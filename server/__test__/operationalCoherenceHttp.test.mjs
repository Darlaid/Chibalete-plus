/**
 * operationalCoherenceHttp.test.mjs — CHP V9 65D-2 (Bloque I). Coherencia operativa de las fuentes de lectura.
 *
 * Tres fuentes registran lectura y cada superficie del mediador leía solo una parte:
 *   - Visor Accesible: solo eventos nativos (events.db). El tablero y el informe de curso, que leen la telemetría
 *     heredada y el progreso, no lo veían: el lector salía «sin actividad» con lectura registrada.
 *   - Lector Único (LU): su sesión llega solo como telemetría heredada (`source: 'lu_android'`). El resumen del grupo
 *     de Aula Viva, que mide el tiempo sobre events.db, no contaba ni un minuto de LU.
 * Cada lectura entra por las RUTAS REALES con el cuerpo que envía cada cliente (hook `useA11yAnalytics` y hook nativo
 * de este repositorio; LU según su código, etiqueta cd24fda y rama 9d5ec70) y se comprueba con números, en dos
 * réplicas:
 *   [1] Visor Accesible → tablero e informe            [2] LU → resumen de Aula Viva (y sigue en el tablero)
 *   [3] actividad mixta: ninguna lectura dos veces     [4] lectura personal (B2C) excluida
 *   [5] lectura anterior al curso: no atribuible, distinta de «sin actividad»
 *   [6] A2 revocada                                    [7] registro de procedencia encendido y apagado
 *   [8] constancias: persistencia entre réplicas y tras reinicio; historial anterior a la activación
 *   [9] antigüedad declarada de las cifras             [10] /api/groups/:id/diagnosis: CIS + C005, administración
 *   [11] C005 revocado                                 [12] supresión por titular: constancias, intervalos y telemetría
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/operationalCoherenceHttp.test.mjs
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
import { ulid } from '../ulid.js';

if (process.platform === 'win32') {
    console.log('operationalCoherenceHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1200)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65d2_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
P.analytics = path.join(P.data, 'analytics_db.json');
process.env.INSIGHTS_SQLITE_PATH = P.insights;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const reader = (id, org) => acct(id, ['lector'], { ...org });
// ra-a11y: solo Visor Accesible · ra-lu: LU 0.9.2 · ra-lu2: LU con sesión en el progreso · ra-mix: web + LU + accesible
// ra-b2c: solo lectura personal (accesible y LU) · ra-b2c2: solo lectura personal accesible · ra-hist: LU y accesible anteriores a su ingreso · ra-hist2: solo accesible anterior
// ra-pre: progreso guardado con el registro apagado · ra-rev: A2 revocada · ra-sup: se suprime · ra-none: nada
const GA = ['ra-a11y', 'ra-lu', 'ra-lu2', 'ra-mix', 'ra-b2c', 'ra-b2c2', 'ra-hist', 'ra-hist2', 'ra-pre', 'ra-rev', 'ra-sup', 'ra-none'];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', ['administrador']), acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }),
    acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }), ...GA.map((id) => reader(id, A)), reader('rb-1', B)]));
const GROUPS = [
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: GA, studentIds: GA },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-1'], studentIds: ['rb-1'] },
];
const RULES = [
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'cs'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c', scope: 'user', scopeId: 'ra-b2c', titleIds: ['cp'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-65D2' } },
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

// Procedencia: línea base hace 100 días para todo el curso.
const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
const Ledger = await import('../aulaViva/contextLedger.mjs');
Ledger.observeContext(GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds })), { nowTs: NOW - 100 * DAY });
Ledger.closeContextLedger();

const ports = await freePorts(3);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i, ledger = '1') => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress, LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, 'archive.db'),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        // El observador periódico no interviene durante la suite (las rutas observan antes de leer el registro).
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: ledger, AULA_VIVA_CONTEXT_OBSERVE_INTERVAL_MS: '3600000',
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

const S1 = start(ports[0], 1), S3 = start(ports[2], 3, '0');   // S3: misma instalación con el registro APAGADO
let S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 300)}`).join(' | ');
const okAll = (rs) => rs.every((r) => r.status === 200);
const row = (j, u) => (j?.studentBreakdown || []).find((s) => s.userId === u);
const rdr = (j, u) => (j?.readers || []).find((s) => s.userId === u);
const MINS = (ms) => Math.round(ms / MIN);
const sql = (file, q, ...a) => { const db = new Database(file, { readonly: true, fileMustExist: true }); try { return db.prepare(q).all(...a); } finally { db.close(); } };

// ── Cuerpos tal como los envía cada cliente ──────────────────────────────────
/** Hook nativo (useA11yAnalytics / useBackboneReadingSession) → POST /api/v1/events. */
const nativeEvt = (userId, contentId, mode, sid, action, extra = {}) => ({ eventId: ulid(), schemaVersion: 1, event: `${mode}.${action}`, mode, userId, contentId, sessionId: sid, clientTs: Date.now(), ...extra });
/** Una sesión del Visor Accesible: apertura, avance y (si `minutes`) cierre con el acumulado. */
const a11ySession = (userId, contentId, minutes) => {
    const sid = ulid();
    const evs = [nativeEvt(userId, contentId, 'a11y', sid, 'session_start', { payload: { totalChapters: 3, totalParagraphs: 40 } }),
        nativeEvt(userId, contentId, 'a11y', sid, 'progress', { elapsedMs: 90_000, progressFraction: 0.2, payload: { paragraphId: 'p-0-0-3', paragraphsRead: 8, chapterIndex: 0 } })];
    if (minutes) evs.push(nativeEvt(userId, contentId, 'a11y', sid, 'session_end', { elapsedMs: minutes * MIN, progressFraction: 0.5, payload: { paragraphsRead: 20, totalParagraphs: 40 } }));
    return { events: evs };
};
/** Modo Guiado por el hook nativo: apertura, latido y cierre. */
const webNative = (userId, contentId, minutes) => {
    const sid = ulid();
    return { events: [nativeEvt(userId, contentId, 'text', sid, 'session_start'), nativeEvt(userId, contentId, 'text', sid, 'session_heartbeat', { elapsedMs: 60_000 }),
        nativeEvt(userId, contentId, 'text', sid, 'session_end', { elapsedMs: minutes * MIN, progressFraction: 0.4 })] };
};
/** Telemetría heredada de los visores web (analyticsService.ts). */
const webLegacy = (userId, contentId, startMs, minutes) => [
    { event: 'session_start', userId, contentId, timestamp: startMs, streak: 0 },
    { event: 'block_complete', userId, contentId, timestamp: startMs + 1000, streak: 1 },
    { event: 'session_end', userId, contentId, timestamp: startMs + minutes * MIN, sessionDuration: minutes * MIN, progressPercentage: 40 }];
