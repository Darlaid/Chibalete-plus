/**
 * insightsStore.js — capa SQLite para alertas persistidas (Sprint 6C).
 *
 * DB SEPARADA de events.db. Se persisten 3 entidades:
 *   - insight_snapshots: foto completa de cada corrida del agregador.
 *   - insight_states:    estado vivo por insight_key (active/resolved/...).
 *   - insight_notifications: cola interna de notificaciones (channel=dashboard).
 *
 * Path:
 *   INSIGHTS_SQLITE_PATH || ../data-critical/insights.db
 *
 * Producción (Docker compose): /var/www/chibalete/data-critical/insights.db
 *   → bind mount → /app/data-critical/insights.db dentro del contenedor.
 *
 * Concurrencia (2 APIs):
 *   - WAL mode permite múltiples readers + 1 writer sin bloquear lecturas.
 *   - busy_timeout=5000 absorbe colisiones momentáneas.
 *   - INSERT OR IGNORE garantiza dedupe atómico para snapshots/notifications.
 *
 * Por qué separar de events.db:
 *   - events.db crece muy rápido y se hace bind mount con políticas distintas.
 *   - Permite tirar/reconstruir alertas sin tocar telemetría.
 *   - Schema independiente.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DB_PATH = process.env.INSIGHTS_SQLITE_PATH
    || path.resolve(__dirname, '../data-critical/insights.db');

{
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

console.log(`[insightsStore] SQLite path: ${DB_PATH}`);

let _db = null;
let _stmt = null;

function getDb() {
    if (_db) return _db;

    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('busy_timeout = 5000');
    _db.pragma('cache_size = -2000');
    _db.pragma('temp_store = MEMORY');
    _db.pragma('wal_autocheckpoint = 100');

    _db.exec(`
        CREATE TABLE IF NOT EXISTS insight_snapshots (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id   TEXT    UNIQUE NOT NULL,
            scope_level   TEXT    NOT NULL,
            scope_id      TEXT,
            window_days   INTEGER NOT NULL,
            generated_at  INTEGER NOT NULL,
            summary_json  TEXT    NOT NULL,
            insights_json TEXT    NOT NULL,
            created_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS insight_states (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            insight_key       TEXT    UNIQUE NOT NULL,
            scope_level       TEXT    NOT NULL,
            scope_id          TEXT,
            type              TEXT    NOT NULL,
            severity          TEXT    NOT NULL,
            title             TEXT    NOT NULL,
            status            TEXT    NOT NULL,
            first_seen_at     INTEGER NOT NULL,
            last_seen_at      INTEGER NOT NULL,
            last_value        REAL,
            previous_value    REAL,
            delta_value       REAL,
            occurrences       INTEGER NOT NULL,
            dismissed_until   INTEGER,
            acknowledged_at   INTEGER,
            acknowledged_by   TEXT,
            last_payload_json TEXT    NOT NULL,
            updated_at        INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS insight_notifications (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            notification_id TEXT    UNIQUE NOT NULL,
            insight_key     TEXT    NOT NULL,
            scope_level     TEXT    NOT NULL,
            scope_id        TEXT,
            severity        TEXT    NOT NULL,
            channel         TEXT    NOT NULL,
            status          TEXT    NOT NULL,
            created_at      INTEGER NOT NULL,
            sent_at         INTEGER,
            payload_json    TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_states_scope_sev ON insight_states(scope_level, scope_id, severity);
        CREATE INDEX IF NOT EXISTS idx_states_status_ts ON insight_states(status, last_seen_at);
        CREATE INDEX IF NOT EXISTS idx_notif_status_ts  ON insight_notifications(status, created_at);
    `);

    _stmt = {
        insertSnapshot: _db.prepare(`
            INSERT OR IGNORE INTO insight_snapshots (
                snapshot_id, scope_level, scope_id, window_days,
                generated_at, summary_json, insights_json, created_at
            ) VALUES (
                @snapshotId, @scopeLevel, @scopeId, @windowDays,
                @generatedAt, @summaryJson, @insightsJson, @createdAt
            )
        `),
        getStateByKey: _db.prepare(`SELECT * FROM insight_states WHERE insight_key = ?`),
        upsertState: _db.prepare(`
            INSERT INTO insight_states (
                insight_key, scope_level, scope_id, type, severity, title,
                status, first_seen_at, last_seen_at, last_value, previous_value,
                delta_value, occurrences, dismissed_until, acknowledged_at,
                acknowledged_by, last_payload_json, updated_at
            ) VALUES (
                @insightKey, @scopeLevel, @scopeId, @type, @severity, @title,
                @status, @firstSeenAt, @lastSeenAt, @lastValue, @previousValue,
                @deltaValue, @occurrences, @dismissedUntil, @acknowledgedAt,
                @acknowledgedBy, @lastPayloadJson, @updatedAt
            )
            ON CONFLICT(insight_key) DO UPDATE SET
                severity          = excluded.severity,
                title             = excluded.title,
                status            = excluded.status,
                last_seen_at      = excluded.last_seen_at,
                last_value        = excluded.last_value,
                previous_value    = excluded.previous_value,
                delta_value       = excluded.delta_value,
                occurrences       = excluded.occurrences,
                dismissed_until   = excluded.dismissed_until,
                acknowledged_at   = excluded.acknowledged_at,
                acknowledged_by   = excluded.acknowledged_by,
                last_payload_json = excluded.last_payload_json,
                updated_at        = excluded.updated_at
        `),
        markStateResolved: _db.prepare(`
            UPDATE insight_states
               SET status = 'resolved', updated_at = ?
             WHERE insight_key = ?
        `),
        ackState: _db.prepare(`
            UPDATE insight_states
               SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
             WHERE insight_key = ?
        `),
        dismissState: _db.prepare(`
            UPDATE insight_states
               SET status = 'dismissed', dismissed_until = ?, updated_at = ?
             WHERE insight_key = ?
        `),
        listActiveStatesByScope: _db.prepare(`
            SELECT * FROM insight_states
             WHERE scope_level = ? AND ( (scope_id IS ? ) OR (scope_id = ?) )
               AND status = 'active'
        `),
        insertNotification: _db.prepare(`
            INSERT OR IGNORE INTO insight_notifications (
                notification_id, insight_key, scope_level, scope_id,
                severity, channel, status, created_at, sent_at, payload_json
            ) VALUES (
                @notificationId, @insightKey, @scopeLevel, @scopeId,
                @severity, @channel, @status, @createdAt, @sentAt, @payloadJson
            )
        `),
        getPendingNotificationFor: _db.prepare(`
            SELECT id FROM insight_notifications
             WHERE insight_key = ? AND status = 'pending'
               AND json_extract(payload_json, '$.type') = ?
             LIMIT 1
        `),
        listNotifications: _db.prepare(`
            SELECT * FROM insight_notifications
             WHERE (status = ? OR ? IS NULL)
             ORDER BY created_at DESC
             LIMIT ?
        `),
        countStatesByStatusSeverity: _db.prepare(`
            SELECT status, severity, COUNT(*) AS n
              FROM insight_states
             WHERE scope_level = ? AND ( (scope_id IS ?) OR (scope_id = ?) )
             GROUP BY status, severity
        `),
        getLastSnapshot: _db.prepare(`
            SELECT generated_at FROM insight_snapshots
             WHERE scope_level = ? AND ( (scope_id IS ?) OR (scope_id = ?) )
             ORDER BY generated_at DESC
             LIMIT 1
        `),
    };

    return _db;
}

// ── API pública ──────────────────────────────────────────────────────────────

export function ensureDbOpen() {
    getDb();
}

/** Inserta snapshot completo. Idempotente por snapshotId. */
export function insertSnapshot(record) {
    getDb();
    _stmt.insertSnapshot.run(record);
}

