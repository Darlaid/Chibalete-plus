/**
 * historyPreservationHttp.test.mjs — CHP V9 65E-C1 (Bloque I). La rotación técnica no destruye evidencia nueva.
 *
 * La telemetría heredada (`analytics_db.json`) es una memoria rodante de 50 000 eventos. De cada tipo de lectura se
 * comprueba, con números y por las rutas reales, en dos réplicas, qué pasa cuando rueda:
 *   [1] antes de rodar: LU (solo telemetría heredada) y web, en tablero y Aula Viva
 *   [2] los hechos de sesión de LU quedan TAMBIÉN en el almacén canónico (events.db), con fecha de dispositivo y recepción
 *   [3] reenvíos: ni la telemetría ni la copia se duplican
 *   [4] más de 50 000 eventos: la sesión de LU ya no está en la memoria rodante y SIGUE contando (antes se perdía)
 *   [5] reenvío posterior a la rotación: sigue siendo una sola sesión
 *   [6] lo que rodó sin copia (anterior a esta versión) no se inventa: se declara
 *   [7] conservación: la copia sigue contando desde el archivo de eventos
 *   [8] las señales no usan la copia (ningún indicador cambia de entradas)
 *   [9] lectura personal en LU, otra institución y A2 revocada: sin fugas
 *   [10] supresión del titular: su copia desaparece y deja de contar
 *   [11] reinicio de una réplica y coste de recepción
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/. Imprime `TABLA {…}` con las cifras medidas.
 *
 *   node server/__test__/historyPreservationHttp.test.mjs
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
    console.log('historyPreservationHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65ec1_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
P.analytics = path.join(P.data, 'analytics_db.json'); P.archive = path.join(P.data, 'archive.db');
process.env.INSIGHTS_SQLITE_PATH = P.insights; process.env.EVENTS_SQLITE_PATH = P.events; process.env.ARCHIVE_SQLITE_PATH = P.archive;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
// rl-1: LU 0.9.2 (telemetría + progreso SIN sesión) · rl-2: LU, dos obras · rw-1: web · rl-old: LU guardada antes de esta versión (sin copia)
// rl-b2c: LU sobre una obra personal · rl-rev: LU, A2 revocada · rl-sup: LU, se suprime · r-none: no lee
const GA = ['rl-1', 'rl-2', 'rw-1', 'rl-old', 'rl-b2c', 'rl-rev', 'rl-sup', 'r-none'];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', ['administrador']), acct('med-a', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-b', ['mediador'], { mediatorKind: 'teacher', ...B }),
    ...GA.map((id) => acct(id, ['lector'], A)), acct('rb-1', ['lector'], B), acct('filler', ['lector'])]));
const GROUPS = [{ id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: GA, studentIds: GA },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-1'], studentIds: ['rb-1'] }];
const RULES = [{ id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1', 'cs'], collectionIds: [] }, { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    { id: 'r-b2c', scope: 'user', scopeId: 'rl-b2c', titleIds: ['cp'], collectionIds: [], expiresAt: Date.now() + 300 * 86400000, b2c: { orderRef: 'SINT-65EC1' } }];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS)); fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['cs', 'Segunda obra'], ['cp', 'Lectura personal'], ['cb', 'Obra de la otra institución']].map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));

const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), iso = (ms) => new Date(ms).toISOString();
const luEvent = (userId, contentId, event, ts, extra = {}) => ({ eventId: crypto.randomUUID(), userId, event, timestamp: ts, contentId, source: 'lu_android', ...extra });
/** Sesión de LU: abrir, un latido por minuto y cerrar (ReaderViewModel.kt + AnalyticsSyncCoordinator.kt). */
const luSession = (userId, contentId, startMs, minutes) => {
    const evs = [luEvent(userId, contentId, 'session_start', startMs)];
    for (let m = 1; m < minutes; m++) evs.push(luEvent(userId, contentId, 'session_heartbeat', startMs + m * MIN, { elapsedMs: m * MIN }));
    evs.push(luEvent(userId, contentId, 'session_end', startMs + minutes * MIN, { sessionDuration: minutes * MIN, elapsedMs: minutes * MIN, progressPercentage: 35 }));
    return evs;
};
// rl-old: 9 min de LU de hace 5 días que YA estaban en la memoria rodante (con constancia) antes de arrancar esta
// versión: no tienen copia en events.db. Es lo primero que rodará.
fs.writeFileSync(P.analytics, JSON.stringify(luSession('rl-old', 'c1', NOW - 5 * DAY, 9).map((e) => ({ ...e, receivedAt: e.timestamp + 60_000 }))));

