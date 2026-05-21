/**
 * playbackSpawnCoverage.test.js — BLOCKER M-5.4.3 regression coverage.
 *
 * Antes del fix, syncStrategy executor se spawneaba SOLO en el .then() de
 * load() autoplay. resume() y handleEnded gapless reproducían audio pero NO
 * llamaban spawnSyncExecutorIfChunked, por lo que perChunkNoAnchors quedaba
 * pegado en idx=0 (caso Guerra de los mundos).
 *
 * Esta suite verifica estructuralmente que TODOS los .play().then() del hook
 * pasan por onAudioPlaybackStarted (helper unificado que despacha AUDIO_STARTED
 * + spawnea executor + actualiza timestamps M-5.4).
 *
 * Tests:
 *   - load_autoplay_path_spawns_sync_executor
 *   - resume_path_spawns_sync_executor   ← antes faltaba
 *   - gapless_path_spawns_sync_executor  ← antes faltaba
 *   - does_not_spawn_duplicate_same_chunk
 *   - build_marker_present
 *   - lazy_mode_derivation_present
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackSpawnCoverage.test.js
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

const hookSrc = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');

console.log('\nplaybackSpawnCoverage — BLOCKER M-5.4.3 regression coverage');

// ───────────────────────────────────────────────────────────────────────────
// [1] Helper único onAudioPlaybackStarted existe
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[1] onAudioPlaybackStarted helper');

ok('helper onAudioPlaybackStarted definido',
   /const\s+onAudioPlaybackStarted\s*=\s*\(/.test(hookSrc));

ok('helper acepta audioEl, index, callsite',
   /const\s+onAudioPlaybackStarted\s*=\s*\(\s*[\s\S]{0,500}?audioEl\s*:[\s\S]{0,200}?index\s*:[\s\S]{0,200}?callsite/.test(hookSrc));

ok('helper despacha AUDIO_STARTED a la machine',
   /onAudioPlaybackStarted[\s\S]{0,2000}?dispatchMachine\(\s*\{\s*type:\s*MA\.AUDIO_STARTED/.test(hookSrc));

ok('helper actualiza lastAudioEventAtRef + lastChunkTransitionAtRef',
   /onAudioPlaybackStarted[\s\S]{0,2000}?lastAudioEventAtRef\.current\s*=\s*Date\.now\(\)[\s\S]{0,500}?lastChunkTransitionAtRef\.current\s*=\s*Date\.now\(\)/.test(hookSrc));

ok('helper llama spawnSyncExecutorIfChunked',
   // BLOCKER FINAL V2 / TASK 2: ventana ampliada 2000→3500 — el helper ahora
   // emite SYNC_SPAWN_AFTER_AUDIO_READY entre dispatch y spawn (invariante
   // de orden audio-ready → spawn).
   /onAudioPlaybackStarted[\s\S]{0,3500}?spawnSyncExecutorIfChunked\(\s*audioEl\s*,\s*index\s*,\s*callsite\s*\)/.test(hookSrc));

ok('helper emite PB_SPAWN_CALLSITE',
   /onAudioPlaybackStarted[\s\S]{0,2000}?\[PB_SPAWN_CALLSITE\]/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [2] load() autoplay path llama onAudioPlaybackStarted
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[2] load_autoplay_path_spawns_sync_executor');

// pActive.play().then(() => { ... onAudioPlaybackStarted(pActive, index, 'load_autoplay') ... })
ok('load().then() contiene onAudioPlaybackStarted con callsite "load_autoplay"',
   /pActive\.play\(\)[\s\S]{0,1500}?onAudioPlaybackStarted\(\s*pActive\s*,\s*index\s*,\s*['"]load_autoplay['"]\s*\)/.test(hookSrc));

ok('load() emite PB_PLAY_ATTEMPT antes del play()',
   /\[PB_PLAY_ATTEMPT\][\s\S]{0,800}?callsite\s*:\s*['"]load_autoplay['"][\s\S]{0,800}?pActive\.play\(\)/.test(hookSrc));

ok('load() emite PB_PLAY_RESOLVED tras play().then()',
   /pActive\.play\(\)[\s\S]{0,1500}?\[PB_PLAY_RESOLVED\][\s\S]{0,500}?callsite\s*:\s*['"]load_autoplay['"]/.test(hookSrc));

ok('load() emite PB_LOAD_PLAY_THEN',
   /pActive\.play\(\)[\s\S]{0,1500}?\[PB_LOAD_PLAY_THEN\]/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [3] resume() path llama onAudioPlaybackStarted — BLOCKER FIX
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[3] resume_path_spawns_sync_executor (BLOCKER FIX)');

// resume() usa p (no pActive) y currentIdxRef.current
ok('resume().then() contiene onAudioPlaybackStarted con callsite "resume"',
   /p\.play\(\)[\s\S]{0,1500}?onAudioPlaybackStarted\(\s*p\s*,\s*currentIdxRef\.current\s*,\s*['"]resume['"]\s*\)/.test(hookSrc));

ok('resume() emite PB_RESUME_ATTEMPT antes del play()',
   /\[PB_RESUME_ATTEMPT\][\s\S]{0,800}?callsite\s*:\s*['"]resume['"][\s\S]{0,900}?p\.play\(\)/.test(hookSrc));

ok('resume() emite PB_RESUME_RESOLVED tras play().then()',
   /p\.play\(\)[\s\S]{0,1500}?\[PB_RESUME_RESOLVED\]/.test(hookSrc));

// Regresión clave: el dispatch inline de AUDIO_STARTED en resume() debe haberse
// REEMPLAZADO por la llamada a onAudioPlaybackStarted. NO debe coexistir.
// Extraer todo el bloque desde p.play() hasta .catch — incluye .then() body
// completo. El lazy match con `}` no sirve porque hay `}` anidados (object
// literals dentro del then).
const resumeWholeBlock = hookSrc.match(/p\.play\(\)\s*\n\s*\.then\([\s\S]*?\n\s*\.catch/);
ok('resume() block extraído (p.play→.catch)', resumeWholeBlock !== null);
if (resumeWholeBlock) {
    const body = resumeWholeBlock[0];
    const inlineDispatches = (body.match(/dispatchMachine\(\s*\{\s*type:\s*MA\.AUDIO_STARTED/g) || []).length;
    ok('resume().then() NO contiene dispatch inline duplicado de AUDIO_STARTED',
       inlineDispatches === 0,
       `found ${inlineDispatches} inline dispatches; expected 0 (helper does it)`);
    ok('resume().then() SÍ llama onAudioPlaybackStarted',
       /onAudioPlaybackStarted\(/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// [4] gapless path llama onAudioPlaybackStarted — BLOCKER FIX
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[4] gapless_path_spawns_sync_executor (BLOCKER FIX)');

ok('handleEnded gapless contiene onAudioPlaybackStarted con callsite "gapless_advance"',
   // BLOCKER FINAL V2 / TASK 2: ventana 1500→3500 — entre nextEl.play() y el
   // helper ahora van GAPLESS_CHUNK_PLAY_CONFIRMED + PB_PLAY_RESOLVED.
   /nextEl\.play\(\)[\s\S]{0,3500}?onAudioPlaybackStarted\(\s*nextEl\s*,\s*nextIdx\s*,\s*['"]gapless_advance['"]\s*\)/.test(hookSrc));

ok('gapless emite PB_PLAY_ATTEMPT con callsite "gapless_advance"',
   /\[PB_PLAY_ATTEMPT\][\s\S]{0,800}?callsite\s*:\s*['"]gapless_advance['"][\s\S]{0,800}?nextEl\.play\(\)/.test(hookSrc));

ok('gapless emite PB_PLAY_RESOLVED con callsite "gapless_advance"',
   /nextEl\.play\(\)[\s\S]{0,1500}?\[PB_PLAY_RESOLVED\][\s\S]{0,500}?callsite\s*:\s*['"]gapless_advance['"]/.test(hookSrc));

// gapless: extraer todo el bloque nextEl.play() hasta el .catch
const gaplessWholeBlock = hookSrc.match(/nextEl\.play\(\)\s*\n\s*\.then\([\s\S]*?\n\s*\.catch/);
ok('gapless block extraído (nextEl.play→.catch)', gaplessWholeBlock !== null);
if (gaplessWholeBlock) {
    const body = gaplessWholeBlock[0];
    const inlineDispatches = (body.match(/dispatchMachine\(\s*\{\s*type:\s*MA\.AUDIO_STARTED/g) || []).length;
    ok('gapless .then() NO contiene dispatch inline duplicado de AUDIO_STARTED',
       inlineDispatches === 0,
       `found ${inlineDispatches} inline dispatches; expected 0 (helper does it)`);
    ok('gapless .then() SÍ llama onAudioPlaybackStarted',
       /onAudioPlaybackStarted\(/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// [5] Dedup: no se spawnea executor duplicado para mismo session+chunk
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[5] does_not_spawn_duplicate_executor_same_chunk');

ok('spawn chequea same sessionId + same chunkKey antes de crear executor',
   /sessionId\s*===\s*contentSessionRef\.current[\s\S]{0,300}?_chunkKey\s*===\s*_spawnChunkKey/.test(hookSrc));

ok('spawn emite SYNC_SPAWN_SKIPPED reason: already_alive_same_chunk',
   /\[SYNC_SPAWN_SKIPPED\][\s\S]{0,500}?reason\s*:\s*['"]already_alive_same_chunk['"]/.test(hookSrc));

ok('handle nuevo se etiqueta con _chunkKey tras spawn exitoso',
   /\(_newHandle\s+as\s+any\)\._chunkKey\s*=\s*_spawnChunkKey/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [6] Bundle marker M543_BUILD_MARKER
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[6] build_marker_present');

ok('M543_BUILD_MARKER presente en hook',
   /\[M543_BUILD_MARKER\]\s+perChunkNoAnchors-spawn-debug/.test(hookSrc));

ok('marker se emite UNA vez por mount (gated por useRef)',
   /_m543MarkerEmittedRef[\s\S]{0,300}?_m543MarkerEmittedRef\.current\s*=\s*true/.test(hookSrc));

ok('marker emite buildPhase identificatorio',
   /M543_BUILD_MARKER[\s\S]{0,500}?buildPhase\s*:\s*['"]M-5\.4\.3-helper-unified-spawn['"]/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [7] Lazy mode derivation
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[7] lazy_mode_derivation_present');

ok('deriveAudioModeLazily helper existe',
   /const\s+deriveAudioModeLazily\s*=/.test(hookSrc));

ok('derivación maneja perSentence si chunkKey === sentenceIdx para todo',
   /deriveAudioModeLazily[\s\S]{0,800}?if\s*\(\s*s2c\[i\]\s*!==\s*i\s*\)[\s\S]{0,200}?return\s+['"]perSentence['"]/.test(hookSrc));

ok('derivación devuelve perChunkWithAnchors si hay anchors',
   /deriveAudioModeLazily[\s\S]{0,1500}?hasAnchors\s*\?\s*['"]perChunkWithAnchors['"]\s*:\s*['"]perChunkNoAnchors['"]/.test(hookSrc));

ok('spawn emite SYNC_MODE_NOT_READY_AT_PLAY cuando deriva lazily',
   /SYNC_MODE_NOT_READY_AT_PLAY[\s\S]{0,500}?derivedMode/.test(hookSrc));

ok('spawn persiste derived mode en audioModeRef',
   /SYNC_MODE_NOT_READY_AT_PLAY[\s\S]{0,1500}?ctx\.audioModeRef\.current\s*=\s*_spawnMode/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [8] Inventario: TODOS los .play() pasan por el helper
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[8] Inventario play() exhaustivo');

const playCallMatches = [...hookSrc.matchAll(/(\w+)\.play\(\)\s*\.then\(/g)];
ok('al menos 3 .play().then() en el hook',
   playCallMatches.length >= 3,
   `found ${playCallMatches.length}`);

// Cada .play().then() identificado debe quedar dentro de un bloque que
// incluya onAudioPlaybackStarted. BLOCKER FINAL V2 / TASK 2: ventana
// 1800→3500 — el path gapless ahora intercala GAPLESS_CHUNK_PLAY_CONFIRMED
// + PB_PLAY_RESOLVED antes del helper. El invariante (todo .play().then()
// pasa por onAudioPlaybackStarted) SIGUE vigente; solo creció la distancia.
let allCovered = true;
const uncovered = [];
for (const m of playCallMatches) {
    const start = m.index;
    const slice = hookSrc.slice(start, Math.min(start + 3500, hookSrc.length));
    if (!slice.includes('onAudioPlaybackStarted')) {
        allCovered = false;
        uncovered.push(`${m[1]}.play() at offset ${start}`);
    }
}
ok('TODOS los .play().then() están seguidos por onAudioPlaybackStarted',
   allCovered,
   uncovered.length > 0 ? `Uncovered: ${uncovered.join(', ')}` : '');

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
