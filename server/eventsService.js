/**
 * eventsService.js — capa SQLite del Data Backbone v1.
 *
 * Persiste eventos unificados en una nueva DB SQLite separada de progress.db.
 *
 * API pública:
 *   validateBackboneEvent(evt, headerUserId?) → { ok: boolean, error?: string }
 *   insertEvent(evt) → boolean        // true=insertado, false=dedup por event_id
 *   getEventCount() → number
 *   getEventCountByName(eventName) → number
 *   getEventById(eventId) → row | null      // util para tests
 *   closeDb() → void                         // graceful shutdown / tests
 *
 * Path SQLite (configurable via env):
 *   EVENTS_SQLITE_PATH || ../data-critical/events.db
 *
 * En producción (Docker compose): /var/www/chibalete/data-critical/events.db
 * → bind mount → /app/data-critical/events.db dentro del contenedor.
 *
 * En dev local: <repo>/data-critical/events.db (auto-mkdir si no existe).
 *
 * Concurrencia (2 APIs):
 *   - WAL mode permite múltiples readers + 1 writer sin bloquear lecturas.
 *   - busy_timeout=5000 absorbe colisiones momentáneas entre api_1 y api_2.
 *   - Cada proceso abre su propia conexión; SQLite coordina vía locks de archivo.
 *   - INSERT OR IGNORE garantiza dedupe atómico por event_id UNIQUE — sin race
 *     condition (no hay "check then insert"; es una sola operación atómica).
 *
 * Por qué SQLite y no Postgres:
 *   - Mismo runtime que progress.db → operacionalmente conocido.
 *   - 0 deps adicionales (better-sqlite3 ya está en package.json).
 *   - Latencia <1 ms por insert. Suficiente para el volumen del producto.
 *   - Path migration a Postgres es directo si llega ese momento.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Path configurable ─────────────────────────────────────────────────────────
const DB_PATH = process.env.EVENTS_SQLITE_PATH
    || path.resolve(__dirname, '../data-critical/events.db');

// Auto-mkdir del directorio padre. En producción ya existe (mount); en dev no.
{
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

console.log(`[eventsService] SQLite path: ${DB_PATH}`);

// ── Estado lazy (singleton por proceso) ──────────────────────────────────────
let _db = null;
let _stmtInsertOI    = null;
let _stmtCount       = null;
let _stmtCountByName = null;
let _stmtGetById     = null;
let _stmtCountByMode = null;
let _stmtCountSinceTs = null;

function getDb() {
    if (_db) return _db;

    _db = new Database(DB_PATH);

    // ── Pragmas idénticos al patrón validado de progressService ──────────────
    _db.pragma('journal_mode = WAL');           // múltiples readers + 1 writer sin bloqueo
    _db.pragma('synchronous = NORMAL');         // fsync solo en checkpoints (seguro con WAL)
    _db.pragma('busy_timeout = 5000');          // 5s de espera ante write lock
    _db.pragma('cache_size = -2000');           // 2 MB cache de páginas
    _db.pragma('temp_store = MEMORY');          // tablas temporales en RAM
    _db.pragma('wal_autocheckpoint = 100');     // checkpoint automático cada ~400 KB

    // ── Schema ────────────────────────────────────────────────────────────────
    _db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id           TEXT    UNIQUE NOT NULL,
            schema_version     INTEGER NOT NULL,
            event              TEXT    NOT NULL,
            mode               TEXT    NOT NULL,
            user_id            TEXT    NOT NULL,
            content_id         TEXT,
            session_id         TEXT    NOT NULL,
            client_ts          INTEGER NOT NULL,
            server_ts          INTEGER NOT NULL,
            elapsed_ms         INTEGER,
            progress_fraction  REAL,
            payload_json       TEXT,
            created_at         INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_user_content ON events(user_id, content_id, server_ts);
        CREATE INDEX IF NOT EXISTS idx_session      ON events(session_id);
        CREATE INDEX IF NOT EXISTS idx_event_ts     ON events(event, server_ts);
        CREATE INDEX IF NOT EXISTS idx_mode_ts      ON events(mode, server_ts);
    `);

    // ── Prepared statements ──────────────────────────────────────────────────
    _stmtInsertOI = _db.prepare(`
        INSERT OR IGNORE INTO events (
            event_id, schema_version, event, mode, user_id, content_id, session_id,
            client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at
        ) VALUES (
            @event_id, @schema_version, @event, @mode, @user_id, @content_id, @session_id,
            @client_ts, @server_ts, @elapsed_ms, @progress_fraction, @payload_json, @created_at
        )
    `);
    _stmtCount        = _db.prepare('SELECT COUNT(*) AS n FROM events');
    _stmtCountByName  = _db.prepare('SELECT COUNT(*) AS n FROM events WHERE event = ?');
    _stmtCountByMode  = _db.prepare('SELECT mode, COUNT(*) AS n FROM events WHERE server_ts >= ? GROUP BY mode');
    _stmtCountSinceTs = _db.prepare('SELECT COUNT(*) AS n FROM events WHERE server_ts >= ?');
    _stmtGetById      = _db.prepare('SELECT * FROM events WHERE event_id = ?');

    return _db;
}

// ── Mapeo fila → BackboneEvent ───────────────────────────────────────────────
//
// Garantías:
//   - payload_json corrupto → payload = {} + warning único por fila (no rompe lectura).
//   - Campos nulos quedan como undefined (en lugar de null) para alinearse con
//     el shape de los emisores (que omiten campos vacíos).

function safeParsePayload(eventId, payloadJson) {
    if (payloadJson === null || payloadJson === undefined || payloadJson === '') return undefined;
    try {
        const parsed = JSON.parse(payloadJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        // Anti-defensiva: arrays/primitivos se rechazan.
        return {};
    } catch {
        // Log solo en dev — no inundar prod si una fila vieja quedó mal serializada.
        if (process.env.NODE_ENV !== 'production') {
            console.warn(`[eventsService] payload_json inválido para event_id=${eventId}; usando {}`);
        }
        return {};
    }
}

function rowToBackboneEvent(row) {
    if (!row) return null;
    const payload = safeParsePayload(row.event_id, row.payload_json);

    // Sprint 5A — clasificación native vs legacy.
    //
    // Si el payload trae al menos un campo "real" pero no tiene _source,
    // lo etiquetamos como 'unknown' (filas históricas anteriores al sprint).
    // Si el payload original era null (sin payload) o estaba corrupto y
    // quedó como `{}`, lo dejamos como vino — el agregador interpreta la
    // ausencia como 'unknown' también, y así no contaminamos un shape que
    // los tests verifican explícitamente vacío.
    if (payload && typeof payload === 'object' && Object.keys(payload).length > 0
        && payload._source === undefined) {
        payload._source = 'unknown';
    }

    return {
        eventId:          row.event_id,
        schemaVersion:    row.schema_version,
        event:            row.event,
        mode:             row.mode,
        userId:           row.user_id,
        contentId:        row.content_id ?? null,
        sessionId:        row.session_id,
        clientTs:         row.client_ts,
        serverTs:         row.server_ts,
        elapsedMs:        row.elapsed_ms ?? undefined,
        progressFraction: row.progress_fraction ?? undefined,
        payload,
    };
}

// ── Constantes para lectura ──────────────────────────────────────────────────
const MS_PER_DAY            = 86_400_000;
const DEFAULT_WINDOW_DAYS   = 30;
const DEFAULT_HARD_LIMIT    = 100_000;

// ── Lectura cruda con filtros opcionales ─────────────────────────────────────
//
// Construye SQL con cláusulas WHERE dinámicas y placeholders (?). Nunca
// concatena valores del usuario en la query — sólo nombres de columna y
// el número de placeholders. Inmune a SQL injection.
//
// hardLimit por defecto 100k filas. Si el conjunto excede, se trunca y se
// loguea un WARN (preferimos respuesta parcial sobre OOM).

export function getEventsSince(opts = {}) {
    const db = getDb();
    const sinceTs = typeof opts.sinceTs === 'number'
        ? opts.sinceTs
        : Date.now() - DEFAULT_WINDOW_DAYS * MS_PER_DAY;
    const untilTs   = typeof opts.untilTs === 'number' ? opts.untilTs : null;
    const modes     = Array.isArray(opts.modes)      && opts.modes.length      ? opts.modes      : null;
    const userIds   = Array.isArray(opts.userIds)    && opts.userIds.length    ? opts.userIds    : null;
    const contentIds = Array.isArray(opts.contentIds) && opts.contentIds.length ? opts.contentIds : null;
    const hardLimit = typeof opts.hardLimit === 'number' ? opts.hardLimit : DEFAULT_HARD_LIMIT;

    const where  = ['server_ts >= ?'];
    const params = [sinceTs];

    if (untilTs !== null) {
        where.push('server_ts <= ?');
        params.push(untilTs);
    }
    if (modes) {
        where.push(`mode IN (${modes.map(() => '?').join(',')})`);
        params.push(...modes);
    }
    if (userIds) {
        where.push(`user_id IN (${userIds.map(() => '?').join(',')})`);
        params.push(...userIds);
    }
    if (contentIds) {
        where.push(`content_id IN (${contentIds.map(() => '?').join(',')})`);
        params.push(...contentIds);
    }

    const sql = `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY server_ts ASC LIMIT ?`;
    params.push(hardLimit);

    const rows = db.prepare(sql).all(...params);

    if (rows.length >= hardLimit && process.env.NODE_ENV !== 'production') {
        console.warn(
            `[eventsService] getEventsSince truncated to ${hardLimit} rows. ` +
            `Consider narrowing the window or using filters.`,
        );
    }

    return rows.map(rowToBackboneEvent);
}

// ── Stats agregadas (count por modo) — útil para health checks rápidos ──────

export function getBackboneEventStats(opts = {}) {
    const db = getDb();
    const sinceTs = typeof opts.sinceTs === 'number'
        ? opts.sinceTs
        : Date.now() - DEFAULT_WINDOW_DAYS * MS_PER_DAY;
    const untilTs = typeof opts.untilTs === 'number' ? opts.untilTs : null;

    let total;
    let countsByMode;

    if (untilTs === null) {
        total = _stmtCountSinceTs.get(sinceTs).n;
        countsByMode = _stmtCountByMode.all(sinceTs);
    } else {
        // Caso inusual con untilTs explícito → query ad-hoc.
        total = db.prepare('SELECT COUNT(*) AS n FROM events WHERE server_ts >= ? AND server_ts <= ?').get(sinceTs, untilTs).n;
        countsByMode = db.prepare(
            'SELECT mode, COUNT(*) AS n FROM events WHERE server_ts >= ? AND server_ts <= ? GROUP BY mode'
        ).all(sinceTs, untilTs);
    }

    const byMode = {};
    for (const row of countsByMode) byMode[row.mode] = row.n;

    return {
        total,
        byMode,
        windowFrom: sinceTs,
        windowTo:   untilTs ?? Date.now(),
    };
}

// ── Helper específico para el agregador de métricas ──────────────────────────
// Wrapper de getEventsSince con default de 30 días.

export function getBackboneEventsForMetrics(opts = {}) {
    const windowDays = typeof opts.windowDays === 'number' && opts.windowDays > 0
        ? opts.windowDays
        : DEFAULT_WINDOW_DAYS;
    const now     = Date.now();
    const sinceTs = typeof opts.sinceTs === 'number' ? opts.sinceTs : now - windowDays * MS_PER_DAY;
    const untilTs = typeof opts.untilTs === 'number' ? opts.untilTs : now;

    const events = getEventsSince({
        sinceTs,
        untilTs,
        modes:      opts.modes,
        userIds:    opts.userIds,
        contentIds: opts.contentIds,
        hardLimit:  opts.hardLimit,
    });

    return {
        events,
        windowFrom: sinceTs,
        windowTo:   untilTs,
        windowDays,
    };
}

// ── Constantes de validación ─────────────────────────────────────────────────

const VALID_MODES = new Set(['pdf', 'text', 'immersive', 'album', 'a11y', 'lu']);
// Formato {mode}.{action} — admite dígitos en mode (necesario para 'a11y') y
// guiones bajos en action. Empieza con letra para evitar nombres tipo "_x.y".
const EVENT_NAME_RX = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/;
const ULID_RX       = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const MAX_PAYLOAD_BYTES = 4 * 1024;

// ── Validación ───────────────────────────────────────────────────────────────

/**
 * Valida la forma de un BackboneEvent.
 *
 * @param {object} evt
 * @param {string} [headerUserId] - si se pasa, exige que coincida con evt.userId.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateBackboneEvent(evt, headerUserId) {
    if (!evt || typeof evt !== 'object' || Array.isArray(evt)) {
        return { ok: false, error: 'event must be an object' };
    }

    if (typeof evt.eventId !== 'string' || !ULID_RX.test(evt.eventId)) {
        return { ok: false, error: 'invalid eventId (must be ULID 26 chars)' };
    }
    if (evt.schemaVersion !== 1) {
        return { ok: false, error: 'schemaVersion must be 1' };
    }
    if (typeof evt.event !== 'string' || !EVENT_NAME_RX.test(evt.event)) {
        return { ok: false, error: 'invalid event name (expected {mode}.{action})' };
    }
    if (typeof evt.mode !== 'string' || !VALID_MODES.has(evt.mode)) {
        return { ok: false, error: `invalid mode (allowed: ${[...VALID_MODES].join(',')})` };
    }
    if (typeof evt.userId !== 'string' || evt.userId.length === 0) {
        return { ok: false, error: 'invalid userId' };
    }
    if (headerUserId !== undefined && evt.userId !== headerUserId) {
        return { ok: false, error: 'userId mismatch with x-user-id header' };
    }
    if (evt.contentId !== null && evt.contentId !== undefined && typeof evt.contentId !== 'string') {
        return { ok: false, error: 'contentId must be string or null' };
    }
    if (typeof evt.sessionId !== 'string' || evt.sessionId.length === 0) {
        return { ok: false, error: 'invalid sessionId' };
    }
    if (typeof evt.clientTs !== 'number' || !Number.isFinite(evt.clientTs)) {
        return { ok: false, error: 'invalid clientTs' };
    }
    if (evt.elapsedMs !== undefined &&
        (typeof evt.elapsedMs !== 'number' || !Number.isFinite(evt.elapsedMs))) {
        return { ok: false, error: 'invalid elapsedMs' };
    }
    if (evt.progressFraction !== undefined &&
        (typeof evt.progressFraction !== 'number' || !Number.isFinite(evt.progressFraction))) {
        return { ok: false, error: 'invalid progressFraction' };
    }
    if (evt.payload !== undefined) {
        if (typeof evt.payload !== 'object' || evt.payload === null || Array.isArray(evt.payload)) {
            return { ok: false, error: 'payload must be a plain object' };
        }
        // Cap por tamaño serializado.
        const json = JSON.stringify(evt.payload);
        if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
            return { ok: false, error: 'payload exceeds 4KB' };
        }
    }

    return { ok: true };
}

// ── Inserción ────────────────────────────────────────────────────────────────

/**
 * Inserta un evento. Dedupe atómico por event_id UNIQUE (INSERT OR IGNORE).
 *
 * @param {object} evt - debe haber pasado validateBackboneEvent.
 * @returns {boolean} true si insertó nueva fila, false si ya existía (dedup).
 */
