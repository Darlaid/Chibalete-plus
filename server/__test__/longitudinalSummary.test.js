/**
 * longitudinalSummary.test.js — Fase 3A Aula Viva Operacional.
 *
 * Cubre el engine determinístico de summaries longitudinales:
 *
 *   §1  flag OFF → siempre []
 *   §2  insufficient_no_profile dispara antes que cualquier otro
 *   §3  insufficient_few_signals con perfil + <3 signals
 *   §4  invisibility_prolonged desde risks no resueltos
 *   §5  abandonment_risk_high desde profile_current.abandono_risk
 *   §6  persistence_low (< 0.3) y persistence_stable (> 0.6 + activo)
 *   §7  recovery_after_help (mediacion_leo ≥ 3 + persistencia > 0.5)
 *   §8  autonomy_growing, diversity_low
 *   §9  leo_emotional_observed con caveat máximo
 *  §10  no_active_recommendations en ausencia de riesgos
 *  §11  determinístico: mismo input → mismo output
 *  §12  defensa: input malformado, throws aislados
 *  §13  todo summary tiene confidence + caveat + sources + headline
 *  §14  ningún summary contiene PII (texto libre, nombres, respuestas)
 *  §15  TEMPLATE_IDS expuesto y consistente con summaries generados
 *
 *   node server/__test__/longitudinalSummary.test.js
 */

import { generateLongitudinalSummaries, TEMPLATE_IDS } from '../services/longitudinalSummary.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

const skipFlag = { skipFlagCheck: true };

function buildTimeline(overrides = {}) {
    const base = {
        user_id: 'u',
        profile_current: {
            fluidez_score: 0.5, persistencia_score: 0.5, autonomia_score: 0.5,
            concentracion_score: 0.5, diversidad_score: 0.5, engagement_score: 0.5,
            abandono_risk: 0.3,
            last_active_at: Date.now() - 2 * 86_400_000,  // 2 días
        },
        signals_current: [
            { signal_id: 'continuidad_semanal',   metric_value: 0.5, confidence: 'medium', updated_at: Date.now() },
            { signal_id: 'tiempo_efectivo_lectura', metric_value: 30, confidence: 'high',   updated_at: Date.now() },
            { signal_id: 'diversidad_lectora',   metric_value: 3,   confidence: 'medium', updated_at: Date.now() },
        ],
        risks: [],
        recommendations: [],
    };
    return { ...base, ...overrides };
}

// ── §1: flag OFF ───────────────────────────────────────────────────────────
section('[1] flag OFF — siempre []');
{
    delete process.env.AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED;
    const t = buildTimeline();
    const out = generateLongitudinalSummaries(t);    // sin skipFlagCheck
    ok('flag OFF + timeline válido → []', Array.isArray(out) && out.length === 0);

    process.env.AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED = '1';
    const out2 = generateLongitudinalSummaries(t);
    ok('flag ON + timeline válido → summaries no vacío',
       Array.isArray(out2) && out2.length > 0);
    delete process.env.AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED;
}

// ── §2: insufficient_no_profile prioridad ──────────────────────────────────
section('[2] insufficient_no_profile dispara cuando no hay perfil');
{
    const cases = [
        { profile_current: null },
        { profile_current: undefined },
    ];
    for (const c of cases) {
        const t = buildTimeline(c);
        const out = generateLongitudinalSummaries(t, skipFlag);
        const ids = out.map(s => s.id);
        ok(`profile=${c.profile_current === null ? 'null' : 'undefined'} → contiene insufficient_no_profile`,
           ids.includes('insufficient_no_profile'));
        ok('insufficient_no_profile kind=insufficient_data',
           out.find(s => s.id === 'insufficient_no_profile')?.kind === 'insufficient_data');
    }
    // null timeline directamente
    ok('null timeline → []',          generateLongitudinalSummaries(null, skipFlag).length === 0);
    ok('undefined timeline → []',     generateLongitudinalSummaries(undefined, skipFlag).length === 0);
    ok('string timeline → []',        generateLongitudinalSummaries('not an object', skipFlag).length === 0);
}

