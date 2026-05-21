/**
 * manifestAdapter.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Lee el manifest TTS de un contenido y lo normaliza al shape que los
 * consumers V2 (sentenceAdapter, audioAdapter futuro) esperan.
 *
 * URL: /uploads/audio/<contentId>/manifest.json
 *
 * Soporta dos versiones de manifest (heredadas del backend TTS pipeline):
 *   - v1: { [chunkKey]: { index: number, file: string, text: string } }
 *   - v2: {
 *       _meta: { version: 2, ... },
 *       [chunkKey]: { index: number, file: string, sentences: string[] }
 *     }
 *
 * Output normalizado:
 *   {
 *     ok: true,
 *     version: 1 | 2,
 *     fileByKey:        Record<string, string>,
 *     sentencesByKey?:  Record<string, string[]>   // solo v2
 *   }
 *
 * NO usa fetch global por defecto sólo si está disponible — accept
 * `fetchImpl` para tests. AbortSignal se propaga al fetch y a la lectura
 * del body. Errores formales discriminados por `reason`.
 */

const MANIFEST_URL = (contentId) =>
    `/uploads/audio/${encodeURIComponent(contentId)}/manifest.json`;

/**
 * loadManifest — fetch + normalize. Devuelve uno de:
 *   { ok: true,  version, fileByKey, sentencesByKey? }
 *   { ok: false, reason: 'invalid_args' | 'no_fetch_impl' | 'aborted'
 *                       | 'fetch_failed' | 'invalid_json' | 'invalid_shape',
 *     meta?: object }
 */
export async function loadManifest({ contentId, signal, fetchImpl } = {}) {
    if (typeof contentId !== 'string' || contentId.length === 0) {
        return { ok: false, reason: 'invalid_args', meta: { reason: 'missing_contentId' } };
    }
    const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch : null);
    if (!fetcher) {
        return { ok: false, reason: 'no_fetch_impl' };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };

    let res;
    try {
        res = await fetcher(MANIFEST_URL(contentId), { signal });
    } catch (e) {
        if (signal?.aborted || isAbortError(e)) return { ok: false, reason: 'aborted' };
        return { ok: false, reason: 'fetch_failed', meta: { error: e?.message ?? String(e) } };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    if (!res || !res.ok) {
        return {
            ok: false, reason: 'fetch_failed',
            meta: { status: res?.status ?? null },
        };
    }

    let raw;
    try {
        raw = await res.json();
    } catch (e) {
        if (signal?.aborted || isAbortError(e)) return { ok: false, reason: 'aborted' };
        return { ok: false, reason: 'invalid_json', meta: { error: e?.message ?? String(e) } };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };

    return normalizeRaw(raw);
}

/**
 * normalizeRaw — convierte un manifest raw (ya parseado) al shape normalizado.
 * Exportado separadamente para que consumers que ya tienen el raw (ej:
 * sentenceAdapter via StartupEngine) lo reusen sin re-fetch.
 */
export function normalizeRaw(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'invalid_shape', meta: { reason: 'not_object' } };
    }
    const meta = raw._meta;
    const version = (meta && Number.isFinite(Number(meta.version)) && Number(meta.version) >= 2)
        ? 2
        : 1;

    const entries = Object.entries(raw).filter(([k]) => k !== '_meta');
    if (entries.length === 0) {
        return { ok: false, reason: 'invalid_shape', meta: { reason: 'no_chunks' } };
    }

    const fileByKey = {};
    const sentencesByKey = (version === 2) ? {} : null;

    for (const [key, chunk] of entries) {
        if (!chunk || typeof chunk !== 'object') continue;
        if (typeof chunk.file === 'string' && chunk.file.length > 0) {
            fileByKey[key] = chunk.file;
        }
        if (sentencesByKey !== null && Array.isArray(chunk.sentences)) {
            const cleaned = chunk.sentences.filter(s => typeof s === 'string' && s.length > 0);
            if (cleaned.length > 0) sentencesByKey[key] = cleaned;
        }
    }

    const fileCount = Object.keys(fileByKey).length;
    const sentenceCount = sentencesByKey ? Object.keys(sentencesByKey).length : 0;
    if (fileCount === 0 && sentenceCount === 0) {
        return { ok: false, reason: 'invalid_shape', meta: { reason: 'no_useful_data' } };
    }

    const out = { ok: true, version, fileByKey };
    if (sentencesByKey) out.sentencesByKey = sentencesByKey;
    return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function isAbortError(e) {
    return e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
}
