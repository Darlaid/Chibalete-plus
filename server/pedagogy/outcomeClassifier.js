/**
 * outcomeClassifier.js — PASO 6 §7-9.
 *
 * Reglas PURAS para clasificar outcomes pedagógicos. Determinístico,
 * auditable, observacional (sin causalidad).
 *
 * Input: baseline metrics + followup metrics (ambos shape consistente).
 * Output: label + confidence + evidence_level + explanation (observacional).
 *
 * Labels (§9 — explícitamente NO clínicos):
 *   - improved              ≥ 2 señales mejoran significativamente
 *   - worsened              ≥ 2 señales empeoran significativamente
 *   - stable                cambios dentro del rango de variación normal
 *   - mixed                 mejora en algunas, empeora en otras
 *   - insufficient_data     baseline/followup con muestra demasiado pequeña
 *
 * Evidence level (§10):
 *   - low                   poca actividad / pocas señales válidas
 *   - medium                datos suficientes en ambas ventanas
 *   - high                  ≥ 3 señales consistentes, alta actividad
 *
 * Vocabulario:
 *   PERMITIDO: "se observó", "muestra cambio", "no se observaron cambios"
 *   PROHIBIDO: "causó", "garantiza", "predijo", "probado", "demostró"
 */

export const OUTCOME_LABELS = Object.freeze({
    improved: 'improved',
    stable: 'stable',
    worsened: 'worsened',
    mixed: 'mixed',
    insufficient_data: 'insufficient_data',
});

export const EVIDENCE_LEVELS = Object.freeze({ low: 'low', medium: 'medium', high: 'high' });

// Umbral relativo (porcentaje del rango [0,1] o cambio absoluto si la señal
// es minutos). Si el delta es ≥ este umbral, cuenta como cambio significativo.
const SIGNIFICANT_DELTA = {
    continuidad:   0.15,    // 0..1
    persistencia:  0.15,    // 0..1
    diversidad:    1.0,     // count absoluto
    engagement:    0.15,    // 0..1
    abandono:      0.15,    // 0..1 (mejora = baja)
    autonomia:     0.15,
    concentracion: 0.15,
    recuperacion:  0.15,
    tiempo_efectivo: 5,     // minutos
    completitud:   0.15,
};

// Para abandono, "mejora" significa que el valor BAJÓ (menos abandono).
// Para los demás, "mejora" = valor SUBIÓ.
const HIGHER_IS_BETTER = {
    continuidad: true, persistencia: true, diversidad: true,
    engagement: true, autonomia: true, concentracion: true,
    recuperacion: true, tiempo_efectivo: true, completitud: true,
    abandono: false,
};

// Cuántos eventos mínimos en cada ventana para no caer en insufficient_data.
const MIN_EVENTS_PER_WINDOW = 3;

/**
 * Computa el delta absoluto (followup - baseline) considerando "higher is
 * better" (para abandono, mejora = delta negativo, así que invertimos).
 */
function directionalDelta(metric, baseline, followup) {
    if (typeof baseline !== 'number' || typeof followup !== 'number') return null;
    const raw = followup - baseline;
    return HIGHER_IS_BETTER[metric] ? raw : -raw;  // > 0 siempre = mejora
}

/**
 * Cuenta señales con delta significativo en cada dirección.
 */
function tallyChanges(baselineMetrics, followupMetrics) {
    const improvements = [];
    const worsenings = [];
    const stable = [];
    const skipped = [];
    for (const key of Object.keys(SIGNIFICANT_DELTA)) {
        const b = baselineMetrics[key];
        const f = followupMetrics[key];
        if (typeof b !== 'number' || typeof f !== 'number') { skipped.push(key); continue; }
        const dirDelta = directionalDelta(key, b, f);
        if (dirDelta == null) { skipped.push(key); continue; }
        const thr = SIGNIFICANT_DELTA[key];
        if (Math.abs(dirDelta) < thr) stable.push({ key, delta: +dirDelta.toFixed(3) });
        else if (dirDelta > 0)        improvements.push({ key, delta: +dirDelta.toFixed(3) });
        else                          worsenings.push({ key, delta: +dirDelta.toFixed(3) });
    }
    return { improvements, worsenings, stable, skipped };
}

