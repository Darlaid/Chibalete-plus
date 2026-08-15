/**
 * sessionIdentityIntegration.test.mjs — CHP-IDDB-M1-A-SESSION-IDENTITY-01.
 *
 * Server REAL en modo compat/enforce con clave file-only 0400 + sessions.db
 * compartida por dos instancias. Matriz de seguridad, two-instance, CSRF,
 * RMW de credentialVersion, fail-closed.
 *
 * POSIX-only: el lector de secretos exige semántica POSIX (0400 + uid match);
 * en Windows se salta (mismo criterio que otras suites de identidad).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

if (process.platform === 'win32') {
    console.log('sessionIdentityIntegration: SKIP (POSIX-only: secret file 0400/uid)');
    process.exit(0);
}

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_sessint_'));
const P = {
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'), progress: path.join(tmp, 'progress_db.json'),
    identity: path.join(tmp, 'identity.db'), uploads: path.join(tmp, 'uploads'),
    offline: path.join(tmp, 'offline.db'), sessions: path.join(tmp, 'sessions.db'),
    key: path.join(tmp, 'session_signing_key'),
};
fs.mkdirSync(P.uploads, { recursive: true });

const ADMIN_PW = 'fixture-admin-pass', READER_PW = 'fixture-reader-pass', DIS_PW = 'fixture-dis-pass';
const users = [
    { id: 'ADM', email: 'adm@fx.test', password: bcrypt.hashSync(ADMIN_PW, 4), roles: ['administrador'], accountStatus: 'active' },
    { id: 'RDR', email: 'rdr@fx.test', password: bcrypt.hashSync(READER_PW, 4), roles: ['lector'], accountStatus: 'active' },
    { id: 'DIS', email: 'dis@fx.test', password: bcrypt.hashSync(DIS_PW, 4), roles: ['lector'], accountStatus: 'disabled' },
];
fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify([], null, 2));
fs.writeFileSync(P.schools, JSON.stringify([], null, 2));
fs.writeFileSync(P.access, JSON.stringify([], null, 2));
fs.writeFileSync(P.content, JSON.stringify([{ id: 't1', title: 'T' }], null, 2));
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));
// Clave de firma 0400 (uid del runner).
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);

function spawnApi(port, mode) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: path.join(tmp, 'data'),
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
            SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
            SESSION_AUTH_MODE: mode, SESSION_ALLOWED_ORIGINS: 'https://app.test',
            // CORS comparte la misma allowlist; un origen ajeno lo corta CORS
            // ANTES del guard CSRF (defensa en capas).
            ALLOWED_ORIGINS: 'https://app.test',
        },
    });
    let bootLog = '';
    child.stdout.on('data', d => { bootLog += d; });
    child.stderr.on('data', d => { bootLog += d; });
    child._boot = () => bootLog;
    return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-1500)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
        await sleep(400);
    }
    throw new Error(`never healthy\n${child._boot().slice(-1500)}`);
}
const setCookie = (res) => {
    const raw = res.headers.get('set-cookie') || '';
    const m = raw.match(/chp_session=([^;]+)/);
    return m ? `chp_session=${m[1]}` : null;
};
const login = (base, email, password) => fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
});

const PORT1 = 4700 + (process.pid % 150), PORT2 = PORT1 + 1;
const b1 = `http://127.0.0.1:${PORT1}`, b2 = `http://127.0.0.1:${PORT2}`;
let api1, api2;

async function main() {
    // ── Two-instance: compat en ambas, sessions.db + key compartidas ──
    api1 = spawnApi(PORT1, 'compat');
    api2 = spawnApi(PORT2, 'compat');
    await waitHealthy(b1, api1);
    await waitHealthy(b2, api2);

    console.log('\n[A] Login emite cookie; /auth/me la resuelve');
    const lr = await login(b1, 'rdr@fx.test', READER_PW);
    ok('login real 200', lr.status === 200);
    const cookie = setCookie(lr);
    ok('Set-Cookie chp_session presente + HttpOnly', !!cookie && /HttpOnly/i.test(lr.headers.get('set-cookie')));
    ok('cookie SameSite=Strict', /SameSite=Strict/i.test(lr.headers.get('set-cookie')));
    const me1 = await fetch(`${b1}/api/auth/me`, { headers: { cookie } });
    ok('/auth/me con cookie → 200 y user correcto', me1.status === 200 && (await me1.json()).id === 'RDR');
    ok('/auth/me sin cookie → 401', (await fetch(`${b1}/api/auth/me`)).status === 401);

    console.log('\n[B] Matriz de seguridad');
    ok('cookie manipulada → 401', (await fetch(`${b1}/api/auth/me`, { headers: { cookie: cookie.slice(0, -2) + 'zz' } })).status === 401);
    ok('login disabled → 401', (await login(b1, 'dis@fx.test', DIS_PW)).status === 401);
    ok('sesión + x-user-id distinto → 401 (subject_mismatch)',
        (await fetch(`${b1}/api/auth/me`, { headers: { cookie, 'x-user-id': 'ADM' } })).status === 401);
    ok('sesión + x-user-id igual → 200',
        (await fetch(`${b1}/api/auth/me`, { headers: { cookie, 'x-user-id': 'RDR' } })).status === 200);
    ok('solo x-user-id legacy (compat) → 200', (await fetch(`${b1}/api/auth/me`, { headers: { 'x-user-id': 'RDR' } })).status === 200);
    ok('lector NO admin: PUT users via sesión lector → 401/403',
        [401, 403].includes((await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{}' })).status));

    console.log('\n[C] Two-instance: cookie de api_1 vale en api_2; revocación cruzada');
    ok('cookie de api_1 válida en api_2', (await fetch(`${b2}/api/auth/me`, { headers: { cookie } })).status === 200);
    // logout en api_2 revoca el sid → api_1 lo rechaza.
    const lo = await fetch(`${b2}/api/auth/logout`, { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin' } });
    ok('logout api_2 200', lo.status === 200);
    ok('tras logout, api_1 rechaza el sid (cross-instance) → 401', (await fetch(`${b1}/api/auth/me`, { headers: { cookie } })).status === 401);
    ok('cookie robada tras logout → 401', (await fetch(`${b2}/api/auth/me`, { headers: { cookie } })).status === 401);

    console.log('\n[D] logout-all + disable + reset invalidan (credentialVersion)');
    const lr2 = await login(b1, 'rdr@fx.test', READER_PW);
    const c2 = setCookie(lr2);
    const lr3 = await login(b2, 'rdr@fx.test', READER_PW); // segunda sesión, otra instancia
    const c3 = setCookie(lr3);
    ok('dos sesiones vivas', (await fetch(`${b1}/api/auth/me`, { headers: { cookie: c2 } })).status === 200
        && (await fetch(`${b2}/api/auth/me`, { headers: { cookie: c3 } })).status === 200);
    await fetch(`${b1}/api/auth/logout-all`, { method: 'POST', headers: { cookie: c2, 'sec-fetch-site': 'same-origin' } });
    ok('logout-all invalida AMBAS sesiones (cv++ global)',
        (await fetch(`${b1}/api/auth/me`, { headers: { cookie: c2 } })).status === 401
        && (await fetch(`${b2}/api/auth/me`, { headers: { cookie: c3 } })).status === 401);

    // disable con sesión viva (admin deshabilita a RDR).
    const la = await login(b1, 'adm@fx.test', ADMIN_PW);
    const ca = setCookie(la);
    const lr4 = await login(b1, 'rdr@fx.test', READER_PW);
    const c4 = setCookie(lr4);
    ok('RDR con sesión viva', (await fetch(`${b1}/api/auth/me`, { headers: { cookie: c4 } })).status === 200);
    const dis = await fetch(`${b1}/api/users/RDR`, {
        method: 'PUT', headers: { cookie: ca, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ accountStatus: 'disabled' }),
    });
    ok('admin deshabilita RDR (200)', dis.status === 200);
    ok('disable invalida la sesión viva de RDR → 401', (await fetch(`${b1}/api/auth/me`, { headers: { cookie: c4 } })).status === 401);
    // re-activar para el siguiente bloque
    await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie: ca, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ accountStatus: 'active' }) });

    console.log('\n[E] CSRF (guard propio) + CORS (capa externa)');
    const lr5 = await login(b1, 'adm@fx.test', ADMIN_PW);
    const c5 = setCookie(lr5);
    ok('POST cookie + Origin permitido → no CSRF-403',
        (await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie: c5, 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify({ nombre: 'x' }) })).status !== 403);
    ok('POST cookie + Sec-Fetch-Site same-origin → no CSRF-403',
        (await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie: c5, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ nombre: 'z' }) })).status !== 403);
    // Mi guard CSRF aísla el caso sin señales de mismo origen (CORS permite al no
    // haber Origin): escritura por cookie sin Origin ni Sec-Fetch-Site → 403.
    ok('POST cookie SIN Origin ni Sec-Fetch-Site → 403 CSRF',
        (await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie: c5, 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'w' }) })).status === 403);
    // Origen ajeno: CORS lo corta antes del guard (defensa en capas) → no-2xx.
    ok('POST cookie + Origin ajeno → bloqueado (CORS)',
        ![200, 201, 204].includes((await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie: c5, 'content-type': 'application/json', origin: 'https://evil.test' }, body: JSON.stringify({ nombre: 'y' }) })).status));
    ok('GET con cookie no requiere CSRF', (await fetch(`${b1}/api/auth/me`, { headers: { cookie: c5 } })).status === 200);

    console.log('\n[F] Active gap: progreso de cuenta deshabilitada → 401');
    // En 'off' el gap se cierra también; aquí en compat via sesión.
    const lr6 = await login(b1, 'rdr@fx.test', READER_PW);
    const c6 = setCookie(lr6);
    await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie: c5, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ accountStatus: 'disabled' }) });
    const prog = await fetch(`${b1}/api/progress/RDR/t1/sync`, { method: 'POST', headers: { cookie: c6, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({}) });
    ok('progreso con sesión de cuenta deshabilitada → 401', prog.status === 401);
    await fetch(`${b1}/api/users/RDR`, { method: 'PUT', headers: { cookie: c5, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ accountStatus: 'active' }) });

    console.log('\n[G] credentialVersion RMW: 3 usuarios preservados, credenciales intactas');
    const padron = JSON.parse(fs.readFileSync(P.users, 'utf8'));
    ok('padrón sigue con 3 usuarios', padron.length === 3);
    ok('todos conservan password (credenciales JSON intactas)', padron.every(u => typeof u.password === 'string' && u.password.startsWith('$2')));
    ok('RDR credentialVersion incrementado por los eventos', (padron.find(u => u.id === 'RDR').credentialVersion | 0) >= 1);
    ok('ADM credentialVersion 0 (sin eventos de credencial)', (padron.find(u => u.id === 'ADM').credentialVersion | 0) === 0);

    console.log('\n[H] enforce: x-user-id externo rechazado, cookie válida aceptada');
    api2.kill('SIGKILL');
    await sleep(300);
    api2 = spawnApi(PORT2, 'enforce');
    await waitHealthy(b2, api2);
    const lr7 = await login(b2, 'adm@fx.test', ADMIN_PW);
    const c7 = setCookie(lr7);
    ok('enforce: solo x-user-id externo → 401', (await fetch(`${b2}/api/auth/me`, { headers: { 'x-user-id': 'ADM' } })).status === 401);
    ok('enforce: cookie válida → 200', (await fetch(`${b2}/api/auth/me`, { headers: { cookie: c7 } })).status === 200);

    console.log('\n[I] fail-closed: store de sesiones no disponible');
    // Cerrar el server, corromper sessions.db, relanzar en compat: una request con
    // cookie debe fallar cerrada (no caer a x-user-id).
    api1.kill('SIGKILL'); await sleep(300);
    // corromper: sustituir por un directorio para forzar apertura fallida
    try { fs.rmSync(P.sessions, { force: true }); } catch {}
    try { fs.rmSync(`${P.sessions}-wal`, { force: true }); fs.rmSync(`${P.sessions}-shm`, { force: true }); } catch {}
    fs.mkdirSync(P.sessions); // ahora getSessionsDb() lanzará (no es archivo)
    api1 = spawnApi(PORT1, 'compat');
    await waitHealthy(b1, api1);
    const failClosed = await fetch(`${b1}/api/auth/me`, { headers: { cookie: c7 } });
    ok('sessions.db inaccesible + cookie → NO 200 (fail-closed)', failClosed.status !== 200);
    ok('fail-closed NO cae a x-user-id (401/503)', [401, 503].includes(failClosed.status));

    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
}

main()
    .then(() => { try { api1?.kill('SIGKILL'); api2?.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); try { api1?.kill('SIGKILL'); api2?.kill('SIGKILL'); } catch {} process.exit(1); });
