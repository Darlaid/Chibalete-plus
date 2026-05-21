/**
 * longitudinalSummary.mjs — Fase 3A Aula Viva Operacional.
 *
 * Genera frases determinísticas sobre el estado longitudinal de un lector,
 * a partir del payload de `getProfileTimeline` (insightReader). Pensado para
 * que un mediador entienda en 5 segundos qué pasó con el lector sin tener
 * que interpretar scores aislados.
 *
 * REGLAS DURAS:
 *
 *   1. NO LLM. NO narrativa libre. Templates con condiciones explícitas.
 *   2. NUNCA afirmar comprensión. Vocabulario observacional: "se observó",
 *      "se observan indicios", "datos insuficientes". Prohibido "el lector
 *      comprende", "el estudiante aprendió", "tiene problemas".
 *   3. Cada summary lleva `confidence` y `caveat` explícitos.
 *   4. Sin PII. Las frases NO incluyen texto del estudiante, respuestas Leo
 *      ni nombres propios. Solo categorías y agregados.
 *   5. Defensivo: cualquier input malformado → devuelve {ok:true, summaries:[]}.
 *   6. Determinístico: mismo input → mismo output.
 *   7. Gated por flag `AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED` (default OFF).
 *   8. Idempotente y barato: O(templates × signals) por call.
 *
 * Cada template:
 *   - id            (slug estable; usado por la UI para deduplicar)
 *   - condition(t)  función pura sobre el timeline; devuelve bool o context.
 *   - render(t, c)  función pura que devuelve el objeto Summary final.
 *
 * Cada Summary devuelto:
 *   {
 *     id:         string,            // slug del template (estable)
 *     kind:       'insufficient_data' | 'attention' | 'positive' | 'observation' | 'neutral',
 *     headline:   string,            // frase principal (corta, observacional)
 *     evidence:   string,            // qué llevó a esta frase (1 línea, sin PII)
 *     confidence: 'low' | 'medium' | 'high',
 *     caveat:     string,            // siempre presente, hace explícito el límite
 *     sources:    string[],          // qué campos del timeline alimentaron
 *   }
 */

import { flags } from '../lib/flags.js';

const DAY = 86_400_000;

// ── Helpers de lectura defensiva sobre el timeline ─────────────────────────

