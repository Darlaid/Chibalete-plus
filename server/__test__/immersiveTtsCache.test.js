/**
 * immersiveTtsCache.test.js — HF4B-1. Pruebas directas del servicio de cache
 * persistente de TTS on-demand del modo inmersivo.
 *
 * Cómo correr (sin framework, solo Node):
 *   node server/__test__/immersiveTtsCache.test.js
 *
 * Aislamiento: usa un directorio temporal propio (os.tmpdir) y un generador
 * MOCK inyectado. NO toca public/uploads ni llama a OpenAI/Gemini.
 *
 * Cubre:
 *   1. cache miss genera archivo + sidecar.
 *   2. segunda llamada al mismo texto = cache hit y NO llama al generador.
 *   3. hash normaliza espacios equivalentes.
 *   4. archivo de 0 bytes se elimina/regenera.
 *   5. sidecar ausente o corrupto no rompe; regenera.
 *   6. respeta mimeType audio/wav o audio/mpeg.
 *   7. textos distintos generan hashes distintos.
 *   8. no permite path traversal (hash hex confinado al cacheDir).
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    getOrGenerateImmersiveAudio,
    textHash,
} from '../immersiveTtsService.js';

let pass = 0;
let fail = 0;

function assert(label, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        pass++;
    } else {
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
        fail++;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshCacheDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'immersive-tts-test-'));
    return dir;
}

/**
 * Construye un generador MOCK que cuenta llamadas y devuelve un buffer estable.
 * @param {object} [o]
 * @param {string} [o.mimeType='audio/mpeg']
 * @param {string} [o.provider='openai']
 * @param {Buffer} [o.data] — bytes de audio falsos (no vacíos por defecto).
 */
function makeMockGenerator(o = {}) {
    const state = { calls: 0, lastText: null };
    const generate = async (text) => {
        state.calls++;
        state.lastText = text;
        return {
            provider: o.provider ?? 'openai',
            model:    'mock-model',
            mimeType: o.mimeType ?? 'audio/mpeg',
            data:     o.data ?? Buffer.from('FAKE_AUDIO_BYTES_NON_EMPTY'),
        };
    };
    return { generate, state };
}

function rmrf(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Test 1: cache miss genera archivo + sidecar ──────────────────────────────
async function test1() {
    console.log('\n[1] cache miss genera archivo + sidecar');
    const cacheDir = freshCacheDir();
    try {
        const { generate, state } = makeMockGenerator();
        const text = 'Había una vez un niño de madera.';
        const r = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });

        assert('cached=false en primera llamada', r.cached === false);
        assert('generador llamado exactamente 1 vez', state.calls === 1, `calls=${state.calls}`);
        assert('devuelve un Buffer no vacío', Buffer.isBuffer(r.buffer) && r.buffer.length > 0);
        assert('provider propagado', r.provider === 'openai', r.provider);

        const audioPath = path.join(cacheDir, `${r.hash}.mp3`);
        const metaPath  = path.join(cacheDir, `${r.hash}.json`);
        assert('archivo de audio escrito en disco', fs.existsSync(audioPath));
        assert('sidecar escrito en disco', fs.existsSync(metaPath));

        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        assert('sidecar.provider', meta.provider === 'openai');
        assert('sidecar.mimeType', meta.mimeType === 'audio/mpeg');
        assert('sidecar.textHash', meta.textHash === r.hash);
        assert('sidecar.bytes coincide', meta.bytes === r.buffer.length, `bytes=${meta.bytes}`);
        assert('sidecar.createdAt presente', typeof meta.createdAt === 'string' && meta.createdAt.length > 0);

        // No deben quedar temporales colgando.
        const leftovers = fs.readdirSync(cacheDir).filter(f => f.includes('.tmp-'));
        assert('sin archivos temporales colgando', leftovers.length === 0, leftovers.join(','));
    } finally {
        rmrf(cacheDir);
    }
}

