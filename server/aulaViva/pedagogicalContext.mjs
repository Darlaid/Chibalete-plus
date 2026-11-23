/**
 * pedagogicalContext.mjs — CHP V9 F7-C2R-U1. Contexto pedagógico para indicadores derivados.
 *
 * Los indicadores derivados de Aula Viva (señales, perfil, riesgo, vector de rasgos, recomendaciones, resúmenes,
 * impacto de intervenciones) son funciones puras sobre una lista de eventos. El almacén global los calcula con TODA
 * la actividad del lector y por eso no se entregan por mediación (F7-C2S). Aquí no hay un segundo motor: se elige
 * QUÉ eventos entran y se llama a las mismas funciones.
 *
 * Un evento entra en el contexto de un lector ante un mediador solo si, a la vez:
 *   - es del propio lector y tiene obra;
 *   - la obra está asociada HOY a un grupo que el mediador media y del que el lector es miembro (ámbito F7-C2);
 *   - en el instante del evento esa asociación y esa membresía estaban vigentes y eso es comprobable
 *     (`contextLedger.mjs`). Una asignación posterior no incorpora lecturas anteriores.
 *
 * Lo que no se puede comprobar no se atribuye, y tampoco se disimula: si en la ventana hay actividad sobre obras del
 * contexto cuya pertenencia temporal no consta, el resultado es `insufficient` (motivo `unverifiable_history`), sin
 * perfil, riesgo ni recomendaciones. Nunca cero, nunca «sin riesgo».
 *
 * Este módulo no autoriza a nadie: CIS + A2 + C005 se comprueban antes, donde siempre. Tampoco lee ni escribe el
 * almacén global, y no persiste nada.
 */
import crypto from 'node:crypto';
import { computeUserSignals, computeUserProfile } from '../services/signalCompute.mjs';
import { SIGNAL_IDS } from '../analytics/signals.js';
import { evaluateAllRules, isValidRuleResult, RULES_ENGINE_VERSION } from '../pedagogy/pedagogicalRules.js';
import { buildFeatureVector, FEATURE_VECTOR_VERSION } from '../services/featureExtractor.mjs';
import { generateLongitudinalSummaries } from '../services/longitudinalSummary.mjs';
import { windowMetricsFromEvents, BASELINE_DAYS, FOLLOWUP_DAYS } from '../services/outcomeEngine.mjs';
import { classifyOutcome, OUTCOME_LABELS } from '../pedagogy/outcomeClassifier.js';
import { MIN_COHORT_READERS } from '../analytics/cohortDisclosure.mjs';
import { ALL_WORKS } from './contextLedger.mjs';

const DAY = 86_400_000;
/** La misma ventana de observación que el materializador global (`PERIOD_DAYS`). */
export const CONTEXT_WINDOW_DAYS = 28;
/** El mismo corte con el que el motor global cuenta lectores en riesgo. */
const AT_RISK_THRESHOLD = 0.7;

export const DATA_STATE = Object.freeze({
    ok: 'ok',                             // calculado con actividad del contexto
    no_activity: 'no_activity',           // contexto válido y comprobable; sin actividad en la ventana
    insufficient: 'insufficient',         // hay actividad, pero no alcanza o no es atribuible: sin diagnóstico
    no_course_works: 'no_course_works',   // los cursos compartidos no tienen obras asociadas
});
/** Puntajes del perfil que el algoritmo vigente todavía no calcula para nadie (quedan en null por diseño). */
const NOT_COMPUTED_SCORES = Object.freeze(['fluidez_score', 'autonomia_score', 'concentracion_score']);
const PROFILE_SCORES = Object.freeze(['fluidez_score', 'persistencia_score', 'autonomia_score', 'concentracion_score',
    'diversidad_score', 'engagement_score', 'abandono_risk']);

// Orden de preferencia al combinar grupos o listas: basta un camino válido; lo dudoso pesa más que lo descartado.
const RANK = { in: 4, unverifiable: 3, outside_period: 2, outside_context: 1 };
const better = (a, b) => (RANK[a] >= RANK[b] ? a : b);

/** Estado de UNA asociación en un instante, según sus intervalos registrados (orden ascendente). */
function statusAt(list, ts) {
    if (!Array.isArray(list) || list.length === 0) return 'unverifiable';     // vigente hoy, sin registro de desde cuándo
    for (const iv of list) if (ts >= iv.since && (iv.until == null || ts < iv.until)) return 'in';
    // Fuera de todo intervalo: antes de una línea base no se sabe; en cualquier otro hueco consta que no valía.
    return ts < list[0].since && list[0].origin === 'baseline' ? 'unverifiable' : 'outside_period';
}

