/**
 * readingContinuityHttp.test.mjs — CHP V9 65D-1 (Bloque I). Fuentes de lectura y continuidad del seguimiento.
 *
 * El tablero del mediador y el informe de curso sacaban sesiones, tiempo y «actividad» SOLO de los eventos heredados
 * (analytics_db.json). El lector EPUB, el Álbum y LU sin telemetría registran su lectura en el progreso: el lector salía
 * «Inactivo» / «Sin datos» con lectura registrada. Aquí cada lectura entra por las RUTAS REALES y con el cuerpo que
 * envía cada cliente (EPUB y web de este repositorio; LU 0.9.2 según su código fuente, etiqueta cd24fda), y se
 * comprueba con números qué muestran el tablero y el informe en dos réplicas:
 *   [1] EPUB con sesiones → sesiones y minutos, sin nivel; no «Inactivo», fuera de atención
 *   [2] misma obra por telemetría y progreso → sin doble conteo; obra solo-progreso → se suma
 *   [3] LU 0.9.2 (progreso SIN sesión + eventos heredados fechados en el dispositivo, enviados después) → sus sesiones
 *   [4] reenvíos y guardados atrasados de la misma sesión → una sola sesión con su duración máxima
 *   [5] más de veinte sesiones de un libro → todas cuentan (constancias de recepción, 65A)
 *   [6] lectura anterior a la membresía → no atribuible, no «lee»; personal (B2C) → nunca del curso
 *   [7] A2 revocada → fuera; sin lectura → «sin actividad»
 *   [8] informe de curso y vista agregada de la administración → las mismas cifras
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/readingContinuityHttp.test.mjs
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
    console.log('readingContinuityHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 900)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65d1_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const reader = (id, org) => acct(id, ['lector'], { ...org });
// re-epub: solo EPUB · re-mix: telemetría + EPUB · re-lu: LU 0.9.2 · re-dup: reenvíos · re-many: 25 sesiones
// re-hist: lectura anterior a su ingreso · re-b2c: solo lectura personal · re-rev: A2 revocada · re-none: nada
const GA = ['re-epub', 're-mix', 're-lu', 're-dup', 're-many', 're-hist', 're-b2c', 're-rev', 're-none'];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', ['administrador']), acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }),
    acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }), ...GA.map((id) => reader(id, A)), reader('rb-1', B)]));
const GROUPS = [
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: GA, studentIds: GA },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-1'], studentIds: ['rb-1'] },
];
const RULES = [
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'cs'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c', scope: 'user', scopeId: 're-b2c', titleIds: ['cp'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-65D1' } },
];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['cs', 'Segunda obra del curso'], ['cp', 'Lectura personal comprada'], ['cb', 'Obra de la otra institución']]
    .map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
for (const f of ['analytics_db.json', 'leo_interactions_db.json']) fs.writeFileSync(path.join(P.data, f), '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));

const REG = a2RegistryPath();
grantA2([...GA, 'rb-1']);
grantC005(['med-a', 'med-b']);

// Procedencia: línea base hace 100 días; re-hist solo consta como miembro desde hace una hora.
const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
const Ledger = await import('../aulaViva/contextLedger.mjs');
Ledger.observeContext(GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds })), { nowTs: NOW - 100 * DAY });
const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
getInsightsExtDb().prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-a' AND user_id = 're-hist'`).run(NOW - 60 * MIN);
Ledger.closeContextLedger();

const ports = await freePorts(2);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress, LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: '1',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`nunca healthy: ${last}`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie) => parse(await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }));
const post = async (s, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) }));
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 300)}`).join(' | ');
const row = (j, u) => (j?.studentBreakdown || []).find((s) => s.userId === u);
const MINS = (ms) => Math.round(ms / MIN);

// Cuerpos tal como los envía cada cliente.
const FP = `sha256:${'a'.repeat(64)}`;
/** Lector EPUB de este repositorio (epubProgress.mjs + EpubReaderApp): posición EPUB y, desde 65D-1, la sesión. */
const epubBody = (sid, startedMs, minutes, fraction = 0.3) => ({
    canonicalProgress: { globalPercentage: Math.round(fraction * 10000) / 100, epub: { cfi: `epubcfi(/6/4!/4/2/${Math.round(fraction * 100)})`, sectionIndex: 1, fraction, contentFingerprint: FP } },
    updatedAt: iso(startedMs + minutes * MIN), session: { sessionId: sid, startedAt: iso(startedMs), durationSec: minutes * 60, mode: 'epub' } });
