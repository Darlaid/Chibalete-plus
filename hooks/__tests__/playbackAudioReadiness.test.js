/**
 * playbackAudioReadiness.test.js — F12 (audio contract + recovery).
 *
 * Verifica que el hook impone contrato de audio readiness antes de play()
 * y maneja NotSupportedError / tts_fail con recovery controlado en lugar
 * de hardResync visual.
 *
 * Cobertura (10 criterios del spec del usuario):
 *
 *   1. Hook expone isAudioFailed(idx) y ensurePlayableAudio(idx).
 *   2. tts_fail (getAudioUrl → null) marca audioFailedKeysRef.
 *   3. NotSupportedError en pActive.play() invalida cache + retry una vez.
 *   4. NotSupportedError NO dispara hardResync directo.
 *   5. Audio retry exitoso permite play (segundo load no agrega a retried).
 *   6. Audio retry fallido marca audioFailed + status='error' + onPlayChange(false).
 *   7. Si isAudioFailed(idx), load(autoPlay) NO ejecuta pActive.play() — pausa.
 *   8. Si isAudioFailed(nextIdx), doAdvance NO ejecuta nextEl.play() — pausa.
 *   9. reset() limpia audioFailedKeys y audioRetriedKeys (cross-content).
 *   10. ensurePlayableAudio emite logs PB_AUDIO_READY_CHECK + READY/FAILED.
 *
 * Cómo correr:
 *   node hooks/__tests__/playbackAudioReadiness.test.js
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

const hookSrc = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');

console.log('\nplaybackAudioReadiness — F12 (audio contract + recovery)');

// ───────────────────────────────────────────────────────────────────────────
// 1. Hook expone isAudioFailed y ensurePlayableAudio
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[1] API pública isAudioFailed + ensurePlayableAudio');

ok('Interface declara isAudioFailed(index): boolean',
   /interface\s+ImmersivePlayback[\s\S]+?isAudioFailed:\s*\(\s*index:\s*number\s*\)\s*=>\s*boolean/.test(hookSrc));

ok('Interface declara ensurePlayableAudio(index): Promise<{ ok, reason?, source? }>',
   /interface\s+ImmersivePlayback[\s\S]+?ensurePlayableAudio:\s*\(\s*index:\s*number\s*\)\s*=>\s*Promise<\s*\{\s*ok:\s*boolean[\s\S]+?\}\s*>/.test(hookSrc));

ok('Hook define const isAudioFailed',
   /const\s+isAudioFailed\s*=\s*\(\s*index:\s*number\s*\)\s*:\s*boolean\s*=>/.test(hookSrc));

ok('Hook define const ensurePlayableAudio como useCallback async',
   /const\s+ensurePlayableAudio\s*=\s*useCallback\s*\(\s*async\s*\(\s*index:\s*number\s*\)/.test(hookSrc));

ok('return del hook incluye isAudioFailed y ensurePlayableAudio',
   /return\s*\{[\s\S]+?isAudioFailed[\s\S]+?ensurePlayableAudio[\s\S]+?\};/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 2. tts_fail (getAudioUrl → null) marca audioFailedKeysRef
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[2] !url tras getAudioUrl marca audioFailedKeysRef');

ok('Refs audioFailedKeysRef y audioRetriedKeysRef declarados',
   /audioFailedKeysRef\s*=\s*useRef\s*\(\s*new\s+Set/.test(hookSrc) &&
   /audioRetriedKeysRef\s*=\s*useRef\s*\(\s*new\s+Set/.test(hookSrc));

// El path `if (!url)` debe añadir el key al audioFailedKeysRef.
ok('Path !url añade key a audioFailedKeysRef',
   /if\s*\(\s*!url\s*\)\s*\{[\s\S]{0,500}?audioFailedKeysRef\.current\.add\s*\(\s*toChunkKey\s*\(\s*index\s*\)\s*\)/.test(hookSrc));

ok('Path !url loguea PB_AUDIO_UNRECOVERABLE',
   /if\s*\(\s*!url\s*\)\s*\{[\s\S]{0,500}?PB_AUDIO_UNRECOVERABLE/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 3-4. NotSupportedError en pActive.play() invalida cache + retry una vez (NO hardResync)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[3-4] NotSupportedError: invalidar + retry una vez, NO hardResync');

// pActive.play().catch tiene rama específica para NotSupportedError.
// Ventana amplia porque el .then incluye audio_metadata + INV-9 cache audit.
ok('Catch de pActive.play tiene rama e.name === "NotSupportedError"',
   /pActive\.play\(\)[\s\S]{0,5000}?e\.name\s*===\s*['"]NotSupportedError['"]/.test(hookSrc));

ok('Rama NotSupportedError invalida cache (revokeObjectURL + delete)',
   /e\.name\s*===\s*['"]NotSupportedError['"][\s\S]{0,600}?URL\.revokeObjectURL[\s\S]{0,200}?audioCache\.current\.delete/.test(hookSrc));

ok('Rama NotSupportedError loguea PB_AUDIO_PLAY_UNSUPPORTED',
   /NotSupportedError[\s\S]{0,1500}?PB_AUDIO_PLAY_UNSUPPORTED/.test(hookSrc));

ok('Rama NotSupportedError loguea PB_AUDIO_CACHE_INVALIDATED',
   /NotSupportedError[\s\S]{0,1500}?PB_AUDIO_CACHE_INVALIDATED/.test(hookSrc));

ok('Rama NotSupportedError chequea audioRetriedKeysRef para retry',
   /NotSupportedError[\s\S]{0,1500}?audioRetriedKeysRef\.current\.has/.test(hookSrc));

ok('Rama NotSupportedError loguea PB_AUDIO_RETRY_ATTEMPT en primer retry',
   /audioRetriedKeysRef\.current\.add[\s\S]{0,300}?PB_AUDIO_RETRY_ATTEMPT/.test(hookSrc));

// REGRESSION: NotSupportedError NO debe disparar hardResync ni pb.skip
// ni dispatchMachine(HARD_RESYNC) en su rama.
const notSupportedBlocks = hookSrc.match(/e\.name\s*===\s*['"]NotSupportedError['"][\s\S]{0,2500}?\}\s*(else\s*\{|\}\s*\)\s*;)/g) ?? [];
let allCleanOfHardResync = notSupportedBlocks.length > 0;
for (const blk of notSupportedBlocks) {
    if (/hardResync\s*\(/.test(blk) || /HARD_RESYNC/.test(blk)) {
        allCleanOfHardResync = false;
        break;
    }
}
ok('NotSupportedError branches NO contienen hardResync ni HARD_RESYNC',
   allCleanOfHardResync,
   `branches=${notSupportedBlocks.length}`);

// ───────────────────────────────────────────────────────────────────────────
// 5-6. Retry exitoso vs retry fallido
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[5-6] Retry agotado → PB_AUDIO_UNRECOVERABLE + status="error"');

// Tras NotSupportedError + segundo intento (audioRetriedKeysRef.has=true),
// se marca audioFailed + setStatus('error') + log PB_AUDIO_UNRECOVERABLE.
ok('Segundo NotSupportedError marca audioFailedKeysRef.add',
   /audioRetriedKeysRef\.current\.has\s*\(\s*key\s*\)[\s\S]{0,400}?\}\s*else\s*\{[\s\S]{0,300}?audioFailedKeysRef\.current\.add/.test(hookSrc));

ok('Segundo NotSupportedError llama setStatus("error")',
   /audioRetriedKeysRef\.current\.has\s*\(\s*key\s*\)[\s\S]{0,500}?\}\s*else\s*\{[\s\S]{0,400}?setStatus\s*\(\s*['"]error['"]/.test(hookSrc));

ok('Segundo NotSupportedError loguea PB_AUDIO_UNRECOVERABLE',
   /audioFailedKeysRef\.current\.add[\s\S]{0,300}?PB_AUDIO_UNRECOVERABLE/.test(hookSrc));

// Retry exitoso = primer fallo → load(index, true) → reload limpio
ok('Primer NotSupportedError llama load(index, true) para retry',
   /audioRetriedKeysRef\.current\.add\s*\(\s*key\s*\)[\s\S]{0,400}?load\s*\(\s*index,\s*true\s*\)/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 7. isAudioFailed bloquea pActive.play() en load(autoPlay) — pausa, no hardResync
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[7] load(autoPlay): isAudioFailed bloquea play (sin hardResync)');

// M-5.4.6 (Phase 1.b.5) — requestAudioStart eliminado. El check de
// isAudioFailed sigue presente justo antes del play (Phase 1.b.B lo simplificará).
// La distancia incluye instrumentación PB_PLAY_ATTEMPT (~700 chars).
ok('load(autoPlay) chequea isAudioFailed(index) antes de pActive.play()',
   /if\s*\(\s*isAudioFailed\s*\(\s*index\s*\)\s*\)[\s\S]{0,2000}?pActive\.play/.test(hookSrc));

ok('Si isAudioFailed → log PB_AUDIO_UNRECOVERABLE + setStatus("error") + return',
   /if\s*\(\s*isAudioFailed\s*\(\s*index\s*\)\s*\)\s*\{[\s\S]{0,600}?PB_AUDIO_UNRECOVERABLE[\s\S]{0,300}?setStatus\s*\(\s*['"]error['"]\s*\)[\s\S]{0,200}?return;/.test(hookSrc));

// REGRESSION: el branch isAudioFailed en load NO debe llamar hardResync.
const loadFailBranch = hookSrc.match(/if\s*\(\s*isAudioFailed\s*\(\s*index\s*\)\s*\)\s*\{[\s\S]{0,800}?return;\s*\}/);
if (loadFailBranch) {
    ok('Branch isAudioFailed en load NO contiene hardResync',
       !/hardResync\s*\(/.test(loadFailBranch[0]));
}

// ───────────────────────────────────────────────────────────────────────────
// 8. doAdvance: isAudioFailed(nextIdx) bloquea nextEl.play() — pausa, no hardResync
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[8] doAdvance: isAudioFailed(nextIdx) bloquea autoadvance');

// M-5.4.6 (Phase 1.b.5) — requestAudioStart eliminado de doAdvance también.
ok('doAdvance chequea isAudioFailed(nextIdx) antes de nextEl.play()',
   // BLOCKER FINAL V2 / TASK 2: ventana 2000→4000 — el guard de chunk
   // (ensureAudioMatchesExpectedChunk + fallback) se intercala entre el
   // check isAudioFailed y nextEl.play(). El orden (check ANTES de play)
   // sigue garantizado; solo creció la distancia textual.
   /if\s*\(\s*isAudioFailed\s*\(\s*nextIdx\s*\)\s*\)[\s\S]{0,4000}?nextEl\.play/.test(hookSrc));

ok('Si isAudioFailed(nextIdx) → log PB_AUDIO_UNRECOVERABLE + setStatus + return',
   /if\s*\(\s*isAudioFailed\s*\(\s*nextIdx\s*\)\s*\)\s*\{[\s\S]{0,600}?PB_AUDIO_UNRECOVERABLE[\s\S]{0,300}?setStatus\s*\(\s*['"]error['"]\s*\)[\s\S]{0,200}?return;/.test(hookSrc));

const advanceFailBranch = hookSrc.match(/if\s*\(\s*isAudioFailed\s*\(\s*nextIdx\s*\)\s*\)\s*\{[\s\S]{0,800}?return;\s*\}/);
if (advanceFailBranch) {
    ok('Branch isAudioFailed en doAdvance NO contiene hardResync',
       !/hardResync\s*\(/.test(advanceFailBranch[0]));
}

// nextEl.play() también maneja NotSupportedError gapless:
ok('nextEl.play() tiene rama NotSupportedError separada del legacy gapless_fail',
   /nextEl\.play\(\)[\s\S]{0,3000}?e\.name\s*===\s*['"]NotSupportedError['"]/.test(hookSrc));

ok('Rama gapless NotSupportedError loguea PB_AUDIO_PLAY_UNSUPPORTED via=gapless',
   /PB_AUDIO_PLAY_UNSUPPORTED[\s\S]{0,200}?via:\s*['"]gapless['"]/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 9. reset() limpia audioFailedKeys + audioRetriedKeys
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[9] reset() limpia audioFailedKeys y audioRetriedKeys');

ok('reset() limpia audioFailedKeysRef',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1500}?audioFailedKeysRef\.current\.clear/.test(hookSrc));

ok('reset() limpia audioRetriedKeysRef',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1500}?audioRetriedKeysRef\.current\.clear/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 10. ensurePlayableAudio emite logs READY_CHECK + READY/READY_FAILED
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[10] ensurePlayableAudio emite logs estructurados');

const ensureBody = hookSrc.match(/const\s+ensurePlayableAudio\s*=\s*useCallback[\s\S]+?\},\s*\[getAudioUrl\]\s*\)/);
if (!ensureBody) {
    ok('cuerpo de ensurePlayableAudio localizable', false);
} else {
    const body = ensureBody[0];
    ok('Loguea PB_AUDIO_READY_CHECK al inicio',
       /PB_AUDIO_READY_CHECK/.test(body));
    ok('Loguea PB_AUDIO_READY_FAILED si isAudioFailed o no url',
       /PB_AUDIO_READY_FAILED/.test(body));
    ok('Loguea PB_AUDIO_READY si todo ok',
       /PB_AUDIO_READY[^_]/.test(body));
    ok('Retorna ok:false con reason cuando bloquea',
       /return\s*\{\s*ok:\s*false,\s*reason:/.test(body));
    ok('Retorna ok:true con source cuando pasa',
       /return\s*\{\s*ok:\s*true,\s*source:/.test(body));
}

// ───────────────────────────────────────────────────────────────────────────
// REGRESSION — la regla madre se mantiene: visual gate todavía existe
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[regresion] visual gate sigue presente (F4)');

// F12: entre requestAudioStart y pActive.play() ahora hay isAudioFailed check
// + setStatus + onPlayChange + sentenceStartTimeRef. Ventana ampliada.
// M-5.4.3: PB_PLAY_ATTEMPT instrumentation agrega ~700 chars adicionales
// antes del .play(). Ventana subida a 2500 para acomodar el nuevo log.
// M-5.4.6 (Phase 1.b.5) — REQUEST_AUDIO_START / requestAudioStart ELIMINADOS.
// El visor ya no autoriza audio. Estos guards no aplican. Quedan eliminados.

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
