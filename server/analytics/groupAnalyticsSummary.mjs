/**
 * groupAnalyticsSummary.mjs — CHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1A).
 *
 * Resumen REAL de un grupo para Aula Viva, derivado solo de fuentes que ya
 * existen. Sustituye como autoridad a `pedagogicalStats` (localStorage que nada
 * alimenta): no lo lee, no lo escribe, no crea store ni materialización.
 *
 * AUTORIDADES
 * -----------
 *   cohorte   resolveGroupReaderCohort (membresía vigente − mediadores) ∩
 *             userIsLectorLike. Un admin u "otro" con groupIds no es lector.
 *   lectura   computeEffectiveReadingMs + normalizador legacy, sobre la
 *             historia lógica hot ∪ archive con la semántica de
 *             `readUserHistoricalRows` (dedupe por event_id, gana la caliente).
 *             `last28d` = filas con server_ts ≥ now − 28 d, la misma frontera
 *             que la señal materializada `tiempo_efectivo_lectura`.
 *   Leo       leo_interactions_db: una entrada por POST /api/leo/ask (la misma
 *             lista que ya cuentan las métricas de curso y el nodo Leo MOOK).
 *   progreso  progress.db vía getProgressByUser, con el criterio vigente de
 *             GET /api/students/:id/status: iniciado = registro existente;
 *             completado = globalPercentage (o porcentaje) ≥ 90, o isCompleted.
 *   tareas / PISA  sin fuente de servidor → state 'no_server_source', nunca 0.
 *
 * RENDIMIENTO
 * -----------
 * Nunca se lee events.db entero: una consulta por base con
 * `WHERE user_id IN (…) AND event IN (…)` sobre la cohorte, que usa el índice
 * existente (`idx_user_content` / `idx_arch_user_content`, prefijo user_id).
 * El filtro por nombre (EFFECTIVE_READING_RAW_EVENTS) descarta la telemetría
 * de reproducción, que en producción era ~87 % de las filas de la cohorte y no
 * aporta tiempo. Solo las columnas que usa la agregación.
 */

import fs from 'node:fs';
import Database from 'better-sqlite3';
import { userIsLectorLike } from '../../utils/groupMembership.mjs';
import { resolveGroupReaderCohort } from './readerCohort.mjs';
import { computeEffectiveReadingMs, EFFECTIVE_READING_EVENT_NAMES } from './effectiveReadingTime.mjs';
import { normalizeEventForSignals, LEGACY_EVENT_MAP } from './legacyEventNormalizer.mjs';
import { DEFAULT_EVENTS_PATH, DEFAULT_ARCHIVE_PATH } from './historicalEvents.mjs';
import { readLuMirror, withLuMirror } from './luSessionMirror.mjs';

export const WINDOW_28D_MS = 28 * 86_400_000;
const NO_SERVER_SOURCE = 'no_server_source';
// Límite de parámetros por sentencia (SQLITE_MAX_VARIABLE_NUMBER conservador).
const IN_CHUNK = 500;

const nameOf = (row) => normalizeEventForSignals(row.event);

/**
 * Nombres CRUDOS de `events.event` que pueden aportar al tiempo efectivo:
 * los que el cálculo consume (identidad canónica) más las claves legacy que el
 * normalizador traduce a ellos. Derivado, nunca enumerado a mano: si cambia el
 * cálculo o el normalizador, cambia la allowlist. Filtrar por ella en SQL solo
 * evita leer filas que `computeEffectiveReadingMs` ignoraría de todos modos.
 */
export const EFFECTIVE_READING_RAW_EVENTS = Object.freeze([...new Set([
    ...EFFECTIVE_READING_EVENT_NAMES,
    ...Object.keys(LEGACY_EVENT_MAP).filter(k => EFFECTIVE_READING_EVENT_NAMES.includes(LEGACY_EVENT_MAP[k])),
])].sort());

/**
 * Lectores del grupo: membresía vigente menos mediadores, y solo roles lector.
 * @returns {string[]}
 */
export function resolveGroupLectorCohort(group, users, allGroups) {
    const byId = new Map((Array.isArray(users) ? users : []).map(u => [u?.id, u]));
    const { readerIds } = resolveGroupReaderCohort(group, users, { allGroups });
    return readerIds.filter(id => userIsLectorLike(byId.get(id)));
}