/**
 * Estado de UNA asociación durante todo un tramo [from, to] (65A): 'in' solo si un mismo intervalo registrado lo cubre
 * entero. Vigente al inicio pero no hasta el final ⇒ no se sabe en qué lado quedó lo ocurrido: 'unverifiable'.
 */
function statusOver(list, from, to) {
    const a = statusAt(list, from);
    if (a !== 'in' || !(to > from)) return a;
    for (const iv of list) if (from >= iv.since && (iv.until == null || to < iv.until)) return 'in';
    return 'unverifiable';
}

/**
 * Contexto pedagógico de un lector frente a un conjunto de grupos (los que comparte con quien consulta).
 *
 * @param {object} p
 * @param {string} p.readerId
 * @param {Array<{groupId:string, works:{all:boolean, ids:string[]}}>} p.groups  ámbito F7-C2 de cada grupo, HOY
 * @param {Map<string, {work:Map, member:Map}>|null} [p.intervals]  procedencia temporal (`contextIntervals`)
 */
export function buildPedagogicalContext({ readerId, groups, intervals = null }) {
    const rid = String(readerId ?? '');
    const gs = (Array.isArray(groups) ? groups : []).map((g) => ({
        groupId: String(g.groupId), all: g.works?.all === true, ids: new Set((g.works?.ids || []).map(String)),
    }));
    const hasWorks = gs.some((g) => g.all || g.ids.size > 0);

    /**
     * 'in' | 'unverifiable' | 'outside_period' | 'outside_context' | 'no_work'.
     * Con `untilTs` (65A) la asociación y la membresía deben constar vigentes durante todo el tramo [ts, untilTs].
     */
    const classify = (contentId, ts, untilTs = ts) => {
        if (contentId == null || contentId === '') return 'no_work';
        const c = String(contentId);
        let best = 'outside_context';
        for (const g of gs) {
            const named = g.ids.has(c);
            if (!named && !g.all) continue;
            if (typeof ts !== 'number' || !Number.isFinite(ts)) { best = better(best, 'unverifiable'); continue; }
            const led = intervals?.get(g.groupId);
            let work = 'outside_period';
            if (named) work = better(work, statusOver(led?.work.get(c), ts, untilTs));
            if (g.all) work = better(work, statusOver(led?.work.get(ALL_WORKS), ts, untilTs));
            const member = statusOver(led?.member.get(rid), ts, untilTs);
            const here = work === 'in' && member === 'in' ? 'in'
                : (work === 'outside_period' || member === 'outside_period') ? 'outside_period' : 'unverifiable';
            best = better(best, here);
            if (best === 'in') break;
        }
        return best;
    };

    const ctx = {
        readerId: rid,
        groupIds: gs.map((g) => g.groupId),
        hasWorks,
        classify,
        /**
         * Predicado para fuentes con obra y fecha (`includeContent(contentId, ts)`); sin fecha comprobable, false.
         * 65E-C3: con `untilTs` (cuándo recibió el servidor el dato) la asociación y la membresía deben constar vigentes
         * durante todo el tramo entre la fecha declarada y esa recepción: la regla de 65A para cualquier dato fechado
         * por el dispositivo. Si el contexto cambió en ese tramo, la fecha declarada no basta para atribuirlo.
         */
        includeContent: (contentId, ts, untilTs = ts) => classify(contentId, ts, untilTs) === 'in',
        /** Predicado para filas crudas de events.db. */
        includeEvent: (row) => !!row && String(row.user_id) === rid && classify(row.content_id, row.server_ts) === 'in',
        describe: () => ({ groups: gs.map((g) => ({ group_id: g.groupId, works: g.all ? null : g.ids.size, all_works: g.all })) }),
    };
    /** 65A — sesiones de un progreso con la fecha acreditable en ESTE contexto (`creditSessions`). */
    ctx.creditSessions = (progress, receipts) => creditSessions(ctx, progress, receipts);
    return ctx;
}