// ── §3: insufficient_few_signals ───────────────────────────────────────────
section('[3] insufficient_few_signals con <3 signals con valor real');
{
    const t = buildTimeline({
        signals_current: [
            { signal_id: 'continuidad_semanal', metric_value: 0.5, confidence: 'medium' },
            { signal_id: 'tiempo_efectivo_lectura', metric_value: null, confidence: 'pending' },  // null no cuenta
            { signal_id: 'persistencia', metric_value: 'not_a_number' },                          // no cuenta
        ],
    });
    const out = generateLongitudinalSummaries(t, skipFlag);
    const ids = out.map(s => s.id);
    ok('1 signal con valor real → dispara insufficient_few_signals',
       ids.includes('insufficient_few_signals'));
}

// ── §4: invisibility_prolonged ─────────────────────────────────────────────
section('[4] invisibility_prolonged desde risks');
{
    const t = buildTimeline({
        risks: [{ risk_type: 'invisibilidad_prolongada', resolved_at: null }],
        profile_current: { ...buildTimeline().profile_current, last_active_at: Date.now() - 21 * 86_400_000 },
    });
    const out = generateLongitudinalSummaries(t, skipFlag);
    const summary = out.find(s => s.id === 'invisibility_prolonged');
    ok('dispara invisibility_prolonged',        !!summary);
    ok('kind === attention',                    summary?.kind === 'attention');
    ok('confidence === high',                   summary?.confidence === 'high');
    ok('evidence menciona días',                /\d+ días/.test(summary?.evidence || ''));
    ok('caveat presente',                       summary?.caveat && summary.caveat.length > 0);
    ok('sources incluye risks',                 (summary?.sources || []).includes('risks'));

    // Si está resuelto, NO dispara
    const t2 = buildTimeline({
        risks: [{ risk_type: 'invisibilidad_prolongada', resolved_at: Date.now() }],
    });
    const out2 = generateLongitudinalSummaries(t2, skipFlag);
    ok('riesgo RESUELTO → NO dispara invisibility_prolonged',
       !out2.find(s => s.id === 'invisibility_prolonged'));
}

// ── §5: abandonment_risk_high ──────────────────────────────────────────────
section('[5] abandonment_risk_high cuando abandono_risk > 0.6');
{
    const t = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, abandono_risk: 0.75 },
    });
    const out = generateLongitudinalSummaries(t, skipFlag);
    const summary = out.find(s => s.id === 'abandonment_risk_high');
    ok('dispara abandonment_risk_high',         !!summary);
    ok('kind === attention',                    summary?.kind === 'attention');
    ok('evidence muestra score',                /0\.75/.test(summary?.evidence || ''));

    // Threshold: 0.6 NO dispara (>, no >=)
    const t2 = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, abandono_risk: 0.6 },
    });
    const out2 = generateLongitudinalSummaries(t2, skipFlag);
    ok('abandono_risk = 0.6 NO dispara',        !out2.find(s => s.id === 'abandonment_risk_high'));
}

// ── §6: persistence_low / persistence_stable ──────────────────────────────
section('[6] persistence_low y persistence_stable');
{
    // low
    const tLow = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, persistencia_score: 0.2 },
    });
    const outLow = generateLongitudinalSummaries(tLow, skipFlag);
    ok('persistencia 0.2 → dispara persistence_low',
       outLow.some(s => s.id === 'persistence_low'));
    // stable
    const tStable = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, persistencia_score: 0.75 },
    });
    const outStable = generateLongitudinalSummaries(tStable, skipFlag);
    ok('persistencia 0.75 + reciente → dispara persistence_stable',
       outStable.some(s => s.id === 'persistence_stable'));
    ok('persistence_stable kind=positive',
       outStable.find(s => s.id === 'persistence_stable')?.kind === 'positive');
    // stable pero hace mucho tiempo NO dispara
    const tOld = buildTimeline({
        profile_current: {
            ...buildTimeline().profile_current,
            persistencia_score: 0.75,
            last_active_at: Date.now() - 30 * 86_400_000,
        },
    });
    const outOld = generateLongitudinalSummaries(tOld, skipFlag);
    ok('persistencia 0.75 pero inactivo >14d → NO dispara persistence_stable',
       !outOld.some(s => s.id === 'persistence_stable'));
}

// ── §7: recovery_after_help ────────────────────────────────────────────────
section('[7] recovery_after_help — mediacion_leo + persistencia');
{
    const t = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, persistencia_score: 0.6 },
        signals_current: [
            ...buildTimeline().signals_current,
            { signal_id: 'mediacion_leo', metric_value: 5, confidence: 'medium' },
        ],
    });
    const out = generateLongitudinalSummaries(t, skipFlag);
    const summary = out.find(s => s.id === 'recovery_after_help');
    ok('dispara recovery_after_help',          !!summary);
    ok('caveat menciona "correlación, no causalidad"', /[Cc]orrelación/.test(summary?.caveat || ''));
}

