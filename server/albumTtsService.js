/**
 * albumTtsService.js — Cache persistente de TTS para libro álbum.
 *
 * Responsabilidades:
 *   1. Buscar audio pre-generado en disco antes de llamar a cualquier API.
 *   2. Generar TTS vía runHybridTask (OpenAI primario → Gemini fallback).
 *   3. Guardar MP3 en disco para cache persistente cross-session.
 *   4. Devolver URL estática servible por Nginx/Express.
 *
 * Cache path:
 *   /uploads/audio/{contentId}/album/{textHash}.mp3
 *
 * La clave de cache es hash(text) — independiente de pageId/regionId.
 * Texto idéntico en páginas distintas comparte el mismo archivo (correcto y deseable).
 *
 * Seguridad:
 *   - contentId sanitizado para evitar path traversal.
 *   - textHash es MD5 de 12 chars — no expone el texto original.
 *   - Ninguna clave de API se transmite al frontend.
 */

import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runHybridTask } from './aiEngine.js';
import { UPLOADS_ROOT } from './config.js';

const log = (msg, type = 'ALBUM_TTS') => {
    console.log(`[${new Date().toISOString()}] [${type}] ${msg}`);
};

// ── Cache GC ────────────────────────────────────────────────────────────────

/**
 * Limpia archivos MP3 + sidecar JSON del cache de álbum que superen maxAgeDays.
 * Opera sobre /uploads/audio/<contentId>/album/.
 * Fire-and-forget — errores individuales de archivo se registran y se ignoran.
 *
 * @param {number} maxAgeDays — Archivos más antiguos que esto serán eliminados (default: 30).
 * @returns {{ removed: number, bytes: number }} resumen de la limpieza.
 */
export async function cleanupAlbumCache(maxAgeDays = 30) {
    const audioRoot  = path.join(UPLOADS_ROOT, 'audio');
    const cutoff     = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let   removed    = 0;
    let   bytes      = 0;

    if (!fs.existsSync(audioRoot)) return { removed: 0, bytes: 0 };

    let contentDirs;
    try { contentDirs = fs.readdirSync(audioRoot); } catch { return { removed: 0, bytes: 0 }; }

    for (const contentId of contentDirs) {
        const albumDir = path.join(audioRoot, contentId, 'album');
        if (!fs.existsSync(albumDir)) continue;

        let files;
        try { files = fs.readdirSync(albumDir); } catch { continue; }

        for (const file of files) {
            if (!file.endsWith('.mp3') && !file.endsWith('.json')) continue;
            const fullPath = path.join(albumDir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.mtimeMs < cutoff) {
                    bytes += stat.size;
                    fs.unlinkSync(fullPath);
                    removed++;
                }
            } catch { /* archivo ya eliminado o error de permisos — ignorar */ }
        }
    }

    if (removed > 0) {
        log(`GC completed: removed=${removed} files bytes=${bytes} maxAgeDays=${maxAgeDays}`);
    }
    return { removed, bytes };
}

/**
 * Elimina todo el cache de un contentId específico.
 * Usado por el endpoint admin DELETE /api/admin/album-cache/:contentId.
 *
 * @returns {{ removed: number, bytes: number }}
 */
export async function purgeAlbumCacheForContent(contentId) {
    const safeId  = String(contentId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
    const albumDir = path.join(UPLOADS_ROOT, 'audio', safeId, 'album');

    if (!fs.existsSync(albumDir)) return { removed: 0, bytes: 0 };

    let removed = 0;
    let bytes   = 0;

    let files;
    try { files = fs.readdirSync(albumDir); } catch { return { removed: 0, bytes: 0 }; }

    for (const file of files) {
        const fullPath = path.join(albumDir, file);
        try {
            bytes += fs.statSync(fullPath).size;
            fs.unlinkSync(fullPath);
            removed++;
        } catch { /* ignorar */ }
    }

    log(`Purged contentId=${safeId}: removed=${removed} files bytes=${bytes}`);
    return { removed, bytes };
}

/**
 * Sanitiza un segmento de path: solo alfanuméricos, guiones y guiones bajos.
 * Previene path traversal (e.g. ../../etc/passwd).
 */
const safeSeg = (s) => String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);

/**
 * Genera un hash corto del texto normalizado para usar como filename.
 * 12 chars hex = 48 bits de entropía — suficiente para evitar colisiones en este dominio.
 */
const textHash = (text) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return crypto.createHash('md5').update(normalized).digest('hex').substring(0, 12);
};

/**
 * Obtiene o genera el audio TTS de un texto para libro álbum.
 *
 * @param {string} contentId — ID del contenido (usado como directorio de cache)
 * @param {string} text      — Texto a narrar (máx 500 chars recomendado)
 * @returns {Promise<{ url: string, cached: boolean }>}
 * @throws si la generación TTS falla en todos los providers
 */
/**
 * Obtiene o genera el audio TTS de un texto para libro álbum.
 *
 * @returns {Promise<{ url: string, provider: string, cached: boolean }>}
 *   provider: 'openai' | 'gemini' | 'mock' — usado por el frontend para normalización de volumen.
 *   En cache hits, el provider se lee de un sidecar JSON mínimo ({hash}.json) guardado al generar.
 */
export async function getOrGenerateAlbumRegionAudio(contentId, text) {
    const safeId      = safeSeg(contentId || 'unknown');
    const hash        = textHash(text);
    const filename    = `${hash}.mp3`;
    const metaname    = `${hash}.json`; // sidecar: { provider: 'openai' | 'gemini' }

    const dir         = path.join(UPLOADS_ROOT, 'audio', safeId, 'album');
    const fullPath    = path.join(dir, filename);
    const metaPath    = path.join(dir, metaname);
    const publicUrl   = `/uploads/audio/${safeId}/album/${filename}`;

    // Cache hit — devolver URL + provider sin llamar a ningún API
    if (fs.existsSync(fullPath)) {
        const size = fs.statSync(fullPath).size;
        if (size > 0) {
            // Leer provider del sidecar (si existe). Default 'openai' para archivos pre-sidecar.
            let provider = 'openai';
            try {
                if (fs.existsSync(metaPath)) {
                    provider = JSON.parse(fs.readFileSync(metaPath, 'utf8')).provider ?? 'openai';
                }
            } catch { /* sidecar corrupto — usar default */ }
            log(`Cache hit: ${publicUrl} provider=${provider} (${size}B)`);
            return { url: publicUrl, provider, cached: true };
        }
        // Archivo corrupto (0 bytes) — eliminar y regenerar
        fs.unlinkSync(fullPath);
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        log(`Corrupt cache removed, regenerating: ${filename}`, 'WARN');
    }

    // Cache miss — generar TTS (OpenAI → Gemini fallback automático en runHybridTask)
    log(`Cache miss, generating: contentId=${safeId} hash=${hash}`);

    fs.mkdirSync(dir, { recursive: true });

    const result = await runHybridTask('tts', {
        text:  text.substring(0, 500),
        voice: 'alloy',
    });

    // Guardar MP3 + sidecar de provider
    fs.writeFileSync(fullPath, result.data);
    fs.writeFileSync(metaPath, JSON.stringify({ provider: result.provider }));
    log(`Generated and cached: ${publicUrl} provider=${result.provider}`);

    return { url: publicUrl, provider: result.provider, cached: false };
}
