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
 *          (scope CIS 'user' + experience_insights — CHP-AULA-VIVA-MOOK-INTEGRATION-01A)
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
// CHP-AULA-VIVA-MOOK-INTEGRATION-01A — autorización de scope vigente (CIS).
import { requireScopeAccess, evaluateScopeAccess } from './scopeAccess.mjs';
// CHP-SEC-AUTHZ-AULA-VIVA-OPERATIONAL-SCOPE-01 — rol del principal, del CIS.
import { getPrincipal, IdentityUnavailableError } from '../identity/cis.mjs';
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

// ── CHP-AULA-VIVA-MOOK-INTEGRATION-01A ──────────────────────────────────────
// Las cinco proyecciones canónicas de Experiencias ya viven en signal_snapshots
// (scope_type='user') y llegan en `signals_current`. Aquí solo se PRESENTAN con
// un contrato explícito: `total` = metric_value vigente de la ventana,
// `by_version` = metadata_json.by_version tal cual (sin mezclar versiones).
// Sin fila → null ("Sin datos"). metadata_json inválido → by_version null,
// nunca un desglose inventado. Cero lecturas adicionales, cero escrituras.
const EXPERIENCE_SIGNAL_IDS = Object.freeze([
    'experiencias_iniciadas',
    'nodos_requeridos_completados',
    'experiencias_completadas',
    'evidencias_enviadas',
    'revisiones_realizadas',
]);

function projectExperienceInsights(signalsCurrent) {
    const byId = new Map();
    for (const s of Array.isArray(signalsCurrent) ? signalsCurrent : []) {
        if (s && typeof s.signal_id === 'string') byId.set(s.signal_id, s);
    }
    const out = {};
    for (const sid of EXPERIENCE_SIGNAL_IDS) {
        const s = byId.get(sid);
        if (!s) { out[sid] = null; continue; }
        const total = (typeof s.metric_value === 'number' && Number.isFinite(s.metric_value))
            ? s.metric_value : null;
        const meta = (s.meta && typeof s.meta === 'object' && !Array.isArray(s.meta)) ? s.meta : null;
        const raw = meta ? meta.by_version : undefined;
        let by_version = null;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            by_version = {};
            for (const [version, n] of Object.entries(raw)) {
                if (typeof n === 'number' && Number.isFinite(n)) by_version[version] = n;
            }
        }
        out[sid] = { total, by_version, updated_at: s.updated_at ?? null };
    }
    return out;
}

function safeJson(res, fn, fallbackBody = null) {
    try {
        const out = fn();
        res.json(out);
    } catch (e) {
        // Recovery-first: NUNCA 500 al cliente. UI verá fallback + banner.
        res.status(200).json(fallbackBody ?? { stale: true, reason: 'engine_unavailable', error: String(e?.message || e) });
    }
}

// ── CHP-SEC-AUTHZ-AULA-VIVA-OPERATIONAL-SCOPE-01 ────────────────────────────
// Hasta esta unidad solo `/students/:userId/timeline` comprobaba alcance: el
// resto del router exigía únicamente sesión, así que un mediador (y por código
// también un lector) leía cohortes, vectores de rasgos o recomendaciones de
// OTRA institución, y podía mutarlas. Contrato:
//   - Aula Viva operacional NO es superficie de lector: solo mediador o
//     administrador de plataforma (rol resuelto por el CIS, nunca por el cliente);
//   - cada ruta con sujeto/grupo/scope lo autoriza el CIS (`requireScopeAccess`
//     / `evaluateScopeAccess`) ANTES de leer o mutar;
//   - agregados globales sin consumidor (resumen de recomendaciones, job ledger)
//     quedan para el administrador;
//   - identidad indisponible → 503, jamás allow ni deny silencioso.
// Sin autoridad nueva: rol y alcance salen del mismo CIS que usa /timeline.

const callerIdOf = (req) => req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];

