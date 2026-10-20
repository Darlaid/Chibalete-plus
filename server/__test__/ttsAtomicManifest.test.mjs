/**
 * ttsAtomicManifest.test.mjs — CHP-MAINT-IMMERSIVE-TTS-2026-10 IMM-TTS-01.
 *
 * MANIFEST_PUBLISH_CONTRACT: el manifest activo de un contenido solo cambia
 * cuando TODOS los chunks esperados para esa versión quedaron resueltos. Un job
 * interrumpido (429, 5xx, excepción) no publica un manifest incompleto: el
 * lector sigue con el manifest válido anterior o, si no había, con el fallback
 * TXT completo + TTS bajo demanda. Defecto que lo motiva (auditoría 2026-10-20):
 * Alicia 10/103 y Una odisea marciana 8/50 publicados tras cortar la cuota.
 *
 * Ratchet: PARTIAL_MANIFEST_PUBLICATION: IMPOSSIBLE_BY_CONTRACT.
 *
 * Aislamiento: directorios temporales; proveedor = doble inyectado con
 * `_setProviderClientsForTest`; sin claves; sin red. NUNCA toca data/,
 * data-critical/ ni uploads productivos.
 *
 *   node server/__test__/ttsAtomicManifest.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_MODE;
delete process.env.TTS_MODE;

const ai = await import('../aiEngine.js');
const tts = await import('../ttsService.js');
const { generateAudioForContent } = tts;
const { generateHash, _setProviderClientsForTest, _resetBreakers } = ai;

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── Doble de proveedor: openai primario; gemini ausente (fallback falla) ──
const calls = [];
let failWhen = null; // (input, n) => Error | null
_setProviderClientsForTest({
    openai: {
        audio: {
            speech: {
                create: async ({ model, voice, input }) => {
                    const err = failWhen && failWhen(input, calls.length);
                    if (err) throw err;
                    calls.push({ model, voice, input });
                    const bytes = Buffer.from(`AUDIO|${model}|${input}`);
                    return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
                },
            },
        },
    },
    gemini: null,
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_ttsatomic_'));
let seq = 0;
const fixture = () => {
    const uploadDir = path.join(root, `u${++seq}`);
    fs.mkdirSync(uploadDir, { recursive: true });
    const contentId = `content-atomic-${seq}`;
    const textPath = path.join(uploadDir, 'texto.txt');
    const audioDir = path.join(uploadDir, 'audio', contentId);
    const manifestPath = path.join(audioDir, 'manifest.json');
    const readManifest = () => fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null;
    const run = async (text) => {
        fs.writeFileSync(textPath, text);
        calls.length = 0;
        _resetBreakers();
        const progress = [];
        let result, threw = null;
        try { result = await generateAudioForContent(contentId, textPath, uploadDir, (p) => progress.push(p)); }
        catch (e) { threw = e; }
        return { result, threw, progress, calls: calls.slice(), raw: readManifest() };
    };
    const mp3s = () => fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3')).sort() : [];
    return { uploadDir, contentId, textPath, audioDir, manifestPath, run, mp3s, readManifest };
};

// Una oración de ~900 caracteres = un chunk exacto (chunkText agrupa 800–1500).
const longSentence = (tag) => {
    let s = `Frase ${tag}`;
    while (s.length < 900) s += ` palabra${tag}`;
    return s + '.';
};
const textOf = (tags) => tags.map(longSentence).join(' ');
const entries = (m) => Object.keys(m).filter(k => k !== '_meta').sort((a, b) => a - b);
const N = 6, K = 3;
const BOOK = textOf(['a', 'b', 'c', 'd', 'e', 'f']);
const failAfterK = (err) => (input, n) => (n >= K ? err : null);
const e429 = () => new Error('429 You have no credits remaining (test)');
const e5xx = () => new Error('502 Bad Gateway (test)');

console.log('\n[1] ejecución completa publica manifest con N entradas');
{
    const f = fixture();
    const r = await f.run(BOOK);
    const m = JSON.parse(r.raw);
    ok('success sin abort', r.result.success === true && !r.result.abortedByProvider);
    ok(`manifest con ${N} entradas = _meta.totalChunks`, entries(m).length === N && m._meta.totalChunks === N);
}

for (const [label, mk, aborted] of [['429', e429, true], ['5xx', e5xx, false]]) {
    console.log(`\n[2/3] ${label} tras el chunk ${K}: sin manifest previo → no se publica nada`);
    const f = fixture();
    failWhen = failAfterK(mk());
    const r = await f.run(BOOK);
    failWhen = null;
    ok(`${label}: success=false`, r.result && r.result.success === false, JSON.stringify(r.result));
    if (aborted) ok('429: abortedByProvider (contrato existente)', r.result.abortedByProvider === true);
    else ok('5xx: incomplete (ya no se marca listo)', r.result.incomplete === true && !r.result.abortedByProvider);
    ok(`${label}: NO existe manifest parcial`, r.raw === null);
    ok(`${label}: los ${K} mp3 generados se conservan`, f.mp3s().length === K, f.mp3s().join(','));
    ok(`${label}: estado terminal error_proveedor emitido`, r.progress.at(-1)?.status === 'error_proveedor');

    console.log(`\n[7/8] ${label}: reintento reutiliza el audio válido y publica completo`);
    const c = await f.run(BOOK);
    const m = JSON.parse(c.raw);
    ok(`${label}: reintento solo genera ${N - K} chunks`, c.calls.length === N - K, String(c.calls.length));
    ok(`${label}: reintento publica ${N} entradas`, c.result.success === true && entries(m).length === N);
}

console.log('\n[4] excepción (texto ilegible) → no publica');
{
    const f = fixture();
    const r = await f.run(BOOK);
    const before = r.raw;
    fs.unlinkSync(f.textPath);
    let res, threw = null;
    try { res = await generateAudioForContent(f.contentId, f.textPath, f.uploadDir, null); } catch (e) { threw = e; }
    ok('excepción: success=false o rechazo', threw !== null || res?.success === false);
    ok('excepción: manifest previo byte a byte intacto', f.readManifest() === before);
}

console.log('\n[4b] excepción del proveedor (no HTTP) a mitad → no publica');
{
    const f = fixture();
    failWhen = failAfterK(new TypeError('socket hang up (test)'));
    const r = await f.run(BOOK);
    failWhen = null;
    ok('excepción proveedor: success=false', r.result?.success === false);
    ok('excepción proveedor: sin manifest', r.raw === null);
}

console.log('\n[5] manifest válido previo sobrevive a una regeneración fallida');
{
    const f = fixture();
    const a = await f.run(BOOK);
    const v1 = a.raw;
    const files1 = f.mp3s();
    const BOOK2 = textOf(['a', 'b', 'X', 'Y', 'Z', 'W']);
    failWhen = (input) => (/palabra[XYZW]\b/.test(input) ? e429() : null);
    const r = await f.run(BOOK2);
    failWhen = null;
    ok('V2 abortada', r.result.success === false);
    ok('manifest activo = V1 byte a byte', f.readManifest() === v1);
    ok('audio de V1 intacto (sin GC en fallo)', files1.every(n => fs.existsSync(path.join(f.audioDir, n))));
    const c = await f.run(BOOK2);
    const m2 = JSON.parse(c.raw);
    ok('V2 completa publica atómicamente V1 → V2', c.result.success === true && entries(m2).length === N && m2[2].text === longSentence('X'));
}

console.log('\n[6] sin manifest previo + fallo → el lector usa TXT completo (no hay manifest)');
{
    const f = fixture();
    failWhen = failAfterK(e429());
    const r = await f.run(BOOK);
    failWhen = null;
    ok('sin manifest.json → StartupEngine cae a TXT crudo', r.raw === null && !fs.existsSync(f.manifestPath));
}

console.log('\n[9/10/11] validateManifestCandidate rechaza candidatos inválidos');
{
    const { validateManifestCandidate } = tts;
    ok('validateManifestCandidate exportada', typeof validateManifestCandidate === 'function');
    const f = fixture();
    const r = await f.run(BOOK);
    const good = JSON.parse(r.raw);
    const chunks = entries(good).map(k => good[k].text);
    const v = (m) => validateManifestCandidate(m, chunks, f.audioDir, f.contentId);
    const clone = () => JSON.parse(JSON.stringify(good));
    ok('candidato completo → ok', v(clone()).ok === true, JSON.stringify(v(clone())));
    const missing = clone(); delete missing[4];
    ok('[9] entries != expected → rechazado', v(missing).ok === false);
    const gap = clone(); gap[6] = { ...gap[5], index: 6 }; delete gap[5];
    ok('[10] índices no contiguos → rechazado', v(gap).ok === false);
    const extra = clone(); extra[N] = { ...extra[N - 1], index: N };
    ok('[9] entrada sobrante → rechazado', v(extra).ok === false);
    const badHash = clone(); badHash[1].hash = 'deadbeef';
    ok('[11] hash ausente/incorrecto → rechazado', v(badHash).ok === false);
    const badText = clone(); badText[2].text = 'otro texto.';
    ok('[11] texto ≠ chunk esperado → rechazado', v(badText).ok === false);
    const badSent = clone(); badSent[3].sentenceStart += 1;
    ok('[11] sentenceStart incoherente → rechazado', v(badSent).ok === false);
    const badTotal = clone(); badTotal._meta.totalSentences += 1;
    ok('[11] _meta.totalSentences incoherente → rechazado', v(badTotal).ok === false);
    const noMeta = clone(); delete noMeta._meta;
    ok('[11] sin _meta → rechazado', v(noMeta).ok === false);
    const emptyFile = clone();
    fs.writeFileSync(path.join(f.uploadDir, emptyFile[0].file), '');
    ok('[11] mp3 vacío → rechazado', v(emptyFile).ok === false);
    fs.unlinkSync(path.join(f.uploadDir, emptyFile[0].file));
    ok('[11] mp3 inexistente → rechazado', v(emptyFile).ok === false);
}

console.log('\n[ratchet] PARTIAL_MANIFEST_PUBLICATION: IMPOSSIBLE_BY_CONTRACT');
{
    const src = fs.readFileSync(new URL('../ttsService.js', import.meta.url), 'utf8');
    const saves = src.match(/saveManifest\(\)/g) || [];
    ok('saveManifest() se invoca exactamente una vez', saves.length === 1, String(saves.length));
    ok('esa invocación está tras validateManifestCandidate', /validateManifestCandidate\([\s\S]{0,400}?if \(publish\.ok\)[\s\S]{0,120}?saveManifest\(\)/.test(src));
    ok('sin escrituras de manifest.json fuera de saveManifest', (src.match(/writeFileAtomic\(manifestPath/g) || []).length === 1);
    // IMM-TTS-02B: ya no hay GC; la detección de huérfanos (read-only) solo corre tras publicar.
    ok('la detección de huérfanos solo corre si se publicó y no borra', /if \(publish\.ok\) \{[\s\S]{0,400}orphanAudioFiles = /.test(src) && !/unlinkSync\(/.test(src));
}

console.log('\n[atomicidad] no quedan temporales');
{
    const leftovers = [];
    const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (n.includes('.tmp')) leftovers.push(p); } };
    walk(root);
    ok('0 archivos .tmp', leftovers.length === 0, leftovers.join(','));
}

_setProviderClientsForTest({});
fs.rmSync(root, { recursive: true, force: true });
console.log(`\nttsAtomicManifest — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
