/**
 * dataConsistencyHttp.test.mjs — CHP V9 65E-B (Bloque I). Integridad de lectura e indicadores.
 *
 * Los ocho pendientes de fuentes, indicadores y límites analíticos, cada uno con números y por las RUTAS REALES, en
 * dos réplicas del mismo almacén:
 *   [1] lector EPUB (solo guarda progreso) → Aula Viva, tablero e informe
 *   [2] lectura mixta EPUB / LU / Visor Accesible / web de un mismo lector: cada minuto una sola vez
 *   [3] lectura personal (B2C) fuera del curso, también en los agregados de la administración
 *   [4] agregados administrativos (curso, colegio, resumen del grupo) sobre la población y las obras correctas
 *   [5] no atribuible ≠ insuficiente ≠ inactivo (tablero, Aula Viva y agregado contextual del curso)
 *   [6] más de 20 000 eventos de un lector: no se pierden los recientes; techo declarado
 *   [7] dos réplicas: antigüedad real de la telemetría heredada, `computedAt` y reinicio
 *   [8] /api/health/analytics lee las bases CONFIGURADAS
 *   [9] A2 y C005 revocados; aislamiento entre instituciones
 *   [10] telemetría de LU anterior a 65A (sin constancia de recepción): no se acredita, y no es «cero»
 *   [11] memoria rodante de 50 000 eventos: lo que se pierde se declara con su fecha
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/. Al final imprime `TABLA {…}` con las cifras medidas.
 *
 *   node server/__test__/dataConsistencyHttp.test.mjs
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
    console.log('dataConsistencyHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1400)), fail++);
const section = (t) => console.log(`\n${t}`);
const TABLA = {};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65eb_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
P.analytics = path.join(P.data, 'analytics_db.json');
P.archive = path.join(P.data, 'archive.db');
process.env.INSIGHTS_SQLITE_PATH = P.insights;
process.env.EVENTS_SQLITE_PATH = P.events;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const reader = (id, org) => acct(id, ['lector'], { ...org });
// re-epub: solo lector EPUB · re-mix: web + EPUB (misma obra) + LU + accesible · re-b2c: solo lectura personal
// re-hist: LU anterior a 65A (sin constancia) · re-cap: 25 sesiones EPUB de una obra · re-rev: A2 revocada
// re-big: más de 20 000 eventos · re-huge: más de 100 000 (el techo real) · re-pre1/re-pre2: lectura accesible anterior a constar como miembros · re-pre3: ídem, lectura web
// re-old: una sesión web de hace 60 días (la primera que la memoria rodante descarta) · re-fresh: lee durante la prueba
const GA = ['re-epub', 're-mix', 're-b2c', 're-hist', 're-cap', 're-rev', 're-big', 're-huge', 're-pre1', 're-pre2', 're-pre3', 're-old', 're-fresh', 're-none'];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', ['administrador']), acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }),
    acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }), ...GA.map((id) => reader(id, A)), reader('rb-1', B), acct('filler', ['lector'])]));
const GROUPS = [
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: GA, studentIds: GA },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-1'], studentIds: ['rb-1'] },
    // Un curso sin obras asociadas: sus cifras en cero no son inactividad.
    { id: 'g-empty', name: 'Sin obras', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: ['re-epub'], studentIds: ['re-epub'] },
];
const RULES = [
    { id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'cs'], collectionIds: [] },
    { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c', scope: 'user', scopeId: 're-b2c', titleIds: ['cp'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-65EB' } },
];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['cs', 'Segunda obra del curso'], ['cp', 'Lectura personal comprada'], ['cb', 'Obra de la otra institución']]
    .map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));

const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
/** Telemetría heredada de los visores web (analyticsService.ts). */
const webLegacy = (userId, contentId, startMs, minutes) => [
    { event: 'session_start', userId, contentId, timestamp: startMs, streak: 0 },
    { event: 'block_complete', userId, contentId, timestamp: startMs + 1000, streak: 1 },
    { event: 'session_end', userId, contentId, timestamp: startMs + minutes * MIN, sessionDuration: minutes * MIN, progressPercentage: 40 }];
/** LU — AnalyticsEvent (`source = "lu_android"`), reloj del dispositivo. */
const luEvent = (userId, contentId, event, ts, extra = {}) => ({ eventId: crypto.randomUUID(), userId, event, timestamp: ts, contentId, source: 'lu_android', ...extra });
const luSession = (userId, contentId, startMs, minutes) => {
    const evs = [luEvent(userId, contentId, 'session_start', startMs)];
    for (let m = 1; m < minutes; m++) evs.push(luEvent(userId, contentId, 'session_heartbeat', startMs + m * MIN, { elapsedMs: m * MIN }));
    evs.push(luEvent(userId, contentId, 'session_end', startMs + minutes * MIN, { sessionDuration: minutes * MIN, elapsedMs: minutes * MIN, progressPercentage: 35 }));
    return evs;
};
// Lo que ya estaba en la telemetría heredada antes de arrancar, en orden de llegada:
//   re-old   una sesión web de 10 min hace 60 días, CON constancia de recepción (es lo primero que rodará);
//   re-hist  12 min de LU hace 40 días SIN constancia de recepción (anterior a 65A).
const SEED = [...webLegacy('re-old', 'c1', NOW - 60 * DAY, 10).map((e) => ({ ...e, receivedAt: e.timestamp + 2000 })), ...luSession('re-hist', 'c1', NOW - 40 * DAY, 12)];
fs.writeFileSync(P.analytics, JSON.stringify(SEED));

const REG = a2RegistryPath();
grantA2([...GA, 'rb-1']);
grantC005(['med-a', 'med-b']);

// Procedencia: línea base hace 100 días para todos los cursos.
const Ledger = await import('../aulaViva/contextLedger.mjs');
Ledger.observeContext(GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scope === 'group' && r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds })), { nowTs: NOW - 100 * DAY });
Ledger.closeContextLedger();

