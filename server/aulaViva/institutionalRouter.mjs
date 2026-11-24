/**
 * institutionalRouter.mjs — Aula Viva PASO 7 §5.
 *
 * Router NUEVO mounted en /api/aula-viva (paralelo a operationalRouter
 * PASO 5; los paths usan sub-prefijo /institutional/* → cero conflicto).
 *
 * Expone los datasets PASO 6 vía REST con:
 *   - requireUserAuth (inyectado)
 *   - evaluateScopeAccess (CHP-ID-01; antes canAccessScope, PASO 7 §13)
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
// V8.1-PROD-01 (DIR-V81-05): agregados de cohorte solo con ≥ 5 lectores y sin inferencias por diferencia.
import { cohortDisclosure, suppressedAggregate, MIN_COHORT_READERS } from '../analytics/cohortDisclosure.mjs';
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { instrument } from '../services/queryProfiler.mjs';
import { evaluateScopeAccess, individualAccessChecker, individualAccess, respondScopeDecision, withholdIndividualIndicators, isMediatedSubject } from './scopeAccess.mjs';
import { getPrincipal, IdentityUnavailableError } from '../identity/cis.mjs';
import { MIN_SUPPORT as LEARNING_MIN_SUPPORT, buildHint as learningHint, computeConfidence as learningConfidence } from '../services/institutionalLearning.mjs';
// V9 F7-C2R-U2 — perfil del lector para quien lo media: contexto pedagógico (U1), nunca el perfil global.
import { buildContextualView, timelineBody, featureVectorBody, contextualInterventions, contextualImpactRows, impactSummaryBody, HISTORY_DAYS as SERIES_HISTORY_DAYS } from './contextualView.mjs';
// V9 F7-C2R-U3D — analítica colectiva de quien media (cohortes tipadas, trayectorias, patrones) desde el contexto.
import { contextualCohortDefinitions, parseCohortId, collectiveEntries, cohortMembers, populationState, cohortTrajectoryBody, contextualPatternsBody } from './collectiveView.mjs';
// V9 F7-C2R-U3 — el impacto compara 14 días antes y 14 después de cada intervención: se lee toda la retención caliente.
const IMPACT_HISTORY_DAYS = 90;
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

/** DIR-V81-05: el administrador de plataforma no tiene umbral; el resto, ≥ 5 lectores sin diferencias. */
const cohortGate = (req, scopeType, scopeId) => (req.aulaVivaPlatformAdmin ? { allowed: true } : cohortDisclosure(scopeType, scopeId));

