/**
 * leaderElection.mjs — PASO 4 §18.
 *
 * Mutex distribuido SIMPLE basado en SQLite. Resuelve doble-cómputo cuando
 * api_1 + api_2 corren materializer/intervention en paralelo. SIN Redis,
 * SIN etcd — sólo SQLite WAL (suficiente porque la tabla es minúscula y
 * INSERT/UPDATE son atómicos).
 *
 * Patrón:
 *   1. acquireLock(key, ttlMs=90s):
 *      a) INSERT OR IGNORE → si filas != 0 → somos líderes (lock nuevo)
 *      b) Si no, UPDATE WHERE expires_at < now → reclamamos lock huérfano
 *      c) Si UPDATE 0 filas → otro proceso tiene lock vivo → return false
 *   2. heartbeat(key): UPDATE expires_at = now+ttl WHERE holder_id = self.
 *      Llamar cada ttlMs/3 (≈30s para TTL 90s).
 *   3. releaseLock(key): DELETE WHERE holder_id = self.
 *
 * Holder ID: hostname:pid:random — único por proceso. Hash si quieres
 * privacidad operacional; aquí se usa raw para debug.
 */
import os from 'node:os';
import crypto from 'node:crypto';
import { getRollupsExtDb, getRollupsStatements } from '../db/rollupsDbExt.mjs';

const HOSTNAME = os.hostname?.() || 'unknown';
const HOLDER_ID = `${HOSTNAME}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

const DEFAULT_TTL_MS = 90_000;          // 90s
const HEARTBEAT_INTERVAL_MS = 30_000;   // cada 30s

/** Identidad estable de este proceso (constante por toda la vida del Node). */
export function getHolderId() { return HOLDER_ID; }

/**
 * Intenta adquirir el lock para `lockKey`.
 * @returns {{acquired:boolean, holder_id?:string, expires_at?:number}}
 */
export function acquireLock(lockKey, ttlMs = DEFAULT_TTL_MS) {
    try {
        getRollupsExtDb();
        const stmts = getRollupsStatements();
        const now = Date.now();
        const expires = now + ttlMs;

        // 1. Intentar INSERT (caso nuevo: nadie tenía el lock).
        const ins = stmts.leaderInsert.run({
            lock_key: lockKey, holder_id: HOLDER_ID,
            acquired_at: now, heartbeat_at: now, expires_at: expires,
        });
        if (ins.changes > 0) {
            return { acquired: true, holder_id: HOLDER_ID, expires_at: expires };
        }

        // 2. Si ya hay registro, intentar reclamar si está EXPIRED.
        const upd = stmts.leaderClaimExpired.run({
            lock_key: lockKey, holder_id: HOLDER_ID,
            acquired_at: now, heartbeat_at: now, expires_at: expires,
            now,
        });
        if (upd.changes > 0) {
            return { acquired: true, holder_id: HOLDER_ID, expires_at: expires, reclaimed: true };
        }

        // 3. Otro proceso tiene el lock vivo.
        return { acquired: false };
    } catch (e) {
        // Fallar = NO somos líderes (safe-default: no doble-cómputo).
        return { acquired: false, error: String(e?.message || e) };
    }
}

/**
 * Renueva el lock si seguimos siendo el holder. Devuelve true si renovó.
 * Si NO somos holder (el lock se perdió por expiración o reclaim), devuelve false
 * → el caller debe parar de hacer trabajo de líder.
 */
export function heartbeat(lockKey, ttlMs = DEFAULT_TTL_MS) {
    try {
        const stmts = getRollupsStatements();
        const now = Date.now();
        const upd = stmts.leaderHeartbeat.run({
            lock_key: lockKey, holder_id: HOLDER_ID,
            heartbeat_at: now, expires_at: now + ttlMs,
        });
        return upd.changes > 0;
    } catch { return false; }
}

/** Suelta el lock incondicionalmente (sólo si somos el holder). */
export function releaseLock(lockKey) {
    try {
        const stmts = getRollupsStatements();
        const del = stmts.leaderRelease.run({ lock_key: lockKey, holder_id: HOLDER_ID });
        return del.changes > 0;
    } catch { return false; }
}

/**
 * Wrapper conveniente: `withLeader(key, fn)` ejecuta `fn` si somos líderes,
 * con heartbeat automático cada HEARTBEAT_INTERVAL_MS. Si `fn` lanza, el
 * lock SE LIBERA igual.
 */
export async function withLeader(lockKey, fn, opts = {}) {
    const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    const hbInterval = opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    const acq = acquireLock(lockKey, ttl);
    if (!acq.acquired) return { ran: false, reason: 'not_leader' };
    let hbTimer = null;
    try {
        hbTimer = setInterval(() => {
            if (!heartbeat(lockKey, ttl)) {
                clearInterval(hbTimer); hbTimer = null;
                // (no podemos abortar fn; el llamador debería chequear si sigue
                // siendo líder en operaciones largas vía isCurrentLeader())
            }
        }, hbInterval);
        const result = await fn({ holder_id: HOLDER_ID });
        return { ran: true, result };
    } finally {
        if (hbTimer) clearInterval(hbTimer);
        releaseLock(lockKey);
    }
}

/** Consulta sin escribir: ¿soy yo el holder actual? */
export function isCurrentLeader(lockKey) {
    try {
        const row = getRollupsStatements().leaderGet.get(lockKey);
        if (!row) return false;
        if (row.expires_at < Date.now()) return false;  // expirado
        return row.holder_id === HOLDER_ID;
    } catch { return false; }
}

export function getLockInfo(lockKey) {
    try {
        const row = getRollupsStatements().leaderGet.get(lockKey);
        if (!row) return null;
        return {
            ...row,
            self: row.holder_id === HOLDER_ID,
            expired: row.expires_at < Date.now(),
        };
    } catch { return null; }
}