function safeNumber(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function getProfileScore(timeline, scoreKey) {
    return safeNumber(timeline?.profile_current?.[scoreKey]);
}

function getSignal(timeline, signalId) {
    if (!Array.isArray(timeline?.signals_current)) return null;
    return timeline.signals_current.find(s => s?.signal_id === signalId) ?? null;
}

function daysSince(ts) {
    const n = safeNumber(ts);
    if (n === null) return null;
    return Math.floor((Date.now() - n) / DAY);
}

function hasUnresolvedRisk(timeline, riskType) {
    if (!Array.isArray(timeline?.risks)) return false;
    return timeline.risks.some(r =>
        r?.risk_type === riskType && (r?.resolved_at === null || r?.resolved_at === undefined));
}

function activeRecommendationsCount(timeline) {
    if (!Array.isArray(timeline?.recommendations)) return 0;
    return timeline.recommendations.filter(r =>
        r && (r.acknowledged === 0 || r.acknowledged === false)).length;
}

function signalsWithRealValueCount(timeline) {
    if (!Array.isArray(timeline?.signals_current)) return 0;
    return timeline.signals_current.filter(s =>
        s && typeof s.metric_value === 'number' && Number.isFinite(s.metric_value)).length;
}

// ── Templates (orden importa: el primero que matchea se prioriza para UI) ──

const TEMPLATES = Object.freeze([

    // INSUFFICIENT DATA — siempre PRIMERO. Si no hay profile, ningún otro
    // template debería disparar sin caveat.
    {
        id: 'insufficient_no_profile',
        condition: (t) => !t || t.profile_current === null || t.profile_current === undefined,
        render: () => ({
            id: 'insufficient_no_profile',
            kind: 'insufficient_data',
            headline: 'Datos insuficientes para generar un resumen longitudinal.',
            evidence: 'No hay snapshot de perfil de lectura para este lector aún.',
            confidence: 'low',
            caveat: 'Se necesita actividad lectora regular antes de poder observar patrones.',
            sources: ['profile_current'],
        }),
    },

    {
        id: 'insufficient_few_signals',
        condition: (t) => {
            // Solo dispara si HAY perfil pero pocas signals con valor real.
            if (t.profile_current === null || t.profile_current === undefined) return false;
            return signalsWithRealValueCount(t) < 3;
        },
        render: (t) => ({
            id: 'insufficient_few_signals',
            kind: 'insufficient_data',
            headline: 'Aún no hay suficiente actividad para observar patrones longitudinales.',
            evidence: `${signalsWithRealValueCount(t)} señales con valor; se sugiere mínimo 3 para resúmenes confiables.`,
            confidence: 'low',
            caveat: 'Más sesiones de lectura permitirán resúmenes más informativos.',
            sources: ['signals_current'],
        }),
    },

    // ATTENTION — riesgos activos y abandono. Tono claro pero observacional.
    {
        id: 'invisibility_prolonged',
        condition: (t) => hasUnresolvedRisk(t, 'invisibilidad_prolongada'),
        render: (t) => {
            const lastActive = getProfileScore(t, 'last_active_at');
            const days = lastActive !== null ? daysSince(lastActive) : null;
            return {
                id: 'invisibility_prolonged',
                kind: 'attention',
                headline: 'Sin actividad lectora reciente registrada.',
                evidence: days !== null
                    ? `Última actividad observada hace ${days} días.`
                    : 'Sin registro de actividad lectora reciente.',
                confidence: 'high',
                caveat: 'Considerar restablecer el vínculo lector. No implica diagnóstico de desinterés.',
                sources: ['risks', 'profile_current.last_active_at'],
            };
        },
    },

    {
        id: 'abandonment_risk_high',
        condition: (t) => {
            const risk = getProfileScore(t, 'abandono_risk');
            return risk !== null && risk > 0.6;
        },
        render: (t) => ({
            id: 'abandonment_risk_high',
            kind: 'attention',
            headline: 'Se observa riesgo de abandono temprano.',
            evidence: `Score de abandono observado: ${getProfileScore(t, 'abandono_risk').toFixed(2)}.`,
            confidence: 'medium',
            caveat: 'Score derivado de eventos recientes; conviene mediación pedagógica antes de conclusiones.',
            sources: ['profile_current.abandono_risk'],
        }),
    },

    {
        id: 'persistence_low',
        condition: (t) => {
            const p = getProfileScore(t, 'persistencia_score');
            return p !== null && p < 0.3;
        },
        render: (t) => ({
            id: 'persistence_low',
            kind: 'attention',
            headline: 'Se observan dificultades para sostener tareas lectoras.',
            evidence: `Score de persistencia observado: ${getProfileScore(t, 'persistencia_score').toFixed(2)}.`,
            confidence: 'medium',
            caveat: 'Persistencia es relación entre sesiones reanudadas/completadas y abandonos. No mide motivación interna.',
            sources: ['profile_current.persistencia_score'],
        }),
    },

    // POSITIVE — patrones favorables, también con caveat.
    {
        id: 'persistence_stable',
        condition: (t) => {
            const p = getProfileScore(t, 'persistencia_score');
            const lastActive = getProfileScore(t, 'last_active_at');
            const recentlyActive = lastActive !== null ? daysSince(lastActive) <= 14 : false;
            return p !== null && p > 0.6 && recentlyActive;
        },
        render: (t) => ({
            id: 'persistence_stable',
            kind: 'positive',
            headline: 'Persistencia estable en las últimas semanas.',
            evidence: `Score de persistencia observado: ${getProfileScore(t, 'persistencia_score').toFixed(2)} con actividad reciente.`,
            confidence: 'medium',
            caveat: 'Persistencia observada en métricas de plataforma. No implica garantía de comprensión.',
            sources: ['profile_current.persistencia_score', 'profile_current.last_active_at'],
        }),
    },

    {
        id: 'recovery_after_help',
        condition: (t) => {
            const mediacion = getSignal(t, 'mediacion_leo');
            const persistencia = getProfileScore(t, 'persistencia_score');
            const mediacionVal = safeNumber(mediacion?.metric_value);
            return mediacionVal !== null && mediacionVal >= 3
                && persistencia !== null && persistencia > 0.5;
        },
        render: (t) => {
            const mediacion = getSignal(t, 'mediacion_leo');
            return {
                id: 'recovery_after_help',
                kind: 'positive',
                headline: 'Se observó actividad lectora sostenida tras búsqueda frecuente de ayuda con Leo.',
                evidence: `${mediacion.metric_value} interacciones con Leo + persistencia ${getProfileScore(t, 'persistencia_score').toFixed(2)}.`,
                confidence: 'low',
                caveat: 'Correlación observada, no causalidad. Alta frecuencia de mediación puede tener múltiples interpretaciones.',
                sources: ['signals_current.mediacion_leo', 'profile_current.persistencia_score'],
            };
        },
    },

    {
        id: 'autonomy_growing',
        condition: (t) => {
            const a = getProfileScore(t, 'autonomia_score');
            return a !== null && a > 0.6;
        },
        render: (t) => ({
            id: 'autonomy_growing',
            kind: 'positive',
            headline: 'Se observan indicios de lectura más autónoma.',
            evidence: `Score de autonomía observado: ${getProfileScore(t, 'autonomia_score').toFixed(2)}.`,
            confidence: 'low',
            caveat: 'Autonomía observada por menor uso de ayudas. No implica nivel de comprensión.',
            sources: ['profile_current.autonomia_score'],
        }),
    },

    // OBSERVATION — patrones notables que no requieren acción urgente.
    {
        id: 'diversity_low',
        condition: (t) => {
            const d = getProfileScore(t, 'diversidad_score');
            return d !== null && d < 0.3;
        },
        render: (t) => ({
            id: 'diversity_low',
            kind: 'observation',
            headline: 'La variedad de contenidos leídos es baja.',
            evidence: `Score de diversidad observado: ${getProfileScore(t, 'diversidad_score').toFixed(2)} (rango 0-1).`,
            confidence: 'medium',
            caveat: 'Variedad observada en cantidad de contenidos distintos. No mide profundidad ni preferencia.',
            sources: ['profile_current.diversidad_score'],
        }),
    },

    {
        id: 'leo_emotional_observed',
        condition: (t) => {
            const emoc = getSignal(t, 'emocion_observada');
            const val = safeNumber(emoc?.metric_value);
            return val !== null && val > 0 && emoc?.confidence !== 'pending';
        },
        render: (t) => ({
            id: 'leo_emotional_observed',
            kind: 'observation',
            headline: 'Se observaron interacciones con Leo de carácter emocional.',
            evidence: 'Algunas interacciones del lector con Leo se clasificaron pedagógicamente como emocionales.',
            confidence: 'low',
            caveat: 'Observación de la clasificación de las interacciones. NO infiere emoción real del lector. NO usar para diagnóstico afectivo.',
            sources: ['signals_current.emocion_observada'],
        }),
    },

    // NEUTRAL — estado por defecto cuando todo está dentro de rangos esperados.
    {
        id: 'no_active_recommendations',
        condition: (t) => {
            // Solo dispara si HAY perfil y NO hay risks ni recommendations activas.
            if (t.profile_current === null || t.profile_current === undefined) return false;
            if (hasUnresolvedRisk(t, 'invisibilidad_prolongada')) return false;
            return activeRecommendationsCount(t) === 0;
        },
        render: () => ({
            id: 'no_active_recommendations',
            kind: 'neutral',
            headline: 'No hay recomendaciones pendientes activas para este lector.',
            evidence: 'Sin recomendaciones marcadas como pendientes en la cola.',
            confidence: 'high',
            caveat: 'Estado puntual — puede cambiar tras la próxima ejecución del motor pedagógico.',
            sources: ['recommendations'],
        }),
    },
]);

/**
 * Lista pública de IDs de templates — útil para tests + introspección UI.
 */
export const TEMPLATE_IDS = Object.freeze(TEMPLATES.map(t => t.id));

// ──────────────────────────────────────────────────────────────────────────
// FASE 3B — cohort-scope templates.
//
// Mismo patrón de templates determinísticos pero sobre datos AGREGADOS de un
// cohort (grupo / curso / club / cohort behavioral). Input shape:
//
//   cohortData = {
//     scope:        { type, id },
//     sample_size:  number,            // miembros activos del cohort
//     metrics:      [{ metric_key, metric_value, trend, delta_vs_global }],
//     period:       string,            // '28d' por default
//   }
//
// El consumidor real (operationalRouter en futuras fases) ya devuelve este
// shape via `reader.getCohortComparison()`. Por eso podemos reusar sin tocar
// el reader.
//
// Gated por flag separado: `AULA_VIVA_COHORT_SUMMARIES_ENABLED` (default OFF).
// ──────────────────────────────────────────────────────────────────────────

function _getCohortMetric(cohortData, metricKey) {
    if (!Array.isArray(cohortData?.metrics)) return null;
    const m = cohortData.metrics.find(x => x?.metric_key === metricKey);
    return m ?? null;
}

function _cohortSampleSize(cohortData) {
    if (typeof cohortData?.sample_size === 'number' && Number.isFinite(cohortData.sample_size)) {
        return cohortData.sample_size;
    }
    return 0;
}

const COHORT_TEMPLATES = Object.freeze([

    // INSUFFICIENT — primero. Cohort con muy pocos miembros no permite agregados.
    {
        id: 'insufficient_cohort_data',
        condition: (c) => !c || _cohortSampleSize(c) < 5,
        render: (c) => ({
            id: 'insufficient_cohort_data',
            kind: 'insufficient_data',
            headline: 'Tamaño de cohorte insuficiente para observar patrones colectivos.',
            evidence: `Cohorte con ${_cohortSampleSize(c)} miembros (mínimo 5 sugerido para agregados confiables).`,
            confidence: 'low',
            caveat: 'Con cohortes pequeñas, métricas individuales tienen más peso que tendencias colectivas. Conviene observar caso por caso.',
            sources: ['cohort.sample_size'],
        }),
    },

    // ATTENTION colectivo — abandono o baja persistencia agregada.
    {
        id: 'cohort_low_persistence',
        condition: (c) => {
            if (_cohortSampleSize(c) < 5) return false;
            const m = _getCohortMetric(c, 'persistencia_score');
            return safeNumber(m?.metric_value) !== null && m.metric_value < 0.4;
        },
        render: (c) => {
            const m = _getCohortMetric(c, 'persistencia_score');
            return {
                id: 'cohort_low_persistence',
                kind: 'attention',
                headline: 'La cohorte muestra dificultades colectivas para sostener tareas lectoras.',
                evidence: `Persistencia promedio observada: ${m.metric_value.toFixed(2)} sobre ${_cohortSampleSize(c)} miembros.`,
                confidence: 'medium',
                caveat: 'Persistencia agregada NO identifica estudiantes específicos. Conviene revisar timelines individuales antes de intervención colectiva.',
                sources: ['cohort.metrics.persistencia_score', 'cohort.sample_size'],
            };
        },
    },

    // POSITIVE colectivo — patrones de recuperación / persistencia creciente.
    {
        id: 'cohort_recovery_collective',
        condition: (c) => {
            if (_cohortSampleSize(c) < 5) return false;
            const recovery = _getCohortMetric(c, 'recuperacion_tras_abandono');
            const persistence = _getCohortMetric(c, 'persistencia_score');
            const recoveryUp  = recovery?.trend === 'up' && safeNumber(recovery?.metric_value) !== null && recovery.metric_value >= 0.4;
            const persistenceUp = persistence?.trend === 'up' && safeNumber(persistence?.metric_value) !== null && persistence.metric_value >= 0.5;
            return recoveryUp || persistenceUp;
        },
        render: (c) => {
            const recovery = _getCohortMetric(c, 'recuperacion_tras_abandono');
            const persistence = _getCohortMetric(c, 'persistencia_score');
            const driver = recovery?.trend === 'up' ? 'recuperación' : 'persistencia';
            return {
                id: 'cohort_recovery_collective',
                kind: 'positive',
                headline: 'Se observa una tendencia colectiva de recuperación en la cohorte.',
                evidence: `Métrica de ${driver} en tendencia creciente sobre ${_cohortSampleSize(c)} miembros.`,
                confidence: 'low',
                caveat: 'Tendencia agregada — puede ocultar variación individual. Conviene contrastar con casos puntuales.',
                sources: ['cohort.metrics.recuperacion_tras_abandono', 'cohort.metrics.persistencia_score'],
            };
        },
    },

    {
        id: 'cohort_persistence_growing',
        condition: (c) => {
            if (_cohortSampleSize(c) < 5) return false;
            const m = _getCohortMetric(c, 'persistencia_score');
            return safeNumber(m?.metric_value) !== null && m.metric_value >= 0.6 && m.trend === 'up';
        },
        render: (c) => {
            const m = _getCohortMetric(c, 'persistencia_score');
            return {
                id: 'cohort_persistence_growing',
                kind: 'positive',
                headline: 'La cohorte muestra persistencia creciente.',
                evidence: `Persistencia promedio observada: ${m.metric_value.toFixed(2)} con tendencia ascendente sobre ${_cohortSampleSize(c)} miembros.`,
                confidence: 'medium',
                caveat: 'Persistencia es relación entre sesiones sostenidas y abandonos. NO implica medición de comprensión colectiva.',
                sources: ['cohort.metrics.persistencia_score'],
            };
        },
    },

    // OBSERVATION colectiva — concentración de mediación Leo en la cohorte.
    {
        id: 'cohort_help_seeking_concentrated',
        condition: (c) => {
            if (_cohortSampleSize(c) < 5) return false;
            const m = _getCohortMetric(c, 'mediacion_leo');
            return safeNumber(m?.metric_value) !== null && m.metric_value >= 5;
        },
        render: (c) => {
            const m = _getCohortMetric(c, 'mediacion_leo');
            return {
                id: 'cohort_help_seeking_concentrated',
                kind: 'observation',
                headline: 'Alta solicitud agregada de mediación con Leo en la cohorte.',
                evidence: `Promedio observado: ${m.metric_value.toFixed(2)} interacciones por miembro sobre ${_cohortSampleSize(c)}.`,
                confidence: 'low',
                caveat: 'Alta mediación NO implica baja autonomía colectiva — puede reflejar exploración activa. Conviene observar contexto pedagógico.',
                sources: ['cohort.metrics.mediacion_leo'],
            };
        },
    },
]);

export const COHORT_TEMPLATE_IDS = Object.freeze(COHORT_TEMPLATES.map(t => t.id));

/**
 * Genera summaries para un cohort. Defensivo + flag-gated separado.
 *
 * @param {object|null} cohortData      Salida de reader.getCohortComparison() o equivalente.
 * @param {object} [opts]
 * @param {boolean} [opts.skipFlagCheck=false]
 * @returns {Array<object>}
 */
export function generateCohortSummaries(cohortData, opts = {}) {
    if (!opts.skipFlagCheck) {
        try {
            if (!flags.aulaVivaCohortSummariesEnabled()) return [];
        } catch { return []; }
    }
    if (!cohortData || typeof cohortData !== 'object') return [];

    const summaries = [];
    for (const t of COHORT_TEMPLATES) {
        try {
            if (t.condition(cohortData)) {
                summaries.push(Object.freeze(t.render(cohortData)));
            }
        } catch { /* template aislado */ }
    }
    return summaries;
}

/**
 * Genera el array de Summaries para un timeline. Defensivo:
 *   - sin flag → []
 *   - sin timeline → []
 *   - template throw → se aísla (cae al siguiente)
 *
 * @param {object|null} timeline   Salida de reader.getProfileTimeline()
 * @param {object} [opts]
 * @param {boolean} [opts.skipFlagCheck=false]  Para tests; true bypasea el flag.
 * @returns {Array<object>}
 */
export function generateLongitudinalSummaries(timeline, opts = {}) {
    if (!opts.skipFlagCheck) {
        try {
            if (!flags.aulaVivaLongitudinalSummaryEnabled()) return [];
        } catch { return []; }
    }
    if (!timeline || typeof timeline !== 'object') return [];

    const summaries = [];
    for (const t of TEMPLATES) {
        try {
            if (t.condition(timeline)) {
                summaries.push(Object.freeze(t.render(timeline)));
            }
        } catch { /* template malformado → aislar, no afecta resto */ }
    }
    return summaries;
}