/** Lee state por insight_key. Devuelve fila cruda o undefined. */
export function getStateByKey(insightKey) {
    getDb();
    return _stmt.getStateByKey.get(insightKey);
}

/** Upsert atómico de state. Recibe el record completo. */
export function upsertState(record) {
    getDb();
    _stmt.upsertState.run(record);
}

/** Marca state como resolved (insight ya no aparece). */
export function markStateResolved(insightKey, ts) {
    getDb();
    _stmt.markStateResolved.run(ts, insightKey);
}

/** Ack: status acknowledged + timestamp + actor. */
export function acknowledgeState(insightKey, actorId, ts) {
    getDb();
    const result = _stmt.ackState.run(ts, actorId, ts, insightKey);
    return result.changes > 0;
}

/** Dismiss N días. status='dismissed' + dismissed_until. */
export function dismissState(insightKey, dismissedUntilTs, ts) {
    getDb();
    const result = _stmt.dismissState.run(dismissedUntilTs, ts, insightKey);
    return result.changes > 0;
}

/** States activos del scope (para detectar resolved). */
export function listActiveStatesByScope(scopeLevel, scopeId) {
    getDb();
    const sid = scopeId ?? null;
    return _stmt.listActiveStatesByScope.all(scopeLevel, sid, sid);
}

/** Lista flexible con filtros. WHERE construido defensivamente con ? placeholders. */
export function listStates({ scopeLevel, scopeId, status, severity, limit = 200 } = {}) {
    const db = getDb();
    const where = [];
    const params = [];
    if (scopeLevel !== undefined) { where.push('scope_level = ?'); params.push(scopeLevel); }
    if (scopeId !== undefined)    { where.push('scope_id = ?');    params.push(scopeId); }
    if (status !== undefined)     { where.push('status = ?');      params.push(status); }
    if (severity !== undefined)   { where.push('severity = ?');    params.push(severity); }
    const sql = `SELECT * FROM insight_states ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_seen_at DESC LIMIT ?`;
    params.push(limit);
    return db.prepare(sql).all(...params);
}

/** Inserta notification. Idempotente por notification_id. */
export function insertNotification(record) {
    getDb();
    _stmt.insertNotification.run(record);
}

/**
 * ¿Ya existe pending del mismo insight_key + type? Evita duplicar notificaciones
 * dentro de una misma corrida o entre snapshots consecutivos.
 */
export function hasPendingNotification(insightKey, type) {
    getDb();
    return !!_stmt.getPendingNotificationFor.get(insightKey, type);
}

export function listNotifications({ status, limit = 100 } = {}) {
    getDb();
    return _stmt.listNotifications.all(status ?? null, status ?? null, limit);
}

/**
 * Resumen de states por scope: active/critical/warning/info counts +
 * lastSnapshotAt. Usado por GET /api/metrics/insights para el bloque
 * `persisted`.
 */
export function getScopeSummary(scopeLevel = 'global', scopeId = null) {
    getDb();
    const rows = _stmt.countStatesByStatusSeverity.all(scopeLevel, scopeId, scopeId);
    let activeCount = 0, criticalCount = 0, warningCount = 0;
    for (const r of rows) {
        if (r.status === 'active') {
            activeCount += r.n;
            if (r.severity === 'critical') criticalCount += r.n;
            if (r.severity === 'warning')  warningCount  += r.n;
        }
    }
    const last = _stmt.getLastSnapshot.get(scopeLevel, scopeId, scopeId);
    return {
        activeCount,
        criticalCount,
        warningCount,
        lastSnapshotAt: last ? last.generated_at : null,
    };
}

export function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
        _stmt = null;
    }
}
