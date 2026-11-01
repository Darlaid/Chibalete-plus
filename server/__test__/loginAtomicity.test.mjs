/**
 * loginAtomicity.test.mjs — SEC-AUTH-ATOMIC-01.
 *
 * Dos server.js reales sobre el mismo padrón sintético, en SESSION_AUTH_MODE=enforce.
 * Un login tarda lo que tarda bcrypt: durante ese tiempo otra réplica puede cambiar
 * la cuenta. Demuestra que el login no corrompe el padrón, no pierde escrituras y
 * no restaura estado, credenciales ni roles antiguos:
 *   [1] logins legacy concurrentes, con migración de hash
 *   [2] logins bcrypt simultáneos
 *   [3] login concurrente con desactivación, de la cuenta y de otra cuenta
 *   [4] login concurrente con cambio de contraseña
 *   [5] login concurrente con cambio de roles
 *   [6] contrato HTTP, temporales y locks
 * POSIX-only: la clave de sesión se lee con el lector fail-closed POSIX.
 *
 *   node server/__test__/loginAtomicity.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { freePort } from './helpers/freePort.mjs';

if (process.platform === 'win32') { console.log('loginAtomicity: SKIP (POSIX-only)'); process.exit(0); }

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_loginatomic_'));
const USERS = path.join(tmp, 'users.json');
const key = path.join(tmp, 'session_signing_key');

// Contraseñas sintéticas de fixture. Coste 10, el del servidor: abre la ventana real.
const PW = 'Fixture-sintetica-71!';
const NEW_PW = 'Fixture-renovada-93!';
const HASH = bcrypt.hashSync(PW, 10);
const account = (id, roles = ['lector'], password = HASH) => ({ id, email: `${id.toLowerCase()}@x.test`, nombre_completo: id, password, roles, accountStatus: 'active' });
const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const LEGACY = ids('L', 30), PARALLEL_LEGACY = ids('PL', 8), BCRYPT = ids('B', 10), SAME = ids('D', 12), OTHER = ids('O', 12), VICTIM = ids('V', 12), PWD = ids('P', 6), ROLE = ids('R', 6);
const seed = [
    account('ADM', ['administrador']),
    ...[...LEGACY, ...PARALLEL_LEGACY, 'SL'].map((id) => account(id, ['lector'], PW)),
    ...[...BCRYPT, ...SAME, ...OTHER, ...VICTIM, ...PWD].map((id) => account(id)),
    ...ROLE.map((id) => account(id, ['mediador'])),
];
fs.writeFileSync(USERS, JSON.stringify(seed, null, 2));
for (const f of ['g', 's', 'a', 'c']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');
fs.writeFileSync(key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(key, 0o400);

const ports = await Promise.all([freePort(), freePort()]);
const [A, B] = ports.map((p) => `http://127.0.0.1:${p}`);
const env = {
    ...process.env, NODE_ENV: 'test', CHP_DATA_DIR: path.join(tmp, 'data'), USERS_DB: USERS,
    GROUPS_DB: path.join(tmp, 'g.json'), SCHOOLS_DB: path.join(tmp, 's.json'), ACCESS_DB: path.join(tmp, 'a.json'), CONTENT_DB: path.join(tmp, 'c.json'),
    UPLOADS_ROOT: path.join(tmp, 'up'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'o.db'), USER_AUDIT_DB: path.join(tmp, 'audit.json'),
    IDENTITY_DB: path.join(tmp, 'i.db'), IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
    INSIGHTS_SQLITE_PATH: path.join(tmp, 'in.db'), EVENTS_SQLITE_PATH: path.join(tmp, 'e.db'), PROGRESS_SQLITE_PATH: path.join(tmp, 'p.db'),
    SESSIONS_DB: path.join(tmp, 'se.db'), SESSION_KEY_CURRENT_PATH: key, ACCESS_FALLBACK_MODE: 'open', SESSION_AUTH_MODE: 'enforce',
};
let logs = '';
const children = ports.map((port) => {
    const c = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: { ...env, PORT: String(port) } });
    c.stdout.on('data', (d) => { logs += d; });
    c.stderr.on('data', (d) => { logs += d; });
    return c;
});

const readUsers = () => JSON.parse(fs.readFileSync(USERS, 'utf8'));
const user = (id) => readUsers().find((u) => u.id === id);
const emailOf = (id) => `${id.toLowerCase()}@x.test`;
const login = async (base, id, password = PW) => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: emailOf(id), password }) });
    const body = await r.json().catch(() => null);
    return { status: r.status, body, cookie: (r.headers.get('set-cookie') || '').match(/chp_session=[^;]+/)?.[0] ?? null };
};
const send = async (base, method, url, cookie, body) => {
    const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
};
const me = async (base, cookie) => (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status;
const rejectedEverywhere = async (cookie) => (await me(A, cookie)) === 401 && (await me(B, cookie)) === 401;

async function main() {
    for (const base of [A, B]) {
        for (let i = 0; ; i++) {
            try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* arrancando */ }
            if (i > 200) throw new Error(`no arrancó\n${logs.slice(-1500)}`);
            await sleep(150);
        }
    }
    const admin = (await login(A, 'ADM')).cookie;
    ok('admin con sesión', !!admin);

    console.log('\n[1] logins legacy');
    let invalid = 0;
    for (const id of LEGACY) {
        const r = await login(A, id);
        try { readUsers(); } catch { invalid++; }
        if (r.status !== 200) invalid++;
    }
    ok('30 logins legacy: JSON válido tras cada uno', invalid === 0, String(invalid));
    ok('cada cuenta migró a bcrypt y conserva lastLoginAt', LEGACY.every((id) => user(id).password.startsWith('$2') && user(id).lastLoginAt));
    const parallelLegacy = await Promise.all(PARALLEL_LEGACY.map((id, i) => login(i % 2 ? A : B, id)));
    ok('legacy en paralelo en dos réplicas: todas entran', parallelLegacy.every((r) => r.status === 200), JSON.stringify(parallelLegacy.map((r) => r.status)));
    ok('legacy en paralelo: ninguna migración perdida', PARALLEL_LEGACY.every((id) => bcrypt.compareSync(PW, user(id).password) && user(id).lastLoginAt));
    const same = await Promise.all([login(A, 'SL'), login(B, 'SL')]);
    ok('misma cuenta legacy en dos réplicas: entra al menos una', same.some((r) => r.status === 200), JSON.stringify(same.map((r) => r.status)));
    ok('misma cuenta legacy: hash válido', bcrypt.compareSync(PW, user('SL').password));

    console.log('\n[2] logins bcrypt simultáneos');
    const bc = await Promise.all(BCRYPT.map((id, i) => login(i % 2 ? A : B, id)));
    ok('todas entran', bc.every((r) => r.status === 200), JSON.stringify(bc.map((r) => r.status)));
    ok('ningún lastLoginAt perdido', BCRYPT.every((id) => user(id).lastLoginAt));
    ok('las sesiones valen en ambas réplicas', (await Promise.all(bc.map(async (r) => (await me(A, r.cookie)) === 200 && (await me(B, r.cookie)) === 200))).every(Boolean));

    console.log('\n[3] login concurrente con desactivación');
    const rounds = await Promise.all(SAME.map(async (id) => {
        const [l, d] = await Promise.all([login(A, id), send(B, 'POST', `/api/users/${id}/disable`, admin)]);
        return { id, l, d };
    }));
    ok('misma cuenta: toda desactivación confirmada', rounds.every((r) => r.d.status === 200), JSON.stringify(rounds.map((r) => r.d.status)));
    ok('misma cuenta: ninguna revertida', SAME.every((id) => user(id).accountStatus === 'disabled'));
    ok('misma cuenta: la credencial no vuelve', SAME.every((id) => !('password' in user(id))));
    const blocked = (logs.match(/la cuenta cambió durante la verificación/g) ?? []).length;
    ok('la carrera ocurrió: logins rechazados por cambio de cuenta', blocked > 0, String(blocked));
    const granted = rounds.filter((r) => r.l.status === 200);
    ok('misma cuenta: una sesión emitida antes queda inválida', (await Promise.all(granted.map((r) => rejectedEverywhere(r.l.cookie)))).every(Boolean));
    ok('misma cuenta: rechazado sin sesión ni datos', rounds.filter((r) => r.l.status === 401).every((r) => !r.l.cookie && r.l.body?.error === 'Credenciales inválidas'));
    ok('misma cuenta: la contraseña ya no entra', (await Promise.all(SAME.slice(0, 4).map((id) => login(B, id)))).every((r) => r.status === 401));
    const other = await Promise.all(OTHER.map(async (id, i) => {
        const [, d] = await Promise.all([login(A, id), send(B, 'POST', `/api/users/${VICTIM[i]}/disable`, admin)]);
        return d.status;
    }));
    ok('otra cuenta: desactivaciones confirmadas', other.every((s) => s === 200), JSON.stringify(other));
    ok('otra cuenta: ninguna revertida por un login ajeno', VICTIM.every((id) => user(id).accountStatus === 'disabled' && !('password' in user(id))));
    ok('otra cuenta: los logins conservan lastLoginAt', OTHER.every((id) => user(id).lastLoginAt));

    console.log('\n[4] login concurrente con cambio de contraseña');
    const pwd = [];
    for (const [i, id] of PWD.entries()) {
        const own = (await login(B, id)).cookie;
        const change = send(B, 'POST', '/api/auth/change-password', own, { currentPassword: PW, newPassword: NEW_PW, confirmPassword: NEW_PW });
        await sleep(40 + i * 25); // Recorre la ventana entre la lectura del login y el cambio.
        const [c, l] = await Promise.all([change, login(A, id)]);
        pwd.push({ id, c, l });
    }
    ok('todos los cambios confirmados', pwd.every((r) => r.c.status === 200), JSON.stringify(pwd.map((r) => r.c.status)));
    ok('ninguna credencial antigua restaurada', PWD.every((id) => bcrypt.compareSync(NEW_PW, user(id).password) && !bcrypt.compareSync(PW, user(id).password)));
    ok('una sesión con la credencial antigua queda inválida', (await Promise.all(pwd.filter((r) => r.l.status === 200).map((r) => rejectedEverywhere(r.l.cookie)))).every(Boolean));
    ok('la contraseña anterior ya no entra', (await Promise.all(PWD.map((id) => login(A, id)))).every((r) => r.status === 401));
    ok('la nueva sí', (await login(B, PWD[0], NEW_PW)).status === 200);

    console.log('\n[5] login concurrente con cambio de roles');
    const role = await Promise.all(ROLE.map(async (id) => {
        const [l, p] = await Promise.all([login(A, id), send(B, 'PUT', `/api/users/${id}`, admin, { roles: ['lector'] })]);
        return { id, l, p };
    }));
    ok('todos los cambios confirmados', role.every((r) => r.p.status === 200), JSON.stringify(role.map((r) => r.p.status)));
    ok('ningún rol antiguo restaurado', ROLE.every((id) => JSON.stringify(user(id).roles) === '["lector"]'), JSON.stringify(ROLE.map((id) => user(id).roles)));

    console.log('\n[6] contrato, temporales y locks');
    const good = await login(B, BCRYPT[0]);
    ok('login: 200, cookie y usuario sin credenciales', good.status === 200 && !!good.cookie && good.body?.success === true && good.body?.user?.id === BCRYPT[0] && !('password' in good.body.user));
    const wrong = await login(B, BCRYPT[0], 'Otra-clave-sintetica-1!');
    ok('contraseña errónea: 401 genérico', wrong.status === 401 && wrong.body?.error === 'Credenciales inválidas' && !wrong.cookie);
    await sleep(100); // Deja cerrar la auditoría en segundo plano antes de inspeccionar el directorio.
    ok('padrón final válido', Array.isArray(readUsers()) && readUsers().length === seed.length);
    const leftovers = fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'));
    ok('sin temporales ni locks residuales', leftovers.length === 0, leftovers.join());
    ok('sin errores de escritura del padrón', !/write error|ENOENT[^\n]*\.tmp|CANONICAL_MUTATION_READ_FAILED|Error writing/.test(logs), (logs.match(/.*(write error|Error writing).*/) ?? [''])[0].slice(0, 200));
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    ok('ninguna escritura del padrón fuera del lock desde el login', !/writeJSONAsync\(USERS_DB/.test(src));
    ok('sin temporal de nombre fijo', !/`\$\{file\}\.tmp`/.test(src));
}

const stop = () => { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* ya terminó */ } } fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); };
main().then(() => {
    console.log(`\nloginAtomicity: ${pass} ✓, ${fail} ✗`);
    stop();
    process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.error(logs.slice(-1500)); stop(); process.exit(1); });