/** Rol operacional del principal: 'admin' | 'mediator'; null si ya respondió. */
function operationalRoleOf(req, res) {
    let p;
    try {
        p = getPrincipal(String(callerIdOf(req) ?? ''));
    } catch (e) {
        if (!(e instanceof IdentityUnavailableError)) throw e;
        res.status(503).json({ ok: false, error: 'identity_unavailable', cause: e.causeTag });
        return null;
    }
    if (!p) { res.status(401).json({ ok: false, error: 'identity_not_established' }); return null; }
    if (p.platformAdmin) return 'admin';
    if (p.mediatorRole) return 'mediator';
    res.status(403).json({ ok: false, error: 'operational_role_required' });
    return null;
}

/** Middleware: mediador o administrador. Deja el rol en `req.aulaVivaRole`. */
function requireOperationalRole(req, res, next) {
    const role = operationalRoleOf(req, res);
    if (!role) return undefined;
    req.aulaVivaRole = role;
    return next();
}

/** Middleware: solo administrador de plataforma. */
function requireOperationalAdmin(req, res, next) {
    const role = operationalRoleOf(req, res);
    if (!role) return undefined;
    if (role !== 'admin') return res.status(403).json({ ok: false, error: 'admin_required' });
    req.aulaVivaRole = role;
    return next();
}

/**
 * Autoriza un scope DERIVADO del store (el de una recomendación o una
 * intervención), no aportado por el cliente. A diferencia de
 * `requireScopeAccess`, el 403 no devuelve el scope: sería revelar a quién
 * pertenece un id ajeno. Un id inexistente se trata igual (sin oráculo),
 * salvo para el administrador, que conserva el contrato previo.
 */
function allowDerivedScope(req, res, target) {
    if (!target) {
        if (req.aulaVivaRole === 'admin') return true;
        res.status(403).json({ ok: false, error: 'scope_access_denied' });
        return false;
    }
    const d = evaluateScopeAccess(callerIdOf(req), target.scope_type, target.scope_id);
    if (d.decision === 'allow') return true;
    if (d.decision === 'unavailable') {
        res.status(503).json({ ok: false, error: 'identity_unavailable', cause: d.cause });
        return false;
    }
    if (d.decision === 'unauthenticated') {
        res.status(401).json({ ok: false, error: 'identity_not_established' });
        return false;
    }
    res.status(403).json({ ok: false, error: 'scope_access_denied' });
    return false;
}

/**
 * CHP-SEC-AUTHZ-AULA-VIVA-AGGREGATE-SCOPE-02 — como `requireScopeAccess`, pero
 * sin agregados interinstitucionales para quien no es administrador. El CIS
 * concede al mediador los agregados anónimos (`all`, cohortes tipadas) por la
 * política `mediator_aggregate_read`; en el Centro operativo el mediador solo
 * ve métricas de sus scopes legítimos, así que ese permiso aquí es 403. La
 * decisión sigue siendo del CIS: solo se lee por qué vía concedió.
 */
function requireTenantScope(scopeType, scopeId, req, res) {
    const d = evaluateScopeAccess(callerIdOf(req), scopeType, scopeId);
    if (d.decision === 'allow') {
        if (d.via === 'policy:mediator_aggregate_read' && req.aulaVivaRole !== 'admin') {
            res.status(403).json({ ok: false, error: 'scope_access_denied', scope_type: scopeType, scope_id: scopeId });
            return false;
        }
        return true;
    }
    if (d.decision === 'unavailable') {
        res.status(503).json({ ok: false, error: 'identity_unavailable', cause: d.cause });
        return false;
    }
    if (d.decision === 'unauthenticated') {
        res.status(401).json({ ok: false, error: 'identity_not_established' });
        return false;
    }
    res.status(403).json({ ok: false, error: 'scope_access_denied', scope_type: scopeType, scope_id: scopeId });
    return false;
}

