/**
 * institutionalRouter.mjs — Aula Viva PASO 7 §5.
 *
 * Router NUEVO mounted en /api/aula-viva (paralelo a operationalRouter
 * PASO 5; los paths usan sub-prefijo /institutional/* → cero conflicto).
 *
 * Expone los datasets PASO 6 vía REST con:
 *   - requireUserAuth (inyectado)
 *   - canAccessScope (PASO 7 §13)
 *   - recovery-first (200 + stale shape ante error)
 *   - instrument() PASO 4 para slow log + dashboard latency
 *   - métricas PASO 7 (cardinalidad fija)
 *
 * 13 endpoints:
 *
 *   GET /institutional/status
 *   GET /institutional/outcomes/by-type/:type
 *   GET /institutional/outcomes/scope/:type/:id
 *   GET /institutional/outcomes/follow-up-queue
 *   GET /institutional/cohorts/definitions
 *   GET /institutional/cohorts/by-type/:type
 *   GET /institutional/cohorts/:cohort_id/members
 *   GET /institutional/cohorts/:cohort_id/trajectory
 *   GET /institutional/learnings/scope/:type/:id
 *   GET /institutional/learnings/global
 *   GET /institutional/patterns/recent
 *   GET /institutional/comparative/strategies
 *   GET /institutional/profile/:userId
 */
import express from 'express';
import * as impact from '../services/interventionImpactTracker.mjs';
import * as learnings from '../services/institutionalLearning.mjs';
import * as patterns from '../services/predictivePatterns.mjs';
import * as cohorts from '../services/cohortBuilder.mjs';
import * as reader from '../services/insightReader.mjs';
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { instrument } from '../services/queryProfiler.mjs';
import { canAccessScope } from './scopeAccess.mjs';
import {
    outcomesViewsTotal, cohortViewsTotal, trajectoryViewsTotal,
    learningViewsTotal, comparativeQueriesTotal, scopeSwitchTotal,
    uiLatencyMs,
} from '../observability/metrics.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function safeJson(res, fn, fallback = null) {
    try {
        const out = fn();
        res.json(out);
    } catch (e) {
        res.status(200).json(fallback ?? { stale: true, reason: 'engine_unavailable',
                                            error: String(e?.message || e) });
    }
}

