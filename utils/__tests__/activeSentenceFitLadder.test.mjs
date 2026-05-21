/**
 * activeSentenceFitLadder.test.mjs — M-5.4.10 / TASK 2 (OVERFLOW ZERO TOLERANCE).
 *
 * Ejerce el código REAL de la escalera de fit que el visor usa.
 * Prueba que el pipeline SIEMPRE resuelve (scroll-safe terminal) y NUNCA
 * deja overlap (ya no hay "rendirse" / ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED).
 *
 * Cómo correr:
 *   node utils/__tests__/activeSentenceFitLadder.test.mjs
 */

import {
    decideFitTier,
    FIT_TIERS,
    TERMINAL_TIER,
    MAX_SHRINK_RETRIES,
} from '../activeSentenceFitLadder.mjs';

let pass = 0, fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(s) { console.log('\n' + s); }

// ────────────────────────────────────────────────────────────────────────────
section('[1] sin overlap → settled inmediato (sin clamp en tiers normales)');
{
    const d = decideFitTier({ currentTier: 'normal', overlapsControls: false, retries: 0 });
    ok('action === settled', d.action === 'settled', JSON.stringify(d));
    ok('final === true',     d.final === true);
    ok('NO clamp en normal', d.applyScrollSafeClamp === false);
}

// ────────────────────────────────────────────────────────────────────────────
section('[2] overlap → baja por la escalera normal→long→very-long→emergency');
{
    let tier = 'normal', retries = 0;
    const seen = [tier];
    for (let step = 0; step < 10; step++) {
        const d = decideFitTier({ currentTier: tier, overlapsControls: true, retries });
        if (d.final) break;
        ok(`downgrade ${tier} → ${d.nextTier}`, d.action === 'downgrade');
        tier = d.nextTier;
        retries += 1;
        seen.push(tier);
    }
    ok('recorre normal→long→very-long→emergency→scroll-safe',
       seen.join(',') === 'normal,long,very-long,emergency,scroll-safe',
       seen.join(','));
}

// ────────────────────────────────────────────────────────────────────────────
section('[3] overlap persistente en scroll-safe → clamp-final (SIEMPRE resuelve)');
{
    const d = decideFitTier({ currentTier: 'scroll-safe', overlapsControls: true, retries: 9 });
    ok('action === clamp-final',         d.action === 'clamp-final', JSON.stringify(d));
    ok('applyScrollSafeClamp === true',  d.applyScrollSafeClamp === true);
    ok('final === true (terminal, sin loop)', d.final === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('[4] shrink agotado → engage scroll-safe directo (terminal acotado)');
{
    const d = decideFitTier({
        currentTier: 'very-long',
        overlapsControls: true,
        retries: MAX_SHRINK_RETRIES,   // agotado
    });
    ok('nextTier === scroll-safe',       d.nextTier === TERMINAL_TIER, JSON.stringify(d));
    ok('applyScrollSafeClamp === true',  d.applyScrollSafeClamp === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('[5] scroll-safe SIN overlap → settled (el clamp ya contuvo el texto)');
{
    const d = decideFitTier({ currentTier: 'scroll-safe', overlapsControls: false, retries: 4 });
    ok('action === settled',            d.action === 'settled', JSON.stringify(d));
    ok('applyScrollSafeClamp === true (sigue en scroll-safe)',
       d.applyScrollSafeClamp === true);
    ok('final === true',                d.final === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('[6] CONVERGENCIA GARANTIZADA — desde cualquier tier, peor caso, resuelve');
{
    for (const startTier of FIT_TIERS) {
        let tier = startTier, retries = 0, resolved = false;
        // Peor caso: overlap SIEMPRE true (frase patológicamente gigante).
        for (let step = 0; step < 12; step++) {
            const d = decideFitTier({ currentTier: tier, overlapsControls: true, retries });
            if (d.final) { resolved = true;
                ok(`desde '${startTier}' resuelve en clamp-final con no-overlap garantizado`,
                   d.action === 'clamp-final' && d.applyScrollSafeClamp === true);
                break;
            }
            tier = d.nextTier; retries += 1;
        }
        ok(`desde '${startTier}' el pipeline converge (NO loop infinito)`, resolved);
    }
}

// ────────────────────────────────────────────────────────────────────────────
section('[7] PUREZA — determinista, sin side effects');
{
    const a = decideFitTier({ currentTier: 'long', overlapsControls: true, retries: 1 });
    const b = decideFitTier({ currentTier: 'long', overlapsControls: true, retries: 1 });
    ok('determinista', JSON.stringify(a) === JSON.stringify(b));
    ok('no expone mutadores / solo datos',
       typeof a.action === 'string' && typeof a.nextTier === 'string'
       && typeof a.final === 'boolean');
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
