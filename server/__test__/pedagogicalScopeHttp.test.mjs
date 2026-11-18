/**
 * pedagogicalScopeHttp.test.mjs — CHP V9 F7-C2.
 *
 * Alcance pedagógico del seguimiento individual. CIS + A2 + C005 deciden si un mediador puede acompañar a un lector;
 * hasta ahora, cumplidos los tres, recibía TODA su actividad lectora: también la de una compra personal y la de obras
 * institucionales ajenas al curso. Ahora solo entra la actividad de las obras ASOCIADAS a los grupos que el mediador
 * media y de los que el lector es miembro (reglas de acceso de ámbito `group`; en datos heredados, los campos del grupo).
 *
 * El mismo lector `ra-1` tiene:
 *   c1  obra asignada a su curso g-a                (regla de grupo)
 *   c2  obra institucional ajena al curso           (regla de organización)
 *   c3  lectura personal comprada                   (regla de usuario con marca b2c)
 * Las sesiones de c2 y c3 son enormes a propósito: si entraran en un total o en un promedio, se notaría.
 *
 * Dos instituciones, tres cursos, dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce, sesiones, registro de
 * decisiones y almacenes sintéticos COMPARTIDOS; cookies reales emitidas por /api/auth/login.
 *   [1] lectura del curso propio            [6] C005 ausente o revocado
 *   [2] obra institucional ajena al curso   [7] informe, Leo y exportación
 *   [3] lectura personal comprada           [8] agregados
 *   [4] lector de otro curso o institución  [9] el lector y la administración
 *   [5] A2 ausente o revocada               [10] sesiones falsas o contradictorias   [11] curso sin obras asociadas
 * Los secretos de sesión exigen permisos POSIX: en win32 la suite se OMITE (no cuenta como aprobada) y en CI una
 * omisión es un fallo. Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/pedagogicalScopeHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers/freePort.mjs';

if (process.platform === 'win32') {
    console.log('pedagogicalScopeHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 400)), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f7c2_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key') };
fs.mkdirSync(P.data, { recursive: true });
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const med = (id, org) => acct(id, ['mediador'], { mediatorKind: 'teacher', ...org });
const reader = (id, org = {}, extra = {}) => acct(id, ['lector'], { ...org, ...extra });
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']),
    med('med-a', A), med('med-a2', A), med('med-noc', A), med('med-z', A), med('med-b', B),
    reader('ra-1', A), reader('ra-noa2', A), reader('ra-x', A), reader('ra-z', A), reader('rb-1', B),
    reader('b2c', {}, { b2c: true, createdVia: 'b2c-provision' }),
]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
fs.writeFileSync(P.groups, JSON.stringify([
    grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a', 'med-noc'], ['ra-1', 'ra-noa2']),
    grp('g-a2', 'Quinto B', A, 'Colegio Alfa', ['med-a2'], ['ra-x']),
    grp('g-z', 'Quinto Z', A, 'Colegio Alfa', ['med-z'], ['ra-z']),          // curso SIN obras asociadas
    grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], ['rb-1']),
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
const TITLES = { c1: 'Obra del curso', c2: 'Obra institucional ajena', c3: 'Lectura personal comprada', c4: 'Obra del otro curso', cb: 'Obra de la otra institución' };
fs.writeFileSync(P.content, JSON.stringify(Object.entries(TITLES).map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1'], collectionIds: [] },
    { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c4'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-org-a', scope: 'organization', scopeId: 'org-a', titleIds: ['c2'], collectionIds: [] },
    { id: 'r-b2c-ra1', scope: 'user', scopeId: 'ra-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-1' } },
    { id: 'r-b2c', scope: 'user', scopeId: 'b2c', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-2' } },
]));
const T0 = Date.now() - 3 * 86400000;
const BIG2 = 9000000, BIG3 = 7000000;
const events = [];
const session = (userId, contentId, d, at) => {
    // V9 65A: `receivedAt` es el sello de recepción que la ingesta pone a cada evento; sin él su fecha no sirve para atribuir.
    events.push({ event: 'session_start', userId, contentId, timestamp: at, streak: 0, receivedAt: at + 5000 });
    events.push({ event: 'block_complete', userId, contentId, timestamp: at + 1000, streak: 1, receivedAt: at + 1000 + 5000 });
    events.push({ event: 'session_end', userId, contentId, timestamp: at + d, sessionDuration: d, progressPercentage: 50, receivedAt: at + d + 5000 });
};
session('ra-1', 'c1', 60000, T0); session('ra-1', 'c2', BIG2, T0 + 3600000); session('ra-1', 'c3', BIG3, T0 + 7200000 + BIG2);
session('ra-x', 'c4', 45000, T0); session('ra-z', 'c2', 30000, T0); session('rb-1', 'cb', 45000, T0);
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(events));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const REG = a2RegistryPath();
grantA2(['ra-1', 'ra-x', 'ra-z', 'rb-1']);
grantC005(['med-a', 'med-a2', 'med-z', 'med-b']);

// V9 F7-C2R-U3B: la procedencia (obra–curso y membresía) consta desde antes de la actividad de esta suite.
const { ledgerEnv } = await (await import('./helpers/seedContextLedger.mjs')).seedContextLedger({ groupsPath: P.groups, accessPath: P.access, insightsPath: path.join(P.data, 'insights.db') });
const ports = await freePorts(2);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock', ...ledgerEnv,
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* aún no */ } await sleep(150); } throw new Error(`nunca healthy\n${s.out.slice(-1500)}`); };
const get = async (s, p, { cookie, headers = {} } = {}) => {
    const r = await fetch(`${s.base}${p}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
    const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text, type: r.headers.get('content-type') || '', bytes: buf.length };
};
const post = async (s, p, cookie, body) => {
    const r = await fetch(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
};
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};
// Las dos réplicas, siempre.
const both = async (p, opts) => [await get(S1, p, opts), await get(S2, p, opts)];
const st = (rs) => rs.map((r) => r.status).join(' ');
const every = (rs, f) => rs.every(f);
// Nada de las obras excluidas: ni su id, ni su título, ni cifras de sus sesiones.
const OUT = /"c2"|"c3"|Obra institucional ajena|Lectura personal comprada/;
const clean = (r) => !OUT.test(r.text) && !r.text.includes(String(BIG2)) && !r.text.includes(String(BIG3));
const row = (r, id = 'ra-1') => (r.json?.studentBreakdown ?? []).find((x) => x.userId === id);
const DENIED = '{"error":"Acceso denegado"}';

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-noc', 'med-z', 'med-b', 'ra-1', 'ra-x', 'ra-z', 'rb-1', 'b2c']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const CP = (pct, u = 'x') => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: pct, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'text', anchor: { type: 'text', value: pct }, viewportHint: pct }, updatedAt: new Date().toISOString(), session: { sessionId: `s-${u}-${Date.now()}`, mode: 'text', durationSec: 60 } });
    const saved = [];
    for (const [u, c, pct] of [['ra-1', 'c1', 40], ['ra-1', 'c2', 55], ['ra-1', 'c3', 70], ['ra-x', 'c4', 30], ['ra-z', 'c2', 20], ['rb-1', 'cb', 25], ['b2c', 'c3', 80]]) saved.push((await post(S1, `/api/progress/${u}/${c}/sync`, C[u], CP(pct, u))).status);
    ok('preparación: cada lector guarda su propio progreso (el mismo lector en sus tres obras)', saved.every((x) => x === 200), saved.join(' '));
    const sub = await post(S2, '/api/submissions', C['ra-1'], { taskId: 't-ga', studentId: 'ra-1', groupId: 'g-a', responseText: 'Entrega sintética del curso.', contentId: 'c1', taskTitle: 'Tarea del curso' });
    ok('preparación: el lector entrega una tarea de su curso', sub.status === 201, `${sub.status} ${sub.text.slice(0, 120)}`);

    console.log('[1] lectura del curso propio: acceso autorizado');
    let list = await both('/api/progress/user/ra-1', { cookie: C['med-a'] });
    ok('progreso del lector → 200 con la obra del curso, en las dos réplicas', every(list, (r) => r.status === 200 && r.json.progressList.length === 1 && r.json.progressList[0].contentId === 'c1'), st(list));
    let item = await both('/api/progress/item/ra-1/c1', { cookie: C['med-a'] });
    ok('progreso de la obra del curso → 200 con su avance real', every(item, (r) => r.status === 200 && r.json.progress?.canonicalProgress?.globalPercentage === 40), st(item));
    let rp = await both('/api/reading-progress/ra-1', { cookie: C['med-a'] });
    ok('lectura resumida → 200: una obra, con su título, y el resumen cuenta una', every(rp, (r) => r.status === 200 && r.json.summary.total === 1 && r.json.readingProgress.length === 1 && r.json.readingProgress[0].contentId === 'c1' && r.json.readingProgress[0].title === TITLES.c1), st(rp));
    ok('lectura de la obra del curso → 200', every(await both('/api/reading-progress/ra-1/c1', { cookie: C['med-a'] }), (r) => r.status === 200 && r.json.readingProgress?.contentId === 'c1'));

    console.log('[2] obra institucional ajena al curso: sin acceso para el mediador');
    const inst = [...await both('/api/progress/item/ra-1/c2', { cookie: C['med-a'] }), ...await both('/api/reading-progress/ra-1/c2', { cookie: C['med-a'] })];
    ok('progreso y lectura de la obra institucional → 403, con la MISMA respuesta que un lector fuera de alcance', every(inst, (r) => r.status === 403 && r.text === DENIED), `${st(inst)} ${inst[0].text}`);
    ok('…y no aparece en las listas: ni su id, ni su título, ni sus cifras', every([...list, ...rp], clean));
    const other = [...await both('/api/progress/item/ra-1/c4', { cookie: C['med-a'] }), ...await both('/api/progress/item/ra-1/no-existe', { cookie: C['med-a'] })];
    ok('una obra de otro curso o inexistente responde igual (no revela si el lector la leyó)', every(other, (r) => r.status === 403 && r.text === DENIED), st(other));

    console.log('[3] lectura personal comprada: sin acceso');
    const pers = [...await both('/api/progress/item/ra-1/c3', { cookie: C['med-a'] }), ...await both('/api/reading-progress/ra-1/c3', { cookie: C['med-a'] })];
    ok('progreso y lectura de la compra personal del lector institucional → 403, misma respuesta', every(pers, (r) => r.status === 403 && r.text === DENIED), st(pers));
    const acc = await both('/api/access/by-user/ra-1', { cookie: C['med-a'] });
    ok('la asignación operativa que ve el mediador sigue sin las compras', every(acc, (r) => r.status === 200 && !r.text.includes('c3') && !r.text.includes('r-b2c')), st(acc));
    const b2c = [...await both('/api/progress/user/b2c', { cookie: C['med-a'] }), ...await both('/api/reading-progress/b2c', { cookie: C['med-a'] }), ...await both('/api/students/b2c/status', { cookie: C['med-a'] })];
    ok('una cuenta personal B2C sigue completamente fuera de alcance', every(b2c, (r) => r.status === 403 && !/Cuenta b2c|c3/.test(r.text)), st(b2c));

    console.log('[4] lector de otro curso o institución: rechazo');
    const foreign = [];
    for (const [who, target] of [['med-a', 'ra-x'], ['med-a', 'rb-1'], ['med-a2', 'ra-1'], ['med-b', 'ra-1']]) for (const p of [`/api/progress/user/${target}`, `/api/reading-progress/${target}`, `/api/students/${target}/status`, `/api/leo/mediator/student/${target}`]) foreign.push(...await both(p, { cookie: C[who] }));
    ok('lector de otro curso de la misma institución, de otra institución, y mediador de otro curso → 403 sin datos', every(foreign, (r) => r.status === 403 && !/Cuenta ra-|Cuenta rb-|progressList|readingProgress/.test(r.text)), st(foreign));
    const m2 = await both('/api/progress/user/ra-x', { cookie: C['med-a2'] });
    ok('control: el mediador del otro curso sí lee a SU lector, y solo la obra de su curso', every(m2, (r) => r.status === 200 && r.json.progressList.map((x) => x.contentId).join() === 'c4'), st(m2));

    console.log('[5] A2 ausente o revocada: rechazo');
    const noa2 = [...await both('/api/progress/user/ra-noa2', { cookie: C['med-a'] }), ...await both('/api/students/ra-noa2/status', { cookie: C['med-a'] })];
    ok('lector del curso sin A2 → 403', every(noa2, (r) => r.status === 403), st(noa2));
    grantA2(['ra-1'], 'revoked');
    const rev = [...await both('/api/progress/user/ra-1', { cookie: C['med-a'] }), ...await both('/api/progress/item/ra-1/c1', { cookie: C['med-a'] }), ...await both('/api/reading-progress/ra-1', { cookie: C['med-a'] })];
    ok('A2 revocada → 403 de inmediato en las dos réplicas, también para la obra del curso', every(rev, (r) => r.status === 403), st(rev));
    grantA2(['ra-1']);
    list = await both('/api/progress/user/ra-1', { cookie: C['med-a'] });
    ok('A2 concedida de nuevo → vuelve el acceso, otra vez solo a la obra del curso', every(list, (r) => r.status === 200 && r.json.progressList.map((x) => x.contentId).join() === 'c1'), st(list));

    console.log('[6] C005 ausente o revocado: rechazo');
    const noc = [...await both('/api/progress/user/ra-1', { cookie: C['med-noc'] }), ...await both('/api/progress/item/ra-1/c1', { cookie: C['med-noc'] }), ...await both('/api/students/ra-1/status', { cookie: C['med-noc'] })];
    ok('mediador del curso sin C005 → 403 aunque el lector tenga A2', every(noc, (r) => r.status === 403), st(noc));
    grantC005(['med-a'], { status: 'revoked' });
    const rc5 = [...await both('/api/progress/user/ra-1', { cookie: C['med-a'] }), ...await both('/api/reading-progress/ra-1/c1', { cookie: C['med-a'] })];
    ok('C005 revocado → 403 de inmediato en las dos réplicas', every(rc5, (r) => r.status === 403), st(rc5));
    grantC005(['med-a']);
    ok('C005 concedido de nuevo → vuelve el acceso', every(await both('/api/progress/item/ra-1/c1', { cookie: C['med-a'] }), (r) => r.status === 200));

    console.log('[7] informe, Leo y exportación: los mismos límites');
    const mc = await both('/api/metrics/course/g-a', { cookie: C['med-a'] }), rc = await both('/api/reports/course/g-a', { cookie: C['med-a'] });
    ok('métricas e informe del curso → 200 sin rastro de las otras obras (id, título ni cifras)', every([...mc, ...rc], (r) => r.status === 200 && clean(r)), st([...mc, ...rc]));
    ok('…el lector figura con UNA sesión y el tiempo de la obra del curso, no con el de sus otras lecturas', every([...mc, ...rc], (r) => row(r)?.totalSessions === 1 && row(r)?.totalReadingTimeMs === 60000), JSON.stringify(row(mc[0])).slice(0, 300));
    ok('…y su detalle de lectura nombra solo la obra del curso', every(mc, (r) => { const d = row(r)?.readingDetails ?? {}; const all = [...(d.inProgress ?? []), ...(d.completed ?? []), ...(d.abandoned ?? [])]; return all.length === 1 && all[0].contentId === 'c1' && row(r).contentsInProgress === 1; }));
    const leo = [...await both('/api/leo/mediator/student/ra-1', { cookie: C['med-a'] }), ...await both('/api/leo/activation/ra-1', { cookie: C['med-a'] })];
    ok('Leo del mediador: resumen y activación → 200 sin las otras obras', every(leo, (r) => r.status === 200 && clean(r)), st(leo));
    const lh = [...await both('/api/leo/mediator/student/ra-1/content/c3', { cookie: C['med-a'] }), ...await both('/api/leo/mediator/student/ra-1/content/c2', { cookie: C['med-a'] })];
    const lout = await both('/api/leo/mediator/student/rb-1/content/cb', { cookie: C['med-a'] });
    ok('Leo por obra: la compra personal y la obra institucional → 403, igual que un lector fuera de alcance', every(lh, (r) => r.status === 403 && r.json?.error === 'scope_access_denied') && every(lout, (r) => r.status === 403 && r.json?.error === lh[0].json?.error), `${st(lh)} | ${st(lout)}`);
    ok('…y la obra del curso → 200', every(await both('/api/leo/mediator/student/ra-1/content/c1', { cookie: C['med-a'] }), (r) => r.status === 200 && r.json?.history?.contentId === 'c1'));
    const ex = await both('/api/students/ra-1/export-submissions', { cookie: C['med-a'] }), ext = await both('/api/tasks/t-ga/export-submissions', { cookie: C['med-a'] });
    ok('exportación de las entregas del curso → ZIP para su mediador', every([...ex, ...ext], (r) => r.status === 200 && /zip/.test(r.type) && r.bytes > 0), st([...ex, ...ext]));
    const exNo = [...await both('/api/students/ra-1/export-submissions', { cookie: C['med-a2'] }), ...await both('/api/tasks/t-ga/export-submissions', { cookie: C['med-b'] }), ...await both('/api/students/ra-1/export-submissions', { cookie: C['med-noc'] })];
    ok('…y negada al mediador de otro curso, de otra institución y al que no tiene C005', every(exNo, (r) => r.status === 403), st(exNo));

    const iv = await post(S1, '/api/interventions', C['med-a'], { mediatorId: 'med-a', studentId: 'ra-1', courseId: 'g-a', type: 'lectura_guiada', note: 'Nota sintética.' });
    const ivs = [...await both('/api/interventions/student/ra-1', { cookie: C['med-a'] }), ...await both('/api/interventions/effectiveness?courseId=g-a', { cookie: C['med-a'] })];
    ok('intervenciones del lector y su efectividad → 200 sin rastro de las otras obras', iv.status < 300 && every(ivs, (r) => r.status === 200 && clean(r)), `${iv.status} ${st(ivs)} ${iv.text.slice(0, 120)}`);

    console.log('[8] agregados: sin reconstruir lo excluido');
    const stt = await both('/api/students/ra-1/status', { cookie: C['med-a'] });
    ok('estado del lector: libros iniciados y promedio SOLO de la obra del curso (1 y 40 %, no 3 y 55 %)', every(stt, (r) => r.status === 200 && r.json.progress.booksStarted === 1 && r.json.progress.percentage === 40), JSON.stringify(stt[0].json?.progress));
    const an = await both('/api/groups/g-a/analytics-summary', { cookie: C['med-a'] });
    ok('resumen del grupo: el lector cuenta un libro y el total del grupo también', every(an, (r) => r.status === 200 && r.json.readers.find((x) => x.userId === 'ra-1')?.progress.booksStarted === 1 && r.json.progress.booksStarted === 1 && clean(r)), JSON.stringify(an[0].json?.progress));
    ok('promedios y totales del curso: ninguna cifra cambia por las lecturas excluidas', every(mc, (r) => r.json.summary.studentCount === 1 && r.json.summary.activeStudentCount === 1 && !JSON.stringify(r.json.backboneMetrics ?? {}).includes('"c2"') && !JSON.stringify(r.json.backboneMetrics ?? {}).includes('"c3"')), JSON.stringify(mc[0].json?.summary));

    console.log('[9] el lector y la administración conservan lo suyo');
    const own = await both('/api/progress/user/ra-1', { cookie: C['ra-1'] }), ownRp = await both('/api/reading-progress/ra-1', { cookie: C['ra-1'] });
    ok('el lector ve todo su progreso: las tres obras', every(own, (r) => r.status === 200 && r.json.progressList.map((x) => x.contentId).sort().join() === 'c1,c2,c3') && every(ownRp, (r) => r.json.summary.total === 3), st(own));
    const ownItems = []; for (const c of ['c1', 'c2', 'c3']) ownItems.push(...await both(`/api/progress/item/ra-1/${c}`, { cookie: C['ra-1'] }));
    ok('…y cada obra con su avance (40, 55 y 70 %)', ownItems.map((r) => r.json?.progress?.canonicalProgress?.globalPercentage).join() === '40,40,55,55,70,70', ownItems.map((r) => r.status).join(' '));
    ok('…y su propio estado cuenta sus tres libros', every(await both('/api/students/ra-1/status', { cookie: C['ra-1'] }), (r) => r.status === 200 && r.json.progress.booksStarted === 3));
    const admP = await both('/api/progress/user/ra-1', { cookie: C.adm }), admS = await both('/api/students/ra-1/status', { cookie: C.adm });
    ok('la administración de plataforma no cambia: progreso completo y estado completo', every(admP, (r) => r.status === 200 && r.json.progressList.length === 3) && every(admS, (r) => r.status === 200 && r.json.progress.booksStarted === 3), `${st(admP)} ${st(admS)}`);
    const admC = await both('/api/metrics/course/g-a', { cookie: C.adm });
    ok('…y del curso sigue recibiendo solo agregados, sin desglose', every(admC, (r) => r.status === 200 && r.json.aggregateOnly === true && !('studentBreakdown' in r.json)), st(admC));
    const admAn = await both('/api/groups/g-a/analytics-summary', { cookie: C.adm });
    ok('…y su resumen del grupo es el de siempre (toda la lectura de la cohorte)', every(admAn, (r) => r.status === 200 && r.json.progress.booksStarted === 3), JSON.stringify(admAn[0].json?.progress));

    console.log('[10] sesiones falsas o contradictorias: rechazo');
    const paths = ['/api/progress/user/ra-1', '/api/progress/item/ra-1/c1', '/api/reading-progress/ra-1', '/api/reading-progress/ra-1/c1', '/api/students/ra-1/status', '/api/metrics/course/g-a', '/api/groups/g-a/analytics-summary', '/api/leo/mediator/student/ra-1'];
    const noCookie = [], junk = [], contra = [], hdr = [];
    for (const p of paths) {
        noCookie.push(...await both(p, { headers: { 'x-user-id': 'med-a' } }));
        junk.push(...await both(p, { cookie: 'chp_session=no-es-un-token', headers: { 'x-user-id': 'med-a' } }));
        contra.push(...await both(p, { cookie: C['rb-1'], headers: { 'x-user-id': 'med-a' } }));
        hdr.push(...await both(p, { cookie: C['med-b'], headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } }));
    }
    const refused = (r) => [401, 403].includes(r.status) && !/progressList|readingProgress|studentBreakdown|Cuenta ra-1/.test(r.text);
    ok('sin cookie y con la cabecera del mediador → rechazado en todas', every(noCookie, refused), st(noCookie));
    ok('cookie inventada → rechazado en todas', every(junk, refused), st(junk));
    ok('cookie de un lector de otra institución + cabecera del mediador → rechazado', every(contra, refused), st(contra));
    ok('cookie de un mediador ajeno + cabecera de administrador → rechazado (sin escalamiento)', every(hdr, refused), st(hdr));
    const logout = await post(S1, '/api/auth/logout', C['med-a2'], {});
    ok('sesión cerrada → su cookie deja de servir en las dos réplicas', logout.status < 400 && every(await both('/api/progress/user/ra-x', { cookie: C['med-a2'] }), (r) => [401, 403].includes(r.status)), String(logout.status));

    console.log('[11] curso sin obras asociadas: no se infiere pertenencia');
    const z = await both('/api/progress/user/ra-z', { cookie: C['med-z'] }), zi = await both('/api/progress/item/ra-z/c2', { cookie: C['med-z'] }), zs = await both('/api/students/ra-z/status', { cookie: C['med-z'] });
    ok('el mediador conserva el acceso al lector, pero sin actividad por obra: lista vacía, obra → 403, cero libros', every(z, (r) => r.status === 200 && r.json.progressList.length === 0) && every(zi, (r) => r.status === 403 && r.text === DENIED) && every(zs, (r) => r.status === 200 && r.json.progress.booksStarted === 0), `${st(z)} ${st(zi)} ${st(zs)}`);
    const zc = await both('/api/metrics/course/g-z', { cookie: C['med-z'] });
    ok('…y su tablero muestra al lector sin sesiones ni obras', every(zc, (r) => r.status === 200 && row(r, 'ra-z')?.totalSessions === 0 && !/"c2"/.test(r.text)), JSON.stringify(row(zc[0], 'ra-z')).slice(0, 200));
} catch (e) {
    console.error('ERROR', e?.stack || e); fail++;
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\npedagogicalScopeHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
