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
    nowTs = Date.now(), eventsPath, archivePath,
}) {
    const readerIds = resolveGroupLectorCohort(group, users, allGroups);
    const { byUser, rowsConsidered } = readCohortHistoricalRows(readerIds, { eventsPath, archivePath });
    const reading = readingPerReader(byUser, readerIds, nowTs);
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
            })),
        },
        rowsConsidered,
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
         * @returns {Promise<{ data:any, cache:'hit'|'miss'|'inflight', computeMs:number|null, rowsConsidered:number|null }>}
         */
        async get(groupId, compute) {
            const hit = entries.get(groupId);
            if (hit && now() < hit.expiresAt) return { data: hit.data, cache: 'hit', computeMs: null, rowsConsidered: null };
            let flight = inflight.get(groupId);
            const joined = !!flight;
            if (!flight) {
                flight = Promise.resolve().then(() => {
                    const t0 = performance.now();
                    const { summary, rowsConsidered } = compute();
                    const computeMs = performance.now() - t0;
                    const fetchedAt = now();
                    entries.set(groupId, { data: summary, fetchedAt, expiresAt: fetchedAt + ttlMs });
                    return { data: summary, computeMs, rowsConsidered };
                }).finally(() => { inflight.delete(groupId); });
                inflight.set(groupId, flight);
            }
            const r = await flight;
            // 'miss' = esta petición disparó el cálculo; 'inflight' = esperó el de otra.
            return { data: r.data, cache: joined ? 'inflight' : 'miss', computeMs: r.computeMs, rowsConsidered: r.rowsConsidered };
        },
        /** Solo diagnóstico/tests: tamaño actual. */
        size() { return { entries: entries.size, inflight: inflight.size }; },
    };
}
