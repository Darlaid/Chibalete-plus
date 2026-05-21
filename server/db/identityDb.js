/**
 * identityDb.js — P1-A conexión SQLite WAL para users/groups/access.
 *
 * Mirror EXACTO del patrón ya probado en producción (server/eventsService.js):
 * mismos PRAGMA, mismo busy_timeout, misma ubicación data-critical/ (volumen
 * bind-mount compartido por api_1/api_2). NO se introduce patrón nuevo.
 *
 * WAL = múltiples readers + 1 writer entre procesos sin corromper → resuelve
 * la raíz real (corrupción JSON cross-container). busy_timeout=5000 absorbe
 * la contención de los 2 api containers.
 *
 * Lazy singleton: NO abre el archivo a menos que se invoque getIdentityDb()
 * (que solo ocurre si IDENTITY_SQLITE_ENABLED). OFF por defecto = inerte.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// data-critical/ es el volumen persistente bind-mounteado (igual que events.db).
const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data-critical', 'identity.db');

let _db = null;

/**
 * @param {string} [dbPath] override (tests usan un archivo temporal).
 * @returns {import('better-sqlite3').Database}
 */
export function getIdentityDb(dbPath = DEFAULT_DB_PATH) {
    if (_db) return _db;
    _db = new Database(dbPath);
    // PRAGMA set idéntico al de eventsService.js (probado en prod).
    _db.pragma('journal_mode = WAL');     // readers concurrentes + 1 writer sin lock
    _db.pragma('synchronous = NORMAL');   // fsync en checkpoints (seguro con WAL)
    _db.pragma('busy_timeout = 5000');    // 5s ante write-lock (contención dual-api)
    _db.pragma('foreign_keys = ON');      // integridad referencial real
    _db.pragma('cache_size = -2000');     // 2 MB page cache
    _db.pragma('temp_store = MEMORY');
    _db.pragma('wal_autocheckpoint = 100');
    return _db;
}

/** Solo para tests / shutdown ordenado. */
export function closeIdentityDb() {
    if (_db) { try { _db.close(); } catch { /* noop */ } _db = null; }
}

export { DEFAULT_DB_PATH };