export function insertEvent(evt) {
    const db = getDb();
    const params = {
        event_id:          evt.eventId,
        schema_version:    evt.schemaVersion,
        event:             evt.event,
        mode:              evt.mode,
        user_id:           evt.userId,
        content_id:        evt.contentId ?? null,
        session_id:        evt.sessionId,
        client_ts:         evt.clientTs,
        server_ts:         Date.now(),
        elapsed_ms:        evt.elapsedMs ?? null,
        progress_fraction: evt.progressFraction ?? null,
        payload_json:      evt.payload ? JSON.stringify(evt.payload) : null,
        created_at:        Date.now(),
    };
    const result = _stmtInsertOI.run(params);
    return result.changes > 0;
}

// ── Helpers de lectura (para tests / health checks) ──────────────────────────

export function getEventCount() {
    const db = getDb();
    return _stmtCount.get().n;
}

export function getEventCountByName(eventName) {
    const db = getDb();
    return _stmtCountByName.get(eventName).n;
}

export function getEventById(eventId) {
    const db = getDb();
    return _stmtGetById.get(eventId) ?? null;
}

// ── Shutdown ─────────────────────────────────────────────────────────────────

export function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
        _stmtInsertOI = _stmtCount = _stmtCountByName = _stmtGetById = null;
    }
}
