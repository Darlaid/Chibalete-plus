/**
 * audioAdapter.mjs — Sprint Inmersivo V2 / Fase M-3.2.
 *
 * Adapter productivo de audio para V2. Dos superficies:
 *
 *   createBrowserAudioAdapter({getActiveSessionId, onEnded, onError, onCanPlay,
 *                              audioCtor?, getReadyState?})
 *     → { factory, cleanupAudio, registerObjectUrl, releaseSession, releaseAll }
 *
 *   resolveAudioSrc({session, index, text, manifest, userId, signal,
 *                    fetchImpl?, onObjectUrlCreated?})
 *     → Promise<{ok: true, src, source: 'manifest'|'tts'} |
 *                {ok: false, reason}>
 *
 * Diseño:
 *   - factory crea HTMLAudioElement vía new Audio() (o ctor inyectado en
 *     tests). Adjunta listeners 'ended' / 'error' / 'canplay' que verifican
 *     stale-callback ANTES de invocar callbacks externos.
 *   - cleanupAudio remueve los listeners de un audio dado. AudioRuntime
 *     debería invocarlo cuando libera/reemplaza el activo (modificación
 *     M-3.2 al AudioRuntime para aceptar opts.audioCleanup).
 *   - Object URLs creados por resolveAudioSrc se registran via callback
 *     onObjectUrlCreated → el viewer/integrator los puede revocar al
 *     cambio de sesión (releaseSession).
 *
 * NO React. NO DOM manipulation. NO singleton state. Cero side effects al
 * import.
 */

const MANIFEST_PREFIX = '/uploads/';
const TTS_ENDPOINT    = '/api/tts';

// Path de file en manifest debe ser SAFE (sin '..', sin esquema, sin /
// inicial). Esto evita open redirect a recursos arbitrarios.
const SAFE_PATH_RE = /^[A-Za-z0-9_/.-]+$/;

/**
 * createBrowserAudioAdapter — factory que produce HTMLAudioElement con
 * listeners stale-aware + APIs para cleanup determinístico.
 *
 * @param {object} opts
 * @param {() => string|null} opts.getActiveSessionId — resuelve el sessionId
 *   "vivo" actual. Cada listener verifica que su sessionId capturado coincida
 *   ANTES de invocar onEnded/onError/onCanPlay.
 * @param {(sessionId: string, index: number) => void} [opts.onEnded]
 * @param {(sessionId: string, index: number, mediaError: object|null) => void} [opts.onError]
 * @param {(sessionId: string, index: number) => void} [opts.onCanPlay]
 * @param {{new(): object}} [opts.audioCtor] — defaults a `Audio` global.
 *   Tests pasan un mock controlado.
 */