/** Tolerancia entre el reloj de un dispositivo y el del servidor. */
export const CLOCK_SKEW_MS = 5 * 60_000;
/** Hasta aquí, entre la fecha declarada y la primera recepción, la sesión se considera recibida en línea. */
export const ONLINE_RECEIPT_MS = 15 * 60_000;
/** Qué respalda (o no) la fecha de una sesión ante quien media. */
export const DATE_EVIDENCE = Object.freeze({
    server_corroborated: 'server_corroborated',   // fecha declarada coherente con la recepción inmediata del servidor
    deferred_sync: 'deferred_sync',               // llegó después (sin conexión); el contexto no cambió entre la fecha y la recepción
    server_received: 'server_received',           // el dispositivo no declaró fecha: vale la de recepción
    no_server_receipt: 'no_server_receipt',       // el servidor no tiene constancia de haberla recibido
    conflicting_dates: 'conflicting_dates',       // la misma sesión llegó con fechas de inicio distintas
    future_date: 'future_date',                   // declarada después de que el servidor la recibiera
    context_changed_before_receipt: 'context_changed_before_receipt',   // el curso o la asignación cambió antes de recibirla
});
const CREDITED = new Set([DATE_EVIDENCE.server_corroborated, DATE_EVIDENCE.deferred_sync, DATE_EVIDENCE.server_received]);

/**
 * V9 65A — sesiones de un progreso con la fecha que puede acreditarse ante quien media.
 *
 * La fecha de una sesión la declara el dispositivo. El servidor solo sabe con certeza cuándo la recibió: la lectura
 * no pudo ocurrir después. Regla:
 *   - sin constancia de recepción, con fechas contradictorias o declarada en el futuro ⇒ fecha no acreditada;
 *   - en otro caso la sesión conserva su fecha declarada (la cronología sin conexión no se pierde) si la asociación
 *     obra–curso y la membresía constan vigentes durante TODO el tramo entre esa fecha y la recepción. Si cambiaron
 *     en ese tramo, la fecha del dispositivo decidiría sola a qué lado cae la lectura ⇒ no acreditada.
 * Una sesión con fecha no acreditada sale con `startedAt: null`: para toda la atribución es actividad sin fecha.
 * No toca el progreso ni el historial del lector.
 *
 * @param {ReturnType<typeof buildPedagogicalContext>} context
 * @param {{contentId:string, history?:Array<object>}} progress
 * @param {Array<object>|undefined} receipts  filas de `sessionReceiptsOf(lector).get(obra)`
 * @returns {{sessions:Array<{sessionId:string, startedAt:string|null, durationSec:number, mode:string, evidence:string}>, complete:boolean, undatedSaves:boolean, fromOrigin:boolean, unverified:number}}
 */
export function creditSessions(context, progress, receipts) {
    const rows = Array.isArray(receipts) ? receipts : [];
    const seen = new Set();
    const sessions = [];
    for (const r of rows) {
        if (r.session_id === '') continue;
        seen.add(r.session_id);
        const declared = Number.isFinite(r.declared_start_ts);
        const R = r.first_received_ts, D = declared ? r.declared_start_ts : R;
        let evidence;
        if (r.conflict) evidence = DATE_EVIDENCE.conflicting_dates;
        else if (D > R + CLOCK_SKEW_MS) evidence = DATE_EVIDENCE.future_date;
        else if (D < R && context.classify(progress.contentId, D) === 'in' && context.classify(progress.contentId, D, R) !== 'in') evidence = DATE_EVIDENCE.context_changed_before_receipt;
        else evidence = !declared ? DATE_EVIDENCE.server_received : R - D <= ONLINE_RECEIPT_MS ? DATE_EVIDENCE.server_corroborated : DATE_EVIDENCE.deferred_sync;
        const credited = CREDITED.has(evidence);
        // Una sesión no pudo durar más que lo que va de su inicio a la última vez que el servidor la recibió.
        const ceiling = Math.max(0, Math.round((r.last_received_ts - D) / 1000)) + CLOCK_SKEW_MS / 1000;
        sessions.push({ sessionId: r.session_id, startedAt: credited ? new Date(D).toISOString() : null,
            durationSec: credited ? Math.min(Math.max(0, r.duration_sec || 0), ceiling) : 0, mode: r.mode || 'text', evidence });
    }
    // Sesiones del historial de las que el servidor no anotó recepción (anteriores al registro, o cuya anotación falló).
    for (const h of Array.isArray(progress?.history) ? progress.history : []) {
        if (h && !seen.has(String(h.sessionId))) sessions.push({ sessionId: String(h.sessionId ?? ''), startedAt: null, durationSec: 0, mode: h.mode || 'text', evidence: DATE_EVIDENCE.no_server_receipt });
    }
    const unverified = sessions.filter((s) => s.startedAt === null).length;
    const undatedSaves = rows.some((r) => r.session_id === '');
    const fromOrigin = rows.some((r) => r.from_origin === 1);
    return { sessions, unverified, undatedSaves, fromOrigin, complete: fromOrigin && !undatedSaves && unverified === 0 && sessions.length > 0 };
}