function readRowsIn(dbPath, userIds) {
    if (!userIds.length || !dbPath || !fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('busy_timeout = 5000');
        const out = [];
        const events = EFFECTIVE_READING_RAW_EVENTS;
        for (let i = 0; i < userIds.length; i += IN_CHUNK) {
            const chunk = userIds.slice(i, i + IN_CHUNK);
            const sql = `SELECT id, event_id, event, mode, user_id, content_id, server_ts, elapsed_ms, payload_json
                FROM events WHERE user_id IN (${chunk.map(() => '?').join(',')})
                AND event IN (${events.map(() => '?').join(',')})`;
            for (const r of db.prepare(sql).all(...chunk, ...events)) out.push(r);
        }
        return out;
    } finally {
        try { db.close(); } catch { /* ignore */ }
    }
}

/**
 * Filas de la cohorte en hot ∪ archive, agrupadas por usuario, con la
 * semántica de `readUserHistoricalRows`.
 * @returns {{ byUser: Map<string, object[]>, rowsConsidered: number, sources: {hot:number, archive:number} }}
 */
export function readCohortHistoricalRows(userIds, opts = {}) {
    const ids = [...new Set(userIds)];
    const hot = readRowsIn(opts.eventsPath || DEFAULT_EVENTS_PATH(), ids);
    const archive = readRowsIn(opts.archivePath || DEFAULT_ARCHIVE_PATH(), ids);
    const seen = new Set();
    const byUser = new Map();
    let rowsConsidered = 0;
    for (const r of [...hot, ...archive]) {   // la caliente entra primero y gana el dedupe
        if (r.event_id != null) {
            if (seen.has(r.event_id)) continue;
            seen.add(r.event_id);
        }
        let list = byUser.get(r.user_id);
        if (!list) { list = []; byUser.set(r.user_id, list); }
        list.push(r);
        rowsConsidered++;
    }
    for (const list of byUser.values()) list.sort((a, b) => (a.server_ts - b.server_ts) || (a.id - b.id));
    return { byUser, rowsConsidered, sources: { hot: hot.length, archive: archive.length } };
}

/**
 * V9 65D-2 — lectura de Lector Único (LU). LU no usa el hook nativo: su sesión (abrir, latido, cerrar) llega solo como
 * telemetría heredada a /api/analytics/events, marcada por la propia app con `source: 'lu_android'`
 * (AnalyticsSyncCoordinator.kt), y desde el cutover canónico esos tres hechos ya no se copian a events.db. El resumen
 * de Aula Viva, que mide el tiempo sobre events.db, no veía ni un minuto de LU.
 *
 * Aquí esos eventos se presentan como filas con la forma de events.db para que el tiempo lo calcule la MISMA función
 * (`computeEffectiveReadingMs`). Solo entran los que llevan la constancia de recepción del servidor (`receivedAt`,
 * 65A): esa constancia es posterior al cutover, así que ninguno de ellos existe también en events.db (sin doble
 * conteo, aunque el lector lea la misma obra en la web), y su fecha —la del dispositivo, nunca posterior a la
 * recepción— es la que el tablero ya usa para atribuir. Los eventos de LU sin constancia quedan fuera.
 */
export const LU_ANALYTICS_SOURCE = 'lu_android';
const LU_EVENT_TO_CANONICAL = Object.freeze({ session_start: 'reading_started', session_heartbeat: 'session_heartbeat', session_end: 'session_ended' });
const LU_RECEIPT_SKEW_MS = 5 * 60_000;

