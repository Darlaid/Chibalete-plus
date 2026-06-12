/**
 * offlineAssignmentService.js — SQLite backend para "libro offline asignado".
 *
 * Regla central (Fase 2):
 *   Cada usuario tiene 0 o 1 libro offline asignado en cualquier momento.
 *   La unicidad la enforcea el schema (PRIMARY KEY user_id).
 *
 * Patrón:
 *   - better-sqlite3 + WAL (mismo modelo que progressService.js).
 *   - Schema autoinicializado en getDb().
 *   - Prepared statements cacheados.
 *
 * API pública:
 *   getAssignment(userId)               → record | null
 *   upsertAssignment(userId, contentId) → record   (sync, atómico)
 *   deleteAssignment(userId)            → boolean  (true si borró algo)
 *   getAssignmentCount()                → number   (debug / health)
 *   closeOfflineAssignmentDb()          → void     (tests / shutdown)
 *
 * Reemplazo:
 *   upsert() es UPSERT atómico. Si el usuario ya tenía un libro distinto,
 *   se sobrescribe en la misma fila (sin duplicar) y se bumpea version + assignedAt.
 *   Si el usuario llama POST con el MISMO contentId que ya tenía, version y
 *   assignedAt se preservan; solo updated_at avanza. Esto cumple la regla
 *   de "repetir mismo libro no rompe progreso".
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DB_PATH = process.env.OFFLINE_ASSIGNMENT_DB_PATH
    || path.resolve(__dirname, '../data/offline_assignments.db');

console.log(`[offlineAssignmentService] SQLite path: ${DB_PATH}`);

let _db = null;
let _stmtGet     = null;
let _stmtUpsert  = null;
let _stmtDelete  = null;
let _stmtCount   = null;

function getDb() {
    if (_db) return _db;

    _db = new Database(DB_PATH);

    // Mismo perfil WAL que progressService — multi-instancia friendly.
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('busy_timeout = 5000');
    _db.pragma('cache_size = -2000');
    _db.pragma('temp_store = MEMORY');
    _db.pragma('wal_autocheckpoint = 100');

    _db.exec(`
        CREATE TABLE IF NOT EXISTS offline_book_assignments (
            user_id         TEXT PRIMARY KEY,
            content_id      TEXT NOT NULL,
            content_version INTEGER NOT NULL DEFAULT 1,
            assigned_at     TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_offline_content_id ON offline_book_assignments(content_id);
    `);

    _stmtGet    = _db.prepare('SELECT * FROM offline_book_assignments WHERE user_id = ?');
    _stmtDelete = _db.prepare('DELETE FROM offline_book_assignments WHERE user_id = ?');
    _stmtCount  = _db.prepare('SELECT COUNT(*) AS n FROM offline_book_assignments');

    // UPSERT atómico:
    //   - INSERT si no existe la fila para user_id.
    //   - ON CONFLICT(user_id):
    //       - si content_id NO cambia → preserva version y assigned_at, solo avanza updated_at.
    //       - si content_id CAMBIA   → incrementa version, resetea assigned_at = now, actualiza updated_at.
    //   - Reemplaza al libro anterior en la misma fila → garantía 1 usuario = 1 assignment.
    _stmtUpsert = _db.prepare(`
        INSERT INTO offline_book_assignments
            (user_id, content_id, content_version, assigned_at, updated_at)
        VALUES
            (@userId, @contentId, 1, @now, @now)
        ON CONFLICT(user_id) DO UPDATE SET
            content_id      = excluded.content_id,
            content_version = CASE
                WHEN offline_book_assignments.content_id = excluded.content_id
                    THEN offline_book_assignments.content_version
                    ELSE offline_book_assignments.content_version + 1
            END,
            assigned_at     = CASE
                WHEN offline_book_assignments.content_id = excluded.content_id
                    THEN offline_book_assignments.assigned_at
                    ELSE excluded.assigned_at
            END,
            updated_at      = excluded.updated_at
    `);

    return _db;
}

function rowToRecord(row) {
    if (!row) return null;
    return {
        userId:     row.user_id,
        contentId:  row.content_id,
        version:    row.content_version,
        assignedAt: row.assigned_at,
        updatedAt:  row.updated_at,
    };
}

/**
 * @returns {{ userId, contentId, version, assignedAt, updatedAt } | null}
 */
export function getAssignment(userId) {
    getDb();
    return rowToRecord(_stmtGet.get(userId));
}

/**
 * Asigna contentId al usuario.
 * - Si el usuario tenía otro libro → lo reemplaza, version++.
 * - Si el usuario tenía el mismo libro → operación idempotente (version preservada).
 *
 * @returns {{ userId, contentId, version, assignedAt, updatedAt, replacedPrevious: boolean, sameAsBefore: boolean }}
 */
export function upsertAssignment(userId, contentId) {
    getDb();
    const previous = rowToRecord(_stmtGet.get(userId));
    const now = new Date().toISOString();

    _stmtUpsert.run({ userId, contentId, now });

    const current = rowToRecord(_stmtGet.get(userId));
    return {
        ...current,
        replacedPrevious: !!previous && previous.contentId !== contentId,
        sameAsBefore:     !!previous && previous.contentId === contentId,
        previousContentId: previous?.contentId ?? null,
    };
}

/**
 * Elimina el assignment del usuario.
 * Idempotente: si no había nada, devuelve false sin error.
 */
export function deleteAssignment(userId) {
    getDb();
    const result = _stmtDelete.run(userId);
    return result.changes > 0;
}

/**
 * Conteo global — para health checks y debug.
 */
export function getAssignmentCount() {
    getDb();
    return _stmtCount.get().n;
}

/**
 * Cierra la conexión SQLite — para tests y graceful shutdown.
 */
export function closeOfflineAssignmentDb() {
    if (_db) {
        _db.close();
        _db = null;
        _stmtGet = _stmtUpsert = _stmtDelete = _stmtCount = null;
    }
}
