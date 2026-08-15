/**
 * operationalRouter.mjs — Aula Viva PASO 5.
 *
 * Express Router auto-contenido que expone los read APIs construidos en
 * PASO 2-4 + el workflow humano §8 (acknowledge / apply / register
 * intervention / close intervention).
 *
 * Patrón de auth: reutiliza `requireAuth` y `requireUserAuth` que server.js
 * pasa como factory args para NO acoplar a `require`/import path.
 *
 * Recovery-first: cada endpoint envuelve el reader con try/catch y devuelve
 * 200 con `{stale:true, reason:'engine_unavailable'}` si las extensiones
 * PASO 2-4 no están inicializadas (p.ej. en tests aislados). Esto evita que
 * la UI vea 500s — el banner degraded se encarga de mostrarlo.
 *
 * Endpoints (todos GET son `requireUserAuth`; mutaciones son `requireUserAuth`
 * más validación adicional dentro):
 *
 *   GET    /students/:userId/timeline                 → reader.getProfileTimeline
 *   GET    /students/:userId/feature-vector           → reader.getLatestFeatureVector
 *   GET    /students/:userId/risk-history             → reader.getRiskHistory
 *   GET    /students/:userId/signals/:signalId/timeline (history append-only)
 *   GET    /recommendations                           → activas paginadas
 *   GET    /recommendations/scope/:type/:id           → por scope
 *   POST   /recommendations/:recId/ack                → marcar vista
 *   POST   /recommendations/:recId/apply              → marcar aplicada
 *   POST   /interventions                             → registrar
 *   PATCH  /interventions/:id/outcome                 → cerrar (outcome)
 *   GET    /cohorts/:scope_type/:scope_id             → comparativa scope vs global
 *   GET    /cohorts/:scope_type/:scope_id/rollups     → daily+weekly+monthly
 *   GET    /students-needing-attention                → ranked list (severity DESC)
 *   GET    /job-ledger                                → últimos N runs
 *   GET    /operational/status                        → resumen agregado para UI
 */
import express from 'express';
import * as reader from '../services/insightReader.mjs';
import * as intervention from '../services/interventionEngine.mjs';
import { getInsightsExtDb } from '../db/insightsDbExt.mjs';
import { getPedagogyExtDb } from '../db/pedagogyDbExt.mjs';
import {
    dashboardViewsTotal, recommendationAcceptTotal, recommendationDismissTotal,
    interventionClosedTotal, uiDegradedModeTotal, emptyStateRenderTotal,
    cohortRenderMs, studentTimelineRenderMs,
} from '../observability/metrics.js';
import { instrument } from '../services/queryProfiler.mjs';
// Fase 3A — summary engine determinístico. Gated por
// AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED (default OFF).
import { generateLongitudinalSummaries } from '../services/longitudinalSummary.mjs';
// Fase 3B — audit emitter institucional. Gated por
// AULA_VIVA_AUDIT_EVENTS_ENABLED (default OFF). Fire-and-forget defensivo.
import {
    emitTeacherViewedStudent,
    emitTeacherReviewedRecommendation,
    emitTeacherCreatedIntervention,
    emitMediatorReviewedCohort,
} from '../services/aulaVivaAuditEmitter.mjs';

function safeJson(res, fn, fallbackBody = null) {
    try {
        const out = fn();
        res.json(out);
    } catch (e) {
        // Recovery-first: NUNCA 500 al cliente. UI verá fallback + banner.
        res.status(200).json(fallbackBody ?? { stale: true, reason: 'engine_unavailable', error: String(e?.message || e) });
    }
}

/**
 * Crea el router. Se reciben los middleware de auth por inyección desde
 * server.js para evitar acoplamiento del módulo a los closures internos.
 */
