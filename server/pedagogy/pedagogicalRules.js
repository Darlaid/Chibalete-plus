/**
 * pedagogicalRules.js — Aula Viva PASO 3.
 *
 * Motor de reglas DETERMINÍSTICO + AUDITABLE + EXPLICABLE.
 *
 * Cada regla es una FUNCIÓN PURA `(ctx) → ruleResult | null` que:
 *   - lee profile + signals + (opcional) previousSnapshot
 *   - aplica condiciones numéricas EXPLÍCITAS
 *   - retorna un objeto con: rule_id, severity, confidence (0..1), reasons[],
 *     signals_used[], recommendation_type, explanation (observacional),
 *     vocabulary_class='observational'
 *
 * Filosofía (audit §5):
 *   - NUNCA emite vocabulario clínico/cognitivo/predictivo.
 *   - `confidence < MIN_CONFIDENCE` → la regla devuelve null (no se persiste).
 *   - El docente entiende POR QUÉ leyendo `reasons` + `signals_used`.
 *
 * Decisión OSS: NO json-rules-engine (audit §3). Custom puro: cero deps,
 * tests directos (`evaluateRule(profile, signals)`), refactor con grep.
 */

export const RULES_ENGINE_VERSION = 1;
export const MIN_CONFIDENCE = 0.3;
export const RECOMMENDATION_TTL_MS = 7 * 86_400_000;  // 7d antes de stale

// Severidades canónicas — orden importa (ordenar/comparar)
export const SEVERITY = Object.freeze({
    info: 0, moderate: 1, high: 2, critical: 3,
});

function severityRank(s) { return SEVERITY[s] ?? -1; }

// Vocabulario observacional reutilizable — NUNCA cadenas clínicas
const PHRASES = Object.freeze({
    abandono_alto:           'Se observan sesiones que se interrumpen antes de progresar y baja continuidad semanal en la última ventana de 28 días.',
    fatiga_lectora:          'Se observan sesiones cortas y abandono frecuente; podría ayudar reducir la complejidad y ofrecer modo audio o pausas.',
    invisibilidad_prolongada:'No se registra actividad lectora en la plataforma durante un período prolongado. Se sugiere restablecer el vínculo con el lector.',
    alta_autonomia:          'La continuidad, persistencia y diversidad lectora se mantienen altas: es un buen momento para sugerir exploración de géneros o retos.',
    diversidad_baja:         'La actividad se concentra en pocos contenidos; podría enriquecer la experiencia rotar a otros géneros o autores.',
    deterioro_continuidad:   'La continuidad semanal ha disminuido respecto a la ventana anterior; conviene reforzar la mediación.',
    mejora_destacada:        'El compromiso lector mejoró de forma notable respecto a la ventana anterior. Reconocer el progreso refuerza el hábito.',
    habito_emergente:        'Se observa un hábito de lectura emergente en este lector. Conviene reforzarlo con continuidad.',
});

/**
 * Edad en ms desde `last_active_at` hasta `nowTs`. Null si falta dato.
 */
function inactivityMs(profile, nowTs) {
    if (!profile || !profile.last_active_at) return null;
    return Math.max(0, nowTs - profile.last_active_at);
}

/**
 * Obtiene metric_value de un snapshot fila signal_snapshots por signal_id.
 * @param {Array<object>} snapshots
 * @param {string} sid
 * @returns {{value:number|null, confidence:string}}
 */
function sig(snapshots, sid) {
    const row = snapshots?.find(s => s.signal_id === sid);
    return row ? { value: row.metric_value, confidence: row.confidence }
               : { value: null, confidence: 'pending' };
}

/**
 * Helper: empaqueta resultado.
 */
function emit({ rule_id, severity, confidence, reasons, signals_used,
                recommendation_type, explanation, deltas }) {
    if (typeof confidence !== 'number' || isNaN(confidence)) return null;
    const conf = Math.max(0, Math.min(1, confidence));
    if (conf < MIN_CONFIDENCE) return null;
    return {
        rule_id, rule_version: RULES_ENGINE_VERSION, severity,
        confidence: conf, reasons, signals_used,
        recommendation_type,
        explanation,
        vocabulary_class: 'observational',
        deltas: deltas ?? null,
    };
}

// ────────────────────────────────────────────────────────────────────────────
//  REGLAS — 8 (audit §6)
// ────────────────────────────────────────────────────────────────────────────

/** RULE 1 — abandono_alto */
export function rule_abandono_alto({ profile, snapshots }) {
    const abandono   = sig(snapshots, 'abandono_temprano');
    const continuidad= sig(snapshots, 'continuidad_semanal');
    if (abandono.value == null || continuidad.value == null) return null;
    if (abandono.value < 0.6 || continuidad.value > 0.3) return null;
    const conf = abandono.value * 0.6 + (1 - continuidad.value) * 0.4;
    return emit({
        rule_id: 'abandono_alto', severity: 'high', confidence: conf,
        reasons: ['abandono_temprano_alto', 'continuidad_baja'],
        signals_used: [
            { id: 'abandono_temprano',   value: abandono.value,    confidence: abandono.confidence },
            { id: 'continuidad_semanal', value: continuidad.value, confidence: continuidad.confidence },
        ],
        recommendation_type: 'lectura_guiada',
        explanation: PHRASES.abandono_alto,
    });
}

