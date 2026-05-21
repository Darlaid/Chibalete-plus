/**
 * playbackPhase1bAFix.test.js — Regression tests for the 5 cases that
 * surfaced after Phase 1.b.A demolition.
 *
 * CASES:
 *   1. VISUAL_INDEX_COMMITTED before audio fetch (TTS black-screen on restore).
 *   2. Executor must not activate sentences < spawnIdx (previous 11→10 jumps to 0).
 *   3. Active sentence has safe viewport fit (long sentence overlaps controls).
 *   4. Manual nav must not emit hard_resync via MA.SKIP.
 *   5. WATCHDOG_STALLED_VISUAL removed.
 *
 * Estructurales: leen el source del hook + visor + shell + machine + watchdog.
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackPhase1bAFix.test.js
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

const hookSrc    = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const visorSrc   = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');
const shellSrc   = fs.readFileSync(path.join(ROOT, 'components', 'ImmersiveShell.tsx'), 'utf8');
const machineSrc = fs.readFileSync(path.join(ROOT, 'utils', 'immersivePlaybackMachine.js'), 'utf8');
const watchdogSrc= fs.readFileSync(path.join(ROOT, 'utils', 'runtimeWatchdog.mjs'), 'utf8');

console.log('\nplaybackPhase1bAFix — 5 cases regression');

// ───────────────────────────────────────────────────────────────────────────
// [CASE 1] restore_target_index_renders_before_audio_ready
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[CASE 1] VISUAL_INDEX_COMMITTED before audio fetch');

// El setIdx + dispatchMachine PREPARE_SENTENCE deben estar ANTES de
// `const url = await getAudioUrl(index)`. Comprobamos el orden por offsets.
const _setIdxIdx  = hookSrc.indexOf('setIdx(index);');
const _dispIdx    = hookSrc.indexOf('type: MA.PREPARE_SENTENCE');
const _fetchIdx   = hookSrc.indexOf('const url = await getAudioUrl(index)');
ok('setIdx(index) está ANTES de getAudioUrl en load()',
   _setIdxIdx > 0 && _fetchIdx > 0 && _setIdxIdx < _fetchIdx,
   `setIdx@${_setIdxIdx} fetch@${_fetchIdx}`);
ok('PREPARE_SENTENCE está ANTES de getAudioUrl en load()',
   _dispIdx > 0 && _fetchIdx > 0 && _dispIdx < _fetchIdx);
ok('Hook emite [VISUAL_INDEX_COMMITTED] con reason "load"',
   /\[VISUAL_INDEX_COMMITTED\][\s\S]{0,400}?reason:\s*['"]load['"]/.test(hookSrc));
ok('VISUAL_INDEX_COMMITTED incluye beforeAudioFetch: true',
   /VISUAL_INDEX_COMMITTED[\s\S]{0,500}?beforeAudioFetch:\s*true/.test(hookSrc));
// No debe haber DUPLICACIÓN del setIdx después del fetch
const _setIdxOccurrencesInLoad = (hookSrc.match(/setIdx\(index\)/g) || []).length;
// Aceptamos 1 (commit pre-fetch) y opcionalmente otro en el path de error (no-URL).
ok('setIdx(index) aparece <= 2 veces en el hook (commit + posible error fallback)',
   _setIdxOccurrencesInLoad <= 2,
   `found ${_setIdxOccurrencesInLoad}`);

// ───────────────────────────────────────────────────────────────────────────
// [CASE 2] perChunkNoAnchors_manual_previous_does_not_jump_to_chunk_start
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[CASE 2] Executor must not activate sentences < spawnIdx');

ok('sentenceGroup filtra entries con absoluteSentenceIndex >= index (M-5.4.6 Task 1)',
   /\.filter\(\s*x\s*=>\s*x\.absoluteSentenceIndex\s*>=\s*index\s*\)/.test(hookSrc));

ok('anchors también se filtran por sentenceIdx >= index (formato V2 legacy en disco)',
   /\.filter\(\s*\(a:\s*any\)\s*=>\s*a\.sentenceIdx\s*>=\s*index\s*\)/.test(hookSrc));

ok('Handle del executor lleva _spawnFromIndex',
   /\(_newHandle\s+as\s+any\)\._spawnFromIndex\s*=\s*index/.test(hookSrc));

ok('Handle del executor lleva _chunkStartIndex y _chunkEndIndex',
   /\(_newHandle\s+as\s+any\)\._chunkStartIndex\s*=\s*_chunkStartIndex/.test(hookSrc) &&
   /\(_newHandle\s+as\s+any\)\._chunkEndIndex\s*=\s*_chunkEndIndex/.test(hookSrc));

ok('advanceWithinChunk tiene guard STALE_OR_LOCAL_INDEX_REJECTED',
   /STALE_OR_LOCAL_INDEX_REJECTED/.test(hookSrc));

ok('Guard rechaza toIndex < _spawnFromIndex o > _chunkEndIndex',
   /toIndex\s*<\s*_spawnFrom\s*\|\|\s*toIndex\s*>\s*_chunkEnd/.test(hookSrc));

ok('SYNC_SPAWN_SUCCESS payload incluye spawnFromIndex',
   /_spawnSuccessPayload[\s\S]{0,500}?spawnFromIndex:\s*index/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [Phase 1.b.B Task 1] Executor semantic stabilization
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[Phase 1.b.B Task 1] Executor uses absoluteSentenceIndex semantics');

ok('Hook construye sentenceGroup con absoluteSentenceIndex',
   /absoluteSentenceIndex:\s*x\.absoluteSentenceIndex/.test(hookSrc));

ok('Hook construye sentenceGroup con localIndexInChunk',
   /localIndexInChunk:\s*x\.absoluteSentenceIndex\s*-\s*_chunkStartIndex/.test(hookSrc));

ok('Hook construye anchors con absoluteSentenceIndex (renombrando desde V2 sentenceIdx)',
   /absoluteSentenceIndex:\s*a\.sentenceIdx/.test(hookSrc));

ok('executeSyncStrategy recibe spawnFromIndex como opt',
   /executeSyncStrategy\(\s*\{[\s\S]{0,1500}?spawnFromIndex:\s*index/.test(hookSrc));

ok('executeSyncStrategy recibe chunkStartIndex/chunkEndIndex como opts',
   /executeSyncStrategy\(\s*\{[\s\S]{0,1500}?chunkStartIndex:\s*_chunkStartIndex/.test(hookSrc) &&
   /executeSyncStrategy\(\s*\{[\s\S]{0,1500}?chunkEndIndex:\s*_chunkEndIndex/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [CASE 3] long_sentence_does_not_overlap_controls
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[CASE 3] Real-layout viewport fit (Phase 1.b.B Task 2)');

// Phase 1.b.B — transform: scale() ELIMINADO. Layout se reduce REALMENTE
// vía class swap por tier (normal/long/very-long).
// Only check that no STYLE assignment uses transform: scale() for active fit.
// La línea 80 tiene transform: translateY(...) que SÍ es legítimo (track scroll).
// La mención en comentario M-5.4.6 (Task 2) es documentación, no código.
ok('M-5.4.6 (Task 2) — Active style NO usa transform: scale() (sólo translateY del track)',
   !/style=\{[^}]*transform:\s*[`'"]?scale\(/.test(shellSrc));

ok('M-5.4.6 (Task 2) — NO usa _fitScale (eliminado)',
   !/_fitScale/.test(shellSrc));

ok('M-5.4.6 (Task 2) — NO usa maxHeight calc(100vh) (eliminado)',
   !/maxHeight:\s*['"`]calc\(100vh/.test(shellSrc));

ok('M-5.4.6 (Task 2) — NO usa overflow: hidden en active style (eliminado)',
   !/_activeStyle[\s\S]{0,300}?overflow:\s*['"]hidden['"]/.test(shellSrc));

ok('M-5.4.6 (Task 2 + 1.b.C) — usa tiers normal/long/very-long como prop value',
   /'normal'\s*\|\s*'long'\s*\|\s*'very-long'/.test(shellSrc));

// M-5.4.6 (Phase 1.b.C) — tier ya NO se determina por largo de texto, se decide
// por medición geométrica real en el visor. Validamos AUSENCIA de la fórmula chars.
ok('M-5.4.6 (Phase 1.b.C) — tier NO se determina por text.length en el shell',
   !/_len\s*>\s*400[\s\S]{0,100}?very-long/.test(shellSrc));

ok('Active sentence container expone data-active-size-tier para diagnóstico',
   /data-active-size-tier=\{isActive\s*\?\s*_tier\s*:\s*undefined\}/.test(shellSrc));

ok('Visor emite ACTIVE_SENTENCE_LAYOUT_FIT con métricas',
   /\[ACTIVE_SENTENCE_LAYOUT_FIT\]/.test(visorSrc));

ok('Métrica incluye overlapsControls flag (overlap REAL)',
   /ACTIVE_SENTENCE_LAYOUT_FIT[\s\S]{0,1500}?overlapsControls/.test(visorSrc));

ok('Métrica incluye computedFontSize (px real del DOM)',
   /ACTIVE_SENTENCE_LAYOUT_FIT[\s\S]{0,1500}?computedFontSize/.test(visorSrc));

ok('Métrica documenta layoutMethod = adaptive-geometric-fit (Phase 1.b.C)',
   /layoutMethod:\s*['"]adaptive-geometric-fit['"]/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// [CASE 4] manual_previous_does_not_dispatch_hard_resync
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[CASE 4] Manual nav (MA.SKIP) does NOT emit HARD_RESYNC');

// MA.SKIP reducer ya no debe contener 'hard_resync' tag ni HARD_RESYNC effect.
const _skipReducer = machineSrc.match(/case\s+Actions\.SKIP:\s*\{[\s\S]+?return\s*\{[\s\S]+?\};\s*\}/);
ok('MA.SKIP reducer extraído',                _skipReducer !== null);
if (_skipReducer) {
    const body = _skipReducer[0];
    ok('MA.SKIP NO emite tag "hard_resync"',
       !/tag:\s*['"]hard_resync['"]/.test(body));
    ok('MA.SKIP NO emite effect { type: "HARD_RESYNC" ... }',
       !/type:\s*['"]HARD_RESYNC['"]/.test(body));
    ok('MA.SKIP usa reason "manual_nav" en cancel_pending',
       /reason:\s*['"]manual_nav['"]/.test(body));
    ok('MA.SKIP emite manual_nav_commit',
       /tag:\s*['"]manual_nav_commit['"]/.test(body));
    ok('MA.SKIP sigue emitiendo load_audio (carga el target)',
       /type:\s*['"]load_audio['"]/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// [CASE 5] watchdog_does_not_report_stalled_visual_when_executor_advances
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[CASE 5] WATCHDOG_STALLED_VISUAL removed');

// El bloque de detección en runtimeWatchdog.mjs debe estar eliminado.
ok('runtimeWatchdog.mjs NO contiene log(\'WATCHDOG_STALLED_VISUAL\', ...)',
   !/log\(\s*['"]WATCHDOG_STALLED_VISUAL['"]/.test(watchdogSrc));

ok('runtimeWatchdog menciona ELIMINADO en comentario M-5.4.6',
   /WATCHDOG_STALLED_VISUAL\s+ELIMINADO/.test(watchdogSrc));

// El watchdog mantiene prevSentenceChangeAt para tracking interno pero ya no emite.
ok('prevSentenceChangeAt sigue existiendo (tracking interno)',
   /prevSentenceChangeAt/.test(watchdogSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