export function createBrowserAudioAdapter(opts = {}) {
    const getActiveSessionId = typeof opts.getActiveSessionId === 'function'
        ? opts.getActiveSessionId
        : () => null;
    const onEnded   = typeof opts.onEnded   === 'function' ? opts.onEnded   : null;
    const onError   = typeof opts.onError   === 'function' ? opts.onError   : null;
    const onCanPlay = typeof opts.onCanPlay === 'function' ? opts.onCanPlay : null;
    const AudioImpl = typeof opts.audioCtor === 'function'
        ? opts.audioCtor
        : (typeof Audio === 'function' ? Audio : null);
    /**
     * Sprint M-3.3 — diagnostics opcional para emitir eventos de preload
     * y autoplay (preload.start, preload.hit, preload.abort, preload.release).
     * El integrator pasa runtime._internal.diagnostics.
     */
    const diagnostics = opts.diagnostics && typeof opts.diagnostics.log === 'function'
        ? opts.diagnostics
        : null;
    function diag(kind, sessionId, data) {
        if (!diagnostics) return;
        diagnostics.log({ kind, sessionId, data });
    }

    /**
     * Map<HTMLAudioElement, { ended, error, canplay }>
     * Usamos Map (no WeakMap) para poder iterar en releaseAll.
     */
    const listenerRegistry = new Map();

    /**
     * Map<sessionId, Set<objectURL>>
     * Mantiene los URLs creados via resolveAudioSrc para revocarlos al
     * cambio de sesión.
     */
    const urlsBySessionId = new Map();

    /**
     * Sprint M-3.3 — Preload cache.
     * Map<sessionId, Map<index, { src?, source?, status, abortController, promise }>>
     *
     * Status: 'pending' | 'ready' | 'failed' | 'aborted'.
     * El src cacheado es exactamente el que `resolveAudioSrc` produciría;
     * `peek` lo devuelve sin re-fetch.
     *
     * Garantías:
     *   - prefetch del mismo (sessionId, index) en flight devuelve la misma promise.
     *   - cancelStaleAround aborta los pending fuera de la ventana.
     *   - cancelForSession aborta TODOS los pending y delega URL revoke a releaseSession.
     */
    const preloadCache = new Map();

    function preloadEntry(sessionId, index) {
        return preloadCache.get(sessionId)?.get(index);
    }

    function factory({ container, sessionId, index, src } = {}) {
        if (!AudioImpl) {
            throw new Error('[audioAdapter] Audio constructor not available — pass audioCtor in tests');
        }
        // Capturados al momento de creación; los listeners los usan para
        // identificar a qué sesión pertenecen.
        const capturedSessionId = sessionId ?? null;
        const capturedIndex     = Number.isInteger(index) ? index : 0;

        const audio = new AudioImpl();
        // Algunos backends permiten preload hint vía property; no asumimos
        // el ctor mock lo soporta.
        try { audio.preload = 'auto'; } catch { /* ignore */ }

        const handlers = {
            ended() {
                if (capturedSessionId === null) return;
                if (getActiveSessionId() !== capturedSessionId) return;   // stale
                if (onEnded) onEnded(capturedSessionId, capturedIndex);
            },
            error(_ev) {
                if (capturedSessionId === null) return;
                if (getActiveSessionId() !== capturedSessionId) return;   // stale
                if (onError) onError(capturedSessionId, capturedIndex, audio.error ?? null);
            },
            canplay() {
                if (capturedSessionId === null) return;
                if (getActiveSessionId() !== capturedSessionId) return;   // stale
                if (onCanPlay) onCanPlay(capturedSessionId, capturedIndex);
            },
        };

        try { audio.addEventListener('ended',   handlers.ended);   } catch { /* ignore */ }
        try { audio.addEventListener('error',   handlers.error);   } catch { /* ignore */ }
        try { audio.addEventListener('canplay', handlers.canplay); } catch { /* ignore */ }

        listenerRegistry.set(audio, handlers);
        return audio;
    }

    function cleanupAudio(audio) {
        if (!audio) return;
        const handlers = listenerRegistry.get(audio);
        if (!handlers) return;
        try { audio.removeEventListener('ended',   handlers.ended);   } catch { /* ignore */ }
        try { audio.removeEventListener('error',   handlers.error);   } catch { /* ignore */ }
        try { audio.removeEventListener('canplay', handlers.canplay); } catch { /* ignore */ }
        listenerRegistry.delete(audio);
    }

    function registerObjectUrl(sessionId, url) {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;
        if (typeof url !== 'string' || url.length === 0) return;
        if (!urlsBySessionId.has(sessionId)) urlsBySessionId.set(sessionId, new Set());
        urlsBySessionId.get(sessionId).add(url);
    }

    function releaseSession(sessionId) {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return 0;
        // Sprint M-3.3 — abortar preload pending ANTES de revocar URLs:
        // un preload en flight podría crear un URL nuevo después del revoke.
        preloadCancelForSession(sessionId);
        const urls = urlsBySessionId.get(sessionId);
        if (!urls) return 0;
        let revoked = 0;
        for (const url of urls) {
            try { URL.revokeObjectURL(url); revoked++; } catch { /* ignore */ }
        }
        urlsBySessionId.delete(sessionId);
        diag('preload.release', sessionId, { revoked });
        return revoked;
    }

    function releaseAll() {
        let revoked = 0;
        for (const sessionId of [...urlsBySessionId.keys()]) {
            revoked += releaseSession(sessionId);
        }
        // También limpiar listeners de cualquier audio aún registrado.
        for (const audio of [...listenerRegistry.keys()]) {
            cleanupAudio(audio);
        }
        // Cancelar preloads de sesiones que NO tenían URLs (purely-pending).
        for (const sid of [...preloadCache.keys()]) {
            preloadCancelForSession(sid);
        }
        return revoked;
    }

    // ── Preload manager (M-3.3) ─────────────────────────────────────────────

    /**
     * preloadPrefetch — encola la resolución de src para (session, index) y
     * cachea el resultado. Si ya existe entry en cache:
     *   - status='ready' → retorna inmediato {ok:true, src, source, hit:'cache'}
     *   - status='pending' → retorna la promise existente (de-dup)
     *   - status='failed'/'aborted' → re-intenta limpio
     *
     * El AbortController es OWNED por la entry — preloadCancelStaleAround o
     * preloadCancelForSession lo abortan.
     */
    function preloadPrefetch({ session, index, text, manifest, userId, fetchImpl } = {}) {
        if (!session || typeof session.id !== 'string') {
            return Promise.resolve({ ok: false, reason: 'invalid_args' });
        }
        if (!Number.isInteger(index) || index < 0) {
            return Promise.resolve({ ok: false, reason: 'invalid_args' });
        }
        const sessionId = session.id;
        const existing = preloadEntry(sessionId, index);
        if (existing) {
            if (existing.status === 'ready') {
                diag('preload.hit', sessionId, { index, src: existing.src });
                return Promise.resolve({
                    ok: true, src: existing.src, source: existing.source, hit: 'cache',
                });
            }
            if (existing.status === 'pending') {
                return existing.promise;
            }
            // failed/aborted → re-intento limpio. Eliminamos la entry vieja.
            preloadCache.get(sessionId)?.delete(index);
        }

        const ac = new AbortController();
        const slot = {
            src: null, source: null,
            status: 'pending',
            abortController: ac,
            promise: null,
        };
        if (!preloadCache.has(sessionId)) preloadCache.set(sessionId, new Map());
        preloadCache.get(sessionId).set(index, slot);
        diag('preload.start', sessionId, { index });

        slot.promise = (async () => {
            const result = await resolveAudioSrc({
                session, index, text, manifest, userId,
                signal: ac.signal,
                fetchImpl,
                onObjectUrlCreated: registerObjectUrl,
            });
            if (ac.signal.aborted) {
                slot.status = 'aborted';
                return { ok: false, reason: 'aborted' };
            }
            if (result.ok) {
                slot.src = result.src;
                slot.source = result.source;
                slot.status = 'ready';
            } else {
                slot.status = 'failed';
            }
            return result;
        })();
        return slot.promise;
    }

    /** preloadPeek — devuelve el src cacheado o null si no hay/no listo. */
    function preloadPeek(sessionId, index) {
        const slot = preloadEntry(sessionId, index);
        if (slot?.status === 'ready') return slot.src;
        return null;
    }

    /**
     * preloadCancelStaleAround — aborta y descarta los preloads que caen
     * fuera de la ventana [currentIndex - 1, currentIndex + window].
     * Útil tras un goTo que invalida prefetches lejanos.
     */
    function preloadCancelStaleAround({ session, currentIndex, window = 2 } = {}) {
        if (!session || typeof session.id !== 'string') return 0;
        const sessionId = session.id;
        const map = preloadCache.get(sessionId);
        if (!map) return 0;
        if (!Number.isInteger(currentIndex)) return 0;
        const lower = currentIndex - 1;
        const upper = currentIndex + Math.max(1, Number.isFinite(window) ? window : 2);
        let aborted = 0;
        for (const [idx, slot] of [...map.entries()]) {
            if (idx < lower || idx > upper) {
                if (slot.status === 'pending') {
                    try { slot.abortController.abort(); } catch { /* ignore */ }
                }
                map.delete(idx);
                diag('preload.abort', sessionId, { index: idx, reason: 'stale' });
                aborted++;
            }
        }
        if (map.size === 0) preloadCache.delete(sessionId);
        return aborted;
    }

    /**
     * preloadCancelForSession — aborta TODOS los preloads pending de la
     * sesión. URLs ya cacheados los revoca releaseSession (que llama esto).
     */
    function preloadCancelForSession(sessionId) {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return 0;
        const map = preloadCache.get(sessionId);
        if (!map) return 0;
        let aborted = 0;
        for (const [idx, slot] of map.entries()) {
            if (slot.status === 'pending') {
                try { slot.abortController.abort(); } catch { /* ignore */ }
                aborted++;
            }
            diag('preload.abort', sessionId, { index: idx, reason: 'session_cancelled' });
        }
        preloadCache.delete(sessionId);
        return aborted;
    }

    function _state() {
        const preloadCount = [...preloadCache.values()].reduce((acc, m) => acc + m.size, 0);
        const preloadReady = [...preloadCache.values()]
            .reduce((acc, m) => acc + [...m.values()].filter(s => s.status === 'ready').length, 0);
        return {
            audiosTracked: listenerRegistry.size,
            sessionsWithUrls: urlsBySessionId.size,
            totalUrls: [...urlsBySessionId.values()].reduce((acc, s) => acc + s.size, 0),
            preloadCount, preloadReady,
        };
    }

    return Object.freeze({
        factory,
        cleanupAudio,
        registerObjectUrl,
        releaseSession,
        releaseAll,
        // Sprint M-3.3 — preload sub-API agrupado.
        preload: Object.freeze({
            prefetch:           preloadPrefetch,
            peek:               preloadPeek,
            cancelStaleAround:  preloadCancelStaleAround,
            cancelForSession:   preloadCancelForSession,
        }),
        _state,
    });
}