/** RULE 2 — fatiga_lectora */
export function rule_fatiga_lectora({ profile, snapshots }) {
    const tiempo     = sig(snapshots, 'tiempo_efectivo_lectura');  // en minutos
    const abandono   = sig(snapshots, 'abandono_temprano');
    const continuidad= sig(snapshots, 'continuidad_semanal');
    if (tiempo.value == null || abandono.value == null || continuidad.value == null) return null;
    if (tiempo.value >= 30 || abandono.value < 0.4 || continuidad.value > 0.4) return null;
    const conf = 0.5 + (1 - continuidad.value) * 0.3;
    return emit({
        rule_id: 'fatiga_lectora', severity: 'moderate', confidence: conf,
        reasons: ['tiempo_efectivo_bajo', 'abandono_moderado', 'continuidad_baja'],
        signals_used: [
            { id: 'tiempo_efectivo_lectura', value: tiempo.value, confidence: tiempo.confidence },
            { id: 'abandono_temprano',       value: abandono.value, confidence: abandono.confidence },
            { id: 'continuidad_semanal',     value: continuidad.value, confidence: continuidad.confidence },
        ],
        recommendation_type: 'modo_audio_con_pausas',
        explanation: PHRASES.fatiga_lectora,
    });
}

/** RULE 3 — invisibilidad_prolongada (>14d sin actividad). CRITICAL. */
export function rule_invisibilidad_prolongada({ profile, nowTs }) {
    const ms = inactivityMs(profile, nowTs);
    if (ms == null) return null;
    const days = Math.floor(ms / 86_400_000);
    if (days < 14) return null;
    return emit({
        rule_id: 'invisibilidad_prolongada', severity: 'critical', confidence: 0.95,
        reasons: ['sin_actividad_prolongada'],
        signals_used: [
            { id: 'last_active_at', value: profile.last_active_at,
              confidence: 'high', meta: { days_inactive: days } },
        ],
        recommendation_type: 'restablecer_vinculo',
        explanation: PHRASES.invisibilidad_prolongada,
    });
}

/** RULE 4 — alta_autonomia (recomendación positiva). */
export function rule_alta_autonomia({ profile, snapshots }) {
    const persistencia = sig(snapshots, 'persistencia');
    const continuidad  = sig(snapshots, 'continuidad_semanal');
    const diversidad   = sig(snapshots, 'diversidad_lectora');
    if (persistencia.value == null || continuidad.value == null || diversidad.value == null) return null;
    if (persistencia.value < 0.7 || continuidad.value < 0.6 || diversidad.value < 3) return null;
    const diversidadNorm = Math.min(1, diversidad.value / 10);  // 10 contenidos = 1.0
    const conf = (persistencia.value + continuidad.value + diversidadNorm) / 3;
    return emit({
        rule_id: 'alta_autonomia', severity: 'info', confidence: conf,
        reasons: ['persistencia_alta', 'continuidad_alta', 'diversidad_alta'],
        signals_used: [
            { id: 'persistencia',        value: persistencia.value, confidence: persistencia.confidence },
            { id: 'continuidad_semanal', value: continuidad.value,  confidence: continuidad.confidence },
            { id: 'diversidad_lectora',  value: diversidad.value,   confidence: diversidad.confidence },
        ],
        recommendation_type: 'exploracion_generos',
        explanation: PHRASES.alta_autonomia,
    });
}

/** RULE 5 — diversidad_baja. */
export function rule_diversidad_baja({ profile, snapshots }) {
    const diversidad = sig(snapshots, 'diversidad_lectora');
    const tiempo     = sig(snapshots, 'tiempo_efectivo_lectura');
    if (diversidad.value == null || tiempo.value == null) return null;
    // Lectura activa (≥30min) pero concentrada en ≤2 contenidos.
    if (diversidad.value > 2 || tiempo.value < 30) return null;
    return emit({
        rule_id: 'diversidad_baja', severity: 'moderate', confidence: 0.6,
        reasons: ['diversidad_baja', 'volumen_lectura_ok'],
        signals_used: [
            { id: 'diversidad_lectora',      value: diversidad.value, confidence: diversidad.confidence },
            { id: 'tiempo_efectivo_lectura', value: tiempo.value,     confidence: tiempo.confidence },
        ],
        recommendation_type: 'sugerir_rotacion',
        explanation: PHRASES.diversidad_baja,
    });
}