function requireScope(req, res, scope_type, scope_id) {
    // CHP-AULA-VIVA-CANONICAL-PRINCIPAL-01A: el principal es la identidad que
    // requireUserAuth ya estableció (sesión firmada → req.auth / req.user); el header
    // x-user-id queda solo como claim legacy_asserted de respaldo (CHP-ADR-01 §G.13).
    // Misma precedencia que scopeAccess.requireScopeAccess y que reqUserId en server.js.
    const callerId = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];
    // DIR-V81-07: un sujeto individual exige además A2/C005 si se llega por mediación.
    if (String(scope_type) === 'user') {
        const di = individualAccess(callerId, scope_id);
        if (di.decision === 'allow') req.aulaVivaPlatformAdmin = String(di.via ?? '').startsWith('policy:platform_admin');
        return respondScopeDecision(di, res, scope_type, scope_id);
    }
    const d = evaluateScopeAccess(callerId, scope_type, scope_id);
    if (d.decision === 'allow') { req.aulaVivaPlatformAdmin = String(d.via ?? '').startsWith('policy:platform_admin'); return true; }
    if (d.decision === 'unavailable') {
        // IDENTITY_UNAVAILABLE jamás se presenta como 403 (CHP-ADR-01 §I-2).
        res.status(503).json({ ok: false, error: 'identity_unavailable', cause: d.cause });
        return false;
    }
    if (d.decision === 'unauthenticated') {
        res.status(401).json({ ok: false, error: 'identity_not_established' });
        return false;
    }
    res.status(403).json({ ok: false, error: 'scope_access_denied',
                            scope_type, scope_id });
    return false;
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createInstitutionalRouter({ requireUserAuth, contextAccess = null }) {
    const router = express.Router();
    /** true si quien llama media (no es la administración de plataforma): su vista de curso es la contextual. */
    const isMediatorOnlyCaller = (callerId) => {
        try { const p = getPrincipal(String(callerId ?? '')); return !!p && !p.platformAdmin && !!p.mediatorRole; } catch { return false; }
    };
    const callerOf = (req) => req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];
    /**
     * V9 F7-C2R-U3A — a quién se dirige la proyección institucional (recuentos y filas de TODAS las instituciones).
     *   'admin'     administración de plataforma: la vista global, como siempre;
     *   'mediator'  quien media: solo lo de sus cursos (nunca la proyección global);
     *   null        ya respondió: 401 sin identidad, 403 para cualquier otra sesión (un lector, institucional o B2C),
     *               503 si la identidad no es verificable. El 403 no trae recuentos ni nombra a nadie.
     * El rol sale del CIS, nunca del cliente.
     */
    function institutionalAudience(req, res) {
        let p;
        try { p = getPrincipal(String(callerOf(req) ?? '')); }
        catch (e) {
            if (!(e instanceof IdentityUnavailableError)) throw e;
            res.status(503).json({ ok: false, error: 'identity_unavailable', cause: e.causeTag });
            return null;
        }
        if (!p) { res.status(401).json({ ok: false, error: 'identity_not_established' }); return null; }
        if (p.platformAdmin) return 'admin';
        if (p.mediatorRole) return 'mediator';
        res.status(403).json({ ok: false, error: 'scope_access_denied' });
        return null;
    }
    /** Quien media sin el acceso al contexto inyectado no recibe la proyección global en su lugar. */
    const contextUnavailable = (res) => res.status(503).json({ ok: false, error: 'context_unavailable' });
    /** Definiciones de cohortes visibles para quien media: las nóminas de SUS cursos y colegios, y las tipadas (sin institución). */
    const visibleCohortDefinitions = (req, rows) => rows.filter((c) => {
        if (!['group', 'club', 'school'].includes(String(c.scope_type))) return true;
        const d = evaluateScopeAccess(callerOf(req), c.scope_type, c.scope_id);
        return d.decision === 'allow' && !String(d.via ?? '').startsWith('policy:');
    });
    /**
     * V9 F7-C2R-U3C — intervenciones de un lector registradas por quienes median sus cursos: las de Aula Viva
     * (`pedagogical_interventions`) y las anotadas desde el tablero del curso. Más recientes primero.
     */
    const interventionsOf = (readerId, mediatorIds, limit = 50) => {
        let dashboard = [];
        try { dashboard = contextAccess?.dashboardInterventions ? contextAccess.dashboardInterventions(readerId, mediatorIds) : []; } catch { dashboard = []; }
        return [...contextualInterventions(readerId, mediatorIds, limit), ...dashboard].sort((x, y) => y.created_at - x.created_at).slice(0, limit);
    };
    /**
     * V9 F7-C2R-U3 — impacto de las intervenciones de los cursos que media quien llama, sobre sus lectores con seguimiento
     * habilitado. Es lo que alimenta su pestaña Institucional: los totales, aprendizajes y comparativas GUARDADOS salen de
     * todas las instituciones y de toda la actividad de cada lector, y no son de quien media. null si ya respondió.
     */
    async function mediatorImpact(req, res, { onlyGroup = null } = {}) {
        try {
            const o = onlyGroup === null ? await contextAccess.readers(callerOf(req), { historyDays: IMPACT_HISTORY_DAYS })
                : await contextAccess.group(callerOf(req), String(onlyGroup), { historyDays: IMPACT_HISTORY_DAYS });
            const [lScope, lId] = onlyGroup === null ? ['cursos', 'mediados'] : ['group', String(onlyGroup)];
            if (!o.ok) { res.status(o.status).json(o.body); return null; }
            const rows = o.readers.flatMap((r) => contextualImpactRows({ context: r.context, events: r.events, nowTs: o.nowTs,
                interventions: interventionsOf(r.readerId, o.mediatorIds) }));
            const byType = new Map();
            for (const r of rows) {
                if (!r.outcome_label) continue;
                const e = byType.get(r.intervention_type) ?? { intervention_type: r.intervention_type, improved: 0, stable: 0, worsened: 0, mixed: 0, insufficient_data: 0, total: 0 };
                e[r.outcome_label] += 1; e.total += 1;
                byType.set(r.intervention_type, e);
            }
            const learnings = [...byType.values()].filter((e) => e.total >= LEARNING_MIN_SUPPORT).map((e) => {
                const distribution = { improved: e.improved, stable: e.stable, worsened: e.worsened, mixed: e.mixed, insufficient_data: e.insufficient_data };
                return { learning_id: `ctxlrn_${onlyGroup === null ? '' : `${lId}_`}${e.intervention_type}`, scope_type: lScope, scope_id: lId, learning_type: 'observed_strategy_effect',
                    evidence: { support_count: e.total, outcome_distribution: distribution, intervention_type: e.intervention_type, min_support_threshold: LEARNING_MIN_SUPPORT },
                    confidence: learningConfidence(e.total), recommendation_hint: learningHint(lScope, lId, e.intervention_type, distribution, e.total), active: 1 };
            });
            return { rows, byType, learnings, population: { roster: o.roster, eligible: o.readers.length } };
        } catch {
            res.status(500).json({ ok: false, error: 'context_indicators_failed' });
            return null;
        }
    }

    /**
     * V9 F7-C2R-U3D — lectores elegibles de quien media (todos sus cursos, o uno) con su vista y su serie contextual.
     * null si ya respondió (403 fuera de alcance, 503 si la identidad o el registro de decisiones no son verificables).
     * Nada de esto sale de las tablas guardadas de cohortes, trayectorias o patrones.
     */
    async function mediatorCollective(req, res, { onlyGroup = null } = {}) {
        if (!contextAccess?.readers || !contextAccess?.group) { contextUnavailable(res); return null; }
        try {
            const o = onlyGroup === null ? await contextAccess.readers(callerOf(req), { historyDays: SERIES_HISTORY_DAYS })
                : await contextAccess.group(callerOf(req), String(onlyGroup), { historyDays: SERIES_HISTORY_DAYS });
            if (!o.ok) { res.status(o.status).json(o.body); return null; }
            const entries = collectiveEntries(o.readers, o.nowTs);
            const byReader = new Map(o.readers.map((r) => [r.readerId, interventionsOf(r.readerId, o.mediatorIds)]));
            return { o, entries, population: { roster: o.roster, eligible: o.readers.length }, state: populationState(entries),
                interventionsOf: (id) => byReader.get(id) ?? [],
                interventionTypes: [...new Set([...byReader.values()].flat().map((x) => x.intervention_type))] };
        } catch {
            res.status(500).json({ ok: false, error: 'context_indicators_failed' });
            return null;
        }
    }
    /** Cohorte de quien media a partir de su identificador: miembros entre SUS lectores elegibles. null si ya respondió. */
    /** Tipo y ámbito de una cohorte por su identificador contextual o, si es uno guardado, por su definición (que es abstracta). */
    const cohortRef = (id) => {
        const parsed = parseCohortId(id);
        if (parsed) return parsed;
        try {
            const c = getOutcomesStatements().getCohortById.get(String(id));
            return c ? parseCohortId(`coh_${c.cohort_type}:${c.scope_id}_v1`) : null;
        } catch { return null; }
    };
    async function mediatorCohort(req, res) {
        const parsed = cohortRef(req.params.cohort_id);
        if (!parsed) { res.status(404).json({ ok: false, error: 'cohort_not_found' }); return null; }
        const roster = parsed.cohort_type === 'group' || parsed.cohort_type === 'club';
        const c = await mediatorCollective(req, res, roster ? { onlyGroup: parsed.scope_id } : {});
        if (!c) return null;
        const members = cohortMembers(parsed, c.entries, { interventionsOf: c.interventionsOf });
        return { ...c, parsed, members, cohort_key: `${parsed.cohort_type}:${parsed.scope_id}` };
    }

    // ── /institutional/status ────────────────────────────────────────────
    router.get('/institutional/status', requireUserAuth, async (req, res) => {
        // V9 F7-C2R-U3A: esta ruta no comprobaba alcance y devolvía los recuentos globales a cualquier sesión.
        const audience = institutionalAudience(req, res);
        if (!audience) return;
        if (audience === 'mediator' && !contextAccess?.readers) return contextUnavailable(res);
        if (audience === 'mediator') {   // V9 F7-C2R-U3: totales del contexto de quien media
            const m = await mediatorImpact(req, res);
            if (!m) return;
            const by_label = {};
            for (const r of m.rows) if (r.outcome_label) by_label[r.outcome_label] = (by_label[r.outcome_label] || 0) + 1;
            // V9 F7-C2R-U3D: cohortes, trayectorias y patrones del contexto (antes se informaban en cero).
            const c = await mediatorCollective(req, res);
            if (!c) return;
            const defs = contextualCohortDefinitions({ groups: c.o.groups ?? [], interventionTypes: c.interventionTypes });
            const sizes = defs.map((d) => cohortMembers(d, c.entries, { interventionsOf: c.interventionsOf }).length);
            const trajectories = defs.filter((d, k) => sizes[k] >= MIN_COHORT_READERS
                && cohortTrajectoryBody({ cohort_id: d.cohort_id, members: cohortMembers(d, c.entries, { interventionsOf: c.interventionsOf }), min: MIN_COHORT_READERS }).series.length > 0).length;
            return res.json({ ts: Date.now(), outcomes: { total: Object.values(by_label).reduce((a, b) => a + b, 0), by_label,
                    pending: m.rows.filter((r) => r.data_state === 'pending').length },
                cohorts: { total_active: sizes.filter((n) => n > 0).length, total_memberships: sizes.reduce((a, b) => a + b, 0) }, trajectories: { total: trajectories },
                learnings: { total_active: m.learnings.length },
                patterns: { total_active: contextualPatternsBody(c.entries, { min: MIN_COHORT_READERS }).patterns.length }, context: true, population: m.population,
                data_state: c.state.data_state, reason: c.state.reason });
        }
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
    router.get('/institutional/outcomes/by-type/:type', requireUserAuth, async (req, res) => {
        // Vista agregada → permitir mediador/admin.
        if (!requireScope(req, res, 'all', 'global')) return;
        // V9 F7-C2R-U3A: la distribución guardada suma todas las instituciones. Quien media recibe la de sus cursos.
        if (!req.aulaVivaPlatformAdmin) {
            if (!contextAccess?.readers) return contextUnavailable(res);
            const m = await mediatorImpact(req, res);
            if (!m) return;
            const e = m.byType.get(String(req.params.type));
            const distribution = {};
            for (const k of ['improved', 'stable', 'worsened', 'mixed', 'insufficient_data']) if (e?.[k]) distribution[k] = e[k];
            return res.json({ intervention_type: req.params.type, total: e?.total ?? 0, distribution, context: true });
        }
        try { outcomesViewsTotal.labels('by_type').inc(); } catch {}
        instrument('institutional.outcomes_by_type', () => {
            safeJson(res, () => impact.getImpactByInterventionType(req.params.type));
        });
    });

    router.get('/institutional/outcomes/scope/:type/:id', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, req.params.type, req.params.id)) return;
        const callerId = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];
        const limit = parseLimit(req.query.limit);
        // V9 F7-C2S / F7-C2R-U3: el impacto guardado se etiqueta con señales de TODA la actividad del lector y no se entrega
        // por mediación. Quien media recibe el impacto de las intervenciones de su curso, comparado solo con la actividad
        // fechada del contexto; sin evidencia en las dos ventanas no hay «mejoró» ni «empeoró».
        if (String(req.params.type) === 'user' && isMediatedSubject(callerId, req.params.id)) {
            if (!contextAccess) return withholdIndividualIndicators(res);
            try {
                const a = await contextAccess.reader(callerId, String(req.params.id), { historyDays: IMPACT_HISTORY_DAYS });
                if (!a.ok) return res.status(a.status).json(a.body);
                const rows = contextualImpactRows({ context: a.context, events: a.events, nowTs: a.nowTs,
                    interventions: interventionsOf(req.params.id, a.mediatorIds, limit) });
                try { outcomesViewsTotal.labels('by_scope').inc(); } catch {}
                return res.json(impactSummaryBody({ type: 'user', id: req.params.id }, rows, { context: a.context.describe() }));
            } catch { return res.status(500).json({ ok: false, error: 'context_indicators_failed' }); }
        }
        // Impacto de un CURSO para quien lo media: las intervenciones de sus lectores con seguimiento habilitado, cada una
        // comparada con el contexto de ese curso. Solo entran lectores que el mediador ya puede ver individualmente.
        if (String(req.params.type) === 'group' && contextAccess?.group && isMediatorOnlyCaller(callerId)) {
            try {
                const g = await contextAccess.group(callerId, String(req.params.id), { historyDays: IMPACT_HISTORY_DAYS });
                if (!g.ok) return res.status(g.status).json(g.body);
                const rows = g.readers.flatMap((r) => contextualImpactRows({ context: r.context, events: r.events, nowTs: g.nowTs,
                    interventions: interventionsOf(r.readerId, g.mediatorIds, limit) }));
                try { outcomesViewsTotal.labels('by_scope').inc(); } catch {}
                return res.json(impactSummaryBody({ type: 'group', id: req.params.id }, rows, { population: { roster: g.roster, eligible: g.readers.length } }));
            } catch { return res.status(500).json({ ok: false, error: 'context_indicators_failed' }); }
        }
        // V9 BIII F5-DP2: ante la administración, el impacto de un lector con lectura personal se compara solo con su
        // lectura institucional (el guardado se etiquetó con toda su actividad).
        if (String(req.params.type) === 'user' && req.aulaVivaPlatformAdmin && contextAccess?.administration) {
            try {
                const a = await contextAccess.administration(String(req.params.id), { historyDays: IMPACT_HISTORY_DAYS });
                if (a && !a.ok) return withholdIndividualIndicators(res);
                if (a) {
                    const rows = contextualImpactRows({ context: a.context, events: a.events, nowTs: a.nowTs,
                        interventions: interventionsOf(req.params.id, a.mediatorIds, limit) });
                    try { outcomesViewsTotal.labels('by_scope').inc(); } catch {}
                    return res.json(impactSummaryBody({ type: 'user', id: req.params.id }, rows, { context: a.context.describe() }));
                }
            } catch { return res.status(500).json({ ok: false, error: 'context_indicators_failed' }); }
        }
        try { outcomesViewsTotal.labels('by_scope').inc(); } catch {}
        const gate = cohortGate(req, req.params.type, req.params.id);
        if (!gate.allowed) return res.json(suppressedAggregate({ scope: { type: req.params.type, id: req.params.id }, total_outcomes: 0, distribution: {}, outcomes: [] }, gate.reason));
        instrument('institutional.outcomes_scope', () => {
            // V9 F7-C2S: cada fila es el resultado de UN lector (identificador, métricas antes/después). Quien media
            // recibe solo la distribución, y solo si resume a 5 o más resultados; las filas no van.
            if (!req.aulaVivaPlatformAdmin && String(req.params.type) !== 'user') {
                const empty = { scope: { type: req.params.type, id: req.params.id }, total_outcomes: 0, distribution: {}, outcomes: [] };
                let full = null;
                try { full = impact.getImpactSummary(req.params.type, req.params.id, { limit }); } catch { full = null; }
                if (!full) return res.json({ ...empty, stale: true, reason: 'engine_unavailable' });
                if (Number(full.total_outcomes) < MIN_COHORT_READERS) return res.json(suppressedAggregate(empty, 'below_min_outcomes'));
                return res.json({ scope: full.scope, total_outcomes: full.total_outcomes, distribution: full.distribution, outcomes: [], withheld: ['outcomes'] });
            }
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
            // DIR-V81-07: fuera de la administración, solo lectores con A2/C005 (ámbito 'all' = política de agregados, no de personas).
            if (!req.aulaVivaPlatformAdmin) {
                const check = individualAccessChecker(req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id']);
                let rows;
                try { rows = impact.getFollowupQueue({ olderThanDays, limit: 1000 }); } catch { rows = []; }
                const out = [];
                for (const r of Array.isArray(rows) ? rows : []) {
                    const d = check(r?.student_id);
                    if (d.decision === 'unavailable') return respondScopeDecision(d, res, 'user', null);
                    if (d.decision === 'allow') out.push(r);
                }
                return res.json(out.slice(0, limit));
            }
            safeJson(res, () => impact.getFollowupQueue({ olderThanDays, limit }), []);
        });
    });

    // ── COHORTS ──────────────────────────────────────────────────────────
    router.get('/institutional/cohorts/definitions', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        // V9 F7-C2R-U3D: quien media recibe las definiciones de SU contexto (sus nóminas y las cohortes tipadas que el
        // sistema sabe construir). Son abstractas y no dependen de que el motor global haya corrido.
        if (!req.aulaVivaPlatformAdmin && contextAccess?.readers) {
            const c = await mediatorCollective(req, res);
            if (!c) return;
            try { cohortViewsTotal.labels('definitions').inc(); } catch {}
            return res.json(contextualCohortDefinitions({ groups: c.o.groups ?? [], interventionTypes: c.interventionTypes }).slice(0, parseLimit(req.query.limit)));
        }
        try { cohortViewsTotal.labels('definitions').inc(); } catch {}
        instrument('institutional.cohorts_definitions', () => {
            safeJson(res, () => {
                const db = getOutcomesExtDb();
                const rows = db.prepare(
                    `SELECT * FROM cohort_definitions WHERE active = 1
                     ORDER BY cohort_type, scope_id LIMIT ?`
                ).all(parseLimit(req.query.limit));
                // V9 F7-C2R-U3A: la lista nombraba cursos y colegios de otras instituciones a cualquier mediador.
                return req.aulaVivaPlatformAdmin ? rows : visibleCohortDefinitions(req, rows);
            }, []);
        });
    });

    router.get('/institutional/cohorts/by-type/:type', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        if (!req.aulaVivaPlatformAdmin && contextAccess?.readers) {   // V9 F7-C2R-U3D
            const c = await mediatorCollective(req, res);
            if (!c) return;
            try { cohortViewsTotal.labels('by_type').inc(); } catch {}
            return res.json(contextualCohortDefinitions({ groups: c.o.groups ?? [], interventionTypes: c.interventionTypes }).filter((d) => d.cohort_type === String(req.params.type)));
        }
        try { cohortViewsTotal.labels('by_type').inc(); } catch {}
        instrument('institutional.cohorts_by_type', () => {
            safeJson(res, () => {
                const stmts = getOutcomesStatements();
                const rows = stmts.listCohortsByType.all(req.params.type);
                return req.aulaVivaPlatformAdmin ? rows : visibleCohortDefinitions(req, rows);   // V9 F7-C2R-U3A
            }, []);
        });
    });

    router.get('/institutional/cohorts/:cohort_id/members', requireUserAuth, async (req, res) => {
        // V9 F7-C2R-U3D: quien media consulta cualquier cohorte de su contexto (nómina o tipada) entre SUS lectores
        // elegibles, con el criterio del constructor aplicado a la actividad del curso. Las cohortes de colegio siguen
        // por la ruta de nóminas de abajo.
        if (contextAccess?.readers && isMediatorOnlyCaller(callerOf(req)) && cohortRef(req.params.cohort_id)) {
            const c = await mediatorCohort(req, res);
            if (!c) return;
            try { cohortViewsTotal.labels('members').inc(); } catch {}
            const members = c.members.map((m) => ({ cohort_id: req.params.cohort_id, user_id: m.readerId, left_at: null }));
            return res.json({ cohort_id: req.params.cohort_id, cohort_key: c.cohort_key, cohort_type: c.parsed.cohort_type, members_count: members.length,
                members: members.slice(0, parseLimit(req.query.limit)), context: true, population: c.population, data_state: c.state.data_state, reason: c.state.reason });
        }
        // Verificar scope del cohort (necesitamos saber scope_type+scope_id antes)
        try {
            const stmts = getOutcomesStatements();
            const cohort = stmts.getCohortById.get(req.params.cohort_id);
            if (!cohort) {
                return res.status(404).json({ ok: false, error: 'cohort_not_found' });
            }
            if (!requireScope(req, res, cohort.scope_type, cohort.scope_id)) return;
            // V9 F7-C2S: pertenecer a una cohorte que no es una nómina (p. ej. una de riesgo) ES un indicador
            // individual derivado. Solo las nóminas (colegio, grupo, club) se listan para quien media.
            if (!req.aulaVivaPlatformAdmin && !['school', 'group', 'club'].includes(String(cohort.cohort_type))) return withholdIndividualIndicators(res);
            try { cohortViewsTotal.labels('members').inc(); } catch {}
            instrument('institutional.cohort_members', () => {
                let members = stmts.listMembersOfCohort.all(req.params.cohort_id);
                // DIR-V81-07: miembros identificables solo con A2/C005; los demás se excluyen (y no se cuentan).
                if (!req.aulaVivaPlatformAdmin) {
                    const check = individualAccessChecker(req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id']);
                    const visible = [];
                    for (const m of members) {
                        const d = check(m?.user_id);
                        if (d.decision === 'unavailable') return respondScopeDecision(d, res, 'user', null);
                        if (d.decision === 'allow') visible.push(m);
                    }
                    members = visible;
                }
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

    router.get('/institutional/cohorts/:cohort_id/trajectory', requireUserAuth, async (req, res) => {
        // V9 F7-C2R-U3D: la serie guardada promedia a los miembros de TODAS las instituciones con toda su actividad. Quien
        // media recibe la serie de sus lectores elegibles en el contexto del curso; cada punto exige ≥ 5 lectores.
        if (contextAccess?.readers && isMediatorOnlyCaller(callerOf(req))) {
            if (!cohortRef(req.params.cohort_id)) return res.status(403).json({ ok: false, error: 'scope_access_denied' });
            const c = await mediatorCohort(req, res);
            if (!c) return;
            try { trajectoryViewsTotal.labels('cohort').inc(); } catch {}
            const population = { ...c.population, members: c.members.length };
            const meta = { context: true, population, data_state: c.state.data_state, reason: c.state.reason };
            if (c.members.length < MIN_COHORT_READERS) {
                return res.json({ cohort_id: req.params.cohort_id, period: '28d', series: [], suppressed: true, reason: 'min_eligible_readers', minCohort: MIN_COHORT_READERS,
                    context: true, population, data_state: c.state.data_state });
            }
            return res.json({ ...cohortTrajectoryBody({ cohort_id: req.params.cohort_id, members: c.members, min: MIN_COHORT_READERS }), ...meta });
        }
        try {
            const stmts = getOutcomesStatements();
            const cohort = stmts.getCohortById.get(req.params.cohort_id);
            if (!cohort) {
                return res.status(404).json({ ok: false, error: 'cohort_not_found' });
            }
            if (!requireScope(req, res, cohort.scope_type, cohort.scope_id)) return;
            const gate = cohortGate(req, cohort.scope_type, cohort.scope_id);
            if (!gate.allowed) return res.json(suppressedAggregate({ cohort_id: req.params.cohort_id, period: String(req.query.period || '28d'), series: [] }, gate.reason));
            try { trajectoryViewsTotal.labels('cohort').inc(); } catch {}
            const period = String(req.query.period || '28d');
            const limit = parseLimit(req.query.limit);
            instrument('institutional.cohort_trajectory', () => {
                const rows = stmts.listTrajectoryByCohort.all(req.params.cohort_id, period, limit);
                // DIR-V81-05: en cohortes tipadas (sin grupo), cada punto exige ≥ 5 miembros.
                const visibleRows = req.aulaVivaPlatformAdmin ? rows : rows.filter(r => Number(r.sample_size) >= MIN_COHORT_READERS);
                const series = visibleRows.map(r => ({
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
    router.get('/institutional/learnings/scope/:type/:id', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, req.params.type, req.params.id)) return;
        // V9 F7-C2R-U3D: los aprendizajes guardados salen del impacto global. Quien media recibe los de SU curso, con el
        // impacto contextual de sus lectores elegibles y el mismo soporte mínimo por estrategia.
        if (contextAccess?.group && isMediatorOnlyCaller(callerOf(req))) {
            if (!['group', 'club'].includes(String(req.params.type))) return res.status(403).json({ ok: false, error: 'scope_access_denied' });
            const m = await mediatorImpact(req, res, { onlyGroup: req.params.id });
            if (!m) return;
            try { learningViewsTotal.labels('by_scope').inc(); } catch {}
            return res.json(m.learnings);
        }
        if (!cohortGate(req, req.params.type, req.params.id).allowed) return res.json([]); // misma forma, sin pistas
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

    router.get('/institutional/learnings/global', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        if (!req.aulaVivaPlatformAdmin) {   // V9 F7-C2R-U3 / U3A: quien media, solo lo de sus cursos
            if (!contextAccess?.readers) return contextUnavailable(res);
            const m = await mediatorImpact(req, res);
            if (!m) return;
            return res.json(m.learnings);
        }
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
    router.get('/institutional/patterns/recent', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        // V9 F7-C2R-U3A / U3D: los patrones guardados agregan todas las instituciones y no se entregan a quien media.
        // Quien media recibe los patrones OBSERVADOS en sus cursos (mismo recuento y mismos umbrales, sobre los
        // episodios de riesgo contextuales de sus lectores elegibles), con la población y el estado de la evidencia.
        if (!req.aulaVivaPlatformAdmin) {
            if (!contextAccess?.readers) return res.status(403).json({ ok: false, error: 'scope_access_denied' });
            const c = await mediatorCollective(req, res);
            if (!c) return;
            return res.json({ ...contextualPatternsBody(c.entries, { min: MIN_COHORT_READERS, nowTs: c.o.nowTs }), context: true, population: c.population,
                data_state: c.state.data_state, reason: c.state.reason });
        }
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
    router.get('/institutional/comparative/strategies', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, 'all', 'global')) return;
        if (!req.aulaVivaPlatformAdmin) {   // V9 F7-C2R-U3 / U3A: quien media, solo lo de sus cursos
            if (!contextAccess?.readers) return contextUnavailable(res);
            const m = await mediatorImpact(req, res);
            if (!m) return;
            const strategies = [...m.byType.values()].map((s) => ({ ...s, improved_ratio: s.total ? +(s.improved / s.total).toFixed(3) : null, note: 'Observacional. NO implica causalidad.' }));
            strategies.sort((a, b) => (a.total < 5 && b.total >= 5 ? 1 : b.total < 5 && a.total >= 5 ? -1 : (b.improved_ratio ?? 0) - (a.improved_ratio ?? 0)));
            return res.json({ strategies, vocabulary_class: 'observational', context: true, population: m.population,
                caveat: 'Las comparaciones reflejan patrones observados en tus cursos, no efectos causales.' });
        }
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
    router.get('/institutional/profile/:userId', requireUserAuth, async (req, res) => {
        if (!requireScope(req, res, 'user', req.params.userId)) return;
        // V9 F7-C2S / F7-C2R-U2: el perfil global no tiene procedencia por obra ni curso. Quien media recibe el timeline y
        // el vector del contexto del curso; el historial de impacto sigue retenido (se declara en `withheld`).
        const callerId = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id'];
        if (isMediatedSubject(callerId, req.params.userId)) {
            if (!contextAccess) return withholdIndividualIndicators(res);
            try {
                const a = await contextAccess.reader(callerId, String(req.params.userId));
                if (!a.ok) return res.status(a.status).json(a.body);
                const view = buildContextualView({ context: a.context, events: a.events, nowTs: a.nowTs, withSeries: true });
                const wide = await contextAccess.reader(callerId, String(req.params.userId), { historyDays: IMPACT_HISTORY_DAYS });
                if (!wide.ok) return res.status(wide.status).json(wide.body);
                const rows = contextualImpactRows({ context: wide.context, events: wide.events, nowTs: wide.nowTs,
                    interventions: interventionsOf(req.params.userId, wide.mediatorIds) });
                return res.json({ user_id: req.params.userId, timeline: timelineBody(view), feature_vector: featureVectorBody(view),
                    impact_history: impactSummaryBody({ type: 'user', id: req.params.userId }, rows) });
            } catch { return res.status(500).json({ ok: false, error: 'context_indicators_failed' }); }
        }
        // V9 BIII F5-DP2: la administración ante un lector con lectura personal recibe el perfil de su lectura institucional.
        if (req.aulaVivaPlatformAdmin && callerId !== req.params.userId && contextAccess?.administration) {
            try {
                const a = await contextAccess.administration(String(req.params.userId));
                if (a && !a.ok) return withholdIndividualIndicators(res);
                if (a) {
                    const view = buildContextualView({ context: a.context, events: a.events, nowTs: a.nowTs, withSeries: true });
                    const wide = await contextAccess.administration(String(req.params.userId), { historyDays: IMPACT_HISTORY_DAYS });
                    const rows = wide?.ok ? contextualImpactRows({ context: wide.context, events: wide.events, nowTs: wide.nowTs,
                        interventions: interventionsOf(req.params.userId, wide.mediatorIds) }) : [];
                    return res.json({ user_id: req.params.userId, timeline: timelineBody(view), feature_vector: featureVectorBody(view),
                        impact_history: impactSummaryBody({ type: 'user', id: req.params.userId }, rows) });
                }
            } catch { return res.status(500).json({ ok: false, error: 'context_indicators_failed' }); }
        }
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
