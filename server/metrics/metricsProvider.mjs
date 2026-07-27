/**
 * metricsProvider.mjs — CHP-API-METRICS-01A.
 *
 * Capa de acceso READ-ONLY que alimenta el motor canónico
 * (`engines/metrics/referenceEngine.mjs`). El motor es puro y no sabe de rutas
 * ni de SQLite; este provider es el único que toca el filesystem.
 *
 * Garantías:
 *   · las rutas llegan de `server/config.js` — cero hardcode productivo;
 *   · `events.db` se abre SIEMPRE en modo readonly;
 *   · las consultas se acotan por periodo en SQL, no en memoria: un request de
 *     30 días no arrastra el histórico completo;
 *   · orden estable por `server_ts` y desempate por `event_id`;
 *   · `analytics_db.json` solo se abre si se pide comparación legacy explícita;
 *   · no se escribe ningún store, ni JSON ni SQLite.
 *
 * Inyectable: `createMetricsProvider({ paths, openDb, readJson })` permite que
 * los tests pasen fixtures sintéticas sin tocar nada real.
 */
import fs from 'node:fs';
import path from 'node:path';
import { USERS_DB, GROUPS_DB, SCHOOLS_DB } from '../config.js';

/** Ruta canónica de events.db, con el mismo patrón env-overridable del resto. */
export const EVENTS_SQLITE_PATH = process.env.EVENTS_SQLITE_PATH
    || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
                    '..', '..', 'data-critical', 'events.db');

export class MetricsSourceError extends Error {
    constructor(source, cause) {
        super(`METRICS_SOURCE_UNAVAILABLE: ${source}${cause ? ` (${cause})` : ''}`);
        this.name = 'MetricsSourceError';
        this.code = 'METRICS_SOURCE_UNAVAILABLE';
        this.source = source;
    }
}

const readJsonArray = (file, label) => {
    if (!fs.existsSync(file)) throw new MetricsSourceError(label, 'missing');
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new MetricsSourceError(label, e?.message); }
    if (!Array.isArray(parsed)) throw new MetricsSourceError(label, 'not_an_array');
    return parsed;
};

/**
 * Abre `events.db` en readonly. Se aísla para que los tests puedan inyectar su
 * propio `openDb` y no dependan de better-sqlite3 ni de un archivo real.
 */
async function defaultOpenDb(file) {
    if (!fs.existsSync(file)) throw new MetricsSourceError('events.db', 'missing');
    const { default: Database } = await import('better-sqlite3');
    return new Database(file, { readonly: true, fileMustExist: true });
}

const EVENT_COLUMNS = `event_id AS eventId, event, mode, user_id AS userId,
                       content_id AS contentId, session_id AS sessionId,
                       server_ts AS serverTs, elapsed_ms AS elapsedMs,
                       progress_fraction AS progressFraction`;

/**
 * @param {object} [deps]
 * @param {{usersDb,groupsDb,schoolsDb,eventsDb}} [deps.paths]
 * @param {function} [deps.openDb]   (file) => Database   — solo lectura
 * @param {function} [deps.readJson] (file, label) => any[]
 */
export function createMetricsProvider(deps = {}) {
    const paths = {
        usersDb:   deps.paths?.usersDb   ?? USERS_DB,
        groupsDb:  deps.paths?.groupsDb  ?? GROUPS_DB,
        schoolsDb: deps.paths?.schoolsDb ?? SCHOOLS_DB,
        eventsDb:  deps.paths?.eventsDb  ?? EVENTS_SQLITE_PATH,
    };
    const openDb   = deps.openDb   ?? defaultOpenDb;
    const readJson = deps.readJson ?? readJsonArray;

    /** Padrones canónicos. Cada llamada relee: el motor debe ver el estado actual. */
    function loadDirectory() {
        return {
            users:   readJson(paths.usersDb,   'usuarios_colegios_oro.json'),
            groups:  readJson(paths.groupsDb,  'groups_db.json'),
            schools: readJson(paths.schoolsDb, 'schools_db.json'),
        };
    }

    /**
     * Eventos acotados por periodo. `period` = {fromTs, toTs} o null (histórico).
     * El filtrado ocurre en SQL: no se carga el histórico para recortarlo luego.
     */
    async function loadEvents(period = null) {
        const db = await openDb(paths.eventsDb);
        try {
            const rows = period
                ? db.prepare(`SELECT ${EVENT_COLUMNS} FROM events
                              WHERE server_ts >= ? AND server_ts <= ?
                              ORDER BY server_ts, event_id`).all(period.fromTs, period.toTs)
                : db.prepare(`SELECT ${EVENT_COLUMNS} FROM events
                              ORDER BY server_ts, event_id`).all();
            return rows;
        } finally {
            try { db.close(); } catch { /* cerrar nunca debe enmascarar el error real */ }
        }
    }

    /** Conteo barato para diagnóstico y control de tamaño, sin materializar filas. */
    async function countEvents(period = null) {
        const db = await openDb(paths.eventsDb);
        try {
            return period
                ? db.prepare('SELECT COUNT(*) c FROM events WHERE server_ts >= ? AND server_ts <= ?')
                    .get(period.fromTs, period.toTs).c
                : db.prepare('SELECT COUNT(*) c FROM events').get().c;
        } finally {
            try { db.close(); } catch { /* idem */ }
        }
    }

    /**
     * Sink legacy. SOLO se abre cuando se pide comparación explícita; ninguna
     * ruta canónica lo toca.
     */
    function loadLegacyAnalytics(analyticsDbPath) {
        if (!analyticsDbPath) throw new MetricsSourceError('analytics_db.json', 'path_required');
        return readJson(analyticsDbPath, 'analytics_db.json');
    }

    return { paths, loadDirectory, loadEvents, countEvents, loadLegacyAnalytics };
}
