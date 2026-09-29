/**
 * b2cProvisioning.integration.test.mjs — CHP-B2C-PROVISIONING-01 (WEB-REORG P2-C).
 *
 * Servidor REAL (server/server.js) sobre un almacén temporal de fixtures. Demuestra, por HTTP:
 *   autenticación HMAC · provisión · idempotencia · activación y acceso reales (login + preflight) ·
 *   caducidad aplicada por el autorizador sin cron · conflicto · revocación solo de la regla del
 *   pedido · cuenta de colegio reutilizada sin tocar su acceso · dry-run sin escrituras ·
 *   el comprador NO entra en el grupo B2C · los logs no contienen correos, tokens ni el secreto.
 *
 * El secreto file-only vive en una ruta constante (/app/secrets/b2c_provisioning_secret). Por eso la
 * prueba SOLO corre en un contenedor desechable y con opt-in explícito:
 *   CHP_B2C_TEST_SECRET_SANDBOX=1 y el archivo NO debe existir de antemano (nunca pisa un secreto real).
 * POSIX-only. Nunca toca datos productivos.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { signB2cRequest, computeExpiresAt, B2C_TS_HEADER, B2C_SIG_HEADER } from '../b2c/b2cProvisioning.mjs';
import { B2C_PROVISIONING_SECRET_PATH } from '../lib/b2cProvisioningSecret.js';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
if (process.platform === 'win32') { console.log('b2cProvisioning.integration: SKIP (POSIX-only)'); process.exit(0); }
if (process.env.CHP_B2C_TEST_SECRET_SANDBOX !== '1') { console.log('b2cProvisioning.integration: SKIP (requiere CHP_B2C_TEST_SECRET_SANDBOX=1 en un contenedor desechable)'); process.exit(0); }
if (fs.existsSync(B2C_PROVISIONING_SECRET_PATH)) { console.error('ABORT: ya existe un secreto B2C en la ruta canónica; esta prueba nunca lo pisa.'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_b2c_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json',
    identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key' };
fs.mkdirSync(P.uploads, { recursive: true });

const SECRET = crypto.randomBytes(48).toString('hex');
fs.mkdirSync(path.dirname(B2C_PROVISIONING_SECRET_PATH), { recursive: true });
fs.writeFileSync(B2C_PROVISIONING_SECRET_PATH, SECRET, { mode: 0o400 }); fs.chmodSync(B2C_PROVISIONING_SECRET_PATH, 0o400);

const PW = 'contrasena-fixture';
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'COLE', email: 'lector.colegio@fixture.invalid', nombre_completo: 'Lector Colegio', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active', groupIds: ['g-colegio'] },
    { id: 'ADMIN', email: 'admin@fixture.invalid', nombre_completo: 'Admin', password: bcrypt.hashSync(PW, 4), roles: ['administrador'], accountStatus: 'active', groupIds: [] },
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'group-b2c-lectores', name: 'Chibalete+ — Lectores', type: 'course', memberIds: [], studentIds: [], mediatorIds: [] },
    { id: 'g-colegio', name: 'Colegio', type: 'course', memberIds: ['COLE'], studentIds: ['COLE'], mediatorIds: [] },
]));
fs.writeFileSync(P.schools, '[]');
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'access-b2c-lectores', scope: 'group', scopeId: 'group-b2c-lectores', titleIds: ['obra-1', 'obra-2'], collectionIds: [], expiresAt: null },
    { id: 'rule-colegio', scope: 'group', scopeId: 'g-colegio', titleIds: ['obra-colegio'], collectionIds: [], expiresAt: null },
]));
fs.writeFileSync(P.content, JSON.stringify([
    { id: 'obra-1', titulo: 'Obra 1', tipo: 'libro' }, { id: 'obra-2', titulo: 'Obra 2', tipo: 'libro' },
    { id: 'obra-colegio', titulo: 'Obra colegio', tipo: 'libro' }, { id: 'obra-fuera', titulo: 'Fuera', tipo: 'libro' },
]));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const PORT = 4700 + (process.pid % 80); const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
    ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_DATA_DIR: tmp + '/data',
    USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
    CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
    USER_AUDIT_DB: tmp + '/au.json', IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db',
    SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
    ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce',
} });
let boot = ''; child.stdout.on('data', d => boot += d); child.stderr.on('data', d => boot += d);

const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tsNow = () => String(Math.floor(Date.now() / 1000));
const signed = async (ruta, cuerpo, { secret = SECRET, ts = tsNow(), tamper = false } = {}) => {
    const raw = JSON.stringify(cuerpo);
    const r = await fetch(base + ruta, { method: 'POST', headers: { 'content-type': 'application/json',
        [B2C_TS_HEADER]: ts, [B2C_SIG_HEADER]: signB2cRequest(secret, ts, raw) }, body: tamper ? raw.replace('}', ',"x":1}') : raw });
    let body = null; try { body = await r.json(); } catch { /* */ }
    return { status: r.status, body };
};
const order = (orderId, email, extra = {}) => ({ orderId, productId: 345, plan: 'digital', source: 'test', email, fullName: 'Comprador Fixture',
    activationAt: Date.now(), idempotencyKey: `test:order:${orderId}`, ...extra });
