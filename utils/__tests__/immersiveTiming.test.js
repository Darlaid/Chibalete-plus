/**
 * immersiveTiming.test.js — Pruebas unitarias de INVARIANTES 7, 8, 9.
 *
 * Si estas pruebas fallan, hay regresión en uno de:
 *   - INV 7: piso mínimo de duración humana (estimateMinSentenceMs)
 *   - INV 8: separación display/spoken text (normalizeSentenceForSpeech)
 *   - INV 9: validación de audio cache (validateAudioDuration)
 *
 * Cómo correr:
 *   node utils/__tests__/immersiveTiming.test.js
 */

import {
    estimateMinSentenceMs,
    normalizeSentenceForSpeech,
    validateAudioDuration,
    countWords,
    ABSOLUTE_FLOOR_MS,
} from '../immersiveTiming.js';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

console.log('\nimmersiveTiming — INVARIANTES 7, 8, 9');

// ───────────────────────────────────────────────────────────────────────────
// INV 7 — estimateMinSentenceMs
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-7] estimateMinSentenceMs — piso humano mínimo');

ok('"Dinah" (1 palabra) >= 900ms a 1x',
   estimateMinSentenceMs('Dinah', 1) >= 900,
   `got ${estimateMinSentenceMs('Dinah', 1)}`);

ok('"Dinah era su gata" (4 palabras) >= 1400ms a 1x',
   estimateMinSentenceMs('Dinah era su gata', 1) >= 1400,
   `got ${estimateMinSentenceMs('Dinah era su gata', 1)}`);

ok('"Abajo, abajo, abajo." (3 palabras + punto) >= 1650ms a 1x',
   estimateMinSentenceMs('Abajo, abajo, abajo.', 1) >= 1650,
   `got ${estimateMinSentenceMs('Abajo, abajo, abajo.', 1)}`);

ok('"¡Querida Dinah!" (2 palabras + !) >= 1650ms a 1x',
   estimateMinSentenceMs('¡Querida Dinah!', 1) >= 1650,
   `got ${estimateMinSentenceMs('¡Querida Dinah!', 1)}`);

ok('Frase larga de 12 palabras >= 3000ms a 1x',
   estimateMinSentenceMs('uno dos tres cuatro cinco seis siete ocho nueve diez once doce', 1) >= 3000,
   `got ${estimateMinSentenceMs('uno dos tres cuatro cinco seis siete ocho nueve diez once doce', 1)}`);

ok('Cualquier frase a 2x nunca baja de 450ms (piso absoluto)',
   estimateMinSentenceMs('Dinah', 2) >= ABSOLUTE_FLOOR_MS,
   `got ${estimateMinSentenceMs('Dinah', 2)}`);

ok('"Dinah era su gata" a 2x se reduce vs 1x pero respeta absoluto',
   estimateMinSentenceMs('Dinah era su gata', 2) < estimateMinSentenceMs('Dinah era su gata', 1) &&
   estimateMinSentenceMs('Dinah era su gata', 2) >= ABSOLUTE_FLOOR_MS,
   `1x=${estimateMinSentenceMs('Dinah era su gata', 1)} 2x=${estimateMinSentenceMs('Dinah era su gata', 2)}`);

ok('Frase vacía retorna piso por defecto (600ms)',
   estimateMinSentenceMs('', 1) === 600);

ok('Frase con sólo espacios retorna 600ms',
   estimateMinSentenceMs('    ', 1) === 600);

// REGRESION GUARD — el incidente reportado:
ok('REGRESION GUARD: "(Dinah era su gata)." NO PUEDE avanzar en <1400ms a 1x',
   estimateMinSentenceMs('(Dinah era su gata).', 1) >= 1400);

ok('REGRESION GUARD: ninguna frase de 4 palabras puede avanzar en <1200ms a 1x',
   estimateMinSentenceMs('uno dos tres cuatro', 1) >= 1200);

// ───────────────────────────────────────────────────────────────────────────
// INV 8 — normalizeSentenceForSpeech
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-8] normalizeSentenceForSpeech — separar display/spoken');