// ── Test 2: segunda llamada = cache hit y NO llama al generador ───────────────
async function test2() {
    console.log('\n[2] segunda llamada = cache hit, sin re-generar');
    const cacheDir = freshCacheDir();
    try {
        const { generate, state } = makeMockGenerator();
        const text = 'El zorro corrió hacia el bosque.';

        const r1 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });
        const r2 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });

        assert('primera = miss', r1.cached === false);
        assert('segunda = hit', r2.cached === true);
        assert('generador llamado solo 1 vez en total', state.calls === 1, `calls=${state.calls}`);
        assert('mismo hash en ambas', r1.hash === r2.hash);
        assert('buffers equivalentes', Buffer.compare(r1.buffer, r2.buffer) === 0);
        assert('mimeType estable', r2.mimeType === 'audio/mpeg');
        assert('provider estable desde sidecar', r2.provider === 'openai');
    } finally {
        rmrf(cacheDir);
    }
}

// ── Test 3: hash normaliza espacios equivalentes ─────────────────────────────
async function test3() {
    console.log('\n[3] hash normaliza whitespace equivalente');
    const cacheDir = freshCacheDir();
    try {
        const a = 'Hola   mundo\n  pequeño';
        const b = 'Hola mundo pequeño';
        assert('textHash() iguala variantes de espacios', textHash(a) === textHash(b),
            `${textHash(a)} vs ${textHash(b)}`);

        // Y a nivel de servicio: la 2ª variante debe ser cache hit de la 1ª.
        const { generate, state } = makeMockGenerator();
        const r1 = await getOrGenerateImmersiveAudio(a, { cacheDir, generate });
        const r2 = await getOrGenerateImmersiveAudio(b, { cacheDir, generate });
        assert('variante con espacios distintos = cache hit', r2.cached === true);
        assert('generador llamado 1 sola vez', state.calls === 1, `calls=${state.calls}`);
        assert('mismo hash', r1.hash === r2.hash);
    } finally {
        rmrf(cacheDir);
    }
}

// ── Test 4: archivo de 0 bytes se elimina/regenera ───────────────────────────
async function test4() {
    console.log('\n[4] archivo de 0 bytes se trata como corrupto y regenera');
    const cacheDir = freshCacheDir();
    try {
        const { generate, state } = makeMockGenerator();
        const text = 'Frase con audio corrupto.';
        const r1 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });

        // Corromper: truncar el audio a 0 bytes.
        const audioPath = path.join(cacheDir, `${r1.hash}.mp3`);
        fs.writeFileSync(audioPath, Buffer.alloc(0));
        assert('audio quedó en 0 bytes', fs.statSync(audioPath).size === 0);

        const r2 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });
        assert('regenera (cached=false)', r2.cached === false);
        assert('generador llamado 2 veces (regeneración)', state.calls === 2, `calls=${state.calls}`);
        assert('audio regenerado no vacío', fs.statSync(audioPath).size > 0);
    } finally {
        rmrf(cacheDir);
    }
}

// ── Test 5: sidecar ausente o corrupto no rompe; regenera ────────────────────
async function test5() {
    console.log('\n[5] sidecar ausente/corrupto no rompe; regenera');

    // 5a — sidecar corrupto (JSON inválido)
    let cacheDir = freshCacheDir();
    try {
        const { generate, state } = makeMockGenerator();
        const text = 'Texto con sidecar corrupto.';
        const r1 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });
        fs.writeFileSync(path.join(cacheDir, `${r1.hash}.json`), '{ esto no es json válido ');

        const r2 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });
        assert('5a: no lanza y regenera (cached=false)', r2.cached === false);
        assert('5a: generador llamado 2 veces', state.calls === 2, `calls=${state.calls}`);
        const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, `${r2.hash}.json`), 'utf8'));
        assert('5a: sidecar reescrito válido', meta.provider === 'openai');
    } finally {
        rmrf(cacheDir);
    }

    // 5b — sidecar ausente (audio presente, .json borrado)
    cacheDir = freshCacheDir();
    try {
        const { generate, state } = makeMockGenerator();
        const text = 'Texto con sidecar ausente.';
        const r1 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });
        fs.unlinkSync(path.join(cacheDir, `${r1.hash}.json`));

        const r2 = await getOrGenerateImmersiveAudio(text, { cacheDir, generate });
        assert('5b: no rompe; regenera (cached=false)', r2.cached === false);
        assert('5b: sidecar restaurado', fs.existsSync(path.join(cacheDir, `${r2.hash}.json`)));
    } finally {
        rmrf(cacheDir);
    }
}