/**
 * Determina evidence_level con honestidad estadística:
 *  - low:    < MIN_EVENTS o muy pocas señales válidas
 *  - high:   ≥3 señales consistentes en MISMA dirección + alta actividad
 *  - medium: el resto (caso por defecto)
 */
function computeEvidenceLevel({ baselineEvents, followupEvents,
                                improvements, worsenings, stable, skipped }) {
    const totalValid = improvements.length + worsenings.length + stable.length;
    if (baselineEvents < MIN_EVENTS_PER_WINDOW || followupEvents < MIN_EVENTS_PER_WINDOW
        || totalValid < 2) {
        return EVIDENCE_LEVELS.low;
    }
    const dominantDir = improvements.length >= worsenings.length ? 'up' : 'down';
    const dominantCount = Math.max(improvements.length, worsenings.length);
    const enoughActivity = baselineEvents >= 10 && followupEvents >= 10;
    if (dominantCount >= 3 && enoughActivity) return EVIDENCE_LEVELS.high;
    return EVIDENCE_LEVELS.medium;
}

/**
 * Confidence en [0..1]. Basada en (a) tamaño de muestra (eventos)
 * y (b) consistencia (cuántas señales apuntan en la misma dirección).
 *
 * NO es una "probabilidad de mejora" — es una métrica de **fuerza de la
 * señal observacional**, NO una predicción.
 */
function computeConfidence({ baselineEvents, followupEvents,
                              improvements, worsenings, stable }) {
    const totalValid = improvements.length + worsenings.length + stable.length;
    if (totalValid === 0) return 0;
    const dominant = Math.max(improvements.length, worsenings.length);
    const consistency = dominant / totalValid;  // 0..1
    const sampleScore = Math.min(1, (baselineEvents + followupEvents) / 60);  // 30+30 → 1
    return +(0.6 * consistency + 0.4 * sampleScore).toFixed(3);
}

/**
 * Texto observacional (sin causalidad).
 */
function buildExplanation({ label, improvements, worsenings, stable, evidence_level,
                            interventionType }) {
    if (label === OUTCOME_LABELS.insufficient_data) {
        return 'Datos insuficientes en la ventana de seguimiento para evaluar cambios observables.';
    }
    const niceNames = (arr) => arr.map(x => x.key.replace(/_/g, ' ')).join(', ');
    const evidenceText = evidence_level === 'high'   ? 'con evidencia observacional alta' :
                         evidence_level === 'medium' ? 'con evidencia observacional media' :
                                                       'con evidencia observacional baja';
    switch (label) {
        case OUTCOME_LABELS.improved:
            return `Después de la intervención "${interventionType}" se observó mejora en ${
                improvements.length} señal${improvements.length>1?'es':''}: ${
                niceNames(improvements)} (${evidenceText}). Esto NO implica causalidad — refleja patrones observados en la ventana de seguimiento.`;
        case OUTCOME_LABELS.worsened:
            return `Después de la intervención "${interventionType}" se observó retroceso en ${
                worsenings.length} señal${worsenings.length>1?'es':''}: ${
                niceNames(worsenings)} (${evidenceText}). Considere revisar contexto adicional antes de conclusiones.`;
        case OUTCOME_LABELS.mixed:
            return `Después de la intervención "${interventionType}" se observaron cambios mixtos: mejora en ${
                niceNames(improvements)}; retroceso en ${niceNames(worsenings)} (${evidenceText}).`;
        case OUTCOME_LABELS.stable:
            return `Después de la intervención "${interventionType}" no se observaron cambios significativos en las señales medidas (${evidenceText}).`;
        default:
            return 'Outcome no clasificable.';
    }
}

/**
 * Clasifica un outcome a partir de baseline + followup metrics.
 *
 * @param {object} args
 * @param {object} args.baselineMetrics  {continuidad, persistencia, abandono, ...}
 * @param {object} args.followupMetrics  mismo shape
 * @param {number} args.baselineEvents   N eventos observados en la ventana baseline
 * @param {number} args.followupEvents   idem follow-up
 * @param {string} args.interventionType
 *
 * @returns {{label, confidence, evidence_level, explanation, delta:object,
 *           improvements, worsenings, stable, skipped}}
 */