/**
 * Separa las filas de un lector según el contexto. Lo ajeno al contexto (otras obras, compras personales, filas sin
 * obra, filas de otro sujeto) ni entra ni se cuenta: su volumen no debe poder leerse en ninguna salida.
 */
export function selectContextEvents(rows, context) {
    const included = [];
    const audit = { in_context_works: 0, included: 0, unverifiable: 0, outside_period: 0, last_unverifiable_ts: null };
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || String(row.user_id) !== context.readerId) continue;
        // 65E-C2: una fila cuya fecha no está acreditada (`date_unverified`: sesión de LU sin constancia de recepción) se
        // clasifica sin fecha: si la obra es del contexto es historial no comprobable; nunca lectura fechada del curso.
        // 65E-C3: una fila fechada por el dispositivo (`received_ts`: cuándo la recibió el servidor) solo es del curso si
        // el contexto consta vigente desde esa fecha hasta la recepción (65A); si cambió en medio, no es atribuible.
        const cls = context.classify(row.content_id, row.date_unverified === true ? NaN : row.server_ts, Number.isFinite(row.received_ts) ? row.received_ts : row.server_ts);
        if (cls === 'no_work' || cls === 'outside_context') continue;
        audit.in_context_works++;
        if (cls === 'in') { included.push(row); audit.included++; }
        else if (cls === 'unverifiable') {
            audit.unverifiable++;
            if (audit.last_unverifiable_ts === null || row.server_ts > audit.last_unverifiable_ts) audit.last_unverifiable_ts = row.server_ts;
        } else audit.outside_period++;
    }
    return { included, audit };
}

/** Huella de las entradas: permite comprobar qué filas contribuyeron sin registrar ni exponer su contenido. */
function provenanceOf(included) {
    const ids = included.map((e) => String(e.event_id ?? e.id)).sort();
    return {
        events: included.length,
        first_ts: included.length ? Math.min(...included.map((e) => e.server_ts)) : null,
        last_ts: included.length ? Math.max(...included.map((e) => e.server_ts)) : null,
        digest: crypto.createHash('sha256').update(ids.join('\n')).digest('hex'),
    };
}

const emptyIndicators = () => ({ profile_current: null, indicator_states: null, signals_current: [], risks: [],
    recommendations: [], feature_vector: null, summaries: [] });

/**
 * Indicadores individuales del lector calculados SOLO con los eventos de su contexto.
 *
 * @param {object} p
 * @param {ReturnType<typeof buildPedagogicalContext>} p.context
 * @param {Array<object>} p.events  filas crudas del lector (events.db) que cubran la ventana
 * @param {number} [p.nowTs]
 * @param {boolean} [p.leoExtractionEnabled]  como en `computeUserSignals`; sin valor decide la misma bandera global
 * @returns {{result: object, audit: object}}  `result` es lo entregable; `audit` (recuentos de lo excluido) no se sirve
 */
