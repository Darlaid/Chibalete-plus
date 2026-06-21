/**
 * immersiveAudioRobustness.test.js — HF4A (Immersive Reader Frontend Resilience).
 *
 * Test ESTRUCTURAL sobre el source del hook (mismo patrón que
 * playbackAudioReadiness.test.js): valida que el contrato de recuperación
 * clear-on-valid-url esté implementado y que NO se rompan HF2/HF3 ni la
 * protección de fallos persistentes.
 *
 * Cobertura (spec del usuario):
 *   1. load() limpia audioFailedKeysRef cuando obtiene URL válida ANTES del
 *      pre_play_check.
 *   2. pre_play_check no emite PB_AUDIO_UNRECOVERABLE si hubo clear por URL
 *      válida (el clear ocurre antes del isAudioFailed pre_play_check).
 *   3. retryAudio limpia fallo recuperable y reintenta (load autoPlay).
 *   4. Se conservan marcas de decode/NotSupportedError (persistente + retry cap).
 *   5. No se eliminan logs/ramas HF2 (resume anclado) / HF3 (fallback corto).
 *
 * Cómo correr:
 *   node hooks/__tests__/immersiveAudioRobustness.test.js
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
const helperPath = path.join(ROOT, 'utils', 'immersiveAudioRecovery.mjs');
const visorSrc = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivo.tsx'), 'utf8');

console.log('\nimmersiveAudioRobustness — HF4A (clear-on-valid-url + retry honesto)');

// ───────────────────────────────────────────────────────────────────────────
// 0. Helper importado y refs nuevos
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[0] helper + refs');

ok('helper immersiveAudioRecovery.mjs existe', fs.existsSync(helperPath));
ok('hook importa classifyAudioFailure + shouldClearFailure desde el helper .mjs',
   /import\s*\{[\s\S]{0,160}?classifyAudioFailure[\s\S]{0,80}?shouldClearFailure[\s\S]{0,320}?\}\s*from\s*['"]\.\.\/utils\/immersiveAudioRecovery\.mjs['"]/.test(hookSrc));
ok('declara audioFailureReasonsRef = useRef(new Map)',
   /audioFailureReasonsRef\s*=\s*useRef\s*\(\s*new\s+Map/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 1-2. CLEAR-ON-VALID-URL en load() ANTES del pre_play_check
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[1-2] clear-on-valid-url precede al pre_play_check en load()');

ok('hook define clearRecoverableFailure que usa shouldClearFailure(reason, true)',
   /const\s+clearRecoverableFailure\s*=\s*\([\s\S]{0,260}?shouldClearFailure\s*\(\s*reason\s*,\s*true\s*\)/.test(hookSrc));

ok('clearRecoverableFailure emite PB_AUDIO_FAILED_CLEARED',
   /const\s+clearRecoverableFailure[\s\S]{0,800}?PB_AUDIO_FAILED_CLEARED/.test(hookSrc));

// load() + ensurePlayableAudio deben invocar el clear con 'valid_url' (>=2 sitios)
const clearValidUrlSites = hookSrc.match(/clearRecoverableFailure\s*\(\s*index\s*,\s*['"]valid_url['"]\s*\)/g) ?? [];
ok('clearRecoverableFailure(index, "valid_url") invocado en load() y ensurePlayableAudio (>=2)',
   clearValidUrlSites.length >= 2, `sitios=${clearValidUrlSites.length}`);

// ORDEN: el clear-on-valid-url debe ocurrir ANTES del pre_play_check
// (isAudioFailed con via:'pre_play_check'). Comparación por posición textual.
const idxClearValidUrl = hookSrc.indexOf("clearRecoverableFailure(index, 'valid_url')");
const idxPrePlayCheck  = hookSrc.indexOf("via: 'pre_play_check'");
ok('clear-on-valid-url aparece ANTES del pre_play_check en el source',
   idxClearValidUrl > 0 && idxPrePlayCheck > 0 && idxClearValidUrl < idxPrePlayCheck,
   `clear@${idxClearValidUrl} preplay@${idxPrePlayCheck}`);

// El pre_play_check sigue existiendo (no se eliminó el guard terminal real)
ok('pre_play_check todavía emite PB_AUDIO_UNRECOVERABLE para fallo terminal real',
   /PB_AUDIO_UNRECOVERABLE[^}]*via:\s*['"]pre_play_check['"]/.test(hookSrc));

// El path !url registra el motivo RECUPERABLE 'no_url' para que un intento
// posterior con URL válida pueda limpiarlo (clear-on-valid-url).
ok('path !url en load() registra motivo recuperable "no_url"',
   /if\s*\(\s*!url\s*\)\s*\{[\s\S]{0,700}?audioFailureReasonsRef\.current\.set\s*\(\s*toChunkKey\s*\(\s*index\s*\)\s*,\s*['"]no_url['"]\s*\)/.test(hookSrc));

// ensurePlayableAudio también limpia al obtener URL válida
ok('ensurePlayableAudio invoca clearRecoverableFailure(index, "valid_url")',
   /const\s+ensurePlayableAudio[\s\S]{0,2800}?clearRecoverableFailure\s*\(\s*index\s*,\s*['"]valid_url['"]\s*\)/.test(hookSrc));

ok('ensurePlayableAudio sólo bloquea de entrada si el fallo es persistente',
   /isAudioFailed\s*\(\s*index\s*\)[\s\S]{0,600}?classifyAudioFailure\s*\(\s*failReason\s*\)\s*===\s*['"]persistent['"]/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 3. retryAudio — reintento manual controlado
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[3] retryAudio limpia recuperable y reintenta');

ok('interface ImmersivePlayback declara retryAudio: () => void',
   /interface\s+ImmersivePlayback[\s\S]+?retryAudio:\s*\(\s*\)\s*=>\s*void/.test(hookSrc));

ok('hook define const retryAudio = useCallback',
   /const\s+retryAudio\s*=\s*useCallback\s*\(\s*\(\s*\)\s*:\s*void\s*=>/.test(hookSrc));

const retryBody = hookSrc.match(/const\s+retryAudio\s*=\s*useCallback[\s\S]+?\},\s*\[load\]\s*\)/);
if (!retryBody) {
    ok('cuerpo de retryAudio localizable (deps [load])', false);
} else {
    const body = retryBody[0];
    ok('retryAudio limpia SOLO si el fallo es recuperable',
       /classifyAudioFailure\s*\(\s*reason\s*\)\s*===\s*['"]recoverable['"]/.test(body));
    ok('retryAudio borra el key del índice actual (no global)',
       /audioFailedKeysRef\.current\.delete\s*\(\s*key\s*\)/.test(body) &&
       /audioFailureReasonsRef\.current\.delete\s*\(\s*key\s*\)/.test(body));
    ok('retryAudio emite PB_AUDIO_RETRY_MANUAL',
       /PB_AUDIO_RETRY_MANUAL/.test(body));
    ok('retryAudio reinvoca load(index, true) con autoPlay',
       /load\s*\(\s*index\s*,\s*true\s*,\s*\{[\s\S]{0,80}?reason:\s*['"]manual_retry['"]/.test(body));
    ok('retryAudio NO contiene hardResync (recuperación sin resync duro)',
       !/hardResync\s*\(/.test(body));
}

ok('return del hook incluye retryAudio',
   /return\s*\{[\s\S]+?retryAudio[\s\S]+?\};/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 4. Fallos persistentes conservados (decode/NotSupportedError)
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[4] persistente: NotSupportedError marcado + protección retry');

// Los dos branches NotSupportedError (load + gapless) registran motivo persistente
const persistentSets = hookSrc.match(/audioFailureReasonsRef\.current\.set\s*\(\s*key,\s*['"]NotSupportedError['"]\s*\)/g) ?? [];
ok('NotSupportedError registra motivo persistente en load y gapless (>=2 sitios)',
   persistentSets.length >= 2, `encontrados=${persistentSets.length}`);

ok('shouldClearFailure NO limpia persistente aunque haya URL (en helper)',
   /shouldClearFailure[\s\S]{0,400}?classifyAudioFailure\([\s\S]{0,40}?===\s*['"]recoverable['"]/.test(
       fs.readFileSync(helperPath, 'utf8')));

ok('audioRetriedKeysRef sigue protegiendo contra loop de retry',
   /audioRetriedKeysRef\.current\.has/.test(hookSrc) &&
   /audioRetriedKeysRef\.current\.add/.test(hookSrc));

ok('reset() limpia audioFailureReasonsRef (cross-content)',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,3000}?audioFailureReasonsRef\.current\.clear/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 5. Regresión — HF2 (resume anclado) + HF3 (fallback corto) intactos
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[5] regresión HF2/HF3 sigue presente');

// HF2 — resume TTS anclado.
ok('HF2: anchorFirstAudio / isResumeAnchoredPlay presente',
   /anchorFirstAudio/.test(hookSrc) && /isResumeAnchoredPlay/.test(hookSrc));
ok('HF2: log [immersive-tts-resume] presente',
   /immersive-tts-resume/.test(hookSrc));

// HF3 — recuperación primer TTS lento via unidad corta.
ok('HF3: firstSpeakableUnit + fallback timeout presente',
   /firstSpeakableUnit\s*\(/.test(hookSrc) && /TTS_FALLBACK_TIMEOUT_MS/.test(hookSrc));
ok('HF3: PB_AUDIO_RECOVERED + fallbackTtsKeysRef presente',
   /PB_AUDIO_RECOVERED/.test(hookSrc) && /fallbackTtsKeysRef/.test(hookSrc));

// ───────────────────────────────────────────────────────────────────────────
// 6. Logs nuevos requeridos + UX honesta del visor
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[6] logs nuevos + UX honesta');

for (const ev of ['PB_AUDIO_PREPARING', 'PB_AUDIO_DELAYED', 'PB_AUDIO_FAILED_CLEARED', 'PB_AUDIO_RETRY_MANUAL']) {
    ok(`hook emite ${ev}`, new RegExp(ev).test(hookSrc));
}
ok('PB_AUDIO_UNRECOVERABLE conservado para fallo terminal real',
   /PB_AUDIO_UNRECOVERABLE/.test(hookSrc));

ok('visor expone botón "Reintentar" en status error',
   /pb\.status\s*===\s*['"]error['"][\s\S]{0,200}?Reintentar/.test(visorSrc) ||
   /Reintentar/.test(visorSrc));
ok('visor invoca pb.retryAudio() en error',
   /pb\.retryAudio\s*\(\s*\)/.test(visorSrc));
ok('visor muestra "Preparando audio…" en loading',
   /Preparando audio/.test(visorSrc));

// ───────────────────────────────────────────────────────────────────────────
// 7. HF4A-R2 — triple coherencia (token/índice/completion) contra el race
// ───────────────────────────────────────────────────────────────────────────
console.log('\n[7] HF4A-R2 — guards de triple coherencia + descarte de tardíos');

// Helper puro importado y usado por el hook (no simulación).
ok('hook importa evaluateRecoveryCoherence del helper',
   /import\s*\{[\s\S]{0,260}?evaluateRecoveryCoherence[\s\S]{0,80}?\}\s*from\s*['"]\.\.\/utils\/immersiveAudioRecovery\.mjs['"]/.test(hookSrc));
ok('helper exporta evaluateRecoveryCoherence',
   /export\s+function\s+evaluateRecoveryCoherence/.test(fs.readFileSync(helperPath, 'utf8')));

// Eje completion: ref declarado + seteado en completion + reseteado en intención real.
ok('declara sessionCompletedRef = useRef(false)',
   /sessionCompletedRef\s*=\s*useRef\s*\(\s*false\s*\)/.test(hookSrc));
ok('completion (session_completed) marca sessionCompletedRef = true',
   /sessionCompletedRef\.current\s*=\s*true[\s\S]{0,400}?log\('session_completed'/.test(hookSrc));
ok('load() resetea sessionCompletedRef = false (re-engagement / leer de nuevo)',
   /=\s*\+\+loadToken\.current[\s\S]{0,900}?sessionCompletedRef\.current\s*=\s*false/.test(hookSrc));
ok('manualSentenceJump resetea sessionCompletedRef = false (cubre same-chunk sin load)',
   /manualSentenceJump\s*=\s*useCallback[\s\S]{0,2000}?sessionCompletedRef\.current\s*=\s*false/.test(hookSrc));
ok('reset() limpia sessionCompletedRef (cross-content)',
   /const\s+reset\s*=\s*useCallback[\s\S]{0,3600}?sessionCompletedRef\.current\s*=\s*false/.test(hookSrc));

// Guard post-getAudioUrl: evalúa coherencia y descarta con PB_AUDIO_STALE_RESULT_DROPPED.
ok('load() evalúa evaluateRecoveryCoherence tras getAudioUrl',
   /const\s+url\s*=\s*await\s+getAudioUrl\(index[\s\S]{0,1500}?evaluateRecoveryCoherence\s*\(/.test(hookSrc));
const staleDrops = hookSrc.match(/PB_AUDIO_STALE_RESULT_DROPPED/g) ?? [];
ok('load() emite PB_AUDIO_STALE_RESULT_DROPPED en >=2 sitios (post_getAudioUrl + pre_spawn)',
   staleDrops.length >= 2, `sitios=${staleDrops.length}`);
ok('el drop registra reason del helper (index_moved/session_completed/stale_token)',
   /event:\s*'PB_AUDIO_STALE_RESULT_DROPPED'[\s\S]{0,300}?reason:\s*_coh/.test(hookSrc));

// ORDEN CRÍTICO: la coherencia se evalúa ANTES del manejo de !url y ANTES del
// clear/spawn — para no contaminar estado de una frase abandonada. Se usan
// literales únicos (robustos a espaciado).
const idxCohPost   = hookSrc.indexOf("'post_getAudioUrl'");
const idxNoUrl     = hookSrc.indexOf("'no_url_after_getAudioUrl'");
const idxPreSpawn  = hookSrc.indexOf("'pre_spawn'");
const idxClearR2   = hookSrc.indexOf("clearRecoverableFailure(index, 'valid_url')");
ok('coherencia post-getAudioUrl precede al manejo de !url',
   idxCohPost > 0 && idxNoUrl > 0 && idxCohPost < idxNoUrl, `coh@${idxCohPost} noUrl@${idxNoUrl}`);
ok('revalidación pre-spawn precede al clear-on-valid-url',
   idxPreSpawn > 0 && idxClearR2 > 0 && idxPreSpawn < idxClearR2,
   `preSpawn@${idxPreSpawn} clear@${idxClearR2}`);

// retryAudio: guard estricto de contexto + skip log.
const retryBody2 = hookSrc.match(/const\s+retryAudio\s*=\s*useCallback[\s\S]+?\},\s*\[load\]\s*\)/);
if (retryBody2) {
    const rb = retryBody2[0];
    ok('retryAudio: no-op si status !== error o sesión completada',
       /statusRef\.current\s*!==\s*'error'\s*\|\|\s*sessionCompletedRef\.current/.test(rb));
    ok('retryAudio: emite PB_AUDIO_RETRY_SKIPPED_STALE_CONTEXT al descartar',
       /PB_AUDIO_RETRY_SKIPPED_STALE_CONTEXT/.test(rb));
    // El guard debe estar ANTES de la limpieza del fallo y del load().
    ok('retryAudio: guard de contexto precede al delete/load',
       rb.indexOf('PB_AUDIO_RETRY_SKIPPED_STALE_CONTEXT') < rb.indexOf('audioFailedKeysRef.current.delete'));
}

// ensurePlayableAudio: el clear queda condicionado a índice vigente + no completed.
ok('ensurePlayableAudio condiciona el clear a índice vigente y sesión no completada',
   /index\s*===\s*currentIdxRef\.current\s*&&\s*!sessionCompletedRef\.current[\s\S]{0,120}?clearRecoverableFailure\s*\(\s*index\s*,\s*['"]valid_url['"]\s*\)/.test(hookSrc));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
