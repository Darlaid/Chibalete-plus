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
import crypto from 'node:crypto';
import fs from 'node:fs';
import { GamificationError, isGamificationEnabled, isXpEarningEnabled, resolveGamificationDbPath, getGamificationDb } from './db.mjs';
import { replayExclusions } from './erasure.mjs';
import { exclusionGate } from './exclusions.mjs';
import { scheduleFact, scheduleOnHookDb } from './intake.mjs';
import { recordWorkRecognition } from './ledger.mjs';
import { attributedEvidence } from './mookWorks.mjs';
import { catalogActivities, readGroupRecognitionCounts, readWorkProgress, recognitionActive, workAccessCounts } from './progress.mjs';
import { candidateEligibility, drainSteps, mookReviewCandidates, mookExperienceCandidates, reconcileSteps } from './reconcile.mjs';
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

/**
 * G4-05A-3. Registra por obra y ciclo las evidencias aprobadas y atribuidas.
 * Idempotente: se reevalúa en cada barrido. La retirada legal se consulta aquí,
 * al reconocer; si no se puede verificar, nada avanza y la evidencia sigue pendiente.
 * @param {{ workRefOf: Function, readRights: () => Function, resolveUser: Function }} deps
 */
export function recognizeMookWorks(db, doc, deps = {}) {
    return drainSteps(recognizeMookWorksSteps(db, doc, deps));
}

/** Derechos vigentes; si no se pueden leer, toda obra cuenta como retirada. */
function withdrawnReader(readRights) {
    try { return readRights(); } catch { return () => true; }
}

/**
 * G4-PERF-01B. `recognizeMookWorks` por pasos: atribuye y registra una evidencia
 * por paso, en el orden del documento, cada registro en su propia transacción.
 * Tras una cesión (`yield` devuelve `true`) relee exclusiones y derechos: una
 * retirada legal o una exclusión posterior al inicio del barrido cuenta desde ahí.
 */
function* recognizeMookWorksSteps(db, doc, { workRefOf, readRights, resolveUser, sinceMs, onlyEvidenceId = null, env = process.env, now = Date.now() } = {}) {
    if (!isXpEarningEnabled(env)) return { skipped: 'disabled' };
    if (typeof workRefOf !== 'function' || typeof readRights !== 'function') return { skipped: 'not_wired' };
    const live = { workRefOf, resolveUser, sinceMs, gate: exclusionGate(db, env), isWithdrawn: withdrawnReader(readRights) };
    const scope = onlyEvidenceId ? { ...doc, evidence: (doc.evidence ?? []).filter((e) => e.id === onlyEvidenceId) } : doc;
    const res = { recognized: 0, already: 0, unattributed: {}, notRecorded: {} };
    for (const e of attributedEvidence(scope, live, res.unattributed)) {
        if (e) {
            const r = recordWorkRecognition(db, e, { env, gate: live.gate, now });
            if (r.inserted) res.recognized++;
            else if (r.factId) res.already++;
            else res.notRecorded[r.reason] = (res.notRecorded[r.reason] ?? 0) + 1;
        }
        if (yield) {
            live.gate = exclusionGate(db, env);
            live.isWithdrawn = withdrawnReader(readRights);
        }
    }
    return res;
}

/**
 * G4-UX-U2. Progreso propio para `GET /api/me/progress`. Solo lectura.
 *  - sin `GAMIFICATION_ENABLED` ⇒ `{ status: 404 }`;
 *  - sin `XP_EARNING_ENABLED` ⇒ `{ enabled: false }`;
 *  - si no, `{ enabled: true, ...readWorkProgress }`.
 * Abre la base en modo `readonly` (+ `query_only`), sin migrar ni crear nada, y la
 * cierra al terminar. Base ausente o sin escritor vivo (faltan `-wal`/`-shm`), registro de
 * exclusiones dañado o clave ausente
 * ⇒ lanza: el llamador responde «no disponible», nunca 0 XP.
 * `userId` es SIEMPRE la persona de la sesión: lo fija el servidor, nunca el cliente.
 * @param {string} userId
 * @param {{ readMook, workRefOf, readRights, readUsers, isUserActive, isSyntheticUser, workAccessOf, titleOf, env?, now? }} deps
 *        `workAccessOf(workRef)` resuelve el acceso de ESTA persona a una obra del catálogo.
 */
