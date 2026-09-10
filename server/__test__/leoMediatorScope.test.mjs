/**
 * leoMediatorScope.test.mjs — CHP-LEO-MEDIATOR-CIS-SCOPE-01A.
 *
 * Las rutas de Leo destinadas a mediadores aplican el alcance canónico (CIS):
 *   GET /api/leo/mediator/student/:userId
 *   GET /api/leo/mediator/student/:userId/content/:contentId
 *   GET /api/leo/activation/:userId   (el propio estudiante conserva su acceso)
 *
 * Servidor REAL, 100 % hermético: padrón, grupos, colegios, contenido, uploads,
 * data dir y SQLite en un directorio temporal (misma receta que
 * contentStoreRmwConcurrency). SESSION_AUTH_MODE=off: la identidad es el header
 * legacy y el CIS resuelve rol/memberships desde el padrón sintético. La capa
 * de sesión firmada y la autoridad de máquina (admin-secret file-only) son
 * POSIX-only y quedan cubiertas por las suites de identidad en CI.
 *
 *   node server/__test__/leoMediatorScope.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── fixtures sintéticos (cero PII real) ──────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_leo_scope_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'), events: path.join(tmp, 'events.db'), insights: path.join(tmp, 'insights.db'),
};
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
const u = (id, roles, extra = {}) => ({ id, email: `${id.toLowerCase()}@fixture.invalid`, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const USERS = [
    u('ADM',  ['administrador']),
    u('MED1', ['mediador'], { organizationId: 'org-a' }),   // media G1 (P1)
    u('MED2', ['mediador'], { organizationId: 'org-a' }),   // sin grupos
    u('MED3', ['mediador'], { organizationId: 'org-b' }),   // media G3 (P2) en otra institución
    u('MEDX', ['mediador'], { organizationId: 'org-a', accountStatus: 'disabled' }), // inactivo, listado en G1
    u('P1',   ['lector'],   { organizationId: 'org-a' }),
    u('P2',   ['lector'],   { organizationId: 'org-b' }),
];
const GROUPS = [
    { id: 'G1', name: 'Grupo A', type: 'course', organizationId: 'org-a', mediatorIds: ['MED1', 'MEDX'], memberIds: ['P1'] },
    { id: 'G3', name: 'Grupo B', type: 'course', organizationId: 'org-b', mediatorIds: ['MED3'], memberIds: ['P2'] },
];
fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio A' }, { id: 'org-b', name: 'Colegio B' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');
fs.writeFileSync(path.join(P.data, 'progress_db.json'), JSON.stringify({ progressMap: {} }));

function spawnApi(port) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
            UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(tmp, 'events.archive.db'),
            PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'),
            SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '' },
    });
    let boot = ''; child.stdout.on('data', d => { boot += d; }); child.stderr.on('data', d => { boot += d; });
    child._boot = () => boot; return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-1500)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-1500)}`);
}
const call = async (base, p, uid, extraHeaders = {}) => {
    const headers = { ...(uid === null ? {} : { 'x-user-id': uid }), ...extraHeaders };
    const r = await fetch(`${base}${p}`, { headers });
    let body = null; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
};
const dataDigest = () => {
    const h = crypto.createHash('sha256');
    for (const f of fs.readdirSync(P.data).sort()) h.update(f + ':' + fs.readFileSync(path.join(P.data, f)));
    return h.digest('hex');
};
const eventsCount = () => {
    if (!fs.existsSync(P.events)) return 0;
    const db = new Database(P.events, { readonly: true }); try { return db.prepare('SELECT COUNT(*) AS n FROM events').get().n; } catch { return 0; } finally { db.close(); }
};

const port = 3100 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const api = spawnApi(port);
try {
    await waitHealthy(base, api);
    const R = {
        summary: (id) => `/api/leo/mediator/student/${id}`,
        history: (id) => `/api/leo/mediator/student/${id}/content/c1`,
        activation: (id) => `/api/leo/activation/${id}`,
    };
    const ROUTES = [R.summary, R.history, R.activation];
    const digest0 = dataDigest(); const events0 = eventsCount();

    console.log('\n[A] sin identidad / principal inexistente / inactivo → 401 en las tres rutas');
    for (const r of ROUTES) {
        const none = await call(base, r('P1'), null);
        const ghost = await call(base, r('P1'), 'ghost');
        const inact = await call(base, r('P1'), 'MEDX');
        ok(`${r('P1')} → 401/401/401`, none.status === 401 && ghost.status === 401 && inact.status === 401, `${none.status}/${ghost.status}/${inact.status}`);
    }

    console.log('\n[B] lector → 403 en rutas de mediación (incluso sobre sí mismo); activación conserva el acceso propio');
    ok('P1 sobre sí mismo: summary 403', (await call(base, R.summary('P1'), 'P1')).status === 403);
    ok('P1 sobre sí mismo: history 403', (await call(base, R.history('P1'), 'P1')).status === 403);
    ok('P1 sobre P2: summary 403 / history 403 / activation 403',
        (await call(base, R.summary('P2'), 'P1')).status === 403 && (await call(base, R.history('P2'), 'P1')).status === 403 && (await call(base, R.activation('P2'), 'P1')).status === 403);
    const selfAct = await call(base, R.activation('P1'), 'P1');
    ok('P1 activation propia → 200 con {success, outputs}', selfAct.status === 200 && selfAct.body?.success === true && 'outputs' in selfAct.body, String(selfAct.status));

    console.log('\n[C] mediador autorizado → solo miembros de sus grupos activos');
    const s1 = await call(base, R.summary('P1'), 'MED1');
    const h1 = await call(base, R.history('P1'), 'MED1');
    const a1 = await call(base, R.activation('P1'), 'MED1');
    ok('MED1 → P1: summary 200 {success, summary}', s1.status === 200 && s1.body?.success === true && 'summary' in s1.body, String(s1.status));
    ok('MED1 → P1: history 200 {success, history}', h1.status === 200 && h1.body?.success === true && 'history' in h1.body, String(h1.status));
    ok('MED1 → P1: activation 200 {success, outputs}', a1.status === 200 && a1.body?.success === true && 'outputs' in a1.body, String(a1.status));
    ok('MED1 → P2 (otra institución): 403 en las tres rutas',
        (await call(base, R.summary('P2'), 'MED1')).status === 403 && (await call(base, R.history('P2'), 'MED1')).status === 403 && (await call(base, R.activation('P2'), 'MED1')).status === 403);
    ok('MED1 sobre sí mismo en ruta de mediación → 403 (no es estudiante)', (await call(base, R.summary('MED1'), 'MED1')).status === 403);

    console.log('\n[D] mediador sin membership / de otro grupo / de otra institución → denegado');
    ok('MED2 (sin grupos) → P1: 403 ×3',
        (await call(base, R.summary('P1'), 'MED2')).status === 403 && (await call(base, R.history('P1'), 'MED2')).status === 403 && (await call(base, R.activation('P1'), 'MED2')).status === 403);
    ok('MED3 (org-b) → P1 (org-a): 403 ×3',
        (await call(base, R.summary('P1'), 'MED3')).status === 403 && (await call(base, R.history('P1'), 'MED3')).status === 403 && (await call(base, R.activation('P1'), 'MED3')).status === 403);
    ok('MED3 → P2 (su grupo): 200 ×3',
        (await call(base, R.summary('P2'), 'MED3')).status === 200 && (await call(base, R.history('P2'), 'MED3')).status === 200 && (await call(base, R.activation('P2'), 'MED3')).status === 200);
    const denied = await call(base, R.summary('P1'), 'MED2');
    ok('denegación tipificada: error scope_access_denied con scope user', denied.body?.error === 'scope_access_denied' && denied.body?.scope_type === 'user' && denied.body?.scope_id === 'P1');

    console.log('\n[E] administrador global conserva el acceso vigente');
    ok('ADM → P1 y P2: 200 en las tres rutas',
        (await call(base, R.summary('P1'), 'ADM')).status === 200 && (await call(base, R.history('P2'), 'ADM')).status === 200 && (await call(base, R.activation('P2'), 'ADM')).status === 200);

    console.log('\n[F] rol, grupo e institución falsificados por el cliente no amplían el alcance');
    const fakeQ = '?role=administrador&rol=administrador&groupId=G1&organizationId=org-a&colegio=Colegio%20A&userId=ADM&reviewerId=ADM';
    const fakeH = { 'x-role': 'administrador', 'x-group-id': 'G1', 'x-organization-id': 'org-a', 'x-colegio': 'Colegio A' };
    ok('MED2 + query/cabeceras falsas → sigue 403 ×3',
        (await call(base, R.summary('P1') + fakeQ, 'MED2', fakeH)).status === 403 && (await call(base, R.history('P1') + fakeQ, 'MED2', fakeH)).status === 403 && (await call(base, R.activation('P1') + fakeQ, 'MED2', fakeH)).status === 403);
    ok('P1 + query/cabeceras falsas → summary sigue 403', (await call(base, R.summary('P1') + fakeQ, 'P1', fakeH)).status === 403);

    console.log('\n[G] las denegaciones no escriben stores ni emiten eventos; el actor efectivo es la identidad autenticada');
    ok('data dir lógicamente idéntico tras todas las denegaciones y lecturas', dataDigest() === digest0);
    ok('events.db sin filas nuevas', eventsCount() === events0);
    const noLeak = JSON.stringify(denied.body);
    ok('respuesta de denegación sin resumen, historial ni outputs', !/summary|history|outputs/.test(noLeak));

    console.log('\n[H] estructural: las tres rutas invocan el guard CIS y conservan requireAuth');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    ok('import de evaluateScopeAccess desde scopeAccess.mjs', /import \{ evaluateScopeAccess \} from '\.\/aulaViva\/scopeAccess\.mjs';/.test(src));
    ok('guard definido una vez', (src.match(/async function requireLeoMediatorScope\(/g) || []).length === 1);
    for (const [route, self] of [["app.get('/api/leo/mediator/student/:userId', requireAuth", false], ["app.get('/api/leo/mediator/student/:userId/content/:contentId', requireAuth", false], ["app.get('/api/leo/activation/:userId', requireAuth", true]]) {
        const i = src.indexOf(route); const block = src.slice(i, i + 900);
        ok(`${route.slice(8, 50)}… llama al guard${self ? ' con allowSelf' : ''}`, i > 0 && (self ? /requireLeoMediatorScope\(req, res, userId, \{ allowSelf: true \}\)/.test(block) : /requireLeoMediatorScope\(req, res, userId\)/.test(block)));
    }
    ok('el guard reutiliza la autoridad de máquina existente (isAdminRequest) y el CIS', /if \(await isAdminRequest\(req\)\) return true;/.test(src) && /evaluateScopeAccess\(callerId, 'user', String\(studentId\)\)/.test(src));
    ok('fixtures sin correos reales ni texto de menores', USERS.every(x => x.email.endsWith('@fixture.invalid')));
} finally {
    try { api.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
