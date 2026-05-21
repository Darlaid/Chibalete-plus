/**
 * cohortLongitudinalSummary.test.js — Fase 3B.
 *
 * Cubre `generateCohortSummaries`:
 *
 *   §1  flag OFF → []
 *   §2  cohort con sample_size < 5 → solo insufficient_cohort_data
 *   §3  cohort_low_persistence dispara con persistencia < 0.4
 *   §4  cohort_persistence_growing con persistencia ≥ 0.6 trend=up
 *   §5  cohort_recovery_collective con recovery o persistence en up
 *   §6  cohort_help_seeking_concentrated con mediacion_leo ≥ 5
 *   §7  insufficient_cohort_data tiene caveat de variabilidad individual
 *   §8  determinismo: mismo input → mismo output
 *   §9  defensa: null, malformed, sample_size 0
 *  §10  cada summary frozen + tiene campos requeridos
 *  §11  COHORT_TEMPLATE_IDS expuesto
 *  §12  ningún summary contiene vocabulario afirmativo prohibido
 *
 *   node server/__test__/cohortLongitudinalSummary.test.js
 */

import {
    generateCohortSummaries,
    COHORT_TEMPLATE_IDS,
} from '../services/longitudinalSummary.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

const skipFlag = { skipFlagCheck: true };

function buildCohort(overrides = {}) {
    const base = {
        scope: { type: 'group', id: 'g1' },
        sample_size: 12,
        period: '28d',
        metrics: [
            { metric_key: 'persistencia_score', metric_value: 0.5, trend: 'flat' },
            { metric_key: 'continuidad_semanal', metric_value: 0.45, trend: 'flat' },
        ],
    };
    return { ...base, ...overrides };
}

// ── §1: flag OFF ───────────────────────────────────────────────────────────
section('[1] flag OFF — siempre []');
{
    delete process.env.AULA_VIVA_COHORT_SUMMARIES_ENABLED;
    const out = generateCohortSummaries(buildCohort());
    ok('flag OFF → []', Array.isArray(out) && out.length === 0);

    process.env.AULA_VIVA_COHORT_SUMMARIES_ENABLED = '1';
    const out2 = generateCohortSummaries(buildCohort());
    ok('flag ON → array no vacío (o vacío sin templates aplicables)', Array.isArray(out2));
    delete process.env.AULA_VIVA_COHORT_SUMMARIES_ENABLED;
}

// ── §2: sample_size < 5 → insufficient_cohort_data ────────────────────────
section('[2] cohort con sample_size < 5 → insufficient');
{
    for (const n of [0, 1, 3, 4]) {
        const c = buildCohort({ sample_size: n });
        const out = generateCohortSummaries(c, skipFlag);
        ok(`sample_size=${n} → contiene insufficient_cohort_data`,
           out.some(s => s.id === 'insufficient_cohort_data'));
        ok(`sample_size=${n} → kind=insufficient_data`,
           out.find(s => s.id === 'insufficient_cohort_data')?.kind === 'insufficient_data');
        // Cuando sample_size < 5, los demás templates NO disparan (gate de cada uno)
        ok(`sample_size=${n} → NO dispara templates con datos pesados`,
           !out.some(s => s.id === 'cohort_persistence_growing'));
    }
}

// ── §3: cohort_low_persistence ─────────────────────────────────────────────
section('[3] cohort_low_persistence con persistencia < 0.4');
{
    const c = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'persistencia_score', metric_value: 0.25, trend: 'flat' }],
    });
    const out = generateCohortSummaries(c, skipFlag);
    const s = out.find(x => x.id === 'cohort_low_persistence');
    ok('dispara cohort_low_persistence',         !!s);
    ok('kind === attention',                     s?.kind === 'attention');
    ok('evidence menciona persistencia 0.25',    /0\.25/.test(s?.evidence || ''));
    ok('caveat menciona NO identifica estudiantes', /NO identifica estudiantes/.test(s?.caveat || ''));
}

