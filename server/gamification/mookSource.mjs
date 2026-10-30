/**
 * mookSource.mjs — CHP-GAMIFICACION-G3-03.
 *
 * MOOK como primera fuente de hechos de gamificación. Tres piezas:
 *  - adaptadores (`mookApprovedReviewCandidates`, `mookCompletedExperienceCandidates`):
 *    SOLO evidencia REVIEWED con decisión `aprobado` y runs `completed`, con
 *    identificadores deterministas y SOLO a partir del corte de activación;
 *  - ganchos en línea (`onMookEvidenceReviewed`, `onMookRunUpdated`): nunca
 *    lanzan, nunca esperan, nunca alteran la respuesta (delegan en `intake`);
 *  - reconciliador programado (`startMookReconciler`): barrido completo,
 *    una sola ejecución efectiva entre réplicas (lock O_EXCL en el bind mount,
 *    mismo patrón que usersLock.js) y conexión propia con busy corto.
 *
 * Corte de activación (`GAMIFICATION_MOOK_SINCE`, ISO 8601, obligatorio): sin
 * él no hay ganchos ni reconciliación. Ningún hecho con `occurredAt` anterior
 * se procesa: la historia previa no recibe puntos retroactivos.
 *
 * No modifica reglas ni permisos de MOOK: solo LEE el documento ya escrito.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { isGamificationEnabled, resolveGamificationDbPath, getGamificationDb } from './db.mjs';
import { replayExclusions } from './erasure.mjs';
import { scheduleFact } from './intake.mjs';
import { candidateEligibility, mookReviewCandidates, mookExperienceCandidates, reconcile } from './reconcile.mjs';
import { loadSubjectKey } from './subjectKey.mjs';

export const RECONCILE_BUSY_MS = 250;
export const DEFAULT_INTERVAL_MS = 15 * 60_000;
export const MIN_INTERVAL_MS = 60_000;
export const DEFAULT_INITIAL_DELAY_MS = 60_000;
export const LOCK_STALE_MS = 10 * 60_000;

/** Corte de activación en ms, o null si falta o no es una fecha válida. */
export function mookActivationSince(env = process.env) {
    const raw = String(env.GAMIFICATION_MOOK_SINCE ?? '').trim();
    if (!raw) return null;
    const t = Date.parse(raw);
    return Number.isFinite(t) && t > 0 ? t : null;
}

/** Solo evidencias aprobadas, posteriores al corte. `con_comentarios` y cualquier otra decisión quedan fuera. */
export function mookApprovedReviewCandidates(doc, sinceMs) {
    if (!sinceMs) return [];
    return mookReviewCandidates(doc).filter((c) => c.occurredAt >= sinceMs);
}

/** Solo experiencias completadas después del corte (una vez por usuario y versión). */
export function mookCompletedExperienceCandidates(doc, sinceMs) {
    if (!sinceMs) return [];
    return mookExperienceCandidates(doc).filter((c) => c.occurredAt >= sinceMs);
}

/**
 * Resolución de sujetos con el padrón que provee el servidor.
 * @param {object[]} users  padrón canónico ya leído
 * @param {(u: object) => boolean} isUserActive  regla de cuenta activa del servidor
 * @param {(u: object) => boolean} isSyntheticUser
 */
export function makeResolveUser(users, isUserActive, isSyntheticUser) {
    const byId = new Map((users || []).filter((u) => u && u.id).map((u) => [u.id, u]));
    return (id) => {
        const u = byId.get(id);
        if (!u) return null;
        return { exists: true, active: !!isUserActive(u), synthetic: !!isSyntheticUser(u) };
    };
}

function scheduleCandidates(cands, resolveUser, opts) {
    for (const c of cands) scheduleFact({ ...c, eligibility: candidateEligibility(resolveUser, c) }, opts);
}

/**
 * Gancho tras una revisión MOOK. Recibe la evidencia ya revisada (lo que el
 * servidor acaba de escribir). Nunca lanza; si no aplica, no hace nada.
 */
export function onMookEvidenceReviewed(evidence, { resolveUser, env = process.env, log = () => {}, onDone } = {}) {
    try {
        if (!isGamificationEnabled(env)) return;
        const since = mookActivationSince(env);
        if (!since || typeof resolveUser !== 'function') return;
        scheduleCandidates(mookApprovedReviewCandidates({ evidence: [evidence] }, since), resolveUser, { env, log, onDone });
    } catch (e) {
        log(`[gamification] gancho MOOK review omitido: ${e?.code || 'ERROR'}`);
    }
}

/**
 * Gancho tras una mutación de run MOOK. Solo actúa si el run quedó `completed`.
 * Nunca lanza; si no aplica, no hace nada.
 */