export function computeContextualIndicators({ context, events, nowTs = Date.now(), leoExtractionEnabled }) {
    const from = nowTs - CONTEXT_WINDOW_DAYS * DAY;
    const inWindow = (Array.isArray(events) ? events : []).filter((e) => e && e.server_ts >= from && e.server_ts <= nowTs);
    const { included, audit } = selectContextEvents(inWindow, context);
    const base = {
        user_id: context.readerId, computed_at: nowTs,
        window: { days: CONTEXT_WINDOW_DAYS, from, to: nowTs },
        context: context.describe(),
    };
    const done = (data_state, reason, extra = {}) => ({ result: { ...base, data_state, reason, ...emptyIndicators(), ...extra }, audit });

    if (!context.hasWorks) return done(DATA_STATE.no_course_works, 'no_course_works', { provenance: null });
    // V9 65E-B: la lectura de la historia alcanzó el techo técnico de filas y solo trae las más recientes. Con una
    // ventana incompleta no se calcula un perfil como si fuera completo.
    if (events?.truncated === true) return done(DATA_STATE.insufficient, 'history_truncated', { provenance: { limitation: 'history_truncated', verifiable_from: null } });
    if (audit.unverifiable > 0) {
        // Parte de la actividad sobre obras del contexto no es atribuible: calcular con el resto daría un perfil
        // artificialmente bajo. Se resuelve solo cuando esa actividad sale de la ventana.
        return done(DATA_STATE.insufficient, 'unverifiable_history', {
            provenance: { limitation: 'unverifiable_history', verifiable_from: audit.last_unverifiable_ts + CONTEXT_WINDOW_DAYS * DAY },
        });
    }
    const provenance = { ...provenanceOf(included), limitation: null, verifiable_from: null };
    if (included.length === 0) return done(DATA_STATE.no_activity, 'no_activity_in_window', { provenance });

    // ── Las mismas funciones del materializador global, sobre los eventos del contexto ──
    const signals = computeUserSignals(included, { nowTs, windowDays: CONTEXT_WINDOW_DAYS, userId: context.readerId,
        ...(typeof leoExtractionEnabled === 'boolean' ? { leoExtractionEnabled } : {}) });
    const profile = computeUserProfile(signals, { nowTs });
    const signals_current = [];
    for (const sid of SIGNAL_IDS) {
        const s = signals[sid];
        if (!s) continue;
        signals_current.push({ signal_id: sid, metric_value: typeof s.value === 'number' ? s.value : null,
            confidence: s.confidence || 'pending', updated_at: nowTs, meta: s.meta ?? null });
    }
    const profile_current = { user_id: context.readerId, ...profile, last_active_at: provenance.last_ts, updated_at: nowTs };

    // Reglas pedagógicas vigentes. Sin perfil ni señales anteriores del MISMO contexto, las reglas que comparan con un
    // estado previo no se disparan: no hay historia contextual que comparar y no se inventa.
    const triggered = evaluateAllRules({ profile: profile_current, snapshots: signals_current,
        previousProfile: null, previousSnapshots: null, nowTs }).filter(isValidRuleResult);
    const recommendations = triggered.map((t) => ({
        scope_type: 'user', scope_id: context.readerId, rule_id: t.rule_id, recommendation_type: t.recommendation_type,
        severity: t.severity, confidence: t.confidence, created_at: nowTs, acknowledged: 0,
        explanation: { rule_id: t.rule_id, rule_version: t.rule_version ?? RULES_ENGINE_VERSION, signals_used: t.signals_used,
            reasons: t.reasons, explanation: t.explanation, recommended_action: t.recommendation_type,
            vocabulary_class: t.vocabulary_class, deltas: t.deltas ?? null, computed_at: nowTs },
    }));
    // Mismo criterio que el historial global: solo severidad alta o crítica cuenta como riesgo.
    const risks = triggered.filter((t) => t.severity === 'high' || t.severity === 'critical').map((t) => ({
        user_id: context.readerId, risk_type: t.rule_id, severity: t.severity, detected_at: nowTs, resolved_at: null,
        source_signals: Object.fromEntries((t.signals_used || []).filter((s) => s?.id).map((s) => [s.id, s.value ?? null])),
    }));

    // Evidencia mínima: las condiciones que YA usa el resumen longitudinal (sin perfil; menos de tres señales con valor).
    const timeline = { user_id: context.readerId, profile_current, signals_current, risks, recommendations };
    const fewSignals = generateLongitudinalSummaries(timeline, { skipFlagCheck: true }).some((s) => s.kind === 'insufficient_data');
    if (fewSignals) return done(DATA_STATE.insufficient, 'few_signals', { signals_current, provenance });

    // Vector de rasgos: la fórmula vigente. La pendiente de progresión usa hoy una serie GLOBAL de la plataforma, no
    // del lector; fuera de contexto no se usa y queda en null.
    const fv = buildFeatureVector({ profile: profile_current, snapshots: signals_current, weekly: [], nowTs });
    const indicator_states = Object.fromEntries(PROFILE_SCORES.map((k) => [k,
        typeof profile_current[k] === 'number' ? 'ok' : NOT_COMPUTED_SCORES.includes(k) ? 'not_computed' : 'insufficient']));

    return {
        result: {
            ...base, data_state: DATA_STATE.ok, reason: null,
            profile_current, indicator_states, signals_current, risks, recommendations,
            feature_vector: { user_id: context.readerId, period: `${CONTEXT_WINDOW_DAYS}d`, vector_version: FEATURE_VECTOR_VERSION,
                period_start: fv.period_start, period_end: fv.period_end, features: fv.features },
            summaries: generateLongitudinalSummaries(timeline),      // respeta su bandera, como la ruta global
            provenance,
        },
        audit,
    };
}

