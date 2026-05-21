/**
 * analyticsHealth.js — handler de /api/health/analytics (separado de /ready
 * para no inflar el readiness con queries de eventos). Resumen operativo
 * de la capa analítica: events.db OK, WAL, throughput, shadow consistency,
 * write failures. Cacheado 10s, never-throws.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

let _cache = { at: 0, payload: null };
const TTL_MS = 10_000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_DB = path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');
const ARCHIVE_DB = path.resolve(__dirname, '..', '..', 'data-critical', 'events.archive.db');

async function safe(fn) { try { return await fn(); } catch (e) { return { ok:false, error:String(e?.message||e) }; } }

export async function analyticsHealthHandler(_req, res) {
    const now = Date.now();
    if (_cache.payload && now - _cache.at < TTL_MS) {
        return res.status(_cache.payload.status === 'ok' ? 200 : 503).json(_cache.payload);
    }
    const checks = {};
    try {
        const events = await import('../eventsService.js');
        const shadow = await import('../services/analyticsShadow.mjs');
        const registry = await import('../analytics/eventRegistry.js');

        checks.events_db = await safe(async () => {
            const present = fs.existsSync(EVENTS_DB);
            const count = present ? events.getEventCount?.() ?? null : 0;
            return { ok: present, present, count };
        });
        checks.registry = await safe(async () => ({
            ok: true, version: registry.REGISTRY_VERSION,
            event_names: registry.EVENT_NAMES.length,
            categories: registry.EVENT_CATEGORIES.length,
        }));
        // PASO 2 — materializer status (insights.db read model).
        checks.materializer = await safe(async () => {
            const m = await import('../services/insightMaterializer.mjs');
            return m.getStatus();
        });
        // PASO 3 — intervention engine status (pedagogical recs + risks).
        checks.intervention_engine = await safe(async () => {
            const m = await import('../services/interventionEngine.mjs');
            return m.getStatus();
        });
        // PASO 4 — scalability surface (rollups, replay, features, leader,
        // WAL sizes, slow queries). Cada check independiente; safe() aísla
        // fallos para que NO tumben el healthcheck completo.
        checks.rollups = await safe(async () => {
            const m = await import('../services/rollupsEngine.mjs');
            return m.getStatus();
        });
        checks.replay = await safe(async () => {
            const m = await import('../services/replayEngine.mjs');
            return m.getStatus();
        });
        checks.feature_extraction = await safe(async () => {
            const m = await import('../services/featureExtractor.mjs');
            return m.getStatus();
        });
        checks.wal_size = await safe(async () => {
            // .-wal coexiste junto al .db; size = file size si presente.
            const sizeOf = (p) => {
                try {
                    const wal = p + '-wal';
                    return fs.existsSync(wal) ? fs.statSync(wal).size : 0;
                } catch { return 0; }
            };
            const eventsDb = path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');
            const insightsDb = path.resolve(__dirname, '..', '..', 'data-critical', 'insights.db');
            const eventsWal   = sizeOf(eventsDb);
            const insightsWal = sizeOf(insightsDb);
            return {
                ok: eventsWal < 100 * 1024 * 1024 && insightsWal < 100 * 1024 * 1024,
                events_wal_bytes: eventsWal,
                insights_wal_bytes: insightsWal,
                warning: (eventsWal > 100 * 1024 * 1024 || insightsWal > 100 * 1024 * 1024)
                    ? 'wal_oversized_force_checkpoint_recommended' : null,
            };
        });
        checks.slow_queries = await safe(async () => {
            const qp = await import('../services/queryProfiler.mjs');
            const count = qp.recentSlowCount(300);  // últimos 5 min
            return { ok: count == null || count < 50, count_5min: count };
        });
        checks.leader = await safe(async () => {
            const le = await import('../services/leaderElection.mjs');
            return {
                ok: true,
                holder_id: le.getHolderId(),
                locks: {
                    materializer: le.getLockInfo('materializer'),
                    intervention: le.getLockInfo('intervention'),
                    rollup:       le.getLockInfo('rollup'),
                },
            };
        });
        // PASO 5 §23 — operational surface.
        checks.scheduler = await safe(async () => {
            const s = await import('../aulaViva/scheduler.mjs');
            return s.getStatus();
        });
        checks.archive_rotation = await safe(async () => {
            const a = await import('../aulaViva/archiveRotation.mjs');
            return a.getStatus();
        });
        // PASO 6 §21 — outcomes / cohorts / trajectories / learnings / patterns.
        checks.outcome_engine = await safe(async () => {
            const m = await import('../services/outcomeEngine.mjs');
            return m.getStatus();
        });
        checks.cohort_builder = await safe(async () => {
            const m = await import('../services/cohortBuilder.mjs');
            return m.getStatus();
        });
        checks.trajectory_analyzer = await safe(async () => {
            const m = await import('../services/trajectoryAnalyzer.mjs');
            return m.getStatus();
        });
        checks.institutional_learning = await safe(async () => {
            const m = await import('../services/institutionalLearning.mjs');
            return m.getStatus();
        });
        checks.predictive_patterns = await safe(async () => {
            const m = await import('../services/predictivePatterns.mjs');
            return m.getStatus();
        });
        // PASO 7 §20 — API institucional agregado. Refleja salud del router
        // y staleness de datos UI (basado en outcomes / cohorts / trajectories).
        checks.institutional_api = await safe(async () => {
            const ext = await import('../db/outcomesDbExt.mjs');
            const db = ext.getOutcomesExtDb();
            const stmts = ext.getOutcomesStatements();
            const lastTraj = db.prepare(
                `SELECT MAX(created_at) AS ts FROM cohort_trajectories`
            ).get();
            const lastOutcome = db.prepare(
                `SELECT MAX(created_at) AS ts FROM intervention_outcomes`
            ).get();
            const lastLearning = db.prepare(
                `SELECT MAX(updated_at) AS ts FROM institutional_learnings WHERE active=1`
            ).get();
            const now = Date.now();
            const stalenessHours = (ts) => ts ? Math.floor((now - ts) / 3600_000) : null;
            return {
                ok: true,
                outcomes_total: stmts.countOutcomes.get().n,
                cohorts_active: stmts.countCohorts.get().n,
                trajectories_total: stmts.countTrajectories.get().n,
                learnings_active: stmts.countLearnings.get().n,
                patterns_active: stmts.countPatterns.get().n,
                staleness_hours: {
                    last_outcome: stalenessHours(lastOutcome?.ts),
                    last_trajectory: stalenessHours(lastTraj?.ts),
                    last_learning: stalenessHours(lastLearning?.ts),
                },
            };
        });
        checks.archive_db = await safe(async () => {
            const present = fs.existsSync(ARCHIVE_DB);
            let sizeMb = null;
            if (present) sizeMb = +(fs.statSync(ARCHIVE_DB).size / 1048576).toFixed(2);
            return { ok: true, present, size_mb: sizeMb };
        });
        checks.throughput = await safe(async () => shadow.throughput(5));
        checks.shadow_consistency = await safe(async () => {
            const r = shadow.divergenceReport();
            return { ok: r.ok, ...r };
        });
    } catch (e) {
        checks.bootstrap_error = { ok: false, error: e.message };
    }

    const allOk = Object.values(checks).every(c => c && c.ok !== false);
    const payload = {
        status: allOk ? 'ok' : 'degraded',
        instance: process.env.HOSTNAME || 'local',
        timestamp: new Date().toISOString(),
        checks,
    };
    _cache = { at: now, payload };
    res.status(allOk ? 200 : 503).json(payload);
}
