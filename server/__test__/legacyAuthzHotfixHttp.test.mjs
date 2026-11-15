/**
 * legacyAuthzHotfixHttp.test.mjs — SEC-SESSION-IDENTITY-04 (hotfix sobre unifiedxp-13b8045).
 *
 * El hotfix de sesiones (01) devolvía a la cuenta legítima sus rutas… con las reglas de permiso de esta versión, que
 * eran demasiado anchas. Esta suite fija la mitigación mínima, hecha solo con controles que ya existían (CIS):
 *
 *   1. Progreso ajeno (4 rutas): el rol de mediador no basta; debe mediar un grupo ACTIVE_REAL del que el lector es
 *      miembro explícito. `user.groupIds`, `teacherId` y las cabeceras no sustituyen esa relación. B2C personal: nunca.
 *   2. Métricas y alertas globales (5 GET + 3 POST): autoridad de máquina o administrador de plataforma; el mediador no.
 *      Se autoriza antes de escribir.
 *   3. Métricas e informe de curso (04U): seguimiento detallado SUSPENDIDO para mediadores — 403 con un mensaje claro,
 *      idéntico medie o no el curso; mediar un grupo no acredita el seguimiento individual. Solo autoridad de máquina.
 *      Sin lectores, el backbone es la forma vacía, no el agregado de la plataforma.
 *
 * Dos réplicas de server.js REAL, enforce, dos instituciones, cookies reales del login. POSIX-only (secretos de
 * sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo. La autoridad de máquina se
 * prueba solo si /app/secrets es escribible por el proceso; si no, esos casos se informan como OMITIDOS.
 *
 * SEC04_MATRIX=<archivo>: además escribe la matriz actor × ruta (para comparar antes/después sobre otro árbol).
 *
 *   node server/__test__/legacyAuthzHotfixHttp.test.mjs
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
    console.log('legacyAuthzHotfixHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0, skipped = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const skip = (l) => { console.log('  – OMITIDO (no cuenta como aprobado):', l); skipped++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_sec04_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), key: path.join(tmp, 'session.key'), sessions: path.join(tmp, 'sessions.db'), insights: path.join(tmp, 'insights.db') };
fs.mkdirSync(P.data, { recursive: true });
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']),
    acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }),
    // Mediador sin relación de mediación: `user.groupIds` (que lo hace MIEMBRO del curso, no mediador) y `teacherId` heredado.
    acct('med-none', ['mediador'], { mediatorKind: 'teacher', ...A, groupIds: ['g-a'] }),
    acct('ra-1', ['lector'], A), acct('ra-2', ['lector'], A), acct('ra-out', ['lector'], A), acct('rb-1', ['lector'], B),
    // Cuentas personales de la tienda: una suelta y otra que alguien añadió a la nómina del curso.
    acct('b2c-1', ['lector'], { b2c: true, createdVia: 'b2c-provision', colegio: '' }),
    acct('b2c-in', ['lector'], { b2c: true, createdVia: 'b2c-provision', colegio: '' }),
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', teacherId: 'med-none', mediatorIds: ['med-a'], memberIds: ['ra-1', 'ra-2', 'b2c-in'], studentIds: ['ra-1', 'ra-2', 'b2c-in'] },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-1'], studentIds: ['rb-1'] },
    { id: 'g-vacio', name: 'Club vacío', type: 'club', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: ['b2c-in'], studentIds: ['b2c-in'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.access, JSON.stringify([{ id: 'r-ga', scope: 'group', scopeId: 'g-a', titleIds: ['c1'], collectionIds: [] }, { id: 'r-gb', scope: 'group', scopeId: 'g-b', titleIds: ['c1'], collectionIds: [] }]));
fs.writeFileSync(P.content, JSON.stringify([{ id: 'c1', titulo: 'Título sintético', tipo: 'libro' }]));
const T0 = Date.now() - 3 * 86400000, events = [];
for (const [userId, d] of Object.entries({ 'ra-1': 60000, 'ra-2': 120000, 'rb-1': 45000, 'b2c-in': 90000, 'b2c-1': 30000 })) {
    events.push({ event: 'session_start', userId, contentId: 'c1', timestamp: T0, streak: 0 });
    events.push({ event: 'block_complete', userId, contentId: 'c1', timestamp: T0 + 1000, streak: 1 });
    events.push({ event: 'session_end', userId, contentId: 'c1', timestamp: T0 + d, sessionDuration: d, progressPercentage: 50 });
}
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(events));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

// Autoridad de máquina: el secreto solo se lee de la ruta canónica, propiedad del proceso y 0400.
const SECRET_DIR = '/app/secrets', SECRET_FILE = `${SECRET_DIR}/admin_secret`, MACHINE = crypto.randomBytes(24).toString('hex');
let machine = false;
try {
    if (!fs.existsSync(SECRET_FILE)) { fs.mkdirSync(SECRET_DIR, { recursive: true }); fs.writeFileSync(SECRET_FILE, MACHINE, { mode: 0o400 }); fs.chmodSync(SECRET_FILE, 0o400); machine = true; }
} catch { machine = false; }

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
// Como el navegador: la cookie y nada más (en POST, además, la marca de mismo origen).
const call = async (s, [method, p, body], { cookie, headers = {} } = {}) => {
    const post = method === 'POST';
    const r = await fetch(`${s.base}${p}`, { method, headers: { ...(post ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie, ...(post ? { 'sec-fetch-site': 'same-origin' } : {}) } : {}), ...headers }, body: post ? JSON.stringify(body ?? { windowDays: 30, days: 1 }) : undefined });
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
const progressOf = (u) => [G(`/api/reading-progress/${u}`), G(`/api/reading-progress/${u}/c1`), G(`/api/progress/user/${u}`), G(`/api/progress/item/${u}/c1`)];
const MC = (g) => G(`/api/metrics/course/${g}`), RC = (g) => G(`/api/reports/course/${g}`);
const GLOBAL_GET = [G('/api/metrics/backbone'), G('/api/metrics/funnels'), G('/api/metrics/insights'), G('/api/metrics/insights/states'), G('/api/metrics/insights/notifications')];
const WRITES = [['POST', '/api/metrics/insights/snapshot'], ['POST', `/api/metrics/insights/${KEY}/ack`], ['POST', `/api/metrics/insights/${KEY}/dismiss`]];
const name = (r) => `${r[0]} ${r[1]}`;
// Un rechazo no dice nada de nadie.
const PRIVATE = /studentBreakdown|productMetrics|readingProgress|progressList|backboneMetrics|summary|insights|states|notifications|Cuenta |fixture\.invalid|Colegio|ra-1|ra-2|rb-1|b2c-/;
const denied = (r) => [401, 403].includes(r.status) && !PRIVATE.test(r.text);
// La restricción temporal: 403, el contrato `{ error }` de siempre con un texto que la explica, y ni un dato.
const restricted = (r) => r.status === 403 && r.json?.code === 'course_detail_restricted' && /temporalmente restringido/.test(r.json?.error ?? '') && Object.keys(r.json).sort().join() === 'code,error' && !PRIVATE.test(r.text);
const forbidden = (r) => r.status === 403 && !PRIVATE.test(r.text);
const both = async (route, opts) => [await call(S1, route, opts), await call(S2, route, opts)];
const all = async (routes, opts) => { const out = []; for (const r of routes) out.push(...await both(r, opts)); return out; };
const st = (rs) => rs.map((r) => r.status).join(' ');
const alertRows = () => { if (!fs.existsSync(P.insights)) return '[]'; const db = new Database(P.insights, { readonly: true }); try { const out = {}; for (const t of ['insight_states', 'insight_snapshots', 'insight_notifications']) { if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t)) out[t] = db.prepare(`SELECT * FROM ${t}`).all(); } return JSON.stringify(out); } finally { db.close(); } };
const writeLogs = () => ((S1.out + S2.out).match(/\[INSIGHTS_(SNAPSHOT|ACK|DISMISS)\]/g) || []).length;
const ids = (r) => (r.json?.studentBreakdown ?? []).map((s) => s.userId).sort().join(',');

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const [i, id] of ['adm', 'med-a', 'med-b', 'med-none', 'ra-1', 'ra-2', 'ra-out', 'rb-1', 'b2c-1', 'b2c-in'].entries()) C[id] = await login(i % 2 ? S2 : S1, id);

    // Progreso real, escrito por cada lector con su propia sesión (la ruta de siempre).
    const CP = { sentenceIndex: 0, totalSentences: 0, globalPercentage: 42, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'text', anchor: { type: 'text', value: 42 }, viewportHint: 42 };
    const syncs = [];
    for (const u of ['ra-1', 'rb-1']) syncs.push(await call(S1, ['POST', `/api/progress/${u}/c1/sync`, { canonicalProgress: CP, updatedAt: new Date().toISOString() }], { cookie: C[u] }));

    console.log('[1] lector: su propio progreso');
    ok('lector → guarda su progreso (sync) → 200', syncs.every((x) => x.status === 200), st(syncs));
    const own = await all(progressOf('ra-1'), { cookie: C['ra-1'] });
    ok('lector → sus cuatro lecturas de progreso → 200 en las dos réplicas', own.every((x) => x.status === 200), st(own));
    const ownItem = await call(S2, G('/api/progress/item/ra-1/c1'), { cookie: C['ra-1'] }), ownList = await call(S1, G('/api/progress/user/ra-1'), { cookie: C['ra-1'] }), ownRp = await call(S2, G('/api/reading-progress/ra-1'), { cookie: C['ra-1'] });
    ok('…con el contrato de siempre y su avance real', ownItem.json?.success === true && ownItem.json.progress != null && ownList.json?.progressList?.length === 1 && ownRp.json?.userId === 'ra-1' && ownRp.json.summary?.total === 1, `${ownItem.text.slice(0, 90)} ${ownList.text.slice(0, 60)}`);
    const peer = await all([...progressOf('ra-1'), ...progressOf('rb-1')], { cookie: C['ra-2'] });
    ok('lector → progreso de OTRO lector (mismo curso, otra institución) → 403, sin datos', peer.every(forbidden), st(peer));

    console.log('[2] mediador: lector de un grupo que media');
    const mine = await all(progressOf('ra-1'), { cookie: C['med-a'] });
    ok('mediador → progreso de un lector de SU grupo → 200 en las cuatro rutas y las dos réplicas', mine.every((x) => x.status === 200), st(mine));
    const mineList = await call(S1, G('/api/progress/user/ra-1'), { cookie: C['med-a'] });
    ok('…y es el avance real del lector', mineList.json?.success === true && mineList.json.progressList?.length === 1, mineList.text.slice(0, 100));
    const hdrSame = await all(progressOf('ra-1'), { cookie: C['med-a'], headers: { 'x-user-id': 'med-a' } });
    ok('una cabecera que repite la identidad de la sesión no estorba', hdrSame.every((x) => x.status === 200), st(hdrSame));

    console.log('[3] mediador: lector ajeno');
    const otherInst = await all(progressOf('rb-1'), { cookie: C['med-a'] });
    ok('mediador → lector de OTRA institución → 403, sin datos', otherInst.every(forbidden), st(otherInst));
    const noGroup = await all(progressOf('ra-out'), { cookie: C['med-a'] });
    ok('mediador → lector de su institución que NO está en sus grupos → 403', noGroup.every(forbidden), st(noGroup));
    const colleague = await all([...progressOf('med-b'), ...progressOf('adm'), ...progressOf('no-existe')], { cookie: C['med-a'] });
    ok('mediador → otro mediador, el administrador o un id inexistente → 403 (no se pueden sondear ids)', colleague.every(forbidden), st(colleague));
    const cross = await all(progressOf('ra-1'), { cookie: C['med-b'] });
    ok('mediador de otra institución → lector de este curso → 403', cross.every(forbidden), st(cross));

    console.log('[4] mediador: cuentas personales B2C');
    const b2c = await all([...progressOf('b2c-1'), ...progressOf('b2c-in')], { cookie: C['med-a'] });
    ok('mediador → cuenta B2C personal (suelta, o añadida a la nómina del curso) → 403, sin datos', b2c.every(forbidden), st(b2c));
    const b2cOwn = await all(progressOf('b2c-1').slice(0, 3), { cookie: C['b2c-1'] });
    ok('la cuenta B2C conserva lo propio → 200', b2cOwn.every((x) => x.status === 200), st(b2cOwn));

    console.log('[5] mediador sin grupos mediados');
    const none = await all([...progressOf('ra-1'), ...progressOf('ra-2'), ...progressOf('rb-1')], { cookie: C['med-none'] });
    ok('mediador sin grupos (con `user.groupIds` y `teacherId` heredados apuntando al curso) → progreso ajeno → 403', none.every(forbidden), st(none));
    const noneHdr = await all(progressOf('ra-1'), { cookie: C['med-none'], headers: { 'x-role': 'administrador', 'x-group-id': 'g-a', 'x-group-ids': 'g-a' } });
    ok('…y ninguna cabecera lo amplía', noneHdr.every(forbidden), st(noneHdr));
    const noneCourse = await all([MC('g-a'), RC('g-a')], { cookie: C['med-none'] });
    ok('…ni le abre las métricas o el informe del curso', noneCourse.every(forbidden), st(noneCourse));
    const noneOwn = await all(progressOf('med-none').slice(0, 3), { cookie: C['med-none'] });
    ok('…pero conserva lo propio → 200', noneOwn.every((x) => x.status === 200), st(noneOwn));

    console.log('[6] mediador: métricas globales');
    const rows0 = alertRows(), logs0 = writeLogs();
    for (const route of GLOBAL_GET) {
        const r = await both(route, { cookie: C['med-a'] });
        ok(`${name(route)} · mediador → 403, sin datos`, r.every(forbidden), st(r));
    }
    const rdGlobal = await all(GLOBAL_GET, { cookie: C['ra-1'] });
    ok('lector → las cinco → 403', rdGlobal.every(forbidden), st(rdGlobal));

    console.log('[7] mediador: escrituras de alertas globales');
    for (const route of WRITES) {
        const r = await both(route, { cookie: C['med-a'] });
        ok(`${name(route)} · mediador → 403`, r.every(forbidden), st(r));
    }
    const wOthers = await all(WRITES, { cookie: C['med-none'] }), wReader = await all(WRITES, { cookie: C['ra-1'] });
    ok('mediador sin grupos y lector → 403 en las tres', [...wOthers, ...wReader].every(forbidden), `${st(wOthers)} ${st(wReader)}`);
    ok('…sin escritura: almacén de alertas idéntico y ninguna operación registrada', alertRows() === rows0 && writeLogs() === logs0);

    console.log('[8] autoridad administrativa');
    const admGet = await all(GLOBAL_GET, { cookie: C.adm });
    ok('administrador de plataforma con su sesión → las cinco métricas globales → 200', admGet.every((x) => x.status === 200 && x.json?.ok === true), st(admGet));
    const admSnap = await call(S1, WRITES[0], { cookie: C.adm });
    ok('administrador → instantánea de alertas → 200 con la forma de siempre', admSnap.status === 200 && 'ok' in (admSnap.json ?? {}), admSnap.text.slice(0, 120));
    const admAck = await all(WRITES.slice(1), { cookie: C.adm });
    ok('administrador → confirmar/descartar: pasa el control (404 de clave inexistente, no 401/403)', admAck.every((x) => ![401, 403].includes(x.status)), st(admAck));
    const admProg = await all([...progressOf('ra-1'), ...progressOf('rb-1')], { cookie: C.adm });
    ok('administrador → progreso de cualquier lector → 200 (sin cambio)', admProg.every((x) => x.status === 200), st(admProg));
    const admCourse = await all([MC('g-a'), RC('g-a')], { cookie: C.adm });
    ok('administrador con sesión → métricas de curso → 403 (ruta de autoridad de máquina; sin cambio ni ampliación)', admCourse.every(forbidden), st(admCourse));
    if (machine) {
        const H = { headers: { 'x-admin-secret': MACHINE } };
        const mGet = await all(GLOBAL_GET, H), mW = await all(WRITES, H), mCourse = await all([MC('g-a'), RC('g-a')], H);
        ok('autoridad de máquina → cinco métricas globales → 200', mGet.every((x) => x.status === 200), st(mGet));
        ok('autoridad de máquina → escrituras de alertas → pasa el control', mW.every((x) => ![401, 403].includes(x.status)), st(mW));
        ok('autoridad de máquina → curso completo, sin filtro (igual que antes)', mCourse.every((x) => x.status === 200 && ids(x) === 'b2c-in,med-none,ra-1,ra-2'), `${st(mCourse)} ${ids(mCourse[0])}`);
        const mBad = await all([...GLOBAL_GET, ...WRITES], { headers: { 'x-admin-secret': `${MACHINE}x` } });
        ok('secreto de máquina incorrecto → rechazado', mBad.every(denied), st(mBad));
    } else skip('autoridad de máquina (admin-secret file-only): /app/secrets no es escribible por este proceso');

    console.log('[9] curso propio: seguimiento detallado suspendido');
    const mc = await both(MC('g-a'), { cookie: C['med-a'] }), rc = await both(RC('g-a'), { cookie: C['med-a'] });
    ok('mediador → métricas e informe de SU curso → 403 con el mensaje de restricción, en las dos réplicas', [...mc, ...rc].every(restricted), `${st(mc)} ${st(rc)} ${mc[0].text.slice(0, 160)}`);
    ok('…sin desglose, nombres, avances ni perfiles: el cuerpo es solo { error, code }', [...mc, ...rc].every((x) => !/studentBreakdown|pedagogicalProfile|topPerformers|needsAttention|nombre|composite/i.test(x.text)));
    const emptyMed = await both(MC('g-vacio'), { cookie: C['med-a'] });
    ok('…también en un curso suyo sin lectores', emptyMed.every(restricted), st(emptyMed));
    const sameHdr = await all([MC('g-a'), RC('g-a')], { cookie: C['med-a'], headers: { 'x-user-id': 'med-a', 'x-role': 'administrador', 'x-admin-secret': 'no-es-el-secreto' } });
    ok('…y ninguna cabecera (rol, secreto inventado) lo levanta', sameHdr.every(restricted), st(sameHdr));
    if (machine) {
        const H = { headers: { 'x-admin-secret': MACHINE } };
        const mFull = await all([MC('g-a'), RC('g-a')], H), mEmpty = await both(MC('g-vacio'), H);
        ok('autoridad de máquina → conserva la respuesta completa con la forma de siempre', mFull.every((x) => x.status === 200 && 'summary' in x.json && Array.isArray(x.json.studentBreakdown)) && mFull.slice(0, 2).every((x) => 'backboneMetrics' in x.json && x.json.studentBreakdown.every((s) => 'pedagogicalProfile' in s)) && mFull.slice(2).every((x) => x.json.reportMeta?.entityId === 'g-a'), st(mFull));
        const noReaders = await both(MC('g-inexistente'), H);
        ok('autoridad de máquina → curso inexistente → 404 (sin cambio)', noReaders.every((x) => x.status === 404), st(noReaders));
        ok('autoridad de máquina → el backbone del curso se filtra por sus miembros (no es el agregado global)', mEmpty.every((x) => x.status === 200 && x.json.backboneMetrics && 'funnels' in x.json.backboneMetrics && 'insights' in x.json.backboneMetrics), st(mEmpty));
    } else skip('autoridad de máquina sobre las rutas de curso: /app/secrets no es escribible por este proceso');

    console.log('[10] curso ajeno');
    const foreign = await all([MC('g-b'), RC('g-b'), MC('g-inexistente'), RC('g-inexistente')], { cookie: C['med-a'] });
    ok('mediador → curso de otra institución o inexistente → 403, sin datos', foreign.every(forbidden), st(foreign));
    ok('…con la MISMA respuesta que en su propio curso (no revela si lo media ni si existe)', foreign.every((x) => x.text === mc[0].text), foreign[0].text.slice(0, 120));
    const noneC = await all([MC('g-a'), RC('g-a')], { cookie: C['med-none'] }), otherC = await all([MC('g-a'), RC('g-a')], { cookie: C['med-b'] });
    ok('mediador sin grupos y mediador de otra institución → la misma restricción', [...noneC, ...otherC].every(restricted), `${st(noneC)} ${st(otherC)}`);
    const rdCourse = await all([MC('g-a'), RC('g-a')], { cookie: C['ra-1'] }), admC = await all([MC('g-a'), RC('g-a')], { cookie: C.adm });
    ok('lector y administrador con sesión → 403 «Acceso denegado» (sin cambio; no reciben el aviso de mediador)', [...rdCourse, ...admC].every((x) => forbidden(x) && x.json?.error === 'Acceso denegado'), `${st(rdCourse)} ${st(admC)}`);

    console.log('[11] cookies ausentes, vencidas o contradictorias');
    const PROTECTED = [...progressOf('ra-1'), MC('g-a'), RC('g-a'), ...GLOBAL_GET, ...WRITES];
    const rows1 = alertRows(), logs1 = writeLogs();
    const noCookie = await all(PROTECTED, { headers: { 'x-user-id': 'med-a' } });
    ok('sin cookie + x-user-id del mediador → rechazado en todas', noCookie.every(denied), st(noCookie));
    const noCookieAdm = await all(PROTECTED, { headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } });
    ok('sin cookie + x-user-id del administrador → rechazado en todas', noCookieAdm.every(denied), st(noCookieAdm));
    const junk = await all(PROTECTED, { cookie: 'chp_session=no-es-un-token', headers: { 'x-user-id': 'adm' } });
    ok('cookie inventada + cabecera → rechazado en todas', junk.every(denied), st(junk));
    const contra = await all(PROTECTED, { cookie: C['med-a'], headers: { 'x-user-id': 'adm' } });
    ok('cookie del mediador + cabecera del administrador → rechazado (sin escalamiento)', contra.every(denied), st(contra));
    const contra2 = await all(progressOf('ra-1'), { cookie: C['med-b'], headers: { 'x-user-id': 'med-a' } });
    ok('cookie de un mediador ajeno + cabecera del mediador del curso → rechazado', contra2.every(denied), st(contra2));
    const tmpMed = await login(S1, 'med-a'), tmpAdm = await login(S2, 'adm');
    ok('sesiones nuevas → 200 (control)', (await call(S2, G('/api/progress/user/ra-1'), { cookie: tmpMed })).status === 200 && (await call(S1, GLOBAL_GET[0], { cookie: tmpAdm })).status === 200);
    { const db = new Database(P.sessions); try { db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'adm' AND id NOT IN (SELECT id FROM sessions WHERE user_id = 'adm' ORDER BY created_at ASC LIMIT 1)").run(); } catch { db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'adm'").run(); C.adm = null; } finally { db.close(); } }
    const expired = await all([...GLOBAL_GET, ...WRITES], { cookie: tmpAdm });
    ok('sesión de administrador vencida → rechazada en métricas y alertas globales', expired.every(denied), st(expired));
    const out = await fetch(`${S1.base}/api/auth/logout`, { method: 'POST', headers: { cookie: tmpMed, 'sec-fetch-site': 'same-origin' } });
    const revoked = await all([...progressOf('ra-1'), MC('g-a'), RC('g-a')], { cookie: tmpMed });
    ok('sesión de mediador cerrada → su cookie queda rechazada en las dos réplicas', out.status < 400 && revoked.every(denied), `${out.status} ${st(revoked)}`);
    ok('…sin afectar a su otra sesión', (await call(S2, G('/api/progress/user/ra-1'), { cookie: C['med-a'] })).status === 200);
    ok('…y nada de esto escribió alertas', alertRows() === rows1 && writeLogs() === logs1);

    console.log('[12] sin regresiones en lo vecino');
    const access = await call(S1, G('/api/content/c1/access?userId=ra-1'), { cookie: C['ra-1'] });
    ok('lectura: el lector conserva el acceso a su título', access.status === 200 && access.json?.allowed === true, access.text.slice(0, 120));
    const lib = await call(S2, G('/api/library/personal'), { cookie: C['ra-1'] }), me = await call(S1, G('/api/auth/me'), { cookie: C['ra-1'] });
    ok('biblioteca personal y /api/auth/me del lector → 200', lib.status === 200 && me.status === 200, `${lib.status} ${me.status}`);
    const again = await call(S2, ['POST', '/api/progress/ra-1/c1/sync', { canonicalProgress: { ...CP, globalPercentage: 55, anchor: { type: 'text', value: 55 }, viewportHint: 55 }, updatedAt: new Date(Date.now() + 1000).toISOString() }], { cookie: C['ra-1'] });
    const after = await call(S1, G('/api/progress/item/ra-1/c1'), { cookie: C['ra-1'] });
    ok('progreso propio: el lector sigue guardando y leyendo su avance entre réplicas', again.status === 200 && after.status === 200 && after.json?.progress != null, `${again.status} ${after.text.slice(0, 100)}`);
    const foreignSync = await call(S1, ['POST', '/api/progress/ra-1/c1/sync', { canonicalProgress: CP, updatedAt: new Date().toISOString() }], { cookie: C['med-a'] });
    ok('nadie escribe el progreso de otro (mediador incluido) → rechazado', [401, 403].includes(foreignSync.status), String(foreignSync.status));
    const ms = await call(S2, G('/api/metrics/student/ra-1'), { cookie: C['ra-1'] }), msMed = await call(S1, G('/api/metrics/student/ra-1'), { cookie: C['med-a'] });
    ok('métricas individuales: el lector las suyas → 200; el mediador → 403 (sin cambio)', ms.status === 200 && msMed.status === 403, `${ms.status} ${msMed.status}`);
    const lu = await call(S1, G('/api/lu/version')), health = await call(S2, G('/api/health'));
    ok('LU (/api/lu/version) y salud → sin cambio', lu.status === 200 && health.status === 200, `${lu.status} ${health.status}`);
    const sch = await call(S1, G('/api/metrics/schools'), { cookie: C['med-a'] }), users = await call(S2, G('/api/users'), { cookie: C['med-a'] }), groups = await call(S1, G('/api/groups'), { cookie: C['med-a'] });
    ok('rutas vecinas del mediador (colegios, usuarios, grupos) → 200', sch.status === 200 && users.status === 200 && groups.status === 200, `${sch.status} ${users.status} ${groups.status}`);

    ok('ningún registro del servidor contiene cookies, contraseñas ni el secreto de máquina', ![S1.out, S2.out].some((o) => o.includes(PW) || o.includes(MACHINE) || Object.values(C).some((c) => c && o.includes(c.split('=')[1]))));

    if (process.env.SEC04_MATRIX) {
        const ACTORS = ['ra-1', 'med-a', 'med-b', 'med-none', 'adm'].filter((a) => C[a]);
        const ROUTES = [...progressOf('ra-1'), ...progressOf('rb-1'), ...progressOf('b2c-1'), ...progressOf('b2c-in'), MC('g-a'), RC('g-a'), MC('g-b'), RC('g-b'), ...GLOBAL_GET, ...WRITES];
        const matrix = {};
        for (const route of ROUTES) { matrix[name(route)] = {}; for (const a of ACTORS) { const r = await call(S1, route, { cookie: C[a] }); matrix[name(route)][a] = route[1].includes('/course/') && r.status === 200 ? `200[${ids(r)}]` : r.status; } }
        fs.writeFileSync(process.env.SEC04_MATRIX, JSON.stringify(matrix, null, 1));
    }
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally {
    S1.child.kill(); S2.child.kill(); await sleep(300); fs.rmSync(tmp, { recursive: true, force: true });
    if (machine) { try { fs.rmSync(SECRET_FILE, { force: true }); } catch { /* */ } }
}

console.log(`\nlegacyAuthzHotfixHttp — ${pass} ✓, ${fail} ✗${skipped ? `, ${skipped} omitidos (no cuentan como aprobados)` : ''}`);
process.exit(fail === 0 ? 0 : 1);
