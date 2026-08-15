/**
 * tenantAuthzIntegration.test.mjs — CHP-IDDB-M1-B-TENANT-AUTHZ-01.
 *
 * Server REAL con instituciones A/B. Golden cross-tenant + escalation + modos
 * (off/shadow/enforce). Identidad de transición vía x-user-id (server.js la
 * resuelve a req.user; M1-B consume ese userId). Hermético cross-plataforma
 * (no requiere clave de sesión: M1-A en 'off').
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_tenant_'));
const P = {
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'), progress: path.join(tmp, 'progress_db.json'),
    identity: path.join(tmp, 'identity.db'), uploads: path.join(tmp, 'uploads'),
    offline: path.join(tmp, 'offline.db'),
};
fs.mkdirSync(P.uploads, { recursive: true });

// Institución A y B + global admin + unscoped + ambiguous.
const users = [
    { id: 'ADMG', email: 'adm@x', roles: ['administrador'], accountStatus: 'active' },
    { id: 'MEDA', email: 'ma@x', roles: ['mediador'], accountStatus: 'active' },
    { id: 'MEDB', email: 'mb@x', roles: ['mediador'], accountStatus: 'active' },
    { id: 'MEMA', email: 'sa@x', roles: ['lector'], accountStatus: 'active' },
    { id: 'MEMB', email: 'sb@x', roles: ['lector'], accountStatus: 'active' },
    { id: 'UNSC', email: 'un@x', roles: ['lector'], accountStatus: 'active' },
    { id: 'AMBI', email: 'am@x', roles: ['lector'], accountStatus: 'active', organizationId: 'inst-B' }, // membership A + org B
];
const groups = [
    { id: 'gA', name: 'A', type: 'course', organizationId: 'inst-A', mediatorIds: ['MEDA'], memberIds: ['MEMA', 'AMBI'], studentIds: ['MEMA', 'AMBI'] },
    { id: 'gB', name: 'B', type: 'course', organizationId: 'inst-B', mediatorIds: ['MEDB'], memberIds: ['MEMB'], studentIds: ['MEMB'] },
];
fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(groups, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-A', name: 'A' }, { id: 'inst-B', name: 'B' }], null, 2));
fs.writeFileSync(P.access, JSON.stringify([], null, 2));
fs.writeFileSync(P.content, JSON.stringify([{ id: 't1' }], null, 2));
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));

const PORT = 4550 + (process.pid % 120);
const base = `http://127.0.0.1:${PORT}`;
let child;

function spawnApi(mode) {
    const c = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_DATA_DIR: path.join(tmp, 'data'),
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access,
            CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
            USER_AUDIT_DB: path.join(tmp, 'audit.json'),
            IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json',
            SESSION_AUTH_MODE: 'off', TENANT_AUTHZ_MODE: mode,
        },
    });
    let boot = ''; c.stdout.on('data', d => boot += d); c.stderr.on('data', d => boot += d); c._boot = () => boot;
    return c;
}
async function waitHealthy(c) {
    for (let i = 0; i < 150; i++) {
        if (c.exitCode !== null) throw new Error(`rc=${c.exitCode}\n${c._boot().slice(-1200)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
        await sleep(400);
    }
    throw new Error(`never healthy\n${c._boot().slice(-1200)}`);
}
const H = (uid) => ({ 'x-user-id': uid, 'content-type': 'application/json' });
const get = (p, uid) => fetch(`${base}${p}`, { headers: H(uid) });
// La capa tenant decide ALLOW (pasa al handler) vs DENY (403/404). El código de
// éxito del handler es ortogonal (algunos handlers 500 en fixture hermética sin
// SQLite de progreso). Por eso las ALLOW se afirman como "no denegado por tenant".
const notTenantDenied = (s) => s !== 403 && s !== 404;
const restart = async (mode) => { if (child) { child.kill('SIGKILL'); await sleep(300); } child = spawnApi(mode); await waitHealthy(child); };

async function main() {
    // ── OFF: sin regresión (todo visible) ──
    await restart('off');
    console.log('\n[OFF] comportamiento actual intacto');
    const uOff = await (await get('/api/users', 'MEMA')).json();
    ok('off: lista users completa (7)', Array.isArray(uOff) && uOff.length === 7);
    const gOff = await (await get('/api/groups', 'MEMB')).json();
    ok('off: lista groups completa (2)', Array.isArray(gOff) && gOff.length === 2);
    ok('off: MEDA lee gB members (sin scope)', (await get('/api/groups/gB/members', 'MEDA')).status === 200);
    ok('off: MEMB lee gA members (sin scope)', (await get('/api/groups/gA/members', 'MEMB')).status === 200);

    // ── SHADOW: misma respuesta que off + telemetría ──
    await restart('shadow');
    console.log('\n[SHADOW] respuesta idéntica a off');
    const uSh = await (await get('/api/users', 'MEDA')).json();
    ok('shadow: lista users NO filtrada (7)', uSh.length === 7);
    ok('shadow: MEDA→gB members sigue 200 (no bloquea)', (await get('/api/groups/gB/members', 'MEDA')).status === 200);
    ok('shadow: MEMB→gA members sigue 200 (no bloquea)', (await get('/api/groups/gA/members', 'MEMB')).status === 200);
    const metrics = await (await fetch(`${base}/metrics`)).text().catch(() => '');
    // (métricas pueden estar off si METRICS_ENABLED!=1; no lo exigimos)

    // ── ENFORCE: golden cross-tenant ──
    await restart('enforce');
    console.log('\n[ENFORCE] aislamiento por institución');
    // Listas filtradas server-side.
    const uAdmin = await (await get('/api/users', 'ADMG')).json();
    ok('admin ve todos los users (7)', uAdmin.length === 7);
    const uMedA = await (await get('/api/users', 'MEDA')).json();
    const medaIds = new Set(uMedA.map(x => x.id));
    ok('MEDA ve solo su institución (incluye MEMA, excluye MEMB)', medaIds.has('MEMA') && !medaIds.has('MEMB'));
    const gMedA = await (await get('/api/groups', 'MEDA')).json();
    ok('MEDA ve solo gA', gMedA.length === 1 && gMedA[0].id === 'gA');
    const gUnsc = await (await get('/api/groups', 'UNSC')).json();
    ok('UNSCOPED no ve grupos', gUnsc.length === 0);

    console.log('\n[ENFORCE] GET cross-tenant → deny');
    ok('MEDA → gA members 200', (await get('/api/groups/gA/members', 'MEDA')).status === 200);
    ok('MEDA → gB members 404 (cross)', (await get('/api/groups/gB/members', 'MEDA')).status === 404);
    ok('MEMA → gA members 200 (miembro)', (await get('/api/groups/gA/members', 'MEMA')).status === 200);
    ok('MEMB → gA members 404', (await get('/api/groups/gA/members', 'MEMB')).status === 404);
    ok('MEMA self status → no denegado por tenant', notTenantDenied((await get('/api/students/MEMA/status', 'MEMA')).status));
    ok('MEDA → status MEMA (su miembro) no denegado', notTenantDenied((await get('/api/students/MEMA/status', 'MEDA')).status));
    ok('MEDA → status MEMB 404 (cross, tenant)', (await get('/api/students/MEMB/status', 'MEDA')).status === 404);
    ok('MEMA → status MEMB 404 (cross, tenant)', (await get('/api/students/MEMB/status', 'MEMA')).status === 404);
    ok('MEMA → progreso MEMB 404 (cross, tenant)', (await get('/api/progress/user/MEMB', 'MEMA')).status === 404);
    ok('MEMA → self progreso no denegado por tenant', notTenantDenied((await get('/api/progress/user/MEMA', 'MEMA')).status));
    ok('Aula Viva: MEDA → timeline MEMB 404 (cross)', (await get('/api/aula-viva/students/MEMB/timeline', 'MEDA')).status === 404);
    ok('Aula Viva: MEDA → timeline MEMA 200', (await get('/api/aula-viva/students/MEMA/timeline', 'MEDA')).status === 200);
    ok('Leo mediador: MEDA → MEMB 404', (await get('/api/leo/mediator/student/MEMB', 'MEDA')).status === 404);

    console.log('\n[ENFORCE] fail-closed unscoped/ambiguous');
    ok('UNSCOPED → status de otro 404', (await get('/api/students/MEMA/status', 'UNSC')).status === 404);
    ok('AMBIGUOUS es miembro de gA → 200 (lectura de su propio grupo, legítima)', (await get('/api/groups/gA/members', 'AMBI')).status === 200);
    ok('AMBIGUOUS → gB members 404 (cross, fail-closed)', (await get('/api/groups/gB/members', 'AMBI')).status === 404);
    ok('AMBIGUOUS → status de otro 404 (no self/mediador)', (await get('/api/students/MEMA/status', 'AMBI')).status === 404);

    console.log('\n[ENFORCE] escalation de membership (mutaciones)');
    // member add: MEDA en su grupo (member) permitido; en gB deny; otorgar mediador deny.
    const addMemA = await fetch(`${base}/api/groups/gA/members`, { method: 'POST', headers: H('MEDA'), body: JSON.stringify({ userId: 'UNSC', role: 'member' }) });
    ok('MEDA add member en gA (suyo) → no 403 tenant', addMemA.status !== 403);
    const addMemB = await fetch(`${base}/api/groups/gB/members`, { method: 'POST', headers: H('MEDA'), body: JSON.stringify({ userId: 'UNSC', role: 'member' }) });
    ok('MEDA add member en gB (ajeno) → 403', addMemB.status === 403);
    const grantMed = await fetch(`${base}/api/groups/gA/members`, { method: 'POST', headers: H('MEDA'), body: JSON.stringify({ userId: 'UNSC', role: 'mediador' }) });
    ok('MEDA otorgar rol mediador → 403', grantMed.status === 403);
    const readerAdd = await fetch(`${base}/api/groups/gA/members`, { method: 'POST', headers: H('MEMA'), body: JSON.stringify({ userId: 'UNSC', role: 'member' }) });
    ok('lector add member → 403', readerAdd.status === 403);

    console.log('\n[ENFORCE] admin global override explícito');
    ok('admin → gB members 200', (await get('/api/groups/gB/members', 'ADMG')).status === 200);
    ok('admin → status MEMB no denegado por tenant', notTenantDenied((await get('/api/students/MEMB/status', 'ADMG')).status));
    const adminAdd = await fetch(`${base}/api/groups/gB/members`, { method: 'POST', headers: H('ADMG'), body: JSON.stringify({ userId: 'UNSC', role: 'member' }) });
    ok('admin gestiona membership en gB → no 403', adminAdd.status !== 403);

    // ── Golden aggregate ──
    console.log('\n[GOLDEN] agregado cross-tenant');
    const crossReads = [
        ['/api/groups/gB/members', 'MEDA'], ['/api/groups/gA/members', 'MEMB'],
        ['/api/students/MEMB/status', 'MEDA'], ['/api/students/MEMA/status', 'MEMB'],
        ['/api/aula-viva/students/MEMB/timeline', 'MEDA'], ['/api/leo/mediator/student/MEMB', 'MEDA'],
    ];
    let leaked = 0;
    for (const [p, uid] of crossReads) { if ((await get(p, uid)).status === 200) leaked++; }
    ok('CROSS_TENANT_READ_ALLOWED=0 (no-admin)', leaked === 0, `leaked=${leaked}`);

    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
}

main()
    .then(() => { try { child?.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); try { child?.kill('SIGKILL'); } catch {} process.exit(1); });