/** Scope de una recomendación según el store, o null si no existe. */
function recommendationScopeOf(recommendationId) {
    return getPedagogyExtDb().prepare(
        'SELECT scope_type, scope_id FROM pedagogical_recommendations WHERE recommendation_id = ?'
    ).get(String(recommendationId)) ?? null;
}

/**
 * Mismo conteo que `getActiveRecommendationsSummary` (acknowledged = 0 por
 * severidad), restringido a los scopes que el CIS concede al principal.
 */
function scopedRecommendationsSummary(callerId) {
    const rows = getPedagogyExtDb().prepare(
        `SELECT scope_type, scope_id, severity, COUNT(*) AS n
         FROM pedagogical_recommendations WHERE acknowledged = 0
         GROUP BY scope_type, scope_id, severity`
    ).all();
    const summary = { critical: 0, high: 0, moderate: 0, info: 0 };
    for (const r of rows) {
        if (evaluateScopeAccess(callerId, r.scope_type, r.scope_id).decision !== 'allow') continue;
        if (r.severity in summary) summary[r.severity] += r.n;
    }
    return summary;
}

/**
 * Crea el router. Se reciben los middleware de auth por inyección desde
 * server.js para evitar acoplamiento del módulo a los closures internos.
 */
export function createOperationalRouter({ requireUserAuth }) {
    const router = express.Router();

    // CHP-AULA-VIVA-CANONICAL-PRINCIPAL-01A: en los 5 sitios de este router el
    // principal sale de la identidad que requireUserAuth ya estableció
    // (req.auth?.userId ?? req.user?.id), con el header x-user-id solo como claim
    // legacy_asserted de respaldo (CHP-ADR-01 §G.13). Ninguna decisión de identidad
    // se toma leyendo una cabecera directamente, y body/query/params no amplían el
    // alcance. Misma precedencia que scopeAccess.requireScopeAccess y reqUserId.

    // ── STUDENT scope ────────────────────────────────────────────────────
    router.get('/students/:userId/timeline', requireUserAuth, requireOperationalRole, (req, res) => {
        // CHP-AULA-VIVA-MOOK-INTEGRATION-01A: el servidor decide los sujetos
        // visibles con la autorización vigente de Aula Viva (CIS): admin global,
        // mediador solo sobre miembros de sus grupos activos, lector solo sí
        // mismo. 401/403/503 según la taxonomía fail-closed existente.
        if (!requireScopeAccess('user', req.params.userId, req, res)) return;
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
            // CHP-AULA-VIVA-MOOK-INTEGRATION-01A — aditivo; campos previos intactos.
            try {
                payload.experience_insights = projectExperienceInsights(payload.signals_current);
            } catch {
                payload.experience_insights = projectExperienceInsights([]);
            }
            // Fase 3B — audit emit (flag OFF default → no-op). Fire-and-forget.
            try {
                emitTeacherViewedStudent({
                    callerId:  req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'],
                    studentId: req.params.userId,
                });
            } catch { /* nunca bloquea el response */ }
            res.json(payload);
        });
    });

    router.get('/students/:userId/feature-vector', requireUserAuth, requireOperationalRole, (req, res) => {
        if (!requireScopeAccess('user', req.params.userId, req, res)) return;
        safeJson(res, () => reader.getLatestFeatureVector(req.params.userId)
            ?? { user_id: req.params.userId, features: null, stale: true });
    });

    router.get('/students/:userId/risk-history', requireUserAuth, requireOperationalRole, (req, res) => {
        if (!requireScopeAccess('user', req.params.userId, req, res)) return;
        const limit = Math.min(200, Number(req.query.limit) || 50);
        safeJson(res, () => reader.getRiskHistory(req.params.userId, { limit }), []);
    });

    router.get('/students/:userId/signals/:signalId/timeline', requireUserAuth, requireOperationalRole, (req, res) => {
        if (!requireScopeAccess('user', req.params.userId, req, res)) return;
        const sinceTs = Number(req.query.sinceTs) || (Date.now() - 90 * 86_400_000);
        safeJson(res, () => reader.getSignalTimeline('user', req.params.userId,
            req.params.signalId, sinceTs), []);
    });

    // ── RECOMMENDATIONS ──────────────────────────────────────────────────
    // Resumen GLOBAL (todas las instituciones) y sin consumidor en la UI → admin.
    router.get('/recommendations', requireUserAuth, requireOperationalAdmin, (req, res) => {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        const severity = req.query.severity;  // critical|high|moderate|info
        safeJson(res, () => {
            const summary = reader.getActiveRecommendationsSummary();
            return { summary, total: Object.values(summary || {}).reduce((a, b) => a + b, 0) };
        }, { summary: { critical: 0, high: 0, moderate: 0, info: 0 }, total: 0 });
    });

    router.get('/recommendations/scope/:type/:id', requireUserAuth, requireOperationalRole, (req, res) => {
        if (!requireTenantScope(req.params.type, req.params.id, req, res)) return;
        safeJson(res, () => reader.getRecommendations(req.params.type, req.params.id,
            { includeAcknowledged: req.query.includeAcknowledged === '1',
              limit: Math.min(200, Number(req.query.limit) || 50) }), []);
    });

    router.post('/recommendations/:recId/ack', requireUserAuth, requireOperationalRole, express.json(), (req, res) => {
        try {
            // El scope es el de la recomendación en el store, decidido ANTES de mutar.
            if (!allowDerivedScope(req, res, recommendationScopeOf(req.params.recId))) return;
            const userId = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];
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

    router.post('/recommendations/:recId/dismiss', requireUserAuth, requireOperationalRole, express.json(), (req, res) => {
        try {
            if (!allowDerivedScope(req, res, recommendationScopeOf(req.params.recId))) return;
            const userId = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];
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
    router.post('/interventions', requireUserAuth, requireOperationalRole, express.json(), (req, res) => {
        try {
            const teacherId = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];
            const { studentId, interventionType, notes, recommendationOrigin } = req.body || {};
            if (!studentId || !interventionType) {
                return res.status(400).json({ ok: false, error: 'studentId+interventionType required' });
            }
            if (!requireScopeAccess('user', String(studentId), req, res)) return;
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

    router.patch('/interventions/:id/outcome', requireUserAuth, requireOperationalRole, express.json(), (req, res) => {
        try {
            const { outcome } = req.body || {};
            if (!['improved', 'no_change', 'worsened', 'pending'].includes(outcome)) {
                return res.status(400).json({ ok: false, error: 'invalid_outcome' });
            }
            const db = getPedagogyExtDb();
            // El sujeto es el alumno de la intervención, decidido ANTES de mutar.
            const row = db.prepare(
                'SELECT student_id FROM pedagogical_interventions WHERE intervention_id = ?'
            ).get(req.params.id);
            if (!allowDerivedScope(req, res, row ? { scope_type: 'user', scope_id: row.student_id } : null)) return;
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
    router.get('/cohorts/:scope_type/:scope_id', requireUserAuth, requireOperationalRole, (req, res) => {
        // Alcance ANTES del audit: una consulta denegada no deja rastro.
        if (!requireTenantScope(req.params.scope_type, req.params.scope_id, req, res)) return;
        instrument('aulaViva.cohort_comparison', () => {
            try { cohortRenderMs.observe(0); } catch {}
            try { dashboardViewsTotal.labels('cohort_comparison').inc(); } catch {}
            // Fase 3B — audit cohort review. Fire-and-forget.
            try {
                emitMediatorReviewedCohort({
                    callerId:  req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'],
                    scopeType: req.params.scope_type,
                    scopeId:   req.params.scope_id,
                });
            } catch { /* nunca bloquea */ }
            safeJson(res, () => reader.getCohortComparison(
                req.params.scope_type, req.params.scope_id,
                { period: req.query.period || '28d',
                  // Mediador: sin baseline interinstitucional (ni se lee).
                  includeGlobal: req.aulaVivaRole === 'admin' }
            ));
        });
    });

    router.get('/cohorts/:scope_type/:scope_id/rollups', requireUserAuth, requireOperationalRole, (req, res) => {
        if (!requireTenantScope(req.params.scope_type, req.params.scope_id, req, res)) return;
        const sinceTs = Number(req.query.sinceTs) || (Date.now() - 90 * 86_400_000);
        safeJson(res, () => ({
            daily:   reader.getDailyRollups(req.params.scope_type, req.params.scope_id, sinceTs),
            weekly:  reader.getWeeklyRollups(req.params.scope_type, req.params.scope_id, sinceTs),
            monthly: reader.getMonthlyRollups(req.params.scope_type, req.params.scope_id, sinceTs),
        }), { daily: [], weekly: [], monthly: [] });
    });

    // ── ATTENTION QUEUE (corazón del panel docente §7) ───────────────────
    router.get('/students-needing-attention', requireUserAuth, requireOperationalRole, (req, res) => {
        try { dashboardViewsTotal.labels('attention_queue').inc(); } catch {}
        // Mediador: solo sujetos que el CIS le concede (miembros de sus grupos
        // activos). Administrador: la cola global de siempre. La deuda del
        // filtro por riesgo (ATTENTION_ENDPOINT_RISK_ZERO) NO se toca aquí.
        const callerId = callerIdOf(req);
        let unavailable = null;
        const inScope = (userId) => {
            if (req.aulaVivaRole === 'admin') return true;
            const d = evaluateScopeAccess(callerId, 'user', userId);
            if (d.decision === 'unavailable') unavailable = d.cause ?? 'unavailable';
            return d.decision === 'allow';
        };
        let queue = null;
        try { queue = buildAttentionQueue(inScope); } catch { queue = null; }
        if (unavailable) return res.status(503).json({ ok: false, error: 'identity_unavailable', cause: unavailable });
        safeJson(res, () => {
            if (queue === null) throw new Error('engine_unavailable');
            return queue;
        }, []);
    });

    function buildAttentionQueue(inScope) {
        {
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
            for (const p of profiles.filter(x => inScope(x.user_id))) {
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
        }
    }

    // ── JOB LEDGER / OPERATIONAL STATUS ─────────────────────────────────
    // Ledger técnico global y sin consumidor en la UI → administrador.
    router.get('/job-ledger', requireUserAuth, requireOperationalAdmin, (req, res) => {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        safeJson(res, () => reader.getJobLedger({ limit }), []);
    });

    router.get('/operational/status', requireUserAuth, requireOperationalRole, (req, res) => {
        try { dashboardViewsTotal.labels('operational_status').inc(); } catch {}
        safeJson(res, () => {
            // El resumen de recomendaciones abarca TODAS las instituciones: al
            // mediador solo se le cuentan las de scopes que el CIS le concede.
            const recsSummary = req.aulaVivaRole === 'admin'
                ? reader.getActiveRecommendationsSummary()
                : scopedRecommendationsSummary(callerIdOf(req));
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
    router.post('/_track/empty-state', requireUserAuth, requireOperationalRole, express.json(), (req, res) => {
        try {
            const where = String(req.body?.where || 'unknown').slice(0, 50);
            emptyStateRenderTotal.labels(where).inc();
        } catch {}
        res.json({ ok: true });
    });

    router.post('/_track/degraded-mode', requireUserAuth, requireOperationalRole, express.json(), (req, res) => {
        try {
            const reason = String(req.body?.reason || 'unknown').slice(0, 50);
            uiDegradedModeTotal.labels(reason).inc();
        } catch {}
        res.json({ ok: true });
    });

    return router;
}
