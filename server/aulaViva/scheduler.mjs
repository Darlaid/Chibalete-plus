/**
 * scheduler.mjs — Aula Viva PASO 5 §19.
 *
 * Conecta los engines (materializer/intervention/rollups/featureExtractor/
 * archiveRotation) con setInterval bajo leader-election. Cada loop:
 *   - solo corre si este proceso es líder (lock SQLite con TTL+heartbeat)
 *   - reporta métricas + actualiza materializer_runs
 *   - degraded mode si los engines retornan error N veces seguidas
 *
 * GATING global: `AULA_VIVA_SCHEDULER_ENABLED=1`. Sin esto, `start()` no hace
 * nada. Cada engine sigue gated por su propio flag (delegación).
 *
 * Cadencias por defecto (configurable via env):
 *   MATERIALIZER_INTERVAL_MS   = 60_000        (60s)
 *   INTERVENTION_INTERVAL_MS   = 300_000       (5min)
 *   ROLLUPS_INTERVAL_MS        = 1_800_000     (30min)
 *   FEATURE_EXTRACT_INTERVAL_MS= 86_400_000    (24h)
 *   ARCHIVE_ROTATION_INTERVAL_MS=21_600_000    (6h)
 *
 * Cancelable: `stop()` limpia todos los timers + libera locks. Idempotente.
 */
import { withLeader } from '../services/leaderElection.mjs';

let _timers = [];
let _running = false;
let _status = {
    started_at: null,
    last_runs: {},        // {key: {ts, ok, durationMs, error?}}
    consecutive_errors: {}, // {key: count}
    enabled: false,
};

const DEFAULTS = {
    materializer:    Number(process.env.MATERIALIZER_INTERVAL_MS    || 60_000),
    intervention:    Number(process.env.INTERVENTION_INTERVAL_MS    || 300_000),
    rollups:         Number(process.env.ROLLUPS_INTERVAL_MS         || 1_800_000),
    feature_extract: Number(process.env.FEATURE_EXTRACT_INTERVAL_MS || 86_400_000),
    archive_rotation:Number(process.env.ARCHIVE_ROTATION_INTERVAL_MS|| 21_600_000),
    // PASO 6 §22 — todos default-OFF (cada engine tiene su propio env gate).
    outcome_engine:         Number(process.env.OUTCOME_ENGINE_INTERVAL_MS         || 3_600_000),  // 1h
    cohort_builder:         Number(process.env.COHORT_BUILDER_INTERVAL_MS         || 21_600_000), // 6h
    trajectory_analyzer:    Number(process.env.TRAJECTORY_INTERVAL_MS             || 21_600_000), // 6h
    institutional_learning: Number(process.env.INSTITUTIONAL_LEARNING_INTERVAL_MS || 21_600_000), // 6h
    predictive_patterns:    Number(process.env.PREDICTIVE_PATTERNS_INTERVAL_MS    || 86_400_000), // 24h
};

const MAX_CONSECUTIVE_ERRORS = 5;  // degraded mode trigger

function recordRun(key, ok, durationMs, error = null) {
    _status.last_runs[key] = { ts: Date.now(), ok, durationMs, error };
    if (ok) _status.consecutive_errors[key] = 0;
    else _status.consecutive_errors[key] = (_status.consecutive_errors[key] || 0) + 1;
}

async function runWithLeader(lockKey, label, fn, log) {
    const t0 = Date.now();
    try {
        const wrapResult = await withLeader(lockKey, async () => fn());
        const elapsed = Date.now() - t0;
        if (!wrapResult.ran) {
            // Not leader es estado normal — no es error.
            return;
        }
        const inner = wrapResult.result;
        const ok = inner?.ok !== false;
        recordRun(label, ok, elapsed, ok ? null : inner?.error);
        log(`[scheduler] ${label} ran=ok=${ok} duration=${elapsed}ms`);
    } catch (e) {
        const elapsed = Date.now() - t0;
        recordRun(label, false, elapsed, String(e?.message || e));
        log(`[scheduler] ${label} threw: ${e.message}`);
    }
}

/**
 * Inicia el scheduler. Cada loop chequea su gate antes de invocar al engine.
 * @param {{log?:(m:string)=>void, intervals?:object}} [opts]
 */
