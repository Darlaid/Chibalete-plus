/**
 * b2cProvisioning.integration.test.mjs — CHP-B2C-PROVISIONING-01 (WEB-REORG P2-C).
 *
 * Servidor REAL (server/server.js) sobre un almacén temporal de fixtures. Demuestra, por HTTP:
 *   autenticación HMAC · provisión · idempotencia · activación y acceso reales (login + preflight) ·
 *   caducidad aplicada por el autorizador sin cron · conflicto · revocación solo de la regla del
 *   pedido · cuenta de colegio reutilizada sin tocar su acceso · dry-run sin escrituras ·
 *   el comprador NO entra en el grupo B2C · los logs no contienen correos, tokens ni el secreto.
 * V8.1-PROD-05B: documentos no aprobados (G1), aceptación no acreditable (G2) y cuenta activa sin T
 *   (G3) ⇒ rechazo sin ninguna escritura; dos réplicas sobre el mismo almacén.
 *
 * El secreto file-only vive en una ruta constante (/app/secrets/b2c_provisioning_secret). Por eso la
 * prueba SOLO corre en un contenedor desechable y con opt-in explícito:
 *   CHP_B2C_TEST_SECRET_SANDBOX=1 y el archivo NO debe existir de antemano (nunca pisa un secreto real).
 * POSIX-only. Nunca toca datos productivos.
 */
import './helpers/testMode.mjs';
// V8.1-CLOSE-05: la activación exige decisiones y un registro verificable.
import { a2RegistryPath, approveTestDocuments, ADULT_ACTIVATION, grantOptional } from './helpers/testA2.mjs';
a2RegistryPath(); approveTestDocuments();
// V8.1-PROD-02B: los lectores de colegio de la siembra tienen A3 (Leo) concedida y verificada.
grantOptional('A3', ['COLE', 'MIXTO']);
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { signB2cRequest, computeExpiresAt, B2C_TS_HEADER, B2C_SIG_HEADER } from '../b2c/b2cProvisioning.mjs';
import { B2C_PROVISIONING_SECRET_PATH } from '../lib/b2cProvisioningSecret.js';
import bcrypt from 'bcryptjs';
import * as R from '../privacy/a2Registry.mjs';
import { ACCEPTANCE_DOCUMENTS } from '../../utils/acceptanceDocuments.mjs';
import { freePorts } from './helpers/freePort.mjs';

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
    { id: 'MIXTO', email: 'mixto@fixture.invalid', nombre_completo: 'Mixto', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active', groupIds: ['g-colegio'], b2c: true },
    { id: 'ADMIN', email: 'admin@fixture.invalid', nombre_completo: 'Admin', password: bcrypt.hashSync(PW, 4), roles: ['administrador'], accountStatus: 'active', groupIds: [] },
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'group-b2c-lectores', name: 'Chibalete+ — Lectores', type: 'course', memberIds: [], studentIds: [], mediatorIds: [] },
    { id: 'g-colegio', name: 'Colegio', type: 'course', memberIds: ['COLE', 'MIXTO'], studentIds: ['COLE', 'MIXTO'], mediatorIds: [] },
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

const [PORT, ...MORE_PORTS] = await freePorts(5); const base = `http://127.0.0.1:${PORT}`;
// V8.1-PROD-05B: varias instancias sobre el MISMO almacén (como api_1/api_2); solo cambia la configuración documental.
const children = [];
const startServer = (port, envOver = {}) => { const c = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
    ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: tmp + '/data',
    USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
    CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
    USER_AUDIT_DB: tmp + '/au.json', IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db',
    SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
    ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce',
    SESSION_ALLOWED_ORIGINS: 'https://app.test', ALLOWED_ORIGINS: 'https://app.test', ...envOver,
} }); children.push(c); return c; };
const child = startServer(PORT);
let boot = ''; child.stdout.on('data', d => boot += d); child.stderr.on('data', d => boot += d);

const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tsNow = () => String(Math.floor(Date.now() / 1000));
const signed = async (ruta, cuerpo, { secret = SECRET, ts = tsNow(), tamper = false, at = base } = {}) => {
    const raw = JSON.stringify(cuerpo);
    const r = await fetch(at + ruta, { method: 'POST', headers: { 'content-type': 'application/json',
        [B2C_TS_HEADER]: ts, [B2C_SIG_HEADER]: signB2cRequest(secret, ts, raw) }, body: tamper ? raw.replace('}', ',"x":1}') : raw });
    let body = null; try { body = await r.json(); } catch { /* */ }
    return { status: r.status, body };
};
const order = (orderId, email, extra = {}) => ({ orderId, productId: 345, plan: 'digital', source: 'test', email, fullName: 'Comprador Fixture',
    activationAt: Date.now(), idempotencyKey: `test:order:${orderId}`, ...extra });