/** @returns {Map<string, object[]>} filas por lector, en orden de fecha */
export function luReadingRows(legacyEvents, userIds) {
    const cohort = new Set(userIds);
    // V9 65E-B: `uncertified` = obras con lectura de LU SIN constancia de recepción (anterior a 65A), por lector. No se
    // cuenta ni se acredita después; sirve para que ese lector no se presente como «sin lectura».
    // V9 65E-C2: `undated` = esos mismos hechos como filas SIN fecha acreditada (`date_unverified`), por lector, para el
    // contexto pedagógico: allí cuentan como historial no comprobable de la obra, nunca como lectura fechada.
    const byUser = Object.assign(new Map(), { uncertified: new Map(), undated: new Map() });
    const seen = new Set();
    let n = 0;
    for (const e of Array.isArray(legacyEvents) ? legacyEvents : []) {
        if (!e || e.source !== LU_ANALYTICS_SOURCE || !cohort.has(e.userId)) continue;
        const event = LU_EVENT_TO_CANONICAL[e.event];
        if (!event || typeof e.contentId !== 'string' || !e.contentId) continue;
        if (!Number.isFinite(e.receivedAt) || !Number.isFinite(e.timestamp) || e.timestamp > e.receivedAt + LU_RECEIPT_SKEW_MS) {
            if (!byUser.uncertified.has(e.userId)) byUser.uncertified.set(e.userId, new Set());
            byUser.uncertified.get(e.userId).add(e.contentId);
            if (!byUser.undated.has(e.userId)) byUser.undated.set(e.userId, []);
            byUser.undated.get(e.userId).push({ id: n++, event_id: null, event, mode: 'lu', user_id: e.userId, content_id: e.contentId,
                server_ts: Number.isFinite(e.timestamp) ? e.timestamp : NaN, elapsed_ms: 0, payload_json: '{}', date_unverified: true });
            continue;
        }
        if (typeof e.eventId === 'string' && e.eventId) {
            if (seen.has(e.eventId)) continue;
            seen.add(e.eventId);
        }
        const acc = [e.sessionDuration, e.elapsedMs].find(v => typeof v === 'number' && v > 0) ?? 0;
        let list = byUser.get(e.userId);
        if (!list) { list = []; byUser.set(e.userId, list); }
        list.push({ id: n++, event_id: typeof e.eventId === 'string' && e.eventId ? `lu:${e.eventId}` : null, event, mode: 'lu',
            user_id: e.userId, content_id: e.contentId, server_ts: e.timestamp, received_ts: e.receivedAt, elapsed_ms: acc, payload_json: '{}' });
    }
    for (const list of byUser.values()) list.sort((a, b) => (a.server_ts - b.server_ts) || (a.id - b.id));
    return byUser;
}

/**
 * V9 65D-2 — actividad del Visor Accesible por lector. Ese visor solo emite por el hook nativo (/api/v1/events): no
 * envía telemetría heredada ni guarda progreso, así que sus filas (`mode = 'a11y'`) no pueden estar contadas por
 * ninguna de las otras dos fuentes del tablero. Sesiones = aperturas registradas (o tramos con tiempo, si faltan);
 * tiempo = `computeEffectiveReadingMs`. `include(obra, fecha, lector)` acota al curso; si además trae
 * `include.historical`, `unattributed` reúne a quienes tienen filas de obras del curso fuera de un periodo acreditado
 * (no entran en ninguna cifra: sirven para no presentarlos como «sin actividad»).
 * @returns {Map<string, {sessions:number, readingTimeMs:number, lastTs:number}> & {unattributed:Set<string>}}
 */
export function accessibleReaderActivity(byUser, include = null) {
    const out = Object.assign(new Map(), { unattributed: new Set() });
    for (const [userId, rows] of byUser) {
        const all = rows.filter(r => r.mode === 'a11y' && typeof r.content_id === 'string' && r.content_id);
        // V9 65E-B: la marca mira la lectura de CUALQUIER visor (no solo el accesible). El resumen de Aula Viva ya decía
        // «no atribuible» de quien tiene lectura web de obras del curso fuera de un periodo acreditado; el tablero, que
        // solo miraba aquí las filas del Visor Accesible, lo presentaba como «sin actividad».
        if (typeof include?.historical === 'function' && rows.some(r => typeof r.content_id === 'string' && r.content_id && include.historical(r.content_id, r.server_ts, userId))) out.unattributed.add(userId);
        const mine = all.filter(r => typeof include !== 'function' || include(r.content_id, r.server_ts, userId));
        if (mine.length === 0) continue;
        const t = computeEffectiveReadingMs(mine, nameOf);
        const opened = mine.filter(r => nameOf(r) === 'reading_started').length;
        const sessions = Math.max(opened, t.sessions);
        if (sessions === 0) continue;
        out.set(userId, { sessions, readingTimeMs: t.ms, lastTs: Math.max(...mine.map(r => r.server_ts)) });
    }
    return out;
}