/**
 * resolveAudioSrc — resuelve el src para (session, index) con cascada
 * manifest → /api/tts → null.
 *
 * @param {object} args
 * @param {{id: string, contentId: string}} args.session
 * @param {number} args.index
 * @param {string} [args.text]              — texto de la oración para fallback TTS
 * @param {object} [args.manifest]          — output normalizado de manifestAdapter
 * @param {string} [args.userId]            — para header x-user-id en /api/tts
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.fetchImpl]       — default: globalThis.fetch
 * @param {(sessionId: string, url: string) => void} [args.onObjectUrlCreated]
 *
 * @returns {Promise<
 *   | { ok: true,  src: string, source: 'manifest' | 'tts' }
 *   | { ok: false, reason: 'invalid_args' | 'no_fetch_impl' | 'aborted'
 *                          | 'manifest_audio_fetch_failed' | 'tts_fetch_failed'
 *                          | 'invalid_audio_response' | 'audio_unavailable',
 *       meta?: object }
 * >}
 */
export async function resolveAudioSrc({
    session, index, text, manifest, userId, signal, fetchImpl, onObjectUrlCreated,
} = {}) {
    if (!session || typeof session.id !== 'string' || session.id.length === 0) {
        return { ok: false, reason: 'invalid_args', meta: { reason: 'missing_session' } };
    }
    if (!Number.isInteger(index) || index < 0) {
        return { ok: false, reason: 'invalid_args', meta: { reason: 'invalid_index' } };
    }
    const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch : null);
    if (!fetcher) {
        return { ok: false, reason: 'no_fetch_impl' };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };

    const sessionId = session.id;

    // ── Cascada 1: manifest hit ────────────────────────────────────────────
    const manifestResult = await tryManifest({
        manifest, index, sessionId, fetcher, signal, onObjectUrlCreated,
    });
    if (manifestResult.ok) return manifestResult;
    if (manifestResult.reason === 'aborted') return manifestResult;
    // Cualquier otra cosa (manifest miss, fetch fail, invalid response):
    // continuamos a TTS.

    // ── Cascada 2: TTS on-demand ───────────────────────────────────────────
    if (typeof text !== 'string' || text.length === 0) {
        return { ok: false, reason: 'audio_unavailable', meta: { reason: 'no_text' } };
    }
    if (typeof userId !== 'string' || userId.length === 0 || userId === 'guest') {
        return { ok: false, reason: 'audio_unavailable', meta: { reason: 'no_user' } };
    }
    return tryTts({ text, userId, sessionId, index, fetcher, signal, onObjectUrlCreated });
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function tryManifest({ manifest, index, sessionId, fetcher, signal, onObjectUrlCreated }) {
    if (!manifest || !manifest.fileByKey || typeof manifest.fileByKey !== 'object') {
        return { ok: false, reason: 'audio_unavailable', meta: { reason: 'no_manifest' } };
    }
    const key = toChunkKey(index);
    const file = manifest.fileByKey[key];
    if (typeof file !== 'string' || file.length === 0) {
        return { ok: false, reason: 'audio_unavailable', meta: { reason: 'no_manifest_entry', key } };
    }
    if (!SAFE_PATH_RE.test(file) || file.includes('..')) {
        return { ok: false, reason: 'invalid_audio_response',
            meta: { reason: 'unsafe_manifest_path', file } };
    }

    const url = MANIFEST_PREFIX + file.replace(/^\/+/, '');
    let res;
    try {
        res = await fetcher(url, { signal });
    } catch (e) {
        if (signal?.aborted || isAbortError(e)) return { ok: false, reason: 'aborted' };
        return { ok: false, reason: 'manifest_audio_fetch_failed',
            meta: { error: e?.message ?? String(e) } };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    if (!res || !res.ok) {
        return { ok: false, reason: 'manifest_audio_fetch_failed',
            meta: { status: res?.status ?? null } };
    }
    const ct = readContentType(res);
    if (typeof ct === 'string' && ct.length > 0 && !ct.startsWith('audio/')) {
        return { ok: false, reason: 'invalid_audio_response',
            meta: { reason: 'wrong_content_type', contentType: ct } };
    }
    let blob;
    try { blob = await res.blob(); }
    catch (e) {
        if (signal?.aborted || isAbortError(e)) return { ok: false, reason: 'aborted' };
        return { ok: false, reason: 'manifest_audio_fetch_failed',
            meta: { error: e?.message ?? String(e) } };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    if (!blob || blob.size === 0) {
        return { ok: false, reason: 'invalid_audio_response',
            meta: { reason: 'empty_blob' } };
    }
    // Sprint M-4.3.1 — diagnostic inspection (ZERO behavior change).
    await _debugInspectBlob({ source: 'manifest', sessionId, index, response: res, blob });
    // Sprint M-4.3.3 — trust-the-bytes: si magic bytes contradicen el blob.type
    // declarado (backend lying, cache stale, middleware buggy), re-wrap con el
    // mime canonical para que HTMLAudioElement use el decoder correcto. Sin
    // detección → pasa-through original.
    blob = await _maybeRewrapBlobByMagic(blob, { source: 'manifest', sessionId, index });
    const objectUrl = URL.createObjectURL(blob);
    if (typeof onObjectUrlCreated === 'function') {
        try { onObjectUrlCreated(sessionId, objectUrl); } catch { /* ignore */ }
    }
    return { ok: true, src: objectUrl, source: 'manifest' };
}

async function tryTts({ text, userId, sessionId, index, fetcher, signal, onObjectUrlCreated }) {
    let res;
    try {
        res = await fetcher(TTS_ENDPOINT, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
            body:    JSON.stringify({ text }),
            signal,
        });
    } catch (e) {
        if (signal?.aborted || isAbortError(e)) return { ok: false, reason: 'aborted' };
        return { ok: false, reason: 'tts_fetch_failed',
            meta: { error: e?.message ?? String(e) } };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    if (!res || !res.ok) {
        return { ok: false, reason: 'tts_fetch_failed',
            meta: { status: res?.status ?? null } };
    }
    const ct = readContentType(res);
    if (typeof ct === 'string' && ct.length > 0 && !ct.startsWith('audio/')) {
        return { ok: false, reason: 'invalid_audio_response',
            meta: { reason: 'wrong_content_type', contentType: ct } };
    }
    let blob;
    try { blob = await res.blob(); }
    catch (e) {
        if (signal?.aborted || isAbortError(e)) return { ok: false, reason: 'aborted' };
        return { ok: false, reason: 'tts_fetch_failed',
            meta: { error: e?.message ?? String(e) } };
    }
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    if (!blob || blob.size === 0) {
        return { ok: false, reason: 'invalid_audio_response',
            meta: { reason: 'empty_blob' } };
    }
    // Sprint M-4.3.1 — diagnostic inspection (ZERO behavior change).
    await _debugInspectBlob({ source: 'tts', sessionId, index, response: res, blob });
    // Sprint M-4.3.3 — trust-the-bytes (mismo principio que tryManifest).
    blob = await _maybeRewrapBlobByMagic(blob, { source: 'tts', sessionId, index });
    const objectUrl = URL.createObjectURL(blob);
    if (typeof onObjectUrlCreated === 'function') {
        try { onObjectUrlCreated(sessionId, objectUrl); } catch { /* ignore */ }
    }
    return { ok: true, src: objectUrl, source: 'tts' };
}

function toChunkKey(index) {
    return String(index).padStart(4, '0');
}

function readContentType(res) {
    if (!res || !res.headers) return '';
    if (typeof res.headers.get === 'function') {
        return res.headers.get('content-type') ?? '';
    }
    // Plain object fallback.
    return res.headers['content-type'] ?? '';
}

function isAbortError(e) {
    return e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
}

/**
 * _debugInspectBlob — Sprint M-4.3.1 — diagnostic ONLY. ZERO behavior change.
 *
 * Inspecciona el blob ANTES de URL.createObjectURL para identificar root cause
 * de src_not_supported. Lee response.status + content-type header + blob.type
 * + blob.size + primeros 256 bytes (magic byte sniff) + utf-8 preview si los
 * bytes parecen texto.
 *
 * Emite [AUDIO_DEBUG] blob.inspect con shape:
 *   {
 *     source: 'manifest' | 'tts',
 *     sessionId, index,
 *     responseStatus,           // 200 | 404 | ...
 *     responseContentType,      // 'audio/mpeg' | 'text/html' | '' | ...
 *     blobType,                 // mime que el Blob almacenó (deriva del CT)
 *     blobSize,                 // bytes
 *     firstBytes,               // Array<number> primeros 32
 *     magicGuess,               // 'mp3_with_id3' | 'mp3_frame_sync' | 'wav_riff'
 *                               // | 'ogg' | 'flac' | 'html_or_xml'
 *                               // | 'json_or_array' | 'ascii_text' | 'unknown'
 *     utf8Preview,              // string|null — si los bytes parecen texto
 *   }
 *
 * Si lectura falla por cualquier razón, emite [AUDIO_DEBUG] blob.inspect.failed
 * sin interrumpir el flujo. SIN throws, SIN side effects sobre el blob (slice
 * es read-only y devuelve un Blob nuevo — el original sigue intacto).
 */
async function _debugInspectBlob({ source, sessionId, index, response, blob }) {
    if (typeof console === 'undefined' || typeof console.log !== 'function') return;
    try {
        const responseStatus      = response?.status ?? null;
        const responseContentType = readContentType(response);
        const blobType            = blob?.type ?? null;
        const blobSize            = blob?.size ?? null;
        let firstBytes  = null;
        let magicGuess  = 'unknown';
        let utf8Preview = null;
        if (blob && typeof blob.slice === 'function' && typeof blob.arrayBuffer === 'function'
            && blobSize > 0) {
            const peekSize    = Math.min(blobSize, 256);
            const sliceBuffer = await blob.slice(0, peekSize).arrayBuffer();
            const bytes       = new Uint8Array(sliceBuffer);
            firstBytes = Array.from(bytes.slice(0, 32));
            // Magic byte classification (estándares well-known).
            //   ID3v2 tag        → 'ID3' (0x49 0x44 0x33)         → mp3 con metadata
            //   MPEG frame sync  → 0xFF + (0xE0 mask in byte 2)   → mp3 raw frames
            //   RIFF header      → 'RIFF' (0x52 0x49 0x46 0x46)   → wav
            //   Ogg              → 'OggS' (0x4F 0x67 0x67 0x53)
            //   FLAC             → 'fLaC' (0x66 0x4C 0x61 0x43)
            //   HTML/XML         → '<'   (0x3C)
            //   JSON             → '{' o '[' (0x7B / 0x5B)
            if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
                magicGuess = 'mp3_with_id3';
            } else if (bytes.length >= 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
                magicGuess = 'mp3_frame_sync';
            } else if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
                magicGuess = 'wav_riff';
            } else if (bytes.length >= 4 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
                magicGuess = 'ogg';
            } else if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
                magicGuess = 'flac';
            } else if (bytes.length >= 1 && bytes[0] === 0x3C) {
                magicGuess = 'html_or_xml';
            } else if (bytes.length >= 1 && (bytes[0] === 0x7B || bytes[0] === 0x5B)) {
                magicGuess = 'json_or_array';
            } else if (bytes.length >= 4 && Array.from(bytes.slice(0, 16)).every(b => b >= 0x20 && b < 0x7F)) {
                magicGuess = 'ascii_text';
            }
            // utf-8 preview si los bytes parecen texto (sirve para detectar
            // 404 HTML pages, error JSON, base64 raw, etc.).
            if ((magicGuess === 'html_or_xml' || magicGuess === 'json_or_array'
                 || magicGuess === 'ascii_text') && typeof TextDecoder !== 'undefined') {
                try {
                    const td = new TextDecoder('utf-8', { fatal: false });
                    utf8Preview = td.decode(sliceBuffer).slice(0, 200);
                } catch { /* ignore */ }
            }
        }
        // eslint-disable-next-line no-console
        console.log('[AUDIO_DEBUG] blob.inspect', {
            source, sessionId, index,
            responseStatus, responseContentType,
            blobType, blobSize,
            firstBytes, magicGuess,
            utf8Preview,
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[AUDIO_DEBUG] blob.inspect.failed', {
            source, sessionId, index,
            error: err?.message ?? String(err),
        });
    }
}