// ── §8: autonomy_growing / diversity_low ──────────────────────────────────
section('[8] autonomy_growing y diversity_low');
{
    const tAuto = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, autonomia_score: 0.75 },
    });
    ok('autonomia 0.75 → dispara autonomy_growing',
       generateLongitudinalSummaries(tAuto, skipFlag).some(s => s.id === 'autonomy_growing'));

    const tDiv = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, diversidad_score: 0.15 },
    });
    ok('diversidad 0.15 → dispara diversity_low',
       generateLongitudinalSummaries(tDiv, skipFlag).some(s => s.id === 'diversity_low'));
}

// ── §9: leo_emotional_observed ────────────────────────────────────────────
section('[9] leo_emotional_observed con caveat máximo');
{
    const t = buildTimeline({
        signals_current: [
            ...buildTimeline().signals_current,
            { signal_id: 'emocion_observada', metric_value: 0.15, confidence: 'low' },
        ],
    });
    const summary = generateLongitudinalSummaries(t, skipFlag).find(s => s.id === 'leo_emotional_observed');
    ok('dispara leo_emotional_observed',       !!summary);
    ok('caveat máximo: menciona "NO infiere emoción"',
       /NO infiere emoción/.test(summary?.caveat || ''));
    ok('caveat máximo: menciona "NO usar para diagnóstico afectivo"',
       /NO usar para diagnóstico afectivo/.test(summary?.caveat || ''));

    // confidence=pending NO dispara
    const t2 = buildTimeline({
        signals_current: [
            ...buildTimeline().signals_current,
            { signal_id: 'emocion_observada', metric_value: 0.3, confidence: 'pending' },
        ],
    });
    ok('confidence=pending NO dispara emotional',
       !generateLongitudinalSummaries(t2, skipFlag).some(s => s.id === 'leo_emotional_observed'));
}

// ── §10: no_active_recommendations ────────────────────────────────────────
section('[10] no_active_recommendations en ausencia de riesgos');
{
    const t = buildTimeline({ recommendations: [] });
    const out = generateLongitudinalSummaries(t, skipFlag);
    ok('sin recommendations + sin riesgos → dispara no_active_recommendations',
       out.some(s => s.id === 'no_active_recommendations'));

    // Si hay recommendations pendientes, NO dispara
    const t2 = buildTimeline({
        recommendations: [{ recommendation_id: 'r1', acknowledged: 0 }],
    });
    ok('recommendation pendiente → NO dispara no_active_recommendations',
       !generateLongitudinalSummaries(t2, skipFlag).some(s => s.id === 'no_active_recommendations'));

    // recommendations ya acknowledged sí permite que dispare
    const t3 = buildTimeline({
        recommendations: [{ recommendation_id: 'r1', acknowledged: 1 }],
    });
    ok('todas acknowledged → SÍ dispara no_active_recommendations',
       generateLongitudinalSummaries(t3, skipFlag).some(s => s.id === 'no_active_recommendations'));
}

// ── §11: determinismo ──────────────────────────────────────────────────────
section('[11] determinístico: mismo input → mismo output');
{
    const t = buildTimeline({
        profile_current: { ...buildTimeline().profile_current, abandono_risk: 0.7, persistencia_score: 0.7 },
    });
    const a = generateLongitudinalSummaries(t, skipFlag);
    const b = generateLongitudinalSummaries(t, skipFlag);
    ok('llamados idénticos → mismo número de summaries', a.length === b.length);
    ok('mismos IDs en mismo orden', JSON.stringify(a.map(s => s.id)) === JSON.stringify(b.map(s => s.id)));
}

// ── §12: defensa contra input malformado ──────────────────────────────────
section('[12] defensa contra input malformado');
{
    const cases = [
        buildTimeline({ signals_current: 'not-an-array' }),
        buildTimeline({ risks: { bad: 'shape' } }),
        buildTimeline({ recommendations: undefined }),
        buildTimeline({ profile_current: { abandono_risk: 'not_a_number' } }),
        buildTimeline({ profile_current: {} }),  // sin scores
    ];
    for (const t of cases) {
        let threw = false;
        try { generateLongitudinalSummaries(t, skipFlag); } catch { threw = true; }
        ok('input raro → NO throw', threw === false);
    }
}