export async function readMyProgress(userId, deps = {}) {
    const { env = process.env, now = Date.now() } = deps;
    if (!isGamificationEnabled(env)) return { status: 404 };
    if (!isXpEarningEnabled(env)) return { enabled: false };
    const sinceMs = mookActivationSince(env);
    const doc = deps.readMook();
    // Acceso por obra del catálogo, resuelto antes de abrir la base (es asíncrono).
    // Incluye las versiones actuales: una persona excluida se ve como alguien sin runs.
    const access = new Map();
    const opts = { workRefOf: deps.workRefOf, sinceMs };
    for (const a of [...catalogActivities(doc, userId, opts), ...catalogActivities(doc, null, opts)]) {
        if (access.has(a.workRef)) continue;
        let decision = null;
        try { decision = await deps.workAccessOf(a.workRef); } catch { decision = null; }
        access.set(a.workRef, decision);
    }
    // U2-CLOSE: sin escritor vivo faltan `-wal`/`-shm`, y abrir en modo readonly
    // los CREARÍA junto al store (y no podría borrarlos). Solo se lee una base
    // viva; si no, «no disponible» sin tocar nada.
    const dbPath = resolveGamificationDbPath(env);
    if (!fs.existsSync(`${dbPath}-wal`) || !fs.existsSync(`${dbPath}-shm`)) throw new GamificationError('GAMIFICATION_DB_NOT_LIVE');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('query_only = ON');
        // V8-INTEGRATION-02A: una sola transacción de lectura = una instantánea WAL.
        // Sin ella, un reconocimiento confirmado a mitad de la lectura daba una
        // respuesta rota (XP total ya sumado, obra «pendiente» e historial vacío).
        const out = db.transaction(() => readWorkProgress(db, userId, {
            doc, workRefOf: deps.workRefOf, access, sinceMs, env, now, titleOf: deps.titleOf,
            resolveUser: makeResolveUser(deps.readUsers(), deps.isUserActive, deps.isSyntheticUser),
            isWithdrawn: withdrawnReader(deps.readRights),
        }))();
        return { enabled: true, ...out };
    } finally {
        db.close();
    }
}

/**
 * G4-UX-U4. Agregados de reconocimiento de un grupo para su mediador. Solo lectura.
 *  - sin `GAMIFICATION_ENABLED` o sin `XP_EARNING_ENABLED` ⇒ `null` (el bloque no existe);
 *  - si no, `{ studentsWithRecognizedWork, suppressed, eligibleWorks }`, solo conteos.
 * Misma apertura que `readMyProgress`: readonly + query_only y solo con escritor
 * vivo; si falta, lanza `GAMIFICATION_DB_NOT_LIVE` sin crear nada.
 * `studentIds` y el alcance del grupo los resuelve el servidor, nunca el cliente.
 * @param {string[]} studentIds
 * @param {{ readMook, workRefOf, readRights, accessDecisionOf: (userId, workRef) => Promise<{decision, via}|null>, env?, now? }} deps
 */
export async function readGroupRecognition(studentIds, deps = {}) {
    const { env = process.env, now = Date.now() } = deps;
    if (!isGamificationEnabled(env) || !isXpEarningEnabled(env)) return null;
    const dbPath = resolveGamificationDbPath(env);
    if (!fs.existsSync(`${dbPath}-wal`) || !fs.existsSync(`${dbPath}-shm`)) throw new GamificationError('GAMIFICATION_DB_NOT_LIVE');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('query_only = ON');
        // Obras del catálogo actual con acceso explícito para al menos una persona del
        // grupo. Solo se evalúan si hoy una revisión puede sumar XP.
        const eligibleWorkRefs = [];
        if (recognitionActive(db, now)) {
            const isWithdrawn = withdrawnReader(deps.readRights);
            const works = new Set(catalogActivities(deps.readMook(), null, { workRefOf: deps.workRefOf, sinceMs: mookActivationSince(env) }).map((a) => a.workRef));
            for (const workRef of works) {
                let withdrawn = true;
                try { withdrawn = isWithdrawn(workRef) !== false; } catch { withdrawn = true; }
                if (withdrawn) continue;
                for (const id of studentIds) {
                    let access = null;
                    try { access = await deps.accessDecisionOf(id, workRef); } catch { access = null; }
                    if (workAccessCounts(access)) { eligibleWorkRefs.push(workRef); break; }
                }
            }
        }
        // Misma instantánea para todo el grupo (V8-INTEGRATION-02A).
        return db.transaction(() => readGroupRecognitionCounts(db, studentIds, { eligibleWorkRefs, env, now }))();
    } finally {
        db.close();
    }
}

