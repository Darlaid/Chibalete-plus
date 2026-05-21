/**
 * perceptualStabilization.test.js — M-5.4.10 estructural (TASK 1-4 + REGLA CRÍTICA).
 *
 * Blinda el WIRING perceptual sobre el source real y la REGLA CRÍTICA:
 * NO se introdujeron nuevos reconciliadores / recovery loops / ownership
 * systems / watchdog actions / hard_resync / runtime mutations ocultas.
 * El comportamiento PURO vive en utils/__tests__/{visualDensityPlan,
 * activeSentenceFitLadder}.test.mjs.
 *
 * Cómo correr:
 *   node hooks/__tests__/perceptualStabilization.test.js
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

const hookSrc  = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');
const shellSrc = fs.readFileSync(path.join(ROOT, 'components', 'ImmersiveShell.tsx'), 'utf8');
const denSrc   = fs.readFileSync(path.join(ROOT, 'utils', 'visualDensityPlan.mjs'), 'utf8');
const fitSrc   = fs.readFileSync(path.join(ROOT, 'utils', 'activeSentenceFitLadder.mjs'), 'utf8');

function stripCommentsAndStrings(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

console.log('\nperceptualStabilization — M-5.4.10 estructural');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[1] TASK 1 — densidad visual normalizada (visual-only)');

ok('visor importa computeVisualDensityPlan/computeVisualPacing',
   /import\s*\{[^}]*computeVisualDensityPlan[^}]*computeVisualPacing[^}]*\}\s*from\s*['"]\.\.\/utils\/visualDensityPlan\.mjs['"]/.test(visorSrc));

ok('visor deriva densityPlan vía useMemo (puro, no efecto mutador)',
   /const\s+densityPlan\s*=\s*useMemo\(\s*\(\)\s*=>\s*computeVisualDensityPlan/.test(visorSrc));

ok('visor pasa densityContextLookahead/densityMode a <ImmersiveShell />',
   /<ImmersiveShell[\s\S]{0,2500}?densityContextLookahead=\{densityPlan\.contextLookahead\}[\s\S]{0,200}?densityMode=\{densityPlan\.mode\}/.test(visorSrc));

ok('emite VISUAL_DENSITY_NORMALIZED/EXPANDED/COMPACTED',
   /VISUAL_DENSITY_NORMALIZED/.test(visorSrc)
   && /VISUAL_DENSITY_EXPANDED/.test(visorSrc)
   && /VISUAL_DENSITY_COMPACTED/.test(visorSrc));

ok('ImmersiveShell renderiza banda de contexto SIN adelantar playback',
   /_isContext\s*=\s*!isActive[\s\S]{0,200}?densityMode\s*===\s*['"]expanded['"][\s\S]{0,200}?idx\s*<=\s*currentIndex\s*\+\s*densityContextLookahead/.test(shellSrc));

ok('contexto = tratamiento legible atenuado (NO destacado, no blur)',
   /_isContext[\s\S]{0,160}?opacity-60[\s\S]{0,40}?blur-none/.test(shellSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[2] TASK 2 — overflow zero tolerance');

ok('visor importa decideFitTier + TERMINAL_TIER',
   /import\s*\{[^}]*decideFitTier[^}]*TERMINAL_TIER[^}]*\}\s*from\s*['"]\.\.\/utils\/activeSentenceFitLadder\.mjs['"]/.test(visorSrc));

ok('visor usa decideFitTier (escalera determinista)',
   /decideFitTier\(\s*\{[\s\S]{0,200}?currentTier:\s*fitStateRef\.current\.tier/.test(visorSrc));

ok('ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED ELIMINADO del visor',
   !/\[ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED\]/.test(visorSrc));

ok('emite ACTIVE_SENTENCE_LAYOUT_FINAL_STATE con fontSize/lineHeight/renderCount/overflowDetected/compactTier',
   /\[ACTIVE_SENTENCE_LAYOUT_FINAL_STATE\][\s\S]{0,900}?fontSize[\s\S]{0,400}?lineHeight[\s\S]{0,400}?renderCount[\s\S]{0,400}?overflowDetected[\s\S]{0,400}?compactTier/.test(visorSrc));

ok('clamp scroll-safe: maxHeight + overflowY auto en item activo terminal',
   /_scrollSafeStyle[\s\S]{0,200}?maxHeight:\s*scrollSafeMaxPx[\s\S]{0,60}?overflowY:\s*['"]auto['"]/.test(shellSrc));

ok('clamp NO usa overflow:hidden (no oculta texto detrás de controles)',
   !/overflow:\s*['"]hidden['"]/.test(shellSrc));

ok('fit ladder converge SIEMPRE (scroll-safe terminal, sin rendirse)',
   /TERMINAL_TIER\s*=\s*'scroll-safe'/.test(fitSrc)
   && /clamp-final/.test(fitSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[3] TASK 3 — previous/next determinista (strict mode)');

ok('goToPreviousSentence = currentIndex - 1 estricto',
   /goToPreviousSentence[\s\S]{0,400}?manualSentenceJump\(\s*pb\.currentIndex\s*-\s*1\s*,\s*['"]button_previous['"]\s*\)/.test(visorSrc));

ok('goToNextSentence = currentIndex + 1 estricto',
   /goToNextSentence[\s\S]{0,400}?manualSentenceJump\(\s*pb\.currentIndex\s*\+\s*1\s*,\s*['"]button_next['"]\s*\)/.test(visorSrc));

ok('manualSentenceJump emite MANUAL_NAV_TARGET_RESOLVED con delta',
   /\[MANUAL_NAV_TARGET_RESOLVED\][\s\S]{0,300}?delta:\s*clamped\s*-\s*fromIdx/.test(hookSrc));

ok('same-chunk → MANUAL_NAV_SAME_CHUNK_REUSE, visual-only, sin reload audio',
   /_chunked\s*&&\s*_fromChunk\s*===\s*_toChunk[\s\S]{0,700}?\[MANUAL_NAV_SAME_CHUNK_REUSE\][\s\S]{0,1800}?setIdx\(\s*clamped\s*\)[\s\S]{0,500}?return\s*;/.test(hookSrc));

ok('same-chunk NO cancela executor NI hace load() (audio sigue, single executor)',
   (() => {
       const m = hookSrc.match(/\[MANUAL_NAV_SAME_CHUNK_REUSE\][\s\S]*?return\s*;/);
       if (!m) return false;
       const block = m[0];
       return !/cancelSyncStrategy\s*\(/.test(block)
           && !/\bload\s*\(\s*clamped/.test(block)
           && !/\.pause\s*\(/.test(block);
   })());

ok('cross-chunk / perSentence → MANUAL_NAV_CROSS_CHUNK_RELOAD (path previo intacto)',
   /\[MANUAL_NAV_CROSS_CHUNK_RELOAD\]/.test(hookSrc));

ok('sin heurísticas de nav (nearest-chunk / chunk-start fallback / replay ambiguo)',
   !/nearest[_-]?chunk/i.test(stripCommentsAndStrings(hookSrc))
   && !/rewindToChunkStart|fallbackToChunkStart/i.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[4] TASK 4 — pacing intra-chunk suave');

ok('visor deriva visualPacing (useMemo puro) + lo pasa como override',
   /const\s+visualPacing\s*=\s*useMemo\(/.test(visorSrc)
   && /scrollDurationMsOverride=\{visualPacing\.durationMs\}/.test(visorSrc));

ok('ImmersiveShell usa scrollDurationMsOverride para la transición',
   /const\s+scrollDurationMs\s*=\s*\(typeof\s+scrollDurationMsOverride\s*===\s*['"]number['"]/.test(shellSrc));

ok('emite VISUAL_PACING_APPLIED/DURATION/SEGMENTED',
   /VISUAL_PACING_APPLIED/.test(visorSrc)
   && /VISUAL_PACING_DURATION/.test(visorSrc)
   && /VISUAL_PACING_SEGMENTED/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n[5] REGLA CRÍTICA — nada de reconciliadores / ownership / runtime mutations');

ok('helpers PUROS: sin DOM/console/fetch/timers/dispatch',
   !/document\.|window\.|console\.|fetch\(|setTimeout|addEventListener|dispatch/.test(denSrc)
   && !/document\.|window\.|console\.|fetch\(|setTimeout|addEventListener|dispatch/.test(fitSrc));

ok('densityPlan NO llama pb.* / setIdx / dispatch / cancelSyncStrategy / hardResync',
   (() => {
       const m = visorSrc.match(/const\s+densityPlan\s*=\s*useMemo\(([\s\S]{0,400}?)\)\s*;/);
       if (!m) return false;
       const b = m[1];
       return /computeVisualDensityPlan/.test(b)
           && !/pb\.\w|setIdx|dispatch|cancelSyncStrategy|hardResync|skip\(|\.pause\(/.test(b);
   })());

ok('NO se introdujo PB_HARD_RESYNC nuevo en el path perceptual',
   !/M-?5\.4\.10[\s\S]{0,400}?PB_HARD_RESYNC/.test(visorSrc)
   && !/M-?5\.4\.10[\s\S]{0,400}?hardResync\(/.test(hookSrc));

ok('same-chunk reuse NO bumpea navGeneration ni despacha SKIP (ownership simple)',
   (() => {
       const m = hookSrc.match(/\[MANUAL_NAV_SAME_CHUNK_REUSE\][\s\S]*?return\s*;/);
       if (!m) return false;
       const block = m[0];
       return !/navGenerationRef\.current\s*=/.test(block)
           && !/MA\.SKIP/.test(block);
   })());

ok('runtimeWatchdog SIGUE sin acciones (read-only intacto post-M5.4.10)',
   (() => {
       const wd = stripCommentsAndStrings(
           fs.readFileSync(path.join(ROOT, 'utils', 'runtimeWatchdog.mjs'), 'utf8'));
       return !/\.pause\s*\(|\bhardResync\s*\(|\bcancelSyncStrategy\s*\(|\bdispatch\w*\s*\(/.test(wd);
   })());

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