function parseLimit(q) {
    const n = Number(q);
    if (!isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function requireScope(req, res, scope_type, scope_id) {
    const callerId = req.headers['x-user-id'];
    if (canAccessScope(callerId, scope_type, scope_id)) return true;
    res.status(403).json({ ok: false, error: 'scope_access_denied',
                            scope_type, scope_id });
    return false;
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createInstitutionalRouter({ requireUserAuth }) {
    const router = express.Router();

    // ── /institutional/status ────────────────────────────────────────────
    router.get('/institutional/status', requireUserAuth, (req, res) => {
        instrument('institutional.status', () => {
            safeJson(res, () => {
                getOutcomesExtDb();
                const stmts = getOutcomesStatements();
                return {
                    ts: Date.now(),
                    outcomes: { total: stmts.countOutcomes.get().n,
                                by_label: Object.fromEntries(
                                    stmts.countOutcomesByLabel.all().map(r => [r.outcome_label, r.n])) },
                    cohorts: { total_active: stmts.countCohorts.get().n,
                               total_memberships: stmts.countCohortMemberships.get().n },
                    trajectories: { total: stmts.countTrajectories.get().n },
                    learnings: { total_active: stmts.countLearnings.get().n },
                    patterns: { total_active: stmts.countPatterns.get().n },
                };
            }, { ts: Date.now(), outcomes: { total: 0, by_label: {} },
                 cohorts: { total_active: 0, total_memberships: 0 },
                 trajectories: { total: 0 }, learnings: { total_active: 0 },
                 patterns: { total_active: 0 }, stale: true });
        });
    });

    // ── OUTCOMES ─────────────────────────────────────────────────────────
    router.get('/institutional/outcomes/by-type/:type', requireUserAuth, (req, res) => {
        // Vista agregada → permitir mediador/admin.
        if (!requireScope(req, res, 'all', 'global')) return;
        try { outcomesViewsTotal.labels('by_type').inc(); } catch {}
        instrument('institutional.outcomes_by_type', () => {
            safeJson(res, () => impact.getImpactByInterventionType(req.params.type));
        });
    });

    router.get('/institutional/outcomes/scope/:type/:id', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, req.params.type, req.params.id)) return;
        try { outcomesViewsTotal.labels('by_scope').inc(); } catch {}
        const limit = parseLimit(req.query.limit);
        instrument('institutional.outcomes_scope', () => {
            safeJson(res, () => impact.getImpactSummary(req.params.type, req.params.id, { limit }),
                     { scope: { type: req.params.type, id: req.params.id },
                       total_outcomes: 0, distribution: {}, outcomes: [] });
        });
    });

    router.get('/institutional/outcomes/follow-up-queue', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        try { outcomesViewsTotal.labels('followup_queue').inc(); } catch {}
        const olderThanDays = Math.max(1, Math.min(90, Number(req.query.olderThanDays) || 14));
        const limit = parseLimit(req.query.limit);
        instrument('institutional.followup_queue', () => {
            safeJson(res, () => impact.getFollowupQueue({ olderThanDays, limit }), []);
        });
    });

    // ── COHORTS ──────────────────────────────────────────────────────────
    router.get('/institutional/cohorts/definitions', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        try { cohortViewsTotal.labels('definitions').inc(); } catch {}
        instrument('institutional.cohorts_definitions', () => {
            safeJson(res, () => {
                const db = getOutcomesExtDb();
                const rows = db.prepare(
                    `SELECT * FROM cohort_definitions WHERE active = 1
                     ORDER BY cohort_type, scope_id LIMIT ?`
                ).all(parseLimit(req.query.limit));
                return rows;
            }, []);
        });
    });

    router.get('/institutional/cohorts/by-type/:type', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        try { cohortViewsTotal.labels('by_type').inc(); } catch {}
        instrument('institutional.cohorts_by_type', () => {
            safeJson(res, () => {
                const stmts = getOutcomesStatements();
                return stmts.listCohortsByType.all(req.params.type);
            }, []);
        });
    });

    router.get('/institutional/cohorts/:cohort_id/members', requireUserAuth, (req, res) => {
        // Verificar scope del cohort (necesitamos saber scope_type+scope_id antes)
        try {
            const stmts = getOutcomesStatements();
            const cohort = stmts.getCohortById.get(req.params.cohort_id);
            if (!cohort) {
                return res.status(404).json({ ok: false, error: 'cohort_not_found' });
            }
            if (!requireScope(req, res, cohort.scope_type, cohort.scope_id)) return;
            try { cohortViewsTotal.labels('members').inc(); } catch {}
            instrument('institutional.cohort_members', () => {
                const members = stmts.listMembersOfCohort.all(req.params.cohort_id);
                res.json({ cohort_id: req.params.cohort_id,
                           cohort_key: cohort.cohort_key,
                           cohort_type: cohort.cohort_type,
                           members_count: members.length,
                           members: members.slice(0, parseLimit(req.query.limit)) });
            });
        } catch (e) {
            res.status(200).json({ stale: true, error: String(e?.message || e) });
        }
    });

    router.get('/institutional/cohorts/:cohort_id/trajectory', requireUserAuth, (req, res) => {
        try {
            const stmts = getOutcomesStatements();
            const cohort = stmts.getCohortById.get(req.params.cohort_id);
            if (!cohort) {
                return res.status(404).json({ ok: false, error: 'cohort_not_found' });
            }
            if (!requireScope(req, res, cohort.scope_type, cohort.scope_id)) return;
            try { trajectoryViewsTotal.labels('cohort').inc(); } catch {}
            const period = String(req.query.period || '28d');
            const limit = parseLimit(req.query.limit);
            instrument('institutional.cohort_trajectory', () => {
                const rows = stmts.listTrajectoryByCohort.all(req.params.cohort_id, period, limit);
                const series = rows.map(r => ({
                    period_start: r.period_start, period_end: r.period_end,
                    metrics: safeJsonParse(r.metrics_json),
                    trend:   safeJsonParse(r.trend_json),
                    confidence: r.confidence, sample_size: r.sample_size,
                    created_at: r.created_at,
                }));
                res.json({ cohort_id: req.params.cohort_id, period, series });
            });
        } catch (e) {
            res.status(200).json({ stale: true, error: String(e?.message || e) });
        }
    });

    // ── INSTITUTIONAL LEARNINGS ──────────────────────────────────────────
    router.get('/institutional/learnings/scope/:type/:id', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, req.params.type, req.params.id)) return;
        try { learningViewsTotal.labels('by_scope').inc(); } catch {}
        instrument('institutional.learnings_scope', () => {
            safeJson(res, () => {
                const stmts = getOutcomesStatements();
                const rows = stmts.listLearningsByScope.all(req.params.type, req.params.id);
                return rows.map(r => ({
                    ...r, evidence: safeJsonParse(r.evidence_json),
                }));
            }, []);
        });
    });

    router.get('/institutional/learnings/global', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        try { learningViewsTotal.labels('global').inc(); } catch {}
        instrument('institutional.learnings_global', () => {
            safeJson(res, () => {
                const stmts = getOutcomesStatements();
                const rows = stmts.listLearningsByScope.all('all', 'global');
                return rows.map(r => ({
                    ...r, evidence: safeJsonParse(r.evidence_json),
                }));
            }, []);
        });
    });

    // ── PREDICTIVE PATTERNS (read-only agregado) ─────────────────────────
    router.get('/institutional/patterns/recent', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        const limit = parseLimit(req.query.limit);
        instrument('institutional.patterns_recent', () => {
            safeJson(res, () => {
                const db = getOutcomesExtDb();
                const rows = db.prepare(
                    `SELECT * FROM predictive_risk_patterns WHERE active = 1
                     ORDER BY confidence DESC, support_count DESC LIMIT ?`
                ).all(limit);
                return rows.map(r => ({
                    ...r,
                    signal_sequence: safeJsonParse(r.signal_sequence_json),
                }));
            }, []);
        });
    });

    // ── COMPARATIVE INTELLIGENCE §8 ──────────────────────────────────────
    router.get('/institutional/comparative/strategies', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        try { comparativeQueriesTotal.labels('strategies').inc(); } catch {}
        instrument('institutional.comparative_strategies', () => {
            safeJson(res, () => {
                const db = getOutcomesExtDb();
                // Distribución agregada por intervention_type — sin nombrar
                // mediadores, sin ranking individual.
                const dist = db.prepare(
                    `SELECT intervention_type, outcome_label, COUNT(*) AS n
                     FROM intervention_outcomes
                     GROUP BY intervention_type, outcome_label`
                ).all();
                // Pivot: intervention_type → {improved, stable, worsened, mixed, insufficient_data, total}
                const out = new Map();
                for (const r of dist) {
                    if (!out.has(r.intervention_type)) {
                        out.set(r.intervention_type, { intervention_type: r.intervention_type,
                                                       improved: 0, stable: 0, worsened: 0,
                                                       mixed: 0, insufficient_data: 0, total: 0 });
                    }
                    const e = out.get(r.intervention_type);
                    e[r.outcome_label] = r.n;
                    e.total += r.n;
                }
                const strategies = Array.from(out.values()).map(s => ({
                    ...s,
                    improved_ratio: s.total ? +(s.improved / s.total).toFixed(3) : null,
                    note: 'Observacional. NO implica causalidad.',
                }));
                // Orden por improved_ratio DESC, pero solo si total ≥ 5 (resto al final).
                strategies.sort((a, b) => {
                    if (a.total < 5 && b.total >= 5) return 1;
                    if (b.total < 5 && a.total >= 5) return -1;
                    return (b.improved_ratio ?? 0) - (a.improved_ratio ?? 0);
                });
                return { strategies, vocabulary_class: 'observational',
                         caveat: 'Las comparaciones reflejan patrones observados, no efectos causales.' };
            }, { strategies: [], vocabulary_class: 'observational',
                 caveat: 'no_data_yet' });
        });
    });

    // ── PROFILE ENRIQUECIDO (wrapper PASO 7) ─────────────────────────────
    router.get('/institutional/profile/:userId', requireUserAuth, (req, res) => {
        if (!requireScope(req, res, 'user', req.params.userId)) return;
        try { outcomesViewsTotal.labels('profile').inc(); } catch {}
        instrument('institutional.profile', () => {
            safeJson(res, () => {
                const timeline = reader.getProfileTimeline(req.params.userId);
                const featureVector = reader.getLatestFeatureVector(req.params.userId);
                const impactHist = impact.getUserImpactHistory(req.params.userId);
                return { user_id: req.params.userId,
                         timeline, feature_vector: featureVector,
                         impact_history: impactHist };
            }, { user_id: req.params.userId, timeline: null,
                 feature_vector: null, impact_history: null, stale: true });
        });
    });

    // ── UI LATENCY TRACKING ──────────────────────────────────────────────
    router.post('/institutional/_track/scope-switch', requireUserAuth, express.json(), (req, res) => {
        try {
            const to = String(req.body?.to || 'unknown').slice(0, 30);
            scopeSwitchTotal.labels(to).inc();
        } catch {}
        res.json({ ok: true });
    });

    router.post('/institutional/_track/ui-latency', requireUserAuth, express.json(), (req, res) => {
        try {
            const where = String(req.body?.where || 'unknown').slice(0, 50);
            const ms = Math.max(0, Math.min(60_000, Number(req.body?.ms) || 0));
            uiLatencyMs.labels(where).observe(ms);
        } catch {}
        res.json({ ok: true });
    });

    return router;
}

function safeJsonParse(s) {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
}
