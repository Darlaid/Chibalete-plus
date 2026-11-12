/**
 * loginIdentifierHttp.test.mjs — CHP V9 F3-D2.
 *
 * Inicio de sesión por correo O por usuario de acceso (`loginId`) de una cuenta representada (F3-D1).
 * Parte pura (cualquier plataforma) y server.js REAL en SESSION_AUTH_MODE=enforce sobre un padrón
 * sintético (POSIX: la clave de sesión se lee con el lector fail-closed POSIX).
 *   [0] resolución de identidad (pura)
 *   [1] cuentas existentes: lector, mediador y administrador por correo (sin regresión)
 *   [2] lector representado por loginId
 *   [3] el correo del representante no abre la cuenta de ninguno de sus hijos
 *   [4] dos hermanos con el mismo contacto: sesiones independientes
 *   [5] respuestas neutras: usuario inexistente y contraseña incorrecta
 *   [6] cuenta desactivada, invitación pendiente y suscripción revocada
 *   [7] cierre de sesión y nueva sesión
 *   [8] límite de intentos por cuenta
 *   [9] registros, decisiones y padrón
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/loginIdentifierHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath } from './helpers/testA2.mjs';
import { appendDecisions, dayOf } from '../privacy/a2Registry.mjs';
import { findLoginIndex, matchesLoginIdentifier, isLoginIdForm } from '../lib/loginIdentity.mjs';
import { loginAccountKey, loginLimits } from '../lib/loginRateLimits.mjs';
import { makeB2cLoginId } from '../b2c/b2cProvisioning.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { freePort } from './helpers/freePort.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (e) => (e ? String(e).trim().toLowerCase() : '');

// Contraseñas sintéticas de fixture, una por cuenta.
const pw = (id) => `Fixture-${id}-sintetica-71!`;
const hash = (id) => bcrypt.hashSync(pw(id), 4);
const CONTACT = 'representante@x.test';
const L = { K1: 'lec-aaaa-bbbb-cccc', K2: 'lec-dddd-eeee-ffff', K3: 'lec-gggg-hhhh-2222', DIS: 'lec-3333-4444-5555', INV: 'lec-6666-7777-8888', VIC: 'lec-9999-aaaa-bbbb', GHOST: 'lec-zzzz-zzzz-zzzz' };
const emailAcc = (id, roles = ['lector'], extra = {}) => ({ id, email: `${id.toLowerCase()}@x.test`, nombre_completo: id, password: hash(id), roles, accountStatus: 'active', groupIds: [], ...extra });
const repAcc = (id, extra = {}) => ({ id, email: '', loginId: L[id], representedBy: { email: CONTACT }, nombre_completo: 'Lector', nombre_usuario: L[id], password: hash(id), roles: ['lector'], accountStatus: 'active', groupIds: [], b2c: true, createdVia: 'b2c-provision', ...extra });
const seed = [
    emailAcc('ADM', ['administrador']), emailAcc('MED', ['mediador'], { mediatorKind: 'teacher' }), emailAcc('LEC'),
    { ...emailAcc('REP'), email: CONTACT },                      // el representante tiene además su propia cuenta
    repAcc('K1'), repAcc('K2'),                                  // dos hermanos, mismo contacto
    repAcc('K3', { representedBy: { email: 'sin.cuenta@x.test' } }), // su representante NO tiene cuenta
    repAcc('DIS', { accountStatus: 'disabled' }), repAcc('INV', { accountStatus: 'invited' }), repAcc('VIC'),
    { ...emailAcc('COL'), email: 'lec-cccc-dddd-eeee' },         // «correo» heredado con forma de usuario (no debería existir)
];

console.log('[0] resolución de identidad (pura)');
ok('correo → la cuenta de ese correo, como siempre (normalizado)', seed[findLoginIndex(seed, norm('  LEC@X.test '), norm)]?.id === 'LEC');
ok('loginId → la cuenta representada de ese usuario', seed[findLoginIndex(seed, L.K1, norm)]?.id === 'K1' && seed[findLoginIndex(seed, norm('LEC-DDDD-EEEE-FFFF'), norm)]?.id === 'K2');
ok('el contacto del representante resuelve SOLO a su propia cuenta, nunca a un hijo', seed[findLoginIndex(seed, CONTACT, norm)]?.id === 'REP' && findLoginIndex(seed, 'sin.cuenta@x.test', norm) === -1);
ok('identificador vacío, nulo o no cadena → nadie (las cuentas representadas tienen email vacío)', [findLoginIndex(seed, '', norm), findLoginIndex(seed, null, norm), findLoginIndex(seed, undefined, norm), findLoginIndex(seed, 7, norm), findLoginIndex(null, 'x', norm)].every((i) => i === -1));
ok('loginId inexistente → nadie', findLoginIndex(seed, L.GHOST, norm) === -1);
ok('sin colisiones: un identificador con forma de usuario nunca se busca entre los correos', isLoginIdForm('lec-cccc-dddd-eeee') && findLoginIndex(seed, 'lec-cccc-dddd-eeee', norm) === -1);
ok('…y un correo nunca se busca entre los usuarios', findLoginIndex([{ id: 'X', email: '', loginId: 'a@x.test' }], 'a@x.test', norm) === -1 && !isLoginIdForm('a@x.test') && !isLoginIdForm('lec-aaaa-bbbb-cccc@x.test') && !isLoginIdForm('lec-aaaa-bbbb'));
ok('revalidación bajo el lock: misma regla que la búsqueda', matchesLoginIdentifier(seed[4], L.K1, norm) && !matchesLoginIdentifier(seed[4], L.K2, norm) && !matchesLoginIdentifier(seed[4], CONTACT, norm) && !matchesLoginIdentifier(seed[4], '', norm) && matchesLoginIdentifier(seed[2], 'lec@x.test', norm) && !matchesLoginIdentifier(null, L.K1, norm));
ok('1000 usuarios generados por la provisión tienen la forma que reconoce el login', Array.from({ length: 1000 }, () => makeB2cLoginId()).every(isLoginIdForm));
ok('la clave del límite por cuenta es la del identificador normalizado (mayúsculas y espacios no la esquivan)', loginAccountKey(' LEC-AAAA-BBBB-CCCC ', norm) === loginAccountKey(L.K1, norm) && loginAccountKey(L.K1, norm) !== loginAccountKey(L.K2, norm) && !loginAccountKey(L.K1, norm).includes('aaaa'));

if (process.platform === 'win32') { console.log(`\nloginIdentifierHttp: parte HTTP SKIP (POSIX-only)\nresultado: ${pass} correctas, ${fail} fallidas`); process.exit(fail ? 1 : 0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_loginid_'));
const USERS = path.join(tmp, 'users.json');
const key = path.join(tmp, 'session_signing_key');
fs.writeFileSync(USERS, JSON.stringify(seed, null, 2));
fs.writeFileSync(path.join(tmp, 'g.json'), '[]'); fs.writeFileSync(path.join(tmp, 's.json'), '[]');
const future = Date.now() + 300 * 86400000;
fs.writeFileSync(path.join(tmp, 'a.json'), JSON.stringify([
    { id: 'access-b2c-test-order-1', scope: 'user', scopeId: 'K1', titleIds: ['obra-1'], collectionIds: [], expiresAt: future, b2c: { orderId: 1, idempotencyKey: 'test:order:1' } },
    { id: 'access-b2c-test-order-2', scope: 'user', scopeId: 'K2', titleIds: ['obra-1'], collectionIds: [], expiresAt: Date.now() - 1000, b2c: { orderId: 2, idempotencyKey: 'test:order:2', revokedAt: Date.now() - 1000, revokeReason: 'refunded' } },
]));
fs.writeFileSync(path.join(tmp, 'c.json'), JSON.stringify([{ id: 'obra-1', titulo: 'Obra 1', tipo: 'libro' }]));
fs.writeFileSync(key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(key, 0o400);
// Decisiones previas del representante sobre K1 (sin verificar): el login no debe tocarlas.
const REG = a2RegistryPath();
appendDecisions(['T', 'A0', 'A1', 'A3'].map((kind) => ({ subjectId: 'K1', kind, status: 'granted', actDay: dayOf(Date.now()), version: kind === 'T' ? '002@1.0' : '004@1.0', medium: 'in_app', capacity: 'legal_representative', verification: 'unverified', requestRef: `SINT-F3D2-${kind}` })), { env: { CHP_A2_REGISTRY: REG } });

const port = await freePort(); const base = `http://127.0.0.1:${port}`;
let logs = '';
const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
    ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: path.join(tmp, 'data'), USERS_DB: USERS,
    GROUPS_DB: path.join(tmp, 'g.json'), SCHOOLS_DB: path.join(tmp, 's.json'), ACCESS_DB: path.join(tmp, 'a.json'), CONTENT_DB: path.join(tmp, 'c.json'),
    UPLOADS_ROOT: path.join(tmp, 'up'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'o.db'), USER_AUDIT_DB: path.join(tmp, 'audit.json'),
    IDENTITY_DB: path.join(tmp, 'i.db'), IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: path.join(tmp, 'in.db'), EVENTS_SQLITE_PATH: path.join(tmp, 'e.db'), PROGRESS_SQLITE_PATH: path.join(tmp, 'p.db'),
    SESSIONS_DB: path.join(tmp, 'se.db'), SESSION_KEY_CURRENT_PATH: key, ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'enforce', CHP_A2_REGISTRY: REG,
} });
child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });

const readUsers = () => JSON.parse(fs.readFileSync(USERS, 'utf8'));
const user = (id) => readUsers().find((u) => u.id === id);
const login = async (identifier, password) => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identifier, password }) });
    const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
    return { status: r.status, body, text, cookie: (r.headers.get('set-cookie') || '').match(/chp_session=[^;]+/)?.[0] ?? null };
};
const me = async (cookie) => { const r = await fetch(`${base}/api/auth/me`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (url, cookie) => (await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie }, body: '{}' })).status;
const access = async (cookie, userId) => { const r = await fetch(`${base}/api/content/obra-1/access?userId=${userId}`, { headers: { cookie } }); const b = await r.json().catch(() => null); return r.status === 200 ? b?.allowed === true : `HTTP${r.status}`; };
const DENIED = '{"error":"Credenciales inválidas"}';

try {
    for (let i = 0; ; i++) {
        try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* arrancando */ }
        if (i > 200 || child.exitCode !== null) throw new Error(`no arrancó\n${logs.slice(-2000)}`);
        await sleep(150);
    }
    const regBefore = fs.readFileSync(REG, 'utf8');

    console.log('[1] cuentas existentes por correo (sin regresión)');
    const lec = await login('lec@x.test', pw('LEC'));
    ok('lector: correo y contraseña válidos → 200, sesión, su propia cuenta', lec.status === 200 && !!lec.cookie && lec.body?.user?.id === 'LEC' && (await me(lec.cookie)).body?.id === 'LEC');
    ok('…el correo sigue aceptándose con mayúsculas y espacios', (await login('  LEC@X.Test ', pw('LEC'))).body?.user?.id === 'LEC');
    const adm = await login('adm@x.test', pw('ADM')), med = await login('med@x.test', pw('MED'));
    ok('administrador y mediador: 200 con sus roles', adm.body?.user?.id === 'ADM' && adm.body.user.roles.includes('administrador') && med.body?.user?.id === 'MED' && med.body.user.roles.includes('mediador'));
    ok('contraseña incorrecta → 401 genérico; la respuesta no trae contraseña ni tokens', (await login('lec@x.test', 'otra')).text === DENIED && !('password' in lec.body.user) && !/inviteToken|resetToken/.test(lec.text));

    console.log('[2] lector representado por loginId');
    const k1 = await login(L.K1, pw('K1'));
    ok('loginId y contraseña válidos → 200, sesión, su propia cuenta', k1.status === 200 && !!k1.cookie && k1.body?.user?.id === 'K1' && (await me(k1.cookie)).body?.id === 'K1');
    ok('…en mayúsculas o con espacios también (mismo normalizado que el correo)', (await login(` ${L.K1.toUpperCase()} `, pw('K1'))).body?.user?.id === 'K1');
    ok('…lastLoginAt queda en SU registro y solo en el suyo', !!user('K1').lastLoginAt && !user('K2').lastLoginAt && !user('REP').lastLoginAt);
    ok('…la sesión es de un lector sin privilegios', JSON.stringify((await me(k1.cookie)).body?.roles) === '["lector"]');

    console.log('[3] el correo del representante no abre la cuenta de sus hijos');
    ok('correo del representante + contraseña del menor → 401 genérico (para ambos hijos)', (await login(CONTACT, pw('K1'))).text === DENIED && (await login(CONTACT, pw('K2'))).text === DENIED);
    const rep = await login(CONTACT, pw('REP'));
    ok('correo del representante + SU contraseña → su propia cuenta, no la de un hijo', rep.body?.user?.id === 'REP' && (await me(rep.cookie)).body?.id === 'REP');
    ok('representante sin cuenta propia: su correo no autentica a nadie', (await login('sin.cuenta@x.test', pw('K3'))).text === DENIED && (await login(L.K3, pw('K3'))).body?.user?.id === 'K3');
    ok('la contraseña del representante no abre la cuenta del menor', (await login(L.K1, pw('REP'))).text === DENIED);

    console.log('[4] dos hermanos con el mismo contacto');
    const k2 = await login(L.K2, pw('K2'));
    ok('cada uno entra con SU usuario y SU contraseña; sesiones distintas', k2.body?.user?.id === 'K2' && k2.cookie !== k1.cookie && (await me(k2.cookie)).body?.id === 'K2' && (await me(k1.cookie)).body?.id === 'K1');
    ok('las credenciales de un hermano no abren la cuenta del otro', (await login(L.K1, pw('K2'))).text === DENIED && (await login(L.K2, pw('K1'))).text === DENIED);
    ok('biblioteca: cada sesión decide solo sobre su propio user.id', (await access(k1.cookie, 'K1')) === true && (await access(k2.cookie, 'K1')) !== true && (await access(k1.cookie, 'K2')) !== true && (await access(rep.cookie, 'K1')) !== true);

    console.log('[5] respuestas neutras');
    const ghost = await login(L.GHOST, 'x'), wrong = await login(L.K1, 'x'), noMail = await login('nadie@x.test', 'x');
    ok('loginId inexistente, loginId real con contraseña incorrecta y correo inexistente → mismo estado y mismo cuerpo', [ghost, wrong, noMail].every((r) => r.status === 401 && r.text === DENIED && r.cookie === null));
    ok('variantes del usuario (con dominio, truncado, con otro prefijo) → 401 genérico', (await login(`${L.K1}@x.test`, pw('K1'))).text === DENIED && (await login(L.K1.slice(0, 13), pw('K1'))).text === DENIED && (await login(L.K1.replace('lec-', 'usr-'), pw('K1'))).text === DENIED);
    ok('un «correo» con forma de usuario no se autentica por la vía de correo (espacios disjuntos)', (await login('lec-cccc-dddd-eeee', pw('COL'))).text === DENIED);
    ok('cuerpo inválido → 400 como antes', (await login('', 'x')).status === 400 && (await login('ab', 'x')).status === 400);

    console.log('[6] cuenta desactivada, invitación pendiente y suscripción revocada');
    ok('cuenta desactivada con contraseña correcta → 401 genérico', (await login(L.DIS, pw('DIS'))).text === DENIED);
    ok('invitación pendiente (sin activar) → 401 genérico', (await login(L.INV, pw('INV'))).text === DENIED);
    const revoked = await access(k2.cookie, 'K2');
    ok('suscripción revocada: entra a su cuenta pero la obra no se abre', k2.status === 200 && [false, 'HTTP403'].includes(revoked), String(revoked));

    console.log('[7] cierre de sesión y nueva sesión');
    ok('la sesión sigue válida en peticiones sucesivas', (await me(k1.cookie)).status === 200 && (await me(k1.cookie)).status === 200);
    ok('cerrar la sesión de un hermano la invalida y no afecta a la del otro', (await post('/api/auth/logout', k1.cookie)) === 200 && (await me(k1.cookie)).status === 401 && (await me(k2.cookie)).status === 200);
    const k1b = await login(L.K1, pw('K1'));
    ok('vuelve a entrar con su usuario: sesión nueva, la anterior sigue sin valer', k1b.status === 200 && k1b.cookie !== k1.cookie && (await me(k1b.cookie)).body?.id === 'K1' && (await me(k1.cookie)).status === 401);
    ok('cerrar todas sus sesiones no toca las de su hermano ni las del representante', (await post('/api/auth/logout-all', k1b.cookie)) === 200 && (await me(k1b.cookie)).status === 401 && (await me(k2.cookie)).status === 200 && (await me(rep.cookie)).status === 200);
    ok('…y después sigue pudiendo entrar con su usuario', (await login(L.K1, pw('K1'))).status === 200);

    console.log('[8] límite de intentos por cuenta');
    const max = loginLimits(false).account; const st = [];
    for (let i = 0; i < max; i++) st.push((await login(L.VIC, 'incorrecta')).status);
    ok(`${max} fallos sobre un usuario → todos 401`, st.every((s) => s === 401));
    ok('el siguiente intento → 429, también con la contraseña correcta y con el usuario en mayúsculas', (await login(L.VIC, pw('VIC'))).status === 429 && (await login(L.VIC.toUpperCase(), pw('VIC'))).status === 429);
    ok('el bloqueo es de esa cuenta: su hermano y un lector por correo siguen entrando', (await login(L.K2, pw('K2'))).status === 200 && (await login('lec@x.test', pw('LEC'))).status === 200);
    const st2 = []; for (let i = 0; i <= max; i++) st2.push((await login(L.GHOST, 'x')).status);
    ok('un usuario inexistente se bloquea igual (el límite no revela qué cuentas existen)', st2.slice(0, max - 1).every((s) => s === 401) && st2[max] === 429);

    console.log('[9] registros, decisiones y padrón');
    await sleep(300);
    ok('los registros no contienen contraseñas, usuarios de acceso, correos completos ni cookies', !Object.keys(L).some((k) => logs.includes(L[k])) && !/Fixture-[A-Z0-9]+-sintetica/.test(logs) && !/[\w.+-]+@x\.test/.test(logs) && !/chp_session=/.test(logs));
    ok('el intento fallido por usuario se registra sin identificador', /Login fallido: unknown/.test(logs) && /Login exitoso: user=K1/.test(logs));
    ok('iniciar sesión no altera ninguna decisión (A0/A1/A3 siguen sin verificar) ni añade líneas al registro', fs.readFileSync(REG, 'utf8') === regBefore);
    const after = readUsers();
    ok('el padrón solo cambió en lastLoginAt y en la versión de credenciales de quien cerró todas sus sesiones', after.length === seed.length && after.every((u) => { const b = seed.find((x) => x.id === u.id); const { lastLoginAt, credentialVersion, ...rest } = u; return JSON.stringify(rest) === JSON.stringify(b); }));
    ok('ninguna cuenta ganó correo, usuario ni contacto', after.every((u) => { const b = seed.find((x) => x.id === u.id); return u.email === b.email && u.loginId === b.loginId && JSON.stringify(u.representedBy) === JSON.stringify(b.representedBy); }));
} catch (e) {
    console.error(e); fail++;
} finally {
    child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