const cookieOf = (res) => { const m = (res.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
const login = async (email) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) }); return { status: r.status, cookie: cookieOf(r) }; };
const activate = async (activationUrl) => { const token = activationUrl.split('token=')[1];
    const r = await fetch(base + '/api/accept-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: PW }) }); return r.status; };
const canRead = async (cookie, userId, contentId) => { const r = await fetch(`${base}/api/content/${contentId}/access?userId=${userId}`, { headers: { cookie } });
    let b = null; try { b = await r.json(); } catch { /* */ } return r.status === 200 && b?.allowed === true; };
const arrancado = async () => { for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health')).ok) return true; } catch { /* */ } await sleep(250); } return false; };

try {
    if (!await arrancado()) { console.error('El servidor no arrancó:\n' + boot.slice(-3000)); process.exit(1); }
    const groupsBefore = fs.readFileSync(P.groups, 'utf8');

    console.log('[1] autenticación');
    const A = order(1001, 'Comprador.Uno@fixture.invalid');
    ok('sin cabeceras → 401', (await fetch(base + '/api/b2c/provision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(A) })).status === 401);
    ok('secreto distinto → 401', (await signed('/api/b2c/provision', A, { secret: 'x'.repeat(64) })).status === 401);
    ok('marca de tiempo vieja (10 min) → 401', (await signed('/api/b2c/provision', A, { ts: String(Math.floor(Date.now() / 1000) - 600) })).status === 401);
    ok('cuerpo alterado tras firmar → 401', (await signed('/api/b2c/provision', A, { tamper: true })).status === 401);
    ok('ninguna regla escrita por peticiones rechazadas', J(P.access).length === 2);

    console.log('[2] provisión Digital (usuario nuevo)');
    const r1 = await signed('/api/b2c/provision', A);
    ok('200 activated', r1.status === 200 && r1.body.status === 'activated', JSON.stringify(r1.body));
    ok('expiresAt = activación + 12 meses (fin del día en Bogotá)', r1.body.expiresAt === computeExpiresAt(A.activationAt));
    ok('devuelve enlace de activación', /^\/#\/activar\?token=[0-9a-f]{64}$/.test(r1.body.activationUrl || ''));
    const u1 = J(P.users).find(u => u.id === r1.body.userId);
    ok('usuario creado invitado, lector, correo normalizado, marcado b2c', u1 && u1.accountStatus === 'invited' && u1.roles.includes('lector') && u1.email === 'comprador.uno@fixture.invalid' && u1.b2c === true);
    ok('el usuario NO tiene grupos', Array.isArray(u1.groupIds) && u1.groupIds.length === 0);
    ok('groups_db intacto: el comprador no entra en group-b2c-lectores', fs.readFileSync(P.groups, 'utf8') === groupsBefore);
    const rule1 = J(P.access).find(r => r.id === 'access-b2c-test-order-1001');
    ok('regla personal: ámbito usuario, titleIds de la plantilla, con caducidad', rule1 && rule1.scope === 'user' && rule1.scopeId === u1.id &&
        JSON.stringify(rule1.titleIds) === '["obra-1","obra-2"]' && rule1.expiresAt === r1.body.expiresAt);

    console.log('[3] idempotencia (reintento del mismo pedido)');
    const r1b = await signed('/api/b2c/provision', { ...A, activationAt: Date.now() });
    ok('already_activated, mismo usuario y misma regla', r1b.status === 200 && r1b.body.status === 'already_activated' && r1b.body.userId === r1.body.userId && r1b.body.ruleId === r1.body.ruleId);
    ok('sin duplicados: 3 reglas, 3 usuarios', J(P.access).length === 3 && J(P.users).length === 3);
    ok('expiresAt NO se recalcula', J(P.access).find(r => r.id === 'access-b2c-test-order-1001').expiresAt === r1.body.expiresAt);
    ok('enlace nuevo (respuesta perdida recuperable) y el anterior deja de valer', r1b.body.activationUrl && r1b.body.activationUrl !== r1.body.activationUrl);
    ok('el enlace anterior ya no activa', (await activate(r1.body.activationUrl)) === 404);

    console.log('[4] activación y acceso reales');
    ok('accept-invite con el enlace vigente → 200', (await activate(r1b.body.activationUrl)) === 200);
    const L1 = await login('comprador.uno@fixture.invalid');
    ok('login del comprador → 200', L1.status === 200 && !!L1.cookie);
    ok('puede abrir una obra de la lista B2C', await canRead(L1.cookie, u1.id, 'obra-1'));
    ok('no puede abrir una obra fuera de la lista B2C', !(await canRead(L1.cookie, u1.id, 'obra-fuera')));

    console.log('[5] caducidad con fecha controlada (sin cron)');
    const E = order(1002, 'vencido@fixture.invalid', { activationAt: Date.now() - 400 * 864e5 });
    const r2 = await signed('/api/b2c/provision', E);
    ok('provisión de un pedido activado hace 400 días → expiresAt en el pasado', r2.status === 200 && r2.body.expiresAt < Date.now(), JSON.stringify(r2.body));
    ok('activación de la cuenta', (await activate(r2.body.activationUrl)) === 200);
    const L2 = await login('vencido@fixture.invalid');
    ok('el comprador vencido puede iniciar sesión…', L2.status === 200);
    ok('…pero la regla vencida NO concede acceso (lo aplica el autorizador en cada petición)', !(await canRead(L2.cookie, r2.body.userId, 'obra-1')));

    console.log('[6] conflicto: segundo pedido con suscripción vigente');
    const r3 = await signed('/api/b2c/provision', order(1003, 'comprador.uno@fixture.invalid'));
    ok('409 conflict_active_subscription', r3.status === 409 && r3.body.code === 'conflict_active_subscription');
    ok('no se crea regla para 1003', !J(P.access).some(r => r.id === 'access-b2c-test-order-1003'));

    console.log('[7] cuenta de colegio existente que compra');
    const r4 = await signed('/api/b2c/provision', order(1004, 'lector.colegio@fixture.invalid'));
    ok('activated reutilizando la cuenta, sin enlace', r4.status === 200 && r4.body.userId === 'COLE' && r4.body.reusedAccount === true && r4.body.activationUrl === null);
    ok('la cuenta de colegio conserva sus grupos', JSON.stringify(J(P.users).find(u => u.id === 'COLE').groupIds) === '["g-colegio"]');
    const L4 = await login('lector.colegio@fixture.invalid');
    ok('ahora lee B2C y colegio', await canRead(L4.cookie, 'COLE', 'obra-1') && await canRead(L4.cookie, 'COLE', 'obra-colegio'));

    console.log('[8] reembolso → revocación solo de la regla del pedido');
    const rulesBefore = J(P.access);
    const v1 = await signed('/api/b2c/revoke', { orderId: 1004, source: 'test', idempotencyKey: 'test:order:1004', reason: 'refunded' });
    ok('revoked', v1.status === 200 && v1.body.status === 'revoked' && v1.body.expiresAt <= Date.now());
    const rulesAfter = J(P.access);
    ok('solo cambió la regla 1004; ninguna regla borrada', rulesAfter.length === rulesBefore.length &&
        rulesAfter.filter(r => JSON.stringify(r) !== JSON.stringify(rulesBefore.find(b => b.id === r.id))).map(r => r.id).join() === 'access-b2c-test-order-1004');
    ok('el usuario no se borra', J(P.users).some(u => u.id === 'COLE'));
    ok('sin B2C, el lector de colegio sigue leyendo su obra del colegio', !(await canRead(L4.cookie, 'COLE', 'obra-1')) && await canRead(L4.cookie, 'COLE', 'obra-colegio'));
    ok('el otro comprador (1001) no se ve afectado', await canRead(L1.cookie, u1.id, 'obra-1'));
    const exp1004 = J(P.access).find(r => r.id === 'access-b2c-test-order-1004').expiresAt;
    const v2 = await signed('/api/b2c/revoke', { orderId: 1004, source: 'test', idempotencyKey: 'test:order:1004', reason: 'refunded' });
    ok('revoke idempotente: already_revoked sin cambios', v2.status === 200 && v2.body.status === 'already_revoked' && J(P.access).find(r => r.id === 'access-b2c-test-order-1004').expiresAt === exp1004);
    ok('revoke de un pedido inexistente → 404', (await signed('/api/b2c/revoke', { orderId: 9999, source: 'test', idempotencyKey: 'test:order:9999' })).status === 404);

    console.log('[9] dry-run');
    const snapU = fs.readFileSync(P.users, 'utf8'), snapA = fs.readFileSync(P.access, 'utf8');
    const d1 = await signed('/api/b2c/provision', order(1005, 'nuevo@fixture.invalid', { dryRun: true }));
    ok('dry_run_activated con expiresAt calculado', d1.status === 200 && d1.body.status === 'dry_run_activated' && d1.body.expiresAt > Date.now());
    ok('dry-run no escribe usuarios ni reglas', fs.readFileSync(P.users, 'utf8') === snapU && fs.readFileSync(P.access, 'utf8') === snapA);

    console.log('[10] entrada inválida y registros');
    ok('plan inválido → 400 invalid_plan', (await signed('/api/b2c/provision', order(1006, 'x@fixture.invalid', { plan: 'mensual' }))).body?.code === 'invalid_plan');
    ok('clave de idempotencia ajena → 400', (await signed('/api/b2c/provision', order(1007, 'x@fixture.invalid', { idempotencyKey: 'test:order:1' }))).status === 400);
    await sleep(300);
    const leaks = boot.split(/\r?\n/).filter(l => /comprador\.uno@|vencido@|nuevo@/i.test(l));
    console.log('    líneas con correo (rutas preexistentes):', JSON.stringify(leaks.map(l => l.replace(/\S+@fixture\.invalid/gi, '<correo>').slice(0, 120))));
    ok('las líneas [B2C] no contienen correos', !leaks.some(l => l.includes('[B2C]')));
    ok('los registros no contienen el secreto ni tokens de invitación', !boot.includes(SECRET) && !/[0-9a-f]{64}/.test(boot));

    console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
} finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    try { fs.rmSync(B2C_PROVISIONING_SECRET_PATH, { force: true }); } catch { /* */ }
}
process.exit(fail === 0 ? 0 : 1);
