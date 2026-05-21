/**
 * visualEarlyCommit.test.js — M-5.4.13 estructural.
 *
 * Blinda la separación visual activation / layout refinement (PHASE A/B):
 * el texto se commitea visualmente ANTES del paint sin esperar la cascada de
 * fit; el refinement corre async post-paint; el continuity guard (M-5.4.12)
 * queda INTACTO; cero mutación de executor/runtime/audio.
 *
 * Cómo correr:  node hooks/__tests__/visualEarlyCommit.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');

console.log('\nvisualEarlyCommit — M-5.4.13 estructural');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[1] PHASE A — commit visual instantáneo (sync, pre-paint)');

ok('optimisticVisualCommit definido (useCallback)',
   /const\s+optimisticVisualCommit\s*=\s*useCallback\(\(\s*index:\s*number\s*,\s*measureStart:\s*number\s*\)/.test(visorSrc));

ok('optimisticVisualCommit reusa el último tier válido (provisional)',
   /const\s+provisional\s*:\s*FitTier\s*=\s*lastSettledTierRef\.current\s*\|\|\s*['"]normal['"]/.test(visorSrc));

ok('optimisticVisualCommit NO mide DOM ni corre decideFitTier (sin medición sync)',
   (() => {
       const m = visorSrc.match(/const\s+optimisticVisualCommit\s*=\s*useCallback\([\s\S]*?\},\s*\[pb,\s*content\.id,\s*runLayoutRefinement,\s*activeFitTier,\s*scrollSafeMaxPx\]\)/);
       if (!m) return false;
       const b = m[0];
       return !/getBoundingClientRect|decideFitTier|querySelector\(/.test(b);
   })());

ok('useLayoutEffect en cambio de índice → optimisticVisualCommit + return',
   /if\s*\(\s*fitStateRef\.current\.index\s*!==\s*currentIndex\s*\)\s*\{[\s\S]{0,200}?optimisticVisualCommit\(\s*currentIndex\s*,\s*_measureStart\s*\)\s*;[\s\S]{0,40}?return\s*;/.test(visorSrc));

ok('emite VISUAL_EARLY_COMMIT con provisionalTier',
   /\[VISUAL_EARLY_COMMIT\][\s\S]{0,200}?provisionalTier:\s*provisional/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[2] PHASE B — refinement async POST-PAINT');

ok('runLayoutRefinement definido (useCallback) y agendado vía requestAnimationFrame',
   /const\s+runLayoutRefinement\s*=\s*useCallback\(\(\s*index:\s*number\s*\)/.test(visorSrc)
   && /requestAnimationFrame\(\s*\(\)\s*=>\s*runLayoutRefinement\(\s*index\s*\)\s*\)/.test(visorSrc));

ok('PHASE B corre decideFitTier (medición + escalera) fuera del effect sync',
   /runLayoutRefinement[\s\S]{0,4000}?decideFitTier\(\s*\{[\s\S]{0,120}?currentTier:\s*fitStateRef\.current\.tier/.test(visorSrc));

ok('PHASE B aborta si el usuario navegó a otra frase (no refina lo viejo)',
   /runLayoutRefinement\s*=\s*useCallback\(\(\s*index:\s*number\s*\)\s*=>\s*\{[\s\S]{0,300}?if\s*\(\s*pb\.currentIndex\s*!==\s*index\s*\)\s*return/.test(visorSrc));

ok('emite VISUAL_LAYOUT_REFINEMENT_START + VISUAL_LAYOUT_REFINEMENT_DONE',
   /\[VISUAL_LAYOUT_REFINEMENT_START\]/.test(visorSrc)
   && /\[VISUAL_LAYOUT_REFINEMENT_DONE\]/.test(visorSrc));

ok('PHASE B sigue emitiendo ACTIVE_SENTENCE_LAYOUT_FINAL_STATE (overflowDetected/compactTier)',
   /\[ACTIVE_SENTENCE_LAYOUT_FINAL_STATE\][\s\S]{0,800}?overflowDetected[\s\S]{0,400}?compactTier/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[3] Medición audio→visual delta');

ok('mide VISUAL_FIRST_PAINT_TS vía requestAnimationFrame',
   /requestAnimationFrame\(\(\)\s*=>\s*\{[\s\S]{0,200}?const\s+firstPaintTs\s*=\s*Date\.now\(\)[\s\S]{0,400}?\[VISUAL_FIRST_PAINT_TS\]/.test(visorSrc));

ok('emite VISUAL_AUDIO_DELTA_MS = firstPaintTs - audioStartTs (lastAudioEventAt)',
   /audioStartTs\s*=\s*pb\.getRuntimeDiagnostics\?\.\(\)\?\.lastAudioEventAt/.test(visorSrc)
   && /const\s+deltaMs\s*=\s*firstPaintTs\s*-\s*audioStartTs/.test(visorSrc)
   && /\[VISUAL_AUDIO_DELTA_MS\][\s\S]{0,200}?withinPerceptualBudget:\s*Math\.abs\(deltaMs\)\s*<\s*40/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[4] Task 7 — degradación elegante si refinement > presupuesto');

ok('REFINE_BUDGET_MS = 120',
   /const\s+REFINE_BUDGET_MS\s*=\s*120/.test(visorSrc));

ok('overBudget → salta cascada a scroll-safe terminal (no normal→…→scroll-safe completo)',
   /const\s+overBudget\s*=\s*refineElapsed\s*>\s*REFINE_BUDGET_MS/.test(visorSrc)
   && /overBudget\s*&&\s*_decision\.action\s*===\s*['"]downgrade['"][\s\S]{0,500}?finalTier\s*=\s*TERMINAL_TIER/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[5] NO REGRESIONES — continuity guard INTACTO + render-only');

ok('continuity guard M-5.4.12 INTACTO (applyTransformWithContinuity sin cambios de firma)',
   /const\s+applyTransformWithContinuity\s*=\s*useCallback\(\(index:\s*number,\s*via:\s*string\)/.test(visorSrc)
   && /\[VISUAL_CONTINUITY_HOLD\]/.test(visorSrc)
   && /\[VISUAL_CONTINUITY_RELEASE\]/.test(visorSrc)
   && /\[VISUAL_NULL_RENDER_BLOCKED\]/.test(visorSrc));

ok('fit_effect_entry sigue siendo la PRIMERA llamada del effect (centrado pre-paint intacto)',
   /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]{0,1800}?applyTransformWithContinuity\(\s*currentIndex\s*,\s*['"]fit_effect_entry['"]\s*\)[\s\S]{0,1000}?if\s*\(\s*fitStateRef\.current\.index\s*!==\s*currentIndex\s*\)/.test(visorSrc));

ok('fit_settle sigue usando el continuity guard (no raw apply)',
   /applyTransformWithContinuity\(\s*currentIndex\s*,\s*['"]fit_settle['"]\s*\)/.test(visorSrc));

const phaseAB = (visorSrc.match(/const\s+optimisticVisualCommit\s*=\s*useCallback\([\s\S]*?\},\s*\[pb,\s*content\.id,\s*runLayoutRefinement,\s*activeFitTier,\s*scrollSafeMaxPx\]\)/) || [''])[0]
              + (visorSrc.match(/const\s+runLayoutRefinement\s*=\s*useCallback\([\s\S]*?\},\s*\[pb,\s*content\.id\]\)/) || [''])[0];
ok('PHASE A/B NO tocan executor/runtime/audio/índice (render-only)',
   phaseAB.length > 0
   && !/\bskip\(|\bload\(|setIdx|cancelSyncStrategy|hardResync|executeSyncStrategy|audioRef[AB]|\.play\(|dispatchMachine|MA\.\w+|navGenerationRef\.current\s*=/.test(phaseAB));

ok('ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED sigue ELIMINADO',
   !/\[ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED\]/.test(visorSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