/**
 * _sniffAudioMime — Sprint M-4.3.3 — derivación canónica de mime desde magic bytes.
 *
 * Lee primeros bytes del blob y devuelve el mime canónico que el browser
 * efectivamente puede decodificar, o null si los bytes no matchean ningún
 * formato conocido. Defensa contra backend que declara mime incorrecto o
 * cache stale que sirve respuesta vieja con header obsoleto.
 *
 * Tabla de magic bytes (estándares well-known):
 *   ID3 ('ID3')                    → audio/mpeg
 *   MPEG sync (0xFF + 0xEx high)   → audio/mpeg
 *   RIFF/WAVE                      → audio/wav
 *   OggS                           → audio/ogg
 *   fLaC                           → audio/flac
 *   ftyp...mp4a / 'M4A '           → audio/mp4
 *
 * PURO. No muta el blob (blob.slice devuelve copia read-only). Async porque
 * blob.arrayBuffer() es async.
 */
async function _sniffAudioMime(blob) {
    if (!blob || typeof blob.slice !== 'function' || typeof blob.arrayBuffer !== 'function') {
        return null;
    }
    const size = blob.size;
    if (typeof size !== 'number' || size < 4) return null;
    let head;
    try {
        head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    } catch { return null; }
    if (head.length < 4) return null;
    // ID3v2 tag at start → mp3
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'audio/mpeg';
    // MPEG frame sync: byte 0 = 0xFF, byte 1 top 3 bits = 111
    if (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0) return 'audio/mpeg';
    // RIFF/WAVE: 'RIFF' + 4 size bytes + 'WAVE'
    if (head.length >= 12
        && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
        && head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45) {
        return 'audio/wav';
    }
    // OggS (Ogg container — vorbis/opus)
    if (head[0] === 0x4F && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return 'audio/ogg';
    // fLaC native FLAC
    if (head[0] === 0x66 && head[1] === 0x4C && head[2] === 0x61 && head[3] === 0x43) return 'audio/flac';
    // ISO base media / MP4 audio container: bytes 4..7 = 'ftyp'
    if (head.length >= 8
        && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
        return 'audio/mp4';
    }
    return null;
}

/**
 * _maybeRewrapBlobByMagic — Sprint M-4.3.3 — defensive trust-the-bytes.
 *
 * Si magic bytes detectables contradicen blob.type declarado, devuelve un
 * Blob NUEVO con el mime canonical derivado de los bytes (mismo body, type
 * corregido). Si los magic bytes no son detectables, o coinciden con blob.type
 * actual, devuelve el blob original sin cambios.
 *
 * Sirve como defensa estructural contra:
 *   - Backend que declara mime incorrecto (Gemini PCM como audio/mpeg)
 *   - Browser cache stale (response vieja con header obsoleto)
 *   - Middleware buggy que reescribe Content-Type
 *
 * Comportamiento idempotente: si el blob ya tiene el mime correcto, no-op.
 * Sin throws — falla silenciosa devuelve blob original (mejor que romper play).
 *
 * Emite [AUDIO_DEBUG] mime.rewrapped cuando hace el swap, para visibilidad.
 */
async function _maybeRewrapBlobByMagic(blob, ctx) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return blob;
    const detected = await _sniffAudioMime(blob);
    if (!detected) return blob;                            // no detectable → trust original
    const current = typeof blob.type === 'string' ? blob.type : '';
    if (current === detected) return blob;                 // ya correcto → no-op
    // Rewrap: leer todos los bytes y reconstruir Blob con type canonical.
    let buf;
    try { buf = await blob.arrayBuffer(); }
    catch { return blob; }                                 // lectura falla → trust original
    const newBlob = new Blob([buf], { type: detected });
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
        // eslint-disable-next-line no-console
        console.log('[AUDIO_DEBUG] mime.rewrapped', {
            source:        ctx?.source ?? null,
            sessionId:     ctx?.sessionId ?? null,
            index:         ctx?.index ?? null,
            previousType:  current || '(empty)',
            canonicalType: detected,
            blobSize:      blob.size,
        });
    }
    return newBlob;
}

