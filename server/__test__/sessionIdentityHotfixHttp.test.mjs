/**
 * sessionIdentityHotfixHttp.test.mjs — SEC-SESSION-IDENTITY-01 (hotfix sobre unifiedxp-13b8045).
 *
 * Diez usos de `resolveRequester` tomaban la identidad de la cabecera `x-user-id` también con la sesión obligatoria
 * (SESSION_AUTH_MODE=enforce). Efecto doble: sin cookie, la cabecera con el id de una cuenta bastaba; con cookie y sin
 * cabecera —el navegador— la cuenta legítima recibía 401/403. Los diez usan ahora `sessionRequesterOf` (la identidad
 * autenticada que ya existía). Aquí se prueba solo de dónde sale la identidad. Las REGLAS de permiso heredadas las
 * acota SEC-SESSION-IDENTITY-04 (`legacyAuthzHotfixHttp.test.mjs`): métricas y alertas globales son de administración,
 * y el seguimiento detallado de curso queda suspendido para mediadores (04U; solo autoridad de máquina).
 *
 * Catorce rutas (diez usos; uno, `requireAdminOrMediator`, protege cinco):
 *   GET  /api/metrics/schools            GET  /api/metrics/backbone|funnels|insights
 *   GET  /api/metrics/student/:u         GET  /api/metrics/insights/states|notifications
 *   GET  /api/metrics/course/:g          POST /api/metrics/insights/snapshot
 *   GET  /api/reports/course/:g          POST /api/metrics/insights/:key/ack|dismiss
 *   GET  /api/reading-progress/:u[/:c]
 *
 * Dos réplicas de server.js REAL, enforce, sesiones y almacenes sintéticos compartidos, cookies reales del login.
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 *
 *   node server/__test__/sessionIdentityHotfixHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers/freePort.mjs';

if (process.platform === 'win32') {
    console.log('sessionIdentityHotfixHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_secsess_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), key: path.join(tmp, 'session.key'), sessions: path.join(tmp, 'sessions.db'), insights: path.join(tmp, 'insights.db') };
fs.mkdirSync(P.data, { recursive: true });
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']),
    acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }),
    acct('ra-1', ['lector'], A), acct('ra-2', ['lector'], A), acct('ra-venc', ['lector'], A), acct('rb-1', ['lector'], B),
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: ['ra-1', 'ra-2', 'ra-venc'], studentIds: ['ra-1', 'ra-2', 'ra-venc'] },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-1'], studentIds: ['rb-1'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');
const T0 = Date.now() - 3 * 86400000, events = [];
for (const [userId, d] of Object.entries({ 'ra-1': 60000, 'ra-2': 120000, 'rb-1': 45000 })) {
    events.push({ event: 'session_start', userId, contentId: 'c1', timestamp: T0, streak: 0 });
    events.push({ event: 'block_complete', userId, contentId: 'c1', timestamp: T0 + 1000, streak: 1 });
    events.push({ event: 'session_end', userId, contentId: 'c1', timestamp: T0 + d, sessionDuration: d, progressPercentage: 50 });
}
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(events));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const ports = await freePorts(2);
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted',
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const ready = async (s) => { for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(200); } throw new Error(`server no arrancó\n${s.out.slice(-1500)}`); };
// Como el navegador: la cookie y nada más (en POST, además, la marca de mismo origen que el navegador añade solo).
const call = async (s, [method, p], { cookie, headers = {} } = {}) => {
    const post = method === 'POST';
    const r = await fetch(`${s.base}${p}`, { method, headers: { ...(post ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie, ...(post ? { 'sec-fetch-site': 'same-origin' } : {}) } : {}), ...headers }, body: post ? JSON.stringify({ windowDays: 30, days: 1 }) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const G = (p) => ['GET', p], KEY = 'alerta-sintetica';
const SCHOOLS = G('/api/metrics/schools'), MS = G('/api/metrics/student/ra-1'), MC = G('/api/metrics/course/g-a'), RC = G('/api/reports/course/g-a');
const RP = G('/api/reading-progress/ra-1'), RPC = G('/api/reading-progress/ra-1/c1');
const GLOBAL_GET = [G('/api/metrics/backbone'), G('/api/metrics/funnels'), G('/api/metrics/insights'), G('/api/metrics/insights/states'), G('/api/metrics/insights/notifications')];
const WRITES = [['POST', '/api/metrics/insights/snapshot'], ['POST', `/api/metrics/insights/${KEY}/ack`], ['POST', `/api/metrics/insights/${KEY}/dismiss`]];
// Las catorce rutas, cada una con la cuenta que —según las reglas de ESTA versión— tiene derecho a ella.
const ALL = [[SCHOOLS, 'med-a'], [MS, 'ra-1'], [MC, 'med-a'], [RC, 'med-a'], [RP, 'ra-1'], [RPC, 'ra-1'], ...GLOBAL_GET.map((r) => [r, 'adm']), ...WRITES.map((r) => [r, 'adm'])];
const name = (r) => `${r[0]} ${r[1]}`;
// Un rechazo no dice nada de nadie: ni datos, ni nombres, ni correos, ni ids de cuentas.
const PRIVATE = /studentBreakdown|productMetrics|readingProgress|backboneMetrics|summary|schoolName|insights|states|notifications|Cuenta |fixture\.invalid|Colegio|ra-1|ra-2|rb-1|med-a|med-b|"adm"/;
const denied = (r) => [401, 403].includes(r.status) && !PRIVATE.test(r.text);
const both = async (route, opts) => [await call(S1, route, opts), await call(S2, route, opts)];
const all = async (routes, opts) => { const out = []; for (const r of routes) out.push(...await both(r, opts)); return out; };
const st = (rs) => rs.map((r) => r.status).join(' ');
const alertRows = () => { if (!fs.existsSync(P.insights)) return '[]'; const db = new Database(P.insights, { readonly: true }); try { const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='insight_states'").get(); return t ? JSON.stringify(db.prepare('SELECT * FROM insight_states').all()) : '[]'; } finally { db.close(); } };
const wrote = () => /\[INSIGHTS_(SNAPSHOT|ACK|DISMISS)\]/.test(S1.out + S2.out);

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const [i, id] of ['adm', 'med-a', 'med-b', 'ra-1', 'ra-2', 'rb-1'].entries()) C[id] = await login(i % 2 ? S2 : S1, id);

    console.log('[1] sin cookie, la cabecera `x-user-id` no es una identidad (14 rutas, dos réplicas)');
    const rows0 = alertRows();
    for (const [route, owner] of ALL) {
        const legit = await both(route, { headers: { 'x-user-id': owner } });
        ok(`${name(route)} · sin cookie + x-user-id de ${owner} → rechazado, sin datos`, legit.every(denied), st(legit));
        const admin = await both(route, { headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } });
        ok(`${name(route)} · sin cookie + x-user-id del administrador → rechazado, sin datos`, admin.every(denied), st(admin));
    }
    const none = await all(ALL.map(([r]) => r));
    ok('sin cookie ni cabecera → rechazado en las catorce', none.every(denied), st(none));
    const junk = await all(ALL.map(([r]) => r), { cookie: 'chp_session=no-es-un-token', headers: { 'x-user-id': 'med-a' } });
    ok('cookie inventada + cabecera → rechazado en las catorce', junk.every(denied), st(junk));
    ok('…y ninguna escritura de alertas llegó a ejecutarse', alertRows() === rows0 && !wrote());

    console.log('[2] cookie de A + cabecera de B: sin suplantación ni escalamiento');
    for (const [route, owner] of ALL) {
        const other = owner === 'med-a' ? 'ra-2' : 'ra-2';
        const spoof = await both(route, { cookie: C[other], headers: { 'x-user-id': owner } });
        ok(`${name(route)} · cookie de un lector (${other}) + x-user-id: ${owner} → rechazado, sin datos`, spoof.every(denied), st(spoof));
    }
    const esc = await all(ALL.map(([r]) => r), { cookie: C['ra-2'], headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } });
    ok('cookie de un lector + x-user-id del administrador → rechazado en las catorce', esc.every(denied), st(esc));
    const contra = await all(ALL.map(([r]) => r), { cookie: C['med-a'], headers: { 'x-user-id': 'med-b' } });
    ok('cookie legítima + cabecera contradictoria → la petición se rechaza (subject_mismatch)', contra.every(denied), st(contra));
    ok('…sin escrituras de alertas', alertRows() === rows0 && !wrote());

    console.log('[3] cookie válida sin cabecera: el acceso legítimo de esta versión');
    for (const [route, owner] of ALL.filter(([r]) => r[0] === 'GET' && r !== MC && r !== RC)) {
        const r = await both(route, { cookie: C[owner] });
        ok(`${name(route)} · cookie de ${owner} → 200 en las dos réplicas`, r.every((x) => x.status === 200), st(r));
    }
    const same = await all([MS, RP, RPC], { cookie: C['ra-1'], headers: { 'x-user-id': 'ra-1' } });
    ok('una cabecera que repite la identidad de la sesión no estorba', same.every((x) => x.status === 200), st(same));

    console.log('[4] lector: lo propio sí, lo ajeno no');
    const ownMs = await call(S1, MS, { cookie: C['ra-1'] }), ownRp = await call(S2, RP, { cookie: C['ra-1'] }), ownRpc = await call(S1, RPC, { cookie: C['ra-1'] });
    ok('lector → sus métricas y su progreso, con el contrato de siempre', 'backboneMetrics' in (ownMs.json ?? {}) && ownRp.json?.success === true && ownRp.json.userId === 'ra-1' && 'summary' in ownRp.json && ownRpc.json?.success === true && 'readingProgress' in ownRpc.json, `${ownMs.text.slice(0, 80)} ${ownRp.text.slice(0, 80)}`);
    const foreign = await all([MS, RP, RPC, G('/api/metrics/student/rb-1'), G('/api/reading-progress/rb-1')], { cookie: C['ra-2'] });
    ok('lector → métricas y progreso de OTRO lector → 403, sin datos', foreign.every((x) => x.status === 403 && denied(x)), st(foreign));
    const rdCourse = await all([MC, RC, ...GLOBAL_GET, ...WRITES], { cookie: C['ra-2'] });
    ok('lector → curso, informe, métricas globales y escrituras de alertas → 403', rdCourse.every((x) => x.status === 403 && denied(x)), st(rdCourse));
    ok('…sin escrituras de alertas', alertRows() === rows0 && !wrote());

    console.log('[5] mediador: sus funciones');
    const mc = await both(MC, { cookie: C['med-a'] }), rc = await both(RC, { cookie: C['med-a'] });
    ok('mediador → métricas e informe de SU curso → 403 con el aviso de restricción temporal, sin datos (SEC-04U)', [...mc, ...rc].every((x) => x.status === 403 && x.json?.code === 'course_detail_restricted' && denied(x)), `${st(mc)} ${st(rc)}`);
    const mOther = await all([G('/api/metrics/course/g-b'), G('/api/reports/course/g-b'), G('/api/metrics/course/g-inexistente')], { cookie: C['med-a'] });
    ok('mediador → curso que no media (otra institución, inexistente) → 403', mOther.every((x) => x.status === 403 && denied(x)), st(mOther));
    const mSch = await call(S1, SCHOOLS, { cookie: C['med-a'] });
    ok('mediador → colegios: solo el de sus cursos', mSch.status === 200 && JSON.stringify(mSch.json?.schools?.map((x) => x.schoolName)) === '["Colegio Alfa"]', mSch.text.slice(0, 120));
    const mMs = await both(MS, { cookie: C['med-a'] });
    ok('mediador → métricas individuales de un lector → 403 (ruta del propio lector; sin cambio)', mMs.every((x) => x.status === 403), st(mMs));
    const medGlobal = await all([...GLOBAL_GET, ...WRITES], { cookie: C['med-a'] });
    ok('mediador con su sesión → métricas y alertas globales → 403 (SEC-04: solo administración)', medGlobal.every((x) => x.status === 403 && denied(x)), st(medGlobal));
    ok('…sin escrituras de alertas', alertRows() === rows0 && !wrote());

    console.log('[6] administración: sin regresiones ni ampliación');
    const admRp = await all([RP, RPC], { cookie: C.adm });
    ok('administrador con su sesión → progreso de un lector → 200 (la ruta ya lo preveía)', admRp.every((x) => x.status === 200), st(admRp));
    const admSch = await call(S2, SCHOOLS, { cookie: C.adm });
    ok('administrador con su sesión → colegios → 200 con todos', admSch.status === 200 && admSch.json?.schools?.length === 2, admSch.text.slice(0, 120));
    const admMachine = await all([MC, RC, MS], { cookie: C.adm });
    ok('administrador con su sesión → rutas de autoridad de máquina → 403 (igual que antes; no se amplía)', admMachine.every((x) => x.status === 403 && denied(x)), st(admMachine));
    const snap = await both(WRITES[0], { cookie: C.adm });
    ok('administrador con su sesión → instantánea de alertas → 200', snap.every((x) => x.status === 200), `${st(snap)} ${snap[0].text.slice(0, 100)}`);
    const ackDis = await all(WRITES.slice(1), { cookie: C.adm });
    ok('administrador con su sesión → confirmar/descartar: la petición pasa el control (no 401/403)', ackDis.every((x) => ![401, 403].includes(x.status)), st(ackDis));
    const users = await call(S1, G('/api/users'), { cookie: C.adm }), groups = await call(S2, G('/api/groups'), { cookie: C.adm }), me = await call(S1, G('/api/auth/me'), { cookie: C['ra-1'] });
    ok('rutas vecinas sin cambio: /api/users y /api/groups del administrador, /api/auth/me del lector → 200', users.status === 200 && groups.status === 200 && me.status === 200, `${users.status} ${groups.status} ${me.status}`);

    console.log('[7] cookie vencida o revocada');
    const venc = await login(S1, 'ra-venc');
    const vPaths = [G('/api/metrics/student/ra-venc'), G('/api/reading-progress/ra-venc'), G('/api/reading-progress/ra-venc/c1'), SCHOOLS];
    const vBefore = await all(vPaths, { cookie: venc });
    ok('sesión vigente → 200 (control)', vBefore.every((x) => x.status === 200), st(vBefore));
    { const db = new Database(P.sessions); try { db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run('ra-venc'); } finally { db.close(); } }
    const vAfter = await all(vPaths, { cookie: venc });
    ok('la misma cookie con la sesión vencida → rechazada en las dos réplicas', vAfter.every(denied), st(vAfter));
    const vHdr = await all(vPaths, { cookie: venc, headers: { 'x-user-id': 'ra-venc' } });
    ok('…y la cabecera no la rescata', vHdr.every(denied), st(vHdr));
    const tmpMed = await login(S1, 'med-a');
    ok('segunda sesión del mediador → 200 (control)', (await call(S2, SCHOOLS, { cookie: tmpMed })).status === 200);
    const out = await fetch(`${S1.base}/api/auth/logout`, { method: 'POST', headers: { cookie: tmpMed, 'sec-fetch-site': 'same-origin' } });
    const before = alertRows();
    const revoked = await all(ALL.filter(([, o]) => o === 'med-a').map(([r]) => r), { cookie: tmpMed });
    ok('tras cerrar esa sesión, su cookie queda revocada → rechazada en sus rutas y las dos réplicas', out.status < 400 && revoked.every(denied) && alertRows() === before, `${out.status} ${st(revoked)}`);
    ok('…sin afectar a la otra sesión del mismo mediador', (await call(S2, SCHOOLS, { cookie: C['med-a'] })).status === 200);

    ok('ningún registro del servidor contiene cookies ni contraseñas', ![S1.out, S2.out].some((o) => o.includes(PW) || Object.values(C).some((c) => o.includes(c.split('=')[1]))));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { S1.child.kill(); S2.child.kill(); await sleep(300); fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nsessionIdentityHotfixHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
