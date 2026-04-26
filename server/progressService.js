/**
 * progressService.js — SQLite backend para progreso de lectura.
 *
 * Reemplaza todas las operaciones de progress_db.json.
 * WAL mode elimina la race condition entre api_1 y api_2.
 *
 * API pública (importar desde server.js y otros servicios):
 *   getProgressItem(userId, contentId)  → record | null
 *   getProgressByUser(userId)           → record[]
 *   getAllProgressAsMap()               → { progressMap: { key: record } }
 *   upsertProgress(record)             → record   (sync — better-sqlite3)
 *   getProgressCount()                 → number
 *   bulkInsert(records)                → void     (transaccional)
 *   closeDb()                          → void     (para tests / graceful shutdown)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Ruta configurable via env.
// En Docker con bind mount /var/www/chibalete/data:/app/data → el archivo físico
// queda en /var/www/chibalete/data/progress.db (persiste entre reinicios).
const DB_PATH = process.env.PROGRESS_SQLITE_PATH
    || path.resolve(__dirname, '../data/progress.db');

console.log(`[progressService] SQLite path: ${DB_PATH}`);

let _db = null;

// ── Prepared statements (cached after first getDb()) ─────────────────────────
let _stmtGet      = null;
let _stmtGetUser  = null;
let _stmtGetAll   = null;
let _stmtUpsert   = null;
let _stmtInsertOI = null;  // INSERT OR IGNORE — para migración
let _stmtCount    = null;

function getDb() {
    if (_db) return _db;

    _db = new Database(DB_PATH);

    // ── WAL pragmas ───────────────────────────────────────────────────────────
    // WAL mode: múltiples lectores concurrentes + escritor sin bloquear lectores.
    // Esto elimina la race condition entre api_1 y api_2.
    _db.pragma('journal_mode = WAL');

    // NORMAL: fsync solo en checkpoints, no en cada escritura. Seguro con WAL.
    // (FULL haría un fsync por escritura — innecesario para este caso de uso)
    _db.pragma('synchronous = NORMAL');

    // 5 s de espera si otro proceso tiene un write lock. Evita SQLITE_BUSY.
    _db.pragma('busy_timeout = 5000');

    // 2 MB de cache de páginas en memoria.
    _db.pragma('cache_size = -2000');

    // Tablas temporales en memoria — más rápido que disco.
    _db.pragma('temp_store = MEMORY');

    // Checkpoint automático cada 100 páginas WAL (~400 KB).
    _db.pragma('wal_autocheckpoint = 100');

    // ── Schema ────────────────────────────────────────────────────────────────
    _db.exec(`
        CREATE TABLE IF NOT EXISTS progress (
            id                  TEXT PRIMARY KEY,
            user_id             TEXT NOT NULL,
            content_id          TEXT NOT NULL,
            is_completed        INTEGER NOT NULL DEFAULT 0,
            canonical_progress  TEXT    NOT NULL DEFAULT '{}',
            updated_at          TEXT    NOT NULL,
            history             TEXT    NOT NULL DEFAULT '[]'
        );

        CREATE INDEX IF NOT EXISTS idx_progress_user_id  ON progress(user_id);
        CREATE INDEX IF NOT EXISTS idx_progress_updated  ON progress(updated_at DESC);
    `);

    // ── Cache prepared statements ─────────────────────────────────────────────
    _stmtGet      = _db.prepare('SELECT * FROM progress WHERE id = ?');
    _stmtGetUser  = _db.prepare('SELECT * FROM progress WHERE user_id = ? ORDER BY updated_at DESC');
    _stmtGetAll   = _db.prepare('SELECT * FROM progress ORDER BY updated_at DESC');
    _stmtCount    = _db.prepare('SELECT COUNT(*) AS n FROM progress');

    _stmtUpsert   = _db.prepare(`
        INSERT INTO progress (id, user_id, content_id, is_completed, canonical_progress, updated_at, history)
        VALUES (@id, @userId, @contentId, @isCompleted, @canonicalProgress, @updatedAt, @history)
        ON CONFLICT(id) DO UPDATE SET
            is_completed       = excluded.is_completed,
            canonical_progress = excluded.canonical_progress,
            updated_at         = excluded.updated_at,
            history            = excluded.history
    `);

    _stmtInsertOI = _db.prepare(`
        INSERT OR IGNORE INTO progress
            (id, user_id, content_id, is_completed, canonical_progress, updated_at, history)
        VALUES
            (@id, @userId, @contentId, @isCompleted, @canonicalProgress, @updatedAt, @history)
    `);

    return _db;
}

// ── Row → JS record ───────────────────────────────────────────────────────────
function rowToRecord(row) {
    if (!row) return null;
    return {
        id:                row.id,
        userId:            row.user_id,
        contentId:         row.content_id,
        isCompleted:       row.is_completed === 1,
        canonicalProgress: JSON.parse(row.canonical_progress),
        updatedAt:         row.updated_at,
        history:           JSON.parse(row.history),
    };
}

// ── Record → DB params ────────────────────────────────────────────────────────
function recordToParams(record) {
    return {
        id:                record.id,
        userId:            record.userId,
        contentId:         record.contentId,
        isCompleted:       record.isCompleted ? 1 : 0,
        canonicalProgress: JSON.stringify(record.canonicalProgress ?? {}),
        updatedAt:         record.updatedAt,
        history:           JSON.stringify(record.history ?? []),
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Obtiene el registro de progreso para un (userId, contentId).
 * Equivale a: db.progressMap[makeProgressKey(userId, contentId)]
 * @returns {object|null}
 */