export function onMookRunUpdated(run, { resolveUser, env = process.env, log = () => {}, onDone } = {}) {
    try {
        if (!isGamificationEnabled(env)) return;
        const since = mookActivationSince(env);
        if (!since || typeof resolveUser !== 'function') return;
        scheduleCandidates(mookCompletedExperienceCandidates({ runs: [run] }, since), resolveUser, { env, log, onDone });
    } catch (e) {
        log(`[gamification] gancho MOOK run omitido: ${e?.code || 'ERROR'}`);
    }
}

// ── Lock entre réplicas (O_EXCL sobre el bind mount, como usersLock.js) ─────

function tryLock(lockFile, now) {
    try {
        const fd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return true;
    } catch (e) {
        if (e.code !== 'EEXIST') return false;
        try {
            if (now - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) { // dueño muerto: se libera
                fs.unlinkSync(lockFile);
                return tryLock(lockFile, now);
            }
        } catch { /* otro lo liberó o lo tomó entre medio */ }
        return false;
    }
}
const unlock = (lockFile) => { try { fs.unlinkSync(lockFile); } catch { /* noop */ } };

/**
 * Un barrido de reconciliación MOOK. Una sola ejecución efectiva entre
 * réplicas: si otra tiene el lock, esta se salta (`skipped: 'locked'`).
 * Usa una conexión propia con busy corto: ante contención el barrido se corta
 * y el siguiente lo retoma (idempotente).
 */
export function runMookReconcileOnce({ readMook, readUsers, isUserActive, isSyntheticUser, env = process.env, now = Date.now } = {}) {
    if (!isGamificationEnabled(env)) return { skipped: 'disabled' };
    const since = mookActivationSince(env);
    if (!since) return { skipped: 'no_activation_cutoff' };
    const dbPath = resolveGamificationDbPath(env);
    if (!fs.existsSync(dbPath)) return { skipped: 'db_absent' };
    const lockFile = `${dbPath}.reconcile.lock`;
    if (!tryLock(lockFile, now())) return { skipped: 'locked' };
    let db = null;
    try {
        db = new Database(dbPath, { fileMustExist: true });
        db.pragma(`busy_timeout = ${RECONCILE_BUSY_MS}`);
        db.pragma('synchronous = FULL');
        db.pragma('foreign_keys = ON');
        db.pragma('secure_delete = ON');
        replayExclusions(db, { env }); // antes de leer la fuente: la puerta de restauración
        const doc = readMook();
        const cands = [...mookApprovedReviewCandidates(doc, since), ...mookCompletedExperienceCandidates(doc, since)];
        const resolveUser = makeResolveUser(readUsers(), isUserActive, isSyntheticUser);
        return { ok: true, ...reconcile(db, cands, { resolveUser, env }) };
    } catch (e) {
        return { ok: false, code: e?.code || 'RECONCILE_ERROR' };
    } finally {
        if (db) { try { db.close(); } catch { /* noop */ } }
        unlock(lockFile);
    }
}

/**
 * Programa la reconciliación: un barrido inicial tras `initialDelayMs` y luego
 * cada `intervalMs` (mínimo 1 min, por defecto 15). Sin flag o sin corte no
 * programa nada. Timers `unref`: nunca retienen el proceso. Devuelve `stop()`.
 * La base se abre y migra AQUÍ, al arrancar (fuera de peticiones).
 */
export function startMookReconciler(deps, { env = process.env, log = () => {} } = {}) {
    if (!isGamificationEnabled(env)) return null;
    if (!mookActivationSince(env)) {
        log('[gamification] reconciliación MOOK desactivada: falta GAMIFICATION_MOOK_SINCE');
        return null;
    }
    // Sin clave de sujeto, ganchos y barridos desisten: nunca se usa un sustituto.
    loadSubjectKey().catch((e) => log(`[gamification] clave de sujeto no disponible: ${e?.code || 'ERROR'}`));
    const intervalMs = Math.max(MIN_INTERVAL_MS, Number(env.GAMIFICATION_RECONCILE_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
    const initialDelayMs = Math.max(0, Number(env.GAMIFICATION_RECONCILE_INITIAL_DELAY_MS ?? DEFAULT_INITIAL_DELAY_MS));
    let running = false;
    const sweep = () => {
        if (running) return; // nunca dos barridos superpuestos en la misma réplica
        running = true;
        try {
            const r = runMookReconcileOnce({ ...deps, env });
            if (r.ok && r.recorded) log(`[gamification] reconciliación MOOK: ${r.recorded} hechos recuperados`);
            else if (r.ok === false) log(`[gamification] reconciliación MOOK abortada: ${r.code}`);
            deps.onSweep?.(r);
        } finally {
            running = false;
        }
    };
    const timers = [];
    timers.push(setTimeout(() => {
        try { getGamificationDb({ log }); } catch (e) { log(`[gamification] base no disponible: ${e.code}`); }
        sweep();
        const iv = setInterval(sweep, intervalMs);
        iv.unref?.();
        timers.push(iv);
    }, initialDelayMs));
    timers[0].unref?.();
    return { stop: () => timers.forEach((t) => { clearTimeout(t); clearInterval(t); }), intervalMs, initialDelayMs };
}
