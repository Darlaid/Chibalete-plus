/**
 * playbackTimerNonBlocking.test.js — F14 (timer/nivel no bloquea playback).
 *
 * Verifica que el case 'complete' del BlockEngine subscribe en VisorInmersivo
 * NO llama pb.pause ni pb.notifyBlockComplete. El timer es solo UI/recompensa.
 *
 * Cobertura (8 criterios del spec del usuario):
 *
 *   1. case 'complete' NO llama pb.pause.
 *   2. case 'complete' NO llama pb.notifyBlockComplete.
 *   3. case 'complete' NO llama pb.skip / hardResync / nextContent.
 *   4. case 'complete' NO modifica currentIndex (no llama setIdx ni pb.load).
 *   5. case 'complete' SÍ loguea BLOCK_COMPLETE_END_SESSION (UI feedback).
 *   6. case 'complete' SÍ setea sessionComplete=true (UI overlay).
 *   7. setSessionComplete es la única mutación visible.
 *   8. pb.notifyBlockComplete sigue existiendo en API pero ya no se usa desde timer.
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackTimerNonBlocking.test.js
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

const hookSrc  = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');

console.log('\nplaybackTimerNonBlocking — F14 (timer no bloquea playback)');

// ───────────────────────────────────────────────────────────────────────────
// Localizar el case 'complete' del subscribe del BlockEngine
// ───────────────────────────────────────────────────────────────────────────

const completeBlock = visorSrc.match(/case\s+['"]complete['"]:[\s\S]+?break;/);
if (!completeBlock) {
    ok('case complete del BlockEngine localizable (sanity)', false);
    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
    process.exit(1);
}
const body = completeBlock[0];

// ───────────────────────────────────────────────────────────────────────────
// 1. F20/P1: case complete SÍ pausa con pausa CONTROLADA (Opción B).
//    El user pidió overlay bloqueante: pausar es OK porque F10 garantiza que
//    pb.pause() preserva buffer.current (no cancela activeSentence). La
//    intención "timer no bloquea" se respeta porque la frase activa sigue
//    visible y el user puede reanudar con +5 Minutos sin recovery dura.
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[1] case complete SÍ pausa audio (controlada, F20/Opción B)');
ok('case complete contiene pb.pause() — pausa controlada que NO cancela buffer',
   /pb\.pause\s*\(\s*\)/.test(body));

// ───────────────────────────────────────────────────────────────────────────
// 2. NO llama pb.notifyBlockComplete
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[2] case complete NO llama pb.notifyBlockComplete');
ok('case complete NO contiene pb.notifyBlockComplete(',
   !/pb\.notifyBlockComplete\s*\(/.test(body));

// ───────────────────────────────────────────────────────────────────────────
// 3. NO llama pb.skip / hardResync / nextContent / navigate
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[3] case complete NO llama skip/hardResync/navigate');
ok('case complete NO contiene pb.skip(',
   !/pb\.skip\s*\(/.test(body));
ok('case complete NO contiene pb.hardResync(',
   !/pb\.hardResync\s*\(/.test(body));
ok('case complete NO contiene pb.manualSentenceJump(',
   !/pb\.manualSentenceJump\s*\(/.test(body));
ok('case complete NO contiene navigate(',
   !/\bnavigate\s*\(/.test(body));
ok('case complete NO contiene triggerTransition',
   !/triggerTransition/.test(body));

// ───────────────────────────────────────────────────────────────────────────
// 4. NO modifica currentIndex
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[4] case complete NO modifica currentIndex');
ok('case complete NO contiene pb.load(',
   !/pb\.load\s*\(/.test(body));
ok('case complete NO contiene setIdx(',
   !/setIdx\s*\(/.test(body));
ok('case complete NO contiene pb.prepareSentence(',
   !/pb\.prepareSentence\s*\(/.test(body));

// ───────────────────────────────────────────────────────────────────────────
// 5. SÍ loguea BLOCK_COMPLETE_END_SESSION
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[5] case complete SÍ emite log BLOCK_COMPLETE_END_SESSION');
ok('case complete contiene immersiveLog BLOCK_COMPLETE_END_SESSION',
   /immersiveLog\s*\(\s*['"]BLOCK_COMPLETE_END_SESSION['"]/.test(body));
ok('Log incluye contentId / userId / elapsed / duration',
   /elapsed:\s*event\.elapsed/.test(body) && /duration:\s*event\.duration/.test(body));

// ───────────────────────────────────────────────────────────────────────────
// 6. SÍ setea sessionComplete=true
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[6] case complete SÍ muestra UI feedback (sessionComplete)');
ok('case complete llama setSessionComplete(true)',
   /setSessionComplete\s*\(\s*true\s*\)/.test(body));
ok('case complete marca sessionCompletingRef.current = true',
   /sessionCompletingRef\.current\s*=\s*true/.test(body));

// ───────────────────────────────────────────────────────────────────────────
// 7. setSessionComplete es la mutación visible (no toca audio/buffer/index)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[7] case complete: única mutación es UI (sessionComplete)');

// El cuerpo NO debe llamar funciones que toquen el playback
// F20: pb.pause sí está permitido (pausa controlada NO destruye buffer).
// Lo que NO está permitido es notifyBlockComplete (cancela buffer) ni
// hardResync ni manualSentenceJump (navegación) ni skip ni load.
const playbackTouchers = [
    'pb.resume', 'pb.skip', 'pb.skipNext', 'pb.skipPrev',
    'pb.load', 'pb.hardResync', 'pb.notifyBlockComplete', 'pb.manualSentenceJump',
    'pb.prepareSentence', 'pb.acknowledgeVisualHighlight',
];
for (const fn of playbackTouchers) {
    ok(`case complete NO toca ${fn}(`,
       !new RegExp(fn.replace(/\./g, '\\.') + '\\s*\\(').test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// 8. pb.notifyBlockComplete sigue existiendo en API
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[8] pb.notifyBlockComplete sigue existiendo en hook (no removida)');
ok('Interface ImmersivePlayback declara notifyBlockComplete',
   /interface\s+ImmersivePlayback[\s\S]+?notifyBlockComplete:\s*\(\s*\)\s*=>\s*void/.test(hookSrc));
ok('Hook define const notifyBlockComplete',
   /const\s+notifyBlockComplete\s*=\s*\(\s*\)\s*:\s*void\s*=>/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — el log explicit indica F14 explícito
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] log incluye nota F14 (auditoría)');
// F20: el log ahora indica audioPolicy: 'pause' (Opción B explícita).
ok('Log incluye audioPolicy: "pause" (F20 Opción B)',
   /audioPolicy:\s*['"]pause['"]/.test(body));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
