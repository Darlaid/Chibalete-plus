/**
 * b2cMinorAuthorization.integration.test.mjs — CHP V9 Bloque II · F7-C4. Representación y autorizaciones de menores (B2C).
 *
 * Servidor REAL (server/server.js), dos réplicas sobre el mismo almacén sintético; pedidos sintéticos por el canal firmado
 * de la tienda; dos familias (F1: compradora que lee y dos menores; F2: comprador, un menor y una lectora adulta distinta)
 * y dos instituciones (A y B). El registro de decisiones es el real (append-only, autenticado), en una ruta temporal.
 *   [1] el pago no es autorización                    [7] cambio y revocación de autorizaciones
 *   [2] compra para un menor: sin decisiones          [8] cancelación antes y después de activar
 *   [3] el menor no es contratante; decisiones incompletas   [9] suscripción vencida
 *   [4] representante: decisiones expresas y vínculo  [10] instituciones: independencia y sin privilegios cruzados
 *   [5] segundo menor: nada se hereda                 [11] autorizaciones ajenas: consultar o modificar
 *   [6] invitación pendiente y reenviada              [12] F7-C3 se conserva
 *
 * POSIX-only; contenedor desechable con CHP_B2C_TEST_SECRET_SANDBOX=1; nunca pisa un secreto existente ni toca datos reales.
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
if (process.platform === 'win32') { console.log('b2cMinorAuthorization.integration: SKIP (POSIX-only)'); process.exit(0); }
if (process.env.CHP_B2C_TEST_SECRET_SANDBOX !== '1') { console.log('b2cMinorAuthorization.integration: SKIP (requiere CHP_B2C_TEST_SECRET_SANDBOX=1 en un contenedor desechable)'); process.exit(0); }
if (fs.existsSync(B2C_PROVISIONING_SECRET_PATH)) { console.error('ABORT: ya existe un secreto B2C en la ruta canónica; esta prueba nunca lo pisa.'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 900)), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TABLA = {};
const DAY = 864e5;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c4_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json',
    identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key' };
fs.mkdirSync(P.uploads, { recursive: true });
const SECRET = crypto.randomBytes(48).toString('hex');
fs.mkdirSync(path.dirname(B2C_PROVISIONING_SECRET_PATH), { recursive: true });
fs.writeFileSync(B2C_PROVISIONING_SECRET_PATH, SECRET, { mode: 0o400 }); fs.chmodSync(B2C_PROVISIONING_SECRET_PATH, 0o400);

const PW = 'contrasena-fixture';
const ORG_A = { organizationId: 'org-a', colegio: 'Colegio A' }, ORG_B = { organizationId: 'org-b', colegio: 'Biblioteca B' };
const hash = bcrypt.hashSync(PW, 4);
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'COLE_A', email: 'lector.a@fixture.invalid', nombre_completo: 'Lector A', password: hash, roles: ['lector'], accountStatus: 'active', groupIds: ['g-a'], ...ORG_A },
    { id: 'MED_A', email: 'mediadora.a@fixture.invalid', nombre_completo: 'Mediadora A', password: hash, roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active', groupIds: [], ...ORG_A },
    { id: 'COLE_B', email: 'lector.b@fixture.invalid', nombre_completo: 'Lector B', password: hash, roles: ['lector'], accountStatus: 'active', groupIds: ['g-b'], ...ORG_B },
    { id: 'MED_B', email: 'mediador.b@fixture.invalid', nombre_completo: 'Mediador B', password: hash, roles: ['mediador'], mediatorKind: 'librarian', accountStatus: 'active', groupIds: [], ...ORG_B },
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'group-b2c-lectores', name: 'Chibalete+ — Lectores', type: 'course', memberIds: [], studentIds: [], mediatorIds: [] },
    { id: 'g-a', name: 'Quinto A', type: 'course', memberIds: ['COLE_A'], studentIds: ['COLE_A'], mediatorIds: ['MED_A'], ...ORG_A, school: 'Colegio A' },
    { id: 'g-b', name: 'Club B', type: 'club', memberIds: ['COLE_B'], studentIds: ['COLE_B'], mediatorIds: ['MED_B'], ...ORG_B, school: 'Biblioteca B' },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio A' }, { id: 'org-b', name: 'Biblioteca B' }]));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'access-b2c-lectores', scope: 'group', scopeId: 'group-b2c-lectores', titleIds: ['obra-1', 'obra-2'], collectionIds: [], expiresAt: null },
    { id: 'rule-a', scope: 'group', scopeId: 'g-a', titleIds: ['obra-a'], collectionIds: [], expiresAt: null },
    { id: 'rule-b', scope: 'group', scopeId: 'g-b', titleIds: ['obra-b'], collectionIds: [], expiresAt: null },
]));
fs.writeFileSync(P.content, JSON.stringify([{ id: 'obra-1', titulo: 'Obra 1', tipo: 'libro' }, { id: 'obra-2', titulo: 'Obra 2', tipo: 'libro' },
    { id: 'obra-a', titulo: 'Obra A', tipo: 'libro' }, { id: 'obra-b', titulo: 'Obra B', tipo: 'libro' }]));
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
const REP = { terms: true, termsVersion: DOCS.terms.version, policy: true, policyVersion: '001@1.0', dataNoticeVersion: DOCS.dataNotice.version, actingAs: 'legal_representative', A0: 'yes', A1: 'yes' };
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

const REG = process.env.CHP_A2_REGISTRY;
const regRaw = () => fs.readFileSync(REG, 'utf8');
const regLines = () => regRaw().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const st = (kind, id) => R.decisionGate().status(kind, id);
const state = (kind, id) => R.decisionGate().state(kind, id);
/** Operador (GVA/AT) con evidencia verificada: mismo camino que ops/a2/decision_operator (appendDecisions, nunca in_app). */
const operator = (subjectId, entries, capacity = 'legal_representative') => R.appendDecisions(entries.map(([kind, status]) => ({ subjectId, kind, status,
    actDay: R.dayOf(Date.now()), version: kind === 'T' ? DOCS.terms.version : DOCS.dataNotice.version, medium: 'paper', capacity, verification: 'verified',
    requestRef: `AUT-SINT-${kind}-${status}-${crypto.randomUUID().slice(0, 8)}` })));