/**
 * isAutoplayBlocked — heurística para identificar el error que el browser
 * arroja cuando audio.play() es rechazado por la autoplay policy.
 *
 * Exportado para que el AudioRuntime (o el viewer) pueda distinguir
 * `audio_autoplay_blocked` de `audio_contract_failed` genérico.
 */
export function isAutoplayBlocked(err) {
    if (!err) return false;
    if (err.name === 'NotAllowedError') return true;
    // Algunos browsers usan otro código pero mensaje contiene "autoplay" o
    // "user activation". Defensivo:
    const msg = (err.message ?? '').toLowerCase();
    if (msg.includes('autoplay') || msg.includes('user activation')) return true;
    return false;
}

/**
 * mediaErrorToReason — traduce un MediaError (audio.error tras evento
 * 'error') a una `reason` discriminada que ImmersiveSession.runAction
 * mapea a kind del SessionError.
 *
 * Mapeo:
 *   MediaError.MEDIA_ERR_ABORTED (1)           → 'aborted'
 *   MediaError.MEDIA_ERR_NETWORK (2)           → 'network_failure'
 *   MediaError.MEDIA_ERR_DECODE (3)            → 'decode_failed'
 *   MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED (4) → 'src_not_supported'
 *   otros / null                               → 'unknown'
 *
 * El integrator usa esto en su onError callback antes de dispatch:
 *   onError: (sid, idx, err) => runtime.dispatch({
 *     kind: 'audioFailed', index: idx, reason: mediaErrorToReason(err)
 *   })
 *
 * `_audioFailed` mapea reason='decode_failed' → kind='audio_decode_failed'.
 */
export function mediaErrorToReason(err) {
    if (!err || typeof err !== 'object') return 'unknown';
    const code = Number(err.code);
    if (code === 1) return 'aborted';
    if (code === 2) return 'network_failure';
    if (code === 3) return 'decode_failed';
    if (code === 4) return 'src_not_supported';
    return 'unknown';
}