export function classifyOutcome({ baselineMetrics, followupMetrics,
                                  baselineEvents = 0, followupEvents = 0,
                                  interventionType = 'unknown' }) {
    if (!baselineMetrics || !followupMetrics) {
        return {
            label: OUTCOME_LABELS.insufficient_data,
            confidence: 0,
            evidence_level: EVIDENCE_LEVELS.low,
            explanation: 'Datos insuficientes: faltan métricas baseline o follow-up.',
            delta: {},
            improvements: [], worsenings: [], stable: [], skipped: [],
        };
    }

    const tally = tallyChanges(baselineMetrics, followupMetrics);
    const { improvements, worsenings, stable, skipped } = tally;

    // Caso insufficient_data
    if (baselineEvents < MIN_EVENTS_PER_WINDOW
        || followupEvents < MIN_EVENTS_PER_WINDOW
        || (improvements.length + worsenings.length + stable.length) < 2) {
        return {
            label: OUTCOME_LABELS.insufficient_data,
            confidence: 0,
            evidence_level: EVIDENCE_LEVELS.low,
            explanation: buildExplanation({ label: OUTCOME_LABELS.insufficient_data,
                improvements, worsenings, stable, evidence_level: 'low',
                interventionType }),
            delta: buildDeltaMap(improvements, worsenings, stable),
            improvements, worsenings, stable, skipped,
        };
    }

    // Determinar label
    let label;
    if (improvements.length >= 2 && worsenings.length === 0) {
        label = OUTCOME_LABELS.improved;
    } else if (worsenings.length >= 2 && improvements.length === 0) {
        label = OUTCOME_LABELS.worsened;
    } else if (improvements.length >= 1 && worsenings.length >= 1) {
        label = OUTCOME_LABELS.mixed;
    } else if (improvements.length === 1 && worsenings.length === 0) {
        // 1 mejora aislada → stable (no suficiente evidencia para improved)
        label = OUTCOME_LABELS.stable;
    } else {
        label = OUTCOME_LABELS.stable;
    }

    const evidence_level = computeEvidenceLevel({
        baselineEvents, followupEvents, improvements, worsenings, stable, skipped });
    const confidence = computeConfidence({
        baselineEvents, followupEvents, improvements, worsenings, stable });
    const explanation = buildExplanation({
        label, improvements, worsenings, stable, evidence_level, interventionType });

    return {
        label, confidence, evidence_level, explanation,
        delta: buildDeltaMap(improvements, worsenings, stable),
        improvements, worsenings, stable, skipped,
    };
}

function buildDeltaMap(improvements, worsenings, stable) {
    const out = {};
    for (const x of [...improvements, ...worsenings, ...stable]) out[x.key] = x.delta;
    return out;
}

/**
 * Valida que el texto de explicación NO contiene vocabulario causal/clínico
 * prohibido. Usado en tests + (futuro) review automatizado.
 */
// IMPORTANTE: las regex usan \b boundaries y verbos/adjetivos específicos.
// La palabra "causalidad" (sustantivo abstracto) NO está bloqueada porque
// se usa precisamente para NEGAR su afirmación ("NO implica causalidad"
// es vocabulario PROHIBIDO afirmar pero PERMITIDO negar). Las afirmaciones
// que SÍ se bloquean son las que el classifier nunca debería emitir:
// "causó", "causa", "causal" (adjetivo solo), "garantiza", "predice", etc.
export const FORBIDDEN_VOCAB = Object.freeze([
    /\bcaus[oóáa]\b/i,                 // "causa" / "causó"
    /\bcausal\b/i,                     // adjetivo aislado: "efecto causal"
    /\bgarantiza\b/i, /\bgarantizado\b/i,
    /\bprob(ad[oa]|aron)\b/i, /\bdemostr[oóáa]\b/i,
    /\bpredijo\b/i, /\bpredice\b/i, /\bpredicción\b/i,
    /\bdéficit\b/i, /\btrastorno\b/i, /\bdislexia\b/i, /\bTDAH\b/i,
    /\bcapacidad cognitiva\b/i, /\bnivel intelectual\b/i,
]);
export function containsForbiddenVocab(text) {
    if (typeof text !== 'string') return false;
    return FORBIDDEN_VOCAB.some(r => r.test(text));
}