/**
 * V9 65E-B — lectura que SOLO registra el progreso. El lector EPUB no emite eventos nativos ni telemetría heredada:
 * guarda su progreso con la sesión (`mode: 'epub'`, inicio y duración). Ninguna otra fuente contiene esas sesiones, así
 * que sumarlas no puede duplicar la lectura web, la de LU ni la del Visor Accesible de la misma obra. Las sesiones del
 * progreso de los demás modos NO entran aquí: su tiempo ya está en events.db (web) o en la telemetría de LU.
 */
export const PROGRESS_ONLY_MODES = Object.freeze(['epub']);
/** Tope del historial de sesiones de un progreso (`mergeHistoryWithLimit`): con él lleno pudo haber sesiones anteriores. */
export const PROGRESS_HISTORY_CAP = 20;
export const isProgressOnlySession = (h) => !!h && PROGRESS_ONLY_MODES.includes(h.mode)
    && (typeof h.sessionId === 'string' || typeof h.sessionId === 'number') && String(h.sessionId) !== '';

/**
 * Sesiones de solo-progreso de cada lector. `sessionsOf(progreso, lector)` (opcional) entrega las sesiones acreditadas
 * por el servidor en lugar del historial recortado; si devuelve null se usa el historial.
 * @returns {Map<string, Array<{content_id:string, server_ts:number, ms:number}>> & {capped:Set<string>}}
 *          `capped`: lectores con algún historial lleno leído tal cual (pudo haber sesiones anteriores que ya no constan).
 */
export function progressOnlyReadingRows(getProgressByUser, userIds, sessionsOf = null) {
    const byUser = Object.assign(new Map(), { capped: new Set() });
    for (const id of userIds) {
        const rows = [];
        for (const p of getProgressByUser(id) || []) {
            if (!p || typeof p.contentId !== 'string' || !p.contentId) continue;
            const credited = typeof sessionsOf === 'function' ? sessionsOf(p, id) : null;
            const history = Array.isArray(p.history) ? p.history : [];
            const mine = (Array.isArray(credited) ? credited : history).filter(isProgressOnlySession);
            if (mine.length === 0) continue;
            if (!Array.isArray(credited) && history.length >= PROGRESS_HISTORY_CAP) byUser.capped.add(id);
            for (const h of mine) {
                const ts = Date.parse(h.startedAt);
                rows.push({ content_id: p.contentId, server_ts: Number.isFinite(ts) ? ts : NaN, ms: Math.max(0, Number(h.durationSec) || 0) * 1000 });
            }
        }
        if (rows.length > 0) byUser.set(id, rows);
    }
    return byUser;
}
/** Tiempo de solo-progreso de cada lector (histórico y 28 d, por fecha de inicio de la sesión), en el orden de readerIds. */
function progressOnlyPerReader(byUser, readerIds, nowTs) {
    const since = nowTs - WINDOW_28D_MS;
    return readerIds.map(id => {
        const rows = byUser.get(id) || [];
        return { allEffectiveMs: rows.reduce((a, r) => a + r.ms, 0), last28dEffectiveMs: rows.filter(r => r.server_ts >= since).reduce((a, r) => a + r.ms, 0) };
    });
}

const windowStats = (msByReader, readerCount) => {
    const total = msByReader.reduce((a, ms) => a + ms, 0);
    return {
        totalEffectiveMs: total,
        readersWithActivity: msByReader.filter(ms => ms > 0).length,
        averageEffectiveMsPerReader: readerCount > 0 ? total / readerCount : 0,
    };
};

/** Tiempo efectivo de cada lector (histórico y 28 d), en el orden de readerIds. */
export function readingPerReader(byUser, readerIds, nowTs) {
    const since = nowTs - WINDOW_28D_MS;
    return readerIds.map(id => {
        const rows = byUser.get(id) || [];
        return {
            allEffectiveMs: computeEffectiveReadingMs(rows, nameOf).ms,
            last28dEffectiveMs: computeEffectiveReadingMs(rows.filter(r => r.server_ts >= since), nameOf).ms,
        };
    });
}

