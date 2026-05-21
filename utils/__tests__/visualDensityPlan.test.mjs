/**
 * visualDensityPlan.test.mjs — M-5.4.10 / TASK 1 + TASK 4 + TASK 5(tests).
 *
 * Ejerce el código REAL de decisión de densidad/pacing que el visor usa.
 *
 * Cómo correr:
 *   node utils/__tests__/visualDensityPlan.test.mjs
 */

import {
    computeVisualDensityPlan,
    computeVisualPacing,
    DENSITY_DEFAULTS,
    PACING_DEFAULTS,
} from '../visualDensityPlan.mjs';

let pass = 0, fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(s) { console.log('\n' + s); }

const short = 'Sí.';                                  // 3 chars
const med   = 'El niño caminó hacia el bosque oscuro y silencioso.'; // ~50
const huge  = 'x'.repeat(400);

// ────────────────────────────────────────────────────────────────────────────
section('[1] frase muy corta → expanded con contexto (NO adelanta playback)');
{
    const sentences = [short, short, short, med, med];
    const plan = computeVisualDensityPlan({ sentences, currentIndex: 0 });
    ok('mode === expanded',                 plan.mode === 'expanded', JSON.stringify(plan));
    ok('contextLookahead > 0',              plan.contextLookahead > 0);
    ok('contextLookahead <= maxLookahead',  plan.contextLookahead <= DENSITY_DEFAULTS.maxContextLookahead);
    ok('windowChars > activeChars (suma contexto)', plan.windowChars > plan.activeChars);
    ok('activeChars === longitud real',     plan.activeChars === short.length);
}

