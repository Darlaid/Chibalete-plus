/**
 * shadowWorkerPool.mjs — CHP-STATS-SHADOW-PERF-01B.
 *
 * Pool ACOTADO y persistente de worker threads para el cálculo canónico del
 * shadow. Decidido en `docs/ADR-CHP-STATS-SHADOW-PERF-01A.md`: es la única
 * arquitectura medida que saca el cómputo del event loop en vez de solo
 * acortarlo.
 *
 * Invariantes:
 *   · **ningún job se ejecuta en el hilo principal**;
 *   · el pool nunca crece por encima de su límite;
 *   · un worker muerto no puede producir un 5xx legacy;
 *   · una respuesta tardía (posterior al timeout) se descarta;
 *   · el respawn tiene backoff acotado: no hay bucle infinito;
 *   · ningún job queda pendiente indefinidamente;
 *   · los identificadores del job viven en memoria y se descartan al terminar:
 *     no se registran ni aparecen en métricas ni en errores.
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(HERE, 'shadowWorker.mjs');

export const PROTOCOL_VERSION = 1;

export const POOL_STATE = Object.freeze({
    STARTING: 'STARTING',
    READY:    'READY',
    DEGRADED: 'DEGRADED',
    STOPPING: 'STOPPING',
    STOPPED:  'STOPPED',
});

export class PoolConfigError extends Error {
    constructor(detail) {
        super(`SHADOW_POOL_CONFIG_ERROR: ${detail}`);
        this.name = 'PoolConfigError';
        this.code = 'SHADOW_POOL_CONFIG_ERROR';
    }
}

/** Tope duro del pool. Esta infraestructura tiene 2 vCPU: más de 1 competiría
 *  con el hilo principal, así que el default es 1 y el máximo se limita. */
export const MAX_WORKERS_HARD_LIMIT = 4;

/**
 * Resuelve el tamaño del pool. **Nunca** se deriva del número de CPU sin tope,
 * y un valor inválido es un error de configuración explícito, no un default
 * silencioso.
 */
export function resolveWorkerCount(env = process.env) {
    const raw = env?.METRICS_SHADOW_WORKERS;
    if (raw === undefined || raw === null || String(raw).trim() === '') return 1;
    const n = Number(String(raw).trim());
    if (!Number.isInteger(n)) throw new PoolConfigError(`METRICS_SHADOW_WORKERS no es entero: ${String(raw)}`);
    if (n < 1) throw new PoolConfigError('METRICS_SHADOW_WORKERS mínimo 1');
    if (n > MAX_WORKERS_HARD_LIMIT) {
        throw new PoolConfigError(`METRICS_SHADOW_WORKERS máximo ${MAX_WORKERS_HARD_LIMIT}`);
    }
    return n;
}

/**
 * @param {object} opts
 * @param {number}  [opts.workers]        tamaño del pool (default 1)
 * @param {number}  [opts.timeoutMs]
 * @param {number}  [opts.queueLimit]
 * @param {number}  [opts.errorThreshold] fallos consecutivos → breaker
 * @param {number}  [opts.breakerCooldownMs]
 * @param {number}  [opts.respawnBaseMs]  backoff base del respawn
 * @param {number}  [opts.respawnMaxMs]
 * @param {function}[opts.now]
 * @param {function}[opts.log]
 * @param {string}  [opts.workerPath]     inyectable en tests
 */
