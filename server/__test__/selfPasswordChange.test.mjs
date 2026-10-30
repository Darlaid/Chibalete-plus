/**
 * selfPasswordChange.test.mjs — SEC-ACCOUNT-01.
 *
 * Cambio de contraseña PROPIA (POST /api/auth/change-password) contra DOS
 * réplicas reales del servidor en SESSION_AUTH_MODE=enforce que comparten
 * padrón, store de sesiones y clave de firma (la topología productiva), con
 * stores herméticos en un directorio temporal. Demuestra:
 *   [1] identidad solo por sesión firmada (ni x-user-id ni id en el cuerpo);
 *   [2] administrador, mediador y lector cambian su contraseña;
 *   [3] credentialVersion++ y revocación de TODAS las sesiones entre réplicas;
 *   [4] hash bcrypt generado por el servidor; la anterior deja de valer;
 *   [5] actual incorrecta, confirmación distinta, corta, predeterminada,
 *       formato hash, demasiado larga y reutilización → rechazo sin escribir;
 *   [6] nunca cambia la cuenta de un tercero;
 *   [7] la cuenta principal protegida puede cambiar la suya;
 *   [8] se conservan id, roles, email, colegio, grupos, progreso y reglas;
 *   [9] tope de intentos fallidos por cuenta;
 *  [10] concurrencia: una sola gana, sin escrituras perdidas;
 *  [11] ningún secreto en respuestas, logs ni auditoría;
 *  [12] CSRF y sin regresión en login y reset.
 * POSIX-only (la clave de sesión se lee con el lector fail-closed POSIX).
 *
 *   node server/__test__/selfPasswordChange.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
if (process.platform === 'win32') { console.log('selfPasswordChange: SKIP (POSIX-only)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_selfpw_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json', identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key', audit: tmp + '/au.json' };
fs.mkdirSync(P.uploads, { recursive: true });

// Contraseñas sintéticas de fixture (no son credenciales reales).
const PW = { PRIN: 'Prin-fixture-80!x', ADM: 'Adm-fixture-77!xy', MED: 'Med-fixture-56!xy', RDR: 'Rdr-fixture-12!xy', RDR2: 'Rdr2-fixture-34!x', LIM: 'Lim-fixture-45!xy', CON: 'Con-fixture-67!xy', XA: 'Xa-fixture-01!xyz', XB: 'Xb-fixture-02!xyz' };
const NEW = { PRIN: 'Prin-Nueva-Segura-81', ADM: 'Adm-Nueva-Segura-78', MED: 'Med-Nueva-Segura-57', RDR: 'Rdr-Nueva-Segura-13', CON1: 'Con-Gana-Uno-6801', CON2: 'Con-Gana-Dos-6802', XA: 'Xa-Nueva-Segura-91', XB: 'Xb-Nueva-Segura-92' };
const RESET_TOKEN = crypto.randomBytes(32).toString('hex');
const H = (p) => bcrypt.hashSync(p, 4);
const fixtures = [
    { id: 'PRIN', email: 'admin@chibaleteeditores.com', nombre_completo: 'Principal', password: H(PW.PRIN), roles: ['administrador'], accountStatus: 'active' },
    { id: 'ADM', email: 'adm@x.test', nombre_completo: 'Admin', password: H(PW.ADM), roles: ['administrador'], accountStatus: 'active' },
    { id: 'MED', email: 'med@x.test', nombre_completo: 'Mediadora', password: H(PW.MED), roles: ['mediador'], mediatorKind: 'teacher', colegio: 'Colegio Uno', accountStatus: 'active', credentialVersion: 3 },
    { id: 'RDR', email: 'lectora.larga@x.test', nombre_completo: 'Lectora', password: H(PW.RDR), roles: ['lector'], colegio: 'Colegio Uno', accountStatus: 'active', groupIds: ['g1'], nivel_lectura: 'Explorador', libros_leidos: 7, resetToken: RESET_TOKEN, resetExpiresAt: Date.now() + 3600e3 },
    { id: 'RDR2', email: 'rdr2@x.test', nombre_completo: 'Lector Dos', password: H(PW.RDR2), roles: ['lector'], accountStatus: 'active', groupIds: ['g1'] },
    { id: 'LIM', email: 'lim@x.test', nombre_completo: 'Límite', password: H(PW.LIM), roles: ['lector'], accountStatus: 'active' },
    { id: 'CON', email: 'con@x.test', nombre_completo: 'Concurrente', password: H(PW.CON), roles: ['lector'], accountStatus: 'active' },
    { id: 'XA', email: 'xa@x.test', nombre_completo: 'XA', password: H(PW.XA), roles: ['lector'], accountStatus: 'active' },
    { id: 'XB', email: 'xb@x.test', nombre_completo: 'XB', password: H(PW.XB), roles: ['mediador'], accountStatus: 'active' },
];
fs.writeFileSync(P.users, JSON.stringify(fixtures, null, 2));
fs.writeFileSync(P.groups, JSON.stringify([{ id: 'g1', type: 'course', name: 'G1', memberIds: ['RDR', 'RDR2'], mediatorIds: ['MED'] }]));
fs.writeFileSync(P.schools, '[]');
fs.writeFileSync(P.access, JSON.stringify([{ id: 'rule-rdr', scope: 'user', scopeId: 'RDR', titleIds: ['t1'], collectionIds: [], expiresAt: null }]));
fs.writeFileSync(P.content, JSON.stringify([{ id: 't1', title: 'T' }]));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

// Dos réplicas, mismos stores (como api_1/api_2 con bind mounts compartidos).
const PORTS = [4610 + (process.pid % 80), 4700 + (process.pid % 80)];
const bases = PORTS.map(p => `http://127.0.0.1:${p}`);
let serverLog = '';
const children = PORTS.map((port) => {
    const c = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: tmp + '/data',
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
        CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
        USER_AUDIT_DB: P.audit, IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
        INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db',
        PROGRESS_SQLITE_PATH: tmp + '/progress.db',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        ACCESS_FALLBACK_MODE: 'open', SESSION_AUTH_MODE: 'enforce',
    } });
    c.stdout.on('data', d => serverLog += d); c.stderr.on('data', d => serverLog += d);
    return c;
});
async function waitHealthy(base, child) { for (let i = 0; i < 150; i++) { if (child.exitCode !== null) throw new Error('rc\n' + serverLog.slice(-1500)); try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await sleep(400); } throw new Error('never healthy\n' + serverLog.slice(-1500)); }

const [A, B] = bases;
const readUsers = () => JSON.parse(fs.readFileSync(P.users, 'utf8'));
const userById = (id) => readUsers().find(u => u.id === id);
const cookieOf = (r) => { const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m && m[1] ? `chp_session=${m[1]}` : null; };
const login = (base, email, password) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
const loginCookie = async (base, email, password) => cookieOf(await login(base, email, password));
const me = async (base, cookie) => (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status;
const change = (base, cookie, body, extra = {}) => fetch(`${base}/api/auth/change-password`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) });
const trio = (cur, nw, conf = nw) => ({ currentPassword: cur, newPassword: nw, confirmPassword: conf });
const isServerBcrypt = (h) => typeof h === 'string' && /^\$2[ab]\$10\$/.test(h); // coste del servidor (fixtures usan 4)
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const bodies = []; // todas las respuestas del endpoint, para buscar secretos
const call = async (...args) => { const r = await change(...args); const txt = await r.text(); bodies.push(txt); let json = {}; try { json = JSON.parse(txt); } catch {} return { status: r.status, json, headers: r.headers, txt }; };
const keep = (u) => { const { password, credentialVersion, resetToken, resetExpiresAt, lastLoginAt, ...r } = u; return JSON.stringify(r); };

async function main() {
    await Promise.all(bases.map((b, i) => waitHealthy(b, children[i])));

    console.log('\n[1] identidad solo por sesión firmada');
    const rdrBefore = userById('RDR');
    ok('sin sesión → 401', (await call(A, null, trio(PW.RDR, NEW.RDR))).status === 401);
    ok('solo x-user-id (enforce) → 401', (await call(A, null, trio(PW.RDR, NEW.RDR), { 'x-user-id': 'RDR' })).status === 401);
    ok('cookie inválida → 401', (await call(A, 'chp_session=forjada.invalida', trio(PW.RDR, NEW.RDR))).status === 401);
    const rdr2 = await loginCookie(A, 'rdr2@x.test', PW.RDR2);
    ok('sesión de RDR2 + x-user-id de RDR → 401 (subject mismatch)', (await call(A, rdr2, trio(PW.RDR, NEW.RDR), { 'x-user-id': 'RDR' })).status === 401);
    ok('RDR intacta tras los intentos', JSON.stringify(userById('RDR')) === JSON.stringify(rdrBefore));

    console.log('\n[5] validaciones (sin escritura)');
    const med = await loginCookie(A, 'med@x.test', PW.MED);
    const medBefore = JSON.stringify(userById('MED'));
    const expect400 = async (label, body, code) => { const r = await call(A, med, body); ok(`${label} → 400 ${code}`, r.status === 400 && r.json.code === code, `${r.status} ${r.json.code}`); };
    await expect400('campos ausentes', { currentPassword: PW.MED }, 'invalid');
    await expect400('contraseña actual incorrecta', trio('Incorrecta-123456', NEW.MED), 'current_password_invalid');
    await expect400('confirmación distinta', trio(PW.MED, NEW.MED, NEW.MED + 'x'), 'confirm_mismatch');
    await expect400('11 caracteres', trio(PW.MED, 'Corta-12345'), 'too_short');
    await expect400('predeterminada de 13 caracteres', trio(PW.MED, 'administrador'), 'default_password');
    await expect400('predeterminada en mayúsculas', trio(PW.MED, 'ChibaletePlus'), 'default_password');
    await expect400('formato bcrypt aportado por el cliente', trio(PW.MED, '$2b$10$abcdefghijklmnopqrstuv'), 'hash_not_allowed');
    await expect400('más de 72 bytes', trio(PW.MED, 'Larga-'.repeat(13)), 'too_long');
    await expect400('reutilizar la actual', trio(PW.MED, PW.MED), 'password_reused');
    const rdrSelf = await loginCookie(A, 'lectora.larga@x.test', PW.RDR);
    const rEmail = await call(A, rdrSelf, trio(PW.RDR, 'lectora.larga'));
    ok('igual a la parte local del email → 400 matches_email', rEmail.status === 400 && rEmail.json.code === 'matches_email');
    ok('ningún rechazo escribió el registro de MED', JSON.stringify(userById('MED')) === medBefore);
    ok('la sesión de MED sigue viva tras los rechazos', (await me(A, med)) === 200);

    console.log('\n[2][3][4] mediador: cambio, revocación entre réplicas, bcrypt');
    const medOnB = await loginCookie(B, 'med@x.test', PW.MED);
    ok('MED con sesión en ambas réplicas', (await me(A, med)) === 200 && (await me(B, medOnB)) === 200);
    const rMed = await call(A, med, trio(PW.MED, NEW.MED));
    ok('cambio → 200 {success, reauthRequired}', rMed.status === 200 && rMed.json.success === true && rMed.json.reauthRequired === true, rMed.txt);
    ok('respuesta no-store', (rMed.headers.get('cache-control') || '').includes('no-store'));
    ok('la respuesta borra la cookie de sesión', /chp_session=;/.test(rMed.headers.get('set-cookie') || ''));
    const medAfter = userById('MED');
    ok('credentialVersion 3 → 4', medAfter.credentialVersion === 4);
    ok('hash bcrypt del servidor que valida la nueva', isServerBcrypt(medAfter.password) && bcrypt.compareSync(NEW.MED, medAfter.password));
    ok('la anterior ya no valida contra el hash', !bcrypt.compareSync(PW.MED, medAfter.password));
    ok('sesión actual (réplica A) revocada', (await me(A, med)) === 401);
    ok('sesión de la réplica B revocada', (await me(B, medOnB)) === 401);
    ok('la cookie antigua tampoco sirve en la otra réplica', (await me(B, med)) === 401);
    ok('login con la anterior → 401 en A y B', (await login(A, 'med@x.test', PW.MED)).status === 401 && (await login(B, 'med@x.test', PW.MED)).status === 401);
    const medNew = await loginCookie(B, 'med@x.test', NEW.MED);
    ok('login con la nueva → sesión válida en ambas réplicas', !!medNew && (await me(A, medNew)) === 200 && (await me(B, medNew)) === 200);
    ok('[8] mediador: id, rol, especialidad, email y colegio intactos', keep(medAfter) === keep(JSON.parse(medBefore)));

    console.log('\n[2][6][8] lectora: cambio propio, nunca de un tercero');
    const rdr2Before = JSON.stringify(userById('RDR2')); const accessSha = sha(P.access); const groupsBefore = fs.readFileSync(P.groups, 'utf8');
    const rRdr = await call(B, rdrSelf, { ...trio(PW.RDR, NEW.RDR), userId: 'RDR2', id: 'RDR2', email: 'rdr2@x.test' });
    ok('lectora → 200 (cambio vía la otra réplica)', rRdr.status === 200, rRdr.txt);
    const rdrAfter = userById('RDR');
    ok('cambió SU contraseña', bcrypt.compareSync(NEW.RDR, rdrAfter.password) && (rdrAfter.credentialVersion | 0) === 1);
    ok('RDR2 (id/email en el cuerpo) intacta byte a byte', JSON.stringify(userById('RDR2')) === rdr2Before);
    ok('la sesión de RDR2 no se tocó', (await me(A, rdr2)) === 200);
    ok('[8] id, roles, email, colegio, grupos y perfil intactos', keep(rdrAfter) === keep(rdrBefore));
    ok('[8] grupo y reglas de acceso intactos', fs.readFileSync(P.groups, 'utf8') === groupsBefore && sha(P.access) === accessSha);
    ok('el reset pendiente queda anulado', !('resetToken' in rdrAfter) && !('resetExpiresAt' in rdrAfter));
    const rc = await fetch(`${A}/api/auth/reset-confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: RESET_TOKEN, password: 'Toma-Control-Reset-9' }) });
    ok('el token de reset anterior ya no sirve → 404', rc.status === 404 && bcrypt.compareSync(NEW.RDR, userById('RDR').password));

    console.log('\n[2][7] administradores, incluida la principal protegida');
    const adm = await loginCookie(A, 'adm@x.test', PW.ADM);
    ok('administrador → 200', (await call(A, adm, trio(PW.ADM, NEW.ADM))).status === 200 && bcrypt.compareSync(NEW.ADM, userById('ADM').password));
    const prinBefore = userById('PRIN');
    const prin = await loginCookie(B, 'admin@chibaleteeditores.com', PW.PRIN);
    const prinOnA = await loginCookie(A, 'admin@chibaleteeditores.com', PW.PRIN);
    const rPrin = await call(B, prin, trio(PW.PRIN, NEW.PRIN));
    ok('principal → 200 por este flujo', rPrin.status === 200, rPrin.txt);
    const prinAfter = userById('PRIN');
    ok('principal: activa, administradora, mismo email', prinAfter.accountStatus === 'active' && prinAfter.roles.includes('administrador') && prinAfter.email === prinBefore.email);
    ok('principal: credentialVersion +1 y sesiones en A y B revocadas', (prinAfter.credentialVersion | 0) === (prinBefore.credentialVersion | 0) + 1 && (await me(B, prin)) === 401 && (await me(A, prinOnA)) === 401);
    ok('principal: la anterior falla y la nueva entra', (await login(A, 'admin@chibaleteeditores.com', PW.PRIN)).status === 401 && (await login(A, 'admin@chibaleteeditores.com', NEW.PRIN)).status === 200);
    ok('principal: resto del registro intacto', keep(prinAfter) === keep(prinBefore));

    console.log('\n[9] tope de intentos fallidos por cuenta');
    const lim = await loginCookie(A, 'lim@x.test', PW.LIM);
    const fails = [];
    for (let i = 0; i < 10; i++) fails.push((await call(A, lim, trio('Mala-Clave-000' + i, 'Lim-Nueva-Segura-46'))).status);
    ok('10 contraseñas actuales incorrectas → 400', fails.every(s => s === 400), JSON.stringify(fails));
    const blocked = await call(A, lim, trio(PW.LIM, 'Lim-Nueva-Segura-46'));
    ok('el intento 11, aun correcto, → 429', blocked.status === 429, `${blocked.status}`);
    ok('la cuenta bloqueada no cambió', bcrypt.compareSync(PW.LIM, userById('LIM').password));
    ok('el tope es por cuenta: otra cuenta no está bloqueada', (await call(A, await loginCookie(A, 'xa@x.test', PW.XA), trio('Mala-Clave-xa-01', NEW.XA))).status === 400);

    console.log('\n[10] concurrencia');
    const con = await loginCookie(A, 'con@x.test', PW.CON);
    const cvBefore = userById('CON').credentialVersion | 0;
    const [c1, c2] = await Promise.all([call(A, con, trio(PW.CON, NEW.CON1)), call(B, con, trio(PW.CON, NEW.CON2))]);
    const statuses = [c1.status, c2.status].sort();
    ok('mismo usuario, dos réplicas a la vez → exactamente un 200', statuses.filter(s => s === 200).length === 1 && statuses.every(s => [200, 401, 409].includes(s)), JSON.stringify(statuses));
    const winner = c1.status === 200 ? NEW.CON1 : NEW.CON2; const loser = c1.status === 200 ? NEW.CON2 : NEW.CON1;
    const conAfter = userById('CON');
    ok('queda la contraseña ganadora y la perdedora no vale', bcrypt.compareSync(winner, conAfter.password) && !bcrypt.compareSync(loser, conAfter.password));
    ok('credentialVersion sube exactamente 1', (conAfter.credentialVersion | 0) === cvBefore + 1);
    const xa = await loginCookie(A, 'xa@x.test', PW.XA); const xb = await loginCookie(B, 'xb@x.test', PW.XB);
    const [ra, rb] = await Promise.all([call(A, xa, trio(PW.XA, NEW.XA)), call(B, xb, trio(PW.XB, NEW.XB))]);
    ok('dos usuarios en réplicas distintas a la vez → ambos 200', ra.status === 200 && rb.status === 200);
    ok('ninguna escritura se pierde', bcrypt.compareSync(NEW.XA, userById('XA').password) && bcrypt.compareSync(NEW.XB, userById('XB').password));
    const final = readUsers();
    ok('store = JSON array válido con todos los registros', Array.isArray(final) && final.length === fixtures.length);

    console.log('\n[12] CSRF y regresiones');
    const rdr2b = await loginCookie(A, 'rdr2@x.test', PW.RDR2);
    const post = (headers) => fetch(`${A}/api/auth/change-password`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: rdr2b, ...headers }, body: JSON.stringify(trio(PW.RDR2, 'Rdr2-Nueva-Segura-35')) });
    const noOrigin = await post({});
    ok('cookie sin Origin ni Sec-Fetch-Site → 403 (guard CSRF)', noOrigin.status === 403, `${noOrigin.status}`);
    const foreign = await post({ origin: 'https://evil.example' });
    ok('cookie desde un origen ajeno → rechazada (CORS)', foreign.status >= 400, `${foreign.status}`);
    ok('ninguno de los dos cambió la contraseña', bcrypt.compareSync(PW.RDR2, userById('RDR2').password));
    ok('login de un tercero no afectado sigue funcionando', (await login(B, 'rdr2@x.test', PW.RDR2)).status === 200);
    const rr = await fetch(`${A}/api/auth/reset-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rdr2@x.test' }) });
    ok('reset-request sigue respondiendo igual (200/202)', [200, 202].includes(rr.status), `${rr.status}`);
    ok('logout sigue funcionando', (await fetch(`${A}/api/auth/logout`, { method: 'POST', headers: { cookie: rdr2b, 'sec-fetch-site': 'same-origin' } })).status === 200 && (await me(A, rdr2b)) === 401);

    console.log('\n[11] ningún secreto en respuestas, logs ni auditoría');
    await sleep(500); // la auditoría se escribe async
    const auditTxt = fs.existsSync(P.audit) ? fs.readFileSync(P.audit, 'utf8') : '[]';
    const audit = JSON.parse(auditTxt);
    const own = audit.filter(e => e.action === 'change_own_password');
    ok('auditoría: un change_own_password por cambio aceptado (7)', own.length === 7, `n=${own.length}`);
    ok('auditoría: actor = titular, sin detalles', own.every(e => e.actor === e.targetUserId && JSON.stringify(e.details) === '{}'));
    const secrets = [...Object.values(PW), ...Object.values(NEW), RESET_TOKEN, 'Toma-Control-Reset-9', 'Lim-Nueva-Segura-46', 'Rdr2-Nueva-Segura-35'];
    const hashes = readUsers().map(u => u.password).filter(Boolean);
    const leak = (txt) => secrets.some(s => txt.includes(s)) || hashes.some(h => txt.includes(h)) || /\$2[aby]\$/.test(txt);
    ok('respuestas del endpoint sin contraseñas, hashes ni tokens', !bodies.some(leak));
    ok('auditoría sin contraseñas, hashes ni tokens', !leak(auditTxt));
    ok('log de ambas réplicas sin contraseñas, hashes ni tokens', !leak(serverLog));
}

main().then(() => {
    console.log(`\nselfPasswordChange — ${pass} ✓, ${fail} ✗`);
    for (const c of children) { try { c.kill('SIGKILL'); } catch {} }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.error(serverLog.slice(-2500)); for (const c of children) { try { c.kill('SIGKILL'); } catch {} } process.exit(1); });
