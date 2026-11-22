/**
 * adminSchoolCourseMetricsHttp.test.mjs — V9 F5-E4.
 *
 * Métricas e informes por colegio y curso para la administración HUMANA. Antes solo las abría la autoridad de máquina
 * (`x-admin-secret`), así que el panel institucional de un administrador con sesión no podía mostrar ni un colegio.
 *
 *   GET /api/metrics/school/:id     GET /api/metrics/course/:id
 *   GET /api/reports/school/:id     GET /api/reports/course/:id
 *
 * Ahora: administrador de plataforma con sesión firmada y cuenta activa → 200, SOLO agregados. En las de curso se
 * retiran `studentBreakdown`, `topPerformers` y `needsAttention` y la respuesta lo declara (`aggregateOnly`): el rol no
 * concede por sí mismo el desglose individual. Autoridad de máquina y mediador (CIS + A2 + C005) no cambian.
 *
 * Dos réplicas de server.js REAL, sesión obligatoria (enforce), dos instituciones, cookies reales del login. POSIX-only
 * (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo. La autoridad de
 * máquina se prueba solo si /app/secrets es escribible por el proceso; si no, esos casos se informan como OMITIDOS.
 *
 *   node server/__test__/adminSchoolCourseMetricsHttp.test.mjs
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
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';

if (process.platform === 'win32') {
    console.log('adminSchoolCourseMetricsHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0, skipped = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 400)), fail++);
const skip = (l) => { console.log('  – OMITIDO (no cuenta como aprobado):', l); skipped++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f5e4_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), key: path.join(tmp, 'session.key'), sessions: path.join(tmp, 'sessions.db') };
fs.mkdirSync(P.data, { recursive: true });
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Persona ${id}`, roles, accountStatus: 'active', ...extra });
const RA = ['ra-1', 'ra-2', 'ra-3'], RB = ['rb-1', 'rb-2'];
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']), acct('adm-off', ['administrador']), acct('adm-tmp', ['administrador']),
    acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }),
    acct('med-noc', ['mediador'], { mediatorKind: 'teacher', ...A }),
    ...RA.map((id) => acct(id, ['lector'], A)), acct('ra-noa2', ['lector'], A), ...RB.map((id) => acct(id, ['lector'], B)),
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a', 'med-noc'], memberIds: [...RA, 'ra-noa2'], studentIds: [...RA, 'ra-noa2'] },
    { id: 'g-b', name: 'Sexto B', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: RB, studentIds: RB },
    { id: 'g-vacio', name: 'Club sin nómina', type: 'club', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: [], studentIds: [] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
// V9 65E-B: el agregado de la administración cuenta solo la actividad de las obras ASOCIADAS al curso (antes, toda la
// lectura de la nómina). La obra que leen estos lectores queda asociada a sus cursos, como en una instalación real.
fs.writeFileSync(P.access, JSON.stringify(['g-a', 'g-b'].map((g) => ({ id: `r-${g}`, scope: 'group', scopeId: g, titleIds: ['c1'], collectionIds: [] })))); fs.writeFileSync(P.content, '[]');
const T0 = Date.now() - 3 * 86400000, events = [];
for (const [i, userId] of [...RA, 'ra-noa2', ...RB].entries()) {
    const d = 60000 * (i + 1);
    events.push({ event: 'session_start', userId, contentId: 'c1', timestamp: T0, streak: 0 });
    events.push({ event: 'block_complete', userId, contentId: 'c1', timestamp: T0 + 1000, streak: 1 });
    events.push({ event: 'session_end', userId, contentId: 'c1', timestamp: T0 + d, sessionDuration: d, progressPercentage: 50 });
}
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(events));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
const REG = a2RegistryPath();
grantA2([...RA, ...RB]); grantA2(['ra-noa2'], 'denied'); grantC005(['med-a', 'med-b']);   // med-noc: sin compromiso 005

// Autoridad de máquina: el secreto solo se lee de la ruta canónica, propiedad del proceso y 0400.
const SECRET_DIR = '/app/secrets', SECRET_FILE = `${SECRET_DIR}/admin_secret`, MACHINE = crypto.randomBytes(24).toString('hex');
let machine = false;
try { if (!fs.existsSync(SECRET_FILE)) { fs.mkdirSync(SECRET_DIR, { recursive: true }); fs.writeFileSync(SECRET_FILE, MACHINE, { mode: 0o400 }); fs.chmodSync(SECRET_FILE, 0o400); machine = true; } } catch { machine = false; }

const ports = await freePorts(2);
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted',
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), INSIGHTS_SQLITE_PATH: path.join(P.data, `insights-${i}.db`), ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const ready = async (s) => { for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(200); } throw new Error(`server no arrancó\n${s.out.slice(-1500)}`); };
const call = async (s, p, { cookie, headers = {}, method = 'GET' } = {}) => {
    const post = method !== 'GET';
    const r = await fetch(`${s.base}${p}`, { method, headers: { ...(post ? { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: post ? '{}' : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const SCHOOL = ['/api/metrics/school/colegio-alfa', '/api/reports/school/colegio-alfa'];
const COURSE = ['/api/metrics/course/g-a', '/api/reports/course/g-a'];
const FOUR = [...SCHOOL, ...COURSE];
const INDIVIDUAL_KEYS = ['studentBreakdown', 'topPerformers', 'needsAttention'];
const READER_IDS = [...RA, 'ra-noa2', ...RB];
// Ni identificadores, ni nombres, ni correos de lectores; tampoco campos que solo existen por persona.
const INDIVIDUAL = new RegExp(`${READER_IDS.map((id) => `"${id}"`).join('|')}|Persona (ra|rb)-|fixture\\.invalid|"userId"|"name":"|pedagogicalProfile|readingDetails|lastAccessAt|nombre_completo`);
const PRIVATE = /studentBreakdown|productMetrics|summary|courseBreakdown|backboneMetrics|Persona |fixture\.invalid|Colegio|Quinto|Sexto/;
const denied = (r) => [401, 403].includes(r.status) && !PRIVATE.test(r.text);
const both = async (p, opts) => [await call(S1, p, opts), await call(S2, p, opts)];
const all = async (paths, opts) => { const out = []; for (const p of paths) out.push(...await both(p, opts)); return out; };
const st = (rs) => rs.map((r) => r.status).join(' ');
const ids = (r) => (r.json?.studentBreakdown ?? []).map((s) => s.userId).sort().join(',');
const breakRegistry = () => { fs.copyFileSync(REG, `${REG}.ok`); fs.appendFileSync(REG, '{no es json\n'); };
const fixRegistry = () => fs.copyFileSync(`${REG}.ok`, REG);
const setStatus = (id, status) => { const u = JSON.parse(fs.readFileSync(P.users, 'utf8')); u.find((x) => x.id === id).accountStatus = status; fs.writeFileSync(P.users, JSON.stringify(u)); };

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const [i, id] of ['adm', 'adm-off', 'adm-tmp', 'med-a', 'med-b', 'med-noc', 'ra-1', 'rb-1'].entries()) C[id] = await login(i % 2 ? S2 : S1, id);

    console.log('[1] administrador activo con su sesión: 200 en las cuatro rutas');
    const adm = {};
    for (const p of FOUR) { adm[p] = await both(p, { cookie: C.adm }); ok(`${p} → 200 en las dos réplicas`, adm[p].every((r) => r.status === 200), st(adm[p])); }
    const admB = await all(['/api/metrics/school/colegio-beta', '/api/reports/school/colegio-beta', '/api/metrics/course/g-b', '/api/reports/course/g-b'], { cookie: C.adm });
    ok('…también para la otra institución (administración de plataforma)', admB.every((r) => r.status === 200), st(admB));
    const hdr = await all(FOUR, { cookie: C.adm, headers: { 'x-user-id': 'adm' } });
    ok('una cabecera que repite la identidad de la sesión no estorba', hdr.every((r) => r.status === 200), st(hdr));

    console.log('[2] la respuesta administrativa es agregada: sin personas');
    for (const p of FOUR) ok(`${p} · sin ids, nombres, correos ni campos por persona`, adm[p].every((r) => !INDIVIDUAL.test(r.text)), adm[p][0].text.match(INDIVIDUAL)?.[0]);
    for (const p of COURSE) {
        ok(`${p} · no trae desglose ni listas con nombre, y lo declara`, adm[p].every((r) => INDIVIDUAL_KEYS.every((k) => !(k in r.json)) && r.json.aggregateOnly === true), Object.keys(adm[p][0].json).join());
        ok(`${p} · los campos retirados NO se sustituyen por listas vacías ni ceros`, adm[p].every((r) => !/"studentBreakdown":\[\]|"topPerformers":\[\]|"needsAttention":\[\]/.test(r.text)));
    }
    const mcA = adm[COURSE[0]][0].json, rcA = adm[COURSE[1]][0].json;
    ok('curso: el agregado es del curso entero (los cuatro de la nómina, también quien no tiene A2)', mcA.summary.studentCount === 4 && mcA.summary.activeStudentCount === 4 && rcA.summary.studentCount === 4, JSON.stringify(mcA.summary));
    ok('curso: conserva resumen, promedios, niveles, distribuciones, alertas y backbone del curso', ['summary', 'productMetrics', 'readingLevels', 'icdli', 'distributions', 'alerts', 'backboneMetrics', 'courseId', 'courseName', 'computedAt'].every((k) => k in mcA), Object.keys(mcA).join());
    ok('curso: el backbone conserva su forma (uso, embudos, insights)', typeof mcA.backboneMetrics.totalEvents === 'number' && 'funnels' in mcA.backboneMetrics && 'insights' in mcA.backboneMetrics, JSON.stringify(mcA.backboneMetrics).slice(0, 120));
    ok('informe de curso: conserva `reportMeta` con su ventana de datos', rcA.reportMeta?.entityId === 'g-a' && rcA.reportMeta.entityType === 'course' && 'dataWindow' in rcA.reportMeta);
    const msA = adm[SCHOOL[0]][0].json, rsA = adm[SCHOOL[1]][0].json;
    ok('colegio: contrato de siempre (totales, promedios y una fila por curso)', ['schoolId', 'schoolName', 'summary', 'productMetrics', 'readingLevels', 'icdli', 'distributions', 'courseBreakdown', 'alerts', 'backboneMetrics'].every((k) => k in msA) && msA.summary.studentCount === 4 && rsA.reportMeta?.entityType === 'school', Object.keys(msA).join());
    ok('colegio: las filas por curso son solo de ESE colegio y solo agregados', msA.courseBreakdown.every((c) => c.courseId === 'g-a' && Object.keys(c).sort().join() === 'avgComposite,avgCritical,avgInferential,avgLiteral,avgReflective,courseId,courseName,studentCount') && !/g-b|Sexto|Beta/.test(JSON.stringify(msA.courseBreakdown)), JSON.stringify(msA.courseBreakdown).slice(0, 200));

    console.log('[3] administrador desactivado');
    const before = await all(FOUR, { cookie: C['adm-off'] });
    ok('activo → 200 (control)', before.every((r) => r.status === 200), st(before));
    setStatus('adm-off', 'disabled');
    const off = await all(FOUR, { cookie: C['adm-off'] });
    ok('la misma cookie con la cuenta desactivada → rechazado en las cuatro y en las dos réplicas, sin datos', off.every(denied), st(off));
    ok('…y no afecta a otro administrador', (await all(FOUR, { cookie: C.adm })).every((r) => r.status === 200));

    console.log('[4] lector');
    const rd = await all([...FOUR, '/api/metrics/course/g-b', '/api/metrics/school/colegio-beta'], { cookie: C['ra-1'] });
    ok('lector → 403 en colegio y curso (propios y ajenos), sin datos', rd.every((r) => r.status === 403 && denied(r)), st(rd));

    console.log('[5] mediador: su ámbito CIS + A2 + C005, sin cambios');
    const ms = await all(SCHOOL, { cookie: C['med-a'] });
    ok('mediador → métricas e informe de COLEGIO → 403 (siguen siendo de administración)', ms.every((r) => r.status === 403 && denied(r)), st(ms));
    const mc = await both(COURSE[0], { cookie: C['med-a'] }), rc = await both(COURSE[1], { cookie: C['med-a'] });
    ok('mediador → su curso → 200 CON su desglose de lectores elegibles (no la proyección agregada)', [...mc, ...rc].every((r) => r.status === 200 && ids(r) === 'ra-1,ra-2,ra-3' && !('aggregateOnly' in r.json) && INDIVIDUAL_KEYS.every((k) => k in r.json)), `${st(mc)} ${ids(mc[0])}`);
    ok('…sus agregados siguen contando solo a los elegibles (3), no a la nómina (4)', mc.every((r) => r.json.summary.studentCount === 3) && !mc[0].text.includes('ra-noa2'));
    const noc = await all(COURSE, { cookie: C['med-noc'] });
    ok('mediador sin C005 → 200 con cero personas, sin desglose con nombres (igual que antes)', noc.every((r) => r.status === 200 && r.json.summary.studentCount === 0 && ids(r) === '' && !INDIVIDUAL.test(r.text.replace(/"userId"/g, ''))), st(noc));

    console.log('[6] mediador de otra institución');
    const other = await all([...FOUR, '/api/metrics/course/g-vacio'], { cookie: C['med-b'] });
    ok('mediador de Beta → colegio y cursos de Alfa → 403, sin datos', other.every((r) => r.status === 403 && denied(r)), st(other));

    console.log('[7] sin cookie');
    const none = await all(FOUR), spoof = await all(FOUR, { headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } }), spoofM = await all(COURSE, { headers: { 'x-user-id': 'med-a' } });
    ok('sin cookie → rechazado, sin datos', none.every(denied), st(none));
    ok('sin cookie + x-user-id del administrador → rechazado', spoof.every(denied), st(spoof));
    ok('sin cookie + x-user-id del mediador → rechazado', spoofM.every(denied), st(spoofM));

    console.log('[8] cookie contradictoria, inventada o revocada');
    const contra = await all(FOUR, { cookie: C['ra-1'], headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } });
    ok('cookie de lector + cabecera del administrador → rechazado (sin escalamiento)', contra.every(denied), st(contra));
    const contraAdm = await all(FOUR, { cookie: C.adm, headers: { 'x-user-id': 'med-a' } });
    ok('cookie del administrador + cabecera de otra persona → rechazado (identidad contradictoria)', contraAdm.every(denied), st(contraAdm));
    const junk = await all(FOUR, { cookie: 'chp_session=no-es-un-token' });
    ok('cookie inventada → rechazado', junk.every(denied), st(junk));
    ok('sesión nueva del administrador → 200 (control)', (await all(FOUR, { cookie: C['adm-tmp'] })).every((r) => r.status === 200));
    const out = await call(S1, '/api/auth/logout', { method: 'POST', cookie: C['adm-tmp'] });
    const revoked = await all(FOUR, { cookie: C['adm-tmp'] });
    ok('tras cerrar esa sesión, su cookie queda revocada en las dos réplicas', out.status < 400 && revoked.every(denied), `${out.status} ${st(revoked)}`);
    { const db = new Database(P.sessions); try { db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'adm-off'").run(); } finally { db.close(); } }
    setStatus('adm-off', 'active');
    const expired = await all(FOUR, { cookie: C['adm-off'] });
    ok('sesión vencida de un administrador activo → rechazada', expired.every(denied), st(expired));

    console.log('[9] autoridad de máquina: contrato anterior intacto');
    if (machine) {
        const H = { headers: { 'x-admin-secret': MACHINE } };
        const mSchool = await all(SCHOOL, H), mCourse = await all(COURSE, H);
        ok('máquina → colegio → 200 con el contrato de siempre', mSchool.every((r) => r.status === 200 && 'courseBreakdown' in r.json && r.json.summary.studentCount === 4), st(mSchool));
        ok('máquina → curso → 200 COMPLETO: desglose de toda la nómina y listas con nombre, sin `aggregateOnly`', mCourse.every((r) => r.status === 200 && ids(r) === 'ra-1,ra-2,ra-3,ra-noa2' && INDIVIDUAL_KEYS.every((k) => k in r.json) && !('aggregateOnly' in r.json)), `${st(mCourse)} ${ids(mCourse[0])}`);
        ok('máquina → métricas de curso conservan el perfil pedagógico por estudiante', mCourse.slice(0, 2).every((r) => r.json.studentBreakdown.every((s) => 'pedagogicalProfile' in s)));
        ok('los AGREGADOS del administrador coinciden con los de la máquina (mismo curso, misma cuenta)', JSON.stringify(mCourse[0].json.summary) === JSON.stringify(mcA.summary) && JSON.stringify(mCourse[0].json.readingLevels) === JSON.stringify(mcA.readingLevels) && JSON.stringify(mSchool[0].json.summary) === JSON.stringify(msA.summary));
        ok('…incluido el backbone del curso: el mismo que recibe la máquina (acotado a sus miembros)', mCourse[0].json.backboneMetrics.totalEvents === mcA.backboneMetrics.totalEvents && mCourse[0].json.backboneMetrics.totalSessions === mcA.backboneMetrics.totalSessions);
        const bad = await all(FOUR, { headers: { 'x-admin-secret': `${MACHINE}x` } });
        ok('secreto de máquina incorrecto → rechazado', bad.every(denied), st(bad));
    } else skip('autoridad de máquina (admin-secret file-only): /app/secrets no es escribible por este proceso');

    console.log('[10] registro de decisiones indisponible: fallo cerrado donde corresponde');
    breakRegistry();
    try {
        const medDown = await all(COURSE, { cookie: C['med-a'] });
        ok('mediador → curso → 503 (su acceso individual depende del registro), sin datos', medDown.every((r) => r.status === 503 && !PRIVATE.test(r.text)), st(medDown));
        const admDown = await all(FOUR, { cookie: C.adm });
        ok('administrador → sus agregados no dependen del registro → 200, y siguen sin personas', admDown.every((r) => r.status === 200 && !INDIVIDUAL.test(r.text)), st(admDown));
        ok('…el registro caído no le abre el desglose', admDown.slice(4).every((r) => INDIVIDUAL_KEYS.every((k) => !(k in r.json))));
    } finally { fixRegistry(); }
    ok('registro restaurado → el mediador recupera su curso', (await both(COURSE[0], { cookie: C['med-a'] })).every((r) => r.status === 200 && ids(r) === 'ra-1,ra-2,ra-3'));

    console.log('[11] curso sin lectores');
    const emptyAdm = await all(['/api/metrics/course/g-vacio', '/api/reports/course/g-vacio'], { cookie: C.adm });
    ok('administrador → curso sin nómina → 200 con cero estudiantes y sin restos de nadie', emptyAdm.every((r) => r.status === 200 && r.json.summary.studentCount === 0 && r.json.aggregateOnly === true && !INDIVIDUAL.test(r.text)), st(emptyAdm));
    ok('…su backbone es la forma vacía, no el agregado de la plataforma', emptyAdm[0].json.backboneMetrics.totalEvents === 0 && emptyAdm[0].json.backboneMetrics.totalSessions === 0);
    const emptyMed = await both('/api/metrics/course/g-vacio', { cookie: C['med-a'] });
    ok('mediador → su curso sin lectores → 200 con cero personas y backbone vacío (igual que antes)', emptyMed.every((r) => r.status === 200 && r.json.summary.studentCount === 0 && ids(r) === '' && r.json.backboneMetrics.totalEvents === 0), st(emptyMed));
    const ghost = await all(['/api/metrics/course/no-existe', '/api/metrics/school/no-existe'], { cookie: C.adm });
    ok('administrador → curso o colegio inexistente → 404, no un resultado vacío', ghost.every((r) => r.status === 404), st(ghost));

    console.log('[12] nada más cambia');
    const glAdm = await all(['/api/metrics/backbone', '/api/metrics/insights/states', '/api/metrics/schools'], { cookie: C.adm });
    const glMed = await all(['/api/metrics/backbone', '/api/metrics/insights/states'], { cookie: C['med-a'] });
    ok('métricas globales: administrador 200, mediador 403 (sin cambio)', glAdm.every((r) => r.status === 200) && glMed.every((r) => r.status === 403), `${st(glAdm)} | ${st(glMed)}`);
    const prog = [await call(S1, '/api/progress/user/ra-1', { cookie: C['ra-1'] }), await call(S2, '/api/progress/user/ra-1', { cookie: C['med-a'] }), await call(S1, '/api/progress/user/ra-noa2', { cookie: C['med-a'] }), await call(S2, '/api/progress/user/ra-1', { cookie: C['med-b'] }), await call(S1, '/api/progress/user/rb-1', { cookie: C['ra-1'] })];
    ok('progreso: propio 200, mediador con A2+C005 200, sin A2 403, otra institución 403, lector ajeno 403 (sin cambio)', st(prog) === '200 200 403 403 403', st(prog));
    const student = await both('/api/metrics/student/ra-1', { cookie: C.adm });
    ok('métricas individuales de un lector: la sesión de administrador sigue sin abrirlas por esta vía', student.every((r) => r.status === 403), st(student));

    ok('ningún registro del servidor contiene cookies, contraseñas ni el secreto de máquina', ![S1.out, S2.out].some((o) => o.includes(PW) || o.includes(MACHINE) || Object.values(C).some((c) => o.includes(c.split('=')[1]))));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally {
    S1.child.kill(); S2.child.kill(); await sleep(300); fs.rmSync(tmp, { recursive: true, force: true });
    if (machine) { try { fs.rmSync(SECRET_FILE, { force: true }); } catch { /* */ } }
}

console.log(`\nadminSchoolCourseMetricsHttp — ${pass} ✓, ${fail} ✗${skipped ? `, ${skipped} omitidos (no cuentan como aprobados)` : ''}`);
process.exit(fail === 0 ? 0 : 1);
