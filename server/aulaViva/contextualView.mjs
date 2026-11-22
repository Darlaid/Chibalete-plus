/**
 * contextualView.mjs — CHP V9 F7-C2R-U2. Seguimiento individual de Aula Viva sobre el contexto pedagógico.
 *
 * Da a las rutas existentes de Aula Viva (timeline, vector, riesgo, series, recomendaciones, cola de atención) la
 * respuesta para quien acompaña a un lector POR MEDIACIÓN, con la misma forma que ya consume la pantalla y calculada
 * solo con `pedagogicalContext.mjs` (U1). Nunca lee el perfil global del lector.
 *
 *  - Evolución: los mismos indicadores evaluados en fechas pasadas (cortes semanales fijos) sobre los eventos fechados
 *    del contexto. No hay historial guardado que mantener ni que pueda contaminarse.
 *  - Riesgo: un episodio empieza en el primer corte en que la regla se dispara y termina en el primero en que deja de
 *    hacerlo. Un corte sin información suficiente no abre ni cierra nada.
 *  - Recomendaciones: se calculan al consultar. Lo único que se guarda es el ACTO del mediador (atendida / aplicada,
 *    cuándo y por quién) en `pedagogical_recommendations`, como fila del lector (ámbito `user`), ya atendida: no
 *    compite con las recomendaciones activas del motor global y la supresión de datos de la persona la alcanza.
 *    El identificador es determinista (lector, contexto, regla, periodo de vigencia): marcar dos veces no duplica.
 */
import crypto from 'node:crypto';
import { computeContextualIndicators, computeContextualImpact, DATA_STATE, CONTEXT_WINDOW_DAYS } from './pedagogicalContext.mjs';
import { FOLLOWUP_DAYS } from '../services/outcomeEngine.mjs';
import { ENABLED as ledgerEnabled } from './contextLedger.mjs';
import { RECOMMENDATION_TTL_MS } from '../pedagogy/pedagogicalRules.js';
import { getPedagogyExtDb } from '../db/pedagogyDbExt.mjs';

const DAY = 86_400_000, WEEK = 7 * DAY;
/** Cortes semanales de la evolución. Con la ventana de 28 días cabe en la retención caliente de eventos (90 días). */
export const SERIES_WEEKS = 8;
export const HISTORY_DAYS = SERIES_WEEKS * 7 + CONTEXT_WINDOW_DAYS;
const REC_PREFIX = 'ctx.';
const SEVERITY_RANK = { critical: 0, high: 1, moderate: 2, info: 3 };

/** Identidad del contexto: los grupos compartidos. Dos mediadores de cursos distintos tienen contextos distintos. */
export const contextKeyOf = (context) =>
    crypto.createHash('sha256').update([...context.groupIds].sort().join('\n')).digest('hex').slice(0, 12);

const periodOf = (ts) => Math.floor(ts / RECOMMENDATION_TTL_MS);
export const recommendationIdFor = (readerId, ctxKey, ruleId, period) =>
    REC_PREFIX + Buffer.from(JSON.stringify([String(readerId), ctxKey, ruleId, period])).toString('base64url');
export const isContextualRecommendationId = (id) => typeof id === 'string' && id.startsWith(REC_PREFIX);
/** Partes de un identificador contextual, o null. No autoriza nada: quien lo use debe volver a comprobarlo todo. */
export function parseRecommendationId(id) {
    if (!isContextualRecommendationId(id)) return null;
    try {
        const p = JSON.parse(Buffer.from(id.slice(REC_PREFIX.length), 'base64url').toString('utf8'));
        if (!Array.isArray(p) || p.length !== 4 || p.slice(0, 3).some((x) => typeof x !== 'string' || !x) || !Number.isInteger(p[3])) return null;
        return { readerId: p[0], ctxKey: p[1], ruleId: p[2], period: p[3] };
    } catch { return null; }
}

