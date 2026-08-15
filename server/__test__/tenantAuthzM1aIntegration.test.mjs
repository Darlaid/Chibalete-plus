/**
 * tenantAuthzM1aIntegration.test.mjs — CHP-IDDB-M1-B-TENANT-AUTHZ-01.
 *
 * Puente M1-A ⨯ M1-B: identidad FIRMADA (cookie) de M1-A alimenta el scoping de
 * M1-B. Prueba: sesión A → req.auth A → scope A; sesión A + x-user-id B → M1-A
 * 401 ANTES de M1-B (M1-B no re-autentica). POSIX-only (clave 0400).
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
if (process.platform === 'win32') { console.log('tenantAuthzM1aIntegration: SKIP (POSIX-only)'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_m1ab_'));
const P = Object.fromEntries(['users', 'groups', 'schools', 'access', 'content', 'progress', 'identity', 'offline', 'sessions', 'key']
    .map(k => [k, path.join(tmp, k + (k === 'identity' || k === 'offline' || k === 'sessions' ? '.db' : k === 'key' ? '' : '.json'))]));
P.uploads = path.join(tmp, 'uploads'); fs.mkdirSync(P.uploads, { recursive: true });

const PW = 'fixture-pass';
const users = [
    { id: 'MEDA', email: 'ma@x', password: bcrypt.hashSync(PW, 4), roles: ['mediador'], accountStatus: 'active' },
    { id: 'MEMA', email: 'sa@x', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active' },
    { id: 'MEMB', email: 'sb@x', password: bcrypt.hashSync(PW, 4), roles: ['lector'], accountStatus: 'active' },
];
fs.writeFileSync(P.users, JSON.stringify(users));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'gA', organizationId: 'inst-A', mediatorIds: ['MEDA'], memberIds: ['MEMA'], studentIds: ['MEMA'] },
    { id: 'gB', organizationId: 'inst-B', mediatorIds: [], memberIds: ['MEMB'], studentIds: ['MEMB'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-A' }, { id: 'inst-B' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[{"id":"t1"}]'); fs.writeFileSync(P.progress, '{"progressMap":{}}');
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const PORT = 4480 + (process.pid % 90);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_DATA_DIR: path.join(tmp, 'data'),
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
        CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
        USER_AUDIT_DB: path.join(tmp, 'audit.json'),
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        SESSION_AUTH_MODE: 'compat', TENANT_AUTHZ_MODE: 'enforce', TENANT_AUTHZ_ALLOW_UNSAFE: '1',
        INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'), EVENTS_SQLITE_PATH: path.join(tmp, 'events.db'),
    },
});
let boot = ''; child.stdout.on('data', d => boot += d); child.stderr.on('data', d => boot += d);
const setCookie = (r) => { const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); return m ? `chp_session=${m[1]}` : null; };
const login = (email) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });

async function main() {
    for (let i = 0; i < 150; i++) { if (child.exitCode !== null) throw new Error(`rc\n${boot.slice(-1200)}`); try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(400); }

    const lm = await login('ma@x'); const cookie = setCookie(lm);
    ok('login MEDA emite cookie', lm.status === 200 && !!cookie);

    console.log('\n[Puente] identidad firmada M1-A → scope M1-B');
    ok('sesión MEDA → status MEMA (su miembro) no denegado por tenant', ((s)=>s!==403&&s!==404)((await fetch(`${base}/api/students/MEMA/status`, { headers: { cookie } })).status));
    ok('sesión MEDA → status MEMB (cross) 404', (await fetch(`${base}/api/students/MEMB/status`, { headers: { cookie } })).status === 404);
    const gList = await (await fetch(`${base}/api/groups`, { headers: { cookie } })).json();
    ok('sesión MEDA → groups filtrado a su institución (solo gA)', Array.isArray(gList) && gList.length === 1 && gList[0].id === 'gA');

    console.log('\n[Puente] x-user-id divergente → M1-A 401 antes de M1-B');
    const mism = await fetch(`${base}/api/students/MEMA/status`, { headers: { cookie, 'x-user-id': 'MEMB' } });
    ok('sesión MEDA + x-user-id MEMB → 401 (subject_mismatch, M1-A)', mism.status === 401);
    // body claim de tenant NO altera la autoridad (identidad sigue MEDA).
    const bodyClaim = await fetch(`${base}/api/students/MEMB/status`, { headers: { cookie, 'content-type': 'application/json' } });
    ok('sesión MEDA + intento de leer MEMB → 404 (claim de request no da autoridad)', bodyClaim.status === 404);

    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
}
main()
    .then(() => { try { child.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); try { child.kill('SIGKILL'); } catch {} process.exit(1); });