/** RULE 6 — deterioro_continuidad (delta longitudinal). */
export function rule_deterioro_continuidad({ snapshots, previousSnapshots }) {
    if (!previousSnapshots || previousSnapshots.length === 0) return null;
    const actual = sig(snapshots, 'continuidad_semanal');
    const previo = sig(previousSnapshots, 'continuidad_semanal');
    if (actual.value == null || previo.value == null) return null;
    const delta = actual.value - previo.value;
    if (delta > -0.25) return null;
    const conf = Math.min(1, Math.abs(delta));
    return emit({
        rule_id: 'deterioro_continuidad', severity: 'moderate', confidence: conf,
        reasons: ['continuidad_en_descenso'],
        signals_used: [
            { id: 'continuidad_semanal', value: actual.value, confidence: actual.confidence },
            { id: 'continuidad_semanal_prev', value: previo.value, confidence: previo.confidence },
        ],
        recommendation_type: 'mediacion_refuerzo',
        explanation: PHRASES.deterioro_continuidad,
        deltas: { continuidad_delta: +delta.toFixed(3) },
    });
}

/** RULE 7 — mejora_destacada (delta positivo en engagement). */
export function rule_mejora_destacada({ profile, previousProfile }) {
    if (!previousProfile || typeof profile?.engagement_score !== 'number'
        || typeof previousProfile.engagement_score !== 'number') return null;
    const delta = profile.engagement_score - previousProfile.engagement_score;
    if (delta < 0.25) return null;
    const conf = Math.min(1, delta);
    return emit({
        rule_id: 'mejora_destacada', severity: 'info', confidence: conf,
        reasons: ['engagement_en_ascenso'],
        signals_used: [
            { id: 'engagement_score',      value: profile.engagement_score,       confidence: 'medium' },
            { id: 'engagement_score_prev', value: previousProfile.engagement_score, confidence: 'medium' },
        ],
        recommendation_type: 'reconocer_progreso',
        explanation: PHRASES.mejora_destacada,
        deltas: { engagement_delta: +delta.toFixed(3) },
    });
}

/** RULE 8 — habito_emergente (continuidad >=0.5 + reciente + sin profile previo). */
export function rule_habito_emergente({ profile, snapshots, previousProfile, nowTs }) {
    const continuidad = sig(snapshots, 'continuidad_semanal');
    if (continuidad.value == null || continuidad.value < 0.5) return null;
    const ms = inactivityMs(profile, nowTs);
    if (ms == null || ms > 14 * 86_400_000) return null;
    // Sólo si NO había snapshot previo (verdadera emergencia, no continuidad).
    if (previousProfile && previousProfile.last_active_at) return null;
    return emit({
        rule_id: 'habito_emergente', severity: 'info', confidence: 0.55,
        reasons: ['hábito_lector_emergente'],
        signals_used: [
            { id: 'continuidad_semanal', value: continuidad.value, confidence: continuidad.confidence },
        ],
        recommendation_type: 'reforzar_habito',
        explanation: PHRASES.habito_emergente,
    });
}

// ────────────────────────────────────────────────────────────────────────────
//  REGISTRY + EVALUADOR
// ────────────────────────────────────────────────────────────────────────────

export const RULES = Object.freeze([
    { id: 'abandono_alto',            fn: rule_abandono_alto,            severity: 'high'     },
    { id: 'fatiga_lectora',           fn: rule_fatiga_lectora,           severity: 'moderate' },
    { id: 'invisibilidad_prolongada', fn: rule_invisibilidad_prolongada, severity: 'critical' },
    { id: 'alta_autonomia',           fn: rule_alta_autonomia,           severity: 'info'     },
    { id: 'diversidad_baja',          fn: rule_diversidad_baja,          severity: 'moderate' },
    { id: 'deterioro_continuidad',    fn: rule_deterioro_continuidad,    severity: 'moderate' },
    { id: 'mejora_destacada',         fn: rule_mejora_destacada,         severity: 'info'     },
    { id: 'habito_emergente',         fn: rule_habito_emergente,         severity: 'info'     },
]);

export const RULE_IDS = Object.freeze(RULES.map(r => r.id));

/**
 * Evalúa TODAS las reglas con el mismo contexto. Una regla que lanza
 * NUNCA tumba a las demás (try/catch por regla).
 *
 * @param {{profile:object, snapshots:Array, previousProfile?:object,
 *          previousSnapshots?:Array, nowTs:number}} ctx
 * @returns {Array<RuleResult>}
 */
export function evaluateAllRules(ctx) {
    const out = [];
    for (const rule of RULES) {
        try {
            const result = rule.fn(ctx);
            if (result && result.confidence >= MIN_CONFIDENCE) out.push(result);
        } catch { /* una regla rota NUNCA tumba al motor */ }
    }
    // Ordenar por severity DESC (critical primero) y confidence DESC.
    out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)
                    || (b.confidence - a.confidence));
    return out;
}

/**
 * Validación rápida del shape de una RuleResult (para tests / observabilidad).
 */
export function isValidRuleResult(r) {
    return !!r && typeof r === 'object'
        && typeof r.rule_id === 'string'
        && typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
        && Array.isArray(r.reasons) && r.reasons.length > 0
        && Array.isArray(r.signals_used)
        && typeof r.recommendation_type === 'string'
        && typeof r.explanation === 'string'
        && r.vocabulary_class === 'observational';
}
