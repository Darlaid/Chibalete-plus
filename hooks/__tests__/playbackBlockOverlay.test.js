/**
 * playbackBlockOverlay.test.js — F20 (overlay bloqueante + sync hook/machine).
 *
 * Verifica:
 *   P1: case 'complete' del BlockEngine usa Opción B (pausa controlada).
 *   P1: overlay no desmonta, +5 Minutos extiende+resume, Salir pausa+navigate.
 *   P2: logs de la machine (PAUSE, BLOCK_COMPLETE) usan buffer.current.index
 *       cuando existe, no committedIndex hardcoded. Fixea divergencia
 *       hook=83 vs machine=0.
 *   P3: cambio de libro loguea PB_CONTENT_CHANGE_BOOTSTRAP_START.
 *
 * Cobertura (10 criterios del spec):
 *
 *   1. case complete llama pb.pause() (Opción B explícita).
 *   2. case complete emite PB_BLOCK_COMPLETE_OVERLAY_SHOWN.
 *   3. case complete emite PB_BLOCK_COMPLETE_AUDIO_POLICY_PAUSE.
 *   4. +5 Minutos: log PB_BLOCK_EXTEND_TIME + startBlock(300_000) + resume/load.
 *   5. Salir: log PB_BLOCK_EXIT + pb.pause si playing + navigate(-1).
 *   6. Machine PAUSE log usa buffer.current.index ?? committedIndex.
 *   7. Machine BLOCK_COMPLETE log incluye bufferIndex.
 *   8. Cambio de libro emite PB_CONTENT_CHANGE_BOOTSTRAP_START.
 *   9. reset() sigue garantizando setStatus('idle').
 *   10. Overlay sigue siendo overlay inline (no return desmontante).
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackBlockOverlay.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

const hookSrc    = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const visorSrc   = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');
const machineSrc = fs.readFileSync(path.join(ROOT, 'utils', 'immersivePlaybackMachine.js'), 'utf8');

console.log('\nplaybackBlockOverlay — F20 (overlay bloqueante + sync hook/machine)');

// ───────────────────────────────────────────────────────────────────────────
// P1 — Opción B: pausa controlada + logs estructurados
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[P1] case complete: pausa controlada + logs PB_BLOCK_*');

const completeBlock = visorSrc.match(/case\s+['"]complete['"]:[\s\S]+?break;/);
if (!completeBlock) {
    ok('case complete localizable', false);
    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
    process.exit(1);
}
const body = completeBlock[0];

ok('case complete llama pb.pause() (Opción B explícita)',
   /pb\.pause\s*\(\s*\)/.test(body));

ok('case complete emite PB_BLOCK_COMPLETE_OVERLAY_SHOWN',
   /PB_BLOCK_COMPLETE_OVERLAY_SHOWN/.test(body));

ok('case complete emite PB_BLOCK_COMPLETE_AUDIO_POLICY_PAUSE',
   /PB_BLOCK_COMPLETE_AUDIO_POLICY_PAUSE/.test(body));

ok('case complete loguea audioPolicy: "pause" en BLOCK_COMPLETE_END_SESSION',
   /BLOCK_COMPLETE_END_SESSION[\s\S]{0,500}?audioPolicy:\s*['"]pause['"]/.test(body));

ok('case complete sigue manteniendo setSessionComplete(true) — overlay UI',
   /setSessionComplete\s*\(\s*true\s*\)/.test(body));

// REGRESSION: case complete NO debe destruir buffer ni hardResync
ok('case complete NO llama pb.hardResync',
   !/pb\.hardResync/.test(body));
ok('case complete NO llama pb.notifyBlockComplete (eso cancelaría buffer)',
   !/pb\.notifyBlockComplete/.test(body));

// ───────────────────────────────────────────────────────────────────────────
// P1 botones overlay: +5 Minutos / Salir
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[P1 botones] +5 Minutos y Salir con semántica clara');

const overlayBlock = visorSrc.match(/data-completion-overlay[\s\S]+?<\/div>\s*\)\s*\}/);
if (!overlayBlock) {
    ok('overlay block localizable', false);
} else {
    const ob = overlayBlock[0];

    ok('+5 Minutos loguea PB_BLOCK_EXTEND_TIME',
       /PB_BLOCK_EXTEND_TIME/.test(ob));
    ok('+5 Minutos llama startBlock(300_000)',
       /startBlock\s*\(\s*300_000\s*\)/.test(ob));
    ok('+5 Minutos llama setSessionComplete(false)',
       /setSessionComplete\s*\(\s*false\s*\)/.test(ob));
    ok('+5 Minutos llama pb.resume() o pb.load para reanudar',
       /pb\.resume\s*\(\s*\)/.test(ob) && /pb\.load\s*\(\s*pb\.currentIndex,\s*true\s*\)/.test(ob));

    ok('Salir loguea PB_BLOCK_EXIT',
       /PB_BLOCK_EXIT/.test(ob));
    ok('Salir llama pb.pause() condicional si isPlaying',
       /pb\.isPlaying[\s\S]{0,100}?pb\.pause/.test(ob));
    ok('Salir llama navigate(-1)',
       /navigate\s*\(\s*-1\s*\)/.test(ob));
}

// ───────────────────────────────────────────────────────────────────────────
// P2 — Logs de la machine usan buffer.current.index
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[P2] Machine logs corrigen divergencia hook/machine');

// case PAUSE: log playback_paused incluye bufferIndex + committedIndex separados
ok('case PAUSE: log playback_paused incluye bufferIndex',
   /case\s+Actions\.PAUSE:[\s\S]{0,2500}?playback_paused[\s\S]{0,300}?bufferIndex:\s*state\.buffer\.current\?\.index/.test(machineSrc));

ok('case PAUSE: pauseLogIndex prefiere buffer.current.index sobre committedIndex',
   /const\s+pauseLogIndex\s*=\s*state\.buffer\.current\?\.index\s*\?\?\s*state\.committedIndex/.test(machineSrc));

ok('case PAUSE: log playback_paused.data.index = pauseLogIndex (no committedIndex literal)',
   /playback_paused[\s\S]{0,300}?data:\s*\{\s*index:\s*pauseLogIndex/.test(machineSrc));

// case BLOCK_COMPLETE: log incluye bufferIndex
ok('case BLOCK_COMPLETE: log incluye bufferIndex',
   /block_complete_end_session[\s\S]{0,300}?bufferIndex:\s*state\.buffer\.current\?\.index/.test(machineSrc));

// ───────────────────────────────────────────────────────────────────────────
// P3 — Cambio de libro emite log de bootstrap
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[P3] Cambio de libro: PB_CONTENT_CHANGE_BOOTSTRAP_START');

ok('Visor emite PB_CONTENT_CHANGE_BOOTSTRAP_START en content change',
   /PB_CONTENT_CHANGE_BOOTSTRAP_START/.test(visorSrc));

ok('Log incluye fromContentId y pbStatusBefore para diagnóstico',
   /PB_CONTENT_CHANGE_BOOTSTRAP_START[\s\S]{0,400}?fromContentId:[\s\S]{0,100}?pbStatusBefore:/.test(visorSrc));

// reset() sigue limpiando todo (regression de F12+F15+F19)
ok('reset() llama setStatus("idle") al final',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,2500}?setStatus\s*\(\s*['"]idle['"]\s*\)/.test(hookSrc));

ok('reset() resetea hardResyncAttemptsRef.current = 0',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1500}?hardResyncAttemptsRef\.current\s*=\s*0/.test(hookSrc));

ok('reset() limpia audioFailedKeys + audioRetriedKeys',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1500}?audioFailedKeysRef\.current\.clear[\s\S]{0,300}?audioRetriedKeysRef\.current\.clear/.test(hookSrc));

ok('reset() incrementa contentSessionRef (invalida callbacks tardíos)',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1500}?contentSessionRef\.current\+\+/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — Overlay sigue inline, no return desmontante
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] Overlay sigue siendo inline (F19/A no se rompió)');

ok('No hay early return if (sessionComplete) que reemplace todo el JSX',
   !/if\s*\(\s*sessionComplete\s*\)\s*\{\s*\n\s*return\s*\(\s*\n\s*<div\s+className=["'][^"']*h-screen/.test(visorSrc));

ok('Overlay sigue con data-completion-overlay="true"',
   /data-completion-overlay\s*=\s*["']true["']/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — Sin hacks por contentId
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] Universal — sin hacks por libro/título/índice');

const forbidden = [
    /content(?:Id)?\s*[=!]==\s*['"]content-\d/,
    /Alicia/,
    /guerra de los mundos/i,
    /\bindex\s*===\s*72\b/,
    /\bindex\s*===\s*73\b/,
    /\bindex\s*===\s*0\b\s*&&/,
];
for (const re of forbidden) {
    ok(`Visor NO contiene patrón ${re}`,
       !re.test(visorSrc));
    ok(`Hook NO contiene patrón ${re}`,
       !re.test(hookSrc));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
