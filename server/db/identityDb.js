/**
 * identityDb.js — P1-A conexión SQLite WAL para users/groups/access.
 *
 * Mirror EXACTO del patrón ya probado en producción (server/eventsService.js):
 * mismos PRAGMA, mismo busy_timeout. NO se introduce patrón nuevo.
 *
 * La UBICACIÓN, en cambio, ya no es data-critical/: la decide el resolutor
 * único de config.js (CHP-IDDB-02B-PATH-01) a partir de `IDENTITY_DB`.
 *
 * WAL = múltiples readers + 1 writer entre procesos sin corromper → resuelve
 * la raíz real (corrupción JSON cross-container). busy_timeout=5000 absorbe
 * la contención de los 2 api containers.
 *
 * Lazy singleton: NO abre el archivo a menos que se invoque getIdentityDb()
 * (que solo ocurre si IDENTITY_SQLITE_ENABLED). OFF por defecto = inerte.
 */
import Database from 'better-sqlite3';
import {
    resolveIdentityDbPath, IDENTITY_DB_LEGACY_DEFAULT, redactIdentityDbPath,
} from './identityDbPath.mjs';

/** Etiqueta segura de la ubicación activa, para logs y diagnóstico. */
export function identityDbLocationLabel(opts = {}) {
    try { return redactIdentityDbPath(resolveIdentityDbPath(opts)); }
    catch (e) { return `(no resuelta: ${e.classification ?? 'error'})`; }
}

// La ruta la decide el resolutor único de config.js (CHP-IDDB-02B-PATH-01):
// aquí ya no hay default implícito. En producción, con cualquier capacidad
// SQLite activa, `IDENTITY_DB` es obligatoria y el default histórico bajo
// data-critical queda rechazado — si no, `better-sqlite3` crearía ahí una base
// vacía y nadie se enteraría.
const DEFAULT_DB_PATH = IDENTITY_DB_LEGACY_DEFAULT;

let _db = null;

/**
 * @param {string} [dbPath] override explícito (los tests usan un temporal). En
 *        producción queda sujeto a las mismas validaciones que `IDENTITY_DB`.
 * @returns {import('better-sqlite3').Database}
 */
export function getIdentityDb(dbPath = undefined) {
    if (_db) return _db;
    const resolved = resolveIdentityDbPath({ explicitPath: dbPath ?? null, forOpen: true });
    _db = new Database(resolved);
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