export async function start(opts = {}) {
    if (_running) return { ok: false, reason: 'already_running' };
    if (process.env.AULA_VIVA_SCHEDULER_ENABLED !== '1') {
        return { ok: true, started: false, reason: 'scheduler_disabled_default_off' };
    }
    const log = opts.log || (() => {});
    const intervals = { ...DEFAULTS, ...(opts.intervals || {}) };

    // Lazy imports — evitan boot cost si el scheduler está OFF.
    const materializer = await import('../services/insightMaterializer.mjs');
    const intervention = await import('../services/interventionEngine.mjs');
    const rollups      = await import('../services/rollupsEngine.mjs');
    const features     = await import('../services/featureExtractor.mjs');
    const archive      = await import('./archiveRotation.mjs');
    // PASO 6 lazy imports.
    const outcomes     = await import('../services/outcomeEngine.mjs');
    const cohorts      = await import('../services/cohortBuilder.mjs');
    const trajectories = await import('../services/trajectoryAnalyzer.mjs');
    const learnings    = await import('../services/institutionalLearning.mjs');
    const patterns     = await import('../services/predictivePatterns.mjs');

    const loops = [
        { key: 'materializer',     lock: 'materializer',     interval: intervals.materializer,
          fn: () => materializer.runOnce({ log }) },
        { key: 'intervention',     lock: 'intervention',     interval: intervals.intervention,
          fn: () => intervention.runOnce({ log }) },
        { key: 'rollups',          lock: 'rollup',           interval: intervals.rollups,
          fn: () => rollups.runOnce({ log }) },
        { key: 'feature_extract',  lock: 'feature_extract',  interval: intervals.feature_extract,
          fn: () => features.runOnce({ log }) },
        { key: 'archive_rotation', lock: 'archive_rotation', interval: intervals.archive_rotation,
          fn: () => archive.rotateOnce({ log }) },
        // PASO 6 §22 loops (cada uno gated por su propio env → si engine OFF,
        // runOnce retorna skipped sin tocar DB).
        { key: 'outcome_engine',        lock: 'outcome_engine',        interval: intervals.outcome_engine,
          fn: () => outcomes.runOnce({ log }) },
        { key: 'cohort_builder',        lock: 'cohort_builder',        interval: intervals.cohort_builder,
          fn: () => cohorts.runOnce({ log }) },
        { key: 'trajectory_analyzer',   lock: 'trajectory_analyzer',   interval: intervals.trajectory_analyzer,
          fn: () => trajectories.runOnce({ log }) },
        { key: 'institutional_learning',lock: 'institutional_learning',interval: intervals.institutional_learning,
          fn: () => learnings.runOnce({ log }) },
        { key: 'predictive_patterns',   lock: 'predictive_patterns',   interval: intervals.predictive_patterns,
          fn: () => patterns.runOnce({ log }) },
    ];

    for (const l of loops) {
        // Primera corrida diferida para no bloquear el boot.
        const initialDelay = Math.min(15_000, Math.floor(l.interval / 4));
        const t = setTimeout(function tick() {
            runWithLeader(l.lock, l.key, l.fn, log).finally(() => {
                _timers.push(setTimeout(tick, l.interval));
            });
        }, initialDelay);
        _timers.push(t);
    }
    _running = true;
    _status.started_at = Date.now();
    _status.enabled = true;
    log(`[scheduler] started; loops=${loops.length}`);
    return { ok: true, started: true, loops: loops.map(l => l.key) };
}

export function stop() {
    for (const t of _timers) clearTimeout(t);
    _timers = [];
    _running = false;
    _status.enabled = false;
    return { ok: true };
}

export function getStatus() {
    return {
        running: _running,
        enabled: process.env.AULA_VIVA_SCHEDULER_ENABLED === '1',
        started_at: _status.started_at,
        timers: _timers.length,
        last_runs: { ..._status.last_runs },
        consecutive_errors: { ..._status.consecutive_errors },
        degraded: Object.values(_status.consecutive_errors)
            .some(n => n >= MAX_CONSECUTIVE_ERRORS),
        ok: true,
    };
}
