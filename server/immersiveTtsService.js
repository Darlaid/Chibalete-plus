/**
 * immersiveTtsService.js — Cache persistente de TTS on-demand para modo Inmersivo.
 *
 * HF4B-1. Gemelo de albumTtsService.js, pero adaptado al CONTRATO BINARIO de
 * /api/tts: el modo inmersivo responde los bytes de audio directamente (no una
 * URL JSON como álbum). Por eso este servicio devuelve el Buffer, no una ruta.
 *
 * Responsabilidades:
 *   1. Buscar audio pre-generado en disco antes de llamar a cualquier API.
 *   2. Generar TTS vía runHybridTask (OpenAI primario → Gemini fallback) en miss.
 *   3. Guardar audio + sidecar en disco para cache persistente cross-session.
 *   4. Devolver { buffer, mimeType, provider, cached, hash } al endpoint.
 *
 * Cache path:
 *   /uploads/audio/immersive/{hash}.{mp3|wav}   ← audio
 *   /uploads/audio/immersive/{hash}.json        ← sidecar { provider, mimeType, ... }
 *
 * Clave de cache: md5(normalize(text)).slice(0,12) — provider-independiente
 * (igual que álbum). Texto idéntico comparte audio aunque lo haya generado
 * OpenAI o Gemini. El provider/mimeType real se persiste en el sidecar.
 *
 * Decisión HF4B-1 (confirmada en HF4B-0): la clave ideal
 * contentId+sentenceIndex+voice+speed NO es construible backend-only porque el
 * frontend solo envía { text }. Hoy voice='alloy' es constante y speed no
 * existe, así que el texto es la clave completa de facto.
 *
 * Seguridad:
 *   - El hash es MD5 hex de 12 chars (solo [0-9a-f]) → imposible path traversal
 *     aunque `text` contenga "../". Se valida defensivamente igualmente.
 *   - Ninguna clave de API se transmite al frontend.
 *
 * NOTA: este servicio NO implementa breaker / prewarm / timeout backend. Esos
 * son HF4B-2 / HF4B-3 / HF4B-4 y no están autorizados en esta fase.
 */

import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import { runHybridTask } from './aiEngine.js';
import { UPLOADS_ROOT }   from './config.js';

const log = (msg, type = 'IMMERSIVE_TTS') => {
    console.log(`[${new Date().toISOString()}] [${type}] ${msg}`);
};

/** Directorio de cache del modo inmersivo. */
export const IMMERSIVE_CACHE_DIR = path.join(UPLOADS_ROOT, 'audio', 'immersive');

/**
 * Genera la clave de cache: MD5 del texto normalizado, 12 chars hex.
 * Normaliza espacios para que variantes de whitespace equivalentes coincidan.
 */
export const textHash = (text) => {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    return crypto.createHash('md5').update(normalized).digest('hex').substring(0, 12);
};

/**
 * Extensión de archivo según mimeType.
 *   OpenAI → audio/mpeg → .mp3
 *   Gemini → audio/wav  → .wav  (PCM L16 wrappeado en RIFF por aiEngine)
 *   mock   → audio/wav  → .wav
 */
const extForMime = (mime) => (typeof mime === 'string' && /wav/i.test(mime)) ? 'wav' : 'mp3';

/**
 * Obtiene o genera el audio TTS de un texto para el modo inmersivo.
 *
 * @param {string} text — Texto a narrar (el endpoint ya recorta a 2000 chars).
 * @param {object} [opts]
 * @param {string}   [opts.cacheDir] — Override del directorio de cache (para tests).
 * @param {function} [opts.generate] — Generador inyectable (para tests). Por
 *                                      defecto runHybridTask('tts', {text, voice:'alloy'}).
 * @returns {Promise<{ buffer: Buffer, mimeType: string, provider: string, cached: boolean, hash: string }>}
 * @throws si la generación TTS falla en todos los providers (el endpoint mapea a 503).
 */