export function getProgressItem(userId, contentId) {
    const db = getDb();
    return rowToRecord(_stmtGet.get(`${userId}__${contentId}`));
}

/**
 * Todos los registros de progreso de un usuario.
 * Equivale a: Object.values(db.progressMap).filter(p => p.userId === userId)
 * @returns {object[]}
 */
export function getProgressByUser(userId) {
    const db = getDb();
    return _stmtGetUser.all(userId).map(rowToRecord);
}

/**
 * Todos los registros en el formato { progressMap: { key: record } }.
 * Compatibilidad con código legado que espera la forma del JSON.
 * Llamado en loadAndInitMetrics, interventions, reading-progress, etc.
 * @returns {{ progressMap: Object }}
 */
export function getAllProgressAsMap() {
    const db = getDb();
    const rows = _stmtGetAll.all();
    const progressMap = {};
    for (const row of rows) {
        const rec = rowToRecord(row);
        progressMap[rec.id] = rec;
    }
    return { progressMap };
}

/**
 * Upsert atómico de un registro de progreso.
 * better-sqlite3 es síncrono — no bloquea el event loop (<0.5 ms).
 * @returns {object} el mismo record recibido
 */
export function upsertProgress(record) {
    const db = getDb();
    _stmtUpsert.run(recordToParams(record));
    return record;
}

/**
 * Conteo total de registros — para health checks y validación de migración.
 * @returns {number}
 */
export function getProgressCount() {
    const db = getDb();
    return _stmtCount.get().n;
}

/**
 * Inserción masiva transaccional (INSERT OR IGNORE).
 * Usa transacción de better-sqlite3 — 10k registros en <50 ms.
 * @param {object[]} records - array de objetos en formato JS (no filas de DB)
 */
export function bulkInsert(records) {
    const db = getDb();
    const tx = db.transaction((recs) => {
        for (const r of recs) {
            _stmtInsertOI.run(recordToParams(r));
        }
    });
    tx(records);
}

/**
 * Cierra la conexión SQLite. Para graceful shutdown o tests.
 */
export function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
        _stmtGet = _stmtGetUser = _stmtGetAll = _stmtUpsert = _stmtInsertOI = _stmtCount = null;
    }
}
