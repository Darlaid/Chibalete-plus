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
            const sql = `SELECT id, event_id, event, user_id, content_id, server_ts, elapsed_ms, payload_json
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

const windowStats = (msByReader, readerCount) => {
    const total = msByReader.reduce((a, ms) => a + ms, 0);
    return {
        totalEffectiveMs: total,
        readersWithActivity: msByReader.filter(ms => ms > 0).length,
        averageEffectiveMsPerReader: readerCount > 0 ? total / readerCount : 0,
    };
};

/** Tiempo efectivo por lector (histórico y 28 d) y agregado del grupo. */
export function summarizeReading(byUser, readerIds, nowTs) {
    const since = nowTs - WINDOW_28D_MS;
    const all = [], last28d = [];
    for (const id of readerIds) {
        const rows = byUser.get(id) || [];
        all.push(computeEffectiveReadingMs(rows, nameOf).ms);
        last28d.push(computeEffectiveReadingMs(rows.filter(r => r.server_ts >= since), nameOf).ms);
    }
    return { all: windowStats(all, readerIds.length), last28d: windowStats(last28d, readerIds.length) };
}

/** Interacciones Leo de la cohorte (entradas de leo_interactions_db). */
export function summarizeLeo(interactions, readerIds) {
    const cohort = new Set(readerIds);
    const perReader = new Map();
    for (const it of Array.isArray(interactions) ? interactions : []) {
        if (!cohort.has(it?.userId)) continue;
        perReader.set(it.userId, (perReader.get(it.userId) || 0) + 1);
    }
    const total = [...perReader.values()].reduce((a, n) => a + n, 0);
    return {
        interactions: total,
        readersWithInteractions: perReader.size,
        averageInteractionsPerReader: readerIds.length > 0 ? total / readerIds.length : 0,
    };
}

// Mismo criterio que GET /api/students/:id/status.
const pctOf = (p) => p?.canonicalProgress?.globalPercentage ?? p?.porcentaje ?? 0;
const isCompleted = (p) => pctOf(p) >= 90 || p?.isCompleted === true;

/** Libros iniciados/completados de la cohorte (progress.db). */
export function summarizeProgress(getProgressByUser, readerIds) {
    let readersWithProgress = 0, booksStarted = 0, booksCompleted = 0;
    for (const id of readerIds) {
        const list = getProgressByUser(id) || [];
        if (list.length) readersWithProgress++;
        booksStarted += list.length;
        booksCompleted += list.filter(isCompleted).length;
    }
    return { readersWithProgress, booksStarted, booksCompleted };
}

/**
 * Resumen del grupo. `getProgressByUser` y `leoInteractions` los inyecta el
 * servidor (fuentes vivas); las bases de eventos se abren en solo lectura.
 */
export function buildGroupAnalyticsSummary({
    group, users, allGroups, leoInteractions, getProgressByUser,
    nowTs = Date.now(), eventsPath, archivePath,
}) {
    const readerIds = resolveGroupLectorCohort(group, users, allGroups);
    const { byUser, rowsConsidered } = readCohortHistoricalRows(readerIds, { eventsPath, archivePath });
    return {
        summary: {
            groupId: group.id,
            readerCount: readerIds.length,
            reading: summarizeReading(byUser, readerIds, nowTs),
            leo: summarizeLeo(leoInteractions, readerIds),
            progress: summarizeProgress(getProgressByUser, readerIds),
            tasks: { state: NO_SERVER_SOURCE },
            pisa: { state: NO_SERVER_SOURCE },
        },
        rowsConsidered,
    };
}
