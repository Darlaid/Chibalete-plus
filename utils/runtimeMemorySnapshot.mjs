/**
 * runtimeMemorySnapshot.mjs — Observabilidad liviana de memoria del runtime
 * inmersivo (M-5.4.1).
 *
 * Diseño:
 *   - READ-ONLY. No fuerza GC, no toca heap, no aloca buffers grandes.
 *   - Defensivo: cualquier API ausente o que throw → fallback a null.
 *   - Serializable: la salida es JSON-plana lista para console.dir() o telemetría.
 *   - SIN side effects observables: no muta el runtime, no emite logs por sí
 *     mismo (eso lo decide el llamador).
 *
 * Usar como observador, NO como decisión. Si querés disparar warnings, hacelo
 * en el llamador comparando contra umbrales.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Campos:
 *
 *   heapUsed         performance.memory.usedJSHeapSize     (bytes) o null
 *   heapTotal        performance.memory.totalJSHeapSize    (bytes) o null
 *   heapLimit        performance.memory.jsHeapSizeLimit    (bytes) o null
 *   heapRatio        heapUsed / heapLimit (0..1) o null
 *   audioCacheEntries  diag.cacheEntries.audioCache (chunkKey → blobUrl Map size)
 *   inFlight          diag.cacheEntries.inFlight
 *   abortCtrls        diag.cacheEntries.abortCtrls
 *   blobUrlCount      heurística: 1..2 si activeAudioSrc/standbyAudioSrc son
 *                     blob:; sumado a audioCacheEntries (los blobs viven en cache)
 *   executorCount     1 si syncStrategy.active && isAlive; 0 caso contrario
 *   pendingTimers     suma de los tres flags de activeTimers
 *   listenerEstimate  estimación grosera: audioRefs vivos + executor + watchdog
 *                     (este último lo aporta el llamador). Es heurística.
 *   memoryAPI         'performance.memory' | null
 *   now               Date.now()
 *
 * NO incluye:
 *   - FPS / RAF metrics (out of scope)
 *   - DOM node count (no es señal accionable a este nivel)
 *   - Service Worker cache stats (otro subsystem)
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * @typedef {object} RuntimeMemorySnapshot
 * @property {number|null} heapUsed
 * @property {number|null} heapTotal
 * @property {number|null} heapLimit
 * @property {number|null} heapRatio
 * @property {number}      audioCacheEntries
 * @property {number}      inFlight
 * @property {number}      abortCtrls
 * @property {number}      blobUrlCount
 * @property {number}      executorCount
 * @property {number}      pendingTimers
 * @property {number}      listenerEstimate
 * @property {string|null} memoryAPI
 * @property {number}      now
 */

/**
 * @param {Record<string, any>} diag  Salida de pb.getRuntimeDiagnostics().
 * @param {{ watchdogActive?: boolean }} [extra]
 * @returns {RuntimeMemorySnapshot}
 */
