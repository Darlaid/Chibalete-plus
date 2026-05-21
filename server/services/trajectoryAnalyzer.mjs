/**
 * trajectoryAnalyzer.mjs — PASO 6 §13.
 *
 * Para cada cohort activa, computa una trayectoria temporal:
 *   - lee members
 *   - lee profiles + signal_snapshots actuales por cada member
 *   - agrega (mean) por signal → metrics_json
 *   - calcula trend simple comparando vs trajectoria anterior (si existe)
 *   - persiste en cohort_trajectories (UPSERT por cohort_id, period, period_end)
 *
 * NO requiere snapshot_history (lee del read model actual + persiste series).
 *
 * GATING: AULA_VIVA_TRAJECTORY_ENABLED=1 (default OFF).
 */
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { getInsightsExtDb } from '../db/insightsDbExt.mjs';
import { trajectoriesComputed } from '../observability/metrics.js';

const DAY_MS = 86_400_000;
const DEFAULT_PERIOD = '28d';

export const ENABLED = () => process.env.AULA_VIVA_TRAJECTORY_ENABLED === '1';

// ── Helpers ────────────────────────────────────────────────────────────────

function avg(xs) {
    const vals = xs.filter(x => typeof x === 'number' && isFinite(x));
    if (!vals.length) return null;
    return +(vals.reduce((s, x) => s + x, 0) / vals.length).toFixed(3);
}

function trendOf(curr, prev) {
    if (typeof curr !== 'number' || typeof prev !== 'number') return null;
    const delta = curr - prev;
    if (Math.abs(delta) < 0.05) return 'flat';
    return delta > 0 ? 'up' : 'down';
}

function aggregateMembers(memberIds, insightsDb) {
    if (!memberIds.length) return { metrics: {}, sample_size: 0 };
    const placeholders = memberIds.map(() => '?').join(',');
    const profiles = insightsDb.prepare(
        `SELECT * FROM user_reading_profiles WHERE user_id IN (${placeholders})`
    ).all(...memberIds);

    const snapshots = insightsDb.prepare(
        `SELECT * FROM signal_snapshots
         WHERE scope_type='user' AND scope_id IN (${placeholders}) AND period='28d'`
    ).all(...memberIds);

    const by = new Map();  // signal_id → [values]
    for (const s of snapshots) {
        if (!by.has(s.signal_id)) by.set(s.signal_id, []);
        if (typeof s.metric_value === 'number') by.get(s.signal_id).push(s.metric_value);
    }
    const metrics = {};
    for (const [sid, vals] of by) {
        metrics[sid] = avg(vals);
    }
    // Profile-derived
    metrics.abandono_risk = avg(profiles.map(p => p.abandono_risk));
    metrics.engagement_score = avg(profiles.map(p => p.engagement_score));
    metrics.persistencia_score = avg(profiles.map(p => p.persistencia_score));
    metrics.diversidad_score = avg(profiles.map(p => p.diversidad_score));
    return { metrics, sample_size: memberIds.length };
}

// ── API ────────────────────────────────────────────────────────────────────

export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const period = opts.period || DEFAULT_PERIOD;
    const result = { ok: false, processed: 0, upserted: 0, by_scope: {},
                     period, durationMs: 0 };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getOutcomesExtDb();
        getInsightsExtDb();
        const stmts = getOutcomesStatements();
        const outDb = getOutcomesExtDb();
        const insDb = getInsightsExtDb();

        // Listar cohorts activas (todas las types, dedupe por cohort_id)
        const allCohorts = outDb.prepare(
            `SELECT * FROM cohort_definitions WHERE active = 1`
        ).all();

        // Pre-leer trayectorias previas para trend.
        const previousByCohort = new Map();
        for (const c of allCohorts) {
            try {
                const prev = stmts.listTrajectoryByCohort.all(c.cohort_id, period, 1);
                if (prev[0]) previousByCohort.set(c.cohort_id, prev[0]);
            } catch {}
        }

        const period_end = nowTs;
        const period_start = nowTs - 28 * DAY_MS;

        // FASE 1: compute puro
        const rows = [];
        for (const c of allCohorts) {
            const members = outDb.prepare(
                `SELECT user_id FROM cohort_memberships WHERE cohort_id = ? AND left_at IS NULL`
            ).all(c.cohort_id).map(r => r.user_id);
            const agg = aggregateMembers(members, insDb);
            if (agg.sample_size === 0) {
                // Cohort vacía: skip, no es error.
                continue;
            }

            // Trend vs trajectoria previa (si existe)
            const trend = {};
            const prev = previousByCohort.get(c.cohort_id);
            const prevMetrics = prev ? safeJsonParse(prev.metrics_json, {}) : null;
            for (const k of Object.keys(agg.metrics)) {
                trend[k] = trendOf(agg.metrics[k], prevMetrics?.[k]);
            }

            rows.push({
                trajectory_id: `traj_${c.cohort_id}_${period}_${period_end}`,
                cohort_id: c.cohort_id,
                period, period_start, period_end,
                metrics_json: JSON.stringify(agg.metrics),
                trend_json:   JSON.stringify(trend),
                confidence:   Math.min(1, agg.sample_size / 30),  // ~30 users = high
                sample_size:  agg.sample_size,
                created_at:   nowTs,
            });
            result.by_scope[c.cohort_type] = (result.by_scope[c.cohort_type] || 0) + 1;
        }

        // FASE 2: tx UPSERT
        const tx = outDb.transaction(() => {
            for (const r of rows) {
                stmts.upsertTrajectory.run(r);
                result.upserted++;
            }
        });
        tx();
        try { for (const k of Object.keys(result.by_scope)) trajectoriesComputed.labels(k).inc(result.by_scope[k]); } catch {}
        result.processed = allCohorts.length;
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[trajectoryAnalyzer] error: ${result.error}`);
    }
    result.durationMs = Date.now() - t0;
    return result;
}

function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
}

export function getStatus() {
    try {
        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        return {
            engine: 'aula_viva_trajectory_v1',
            enabled: ENABLED(),
            trajectories_total: stmts.countTrajectories.get().n,
            ok: true,
        };
    } catch (e) { return { ok: false, engine: 'aula_viva_trajectory_v1', error: String(e?.message || e) }; }
}