/** Agregado del grupo a partir del detalle por lector. */
export function summarizeReading(byUser, readerIds, nowTs) {
    return aggregateReading(readingPerReader(byUser, readerIds, nowTs), readerIds.length);
}
const aggregateReading = (per, readerCount) => ({
    all: windowStats(per.map(r => r.allEffectiveMs), readerCount),
    last28d: windowStats(per.map(r => r.last28dEffectiveMs), readerCount),
});

/** Interacciones Leo de cada lector (entradas de leo_interactions_db). */
export function leoPerReader(interactions, readerIds) {
    const cohort = new Set(readerIds);
    const count = new Map();
    for (const it of Array.isArray(interactions) ? interactions : []) {
        if (!cohort.has(it?.userId)) continue;
        count.set(it.userId, (count.get(it.userId) || 0) + 1);
    }
    return readerIds.map(id => ({ interactions: count.get(id) || 0 }));
}

/** Agregado Leo de la cohorte. */
export function summarizeLeo(interactions, readerIds) {
    return aggregateLeo(leoPerReader(interactions, readerIds), readerIds.length);
}
const aggregateLeo = (per, readerCount) => {
    const total = per.reduce((a, r) => a + r.interactions, 0);
    return {
        interactions: total,
        readersWithInteractions: per.filter(r => r.interactions > 0).length,
        averageInteractionsPerReader: readerCount > 0 ? total / readerCount : 0,
    };
};

// Mismo criterio que GET /api/students/:id/status.
const pctOf = (p) => p?.canonicalProgress?.globalPercentage ?? p?.porcentaje ?? 0;
const isCompleted = (p) => pctOf(p) >= 90 || p?.isCompleted === true;

/** Libros de cada lector (progress.db); averagePercent = el de /status. */
export function progressPerReader(getProgressByUser, readerIds) {
    return readerIds.map(id => {
        const list = getProgressByUser(id) || [];
        return {
            booksStarted: list.length,
            booksCompleted: list.filter(isCompleted).length,
            averagePercent: list.length === 0 ? 0
                : Math.round(list.reduce((a, p) => a + pctOf(p), 0) / list.length),
        };
    });
}

/** Libros iniciados/completados de la cohorte. */
export function summarizeProgress(getProgressByUser, readerIds) {
    return aggregateProgress(progressPerReader(getProgressByUser, readerIds));
}
const aggregateProgress = (per) => ({
    readersWithProgress: per.filter(r => r.booksStarted > 0).length,
    booksStarted: per.reduce((a, r) => a + r.booksStarted, 0),
    booksCompleted: per.reduce((a, r) => a + r.booksCompleted, 0),
});

/**
 * Resumen del grupo. `getProgressByUser` y `leoInteractions` los inyecta el
 * servidor (fuentes vivas); las bases de eventos se abren en solo lectura.
 * `readers` es el detalle por lector del MISMO cálculo (sin consultas extra):
 * los agregados son, por construcción, la suma de ese detalle.
 */
