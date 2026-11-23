/**
 * b2cRepresentationOps.integration.test.mjs — CHP V9 Bloque II · BII-CLOSE-1. Cierre operativo de representación y autorizaciones (B2C).
 *
 * Servidor REAL, dos réplicas sobre el mismo almacén sintético (más una tercera y una cuarta para el registro
 * indisponible), pedidos sintéticos por el canal firmado de la tienda, registro de decisiones real en ruta temporal.
 * Los pasos de GVA/AT se ejecutan con las herramientas que existen: decisiones verificadas (el camino de
 * ops/a2/decision_operator.mjs), `POST /api/users/:id/reinvite` y `POST /api/users/:id/representation`.
 *   [1] declarado frente a verificado: qué se permite antes y después    [6] cambio de representante
 *   [2] verificación negativa o imposible                               [7] mayoría de edad
 *   [3] A1 revocada: el bloqueo continúa                                [8] compra y activación diferidas: fechas
 *   [4] registro de autorizaciones indisponible                         [9] aislamiento B2C / institucional
 *   [5] restablecimiento autorizado
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
if (process.platform === 'win32') { console.log('b2cRepresentationOps.integration: SKIP (POSIX-only)'); process.exit(0); }
if (process.env.CHP_B2C_TEST_SECRET_SANDBOX !== '1') { console.log('b2cRepresentationOps.integration: SKIP (requiere CHP_B2C_TEST_SECRET_SANDBOX=1 en un contenedor desechable)'); process.exit(0); }
if (fs.existsSync(B2C_PROVISIONING_SECRET_PATH)) { console.error('ABORT: ya existe un secreto B2C en la ruta canónica; esta prueba nunca lo pisa.'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 900)), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TABLA = {};
const DAY = 864e5;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_biic1_'));
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
    { id: 'ADM', email: 'admin.at@fixture.invalid', nombre_completo: 'Administración AT', password: hash, roles: ['administrador'], accountStatus: 'active', groupIds: [] },
    { id: 'ADM2', email: 'admin.dos@fixture.invalid', nombre_completo: 'Administración Dos', password: hash, roles: ['administrador'], accountStatus: 'active', groupIds: [] },
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

const REG = process.env.CHP_A2_REGISTRY;
const regRaw = () => fs.readFileSync(REG, 'utf8');
const regLines = () => regRaw().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const st = (kind, id) => R.decisionGate().status(kind, id);
const state = (kind, id) => R.decisionGate().state(kind, id);
/** GVA/AT con evidencia verificada: el mismo camino que ops/a2/decision_operator.mjs (appendDecisions; nunca in_app). */
const operator = (subjectId, entries, capacity = 'legal_representative') => R.appendDecisions(entries.map(([kind, status]) => ({ subjectId, kind, status,
    actDay: R.dayOf(Date.now()), version: kind === 'T' ? DOCS.terms.version : DOCS.dataNotice.version, medium: 'paper', capacity, verification: 'verified',
    requestRef: `GVA-SINT-${kind}-${status}-${crypto.randomUUID().slice(0, 8)}` })));
const access = async (cookie, userId, contentId, at = next()) => {
    const r = await fetch(`${at}/api/content/${contentId}/access?userId=${userId}`, { headers: cookie ? { cookie } : {} });
    let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b };
};
const both = async (fn) => [await fn(bases[0]), await fn(bases[1])];
const send = async (method, ruta, cookie, body, at = next()) => {
    const r = await fetch(at + ruta, { method, headers: { 'content-type': 'application/json', origin: 'https://app.test', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body ?? {}) });
    let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b };
};
const me = async (cookie, at = next()) => (await get('/api/auth/me', cookie, at)).body;
const extra = [];
/** Otra réplica sobre el MISMO almacén, con su propio registro de decisiones (para el registro indisponible). */
const spawnReplica = async (registry) => {
    const [port] = await freePorts(1);
    const c = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: tmp + '/data', CHP_A2_REGISTRY: registry,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: tmp + '/au.json', IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
        INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db', PROGRESS_SQLITE_PATH: tmp + '/progress.db',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce',
        SESSION_ALLOWED_ORIGINS: 'https://app.test', ALLOWED_ORIGINS: 'https://app.test',
    } });
    c.stdout.on('data', (d) => { boot += d; }); c.stderr.on('data', (d) => { boot += d; });
    extra.push(c);
    const b = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 160; i++) { try { if ((await fetch(b + '/api/health')).ok) return b; } catch { /* */ } await sleep(250); }
    return null;
};

