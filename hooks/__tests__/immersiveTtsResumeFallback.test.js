/**
 * HF3 structural guard: when the first on-demand TTS of a book without
 * pre-generated manifest audio fails (TimeoutError / long first sentence /
 * cold backend), getAudioUrl must recover with a shorter speakable unit
 * instead of returning null straight into PB_AUDIO_UNRECOVERABLE ("Sin audio").
 *
 * Root cause (Pinocchio content-1775775232788, no progress):
 *   manifest miss on chunk 0 → on-demand TTS of audioSentences[0] → single
 *   20s attempt → TimeoutError → getAudioUrl null → load() marks UNRECOVERABLE.
 *
 * Run:
 *   node hooks/__tests__/immersiveTtsResumeFallback.test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');

const hookSrc = fs.readFileSync(path.join(ROOT, 'hooks', 'useImmersivePlayback.ts'), 'utf8');
const v2Src = fs.readFileSync(path.join(ROOT, 'pages', 'VisorInmersivoV2.tsx'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, condition, detail = '') {
    if (condition) { console.log(`  ok ${label}`); pass++; }
    else { console.error(`  fail ${label}${detail ? ` - ${detail}` : ''}`); fail++; }
}

console.log('immersiveTtsResumeFallback - HF3 guard');

console.log('\n[A] helper de unidad hablable de fallback');
ok('Define firstSpeakableUnit(text, maxChars)',
   /function\s+firstSpeakableUnit\s*\(\s*text:\s*string,\s*maxChars:\s*number\s*\)\s*:\s*string/.test(hookSrc));
ok('firstSpeakableUnit parte por puntuación de frase/cláusula',
   /firstSpeakableUnit[\s\S]{0,400}?\[\^\.!\?…;:\\n\]\+\[\.!\?…;:\\n\]\*/.test(hookSrc));
ok('firstSpeakableUnit no usa lookbehind (compat Safari)',
   /function\s+firstSpeakableUnit[\s\S]{0,600}?\}/.test(hookSrc) &&
   !/firstSpeakableUnit[\s\S]{0,600}?\(\?<=/.test(hookSrc));
ok('Constantes de timeout/umbral declaradas',
   /TTS_PRIMARY_TIMEOUT_MS\s*=\s*20000/.test(hookSrc) &&
   /TTS_FALLBACK_TIMEOUT_MS\s*=\s*15000/.test(hookSrc) &&
   /TTS_FALLBACK_MAX_CHARS\s*=\s*220/.test(hookSrc));