const access = async (cookie, userId, contentId, at = next()) => {
    const r = await fetch(`${at}/api/content/${contentId}/access?userId=${userId}`, { headers: cookie ? { cookie } : {} });
    let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b };
};
const both = async (fn) => [await fn(bases[0]), await fn(bases[1])];
const send = async (method, ruta, cookie, body, at = next()) => {
    const r = await fetch(at + ruta, { method, headers: { 'content-type': 'application/json', origin: 'https://app.test', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body ?? {}) });
    let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b };
};
const me = async (cookie) => (await get('/api/auth/me', cookie)).body;

try {
    if (!await up()) { console.error('El servidor no arrancó:\n' + boot.slice(-3000)); process.exit(1); }
    const groupsBefore = fs.readFileSync(P.groups, 'utf8');
    const F1 = 'compradora.f1@fixture.invalid', F2 = 'comprador.f2@fixture.invalid';

    section('[1] el pago no es autorización (adulta que compra y lee)');
    const o1 = await provision(order(8001, F1, { termsAcceptance: T_NOW() }));
    const U1 = o1.body.userId;
    {
        const t = state('T', U1);
        ok('pedido pagado ⇒ cuenta invitada; queda la aceptación comercial de la compradora (T del checkout, titular) y NADA más', o1.status === 200 && o1.body.accountStatus === 'invited'
            && t?.medium === 'checkout' && t?.capacity === 'titular' && st('A1', U1) === 'pending' && st('A0', U1) === 'pending' && st('A3', U1) === 'pending' && st('A5', U1) === 'pending', JSON.stringify([o1.body, t]));
        ok('pagar no da sesión ni lectura', (await login(F1)).status !== 200 && ruleOf(8001).b2c.pendingActivation === true);
        const bad = await accept(o1.body.activationUrl, { ...ADULT_ACTIVATION, A1: undefined });
        ok('sin la autorización de cuenta y lectura (A1) expresa no se activa (422)', bad.status === 422 && bad.body.code === 'DECISIONS_REQUIRED' && bad.body.required.includes('A1') && userOf(U1).accountStatus === 'invited');
        const act = await accept(o1.body.activationUrl, { ...ADULT_ACTIVATION });
        const a1 = state('A1', U1);
        ok('la titular adulta autoriza A1 en su propia cuenta ⇒ activa; A1 expresa, versionada y efectiva', act.status === 200 && st('A1', U1) === 'effective' && a1.capacity === 'titular' && a1.verification === 'self_authenticated' && a1.version === DOCS.dataNotice.version && a1.medium === 'in_app' && a1.actDay === R.dayOf(Date.now()), JSON.stringify(a1));
        ok('las finalidades opcionales que no decidió siguen pendientes (no se presumen)', st('A3', U1) === 'pending' && st('A5', U1) === 'pending');
    }
    const s1 = await login(F1);
    ok('lee el catálogo de su suscripción', s1.status === 200 && await canRead(s1.cookie, U1, 'obra-1'));

    section('[2] compra para un menor: el pago no anota ninguna decisión');
    {
        const withT = await provision(minor(8002, F1, { name: 'Lupe' }, { termsAcceptance: T_NOW() }));
        ok('la aceptación del checkout (de la compradora) no se admite como aceptación de la cuenta del menor (400)', withT.status === 400 && withT.body.code === 'terms_acceptance_not_applicable', JSON.stringify(withT.body));
    }
    const regBefore2 = regRaw();
    const k1 = await provision(minor(8002, F1, { name: 'Lupe' }));
    const K1 = k1.body.userId;
    const k2 = await provision(minor(8003, F1, { name: 'Tomás' }));
    const K2 = k2.body.userId;
    {
        const u = userOf(K1);
        ok('dos pedidos ⇒ dos cuentas de menor distintas, invitadas, con usuario propio y sin correo; el contacto es el de la compradora', k1.status === 200 && k2.status === 200 && K1 !== K2 && K1 !== U1
            && u.accountStatus === 'invited' && u.email === '' && /^lec-/.test(u.loginId) && u.representedBy.email === F1 && userOf(K2).loginId !== u.loginId, JSON.stringify(k1.body));
        ok('el registro de decisiones no cambió: ni T, ni A0, ni A1 de ningún menor por haber pagado', regRaw() === regBefore2 && ['T', 'A0', 'A1', 'A3', 'A5'].every((k) => st(k, K1) === 'pending' && st(k, K2) === 'pending'));
        ok('el menor no figura como contratante: su cuenta no lleva correo ni datos de pago, y la cuenta de la compradora no cambió de rol', !u.password && JSON.stringify(userOf(U1).roles) === '["lector"]' && userOf(U1).representedBy === undefined);
        ok('sin activar: sin sesión y con el acceso pendiente (F7-C3)', (await login(u.loginId)).status !== 200 && ruleOf(8002).b2c.pendingActivation === true && k1.body.accessState === 'pending_activation');
    }

    section('[3] el menor no es contratante; decisiones incompletas');
    {
        const reg0 = regRaw(), users0 = fs.readFileSync(P.users, 'utf8');
        // F7C4_BASELINE_SKIP_TITULAR=1: solo para medir la línea base del resto de escenarios (ese intento activaría la cuenta).
        const asAdult = process.env.F7C4_BASELINE_SKIP_TITULAR === '1' ? { status: 0, body: {} } : await accept(k1.body.activationUrl, { ...ADULT_ACTIVATION });
        ok('la cuenta de un menor NO se puede activar declarándose «titular mayor de edad» (422 REPRESENTATIVE_REQUIRED)', asAdult.status === 422 && asAdult.body.code === 'REPRESENTATIVE_REQUIRED', JSON.stringify(asAdult.body));
        ok('…y no dejó decisiones de «titular» a nombre del menor ni activó la cuenta', regRaw() === reg0 && userOf(K1).accountStatus === 'invited' && st('A1', K1) === 'pending' && ruleOf(8002).b2c.pendingActivation === true);
        const cases = [
            ['sin A0 (datos del representante)', { ...REP, A0: undefined }, 'DECISIONS_REQUIRED', 'A0'],
            ['sin A1 (cuenta y lectura)', { ...REP, A1: undefined }, 'DECISIONS_REQUIRED', 'A1'],
            ['A0 = no', { ...REP, A0: 'no' }, 'A0_DENIED', null],
            ['A1 = no', { ...REP, A1: 'no' }, 'A1_DENIED', null],
            ['sin aceptar los términos', { ...REP, terms: false }, 'DECISIONS_REQUIRED', 'T'],
            ['versión del 004 distinta de la vigente', { ...REP, dataNoticeVersion: '004@0.9' }, 'VERSION_MISMATCH', null],
            ['sin declarar en qué calidad actúa', { ...REP, actingAs: undefined }, 'DECISIONS_REQUIRED', 'actingAs'],
            ['con A2 = sí (no hay institución)', { ...REP, A2: 'yes' }, 'A2_NOT_APPLICABLE', null],
            ['opcional con un valor que no es sí/no', { ...REP, A3: 'tal vez' }, 'DECISIONS_REQUIRED', 'A3'],
        ];
        const out = [];
        for (const [label, acc, code, req] of cases) {
            const r = await accept(k1.body.activationUrl, acc);
            out.push([label, r.status === 422 && r.body.code === code && (!req || (r.body.required || []).includes(req)), r.body]);
        }
        ok(`autorización incompleta o negada ⇒ 422 en los ${cases.length} casos`, out.every((x) => x[1]), JSON.stringify(out.filter((x) => !x[1])));
        // `users0` cambia solo si algún intento hubiera activado o tocado la cuenta.
        ok('ninguno de esos intentos escribió nada: registro y padrón idénticos, cuenta invitada, acceso pendiente', regRaw() === reg0 && fs.readFileSync(P.users, 'utf8') === users0 && ruleOf(8002).b2c.pendingActivation === true);
    }

    section('[4] representante: decisiones expresas, versionadas y vinculadas a la cuenta');
    const tK1 = Date.now();
    {
        const act = await accept(k1.body.activationUrl, { ...REP, A3: 'yes' });
        const u = userOf(K1), decl = u.representedBy?.declaration;
        ok('el representante declara y autoriza (A0 y A1 = sí; A3 = sí) ⇒ la cuenta del menor se activa', act.status === 200 && u.accountStatus === 'active', JSON.stringify(act.body));
        const kinds = ['T', 'A0', 'A1', 'A3'].map((k) => state(k, K1));
        ok('cada decisión queda con su versión, día, medio y calidad «representante legal», declarada y SIN verificar', kinds.every((s) => s && s.status === 'granted' && s.capacity === 'legal_representative' && s.verification === 'unverified' && s.medium === 'in_app' && s.actDay === R.dayOf(Date.now()))
            && kinds[0].version === DOCS.terms.version && kinds.slice(1).every((s) => s.version === DOCS.dataNotice.version), JSON.stringify(kinds));
        ok('ninguna queda como del «titular»: el menor no aceptó los términos ni autorizó nada por sí mismo', kinds.every((s) => s.capacity !== 'titular') && st('A5', K1) === 'pending');
        const lines = decl ? regLines().filter((l) => l.r === decl.ref) : [];
        ok('la cuenta guarda la constancia de la declaración (referencia y día) y esa referencia es la de sus decisiones en el registro', !!decl && /^ACT-[0-9a-f-]{36}$/.test(decl.ref) && decl.day === R.dayOf(Date.now())
            && lines.length === 5 && JSON.stringify(lines.map((l) => l.k).sort()) === '["A0","A1","A3","P","T"]' && u.representedBy.email === F1, JSON.stringify([decl, lines.map((l) => l.k)]));
        ok('el vínculo verificable: contacto del pedido → enlace de un solo uso → declaración → registro; nada de eso sale al navegador', act.body.user.representedBy === undefined && act.body.user.b2cOrigin === undefined && !JSON.stringify(act.body).includes(F1) && !JSON.stringify(act.body).includes(decl?.ref || 'ACT-'));
        ok('el enlace ya usado no sirve para declarar otra vez', (await accept(k1.body.activationUrl, { ...REP })).status === 404 && regLines().filter((l) => l.r === decl?.ref).length === 5);
    }
    const sK1 = await login(userOf(K1).loginId);
    {
        ok('el menor entra con su usuario y lee (A1 declarada por su representante)', sK1.status === 200 && await canRead(sK1.cookie, K1, 'obra-1'));
        const m = await me(sK1.cookie);
        ok('necesario ≠ opcional: A3 declarada pero sin verificar ⇒ Leo sigue cerrado; la lectura no depende de A3', m.optionalProcessing?.leo === false && m.optionalProcessing?.voiceTranscription === false && st('A3', K1) === 'granted_unverified', JSON.stringify(m));
        ok('su ficha no expone el contacto del adulto ni la constancia', !JSON.stringify(m).includes(F1) && !/representedBy|declaration|ACT-/.test(JSON.stringify(m)));
    }

    section('[5] segundo menor: nada se hereda');
    {
        operator(K1, [['T', 'granted'], ['A0', 'granted'], ['A1', 'granted'], ['A3', 'granted']]);
        const m1 = await me(sK1.cookie);
        ok('GVA verifica la representación de la primera menor ⇒ sus decisiones pasan a efectivas y su A3 abre Leo', st('A1', K1) === 'effective' && st('A0', K1) === 'effective' && m1.optionalProcessing?.leo === true, JSON.stringify(m1));
        ok('el segundo menor, mismo contratante y mismo contacto: sigue invitado y sin ninguna decisión', userOf(K2).accountStatus === 'invited' && ['T', 'A0', 'A1', 'A3', 'A5'].every((k) => st(k, K2) === 'pending') && (await login(userOf(K2).loginId)).status !== 200 && ruleOf(8003).b2c.pendingActivation === true);
        const act2 = await accept(k2.body.activationUrl, { ...REP, A3: 'no' });
        const sK2 = await login(userOf(K2).loginId);
        const m2 = await me(sK2.cookie);
        ok('exige su propia declaración; aquí el representante niega A3 ⇒ su cuenta se activa y Leo queda cerrado para él', act2.status === 200 && st('A3', K2) === 'denied' && m2.optionalProcessing?.leo === false && st('A1', K2) === 'granted_unverified' && await canRead(sK2.cookie, K2, 'obra-1'), JSON.stringify(m2));
        ok('cada cuenta con su propia constancia; la verificación y el A3 de la primera no pasaron al segundo', !!userOf(K2).representedBy.declaration?.ref && userOf(K2).representedBy.declaration?.ref !== userOf(K1).representedBy.declaration?.ref && st('A1', K2) !== 'effective' && (await me(sK1.cookie)).optionalProcessing?.leo === true);
    }

    section('[6] invitación pendiente y reenviada');
    const k3 = await provision(minor(8101, F2, { name: 'Ana' }));
    const K3 = k3.body.userId;
    {
        const reg0 = regRaw(), rules0 = J(P.access).length, users0 = J(P.users).length;
        const again = await provision(minor(8101, F2, { name: 'Ana' }));
        ok('reenvío del mismo pedido ⇒ misma cuenta y misma regla, enlace nuevo, acceso todavía pendiente', again.status === 200 && again.body.status === 'already_activated' && again.body.userId === K3 && again.body.activationUrl !== k3.body.activationUrl
            && again.body.accessState === 'pending_activation' && J(P.access).length === rules0 && J(P.users).length === users0, JSON.stringify(again.body));
        ok('reenviar no anota decisiones ni activa nada', regRaw() === reg0 && userOf(K3).accountStatus === 'invited');
        ok('el enlace anterior deja de valer', (await accept(k3.body.activationUrl, { ...REP })).status === 404 && regRaw() === reg0);
        const t0 = Date.now();
        const act = await accept(again.body.activationUrl, { ...REP });
        ok('con el enlace vigente el representante activa; la vigencia empieza entonces (F7-C3)', act.status === 200 && ruleOf(8101).b2c.activationAt >= t0 && ruleOf(8101).expiresAt === computeExpiresAt(ruleOf(8101).b2c.activationAt));
    }
    const sK3 = await login(userOf(K3).loginId);

    section('[7] cambio y revocación de autorizaciones');
    {
        // (a) revocación PARCIAL: una finalidad opcional.
        operator(K1, [['A3', 'revoked']]);
        const leo = await both(async (b) => (await get('/api/auth/me', sK1.cookie, b)).body.optionalProcessing?.leo);
        ok('revocar A3 (opcional) cierra Leo en las dos réplicas, sin reinicio, y no toca la lectura ni A1', leo.every((x) => x === false) && st('A1', K1) === 'effective' && await canRead(sK1.cookie, K1, 'obra-1'), JSON.stringify(leo));

        // (b) revocación de la autorización NECESARIA (A1) de una cuenta con la representación ya verificada.
        operator(K3, [['T', 'granted'], ['A0', 'granted'], ['A1', 'granted']]);
        ok('antes: la menor de la familia 2 lee', await canRead(sK3.cookie, K3, 'obra-1'));
        const usersBefore = fs.readFileSync(P.users, 'utf8'), rulesBefore = fs.readFileSync(P.access, 'utf8');
        operator(K3, [['A1', 'revoked']]);
        const blocked = await both((b) => access(sK3.cookie, K3, 'obra-1', b));
        ok('A1 revocada ⇒ no abre ningún contenido, en las dos réplicas y sin reinicio (403 AUTHORIZATION_WITHDRAWN)', blocked.every((r) => r.status === 403 && r.body.allowed === false && r.body.errorCode === 'AUTHORIZATION_WITHDRAWN'), JSON.stringify(blocked));
        ok('nada se borró: cuenta, suscripción y fechas idénticas; la revocación no acorta ni alarga la vigencia', fs.readFileSync(P.users, 'utf8') === usersBefore && fs.readFileSync(P.access, 'utf8') === rulesBefore);
        ok('las demás decisiones conservan su historial (T y A0 siguen; A1 consta como revocada, no desaparece)', st('T', K3) === 'effective' && st('A0', K3) === 'effective' && st('A1', K3) === 'revoked' && regLines().length > 0);
        ok('la revocación de una cuenta no afecta a otra familia ni a la otra menor', await canRead(sK1.cookie, K1, 'obra-1') && await canRead(s1.cookie, U1, 'obra-1'));

        // (c) una autorización nueva y expresa (no una compra) la restablece.
        operator(K3, [['A1', 'granted']]);
        ok('solo una nueva autorización expresa y verificada restablece el acceso', (await both((b) => access(sK3.cookie, K3, 'obra-1', b))).every((r) => r.status === 200 && r.body.allowed === true));
        operator(K3, [['A1', 'revoked']]);

        // (d) una compra nueva no reabre lo revocado (001 §11.5).
        const refund = await revoke(8101, 'refunded');
        const reg0 = regRaw(), rules0 = J(P.access).length, users0 = J(P.users).length;
        const rebuy = await provision(minor(8102, F2, { loginId: userOf(K3).loginId }));
        ok('compra nueva para la cuenta con A1 revocada ⇒ 422 authorization_withdrawn: decide una persona', refund.status === 200 && rebuy.status === 422 && rebuy.body.code === 'authorization_withdrawn', JSON.stringify(rebuy.body));
        ok('…sin regla nueva, sin cuenta nueva y sin decisiones: la compra no reactiva la autorización', J(P.access).length === rules0 && J(P.users).length === users0 && regRaw() === reg0 && st('A1', K3) === 'revoked' && !ruleOf(8102));
        ok('la cuenta sigue sin abrir contenido', (await access(sK3.cookie, K3, 'obra-1')).body.allowed === false);

        // (e) negada por el operador (ficha con A1 = No) equivale a retirada; pendiente o sin verificar, no.
        const before = await canRead((await login(userOf(K2).loginId)).cookie, K2, 'obra-1');
        ok('una autorización declarada y aún sin verificar NO se trata como retirada', before === true && st('A1', K2) === 'granted_unverified');
    }

    section('[8] cancelación antes y después de activar');
    {
        const k4 = await provision(minor(8201, F2, { name: 'Leo' }));
        const K4 = k4.body.userId;
        await revoke(8201, 'cancelled');
        const act = await accept(k4.body.activationUrl, { ...REP });
        const sK4 = await login(userOf(K4).loginId);
        ok('pedido cancelado ANTES de activar: el representante puede declarar, pero la cuenta no recibe acceso ni plazo', act.status === 200 && sK4.status === 200 && !(await canRead(sK4.cookie, K4, 'obra-1')) && ruleOf(8201).b2c.revokedBeforeActivation === true && ruleOf(8201).b2c.activationAt === null);
        ok('…y sus decisiones constan igual (la autorización de datos es independiente del pedido)', st('A1', K4) === 'granted_unverified' && !!userOf(K4).representedBy.declaration);

        // Lectora adulta distinta del contratante: el pedido se hace para su correo; ella acepta y autoriza lo suyo.
        const LECT = 'lectora.adulta@fixture.invalid';
        const o = await provision(order(8202, LECT));
        const UL = o.body.userId;
        ok('contratante y lectora adulta distintos: la compra no anota ninguna decisión de la lectora', o.status === 200 && ['T', 'A1'].every((k) => st(k, UL) === 'pending'));
        const actL = await accept(o.body.activationUrl, { ...ADULT_ACTIVATION });
        const sL = await login(LECT);
        ok('la lectora acepta los términos y autoriza A1 por sí misma al activar; lee', actL.status === 200 && state('T', UL).medium === 'in_app' && state('T', UL).capacity === 'titular' && st('A1', UL) === 'effective' && await canRead(sL.cookie, UL, 'obra-1'));
        const refund = await revoke(8202, 'refunded');
        ok('reembolso DESPUÉS de activar: pierde el acceso; sus decisiones y su cuenta se conservan', refund.status === 200 && !(await canRead(sL.cookie, UL, 'obra-1')) && st('A1', UL) === 'effective' && userOf(UL).accountStatus === 'active');
    }

    section('[9] suscripción vencida');
    {
        expireRule(8001);
        await sleep(1200);
        ok('vencida: la compradora no lee; su autorización sigue en el registro (vencer no revoca)', !(await canRead(s1.cookie, U1, 'obra-1')) && st('A1', U1) === 'effective');
        const again = await provision(order(8001, F1, { termsAcceptance: T_NOW() }));
        ok('reenviar el pedido vencido no renueva nada', again.body.status === 'already_activated' && again.body.accessState === 'expired' && !(await canRead(s1.cookie, U1, 'obra-1')), JSON.stringify(again.body));
    }

    section('[10] instituciones: acceso independiente y sin privilegios cruzados');
    {
        const sA = await login('lector.a@fixture.invalid'), sB = await login('lector.b@fixture.invalid'), sMedA = await login('mediadora.a@fixture.invalid'), sMedB = await login('mediador.b@fixture.invalid');
        const a2Before = st('A2', 'COLE_A'), c5Before = st('C005', 'MED_A');
        const o = await provision(order(8301, 'lector.a@fixture.invalid', { termsAcceptance: T_NOW() }));
        ok('un lector del colegio A compra por su cuenta: lee lo del colegio A y lo de su compra; no lo de la institución B', o.status === 200 && o.body.userId === 'COLE_A'
            && await canRead(sA.cookie, 'COLE_A', 'obra-a') && await canRead(sA.cookie, 'COLE_A', 'obra-1') && !(await canRead(sA.cookie, 'COLE_A', 'obra-b')), JSON.stringify(o.body));
        ok('la compra no tocó su A2 ni el compromiso 005 de su mediadora (contratos independientes)', st('A2', 'COLE_A') === a2Before && st('C005', 'MED_A') === c5Before);
        await revoke(8301, 'refunded');
        ok('reembolso de la compra: conserva el acceso institucional y pierde solo el comprado', await canRead(sA.cookie, 'COLE_A', 'obra-a') && !(await canRead(sA.cookie, 'COLE_A', 'obra-1')));
        ok('las cuentas familiares no reciben nada institucional: sin organización, sin grupos, sin contenidos de A ni de B', [K1, K2, U1].every((id) => !userOf(id).organizationId && (userOf(id).groupIds || []).length === 0)
            && !(await canRead(sK1.cookie, K1, 'obra-a')) && !(await canRead(sK1.cookie, K1, 'obra-b')) && fs.readFileSync(P.groups, 'utf8') === groupsBefore);
        ok('el lector de la institución B no lee lo de A ni el catálogo comprado por otros', await canRead(sB.cookie, 'COLE_B', 'obra-b') && !(await canRead(sB.cookie, 'COLE_B', 'obra-a')) && !(await canRead(sB.cookie, 'COLE_B', 'obra-1')));
        const peek = [];
        for (const [who, c] of [['MED_A', sMedA.cookie], ['MED_B', sMedB.cookie], ['COLE_A', sA.cookie]]) {
            for (const target of [K1, U1]) { const r = await get(`/api/access/by-user/${target}`, c); peek.push([who, r.status, JSON.stringify(r.body || {}).includes('access-b2c-test-order')]); }
        }
        ok('ningún mediador ni lector institucional consulta los accesos de una cuenta familiar', peek.every((p) => p[1] !== 200 && p[2] === false), JSON.stringify(peek));
        const lists = [];
        for (const c of [sMedA.cookie, sMedB.cookie, sA.cookie]) { const r = await get('/api/users', c); lists.push(JSON.stringify(r.body || {})); }
        ok('ninguna lista de usuarios que vea una institución expone el contacto del adulto, la constancia ni el usuario de un menor de una familia', lists.every((t) => !t.includes(F1) && !t.includes(F2) && !/ACT-[0-9a-f]{8}/.test(t) && !t.includes(userOf(K1).loginId)), lists.map((t) => t.length).join(','));
        ok('una cuenta personal B2C con A2 = sí no es posible: A2 solo existe con acompañamiento institucional', st('A2', K1) === 'pending' && st('A2', U1) === 'pending');
    }

    section('[11] autorizaciones ajenas: consultar o modificar');
    {
        const reg0 = regRaw(), users0 = fs.readFileSync(P.users, 'utf8'), rules0 = fs.readFileSync(P.access, 'utf8');
        const k5 = await provision(minor(8401, F2, { name: 'Sol' }));
        const K5 = k5.body.userId;
        const users1 = fs.readFileSync(P.users, 'utf8'), rules1 = fs.readFileSync(P.access, 'utf8');
        const tries = [
            ['la menor de F1 consulta los accesos de un menor de F2', await get(`/api/access/by-user/${K3}`, sK1.cookie)],
            ['…o pide abrir contenido en nombre de otro', await access(sK1.cookie, K3, 'obra-1')],
            ['una lectora pide un enlace nuevo para la cuenta invitada de otra familia', await send('POST', '/api/resend-invite', sK1.cookie, { userId: K5 })],
            ['…o intenta activarla o desactivarla por la API de usuarios', await send('PUT', `/api/users/${K5}`, sK1.cookie, { accountStatus: 'active' })],
            ['…o cambiar el contacto del adulto de su propia cuenta', await send('PUT', `/api/users/${K1}`, sK1.cookie, { representedBy: { email: 'otra@fixture.invalid' } })],
            ['…o reinvitar', await send('POST', `/api/users/${K5}/reinvite`, sK1.cookie, {})],
            ['sin sesión: accesos de una cuenta', await get(`/api/access/by-user/${K1}`, null)],
        ];
        ok(`los ${tries.length} intentos se rechazan (401/403)`, tries.every(([, r]) => [401, 403].includes(r.status)), JSON.stringify(tries.map(([l, r]) => [l, r.status])));
        ok('…y no cambiaron nada: padrón, reglas y registro idénticos', fs.readFileSync(P.users, 'utf8') === users1 && fs.readFileSync(P.access, 'utf8') === rules1 && regRaw() === reg0);
        const cross = await provision(minor(8402, F1, { loginId: userOf(K3).loginId }));
        const ghost = await provision(minor(8403, F1, { loginId: 'lec-zzzz-zzzz-zzzz' }));
        ok('comprar «para» el usuario de un menor de OTRA familia ⇒ la misma respuesta neutra que un usuario inexistente (409), sin datos de nadie', cross.status === 409 && ghost.status === 409 && cross.body.code === ghost.body.code && JSON.stringify(cross.body) === JSON.stringify(ghost.body), JSON.stringify([cross.body, ghost.body]));
        const inj = await provision({ ...minor(8404, F1, { name: 'Iker' }), acceptance: { ...REP }, A1: 'yes', reader: { type: 'minor', name: 'Iker', A1: 'yes', actingAs: 'legal_representative' } });
        ok('el canal de la tienda no puede anotar autorizaciones: campos de decisión en el pedido no producen ninguna', regRaw() === reg0 && (inj.status !== 200 || ['T', 'A0', 'A1'].every((k) => st(k, inj.body.userId) === 'pending')), JSON.stringify(inj.body));
        const guess = await accept('/#/activar?token=' + 'f'.repeat(64), { ...REP });
        ok('un token inventado no activa ni declara nada', guess.status === 404 && regRaw() === reg0);
        ok('el registro de decisiones no contiene ningún identificador en claro (ni cuentas, ni correos, ni usuarios de menores)', ![K1, K2, K3, U1, F1, F2, userOf(K1).loginId].some((x) => regRaw().includes(x)));
        void users0; void rules0;
    }

    section('[12] F7-C3 se conserva');
    {
        const r = ruleOf(8002), before = JSON.stringify(r);
        ok('la vigencia de la menor empezó al activarse su cuenta: doce meses completos', r.b2c.activationAt >= tK1 && r.expiresAt === computeExpiresAt(r.b2c.activationAt) && r.b2c.activationBasis === 'account_activated' && days(r.expiresAt) >= 365);
        const dup = await provision(minor(8002, F1, { name: 'Lupe' }));
        ok('aviso duplicado: «already_activated», mismas fechas, sin enlace y sin decisiones nuevas', dup.body.status === 'already_activated' && dup.body.accessState === 'active' && JSON.stringify(ruleOf(8002)) === before && dup.body.activationUrl === null);
        ok('verificar, revocar o restablecer autorizaciones no movió ninguna fecha de suscripción', ruleOf(8101).b2c.revokedAt > 0 && ruleOf(8003).expiresAt === computeExpiresAt(ruleOf(8003).b2c.activationAt));
        await sleep(400);
        const leaks = boot.split('\n').filter((l) => /fixture\.invalid|token=[0-9a-f]{20}/.test(l) && !/\*\*\*@/.test(l) || l.includes(SECRET));
        ok('los registros del servidor no contienen correos, enlaces de activación ni el secreto', leaks.length === 0, leaks.slice(0, 2).join(' | '));
        TABLA['decisiones en el registro'] = regLines().length;
        TABLA['cuentas de menor'] = J(P.users).filter((u) => u.representedBy).length;
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    for (const c of children) { try { c.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    try { fs.rmSync(B2C_PROVISIONING_SECRET_PATH, { force: true }); fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\nb2cMinorAuthorization.integration — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
