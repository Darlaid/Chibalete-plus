/**
 * playbackManualNavigation.test.js — F13 (botones anterior/siguiente).
 *
 * Verifica que los botones ant/sig hacen SOLO navegación local de frase:
 * pause + prepareSentence + setIdx + status='paused'. NO inician audio,
 * NO guardan progreso, NO disparan blockComplete, NO usan hardResync,
 * NO cambian contentId. El user reanuda con play que pasa por gates.
 *
 * Cobertura (11 criterios del spec del usuario):
 *
 *   1. Hook expone manualSentenceJump(targetIndex, reason).
 *   2. siguiente desde N llama manualSentenceJump(N+1, ...).
 *   3. anterior desde N llama manualSentenceJump(N-1, ...).
 *   4. clamp en [0, sentences.length-1].
 *   5. manual jump no llama .play() automáticamente.
 *   6. manual jump no llama updateProgreso.
 *   7. manual jump no llama notifyBlockComplete.
 *   8. manual jump no llama hardResync ni dispatch HARD_RESYNC.
 *   9. manual jump pausa audio + cancelPendingAdvance.
 *   10. manual jump dispatch PREPARE_SENTENCE para targetIndex.
 *   11. Botones del visor (ant/sig) usan manualSentenceJump (no skipNext/skipPrev).
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackManualNavigation.test.js
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

console.log('\nplaybackManualNavigation — F13 (botones anterior/siguiente)');

// ───────────────────────────────────────────────────────────────────────────
// 1. Hook expone manualSentenceJump
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[1] Hook expone manualSentenceJump(targetIndex, reason)');

ok('Interface declara manualSentenceJump',
   /interface\s+ImmersivePlayback[\s\S]+?manualSentenceJump:\s*\(\s*targetIndex:\s*number,\s*reason:\s*string\s*\)\s*=>\s*void/.test(hookSrc));

ok('Hook define const manualSentenceJump como useCallback',
   /const\s+manualSentenceJump\s*=\s*useCallback\s*\(\s*\(\s*targetIndex:\s*number,\s*reason:\s*string\s*\)/.test(hookSrc));

ok('return del hook incluye manualSentenceJump',
   /return\s*\{[\s\S]+?manualSentenceJump[\s\S]+?\};/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 2-3. Botones del visor
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[2-3] Visor: botones ant/sig llaman manualSentenceJump');

ok('Visor define goToPreviousSentence',
   /const\s+goToPreviousSentence\s*=\s*useCallback/.test(visorSrc));

ok('Visor define goToNextSentence',
   /const\s+goToNextSentence\s*=\s*useCallback/.test(visorSrc));

ok('goToPreviousSentence llama pb.manualSentenceJump(currentIndex - 1, "button_previous")',
   /goToPreviousSentence[\s\S]{0,500}?pb\.manualSentenceJump\s*\(\s*pb\.currentIndex\s*-\s*1,\s*['"]button_previous['"]\s*\)/.test(visorSrc));

ok('goToNextSentence llama pb.manualSentenceJump(currentIndex + 1, "button_next")',
   /goToNextSentence[\s\S]{0,500}?pb\.manualSentenceJump\s*\(\s*pb\.currentIndex\s*\+\s*1,\s*['"]button_next['"]\s*\)/.test(visorSrc));

// Logs estructurados de auditoría
ok('goToPreviousSentence loguea PB_MANUAL_PREVIOUS_SENTENCE',
   /goToPreviousSentence[\s\S]{0,500}?PB_MANUAL_PREVIOUS_SENTENCE/.test(visorSrc));

ok('goToNextSentence loguea PB_MANUAL_NEXT_SENTENCE',
   /goToNextSentence[\s\S]{0,500}?PB_MANUAL_NEXT_SENTENCE/.test(visorSrc));

// Los botones onClick usan los nuevos handlers (no skipNext/skipPrev)
ok('Botón ChevronLeft usa onClick={goToPreviousSentence}',
   /onClick=\{goToPreviousSentence\}[\s\S]{0,200}?ChevronLeft/.test(visorSrc));

ok('Botón SkipForward usa onClick={goToNextSentence}',
   /onClick=\{goToNextSentence\}[\s\S]{0,200}?SkipForward/.test(visorSrc));

// REGRESSION: los botones ant/sig YA NO llaman pb.skipPrev() ni pb.skipNext()
ok('Visor NO usa pb.skipPrev() en botones',
   !/onClick=\{[^}]*pb\.skipPrev/.test(visorSrc));

ok('Visor NO usa pb.skipNext() en botones',
   !/onClick=\{[^}]*pb\.skipNext/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// 4. Clamp en [0, sentences.length - 1]
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[4] manualSentenceJump clampa target a [0, total-1]');

// M-5.4.5: manualSentenceJump ahora delega a load() para actualizar audio src
// y autoplay condicional. La dep array cambió a [load]. El body ya NO contiene
// prepareSentence directo, setIdx directo, ni los logs PB_MANUAL_JUMP_READY
// (reemplazados por MANUAL_NAV_READY dentro del .then() de load).
const jumpBody = hookSrc.match(/const\s+manualSentenceJump\s*=\s*useCallback[\s\S]+?\},\s*\[(?:prepareSentence|load)\]\s*\)/);
if (!jumpBody) {
    ok('cuerpo de manualSentenceJump localizable', false);
} else {
    const body = jumpBody[0];

    ok('Lee total = sentencesRef.current.length',
       /const\s+total\s*=\s*ctx\.sentencesRef\.current\.length/.test(body));

    ok('Calcula clamped = Math.max(0, Math.min(total-1, targetIndex))',
       /Math\.max\s*\(\s*0,\s*Math\.min\s*\(\s*total\s*-\s*1,\s*targetIndex\s*\)\s*\)/.test(body));

    // ───────────────────────────────────────────────────────────────────────
    // 5. M-5.4.5: el play sigue siendo condicional al wasPlaying — el body
    // del helper no llama .play() literalmente; eso vive dentro de load().
    // Lo que sí verificamos es que NO llama requestAudioStart (autoplay no
    // se fuerza desde el helper).
    // ───────────────────────────────────────────────────────────────────────
    console.log('\n[5] manualSentenceJump no fuerza autoplay (requestAudioStart)');
    ok('manualSentenceJump body NO contiene requestAudioStart',
       !/requestAudioStart\s*\(/.test(body));

    // ───────────────────────────────────────────────────────────────────────
    // 6. NO llama updateProgreso
    // ───────────────────────────────────────────────────────────────────────
    console.log('\n[6] manualSentenceJump NO guarda progreso');
    ok('manualSentenceJump NO contiene updateProgreso',
       !/updateProgreso/.test(body));

    // ───────────────────────────────────────────────────────────────────────
    // 7. NO llama notifyBlockComplete
    // ───────────────────────────────────────────────────────────────────────
    console.log('\n[7] manualSentenceJump NO dispara blockComplete');
    ok('manualSentenceJump NO contiene notifyBlockComplete',
       !/notifyBlockComplete/.test(body));
    ok('manualSentenceJump NO dispatch BLOCK_COMPLETE',
       !/MA\.BLOCK_COMPLETE/.test(body));

    // ───────────────────────────────────────────────────────────────────────
    // 8. NO hardResync ni HARD_RESYNC
    // ───────────────────────────────────────────────────────────────────────
    console.log('\n[8] manualSentenceJump NO usa hardResync');
    ok('manualSentenceJump NO llama hardResync',
       !/\bhardResync\s*\(/.test(body));
    ok('manualSentenceJump NO dispatch HARD_RESYNC',
       !/MA\.HARD_RESYNC/.test(body));

    // ───────────────────────────────────────────────────────────────────────
    // 9. Pausa audio + cancelPendingAdvance + cancela executor (M-5.4.5)
    // ───────────────────────────────────────────────────────────────────────
    console.log('\n[9] manualSentenceJump pausa audio + cancela timers + executor');
    ok('manualSentenceJump llama cancelPendingAdvance',
       /cancelPendingAdvance\s*\(/.test(body));
    ok('manualSentenceJump pausa audioRefA',
       /audioRefA\.current\?\.pause\(\)/.test(body));
    ok('manualSentenceJump pausa audioRefB',
       /audioRefB\.current\?\.pause\(\)/.test(body));
    ok('manualSentenceJump invalida loadToken',
       /loadToken\.current\+\+/.test(body));
    // M-5.4.5: status puede ser 'loading' (si wasPlaying) o 'paused'.
    ok('manualSentenceJump setStatus("loading"|"paused") según wasPlaying',
       /setStatus\s*\(\s*wasPlaying\s*\?\s*['"]loading['"]\s*:\s*['"]paused['"]\s*\)/.test(body));
    ok('manualSentenceJump notifica onPlayChange(false)',
       /ctx\.onPlayChange\.current\s*\(\s*false\s*\)/.test(body));
    // M-5.4.5: cancela executor (sino executor stale sigue activando)
    ok('manualSentenceJump llama cancelSyncStrategy("manual_nav")',
       /cancelSyncStrategy\(\s*['"]manual_nav['"]\s*\)/.test(body));

    // ───────────────────────────────────────────────────────────────────────
    // 10. M-5.4.5: delega a load(clamped, wasPlaying). load() internamente
    // hace prepareSentence + setIdx + autoplay condicional.
    // ───────────────────────────────────────────────────────────────────────
    console.log('\n[10] manualSentenceJump delega a load() para audio src + autoplay');
    ok('manualSentenceJump llama load(clamped, wasPlaying)',
       /load\(\s*clamped\s*,\s*wasPlaying\s*\)/.test(body));
    ok('manualSentenceJump dispatch MA.SKIP a la machine',
       /dispatchMachine\(\s*\{\s*type:\s*MA\.SKIP/.test(body));

    // Logs M-5.4.5: MANUAL_NAV_* reemplazan PB_MANUAL_JUMP_READY
    ok('manualSentenceJump emite PB_MANUAL_SENTENCE_JUMP',
       /PB_MANUAL_SENTENCE_JUMP/.test(body));
    ok('manualSentenceJump emite MANUAL_NAV_START',
       /MANUAL_NAV_START/.test(body));
    ok('manualSentenceJump emite MANUAL_NAV_CANCEL_EXECUTOR',
       /MANUAL_NAV_CANCEL_EXECUTOR/.test(body));
    ok('manualSentenceJump emite MANUAL_NAV_READY',
       /MANUAL_NAV_READY/.test(body));
    ok('manualSentenceJump emite PB_MANUAL_JUMP_NO_PROGRESS_SAVE',
       /PB_MANUAL_JUMP_NO_PROGRESS_SAVE/.test(body));

    // Same-index → blocked + return early
    ok('manualSentenceJump no-op si clamped === fromIdx',
       /if\s*\(\s*clamped\s*===\s*fromIdx\s*\)/.test(body));
    ok('Caso same_index loguea PB_MANUAL_JUMP_BLOCKED',
       /PB_MANUAL_JUMP_BLOCKED[\s\S]{0,200}?same_index/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — el handler NO depende del timer/blockEngine
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] handlers ant/sig NO leen timer/blockEngine');

const goPrevBody = visorSrc.match(/const\s+goToPreviousSentence\s*=\s*useCallback[\s\S]+?\},\s*\[/);
const goNextBody = visorSrc.match(/const\s+goToNextSentence\s*=\s*useCallback[\s\S]+?\},\s*\[/);

if (goPrevBody && goNextBody) {
    const prevBody = goPrevBody[0];
    const nextBody = goNextBody[0];

    ok('goToPreviousSentence NO referencia blockEngineRef',
       !/blockEngineRef/.test(prevBody));
    ok('goToNextSentence NO referencia blockEngineRef',
       !/blockEngineRef/.test(nextBody));
    ok('goToPreviousSentence NO referencia timeLeft / sessionComplete',
       !/timeLeft|sessionComplete/.test(prevBody));
    ok('goToNextSentence NO referencia timeLeft / sessionComplete',
       !/timeLeft|sessionComplete/.test(nextBody));
    ok('goToPreviousSentence NO referencia content.id de otro libro (no condicional)',
       !/if\s*\(\s*content\.id/.test(prevBody));
    ok('goToNextSentence NO referencia content.id de otro libro (no condicional)',
       !/if\s*\(\s*content\.id/.test(nextBody));
}

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — pb.skip / skipNext / skipPrev del hook quedan como API legacy
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] pb.skip / skipNext / skipPrev siguen existiendo (legacy)');

ok('Interface ImmersivePlayback aún declara skip',
   /interface\s+ImmersivePlayback[\s\S]+?\bskip:\s*\(/.test(hookSrc));
ok('Interface aún declara skipNext',
   /interface\s+ImmersivePlayback[\s\S]+?\bskipNext:\s*\(/.test(hookSrc));
ok('Interface aún declara skipPrev',
   /interface\s+ImmersivePlayback[\s\S]+?\bskipPrev:\s*\(/.test(hookSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