// ── Test 6: respeta mimeType audio/wav o audio/mpeg ──────────────────────────
async function test6() {
    console.log('\n[6] respeta mimeType (wav → .wav, mpeg → .mp3)');

    // 6a — Gemini WAV
    let cacheDir = freshCacheDir();
    try {
        const { generate } = makeMockGenerator({ provider: 'gemini', mimeType: 'audio/wav' });
        const r = await getOrGenerateImmersiveAudio('Audio en formato WAV.', { cacheDir, generate });
        assert('6a: mimeType wav propagado', r.mimeType === 'audio/wav');
        assert('6a: provider gemini', r.provider === 'gemini');
        assert('6a: archivo .wav en disco', fs.existsSync(path.join(cacheDir, `${r.hash}.wav`)));
        // Cache hit conserva wav.
        const r2 = await getOrGenerateImmersiveAudio('Audio en formato WAV.', { cacheDir, generate });
        assert('6a: hit conserva mimeType wav', r2.cached === true && r2.mimeType === 'audio/wav');
    } finally {
        rmrf(cacheDir);
    }

    // 6b — OpenAI MP3
    cacheDir = freshCacheDir();
    try {
        const { generate } = makeMockGenerator({ provider: 'openai', mimeType: 'audio/mpeg' });
        const r = await getOrGenerateImmersiveAudio('Audio en formato MP3.', { cacheDir, generate });
        assert('6b: mimeType mpeg propagado', r.mimeType === 'audio/mpeg');
        assert('6b: archivo .mp3 en disco', fs.existsSync(path.join(cacheDir, `${r.hash}.mp3`)));
    } finally {
        rmrf(cacheDir);
    }
}

// ── Test 7: textos distintos generan hashes distintos ────────────────────────
async function test7() {
    console.log('\n[7] textos distintos → hashes distintos');
    const h1 = textHash('Primer texto.');
    const h2 = textHash('Segundo texto.');
    assert('hashes distintos', h1 !== h2, `${h1} === ${h2}`);
    assert('hash 1 es hex de 12 chars', /^[0-9a-f]{12}$/.test(h1), h1);
    assert('hash 2 es hex de 12 chars', /^[0-9a-f]{12}$/.test(h2), h2);
}

// ── Test 8: no permite path traversal ────────────────────────────────────────
async function test8() {
    console.log('\n[8] no permite path traversal');
    const cacheDir = freshCacheDir();
    try {
        const { generate } = makeMockGenerator();
        const evil = '../../../../etc/passwd  y más texto';
        const r = await getOrGenerateImmersiveAudio(evil, { cacheDir, generate });

        assert('hash sigue siendo hex puro de 12 chars', /^[0-9a-f]{12}$/.test(r.hash), r.hash);

        // Todos los archivos creados deben vivir DENTRO de cacheDir, sin escapar.
        const entries = fs.readdirSync(cacheDir);
        const allInside = entries.every(name => {
            const resolved = path.resolve(cacheDir, name);
            return resolved.startsWith(path.resolve(cacheDir) + path.sep);
        });
        assert('todos los archivos confinados al cacheDir', allInside, entries.join(','));
        assert('nombres de archivo solo hash.ext', entries.every(n => /^[0-9a-f]{12}\.(mp3|wav|json)$/.test(n)),
            entries.join(','));
    } finally {
        rmrf(cacheDir);
    }
}

// ── Runner ───────────────────────────────────────────────────────────────────
(async () => {
    console.log('immersiveTtsCache — HF4B-1');
    const tests = [test1, test2, test3, test4, test5, test6, test7, test8];
    for (const t of tests) {
        try {
            await t();
        } catch (e) {
            fail++;
            console.error(`  ✗ ${t.name} lanzó excepción — ${e && e.stack ? e.stack : e}`);
        }
    }
    console.log('');
    console.log(`immersiveTtsCache — pass=${pass} fail=${fail}`);
    if (fail > 0) process.exitCode = 1;
})();