const cookieOf = (res) => { const m = (res.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
const login = async (email) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) }); return { status: r.status, cookie: cookieOf(r) }; };
const activate = async (activationUrl) => { const token = activationUrl.split('token=')[1];
    const r = await fetch(base + '/api/accept-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: PW, acceptance: { ...ADULT_ACTIVATION, A3: 'yes' } }) /* V8.1-PROD-02B: el comprador adulto autoriza Leo (A3) */ }); return r.status; };
const canRead = async (cookie, userId, contentId) => { const r = await fetch(`${base}/api/content/${contentId}/access?userId=${userId}`, { headers: { cookie } });
    let b = null; try { b = await r.json(); } catch { /* */ } return r.status === 200 && b?.allowed === true; };
const arrancado = async (at = base) => { for (let i = 0; i < 120; i++) { try { if ((await fetch(at + '/api/health')).ok) return true; } catch { /* */ } await sleep(250); } return false; };
// V8.1-PROD-05B: huella de todo lo que una provisión puede escribir (cuentas, reglas, decisiones).
const stores = () => [P.users, P.access, process.env.CHP_A2_REGISTRY].map((f) => fs.readFileSync(f, 'utf8')).join('\u0000');
const T_NOW = () => ({ version: ACCEPTANCE_DOCUMENTS.terms.version, acceptedAt: Date.now() - 5000 });

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
    ok('sin duplicados: 3 reglas, 4 usuarios (fixtures COLE, MIXTO, ADMIN + 1 nuevo)', J(P.access).length === 3 && J(P.users).length === 4);
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
    {   // V8.1-PROD-05B (G3): activa, sin T del checkout ni T previa ⇒ 422 y nada escrito.
        const snap = stores();
        const g3 = await signed('/api/b2c/provision', order(1004, 'lector.colegio@fixture.invalid'));
        ok('G3: cuenta activa sin T ⇒ 422 terms_acceptance_required', g3.status === 422 && g3.body?.code === 'terms_acceptance_required', JSON.stringify(g3));
        ok('G3: …ni cuenta, ni regla, ni decisión escritas', stores() === snap);
        const g3d = await signed('/api/b2c/provision', order(1004, 'lector.colegio@fixture.invalid', { dryRun: true }));
        ok('G3: el dry-run anticipa el mismo 422', g3d.status === 422 && g3d.body?.code === 'terms_acceptance_required');
    }
    const r4 = await signed('/api/b2c/provision', order(1004, 'lector.colegio@fixture.invalid', { termsAcceptance: T_NOW() }));
    ok('activated reutilizando la cuenta, sin enlace, con su T', r4.status === 200 && r4.body.userId === 'COLE' && r4.body.reusedAccount === true && r4.body.activationUrl === null && r4.body.termsRecorded === true, JSON.stringify(r4.body));
    ok('G3: reintento del pedido ya aprovisionado sin T ⇒ already_activated (idempotente)', (await signed('/api/b2c/provision', order(1004, 'lector.colegio@fixture.invalid'))).body?.status === 'already_activated');
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

    console.log('[E] P2-ENTITLEMENT-EXPIRY-01 — Leo, Experiencias y TTS');
    const call = async (method, path, cookie, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' }, body: body ? JSON.stringify(body) : undefined });
        let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b }; };
    const expiredCode = (r) => r.status === 403 && r.body?.code === 'ENTITLEMENT_EXPIRED';
    const premium = async (cookie, uid) => ({
        ask: await call('POST', '/api/leo/ask', cookie, { question: 'hola', contentId: 'obra-1', userId: uid }),
        chat: await call('POST', '/api/leo/chat', cookie, { message: 'hola', contentId: 'obra-1', userId: uid }),
        recap: await call('POST', '/api/leo/recap', cookie, { contentId: 'obra-1', userId: uid }),
        mem: await call('GET', `/api/leo/memory/${uid}/obra-1`, cookie),
        list: await call('GET', '/api/experiences', cookie),
        detail: await call('GET', '/api/experiences/exp-inexistente', cookie),
        run: await call('POST', '/api/experiences/exp-inexistente/run', cookie, {}),
        route: await call('GET', '/api/experiences/exp-inexistente/route', cookie),
        tts: await call('POST', '/api/tts', cookie, { text: 'hola' }),
    });
    // A. B2C vigente (1001 sigue vigente en este punto) → nada devuelve ENTITLEMENT_EXPIRED
    const pA = await premium(L1.cookie, u1.id);
    ok('A. B2C vigente: Leo, Experiencias y TTS llegan a su lógica (ningún 403)', Object.values(pA).every(r => r.status !== 403), JSON.stringify(Object.fromEntries(Object.entries(pA).map(([k, v]) => [k, v.status]))));
    // B. B2C vencido sin otras reglas → login sí, premium no
    const L2b = await login('vencido@fixture.invalid');
    ok('B. B2C vencido: el login sigue funcionando', L2b.status === 200);
    const pB = await premium(L2b.cookie, r2.body.userId);
    ok('B. Leo (ask, chat, recap, memoria) → 403 ENTITLEMENT_EXPIRED', expiredCode(pB.ask) && expiredCode(pB.chat) && expiredCode(pB.recap) && expiredCode(pB.mem));
    ok('B. Experiencias: listado vacío; detalle, inicio y recorrido → 403', pB.list.status === 200 && Array.isArray(pB.list.body) && pB.list.body.length === 0 && expiredCode(pB.detail) && expiredCode(pB.run) && expiredCode(pB.route));
    ok('B. TTS → 403', expiredCode(pB.tts));
    ok('B. libros: tampoco abre la obra B2C', !(await canRead(L2b.cookie, r2.body.userId, 'obra-1')));
    // C. B2C vencido + colegio vigente → conserva solo lo del colegio
    const actM = Date.now() - 400 * 864e5; // V8.1-PROD-05B (G3): cuenta activa ⇒ con la T del checkout de ese pedido
    const rM = await signed('/api/b2c/provision', order(1010, 'mixto@fixture.invalid', { activationAt: actM, termsAcceptance: { version: ACCEPTANCE_DOCUMENTS.terms.version, acceptedAt: actM } }));
    ok('C. identidad B2C mixta con suscripción vencida', rM.status === 200 && rM.body.userId === 'MIXTO' && rM.body.expiresAt < Date.now());
    const LM = await login('mixto@fixture.invalid');
    ok('C. abre la obra del colegio y NO la obra B2C', await canRead(LM.cookie, 'MIXTO', 'obra-colegio') && !(await canRead(LM.cookie, 'MIXTO', 'obra-1')));
    const pC = await premium(LM.cookie, 'MIXTO');
    ok('C. la regla de colegio vigente mantiene Leo y Experiencias (doctrina escolar, ningún 403)', Object.values(pC).every(r => r.status !== 403), JSON.stringify(Object.fromEntries(Object.entries(pC).map(([k, v]) => [k, v.status]))));
    // D. identidad de colegio (no B2C) con su B2C reembolsado → nada cambia para ella
    const pD = await premium(L4.cookie, 'COLE');
    ok('D. colegio con B2C reembolsado: Leo/Experiencias sin bloqueo (ningún 403) y su obra de colegio intacta', Object.values(pD).every(r => r.status !== 403) && await canRead(L4.cookie, 'COLE', 'obra-colegio'));
    ok('D. las reglas de colegio siguen intactas en el almacén', JSON.stringify(J(P.access).find(r => r.id === 'rule-colegio').titleIds) === '["obra-colegio"]');

    console.log('[9b] V8.1-CLOSE-06B: aceptación del checkout (integración autenticada)');
    {
        const T_ACC = { version: ACCEPTANCE_DOCUMENTS.terms.version, acceptedAt: Date.now() - 5000 };
        const c1 = await signed('/api/b2c/provision', order(1101, 'checkout.uno@fixture.invalid', { termsAcceptance: T_ACC }));
        ok('compra nueva con aceptación ⇒ 200 y termsRecorded', c1.status === 200 && c1.body.termsRecorded === true, JSON.stringify(c1.body));
        const g = () => R.decisionGate();
        ok('T del comprador, medio checkout y referencia del pedido', g().effective('T', c1.body.userId) && g().state('T', c1.body.userId)?.medium === 'checkout');
        ok('la compra no concede A1 ni A2', g().status('A1', c1.body.userId) === 'pending' && g().status('A2', c1.body.userId) === 'pending');
        const token = c1.body.activationUrl.split('token=')[1];
        const noTerms = { ...ADULT_ACTIVATION, terms: undefined, termsVersion: undefined };
        const act = await fetch(base + '/api/accept-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: PW, acceptance: noTerms }) });
        ok('activación sin repetir T, con A1 del titular ⇒ 200', act.status === 200 && g().effective('A1', c1.body.userId));
        const reuse = await signed('/api/b2c/provision', order(1102, 'lector.colegio@fixture.invalid', { termsAcceptance: T_ACC }));
        ok('cuenta reutilizada (ya activa): la compra deja su T', reuse.status === 200 && reuse.body.reusedAccount === true && reuse.body.termsRecorded === true, JSON.stringify(reuse.body));
        const regBefore = fs.readFileSync(process.env.CHP_A2_REGISTRY, 'utf8');
        const bad = await signed('/api/b2c/provision', order(1103, 'checkout.dos@fixture.invalid', { termsAcceptance: { version: '002@0.9', acceptedAt: Date.now() } }));
        ok('versión distinta ⇒ 400 invalid_terms_acceptance, sin escribir', bad.status === 400 && bad.body?.code === 'invalid_terms_acceptance' && fs.readFileSync(process.env.CHP_A2_REGISTRY, 'utf8') === regBefore);
        const dry = await signed('/api/b2c/provision', order(1104, 'checkout.tres@fixture.invalid', { termsAcceptance: T_ACC, dryRun: true }));
        ok('dry-run ⇒ termsRecorded false y sin escribir', dry.status === 200 && dry.body.termsRecorded === false && fs.readFileSync(process.env.CHP_A2_REGISTRY, 'utf8') === regBefore);
        const forged = await signed('/api/b2c/provision', order(1105, 'checkout.cuatro@fixture.invalid', { termsAcceptance: T_ACC }), { tamper: true });
        ok('cuerpo alterado tras firmar ⇒ 401, nada registrado', forged.status === 401 && fs.readFileSync(process.env.CHP_A2_REGISTRY, 'utf8') === regBefore);
        const retry = await signed('/api/b2c/provision', order(1101, 'checkout.uno@fixture.invalid', { termsAcceptance: T_ACC }));
        ok('reintento de la tienda ⇒ already_activated; la T sigue efectiva', retry.status === 200 && retry.body.status === 'already_activated' && g().effective('T', c1.body.userId));
    }

    console.log('[11] V8.1-CLOSE-09B: reenvío firmado tras una supresión o una baja');
    {
        const SUP = await import('../privacy/suppression.mjs');
        const adm = await login('admin@fixture.invalid');
        const del = (id) => fetch(`${base}/api/users/${id}`, { method: 'DELETE', headers: { cookie: adm.cookie, origin: 'https://app.test' } });
        const sA = await signed('/api/b2c/provision', order(1201, 'suprimida@fixture.invalid'));
        ok('alta B2C de la persona', sA.status === 200 && sA.body.status === 'activated');
        ok('baja con la operación existente', (await del(sA.body.userId)).status === 200);
        const sAck = await SUP.suppressResidualSources({ access: P.access }, sA.body.userId); // paso del operador sobre access_db.json
        ok('la regla del pedido queda sin titular y vencida', sAck.access.b2cKeptWithoutSubject === 1);
        const n0 = J(P.users).length;
        const rep = await signed('/api/b2c/provision', order(1201, 'suprimida@fixture.invalid'));
        ok('reenvío firmado del mismo pedido ⇒ 409 account_not_available', rep.status === 409 && rep.body?.code === 'account_not_available', JSON.stringify(rep));
        ok('…sin crear ni invitar a nadie', J(P.users).length === n0 && !J(P.users).some((u) => u.email === 'suprimida@fixture.invalid'));
        ok('…sin enlace, id ni datos del titular en la respuesta', !('activationUrl' in (rep.body ?? {})) && !('userId' in (rep.body ?? {})) && !JSON.stringify(rep.body).includes('suprimida'));
        const otraIdentidad = await signed('/api/b2c/provision', order(1201, 'otra@fixture.invalid'));
        ok('…misma respuesta con otro correo (no revela al titular)', otraIdentidad.status === 409 && otraIdentidad.body?.code === 'account_not_available');
        const nuevo = await signed('/api/b2c/provision', order(1202, 'suprimida@fixture.invalid'));
        ok('pedido NUEVO de la misma persona ⇒ alta nueva legítima', nuevo.status === 200 && nuevo.body.status === 'activated' && nuevo.body.userId !== sA.body.userId);
        const otro = await signed('/api/b2c/provision', order(1203, 'otra.persona@fixture.invalid'));
        ok('pedido de otra persona ⇒ alta normal', otro.status === 200 && otro.body.status === 'activated');
        ok('reintento normal (cuenta viva) sigue idempotente', (await signed('/api/b2c/provision', order(1203, 'otra.persona@fixture.invalid'))).body?.status === 'already_activated');
        ok('baja SIN supresión todavía (entre DELETE y operador)', (await del(otro.body.userId)).status === 200);
        const gap = await signed('/api/b2c/provision', order(1203, 'otra.persona@fixture.invalid'));
        ok('…el reenvío tampoco recrea la cuenta', gap.status === 409 && gap.body?.code === 'account_not_available' && !J(P.users).some((u) => u.email === 'otra.persona@fixture.invalid'));
        const rv = await signed('/api/b2c/revoke', { orderId: 1201, source: 'test', idempotencyKey: 'test:order:1201', reason: 'refunded' });
        ok('el reembolso del pedido suprimido sigue funcionando (contrato con la tienda)', rv.status === 200);
    }

    console.log('[12] V8.1-PROD-05B: documentos no aprobados (G1/G2) y dos réplicas');
    {
        const [P_NONE, P_PART, P_BAD, P_R2] = MORE_PORTS;
        const at = (p) => `http://127.0.0.1:${p}`;
        const docs = (over = {}, ids = ['001', '002', '004', '005']) => JSON.stringify(Object.fromEntries(Object.values(ACCEPTANCE_DOCUMENTS)
            .filter((d) => ids.includes(d.id)).map((d) => [d.id, { version: d.version, url: `https://docs.example.invalid/${d.id}`, ...(over[d.id] || {}) }])));
        startServer(P_NONE, { CHP_ACCEPTANCE_DOCUMENTS: '' });
        startServer(P_PART, { CHP_ACCEPTANCE_DOCUMENTS: docs({}, ['001', '002', '005']) });                       // 002 aprobado, 004 pendiente
        startServer(P_BAD, { CHP_ACCEPTANCE_DOCUMENTS: docs({ '004': { version: '004@0.9' }, '001': { url: 'http://docs.example.invalid/001' } }) });
        startServer(P_R2);                                                                                         // réplica 2, configuración completa
        ok('arrancan las cuatro instancias sobre el mismo almacén', (await Promise.all([P_NONE, P_PART, P_BAD, P_R2].map((p) => arrancado(at(p))))).every(Boolean));
        const casos = [
            ['cuenta nueva con T válida', () => order(1301, 'g1.nueva@fixture.invalid', { termsAcceptance: T_NOW() })],
            ['cuenta nueva sin T', () => order(1302, 'g1.sin@fixture.invalid')],
            ['cuenta reutilizada (activa) con T', () => order(1303, 'lector.colegio@fixture.invalid', { termsAcceptance: T_NOW() })],
            ['cuenta reutilizada (activa) sin T', () => order(1304, 'lector.colegio@fixture.invalid')],
            ['T de versión incorrecta', () => order(1305, 'g1.version@fixture.invalid', { termsAcceptance: { version: '002@0.9', acceptedAt: Date.now() } })],
            ['reintento de un pedido ya aprovisionado', () => order(1001, 'comprador.uno@fixture.invalid')],
            ['dry-run', () => order(1306, 'g1.dry@fixture.invalid', { termsAcceptance: T_NOW(), dryRun: true })],
        ];
        for (const [nombre, p] of [['sin documentos', P_NONE], ['002 aprobado y 004 pendiente', P_PART], ['004 con otra versión y 001 sin https', P_BAD]]) {
            const snap = stores(); const res = [];
            for (const [, cuerpo] of casos) res.push(await signed('/api/b2c/provision', cuerpo(), { at: at(p) }));
            const codes = res.map((r) => `${r.status}:${r.body?.code}`);
            // La versión incorrecta es entrada inválida (400) y se rechaza antes; todo lo demás ⇒ 503.
            ok(`G1 ${nombre}: 503 DOCUMENTS_NOT_APPROVED en todos los casos válidos`, codes.every((c, i) => c === (casos[i][0] === 'T de versión incorrecta' ? '400:invalid_terms_acceptance' : '503:DOCUMENTS_NOT_APPROVED')), JSON.stringify(codes));
            ok(`G1 ${nombre}: cero escrituras (cuentas, reglas y registro de decisiones idénticos)`, stores() === snap);
            ok(`G1 ${nombre}: la respuesta no revela cuenta ni enlace`, res.every((r) => !('userId' in (r.body ?? {})) && !('activationUrl' in (r.body ?? {}))));
        }
        ok('G1: sin firma válida sigue siendo 401 antes que 503', (await signed('/api/b2c/provision', order(1307, 'g1.firma@fixture.invalid'), { at: at(P_NONE), secret: 'y'.repeat(64) })).status === 401);
        ok('G1: la revocación (reembolso) no depende de los documentos', (await signed('/api/b2c/revoke', { orderId: 1004, source: 'test', idempotencyKey: 'test:order:1004', reason: 'refunded' }, { at: at(P_NONE) })).status === 200);

        // Dos réplicas (base y P_R2) con configuración completa sobre el mismo almacén.
        const usersN = J(P.users).length, rulesN = J(P.access).length;
        const cuerpo = order(1401, 'dos.replicas@fixture.invalid', { termsAcceptance: T_NOW() });
        const [ra, rb] = await Promise.all([signed('/api/b2c/provision', cuerpo), signed('/api/b2c/provision', cuerpo, { at: at(P_R2) })]);
        ok('réplicas: el mismo pedido a la vez ⇒ 200 en ambas (activated + already_activated)', ra.status === 200 && rb.status === 200 &&
            [ra.body.status, rb.body.status].sort().join() === 'activated,already_activated', JSON.stringify([ra.body, rb.body]));
        ok('réplicas: una sola cuenta y una sola regla, del mismo titular', J(P.users).length === usersN + 1 && J(P.access).length === rulesN + 1 && ra.body.userId === rb.body.userId);
        ok('réplicas: la T del checkout queda efectiva para esa cuenta', R.decisionGate().effective('T', ra.body.userId));
        const snap2 = stores();
        const [ga, gb] = await Promise.all([signed('/api/b2c/provision', order(1402, 'admin@fixture.invalid')), signed('/api/b2c/provision', order(1402, 'admin@fixture.invalid'), { at: at(P_R2) })]);
        ok('réplicas: G3 en ambas ⇒ 422 si la cuenta activa no aporta T vigente', ga.status === 422 && gb.status === 422, JSON.stringify([ga.body, gb.body]));
        ok('réplicas: …sin ninguna escritura', stores() === snap2);
        // MIXTO ya tiene T vigente de 1010 (checkout) ⇒ una compra posterior sin T se acepta (aceptación previa aplicable).
        const prev = await signed('/api/b2c/provision', order(1403, 'mixto@fixture.invalid'), { at: at(P_R2) });
        ok('G3: T previa vigente de la misma versión ⇒ 200 sin inventar una nueva', prev.status === 200 && prev.body.termsRecorded === false, JSON.stringify(prev.body));
    }

    console.log('[10] entrada inválida y registros');
    ok('plan inválido → 400 invalid_plan', (await signed('/api/b2c/provision', order(1006, 'x@fixture.invalid', { plan: 'mensual' }))).body?.code === 'invalid_plan');
    ok('clave de idempotencia ajena → 400', (await signed('/api/b2c/provision', order(1007, 'x@fixture.invalid', { idempotencyKey: 'test:order:1' }))).status === 400);
    await sleep(300);
    const leaks = boot.split(/\r?\n/).filter(l => /comprador\.uno@|vencido@|nuevo@/i.test(l));
    console.log('    líneas con correo (rutas preexistentes):', JSON.stringify(leaks.map(l => l.replace(/\S+@fixture\.invalid/gi, '<correo>').slice(0, 120))));
    await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nadie@fixture.invalid', password: 'x' }) });
    await sleep(200);
    const fullEmails = boot.split(/\r?\n/).filter(l => /[\w.+-]+@fixture\.invalid/i.test(l));
    ok('CHP-PRIVACY-LOGGING-01: ningún registro contiene un correo completo', fullEmails.length === 0, JSON.stringify(fullEmails.map(l => l.slice(0, 100))));
    ok('el login fallido se registra redactado', /Login fallido: n\*\*\*@fixture\.invalid/.test(boot));
    ok('los registros no contienen el secreto ni tokens de invitación', !boot.includes(SECRET) && !/[0-9a-f]{64}/.test(boot));

    console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
} finally {
    for (const c of children) c.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    try { fs.rmSync(B2C_PROVISIONING_SECRET_PATH, { force: true }); } catch { /* */ }
}
process.exit(fail === 0 ? 0 : 1);
