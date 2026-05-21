/**
 * gaplessChunkTransition.test.js — BLOCKER FINAL V2 / TASK 2+3+4.
 *
 * Verifica ESTRUCTURALMENTE (sobre el source real) que el hook respeta el
 * orden de eventos y la cancelación correcta del executor en la transición
 * gapless de chunk. El comportamiento puro vive en
 * utils/__tests__/gaplessChunkGuard.test.mjs (decisión) y
 * utils/__tests__/syncStrategyExecutor.test.mjs (executor); acá blindamos
 * el WIRING dentro de useImmersivePlayback.ts para que no regrese el bug.
 *
 * Tests nombrados (TASK 4):
 *   - executor_spawns_only_after_audio_ready
 *   - gapless_guard_runs_before_play (TASK 2 invariante)
 *   - chunk_audio_source_mismatch_cancels_prev_executor (TASK 3)
 *   - watchdog_desync_renamed_readonly (TASK 1)
 *
 * Cómo correr:
 *   node hooks/__tests__/gaplessChunkTransition.test.js
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
const wdSrc    = fs.readFileSync(path.join(ROOT, 'utils', 'runtimeWatchdog.mjs'), 'utf8');
const guardSrc = fs.readFileSync(path.join(ROOT, 'utils', 'gaplessChunkGuard.mjs'), 'utf8');

// Quita comentarios de bloque/línea y strings para que el grep negativo de
// "el watchdog NO LLAMA X" mida CÓDIGO real, no la prosa del invariante (que
// nombra explícitamente lo que el watchdog tiene prohibido hacer).
function stripCommentsAndStrings(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // line comments (no rompe http://)
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")  // single-quoted strings
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')  // double-quoted strings
        .replace(/`(?:[^`\\]|\\.)*`/g, '``'); // template strings
}
const wdCode = stripCommentsAndStrings(wdSrc);

console.log('\ngaplessChunkTransition — BLOCKER FINAL V2 estructural');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[1] gapless_guard_runs_before_play (TASK 2)');

ok('hook importa decideChunkTransition del módulo puro',
   /import\s*\{\s*decideChunkTransition\s*\}\s*from\s*'\.\.\/utils\/gaplessChunkGuard\.mjs'/.test(hookSrc));

ok('helper ensureAudioMatchesExpectedChunk definido',
   /const\s+ensureAudioMatchesExpectedChunk\s*=\s*async\s*\(/.test(hookSrc));

ok('helper usa decideChunkTransition (mismo código que los tests)',
   /ensureAudioMatchesExpectedChunk[\s\S]{0,3000}?decideChunkTransition\(\s*\{/.test(hookSrc));

ok('helper emite GAPLESS_CHUNK_TRANSITION_START',
   /ensureAudioMatchesExpectedChunk[\s\S]{0,2000}?\[GAPLESS_CHUNK_TRANSITION_START\]/.test(hookSrc));

ok('helper emite CHUNK_AUDIO_SOURCE_MISMATCH en mismatch',
   /\[CHUNK_AUDIO_SOURCE_MISMATCH\]/.test(hookSrc));

ok('helper emite GAPLESS_CHUNK_AUDIO_LOAD_REQUIRED',
   /\[GAPLESS_CHUNK_AUDIO_LOAD_REQUIRED\]/.test(hookSrc));

ok('helper emite GAPLESS_CHUNK_AUDIO_READY',
   /\[GAPLESS_CHUNK_AUDIO_READY\]/.test(hookSrc));

// El guard se llama (await) ANTES del PB_PLAY_ATTEMPT gapless y del nextEl.play().
// Aislamos el bloque doAdvance gapless para medir orden source-local real.
const gaplessBlock = (hookSrc.match(
   /const\s+_chunkGuard\s*=\s*await\s+ensureAudioMatchesExpectedChunk[\s\S]*?onAudioPlaybackStarted\(\s*nextEl\s*,\s*nextIdx\s*,\s*'gapless_advance'\s*\)/
) || [''])[0];
ok('bloque gapless doAdvance localizado', gaplessBlock.length > 0);

const idxGuard   = gaplessBlock.indexOf('await ensureAudioMatchesExpectedChunk');
const idxFail    = gaplessBlock.indexOf("_chunkGuard === 'fail'");
const idxAttempt = gaplessBlock.indexOf('[PB_PLAY_ATTEMPT]');
const idxPlay    = gaplessBlock.indexOf('nextEl.play()');
const idxConfirm = gaplessBlock.indexOf('[GAPLESS_CHUNK_PLAY_CONFIRMED]');
const idxResolved= gaplessBlock.indexOf('[PB_PLAY_RESOLVED]');
const idxSpawn   = gaplessBlock.search(/onAudioPlaybackStarted\(\s*nextEl/);

ok('await ensureAudioMatchesExpectedChunk ocurre ANTES de nextEl.play()',
   idxGuard >= 0 && idxPlay > idxGuard, `guard@${idxGuard} play@${idxPlay}`);

ok('PB_PLAY_ATTEMPT gapless ocurre DESPUÉS del guard',
   idxAttempt > idxGuard && idxAttempt < idxPlay,
   `guard@${idxGuard} attempt@${idxAttempt} play@${idxPlay}`);

ok('si guard === fail → fallback load() + return (NO play, NO spawn)',
   /_chunkGuard\s*===\s*'fail'\s*\)\s*\{[\s\S]{0,800}?load\(\s*nextIdx\s*,\s*true\s*\)\s*;\s*return\s*;/.test(gaplessBlock)
   && idxFail >= 0 && idxFail < idxPlay,
   'el branch fail debe hacer load()+return antes del play()');

ok('GAPLESS_CHUNK_PLAY_CONFIRMED se emite tras play() (dentro del .then)',
   idxConfirm > idxPlay, `play@${idxPlay} confirm@${idxConfirm}`);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[2] executor_spawns_only_after_audio_ready (TASK 2)');

ok('onAudioPlaybackStarted emite SYNC_SPAWN_AFTER_AUDIO_READY',
   /onAudioPlaybackStarted[\s\S]{0,2500}?\[SYNC_SPAWN_AFTER_AUDIO_READY\]/.test(hookSrc));

ok('SYNC_SPAWN_AFTER_AUDIO_READY se emite ANTES de spawnSyncExecutorIfChunked',
   // M-5.4.14: ventana 600→1500 — FINAL_AUDIO_STATE (observabilidad pura) se
   // intercala entre el log y el spawn. El ORDEN sigue garantizado.
   /\[SYNC_SPAWN_AFTER_AUDIO_READY\][\s\S]{0,2400}?spawnSyncExecutorIfChunked\(\s*audioEl\s*,\s*index\s*,\s*callsite\s*\)/.test(hookSrc),
   'el spawn debe ocurrir después del log de audio-ready');

// Orden gapless garantizado dentro del .then() de play():
//   GAPLESS_CHUNK_PLAY_CONFIRMED → PB_PLAY_RESOLVED → onAudioPlaybackStarted
//   (→ SYNC_SPAWN_AFTER_AUDIO_READY → spawn). Source-local = orden real.
ok('en gapless: GAPLESS_CHUNK_PLAY_CONFIRMED precede a PB_PLAY_RESOLVED',
   idxConfirm >= 0 && idxResolved > idxConfirm,
   `confirm@${idxConfirm} resolved@${idxResolved}`);

ok('en gapless: PB_PLAY_RESOLVED precede a onAudioPlaybackStarted (spawn)',
   idxResolved >= 0 && idxSpawn > idxResolved,
   `resolved@${idxResolved} spawn@${idxSpawn}`);

// El guard (que emite GAPLESS_CHUNK_AUDIO_READY internamente) corre y se
// AWAITEA antes del play(): el orden runtime READY → PLAY → SPAWN está probado
// conductualmente en utils/__tests__/gaplessChunkGuard.test.mjs (decisión) +
// syncStrategyExecutor.test.mjs (executor). Acá fijamos el wiring estructural.
ok('guard (emite GAPLESS_CHUNK_AUDIO_READY) se awaita antes del play()',
   idxGuard >= 0 && idxGuard < idxPlay
   && /\[GAPLESS_CHUNK_AUDIO_READY\]/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[3] chunk_audio_source_mismatch_cancels_prev_executor (TASK 3)');

ok('en mismatch (reload) se llama cancelSyncStrategy ANTES de recargar audio',
   /decision\.action[\s\S]{0,1500}?cancelSyncStrategy\(\s*'gapless_chunk_transition'\s*\)[\s\S]{0,200}?audioEl\.src\s*=/.test(hookSrc),
   'el executor del chunk anterior debe cancelarse antes de cargar el nuevo audio');

ok('executor: SYNC_STRATEGY_COMPLETE emitido vía emitCompleteOnce (idempotente)',
   /emitCompleteOnce\s*\(/.test(fs.readFileSync(path.join(ROOT, 'utils', 'syncStrategyExecutor.mjs'), 'utf8')));

const execSrc = fs.readFileSync(path.join(ROOT, 'utils', 'syncStrategyExecutor.mjs'), 'utf8');
ok('executor: detachTimeupdate desengancha timeupdate al completar',
   /const\s+detachTimeupdate\s*=\s*\(\)\s*=>/.test(execSrc)
   && /emitCompleteOnce\(\s*viaLabel\s*,\s*true/.test(execSrc));

ok('executor: completeEmitted flag previene doble SYNC_STRATEGY_COMPLETE',
   /let\s+completeEmitted\s*=\s*false/.test(execSrc)
   && /if\s*\(\s*completeEmitted\s*\)\s*return/.test(execSrc));

ok('executor: ya NO hay log SYNC_STRATEGY_COMPLETE crudo en tickActivate',
   !/if\s*\(\s*activatedSet\.size\s*>=\s*timeline\.length[\s\S]{0,120}?log\(\s*'SYNC_STRATEGY_COMPLETE'/.test(execSrc),
   'la emisión cruda en tickActivate fue reemplazada por emitCompleteOnce');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[4] watchdog_desync_renamed_readonly (TASK 1)');

ok('runtimeWatchdog emite WATCHDOG_DESYNC_OBSERVED_READONLY',
   /WATCHDOG_DESYNC_OBSERVED_READONLY/.test(wdSrc));

ok('runtimeWatchdog ya NO emite WATCHDOG_DESYNC_WARNING',
   !/log\(\s*'WATCHDOG_DESYNC_WARNING'/.test(wdSrc));

ok('VisorInmersivo SEVERITY mapea READONLY a info (no critical)',
   /WATCHDOG_DESYNC_OBSERVED_READONLY:\s*'info'/.test(visorSrc));

ok('VisorInmersivo SEVERITY ya NO tiene WATCHDOG_DESYNC_WARNING: critical',
   !/WATCHDOG_DESYNC_WARNING:\s*'critical'/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[5] watchdog_read_only_absoluto — grep negativo (TASK 1)');

// El módulo watchdog NO debe contener NINGUNA capacidad de intervención.
// Patrones de LLAMADA (intervención), no de lectura. Leer
// snap.hardResyncCount es observación read-only legítima (el watchdog emite
// WATCHDOG_HARD_RESYNC_CASCADE OBSERVANDO ese contador) — por eso el patrón
// prohibido es la INVOCACIÓN `hardResync(`, no la propiedad `hardResyncCount`.
const FORBIDDEN = [
    [/\.pause\s*\(/,                       'pause('],
    [/\bhardResync\s*\(/,                  'hardResync('],
    [/\bcancelSyncStrategy\s*\(/,          'cancelSyncStrategy('],
    [/\bdispatchMachine\s*\(|\bdispatch\s*\(/, 'dispatch('],
    [/\.cleanup\s*\(/,                     'cleanup('],
    [/\bsetIdx\s*\(|\bsetCurrentIndex\s*\(/, 'setIdx('],
    [/\bonSessionEnd\s*(\.current)?\s*\(/, 'onSessionEnd('],
];
for (const [re, name] of FORBIDDEN) {
    // wdCode = source SIN comentarios/strings → mide llamadas reales, no la
    // prosa del invariante (que NOMBRA lo prohibido para documentarlo).
    ok(`runtimeWatchdog.mjs NO LLAMA "${name}" (código real, sin prosa)`,
       !re.test(wdCode),
       `patrón prohibido encontrado en código: ${name}`);
}

ok('gaplessChunkGuard.mjs es PURO (sin DOM/console/fetch/timers)',
   !/document\.|window\.|console\.|fetch\(|setTimeout|addEventListener/.test(guardSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