const webBody = (sid, startedMs, minutes, mode = 'text') => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: 40, lastInteractedMode: 'text' },
    updatedAt: iso(startedMs + minutes * MIN), session: { sessionId: sid, startedAt: iso(startedMs), durationSec: minutes * 60, mode } });
/** LU — AnalyticsEvent (ReaderViewModel.kt + AnalyticsSyncCoordinator.kt: `source = appSurface = "lu_android"`), reloj del dispositivo. */
const luEvent = (userId, contentId, event, ts, extra = {}) => ({ eventId: crypto.randomUUID(), userId, event, timestamp: ts, contentId, source: 'lu_android', ...extra });
const luSession = (userId, contentId, startMs, minutes, { end = true } = {}) => {
    const evs = [luEvent(userId, contentId, 'session_start', startMs)];
    for (let m = 1; m < minutes; m++) evs.push(luEvent(userId, contentId, 'session_heartbeat', startMs + m * MIN, { elapsedMs: m * MIN }));
    if (end) evs.push(luEvent(userId, contentId, 'session_end', startMs + minutes * MIN, { sessionDuration: minutes * MIN, elapsedMs: minutes * MIN, progressPercentage: 35 }));
    else evs.push(luEvent(userId, contentId, 'session_heartbeat', startMs + minutes * MIN, { elapsedMs: minutes * MIN }));
    return evs;
};
/** LU 0.9.2 — progreso SIN sesión. LU 9d5ec70 — con la sesión (`mode: 'lu'`). */
const luProgress = (pct, deviceMs, session = null) => ({ canonicalProgress: { globalPercentage: pct }, updatedAt: iso(deviceMs), session });

