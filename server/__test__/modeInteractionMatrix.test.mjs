/**
 * modeInteractionMatrix.test.mjs — CHP-IDDB-M1-B-INTEGRATION-REHEARSAL-01.
 * Matriz de interacción SESSION_AUTH_MODE × TENANT_AUTHZ_MODE sobre el árbol
 * integrado M1-A(final)+M1-B. Prueba combinaciones seguras y el guard de la
 * combinación inválida (tenant enforce sin session enforce) en producción.
 * POSIX-only (algunas combinaciones usan clave de sesión).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
if (process.platform === 'win32') { console.log('modeInteractionMatrix: SKIP (POSIX-only)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_modes_'));
const P = { users: tmp + '/u.json', groups: tmp + '/g.json', schools: tmp + '/s.json', access: tmp + '/a.json', content: tmp + '/c.json', progress: tmp + '/p.json', identity: tmp + '/i.db', uploads: tmp + '/up', offline: tmp + '/o.db', sessions: tmp + '/sess.db', key: tmp + '/key' };
fs.mkdirSync(P.uploads, { recursive: true });
const PW = 'pw';
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'MEDA', email: 'ma@x', password: bcrypt.hashSync(PW, 4), roles: ['mediador'], accountStatus: 'active' },
    { id: 'MEMA', email: 'sa@x', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active' },
    { id: 'MEMB', email: 'sb@x', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active' },
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'gA', organizationId: 'inst-A', mediatorIds: ['MEDA'], memberIds: ['MEMA'], studentIds: ['MEMA'] },
    { id: 'gB', organizationId: 'inst-B', mediatorIds: [], memberIds: ['MEMB'], studentIds: ['MEMB'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-A' }, { id: 'inst-B' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[{"id":"t1"}]'); fs.writeFileSync(P.progress, '{"progressMap":{}}');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const PORT = 4390 + (process.pid % 90); const base = `http://127.0.0.1:${PORT}`;
let child;
function spawnApi(sessionMode, tenantMode, { bypass = false } = {}) {
    const env = {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_DATA_DIR: tmp + '/data',
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
        UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: tmp + '/au.json',
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
        INSIGHTS_SQLITE_PATH: tmp + '/insights.db', EVENTS_SQLITE_PATH: tmp + '/events.db',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        SESSION_AUTH_MODE: sessionMode, TENANT_AUTHZ_MODE: tenantMode,
    };
    if (bypass) env.TENANT_AUTHZ_ALLOW_UNSAFE = '1'; else delete env.TENANT_AUTHZ_ALLOW_UNSAFE;
    const c = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env });
    let boot = ''; c.stdout.on('data', d => boot += d); c.stderr.on('data', d => boot += d); c._boot = () => boot; return c;
}
async function waitHealthy(c) { for (let i = 0; i < 150; i++) { if (c.exitCode !== null) return false; try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch {} await sleep(400); } return false; }
const setCookie = (r) => { const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
const login = (e) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: PW }) });
const restart = async (sm, tm, opts = {}) => { if (child) { child.kill('SIGKILL'); await sleep(300); } child = spawnApi(sm, tm, opts); return waitHealthy(child); };

async function main() {
    console.log('\n[Matriz session × tenant — combinaciones VÁLIDAS arrancan]');
    // El guard solo dispara con tenant=enforce ∧ session!=enforce. El resto es válido.
    ok('session off + tenant off → healthy', await restart('off', 'off'));
    ok('session compat + tenant off → healthy', await restart('compat', 'off'));
    ok('session enforce + tenant off → healthy', await restart('enforce', 'off'));
    ok('session compat + tenant shadow → healthy', await restart('compat', 'shadow'));
    ok('session enforce + tenant shadow → healthy', await restart('enforce', 'shadow'));
    ok('session enforce + tenant enforce (SEGURA) → healthy', await restart('enforce', 'enforce'));

    console.log('\n[session enforce + tenant enforce — aislamiento vivo]');
    { const lm = await login('ma@x'); const cookie = setCookie(lm);
      ok('MEDA cookie → status MEMA (su miembro) no-tenant-deny',
          ((s) => s !== 403 && s !== 404)((await fetch(`${base}/api/students/MEMA/status`, { headers: { cookie } })).status));
      ok('MEDA cookie → status MEMB (cross) 404', (await fetch(`${base}/api/students/MEMB/status`, { headers: { cookie } })).status === 404);
      ok('enforce sesión: solo x-user-id externo → 401', (await fetch(`${base}/api/students/MEMA/status`, { headers: { 'x-user-id': 'MEDA' } })).status === 401); }

    console.log('\n[Guard de combinación INVÁLIDA: tenant enforce ∧ session!=enforce]');
    // Sin bypass: fail-fast (no arranca).
    ok('tenant enforce + session off (sin bypass) → NO arranca (fail-fast)', (await restart('off', 'enforce')) === false);
    ok('el boot log declara MODE_GUARD', /MODE_GUARD/.test(child._boot()));
    ok('tenant enforce + session compat (sin bypass) → NO arranca (fail-fast)', (await restart('compat', 'enforce')) === false);
    // Con bypass explícito de test: arranca con WARN (permite tests de lógica).
    ok('tenant enforce + session off + bypass → arranca (warn)', await restart('off', 'enforce', { bypass: true }));

    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
}
main().then(() => { try { child?.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); try { child?.kill('SIGKILL'); } catch {} process.exit(1); });