/**
 * Impacto de una intervención con las ventanas y el clasificador vigentes, sobre los eventos del contexto.
 * @param {{context:object, events:Array<object>, interventionTs:number, interventionType?:string, nowTs?:number}} p
 */
export function computeContextualImpact({ context, events, interventionTs, interventionType = 'unknown', nowTs = Date.now() }) {
    const baselineFrom = interventionTs - BASELINE_DAYS * DAY;
    const followupTo = Math.min(nowTs, interventionTs + FOLLOWUP_DAYS * DAY);
    const rows = (Array.isArray(events) ? events : []).filter((e) => e && e.server_ts >= baselineFrom && e.server_ts < followupTo);
    const { included, audit } = selectContextEvents(rows, context);
    const base = { user_id: context.readerId, context: context.describe(),
        baseline_window: { from: baselineFrom, to: interventionTs }, followup_window: { from: interventionTs, to: followupTo } };
    const none = (reason) => ({ result: { ...base, data_state: reason === 'no_course_works' ? DATA_STATE.no_course_works : DATA_STATE.insufficient,
        reason, outcome_label: null, baseline_metrics: null, followup_metrics: null, delta_metrics: null }, audit });
    if (!context.hasWorks) return none('no_course_works');
    if (audit.unverifiable > 0) return none('unverifiable_history');
    const baseline = windowMetricsFromEvents(included.filter((e) => e.server_ts < interventionTs));
    const followup = windowMetricsFromEvents(included.filter((e) => e.server_ts >= interventionTs));
    const clas = classifyOutcome({ baselineMetrics: baseline, followupMetrics: followup,
        baselineEvents: baseline.eventsCount, followupEvents: followup.eventsCount, interventionType });
    const insufficient = clas.label === OUTCOME_LABELS.insufficient_data;
    return {
        result: { ...base, data_state: insufficient ? DATA_STATE.insufficient : DATA_STATE.ok, reason: insufficient ? 'insufficient_window_evidence' : null,
            outcome_label: clas.label, confidence: clas.confidence, evidence_level: clas.evidence_level,
            baseline_metrics: baseline, followup_metrics: followup, delta_metrics: clas.delta,
            provenance: provenanceOf(included) },
        audit,
    };
}

/**
 * Agregado de un curso a partir de los resultados contextuales de sus lectores (cada uno calculado con el contexto de
 * ESE curso). Sin filas por lector. Usa el umbral de divulgación vigente (`MIN_COHORT_READERS`) dos veces: sobre el
 * tamaño del curso y sobre cuántos lectores sostienen cada promedio.
 * @param {Array<object>} results  `result` de `computeContextualIndicators`, uno por lector
 */
export function aggregateContextualIndicators(results, { min = MIN_COHORT_READERS } = {}) {
    const list = Array.isArray(results) ? results : [];
    const by_state = Object.fromEntries(Object.values(DATA_STATE).map((s) => [s, 0]));
    for (const r of list) if (r?.data_state in by_state) by_state[r.data_state]++;
    if (list.length < min) return { suppressed: true, reason: 'min_cohort', minCohort: min };
    const ok = list.filter((r) => r?.data_state === DATA_STATE.ok && r.profile_current);
    const metrics = { reader_cohort: list.length, readers_with_indicators: ok.length };
    const avgOf = (key) => {
        const vs = ok.map((r) => r.profile_current[key]).filter((v) => typeof v === 'number');
        return vs.length >= min ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    for (const k of PROFILE_SCORES) if (!NOT_COMPUTED_SCORES.includes(k)) metrics[`avg_${k}`] = avgOf(k);
    const withRisk = ok.filter((r) => typeof r.profile_current.abandono_risk === 'number');
    metrics.at_risk_users = withRisk.length >= min ? withRisk.filter((r) => r.profile_current.abandono_risk >= AT_RISK_THRESHOLD).length : null;
    return { suppressed: false, minCohort: min, by_state, metrics };
}
