/**
 * intake.mjs — CHP-GAMIFICACION-G3-02.
 *
 * Entrada en línea de hechos SIN BLOQUEAR la operación que los origina.
 * Nada del producto lo invoca todavía (sin ganchos en G3-02).
 *
 * better-sqlite3 es síncrono: una escritura con contención espera hasta
 * `busy_timeout` BLOQUEANDO el event loop de la réplica. Por eso la entrada
 * en línea:
 *  1. corre DESPUÉS de la respuesta (`setImmediate`), nunca dentro de ella;
 *  2. usa una conexión PROPIA con `busy_timeout` corto (HOOK_BUSY_MS);
 *  3. no abre ni migra la base: si el archivo no existe, desiste (la apertura
 *     y migración ocurren al arrancar, con su reintento, fuera de peticiones);
 *  4. ante cualquier error (BUSY, corrupción, flag OFF) DESISTE en silencio:
 *     el hecho lo recupera después `reconcile()` desde la fuente canónica.
 * Solo las fuentes RECUPERABLES pueden entrar por aquí: perder un hecho en
 * línea es aceptable únicamente si el barrido puede reconstruirlo.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { isGamificationEnabled, resolveGamificationDbPath, RETRY_AFTER_MS } from './db.mjs';
import { recordFact } from './ledger.mjs';
import { RECOVERABLE_SOURCES } from './reconcile.mjs';

export const HOOK_BUSY_MS = 150;

let _hookDb = null;
let _hookPath = null;
let _hookFailedUntil = 0;

function hookDb(env, now) {
    const p = resolveGamificationDbPath(env);
    if (_hookDb && _hookPath === p) return _hookDb;
    if (now < _hookFailedUntil) return null;
    if (!fs.existsSync(p)) { _hookFailedUntil = now + RETRY_AFTER_MS; return null; }
    let db = null;
    try {
        db = new Database(p, { fileMustExist: true });
        db.pragma(`busy_timeout = ${HOOK_BUSY_MS}`);
        db.pragma('synchronous = FULL');
        db.pragma('foreign_keys = ON');
        // Corrupción ⇒ lanza; base sin migrar ⇒ sin fila. En ambos casos se desiste.
        if (!db.prepare("SELECT 1 FROM _migrations WHERE version = '0002_subject_model'").get()) throw new Error('sin migrar');
        closeIntake();
        _hookDb = db;
        _hookPath = p;
        return db;
    } catch {
        if (db) { try { db.close(); } catch { /* noop */ } } // nunca dejar el archivo abierto
        _hookFailedUntil = now + RETRY_AFTER_MS;
        return null;
    }
}

/**
 * Programa el registro de un hecho para DESPUÉS del tick actual. Nunca lanza,
 * nunca espera. `onDone({ ok, code?, result? })` es solo para pruebas y
 * telemetría; el llamador no debe depender de él.
 */
export function scheduleFact(fact, { env = process.env, log = () => {}, onDone } = {}) {
    if (!isGamificationEnabled(env)) { onDone?.({ ok: false, code: 'GAMIFICATION_DISABLED' }); return; }
    if (!RECOVERABLE_SOURCES[fact?.source]?.recoverable) { onDone?.({ ok: false, code: 'SOURCE_NOT_RECOVERABLE' }); return; }
    setImmediate(() => {
        let outcome;
        try {
            const db = hookDb(env, Date.now());
            if (!db) outcome = { ok: false, code: 'GAMIFICATION_DB_UNAVAILABLE' };
            else outcome = { ok: true, result: recordFact(db, fact, { env }) };
        } catch (e) {
            outcome = { ok: false, code: e?.code || 'GAMIFICATION_ERROR' };
        }
        if (!outcome.ok && outcome.code !== 'GAMIFICATION_DISABLED') log(`[gamification] intake desistió: ${outcome.code}`);
        try { onDone?.(outcome); } catch { /* el observador nunca rompe nada */ }
    });
}

/** Solo para tests / shutdown ordenado. */
export function closeIntake({ resetBackoff = false } = {}) {
    if (_hookDb) { try { _hookDb.close(); } catch { /* noop */ } }
    _hookDb = null;
    _hookPath = null;
    if (resetBackoff) _hookFailedUntil = 0;
}
