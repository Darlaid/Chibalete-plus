/**
 * queryProfiler.mjs — PASO 4 §13 + §15.
 *
 * Wrapper instrumentación de queries críticas:
 *   - mide elapsed con process.hrtime
 *   - emite `chibalete_dashboard_latency_ms{endpoint}` histogram
 *   - si elapsed > SLOW_THRESHOLD_MS → insert en slow_query_log + emite
 *     `chibalete_query_slow_total{query_id}` counter
 *
 * NUNCA propaga error de la query original. NUNCA es síncronamente caro
 * (overhead ~10µs por wrap).
 */
import { getRollupsExtDb, getRollupsStatements } from '../db/rollupsDbExt.mjs';
import { dashboardLatency, querySlow } from '../observability/metrics.js';

export const SLOW_THRESHOLD_MS = Number(process.env.SLOW_QUERY_THRESHOLD_MS || 250);

/**
 * Envuelve `fn` síncrono, mide y registra. `queryId` es estable (no contiene
 * IDs de usuario — cardinalidad fija).
 */
export function instrument(queryId, fn, opts = {}) {
    const t0 = process.hrtime.bigint();
    let result, threw = false;
    try { result = fn(); }
    catch (e) { threw = true; result = e; }
    const elapsedMs = Number((process.hrtime.bigint() - t0) / 1000000n);
    try {
        dashboardLatency.labels(queryId).observe(elapsedMs);
        if (elapsedMs >= SLOW_THRESHOLD_MS) {
            querySlow.labels(queryId).inc();
            try {
                getRollupsExtDb();
                getRollupsStatements().logSlow.run({
                    query_id: queryId,
                    elapsed_ms: elapsedMs,
                    observed_at: Date.now(),
                    sample_args: opts.sample_args
                        ? JSON.stringify(opts.sample_args).slice(0, 500)
                        : null,
                });
            } catch { /* nunca tumba la query */ }
        }
    } catch { /* métrica jamás tumba */ }
    if (threw) throw result;
    return result;
}

/**
 * Versión async (Promise). Idéntica semántica.
 */
export async function instrumentAsync(queryId, fn, opts = {}) {
    const t0 = process.hrtime.bigint();
    try {
        const result = await fn();
        const elapsedMs = Number((process.hrtime.bigint() - t0) / 1000000n);
        try {
            dashboardLatency.labels(queryId).observe(elapsedMs);
            if (elapsedMs >= SLOW_THRESHOLD_MS) {
                querySlow.labels(queryId).inc();
                try {
                    getRollupsExtDb();
                    getRollupsStatements().logSlow.run({
                        query_id: queryId,
                        elapsed_ms: elapsedMs,
                        observed_at: Date.now(),
                        sample_args: opts.sample_args
                            ? JSON.stringify(opts.sample_args).slice(0, 500)
                            : null,
                    });
                } catch {}
            }
        } catch {}
        return result;
    } catch (e) {
        const elapsedMs = Number((process.hrtime.bigint() - t0) / 1000000n);
        try { dashboardLatency.labels(queryId).observe(elapsedMs); } catch {}
        throw e;
    }
}

/** Para healthcheck: cuántas slow queries en los últimos N segundos. */
export function recentSlowCount(windowSec = 300) {
    try {
        getRollupsExtDb();
        const since = Date.now() - windowSec * 1000;
        return getRollupsStatements().countSlowSince.get(since).n;
    } catch { return null; }
}

/** Lista las slow queries recientes (para debug). */
export function listRecentSlow(windowSec = 300, limit = 100) {
    try {
        getRollupsExtDb();
        const since = Date.now() - windowSec * 1000;
        return getRollupsStatements().listSlowRecent.all(since, limit);
    } catch { return []; }
}

/** Limpieza del log: borra entradas más viejas que `keepHours`. */
export function pruneOlderThan(keepHours = 24) {
    try {
        getRollupsExtDb();
        const cutoff = Date.now() - keepHours * 3600_000;
        const del = getRollupsStatements().pruneSlow.run(cutoff);
        return { ok: true, deleted: del.changes };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
