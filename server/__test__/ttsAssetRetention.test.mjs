/**
 * ttsAssetRetention.test.mjs — CHP-MAINT-IMMERSIVE-TTS-2026-10 IMM-TTS-02B.
 *
 * TTS_ASSET_RETENTION_CONTRACT: ningún job TTS borra, mueve ni trunca audio
 * existente. Una regeneración completa publica su manifest (contrato atómico de
 * IMM-TTS-01) y escribe audio NUEVO; el audio anterior o huérfano se CONSERVA y
 * solo se cuenta (detección read-only). La limpieza futura exige una unidad
 * explícita con autorización humana.
 *
 * Defecto que lo motiva: la GC de generateAudioForContent borraba todo mp3 no
 * referenciado por el manifest nuevo ni por el anterior. Sobre producción, un
 * retry de La metamorfosis borraría sus 8 huérfanos, y una segunda regeneración
 * de Cavafis borraría su audio original.
 *
 * Ratchet: TTS_AUTOMATIC_ASSET_DELETION: ZERO.
 *
 * Aislamiento: directorios temporales; proveedor = doble inyectado; sin claves;
 * sin red. NUNCA toca data/, data-critical/ ni uploads productivos.
 *
 *   node server/__test__/ttsAssetRetention.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_MODE;
delete process.env.TTS_MODE;

const ai = await import('../aiEngine.js');
const { generateAudioForContent } = await import('../ttsService.js');
const { generateHash, _setProviderClientsForTest, _resetBreakers } = ai;

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── Espía de operaciones destructivas sobre el sistema de archivos ──
const destructive = [];
const spy = (obj, name, label) => {
    const orig = obj[name];
    obj[name] = function (...args) { destructive.push(`${label}:${String(args[0])}`); return orig.apply(this, args); };
};
for (const n of ['unlinkSync', 'rmSync', 'rmdirSync', 'truncateSync', 'ftruncateSync']) spy(fs, n, n);
for (const n of ['unlink', 'rm', 'rmdir', 'truncate']) spy(fs, n, n);
for (const n of ['unlink', 'rm', 'rmdir', 'truncate']) spy(fs.promises, n, `promises.${n}`);
// renameSync solo es legítimo como publicación atómica desde un temporal `.tmp-`.
const origRename = fs.renameSync;
fs.renameSync = function (from, to) {
    if (!String(from).includes('.tmp-')) destructive.push(`renameSync:${from}->${to}`);
    return origRename.apply(this, arguments);
};

const calls = [];
let failWhen = null;
_setProviderClientsForTest({
    openai: {
        audio: {
            speech: {
                create: async ({ model, input }) => {
                    const err = failWhen && failWhen(input, calls.length);
                    if (err) throw err;
                    calls.push(input);
                    const bytes = Buffer.from(`AUDIO|${model}|${input}`);
                    return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
                },
            },
        },
    },
    gemini: null,
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_ttsretain_'));
let seq = 0;
const longSentence = (tag) => {
    let s = `Frase ${tag}`;
    while (s.length < 900) s += ` palabra${tag}`;
    return s + '.';
};
const textOf = (tags) => tags.map(longSentence).join(' ');
const entries = (m) => Object.keys(m).filter(k => k !== '_meta').sort((a, b) => a - b);
const fileOf = (text, provider = 'openai', model = 'tts-1') => `chunk_${generateHash(text, 'es', 'alloy', provider, model)}_${provider}_${model}.mp3`;

const fixture = () => {
    const uploadDir = path.join(root, `u${++seq}`);
    fs.mkdirSync(uploadDir, { recursive: true });
    const contentId = `content-retain-${seq}`;
    const textPath = path.join(uploadDir, 'texto.txt');
    const audioDir = path.join(uploadDir, 'audio', contentId);
    fs.mkdirSync(audioDir, { recursive: true });
    const manifestPath = path.join(audioDir, 'manifest.json');
    const run = async (text) => {
        fs.writeFileSync(textPath, text);
        calls.length = 0;
        _resetBreakers();
        const result = await generateAudioForContent(contentId, textPath, uploadDir);
        const raw = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null;
        return { result, calls: calls.slice(), raw, manifest: raw ? JSON.parse(raw) : null };
    };
    // Huella exacta (nombre, tamaño, contenido) de los archivos presentes.
    const snapshot = () => Object.fromEntries(fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'))
        .map(f => [f, fs.readFileSync(path.join(audioDir, f), 'utf8')]));
    const seed = (name, data) => fs.writeFileSync(path.join(audioDir, name), data);
    return { uploadDir, contentId, audioDir, manifestPath, run, snapshot, seed };
};
const preserved = (before, f) => {
    const now = f.snapshot();
    return Object.entries(before).every(([n, data]) => now[n] === data);
};

console.log('\n[1/2/3/4] V1 → V2 → V3: cada versión se publica; ningún mp3 anterior se borra');
{
    const f = fixture();
    const v1 = await f.run(textOf(['a', 'b', 'c', 'd']));
    const s1 = f.snapshot();
    const v2 = await f.run(textOf(['a', 'b', 'X', 'Y']));
    ok('[1] V2 publicada completa', v2.result.success === true && entries(v2.manifest).length === 4 && v2.manifest[2].text === longSentence('X'));
    const v3 = await f.run(textOf(['a', 'b', 'P', 'Q']));
    ok('[1] V3 publicada completa', v3.result.success === true && entries(v3.manifest).length === 4 && v3.manifest[3].text === longSentence('Q'));
    ok('[2] mp3 obsoletos de V1 (c, d) siguen en disco', [longSentence('c'), longSentence('d')].every(t => fs.existsSync(path.join(f.audioDir, fileOf(t)))));
    ok('[3] varios obsoletos (V1 c,d + V2 X,Y) siguen en disco', ['c', 'd', 'X', 'Y'].every(t => fs.existsSync(path.join(f.audioDir, fileOf(longSentence(t))))));
    ok('[3] todo el audio de V1 intacto byte a byte', preserved(s1, f));
    ok('[4] audio vigente (a, b, P, Q) presente y referenciado', entries(v3.manifest).every(k => fs.existsSync(path.join(f.uploadDir, v3.manifest[k].file))));
    ok('[8] el job informa los huérfanos (read-only)', v3.result.orphanAudioFiles === 4, String(v3.result.orphanAudioFiles));
}

console.log('\n[5] regeneración fallida (429) conserva todo el audio y el manifest');
{
    const f = fixture();
    const a = await f.run(textOf(['a', 'b', 'c']));
    const s = f.snapshot();
    failWhen = (input) => (input === longSentence('Z') ? new Error('429 You have no credits remaining (test)') : null);
    const b = await f.run(textOf(['a', 'Z', 'c']));
    failWhen = null;
    ok('fallo: success=false', b.result.success === false);
    ok('fallo: manifest V1 intacto', b.raw === a.raw);
    ok('fallo: todos los mp3 previos intactos', preserved(s, f));
}

console.log('\n[6] reintento reutiliza audio válido existente');
{
    const f = fixture();
    failWhen = (input, n) => (n >= 2 ? new Error('502 Bad Gateway (test)') : null);
    await f.run(textOf(['a', 'b', 'c', 'd']));
    failWhen = null;
    const r = await f.run(textOf(['a', 'b', 'c', 'd']));
    ok('reintento: solo 2 llamadas (a, b reutilizados)', r.calls.length === 2, String(r.calls.length));
    ok('reintento: manifest completo', entries(r.manifest).length === 4);
}

console.log('\n[I] Alicia: manifest 10/103 + mp3 válidos de 10–14 + huérfano ajeno → retry 103/103');
{
    const f = fixture();
    const tags = Array.from({ length: 103 }, (_, i) => `al${i}`);
    const text = textOf(tags);
    // Manifest previo con 0..9 (generado por el propio servicio con un corte de cuota).
    failWhen = (input, n) => (n >= 15 ? new Error('429 quota (test)') : null);
    await f.run(text); // genera 0..14, sin manifest (contrato atómico)
    failWhen = null;
    // Reconstruir el estado de producción: manifest con 0..9; 10..14 quedan como huérfanos válidos.
    const m = { _meta: { version: 2, splitVersion: 1, totalChunks: 103, totalSentences: 0 } };
    for (let i = 0; i < 10; i++) {
        const t = longSentence(tags[i]);
        m[i] = { text: t, file: `audio/${f.contentId}/${fileOf(t)}`, index: i, hash: generateHash(t, 'es', 'alloy', 'openai', 'tts-1'), provider: 'openai', model: 'tts-1', sentences: [t], sentenceStart: i };
    }
    fs.writeFileSync(f.manifestPath, JSON.stringify(m));
    f.seed('chunk_00000000000000000000000000000000_openai_tts-1.mp3', 'AUDIO|ajeno');
    const before = f.snapshot();
    ok('estado previo: 15 mp3 de chunks + 1 ajeno', Object.keys(before).length === 16);
    destructive.length = 0;
    const r = await f.run(text);
    ok('retry publica 103/103', r.result.success === true && entries(r.manifest).length === 103);
    ok('reused = 15 (0–14), generados = 88', r.calls.length === 88, String(r.calls.length));
    ok('deleted = 0: todo el audio previo intacto', preserved(before, f));
    ok('el mp3 ajeno (no reutilizable) se conserva', fs.existsSync(path.join(f.audioDir, 'chunk_00000000000000000000000000000000_openai_tts-1.mp3')));
    ok('[7] ninguna operación destructiva', destructive.length === 0, destructive.join(' | '));
}

console.log('\n[J] Cavafis: manifest stale (46, hashes de otro texto) → texto nuevo de 45 → nuevo manifest');
{
    const f = fixture();
    const oldTags = Array.from({ length: 46 }, (_, i) => `old${i}`);
    const m = { _meta: { version: 2, splitVersion: 1, totalChunks: 45, totalSentences: 0 } };
    oldTags.forEach((tg, i) => {
        const t = longSentence(tg);
        const name = fileOf(t, 'gemini', 'gemini-2.5-flash-preview-tts');
        f.seed(name, `AUDIO|stale|${tg}`);
        m[i] = { text: t, file: `audio/${f.contentId}/${name}`, index: i, hash: 'x', provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', sentences: [t], sentenceStart: i };
    });
    fs.writeFileSync(f.manifestPath, JSON.stringify(m));
    const before = f.snapshot();
    destructive.length = 0;
    const r = await f.run(textOf(Array.from({ length: 45 }, (_, i) => `new${i}`)));
    ok('nuevo manifest 45/45 publicado', r.result.success === true && entries(r.manifest).length === 45);
    ok('new assets = 45', r.calls.length === 45);
    ok('old preserved = 46/46 byte a byte', preserved(before, f) && Object.keys(before).length === 46);
    // Segunda regeneración: antes, el audio original ya no estaba en el manifest
    // anterior y la GC lo borraba.
    const r2 = await f.run(textOf(Array.from({ length: 45 }, (_, i) => `v3_${i}`)));
    ok('segunda regeneración publica; audio original sigue intacto', r2.result.success === true && preserved(before, f));
    ok('[7] ninguna operación destructiva', destructive.length === 0, destructive.join(' | '));
}

console.log('\n[K] La metamorfosis: manifest v1 vacío + 8 huérfanos → generación completa');
{
    const f = fixture();
    fs.writeFileSync(f.manifestPath, '{}');
    for (let i = 0; i < 8; i++) f.seed(`chunk_${String(i).repeat(32).slice(0, 32)}_openai_tts-1.mp3`, `AUDIO|huerfano|${i}`);
    const before = f.snapshot();
    destructive.length = 0;
    const r = await f.run(textOf(['m0', 'm1', 'm2']));
    ok('generación completa publicada', r.result.success === true && entries(r.manifest).length === 3);
    ok('8 huérfanos preservados byte a byte', preserved(before, f) && Object.keys(before).length === 8);
    ok('[8] detección: 8 huérfanos informados, sin mutación', r.result.orphanAudioFiles === 8);
    ok('[7] ninguna operación destructiva', destructive.length === 0, destructive.join(' | '));
}

console.log('\n[L] caché bajo demanda de Inmersivo: regenerar no borra audio de otra extensión');
{
    let imm = null;
    try { imm = await import('../immersiveTtsService.js'); }
    catch (e) { console.log(`  SKIP: immersiveTtsService no carga en esta plataforma (${e.code || e.message}); ejecutar en la imagen API (POSIX)`); }
    if (imm) {
        const cacheDir = path.join(root, 'immersive-cache');
        const gen = (mimeType, provider) => async (text) => ({ data: Buffer.from(`AUDIO|${provider}|${text}`), mimeType, provider });
        const text = 'Frase de prueba para la caché.';
        const a = await imm.getOrGenerateImmersiveAudio(text, { cacheDir, generate: gen('audio/wav', 'gemini') });
        const wavPath = path.join(cacheDir, `${a.hash}.wav`);
        const wavBytes = fs.readFileSync(wavPath, 'utf8');
        // Sidecar corrupto → regenera con otro proveedor/extensión.
        fs.writeFileSync(path.join(cacheDir, `${a.hash}.json`), '{ roto');
        destructive.length = 0;
        const b = await imm.getOrGenerateImmersiveAudio(text, { cacheDir, generate: gen('audio/mpeg', 'openai') });
        ok('regenera en .mp3', b.cached === false && fs.existsSync(path.join(cacheDir, `${a.hash}.mp3`)));
        ok('el .wav anterior se conserva byte a byte', fs.readFileSync(wavPath, 'utf8') === wavBytes);
        ok('el sidecar apunta al audio nuevo', JSON.parse(fs.readFileSync(path.join(cacheDir, `${a.hash}.json`), 'utf8')).mimeType === 'audio/mpeg');
        ok('[7] ninguna operación destructiva en la caché', destructive.length === 0, destructive.join(' | '));
    }
}

console.log('\n[ratchet] TTS_AUTOMATIC_ASSET_DELETION: ZERO');
{
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const tts = strip(fs.readFileSync(new URL('../ttsService.js', import.meta.url), 'utf8'));
    ok('ttsService.js: sin unlink/rm/rmdir/truncate', !/\b(unlink|unlinkSync|rmSync|rmdirSync|rmdir|truncateSync|ftruncateSync)\s*\(|\bfs\.rm\s*\(/.test(tts));
    ok('ttsService.js: renameSync solo desde temporales', (tts.match(/renameSync\(/g) || []).length === 1 && /renameSync\(tmpPath, filePath\)/.test(tts));
    const imm = strip(fs.readFileSync(new URL('../immersiveTtsService.js', import.meta.url), 'utf8'));
    ok('immersiveTtsService.js: sin unlink/rm', !/\b(unlink|unlinkSync|rmSync|rmdirSync|truncateSync)\s*\(|\bfs\.rm\s*\(/.test(imm));
    const srv = strip(fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'));
    ok('server.js: la GC del caché de álbum no se programa automáticamente', !/cleanupAlbumCache\(30\)/.test(srv) && !/setInterval\([\s\S]{0,200}cleanupAlbumCache/.test(srv));
    ok('server.js: la limpieza del caché de álbum solo existe por endpoint admin explícito', (srv.match(/cleanupAlbumCache\(/g) || []).length === 1);
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
console.log(`\nttsAssetRetention — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