// ── §4: cohort_persistence_growing ─────────────────────────────────────────
section('[4] cohort_persistence_growing con score ≥ 0.6 + trend up');
{
    const c = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'persistencia_score', metric_value: 0.72, trend: 'up' }],
    });
    const out = generateCohortSummaries(c, skipFlag);
    const s = out.find(x => x.id === 'cohort_persistence_growing');
    ok('dispara cohort_persistence_growing',  !!s);
    ok('kind === positive',                   s?.kind === 'positive');

    // Trend flat NO dispara
    const c2 = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'persistencia_score', metric_value: 0.72, trend: 'flat' }],
    });
    ok('trend=flat NO dispara persistence_growing',
       !generateCohortSummaries(c2, skipFlag).some(x => x.id === 'cohort_persistence_growing'));
}

// ── §5: cohort_recovery_collective ─────────────────────────────────────────
section('[5] cohort_recovery_collective con recovery o persistence up');
{
    const cRec = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'recuperacion_tras_abandono', metric_value: 0.5, trend: 'up' }],
    });
    ok('recovery up + value ≥ 0.4 → dispara',
       generateCohortSummaries(cRec, skipFlag).some(x => x.id === 'cohort_recovery_collective'));

    const cPers = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'persistencia_score', metric_value: 0.6, trend: 'up' }],
    });
    ok('persistence up + value ≥ 0.5 → dispara',
       generateCohortSummaries(cPers, skipFlag).some(x => x.id === 'cohort_recovery_collective'));

    const cFlat = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'recuperacion_tras_abandono', metric_value: 0.5, trend: 'flat' }],
    });
    ok('trend=flat NO dispara recovery_collective',
       !generateCohortSummaries(cFlat, skipFlag).some(x => x.id === 'cohort_recovery_collective'));
}

// ── §6: cohort_help_seeking_concentrated ──────────────────────────────────
section('[6] cohort_help_seeking_concentrated con mediacion_leo ≥ 5');
{
    const c = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'mediacion_leo', metric_value: 7.5, trend: 'up' }],
    });
    const out = generateCohortSummaries(c, skipFlag);
    const s = out.find(x => x.id === 'cohort_help_seeking_concentrated');
    ok('dispara cohort_help_seeking_concentrated', !!s);
    ok('kind === observation',                     s?.kind === 'observation');
    ok('caveat menciona NO implica baja autonomía', /NO implica baja autonomía/.test(s?.caveat || ''));

    // < 5 NO dispara
    const c2 = buildCohort({
        sample_size: 15,
        metrics: [{ metric_key: 'mediacion_leo', metric_value: 3, trend: 'flat' }],
    });
    ok('mediacion_leo = 3 NO dispara',
       !generateCohortSummaries(c2, skipFlag).some(x => x.id === 'cohort_help_seeking_concentrated'));
}

// ── §7: insufficient_cohort_data tiene caveat correcto ────────────────────
section('[7] insufficient_cohort_data caveat de variabilidad individual');
{
    const out = generateCohortSummaries(buildCohort({ sample_size: 2 }), skipFlag);
    const s = out.find(x => x.id === 'insufficient_cohort_data');
    ok('caveat menciona "caso por caso"', /caso por caso/i.test(s?.caveat || ''));
}

// ── §8: determinismo ──────────────────────────────────────────────────────
section('[8] determinístico');
{
    const c = buildCohort({
        sample_size: 15,
        metrics: [
            { metric_key: 'persistencia_score', metric_value: 0.7, trend: 'up' },
            { metric_key: 'mediacion_leo',      metric_value: 6,   trend: 'flat' },
        ],
    });
    const a = generateCohortSummaries(c, skipFlag);
    const b = generateCohortSummaries(c, skipFlag);
    ok('mismo input → mismo output',
       JSON.stringify(a.map(s => s.id)) === JSON.stringify(b.map(s => s.id)));
}