try {
    if (!await up()) { console.error('El servidor no arrancó:\n' + boot.slice(-3000)); process.exit(1); }
    const groupsBefore = fs.readFileSync(P.groups, 'utf8');
    const F1 = 'compradora.f1@fixture.invalid', F2 = 'comprador.f2@fixture.invalid', N1 = 'nueva.representante@fixture.invalid';
    const adm = (await login('admin.at@fixture.invalid')).cookie;
    const activateMinor = async (orderId, contact, name, acc = REP) => {
        const p = await provision(minor(orderId, contact, { name }));
        const a = await accept(p.body.activationUrl, { ...acc });
        return { id: p.body.userId, provision: p, activation: a, loginId: userOf(p.body.userId).loginId };
    };

    section('[1] declarado frente a verificado: qué se permite antes y después');
    const k1 = await activateMinor(9001, F1, 'Lupe', { ...REP, A3: 'yes' });
    const K1 = k1.id;
    let sK1 = await login(k1.loginId);
    {
        const m = await me(sK1.cookie);
        ok('DECLARADO (representante en la app, sin verificar): la cuenta se activa y el lector lee', k1.activation.status === 200 && st('A1', K1) === 'granted_unverified' && st('A0', K1) === 'granted_unverified' && await canRead(sK1.cookie, K1, 'obra-1'));
        ok('…pero lo opcional no rige todavía: Leo (A3) y voz (A5) cerrados aunque A3 = sí', m.optionalProcessing?.leo === false && m.optionalProcessing?.voiceTranscription === false && st('A3', K1) === 'granted_unverified');
        operator(K1, [['T', 'granted'], ['A0', 'granted'], ['A1', 'granted'], ['A3', 'granted']]);
        const m2 = await both(async (b) => (await me(sK1.cookie, b)).optionalProcessing?.leo);
        ok('VERIFICADO por GVA: las mismas decisiones pasan a efectivas en las dos réplicas, sin reinicio; Leo se abre', ['T', 'A0', 'A1', 'A3'].every((k) => st(k, K1) === 'effective') && m2.every((x) => x === true), JSON.stringify(m2));
        ok('la verificación no añade decisiones que el representante no dio: A5 sigue pendiente y la voz cerrada', st('A5', K1) === 'pending' && (await me(sK1.cookie)).optionalProcessing?.voiceTranscription === false);
        TABLA['antes de verificar'] = 'cuenta y lectura: sí · Leo/voz: no · recompra: revisión manual';
        TABLA['después de verificar'] = 'cuenta y lectura: sí · Leo/voz: según A3/A5 · recompra: sí';
    }
    {
        // Recompra antes y después de verificar, con una cuenta sin suscripción vigente (la primera se reembolsa).
        const kr = await activateMinor(9010, F1, 'Rita');
        await revoke(9010, 'refunded');
        const before = await provision(minor(9011, F1, { loginId: kr.loginId }));
        operator(kr.id, [['T', 'granted'], ['A0', 'granted'], ['A1', 'granted']]);
        const after = await provision(minor(9011, F1, { loginId: kr.loginId }));
        ok('recompra para un menor: sin verificar ⇒ 422 (revisión manual, sin acceso); verificada ⇒ acceso en la MISMA cuenta', before.status === 422 && before.body.code === 'terms_acceptance_required' && after.status === 200 && after.body.userId === kr.id && after.body.accessState === 'active', JSON.stringify([before.body, after.body]));
    }

    section('[2] verificación negativa o imposible');
    const k2 = await activateMinor(9003, F1, 'Tomás', { ...REP, A3: 'yes' });
    const K2 = k2.id;
    const sK2 = await login(k2.loginId);
    {
        ok('antes del resultado: el segundo menor lee con lo declarado', await canRead(sK2.cookie, K2, 'obra-1'));
        const usersBefore = fs.readFileSync(P.users, 'utf8'), rulesBefore = fs.readFileSync(P.access, 'utf8');
        operator(K2, [['A0', 'denied'], ['A1', 'denied']]);
        const blocked = await both((b) => access(sK2.cookie, K2, 'obra-1', b));
        ok('GVA anota el resultado negativo (o que no pudo verificarse): A0 y A1 negadas ⇒ la cuenta deja de abrir contenido en las dos réplicas', blocked.every((r) => r.status === 403 && r.body.errorCode === 'AUTHORIZATION_WITHDRAWN') && st('A1', K2) === 'denied' && st('A0', K2) === 'denied', JSON.stringify(blocked));
        ok('lo opcional declarado tampoco surte efecto', (await me(sK2.cookie)).optionalProcessing?.leo === false);
        ok('no se borra nada: cuenta, suscripción y fechas idénticas (decide Dirección qué hacer con el pedido)', fs.readFileSync(P.users, 'utf8') === usersBefore && fs.readFileSync(P.access, 'utf8') === rulesBefore);
        ok('la primera menor, misma familia y mismo contacto, no cambia', await canRead(sK1.cookie, K1, 'obra-1') && st('A1', K1) === 'effective');
        await revoke(9003, 'refunded');
        const rebuy = await provision(minor(9004, F1, { loginId: k2.loginId }));
        ok('una compra nueva para esa cuenta no la reabre (422 authorization_withdrawn)', rebuy.status === 422 && rebuy.body.code === 'authorization_withdrawn' && !ruleOf(9004));
        const dis = await send('POST', `/api/users/${K2}/disable`, adm);
        ok('AT puede además desactivar la cuenta con la herramienta existente; el lector ya no entra', dis.status === 200 && (await login(k2.loginId)).status !== 200 && userOf(K2).accountStatus === 'disabled');
    }

    section('[3] A1 revocada: el bloqueo continúa');
    const k3 = await activateMinor(9101, F2, 'Ana');
    const K3 = k3.id;
    let sK3 = await login(k3.loginId);
    operator(K3, [['T', 'granted'], ['A0', 'granted'], ['A1', 'granted']]);
    const rule3 = JSON.stringify(ruleOf(9101));
    {
        operator(K3, [['A1', 'revoked']]);
        const isBlocked = async () => (await both((b) => access(sK3.cookie, K3, 'obra-1', b))).every((r) => r.status === 403 && r.body.errorCode === 'AUTHORIZATION_WITHDRAWN');
        ok('revocada por GVA: bloqueada en las dos réplicas', await isBlocked());
        const relog = await login(k3.loginId);
        ok('sigue bloqueada tras iniciar sesión de nuevo', relog.status === 200 && (await access(relog.cookie, K3, 'obra-1')).body.errorCode === 'AUTHORIZATION_WITHDRAWN');
        const resend = await provision(minor(9101, F2, { name: 'Ana' }));
        ok('…tras un reenvío del pedido por la tienda (sin enlace, sin fechas nuevas)', resend.status === 200 && resend.body.status === 'already_activated' && resend.body.activationUrl === null && await isBlocked() && JSON.stringify(ruleOf(9101)) === rule3);
        await get(`/api/access/by-user/${K3}`, sK3.cookie);
        ok('…tras la consulta de sus propios accesos (la reparación de F7-C3 no la toca)', await isBlocked() && JSON.stringify(ruleOf(9101)) === rule3);
        const put = await send('PUT', `/api/users/${K3}`, adm, { accountStatus: 'active' });
        ok('…y un cambio administrativo de estado tampoco la reabre', put.status !== 500 && await isBlocked());
        ok('una revocación parcial (A3 de la primera menor) no bloquea su lectura', (operator(K1, [['A3', 'revoked']]), (await me(sK1.cookie)).optionalProcessing?.leo === false) && await canRead(sK1.cookie, K1, 'obra-1'));
    }

    section('[4] registro de autorizaciones indisponible');
    {
        // (a) Réplicas que YA lo habían verificado: el registro se corrompe (línea inválida al final).
        const good = regRaw();
        fs.writeFileSync(REG, good + '{"esto":"no es una decisión"}\n');
        let unverifiable = false; try { R.decisionGate(); } catch { unverifiable = true; }
        const k3Blocked = await both((b) => access(sK3.cookie, K3, 'obra-1', b));
        const k1Reads = await both((b) => access(sK1.cookie, K1, 'obra-1', b));
        ok('registro corrupto: no es verificable', unverifiable);
        ok('…la cuenta con A1 revocada SIGUE bloqueada en las dos réplicas (rige la última lectura verificada): el fallo no la reabre', k3Blocked.every((r) => r.status === 403 && r.body.errorCode === 'AUTHORIZATION_WITHDRAWN'), JSON.stringify(k3Blocked));
        ok('…y quien tenía su autorización vigente sigue leyendo: el fallo tampoco deja a todos sin servicio', k1Reads.every((r) => r.status === 200 && r.body.allowed === true), JSON.stringify(k1Reads));
        const leo = await both(async (b) => (await me(sK1.cookie, b)).optionalProcessing);
        ok('los tratamientos opcionales se cierran (fallo cerrado, como antes)', leo.every((o) => o.leo === false && o.voiceTranscription === false));
        const pend = await provision(minor(9150, F2, { name: 'Pendiente' }));
        const actFail = pend.status === 200 ? await accept(pend.body.activationUrl, { ...REP }) : { status: 0, body: {} };
        ok('no se puede activar una cuenta: las decisiones no se aplazan ni se presumen (503)', actFail.status === 503 && actFail.body.code === 'ACCEPTANCE_REGISTRY_UNAVAILABLE' && userOf(pend.body.userId).accountStatus === 'invited', JSON.stringify([pend.body, actFail.body]));
        const chg = await send('POST', `/api/users/${K1}/representation`, adm, { action: 'change_contact', email: N1, requestRef: 'GVA-SINT-CAMBIO-0' });
        ok('ni cambiar un representante (503)', chg.status === 503 && chg.body.code === 'ACCEPTANCE_REGISTRY_UNAVAILABLE' && userOf(K1).representedBy.email === F1);

        // (b) Réplica que NUNCA pudo verificarlo (arranca con el registro ya corrupto).
        const cold = await spawnReplica(REG);
        const coldK1 = cold ? await access(sK1.cookie, K1, 'obra-1', cold) : { status: 0, body: {} };
        const coldK3 = cold ? await access(sK3.cookie, K3, 'obra-1', cold) : { status: 0, body: {} };
        ok('réplica que arranca sin poder verificar el registro: cierre TEMPORAL de las cuentas personales (503, no una negativa definitiva)', !!cold && coldK1.status === 503 && coldK1.body.errorCode === 'AUTHORIZATION_REGISTRY_UNAVAILABLE' && coldK3.status === 503 && coldK3.body.allowed === false, JSON.stringify([coldK1, coldK3]));
        const sA = await login('lector.a@fixture.invalid');
        ok('…las cuentas institucionales no dependen de esta comprobación: siguen con su acceso', (await access(sA.cookie, 'COLE_A', 'obra-a', cold)).body.allowed === true);

        // (c) El registro se repara: todo vuelve a su estado, sin intervención.
        fs.writeFileSync(REG, good);
        await sleep(50);
        const after = [await access(sK1.cookie, K1, 'obra-1', cold), await access(sK3.cookie, K3, 'obra-1', cold), ...(await both((b) => access(sK3.cookie, K3, 'obra-1', b)))];
        ok('reparado el registro: la réplica vuelve a decidir sola; la revocada sigue revocada y la vigente lee', after[0].body.allowed === true && after.slice(1).every((r) => r.body.errorCode === 'AUTHORIZATION_WITHDRAWN'), JSON.stringify(after));
        const act = await accept(pend.body.activationUrl, { ...REP });
        ok('…y la activación pendiente puede completarse', act.status === 200);

        // (d) Despliegue SIN registro configurado: esta comprobación no concluye nada (el resto de puertas sigue cerrado).
        const none = await spawnReplica('');
        ok('sin registro configurado: no se inventa una revocación ni un cierre (la lectura sigue las reglas de acceso)', !!none && (await access(sK1.cookie, K1, 'obra-1', none)).body.allowed === true && (await me(sK1.cookie, none)).optionalProcessing?.leo === false);
    }

    section('[5] restablecimiento autorizado');
    {
        const before = userOf(K3).representedBy.declaration.ref;
        const reinv = await send('POST', `/api/users/${K3}/reinvite`, adm);
        ok('AT reinvita la cuenta (herramienta existente): vuelve a «invitada», sin contraseña, con las sesiones cerradas', reinv.status === 200 && /token=[0-9a-f]{64}$/.test(reinv.body.activationUrl) && userOf(K3).accountStatus === 'invited' && !userOf(K3).password && (await get('/api/auth/me', sK3.cookie)).status === 401);
        ok('reinvitar no restablece nada por sí solo: A1 sigue revocada', st('A1', K3) === 'revoked');
        ok('quien usa el enlace no puede declararse «titular»', (await accept(reinv.body.activationUrl, { ...ADULT_ACTIVATION })).body?.code === 'REPRESENTATIVE_REQUIRED');
        const act = await accept(reinv.body.activationUrl, { ...REP });
        sK3 = await login(k3.loginId);
        ok('el representante autoriza de nuevo, de forma expresa ⇒ la cuenta vuelve a leer; queda declarada (GVA la verifica otra vez)', act.status === 200 && st('A1', K3) === 'granted_unverified' && await canRead(sK3.cookie, K3, 'obra-1'));
        ok('constancia nueva; la suscripción y sus fechas no cambiaron (ni se alargó ni se reinició)', userOf(K3).representedBy.declaration.ref !== before && JSON.stringify(ruleOf(9101)) === rule3 && act.body.subscription === undefined);
    }

    section('[6] cambio de representante (operador autorizado)');
    {
        const ruleBefore = JSON.stringify(ruleOf(9001)), declBefore = userOf(K1).representedBy.declaration.ref;
        const body = { action: 'change_contact', email: N1, requestRef: 'GVA-SINT-CAMBIO-1' };
        const snap = () => JSON.stringify(J(P.users).map(({ lastLoginAt, ...u }) => u)); // el inicio de sesión anota su fecha: no cuenta
        const s0 = snap();
        const denied = [
            ['el propio lector', await send('POST', `/api/users/${K1}/representation`, sK1.cookie, body)],
            ['una mediadora', await send('POST', `/api/users/${K1}/representation`, (await login('mediadora.a@fixture.invalid')).cookie, body)],
            ['sin sesión', await send('POST', `/api/users/${K1}/representation`, null, body)],
        ];
        ok('solo Administración: lector, mediadora y anónimo ⇒ 401/403', denied.every(([, r]) => [401, 403].includes(r.status)), JSON.stringify(denied.map(([l, r]) => [l, r.status])));
        const bad = [
            await send('POST', `/api/users/${K1}/representation`, adm, { ...body, action: 'otra' }),
            await send('POST', `/api/users/${K1}/representation`, adm, { ...body, requestRef: '' }),
            await send('POST', `/api/users/${K1}/representation`, adm, { ...body, email: 'no-es-correo' }),
        ];
        ok('sin acción válida, sin referencia del trámite o sin correo válido ⇒ 400', bad.every((r) => r.status === 400), JSON.stringify(bad.map((r) => r.body)));
        const early = await send('POST', `/api/users/${K1}/representation`, adm, body);
        ok('con las autorizaciones del representante anterior aún en pie ⇒ 409: nada se transfiere', early.status === 409 && early.body.code === 'AUTHORIZATIONS_NOT_WITHDRAWN' && early.body.kinds.includes('A0') && early.body.kinds.includes('A1'), JSON.stringify(early.body));
        ok('cuenta institucional o adulta ⇒ 409 NOT_REPRESENTED; inexistente ⇒ 404', (await send('POST', '/api/users/COLE_A/representation', adm, body)).body.code === 'NOT_REPRESENTED' && (await send('POST', '/api/users/NOPE/representation', adm, body)).status === 404);
        ok('ninguno de esos intentos cambió el padrón', snap() === s0);

        operator(K1, [['A0', 'revoked'], ['A1', 'revoked']]); // GVA, con la evidencia del trámite (A3 ya estaba revocada)
        ok('GVA retira las autorizaciones del representante anterior ⇒ la cuenta deja de abrir contenido', (await access(sK1.cookie, K1, 'obra-1')).body.errorCode === 'AUTHORIZATION_WITHDRAWN');
        ok('mismo contacto ⇒ 409 SAME_CONTACT', (await send('POST', `/api/users/${K1}/representation`, adm, { ...body, email: F1.toUpperCase() })).body.code === 'SAME_CONTACT');
        const chg = await send('POST', `/api/users/${K1}/representation`, adm, body);
        const u = userOf(K1);
        ok('cambio aplicado: 200 con un enlace nuevo para entregar por el canal verificado', chg.status === 200 && chg.body.accountStatus === 'invited' && /^\/#\/activar\?token=[0-9a-f]{64}$/.test(chg.body.activationUrl), JSON.stringify(chg.body));
        ok('la cuenta queda invitada, sin contraseña, con el contacto NUEVO y la referencia del trámite', u.accountStatus === 'invited' && !u.password && u.representedBy.email === N1 && u.representedBy.changedRef === 'GVA-SINT-CAMBIO-1' && u.representedBy.declaration === undefined);
        ok('del representante anterior no queda el correo: solo la referencia de lo que declaró y del trámite que lo terminó', !JSON.stringify(u).includes(F1) && u.representedBy.previous.length === 1 && u.representedBy.previous[0].declaration.ref === declBefore && u.representedBy.previous[0].endedRef === 'GVA-SINT-CAMBIO-1');
        ok('las sesiones del lector se cerraron y la contraseña anterior ya no sirve', (await get('/api/auth/me', sK1.cookie)).status === 401 && (await login(k1.loginId)).status !== 200);
        const oldResend = await provision(minor(9001, F1, { name: 'Lupe' }));
        ok('el contacto anterior ya no puede pedir enlaces por la tienda para esa cuenta (409, sin datos)', oldResend.status === 409 && !oldResend.body.activationUrl, JSON.stringify(oldResend.body));
        ok('el nuevo representante no puede activarla como «titular»', (await accept(chg.body.activationUrl, { ...ADULT_ACTIVATION })).body?.code === 'REPRESENTATIVE_REQUIRED');
        const act = await accept(chg.body.activationUrl, { ...REP });
        sK1 = await login(k1.loginId);
        const a1 = state('A1', K1);
        ok('el nuevo representante declara y autoriza A0 y A1 por sí mismo ⇒ la cuenta se activa y el lector lee', act.status === 200 && a1.status === 'granted' && a1.verification === 'unverified' && a1.medium === 'in_app' && st('A0', K1) === 'granted_unverified' && await canRead(sK1.cookie, K1, 'obra-1'));
        ok('lo que NO decidió no pasa del anterior: A3 sigue revocada y Leo cerrado', st('A3', K1) === 'revoked' && (await me(sK1.cookie)).optionalProcessing?.leo === false);
        ok('constancia nueva y distinta; mismo usuario del lector; suscripción y fechas intactas', userOf(K1).representedBy.declaration.ref !== declBefore && userOf(K1).loginId === k1.loginId && JSON.stringify(ruleOf(9001)) === ruleBefore);
        ok('el cambio de una cuenta no tocó a la otra familia', userOf(K3).representedBy.email === F2 && await canRead(sK3.cookie, K3, 'obra-1'));
    }

    section('[7] mayoría de edad: transición controlada a titular adulto');
    {
        const k4 = await activateMinor(9201, F2, 'Leo', { ...REP, A3: 'yes' });
        const K4 = k4.id, OWN = 'leo.adulto@fixture.invalid';
        operator(K4, [['T', 'granted'], ['A0', 'granted'], ['A1', 'granted'], ['A3', 'granted']]);
        const sOld = await login(k4.loginId);
        const ruleBefore = JSON.stringify(ruleOf(9201)), declBefore = userOf(K4).representedBy.declaration.ref;
        const body = { action: 'majority', email: OWN, requestRef: 'GVA-SINT-MAYORIA-1' };
        ok('con las autorizaciones del representante en pie ⇒ 409', (await send('POST', `/api/users/${K4}/representation`, adm, body)).body.code === 'AUTHORIZATIONS_NOT_WITHDRAWN');
        operator(K4, [['A0', 'revoked'], ['A1', 'revoked'], ['A3', 'revoked']]);
        ok('un correo que ya es de otra cuenta ⇒ 409 EMAIL_IN_USE', (await send('POST', `/api/users/${K4}/representation`, adm, { ...body, email: 'lector.a@fixture.invalid' })).body.code === 'EMAIL_IN_USE');
        const tr = await send('POST', `/api/users/${K4}/representation`, adm, body);
        const u = userOf(K4);
        ok('transición aplicada: la cuenta pasa a tener correo propio, deja de ser representada y queda invitada', tr.status === 200 && u.email === OWN && u.representedBy === undefined && u.loginId === undefined && u.accountStatus === 'invited' && !u.password && u.titularTransition.ref === 'GVA-SINT-MAYORIA-1', JSON.stringify(tr.body));
        ok('no conserva el contacto del antiguo representante; sí la referencia de lo que declaró', !JSON.stringify(u).includes(F2) && u.titularTransition.previous[0].declaration.ref === declBefore);
        ok('sesión anterior cerrada; el usuario lec-… ya no entra', (await get('/api/auth/me', sOld.cookie)).status === 401 && (await login(k4.loginId)).status !== 200);
        const noTerms = await accept(tr.body.activationUrl, { ...ADULT_ACTIVATION, terms: false });
        ok('los términos que aceptó su representante no se dan por suyos: sin aceptarlos él mismo ⇒ 422 (T)', noTerms.status === 422 && (noTerms.body.required || []).includes('T'), JSON.stringify(noTerms.body));
        ok('ni la autorización de cuenta y lectura: sin A1 propia ⇒ 422', (await accept(tr.body.activationUrl, { ...ADULT_ACTIVATION, A1: undefined })).body?.required?.includes('A1'));
        const act = await accept(tr.body.activationUrl, { ...ADULT_ACTIVATION });
        const sOwn = await login(OWN);
        const t = state('T', K4), a1 = state('A1', K4);
        ok('el ya adulto acepta los términos y autoriza A1 por sí mismo ⇒ activa; decisiones de «titular», efectivas', act.status === 200 && t.capacity === 'titular' && t.verification === 'self_authenticated' && t.medium === 'in_app' && a1.capacity === 'titular' && st('A1', K4) === 'effective', JSON.stringify([t, a1]));
        ok('entra con su correo y lee; MISMA cuenta (identificador, suscripción y fechas intactos)', sOwn.status === 200 && await canRead(sOwn.cookie, K4, 'obra-1') && JSON.stringify(ruleOf(9201)) === ruleBefore && act.body.user.id === K4);
        ok('lo opcional que autorizó su representante no pasa a él: A3 sigue revocada hasta que él decida', st('A3', K4) === 'revoked' && (await me(sOwn.cookie)).optionalProcessing?.leo === false && st('A0', K4) === 'revoked');
        ok('ya no es una cuenta representada: la operación no se le puede volver a aplicar', (await send('POST', `/api/users/${K4}/representation`, adm, { ...body, email: 'otro@fixture.invalid' })).body.code === 'NOT_REPRESENTED');
        const audit = fs.existsSync(tmp + '/au.json') ? fs.readFileSync(tmp + '/au.json', 'utf8') : '';
        ok('las dos operaciones constan en la auditoría de usuarios, con la referencia del trámite y sin correos', /representation_change_contact/.test(audit) && /representation_majority/.test(audit) && audit.includes('GVA-SINT-MAYORIA-1') && !audit.includes(OWN) && !audit.includes(N1));
    }

    section('[8] compra y activación diferidas: fechas efectivas');
    {
        const paid = Date.now() - 30 * DAY;
        const p = await provision(order(9301, 'diferida@fixture.invalid', { activationAt: paid }));
        const dry0 = await provision(order(9301, 'diferida@fixture.invalid', { activationAt: paid, dryRun: true }));
        const u0 = fs.readFileSync(P.users, 'utf8');
        ok('pagado hace 30 días y sin activar: la consulta de la tienda (dryRun) dice «pendiente», sin fechas, y no invalida el enlace', dry0.status === 200 && dry0.body.accessState === 'pending_activation' && dry0.body.expiresAt === null && dry0.body.activationAt === null && fs.readFileSync(P.users, 'utf8') === u0 && ruleOf(9301).b2c.pendingActivation === true, JSON.stringify(dry0.body));
        const t0 = Date.now();
        const act = await accept(p.body.activationUrl, { ...ADULT_ACTIVATION });
        const r = ruleOf(9301);
        ok('al activar, la respuesta trae las fechas de inicio y terminación (002 §3.4): las de la regla', act.status === 200 && act.body.subscription?.startsAt === r.b2c.activationAt && act.body.subscription?.expiresAt === r.expiresAt && r.b2c.activationAt >= t0 && r.expiresAt === computeExpiresAt(r.b2c.activationAt), JSON.stringify(act.body.subscription));
        const dry1 = await provision(order(9301, 'diferida@fixture.invalid', { activationAt: paid, dryRun: true }));
        ok('la consulta de la tienda recibe ahora esas MISMAS fechas (doce meses completos; los 30 días de espera no se descontaron)', dry1.body.accessState === 'active' && dry1.body.activationAt === r.b2c.activationAt && dry1.body.expiresAt === r.expiresAt && days(r.expiresAt) >= 365 && JSON.stringify(ruleOf(9301)) === JSON.stringify(r), JSON.stringify(dry1.body));

        // Fallo intermedio: la cuenta quedó activa pero el inicio no llegó a escribirse.
        const q = await provision(order(9302, 'intermedio@fixture.invalid'));
        const users = J(P.users), x = users.find((y) => y.id === q.body.userId);
        x.accountStatus = 'active'; x.password = hash; delete x.inviteToken; delete x.inviteExpiresAt;
        fs.writeFileSync(P.users + '.tmp', JSON.stringify(users)); fs.renameSync(P.users + '.tmp', P.users);
        R.appendDecisions([{ subjectId: x.id, kind: 'T', status: 'granted', actDay: R.dayOf(Date.now()), version: DOCS.terms.version, medium: 'in_app', capacity: 'titular', verification: 'self_authenticated', requestRef: 'ACT-SINT-INTERMEDIO' },
            { subjectId: x.id, kind: 'A1', status: 'granted', actDay: R.dayOf(Date.now()), version: DOCS.dataNotice.version, medium: 'in_app', capacity: 'titular', verification: 'self_authenticated', requestRef: 'ACT-SINT-INTERMEDIO' }]);
        await sleep(1200);
        const dry = await provision(order(9302, 'intermedio@fixture.invalid', { dryRun: true }));
        ok('una consulta nunca informa un inicio que no quedó escrito: sigue «pendiente» y no escribe', dry.body.accessState === 'pending_activation' && dry.body.expiresAt === null && ruleOf(9302).b2c.pendingActivation === true, JSON.stringify(dry.body));
        const sX = await login('intermedio@fixture.invalid');
        await get(`/api/access/by-user/${x.id}`, sX.cookie);
        const dry2 = await provision(order(9302, 'intermedio@fixture.invalid', { dryRun: true }));
        ok('cuando el inicio se escribe de verdad, la consulta devuelve esas fechas', ruleOf(9302).b2c.activationAt > 0 && dry2.body.accessState === 'active' && dry2.body.expiresAt === ruleOf(9302).expiresAt);
    }

    section('[9] aislamiento B2C / institucional');
    {
        const sA = await login('lector.a@fixture.invalid'), sB = await login('lector.b@fixture.invalid');
        ok('nada de lo anterior tocó grupos ni dio contenidos institucionales a cuentas familiares', fs.readFileSync(P.groups, 'utf8') === groupsBefore && !(await canRead(sK1.cookie, K1, 'obra-a')) && !(await canRead(sK3.cookie, K3, 'obra-b')));
        ok('los lectores institucionales conservan lo suyo y no reciben el catálogo comprado', await canRead(sA.cookie, 'COLE_A', 'obra-a') && await canRead(sB.cookie, 'COLE_B', 'obra-b') && !(await canRead(sA.cookie, 'COLE_A', 'obra-1')) && !(await canRead(sB.cookie, 'COLE_B', 'obra-a')));
        ok('las decisiones institucionales (A2, C005) no cambiaron', st('A2', 'COLE_A') === 'pending' && st('C005', 'MED_A') === 'pending' && st('A2', K1) === 'pending');
        ok('el registro sigue sin identificadores en claro', ![K1, K3, F1, F2, N1, k1.loginId].some((x) => regRaw().includes(x)));
        await sleep(300);
        const leaks = boot.split('\n').filter((l) => /fixture\.invalid|token=[0-9a-f]{20}/.test(l) && !/\*\*\*@/.test(l) || l.includes(SECRET));
        ok('los registros del servidor no contienen correos, enlaces de activación ni el secreto', leaks.length === 0, leaks.slice(0, 2).join(' | '));
        TABLA['decisiones en el registro'] = regLines().length;
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    for (const c of [...children, ...extra]) { try { c.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    try { fs.rmSync(B2C_PROVISIONING_SECRET_PATH, { force: true }); fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\nb2cRepresentationOps.integration — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