export function createOperationalRouter({ requireUserAuth, studentTenantGuard }) {
    const router = express.Router();
    // CHP-IDDB-M1-B: guard de scope de estudiante inyectado por server.js. Default
    // no-op (compat con tests que no lo inyectan / modo 'off').
    const studentGuard = typeof studentTenantGuard === 'function' ? studentTenantGuard : (req, res, next) => next();

    // ── STUDENT scope ────────────────────────────────────────────────────
    router.get('/students/:userId/timeline', requireUserAuth, studentGuard, (req, res) => {
        instrument('aulaViva.student_timeline', () => {
            const data = reader.getProfileTimeline(req.params.userId);
            try { studentTimelineRenderMs.observe(0); } catch {}
            try { dashboardViewsTotal.labels('student_timeline').inc(); } catch {}
            const payload = data ?? { user_id: req.params.userId, profile_current: null,
                signals_current: [], risks: [], recommendations: [],
                stale: true, reason: 'no_data_yet' };
            // Fase 3A — agrega summaries determinísticos. Defensivo: cualquier
            // fallo del engine deja summaries=[] sin romper el resto del payload.
            try {
                payload.summaries = generateLongitudinalSummaries(payload);
            } catch {
                payload.summaries = [];
            }
            // Fase 3B — audit emit (flag OFF default → no-op). Fire-and-forget.
            try {
                emitTeacherViewedStudent({
                    callerId:  req.headers['x-user-id'],
                    studentId: req.params.userId,
                });
            } catch { /* nunca bloquea el response */ }
            res.json(payload);
        });
    });

    router.get('/students/:userId/feature-vector', requireUserAuth, studentGuard, (req, res) => {
        safeJson(res, () => reader.getLatestFeatureVector(req.params.userId)
            ?? { user_id: req.params.userId, features: null, stale: true });
    });

    router.get('/students/:userId/risk-history', requireUserAuth, studentGuard, (req, res) => {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        safeJson(res, () => reader.getRiskHistory(req.params.userId, { limit }), []);
    });

    router.get('/students/:userId/signals/:signalId/timeline', requireUserAuth, studentGuard, (req, res) => {
        const sinceTs = Number(req.query.sinceTs) || (Date.now() - 90 * 86_400_000);
        safeJson(res, () => reader.getSignalTimeline('user', req.params.userId,
            req.params.signalId, sinceTs), []);
    });

    // ── RECOMMENDATIONS ──────────────────────────────────────────────────
    router.get('/recommendations', requireUserAuth, (req, res) => {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        const severity = req.query.severity;  // critical|high|moderate|info
        safeJson(res, () => {
            const summary = reader.getActiveRecommendationsSummary();
            return { summary, total: Object.values(summary || {}).reduce((a, b) => a + b, 0) };
        }, { summary: { critical: 0, high: 0, moderate: 0, info: 0 }, total: 0 });
    });

    router.get('/recommendations/scope/:type/:id', requireUserAuth, (req, res) => {
        safeJson(res, () => reader.getRecommendations(req.params.type, req.params.id,
            { includeAcknowledged: req.query.includeAcknowledged === '1',
              limit: Math.min(200, Number(req.query.limit) || 50) }), []);
    });

    router.post('/recommendations/:recId/ack', requireUserAuth, express.json(), (req, res) => {
        try {
            const userId = req.headers['x-user-id'];
            const r = intervention.acknowledgeRecommendation({
                recommendationId: req.params.recId,
                by: userId, applied: !!req.body?.applied,
            });
            if (r?.ok && r?.acknowledged) {
                try { recommendationAcceptTotal.inc(); } catch {}
            }
            // Fase 3B — audit: accepted=true (ack/apply).
            try {
                emitTeacherReviewedRecommendation({
                    callerId: userId,
                    recommendationId: req.params.recId,
                    accepted: true,
                });
            } catch { /* nunca bloquea */ }
            res.json(r);
        } catch (e) {
            res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    router.post('/recommendations/:recId/dismiss', requireUserAuth, express.json(), (req, res) => {
        try {
            const userId = req.headers['x-user-id'];
            const r = intervention.acknowledgeRecommendation({
                recommendationId: req.params.recId,
                by: userId, applied: false,
            });
            if (r?.ok && r?.acknowledged) {
                try { recommendationDismissTotal.inc(); } catch {}
            }
            // Fase 3B — audit: accepted=false (dismiss).
            try {
                emitTeacherReviewedRecommendation({
                    callerId: userId,
                    recommendationId: req.params.recId,
                    accepted: false,
                });
            } catch { /* nunca bloquea */ }
            res.json(r);
        } catch (e) {
            res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    // ── INTERVENTIONS ────────────────────────────────────────────────────
    router.post('/interventions', requireUserAuth, express.json(), (req, res) => {
        try {
            const teacherId = req.headers['x-user-id'];
            const { studentId, interventionType, notes, recommendationOrigin } = req.body || {};
            if (!studentId || !interventionType) {
                return res.status(400).json({ ok: false, error: 'studentId+interventionType required' });
            }
            const r = intervention.recordIntervention({
                teacherId, studentId, interventionType,
                notes: notes ?? null,
                recommendationOrigin: recommendationOrigin ?? null,
            });
            // Fase 3B — audit. La nota libre NO se incluye en el payload (PII).
            try {
                emitTeacherCreatedIntervention({
                    callerId:         teacherId,
                    studentId,
                    interventionType,
                });
            } catch { /* nunca bloquea */ }
            res.json(r);
        } catch (e) {
            res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    router.patch('/interventions/:id/outcome', requireUserAuth, express.json(), (req, res) => {
        try {
            const { outcome } = req.body || {};
            if (!['improved', 'no_change', 'worsened', 'pending'].includes(outcome)) {
                return res.status(400).json({ ok: false, error: 'invalid_outcome' });
            }
            const db = getPedagogyExtDb();
            const upd = db.prepare(
                `UPDATE pedagogical_interventions
                 SET outcome = ?, outcome_at = ?
                 WHERE intervention_id = ?`
            ).run(outcome, Date.now(), req.params.id);
            if (upd.changes > 0 && outcome !== 'pending') {
                try { interventionClosedTotal.labels(outcome).inc(); } catch {}
            }
            res.json({ ok: true, updated: upd.changes });
        } catch (e) {
            res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    // ── COHORTS ──────────────────────────────────────────────────────────
    router.get('/cohorts/:scope_type/:scope_id', requireUserAuth, (req, res) => {
        instrument('aulaViva.cohort_comparison', () => {
            try { cohortRenderMs.observe(0); } catch {}
            try { dashboardViewsTotal.labels('cohort_comparison').inc(); } catch {}
            // Fase 3B — audit cohort review. Fire-and-forget.
            try {
                emitMediatorReviewedCohort({
                    callerId:  req.headers['x-user-id'],
                    scopeType: req.params.scope_type,
                    scopeId:   req.params.scope_id,
                });
            } catch { /* nunca bloquea */ }
            safeJson(res, () => reader.getCohortComparison(
                req.params.scope_type, req.params.scope_id,
                { period: req.query.period || '28d' }
            ));
        });
    });

    router.get('/cohorts/:scope_type/:scope_id/rollups', requireUserAuth, (req, res) => {
        const sinceTs = Number(req.query.sinceTs) || (Date.now() - 90 * 86_400_000);
        safeJson(res, () => ({
            daily:   reader.getDailyRollups(req.params.scope_type, req.params.scope_id, sinceTs),
            weekly:  reader.getWeeklyRollups(req.params.scope_type, req.params.scope_id, sinceTs),
            monthly: reader.getMonthlyRollups(req.params.scope_type, req.params.scope_id, sinceTs),
        }), { daily: [], weekly: [], monthly: [] });
    });

    // ── ATTENTION QUEUE (corazón del panel docente §7) ───────────────────
    router.get('/students-needing-attention', requireUserAuth, (req, res) => {
        try { dashboardViewsTotal.labels('attention_queue').inc(); } catch {}
        safeJson(res, () => {
            // Estrategia: profiles con abandono_risk >= 0.5 ordenados DESC,
            // luego recomendaciones críticas/altas activas (top severity).
            const insightsDb = getInsightsExtDb();
            const profiles = insightsDb.prepare(
                `SELECT user_id, abandono_risk, last_active_at, engagement_score, updated_at
                 FROM user_reading_profiles
                 WHERE abandono_risk IS NOT NULL
                 ORDER BY abandono_risk DESC
                 LIMIT 100`
            ).all();
            // Enriquecer con recomendaciones activas top
            const out = [];
            for (const p of profiles) {
                const recs = reader.getRecommendations('user', p.user_id, { limit: 3 });
                const topSev = recs[0]?.severity || null;
                out.push({
                    user_id: p.user_id,
                    abandono_risk: p.abandono_risk,
                    last_active_at: p.last_active_at,
                    engagement_score: p.engagement_score,
                    top_severity: topSev,
                    recommendations_count: recs.length,
                    days_since_active: p.last_active_at
                        ? Math.floor((Date.now() - p.last_active_at) / 86_400_000)
                        : null,
                });
            }
            // Re-ordenar: critical/high primero por count, después abandono_risk
            const sevRank = { critical: 0, high: 1, moderate: 2, info: 3, null: 4 };
            out.sort((a, b) =>
                (sevRank[a.top_severity] ?? 4) - (sevRank[b.top_severity] ?? 4)
                || b.abandono_risk - a.abandono_risk);
            return out.slice(0, 50);
        }, []);
    });

    // ── JOB LEDGER / OPERATIONAL STATUS ─────────────────────────────────
    router.get('/job-ledger', requireUserAuth, (req, res) => {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        safeJson(res, () => reader.getJobLedger({ limit }), []);
    });

    router.get('/operational/status', requireUserAuth, (req, res) => {
        try { dashboardViewsTotal.labels('operational_status').inc(); } catch {}
        safeJson(res, () => {
            const recsSummary = reader.getActiveRecommendationsSummary();
            const isMatReady = reader.isReady();
            const ledger = reader.getJobLedger({ limit: 5 });
            return {
                ts: Date.now(),
                recommendations_summary: recsSummary,
                materializer_ready: isMatReady,
                recent_jobs: ledger,
                degraded: !isMatReady?.ready || ledger.some(j => j.status === 'failed' || j.status === 'stalled'),
            };
        }, { ts: Date.now(), recommendations_summary: { critical: 0, high: 0, moderate: 0, info: 0 },
             materializer_ready: { ready: false, reason: 'engine_unavailable' },
             recent_jobs: [], degraded: true });
    });

    // ── EMPTY STATE TRACKING (UI llama al render para métrica) ──────────
    router.post('/_track/empty-state', requireUserAuth, express.json(), (req, res) => {
        try {
            const where = String(req.body?.where || 'unknown').slice(0, 50);
            emptyStateRenderTotal.labels(where).inc();
        } catch {}
        res.json({ ok: true });
    });

    router.post('/_track/degraded-mode', requireUserAuth, express.json(), (req, res) => {
        try {
            const reason = String(req.body?.reason || 'unknown').slice(0, 50);
            uiDegradedModeTotal.labels(reason).inc();
        } catch {}
        res.json({ ok: true });
    });

    return router;
}
