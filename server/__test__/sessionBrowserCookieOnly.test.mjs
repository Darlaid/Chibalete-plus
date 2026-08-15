/**
 * sessionBrowserCookieOnly.test.mjs — CHP-IDDB-M1-A-...-DEPLOY-REHEARSAL-01-R1.
 * Prueba que los flujos de producto funcionan SOLO con la cookie de sesión
 * (sin x-user-id), en compat y enforce, incluido el preflight de acceso y las
 * rutas gateadas por middleware/handler que antes leían x-user-id. POSIX-only.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
if (process.platform === 'win32') { console.log('sessionBrowserCookieOnly: SKIP (POSIX-only)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_cookieonly_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json', progress: tmp + '/p.json', identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key' };
fs.mkdirSync(P.uploads, { recursive: true });
const PW = 'pw';
fs.writeFileSync(P.users, JSON.stringify([{ id: 'RDR', email: 'r@x', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active' }]));
fs.writeFileSync(P.groups, '[]'); fs.writeFileSync(P.schools, '[]');
fs.writeFileSync(P.access, JSON.stringify([{ id: 'rule-rdr', scope: 'user', scopeId: 'RDR', titleIds: ['t1'], collectionIds: [], expiresAt: null }]));
fs.writeFileSync(P.content, JSON.stringify([{ id: 't1', title: 'T' }]));
fs.writeFileSync(P.progress, '{"progressMap":{}}');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const PORT = 4420 + (process.pid % 90); const base = `http://127.0.0.1:${PORT}`;
let child;
function spawnApi(mode) {
    const c = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_DATA_DIR: tmp + '/data',
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
        CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
        USER_AUDIT_DB: tmp + '/au.json', IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
        INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        ACCESS_FALLBACK_MODE: 'open', SESSION_AUTH_MODE: mode,
    } });
    let boot = ''; c.stdout.on('data', d => boot += d); c.stderr.on('data', d => boot += d); c._boot = () => boot; return c;
}
async function waitHealthy(c) { for (let i = 0; i < 150; i++) { if (c.exitCode !== null) throw new Error('rc\n' + c._boot().slice(-1000)); try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await sleep(400); } throw new Error('never healthy\n' + c._boot().slice(-1000)); }
const setCookie = (r) => { const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
const login = () => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'r@x', password: PW }) });
const restart = async (m) => { if (child) { child.kill('SIGKILL'); await sleep(300); } child = spawnApi(m); await waitHealthy(child); };

async function main() {
    // ── COMPAT: todo cookie-only, SIN x-user-id ──
    await restart('compat');
    const lr = await login(); const cookie = setCookie(lr);
    ok('login → cookie', lr.status === 200 && !!cookie);
    console.log('\n[COMPAT cookie-only, sin x-user-id]');
    ok('/auth/me 200', (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status === 200);
    ok('/api/users 200', (await fetch(`${base}/api/users`, { headers: { cookie } })).status === 200);
    ok('/api/groups 200', (await fetch(`${base}/api/groups`, { headers: { cookie } })).status === 200);
    ok('/api/content/:id/access (preflight) allowed cookie-only',
        (await fetch(`${base}/api/content/t1/access?userId=RDR`, { headers: { cookie } })).status === 200);
    ok('/api/content/my-catalog 200', (await fetch(`${base}/api/content/my-catalog`, { headers: { cookie } })).status === 200);
    // Preflight sin cookie ni x-user-id → 401 (no autofabricación por query).
    ok('preflight sin identidad → 401', (await fetch(`${base}/api/content/t1/access?userId=RDR`)).status === 401);
    // Preflight con query de OTRO userId (cookie=RDR) → 401 (anti-spoof por sesión).
    ok('preflight query userId != sesion → 401', (await fetch(`${base}/api/content/t1/access?userId=OTHER`, { headers: { cookie } })).status === 401);

    // ── ENFORCE: cookie-only works; external x-user-id-only rejected ──
    await restart('enforce');
    const lr2 = await login(); const c2 = setCookie(lr2);
    console.log('\n[ENFORCE]');
    ok('enforce: /auth/me cookie-only 200', (await fetch(`${base}/api/auth/me`, { headers: { cookie: c2 } })).status === 200);
    ok('enforce: preflight cookie-only 200', (await fetch(`${base}/api/content/t1/access?userId=RDR`, { headers: { cookie: c2 } })).status === 200);
    ok('enforce: solo x-user-id externo → 401 (/auth/me)', (await fetch(`${base}/api/auth/me`, { headers: { 'x-user-id': 'RDR' } })).status === 401);
    ok('enforce: preflight solo x-user-id externo → 401', (await fetch(`${base}/api/content/t1/access?userId=RDR`, { headers: { 'x-user-id': 'RDR' } })).status === 401);
    ok('enforce: cookie + x-user-id mismatch → 401', (await fetch(`${base}/api/auth/me`, { headers: { cookie: c2, 'x-user-id': 'OTHER' } })).status === 401);

    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
}
main().then(() => { try { child?.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); try { child?.kill('SIGKILL'); } catch {} process.exit(1); });