/** Visores web por dataService.updateProgreso. */
const webBody = (sid, startedMs, minutes) => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: 40, lastInteractedMode: 'text' },
    updatedAt: iso(startedMs + minutes * MIN), session: { sessionId: sid, startedAt: iso(startedMs), durationSec: minutes * 60, mode: 'text' } });
/** LU 0.9.2 — SyncProgressRequest (ReadingProgressRepository.kt:160-164): sin sesión, fecha del dispositivo. */
const luProgressBody = (pct, deviceMs) => ({ canonicalProgress: { globalPercentage: pct }, updatedAt: iso(deviceMs), session: null });
/** LU 0.9.2 — AnalyticsEvent (ReaderViewModel.kt: session_start / session_heartbeat / session_end), reloj del dispositivo. */
const luEvent = (userId, contentId, event, ts, extra = {}) => ({ eventId: crypto.randomUUID(), userId, event, timestamp: ts, contentId, ...extra });
/** Telemetría heredada de los visores web (analyticsService.ts). */
const webLegacy = (userId, contentId, startMs, minutes) => [
    { event: 'session_start', userId, contentId, timestamp: startMs, streak: 0 },
    { event: 'block_complete', userId, contentId, timestamp: startMs + 1000, streak: 1 },
    { event: 'session_end', userId, contentId, timestamp: startMs + minutes * MIN, sessionDuration: minutes * MIN, progressPercentage: 40 }];

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-b', ...GA]) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const at = (h) => NOW - h * 60 * MIN;     // hace h horas
    const okAll = (rs) => rs.every((r) => r.status === 200);

    section('[escritura] cada cliente por su ruta real (las réplicas se alternan)');
    const writes = [];
    // re-epub: tres sesiones EPUB de 12, 8 y 20 minutos en c1.
    writes.push(await post(S1, '/api/progress/re-epub/c1/sync', C['re-epub'], epubBody('ep-1', at(30), 12, 0.2)));
    writes.push(await post(S2, '/api/progress/re-epub/c1/sync', C['re-epub'], epubBody('ep-2', at(20), 8, 0.3)));
    writes.push(await post(S1, '/api/progress/re-epub/c1/sync', C['re-epub'], epubBody('ep-3', at(10), 20, 0.5)));
    // re-mix: c1 con telemetría (2 × 10 min) Y su progreso (las mismas 2 sesiones); cs solo por EPUB (15 min).
    for (const [i, h] of [[1, 30], [2, 20]]) {
        writes.push(await post(S1, '/api/analytics/events', C['re-mix'], webLegacy('re-mix', 'c1', at(h), 10)));
        writes.push(await post(S2, '/api/progress/re-mix/c1/sync', C['re-mix'], webBody(`web-${i}`, at(h), 10)));
    }
    writes.push(await post(S1, '/api/progress/re-mix/cs/sync', C['re-mix'], epubBody('mix-ep', at(5), 15)));
    // re-lu: leyó sin conexión hace dos días (30 min); LU envía todo hoy, con las fechas del dispositivo.
    const luStart = NOW - 2 * DAY;
    writes.push(await post(S2, '/api/progress/re-lu/c1/sync', C['re-lu'], luProgressBody(35, luStart + 30 * MIN)));
    writes.push(await post(S1, '/api/analytics/events', C['re-lu'], [luEvent('re-lu', 'c1', 'session_start', luStart, { source: 'lu' }),
        luEvent('re-lu', 'c1', 'session_heartbeat', luStart + 15 * MIN, { elapsedMs: 15 * MIN, source: 'lu' }),
        luEvent('re-lu', 'c1', 'session_end', luStart + 30 * MIN, { sessionDuration: 30 * MIN, elapsedMs: 30 * MIN, progressPercentage: 35, source: 'lu' })]));
    // re-dup: la misma sesión llega cuatro veces (heartbeat 5, 10, 25 min y un reenvío atrasado de 10) por las dos réplicas.
    for (const [s, m] of [[S1, 5], [S2, 10], [S1, 25], [S2, 10]]) writes.push(await post(s, '/api/progress/re-dup/c1/sync', C['re-dup'], epubBody('dup-1', at(12), m, 0.1 + m / 100)));
    // re-many: 25 sesiones EPUB de 2 minutos en c1 (el historial del progreso guarda 20).
    for (let i = 0; i < 25; i++) writes.push(await post(i % 2 ? S1 : S2, '/api/progress/re-many/c1/sync', C['re-many'], epubBody(`many-${i}`, at(50 - i), 2, 0.01 * (i + 1))));
    // re-hist: lectura EPUB de hace tres horas; su membresía solo consta desde hace una.
    writes.push(await post(S1, '/api/progress/re-hist/c1/sync', C['re-hist'], epubBody('hist-1', at(3), 15)));
    // re-b2c: 40 minutos de lectura PERSONAL (cp), nada del curso.
    writes.push(await post(S2, '/api/progress/re-b2c/cp/sync', C['re-b2c'], epubBody('b2c-1', at(6), 40)));
    // re-rev: lee 10 minutos y después se revoca su A2.
    writes.push(await post(S1, '/api/progress/re-rev/c1/sync', C['re-rev'], epubBody('rev-1', at(8), 10)));
    ok('todas las escrituras aceptadas por las rutas reales (progreso 200, eventos 200/202)', writes.every((w) => w.status === 200 || w.status === 202), writes.filter((w) => w.status !== 200 && w.status !== 202).map((w) => `${w.status} ${w.text.slice(0, 120)}`).join(' | '));
    const Reg = await import('../privacy/a2Registry.mjs');
    Reg.appendDecisions([{ subjectId: 're-rev', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-65D1' }]);

    const m = await both('/api/metrics/course/g-a', C['med-a']);
    const r = await both('/api/reports/course/g-a', C['med-a']);
    ok('tablero e informe del curso responden en las dos réplicas', okAll(m) && okAll(r), st([...m, ...r]));
    const view = (rs, u) => rs.map((x) => row(x.json, u));
    const fields = (s) => s && { hasData: s.hasData, reads: s.readsWithoutTelemetry === true, sessions: s.totalSessions, minutes: MINS(s.totalReadingTimeMs), needsAttention: s.needsAttention, dataState: s.dataState };
    const dump = (u) => JSON.stringify(view(m, u).map(fields));

    section('[1] EPUB: la lectura registrada por el progreso aparece en el tablero');
    {
        const rows = view(m, 're-epub');
        ok('3 sesiones y 40 minutos (12 + 8 + 20), en las dos réplicas', rows.every((s) => s?.totalSessions === 3 && MINS(s.totalReadingTimeMs) === 40), dump('re-epub'));
        ok('…marcado como «lee sin nivel calculable»: sin nivel (hasData=false), actividad acreditada del curso, fuera de atención', rows.every((s) => s.hasData === false && s.readsWithoutTelemetry === true && s.needsAttention === false && s.dataState === 'verified_context'), dump('re-epub'));
        ok('…y no figura en la lista de «necesitan atención»', m.every((x) => !(x.json.needsAttention || []).some((n) => n.userId === 're-epub')));
        ok('su obra en curso sigue en el detalle de lectura (progreso)', rows.every((s) => s.contentsInProgress >= 1), dump('re-epub'));
    }

    section('[2] sin doble conteo entre telemetría y progreso');
    {
        const rows = view(m, 're-mix');
        ok('c1 por telemetría (2 × 10) + cs solo por progreso (15) = 3 sesiones y 35 minutos: las 2 sesiones del progreso de c1 NO se suman', rows.every((s) => s?.totalSessions === 3 && MINS(s.totalReadingTimeMs) === 35 && s.progressOnlySessions === 1), dump('re-mix'));
        ok('…su nivel sigue saliendo de la telemetría (hasData=true, sin la marca de «sin nivel»)', rows.every((s) => s.hasData === true && s.readsWithoutTelemetry !== true), dump('re-mix'));
    }

    section('[3] LU 0.9.2: progreso sin sesión y telemetría con fecha del dispositivo, enviada después');
    {
        const rows = view(m, 're-lu');
        ok('1 sesión de 30 minutos (de sus eventos heredados), con nivel calculable', rows.every((s) => s?.totalSessions === 1 && MINS(s.totalReadingTimeMs) === 30 && s.hasData === true), dump('re-lu'));
        ok('…el progreso sin sesión no inventa sesiones (progressOnlySessions = 0)', rows.every((s) => s.progressOnlySessions === 0), dump('re-lu'));
    }

    section('[4] reenvíos y guardados atrasados de la misma sesión');
    {
        const rows = view(m, 're-dup');
        ok('cuatro envíos de la misma sesión por dos réplicas = 1 sesión de 25 minutos (la mayor duración; el reenvío atrasado no la reduce)', rows.every((s) => s?.totalSessions === 1 && MINS(s.totalReadingTimeMs) === 25), dump('re-dup'));
    }

    section('[5] más de veinte sesiones de un libro');
    {
        const rows = view(m, 're-many');
        ok('25 sesiones de 2 minutos = 25 sesiones y 50 minutos (las constancias de recepción, no el historial de 20)', rows.every((s) => s?.totalSessions === 25 && MINS(s.totalReadingTimeMs) === 50), dump('re-many'));
    }

    section('[6] atribución temporal y lectura personal');
    {
        const hist = view(m, 're-hist');
        ok('lectura anterior a su ingreso: no se cuenta ni se marca como «lee»; se declara no atribuible', hist.every((s) => s?.totalSessions === 0 && s.readsWithoutTelemetry !== true && s.dataState === 'unverifiable_history' && s.needsAttention === false), dump('re-hist'));
        const b2c = view(m, 're-b2c');
        ok('solo lectura personal (B2C): nada del curso, «sin actividad» del curso', b2c.every((s) => s?.totalSessions === 0 && s.readsWithoutTelemetry !== true && s.dataState === 'no_activity'), dump('re-b2c'));
        ok('la obra personal no aparece en ningún detalle del curso', m.every((x) => !JSON.stringify(x.json.studentBreakdown).includes('"cp"') && !/Lectura personal comprada/.test(x.text)));
    }

    section('[7] permisos y ausencia de lectura');
    {
        ok('A2 revocada: el lector no aparece en el tablero ni en el informe', [...m, ...r].every((x) => !row(x.json, 're-rev')), dump('re-rev'));
        const none = view(m, 're-none');
        ok('sin ninguna lectura: «sin actividad» y en atención, como antes', none.every((s) => s?.totalSessions === 0 && s.hasData === false && s.readsWithoutTelemetry !== true && s.needsAttention === true && s.dataState === 'no_activity'), dump('re-none'));
        const other = await both('/api/metrics/course/g-a', C['med-b']);
        ok('el mediador de otra institución no accede al curso', other.every((x) => x.status === 403), st(other));
    }

    section('[8] coherencia entre superficies y réplicas');
    {
        const pick = (x) => ['re-epub', 're-mix', 're-lu', 're-dup', 're-many', 're-hist', 're-b2c', 're-none'].map((u) => fields(row(x.json, u)));
        ok('las dos réplicas dan las mismas cifras por lector', JSON.stringify(pick(m[0])) === JSON.stringify(pick(m[1])), JSON.stringify([pick(m[0]), pick(m[1])]));
        const rr = (x) => ['re-epub', 're-mix', 're-lu', 're-dup', 're-many'].map((u) => { const s = row(x.json, u); return s && [s.totalSessions, s.readsWithoutTelemetry === true]; });
        ok('el informe de curso cuenta lo mismo que el tablero', r.every((x) => JSON.stringify(rr(x)) === JSON.stringify(rr(m[0]))), JSON.stringify([rr(r[0]), rr(m[0])]));
        // Activos: re-mix, re-lu (telemetría) + re-epub, re-dup, re-many (solo progreso) = 5 de 8 elegibles.
        ok('participación: los que leen sin telemetría cuentan como activos (5 de 8)', m.every((x) => x.json.summary.activeStudentCount === 5 && x.json.summary.studentCount === 8), JSON.stringify(m.map((x) => x.json.summary)));
        // La administración ve el curso sin filtro de autorizaciones ni de fechas (como antes): 9 de la nómina; activos los
        // 5 anteriores + re-hist (lee una obra del curso) + re-rev. La lectura PERSONAL de re-b2c no cuenta.
        const adm = await both('/api/metrics/course/g-a', C['adm']);
        ok('vista agregada de la administración: lee las obras del curso, nunca la lectura personal (7 de 9), sin desglose', adm.every((x) => x.status === 200 && x.json.summary?.activeStudentCount === 7 && x.json.summary?.studentCount === 9 && !x.json.studentBreakdown?.length), st(adm));
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGKILL'); } catch { /* */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nreadingContinuityHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