// ── §13: shape mínimo de cada summary ─────────────────────────────────────
section('[13] cada summary tiene campos obligatorios');
{
    // forzamos varios summaries simultáneos
    const t = buildTimeline({
        profile_current: {
            ...buildTimeline().profile_current,
            persistencia_score: 0.75, autonomia_score: 0.7, diversidad_score: 0.15,
            abandono_risk: 0.7,
        },
        risks: [{ risk_type: 'invisibilidad_prolongada', resolved_at: null }],
    });
    const out = generateLongitudinalSummaries(t, skipFlag);
    ok('hay al menos 3 summaries en escenario complejo', out.length >= 3);
    for (const s of out) {
        ok(`'${s.id}': id string`,                         typeof s.id === 'string' && s.id.length > 0);
        ok(`'${s.id}': kind ∈ enum`,
           ['insufficient_data', 'attention', 'positive', 'observation', 'neutral'].includes(s.kind));
        ok(`'${s.id}': headline string corto`,             typeof s.headline === 'string' && s.headline.length > 0 && s.headline.length < 300);
        ok(`'${s.id}': evidence string`,                   typeof s.evidence === 'string' && s.evidence.length > 0);
        ok(`'${s.id}': confidence ∈ {low,medium,high}`,    ['low', 'medium', 'high'].includes(s.confidence));
        ok(`'${s.id}': caveat string no vacío`,            typeof s.caveat === 'string' && s.caveat.length > 0);
        ok(`'${s.id}': sources es array de strings`,       Array.isArray(s.sources) && s.sources.every(x => typeof x === 'string'));
        ok(`'${s.id}': frozen (inmutable)`,                Object.isFrozen(s));
    }
}

// ── §14: sin PII ───────────────────────────────────────────────────────────
section('[14] summaries NO contienen PII');
{
    // Si por error el profile incluye nombres/email del estudiante, NO debe propagarse.
    const t = buildTimeline({
        profile_current: {
            ...buildTimeline().profile_current,
            persistencia_score: 0.2,
            user_name: 'Juan Pérez',         // si llegara por error
            user_email: 'juan@example.com',
        },
        signals_current: [
            ...buildTimeline().signals_current,
            { signal_id: 'mediacion_leo', metric_value: 5, confidence: 'medium',
              meta: { last_message: 'cómo se llama el protagonista' } },
        ],
    });
    const out = generateLongitudinalSummaries(t, skipFlag);
    const allText = JSON.stringify(out);
    const banned = ['Juan Pérez', 'juan@example.com', 'cómo se llama', 'protagonista',
                    'user_name', 'user_email', 'last_message'];
    for (const word of banned) {
        ok(`ningún summary contiene "${word}"`, !allText.includes(word));
    }
    // Vocabulario observacional: NO afirmaciones de comprensión
    const forbidden = ['comprende perfectamente', 'sabe leer', 'es un buen lector',
                       'fracasa', 'tiene problemas de'];
    for (const phrase of forbidden) {
        ok(`ningún summary afirma "${phrase}"`, !allText.toLowerCase().includes(phrase.toLowerCase()));
    }
}

// ── §15: TEMPLATE_IDS expuesto ────────────────────────────────────────────
section('[15] TEMPLATE_IDS expuesto y consistente');
{
    ok('TEMPLATE_IDS array no vacío',          Array.isArray(TEMPLATE_IDS) && TEMPLATE_IDS.length > 0);
    ok('TEMPLATE_IDS es Object.freeze',         Object.isFrozen(TEMPLATE_IDS));
    ok('TEMPLATE_IDS contiene insufficient_no_profile',
       TEMPLATE_IDS.includes('insufficient_no_profile'));
    ok('TEMPLATE_IDS contiene invisibility_prolonged',
       TEMPLATE_IDS.includes('invisibility_prolonged'));
    ok('TEMPLATE_IDS contiene leo_emotional_observed',
       TEMPLATE_IDS.includes('leo_emotional_observed'));

    // Todos los summaries generados tienen su id en TEMPLATE_IDS
    const t = buildTimeline();
    const out = generateLongitudinalSummaries(t, skipFlag);
    for (const s of out) {
        ok(`generated.${s.id} está en TEMPLATE_IDS`, TEMPLATE_IDS.includes(s.id));
    }
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