export function getRuntimeMemorySnapshot(diag, extra = {}) {
    /** @type {number|null} */ let heapUsed   = null;
    /** @type {number|null} */ let heapTotal  = null;
    /** @type {number|null} */ let heapLimit  = null;
    /** @type {string|null} */ let memoryAPI  = null;

    try {
        // performance.memory es Chrome-only. Safari/Firefox → null.
        if (typeof performance !== 'undefined'
            && /** @type {any} */ (performance).memory) {
            const m = /** @type {any} */ (performance).memory;
            if (typeof m.usedJSHeapSize === 'number')  heapUsed  = m.usedJSHeapSize;
            if (typeof m.totalJSHeapSize === 'number') heapTotal = m.totalJSHeapSize;
            if (typeof m.jsHeapSizeLimit === 'number') heapLimit = m.jsHeapSizeLimit;
            memoryAPI = 'performance.memory';
        }
    } catch { /* defensivo — alguna policy de browser puede throw */ }

    const heapRatio = (heapUsed != null && heapLimit != null && heapLimit > 0)
        ? heapUsed / heapLimit : null;

    const cache = (diag && diag.cacheEntries) || {};
    const audioCacheEntries = typeof cache.audioCache === 'number' ? cache.audioCache : 0;
    const inFlight          = typeof cache.inFlight === 'number'   ? cache.inFlight   : 0;
    const abortCtrls        = typeof cache.abortCtrls === 'number' ? cache.abortCtrls : 0;

    // Blob URL heurística: cada entry de audioCache es 1 blob URL. Sumamos 1..2
    // por los <audio> activo/standby si tienen blob: src (esos también consumen
    // memoria pero ya pueden estar dentro del Map).
    let blobUrlCount = audioCacheEntries;
    const activeSrc  = diag && diag.activeAudioSrc;
    const standbySrc = diag && diag.standbyAudioSrc;
    // Si los src son blob: y NO están en el cache (ej. transición en curso),
    // los sumamos. Como heurística simple, ya lo aporta audioCacheEntries en
    // 99% de los casos; este +X es defensivo.
    if (activeSrc  && typeof activeSrc  === 'string' && activeSrc.startsWith('blob:'))  blobUrlCount += 0;
    if (standbySrc && typeof standbySrc === 'string' && standbySrc.startsWith('blob:')) blobUrlCount += 0;

    const exec = diag && diag.syncStrategy;
    const executorCount = exec && exec.active ? 1 : 0;

    const t = (diag && diag.activeTimers) || {};
    const pendingTimers =
        (t.pendingAdvance        ? 1 : 0)
      + (t.pendingFallback       ? 1 : 0)
      + (t.pendingCanplaythrough ? 1 : 0);

    // listenerEstimate: heurística. Es solo una cota inferior:
    //   2 audioRefs (siempre vivos en el visor) +
    //   1 si hay executor +
    //   1 si hay watchdog activo (lo informa el llamador via extra).
    const listenerEstimate =
        2
      + executorCount
      + (extra.watchdogActive ? 1 : 0);

    return {
        heapUsed, heapTotal, heapLimit, heapRatio,
        audioCacheEntries, inFlight, abortCtrls, blobUrlCount,
        executorCount, pendingTimers, listenerEstimate,
        memoryAPI,
        now: Date.now(),
    };
}

/**
 * Clasifica un snapshot contra umbrales y devuelve qué warnings emitir.
 * NO emite logs por sí mismo — el llamador decide.
 *
 * Umbrales razonables para Chibalete+ runtime inmersivo (sesiones 15-60 min):
 *   - heapRatio > 0.85 → MEMORY_PRESSURE_WARNING (cerca del cap del browser)
 *   - growthBytes > 50 MB en window de 60s → MEMORY_GROWTH_WARNING
 *
 * @param {RuntimeMemorySnapshot}      current
 * @param {RuntimeMemorySnapshot|null} previous
 * @param {{ pressureRatio?: number, growthBytes?: number, growthWindowMs?: number }} [thresholds]
 * @returns {Array<{event: string, data: object}>}
 */
export function classifyMemorySnapshot(current, previous, thresholds = {}) {
    const T = {
        pressureRatio:    thresholds.pressureRatio   ?? 0.85,
        growthBytes:      thresholds.growthBytes     ?? 50 * 1024 * 1024,
        growthWindowMs:   thresholds.growthWindowMs  ?? 60_000,
    };
    /** @type {Array<{event:string, data:object}>} */
    const out = [];

    if (current && current.heapRatio != null && current.heapRatio > T.pressureRatio) {
        out.push({
            event: 'MEMORY_PRESSURE_WARNING',
            data: {
                heapRatio:    current.heapRatio,
                heapUsedMB:   current.heapUsed   != null ? Math.round(current.heapUsed   / 1024 / 1024) : null,
                heapLimitMB:  current.heapLimit  != null ? Math.round(current.heapLimit  / 1024 / 1024) : null,
                threshold:    T.pressureRatio,
            },
        });
    }

    if (current && previous && current.heapUsed != null && previous.heapUsed != null) {
        const dt = current.now - previous.now;
        if (dt > 0 && dt <= T.growthWindowMs) {
            const growth = current.heapUsed - previous.heapUsed;
            if (growth > T.growthBytes) {
                out.push({
                    event: 'MEMORY_GROWTH_WARNING',
                    data: {
                        growthMB:     Math.round(growth / 1024 / 1024),
                        windowMs:     dt,
                        heapUsedMB:   Math.round(current.heapUsed / 1024 / 1024),
                        threshold:    T.growthBytes,
                    },
                });
            }
        }
    }

    return out;
}