export function createShadowWorkerPool({
    workers = 1, timeoutMs = 5000, queueLimit = 50,
    errorThreshold = 10, breakerCooldownMs = 60_000,
    respawnBaseMs = 250, respawnMaxMs = 30_000,
    now = () => Date.now(), log = () => {}, workerPath = WORKER_PATH,
    providerDeps = {},
} = {}) {
    if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS_HARD_LIMIT) {
        throw new PoolConfigError(`workers fuera de rango: ${workers}`);
    }

    const counters = {
        pool_jobs_submitted: 0,
        pool_jobs_started: 0,
        pool_jobs_completed: 0,
        pool_jobs_failed: 0,
        pool_jobs_timeout: 0,
        pool_jobs_rejected_queue_full: 0,
        pool_jobs_rejected_breaker: 0,
        pool_jobs_rejected_stopping: 0,
        pool_late_responses_discarded: 0,
        pool_worker_spawns: 0,
        pool_worker_crashes: 0,
        pool_respawn_backoff_ms: 0,
        pool_invalid_shape: 0,
        pool_unknown_job_id: 0,
    };

    const queue = [];
    /** slots[i] = { worker, busy, jobId } */
    const slots = [];
    /** jobId → { resolve, timer, slotIndex } */
    const inFlight = new Map();
    let seq = 0;
    let state = POOL_STATE.STARTING;
    let consecutiveErrors = 0;
    let breakerOpenUntil = 0;
    let stopping = false;

    const breakerOpen = () => now() < breakerOpenUntil;
    const liveWorkers = () => slots.filter(s => s.worker).length;

    function refreshState() {
        if (stopping) { state = slots.length === 0 ? POOL_STATE.STOPPED : POOL_STATE.STOPPING; return; }
        if (liveWorkers() === 0) { state = POOL_STATE.DEGRADED; return; }
        state = breakerOpen() || liveWorkers() < slots.length ? POOL_STATE.DEGRADED : POOL_STATE.READY;
    }

    function settle(jobId, result) {
        const rec = inFlight.get(jobId);
        if (!rec) {
            // Respuesta tardía: el job ya expiró o no existe. Se descarta.
            counters.pool_late_responses_discarded += 1;
            return;
        }
        inFlight.delete(jobId);
        if (rec.timer) clearTimeout(rec.timer);
        const slot = slots[rec.slotIndex];
        if (slot) { slot.busy = false; slot.jobId = null; }
        rec.resolve(result);
        pump();
    }

    function spawn(i, backoffMs = 0) {
        if (stopping) return;
        const start = () => {
            if (stopping) return;
            let w;
            try {
                w = new Worker(workerPath, { workerData: { providerDeps } });
            } catch (e) {
                counters.pool_worker_crashes += 1;
                scheduleRespawn(i, backoffMs);
                return;
            }
            counters.pool_worker_spawns += 1;
            slots[i] = { worker: w, busy: false, jobId: null, backoff: respawnBaseMs };

            w.on('message', (msg) => {
                if (!msg || typeof msg !== 'object' || msg.jobId == null) {
                    counters.pool_invalid_shape += 1;
                    return;
                }
                if (!inFlight.has(msg.jobId)) { counters.pool_unknown_job_id += 1; counters.pool_late_responses_discarded += 1; return; }
                if (msg.ok === true) {
                    counters.pool_jobs_completed += 1;
                    consecutiveErrors = 0;
                    settle(msg.jobId, { ok: true, status: msg.status, projection: msg.projection, durationMs: msg.durationMs });
                } else {
                    counters.pool_jobs_failed += 1;
                    consecutiveErrors += 1;
                    maybeOpenBreaker();
                    settle(msg.jobId, { ok: false, error: msg.error ?? 'WORKER_ERROR' });
                }
                refreshState();
            });

            w.on('error', () => {
                counters.pool_worker_crashes += 1;
                consecutiveErrors += 1;
                maybeOpenBreaker();
                failSlot(i, 'WORKER_ERROR');
            });

            w.on('exit', () => {
                if (stopping) { slots[i] = { worker: null, busy: false, jobId: null, backoff: respawnBaseMs }; refreshState(); return; }
                counters.pool_worker_crashes += 1;
                failSlot(i, 'WORKER_EXIT');
                scheduleRespawn(i, Math.max(respawnBaseMs, backoffMs));
            });

            refreshState();
            pump();
        };

        if (backoffMs > 0) {
            counters.pool_respawn_backoff_ms = backoffMs;
            const t = setTimeout(start, backoffMs);
            if (typeof t.unref === 'function') t.unref();
        } else start();
    }

    function scheduleRespawn(i, prevBackoff) {
        // Backoff exponencial ACOTADO: nunca un bucle de respawn ilimitado.
        const next = Math.min(respawnMaxMs, Math.max(respawnBaseMs, (prevBackoff || respawnBaseMs) * 2));
        slots[i] = { worker: null, busy: false, jobId: null, backoff: next };
        refreshState();
        spawn(i, next);
    }

    function failSlot(i, error) {
        const slot = slots[i];
        if (slot?.jobId != null) settle(slot.jobId, { ok: false, error });
        slots[i] = { worker: null, busy: false, jobId: null, backoff: slot?.backoff ?? respawnBaseMs };
        refreshState();
    }

    function maybeOpenBreaker() {
        if (consecutiveErrors >= errorThreshold && !breakerOpen()) {
            breakerOpenUntil = now() + breakerCooldownMs;
            log({ evt: 'shadow_pool_breaker_open', consecutiveErrors }, 'WARN');
        }
    }

    function pump() {
        if (stopping) return;
        for (let i = 0; i < slots.length && queue.length > 0; i++) {
            const slot = slots[i];
            if (!slot?.worker || slot.busy) continue;
            const job = queue.shift();
            slot.busy = true;
            slot.jobId = job.jobId;
            counters.pool_jobs_started += 1;

            const timer = setTimeout(() => {
                counters.pool_jobs_timeout += 1;
                consecutiveErrors += 1;
                maybeOpenBreaker();
                // El job se abandona; una respuesta posterior se descartará.
                settle(job.jobId, { ok: false, error: 'WORKER_TIMEOUT' });
            }, timeoutMs);
            if (typeof timer.unref === 'function') timer.unref();

            inFlight.set(job.jobId, { resolve: job.resolve, timer, slotIndex: i });
            try {
                slot.worker.postMessage({ ...job.message, jobId: job.jobId, protocolVersion: PROTOCOL_VERSION });
            } catch (e) {
                settle(job.jobId, { ok: false, error: 'WORKER_POST_FAILED' });
            }
        }
    }

    for (let i = 0; i < workers; i++) spawn(i);
    refreshState();

    return {
        counters,
        get state() { refreshState(); return state; },
        stats() {
            refreshState();
            return {
                state, workers: slots.length, liveWorkers: liveWorkers(),
                queueDepth: queue.length, inFlight: inFlight.size,
                breakerOpen: breakerOpen(), consecutiveErrors,
            };
        },
        /** ¿Hay al menos un worker operativo? readiness del shadow. */
        isOperational() { return !stopping && liveWorkers() > 0 && !breakerOpen(); },

        /**
         * Encola un job canónico. **Nunca** ejecuta en el hilo principal.
         * @returns {Promise<{ok:boolean, status?:number, projection?:object, error?:string}>}
         */
        submit(message) {
            counters.pool_jobs_submitted += 1;
            if (stopping) { counters.pool_jobs_rejected_stopping += 1; return Promise.resolve({ ok: false, error: 'POOL_STOPPING' }); }
            if (breakerOpen()) { counters.pool_jobs_rejected_breaker += 1; return Promise.resolve({ ok: false, error: 'BREAKER_OPEN' }); }
            if (queue.length >= queueLimit) { counters.pool_jobs_rejected_queue_full += 1; return Promise.resolve({ ok: false, error: 'QUEUE_FULL' }); }

            const jobId = ++seq;
            return new Promise((resolve) => {
                queue.push({ jobId, message, resolve });
                pump();
            });
        },

        async shutdown({ drainMs = 2000 } = {}) {
            stopping = true;
            refreshState();
            const dropped = queue.length;
            queue.length = 0;
            const deadline = new Promise((r) => { const t = setTimeout(r, drainMs); /* no unref: debe disparar */ });
            await Promise.race([
                (async () => { while (inFlight.size > 0) await new Promise(r => setTimeout(r, 10)); })(),
                deadline,
            ]);
            for (const rec of inFlight.values()) if (rec.timer) clearTimeout(rec.timer);
            inFlight.clear();
            await Promise.all(slots.map(async (s) => { if (s?.worker) { try { await s.worker.terminate(); } catch { /* noop */ } } }));
            slots.length = 0;
            refreshState();
            return { dropped, state };
        },
    };
}