function scheduleCandidates(cands, resolveUser, opts) {
    for (const c of cands) scheduleFact({ ...c, eligibility: candidateEligibility(resolveUser, c) }, opts);
}

/**
 * Gancho tras una revisión MOOK. Recibe la evidencia ya revisada (lo que el
 * servidor acaba de escribir). Nunca lanza; si no aplica, no hace nada.
 */
export function onMookEvidenceReviewed(evidence, { resolveUser, recognition = null, env = process.env, log = () => {}, onDone } = {}) {
    try {
        if (!isGamificationEnabled(env)) return;
        const since = mookActivationSince(env);
        if (!since || typeof resolveUser !== 'function') return;
        scheduleCandidates(mookApprovedReviewCandidates({ evidence: [evidence] }, since), resolveUser, { env, log, onDone });
        if (recognition && isXpEarningEnabled(env)) {
            scheduleOnHookDb((db) => recognizeMookWorks(db, recognition.readMook(), { ...recognition, resolveUser, sinceMs: since, onlyEvidenceId: evidence.id, env }), { env, log, onDone: recognition.onDone });
        }
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
//
// G4-PERF-01B. El lock lleva un testigo propio (pid + uuid: en contenedores el pid
// se repite). El barrido por lotes lo renueva (mtime) en cada cesión, solo si el
// testigo sigue siendo el suyo; si no lo es, otra réplica lo dio por muerto y el
// barrido se detiene. Al terminar, solo se borra un lock propio.

function tryLock(lockFile, now) {
    const token = `${process.pid}:${crypto.randomUUID()}`;
    try {
        const fd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
        fs.writeSync(fd, token);
        fs.closeSync(fd);
        return token;
    } catch (e) {
        if (e.code !== 'EEXIST') return null;
        try {
            if (now - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) { // dueño muerto: se libera
                fs.unlinkSync(lockFile);
                return tryLock(lockFile, now);
            }
        } catch { /* otro lo liberó o lo tomó entre medio */ }
        return null;
    }
}

/** Testigo escrito en el lock, o null si no existe o no se puede leer. */
function lockHolder(lockFile) {
    let fd = null;
    try {
        fd = fs.openSync(lockFile, 'r');
        const buf = Buffer.alloc(128);
        return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
    } catch {
        return null;
    } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* noop */ } }
    }
}

/**
 * Renueva un lock propio. `false` si ya no es nuestro.
 * G4-PERF-01B-CLOSE: testigo y renovación van por el MISMO descriptor (el mismo
 * inodo), y después se confirma que la ruta sigue apuntando a él. Si otra
 * réplica lo dio por obsoleto y lo reemplazó entre medio, la renovación cae en
 * el inodo ya desvinculado (inocuo) y se da por perdida: el lock nuevo no se toca.
 */
function renewLock(lockFile, token, now) {
    let fd = null;
    try {
        fd = fs.openSync(lockFile, 'r+');
        const buf = Buffer.alloc(128);
        if (buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0)) !== token) return false;
        lockRaceHook?.('renew');
        const t = new Date(now);
        fs.futimesSync(fd, t, t);
        const held = fs.fstatSync(fd, { bigint: true });
        const atPath = fs.statSync(lockFile, { bigint: true });
        return held.ino === atPath.ino && held.dev === atPath.dev;
    } catch {
        return false;
    } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* noop */ } }
    }
}

/**
 * Libera solo un lock propio. Se renueva y confirma justo antes de liberarlo.
 * G4-PERF-01B-FINAL: no se borra por ruta. El lock se aparta con `rename`
 * (atómico) a un nombre propio de este testigo y se comprueba que lo apartado
 * lleva nuestro testigo. Si en ese instante otra réplica ya lo había reemplazado
 * (solo posible si este proceso se congeló más de LOCK_STALE_MS justo antes),
 * lo apartado es el lock de ella (otro testigo): se devuelve a su sitio con
 * `link`, que nunca pisa un lock creado entre medio, y su dueño lo conserva.
 */
