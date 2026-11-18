/**
 * collectiveView.mjs — V9 F7-C2R-U3D.
 *
 * Analítica COLECTIVA para quien media: cohortes tipadas, sus trayectorias y los patrones observados, calculados con
 * los lectores que puede acompañar HOY (sus cursos, A2 vigente, C005 propio) y solo con la actividad fechada del curso
 * (motor de U1, vista por lector de U2). Las tablas guardadas (`cohort_memberships`, `cohort_trajectories`,
 * `predictive_risk_patterns`) agregan todas las instituciones y toda la actividad de cada lector: no son de quien
 * media y este módulo no las lee ni las escribe.
 *
 * No hay algoritmos nuevos. Cada cálculo aplica la regla del motor existente a entradas contextuales:
 *   - pertenencia a una cohorte  → criterios de `services/cohortBuilder.mjs` (riesgo activo, continuidad ≥ umbral,
 *                                  riesgo ya resuelto, lectura inmersiva y con audio, estrategia recibida);
 *   - trayectoria                → `services/trajectoryAnalyzer.mjs` (media de señales y puntajes de los miembros por
 *                                  corte, tendencia frente al corte anterior con el mismo umbral);
 *   - patrones                   → `services/predictivePatterns.mjs` (frecuencia de cada tipo de riesgo observado, con
 *                                  su soporte mínimo y su confianza por tramos). Es un recuento de lo observado: no
 *                                  predice nada de ningún lector.
 * Umbral de divulgación: un agregado (un punto de una serie, un patrón) solo se entrega si lo sostienen al menos
 * `min` lectores. Los lectores sin autorización nunca entran, así que comparar vistas no revela nada de ellos.
 */
import { buildContextualView, SERIES_WEEKS } from './contextualView.mjs';
import { DATA_STATE, selectContextEvents, CONTEXT_WINDOW_DAYS } from './pedagogicalContext.mjs';
import { MIN_SUPPORT as PATTERN_MIN_SUPPORT, PATTERN_VERSION, confidenceFromSupport } from '../services/predictivePatterns.mjs';
import { avg, trendOf } from '../services/trajectoryAnalyzer.mjs';
import { RULE_IDS } from '../pedagogy/pedagogicalRules.js';

const DAY = 86_400_000, WEEK = 7 * DAY;
const HABIT_THRESHOLD = 0.7;                                  // cohortBuilder: habit:high_continuity
const PROFILE_KEYS = ['abandono_risk', 'engagement_score', 'persistencia_score', 'diversidad_score'];
const TYPED = ['habit', 'trajectory', 'modality', 'intervention', 'risk'];
const ROSTER = ['group', 'club'];

export const cohortIdOf = (type, scopeId) => `coh_${type}:${scopeId}_v1`;
/** Tipo y ámbito de un identificador de cohorte (`coh_<tipo>:<ámbito>_v1`), o null. Solo los tipos que quien media puede consultar. */
export function parseCohortId(id) {
    const m = /^coh_([a-z]+):(.+)_v1$/.exec(String(id ?? ''));
    return m && [...TYPED, ...ROSTER].includes(m[1]) ? { cohort_type: m[1], scope_id: m[2] } : null;
}

const definition = (cohort_type, scope_id) => ({ cohort_id: cohortIdOf(cohort_type, scope_id), cohort_key: `${cohort_type}:${scope_id}`, cohort_type,
    scope_type: cohort_type, scope_id: String(scope_id), criteria_json: '{}', version: 1, active: 1, context: true });

/**
 * Definiciones que quien media puede consultar: las nóminas de sus cursos y clubes, y las cohortes tipadas que el
 * sistema sabe construir (las mismas de `cohortBuilder.runOnce`). Son definiciones abstractas: no dicen quién
 * pertenece ni cuántos, y no dependen de que el motor global haya corrido.
 */
export function contextualCohortDefinitions({ groups = [], interventionTypes = [] }) {
    return [
        ...groups.map((g) => definition(g.type === 'club' ? 'club' : 'group', g.id)),
        definition('habit', 'high_continuity'), definition('trajectory', 'recovered_after_risk'), definition('modality', 'audio_plus_immersive'),
        ...[...new Set(interventionTypes.map(String))].sort().map((t) => definition('intervention', t)),
        ...RULE_IDS.map((r) => definition('risk', r)),
    ];
}

/** Vista con serie de cada lector elegible (una sola vez por petición). */
export function collectiveEntries(readers, nowTs) {
    return readers.map((r) => ({ readerId: r.readerId, groupIds: r.groupIds ?? r.context.groupIds ?? [], context: r.context, events: r.events,
        view: buildContextualView({ context: r.context, events: r.events, nowTs, withSeries: true }) }));
}

const signalOf = (result, id) => result?.signals_current?.find((s) => s.signal_id === id)?.metric_value;

/**
 * Miembros de una cohorte entre los lectores elegibles, con el criterio del constructor de cohortes aplicado al
 * contexto del curso. `interventionsOf(readerId)` → intervenciones registradas por quienes median (para `intervention`).
 */