// ── §9: defensa contra input malformado ───────────────────────────────────
section('[9] defensa contra input malformado');
{
    const cases = [
        null, undefined, 'string', 0, [],
        { scope: 'malformed' },
        { sample_size: 'not_a_number', metrics: [] },
        { sample_size: 15, metrics: 'not_an_array' },
        { sample_size: 15, metrics: [{ metric_key: 'x', metric_value: 'NaN', trend: null }] },
    ];
    for (const c of cases) {
        let threw = false;
        try { generateCohortSummaries(c, skipFlag); } catch { threw = true; }
        ok(`input raro → NO throw`, threw === false);
    }
}

// ── §10: cada summary tiene campos requeridos + frozen ────────────────────
section('[10] cada summary frozen + campos requeridos');
{
    // Escenario complejo que dispara varios
    const c = buildCohort({
        sample_size: 20,
        metrics: [
            { metric_key: 'persistencia_score',         metric_value: 0.72, trend: 'up' },
            { metric_key: 'recuperacion_tras_abandono', metric_value: 0.55, trend: 'up' },
            { metric_key: 'mediacion_leo',              metric_value: 8,    trend: 'up' },
        ],
    });
    const out = generateCohortSummaries(c, skipFlag);
    ok('al menos 2 summaries en escenario rico', out.length >= 2);

    for (const s of out) {
        ok(`'${s.id}': Object.isFrozen`,                Object.isFrozen(s));
        ok(`'${s.id}': id string`,                      typeof s.id === 'string');
        ok(`'${s.id}': kind ∈ enum`,
           ['insufficient_data', 'attention', 'positive', 'observation', 'neutral'].includes(s.kind));
        ok(`'${s.id}': headline string`,                typeof s.headline === 'string' && s.headline.length > 0);
        ok(`'${s.id}': evidence string`,                typeof s.evidence === 'string');
        ok(`'${s.id}': confidence ∈ {low,medium,high}`, ['low', 'medium', 'high'].includes(s.confidence));
        ok(`'${s.id}': caveat string no vacío`,         typeof s.caveat === 'string' && s.caveat.length > 0);
        ok(`'${s.id}': sources es array`,               Array.isArray(s.sources));
    }
}

// ── §11: COHORT_TEMPLATE_IDS expuesto ─────────────────────────────────────
section('[11] COHORT_TEMPLATE_IDS expuesto');
{
    ok('array no vacío',           Array.isArray(COHORT_TEMPLATE_IDS) && COHORT_TEMPLATE_IDS.length > 0);
    ok('frozen',                   Object.isFrozen(COHORT_TEMPLATE_IDS));
    ok('contiene insufficient_cohort_data', COHORT_TEMPLATE_IDS.includes('insufficient_cohort_data'));
    ok('contiene cohort_low_persistence',   COHORT_TEMPLATE_IDS.includes('cohort_low_persistence'));
    ok('contiene cohort_recovery_collective', COHORT_TEMPLATE_IDS.includes('cohort_recovery_collective'));
    ok('contiene cohort_help_seeking_concentrated', COHORT_TEMPLATE_IDS.includes('cohort_help_seeking_concentrated'));
    ok('contiene cohort_persistence_growing', COHORT_TEMPLATE_IDS.includes('cohort_persistence_growing'));
}

// ── §12: sin vocabulario prohibido ────────────────────────────────────────
section('[12] sin afirmaciones prohibidas / ranking / shaming');
{
    const c = buildCohort({
        sample_size: 20,
        metrics: [
            { metric_key: 'persistencia_score', metric_value: 0.2, trend: 'down' },
            { metric_key: 'mediacion_leo',      metric_value: 8,   trend: 'up' },
        ],
    });
    const out = generateCohortSummaries(c, skipFlag);
    const allText = JSON.stringify(out).toLowerCase();
    const forbidden = [
        'mejor grupo', 'peor grupo', 'ranking',
        'fracasa', 'es un mal grupo', 'son malos lectores',
        'rank', 'top-5', 'bottom-',
    ];
    for (const phrase of forbidden) {
        ok(`NO contiene "${phrase}"`, !allText.includes(phrase.toLowerCase()));
    }
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
