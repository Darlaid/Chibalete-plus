/**
 * shadowExecutor.mjs — CHP-STATS-SHADOW-01A.
 *
 * Ejecutor ACOTADO y NO BLOQUEANTE del trabajo canónico en modo shadow.
 *
 * Regla dura: la respuesta pública NUNCA espera a este ejecutor. `submit()`
 * devuelve de inmediato un veredicto de admisión y el trabajo ocurre después,
 * fuera del camino de la respuesta.
 *
 * Protecciones, todas configurables y todas con default seguro:
 *   · sample rate      — por defecto 0: nada se ejecuta si no se activa;
 *   · cola acotada     — al llenarse se descarta y se cuenta, nunca crece;
 *   · concurrencia máx — limita el trabajo simultáneo;
 *   · timeout          — un canónico lento se abandona, no se acumula;
 *   · circuit breaker  — tras N fallos consecutivos suspende temporalmente;
 *   · shutdown limpio  — drena o descarta sin dejar promesas colgando.
 *
 * Toda promesa rechazada se captura aquí dentro: nada escapa al proceso.
 */

/** Lee un entero de entorno con default y cota. */
function envInt(env, name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = env?.[name];
    if (raw === undefined || raw === null || raw === '') return def;
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

function envFloat(env, name, def, { min = 0, max = 1 } = {}) {
    const raw = env?.[name];
    if (raw === undefined || raw === null || raw === '') return def;
    const n = Number.parseFloat(String(raw));
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

/**
 * Configuración efectiva. **El default de `sampleRate` es 0**: si la variable
 * falta, el shadow queda inerte. Ninguna ausencia de configuración puede
 * activarlo por accidente.
 */
export function resolveShadowConfig(env = process.env) {
    return Object.freeze({
        sampleRate:     envFloat(env, 'METRICS_SHADOW_SAMPLE_RATE', 0),
        timeoutMs:      envInt(env, 'METRICS_SHADOW_TIMEOUT_MS', 2000, { min: 1, max: 60_000 }),
        maxConcurrency: envInt(env, 'METRICS_SHADOW_MAX_CONCURRENCY', 2, { min: 1, max: 64 }),
        queueLimit:     envInt(env, 'METRICS_SHADOW_QUEUE_LIMIT', 50, { min: 1, max: 10_000 }),
        errorThreshold: envInt(env, 'METRICS_SHADOW_ERROR_THRESHOLD', 10, { min: 1, max: 10_000 }),
        breakerCooldownMs: envInt(env, 'METRICS_SHADOW_BREAKER_COOLDOWN_MS', 60_000, { min: 1_000, max: 3_600_000 }),
    });
}

export const SKIP = Object.freeze({
    SAMPLED_OUT:    'sampled_out',
    QUEUE_FULL:     'queue_full',
    BREAKER_OPEN:   'breaker_open',
    SHUTTING_DOWN:  'shutting_down',
    DISABLED:       'disabled',
});

/** Contadores agregados. Sin PII, sin payloads: solo números. */
function emptyCounters() {
    return {
        shadow_requests_total: 0,
        shadow_comparisons_started: 0,
        shadow_comparisons_completed: 0,
        shadow_comparisons_skipped: 0,
        shadow_queue_full: 0,
        shadow_timeouts: 0,
        shadow_canonical_errors: 0,
        shadow_shape_errors: 0,
        shadow_breaker_open_total: 0,
        shadow_differences_by_reason: Object.create(null),
        shadow_duration_ms: { count: 0, sum: 0, max: 0 },
        shadow_legacy_response_duration_ms: { count: 0, sum: 0, max: 0 },
    };
}

function observe(hist, ms) {
    hist.count += 1;
    hist.sum += ms;
    if (ms > hist.max) hist.max = ms;
}

/**
 * @param {object} opts
 * @param {object} [opts.config]  configuración ya resuelta
 * @param {function} [opts.now]   reloj inyectable (tests determinísticos)
 * @param {function} [opts.random] RNG inyectable
 * @param {function} [opts.log]   logger estructurado
 */
export function createShadowExecutor({
    config = resolveShadowConfig(),
    now = () => Date.now(),
    random = Math.random,
    log = () => {},
} = {}) {
    const counters = emptyCounters();
    const queue = [];
    let active = 0;
    let consecutiveErrors = 0;
    let breakerOpenUntil = 0;
    let shuttingDown = false;
    /** Promesas en vuelo, para poder drenar en el shutdown. */
    const inFlight = new Set();

    const breakerOpen = () => now() < breakerOpenUntil;

    function skip(reason) {
        counters.shadow_comparisons_skipped += 1;
        if (reason === SKIP.QUEUE_FULL) counters.shadow_queue_full += 1;
        return { accepted: false, reason };
    }

    function pump() {
        while (active < config.maxConcurrency && queue.length > 0) {
            const job = queue.shift();
            active += 1;
            counters.shadow_comparisons_started += 1;
            const started = now();

            // Timeout que no deja timers colgando ni promesas sin capturar.
            let timer = null;
            const timeout = new Promise((resolve) => {
                timer = setTimeout(() => resolve({ __timedOut: true }), config.timeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
            });

            const p = Promise.race([Promise.resolve().then(job.task), timeout])
                .then((result) => {
                    if (result && result.__timedOut) {
                        counters.shadow_timeouts += 1;
                        consecutiveErrors += 1;
                        log({ evt: 'shadow_timeout', routeKind: job.routeKind }, 'WARN');
                        return;
                    }
                    counters.shadow_comparisons_completed += 1;
                    consecutiveErrors = 0;
                    if (result && Array.isArray(result.differences)) {
                        for (const d of result.differences) {
                            const r = d?.reasonCode ?? 'UNKNOWN_DIFFERENCE';
                            counters.shadow_differences_by_reason[r] =
                                (counters.shadow_differences_by_reason[r] ?? 0) + 1;
                        }
                    }
                    if (result?.canonicalError) counters.shadow_canonical_errors += 1;
                    if (result?.shapeError) counters.shadow_shape_errors += 1;
                })
                .catch((e) => {
                    counters.shadow_canonical_errors += 1;
                    consecutiveErrors += 1;
                    // Nunca se propaga: el shadow no puede tumbar el proceso.
                    log({ evt: 'shadow_error', routeKind: job.routeKind, code: e?.code ?? 'error' }, 'WARN');
                })
                .finally(() => {
                    if (timer) clearTimeout(timer);
                    observe(counters.shadow_duration_ms, now() - started);
                    active -= 1;
                    inFlight.delete(p);
                    if (consecutiveErrors >= config.errorThreshold && !breakerOpen()) {
                        breakerOpenUntil = now() + config.breakerCooldownMs;
                        counters.shadow_breaker_open_total += 1;
                        log({ evt: 'shadow_breaker_open', consecutiveErrors }, 'WARN');
                    }
                    if (!shuttingDown) pump();
                });

            inFlight.add(p);
        }
    }

    return {
        config,
        counters,

        /** Métrica del camino público, para demostrar que shadow no lo retrasa. */
        observeLegacyDuration(ms) { observe(counters.shadow_legacy_response_duration_ms, ms); },

        /**
         * Admite trabajo canónico. **Retorna de inmediato**, sin await.
         * @returns {{accepted: boolean, reason?: string}}
         */
        submit({ routeKind, task }) {
            counters.shadow_requests_total += 1;
            if (shuttingDown) return skip(SKIP.SHUTTING_DOWN);
            if (config.sampleRate <= 0) return skip(SKIP.DISABLED);
            if (breakerOpen()) return skip(SKIP.BREAKER_OPEN);
            if (config.sampleRate < 1 && random() >= config.sampleRate) return skip(SKIP.SAMPLED_OUT);
            if (queue.length >= config.queueLimit) return skip(SKIP.QUEUE_FULL);

            queue.push({ routeKind, task });
            pump();                       // síncrono: solo encola y arranca
            return { accepted: true };
        },

        stats() {
            return {
                queueDepth: queue.length,
                active,
                breakerOpen: breakerOpen(),
                consecutiveErrors,
                shuttingDown,
            };
        },

        /** Apagado limpio: deja de admitir y espera a lo que ya está en vuelo. */
        async shutdown({ drainMs = 5000 } = {}) {
            shuttingDown = true;
            const dropped = queue.length;
            queue.length = 0;
            counters.shadow_comparisons_skipped += dropped;
            const deadline = Promise.all([...inFlight]).catch(() => {});
            // El temporizador de drenaje NO se hace unref a propósito: si un job
            // quedó colgado, un timer unref'd nunca dispararía y `shutdown()`
            // no resolvería jamás. Es corto y deliberado.
            let t;
            const timer = new Promise((r) => { t = setTimeout(r, drainMs); });
            try {
                await Promise.race([deadline, timer]);
            } finally {
                clearTimeout(t);
            }
            return { dropped, stillActive: active };
        },
    };
}

/** Instantánea serializable de contadores (para /metrics o logs agregados). */
export function snapshotCounters(executor) {
    const c = executor.counters;
    const avg = (h) => (h.count ? Math.round(h.sum / h.count) : 0);
    return {
        ...c,
        shadow_duration_ms: { ...c.shadow_duration_ms, avg: avg(c.shadow_duration_ms) },
        shadow_legacy_response_duration_ms: {
            ...c.shadow_legacy_response_duration_ms,
            avg: avg(c.shadow_legacy_response_duration_ms),
        },
        ...executor.stats(),
    };
}
