/**
 * playbackRuntimeIntegration.test.js — F3 (machine como observer runtime).
 *
 * Verifica estructuralmente (análisis estático del source) que
 * useImmersivePlayback.ts integra la state machine como fuente observacional:
 *
 *   1. Importa la machine (initialState, reduce, Actions).
 *   2. Define dispatchMachine.
 *   3. Define executeMachineEffects.
 *   4. load() dispatchea PREPARE_SENTENCE tras setIdx.
 *   5. play().then dispatchea AUDIO_STARTED.
 *   6. handleEnded dispatchea AUDIO_ENDED al inicio.
 *   7. doAdvance dispatchea SENTENCE_COMPLETED + PREPARE_SENTENCE.
 *   8. goLoad dispatchea SENTENCE_COMPLETED.
 *   9. pause() dispatchea PAUSE.
 *   10. skip() dispatchea SKIP.
 *   11. reset() dispatchea CONTENT_CHANGE.
 *   12. Hook expone acknowledgeVisualHighlight y notifyBlockComplete.
 *   13. API pública existente intacta (load, pause, resume, skip, skipNext,
 *       skipPrev, handleEnded, handleAudioError, prefetch, runGC, reset,
 *       isPendingAdvance).
 *
 * Estilo: análisis estático con regex sobre source — sin DOM, sin React render.
 * Compatible con el runner del package.json (node directo).
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackRuntimeIntegration.test.js
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

const src = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');

console.log('\nplaybackRuntimeIntegration — F3 (machine como observer runtime)');

// ───────────────────────────────────────────────────────────────────────────
// 1. Importa la machine
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[1] Importa la machine pura');
ok('Importa initialState como machineInit',
   /import\s*\{[^}]*initialState\s+as\s+machineInit[^}]*\}\s*from\s*['"]\.\.\/utils\/immersivePlaybackMachine\.js['"]/.test(src));
ok('Importa reduce como machineReduce',
   /import\s*\{[^}]*reduce\s+as\s+machineReduce[^}]*\}\s*from\s*['"]\.\.\/utils\/immersivePlaybackMachine\.js['"]/.test(src));
ok('Importa Actions como MA',
   /import\s*\{[^}]*Actions\s+as\s+MA[^}]*\}\s*from\s*['"]\.\.\/utils\/immersivePlaybackMachine\.js['"]/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 2. Define dispatchMachine
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[2] Define dispatchMachine');
// F4: dispatchMachine ahora retorna { effects } para que el caller pueda
// consultar BLOCK_AUDIO_START / play_audio sin re-dispatchear.
ok('dispatchMachine es función con retorno { effects }',
   /const\s+dispatchMachine\s*=\s*\(\s*action:\s*object\s*\)\s*:\s*\{\s*effects:\s*[^}]+\}\s*=>/.test(src));
ok('dispatchMachine llama machineReduce',
   /dispatchMachine[\s\S]{0,400}?machineReduce\s*\(\s*machineRef\.current/.test(src));
ok('dispatchMachine actualiza machineRef.current con el next state',
   /machineRef\.current\s*=\s*result\.state/.test(src));
ok('dispatchMachine llama executeMachineEffects con effects',
   /executeMachineEffects\s*\(\s*result\.effects\s*\)/.test(src));
ok('dispatchMachine retorna result.effects',
   /dispatchMachine[\s\S]{0,800}?return\s*\{\s*effects:\s*result\.effects\s*\}/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 3. Define executeMachineEffects
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[3] Define executeMachineEffects');
ok('executeMachineEffects es función',
   /const\s+executeMachineEffects\s*=\s*\(\s*effects:[^)]+\)\s*:\s*void\s*=>/.test(src));
ok('executeMachineEffects emite logs en analytics',
   /executeMachineEffects[\s\S]{0,800}?analytics\.emit/.test(src));
ok('executeMachineEffects observa BLOCK_AUDIO_START (placeholder F3)',
   /executeMachineEffects[\s\S]{0,1200}?BLOCK_AUDIO_START/.test(src));
ok('executeMachineEffects observa BLOCK_PROGRESS_SAVE (placeholder F3)',
   /executeMachineEffects[\s\S]{0,1200}?BLOCK_PROGRESS_SAVE/.test(src));
ok('executeMachineEffects NO re-ejecuta play_audio (evita double side effect)',
   !/executeMachineEffects[\s\S]{0,2000}?effect\.type\s*===\s*['"]play_audio['"]\s*[\s\S]{0,200}?\.play\(\)/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 4. load() dispatchea PREPARE_SENTENCE
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[4] load() dispatchea PREPARE_SENTENCE tras setIdx');
// load() es definido como `const load = useCallback(async (...) => { ... }, [...])`.
// Buscamos la ocurrencia de setIdx(index) seguida (dentro de ~500 chars) de
// dispatchMachine({ type: MA.PREPARE_SENTENCE, ...
ok('Hay setIdx(index) en load',
   /setIdx\s*\(\s*index\s*\)/.test(src));
ok('PREPARE_SENTENCE es dispatcheada con index',
   /dispatchMachine\s*\(\s*\{\s*type:\s*MA\.PREPARE_SENTENCE[\s\S]{0,300}?index[\s\S]{0,200}?\}\s*\)/.test(src));
ok('PREPARE_SENTENCE incluye displayText',
   /dispatchMachine\s*\(\s*\{\s*type:\s*MA\.PREPARE_SENTENCE[\s\S]{0,400}?displayText[\s\S]{0,100}?sentencesRef\.current/.test(src));
ok('PREPARE_SENTENCE incluye spokenText',
   /dispatchMachine\s*\(\s*\{\s*type:\s*MA\.PREPARE_SENTENCE[\s\S]{0,500}?spokenText[\s\S]{0,100}?audioSentencesRef\.current/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 5. play().then dispatchea AUDIO_STARTED
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[5] play().then dispatchea AUDIO_STARTED');
// BLOCKER M-5.4.3 — el dispatch inline de AUDIO_STARTED fue consolidado dentro
// del helper onAudioPlaybackStarted (centraliza dispatch + spawn + timestamps).
// Verificamos que (a) el helper despacha AUDIO_STARTED, y (b) cada play().then()
// llama al helper. Cobertura estructural detallada vive en playbackSpawnCoverage.
const helperDispatches = /const\s+onAudioPlaybackStarted[\s\S]{0,2500}?dispatchMachine\(\s*\{\s*type:\s*MA\.AUDIO_STARTED,\s*index\s*\}/.test(src);
ok('onAudioPlaybackStarted helper despacha AUDIO_STARTED con index',
   helperDispatches);

// Cada play().then() llama al helper (pActive en load, p en resume, nextEl en gapless)
ok('pActive.play().then → onAudioPlaybackStarted (load_autoplay)',
   /pActive\.play\(\)[\s\S]{0,1500}?onAudioPlaybackStarted\(\s*pActive\s*,\s*index\s*,\s*['"]load_autoplay['"]/.test(src));

ok('nextEl.play().then → onAudioPlaybackStarted (gapless_advance)',
   // BLOCKER FINAL V2 / TASK 2: ventana 1500→3500 — GAPLESS_CHUNK_PLAY_CONFIRMED
   // + PB_PLAY_RESOLVED se intercalan antes del helper en el path gapless.
   /nextEl\.play\(\)[\s\S]{0,3500}?onAudioPlaybackStarted\(\s*nextEl\s*,\s*nextIdx\s*,\s*['"]gapless_advance['"]/.test(src));

ok('resume p.play().then → onAudioPlaybackStarted (resume)',
   /p\.play\(\)[\s\S]{0,1500}?onAudioPlaybackStarted\(\s*p\s*,\s*currentIdxRef\.current\s*,\s*['"]resume['"]/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 6. handleEnded dispatchea AUDIO_ENDED al inicio
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[6] handleEnded dispatchea AUDIO_ENDED');
// handleEnded debe contener un dispatchMachine MA.AUDIO_ENDED con durationMs.
ok('handleEnded dispatchea AUDIO_ENDED con index y durationMs',
   /handleEnded[\s\S]{0,2000}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.AUDIO_ENDED[\s\S]{0,200}?index:\s*currentIdxRef\.current[\s\S]{0,200}?durationMs/.test(src));

// AUDIO_ENDED debe estar cerca del cálculo de durationMs (al inicio de handleEnded)
ok('AUDIO_ENDED se dispatchea cerca del cálculo de durationMs',
   /const\s+durationMs\s*=\s*Date\.now\(\)\s*-\s*sentenceStartTimeRef\.current;[\s\S]{0,500}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.AUDIO_ENDED/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 7. doAdvance dispatchea SENTENCE_COMPLETED y PREPARE_SENTENCE
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[7] doAdvance dispatchea SENTENCE_COMPLETED y PREPARE_SENTENCE para nextIdx');
ok('doAdvance dispatchea SENTENCE_COMPLETED para currentIdx',
   /doAdvance[\s\S]{0,1500}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.SENTENCE_COMPLETED,\s*index:\s*currentIdx\s*\}\s*\)/.test(src));
ok('doAdvance dispatchea PREPARE_SENTENCE para nextIdx',
   /doAdvance[\s\S]{0,2500}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.PREPARE_SENTENCE[\s\S]{0,300}?index:\s*nextIdx/.test(src));

// Orden: SENTENCE_COMPLETED debe aparecer ANTES de PREPARE_SENTENCE (regla:
// cerrar la frase antes de abrir la próxima). F4.2: doAdvance es async.
const doAdvanceBody = src.match(/const\s+doAdvance\s*=\s*async\s*\(\)\s*:\s*Promise<void>\s*=>\s*\{[\s\S]+?\};/);
if (doAdvanceBody) {
    const body = doAdvanceBody[0];
    const completedIdx = body.indexOf('MA.SENTENCE_COMPLETED');
    const prepareIdx   = body.indexOf('MA.PREPARE_SENTENCE');
    ok('SENTENCE_COMPLETED aparece ANTES de PREPARE_SENTENCE en doAdvance',
       completedIdx >= 0 && prepareIdx >= 0 && completedIdx < prepareIdx,
       `completed@${completedIdx}, prepare@${prepareIdx}`);
} else {
    ok('doAdvance body encontrado (sanity)', false, 'no se encontró el cuerpo de doAdvance (debe ser async)');
}

// ───────────────────────────────────────────────────────────────────────────
// 8. goLoad dispatchea SENTENCE_COMPLETED
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[8] goLoad (fallback path) dispatchea SENTENCE_COMPLETED');
ok('goLoad dispatchea SENTENCE_COMPLETED para currentIdx',
   /goLoad[\s\S]{0,800}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.SENTENCE_COMPLETED,\s*index:\s*currentIdx\s*\}\s*\)/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 9. pause() dispatchea PAUSE
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[9] pause() dispatchea PAUSE');
ok('pause useCallback contiene dispatchMachine MA.PAUSE',
   /const\s+pause\s*=\s*useCallback[\s\S]{0,1500}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.PAUSE\s*\}\s*\)/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 10. skip() dispatchea SKIP
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[10] skip() dispatchea SKIP con targetIndex');
// M-5.4.6 (Phase 1.b.C Task 2): el bump de navGenerationRef agrega ~400 chars
// entre la apertura de skip y el dispatchMachine. Ventana subida a 2200.
ok('skip useCallback contiene dispatchMachine MA.SKIP',
   /const\s+skip\s*=\s*useCallback[\s\S]{0,2200}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.SKIP,\s*targetIndex:\s*index\s*\}\s*\)/.test(src));

// El SKIP debe dispatchearse ANTES de load(), no después (el cancel del buffer
// va primero, luego load re-prepara).
const skipBody = src.match(/const\s+skip\s*=\s*useCallback[\s\S]+?\}\s*,\s*\[load\]\)/);
if (skipBody) {
    const body = skipBody[0];
    const skipDispatchIdx = body.indexOf('MA.SKIP');
    const loadCallIdx     = body.indexOf('load(index, true)');
    ok('dispatchMachine(SKIP) aparece ANTES de load(index, true) en skip',
       skipDispatchIdx >= 0 && loadCallIdx >= 0 && skipDispatchIdx < loadCallIdx,
       `skip@${skipDispatchIdx}, load@${loadCallIdx}`);
}

// ───────────────────────────────────────────────────────────────────────────
// 11. reset() dispatchea CONTENT_CHANGE
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[11] reset() dispatchea CONTENT_CHANGE');
ok('reset useCallback contiene dispatchMachine MA.CONTENT_CHANGE',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1500}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.CONTENT_CHANGE/.test(src));
ok('CONTENT_CHANGE incluye contentId, sessionKey, startIndex',
   /dispatchMachine\s*\(\s*\{\s*type:\s*MA\.CONTENT_CHANGE[\s\S]{0,400}?contentId[\s\S]{0,100}?sessionKey[\s\S]{0,100}?startIndex/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 12. Métodos públicos nuevos para F7
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[12] Hook expone notifyBlockComplete (M-5.4.6: acknowledgeVisualHighlight quedó como no-op deprecated)');
ok('acknowledgeVisualHighlight sigue exportado (stub no-op tras Phase 1.b.5)',
   /const\s+acknowledgeVisualHighlight\s*=\s*\(/.test(src));
ok('acknowledgeVisualHighlight YA NO dispatchea VISUAL_HIGHLIGHT_ACK',
   !/acknowledgeVisualHighlight[\s\S]{0,200}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.VISUAL_HIGHLIGHT_ACK/.test(src));
ok('notifyBlockComplete definido',
   /const\s+notifyBlockComplete\s*=\s*\(\s*\)\s*:\s*void\s*=>/.test(src));
ok('notifyBlockComplete dispatchea BLOCK_COMPLETE',
   /notifyBlockComplete[\s\S]{0,200}?dispatchMachine\s*\(\s*\{\s*type:\s*MA\.BLOCK_COMPLETE\s*\}/.test(src));

// La interface ImmersivePlayback debe declararlos
ok('Interface ImmersivePlayback declara acknowledgeVisualHighlight',
   /interface\s+ImmersivePlayback[\s\S]+?acknowledgeVisualHighlight:\s*\(\s*index:\s*number\s*\)\s*=>\s*void/.test(src));
ok('Interface ImmersivePlayback declara notifyBlockComplete',
   /interface\s+ImmersivePlayback[\s\S]+?notifyBlockComplete:\s*\(\s*\)\s*=>\s*void/.test(src));

// El return del hook debe incluirlos
ok('return del hook incluye acknowledgeVisualHighlight',
   /return\s*\{[\s\S]+?acknowledgeVisualHighlight[\s\S]+?\};/.test(src));
ok('return del hook incluye notifyBlockComplete',
   /return\s*\{[\s\S]+?notifyBlockComplete[\s\S]+?\};/.test(src));

// ───────────────────────────────────────────────────────────────────────────
// 13. API pública existente intacta
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[13] API pública existente sigue intacta (regresion guard)');
const publicMembers = [
    'audioRefA', 'audioRefB', 'status', 'isPlaying', 'currentIndex',
    'load', 'pause', 'resume', 'skip', 'skipNext', 'skipPrev',
    'handleEnded', 'handleAudioError', 'prefetch', 'runGC', 'reset',
    'isPendingAdvance',
];
for (const m of publicMembers) {
    ok(`return incluye ${m}`,
       new RegExp(`return\\s*\\{[\\s\\S]+?\\b${m}\\b[\\s\\S]+?\\};`).test(src));
}

// ───────────────────────────────────────────────────────────────────────────
// REGRESION — la machine NO debe duplicar side effects en F3
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] executeMachineEffects no duplica play_audio/save_progress');
// Si executeMachineEffects ejecutara play_audio, habría un .play() o dataService.updateProgreso
// dentro de su cuerpo. Verificamos que NO.
const exeBody = src.match(/const\s+executeMachineEffects\s*=[\s\S]+?\};\s*\n/);
if (exeBody) {
    const body = exeBody[0];
    ok('executeMachineEffects no llama .play()',
       !/\.play\s*\(\s*\)/.test(body));
    ok('executeMachineEffects no llama dataService.updateProgreso',
       !/dataService\.updateProgreso/.test(body));
    ok('executeMachineEffects no llama load(',
       !/\bload\s*\(/.test(body));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