export function buildGroupAnalyticsSummary({
    group, users, allGroups, leoInteractions, getProgressByUser,
    nowTs = Date.now(), eventsPath, archivePath, includeContent = null, legacyEvents = null,
}) {
    const readerIds = resolveGroupLectorCohort(group, users, allGroups);
    // 65E-B: el progreso de cada lector se lee UNA vez (lo usan el tiempo de solo-progreso y los libros).
    const readProgress = getProgressByUser, progressOf = new Map();
    getProgressByUser = (id) => { if (!progressOf.has(id)) progressOf.set(id, readProgress(id) || []); return progressOf.get(id); };
    const { byUser, rowsConsidered } = readCohortHistoricalRows(readerIds, { eventsPath, archivePath });
    // V9 65D-2: lectura de LU (telemetría heredada con constancia de recepción). Se calcula aparte y se suma.
    // V9 65E-C1: a la telemetría heredada se le unen los hechos de sesión de LU conservados en events.db que ya no están
    // en la memoria rodante (por `eventId`: mientras el evento siga allí no cambia nada, y nunca cuenta dos veces).
    legacyEvents = withLuMirror(legacyEvents, readLuMirror(readerIds, { eventsPath, archivePath }));
    const luByUser = luReadingRows(legacyEvents, readerIds);
    // V9 65E-B: lectura del lector EPUB (solo consta en el progreso). Con predicado, las sesiones son las que el
    // servidor puede acreditar (`includeContent.creditedSessions`), no el historial recortado.
    const epubByUser = progressOnlyReadingRows(getProgressByUser, readerIds, typeof includeContent?.creditedSessions === 'function' ? includeContent.creditedSessions : null);
    const historicalReaders = new Set();
    // V9 F7-C2: `includeContent` (opcional) limita el resumen a la actividad de unas obras: tiempo de lectura,
    // interacciones de Leo y libros de las demás no entran ni en el detalle ni en los agregados.
    if (typeof includeContent === 'function') {
        // V9 F7-C2R-U3B: el predicado recibe además la fecha del dato y el lector (pertenencia temporal al curso); uno de
        // un solo argumento los ignora. Del progreso se toma la fecha de su primera sesión y, si el historial de sesiones
        // está recortado (20), no se da por acreditado.
        const firstSessionTs = (p) => {
            const h = Array.isArray(p?.history) ? p.history : [];
            const ts = h.map(x => Date.parse(x?.startedAt)).filter(Number.isFinite);
            return ts.length && h.length < 20 ? Math.min(...ts) : undefined;
        };
        // Lectores con lectura fechada de obras del curso que el predicado no puede acreditar: se anota (no se cuenta
        // en ninguna cifra) para que un tiempo de lectura en cero no se lea como «no leyeron».
        if (typeof includeContent.historical === 'function') {
            // 65E-C3: las filas de LU llevan además cuándo las recibió el servidor (`received_ts`); el predicado exige el
            // contexto vigente durante todo ese tramo (65A). Las demás fuentes no lo llevan y se evalúan como antes.
            for (const src of [byUser, luByUser, epubByUser]) for (const [id, rows] of src) if (rows.some(r => includeContent.historical(r.content_id, r.server_ts, id, r.received_ts))) historicalReaders.add(id);
            // 65E-B: lectura de LU sin constancia de recepción (anterior a 65A) de obras del ámbito: no atribuible, no «cero».
            for (const [id, works] of luByUser.uncertified) if ([...works].some(c => includeContent.historical(c, NaN, id))) historicalReaders.add(id);
        }
        for (const src of [byUser, luByUser, epubByUser]) for (const [id, rows] of src) src.set(id, rows.filter(r => includeContent(r.content_id, r.server_ts, id, r.received_ts)));
        leoInteractions = (Array.isArray(leoInteractions) ? leoInteractions : []).filter(it => includeContent(it?.contentId, it?.timestamp, it?.userId));
        const allProgress = getProgressByUser;
        // V9 65A: si el predicado sabe acreditar la fecha de inicio (constancias de recepción del servidor), decide él.
        const startOf = typeof includeContent.firstSessionTs === 'function' ? includeContent.firstSessionTs : firstSessionTs;
        getProgressByUser = (id) => (allProgress(id) || []).filter(p => includeContent(p?.contentId, startOf(p, id), id));
    }
    const luReading = readingPerReader(luByUser, readerIds, nowTs);
    const epubReading = progressOnlyPerReader(epubByUser, readerIds, nowTs);
    const reading = readingPerReader(byUser, readerIds, nowTs).map((r, i) => ({
        allEffectiveMs: r.allEffectiveMs + luReading[i].allEffectiveMs + epubReading[i].allEffectiveMs,
        last28dEffectiveMs: r.last28dEffectiveMs + luReading[i].last28dEffectiveMs + epubReading[i].last28dEffectiveMs,
    }));
    // Lectores cuyo tiempo de solo-progreso sale de un historial lleno: su total es un mínimo, y se dice.
    const capped = new Set(readerIds.filter(id => epubByUser.capped.has(id) && (epubByUser.get(id) || []).length > 0));
    const leo = leoPerReader(leoInteractions, readerIds);
    const progress = progressPerReader(getProgressByUser, readerIds);
    return {
        summary: {
            groupId: group.id,
            readerCount: readerIds.length,
            reading: aggregateReading(reading, readerIds.length),
            leo: aggregateLeo(leo, readerIds.length),
            progress: aggregateProgress(progress),
            tasks: { state: NO_SERVER_SOURCE },
            pisa: { state: NO_SERVER_SOURCE },
            readers: readerIds.map((userId, i) => ({
                userId, reading: reading[i], leo: leo[i], progress: progress[i],
                ...(historicalReaders.has(userId) ? { historicalActivity: true } : {}),
                ...(capped.has(userId) ? { sessionHistoryCapped: true } : {}),
            })),
        },
        rowsConsidered,
    };
}