export async function getOrGenerateImmersiveAudio(text, opts = {}) {
    const cacheDir = opts.cacheDir || IMMERSIVE_CACHE_DIR;
    const generate = opts.generate || ((t) => runHybridTask('tts', { text: t, voice: 'alloy' }));

    const hash = textHash(text);

    // Defensa anti path-traversal: el hash debe ser hex puro. Si por cualquier
    // motivo no lo es, abortamos antes de tocar el filesystem.
    if (!/^[0-9a-f]{12}$/.test(hash)) {
        throw new Error(`Invalid cache hash derived from text: "${hash}"`);
    }

    const metaPath = path.join(cacheDir, `${hash}.json`);

    // ── Cache lookup ─────────────────────────────────────────────────────────
    // El sidecar dice qué extensión/mimeType tiene el audio. Lo leemos primero.
    let meta = null;
    if (fs.existsSync(metaPath)) {
        try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch {
            // Sidecar corrupto → no rompe: lo descartamos y tratamos como miss.
            log(`corrupt_cache hash=${hash} reason=sidecar_parse`, 'WARN');
            try { fs.unlinkSync(metaPath); } catch { /* ya borrado */ }
            meta = null;
        }
    }

    if (meta && meta.mimeType) {
        const ext       = extForMime(meta.mimeType);
        const audioPath = path.join(cacheDir, `${hash}.${ext}`);

        if (fs.existsSync(audioPath)) {
            const size = fs.statSync(audioPath).size;
            if (size > 0) {
                const buffer = fs.readFileSync(audioPath);
                log(`cache_hit hash=${hash} provider=${meta.provider ?? 'unknown'}`);
                return {
                    buffer,
                    mimeType: meta.mimeType,
                    provider: meta.provider ?? 'openai',
                    cached:   true,
                    hash,
                };
            }
            // Archivo de 0 bytes → corrupto: eliminar archivo + sidecar y regenerar.
            log(`corrupt_cache hash=${hash} reason=zero_bytes`, 'WARN');
            try { fs.unlinkSync(audioPath); } catch { /* ignore */ }
            try { fs.unlinkSync(metaPath);  } catch { /* ignore */ }
        } else {
            // Sidecar presente pero audio ausente: sidecar stale → limpiar y regenerar.
            log(`corrupt_cache hash=${hash} reason=missing_audio`, 'WARN');
            try { fs.unlinkSync(metaPath); } catch { /* ignore */ }
        }
    }

    // ── Cache miss → generar ─────────────────────────────────────────────────
    log(`cache_miss hash=${hash}`);
    fs.mkdirSync(cacheDir, { recursive: true });

    const result   = await generate(text);
    const mimeType = (typeof result.mimeType === 'string' && result.mimeType.length > 0)
        ? result.mimeType
        : 'audio/mpeg';
    const provider = result.provider ?? 'openai';
    const ext      = extForMime(mimeType);
    const buffer   = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);

    const audioPath = path.join(cacheDir, `${hash}.${ext}`);

    // Escritura atómica: archivo temporal + rename. Evita que un lector
    // concurrente vea un archivo a medio escribir.
    const tmpPath = path.join(cacheDir, `${hash}.${ext}.tmp-${process.pid}`);
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, audioPath);

    // Limpiar un posible archivo stale de la extensión opuesta (p. ej. cambió el
    // provider entre generaciones: .wav viejo cuando ahora generamos .mp3).
    const otherPath = path.join(cacheDir, `${hash}.${ext === 'mp3' ? 'wav' : 'mp3'}`);
    if (fs.existsSync(otherPath)) { try { fs.unlinkSync(otherPath); } catch { /* ignore */ } }

    const sidecar = {
        provider,
        mimeType,
        createdAt: new Date().toISOString(),
        textHash:  hash,
        bytes:     buffer.length,
    };
    fs.writeFileSync(metaPath, JSON.stringify(sidecar));

    log(`generated hash=${hash} provider=${provider} bytes=${buffer.length}`);
    return { buffer, mimeType, provider, cached: false, hash };
}
