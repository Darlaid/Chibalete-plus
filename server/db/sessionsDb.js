/**
 * sessionsDb.js — CHP-IDDB-M1-A-SESSION-IDENTITY-01.
 *
 * Conexión SQLite DEDICADA para el store de sesiones humanas firmadas. NO es
 * identity.db: las sesiones son efímeras y NO recovery-critical (una pérdida ⇒
 * fail-closed ⇒ re-login), así que viven en una base separada para no mezclar
 * radio de impacto con la autoridad canónica de identidad.
 *
 * Ubicación: `SESSIONS_DB` explícita (obligatoria para abrir); en producción la
 * inyecta el compose apuntando al bind mount host-persistent compartido por
 * api_1/api_2 (p. ej. `/app/identity/sessions.db`, misma carpeta persistente
 * que identity.db pero archivo distinto, fuera de la lista de 25 stores del
 * backup). Los tests pasan un temporal hermético.
 *
 * Patrón WAL/busy_timeout idéntico al probado en identityDb.js (dos api
 * containers). Lazy singleton: no abre el archivo salvo que el modo de sesión
 * lo requiera (SESSION_AUTH_MODE != off).
 */
import path from 'node:path';
import Database from 'better-sqlite3';

const isBusy = (e) => /SQLITE_BUSY|database is locked/i.test(String(e?.message ?? ''));
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Resuelve la ruta del store de sesiones. `SESSIONS_DB` explícita gana; si no,
 * se coloca junto a `IDENTITY_DB` (mismo mount persistente compartido), con el
 * basename `sessions.db`. Sin ninguna de las dos ⇒ error (nunca un default
 * bajo el filesystem efímero del contenedor).
 */
export function resolveSessionsDbPath({ explicitPath = null } = {}) {
    const fromArg = explicitPath || process.env.SESSIONS_DB;
    if (fromArg) return path.resolve(String(fromArg));
    const identity = process.env.IDENTITY_DB;
    if (identity) return path.join(path.dirname(path.resolve(String(identity))), 'sessions.db');
    throw new Error('SESSIONS_DB_PATH_REQUIRED: define SESSIONS_DB o IDENTITY_DB para ubicar el store de sesiones');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  sid_hash            TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  issued_at           TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  revoked_at          TEXT,
  credential_version  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user     ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);
`;

function enableWalMode(db, { attempts = 20, waitMs = 50 } = {}) {
    const current = () => {
        try { return String(db.pragma('journal_mode', { simple: true })).toLowerCase(); }
        catch (e) { if (isBusy(e)) return null; throw e; }
    };
    if (current() === 'wal') return 'wal';
    for (let i = 0; i < attempts; i++) {
        try {
            if (String(db.pragma('journal_mode = WAL', { simple: true })).toLowerCase() === 'wal') return 'wal';
        } catch (e) { if (!isBusy(e)) throw e; }
        sleepSync(waitMs);
        if (current() === 'wal') return 'wal';
    }
    throw new Error('SESSIONS_DB_WAL_UNAVAILABLE: no se pudo fijar journal_mode=WAL');
}

let _db = null;
let _openedPath = null;

/**
 * Abre (lazy singleton) el store de sesiones y garantiza el schema. Lanza ante
 * cualquier fallo de apertura — el caller (verifySession) traduce a fail-closed.
 * @returns {import('better-sqlite3').Database}
 */
export function getSessionsDb(explicitPath = undefined) {
    if (_db) return _db;
    const resolved = resolveSessionsDbPath({ explicitPath: explicitPath ?? null });
    const db = new Database(resolved);
    db.pragma('busy_timeout = 5000');
    enableWalMode(db);
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('wal_autocheckpoint = 100');
    db.exec(SCHEMA);
    _db = db;
    _openedPath = resolved;
    return _db;
}

/** Solo para tests / shutdown ordenado. */
export function closeSessionsDb() {
    if (_db) { try { _db.close(); } catch { /* noop */ } _db = null; _openedPath = null; }
}

/** Ruta actualmente abierta (diagnóstico; nunca secretos). */
export function sessionsDbOpenPath() { return _openedPath; }