export function cohortMembers({ cohort_type, scope_id }, entries, { interventionsOf = () => [] } = {}) {
    const ok = (e) => e.view.result.data_state === DATA_STATE.ok;
    switch (cohort_type) {
        case 'group': case 'club':
            return entries.filter((e) => e.groupIds.map(String).includes(String(scope_id)));
        case 'risk':
            return entries.filter((e) => e.view.risks.some((x) => x.risk_type === String(scope_id) && x.resolved_at === null));
        case 'habit':
            return String(scope_id) === 'high_continuity'
                ? entries.filter((e) => ok(e) && typeof signalOf(e.view.result, 'continuidad_semanal') === 'number' && signalOf(e.view.result, 'continuidad_semanal') >= HABIT_THRESHOLD) : [];
        case 'trajectory':
            return String(scope_id) === 'recovered_after_risk' ? entries.filter((e) => e.view.risks.some((x) => x.resolved_at !== null)) : [];
        case 'modality': {
            if (String(scope_id) !== 'audio_plus_immersive') return [];
            return entries.filter((e) => {
                const rows = selectContextEvents(e.events, e.context).included ?? [];
                return rows.some((r) => r.mode === 'immersive') && rows.some((r) => r.event === 'audio_started' || r.event === 'tts_started' || r.mode === 'audio');
            });
        }
        case 'intervention':
            return entries.filter((e) => interventionsOf(e.readerId).some((i) => String(i.intervention_type) === String(scope_id)));
        default:
            return [];
    }
}

/** Estado de la población para explicar un agregado vacío (nunca como «cero»). */
export function populationState(entries) {
    const by = Object.fromEntries(Object.values(DATA_STATE).map((s) => [s, entries.filter((e) => e.view.result.data_state === s).length]));
    const reasons = new Set(entries.filter((e) => e.view.result.data_state === DATA_STATE.insufficient).map((e) => e.view.result.reason));
    if (entries.length === 0) return { data_state: 'no_eligible_readers', reason: 'no_eligible_readers', by_state: by };
    if (by[DATA_STATE.ok] > 0) return { data_state: DATA_STATE.ok, reason: null, by_state: by };
    if (by[DATA_STATE.no_course_works] === entries.length) return { data_state: DATA_STATE.no_course_works, reason: 'no_course_works', by_state: by };
    if (by[DATA_STATE.insufficient] > 0) {
        return { data_state: DATA_STATE.insufficient, reason: reasons.has('provenance_not_recorded') ? 'provenance_not_recorded' : reasons.has('unverifiable_history') ? 'unverifiable_history' : 'few_signals', by_state: by };
    }
    return { data_state: DATA_STATE.no_activity, reason: 'no_activity_in_context', by_state: by };
}

/**
 * Trayectoria de una cohorte: un punto por corte SEMANAL (más el de la consulta), con la media de las señales y de
 * los puntajes de los miembros que tienen indicadores en ese corte. Un corte con menos de `min` lectores no se
 * entrega (`suppressed_points` lo cuenta). La tendencia compara con el punto anterior ENTREGADO.
 */
export function cohortTrajectoryBody({ cohort_id, members, min, period = `${CONTEXT_WINDOW_DAYS}d` }) {
    const cuts = members[0]?.view.points?.map((p) => p.ts) ?? [];
    const weekly = cuts.filter((ts, i) => ts % WEEK === 0 || i === cuts.length - 1);
    const series = [];
    let suppressed = 0, prev = null;
    for (const ts of weekly) {
        const results = members.map((m) => m.view.points.find((p) => p.ts === ts)?.result).filter((r) => r && r.data_state === DATA_STATE.ok && r.profile_current);
        if (results.length === 0) continue;                        // nadie con indicadores en ese corte: no hay punto
        if (results.length < min) { suppressed++; continue; }
        const bySignal = new Map();
        for (const r of results) for (const s of r.signals_current ?? []) {
            if (typeof s.metric_value !== 'number') continue;
            if (!bySignal.has(s.signal_id)) bySignal.set(s.signal_id, []);
            bySignal.get(s.signal_id).push(s.metric_value);
        }
        const metrics = {};
        for (const [id, vals] of bySignal) metrics[id] = avg(vals);
        for (const k of PROFILE_KEYS) metrics[k] = avg(results.map((r) => r.profile_current[k]));
        const trend = {};
        for (const k of Object.keys(metrics)) trend[k] = trendOf(metrics[k], prev?.[k]);
        series.push({ period_start: ts - CONTEXT_WINDOW_DAYS * DAY, period_end: ts, metrics, trend,
            confidence: Math.min(1, results.length / 30), sample_size: results.length, created_at: ts });
        prev = metrics;
    }
    return { cohort_id, period, series: series.reverse(), suppressed_points: suppressed, min_cohort: min, weeks: SERIES_WEEKS };
}

/**
 * Patrones observados en los cursos de quien media: por tipo de riesgo, cuántos episodios se observaron en la ventana
 * de la serie. Mismo soporte mínimo y misma confianza que el motor global; además, el patrón solo se entrega si lo
 * sostienen al menos `min` lectores distintos. No es una predicción sobre ningún lector.
 */
export function contextualPatternsBody(entries, { min, nowTs = Date.now() }) {
    const byType = new Map();
    for (const e of entries) for (const ep of e.view.risks) {
        const g = byType.get(ep.risk_type) ?? { total: 0, readers: new Set() };
        g.total++; g.readers.add(e.readerId);
        byType.set(ep.risk_type, g);
    }
    const patterns = [];
    let withheld = 0;
    for (const [type, g] of byType) {
        if (g.total < PATTERN_MIN_SUPPORT || g.readers.size < min) { withheld++; continue; }
        patterns.push({ pattern_id: `ctxpat_${type}_v${PATTERN_VERSION}`, pattern_key: `risk:${type}`,
            signal_sequence: { rule_id: type, trigger_signals: ['risk_history_detected'], window: `series_${SERIES_WEEKS}w` },
            observed_outcome: type, support_count: g.total, readers: g.readers.size, confidence: confidenceFromSupport(g.total),
            version: PATTERN_VERSION, active: 1, updated_at: nowTs });
    }
    patterns.sort((a, b) => b.confidence - a.confidence || b.support_count - a.support_count);
    return { patterns, withheld_below_support: withheld, min_support: PATTERN_MIN_SUPPORT, min_cohort: min, weeks: SERIES_WEEKS };
}
