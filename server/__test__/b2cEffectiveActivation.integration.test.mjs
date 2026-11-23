/**
 * b2cEffectiveActivation.integration.test.mjs — CHP V9 Bloque II · F7-C3. Activación efectiva de suscripciones B2C.
 *
 * La vigencia de doce meses empieza con la ACTIVACIÓN EFECTIVA del acceso, no con el pago ni con el primer intento de
 * la tienda. Servidor REAL (server/server.js), dos réplicas sobre el mismo almacén sintético, pedidos sintéticos por
 * el canal firmado de la tienda:
 *   [1] compra válida y activación posterior          [7] cuenta adulta y cuenta lectora diferenciadas
 *   [2] fecha de inicio y de vencimiento              [8] pedido cancelado, fallido o pendiente
 *   [3] pago sin activación                           [9] Plan Digital frente a Mi biblioteca
 *   [4] reintento y aviso duplicado                   [10] aislamiento B2C / institucional
 *   [5] menor sin autorización suficiente             [11] acceso vencido; sin renovación automática
 *   [6] representante y autorización válida           [12] identidad, sesiones y lectura
 *
 * El secreto file-only vive en una ruta constante (/app/secrets/b2c_provisioning_secret): la prueba SOLO corre en un
 * contenedor desechable y con opt-in explícito (CHP_B2C_TEST_SECRET_SANDBOX=1); nunca pisa un secreto existente.
 * POSIX-only. Nunca toca datos productivos. Imprime `TABLA {…}`.
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, approveTestDocuments, ADULT_ACTIVATION } from './helpers/testA2.mjs';
a2RegistryPath(); approveTestDocuments();
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { signB2cRequest, computeExpiresAt, B2C_TS_HEADER, B2C_SIG_HEADER } from '../b2c/b2cProvisioning.mjs';
import { B2C_PROVISIONING_SECRET_PATH } from '../lib/b2cProvisioningSecret.js';
import bcrypt from 'bcryptjs';
import * as R from '../privacy/a2Registry.mjs';
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../../utils/acceptanceDocuments.mjs';
import { freePorts } from './helpers/freePort.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (process.platform === 'win32') { console.log('b2cEffectiveActivation.integration: SKIP (POSIX-only)'); process.exit(0); }
if (process.env.CHP_B2C_TEST_SECRET_SANDBOX !== '1') { console.log('b2cEffectiveActivation.integration: SKIP (requiere CHP_B2C_TEST_SECRET_SANDBOX=1 en un contenedor desechable)'); process.exit(0); }
if (fs.existsSync(B2C_PROVISIONING_SECRET_PATH)) { console.error('ABORT: ya existe un secreto B2C en la ruta canónica; esta prueba nunca lo pisa.'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 900)), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TABLA = {};
const DAY = 864e5;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c3_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json',
    identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key' };
fs.mkdirSync(P.uploads, { recursive: true });
const SECRET = crypto.randomBytes(48).toString('hex');
fs.mkdirSync(path.dirname(B2C_PROVISIONING_SECRET_PATH), { recursive: true });
fs.writeFileSync(B2C_PROVISIONING_SECRET_PATH, SECRET, { mode: 0o400 }); fs.chmodSync(B2C_PROVISIONING_SECRET_PATH, 0o400);

const PW = 'contrasena-fixture';
const ORG = { organizationId: 'org-colegio', colegio: 'Colegio Fixture' };
fs.writeFileSync(P.users, JSON.stringify([
    // Lector de colegio (institucional) y su mediadora; un lector institucional que además compra por su cuenta.
    { id: 'COLE', email: 'lector.colegio@fixture.invalid', nombre_completo: 'Lector Colegio', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active', groupIds: ['g-colegio'], ...ORG },
    { id: 'MED', email: 'mediadora@fixture.invalid', nombre_completo: 'Mediadora', password: bcrypt.hashSync(PW, 4), roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active', groupIds: [], ...ORG },
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'group-b2c-lectores', name: 'Chibalete+ — Lectores', type: 'course', memberIds: [], studentIds: [], mediatorIds: [] },
    { id: 'g-colegio', name: 'Quinto', type: 'course', memberIds: ['COLE'], studentIds: ['COLE'], mediatorIds: ['MED'], ...ORG, school: 'Colegio Fixture' },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-colegio', name: 'Colegio Fixture' }]));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'access-b2c-lectores', scope: 'group', scopeId: 'group-b2c-lectores', titleIds: ['obra-1', 'obra-2'], collectionIds: [], expiresAt: null },
    { id: 'rule-colegio', scope: 'group', scopeId: 'g-colegio', titleIds: ['obra-colegio'], collectionIds: [], expiresAt: null },
]));
fs.writeFileSync(P.content, JSON.stringify([{ id: 'obra-1', titulo: 'Obra 1', tipo: 'libro' }, { id: 'obra-2', titulo: 'Obra 2', tipo: 'libro' },
    { id: 'obra-colegio', titulo: 'Obra colegio', tipo: 'libro' }]));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const [PORT1, PORT2] = await freePorts(2);
const bases = [`http://127.0.0.1:${PORT1}`, `http://127.0.0.1:${PORT2}`];
const children = [];
let boot = '';
for (const port of [PORT1, PORT2]) {
    const c = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: tmp + '/data',
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: tmp + '/au.json', IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
        INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db', PROGRESS_SQLITE_PATH: tmp + '/progress.db',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce',
        SESSION_ALLOWED_ORIGINS: 'https://app.test', ALLOWED_ORIGINS: 'https://app.test',
    } });
    c.stdout.on('data', (d) => { boot += d; }); c.stderr.on('data', (d) => { boot += d; });
    children.push(c);
}
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
let turn = 0;
/** Cada llamada alterna de réplica (como el balanceador). */
const next = () => bases[turn++ % 2];
const signed = async (ruta, cuerpo, at = next()) => {
    const raw = JSON.stringify(cuerpo), ts = String(Math.floor(Date.now() / 1000));
    const r = await fetch(at + ruta, { method: 'POST', headers: { 'content-type': 'application/json', [B2C_TS_HEADER]: ts, [B2C_SIG_HEADER]: signB2cRequest(SECRET, ts, raw) }, body: raw });
    let body = null; try { body = await r.json(); } catch { /* */ }
    return { status: r.status, body };
};
const provision = (o, at) => signed('/api/b2c/provision', o, at);
const revoke = (orderId, reason = 'cancelled') => signed('/api/b2c/revoke', { orderId, source: 'test', idempotencyKey: `test:order:${orderId}`, reason });
const order = (orderId, email, extra = {}) => ({ orderId, productId: 345, plan: 'digital', source: 'test', email, fullName: 'Comprador Fixture',
    activationAt: Date.now(), idempotencyKey: `test:order:${orderId}`, ...extra });