const unlock = (lockFile, token) => {
    if (!renewLock(lockFile, token, Date.now())) return; // lo tomó otra réplica: no es nuestro
    lockRaceHook?.('release');
    const aside = `${lockFile}.${token.replace(/[^0-9A-Za-z-]/g, '-')}.release`;
    try { fs.renameSync(lockFile, aside); } catch { return; }
    // Por testigo y no por inodo: sin descriptor abierto, un inodo liberado se
    // reutiliza (Linux) y el lock nuevo podría tener el mismo número.
    if (lockHolder(aside) !== token) {
        lockRaceHook?.('restore');
        // `link` falla si la ruta ya está ocupada: nunca pisa un lock creado entre
        // medio. Si falla, el lock vigente es el de quien ocupó la ruta; el dueño
        // apartado lo detecta en su siguiente cesión (`RECONCILE_LOCK_LOST`).
        try { fs.linkSync(aside, lockFile); } catch { /* ruta ocupada */ }
    }
    try { fs.unlinkSync(aside); } catch { /* noop */ } // solo el nombre apartado, nunca la ruta del lock
};

// Solo pruebas: `setRaceHook` corre una función entre la comprobación del testigo
// y la operación (renovar o liberar), para reproducir la toma por otra réplica.
let lockRaceHook = null;
export const __reconcileLockForTest = Object.freeze({
    tryLock, renewLock, unlock, lockHolder, setRaceHook: (fn) => { lockRaceHook = fn; },
});

/** Precondiciones comunes a los dos conductores. */
function reconcilePlan(env) {
    if (!isGamificationEnabled(env)) return { skipped: 'disabled' };
    const since = mookActivationSince(env);
    if (!since) return { skipped: 'no_activation_cutoff' };
    const dbPath = resolveGamificationDbPath(env);
    if (!fs.existsSync(dbPath)) return { skipped: 'db_absent' };
    const lockFile = `${dbPath}.reconcile.lock`;
    return { since, dbPath, lockFile };
}

function openReconcileDb(dbPath) {
    const db = new Database(dbPath, { fileMustExist: true });
    db.pragma(`busy_timeout = ${RECONCILE_BUSY_MS}`);
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('secure_delete = ON');
    return db;
}

/**
 * Pasos de un barrido. Cada `yield` cae entre transacciones: ninguna queda
 * abierta mientras el conductor cede el event loop.
 */
function* sweepSteps(db, { readMook, readUsers, isUserActive, isSyntheticUser, workRefOf, readRights, since, env, now }) {
    replayExclusions(db, { env }); // antes de leer la fuente: la puerta de restauración
    const doc = readMook();
    yield;
    const cands = [...mookApprovedReviewCandidates(doc, since), ...mookCompletedExperienceCandidates(doc, since)];
    const resolveUser = makeResolveUser(readUsers(), isUserActive, isSyntheticUser);
    yield;
    const swept = yield* reconcileSteps(db, cands, { resolveUser, env });
    const recognition = yield* recognizeMookWorksSteps(db, doc, { workRefOf, readRights, resolveUser, sinceMs: since, env, now: now() });
    return { ok: true, ...swept, recognition };
}

/**
 * Un barrido de reconciliación MOOK, síncrono y sin cesiones. Una sola ejecución
 * efectiva entre réplicas: si otra tiene el lock, esta se salta (`skipped: 'locked'`).
 * Usa una conexión propia con busy corto: ante contención el barrido se corta
 * y el siguiente lo retoma (idempotente).
 */
export function runMookReconcileOnce(deps = {}) {
    const { env = process.env, now = Date.now } = deps;
    const plan = reconcilePlan(env);
    if (plan.skipped) return plan;
    const token = tryLock(plan.lockFile, now());
    if (!token) return { skipped: 'locked' };
    let db = null;
    try {
        db = openReconcileDb(plan.dbPath);
        return drainSteps(sweepSteps(db, { ...deps, since: plan.since, env, now }));
    } catch (e) {
        return { ok: false, code: e?.code || 'RECONCILE_ERROR' };
    } finally {
        if (db) { try { db.close(); } catch { /* noop */ } }
        unlock(plan.lockFile, token);
    }
}