// ────────────────────────────────────────────────────────────────────────────
section('[2] frase normal → normal, sin contexto');
{
    const plan = computeVisualDensityPlan({ sentences: [med, med, med], currentIndex: 1 });
    ok('mode === normal',          plan.mode === 'normal', JSON.stringify(plan));
    ok('contextLookahead === 0',   plan.contextLookahead === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[3] frase enorme → compacted (señal para fit pipeline, NO overlap)');
{
    const plan = computeVisualDensityPlan({ sentences: [huge, med], currentIndex: 0 });
    ok('mode === compacted',       plan.mode === 'compacted', JSON.stringify(plan));
    ok('contextLookahead === 0 (no agregar contexto a algo enorme)',
       plan.contextLookahead === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[4] corta al FINAL del libro → normal (no hay contexto siguiente)');
{
    const plan = computeVisualDensityPlan({ sentences: [med, short], currentIndex: 1 });
    ok('mode === normal (sin contexto disponible)', plan.mode === 'normal', JSON.stringify(plan));
    ok('contextLookahead === 0',                    plan.contextLookahead === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[5] contexto NUNCA mete una frase que sola desborde maxChars');
{
    const sentences = [short, huge, med];
    const plan = computeVisualDensityPlan({ sentences, currentIndex: 0 });
    ok('no expande con la frase huge siguiente',
       plan.contextLookahead === 0 && plan.mode === 'normal',
       JSON.stringify(plan));
}

// ────────────────────────────────────────────────────────────────────────────
section('[6] homogeneidad: el plan NUNCA deja contexto expandible sin usar');
{
    // Mezcla realista: cortas y largas intercaladas (caso Guerra/Alicia).
    // Invariante real verificable: si la frase activa es corta y EXISTE una
    // frase siguiente no-enorme, el plan DEBE expandir (no puede fabricar
    // texto inexistente al final del libro — eso NO es bug del plan).
    const sentences = [short, short, med, huge, short, med, short, short];
    let unusedExpandable = 0, hugeScreens = 0;
    for (let i = 0; i < sentences.length; i++) {
        const p = computeVisualDensityPlan({ sentences, currentIndex: i });
        const nextExists   = (i + 1) < sentences.length;
        const nextFits     = nextExists
            && sentences[i + 1].length <= DENSITY_DEFAULTS.maxCharsPerScreen
            && (p.activeChars + sentences[i + 1].length) <= DENSITY_DEFAULTS.maxCharsPerScreen;
        const activeShort  = p.activeChars < DENSITY_DEFAULTS.minCharsPerScreen;
        if (activeShort && nextFits && p.contextLookahead === 0) unusedExpandable++;
        if (p.mode === 'compacted') hugeScreens++;
    }
    ok('plan SIEMPRE usa el contexto expandible disponible (cero desperdicio)',
       unusedExpandable === 0, `got ${unusedExpandable}`);
    ok('frases enormes SIEMPRE marcadas compacted (fit las contiene)',
       hugeScreens === 1);  // solo la `huge`
}

// ────────────────────────────────────────────────────────────────────────────
section('[7] TASK 4 — pacing: paso normal = base, salto grande = más suave');
{
    const step = computeVisualPacing({ fromIndex: 4, toIndex: 5, activeChars: 50 });
    ok('paso normal (delta 1) → durationMs == baseMs',
       step.durationMs === PACING_DEFAULTS.baseMs, JSON.stringify(step));
    ok('paso normal indexDelta === 1', step.indexDelta === 1);
    ok('paso normal NO segmentado',    step.segmented === false);

    const jump = computeVisualPacing({ fromIndex: 4, toIndex: 12, activeChars: 50 });
    ok('salto grande → durationMs > base (más suave, no latigazo)',
       jump.durationMs > PACING_DEFAULTS.baseMs, JSON.stringify(jump));
    ok('salto grande acotado a maxMs',  jump.durationMs <= PACING_DEFAULTS.maxMs);
    ok('salto grande indexDelta === 8', jump.indexDelta === 8);
}

// ────────────────────────────────────────────────────────────────────────────
section('[8] TASK 4 — pacing: speed alto acorta (acotado al piso) + extrema');
{
    const fast = computeVisualPacing({ fromIndex: 0, toIndex: 1, activeChars: 50, playbackSpeed: 2 });
    ok('speed 2x → durationMs < base pero >= minMs',
       fast.durationMs < PACING_DEFAULTS.baseMs && fast.durationMs >= PACING_DEFAULTS.minMs,
       JSON.stringify(fast));

    const extreme = computeVisualPacing({ fromIndex: 0, toIndex: 1, activeChars: 400 });
    ok('frase extrema → segmented true (contención visual marcada)',
       extreme.segmented === true, JSON.stringify(extreme));
    ok('duración SIEMPRE acotada [minMs, maxMs]',
       extreme.durationMs >= PACING_DEFAULTS.minMs && extreme.durationMs <= PACING_DEFAULTS.maxMs);
}

// ────────────────────────────────────────────────────────────────────────────
section('[9] PUREZA — no muta inputs, no side effects, determinista');
{
    const sentences = [short, med, huge];
    const frozen = Object.freeze(sentences.slice());
    let threw = false;
    try { computeVisualDensityPlan({ sentences: frozen, currentIndex: 0 }); }
    catch { threw = true; }
    ok('acepta array congelado sin lanzar (no muta)', threw === false);
    const a = computeVisualPacing({ fromIndex: 1, toIndex: 2, activeChars: 50 });
    const b = computeVisualPacing({ fromIndex: 1, toIndex: 2, activeChars: 50 });
    ok('determinista (misma entrada → misma salida)',
       JSON.stringify(a) === JSON.stringify(b));
}

// ────────────────────────────────────────────────────────────────────────────
section('[10] M-5.4.14 / TASK 5 — pacing homogenizado por lineCount/complexity');
{
    // Back-compat DURO: sin lineCount/complexity → idéntico al comportamiento
    // previo (nudge=0). Protege los tests [7]/[8] de regresión.
    const baseline = computeVisualPacing({ fromIndex: 4, toIndex: 5, activeChars: 50 });
    ok('sin lineCount/complexity → durationMs == baseMs (back-compat)',
       baseline.durationMs === PACING_DEFAULTS.baseMs, JSON.stringify(baseline));
    ok('back-compat → perceptualNudgeMs === 0', baseline.perceptualNudgeMs === 0);
    ok('back-compat → reason normal_step', baseline.reason === 'normal_step');

    // Multilínea → más tiempo (no "aparece demasiado rápido"), acotado.
    const multi = computeVisualPacing({
        fromIndex: 4, toIndex: 5, activeChars: 200, lineCount: 5,
    });
    ok('multilínea → durationMs > baseline', multi.durationMs > baseline.durationMs,
       JSON.stringify(multi));
    ok('multilínea → perceptualNudgeMs > 0', multi.perceptualNudgeMs > 0);
    ok('multilínea → reason perceptual_homogenized',
       multi.reason === 'perceptual_homogenized');

    // Complejidad alta → nudge presente, SIEMPRE acotado [minMs,maxMs].
    const complex = computeVisualPacing({
        fromIndex: 4, toIndex: 5, activeChars: 120, lineCount: 3, complexity: 1,
    });
    ok('complejidad alta → nudge ≤ maxNudgeMs (acotado)',
       complex.perceptualNudgeMs <= PACING_DEFAULTS.maxNudgeMs);
    ok('SIEMPRE dentro de [minMs, maxMs]',
       complex.durationMs >= PACING_DEFAULTS.minMs
       && complex.durationMs <= PACING_DEFAULTS.maxMs);
    ok('complexity clamped a [0,1] (input fuera de rango no rompe)',
       computeVisualPacing({ fromIndex: 0, toIndex: 1, activeChars: 10, complexity: 9 }).complexity === 1);

    // NO afecta audio timing (la función no recibe ni emite nada de audio).
    ok('pacing es VISUAL-only (sin campos de audio en el output)',
       !('audioStartTs' in multi) && !('audioMs' in multi));

    // Speed sigue acortando + nudge, acotado al piso.
    const fast = computeVisualPacing({
        fromIndex: 0, toIndex: 1, activeChars: 200, lineCount: 6, complexity: 1, playbackSpeed: 2,
    });
    ok('speed>1 con nudge → sigue >= minMs', fast.durationMs >= PACING_DEFAULTS.minMs);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