const ports = await freePorts(2);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress, LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: P.archive,
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: '1', AULA_VIVA_CONTEXT_OBSERVE_INTERVAL_MS: '3600000',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`server not ready: ${last}\n${s.out.slice(-1500)}`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie) => parse(await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }));
const post = async (s, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) }));
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const S1 = start(ports[0], 1);
let S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 300)}`).join(' | ');
const okAll = (rs) => rs.every((r) => r.status === 200);
const row = (j, u) => (j?.studentBreakdown || []).find((s) => s.userId === u);
const rdr = (j, u) => (j?.readers || []).find((s) => s.userId === u);
const MINS = (ms) => Math.round(ms / MIN);
const sql = (file, q, ...a) => { const db = new Database(file, { readonly: true, fileMustExist: true }); try { return db.prepare(q).all(...a); } finally { db.close(); } };

// ── Cuerpos tal como los envía cada cliente ──────────────────────────────────
const nativeEvt = (userId, contentId, mode, sid, action, extra = {}) => ({ eventId: ulid(), schemaVersion: 1, event: `${mode}.${action}`, mode, userId, contentId, sessionId: sid, clientTs: Date.now(), ...extra });
/** Visor Accesible: apertura, avance y cierre con el acumulado (solo eventos nativos). */
const a11ySession = (userId, contentId, minutes) => {
    const sid = ulid();
    return { events: [nativeEvt(userId, contentId, 'a11y', sid, 'session_start', { payload: { totalChapters: 3, totalParagraphs: 40 } }),
        nativeEvt(userId, contentId, 'a11y', sid, 'progress', { elapsedMs: 90_000, progressFraction: 0.2, payload: { paragraphId: 'p-0-0-3', paragraphsRead: 8, chapterIndex: 0 } }),
        nativeEvt(userId, contentId, 'a11y', sid, 'session_end', { elapsedMs: minutes * MIN, progressFraction: 0.5, payload: { paragraphsRead: 20, totalParagraphs: 40 } })] };
};
/** Modo Guiado por el hook nativo: apertura, latido y cierre. */
const webNative = (userId, contentId, minutes) => {
    const sid = ulid();
    return { events: [nativeEvt(userId, contentId, 'text', sid, 'session_start'), nativeEvt(userId, contentId, 'text', sid, 'session_heartbeat', { elapsedMs: 60_000 }),
        nativeEvt(userId, contentId, 'text', sid, 'session_end', { elapsedMs: minutes * MIN, progressFraction: 0.4 })] };
};
const webBody = (sid, startedMs, minutes, mode = 'text') => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: 40, lastInteractedMode: 'text' },
    updatedAt: iso(startedMs + minutes * MIN), session: { sessionId: sid, startedAt: iso(startedMs), durationSec: minutes * 60, mode } });
/** Lector EPUB de este repositorio (epubProgress.mjs + EpubReaderApp): posición EPUB y la sesión (`mode: 'epub'`). */
const FP = `sha256:${'a'.repeat(64)}`;
const epubBody = (sid, startedMs, minutes, fraction = 0.3) => ({
    canonicalProgress: { globalPercentage: Math.round(fraction * 10000) / 100, epub: { cfi: `epubcfi(/6/4!/4/2/${Math.round(fraction * 100)})`, sectionIndex: 1, fraction, contentFingerprint: FP } },
    updatedAt: iso(startedMs + minutes * MIN), session: { sessionId: sid, startedAt: iso(startedMs), durationSec: minutes * 60, mode: 'epub' } });

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-b', 'rb-1', 'filler', ...GA]) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const at = (h) => NOW - h * 60 * MIN;     // hace h horas
    const writes = [];
    const W = async (s, p, id, body) => { const r = await post(s, p, C[id], body); writes.push({ p, ...r }); return r; };

    section('[escritura] cada cliente por su ruta real (las réplicas se alternan)');
    // re-epub: dos sesiones del lector EPUB en c1 (12 y 8 min). Nada más: ni telemetría ni eventos nativos.
    await W(S1, '/api/progress/re-epub/c1/sync', 're-epub', epubBody('ep-1', at(30), 12, 0.2));
    await W(S2, '/api/progress/re-epub/c1/sync', 're-epub', epubBody('ep-2', at(5), 8, 0.35));
    // re-mix: c1 en la web (la MISMA sesión de 10 min por hook nativo, telemetría heredada y progreso) y c1 en el
    //         lector EPUB (15 min, mismo progreso); cs en LU (9 min, telemetría + progreso) y cs en el Visor Accesible (7 min).
    await W(S1, '/api/v1/events', 're-mix', webNative('re-mix', 'c1', 10));
    await W(S2, '/api/analytics/events', 're-mix', webLegacy('re-mix', 'c1', at(30), 10));
    await W(S1, '/api/progress/re-mix/c1/sync', 're-mix', webBody('web-1', at(30), 10));
    await W(S2, '/api/progress/re-mix/c1/sync', 're-mix', epubBody('ep-mix', at(20), 15, 0.5));
    await W(S1, '/api/analytics/events', 're-mix', luSession('re-mix', 'cs', at(50), 9));
    await W(S2, '/api/progress/re-mix/cs/sync', 're-mix', { canonicalProgress: { globalPercentage: 35 }, updatedAt: iso(at(50) + 9 * MIN), session: { sessionId: 'lu-mix', startedAt: iso(at(50)), durationSec: 9 * 60, mode: 'lu' } });
    await W(S1, '/api/v1/events', 're-mix', a11ySession('re-mix', 'cs', 7));
    // re-b2c: solo lectura PERSONAL (cp): 20 min en el lector EPUB y 5 min en la web (hook nativo + telemetría heredada).
    await W(S1, '/api/progress/re-b2c/cp/sync', 're-b2c', epubBody('ep-b2c', at(10), 20, 0.4));
    await W(S2, '/api/v1/events', 're-b2c', webNative('re-b2c', 'cp', 5));
    await W(S1, '/api/analytics/events', 're-b2c', webLegacy('re-b2c', 'cp', at(9), 5));
    // re-cap: 25 sesiones EPUB de 2 min en c1 (el historial del progreso conserva 20).
    for (let i = 0; i < 25; i++) await W(i % 2 ? S1 : S2, '/api/progress/re-cap/c1/sync', 're-cap', epubBody(`cap-${i}`, at(60 - i), 2, 0.02 * (i + 1)));
    // re-rev: 6 min de EPUB en c1 (después se revoca su A2).
    await W(S1, '/api/progress/re-rev/c1/sync', 're-rev', epubBody('ep-rev', at(7), 6, 0.1));
    // re-pre1 / re-pre2: lectura accesible de c1 ANTES de constar como miembros (la membresía se fecha después, abajo).
    await W(S1, '/api/v1/events', 're-pre1', a11ySession('re-pre1', 'c1', 6));
    await W(S2, '/api/v1/events', 're-pre2', a11ySession('re-pre2', 'c1', 4));
    // re-pre3: lo mismo, pero lectura WEB (hook nativo, sin telemetría heredada ni progreso).
    await W(S1, '/api/v1/events', 're-pre3', webNative('re-pre3', 'c1', 5));
    // rb-1 (otra institución): 11 min de EPUB en su obra.
    await W(S1, '/api/progress/rb-1/cb/sync', 'rb-1', epubBody('ep-b', at(8), 11, 0.2));
    ok('todas las escrituras aceptadas por las rutas reales', writes.every((w) => w.status === 200 || w.status === 202), writes.filter((w) => w.status !== 200 && w.status !== 202).map((w) => `${w.p} ${w.status} ${w.text.slice(0, 160)}`).join(' | '));

    const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');
    await sleep(20);
    getInsightsExtDb().prepare(`UPDATE pedagogical_context_intervals SET since_ts = ? WHERE kind = 'member' AND group_id = 'g-a' AND user_id IN ('re-pre1', 're-pre2', 're-pre3')`).run(Date.now());

    // re-big: 20 600 filas propias en events.db (obra del curso). 20 500 antiguas (de hace 20 a 2 días) y 100 de la
    // última hora: una lectura que corta en las 20 000 más antiguas pierde justo las recientes.
    {
        const db = new Database(P.events); db.pragma('busy_timeout = 5000');
        const ins = db.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
            VALUES (?, 1, ?, 'text', 're-big', 'c1', ?, ?, ?, ?, NULL, '{}', ?)`);
        db.transaction(() => {
            const from = NOW - 20 * DAY, span = 18 * DAY;
            for (let i = 0; i < 20_500; i++) { const ts = from + Math.floor((i / 20_500) * span); ins.run(`big-old-${i}`, 'text.session_heartbeat', `big-s-${Math.floor(i / 50)}`, ts, ts, 60_000 * (i % 50), ts); }
            for (let i = 0; i < 100; i++) { const ts = NOW - 50 * MIN + i * 20_000; ins.run(`big-new-${i}`, i === 0 ? 'text.session_start' : i === 99 ? 'text.session_end' : 'text.session_heartbeat', 'big-recent', ts, ts, i * 20_000, ts); }
        })();
        db.close();
    }

    const m = await both('/api/metrics/course/g-a', C['med-a']);
    const r = await both('/api/reports/course/g-a', C['med-a']);
    const s = await both('/api/groups/g-a/analytics-summary', C['med-a']);
    ok('tablero, informe y resumen del grupo responden al mediador en las dos réplicas', okAll(m) && okAll(r) && okAll(s), st([...m, ...r, ...s]));
    const view = (rs, u) => rs.map((x) => row(x.json, u));
    const fields = (x) => x && { hasData: x.hasData, reads: x.readsWithoutTelemetry === true, sessions: x.totalSessions, minutes: MINS(x.totalReadingTimeMs), a11y: x.accessibleReaderSessions,
        progressOnly: x.progressOnlySessions, needsAttention: x.needsAttention, dataState: x.dataState, capped: x.sessionHistoryCapped === true };
    const dump = (rs, u) => JSON.stringify(view(rs, u).map(fields));
    const mins = (rs, u) => rs.map((x) => { const q = rdr(x.json, u); return q && [MINS(q.reading.allEffectiveMs), MINS(q.reading.last28dEffectiveMs), q.historicalActivity === true, q.sessionHistoryCapped === true]; });
    const sdump = (rs, u) => JSON.stringify(mins(rs, u));
    const T = (u) => { const x = row(m[0].json, u), q = rdr(s[0].json, u); return { tablero: x ? [x.totalSessions, MINS(x.totalReadingTimeMs), x.dataState] : null, aulaViva: q ? [MINS(q.reading.allEffectiveMs), q.historicalActivity === true] : null }; };
    for (const u of ['re-epub', 're-mix', 're-b2c', 're-cap', 're-hist', 're-pre1']) TABLA[`mediador ${u} [sesiones, min, estado] / Aula Viva [min, no atribuible]`] = T(u);

    section('[1] lector EPUB → tablero, informe y Aula Viva');
    {
        ok('tablero: 2 sesiones y 20 minutos (12 + 8), activo, sin nivel calculable, en las dos réplicas', view(m, 're-epub').every((x) => x?.totalSessions === 2 && MINS(x.totalReadingTimeMs) === 20 && x.readsWithoutTelemetry === true && x.needsAttention === false && x.dataState === 'verified_context'), dump(m, 're-epub'));
        ok('informe de curso: las mismas 2 sesiones y 20 minutos', view(r, 're-epub').every((x) => x?.totalSessions === 2 && MINS(x.totalReadingTimeMs) === 20), dump(r, 're-epub'));
        ok('resumen de Aula Viva: los MISMOS 20 minutos (histórico y 28 días)', mins(s, 're-epub').every((q) => q && q[0] === 20 && q[1] === 20 && q[2] === false), sdump(s, 're-epub'));
        ok('…y entran en el agregado del grupo: el lector cuenta entre los que tienen actividad', s.every((x) => x.json.reading.all.totalEffectiveMs >= 20 * MIN && x.json.reading.all.readersWithActivity >= 4), JSON.stringify(s.map((x) => x.json.reading.all)));
    }

    section('[2] lectura mixta (web + EPUB de la misma obra, LU y Visor Accesible): cada minuto una sola vez');
    {
        // Tablero: web 10 (telemetría) + EPUB 15 (progreso) + LU 9 (telemetría) + accesible 7 (eventos nativos) = 4 sesiones, 41 min.
        ok('tablero: 4 sesiones y 41 minutos; la sesión web no se cuenta también por su progreso ni la de LU por el suyo', view(m, 're-mix').every((x) => x?.totalSessions === 4 && MINS(x.totalReadingTimeMs) === 41 && x.progressOnlySessions === 2 && x.accessibleReaderSessions === 1), dump(m, 're-mix'));
        ok('informe: las mismas 4 sesiones y 41 minutos', view(r, 're-mix').every((x) => x?.totalSessions === 4 && MINS(x.totalReadingTimeMs) === 41), dump(r, 're-mix'));
        ok('Aula Viva: los mismos 41 minutos (10 web + 15 EPUB + 9 LU + 7 accesible)', mins(s, 're-mix').every((q) => q && q[0] === 41 && q[1] === 41), sdump(s, 're-mix'));
        const again = await both('/api/groups/g-a/analytics-summary', C['med-a']);
        ok('una segunda consulta entrega las mismas cifras (nada se acumula al consultar)', mins(again, 're-mix').every((q) => q && q[0] === 41), sdump(again, 're-mix'));
    }

    section('[3] lectura personal (B2C) fuera del curso');
    {
        ok('tablero del mediador: sin sesiones ni minutos del curso', view(m, 're-b2c').every((x) => x && x.totalSessions === 0 && x.totalReadingTimeMs === 0 && x.hasData === false), dump(m, 're-b2c'));
        ok('Aula Viva del mediador: 0 minutos y ningún libro', mins(s, 're-b2c').every((q) => q && q[0] === 0) && s.every((x) => rdr(x.json, 're-b2c').progress.booksStarted === 0), sdump(s, 're-b2c'));
        ok('ninguna respuesta del mediador nombra la obra personal', [...m, ...r, ...s].every((x) => !/"cp"|Lectura personal comprada/.test(x.text)));
    }

    section('[4] agregados de la administración: población del curso, obras del curso');
    const am = await both('/api/metrics/course/g-a', C.adm), ar = await both('/api/reports/course/g-a', C.adm), as = await both('/api/groups/g-a/analytics-summary', C.adm);
    const sch = await both(`/api/metrics/school/${encodeURIComponent('Colegio Alfa')}`, C.adm), schB = await both(`/api/metrics/school/${encodeURIComponent('Colegio Beta')}`, C.adm);
    {
        ok('responden a la administración en las dos réplicas', okAll(am) && okAll(ar) && okAll(as) && okAll(sch) && okAll(schB), st([...am, ...ar, ...as, ...sch, ...schB]));
        // Activos del curso: re-epub, re-mix, re-cap, re-rev (EPUB), re-pre1, re-pre2 (accesible) y re-old (telemetría de obras
        // del curso). re-b2c NO (lectura personal). re-hist TAMPOCO (65E-C): su telemetría de LU no tiene constancia de recepción;
        // no se acredita en el tablero, igual que en Aula Viva, y el curso anuncia que existe.
        TABLA['administración · activos del curso g-a (tablero)'] = am[0].json?.summary?.activeStudentCount;
        TABLA['administración · activos del colegio Alfa'] = sch[0].json?.summary?.activeStudentCount;
        ok('tablero agregado: 14 en la nómina y 7 activos; quien solo tiene lectura personal no cuenta como activo', am.every((x) => x.json.aggregateOnly === true && x.json.summary.studentCount === 14 && x.json.summary.activeStudentCount === 7), JSON.stringify(am.map((x) => x.json.summary)));
        // A1 — mismo curso, misma población: lo que una pantalla no acredita, la otra tampoco; y las dos lo anuncian.
        const avActive = as.map((x) => (x.json.readers || []).filter((q) => q.reading.allEffectiveMs > 0 || q.progress.booksStarted > 0).map((q) => q.userId));
        TABLA['administración · LU sin constancia: activo en tablero / minutos en Aula Viva / anunciados (tablero, Aula Viva)'] = [am[0].json.summary.activeStudentCount, mins(as, 're-hist')[0]?.[0] ?? null, am[0].json.courseAttribution?.readers_with_unverifiable_history ?? null, as[0].json.courseAttribution?.readers_with_unverifiable_history ?? null];
        ok('A1: la telemetría de LU sin constancia no hace «activo» al lector en el tablero de la administración ni suma minutos en su Aula Viva', as.every((x) => rdr(x.json, 're-hist')?.reading.allEffectiveMs === 0) && avActive.every((ids) => !ids.includes('re-hist')), JSON.stringify(avActive));
        ok('A1: …y las dos pantallas anuncian al mismo lector como «lectura no atribuible» (1)', am.every((x) => x.json.courseAttribution?.readers_with_unverifiable_history === 1 && x.json.courseAttribution.course_has_works === true) && as.every((x) => x.json.courseAttribution?.readers_with_unverifiable_history === 1 && rdr(x.json, 're-hist')?.historicalActivity === true), JSON.stringify([am[0].json.courseAttribution, as[0].json.courseAttribution]));
        ok('A1: la telemetría WEB con constancia (re-old) y la lectura por progreso o eventos nativos siguen contando en las dos', as.every((x) => rdr(x.json, 're-epub')?.reading.allEffectiveMs === 20 * MIN) && am.every((x) => x.json.summary.activeStudentCount === 7));
        ok('informe agregado: los mismos 7 activos', ar.every((x) => x.json.summary.activeStudentCount === 7 && x.json.courseAttribution?.readers_with_unverifiable_history === 1), JSON.stringify(ar.map((x) => x.json.summary)));
        ok('agregado del colegio: los mismos 7 activos (también quien lee por EPUB o por el Visor Accesible)', sch.every((x) => x.json.summary.studentCount === 14 && x.json.summary.activeStudentCount === 7), JSON.stringify(sch.map((x) => x.json.summary)));
        ok('el colegio Beta cuenta solo a su lector y su lectura', schB.every((x) => x.json.summary.studentCount === 1 && x.json.summary.activeStudentCount === 1), JSON.stringify(schB.map((x) => x.json.summary)));
        const b2c = mins(as, 're-b2c');
        TABLA['administración · Aula Viva re-b2c [min]'] = b2c[0]?.[0] ?? null;
        TABLA['administración · Aula Viva re-epub [min]'] = mins(as, 're-epub')[0]?.[0] ?? null;
        ok('resumen del grupo (administración): la lectura personal no suma minutos ni libros al grupo', b2c.every((q) => q && q[0] === 0) && as.every((x) => rdr(x.json, 're-b2c').progress.booksStarted === 0), sdump(as, 're-b2c'));
        ok('…y sí la lectura EPUB de las obras del curso (20 min de re-epub, 41 de re-mix)', mins(as, 're-epub').every((q) => q?.[0] === 20) && mins(as, 're-mix').every((q) => q?.[0] === 41), `${sdump(as, 're-epub')} ${sdump(as, 're-mix')}`);
        ok('ninguna respuesta de la administración sobre el curso nombra la obra personal', [...am, ...ar, ...as].every((x) => !/"cp"/.test(x.text)));
        // Curso sin obras asociadas: se dice, no se presenta como inactividad.
        const em = await both('/api/metrics/course/g-empty', C.adm), es = await both('/api/groups/g-empty/analytics-summary', C.adm);
        ok('curso sin obras asociadas: la administración recibe la marca (cifras en cero ≠ no leen) y ninguna alerta', em.every((x) => x.status === 200 && x.json.courseAttribution?.course_has_works === false && (x.json.alerts || []).length === 0)
            && es.every((x) => x.status === 200 && x.json.courseAttribution?.course_has_works === false), st([...em, ...es]));
        const er = await both('/api/reports/course/g-empty', C.adm), ec = await both('/api/aula-viva/cohorts/group/g-empty', C['med-a']), emm = await both('/api/metrics/course/g-empty', C['med-a']);
        ok('A2: también el informe, y el mediador en tablero y agregado contextual (ningún lector «inactivo» por falta de asociación)', er.every((x) => x.json.courseAttribution?.course_has_works === false) && emm.every((x) => x.status === 200 && x.json.courseAttribution?.course_has_works === false && (x.json.needsAttention || []).length === 0)
            && ec.every((x) => x.status === 200 && (x.json.suppressed === true || x.json.by_state?.no_course_works >= 1)), st([...er, ...emm, ...ec]).slice(0, 500));
        const cb = (x, id) => (x.json.courseBreakdown || []).find((c) => c.courseId === id);
        ok('A2: el agregado del colegio marca el curso sin obras (y no los demás)', sch.every((x) => cb(x, 'g-empty')?.hasWorks === false && cb(x, 'g-a') && !('hasWorks' in cb(x, 'g-a'))), JSON.stringify(sch[0].json.courseBreakdown));
        ok('A2: cada curso del colegio lleva sus lectores activos (g-a 7, g-empty 0): sin activos no hay promedio que juzgar', sch.every((x) => cb(x, 'g-a')?.activeStudentCount === 7 && cb(x, 'g-empty')?.activeStudentCount === 0), JSON.stringify(sch[0].json.courseBreakdown.map((c) => [c.courseId, c.activeStudentCount])));
        ok('A2: un colegio CON lectores activos no se marca; el agregado conserva sus alertas', sch.every((x) => x.json.noActivity === undefined) && schB.every((x) => x.json.noActivity === undefined));
        ok('A2: la lectura personal del miembro de ese curso no se usa para llenarlo', em.every((x) => x.json.summary.activeStudentCount === 0) && es.every((x) => x.json.reading.all.totalEffectiveMs === 0), JSON.stringify(em[0].json.summary));
    }

    section('[5] no atribuible ≠ insuficiente ≠ inactivo');
    {
        ok('re-none (no ha leído): «sin actividad», necesita atención', view(m, 're-none').every((x) => x?.dataState === 'no_activity' && x.needsAttention === true), dump(m, 're-none'));
        ok('re-pre1 (lectura accesible anterior a su ingreso): «lectura no atribuible», fuera de atención, sin cifras', view(m, 're-pre1').every((x) => x?.dataState === 'unverifiable_history' && x.needsAttention === false && x.totalSessions === 0), dump(m, 're-pre1'));
        ok('…y en Aula Viva: 0 minutos CON la marca de lectura no atribuible', mins(s, 're-pre1').every((q) => q && q[0] === 0 && q[2] === true), sdump(s, 're-pre1'));
        // Lectura WEB anterior al ingreso: el tablero solo miraba el Visor Accesible y lo presentaba como «sin actividad».
        ok('re-pre3 (lectura web anterior a su ingreso): también «lectura no atribuible» en el tablero, como en Aula Viva', view(m, 're-pre3').every((x) => x?.dataState === 'unverifiable_history' && x.needsAttention === false) && mins(s, 're-pre3').every((q) => q && q[0] === 0 && q[2] === true), `${dump(m, 're-pre3')} ${sdump(s, 're-pre3')}`);
        TABLA['tablero · aviso «estudiantes con lectura no atribuible» / filas marcadas'] = [m[0].json.courseAttribution?.readers_with_unverifiable_history ?? null, (m[0].json.studentBreakdown || []).filter((x) => x.dataState === 'unverifiable_history').length];
        ok('el aviso del curso cuenta a los mismos lectores que las filas marcan (4: re-hist, re-pre1, re-pre2, re-pre3), en tablero e informe', [...m, ...r].every((x) => x.json.courseAttribution?.readers_with_unverifiable_history === 4 && (x.json.studentBreakdown || []).filter((y) => y.dataState === 'unverifiable_history').length === 4), JSON.stringify(m.map((x) => x.json.courseAttribution)));
        ok('…y el resumen de Aula Viva anuncia los mismos 4', s.every((x) => x.json.courseAttribution?.readers_with_unverifiable_history === 4), JSON.stringify(s.map((x) => x.json.courseAttribution)));
        const co = await both('/api/aula-viva/cohorts/group/g-a', C['med-a']);
        const metric = (x, k) => (x.json?.metrics || []).find((y) => y.metric_key === k)?.metric_value;
        TABLA['agregado contextual g-a [activos, no atribuibles]'] = [metric(co[0], 'active_users'), metric(co[0], 'readers_with_unattributable_activity') ?? null];
        ok('agregado contextual del curso: responde con sus lectores elegibles', co.every((x) => x.status === 200 && x.json.suppressed === false), st(co));
        ok('…los lectores con lectura no atribuible se cuentan APARTE de los activos (3), no como inactivos', co.every((x) => metric(x, 'readers_with_unattributable_activity') === 3 && metric(x, 'active_users') >= 2 && x.json.by_state.insufficient >= 3), JSON.stringify(co.map((x) => [x.json.metrics, x.json.by_state])));
        const ro = await both('/api/aula-viva/cohorts/group/g-a/rollups', C['med-a']);
        ok('…y la serie semanal lleva la misma cuenta', ro.every((x) => x.status === 200 && (x.json.weekly || []).some((w) => w.metric_key === 'readers_with_unattributable_activity')), st(ro));
    }

    section('[6] más de 20 000 eventos de un lector');
    {
        const n = sql(P.events, `SELECT COUNT(*) n FROM events WHERE user_id = 're-big'`)[0].n;
        ok('el lector tiene 20 600 filas propias en la ventana', n === 20_600, String(n));
        const tl = await both('/api/aula-viva/students/re-big/timeline', C['med-a']);
        const last = tl.map((x) => (x.json?.evolution || []).slice(-1)[0]);
        TABLA['re-big · eventos considerados en los indicadores'] = last[0]?.events ?? null;
        ok('indicadores del lector: se calculan con las 20 600 filas, no con las 20 000 más antiguas', tl.every((x) => x.status === 200) && last.every((p) => p?.events === 20_600), JSON.stringify(tl.map((x) => [x.status, x.json?.data_state, x.json?.reason, (x.json?.evolution || []).slice(-1)])));
        ok('…incluida la lectura de la última hora (última actividad de hoy)', tl.every((x) => (x.json?.profile_current?.last_active_at ?? 0) > NOW - 2 * 60 * MIN || x.json?.data_state !== 'ok'), JSON.stringify(tl.map((x) => x.json?.profile_current?.last_active_at)));
        // La lectura de historia, directa: completa, en orden, y con el techo declarado.
        const Mat = await import('../services/insightMaterializer.mjs');
        const all = Mat.readOwnEventHistory('re-big', NOW - 28 * DAY);
        const ordered = all.every((e, i) => i === 0 || e.server_ts > all[i - 1].server_ts || (e.server_ts === all[i - 1].server_ts && e.id > all[i - 1].id));
        ok('lectura de historia: 20 600 filas en orden ascendente, la última es la más reciente, sin marca de recorte', all.length === 20_600 && ordered && all[all.length - 1].event_id === 'big-new-99' && all.truncated !== true, `${all.length} ${ordered} ${all[all.length - 1]?.event_id} ${all.truncated}`);
        const capped = typeof Mat.HISTORY_MAX_ROWS === 'number' ? Mat.readOwnEventHistory('re-big', NOW - 28 * DAY, 5000) : all;
        ok('con el techo alcanzado: se conservan las MÁS RECIENTES y el resultado lo declara', capped.length === 5000 && capped.truncated === true && capped[capped.length - 1].event_id === 'big-new-99' && capped[0].server_ts < capped[4999].server_ts, `${capped.length} ${capped.truncated} ${capped[capped.length - 1]?.event_id}`);
        Mat.closeMaterializerEventsDb();
        // A3 (65E-C) — el techo REAL por HTTP: un lector con 100 500 filas en la ventana, en tres obras del curso.
        {
            const db = new Database(P.events); db.pragma('busy_timeout = 5000');
            const ins = db.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
                VALUES (?, 1, 'text.session_heartbeat', 'text', 're-huge', ?, ?, ?, ?, ?, NULL, '{}', ?)`);
            db.transaction(() => { const from = NOW - 27 * DAY, span = 26.9 * DAY; for (let i = 0; i < 100_500; i++) { const ts = from + Math.floor((i / 100_500) * span); ins.run(`huge-${i}`, i % 3 === 2 ? 'cs' : 'c1', `huge-s-${Math.floor(i / 60)}`, ts, ts, 30_000 * (i % 60), ts); } })();
            db.close();
            const rss = (s) => { try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${s.child.pid}/status`, 'utf8'))[1]) / 1024); } catch { return null; } };
            const rss0 = rss(S1), t0 = Date.now();
            const huge = await both('/api/aula-viva/students/re-huge/timeline', C['med-a']);
            const ms = Date.now() - t0, rss1 = rss(S1);
            const t1 = Date.now(); const cohort = await get(S1, '/api/aula-viva/cohorts/group/g-a', C['med-a']); const cohortMs = Date.now() - t1, rss2 = rss(S1);
            TABLA['re-huge (100 500 filas) · estado / ms por consulta / memoria del proceso antes→después (MB)'] = [huge[0].json?.reason ?? huge[0].json?.data_state, Math.round(ms / 2), `${rss0}→${rss1}`];
            TABLA['agregado del curso con ese lector · ms / memoria (MB)'] = [cohortMs, rss2];
            ok('más de 100 000 filas: «insuficiente», motivo propio, sin perfil ni riesgo (no un perfil parcial), en las dos réplicas', huge.every((x) => x.status === 200 && x.json.data_state === 'insufficient' && x.json.reason === 'history_truncated' && x.json.profile_current === null && (x.json.risks || []).length === 0), JSON.stringify(huge.map((x) => [x.status, x.json?.data_state, x.json?.reason])));
            ok('…con su explicación en la tarjeta de estado', huge.every((x) => (x.json.summaries || []).some((c) => c.id === 'context_history_truncated')), JSON.stringify(huge[0].json?.summaries?.map((c) => c.id)));
            ok('…el agregado del curso lo cuenta aparte (no como inactivo) y sigue respondiendo', cohort.status === 200 && (cohort.json.metrics || []).find((y) => y.metric_key === 'readers_with_unattributable_activity')?.metric_value === 4, JSON.stringify(cohort.json?.metrics));
            ok('…sin degradar el servicio: cada consulta en menos de 15 s y el proceso por debajo de 1,5 GB', ms / 2 < 15_000 && cohortMs < 15_000 && (rss2 === null || rss2 < 1500), `${ms} ${cohortMs} ${rss2}`);
            const h = await get(S1, '/api/health/analytics');
            ok('…y la salud analítica lo registra (lecturas que alcanzaron el techo > 0)', (h.json?.checks?.materializer?.history_truncations ?? 0) > 0 || (await get(S2, '/api/health/analytics')).json?.checks?.materializer?.history_truncations > 0, JSON.stringify(h.json?.checks?.materializer));
        }
        const Ctx = await import('../aulaViva/pedagogicalContext.mjs');
        const ctx = Ctx.buildPedagogicalContext({ readerId: 're-big', groups: [{ groupId: 'g-a', works: { all: false, ids: ['c1'] } }], intervals: null });
        const res = Ctx.computeContextualIndicators({ context: ctx, events: capped, nowTs: Date.now() }).result;
        ok('…y con una historia recortada no se entrega un perfil: «insuficiente», motivo propio', res.data_state === 'insufficient' && res.reason === 'history_truncated' && res.profile_current === null, JSON.stringify([res.data_state, res.reason]));
    }

    section('[7] dos réplicas: antigüedad de la telemetría heredada, `computedAt` y reinicio');
    {
        // S2 calcula el tablero (y deja en su memoria la telemetría leída). Pasan más de 2 s sin escrituras.
        const before = await get(S2, '/api/metrics/course/g-a', C['med-a']);
        await sleep(2300);
        await get(S2, '/api/metrics/course/g-a', C['med-a']);
        // re-fresh lee 6 minutos en la web; lo atiende S1.
        const w = await post(S1, '/api/analytics/events', C['re-fresh'], webLegacy('re-fresh', 'c1', Date.now() - 7 * MIN, 6));
        const t0 = Date.now();
        const after = await get(S2, '/api/metrics/course/g-a', C['med-a']);
        const seen = () => row(after.json, 're-fresh')?.totalSessions === 1;
        let lagMs = seen() ? 0 : null;
        if (lagMs === null) {   // se mide cuánto tarda la otra réplica en verlo (hasta 40 s)
            for (let i = 0; i < 80 && lagMs === null; i++) { await sleep(500); const x = await get(S2, '/api/metrics/course/g-a', C['med-a']); if (row(x.json, 're-fresh')?.totalSessions === 1) lagMs = Date.now() - t0; }
        }
        TABLA['telemetría heredada: desfase entre réplicas (ms)'] = lagMs;
        ok('la escritura se aceptó y la réplica ya tenía cifras previas', w.status === 200 && before.status === 200 && row(before.json, 're-fresh')?.totalSessions === 0, `${w.status} ${before.status}`);
        ok('la otra réplica cuenta la sesión en su siguiente cálculo (sin esperar a que caduque su copia)', seen(), `desfase medido: ${lagMs} ms; fila: ${JSON.stringify(fields(row(after.json, 're-fresh')))}`);
        ok('`computedAt` del tablero es el instante del cálculo y sus datos no son anteriores a la última escritura', Math.abs(after.json.computedAt - t0) < 5000 && seen(), `${after.json.computedAt - t0}`);
        // Resumen de Aula Viva: se conserva hasta 5 min por réplica y lo DICE (computedAt = cuándo se calculó).
        const a1 = await get(S1, '/api/groups/g-a/analytics-summary', C['med-a']); await sleep(1100);
        const a2 = await get(S1, '/api/groups/g-a/analytics-summary', C['med-a']);
        ok('resumen de Aula Viva servido de la memoria: `computedAt` no avanza (declara su antigüedad, no «ahora»)', a1.status === 200 && a2.json.computedAt === a1.json.computedAt && a2.json.computedAt <= Date.now() - 1000, `${a1.json?.computedAt} ${a2.json?.computedAt}`);
        // Reinicio de una réplica: mismas cifras que la otra.
        S2.child.kill('SIGTERM'); await new Promise((res) => S2.child.once('exit', res));
        S2 = start(ports[1], 2); await ready(S2);
        const [x1, x2] = await both('/api/metrics/course/g-a', C['med-a']);
        const [y1, y2] = await both('/api/groups/g-a/analytics-summary', C['med-a']);
        const proj = (j) => JSON.stringify((j.studentBreakdown || []).map((q) => [q.userId, q.totalSessions, q.totalReadingTimeMs, q.dataState]).sort());
        // re-huge queda fuera: sus filas se insertaron después de que la otra réplica calculara su resumen (lo declara su `computedAt`).
        const sproj = (j) => JSON.stringify((j.readers || []).filter((q) => q.userId !== 're-huge').map((q) => [q.userId, q.reading.allEffectiveMs, q.historicalActivity === true]).sort());
        ok('tras reiniciar una réplica: tablero idéntico en las dos (sesiones, tiempo y estado por lector)', x1.status === 200 && x2.status === 200 && proj(x1.json) === proj(x2.json), `${proj(x1.json)}\n${proj(x2.json)}`);
        ok('…y el mismo detalle por lector en el resumen de Aula Viva', y1.status === 200 && y2.status === 200 && sproj(y1.json) === sproj(y2.json), `${sproj(y1.json)}\n${sproj(y2.json)}`);
        ok('…con la lectura EPUB y la mixta intactas tras el reinicio', rdr(y2.json, 're-epub')?.reading.allEffectiveMs === 20 * MIN && rdr(y2.json, 're-mix')?.reading.allEffectiveMs === 41 * MIN, sproj(y2.json));
    }

    section('[8] /api/health/analytics lee las bases configuradas');
    {
        // La respuesta de salud se conserva 10 s por réplica (analyticsHealth.js). S1 ya la calculó en [6], ANTES de la
        // escritura de [7]: si [7] dura menos de 10 s devolvería aquel recuento (una fila menos) y no el actual. Se pide
        // una respuesta calculada después de este punto: si la que llega es anterior, se espera lo que le queda de vigencia.
        const t8 = Date.now();
        const freshHealth = async (s) => {
            let x = await get(s, '/api/health/analytics');
            const at = Date.parse(x.json?.timestamp);
            if (Number.isFinite(at) && at < t8) { await sleep(Math.max(0, at + 10_000 - Date.now()) + 100); x = await get(s, '/api/health/analytics'); }
            return x;
        };
        const h = [await freshHealth(S1), await freshHealth(S2)];
        const count = sql(P.events, 'SELECT COUNT(*) n FROM events')[0].n;
        ok('las dos respuestas de salud se calcularon después de la última escritura (no vienen de la memoria de 10 s)', h.every((x) => Date.parse(x.json?.timestamp) >= t8), JSON.stringify(h.map((x) => [x.json?.timestamp, t8])));
        TABLA['salud analítica · events.db presente / recuento'] = [h[0].json?.checks?.events_db?.present ?? null, h[0].json?.checks?.events_db?.count ?? null];
        ok('events.db: presente (la configurada) y con su recuento real', h.every((x) => x.json?.checks?.events_db?.present === true && x.json.checks.events_db.count === count), JSON.stringify(h.map((x) => x.json?.checks?.events_db)) + ` real=${count}`);
        ok('archivo de eventos: informa el configurado (todavía no existe), no otro', h.every((x) => x.json?.checks?.archive_db?.present === fs.existsSync(P.archive)), JSON.stringify(h.map((x) => x.json?.checks?.archive_db)));
        ok('consistencia con la telemetría heredada: muestrea la del directorio de datos configurado', h.every((x) => (x.json?.checks?.shadow_consistency?.legacyTailSampled ?? 0) > 0), JSON.stringify(h.map((x) => x.json?.checks?.shadow_consistency)));
        const wal = fs.existsSync(`${P.events}-wal`) ? fs.statSync(`${P.events}-wal`).size : 0;
        ok('tamaño del WAL: el de la base configurada', h.every((x) => (wal > 0) === ((x.json?.checks?.wal_size?.events_wal_bytes ?? 0) > 0)), JSON.stringify(h.map((x) => x.json?.checks?.wal_size)) + ` real=${wal}`);
        ok('el materializador declara su techo de historia y cuántas lecturas lo alcanzaron', h.every((x) => x.json?.checks?.materializer?.history_max_rows === 100_000 && Number.isFinite(x.json.checks.materializer.history_truncations)), JSON.stringify(h.map((x) => x.json?.checks?.materializer)));
    }

    section('[10] telemetría de LU anterior a 65A (sin constancia de recepción)');
    {
        const [m1] = await both('/api/metrics/course/g-a', C['med-a']);
        const s1 = await get(S2, '/api/groups/g-a/analytics-summary', C['med-a']);
        ok('la telemetría sembrada de re-hist no tiene constancia de recepción (anterior a 65A)', JSON.parse(fs.readFileSync(P.analytics, 'utf8')).filter((e) => e.userId === 're-hist').every((e) => e.receivedAt === undefined));
        ok('tablero del mediador: no se acredita (0 sesiones, 0 minutos)…', row(m1.json, 're-hist')?.totalSessions === 0 && row(m1.json, 're-hist')?.totalReadingTimeMs === 0, JSON.stringify(fields(row(m1.json, 're-hist'))));
        ok('…y tampoco se presenta como inactividad: «lectura no atribuible», fuera de atención', row(m1.json, 're-hist')?.dataState === 'unverifiable_history' && row(m1.json, 're-hist')?.needsAttention === false && !(m1.json.needsAttention || []).some((x) => x.userId === 're-hist'), JSON.stringify(fields(row(m1.json, 're-hist'))));
        ok('Aula Viva: 0 minutos con la marca de lectura no atribuible', rdr(s1.json, 're-hist')?.reading.allEffectiveMs === 0 && rdr(s1.json, 're-hist')?.historicalActivity === true, JSON.stringify(rdr(s1.json, 're-hist')));
        ok('…y el grupo dice cuántos lectores están en esa situación', (s1.json.courseAttribution?.readers_with_unverifiable_history ?? 0) >= 4, JSON.stringify(s1.json.courseAttribution));
        const asx = await get(S1, '/api/groups/g-a/analytics-summary', C.adm);
        ok('resumen de la administración: tampoco la suma, y la declara', rdr(asx.json, 're-hist')?.reading.allEffectiveMs === 0 && rdr(asx.json, 're-hist')?.historicalActivity === true && (asx.json.courseAttribution?.readers_with_unverifiable_history ?? 0) >= 1, JSON.stringify([rdr(asx.json, 're-hist'), asx.json.courseAttribution]));
    }

    section('[1b] historial de 20 sesiones por obra: completo con las constancias, mínimo declarado sin ellas');
    {
        const [m1] = await both('/api/metrics/course/g-a', C['med-a']);
        const s1 = await get(S1, '/api/groups/g-a/analytics-summary', C['med-a']);
        const a1 = await get(S1, '/api/groups/g-a/analytics-summary', C.adm);
        TABLA['re-cap (25 sesiones EPUB) · mediador [sesiones, min] / administración [min, mínimo declarado]'] = [[row(m1.json, 're-cap')?.totalSessions, MINS(row(m1.json, 're-cap')?.totalReadingTimeMs ?? 0)], [MINS(rdr(a1.json, 're-cap')?.reading.allEffectiveMs ?? 0), rdr(a1.json, 're-cap')?.sessionHistoryCapped === true]];
        ok('mediador (sesiones acreditadas por las constancias del servidor): las 25 sesiones y 50 minutos, en tablero y Aula Viva', row(m1.json, 're-cap')?.totalSessions === 25 && MINS(row(m1.json, 're-cap').totalReadingTimeMs) === 50 && row(m1.json, 're-cap').sessionHistoryCapped !== true
            && MINS(rdr(s1.json, 're-cap')?.reading.allEffectiveMs) === 50 && rdr(s1.json, 're-cap').sessionHistoryCapped !== true, JSON.stringify([fields(row(m1.json, 're-cap')), rdr(s1.json, 're-cap')]));
        ok('administración (historial del progreso, últimas 20): 40 minutos DECLARADOS como mínimo', MINS(rdr(a1.json, 're-cap')?.reading.allEffectiveMs) === 40 && rdr(a1.json, 're-cap').sessionHistoryCapped === true, JSON.stringify(rdr(a1.json, 're-cap')));
    }

    section('[9] A2 y C005 revocados; aislamiento entre instituciones');
    {
        const Reg = await import('../privacy/a2Registry.mjs');
        Reg.appendDecisions([{ subjectId: 're-rev', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-65EB' }]);
        const m2 = await both('/api/metrics/course/g-a', C['med-a']), s2 = await both('/api/groups/g-a/analytics-summary', C['med-a']);
        ok('A2 revocada: el lector deja de figurar en tablero y resumen del mediador, en las dos réplicas', m2.every((x) => x.status === 200 && !row(x.json, 're-rev') && !x.text.includes('re-rev')) && s2.every((x) => x.status === 200 && !rdr(x.json, 're-rev')), st(m2).slice(0, 300));
        ok('…sin afectar a los demás (re-epub sigue con sus 20 minutos)', m2.every((x) => MINS(row(x.json, 're-epub')?.totalReadingTimeMs) === 20), dump(m2, 're-epub'));
        // Aislamiento.
        const cross = [...await both('/api/metrics/course/g-b', C['med-a']), ...await both('/api/groups/g-b/analytics-summary', C['med-a']), ...await both('/api/reports/course/g-b', C['med-a']), ...await both('/api/aula-viva/cohorts/group/g-b', C['med-a'])];
        ok('el mediador de una institución no consulta el curso de la otra (403)', cross.every((x) => x.status === 403), st(cross));
        const mb = await both('/api/metrics/course/g-b', C['med-b']), sb = await both('/api/groups/g-b/analytics-summary', C['med-b']);
        ok('el mediador de la otra institución ve a su lector con sus 11 minutos EPUB, en tablero y Aula Viva', mb.every((x) => MINS(row(x.json, 'rb-1')?.totalReadingTimeMs) === 11) && sb.every((x) => MINS(rdr(x.json, 'rb-1')?.reading.allEffectiveMs) === 11), `${dump(mb, 'rb-1')} ${sdump(sb, 'rb-1')}`);
        ok('…y nada de la primera institución', [...mb, ...sb].every((x) => !/re-(epub|mix|b2c|cap|hist|big|old)/.test(x.text)));
        // C005 del mediador.
        Reg.appendDecisions([{ subjectId: 'med-a', kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-65EB' }]);
        const denied = [...await both('/api/metrics/course/g-a', C['med-a']), ...await both('/api/reports/course/g-a', C['med-a']), ...await both('/api/groups/g-a/analytics-summary', C['med-a']),
            ...await both('/api/aula-viva/cohorts/group/g-a', C['med-a']), ...await both('/api/aula-viva/students/re-epub/timeline', C['med-a'])];
        // Tablero e informe conservan su contrato (F5-C2): responden sin ningún lector elegible; las demás, 403.
        // El agregado contextual responde suprimido (ningún lector elegible, ninguna métrica). Un 403 repite el id de la URL.
        const suppressed = (x) => x.status === 200 && x.json?.suppressed === true && (x.json.metrics || []).length === 0 && x.json.population?.eligible === 0;
        const empty = (x) => x.status === 200 && x.json?.summary?.studentCount === 0 && (x.json.studentBreakdown || []).length === 0 && x.json.productMetrics?.totalSessions === 0;
        ok('C005 revocado: ninguna superficie entrega lectores ni cifras de lectura (403/503, o el curso sin ningún lector elegible), en las dos réplicas', denied.every((x) => (x.status === 403 || x.status === 503 || empty(x) || suppressed(x)) && !/re-(epub|mix|cap|big|old|hist)|allEffectiveMs/.test(x.text.replace(/"scope_id":"[^"]*"/, ''))), denied.map((x) => `${x.status}:${x.text.slice(0, 110)}`).join(' | '));
        const admStill = await both('/api/metrics/course/g-a', C.adm);
        ok('la administración conserva su agregado', admStill.every((x) => x.status === 200 && x.json.summary.studentCount === 14));
    }

    section('[11] memoria rodante de 50 000 eventos');
    {
        const adm0 = await get(S1, '/api/metrics/course/g-a', C.adm);
        ok('antes de llenarse: no declara recorte', adm0.json.dataCoverage === undefined || adm0.json.dataCoverage.telemetry.rolling === false, JSON.stringify(adm0.json.dataCoverage));
        // Se llena hasta 49 990 con actividad de otra cuenta (llegada posterior a lo existente) y entran 50 eventos más
        // por la ruta real: el tope descarta los más antiguos, entre ellos la única sesión de re-old.
        const current = JSON.parse(fs.readFileSync(P.analytics, 'utf8'));
        const fillerAt = Date.now() - 30 * MIN;
        const filler = Array.from({ length: 49_990 - current.length }, (_, i) => ({ eventId: `fill-${i}`, event: 'page_change', userId: 'filler', contentId: 'cp', timestamp: fillerAt + i, receivedAt: fillerAt + i }));
        const tmpFile = `${P.analytics}.seed.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify([...current, ...filler])); fs.renameSync(tmpFile, P.analytics);
        await sleep(2300);
        const pre = await get(S2, '/api/metrics/course/g-a', C.adm);
        const more = Array.from({ length: 50 }, (_, i) => ({ eventId: `fill-more-${i}`, event: 'page_change', userId: 'filler', contentId: 'cp', timestamp: Date.now() - 1000 + i }));
        const w = await post(S1, '/api/analytics/events', C.filler, more);
        const after = JSON.parse(fs.readFileSync(P.analytics, 'utf8'));
        ok('la escritura se acepta y el almacén queda en 50 000: se descartaron los 40 más antiguos', w.status === 200 && w.json.received === 50 && after.length === 50_000 && !after.some((e) => e.userId === 're-old'), `${w.status} ${after.length}`);
        const tw = Date.now(); const w2 = await post(S2, '/api/analytics/events', C.filler, [{ eventId: 'fill-cost', event: 'page_change', userId: 'filler', contentId: 'cp', timestamp: Date.now() - 500 }]); const writeMs = Date.now() - tw;
        const tr = Date.now(); const [d1, d2] = await both('/api/metrics/course/g-a', C.adm); const readMs = Math.round((Date.now() - tr) / 2);
        TABLA['almacén lleno (50 000) · ms de una escritura / ms de un tablero / tamaño (MB)'] = [writeMs, readMs, Math.round(fs.statSync(P.analytics).size / 104857.6) / 10];
        ok('con el almacén lleno, escribir un evento y calcular un tablero siguen siendo rápidos (< 5 s cada uno)', w2.status === 200 && writeMs < 5000 && readMs < 5000, `${writeMs} ${readMs}`);
        const [e1, e2] = await both('/api/groups/g-a/analytics-summary', C.adm);
        const [f1] = await both(`/api/metrics/school/${encodeURIComponent('Colegio Alfa')}`, C.adm);
        TABLA['memoria rodante · activos del curso antes / después de rodar'] = [pre.json?.summary?.activeStudentCount, d1.json?.summary?.activeStudentCount];
        TABLA['memoria rodante · cobertura declarada'] = d1.json?.dataCoverage?.telemetry ?? null;
        // Ruedan 40 eventos: la sesión de re-old, la telemetría de re-hist, la de re-mix (que sigue activo por su progreso),
        // la de re-b2c y la sesión reciente de re-fresh.
        ok('las cifras bajan (re-old y re-fresh ya no constan): 8 activos antes, 6 después', pre.json.summary.activeStudentCount === 8 && d1.json.summary.activeStudentCount === 6 && d2.json.summary.activeStudentCount === 6, `${pre.json.summary.activeStudentCount} → ${d1.json.summary.activeStudentCount}/${d2.json.summary.activeStudentCount}`);
        const kept = JSON.parse(fs.readFileSync(P.analytics, 'utf8')); const first = kept[0].receivedAt ?? kept[0].timestamp;   // tras la última escritura
        ok('…y la respuesta lo DECLARA: memoria rodante, completa solo desde la llegada del evento más antiguo conservado (tablero, las dos réplicas)', [d1, d2].every((x) => x.json.dataCoverage?.telemetry?.rolling === true && x.json.dataCoverage.telemetry.from === first), JSON.stringify([d1.json.dataCoverage, d2.json.dataCoverage, first]));
        ok('…también el informe, el resumen de Aula Viva y el agregado del colegio', [e1, e2, f1].every((x) => x.json.dataCoverage?.telemetry?.rolling === true) && (await get(S1, '/api/reports/course/g-a', C.adm)).json.dataCoverage?.telemetry?.rolling === true, JSON.stringify([e1.json.dataCoverage, f1.json.dataCoverage]));
        ok('el registro de interacciones de Leo (sin llenar) no declara recorte', d1.json.dataCoverage.leo.rolling === false);
        // Para quien media: de un lector sin sesiones solo se afirma «sin actividad DESDE» esa fecha.
        const Reg = await import('../privacy/a2Registry.mjs');
        Reg.appendDecisions([{ subjectId: 'med-a', kind: 'C005', status: 'granted', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-65EB-2' }]);
        const [g1, g2] = await both('/api/metrics/course/g-a', C['med-a']);
        ok('C005 restituido: el mediador vuelve a consultar en las dos réplicas', g1.status === 200 && g2.status === 200, st([g1, g2]).slice(0, 300));
        ok('re-old (su única sesión rodó): la fila lleva desde cuándo se conoce su actividad, no un «nunca ha leído»', [g1, g2].every((x) => row(x.json, 're-old')?.totalSessions === 0 && row(x.json, 're-old').activityKnownSince === first), JSON.stringify(fields(row(g1.json, 're-old'))) + ` ${row(g1.json, 're-old')?.activityKnownSince}`);
        ok('la lectura que no depende de esa memoria no cambia (re-epub 20 min, re-cap 25 sesiones)', [g1, g2].every((x) => MINS(row(x.json, 're-epub')?.totalReadingTimeMs) === 20 && row(x.json, 're-cap')?.totalSessions === 25), `${dump([g1, g2], 're-epub')} ${dump([g1, g2], 're-cap')}`);
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e);
    for (const s of [S1, S2]) console.error(`--- salida ${s.base}\n${s.out.slice(-1800)}`);
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    try { const { closeContextLedger } = await import('../aulaViva/contextLedger.mjs'); closeContextLedger(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    try { fs.rmSync(REG, { force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\ndataConsistencyHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
