/**
 * mookLearnerUx03b.test.mjs — G4-PILOT-UX-03B-FIX.
 *
 * Defectos de interfaz del piloto «La tortuga que no se rindió»:
 *  [1] textos infantiles: explican la causa del rechazo, nunca la ocultan;
 *  [2] audio: un manifiesto con solo `_meta` no tiene audio reproducible;
 *  [3] contrato de la interfaz (fuente): sin formulario vacío con entrega hecha,
 *      reenvío que parte del texto exacto, nombres de producción, 44 px, sin
 *      almacenamiento local ni guardado automático, y backend sin cambios.
 *
 *   node server/__test__/mookLearnerUx03b.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordCount, lengthMessage, counterText, learnerErrorMessage } from '../../utils/mookLearnerText.mjs';
import { manifestAudioState, playableChunkCount, playableChunkIndexes } from '../../utils/ttsManifest.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

console.log('\n[1] textos para lectores');
t('cuenta palabras igual que el servidor', () => {
    const server = read('server/lib/experienceStore.js');
    assert.match(server, /const countWords = \(t\) => String\(t \|\| ''\)\.trim\(\)\.split\(\/\\s\+\/\)\.filter\(Boolean\)\.length;/);
    assert.equal(wordCount('  una   dos\ntres  '), 3);
    assert.equal(wordCount(''), 0);
    assert.equal(wordCount(undefined), 0);
});
t('corto: dice cuántas tiene, cuántas necesita y cuántas faltan', () => {
    const m = lengthMessage(10, 40, 150);
    assert.match(m, /tiene 10 palabras/);
    assert.match(m, /al menos 40/);
    assert.match(m, /faltan 30 palabras/);
});
t('singular correcto (1 palabra, falta 1)', () => {
    assert.match(lengthMessage(1, 2, 10), /tiene 1 palabra y .* te falta 1 palabra\./);
});
t('largo: dice el máximo y cuántas sobran', () => {
    const m = lengthMessage(160, 40, 150);
    assert.match(m, /como máximo 150/);
    assert.match(m, /sobran 10 palabras/);
});
t('en rango: sin mensaje', () => {
    assert.equal(lengthMessage(40, 40, 150), null);
    assert.equal(lengthMessage(150, 40, 150), null);
});
t('contador legible', () => {
    assert.equal(counterText(10, 40, 150), '10 palabras · necesitas entre 40 y 150');
    assert.equal(counterText(45, 40, 150), '45 palabras · ¡extensión correcta!');
    assert.equal(counterText(151, 40, 150), '151 palabras · máximo 150');
});
t('códigos del servidor → explicación con la causa', () => {
    assert.match(learnerErrorMessage({ code: 'PRODUCTION_LENGTH', error: 'la producción exige 40–150 palabras (lleva 10)' }, { words: 10, min: 40, max: 150 }), /faltan 30/);
    assert.match(learnerErrorMessage({ code: 'ACTIVITY_INCOMPLETE' }), /Falta responder alguna pregunta/);
    assert.match(learnerErrorMessage({ code: 'NODE_LOCKED' }), /primero termina los pasos anteriores/);
    assert.match(learnerErrorMessage({ code: 'INVALID_TRANSITION' }), /ya no se puede reenviar/);
    assert.match(learnerErrorMessage({ error: 'Sin conexión' }), /Tu texto sigue aquí/);
});
t('código desconocido: la causa se muestra, no se oculta', () => {
    assert.equal(learnerErrorMessage({ code: 'ALGO_NUEVO', error: 'motivo del servidor' }), 'No se pudo enviar: motivo del servidor');
    assert.match(learnerErrorMessage({}), /Intenta otra vez o avisa a tu mediador/);
});

console.log('\n[2] audio');
t('sin manifiesto: «none» (vista previa bajo demanda, como antes)', () => {
    assert.equal(manifestAudioState(null), 'none');
});
t('solo `_meta` (el estado real de la obra del piloto): «unavailable»', () => {
    const m = { _meta: { version: 2, splitVersion: 1, totalChunks: 68, totalSentences: 1302 } };
    assert.equal(manifestAudioState(m), 'unavailable');
    assert.equal(playableChunkCount(m), 0);
});
t('fragmentos con `file`: «ready», y `_meta` no cuenta', () => {
    const m = { _meta: {}, 0: { file: 'audio/x/chunk_a.mp3' }, 1: { file: 'audio/x/chunk_b.mp3' } };
    assert.equal(manifestAudioState(m), 'ready');
    assert.equal(playableChunkCount(m), 2);
});
t('entradas sin `file` o con claves no numéricas no cuentan; orden numérico', () => {
    const m = { 10: { file: 'b' }, 2: { file: 'a' }, 3: {}, x: { file: 'c' }, 4: { file: '' } };
    assert.deepEqual(playableChunkIndexes(m), [2, 10]);
    assert.equal(manifestAudioState({ 0: {} }), 'unavailable');
});

console.log('\n[3] contrato de la interfaz');
const exp = read('pages/Experiencias.tsx');
const visor = read('pages/VisorTexto.tsx');
t('con una entrega hecha no hay formulario nuevo vacío', () => {
    assert.match(exp, /const production = myEvidence\.find\(\(e: any\) => e\.requiresReview\);/);
    assert.match(exp, /\{!revisiting && node\.type === 'PRODUCTION' && !production && \(/);
});
t('el reenvío empieza con el texto EXACTO de la entrega vigente', () => {
    assert.match(exp, /useState<string>\(e\.currentText \?\? ''\)/);
    assert.match(exp, /Ver lo que enviaste antes/);
    assert.ok(!exp.includes('Puedes partir de tu versión anterior copiándola aquí'), 'el campo ya no pide copiar a mano');
});
t('un solo formulario por entrega: tarjeta O panel', () => {
    assert.match(exp, /inCardNodeId=\{visibleIdx === frontierIdx \? visibleId : null\}/);
    assert.match(exp, /if \(e\.nodeId === inCardNodeId\)/);
    assert.match(exp, /e\.canResubmit && !preview && <ProductionResubmitForm/);
});
t('cada producción con su nombre: formulario, estado, panel y cierre', () => {
    assert.match(exp, /Tu texto para «\{node\.title\}»/);
    assert.match(exp, /Mejora tu texto de «\{title\}»/);
    assert.match(exp, /\{title && <p className="font-bold[^"]*">«\{title\}»<\/p>\}/);
    assert.match(exp, /«\{titleOf\(p\.nodeId\)\}»:/);
    assert.match(exp, /<div className="mt-4 rounded-xl bg-white text-gray-800 p-4">/, 'estado en el cierre con contraste suficiente');
    assert.match(exp, /aria-label="Tus producciones"/);
    assert.ok(!exp.includes('Incluye una producción'), 'la portada no da un número equivocado');
    assert.match(exp, /node\.type === 'PRODUCTION' \? 'Volver a leer'/);
});
t('validación antes de enviar, con el texto infantil; el servidor sigue decidiendo', () => {
    assert.match(exp, /const sendProduction = async \(\) => \{\s*const why = lengthMessage\(wordCount\(text\), pMin, pMax\);/);
    assert.match(exp, /setMsg\(learnerErrorMessage\(r, payload\.text !== undefined/);
});
t('móvil: 44 px en enviar, reenviar y navegación; navegación a la izquierda en teléfono', () => {
    assert.match(exp, /onClick=\{sendProduction\} disabled=\{busy\} className="min-h-\[44px\]/);
    assert.match(exp, /onClick=\{resubmit\} disabled=\{busy\} className="min-h-\[44px\]/);
    assert.equal((exp.match(/px-3 py-2 min-h-\[44px\] rounded-xl border/g) || []).length, 2);
    assert.match(exp, /justify-start sm:justify-end/);
    assert.match(exp, /p-4 pb-40 md:p-8/);
});
t('legibilidad: criterio y contador en text-sm, sin gray-400 ni gray-500 en el criterio', () => {
    assert.ok(!exp.includes('text-xs text-gray-500">Criterio'), 'criterio ya no va en 12 px gris');
    assert.match(exp, /<b>Cómo lo revisará tu mediador:<\/b>/);
    assert.match(exp, /<span id=\{id\} className=\{`text-sm /);
    assert.ok(!/not-italic text-gray-400"/.test(exp) && !/text-xs text-gray-400">Historial/.test(exp));
});
t('sin guardado automático ni almacenamiento local', () => {
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(exp));
    assert.ok(!/setInterval|autosave|autoguard/i.test(exp));
});
t('audio: no simula reproducción, lo dice y sigue siendo enfocable', () => {
    assert.match(visor, /const audioUnavailable = audioState === 'unavailable' && language === 'es';/);
    assert.match(visor, /if \(audioUnavailable\) \{\s*setAudioError\('Audio no disponible para este libro\./);
    assert.match(visor, /aria-disabled=\{audioUnavailable \|\| undefined\}/);
    assert.match(visor, /aria-label=\{audioUnavailable \? 'Audio no disponible'/);
    assert.match(visor, /if \(audioState === 'ready' && language === 'es'\) \{/);
    assert.ok(!/Object\.keys\(manifest\)\.length/.test(visor), '`_meta` ya no cuenta como fragmento');
});
t('el backend y las reglas no cambian', () => {
    const ds = read('services/dataService.ts');
    assert.match(ds, /return res\.ok \? \{ ok: true \} : \{ ok: false, error: body\.error, code: body\.code \};/);
    const store = read('server/lib/experienceStore.js');
    assert.match(store, /throw err\('PRODUCTION_LENGTH'/);
    assert.match(read('server/gamification/policy.mjs'), /XP_RECOGNITION_ONLY_SOURCES = Object\.freeze\(\['mook_review'\]\)/); // V8-ACTIVATE-PREP-01: sin XP por facts
});

console.log(`\nmookLearnerUx03b: ${passed} tests OK`);
