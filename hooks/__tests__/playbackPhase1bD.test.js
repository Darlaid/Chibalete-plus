/**
 * playbackPhase1bD.test.js — M-5.4.7 Operational Hardening regression.
 *
 * A. Fit perf bounded
 *    - max 2 retries
 *    - max 3 renders (initial + 2 downgrades)
 *    - ACTIVE_SENTENCE_LAYOUT_PERF emitido cuando settle
 *    - no RAF recursion
 *
 * B. Controls marker invariant
 *    - data-immersive-controls="true" presente en el visor
 *    - IMMERSIVE_CONTROLS_MARKER_MISSING emitido cuando ausente
 *    - flag de "logged once" para no spamear
 *    - counter expuesto en runtime
 *
 * C. Resize/orientation refit bounded
 *    - listeners de resize + orientationchange registrados
 *    - throttled via RAF
 *    - IMMERSIVE_VIEWPORT_CHANGED + ACTIVE_SENTENCE_REFIT_TRIGGERED logs
 *    - reset bounded: solo fitStateRef de la frase activa
 *    - cleanup en unmount
 *
 * D. Nav spam instrumentation
 *    - NAV_SPAM_SEQUENCE log por gesto
 *    - tracking lastFiveActions
 *    - counters staleCallbackRejects + executorCancels en diagnostics
 *
 * E. Long session health snapshot
 *    - RUNTIME_HEALTH_SNAPSHOT emitido cada 5 min en dev
 *    - dev gating (immersive_debug flag o import.meta.env.DEV)
 *    - cleanup del setInterval en unmount
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackPhase1bD.test.js
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

console.log('\nplaybackPhase1bD — operational hardening');

// ───────────────────────────────────────────────────────────────────────────
// [A] Fit perf bounded
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[A] Fit perf bounded');

ok('fitStateRef incluye firstRenderAt + renderCount',
   /firstRenderAt:\s*number\s*\|\s*null[\s\S]{0,200}?renderCount:\s*number/.test(visorSrc));

ok('Visor emite [ACTIVE_SENTENCE_LAYOUT_PERF]',
   /\[ACTIVE_SENTENCE_LAYOUT_PERF\]/.test(visorSrc));

ok('LAYOUT_PERF incluye layoutFitDurationMs',
   /ACTIVE_SENTENCE_LAYOUT_PERF[\s\S]{0,1000}?layoutFitDurationMs/.test(visorSrc));

ok('LAYOUT_PERF incluye measurementDurationMs',
   /ACTIVE_SENTENCE_LAYOUT_PERF[\s\S]{0,1000}?measurementDurationMs/.test(visorSrc));

ok('LAYOUT_PERF incluye renderCount',
   /ACTIVE_SENTENCE_LAYOUT_PERF[\s\S]{0,1000}?renderCount/.test(visorSrc));

ok('LAYOUT_PERF incluye settled flag',
   /ACTIVE_SENTENCE_LAYOUT_PERF[\s\S]{0,1000}?settled/.test(visorSrc));

// M-5.4.10 / TASK 2 — el bound `retries < 2` fue reemplazado por la escalera
// determinista decideFitTier (MAX_SHRINK_RETRIES + scroll-safe terminal). El
// pipeline sigue ACOTADO (converge siempre, sin loop) pero ya NO se "rinde"
// con overlap: scroll-safe garantiza no-overlap. Cobertura conductual del
// bound en utils/__tests__/activeSentenceFitLadder.test.mjs [6].
ok('Pipeline de fit ACOTADO vía decideFitTier (downgrade/settled/clamp-final)',
   /decideFitTier\(\s*\{/.test(visorSrc)
   && /_decision\.action\s*===\s*['"]downgrade['"]/.test(visorSrc)
   && /_decision\.action\s*===\s*['"]clamp-final['"]/.test(visorSrc));

ok('NO RAF recursion en fit (sólo setActiveFitTier que es bounded por retries)',
   !/requestAnimationFrame[\s\S]{0,200}?setActiveFitTier/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// [B] Controls marker invariant
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[B] Controls marker invariant');

ok('Visor incluye data-immersive-controls="true" en el DOM render',
   /data-immersive-controls="true"/.test(visorSrc));

ok('Visor emite [IMMERSIVE_CONTROLS_MARKER_MISSING] si controls === null',
   /\[IMMERSIVE_CONTROLS_MARKER_MISSING\]/.test(visorSrc));

ok('IMMERSIVE_CONTROLS_MARKER_MISSING incluye currentIndex/viewportHeight/contentId',
   /IMMERSIVE_CONTROLS_MARKER_MISSING[\s\S]{0,500}?currentIndex[\s\S]{0,200}?viewportHeight[\s\S]{0,200}?contentId/.test(visorSrc));

ok('controlsMarkerMissingLoggedRef previene spam (log una sola vez)',
   /controlsMarkerMissingLoggedRef/.test(visorSrc));

ok('controlsMarkerMissingCountRef expuesto para health snapshot',
   /controlsMarkerMissingCountRef/.test(visorSrc));

ok('Fallback degraded usa safe-zone explícita (window.innerHeight - 200), NO innerHeight crudo',
   /window\.innerHeight\s*-\s*200/.test(visorSrc));

ok('LAYOUT_FIT incluye controlsMarkerPresent flag',
   /ACTIVE_SENTENCE_LAYOUT_FIT[\s\S]{0,1500}?controlsMarkerPresent/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// [C] Resize/orientation hardening
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[C] Resize/orientation hardening');

ok('Visor registra listener resize',
   /window\.addEventListener\(\s*['"]resize['"]/.test(visorSrc));

ok('Visor registra listener orientationchange',
   /window\.addEventListener\(\s*['"]orientationchange['"]/.test(visorSrc));

ok('Handler throttled via requestAnimationFrame',
   /handleViewportChange[\s\S]{0,300}?requestAnimationFrame/.test(visorSrc));

ok('Emite [IMMERSIVE_VIEWPORT_CHANGED] con oldWidth/oldHeight/newWidth/newHeight/orientation/currentIndex',
   /\[IMMERSIVE_VIEWPORT_CHANGED\][\s\S]{0,800}?oldWidth[\s\S]{0,200}?oldHeight[\s\S]{0,200}?newWidth[\s\S]{0,200}?newHeight[\s\S]{0,200}?orientation[\s\S]{0,200}?currentIndex/.test(visorSrc));

ok('Emite [ACTIVE_SENTENCE_REFIT_TRIGGERED] con reason resize|orientationchange',
   /\[ACTIVE_SENTENCE_REFIT_TRIGGERED\][\s\S]{0,500}?reason/.test(visorSrc));

ok('Reset fit state SOLO de la frase activa (no rebuild)',
   /fitStateRef\.current\s*=\s*\{\s*index:\s*currentIndex,\s*tier:\s*['"]normal['"]/.test(visorSrc));

ok('Cleanup removeEventListener en unmount',
   /removeEventListener\(\s*['"]resize['"]/.test(visorSrc) &&
   /removeEventListener\(\s*['"]orientationchange['"]/.test(visorSrc));

ok('Cleanup cancela RAF pendiente',
   /cancelAnimationFrame\(rafId\)/.test(visorSrc));

ok('Short-circuit si dims no cambiaron (anti-spam)',
   /prev\.w\s*===\s*newW\s*&&\s*prev\.h\s*===\s*newH/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// [D] Nav spam instrumentation
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[D] Nav spam instrumentation');

ok('Visor declara navSpamSequenceRef',
   /navSpamSequenceRef\s*=\s*useRef/.test(visorSrc));

ok('Visor declara _recordNavSpam helper',
   /const\s+_recordNavSpam\s*=\s*useCallback/.test(visorSrc));

ok('Visor emite [NAV_SPAM_SEQUENCE]',
   /\[NAV_SPAM_SEQUENCE\]/.test(visorSrc));

ok('NAV_SPAM_SEQUENCE incluye action/generation/timestamp/currentIndex',
   /\[NAV_SPAM_SEQUENCE\][\s\S]{0,600}?action[\s\S]{0,200}?generation[\s\S]{0,200}?timestamp[\s\S]{0,200}?currentIndex/.test(visorSrc));

ok('lastFiveActions tracking incluye burst detection',
   /lastFiveActions/.test(visorSrc) && /burstMsSincePrev/.test(visorSrc));

ok('goToNextSentence registra spam antes del manualSentenceJump',
   /_recordNavSpam\(\s*['"]next['"][\s\S]{0,300}?pb\.manualSentenceJump\(/.test(visorSrc));

ok('goToPreviousSentence registra spam antes del manualSentenceJump',
   /_recordNavSpam\(\s*['"]previous['"][\s\S]{0,300}?pb\.manualSentenceJump\(/.test(visorSrc));

// Counters runtime
ok('Hook declara staleCallbackRejectCountRef',
   /staleCallbackRejectCountRef\s*=\s*useRef\(0\)/.test(hookSrc));

ok('Hook declara executorCancelCountRef',
   /executorCancelCountRef\s*=\s*useRef\(0\)/.test(hookSrc));

ok('Stale callback handler bumpea counter',
   /staleCallbackRejectCountRef\.current\s*\+=\s*1[\s\S]{0,500}?STALE_NAV_CALLBACK_REJECTED/.test(hookSrc));

ok('cancelSyncStrategy bumpea executorCancelCountRef',
   /cancelSyncStrategy[\s\S]{0,500}?executorCancelCountRef\.current\s*\+=\s*1/.test(hookSrc));

ok('STALE_NAV_CALLBACK_REJECTED log incluye totalRejects',
   /STALE_NAV_CALLBACK_REJECTED[\s\S]{0,800}?totalRejects/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [E] Long session health snapshot
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[E] Long session health snapshot');

ok('Visor emite [RUNTIME_HEALTH_SNAPSHOT]',
   /\[RUNTIME_HEALTH_SNAPSHOT\]/.test(visorSrc));

ok('Snapshot incluye activeExecutor/pendingTimeouts/cacheEntries/navGeneration',
   /RUNTIME_HEALTH_SNAPSHOT[\s\S]{0,1500}?activeExecutor[\s\S]{0,500}?pendingTimeouts[\s\S]{0,500}?cacheEntries[\s\S]{0,500}?navGeneration/.test(visorSrc));

ok('Snapshot incluye staleCallbackRejects + executorCancels',
   /RUNTIME_HEALTH_SNAPSHOT[\s\S]{0,1500}?staleCallbackRejects[\s\S]{0,200}?executorCancels/.test(visorSrc));

ok('Snapshot incluye uptimeMs',
   /RUNTIME_HEALTH_SNAPSHOT[\s\S]{0,1500}?uptimeMs/.test(visorSrc));

ok('Snapshot incluye detachedListenersEstimate',
   /detachedListenersEstimate/.test(visorSrc));

ok('Snapshot incluye fitRetries + fitTier',
   /RUNTIME_HEALTH_SNAPSHOT[\s\S]{0,1500}?fitRetries[\s\S]{0,200}?fitTier/.test(visorSrc));

ok('Snapshot incluye controlsMarkerMissingCount',
   /RUNTIME_HEALTH_SNAPSHOT[\s\S]{0,1500}?controlsMarkerMissingCount/.test(visorSrc));

ok('Snapshot corre cada 5 minutos (5 * 60 * 1000 ms)',
   /5\s*\*\s*60\s*\*\s*1000/.test(visorSrc));

ok('Snapshot dev-gated (immersive_debug flag o import.meta.env.DEV)',
   /immersive_debug/.test(visorSrc) && /import\.meta\.env\.DEV/.test(visorSrc));

ok('Snapshot cleanup setInterval en unmount',
   /return\s*\(\)\s*=>\s*clearInterval\(id\)/.test(visorSrc));

// Hook diagnostics
ok('getRuntimeDiagnostics expone navGeneration',
   /navGeneration:\s*navGenerationRef\.current/.test(hookSrc));

ok('getRuntimeDiagnostics expone staleCallbackRejects',
   /staleCallbackRejects:\s*staleCallbackRejectCountRef\.current/.test(hookSrc));

ok('getRuntimeDiagnostics expone executorCancels',
   /executorCancels:\s*executorCancelCountRef\.current/.test(hookSrc));

ok('getRuntimeDiagnostics expone uptimeMs',
   /uptimeMs:\s*Date\.now\(\)\s*-\s*runtimeStartedAtRef\.current/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// [F] Anti-regression — NO se introducen patterns prohibidos
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[F] Anti-regression guards');

ok('NO se introducen grace windows nuevas',
   !/INTRA_CHUNK_GRACE_MS/.test(visorSrc) &&
   !/MANUAL_NAV_GRACE_MS/.test(visorSrc));

ok('NO se introducen visualAck nuevos en el flow',
   !/acknowledgeVisualHighlight\([^_]/.test(visorSrc));

ok('NO se introducen hardResync nuevos en manual nav handlers',
   !/goToNextSentence[\s\S]{0,500}?hardResync/.test(visorSrc) &&
   !/goToPreviousSentence[\s\S]{0,500}?hardResync/.test(visorSrc));

ok('Snapshot NO bloquea ni muta runtime (try/catch defensive)',
   /RUNTIME_HEALTH_SNAPSHOT[\s\S]{0,3000}?catch\s*\{\s*\/\* defensive/.test(visorSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
