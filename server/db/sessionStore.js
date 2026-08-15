/**
 * sessionStore.js — CHP-IDDB-M1-A-SESSION-IDENTITY-01.
 *
 * Servicio de sesiones sobre `sessions.db` (SQLite dedicada). Persiste SOLO el
 * hash del sid (SHA-256), nunca el token/cookie/clave/password.
 *
 * Contrato de revocación:
 *  - logout normal        → revoca ESE sid.
 *  - logout-all / disable / reset → el caller incrementa credentialVersion en el
 *    padrón JSON (autoridad física) y revoca las sesiones vivas del usuario.
 *  - una sesión es válida solo si: fila presente ∧ revoked_at IS NULL ∧ no
 *    expirada ∧ credential_version de la fila == cv del token (defensa extra).
 *
 * Toda operación puede lanzar si el store no está disponible → el middleware lo
 * traduce a FAIL-CLOSED (nunca cae a x-user-id).
 */
import { getSessionsDb } from './sessionsDb.js';
import { hashSid } from '../lib/sessionToken.js';

const nowIso = () => new Date().toISOString();

/**
 * Inserta una sesión emitida.
 * @param {{sid:string,userId:string,issuedAtSec:number,expiresAtSec:number,credentialVersion:number}} s
 */
export function persistSession(s, dbPath = undefined) {
    const db = getSessionsDb(dbPath);
    db.prepare(
        `INSERT INTO sessions (sid_hash, user_id, issued_at, expires_at, revoked_at, credential_version)
         VALUES (?, ?, ?, ?, NULL, ?)`
    ).run(
        hashSid(s.sid), String(s.userId),
        new Date(s.issuedAtSec * 1000).toISOString(),
        new Date(s.expiresAtSec * 1000).toISOString(),
        s.credentialVersion | 0,
    );
}

/**
 * Estado de revocación/validez de un sid. Devuelve la fila o null.
 * @returns {{revoked:boolean, expired:boolean, credentialVersion:number}|null}
 */
export function getSessionState(sid, dbPath = undefined) {
    const db = getSessionsDb(dbPath);
    const row = db.prepare(
        `SELECT revoked_at, expires_at, credential_version FROM sessions WHERE sid_hash = ?`
    ).get(hashSid(sid));
    if (!row) return null;
    return {
        revoked: row.revoked_at !== null,
        expired: Date.parse(row.expires_at) <= Date.now(),
        credentialVersion: row.credential_version | 0,
    };
}

/** Revoca un sid concreto (idempotente). @returns {boolean} tocó una fila viva */
export function revokeSession(sid, dbPath = undefined) {
    const db = getSessionsDb(dbPath);
    const r = db.prepare(
        `UPDATE sessions SET revoked_at = ? WHERE sid_hash = ? AND revoked_at IS NULL`
    ).run(nowIso(), hashSid(sid));
    return r.changes > 0;
}

/** Revoca TODAS las sesiones vivas de un usuario. @returns {number} filas */
export function revokeAllUserSessions(userId, dbPath = undefined) {
    const db = getSessionsDb(dbPath);
    const r = db.prepare(
        `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
    ).run(nowIso(), String(userId));
    return r.changes;
}

/**
 * Limpieza oportunista y ACOTADA de sesiones expiradas. NUNCA se llama por
 * request; el caller la invoca con baja frecuencia (p. ej. tras un login).
 * @returns {number} filas borradas
 */
export function cleanupExpiredSessions({ limit = 1000 } = {}, dbPath = undefined) {
    const db = getSessionsDb(dbPath);
    const r = db.prepare(
        `DELETE FROM sessions WHERE sid_hash IN (
            SELECT sid_hash FROM sessions WHERE expires_at <= ? LIMIT ?)`
    ).run(nowIso(), limit | 0);
    return r.changes;
}
