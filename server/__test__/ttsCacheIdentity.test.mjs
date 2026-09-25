/**
 * ttsCacheIdentity.test.mjs — CHP-CONTENT-CANONICAL-2026-01 PARTE 1A.
 *
 * La caché de audio TTS debe decidirse por IDENTIDAD DE CONTENIDO, no por la
 * posición del chunk. Defecto que lo motiva (auditoría TXT/EPUB F0): el HIT se
 * decidía con `manifest[i].file` existente, y la rama de HIT reescribía
 * `manifest[i].text` con el texto NUEVO conservando el mp3 VIEJO. En producción
 * hay un contenido con 46/46 entradas en ese estado.
 *
 * Identidad = generateHash(texto del chunk, idioma, voz, provider, model), la
 * misma que ya da nombre al archivo: chunk_<hash>_<provider>_<model>.mp3.
 *
 * Aislamiento: todo en directorios temporales; el proveedor es un doble
 * inyectado con `_setProviderClientsForTest`; claves de proveedor vacías.
 * NUNCA toca data/, data-critical/, uploads productivos ni la red.
 *
 *   node server/__test__/ttsCacheIdentity.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Modo real con doble de proveedor: sin claves, sin mock global.
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_MODE;
delete process.env.TTS_MODE;

const ai = await import('../aiEngine.js');
const { generateAudioForContent } = await import('../ttsService.js');
const { AI_CONFIG, generateHash, _setProviderClientsForTest, _resetBreakers, GEMINI_TTS_MODEL } = ai;

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── Doble de OpenAI: registra cada síntesis; puede fallar con 429 a demanda ──
const calls = [];
let failWhen = null; // (input) => boolean
_setProviderClientsForTest({
    openai: {
        audio: {
            speech: {
                create: async ({ model, voice, input }) => {
                    if (failWhen && failWhen(input)) throw new Error('429 rate limit (test)');
                    calls.push({ model, voice, input });
                    const bytes = Buffer.from(`AUDIO|${model}|${input}`);
                    return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
                },
            },
        },
    },
    gemini: null,
});

const DEFAULT_TTS = JSON.parse(JSON.stringify({ primary: AI_CONFIG.tts.primary, fallback: AI_CONFIG.tts.fallback }));
const resetConfig = () => {
    AI_CONFIG.tts.primary = { ...DEFAULT_TTS.primary };
    AI_CONFIG.tts.fallback = { ...DEFAULT_TTS.fallback };
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_ttsid_'));
let seq = 0;
const fixture = () => {
    const uploadDir = path.join(root, `u${++seq}`);
    fs.mkdirSync(uploadDir, { recursive: true });
    const contentId = `content-test-${seq}`;
    const textPath = path.join(uploadDir, 'texto.txt');
    const audioDir = path.join(uploadDir, 'audio', contentId);
    const manifestPath = path.join(audioDir, 'manifest.json');
    const run = async (text) => {
        fs.writeFileSync(textPath, text);
        calls.length = 0;
        _resetBreakers();
        const result = await generateAudioForContent(contentId, textPath, uploadDir);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { result, manifest, calls: calls.slice(), bytes: fs.readFileSync(manifestPath, 'utf8') };
    };
    const mp3s = () => fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3')).sort() : [];
    return { uploadDir, contentId, audioDir, manifestPath, run, mp3s };
};

// Una oración de ~900 caracteres = un chunk exacto (chunkText agrupa 800–1500).
const longSentence = (tag) => {
    let s = `Frase ${tag}`;
    while (s.length < 900) s += ` palabra${tag}`;
    return s + '.';
};
const textOf = (tags) => tags.map(longSentence).join(' ');
const entries = (m) => Object.keys(m).filter(k => k !== '_meta').sort((a, b) => a - b);
const expectedHash = (text, provider, model) => generateHash(text, 'es', 'alloy', provider, model);

const coherent = (m) => {
    const keys = entries(m);
    let start = 0, fine = keys.length === m._meta.totalChunks;
    for (const k of keys) {
        const e = m[k];
        fine = fine && e.index === Number(k) && e.sentenceStart === start
            && e.hash === expectedHash(e.text, e.provider, e.model)
            && path.basename(e.file) === `chunk_${e.hash}_${e.provider}_${e.model}.mp3`;
        start += e.sentences.length;
    }
    return fine && start === m._meta.totalSentences && m._meta.version === 2 && m._meta.splitVersion === 1;
};
const FIELDS = ['text', 'file', 'index', 'hash', 'provider', 'model', 'sentences', 'sentenceStart'];

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[B/13] regresión: mismo índice, mp3 existente, texto NUEVO → regenera');
{
    const f = fixture();
    const a = await f.run('El gato duerme.');
    ok('versión A genera 1 chunk', a.calls.length === 1 && a.manifest[0].text === 'El gato duerme.');
    const oldFile = a.manifest[0].file;
    // Precondición del defecto: la lógica anterior daba HIT con esto (entrada en
    // el índice 0 + archivo existente no vacío + provider real).
    ok('precondición del bug: manifest[0].file existe en disco', fs.statSync(path.join(f.uploadDir, oldFile)).size > 0 && a.manifest[0].provider === 'openai');
    const b = await f.run('El perro corre.');
    ok('texto cambiado → 1 llamada TTS con el texto nuevo', b.calls.length === 1 && b.calls[0].input === 'El perro corre.', JSON.stringify(b.calls));
    ok('manifest[0] = texto nuevo con audio nuevo', b.manifest[0].text === 'El perro corre.' && b.manifest[0].file !== oldFile);
    ok('hash del manifest = identidad del texto nuevo', b.manifest[0].hash === expectedHash('El perro corre.', 'openai', 'tts-1'));
    ok('el mp3 referenciado contiene el audio del texto nuevo',
        fs.readFileSync(path.join(f.uploadDir, b.manifest[0].file), 'utf8') === 'AUDIO|tts-1|El perro corre.');
    ok('[J] manifest coherente', coherent(b.manifest));
}

console.log('\n[A/I] mismo texto + mismo provider/model → reutiliza, idempotente');
{
    const f = fixture();
    const text = textOf(['a', 'b', 'c']);
    const a = await f.run(text);
    ok('primera generación: 3 llamadas', a.calls.length === 3);
    const b = await f.run(text);
    ok('segunda generación: 0 llamadas TTS', b.calls.length === 0, JSON.stringify(b.calls.length));
    ok('manifest byte a byte idéntico', a.bytes === b.bytes);
    ok('mismos mp3 en disco', JSON.stringify(f.mp3s()) === JSON.stringify(entries(a.manifest).map(k => path.basename(a.manifest[k].file)).sort()));
    ok('resultado success', b.result.success === true && !b.result.abortedByProvider);
    ok('[J] manifest coherente', coherent(b.manifest));
    ok('[K] contrato: _meta + campos por entrada sin cambios',
        JSON.stringify(Object.keys(b.manifest._meta)) === JSON.stringify(['version', 'splitVersion', 'totalChunks', 'totalSentences'])
        && entries(b.manifest).every(k => JSON.stringify(Object.keys(b.manifest[k])) === JSON.stringify(FIELDS)));
}

console.log('\n[C] cambio ligero → regenera; solo espacios (mismo input al proveedor) → reutiliza');
{
    const f = fixture();
    await f.run('El gato duerme.');
    const b = await f.run('El gato duerme!');
    ok('puntuación distinta → 1 llamada', b.calls.length === 1 && b.calls[0].input === 'El gato duerme!');
    const c = await f.run('El gato duerme!');
    ok('repetido → 0 llamadas', c.calls.length === 0);
    const d = await f.run('El   gato\nduerme!');
    ok('solo espacios/saltos (el proveedor recibe lo mismo) → 0 llamadas', d.calls.length === 0 && d.manifest[0].text === 'El gato duerme!');
}

console.log('\n[D] provider cambiado → no reutiliza audio incompatible');
{
    const f = fixture();
    const text = 'La luna brilla.';
    // Audio previo generado por el fallback configurado (gemini): válido mientras gemini esté configurado.
    fs.mkdirSync(f.audioDir, { recursive: true });
    const gh = expectedHash(text, 'gemini', GEMINI_TTS_MODEL);
    const gFile = `chunk_${gh}_gemini_${GEMINI_TTS_MODEL}.mp3`;
    fs.writeFileSync(path.join(f.audioDir, gFile), 'AUDIO|gemini');
    fs.writeFileSync(f.manifestPath, JSON.stringify({ 0: { text, file: `audio/${f.contentId}/${gFile}`, index: 0, hash: gh, provider: 'gemini', model: GEMINI_TTS_MODEL, sentences: [text], sentenceStart: 0 } }));
    const a = await f.run(text);
    ok('gemini configurado como fallback → HIT (0 llamadas)', a.calls.length === 0 && a.manifest[0].provider === 'gemini');
    AI_CONFIG.tts.fallback = { provider: 'openai', model: 'tts-1-hd' };
    const b = await f.run(text);
    ok('gemini ya no configurado → regenera con openai', b.calls.length === 1 && b.manifest[0].provider === 'openai' && b.manifest[0].model === 'tts-1');
    resetConfig();

    // Barrera previa preservada: en modo real nunca se reutiliza audio mock.
    const g = fixture();
    fs.mkdirSync(g.audioDir, { recursive: true });
    const mh = expectedHash(text, 'mock', 'mock-engine');
    const mFile = `chunk_${mh}_mock_mock-engine.mp3`;
    fs.writeFileSync(path.join(g.audioDir, mFile), 'MOCK');
    fs.writeFileSync(g.manifestPath, JSON.stringify({ 0: { text, file: `audio/${g.contentId}/${mFile}`, index: 0, hash: mh, provider: 'mock', model: 'mock-engine', sentences: [text], sentenceStart: 0 } }));
    const m = await g.run(text);
    ok('audio mock en modo real → regenera', m.calls.length === 1 && m.manifest[0].provider === 'openai');
}

console.log('\n[E] model cambiado → regenera');
{
    const f = fixture();
    const text = 'El río suena.';
    await f.run(text);
    AI_CONFIG.tts.primary = { provider: 'openai', model: 'tts-1-hd' };
    const b = await f.run(text);
    ok('tts-1 → tts-1-hd: 1 llamada con el modelo nuevo', b.calls.length === 1 && b.calls[0].model === 'tts-1-hd');
    ok('manifest con el modelo nuevo', b.manifest[0].model === 'tts-1-hd' && b.manifest[0].hash === expectedHash(text, 'openai', 'tts-1-hd'));
    resetConfig();
}

console.log('\n[F] 5 chunks → 3 chunks → el manifest solo expone 3');
{
    const f = fixture();
    const a = await f.run(textOf(['a', 'b', 'c', 'd', 'e']));
    ok('versión A: 5 chunks', entries(a.manifest).length === 5);
    const dropped = [3, 4].map(k => path.basename(a.manifest[k].file));
    const b = await f.run(textOf(['a', 'b', 'c']));
    ok('versión B: 0 llamadas (los 3 chunks no cambian)', b.calls.length === 0);
    ok('manifest final = 3 entradas, totalChunks 3', JSON.stringify(entries(b.manifest)) === '["0","1","2"]' && b.manifest._meta.totalChunks === 3);
    ok('ninguna entrada referencia los chunks 3 y 4', !JSON.stringify(b.manifest).includes(dropped[0]) && !JSON.stringify(b.manifest).includes(dropped[1]));
    ok('los mp3 de 3 y 4 NO se borran en esta pasada (huérfanos físicos)', dropped.every(n => fs.existsSync(path.join(f.audioDir, n))));
    ok('[J] manifest coherente', coherent(b.manifest));
}

console.log('\n[G] manifest previo con hash incorrecto → no reutiliza');
{
    const f = fixture();
    const text = 'El viento sopla.';
    fs.mkdirSync(f.audioDir, { recursive: true });
    const bad = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const badFile = `chunk_${bad}_openai_tts-1.mp3`;
    fs.writeFileSync(path.join(f.audioDir, badFile), 'AUDIO|viejo');
    fs.writeFileSync(f.manifestPath, JSON.stringify({ _meta: { version: 2, splitVersion: 1, totalChunks: 1, totalSentences: 1 }, 0: { text, file: `audio/${f.contentId}/${badFile}`, index: 0, hash: bad, provider: 'openai', model: 'tts-1', sentences: [text], sentenceStart: 0 } }));
    const b = await f.run(text);
    ok('hash que no corresponde al texto → 1 llamada', b.calls.length === 1);
    ok('manifest apunta al audio nuevo', b.manifest[0].hash === expectedHash(text, 'openai', 'tts-1') && !b.manifest[0].file.includes(bad));
}

console.log('\n[H] mp3 faltante con hash correcto → regenera');
{
    const f = fixture();
    const a = await f.run('La lluvia cae.');
    fs.unlinkSync(path.join(f.uploadDir, a.manifest[0].file));
    const b = await f.run('La lluvia cae.');
    ok('1 llamada y archivo repuesto', b.calls.length === 1 && fs.existsSync(path.join(f.uploadDir, b.manifest[0].file)));
}

console.log('\n[extra] desplazamiento de índices: identidad, no posición');
{
    const f = fixture();
    await f.run(textOf(['a', 'b', 'c']));
    const b = await f.run(textOf(['z', 'a', 'b', 'c']));
    ok('chunk nuevo al inicio → solo 1 llamada; a,b,c reutilizados en 1,2,3', b.calls.length === 1 && b.calls[0].input === longSentence('z'));
    ok('[J] manifest coherente tras el desplazamiento', coherent(b.manifest));
}

console.log('\n[extra] circuit breaker: no expone entradas viejas ni borra audio válido');
{
    const f = fixture();
    const a = await f.run(textOf(['a', 'b', 'c', 'd']));
    const oldB = path.basename(a.manifest[1].file);
    failWhen = (input) => input === longSentence('B2');
    const b = await f.run(textOf(['a', 'B2', 'c', 'd']));
    failWhen = null;
    ok('resultado abortedByProvider', b.result.abortedByProvider === true);
    ok('chunk 1 (texto nuevo sin audio) ausente; 0, 2, 3 reutilizados', JSON.stringify(entries(b.manifest)) === '["0","2","3"]' && b.calls.length === 0);
    ok('ninguna entrada expone el audio viejo del chunk 1', !JSON.stringify(b.manifest).includes(oldB));
    ok('audio de 2 y 3 sigue en disco', [2, 3].every(k => fs.existsSync(path.join(f.uploadDir, b.manifest[k].file))));
    const c = await f.run(textOf(['a', 'B2', 'c', 'd']));
    ok('reintento: solo se genera el chunk pendiente', c.calls.length === 1 && entries(c.manifest).length === 4 && coherent(c.manifest));
}

console.log('\n[atomicidad] no quedan temporales del manifest ni de los mp3');
{
    const leftovers = [];
    const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (n.includes('.tmp')) leftovers.push(p); } };
    walk(root);
    ok('0 archivos .tmp', leftovers.length === 0, leftovers.join(','));
}

_setProviderClientsForTest({});
fs.rmSync(root, { recursive: true, force: true });
console.log(`\nttsCacheIdentity — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