export const RECONCILE_SLICE_MS = 20;
export const RECONCILE_SLICE_MAX = 500;
const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * G4-PERF-01B. El mismo barrido, en lotes acotados por tiempo (`sliceMs`) y por
 * pasos (`sliceMax`), cediendo el event loop con `setImmediate` entre lotes.
 * Mismas decisiones, mismo orden y mismas transacciones que `runMookReconcileOnce`.
 * En cada cesión: renueva el lock (o se detiene si ya no es suyo) y, al reanudar,
 * relee exclusiones y derechos. Sin cursor ni estado entre barridos: un barrido
 * cortado (error, parada, SIGKILL) lo retoma entero el siguiente, idempotente.
 * `onPause` existe para las pruebas.
 */
export async function runMookReconcileBatched(deps = {}, { sliceMs = RECONCILE_SLICE_MS, sliceMax = RECONCILE_SLICE_MAX, shouldStop = () => false, onPause = null } = {}) {
    const { env = process.env, now = Date.now } = deps;
    const plan = reconcilePlan(env);
    if (plan.skipped) return plan;
    const token = tryLock(plan.lockFile, now());
    if (!token) return { skipped: 'locked' };
    let db = null;
    let steps = null;
    try {
        db = openReconcileDb(plan.dbPath);
        steps = sweepSteps(db, { ...deps, since: plan.since, env, now });
        let slices = 1;
        let n = 0;
        let sliceStart = performance.now();
        let r = steps.next(false);
        while (!r.done) {
            if (++n < sliceMax && performance.now() - sliceStart < sliceMs) { r = steps.next(false); continue; }
            await yieldEventLoop();
            if (onPause) await onPause({ db, slices });
            if (shouldStop()) return { ok: false, code: 'RECONCILE_STOPPED' };
            if (!renewLock(plan.lockFile, token, now())) return { ok: false, code: 'RECONCILE_LOCK_LOST' };
            slices++;
            n = 0;
            sliceStart = performance.now();
            r = steps.next(true);
        }
        return { ...r.value, slices };
    } catch (e) {
        return { ok: false, code: e?.code || 'RECONCILE_ERROR' };
    } finally {
        try { steps?.return(); } catch { /* noop */ }
        if (db) { try { db.close(); } catch { /* noop */ } }
        unlock(plan.lockFile, token);
    }
}

/**
 * Programa la reconciliación: un barrido inicial tras `initialDelayMs` y luego
 * cada `intervalMs` (mínimo 1 min, por defecto 15). Sin flag o sin corte no
 * programa nada. Timers `unref`: nunca retienen el proceso. Devuelve `stop()`.
 * La base se abre y migra AQUÍ, al arrancar (fuera de peticiones).
 * G4-PERF-01B: cada barrido va por lotes y cede el event loop.
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
    let stopped = false;
    const sweep = async () => {
        if (running || stopped) return; // nunca dos barridos superpuestos en la misma réplica, tampoco entre lotes
        running = true;
        try {
            const r = await runMookReconcileBatched({ ...deps, env }, { shouldStop: () => stopped });
            if (r.ok && r.recorded) log(`[gamification] reconciliación MOOK: ${r.recorded} hechos recuperados`);
            else if (r.ok === false) log(`[gamification] reconciliación MOOK abortada: ${r.code}`);
            deps.onSweep?.(r);
        } catch (e) {
            log(`[gamification] reconciliación MOOK abortada: ${e?.code || 'RECONCILE_ERROR'}`);
        } finally {
            running = false;
        }
    };
    const timers = [];
    timers.push(setTimeout(() => {
        try { getGamificationDb({ log }); } catch (e) { log(`[gamification] base no disponible: ${e.code}`); }
        void sweep();
        const iv = setInterval(() => { void sweep(); }, intervalMs);
        iv.unref?.();
        timers.push(iv);
    }, initialDelayMs));
    timers[0].unref?.();
    return { stop: () => { stopped = true; timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); }, intervalMs, initialDelayMs };
}
