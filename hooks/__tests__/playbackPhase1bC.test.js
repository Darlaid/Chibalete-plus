/**
 * playbackPhase1bC.test.js — Phase 1.b.C regression coverage.
 *
 * A. Adaptive geometric fit
 *    - tier no se decide por text.length
 *    - M-5.4.10 / TASK 2: escalera determinista vía decideFitTier
 *      (normal→long→very-long→emergency→scroll-safe). ACTIVE_SENTENCE_
 *      OVERFLOW_UNRESOLVED ELIMINADO; reemplazado por
 *      ACTIVE_SENTENCE_LAYOUT_FINAL_STATE (siempre resuelve, cero overlap).
 *    - no transform: scale en active style
 *    - no overflow: hidden en active style
 *
 * B. Nav generation
 *    - navGenerationRef existe
 *    - manualSentenceJump + skip bumpean
 *    - spawn captura spawnNavGeneration
 *    - callbacks rechazan stale generations
 *    - MANUAL_NAV_GENERATION_BUMP log presente
 *    - STALE_NAV_CALLBACK_REJECTED log presente
 *
 * C. Atomicity
 *    - cancelSyncStrategy aparece ANTES de bumpear generation (al revés
 *      provocaría callbacks viejos validando contra generation nueva).
 *    - Actually: bump generation primero invalida callbacks pending → cancel
 *      del executor cierra listeners. Orden: bump → cancel → setIdx → load.
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackPhase1bC.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

const hookSrc  = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');
const shellSrc = fs.readFileSync(path.join(ROOT, 'components', 'ImmersiveShell.tsx'), 'utf8');

console.log('\nplaybackPhase1bC — adaptive fit + manual nav ownership lock');

// ───────────────────────────────────────────────────────────────────────────
// [A] Adaptive geometric fit
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[A] Adaptive geometric fit');

ok('ImmersiveShell ya NO calcula tier desde text.length',
   !/_tier[\s\S]{0,200}?_len\s*>\s*400/.test(shellSrc) &&
   !/_tier[\s\S]{0,200}?_len\s*>\s*200/.test(shellSrc));

ok('ImmersiveShell acepta prop activeFitTier',
   /activeFitTier\?:\s*['"]normal['"]\s*\|\s*['"]long['"]\s*\|\s*['"]very-long['"]/.test(shellSrc));

ok('ImmersiveShell deriva _tier desde la prop (no de text.length)',
   /const\s+_tier\s*=\s*isActive\s*\?\s*activeFitTier\s*:\s*['"]normal['"]/.test(shellSrc));

ok('Active style NO usa transform: scale()',
   !/style=\{[^}]*transform:\s*[`'"]?scale\(/.test(shellSrc));

ok('Active style NO usa overflow: hidden',
   !/style=\{[^}]*overflow:\s*['"]hidden['"]/.test(shellSrc));

ok('Visor declara state activeFitTier con setActiveFitTier',
   /const\s+\[activeFitTier,\s*setActiveFitTier\]\s*=\s*useState/.test(visorSrc));

ok('Visor declara fitStateRef con index/tier/retries (Phase 1.b.D extiende con firstRenderAt/renderCount)',
   /const\s+fitStateRef\s*=\s*useRef[\s\S]{0,500}?index:\s*-1[\s\S]{0,100}?tier:\s*['"]normal['"][\s\S]{0,100}?retries:\s*0/.test(visorSrc));

ok('Visor pasa activeFitTier a <ImmersiveShell />',
   /<ImmersiveShell[\s\S]{0,2000}?activeFitTier=\{activeFitTier\}/.test(visorSrc));

ok('Visor mide rect.bottom vs controlsTop',
   /rect\.bottom\s*>\s*controlsTop/.test(visorSrc));

// M-5.4.10 / TASK 2 — escalera determinista vía helper PURO decideFitTier.
ok('Visor importa decideFitTier de activeSentenceFitLadder.mjs',
   /import\s*\{[^}]*decideFitTier[^}]*\}\s*from\s*['"]\.\.\/utils\/activeSentenceFitLadder\.mjs['"]/.test(visorSrc));

ok('Visor usa decideFitTier para decidir el próximo tier (no ternario hardcodeado)',
   /decideFitTier\(\s*\{[\s\S]{0,300}?currentTier:\s*fitStateRef\.current\.tier/.test(visorSrc) &&
   !/fitStateRef\.current\.tier\s*===\s*['"]normal['"]\s*\?\s*['"]long['"]\s*:\s*['"]very-long['"]/.test(visorSrc));

ok('Escalera incluye emergency + scroll-safe (overflow zero tolerance)',
   /['"]emergency['"][\s\S]{0,80}?['"]scroll-safe['"]/.test(visorSrc) ||
   /scroll-safe/.test(visorSrc));

ok('Pipeline acotado por decideFitTier (action downgrade/settled/clamp-final)',
   /_decision\.action\s*===\s*['"]downgrade['"]/.test(visorSrc) &&
   /_decision\.action\s*===\s*['"]clamp-final['"]/.test(visorSrc));

// M-5.4.13 — el reset de fitState en cambio de índice se movió a
// optimisticVisualCommit (PHASE A): tier = provisional (reusa último válido),
// retries: 0. El effect en cambio de índice delega + return (no cascada sync).
ok('Reset state cuando currentIndex cambia (PHASE A optimisticVisualCommit)',
   /if\s*\(\s*fitStateRef\.current\.index\s*!==\s*currentIndex\s*\)\s*\{[\s\S]{0,200}?optimisticVisualCommit\(\s*currentIndex\s*,\s*_measureStart\s*\)[\s\S]{0,40}?return\s*;/.test(visorSrc)
   && /optimisticVisualCommit\s*=\s*useCallback[\s\S]{0,400}?fitStateRef\.current\s*=\s*\{[\s\S]{0,80}?index,\s*tier:\s*provisional,\s*retries:\s*0/.test(visorSrc));

ok('M-5.4.10 / TASK 2 — ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED ELIMINADO',
   !/\[ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED\]/.test(visorSrc));

ok('M-5.4.10 / TASK 2 — emite ACTIVE_SENTENCE_LAYOUT_FINAL_STATE (siempre resuelve)',
   /\[ACTIVE_SENTENCE_LAYOUT_FINAL_STATE\][\s\S]{0,800}?overflowDetected[\s\S]{0,400}?compactTier/.test(visorSrc));

ok('Layout method documentado como adaptive-geometric-fit',
   /layoutMethod:\s*['"]adaptive-geometric-fit['"]/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// [B] Nav generation lock
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[B] Nav generation lock');

ok('Hook declara navGenerationRef = useRef(0)',
   /const\s+navGenerationRef\s*=\s*useRef<number>\(0\)/.test(hookSrc));

// M-5.4.10 / TASK 3: ventanas ampliadas — el path strict same-chunk reuse
// (visual-only, retorna ANTES del bump) se intercala legítimamente entre el
// inicio de manualSentenceJump y el bump del cross-chunk path. El bump SIGUE
// intacto en el path cross-chunk (sección [C] verifica el orden).
ok('manualSentenceJump bumpea navGenerationRef',
   /const\s+manualSentenceJump[\s\S]{0,9000}?const\s+_fromGeneration\s*=\s*navGenerationRef\.current[\s\S]{0,200}?navGenerationRef\.current\s*=\s*_fromGeneration\s*\+\s*1/.test(hookSrc));

ok('manualSentenceJump emite MANUAL_NAV_GENERATION_BUMP',
   /const\s+manualSentenceJump[\s\S]{0,9000}?\[MANUAL_NAV_GENERATION_BUMP\]/.test(hookSrc));

ok('MANUAL_NAV_GENERATION_BUMP incluye fromGeneration/toGeneration/reason/targetIndex',
   /\[MANUAL_NAV_GENERATION_BUMP\][\s\S]{0,500}?fromGeneration[\s\S]{0,200}?toGeneration[\s\S]{0,200}?reason[\s\S]{0,100}?targetIndex/.test(hookSrc));

ok('skip() programático también bumpea navGenerationRef',
   /const\s+skip\s*=\s*useCallback[\s\S]{0,2500}?navGenerationRef\.current\s*=\s*_fromGeneration\s*\+\s*1/.test(hookSrc));

ok('Spawn captura _spawnNavGeneration = navGenerationRef.current',
   /const\s+_spawnNavGeneration\s*=\s*navGenerationRef\.current/.test(hookSrc));

ok('onSentenceActivate valida _spawnNavGeneration vs navGenerationRef.current',
   /onSentenceActivate[\s\S]{0,500}?if\s*\(\s*_spawnNavGeneration\s*!==\s*navGenerationRef\.current\s*\)/.test(hookSrc));

ok('onSentenceActivate emite STALE_NAV_CALLBACK_REJECTED si stale',
   /onSentenceActivate[\s\S]{0,800}?\[STALE_NAV_CALLBACK_REJECTED\]/.test(hookSrc));

ok('STALE_NAV_CALLBACK_REJECTED incluye callbackGeneration/currentGeneration/callbackType/attemptedIndex',
   /\[STALE_NAV_CALLBACK_REJECTED\][\s\S]{0,500}?callbackGeneration[\s\S]{0,200}?currentGeneration[\s\S]{0,200}?callbackType[\s\S]{0,100}?attemptedIndex/.test(hookSrc));

ok('onChunkComplete también valida generation',
   /onChunkComplete[\s\S]{0,500}?if\s*\(\s*_spawnNavGeneration\s*!==\s*navGenerationRef\.current\s*\)/.test(hookSrc));

ok('onChunkComplete emite STALE_NAV_CALLBACK_REJECTED si stale',
   /onChunkComplete[\s\S]{0,700}?\[STALE_NAV_CALLBACK_REJECTED\]/.test(hookSrc));

ok('Handle del executor lleva _spawnNavGeneration etiquetado',
   /\(_newHandle\s+as\s+any\)\._spawnNavGeneration\s*=\s*_spawnNavGeneration/.test(hookSrc));

ok('SYNC_SPAWN_SUCCESS payload incluye spawnNavGeneration',
   /_spawnSuccessPayload[\s\S]{0,500}?spawnNavGeneration:\s*_spawnNavGeneration/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [C] Atomicity — manual nav cancela executor antes del nuevo spawn
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[C] Atomicity of manual nav');

// El bump de generation ocurre ANTES del cancelSyncStrategy en
// manualSentenceJump (para que cualquier callback pending del executor anterior
// que llegue durante el cancel también vea generation cambiada).
const manualJumpBlock = hookSrc.match(/const\s+manualSentenceJump[\s\S]+?\},\s*\[\s*load\s*\]\s*\)/);
ok('manualSentenceJump block extraído', manualJumpBlock !== null);
if (manualJumpBlock) {
    const body = manualJumpBlock[0];
    const bumpIdx   = body.indexOf('navGenerationRef.current = _fromGeneration + 1');
    const cancelIdx = body.indexOf("cancelSyncStrategy('manual_nav')");
    const loadIdx   = body.indexOf('load(clamped');
    ok('Bump generation aparece en el body',
       bumpIdx > 0);
    ok('cancelSyncStrategy aparece DESPUÉS del bump',
       cancelIdx > bumpIdx,
       `bump@${bumpIdx} cancel@${cancelIdx}`);
    ok('load() aparece DESPUÉS del cancel + bump',
       loadIdx > cancelIdx && loadIdx > bumpIdx,
       `bump@${bumpIdx} cancel@${cancelIdx} load@${loadIdx}`);
}

// ───────────────────────────────────────────────────────────────────────────
// [D] Anti-regression — no reintroducción de patrones eliminados
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[D] Anti-regression guards');

ok('Hook NO declara hardResync nuevo (Phase 1.c lo eliminará formalmente)',
   // hardResync sigue existiendo internamente; guard es contra REINTRODUCCIÓN
   // de su uso desde manualSentenceJump.
   !(manualJumpBlock && /\bhardResync\s*\(/.test(manualJumpBlock[0])));

ok('manualSentenceJump NO menciona drift detector',
   !(manualJumpBlock && /drift/i.test(manualJumpBlock[0])));

ok('manualSentenceJump NO dispatchea VISUAL_HIGHLIGHT_ACK',
   !(manualJumpBlock && /VISUAL_HIGHLIGHT_ACK/.test(manualJumpBlock[0])));

ok('Visor NO contiene grace window de manual nav',
   !/MANUAL_NAV_GRACE_MS/.test(visorSrc));

ok('Visor NO contiene grace window intra-chunk',
   !/INTRA_CHUNK_GRACE_MS/.test(visorSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