try {
    await ready(S1); await ready(S2); await ready(S3);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-b', ...GA]) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const at = (h) => NOW - h * 60 * MIN;     // hace h horas
    const writes = [];
    const W = async (s, p, id, body) => { const r = await post(s, p, C[id], body); writes.push({ p, ...r }); return r; };

    section('[escritura] cada cliente por su ruta real (las réplicas se alternan)');
    // ra-a11y: dos sesiones cerradas en c1 (6 y 4 min) y una abierta sin cierre en cs. Nada más: ni telemetría heredada ni progreso.
    await W(S1, '/api/v1/events', 'ra-a11y', a11ySession('ra-a11y', 'c1', 6));
    await W(S2, '/api/v1/events', 'ra-a11y', a11ySession('ra-a11y', 'c1', 4));
    await W(S1, '/api/v1/events', 'ra-a11y', a11ySession('ra-a11y', 'cs', 0));
    // ra-lu (LU 0.9.2): 30 min sin conexión hace dos días, enviados hoy; progreso sin sesión. Reenvío completo por la otra réplica.
    const lu1 = luSession('ra-lu', 'c1', NOW - 2 * DAY, 30);
    await W(S2, '/api/progress/ra-lu/c1/sync', 'ra-lu', luProgress(35, NOW - 2 * DAY + 30 * MIN));
    await W(S1, '/api/analytics/events', 'ra-lu', lu1);
    const resent = await W(S2, '/api/analytics/events', 'ra-lu', lu1);
    // ra-lu2 (LU 9d5ec70): 20 min en c1 con la sesión también en el progreso; y una sesión de 2 min en cs que la app no cerró.
    const lu2Start = NOW - 26 * 60 * MIN, lu2Sid = crypto.randomUUID();
    await W(S1, '/api/analytics/events', 'ra-lu2', luSession('ra-lu2', 'c1', lu2Start, 20));
    await W(S2, '/api/progress/ra-lu2/c1/sync', 'ra-lu2', luProgress(50, lu2Start + 20 * MIN, { sessionId: lu2Sid, startedAt: iso(lu2Start), durationSec: 20 * 60, mode: 'lu' }));
    await W(S2, '/api/analytics/events', 'ra-lu2', luSession('ra-lu2', 'cs', at(5), 2, { end: false }));
    // ra-mix: c1 en la web (hook nativo + telemetría heredada + progreso: la MISMA sesión de 10 min por tres vías),
    //         c1 en LU otro día (15 min) y cs en el Visor Accesible (5 min).
    await W(S1, '/api/v1/events', 'ra-mix', webNative('ra-mix', 'c1', 10));
    await W(S2, '/api/analytics/events', 'ra-mix', webLegacy('ra-mix', 'c1', at(30), 10));
    await W(S1, '/api/progress/ra-mix/c1/sync', 'ra-mix', webBody('web-1', at(30), 10));
    await W(S2, '/api/analytics/events', 'ra-mix', luSession('ra-mix', 'c1', NOW - DAY, 15));
    await W(S1, '/api/v1/events', 'ra-mix', a11ySession('ra-mix', 'cs', 5));
    // ra-b2c: solo lectura PERSONAL (cp): 20 min accesible y 25 min en LU.
    await W(S1, '/api/v1/events', 'ra-b2c', a11ySession('ra-b2c', 'cp', 20));
    await W(S2, '/api/analytics/events', 'ra-b2c', luSession('ra-b2c', 'cp', at(8), 25));
    await W(S2, '/api/v1/events', 'ra-b2c2', a11ySession('ra-b2c2', 'cp', 9));
    // ra-hist / ra-hist2: leen ANTES de constar como miembros (la membresía se fecha después, abajo).
    await W(S1, '/api/v1/events', 'ra-hist', a11ySession('ra-hist', 'c1', 6));
    await W(S2, '/api/analytics/events', 'ra-hist', luSession('ra-hist', 'c1', at(3), 12));
    await W(S1, '/api/progress/ra-hist/c1/sync', 'ra-hist', luProgress(20, at(3) + 12 * MIN));
    await W(S2, '/api/v1/events', 'ra-hist2', a11ySession('ra-hist2', 'c1', 7));
    // ra-rev y ra-sup: lectura accesible y de LU; después, A2 revocada y supresión.
    await W(S1, '/api/v1/events', 'ra-rev', a11ySession('ra-rev', 'c1', 5));
    await W(S2, '/api/analytics/events', 'ra-rev', luSession('ra-rev', 'c1', at(4), 9));
    await W(S1, '/api/v1/events', 'ra-sup', a11ySession('ra-sup', 'c1', 3));
    await W(S2, '/api/analytics/events', 'ra-sup', luSession('ra-sup', 'c1', at(6), 11));
    await W(S1, '/api/progress/ra-sup/c1/sync', 'ra-sup', webBody('sup-1', at(6), 11, 'lu'));
    // ra-pre: un guardado de progreso (sesión de 10 min) por la réplica con el registro APAGADO: sin constancia.
    const receiptsBefore = sql(P.insights, 'SELECT COUNT(*) n FROM reading_session_receipts')[0].n;
    await W(S3, '/api/progress/ra-pre/c1/sync', 'ra-pre', webBody('pre-1', at(2), 10, 'epub'));
    const receiptsAfterOff = sql(P.insights, 'SELECT COUNT(*) n FROM reading_session_receipts')[0].n;
    ok('todas las escrituras aceptadas por las rutas reales', writes.every((w) => w.status === 200 || w.status === 202), writes.filter((w) => w.status !== 200 && w.status !== 202).map((w) => `${w.p} ${w.status} ${w.text.slice(0, 160)}`).join(' | '));
    ok('el reenvío completo de LU por la otra réplica se reconoce como ya recibido (0 nuevos)', resent.json?.received === 0 && resent.json?.deduplicated === lu1.length, resent.text);
    ok('los eventos nativos no rechazan ninguno', writes.filter((w) => w.p === '/api/v1/events').every((w) => (w.json?.rejected ?? 0) === 0), JSON.stringify(writes.filter((w) => w.p === '/api/v1/events').map((w) => w.json)));

    // La membresía de ra-hist y ra-hist2 consta solo desde AHORA (después de su lectura).
    const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
    await sleep(20);
    getInsightsExtDb().prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-a' AND user_id IN ('ra-hist', 'ra-hist2')`).run(Date.now());
    const Reg = await import('../privacy/a2Registry.mjs');
    Reg.appendDecisions([{ subjectId: 'ra-rev', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-65D2' }]);

    const m = await both('/api/metrics/course/g-a', C['med-a']);
    const r = await both('/api/reports/course/g-a', C['med-a']);
    const s = await both('/api/groups/g-a/analytics-summary', C['med-a']);
    ok('tablero, informe y resumen del grupo responden en las dos réplicas', okAll(m) && okAll(r) && okAll(s), st([...m, ...r, ...s]));
    const view = (rs, u) => rs.map((x) => row(x.json, u));
    const fields = (x) => x && { hasData: x.hasData, reads: x.readsWithoutTelemetry === true, sessions: x.totalSessions, minutes: MINS(x.totalReadingTimeMs), a11y: x.accessibleReaderSessions,
        progressOnly: x.progressOnlySessions, needsAttention: x.needsAttention, dataState: x.dataState };
    const dump = (u) => JSON.stringify(view(m, u).map(fields));
    const mins = (rs, u) => rs.map((x) => { const q = rdr(x.json, u); return q && [MINS(q.reading.allEffectiveMs), MINS(q.reading.last28dEffectiveMs), q.historicalActivity === true]; });
    const sdump = (u) => JSON.stringify(mins(s, u));

    section('[1] Visor Accesible → tablero e informe');
    {
        const rows = view(m, 'ra-a11y');
        ok('tablero: 3 sesiones (dos cerradas y una abierta) y 10 minutos (6 + 4), en las dos réplicas', rows.every((x) => x?.totalSessions === 3 && MINS(x.totalReadingTimeMs) === 10 && x.accessibleReaderSessions === 3), dump('ra-a11y'));
        ok('…«lee sin nivel calculable»: actividad acreditada del curso, fuera de atención, con último acceso', rows.every((x) => x.hasData === false && x.readsWithoutTelemetry === true && x.needsAttention === false && x.dataState === 'verified_context' && x.lastAccessAt > NOW - 10 * MIN), dump('ra-a11y'));
        ok('…no figura en «necesitan atención»', m.every((x) => !(x.json.needsAttention || []).some((n) => n.userId === 'ra-a11y')));
        ok('informe de curso: las mismas sesiones y la misma marca', view(r, 'ra-a11y').every((x) => x?.totalSessions === 3 && x.readsWithoutTelemetry === true && MINS(x.totalReadingTimeMs) === 10), JSON.stringify(view(r, 'ra-a11y').map(fields)));
        ok('resumen de Aula Viva: los mismos 10 minutos (ya los contaba)', mins(s, 'ra-a11y').every((q) => q && q[0] === 10 && q[1] === 10), sdump('ra-a11y'));
    }

    section('[2] LU → resumen de Aula Viva');
    {
        ok('LU 0.9.2: sus 30 minutos entran en el resumen (histórico y 28 días), una sola vez pese al reenvío', mins(s, 'ra-lu').every((q) => q && q[0] === 30 && q[1] === 30), sdump('ra-lu'));
        ok('…y siguen en el tablero: 1 sesión de 30 minutos con nivel calculable', view(m, 'ra-lu').every((x) => x?.totalSessions === 1 && MINS(x.totalReadingTimeMs) === 30 && x.hasData === true), dump('ra-lu'));
        ok('LU con sesión en el progreso: 20 min + 2 min de una sesión sin cierre = 22, sin sumar la sesión del progreso', mins(s, 'ra-lu2').every((q) => q && q[0] === 22), sdump('ra-lu2'));
        ok('…tablero: 2 sesiones y 22 minutos; la sesión del progreso de c1 no se suma (progressOnly = 0)', view(m, 'ra-lu2').every((x) => x?.totalSessions === 2 && MINS(x.totalReadingTimeMs) === 22 && x.progressOnlySessions === 0), dump('ra-lu2'));
    }

    section('[3] actividad mixta: ninguna lectura se cuenta dos veces');
    {
        // Tablero: telemetría heredada c1 (web 10 + LU 15 = 2 sesiones, 25 min) + accesible cs (1 sesión, 5 min). El hook
        // nativo y el progreso de la sesión web NO suman. Aula Viva: nativo c1 10 + accesible cs 5 + LU c1 15.
        ok('tablero: 3 sesiones y 30 minutos', view(m, 'ra-mix').every((x) => x?.totalSessions === 3 && MINS(x.totalReadingTimeMs) === 30 && x.accessibleReaderSessions === 1 && x.progressOnlySessions === 1 && x.hasData === true), dump('ra-mix'));
        ok('resumen de Aula Viva: los mismos 30 minutos', mins(s, 'ra-mix').every((q) => q && q[0] === 30), sdump('ra-mix'));
        ok('el informe coincide con el tablero', view(r, 'ra-mix').every((x) => x?.totalSessions === 3 && MINS(x.totalReadingTimeMs) === 30), JSON.stringify(view(r, 'ra-mix').map(fields)));
    }

    section('[4] lectura personal (B2C) excluida');
    {
        ok('tablero: nada del curso, «sin actividad» del curso', ['ra-b2c', 'ra-b2c2'].every((u) => view(m, u).every((x) => x?.totalSessions === 0 && x.readsWithoutTelemetry !== true && x.dataState === 'no_activity')), dump('ra-b2c') + dump('ra-b2c2'));
        ok('resumen: 0 minutos y sin marca de lectura histórica (no es una obra del curso)', ['ra-b2c', 'ra-b2c2'].every((u) => mins(s, u).every((q) => q && q[0] === 0 && q[2] === false)), sdump('ra-b2c') + sdump('ra-b2c2'));
        ok('la obra personal no aparece en ninguna respuesta del mediador', [...m, ...r, ...s].every((x) => !/"cp"|Lectura personal comprada/.test(x.text)));
    }

    section('[5] lectura anterior al curso: no atribuible, distinta de «sin actividad»');
    {
        ok('LU + accesible antes del ingreso: 0 sesiones, «no atribuible», fuera de atención', view(m, 'ra-hist').every((x) => x?.totalSessions === 0 && x.readsWithoutTelemetry !== true && x.dataState === 'unverifiable_history' && x.needsAttention === false), dump('ra-hist'));
        ok('solo accesible antes del ingreso (sin progreso): también «no atribuible», no «sin actividad»', view(m, 'ra-hist2').every((x) => x?.totalSessions === 0 && x.dataState === 'unverifiable_history' && x.needsAttention === false), dump('ra-hist2'));
        ok('resumen: 0 minutos con la marca de lectura histórica, en los dos', ['ra-hist', 'ra-hist2'].every((u) => mins(s, u).every((q) => q && q[0] === 0 && q[2] === true)), sdump('ra-hist') + sdump('ra-hist2'));
        ok('sin ninguna lectura: «sin actividad», en atención, sin marca histórica', view(m, 'ra-none').every((x) => x?.totalSessions === 0 && x.dataState === 'no_activity' && x.needsAttention === true) && mins(s, 'ra-none').every((q) => q && q[0] === 0 && q[2] === false), dump('ra-none') + sdump('ra-none'));
        ok('el recuento del curso declara a los dos lectores sin actividad acreditable', m.every((x) => x.json.courseAttribution?.readers_without_verified_activity >= 2), JSON.stringify(m.map((x) => x.json.courseAttribution)));
    }

    section('[6] A2 revocada');
    {
        ok('el lector no aparece en el tablero, el informe ni el detalle del resumen', [...m, ...r].every((x) => !row(x.json, 'ra-rev')) && s.every((x) => !rdr(x.json, 'ra-rev')));
    }

    section('[7] registro de procedencia encendido y apagado');
    {
        ok('apagado no anota constancias: el guardado por esa réplica no añadió ninguna', receiptsAfterOff === receiptsBefore, `${receiptsBefore} → ${receiptsAfterOff}`);
        const m3 = await get(S3, '/api/metrics/course/g-a', C['med-a']), s3 = await get(S3, '/api/groups/g-a/analytics-summary', C['med-a']);
        ok('réplica con el registro apagado: responde', m3.status === 200 && s3.status === 200, st([m3, s3]));
        const a = row(m3.json, 'ra-a11y'), l = row(m3.json, 'ra-lu');
        ok('…ninguna lectura se atribuye al curso (0 sesiones) y se declara «no atribuible», nunca «sin actividad»', a?.totalSessions === 0 && a.dataState === 'unverifiable_history' && l?.totalSessions === 0 && l.dataState === 'unverifiable_history', JSON.stringify([fields(a), fields(l)]));
        const qa = rdr(s3.json, 'ra-a11y'), ql = rdr(s3.json, 'ra-lu');
        ok('…el resumen da 0 minutos con la marca de lectura histórica (accesible y LU)', qa?.reading.allEffectiveMs === 0 && qa.historicalActivity === true && ql?.reading.allEffectiveMs === 0 && ql.historicalActivity === true, JSON.stringify([qa, ql]));
        ok('…quien no leyó sigue «sin actividad»', row(m3.json, 'ra-none')?.dataState === 'no_activity');
        // La ruta de salud (agregada, sin identificadores) dice en qué estado está el registro en cada réplica.
        const h1 = (await get(S1, '/api/health/analytics')).json?.checks?.context_ledger, h3 = (await get(S3, '/api/health/analytics')).json?.checks?.context_ledger;
        ok('la salud declara el registro encendido, con su línea base y sus constancias', h1?.ok === true && h1.enabled === true && h1.baseline_ts > 0 && h1.receipts?.total === receiptsBefore && h1.receipts.without_session >= 1 && h1.receipts.conflicts === 0, JSON.stringify(h1));
        ok('…y apagado en la réplica apagada, sin cifras ni identificadores', h3?.ok === true && h3.enabled === false && !('receipts' in h3) && !/ra-|med-/.test(JSON.stringify([h1, h3])), JSON.stringify(h3));
    }

    section('[8] constancias: réplicas, reinicio e historial anterior a la activación');
    {
        const rec = sql(P.insights, `SELECT user_id, work_id, session_id, mode, duration_sec, from_origin, conflict FROM reading_session_receipts WHERE user_id IN ('ra-lu', 'ra-lu2', 'ra-pre') ORDER BY user_id, session_id`);
        ok('LU 0.9.2 deja una constancia sin sesión; LU con sesión, la suya (modo lu, 20 min, desde el origen)', rec.some((x) => x.user_id === 'ra-lu' && x.session_id === '') && rec.some((x) => x.user_id === 'ra-lu2' && x.session_id === lu2Sid && x.mode === 'lu' && x.duration_sec === 1200 && x.from_origin === 1 && x.conflict === 0), JSON.stringify(rec));
        ok('el guardado hecho con el registro apagado no tiene constancia', !rec.some((x) => x.user_id === 'ra-pre'), JSON.stringify(rec));
        ok('…y esa lectura queda como no atribuible para el mediador (no se acredita hacia atrás)', view(m, 'ra-pre').every((x) => x?.totalSessions === 0 && x.dataState === 'unverifiable_history'), dump('ra-pre'));
        // Reenvío de la sesión de LU por la otra réplica con otra duración: una sola constancia, la mayor duración.
        await post(S1, '/api/progress/ra-lu2/c1/sync', C['ra-lu2'], luProgress(50, lu2Start + 20 * MIN, { sessionId: lu2Sid, startedAt: iso(lu2Start), durationSec: 15 * 60, mode: 'lu' }));
        const again = sql(P.insights, `SELECT duration_sec, conflict FROM reading_session_receipts WHERE user_id = 'ra-lu2' AND session_id = ?`, lu2Sid);
        ok('un reenvío atrasado por la otra réplica no duplica ni reduce la constancia', again.length === 1 && again[0].duration_sec === 1200 && again[0].conflict === 0, JSON.stringify(again));
        // Reinicio de una réplica: lo que se responde sale de los almacenes, no de la memoria del proceso.
        const before = JSON.stringify(['ra-a11y', 'ra-lu', 'ra-lu2', 'ra-mix', 'ra-hist', 'ra-pre'].map((u) => fields(row(m[1].json, u))));
        S2.child.kill('SIGKILL'); await sleep(300);
        S2 = start(ports[1], 2); await ready(S2);
        const m2 = await get(S2, '/api/metrics/course/g-a', C['med-a']), s2 = await get(S2, '/api/groups/g-a/analytics-summary', C['med-a']);
        ok('tras reiniciar una réplica, el tablero da las mismas cifras por lector', m2.status === 200 && JSON.stringify(['ra-a11y', 'ra-lu', 'ra-lu2', 'ra-mix', 'ra-hist', 'ra-pre'].map((u) => fields(row(m2.json, u)))) === before, `${m2.status} ${before}`);
        ok('…y el resumen los mismos minutos', ['ra-a11y', 'ra-lu', 'ra-lu2', 'ra-mix'].every((u) => MINS(rdr(s2.json, u)?.reading.allEffectiveMs) === mins(s, u)[0][0]), s2.text.slice(0, 300));
    }

    section('[9] coherencia entre réplicas y antigüedad declarada');
    {
        const pick = (x) => GA.filter((u) => u !== 'ra-rev').map((u) => fields(row(x.json, u)));
        ok('las dos réplicas dan las mismas cifras por lector en el tablero', JSON.stringify(pick(m[0])) === JSON.stringify(pick(m[1])), JSON.stringify([pick(m[0]), pick(m[1])]));
        const spick = (x) => GA.filter((u) => u !== 'ra-rev').map((u) => rdr(x.json, u)?.reading);
        ok('…y en el resumen', JSON.stringify(spick(s[0])) === JSON.stringify(spick(s[1])), JSON.stringify([spick(s[0]), spick(s[1])]));
        ok('el resumen declara cuándo se calcularon sus cifras (`computedAt`) y el tablero también', s.every((x) => Number.isFinite(x.json.computedAt) && x.json.computedAt >= NOW) && m.every((x) => Number.isFinite(x.json.computedAt)), JSON.stringify(s.map((x) => x.json.computedAt)));
        const s1b = await get(S1, '/api/groups/g-a/analytics-summary', C['med-a']);
        ok('una respuesta servida de la copia conserva la hora del cálculo original (no se presenta como recién calculada)', s1b.json?.computedAt === s[0].json.computedAt, `${s1b.json?.computedAt} vs ${s[0].json.computedAt}`);
        // Participación: ra-lu, ra-lu2, ra-mix, ra-sup (telemetría) + ra-a11y (solo accesible) = 5 de los 11 elegibles (ra-rev fuera).
        ok('participación del curso: quien solo usa el Visor Accesible cuenta como activo (5 de 11)', m.every((x) => x.json.summary.activeStudentCount === 5 && x.json.summary.studentCount === 11), JSON.stringify(m.map((x) => x.json.summary)));
        // Administración (agregado, sin filtro de autorizaciones ni de fechas, como antes): ra-lu, ra-lu2, ra-mix, ra-hist,
        // ra-rev, ra-sup y ra-b2c (su telemetría heredada no se filtra por obra: contrato previo de esa vista) + ra-a11y y
        // ra-hist2 (accesible, obras del curso) + ra-pre (progreso) = 10 de 12. La lectura accesible PERSONAL de ra-b2c2
        // no lo vuelve activo; ra-none tampoco lo es.
        const adm = await both('/api/metrics/course/g-a', C['adm']);
        ok('vista agregada de la administración: la lectura accesible cuenta solo en obras del curso (10 de 12), sin desglose', adm.every((x) => x.status === 200 && x.json.summary?.activeStudentCount === 10 && x.json.summary?.studentCount === 12 && !x.json.studentBreakdown?.length), st(adm));
    }

    section('[10] /api/groups/:id/diagnosis');
    const diag = (cookie, g = 'g-a') => both(`/api/groups/${g}/diagnosis`, cookie);
    let diagBefore;
    {
        const med = await diag(C['med-a']), adm = await diag(C['adm']);
        diagBefore = adm[0].text;
        ok('mediador del curso con C005 vigente: 200 con el diagnóstico', med.every((x) => x.status === 200 && typeof x.json?.healthStatus === 'string'), st(med));
        ok('…el mismo diagnóstico que recibe la administración (no se exige A2: es información de la nómina)', med.every((x) => x.text === adm[0].text) && adm.every((x) => x.status === 200), st([med[0], adm[0]]));
        ok('mediador de otra institución: 403, sin datos del grupo', (await diag(C['med-b'])).every((x) => x.status === 403 && !/ra-|Quinto/.test(x.text)));
        ok('mediador sobre un curso que no media (otra institución): 403', (await diag(C['med-a'], 'g-b')).every((x) => x.status === 403));
        ok('un lector del grupo: 403', (await diag(C['ra-none'])).every((x) => x.status === 403));
        ok('sin sesión: 401', (await diag(null)).every((x) => x.status === 401));
    }

    section('[11] C005 del mediador revocado');
    {
        Reg.appendDecisions([{ subjectId: 'med-a', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C2-SINT-65D2-REV' }]);
        const d = await diag(C['med-a']);
        ok('diagnóstico: 403 scope_access_denied en las dos réplicas, sin datos del grupo', d.every((x) => x.status === 403 && x.json?.error === 'scope_access_denied' && !/ra-|healthStatus/.test(x.text)), st(d));
        const sm = await both('/api/groups/g-a/analytics-summary', C['med-a']), mm = await both('/api/metrics/course/g-a', C['med-a']);
        ok('resumen del grupo: 403; tablero: ningún lector', sm.every((x) => x.status === 403) && mm.every((x) => x.status !== 200 || !(x.json.studentBreakdown || []).length), st([...sm, ...mm]));
        const adm = await diag(C['adm']);
        ok('la administración conserva el diagnóstico, sin cambios', adm.every((x) => x.status === 200 && x.text === diagBefore), st(adm));
        ok('el mediador de la otra institución conserva el de SU curso', (await diag(C['med-b'], 'g-b')).every((x) => x.status === 200));
    }

    section('[12] supresión por titular');
    {
        const SUP = await import('../privacy/suppression.mjs');
        const paths = SUP.residualPaths({ CHP_DATA_DIR: P.data, EVENTS_SQLITE_PATH: P.events, ARCHIVE_SQLITE_PATH: path.join(P.data, 'archive.db'), PROGRESS_SQLITE_PATH: P.progress,
            LEO_EVIDENCE_DB: P.evidence, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), ACCESS_DB: P.access, INSIGHTS_SQLITE_PATH: P.insights }, tmp);
        const count = () => ({
            receipts: sql(P.insights, `SELECT COUNT(*) n FROM reading_session_receipts WHERE user_id = 'ra-sup'`)[0].n,
            intervals: sql(P.insights, `SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE user_id = 'ra-sup'`)[0].n,
            events: sql(P.events, `SELECT COUNT(*) n FROM events WHERE user_id = 'ra-sup'`)[0].n,
            legacy: JSON.parse(fs.readFileSync(P.analytics, 'utf8')).filter((e) => e.userId === 'ra-sup').length,
        });
        const before = count();
        ok('antes: la persona tiene constancia, intervalo de membresía, eventos nativos y telemetría de LU', before.receipts >= 1 && before.intervals >= 1 && before.events >= 2 && before.legacy >= 3, JSON.stringify(before));
        const others = () => ({ receipts: sql(P.insights, `SELECT COUNT(*) n FROM reading_session_receipts WHERE user_id <> 'ra-sup'`)[0].n,
            intervals: sql(P.insights, `SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE IFNULL(user_id, '') <> 'ra-sup'`)[0].n,
            legacy: JSON.parse(fs.readFileSync(P.analytics, 'utf8')).filter((e) => e.userId !== 'ra-sup').length });
        const othersBefore = others();
        const ack = await SUP.suppressResidualSources(paths, 'ra-sup');
        const after = count();
        ok('después: ninguna constancia, intervalo, evento nativo ni evento de telemetría de la persona', after.receipts === 0 && after.intervals === 0 && after.events === 0 && after.legacy === 0, JSON.stringify(after));
        ok('…el acuse cuenta la telemetría heredada retirada, sin identificadores', ack.analytics?.removed === before.legacy && !JSON.stringify(ack).includes('ra-sup'), JSON.stringify(ack.analytics));
        ok('…y lo de las demás personas queda intacto', JSON.stringify(others()) === JSON.stringify(othersBefore), JSON.stringify([othersBefore, others()]));
        const twice = await SUP.suppressResidualSources(paths, 'ra-sup');
        ok('repetir la supresión no cambia nada (idempotente)', twice.analytics?.removed === 0 && twice.insights?.rowsRemoved === 0, JSON.stringify([twice.analytics, twice.insights]));
        ok('la conciliación tras restaurar reconoce esa fuente: un id solo presente en la telemetría queda entre los candidatos', SUP.residualSubjectIds(paths).has('ra-lu') && !SUP.residualSubjectIds(paths).has('ra-sup'));
    }

    section('[13] conservación: caducidad de constancias con las dos réplicas en marcha (65D-2R)');
    {
        // ra-none lee ahora 10 minutos por el progreso (lector EPUB): una sesión con su constancia.
        grantC005(['med-a']);   // el compromiso vuelve a estar vigente para poder consultar el tablero
        const w = await post(S1, '/api/progress/ra-none/c1/sync', C['ra-none'], webBody('ret-1', Date.now() - 10 * MIN, 10, 'epub'));
        const m1 = await both('/api/metrics/course/g-a', C['med-a']);
        ok('antes: la sesión se acredita en las dos réplicas (1 sesión, 10 min, del curso)', w.status === 200 && m1.every((x) => { const q = row(x.json, 'ra-none'); return q?.totalSessions === 1 && MINS(q.totalReadingTimeMs) === 10 && q.dataState === 'verified_context'; }), st([w, ...m1]).slice(0, 600));
        const openBefore = sql(P.insights, `SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE until_ts IS NULL`)[0].n;
        const worksBefore = sql(P.insights, `SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE kind = 'work'`)[0].n;
        const LedgerR = await import('../aulaViva/contextLedger.mjs');
        const off = LedgerR.pruneContextLedger({ nowTs: Date.now() + 400 * DAY });
        ok('sin su bandera, la poda no elimina nada', off.skipped === 'retention_disabled_default_off' && sql(P.insights, 'SELECT COUNT(*) n FROM reading_session_receipts')[0].n > 0, JSON.stringify(off));
        process.env.AULA_VIVA_CONTEXT_LEDGER_RETENTION_ENABLED = '1';
        const total = sql(P.insights, 'SELECT COUNT(*) n FROM reading_session_receipts')[0].n;
        const kept = LedgerR.pruneContextLedger({ nowTs: Date.now() + 300 * DAY });   // a los diez meses nada ha caducado
        const pruned = LedgerR.pruneContextLedger({ nowTs: Date.now() + 367 * DAY }); // pasados los doce meses, todas
        LedgerR.closeContextLedger();
        ok('a los diez meses no caduca nada; pasados doce, todas las constancias (y ninguna membresía abierta ni asociación obra–curso)', kept.receipts_removed === 0 && pruned.ok && pruned.receipts_removed === total && pruned.member_intervals_removed === 0
            && sql(P.insights, `SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE until_ts IS NULL`)[0].n === openBefore && sql(P.insights, `SELECT COUNT(*) n FROM pedagogical_context_intervals WHERE kind = 'work'`)[0].n === worksBefore, JSON.stringify([kept, pruned, total]));
        const m2 = await both('/api/metrics/course/g-a', C['med-a']);
        ok('después: la misma sesión ya no se acredita en ninguna réplica: «no atribuible», nunca «sin actividad» ni dada por buena', m2.every((x) => { const q = row(x.json, 'ra-none'); return q?.totalSessions === 0 && q.dataState === 'unverifiable_history' && q.readsWithoutTelemetry !== true; }), JSON.stringify(m2.map((x) => row(x.json, 'ra-none'))).slice(0, 600));
        ok('…y lo que no depende de constancias sigue acreditado (Visor Accesible: 3 sesiones; membresías abiertas intactas)', m2.every((x) => row(x.json, 'ra-a11y')?.totalSessions === 3 && row(x.json, 'ra-lu')?.totalSessions === 1), JSON.stringify(m2.map((x) => row(x.json, 'ra-a11y')?.totalSessions)));
        const h2 = (await get(S2, '/api/health/analytics')).json?.checks?.context_ledger;
        ok('la salud declara la conservación (12 meses, última poda) y 0 constancias; la bandera sigue apagada en los servidores', h2?.retention?.months === 12 && h2.retention.last_pruned_ts > Date.now() && h2.retention.enabled === false && h2.receipts?.total === 0, JSON.stringify(h2));
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const x of [S1, S2, S3]) { try { x.child.kill('SIGKILL'); } catch { /* */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\noperationalCoherenceHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