ok('"” (Dinah era su gata)." → spokenText contiene "Dinah era su gata"',
   normalizeSentenceForSpeech('” (Dinah era su gata).').includes('Dinah era su gata'),
   `got "${normalizeSentenceForSpeech('” (Dinah era su gata).')}"`);

ok('"“¡Querida Dinah!”" → spokenText contiene "Querida Dinah"',
   normalizeSentenceForSpeech('“¡Querida Dinah!”').includes('Querida Dinah'),
   `got "${normalizeSentenceForSpeech('“¡Querida Dinah!”')}"`);

ok('Normalización conserva contenido completo (no reduce a una palabra)',
   countWords(normalizeSentenceForSpeech('” (Dinah era su gata).')) >= 4,
   `wordCount=${countWords(normalizeSentenceForSpeech('” (Dinah era su gata).'))}`);

ok('Frase sin signos decorativos pasa intacta',
   normalizeSentenceForSpeech('Abajo, abajo, abajo.') === 'Abajo, abajo, abajo.');

ok('Conserva puntuación fuerte final (.) pegada al texto',
   normalizeSentenceForSpeech('Hola mundo.').endsWith('.'));

ok('Conserva puntuación fuerte final (?) tras paréntesis cerrado',
   normalizeSentenceForSpeech('(¿Qué es esto?)').endsWith('?'),
   `got "${normalizeSentenceForSpeech('(¿Qué es esto?)')}"`);

// REGRESION GUARD — incidente reportado:
ok('REGRESION GUARD: normalización NO reduce "(Dinah era su gata)" a "Dinah"',
   normalizeSentenceForSpeech('(Dinah era su gata).').split(/\s+/).filter(Boolean).length >= 4,
   `got "${normalizeSentenceForSpeech('(Dinah era su gata).')}"`);

// ───────────────────────────────────────────────────────────────────────────
// INV 9 — validateAudioDuration
// ───────────────────────────────────────────────────────────────────────────

console.log('\n[INV-9] validateAudioDuration — cache de audio sospechoso');

ok('duration=0.18s para frase de 4 palabras → invalid (incidente Dinah)',
   validateAudioDuration({
       displayText: '(Dinah era su gata).',
       duration: 0.18,
       cached: true,
   }).status === 'invalid');

ok('duration=3.0s para frase de 4 palabras → valid',
   validateAudioDuration({
       displayText: 'Dinah era su gata.',
       duration: 3.0,
   }).status === 'valid');

ok('duration=null → pending (esperar metadata)',
   validateAudioDuration({
       displayText: 'Dinah era su gata.',
       duration: null,
   }).status === 'pending');

ok('duration=NaN → pending',
   validateAudioDuration({
       displayText: 'Dinah era su gata.',
       duration: NaN,
   }).status === 'pending');

ok('duration=Infinity → pending',
   validateAudioDuration({
       displayText: 'Dinah era su gata.',
       duration: Infinity,
   }).status === 'pending');

ok('duration=0 → invalid',
   validateAudioDuration({
       displayText: 'Dinah era su gata.',
       duration: 0,
   }).status === 'invalid');

ok('Frase de 1 palabra ("Oh.") con duration corta NO se marca invalid (legítima)',
   validateAudioDuration({
       displayText: 'Oh.',
       duration: 0.4,
   }).status !== 'invalid');

ok('blobSize < 1024 + frase de 4 palabras → suspicious',
   validateAudioDuration({
       displayText: 'Dinah era su gata.',
       duration: 1.5,
       blobSize: 512,
   }).status === 'suspicious',
   `got status=${validateAudioDuration({ displayText: 'Dinah era su gata.', duration: 1.5, blobSize: 512 }).status}`);

ok('REGRESION GUARD: blob 27840 bytes + duration 3s + frase de 4 palabras → valid',
   validateAudioDuration({
       displayText: 'Dinah era su gata.',
       duration: 3.0,
       blobSize: 27840,
   }).status === 'valid');

// ───────────────────────────────────────────────────────────────────────────
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