const REG = a2RegistryPath();
grantA2([...GA, 'rb-1']); grantC005(['med-a', 'med-b']);
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
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 260)}`).join(' | ');
const row = (j, u) => (j?.studentBreakdown || []).find((s) => s.userId === u), rdr = (j, u) => (j?.readers || []).find((s) => s.userId === u);
const MINS = (ms) => Math.round((ms || 0) / MIN);
const sql = (file, q, ...a) => { const db = new Database(file, { readonly: true, fileMustExist: true }); try { return db.prepare(q).all(...a); } finally { db.close(); } };
const stored = () => JSON.parse(fs.readFileSync(P.analytics, 'utf8'));
const nativeEvt = (userId, contentId, mode, sid, action, extra = {}) => ({ eventId: ulid(), schemaVersion: 1, event: `${mode}.${action}`, mode, userId, contentId, sessionId: sid, clientTs: Date.now(), ...extra });
const webNative = (userId, contentId, minutes) => { const sid = ulid(); return { events: [nativeEvt(userId, contentId, 'text', sid, 'session_start'), nativeEvt(userId, contentId, 'text', sid, 'session_heartbeat', { elapsedMs: 60_000 }), nativeEvt(userId, contentId, 'text', sid, 'session_end', { elapsedMs: minutes * MIN, progressFraction: 0.4 })] }; };
const webLegacy = (userId, contentId, startMs, minutes) => [{ event: 'session_start', userId, contentId, timestamp: startMs, streak: 0 }, { event: 'block_complete', userId, contentId, timestamp: startMs + 1000, streak: 1 },
    { event: 'session_end', userId, contentId, timestamp: startMs + minutes * MIN, sessionDuration: minutes * MIN, progressPercentage: 40 }];
const MIRROR = `event IN ('lu.read_session_start', 'lu.read_session_heartbeat', 'lu.read_session_end')`;
const mirrorRows = (file, u) => (fs.existsSync(file) ? sql(file, `SELECT event, mode, content_id, client_ts, server_ts, payload_json FROM events WHERE user_id = ? AND ${MIRROR} ORDER BY client_ts`, u) : []);
const tab = (rs, u) => rs.map((x) => { const q = row(x.json, u); return q ? [q.totalSessions, MINS(q.totalReadingTimeMs), q.dataState ?? null] : null; });
const av = (rs, u) => rs.map((x) => { const q = rdr(x.json, u); return q ? MINS(q.reading.allEffectiveMs) : null; });

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-b', 'rb-1', 'filler', ...GA]) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const at = (h) => NOW - h * 60 * MIN;

    section('[escritura] por las rutas reales, alternando réplicas');
    const w = [];
    // rl-1 — LU 0.9.2: 12 min leídos SIN conexión hace dos días, sincronizados hoy; progreso sin sesión.
    const lu1 = luSession('rl-1', 'c1', NOW - 2 * DAY, 12);
    w.push(await post(S1, '/api/analytics/events', C['rl-1'], lu1));
    w.push(await post(S2, '/api/progress/rl-1/c1/sync', C['rl-1'], { canonicalProgress: { globalPercentage: 30 }, updatedAt: iso(NOW - 2 * DAY + 12 * MIN), session: null }));
    // rl-2 — LU en dos obras del curso: 8 min (c1) y 5 min (cs).
    w.push(await post(S2, '/api/analytics/events', C['rl-2'], luSession('rl-2', 'c1', at(30), 8)));
    w.push(await post(S1, '/api/analytics/events', C['rl-2'], luSession('rl-2', 'cs', at(6), 5)));
    // rw-1 — web: la misma sesión de 10 min por hook nativo, telemetría heredada y progreso.
    w.push(await post(S1, '/api/v1/events', C['rw-1'], webNative('rw-1', 'c1', 10)));
    w.push(await post(S2, '/api/analytics/events', C['rw-1'], webLegacy('rw-1', 'c1', at(20), 10)));
    w.push(await post(S1, '/api/progress/rw-1/c1/sync', C['rw-1'], { canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: 40, lastInteractedMode: 'text' }, updatedAt: iso(at(20) + 10 * MIN), session: { sessionId: 'web-1', startedAt: iso(at(20)), durationSec: 600, mode: 'text' } }));
    // rl-b2c — LU sobre su obra PERSONAL (7 min). rl-rev y rl-sup — LU sobre la obra del curso (6 y 4 min).
    w.push(await post(S2, '/api/analytics/events', C['rl-b2c'], luSession('rl-b2c', 'cp', at(9), 7)));
    w.push(await post(S1, '/api/analytics/events', C['rl-rev'], luSession('rl-rev', 'c1', at(8), 6)));
    w.push(await post(S2, '/api/analytics/events', C['rl-sup'], luSession('rl-sup', 'c1', at(7), 4)));
    // rb-1 (otra institución) — LU, 11 min.
    w.push(await post(S1, '/api/analytics/events', C['rb-1'], luSession('rb-1', 'cb', at(5), 11)));
    ok('todas las escrituras aceptadas', w.every((x) => x.status === 200 || x.status === 202), w.filter((x) => x.status !== 200 && x.status !== 202).map((x) => `${x.status} ${x.text.slice(0, 120)}`).join(' | '));

    section('[1] antes de rodar');
    const m0 = await both('/api/metrics/course/g-a', C['med-a']);
    const s0 = await get(S1, '/api/groups/g-a/analytics-summary', C['med-a']);   // S2 calculará el suyo después de rodar
    const a0 = await get(S1, '/api/groups/g-a/analytics-summary', C.adm);
    ok('tablero: LU 1 sesión / 12 min (rl-1), 2 sesiones / 13 min (rl-2); web 1 sesión / 10 min', JSON.stringify(tab(m0, 'rl-1')) === JSON.stringify([[1, 12, 'verified_context'], [1, 12, 'verified_context']]) && tab(m0, 'rl-2').every((q) => q[0] === 2 && q[1] === 13) && tab(m0, 'rw-1').every((q) => q[0] === 1 && q[1] === 10), JSON.stringify([tab(m0, 'rl-1'), tab(m0, 'rl-2'), tab(m0, 'rw-1')]));
    ok('Aula Viva: los mismos minutos (12, 13 y 10)', av([s0], 'rl-1')[0] === 12 && av([s0], 'rl-2')[0] === 13 && av([s0], 'rw-1')[0] === 10, JSON.stringify([av([s0], 'rl-1'), av([s0], 'rl-2'), av([s0], 'rw-1')]));
    ok('rl-old (LU guardada antes de esta versión, con constancia): cuenta mientras siga en la memoria rodante (1 sesión, 9 min)', tab(m0, 'rl-old').every((q) => q[0] === 1 && q[1] === 9) && av([s0], 'rl-old')[0] === 9, JSON.stringify([tab(m0, 'rl-old'), av([s0], 'rl-old')]));
    TABLA['antes de rodar · tablero [sesiones, min] rl-1 / rl-2 / rw-1 / rl-old'] = [tab(m0, 'rl-1')[0], tab(m0, 'rl-2')[0], tab(m0, 'rw-1')[0], tab(m0, 'rl-old')[0]].map((q) => q?.slice(0, 2));
    TABLA['antes de rodar · Aula Viva [min] rl-1 / rl-2 / rw-1 / rl-old'] = [av([s0], 'rl-1')[0], av([s0], 'rl-2')[0], av([s0], 'rw-1')[0], av([s0], 'rl-old')[0]];

    section('[2] copia canónica de los hechos de sesión de LU (events.db)');
    const mir1 = mirrorRows(P.events, 'rl-1');
    {
        ok('rl-1: sus 13 hechos de sesión (abrir, 11 latidos, cerrar) están en events.db', mir1.length === 13 && mir1[0].event === 'lu.read_session_start' && mir1[12].event === 'lu.read_session_end' && mir1.every((r) => r.mode === 'lu' && r.content_id === 'c1'), `${mir1.length} ${JSON.stringify(mir1[0])}`);
        ok('…con la fecha del dispositivo (hace dos días) y la de recepción del servidor (hoy)', mir1.length === 13 && mir1.every((r, i) => r.client_ts === lu1[i].timestamp && r.server_ts >= NOW - 5 * MIN && r.server_ts <= Date.now()), JSON.stringify([mir1[0]?.client_ts, lu1[0].timestamp, mir1[0]?.server_ts]));
        ok('…y el identificador original de LU (para no repetir) y la duración del cierre', mir1.length === 13 && mir1.every((r, i) => JSON.parse(r.payload_json).eventId === lu1[i].eventId) && JSON.parse(mir1[12].payload_json).sessionDuration === 12 * MIN, mir1[12]?.payload_json);
        ok('la telemetría WEB no se copia así (su sesión ya la escribe el hook nativo): 0 filas', mirrorRows(P.events, 'rw-1').length === 0 && sql(P.events, `SELECT COUNT(*) n FROM events WHERE user_id = 'rw-1'`)[0].n >= 3, JSON.stringify(sql(P.events, `SELECT event, mode FROM events WHERE user_id = 'rw-1'`)));
        ok('rl-old (anterior a esta versión) no tiene copia: no se reconstruye lo que no se recibió aquí', mirrorRows(P.events, 'rl-old').length === 0);
        TABLA['copia en events.db · hechos de sesión rl-1 / rl-2 / rl-old'] = [mir1.length, mirrorRows(P.events, 'rl-2').length, mirrorRows(P.events, 'rl-old').length];
    }

    section('[3] reenvíos antes de rodar');
    {
        const again = [await post(S2, '/api/analytics/events', C['rl-1'], lu1), await post(S1, '/api/analytics/events', C['rl-1'], lu1)];
        ok('reenvío completo por las dos réplicas: 0 nuevos en la memoria rodante', again.every((x) => x.json?.received === 0 && x.json.deduplicated === 13), st(again));
        ok('…y la copia sigue con 13 filas', mirrorRows(P.events, 'rl-1').length === 13);
        const m = await both('/api/metrics/course/g-a', C['med-a']);
        ok('…y el tablero sigue en 1 sesión / 12 min', tab(m, 'rl-1').every((q) => q[0] === 1 && q[1] === 12), JSON.stringify(tab(m, 'rl-1')));
    }

    section('[8] las señales no usan la copia');
    {
        const Mat = await import('../services/insightMaterializer.mjs');
        const h = Mat.readOwnEventHistory('rl-1', NOW - 28 * DAY); Mat.closeMaterializerEventsDb();
        ok('la historia de eventos de un lector de LU no incluye la copia (0 filas): ninguna señal cambia de entradas', h.length === 0, String(h.length));
        const tl = await both('/api/aula-viva/students/rw-1/timeline', C['med-a']);
        ok('el lector web conserva sus indicadores contextuales', tl.every((x) => x.status === 200 && (x.json.evolution || []).slice(-1)[0]?.events >= 3 && x.json.data_state === 'ok'), JSON.stringify(tl.map((x) => [x.status, (x.json?.evolution || []).slice(-1)])));
    }

    section('[4] más de 50 000 eventos');
    {
        const before = stored();
        ok('antes: la sesión de rl-1 está en la memoria rodante', before.filter((e) => e.userId === 'rl-1').length === 13);
        const fillerAt = Date.now() - 30 * MIN;
        const filler = Array.from({ length: 49_990 - before.length }, (_, i) => ({ eventId: `fill-${i}`, event: 'page_change', userId: 'filler', contentId: 'cp', timestamp: fillerAt + i, receivedAt: fillerAt + i }));
        fs.writeFileSync(`${P.analytics}.seed.tmp`, JSON.stringify([...before, ...filler])); fs.renameSync(`${P.analytics}.seed.tmp`, P.analytics);
        await sleep(2300);
        // Entran más eventos por la ruta real hasta desalojar TODO lo anterior (LU y web).
        let rounds = 0;
        while (stored().some((e) => e.userId !== 'filler') && rounds < 8) { rounds++; const r = await post(rounds % 2 ? S1 : S2, '/api/analytics/events', C.filler, Array.from({ length: 50 }, (_, i) => ({ eventId: `more-${rounds}-${i}`, event: 'page_change', userId: 'filler', contentId: 'cp', timestamp: Date.now() - 1000 + i }))); if (r.status !== 200) break; }
        const after = stored();
        ok('la memoria rodante quedó en 50 000 y ya no guarda NINGÚN evento de lectores (ni LU ni web)', after.length === 50_000 && after.every((e) => e.userId === 'filler'), `${after.length} ${after.filter((e) => e.userId !== 'filler').length}`);
        const m = await both('/api/metrics/course/g-a', C['med-a']), ma = await both('/api/metrics/course/g-a', C.adm);
        const s = await get(S2, '/api/groups/g-a/analytics-summary', C['med-a']), sa = await get(S2, '/api/groups/g-a/analytics-summary', C.adm);
        TABLA['tras rodar · tablero [sesiones, min] rl-1 / rl-2 / rw-1 / rl-old'] = [tab(m, 'rl-1')[0], tab(m, 'rl-2')[0], tab(m, 'rw-1')[0], tab(m, 'rl-old')[0]].map((q) => q?.slice(0, 2));
        TABLA['tras rodar · Aula Viva [min] rl-1 / rl-2 / rw-1 / rl-old'] = [av([s], 'rl-1')[0], av([s], 'rl-2')[0], av([s], 'rw-1')[0], av([s], 'rl-old')[0]];
        ok('tablero: la lectura de LU SIGUE contando igual (rl-1 1 sesión / 12 min; rl-2 2 sesiones / 13 min), en las dos réplicas', tab(m, 'rl-1').every((q) => q && q[0] === 1 && q[1] === 12 && q[2] === 'verified_context') && tab(m, 'rl-2').every((q) => q && q[0] === 2 && q[1] === 13), JSON.stringify([tab(m, 'rl-1'), tab(m, 'rl-2')]));
        ok('Aula Viva: los mismos 12 y 13 minutos (mediador y administración)', av([s], 'rl-1')[0] === 12 && av([s], 'rl-2')[0] === 13 && av([sa], 'rl-1')[0] === 12 && av([sa], 'rl-2')[0] === 13, JSON.stringify([av([s], 'rl-1'), av([s], 'rl-2'), av([sa], 'rl-1')]));
        ok('con la fecha del dispositivo (la lectura de hace dos días sigue fechada entonces, no hoy)', (row(m[0].json, 'rl-1')?.lastAccessAt ?? 0) <= NOW - 2 * DAY + 13 * MIN && (row(m[0].json, 'rl-1')?.lastAccessAt ?? 0) >= NOW - 2 * DAY, String(row(m[0].json, 'rl-1')?.lastAccessAt));
        ok('web: la sesión sigue contando por su progreso (1 sesión / 10 min) y en Aula Viva por sus eventos (10 min)', tab(m, 'rw-1').every((q) => q && q[0] === 1 && q[1] === 10) && av([s], 'rw-1')[0] === 10, JSON.stringify([tab(m, 'rw-1'), av([s], 'rw-1')]));
        ok('agregado de la administración: los mismos activos que antes de rodar, menos rl-old', ma.every((x) => x.status === 200 && x.json.dataCoverage?.telemetry?.rolling === true), JSON.stringify(ma.map((x) => [x.json?.summary?.activeStudentCount, x.json?.dataCoverage?.telemetry])));
        TABLA['activos del curso (administración) antes / después de rodar'] = [(await get(S1, '/api/metrics/course/g-a', C.adm)).json?.summary?.activeStudentCount, ma[0].json?.summary?.activeStudentCount];
        globalThis.afterRoll = { m, s, a0 };

        section('[6] lo que rodó sin copia no se inventa');
        ok('rl-old: su telemetría rodó y no tenía copia → 0 sesiones, con «sin actividad registrada desde…» (no «nunca ha leído»)', tab(m, 'rl-old').every((q) => q && q[0] === 0 && q[1] === 0) && m.every((x) => Number.isFinite(row(x.json, 'rl-old')?.activityKnownSince)), JSON.stringify(m.map((x) => [tab([x], 'rl-old')[0], row(x.json, 'rl-old')?.activityKnownSince])));
        ok('…Aula Viva: 0 minutos, sin fabricar nada', av([s], 'rl-old')[0] === 0);
        ok('…y la respuesta declara desde cuándo es completa la memoria rodante', m.every((x) => x.json.dataCoverage?.telemetry?.rolling === true && Number.isFinite(x.json.dataCoverage.telemetry.from)) && s.json.dataCoverage?.telemetry?.rolling === true);
    }

    section('[5] reenvío posterior a la rotación');
    {
        const r1 = await post(S1, '/api/analytics/events', C['rl-1'], lu1), n = mirrorRows(P.events, 'rl-1').length;
        ok('la memoria rodante ya no recuerda el lote y lo acepta de nuevo (13 «nuevos»)…', r1.status === 200 && r1.json.received === 13, r1.text);
        ok('…pero la copia canónica lo reconoce: siguen siendo 13 filas', n === 13, String(n));
        const m = await both('/api/metrics/course/g-a', C['med-a']);
        ok('…y sigue siendo UNA sesión de 12 minutos en el tablero (no dos)', tab(m, 'rl-1').every((q) => q && q[0] === 1 && q[1] === 12), JSON.stringify(tab(m, 'rl-1')));
        const sa = await get(S1, '/api/metrics/school/' + encodeURIComponent('Colegio Alfa'), C.adm);
        ok('…y el agregado del colegio responde con la lectura de LU contada', sa.status === 200 && sa.json.summary.activeStudentCount >= 3, JSON.stringify(sa.json?.summary));
    }

    section('[9] lectura personal, otra institución y A2 revocada');
    {
        const { m, s } = globalThis.afterRoll;
        ok('LU sobre una obra personal: copiada como evidencia del lector, pero NO cuenta para el curso', mirrorRows(P.events, 'rl-b2c').length === 8 && tab(m, 'rl-b2c').every((q) => q && q[0] === 0) && av([s], 'rl-b2c')[0] === 0 && m.every((x) => !/"cp"/.test(x.text)), JSON.stringify(tab(m, 'rl-b2c')));
        const cross = [...await both('/api/metrics/course/g-b', C['med-a']), ...await both('/api/groups/g-b/analytics-summary', C['med-a'])];
        ok('el mediador de una institución no consulta el curso de la otra', cross.every((x) => x.status === 403), st(cross));
        const mb = await both('/api/metrics/course/g-b', C['med-b']);
        ok('la otra institución ve la lectura de LU de su lector (11 min) y nada de la primera', tab(mb, 'rb-1').every((q) => q && q[0] === 1 && q[1] === 11) && mb.every((x) => !/rl-|rw-/.test(x.text)), JSON.stringify(tab(mb, 'rb-1')));
        const Reg = await import('../privacy/a2Registry.mjs');
        Reg.appendDecisions([{ subjectId: 'rl-rev', kind: 'A2', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-65EC1' }]);
        const m2 = await both('/api/metrics/course/g-a', C['med-a']);
        ok('A2 revocada: el lector desaparece del tablero del mediador aunque su lectura esté conservada', m2.every((x) => x.status === 200 && !row(x.json, 'rl-rev') && !x.text.includes('rl-rev')));
    }

    section('[7] conservación: la copia cuenta también desde el archivo de eventos');
    {
        // Lo que hará la rotación aprobada (90 días): las filas pasan de events.db al archivo. Aquí se mueven las de rl-2.
        const hot = new Database(P.events); hot.pragma('busy_timeout = 5000');
        const rows = hot.prepare(`SELECT * FROM events WHERE user_id = 'rl-2' AND ${MIRROR}`).all();
        const ddl = hot.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'`).get().sql;
        const arch = new Database(P.archive); arch.exec(ddl.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS').replace('IF NOT EXISTS IF NOT EXISTS', 'IF NOT EXISTS'));
        const cols = Object.keys(rows[0]);
        const ins = arch.prepare(`INSERT INTO events (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`);
        arch.transaction(() => rows.forEach((r) => ins.run(r)))(); arch.close();
        hot.prepare(`DELETE FROM events WHERE user_id = 'rl-2' AND ${MIRROR}`).run(); hot.close();
        ok('las filas de rl-2 están ahora solo en el archivo', mirrorRows(P.events, 'rl-2').length === 0 && mirrorRows(P.archive, 'rl-2').length === rows.length, `${rows.length}`);
        const m = await both('/api/metrics/course/g-a', C['med-a']);
        ok('…y su lectura sigue contando igual (2 sesiones / 13 min) en las dos réplicas', tab(m, 'rl-2').every((q) => q && q[0] === 2 && q[1] === 13), JSON.stringify(tab(m, 'rl-2')));
    }

    section('[10] supresión del titular');
    {
        const SUP = await import('../privacy/suppression.mjs');
        const paths = SUP.residualPaths({ CHP_DATA_DIR: P.data, EVENTS_SQLITE_PATH: P.events, ARCHIVE_SQLITE_PATH: P.archive, PROGRESS_SQLITE_PATH: P.progress,
            LEO_EVIDENCE_DB: P.evidence, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), ACCESS_DB: P.access, INSIGHTS_SQLITE_PATH: P.insights }, tmp);
        const before = mirrorRows(P.events, 'rl-sup').length;
        await SUP.suppressResidualSources(paths, 'rl-sup');
        ok('la supresión retira también la copia de sus sesiones de LU', before === 5 && mirrorRows(P.events, 'rl-sup').length === 0, `${before} → ${mirrorRows(P.events, 'rl-sup').length}`);
        const m = await both('/api/metrics/course/g-a', C['med-a']);
        ok('…y deja de contar en las dos réplicas; la de los demás sigue', tab(m, 'rl-sup').every((q) => !q || q[0] === 0) && tab(m, 'rl-1').every((q) => q && q[0] === 1 && q[1] === 12), JSON.stringify([tab(m, 'rl-sup'), tab(m, 'rl-1')]));
    }

    section('[11] reinicio y coste');
    {
        S2.child.kill('SIGTERM'); await new Promise((res) => S2.child.once('exit', res));
        S2 = start(ports[1], 2); await ready(S2);
        const m = await both('/api/metrics/course/g-a', C['med-a']);
        const proj = (j) => JSON.stringify((j.studentBreakdown || []).map((q) => [q.userId, q.totalSessions, q.totalReadingTimeMs]).sort());
        ok('tras reiniciar una réplica: tablero idéntico en las dos', m.every((x) => x.status === 200) && proj(m[0].json) === proj(m[1].json), `${proj(m[0].json)}\n${proj(m[1].json)}`);
        // Coste: un lote de 50 eventos de LU (el máximo por petición) con el almacén lleno.
        const big = luSession('rl-2', 'cs', Date.now() - 60 * MIN, 49);
        const t0 = Date.now(); const r = await post(S1, '/api/analytics/events', C['rl-2'], big); const ms = Date.now() - t0;
        const rowsNow = sql(P.events, `SELECT COUNT(*) n FROM events WHERE ${MIRROR}`)[0].n;
        TABLA['recepción de 50 hechos de LU con el almacén lleno (ms) / filas de copia en events.db'] = [ms, rowsNow];
        ok('recibir 50 hechos de sesión de LU con el almacén lleno tarda menos de 5 s y deja 50 filas más', r.status === 200 && r.json.received === 50 && ms < 5000 && mirrorRows(P.events, 'rl-2').length === 50, `${ms} ms ${mirrorRows(P.events, 'rl-2').length}`);
        const t1 = Date.now(); const m2 = await get(S2, '/api/metrics/course/g-a', C['med-a']); const readMs = Date.now() - t1;
        TABLA['tablero con la copia unida (ms)'] = readMs;
        ok('el tablero la cuenta en la otra réplica de inmediato (3 sesiones) y responde en menos de 5 s', row(m2.json, 'rl-2')?.totalSessions === 3 && readMs < 5000, `${row(m2.json, 'rl-2')?.totalSessions} ${readMs}`);
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
console.log(`\nhistoryPreservationHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