/** Actos de atención guardados para unos identificadores. */
function attentionRows(ids) {
    const out = new Map();
    if (ids.length === 0) return out;
    const rows = getPedagogyExtDb().prepare(
        `SELECT recommendation_id, acknowledged, acknowledged_at, acknowledged_by, applied, applied_at
         FROM pedagogical_recommendations WHERE recommendation_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    for (const r of rows) out.set(r.recommendation_id, r);
    return out;
}

/** Recomendaciones de periodos anteriores que el mediador atendió en ESTE contexto (historial fechado). */
function attendedHistory(readerId, ctxKey, exclude) {
    const rows = getPedagogyExtDb().prepare(
        `SELECT * FROM pedagogical_recommendations
         WHERE scope_type = 'user' AND scope_id = ? AND acknowledged = 1 AND recommendation_id LIKE 'ctx.%'
         ORDER BY created_at DESC LIMIT 50`).all(String(readerId));
    const out = [];
    for (const r of rows) {
        if (exclude.has(r.recommendation_id) || parseRecommendationId(r.recommendation_id)?.ctxKey !== ctxKey) continue;
        let explanation = null, rule_ids = [r.rule_id];
        try { explanation = JSON.parse(r.explanation_json); } catch { /* fila sin explicación legible */ }
        try { rule_ids = JSON.parse(r.rule_ids_json); } catch { /* idem */ }
        out.push({ recommendation_id: r.recommendation_id, scope_type: 'user', scope_id: r.scope_id, rule_id: r.rule_id,
            recommendation_type: r.recommendation_type, severity: r.severity, confidence: r.confidence, created_at: r.created_at,
            expires_at: r.expires_at, acknowledged: 1, acknowledged_at: r.acknowledged_at, applied: r.applied, applied_at: r.applied_at,
            explanation, rule_ids });
    }
    return out;
}

function decorateRecommendations(result, ctxKey, nowTs) {
    const period = periodOf(nowTs);
    const groups = result.context.groups.map((g) => g.group_id);
    // Fecha de la recomendación: la última lectura del contexto que la sostiene o, si es anterior, el inicio del periodo
    // de vigencia en que se vuelve a emitir. Nunca una fecha anterior a la evidencia.
    const created_at = Math.max(period * RECOMMENDATION_TTL_MS, result.provenance?.last_ts ?? 0);
    const recs = result.recommendations.map((r) => ({
        recommendation_id: recommendationIdFor(result.user_id, ctxKey, r.rule_id, period),
        scope_type: 'user', scope_id: result.user_id, rule_id: r.rule_id, recommendation_type: r.recommendation_type,
        severity: r.severity, confidence: r.confidence,
        created_at, expires_at: (period + 1) * RECOMMENDATION_TTL_MS,
        acknowledged: 0, acknowledged_at: null, applied: 0, applied_at: null,
        explanation: { ...r.explanation, context: { groups } }, rule_ids: [r.rule_id],
    }));
    const state = attentionRows(recs.map((r) => r.recommendation_id));
    for (const r of recs) {
        const s = state.get(r.recommendation_id);
        if (s) Object.assign(r, { acknowledged: s.acknowledged ? 1 : 0, acknowledged_at: s.acknowledged_at ?? null, applied: s.applied ? 1 : 0, applied_at: s.applied_at ?? null });
    }
    recs.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4));
    return recs;
}

/**
 * Cortes de evaluación, del más antiguo al actual: semanas UTC fijas, después los días de la semana en curso y, al
 * final, el instante de la consulta. `ts` es cuándo se evalúa; `date` es la fecha que se informa para lo que ese corte
 * descubre. Las fechas son fijas (no se mueven con cada consulta): lo que se ve por primera vez en un corte diario
 * ocurrió durante el día anterior, y lo que se ve en la consulta en curso, hoy.
 */
function seriesCuts(nowTs) {
    const base = Math.floor(nowTs / WEEK) * WEEK, today = Math.floor(nowTs / DAY) * DAY;
    const cuts = [];
    for (let k = SERIES_WEEKS - 1; k >= 0; k--) cuts.push({ ts: base - k * WEEK, date: base - k * WEEK });
    for (let d = base + DAY; d <= today; d += DAY) cuts.push({ ts: d, date: d - DAY });
    if (nowTs > cuts.at(-1).ts) cuts.push({ ts: nowTs, date: today });
    return cuts;
}

function riskEpisodes(points, ctxKey) {
    const open = new Map(), out = [];
    for (const p of points) {
        const st = p.result.data_state;
        if (st === DATA_STATE.insufficient) continue;                // no se sabe: ni abre ni cierra
        const now = new Map((st === DATA_STATE.ok ? p.result.risks : []).map((r) => [r.risk_type, r]));
        for (const [type, ep] of open) if (!now.has(type)) { ep.resolved_at = p.date; ep.active = false; open.delete(type); }
        for (const [type, r] of now) {
            if (open.has(type)) { open.get(type).severity = r.severity; open.get(type).source_signals = r.source_signals; continue; }
            const ep = { risk_id: `ctxrisk_${ctxKey}_${type}_${p.date}`, user_id: r.user_id, risk_type: type, severity: r.severity,
                detected_at: p.date, resolved_at: null, source_signals: r.source_signals, active: true };
            open.set(type, ep); out.push(ep);
        }
    }
    return out.sort((a, b) => b.detected_at - a.detected_at);
}

/** El estado, dicho en claro para la pantalla existente (tarjeta de observación). Nunca un diagnóstico. */
function stateNotice(result) {
    const card = (id, kind, headline, evidence, caveat, confidence) => ({ id, kind, headline, evidence, caveat, confidence, sources: ['context'] });
    if (result.data_state === DATA_STATE.no_course_works) return card('context_no_course_works', 'neutral',
        'El curso todavía no tiene obras asociadas.',
        'Los indicadores se calculan solo con la lectura de las obras del curso. Sin obras asociadas no hay nada que observar.',
        'Esto no describe cómo lee el estudiante.', 'high');
    if (result.data_state === DATA_STATE.no_activity) return card('context_no_activity', 'neutral',
        `Sin actividad en las obras del curso en los últimos ${CONTEXT_WINDOW_DAYS} días.`,
        'No se registró lectura de las obras asociadas al curso en la ventana de observación.',
        'La lectura personal o de otros cursos no se considera aquí.', 'high');
    if (result.data_state !== DATA_STATE.insufficient) return null;
    if (result.reason === 'provenance_not_recorded') return card('context_provenance_not_recorded', 'insufficient_data',
        'Información insuficiente por ahora.',
        'Todavía no se registra desde cuándo valen las asignaciones de obras y las membresías del curso, así que la lectura no puede atribuirse al curso.',
        'No hay perfil, riesgo ni recomendaciones hasta que ese registro esté activo. Esto no describe cómo lee el estudiante.', 'low');
    if (result.reason === 'unverifiable_history') {
        const from = result.provenance?.verifiable_from;
        return card('context_unverifiable_history', 'insufficient_data',
            'Información insuficiente por ahora.',
            'Hay lectura de obras del curso anterior al momento en que se empezó a registrar su asignación o la membresía del estudiante; no puede atribuirse al curso.',
            `Los indicadores estarán disponibles${typeof from === 'number' ? ` a partir del ${new Date(from).toISOString().slice(0, 10)}` : ' más adelante'}. Esto no describe cómo lee el estudiante.`, 'low');
    }
    if (result.reason === 'history_truncated') return card('context_history_truncated', 'insufficient_data',
        'Información insuficiente por ahora.',
        'El registro de actividad de este estudiante en el periodo es demasiado extenso para procesarlo completo, y los indicadores no se calculan con una parte.',
        'No hay perfil, riesgo ni recomendaciones. Esto no describe cómo lee el estudiante: tiene mucha actividad registrada.', 'low');
    return card('context_few_signals', 'insufficient_data',
        'Aún no hay suficiente actividad del curso para observar patrones.',
        'La lectura registrada en las obras del curso es todavía muy poca.',
        'Más sesiones de lectura permitirán observar patrones.', 'low');
}

/**
 * Vista contextual de un lector.
 * @param {{context:object, events:Array<object>, nowTs?:number, withSeries?:boolean}} p
 */
export function buildContextualView({ context, events, nowTs = Date.now(), withSeries = false }) {
    const ctxKey = contextKeyOf(context);
    const finish = (r) => {
        if (r.reason === 'unverifiable_history' && !ledgerEnabled()) { r.reason = 'provenance_not_recorded'; r.provenance = { limitation: 'provenance_not_recorded', verifiable_from: null }; }
        return r;
    };
    const result = finish(computeContextualIndicators({ context, events, nowTs }).result);
    const recommendations = decorateRecommendations(result, ctxKey, nowTs);
    let points = null, risks = result.risks;
    if (withSeries) {
        points = seriesCuts(nowTs).map(({ ts, date }) => ({ ts, date, result: ts === nowTs ? result : finish(computeContextualIndicators({ context, events, nowTs: ts }).result) }));
        risks = riskEpisodes(points, ctxKey);
    }
    return { result, ctxKey, recommendations, risks, points };
}

const contextMeta = (view) => ({ data_state: view.result.data_state, reason: view.result.reason, context: view.result.context,
    window: view.result.window, provenance: view.result.provenance });

/** Cuerpo de `/students/:id/timeline` (misma forma que la vista global, más estado y contexto). */
export function timelineBody(view) {
    const r = view.result, notice = stateNotice(r);
    const current = new Set(view.recommendations.map((x) => x.recommendation_id));
    return {
        user_id: r.user_id, profile_current: r.profile_current, signals_current: r.signals_current,
        risks: view.risks,
        recommendations: [...view.recommendations, ...attendedHistory(r.user_id, view.ctxKey, current)],
        summaries: [...(notice ? [notice] : []), ...r.summaries],
        indicator_states: r.indicator_states,
        evolution: view.points ? view.points.map((p) => ({ recorded_at: p.ts, data_state: p.result.data_state,
            abandono_risk: p.result.profile_current?.abandono_risk ?? null, engagement_score: p.result.profile_current?.engagement_score ?? null,
            events: p.result.provenance?.events ?? null })) : undefined,
        ...contextMeta(view),
    };
}

export function featureVectorBody(view) {
    const fv = view.result.feature_vector;
    return fv ? { ...fv, computed_at: view.result.computed_at, ...contextMeta(view) }
        : { user_id: view.result.user_id, features: null, stale: true, ...contextMeta(view) };
}

export const riskHistoryBody = (view, limit = 50) => view.risks.slice(0, limit);

/** Serie de UNA señal en los cortes semanales. */
export function signalSeriesBody(view, signalId, sinceTs) {
    return (view.points || []).filter((p) => p.ts >= sinceTs).map((p) => {
        const s = p.result.signals_current.find((x) => x.signal_id === signalId);
        return { recorded_at: p.ts, scope_type: 'user', scope_id: view.result.user_id, signal_id: signalId, period: `${CONTEXT_WINDOW_DAYS}d`,
            metric_value: s?.metric_value ?? null, confidence: s?.confidence ?? null, data_state: p.result.data_state };
    });
}

export const recommendationsBody = (view, { includeAcknowledged = false, limit = 50 } = {}) =>
    view.recommendations.filter((r) => includeAcknowledged || !r.acknowledged).slice(0, limit);

/** Fila de la cola de atención, o null si el lector no tiene un riesgo calculado (no se ordena lo que no se sabe). */
export function attentionItem(view, nowTs = Date.now()) {
    const p = view.result.profile_current;
    if (view.result.data_state !== DATA_STATE.ok || !p || typeof p.abandono_risk !== 'number') return null;
    const pending = view.recommendations.filter((r) => !r.acknowledged);
    return { user_id: view.result.user_id, abandono_risk: p.abandono_risk, last_active_at: p.last_active_at ?? null,
        engagement_score: p.engagement_score ?? null, top_severity: pending[0]?.severity ?? null, recommendations_count: pending.length,
        days_since_active: p.last_active_at ? Math.floor((nowTs - p.last_active_at) / DAY) : null, data_state: DATA_STATE.ok };
}

/** Orden de la cola: el mismo de siempre (severidad de la recomendación más alta y, después, riesgo). */
export const sortAttention = (items) => items.sort((a, b) =>
    (SEVERITY_RANK[a.top_severity] ?? 4) - (SEVERITY_RANK[b.top_severity] ?? 4) || b.abandono_risk - a.abandono_risk);

/**
 * Registra que el mediador atendió una recomendación de ESTA vista. Idempotente: la segunda vez no cambia nada.
 * @returns {{ok:true, acknowledged:boolean, applied:boolean}|null}  null si el identificador no es de esta vista
 */
export function acknowledgeContextual(view, recommendationId, { by, applied = false, nowTs = Date.now() }) {
    const parsed = parseRecommendationId(recommendationId);
    if (!parsed || parsed.readerId !== view.result.user_id || parsed.ctxKey !== view.ctxKey) return null;
    const period = periodOf(nowTs);
    if (parsed.period !== period && parsed.period !== period - 1) return null;            // periodo vigente o el recién cerrado
    const rec = view.recommendations.find((r) => r.rule_id === parsed.ruleId);
    if (!rec) return null;                                                                 // la regla no está activa en este contexto
    const db = getPedagogyExtDb();
    const ins = db.prepare(`
        INSERT OR IGNORE INTO pedagogical_recommendations
            (recommendation_id, scope_type, scope_id, rule_id, recommendation_type, severity, confidence, created_at, expires_at,
             explanation_json, rule_ids_json, acknowledged, acknowledged_at, acknowledged_by, applied, applied_at, source_watermark)
        VALUES (@recommendation_id, 'user', @scope_id, @rule_id, @recommendation_type, @severity, @confidence, @created_at, @expires_at,
             @explanation_json, @rule_ids_json, 1, @ts, @by, @applied, @applied_at, 0)`).run({
        recommendation_id: recommendationId, scope_id: view.result.user_id, rule_id: rec.rule_id, recommendation_type: rec.recommendation_type,
        severity: rec.severity, confidence: rec.confidence, created_at: rec.created_at,
        expires_at: (parsed.period + 1) * RECOMMENDATION_TTL_MS, explanation_json: JSON.stringify(rec.explanation),
        rule_ids_json: JSON.stringify(rec.rule_ids), ts: nowTs, by: by ?? null, applied: applied ? 1 : 0, applied_at: applied ? nowTs : null });
    if (ins.changes === 0 && applied) {
        db.prepare(`UPDATE pedagogical_recommendations SET applied = 1, applied_at = ? WHERE recommendation_id = ? AND applied = 0`).run(nowTs, recommendationId);
    }
    return { ok: true, acknowledged: ins.changes > 0, applied: !!applied };
}

/** Resumen de estados de los lectores de un mediador (solo recuentos). */
export function overviewOf(views) {
    const out = { readers: views.length, ok: 0, no_activity: 0, insufficient: 0, no_course_works: 0, in_attention: 0 };
    for (const v of views) { if (v.result.data_state in out) out[v.result.data_state]++; if (attentionItem(v)) out.in_attention++; }
    return out;
}

// ── V9 F7-C2R-U3 — impacto de intervenciones y agregados de curso ────────────────────────────────────────────────────
// Mismas ventanas y mismo clasificador (`computeContextualImpact`), sobre la actividad fechada del contexto. Nada se
// guarda: el resultado se calcula al consultar, así que no puede quedar etiquetado con lectura ajena al curso.

/**
 * Intervenciones registradas sobre un lector por quienes median los grupos del contexto (no las de otros cursos).
 * @param {string} readerId
 * @param {Iterable<string>} mediatorIds
 */
export function contextualInterventions(readerId, mediatorIds, limit = 50) {
    const ids = [...new Set([...mediatorIds].map(String))];
    if (ids.length === 0) return [];
    return getPedagogyExtDb().prepare(
        `SELECT intervention_id, teacher_id, student_id, intervention_type, created_at, recommendation_origin, outcome, outcome_at
         FROM pedagogical_interventions
         WHERE student_id = ? AND teacher_id IN (${ids.map(() => '?').join(',')})
         ORDER BY created_at DESC LIMIT ?`).all(String(readerId), ...ids, limit);
}

/** Una fila de impacto por intervención. `pending` = la ventana posterior aún no se cierra: no se compara nada. */
export function contextualImpactRows({ context, events, nowTs = Date.now(), interventions }) {
    return interventions.map((i) => {
        const base = { outcome_id: `ctxout_${i.intervention_id}`, intervention_id: i.intervention_id, recommendation_id: i.recommendation_origin ?? null,
            user_id: i.student_id, scope_type: 'user', scope_id: i.student_id, intervention_type: i.intervention_type, teacher_id: i.teacher_id,
            manual_outcome: i.outcome ?? null, created_at: i.created_at };
        const due = i.created_at + FOLLOWUP_DAYS * DAY;
        if (nowTs < due) {
            return { ...base, data_state: 'pending', reason: 'followup_window_open', followup_due_at: due, outcome_label: null, confidence: null,
                evidence_level: null, baseline_metrics: null, followup_metrics: null, delta_metrics: null };
        }
        const r = computeContextualImpact({ context, events, interventionTs: i.created_at, interventionType: i.intervention_type, nowTs }).result;
        return { ...base, data_state: r.data_state, reason: r.reason, outcome_label: r.outcome_label ?? null, confidence: r.confidence ?? null,
            evidence_level: r.evidence_level ?? null, baseline_window_start: r.baseline_window.from, baseline_window_end: r.baseline_window.to,
            followup_window_start: r.followup_window.from, followup_window_end: r.followup_window.to,
            baseline_metrics: r.baseline_metrics, followup_metrics: r.followup_metrics, delta_metrics: r.delta_metrics };
    });
}

/** Cuerpo con la forma de `getImpactSummary`. La distribución solo cuenta comparaciones que el clasificador pudo hacer. */
export function impactSummaryBody(scope, rows, extra = {}) {
    const STRATEGY_MIN_SUPPORT = Number(process.env.AULA_VIVA_LEARNING_MIN_SUPPORT || 5);   // mismo umbral que los aprendizajes
    const distribution = { improved: 0, stable: 0, worsened: 0, mixed: 0, insufficient_data: 0 };
    let pending = 0, notComparable = 0;
    for (const r of rows) {
        if (r.data_state === 'pending') pending++;
        else if (r.outcome_label && r.outcome_label in distribution) distribution[r.outcome_label]++;
        else notComparable++;
    }
    // V9 F7-C2R-U3C — resultados por estrategia. `evaluated` = intervenciones con resultado calculado (ni pendientes ni
    // insuficientes); con menos de `min_support` evaluadas no se afirma nada de la estrategia (`sufficient: false`).
    const byType = new Map();
    for (const r of rows) {
        const e = byType.get(r.intervention_type) ?? { intervention_type: r.intervention_type, total: 0, pending: 0, insufficient: 0, evaluated: 0, improved: 0, stable: 0, worsened: 0, mixed: 0 };
        e.total++;
        if (r.data_state === 'pending') e.pending++;
        else if (['improved', 'stable', 'worsened', 'mixed'].includes(r.outcome_label)) { e[r.outcome_label]++; e.evaluated++; }
        else e.insufficient++;
        byType.set(r.intervention_type, e);
    }
    const by_type = [...byType.values()].map((e) => ({ ...e, sufficient: e.evaluated >= STRATEGY_MIN_SUPPORT })).sort((x, y) => y.total - x.total);
    return { scope, total_outcomes: rows.length - pending, distribution, pending, not_comparable: notComparable, outcomes: rows, by_type, min_support: STRATEGY_MIN_SUPPORT, ...extra };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Métrica agregada: solo si la sostienen al menos `min` lectores (umbral de divulgación vigente). */
const disclosed = (values, min) => (values.length >= min ? mean(values) : null);
const signalOf = (r, id) => r.signals_current.find((s) => s.signal_id === id)?.metric_value;

/**
 * Agregado de UN curso con los resultados contextuales de sus lectores con seguimiento habilitado. Devuelve la forma de
 * la comparativa de cohortes. `roster` es la nómina total: se informa para que no se confunda con la población medida.
 */
export function groupAggregateBody({ groupId, roster, results, min, period = '28d' }) {
    const base = { scope: { type: 'group', id: groupId }, period, population: { roster, eligible: results.length }, global_baseline: [] };
    if (results.length < min) return { ...base, metrics: [], suppressed: true, reason: 'min_eligible_readers', minCohort: min };
    const ok = results.filter((r) => r.data_state === DATA_STATE.ok && r.profile_current);
    const risk = ok.map((r) => r.profile_current.abandono_risk).filter((v) => typeof v === 'number');
    const metric = (metric_key, metric_value) => ({ metric_key, metric_value, trend: null, global_value: null, delta_vs_global: null });
    const by_state = Object.fromEntries(Object.values(DATA_STATE).map((s) => [s, results.filter((r) => r.data_state === s).length]));
    return { ...base, suppressed: false, by_state, metrics: [
        metric('reader_cohort', roster),
        metric('eligible_readers', results.length),
        metric('active_users', results.filter((r) => (r.provenance?.events ?? 0) > 0).length),
        // V9 65E-B: `active_users` cuenta lectores con lectura ACREDITADA del curso. Quien tiene lectura de sus obras que
        // no puede atribuirse (o cuya historia no pudo leerse completa) no es un lector inactivo: se cuenta aparte.
        metric('readers_with_unattributable_activity', results.filter(hasUnattributableActivity).length),
        metric('profiles_evaluated', ok.length),
        metric('avg_continuidad', disclosed(ok.map((r) => signalOf(r, 'continuidad_semanal')).filter((v) => typeof v === 'number'), min)),
        metric('avg_engagement', disclosed(ok.map((r) => r.profile_current.engagement_score).filter((v) => typeof v === 'number'), min)),
        metric('at_risk_users', risk.length >= min ? risk.filter((v) => v >= 0.7).length : null),
    ] };
}

/** Hay actividad sobre obras del curso, pero no es atribuible o no pudo leerse completa (65E-B). */
const UNATTRIBUTABLE_REASONS = new Set(['unverifiable_history', 'provenance_not_recorded', 'history_truncated']);
const hasUnattributableActivity = (r) => r.data_state === DATA_STATE.insufficient && UNATTRIBUTABLE_REASONS.has(r.reason);

/** Serie semanal del agregado de un curso (los mismos cortes fijos de la evolución individual). */
export function groupRollupsBody({ groupId, views, min }) {
    const weekly = [];
    const cuts = (views[0]?.points || []).filter((p) => p.ts % WEEK === 0);
    for (const cut of cuts) {
        const at = views.map((v) => v.points.find((p) => p.ts === cut.ts)?.result).filter(Boolean);
        if (at.length < min) continue;
        const ok = at.filter((r) => r.data_state === DATA_STATE.ok && r.profile_current);
        const cont = ok.map((r) => signalOf(r, 'continuidad_semanal')).filter((v) => typeof v === 'number');
        const risk = ok.map((r) => r.profile_current.abandono_risk).filter((v) => typeof v === 'number');
        const row = (metric_key, metric_value) => ({ scope_type: 'group', scope_id: groupId, period_start: cut.ts - WEEK, period_end: cut.ts, metric_key, metric_value });
        weekly.push(row('active_users', at.filter((r) => (r.provenance?.events ?? 0) > 0).length),
            row('readers_with_unattributable_activity', at.filter(hasUnattributableActivity).length),
            row('avg_continuidad', disclosed(cont, min)), row('at_risk_users', risk.length >= min ? risk.filter((v) => v >= 0.7).length : null));
    }
    return { daily: [], weekly, monthly: [], population: { eligible: views.length } };
}