const minor = (orderId, email, reader = {}, extra = {}) => order(orderId, email, { reader: { type: 'minor', ...reader }, ...extra });
const T_NOW = () => ({ version: DOCS.terms.version, acceptedAt: Date.now() - 5000 });
const REP = { terms: true, termsVersion: DOCS.terms.version, dataNoticeVersion: DOCS.dataNotice.version, actingAs: 'legal_representative', A0: 'yes', A1: 'yes' };
const accept = async (activationUrl, acceptance, at = next()) => {
    const r = await fetch(at + '/api/accept-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: String(activationUrl).split('token=')[1], password: PW, acceptance }) });
    let body = null; try { body = await r.json(); } catch { /* */ }
    return { status: r.status, body };
};
const login = async (identifier, at = next()) => {
    const r = await fetch(at + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identifier, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    return { status: r.status, cookie: m ? `chp_session=${m[1]}` : null };
};
const canRead = async (cookie, userId, contentId, at = next()) => {
    const r = await fetch(`${at}/api/content/${contentId}/access?userId=${userId}`, { headers: cookie ? { cookie } : {} });
    let b = null; try { b = await r.json(); } catch { /* */ } return r.status === 200 && b?.allowed === true;
};
const get = async (ruta, cookie, at = next()) => { const r = await fetch(at + ruta, { headers: cookie ? { cookie } : {} }); let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b }; };
const ruleOf = (orderId) => J(P.access).find((r) => r.id === `access-b2c-test-order-${orderId}`);
const userOf = (id) => J(P.users).find((u) => u.id === id);
const stores = () => [P.users, P.access, process.env.CHP_A2_REGISTRY].map((f) => fs.readFileSync(f, 'utf8')).join('\u0000');
/** «Pasa el año»: la regla ya iniciada de ese pedido pasa a haber empezado hace 13 meses (almacén sintético). */
const expireRule = (orderId) => {
    const rules = J(P.access), r = rules.find((x) => x.id === `access-b2c-test-order-${orderId}`), past = Date.now() - 35 * DAY;
    r.expiresAt = past; r.b2c = { ...r.b2c, expiresAt: past, activationAt: past - 365 * DAY };
    fs.writeFileSync(P.access + '.tmp', JSON.stringify(rules)); fs.renameSync(P.access + '.tmp', P.access);
};
const days = (ms) => Math.round((ms - Date.now()) / DAY);
const gate = () => R.decisionGate({ env: { CHP_A2_REGISTRY: process.env.CHP_A2_REGISTRY } });
const up = async () => { for (const b of bases) { let ready = false; for (let i = 0; i < 160 && !ready; i++) { try { ready = (await fetch(b + '/api/health')).ok; } catch { /* */ } if (!ready) await sleep(250); } if (!ready) return false; } return true; };

try {
    if (!await up()) { console.error('El servidor no arrancó:\n' + boot.slice(-3000)); process.exit(1); }
    const groupsBefore = fs.readFileSync(P.groups, 'utf8');

    section('[1] compra válida y activación posterior · [2] fecha de inicio y de vencimiento');
    // La tienda aprovisiona el pedido 6 días después del primer intento (revisión manual, bloqueo documental o reintentos).
    const paidAt = Date.now() - 6 * DAY;
    const A = order(7001, 'adulta@fixture.invalid', { activationAt: paidAt });
    const a1 = await provision(A);
    {
        ok('pedido pagado ⇒ 200, cuenta invitada con enlace, acceso PENDIENTE de activación (sin fechas)', a1.status === 200 && a1.body.status === 'activated' && a1.body.accountStatus === 'invited' && /token=[0-9a-f]{64}$/.test(a1.body.activationUrl || '')
            && a1.body.accessState === 'pending_activation' && a1.body.activationAt === null && a1.body.expiresAt === null && a1.body.requestedAt === paidAt, JSON.stringify(a1.body));
        const r = ruleOf(7001);
        ok('la regla del pedido existe pero no concede nada: pendiente, sin inicio, vencimiento 0', r.b2c.pendingActivation === true && r.b2c.activationAt === null && r.expiresAt === 0 && r.b2c.requestedAt === paidAt, JSON.stringify(r.b2c));
        const t0 = Date.now();
        const act = await accept(a1.body.activationUrl, { ...ADULT_ACTIVATION });
        const s = ruleOf(7001);
        TABLA['pedido aprovisionado 6 días después del primer intento · días de vigencia al activar [antes: 359, ahora]'] = [days(computeExpiresAt(paidAt)), days(s.expiresAt)];
        ok('la cuenta se activa (200) y en ese momento empieza la vigencia', act.status === 200 && s.b2c.pendingActivation === undefined && s.b2c.activationAt >= t0 && s.b2c.activationAt <= Date.now() && s.b2c.activationBasis === 'account_activated', JSON.stringify(s.b2c));
        ok('vencimiento = mismo día 12 meses después de la ACTIVACIÓN, fin del día en Bogotá', s.expiresAt === computeExpiresAt(s.b2c.activationAt) && s.b2c.expiresAt === s.expiresAt);
        ok('…doce meses completos desde hoy: los 6 días que el pedido esperó no se descuentan (antes vencía 6 días antes)', s.expiresAt > computeExpiresAt(paidAt) && days(s.expiresAt) >= 364, `${days(s.expiresAt)} vs ${days(computeExpiresAt(paidAt))}`);
        ok('la fecha que envió la tienda se conserva como «pedido el», sin efecto sobre la vigencia', s.b2c.requestedAt === paidAt);
        const L = await login('adulta@fixture.invalid');
        ok('la lectora inicia sesión y abre una obra del plan, en las dos réplicas', L.status === 200 && await canRead(L.cookie, a1.body.userId, 'obra-1', bases[0]) && await canRead(L.cookie, a1.body.userId, 'obra-1', bases[1]));
    }

    section('[3] pago sin activación');
    const B = order(7002, 'sin.activar@fixture.invalid', { activationAt: Date.now() - 60 * DAY });
    const b1 = await provision(B);
    {
        ok('pagado hace 60 días y nunca activado: la regla sigue pendiente y no vence', b1.body.accessState === 'pending_activation' && ruleOf(7002).b2c.pendingActivation === true);
        ok('sin activar no hay sesión posible (la cuenta invitada no inicia sesión)', (await login('sin.activar@fixture.invalid')).status !== 200);
        ok('sin sesión no se abre ninguna obra', !(await canRead(null, b1.body.userId, 'obra-1')));
        const u = userOf(b1.body.userId);
        ok('la cuenta invitada no tiene contraseña ni decisiones registradas: pagar no acredita aceptación', !u.password && gate().state('T', u.id) === null && gate().state('A1', u.id) === null, JSON.stringify(gate().state('T', u.id)));
        const act = await accept(b1.body.activationUrl, { ...ADULT_ACTIVATION });
        ok('al activar 60 días después recibe sus doce meses completos', act.status === 200 && days(ruleOf(7002).expiresAt) >= 364, String(days(ruleOf(7002).expiresAt)));
        TABLA['pagado hace 60 días, activado hoy · días de vigencia [antes, ahora]'] = [days(computeExpiresAt(B.activationAt)), days(ruleOf(7002).expiresAt)];
    }

    section('[4] reintento y aviso duplicado');
    {
        const C = order(7003, 'reintentos@fixture.invalid');
        const n0 = [J(P.users).length, J(P.access).length];
        const [c1, c2, c3] = await Promise.all([provision(C, bases[0]), provision(C, bases[1]), provision(C, bases[0])]);
        ok('el mismo pedido tres veces a la vez por dos réplicas ⇒ 200 las tres, una sola «activated»', [c1, c2, c3].every((x) => x.status === 200) && [c1, c2, c3].filter((x) => x.body.status === 'activated').length === 1, JSON.stringify([c1.body.status, c2.body.status, c3.body.status]));
        ok('…una sola cuenta y una sola regla', J(P.users).length === n0[0] + 1 && J(P.access).length === n0[1] + 1 && new Set([c1, c2, c3].map((x) => x.body.userId)).size === 1);
        const last = await provision(C);   // el enlace vigente es el del último reintento
        ok('los reintentos no inician la vigencia', last.body.accessState === 'pending_activation' && ruleOf(7003).b2c.pendingActivation === true);
        const act = await accept(last.body.activationUrl, { ...ADULT_ACTIVATION }), s = ruleOf(7003);
        const again = await accept(last.body.activationUrl, { ...ADULT_ACTIVATION });
        ok('activar dos veces: la segunda se rechaza y no mueve las fechas', act.status === 200 && again.status !== 200 && ruleOf(7003).expiresAt === s.expiresAt && ruleOf(7003).b2c.activationAt === s.b2c.activationAt, `${again.status}`);
        await sleep(1100);
        const [d1, d2] = await Promise.all([provision({ ...C, activationAt: Date.now() }, bases[0]), provision({ ...C, activationAt: Date.now() }, bases[1])]);
        ok('aviso duplicado de la tienda DESPUÉS de activar: «already_activated», mismas fechas, sin enlace nuevo', [d1, d2].every((x) => x.status === 200 && x.body.status === 'already_activated' && x.body.accessState === 'active' && x.body.expiresAt === s.expiresAt && x.body.activationAt === s.b2c.activationAt && x.body.activationUrl === null), JSON.stringify(d1.body));
        ok('…y la regla no cambió (ni se reinició ni se duplicó el beneficio)', JSON.stringify(ruleOf(7003)) === JSON.stringify(s) && J(P.access).filter((r) => r.scopeId === c1.body.userId).length === 1);
        const second = await provision(order(7004, 'reintentos@fixture.invalid', { termsAcceptance: T_NOW() }));
        ok('otra compra de la misma cuenta con la suscripción en curso ⇒ 409, sin sumar meses', second.status === 409 && second.body.code === 'conflict_active_subscription' && !ruleOf(7004));
        const pend = await provision(order(7005, 'sin.activar.2@fixture.invalid'));
        const dup = await provision(order(7006, 'sin.activar.2@fixture.invalid'));
        ok('…también si la primera está pagada y pendiente de activación', pend.status === 200 && dup.status === 409 && dup.body.code === 'conflict_active_subscription' && !ruleOf(7006), JSON.stringify(dup.body));
    }

    section('[5] menor sin autorización suficiente');
    const TUTOR = 'tutora@fixture.invalid';
    const k1 = await provision(minor(7101, TUTOR, { name: 'Lupe' }));
    {
        ok('pedido para un lector menor ⇒ cuenta representada (usuario lec-…), acceso pendiente', k1.status === 200 && /^lec-/.test(k1.body.loginId || '') && k1.body.accessState === 'pending_activation', JSON.stringify(k1.body));
        const before = stores();
        const tries = { 'sin decisiones': {}, 'sin declarar la representación': { ...REP, A0: undefined }, 'representante que NO autoriza el tratamiento (A1 = no)': { ...REP, A1: 'no' },
            'quien activa declara no ser representante (A0 = no)': { ...REP, A0: 'no' }, 'como titular adulto, sin declarar mayoría de edad': { terms: true, termsVersion: DOCS.terms.version, dataNoticeVersion: DOCS.dataNotice.version, actingAs: 'titular', A1: 'yes' } };
        const out = {};
        for (const [name, acc] of Object.entries(tries)) out[name] = (await accept(k1.body.activationUrl, acc)).status;
        ok('ningún intento sin autorización suficiente activa la cuenta (422 en todos)', Object.values(out).every((s) => s === 422), JSON.stringify(out));
        ok('…ni escribe cuentas, reglas o decisiones', stores() === before);
        ok('…la cuenta sigue invitada y el acceso pendiente: sin sesión, sin lectura y sin plazo corriendo', userOf(k1.body.userId).accountStatus === 'invited' && ruleOf(7101).b2c.pendingActivation === true && (await login(k1.body.loginId)).status !== 200);
        ok('el pago no anotó ninguna decisión en nombre del menor ni de su representante', ['T', 'A0', 'A1', 'A2', 'A3'].every((k) => gate().state(k, k1.body.userId) === null));
        const withT = await provision(minor(7102, TUTOR, {}, { termsAcceptance: T_NOW() }));
        ok('la aceptación del comprador en el checkout no vale como autorización del menor (400, sin escrituras)', withT.status === 400 && withT.body.code === 'terms_acceptance_not_applicable' && !ruleOf(7102));
    }

    section('[6] representante y autorización válida');
    {
        const t0 = Date.now();
        const act = await accept(k1.body.activationUrl, { ...REP, A3: 'no' });
        const s = ruleOf(7101), g = gate();
        ok('el representante declara y autoriza (A0 y A1 = sí) ⇒ la cuenta del menor se activa y su vigencia empieza entonces', act.status === 200 && s.b2c.activationAt >= t0 && s.expiresAt === computeExpiresAt(s.b2c.activationAt) && userOf(k1.body.userId).accountStatus === 'active', JSON.stringify(s.b2c));
        ok('las decisiones quedan en la cuenta del MENOR, como representante legal y sin verificar (lo verifica GVA): nada se completa por inferencia', ['T', 'A0', 'A1'].every((k) => g.state(k, k1.body.userId)?.status === 'granted' && g.state(k, k1.body.userId).capacity === 'legal_representative' && g.state(k, k1.body.userId).verification === 'unverified') && g.state('A3', k1.body.userId)?.status === 'denied', JSON.stringify(g.state('A1', k1.body.userId)));
        const L = await login(k1.body.loginId);
        ok('el lector menor entra con su usuario y lee las obras del plan', L.status === 200 && await canRead(L.cookie, k1.body.userId, 'obra-1'));
        // Recompra para la misma cuenta, ya activa: exige la representación VERIFICADA.
        expireRule(7101);
        const noVerif = await provision(minor(7103, TUTOR, { loginId: k1.body.loginId }));
        ok('recompra con la representación solo declarada ⇒ 422, sin acceso nuevo (revisión de una persona)', noVerif.status === 422 && noVerif.body.code === 'terms_acceptance_required' && !ruleOf(7103), JSON.stringify(noVerif.body));
        R.appendDecisions([{ subjectId: k1.body.userId, kind: 'T', status: 'granted', actDay: R.dayOf(Date.now()), version: DOCS.terms.version, medium: 'paper', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-SINT-F7C3-T' }], { env: { CHP_A2_REGISTRY: process.env.CHP_A2_REGISTRY } });
        const verif = await provision(minor(7103, TUTOR, { loginId: k1.body.loginId }, { activationAt: Date.now() - 3 * DAY }));
        ok('con la representación verificada por GVA ⇒ acceso activo de inmediato en la MISMA cuenta; inicio = ahora, no la fecha de la tienda', verif.status === 200 && verif.body.userId === k1.body.userId && verif.body.accessState === 'active' && verif.body.activationUrl === null
            && verif.body.activationAt >= Date.now() - 60_000 && verif.body.expiresAt === computeExpiresAt(verif.body.activationAt) && ruleOf(7103).b2c.activationBasis === 'rule_granted', JSON.stringify(verif.body));
    }

    section('[7] cuenta adulta y cuenta lectora diferenciadas');
    {
        const users = J(P.users), kid = userOf(k1.body.userId);
        ok('la compra para un menor NO crea una cuenta con el correo del adulto que paga', !users.some((u) => u.email === TUTOR));
        ok('la cuenta de lectura es del menor: usuario propio, sin correo, con el contacto del adulto solo como vínculo', kid.email === '' && /^lec-/.test(kid.loginId) && kid.representedBy?.email === TUTOR && kid.roles.join() === 'lector');
        ok('el menor no asume la contratación: ni el pedido ni el pago figuran como decisiones suyas (ninguna «titular»)', ['T', 'A0', 'A1'].every((k) => gate().state(k, kid.id).capacity !== 'titular'));
        const k2 = await provision(minor(7104, TUTOR, { name: 'Tomás' }));
        ok('un segundo menor con el mismo contacto recibe SU propia cuenta y su propio acceso pendiente', k2.status === 200 && k2.body.userId !== k1.body.userId && k2.body.loginId !== k1.body.loginId && k2.body.accessState === 'pending_activation');
        const self = await provision(order(7105, TUTOR, { termsAcceptance: T_NOW() }));
        ok('si ese adulto compra para SÍ, es otra cuenta (la suya, con su correo), distinta de las de los menores', self.status === 200 && ![k1.body.userId, k2.body.userId].includes(self.body.userId) && userOf(self.body.userId).email === TUTOR && !userOf(self.body.userId).loginId);
        const client = await get('/api/auth/me', (await login(k1.body.loginId)).cookie);
        ok('la sesión del menor no expone el correo del adulto ni datos del pedido', client.status === 200 && !JSON.stringify(client.body).includes(TUTOR) && !/order|pedido/i.test(JSON.stringify(client.body)), JSON.stringify(client.body).slice(0, 300));
    }

    section('[8] pedido cancelado, fallido o pendiente');
    {
        // Un pedido sin pagar (pendiente o fallido) nunca llega a la app: la tienda no lo envía. Aquí, lo que la app garantiza:
        ok('sin aviso de la tienda no existe cuenta ni regla (pedido pendiente o fallido = nada en la app)', !ruleOf(7999) && !J(P.users).some((u) => u.email === 'nunca.pago@fixture.invalid'));
        const bad = await fetch(next() + '/api/b2c/provision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order(7999, 'nunca.pago@fixture.invalid')) });
        ok('una petición sin la firma de la tienda no aprovisiona nada (401)', bad.status === 401 && !ruleOf(7999));
        const X = await provision(order(7201, 'cancela@fixture.invalid'));
        const rv = await revoke(7201, 'cancelled');
        ok('pedido cancelado ANTES de activar: la regla queda revocada y deja de estar pendiente', rv.status === 200 && rv.body.status === 'revoked' && ruleOf(7201).b2c.revokedAt > 0 && ruleOf(7201).b2c.pendingActivation === undefined && ruleOf(7201).b2c.revokedBeforeActivation === true, JSON.stringify(ruleOf(7201).b2c));
        const act = await accept(X.body.activationUrl, { ...ADULT_ACTIVATION });
        const L = await login('cancela@fixture.invalid');
        ok('…si después activa la cuenta, la cuenta existe pero el pedido cancelado NO le da acceso ni inicia ningún plazo', act.status === 200 && L.status === 200 && !(await canRead(L.cookie, X.body.userId, 'obra-1')) && ruleOf(7201).expiresAt <= Date.now() && ruleOf(7201).b2c.activationAt === null);
        const again = await provision(order(7201, 'cancela@fixture.invalid'));
        ok('…y reenviar el pedido cancelado no lo revive', again.status === 200 && again.body.accessState === 'revoked' && !(await canRead(L.cookie, X.body.userId, 'obra-1')), JSON.stringify(again.body));
        const Y = await provision(order(7202, 'reembolso@fixture.invalid'));
        await accept(Y.body.activationUrl, { ...ADULT_ACTIVATION });
        const LY = await login('reembolso@fixture.invalid');
        const okBefore = await canRead(LY.cookie, Y.body.userId, 'obra-1');
        const rf = await revoke(7202, 'refunded');
        ok('reembolso de un pedido activo: el acceso termina en ese momento, en las dos réplicas', okBefore && rf.body.status === 'revoked' && !(await canRead(LY.cookie, Y.body.userId, 'obra-1', bases[0])) && !(await canRead(LY.cookie, Y.body.userId, 'obra-1', bases[1])));
        ok('revocar dos veces no cambia nada', (await revoke(7202, 'refunded')).body.status === 'already_revoked');
    }

    section('[9] Plan Digital frente a Mi biblioteca');
    {
        const D = await provision(order(7301, 'digital@fixture.invalid', { productId: 345, plan: 'digital' }));
        const M = await provision(order(7302, 'mibiblioteca@fixture.invalid', { productId: 346, plan: 'mi_biblioteca' }));
        await accept(D.body.activationUrl, { ...ADULT_ACTIVATION }); await accept(M.body.activationUrl, { ...ADULT_ACTIVATION });
        const rd = ruleOf(7301), rm = ruleOf(7302);
        ok('los dos planes (#345 Digital, #346 Mi biblioteca) dan el mismo acceso digital, con su plan y su producto anotados', rd.b2c.plan === 'digital' && rd.b2c.productId === 345 && rm.b2c.plan === 'mi_biblioteca' && rm.b2c.productId === 346 && JSON.stringify(rd.titleIds) === JSON.stringify(rm.titleIds));
        ok('los dos con doce meses desde su activación efectiva', days(rd.expiresAt) >= 364 && days(rm.expiresAt) >= 364 && rd.b2c.activationBasis === 'account_activated' && rm.b2c.activationBasis === 'account_activated');
        ok('un plan desconocido o un producto inválido no aprovisiona (400)', (await provision(order(7303, 'x@fixture.invalid', { plan: 'premium' }))).body.code === 'invalid_plan' && (await provision(order(7304, 'x@fixture.invalid', { productId: 0 }))).body.code === 'invalid_product_id');
        ok('la app devuelve a la tienda cuándo lo pidió (base de su calendario de envíos de Mi biblioteca), sin tocarlo', (await provision(order(7302, 'mibiblioteca@fixture.invalid', { productId: 346, plan: 'mi_biblioteca' }))).body.requestedAt === rm.b2c.requestedAt);
    }

    section('[10] aislamiento B2C / institucional');
    {
        const adulta = J(P.users).find((u) => u.email === 'adulta@fixture.invalid');
        ok('quien compra no entra en ningún grupo ni recibe organización: una compra no crea vínculo institucional', adulta.groupIds.length === 0 && !adulta.organizationId && !adulta.colegio && fs.readFileSync(P.groups, 'utf8') === groupsBefore);
        const L = await login('adulta@fixture.invalid');
        ok('…y no abre la obra del colegio', !(await canRead(L.cookie, adulta.id, 'obra-colegio')));
        const before = J(P.access).find((r) => r.id === 'rule-colegio');
        const school = await provision(order(7401, 'lector.colegio@fixture.invalid', { termsAcceptance: T_NOW() }));
        const LC = await login('lector.colegio@fixture.invalid');
        ok('un lector de colegio que compra por su cuenta conserva su acceso institucional intacto y suma el del plan', school.status === 200 && school.body.userId === 'COLE' && JSON.stringify(J(P.access).find((r) => r.id === 'rule-colegio')) === JSON.stringify(before)
            && await canRead(LC.cookie, 'COLE', 'obra-colegio') && await canRead(LC.cookie, 'COLE', 'obra-1') && userOf('COLE').groupIds.join() === 'g-colegio', JSON.stringify(school.body));
        ok('…la regla comprada es personal (de la cuenta), nunca de un grupo o de la organización', ruleOf(7401).scope === 'user' && ruleOf(7401).scopeId === 'COLE' && J(P.access).filter((r) => r.b2c).every((r) => r.scope === 'user'));
        expireRule(7401);
        ok('vencida su compra, sigue leyendo lo del colegio y deja de leer lo del plan', await canRead(LC.cookie, 'COLE', 'obra-colegio') && !(await canRead(LC.cookie, 'COLE', 'obra-1')));
        const LM = await login('mediadora@fixture.invalid');
        const kid = await get(`/api/progress/user/${k1.body.userId}`, LM.cookie), own = await get(`/api/access/by-user/${adulta.id}`, LM.cookie);
        ok('la mediadora del colegio no consulta cuentas B2C personales (403)', kid.status === 403 && own.status === 403, `${kid.status} ${own.status}`);
        ok('ninguna compra B2C alteró reglas de grupo ni de organización', J(P.access).filter((r) => !r.b2c).length === 2);
    }

    section('[11] acceso vencido; sin renovación automática');
    {
        const adulta = J(P.users).find((u) => u.email === 'adulta@fixture.invalid');
        const L = await login('adulta@fixture.invalid');
        expireRule(7001);
        ok('pasado el año: la cuenta sigue existiendo e inicia sesión, pero ya no abre las obras del plan (dos réplicas)', (await login('adulta@fixture.invalid')).status === 200 && !(await canRead(L.cookie, adulta.id, 'obra-1', bases[0])) && !(await canRead(L.cookie, adulta.id, 'obra-1', bases[1])));
        const leo = await fetch(next() + '/api/leo/ask', { method: 'POST', headers: { 'content-type': 'application/json', cookie: L.cookie, Origin: 'https://app.test', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ contentId: 'obra-1', question: '¿de qué trata?' }) });
        let lb = null; try { lb = await leo.json(); } catch { /* */ }
        ok('…y lo que solo exigía sesión responde «tu suscripción terminó»', leo.status === 403 && lb?.code === 'ENTITLEMENT_EXPIRED', `${leo.status} ${JSON.stringify(lb)}`);
        const n = J(P.access).length;
        await get(`/api/access/by-user/${adulta.id}`, L.cookie); await login('adulta@fixture.invalid');
        ok('no hay renovación automática: usar la cuenta vencida no crea reglas ni mueve fechas', J(P.access).length === n && ruleOf(7001).expiresAt < Date.now());
        const re = await provision({ ...A, activationAt: Date.now() });
        ok('reenviar el pedido vencido no lo renueva: «already_activated», estado vencido, mismas fechas', re.status === 200 && re.body.status === 'already_activated' && re.body.accessState === 'expired' && re.body.expiresAt === ruleOf(7001).expiresAt && !(await canRead(L.cookie, adulta.id, 'obra-1')), JSON.stringify(re.body));
        const renew = await provision(order(7501, 'adulta@fixture.invalid', { termsAcceptance: T_NOW() }));
        ok('una compra NUEVA (otro pedido) sí da otros doce meses desde que se concede', renew.status === 200 && renew.body.accessState === 'active' && days(renew.body.expiresAt) >= 364 && await canRead(L.cookie, adulta.id, 'obra-1'), JSON.stringify(renew.body));
    }

    section('[12] identidad, sesiones y lectura');
    {
        const L = await login('reintentos@fixture.invalid');
        const me = await get('/api/auth/me', L.cookie), uid = me.body?.user?.id ?? me.body?.id;
        ok('sesión por cookie firmada: /api/auth/me devuelve a la propia cuenta', me.status === 200 && typeof uid === 'string' && uid === J(P.users).find((u) => u.email === 'reintentos@fixture.invalid').id, JSON.stringify(me.body).slice(0, 200));
        ok('sin sesión: 401 en /api/auth/me y ninguna obra', (await get('/api/auth/me', null)).status === 401 && !(await canRead(null, uid, 'obra-1')));
        const other = J(P.users).find((u) => u.email === 'digital@fixture.invalid');
        ok('una cuenta no consulta el acceso de otra (403)', (await get(`/api/access/by-user/${other.id}`, L.cookie)).status === 403);
        const sync = await fetch(`${next()}/api/progress/${uid}/obra-1/sync`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: L.cookie, Origin: 'https://app.test', 'sec-fetch-site': 'same-origin' },
            body: JSON.stringify({ canonicalProgress: { globalPercentage: 12 }, updatedAt: new Date().toISOString(), session: { sessionId: 'f7c3-s1', startedAt: new Date(Date.now() - 6e5).toISOString(), durationSec: 600, mode: 'text' } }) });
        const item = await get(`/api/progress/item/${uid}/obra-1`, L.cookie);
        ok('la lectora guarda su progreso y lo vuelve a leer en la otra réplica', sync.status === 200 && item.status === 200 && JSON.stringify(item.body).includes('12'), `${sync.status} ${JSON.stringify(item.body).slice(0, 200)}`);
        // Autocuración: una cuenta activa con una regla que quedó pendiente (su inicio no llegó a escribirse) se inicia al usarla.
        const H = await provision(order(7601, 'autocura@fixture.invalid'));
        const users = J(P.users), hu = users.find((u) => u.id === H.body.userId);
        hu.accountStatus = 'active'; hu.password = bcrypt.hashSync(PW, 4); delete hu.inviteToken; delete hu.inviteExpiresAt;
        fs.writeFileSync(P.users + '.tmp', JSON.stringify(users)); fs.renameSync(P.users + '.tmp', P.users);
        R.appendDecisions([{ subjectId: hu.id, kind: 'T', status: 'granted', actDay: R.dayOf(Date.now()), version: DOCS.terms.version, medium: 'in_app', capacity: 'titular', verification: 'self_authenticated', requestRef: 'ACT-SINT-F7C3' }], { env: { CHP_A2_REGISTRY: process.env.CHP_A2_REGISTRY } });
        const LH = await login('autocura@fixture.invalid');
        const mine = await get(`/api/access/by-user/${hu.id}`, LH.cookie);
        ok('cuenta activa con la regla aún pendiente: al consultar su propio acceso la vigencia se inicia (una vez)', mine.status === 200 && ruleOf(7601).b2c.pendingActivation === undefined && days(ruleOf(7601).expiresAt) >= 364 && await canRead(LH.cookie, hu.id, 'obra-1'), JSON.stringify(ruleOf(7601).b2c));
        const snap = JSON.stringify(ruleOf(7601));
        await get(`/api/access/by-user/${hu.id}`, LH.cookie, bases[0]); await get(`/api/access/by-user/${hu.id}`, LH.cookie, bases[1]);
        ok('…y volver a consultarlo no la reinicia', JSON.stringify(ruleOf(7601)) === snap);
        // (el servidor registra los correos enmascarados, `s***@…`: eso no es una fuga)
        const leaks = boot.split(/\r?\n/).filter((l) => /[a-z0-9.]{2,}@fixture\.invalid|token=[0-9a-f]{20}/i.test(l) || l.includes(SECRET));
        ok('los registros del servidor no contienen correos, enlaces de activación ni el secreto', leaks.length === 0, leaks.slice(0, 2).join(' | '));
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    for (const c of children) { try { c.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    try { fs.rmSync(B2C_PROVISIONING_SECRET_PATH, { force: true }); fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\nb2cEffectiveActivation.integration — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
