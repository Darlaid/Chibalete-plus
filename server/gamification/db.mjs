/**
 * db.mjs — CHP-GAMIFICACION-G3-01.
 *
 * Apertura de `gamification.db` (ADR-GAM-G2-01 §2). Mismo esqueleto que
 * `getRoyaltiesDb` con dos diferencias deliberadas:
 *  - `synchronous = FULL`: un corte del host no pierde la última transacción
 *    de saldo (en WAL, NORMAL sí puede);
 *  - la base SOLO existe con `GAMIFICATION_ENABLED` encendido: con el flag
 *    apagado no se crea el archivo, ni su directorio, ni se migra nada.
 *
 * Fallo seguro: una base corrupta o inaccesible lanza `GamificationError`
 * (`GAMIFICATION_DB_UNAVAILABLE`) y deja de reintentarse durante
 * `RETRY_AFTER_MS`; `safely()` la convierte en `{ ok: false }` para que ningún
 * llamador futuro (lectura, MOOK, progreso) vea una excepción.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../db/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'gamification.db');
export const RETRY_AFTER_MS = 30_000;

export class GamificationError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'GamificationError';
        this.code = code;
    }
}

/** `GAMIFICATION_ENABLED`: solo '1' o 'true' encienden; ausente o cualquier otro valor ⇒ OFF. Se lee por llamada. */
export function isGamificationEnabled(env = process.env) {
    const v = String(env.GAMIFICATION_ENABLED ?? '').trim().toLowerCase();
    return v === '1' || v === 'true';
}

/**
 * `PM_EARNING_ENABLED`: hijo de `GAMIFICATION_ENABLED` (padre OFF ⇒ OFF).
 * Solo gobierna PM. El XP tiene su propio flag (G4-04).
 */
export function isEarningEnabled(env = process.env) {
    if (!isGamificationEnabled(env)) return false;
    const v = String(env.PM_EARNING_ENABLED ?? '').trim().toLowerCase();
    return v === '1' || v === 'true';
}

/** `XP_EARNING_ENABLED`: hijo de `GAMIFICATION_ENABLED`, independiente de `PM_EARNING_ENABLED` (A4). */
export function isXpEarningEnabled(env = process.env) {
    if (!isGamificationEnabled(env)) return false;
    const v = String(env.XP_EARNING_ENABLED ?? '').trim().toLowerCase();
    return v === '1' || v === 'true';
}

export const resolveGamificationDbPath = (env = process.env) =>
    (env.GAMIFICATION_DB ? path.resolve(env.GAMIFICATION_DB) : DEFAULT_DB_PATH);

let _db = null;
let _dbPath = null;
let _failedUntil = 0;

const OPEN_ATTEMPTS = 12;
const isBusy = (e) => e?.code === 'SQLITE_BUSY' || e?.code === 'SQLITE_LOCKED' || /database is locked|database is busy/i.test(e?.message || '');
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Arranque simultáneo de réplicas sobre una base nueva: el paso a WAL y la
 * migración (transacción diferida que sube a escritura) devuelven SQLITE_BUSY
 * SIN pasar por busy_timeout. Se reintenta la apertura completa, acotada y con
 * espera aleatoria; cualquier otro error sale de inmediato.
 */
function openAndMigrate(dbPath, log) {
    for (let attempt = 1; ; attempt++) {
        try {
            return openAndMigrateOnce(dbPath, log);
        } catch (e) {
            if (!isBusy(e) || attempt >= OPEN_ATTEMPTS) throw e;
            log(`[gamification-migrate] busy at open (attempt ${attempt}), retrying`);
            sleepSync(25 + Math.floor(Math.random() * 75 * attempt));
        }
    }
}

function openAndMigrateOnce(dbPath, log) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
        db.pragma('busy_timeout = 5000');
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = FULL');
        db.pragma('foreign_keys = ON');
        const opts = { dir: MIGRATIONS_DIR, tag: 'gamification-migrate' };
        try {
            runMigrations(db, log, opts);
        } catch (e) {
            // La otra réplica pudo aplicar la misma versión entre la lectura de
            // `_migrations` y nuestra transacción: reintentar ya la ve aplicada.
            log(`[gamification-migrate] retry after: ${e.message}`);
            runMigrations(db, log, opts);
        }
        return db;
    } catch (e) {
        try { db.close(); } catch { /* noop */ }
        throw e;
    }
}

/**
 * Abre (y migra) la base. Idempotente; seguro con dos réplicas.
 * @throws {GamificationError} GAMIFICATION_DISABLED | GAMIFICATION_DB_UNAVAILABLE
 */
export function getGamificationDb({ log = () => {}, env = process.env, now = Date.now() } = {}) {
    if (!isGamificationEnabled(env)) throw new GamificationError('GAMIFICATION_DISABLED');
    const dbPath = resolveGamificationDbPath(env);
    if (_db && _dbPath === dbPath) return _db;
    if (now < _failedUntil) throw new GamificationError('GAMIFICATION_DB_UNAVAILABLE', 'en espera de reintento');
    try {
        const db = openAndMigrate(dbPath, log);
        closeGamificationDb();
        _db = db;
        _dbPath = dbPath;
        return db;
    } catch (e) {
        _failedUntil = now + RETRY_AFTER_MS;
        throw new GamificationError('GAMIFICATION_DB_UNAVAILABLE', e.message);
    }
}

/** Ejecuta `fn(db)` sin propagar nunca un error: `{ ok, value }` o `{ ok: false, code }`. */
export function safely(fn, { log = () => {}, env = process.env } = {}) {
    try {
        return { ok: true, value: fn(getGamificationDb({ log, env })) };
    } catch (e) {
        const code = e?.code || 'GAMIFICATION_ERROR';
        if (code !== 'GAMIFICATION_DISABLED') log(`[gamification] ${code}`);
        return { ok: false, code };
    }
}

/** Solo para tests / shutdown ordenado. */
export function closeGamificationDb({ resetBackoff = false } = {}) {
    if (_db) { try { _db.close(); } catch { /* noop */ } }
    _db = null;
    _dbPath = null;
    if (resetBackoff) _failedUntil = 0;
}
