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

const isBusy = (e) => /SQLITE_BUSY|database is locked/i.test(String(e?.message ?? ''));
/** Pausa síncrona y acotada; no hay bucle de eventos que ceder en la apertura. */
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Fija `journal_mode = WAL` de forma resistente a la contención
 * (CHP-IDDB-02B-D-A).
 *
 * CAMBIAR el journal mode exige un lock exclusivo y, a diferencia de casi todo
 * lo demás, **NO respeta `busy_timeout`**: si otro proceso tiene la base
 * tomada, SQLite devuelve SQLITE_BUSY en el acto. Medido con dos procesos
 * abriendo a la vez una base recién creada: fallo en 9 ms desde la propia
 * apertura, antes de tocar el espejo.
 *
 * En producción la base YA está en WAL, así que el caso normal es la primera
 * rama: se comprueba y no se intenta ningún cambio, lo que además evita pedir
 * un lock exclusivo en cada apertura. El reintento acotado cubre el caso real
 * que queda —dos instancias arrancando contra una identity.db recién creada—
 * y falla claro si no lo consigue, en vez de seguir con la base en modo
 * `delete`, que es justamente el modo que no soporta dos escritores.
 */
export function enableWalMode(db, { attempts = 20, waitMs = 50 } = {}) {
    const current = () => {
        try { return String(db.pragma('journal_mode', { simple: true })).toLowerCase(); }
        catch (e) { if (isBusy(e)) return null; throw e; }
    };
    if (current() === 'wal') return 'wal';
    for (let i = 0; i < attempts; i++) {
        try {
            if (String(db.pragma('journal_mode = WAL', { simple: true })).toLowerCase() === 'wal') {
                return 'wal';
            }
        } catch (e) { if (!isBusy(e)) throw e; }
        sleepSync(waitMs);
        if (current() === 'wal') return 'wal';   // lo fijó el otro proceso
    }
    throw new Error('IDENTITY_DB_WAL_UNAVAILABLE: no se pudo fijar journal_mode=WAL '
        + `tras ${attempts} intentos (la base sigue tomada por otro proceso)`);
}

/**
 * @param {string} [dbPath] override explícito (los tests usan un temporal). En
 *        producción queda sujeto a las mismas validaciones que `IDENTITY_DB`.
 * @returns {import('better-sqlite3').Database}
 */
export function getIdentityDb(dbPath = undefined) {
    if (_db) return _db;
    const resolved = resolveIdentityDbPath({ explicitPath: dbPath ?? null, forOpen: true });
    _db = new Database(resolved);
    // `busy_timeout` va PRIMERO (CHP-IDDB-02B-D-A). No adquiere ningún lock,
    // pero los pragma que vienen detrás sí: `journal_mode` necesita el lock de
    // la base, y con el timeout todavía en 0 falla en seco con SQLITE_BUSY si
    // otro proceso está escribiendo. Reproducido con dos escritores abriendo la
    // misma base a la vez: `database is locked` lanzado desde la propia
    // apertura, antes de tocar el espejo.
    _db.pragma('busy_timeout = 5000');    // 5s ante write-lock (contención dual-api)
    // Resto del set idéntico al de eventsService.js (probado en prod), que
    // conserva el orden histórico: allí solo hay un abridor por proceso y el
    // mismo riesgo es mucho menor, así que no se toca desde esta unidad.
    enableWalMode(_db);                   // readers concurrentes + 1 writer sin lock
    _db.pragma('synchronous = NORMAL');   // fsync en checkpoints (seguro con WAL)
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