console.log('\n[B] intento primario + fallback aislados por AbortController propio');
ok('attemptTts crea AbortController propio enlazado al padre',
   /const\s+attemptTts\s*=\s*async[\s\S]{0,300}?new AbortController\(\)/.test(hookSrc) &&
   /addEventListener\(\s*['"]abort['"]\s*,\s*onParentAbort/.test(hookSrc));
ok('attemptTts tiene timeout propio que aborta sólo su intento',
   /const\s+attemptTts[\s\S]{0,600}?setTimeout\([\s\S]{0,160}?TimeoutError/.test(hookSrc));
ok('materializeTts valida ok/content-type/blob sin lanzar',
   /const\s+materializeTts\s*=\s*async\s*\(\s*res:\s*Response/.test(hookSrc) &&
   /materializeTts[\s\S]{0,2200}?startsWith\(\s*['"]audio\//.test(hookSrc));
ok('Intento primario usa la frase completa y timeout primario',
   /attemptTts\(\s*txt,\s*TTS_PRIMARY_TIMEOUT_MS,\s*['"]primary['"]\s*\)/.test(hookSrc));

console.log('\n[C] fallback por unidad corta ante fallo recuperable');
ok('Bloque fallback sólo si no hubo url y la carga no fue cancelada',
   /if\s*\(\s*!url\s*&&\s*!abortCtrl\.signal\.aborted\s*&&\s*!ctx\.unmountedRef\.current\s*\)/.test(hookSrc));
ok('Fallback recorta con firstSpeakableUnit(txt, TTS_FALLBACK_MAX_CHARS)',
   /firstSpeakableUnit\(\s*txt,\s*TTS_FALLBACK_MAX_CHARS\s*\)/.test(hookSrc));
ok('Fallback reintenta TTS con timeout de fallback',
   /attemptTts\(\s*shortText,\s*TTS_FALLBACK_TIMEOUT_MS,\s*['"]fallback['"]\s*\)/.test(hookSrc));
ok('Éxito de fallback marca recoveredViaFallback + fallbackTtsKeysRef',
   /recoveredViaFallback\s*=\s*true/.test(hookSrc) &&
   /fallbackTtsKeysRef\.current\.add\(\s*key\s*\)/.test(hookSrc));
ok('fallbackTtsKeysRef declarado y limpiado en reset',
   /fallbackTtsKeysRef\s*=\s*useRef\(\s*new\s+Set/.test(hookSrc) &&
   /const\s+reset\s*=\s*useCallback[\s\S]{0,1600}?fallbackTtsKeysRef\.current\.clear/.test(hookSrc));

console.log('\n[D] cancelación externa NO dispara fallback (jump/resume/unmount)');
ok('Catch primario corta sin reintentar si abortCtrl ya fue abortado',
   /catch\s*\(\s*ePrimary[\s\S]{0,260}?if\s*\(\s*abortCtrl\.signal\.aborted\s*\)\s*\{[\s\S]{0,600}?return null;/.test(hookSrc));

console.log('\n[E] sólo tras agotar fallback se entrega null (→ UNRECOVERABLE)');
ok('El fallback ocurre ANTES del null final en getAudioUrl',
   /firstSpeakableUnit\(\s*txt,\s*TTS_FALLBACK_MAX_CHARS\s*\)[\s\S]{0,2600}?getAudioUrl_result[\s\S]{0,260}?if\s*\(\s*!url\s*\)\s*return null;/.test(hookSrc));
ok('url de fallback se cachea bajo `key` (evita repetir timeout primario)',
   /if\s*\(\s*!url\s*\)\s*return null;[\s\S]{0,400}?audioCache\.current\.set\(\s*key,\s*url\s*\)/.test(hookSrc));
ok('load() conserva el path !url → audioFailedKeys + PB_AUDIO_UNRECOVERABLE',
   /if\s*\(\s*!url\s*\)\s*\{[\s\S]{0,500}?audioFailedKeysRef\.current\.add\s*\(\s*toChunkKey\s*\(\s*index\s*\)\s*\)[\s\S]{0,300}?PB_AUDIO_UNRECOVERABLE[\s\S]{0,120}?no_url_after_getAudioUrl/.test(hookSrc));

console.log('\n[F] HF2 (resume anchored) intacto');
ok('forceSentenceTts sigue derivándose de anchorFirstAudio',
   /options\.anchorFirstAudio\s*===\s*true\s*&&\s*chunkKey\s*!==\s*index/.test(hookSrc));
ok('cache key negativa de sentence-TTS sigue presente',
   /toSentenceTtsCacheKey\(index\)/.test(hookSrc) &&
   /SENTENCE_TTS_CACHE_KEY_OFFSET/.test(hookSrc));
ok('log immersive-tts-resume de HF2 intacto',
   hookSrc.includes('[immersive-tts-resume] visualIndex=${index}'));

console.log('\n[G] logs de diagnóstico HF3 presentes');
ok('[AUDIO_TRACE] tts_timeout_retry', /\[AUDIO_TRACE\]\s*tts_timeout_retry/.test(hookSrc));
ok('[AUDIO_TRACE] fallback_sentence_tts', /\[AUDIO_TRACE\]\s*fallback_sentence_tts/.test(hookSrc));
ok('[AUDIO_TRACE] fallback_text_length', /\[AUDIO_TRACE\]\s*fallback_text_length/.test(hookSrc));
ok('[AUDIO_TRACE] getAudioUrl_result urlPresent', /getAudioUrl_result[\s\S]{0,160}?urlPresent:\s*!!url/.test(hookSrc));
ok('[PB_AUDIO_RECOVERED] cuando el fallback funciona', /\[PB_AUDIO_RECOVERED\]/.test(hookSrc));

console.log('\n[H] inmersivo V2 aislado');
ok('V2 no referencia firstSpeakableUnit ni fallbackTtsKeys',
   !/firstSpeakableUnit|fallbackTtsKeysRef|tts_timeout_retry|fallback_sentence_tts/.test(v2Src));

console.log(`\nimmersiveTtsResumeFallback - pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