/**
 * V8.1-CLOSE-01 (G-02) — el mismo resumen limitado a un subconjunto de la cohorte.
 * Los agregados se recalculan con las MISMAS funciones a partir del detalle por
 * lector, así que siguen siendo la suma de `readers`. No toca el objeto de
 * entrada (puede venir de la caché).
 * @param {object} summary  salida `summary` de buildGroupAnalyticsSummary
 * @param {Set<string>} ids
 */
export function restrictSummaryToReaders(summary, ids) {
    const readers = (summary.readers || []).filter(r => ids.has(r.userId));
    return {
        ...summary,
        readerCount: readers.length,
        reading: aggregateReading(readers.map(r => r.reading), readers.length),
        leo: aggregateLeo(readers.map(r => r.leo), readers.length),
        progress: aggregateProgress(readers.map(r => r.progress)),
        readers,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1C) — caché por grupo.
//
// El resumen es el mismo para cualquier llamante autorizado al grupo, así que
// se cachea por groupId (nunca por usuario) en memoria de la réplica, TTL 5 min,
// con single-flight: varias peticiones con MISS del mismo grupo esperan UNA
// sola Promise de cálculo. Un fallo no se cachea y libera el inflight para que
// la siguiente petición reintente. Sin persistencia, sin scheduler, sin
// invalidación por eventos. La autorización NO vive aquí: el llamador la
// resuelve SIEMPRE antes de pedir el resumen (un HIT jamás salta el scope).
// ─────────────────────────────────────────────────────────────────────────────
export const GROUP_ANALYTICS_CACHE_TTL_MS = 300_000;

/**
 * @param {{ ttlMs?: number, now?: () => number }} [opts]
 */
export function createGroupAnalyticsCache({ ttlMs = GROUP_ANALYTICS_CACHE_TTL_MS, now = Date.now } = {}) {
    /** @type {Map<string, { data:any, fetchedAt:number, expiresAt:number }>} */
    const entries = new Map();
    /** @type {Map<string, Promise<{ data:any, computeMs:number, rowsConsidered:number }>>} */
    const inflight = new Map();
    return {
        /**
         * @param {string} groupId
         * @param {() => { summary:any, rowsConsidered:number }} compute
         * @returns {Promise<{ data:any, cache:'hit'|'miss'|'inflight', computeMs:number|null, rowsConsidered:number|null, fetchedAt:number }>}
         *          `fetchedAt` (65B): instante en que se calculó lo que se entrega, venga o no de la caché.
         */
        async get(groupId, compute) {
            const hit = entries.get(groupId);
            if (hit && now() < hit.expiresAt) return { data: hit.data, cache: 'hit', computeMs: null, rowsConsidered: null, fetchedAt: hit.fetchedAt };
            let flight = inflight.get(groupId);
            const joined = !!flight;
            if (!flight) {
                flight = Promise.resolve().then(() => {
                    const t0 = performance.now();
                    const { summary, rowsConsidered } = compute();
                    const computeMs = performance.now() - t0;
                    const fetchedAt = now();
                    entries.set(groupId, { data: summary, fetchedAt, expiresAt: fetchedAt + ttlMs });
                    return { data: summary, computeMs, rowsConsidered, fetchedAt };
                }).finally(() => { inflight.delete(groupId); });
                inflight.set(groupId, flight);
            }
            const r = await flight;
            // 'miss' = esta petición disparó el cálculo; 'inflight' = esperó el de otra.
            return { data: r.data, cache: joined ? 'inflight' : 'miss', computeMs: r.computeMs, rowsConsidered: r.rowsConsidered, fetchedAt: r.fetchedAt };
        },
        /** Solo diagnóstico/tests: tamaño actual. */
        size() { return { entries: entries.size, inflight: inflight.size }; },
    };
}
