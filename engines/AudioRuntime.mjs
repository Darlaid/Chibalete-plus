/**
 * AudioRuntime.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Adaptador de audio del runtime. NO depende de HTMLAudioElement directo:
 * recibe un `audioFactory` que produce objetos con la interfaz mínima
 * { play, pause, src, currentTime }. En producción el factory crea
 * `new Audio()`; en tests el factory devuelve un fake controlado.
 *
 * Responsabilidades:
 *   - mount(container)              — opcional; algunos backends necesitan
 *                                     estar attachados al DOM. Default: no-op.
 *   - unmount()                     — cleanup permanente del runtime.
 *   - preflight(session, index)     — verifica que el clip está disponible
 *                                     ANTES de iniciar reproducción. Async.
 *   - startPlayback(session, index) — inicia reproducción. Async.
 *   - pause()                       — pausa el clip activo.
 *   - releaseFor(session)           — libera todo lo asociado a esta sesión:
 *                                     pausa, libera blobs, limpia callbacks.
 *   - isFailedFor(session, index)   — query síncrona del estado de fallo
 *                                     del último intento sobre (session,index).
 *
 * Garantías:
 *   - Ningún side effect cross-session: releaseFor(s) no afecta otras sesiones.
 *   - Failures se memoizan por (sessionId, index) para que el clasificador
 *     pueda decidir audio_unavailable sin reintentar.
 *   - El audio activo se rastrea internamente — pause() afecta solo al activo.
 */

/**
 * Sprint M-3.2 — heurística inline para detectar autoplay policy reject.
 * Inlined (no importada) para mantener AudioRuntime independiente de
 * utils/immersiveV2/. La misma heurística está en audioAdapter.mjs como
 * helper público para uso del viewer; aquí la duplicamos a propósito.
 */
function isAutoplayBlocked(err) {
    if (!err) return false;
    if (err.name === 'NotAllowedError') return true;
    const msg = String(err.message ?? '').toLowerCase();
    return msg.includes('autoplay') || msg.includes('user activation');
}

const NULL_FACTORY = () => ({
    play: async () => {},
    pause: () => {},
    set src(v) {},
    get src() { return ''; },
    get currentTime() { return 0; },
    set currentTime(v) {},
});

// M-4.3.4 — readyState canonical thresholds del HTMLMediaElement.
// HAVE_NOTHING (0), HAVE_METADATA (1), HAVE_CURRENT_DATA (2),
// HAVE_FUTURE_DATA (3), HAVE_ENOUGH_DATA (4).
const READY_STATE_HAVE_CURRENT_DATA = 2;
const WAIT_CANPLAY_TIMEOUT_MS       = 4000;

/**
 * _waitForCanPlay — Sprint M-4.3.4 — defensive gating contra premature-play
 * AbortError en Chrome.
 *
 * Cuando el flujo de startPlayback hace `audio.src = src` seguido inmediato
 * por `await audio.play()`, Chrome a veces rechaza con AbortError porque el
 * load todavía no completó. La solución es esperar hasta readyState >=
 * HAVE_CURRENT_DATA (2) o el event 'canplay' antes de invocar play().
 *
 * Mock-safe: si `typeof audio.readyState !== 'number'` (el mock no expone
 * la propiedad), skip-eamos el wait inmediatamente → tests pre-M-4.3.4
 * siguen pasando sin modificación.
 *
 * Si el audio ya está ready (readyState >= 2 al momento de invocación),
 * retornamos OK sin esperar — fast path.
 *
 * Timeout: 4000ms. Tras timeout, retornamos { ok: true, reason: 'timeout' }
 * para que el caller proceda con play() de todos modos (defensive — quizás
 * el browser ya está listo y canplay simplemente no disparó). El diagnostic
 * 'audio.acquire.wait_ready_timeout' visibiliza el caso.
 */
async function _waitForCanPlay(audio, sessionId, contentId, index, diagFn) {
    // Mock skip: si no hay readyState numeric (tests, NULL_FACTORY), no esperamos.
    if (!audio || typeof audio.readyState !== 'number') return { ok: true, skipped: true };
    if (audio.readyState >= READY_STATE_HAVE_CURRENT_DATA) {
        return { ok: true, fastPath: true, readyState: audio.readyState };
    }
    if (typeof audio.addEventListener !== 'function') return { ok: true, skipped: true };
    diagFn('audio.acquire.wait_ready_start', sessionId, contentId, {
        index,
        readyState:   audio.readyState,
        networkState: typeof audio.networkState === 'number' ? audio.networkState : null,
        timeoutMs:    WAIT_CANPLAY_TIMEOUT_MS,
    });
    return new Promise((resolve) => {
        let done = false;
        const finish = (outcome) => {
            if (done) return;
            done = true;
            try { audio.removeEventListener('canplay',     onCanPlay); }   catch { /* ignore */ }
            try { audio.removeEventListener('loadeddata',  onLoadedData); } catch { /* ignore */ }
            try { audio.removeEventListener('error',       onError); }      catch { /* ignore */ }
            clearTimeout(timer);
            resolve(outcome);
        };
        const onCanPlay = () => {
            diagFn('audio.acquire.wait_ready_resolved', sessionId, contentId, {
                index, source: 'canplay_event',
                readyState: typeof audio.readyState === 'number' ? audio.readyState : null,
            });
            finish({ ok: true, source: 'canplay_event' });
        };
        const onLoadedData = () => {
            // Algunas implementaciones llegan a HAVE_CURRENT_DATA via 'loadeddata'
            // antes de canplay. Aceptamos ambos como señal de listo.
            if (audio.readyState >= READY_STATE_HAVE_CURRENT_DATA) {
                diagFn('audio.acquire.wait_ready_resolved', sessionId, contentId, {
                    index, source: 'loadeddata_event',
                    readyState: audio.readyState,
                });
                finish({ ok: true, source: 'loadeddata_event' });
            }
        };
        const onError = () => {
            // Si el media element dispara 'error' durante el wait, abortamos —
            // play() habría rechazado igual, mejor cortar acá con diagnostic.
            finish({
                ok: false,
                reason: 'load_failed_before_play',
                mediaErrorCode:    audio.error?.code    ?? null,
                mediaErrorMessage: audio.error?.message ?? null,
            });
        };
        try { audio.addEventListener('canplay',    onCanPlay,    { once: true }); } catch { /* ignore */ }
        try { audio.addEventListener('loadeddata', onLoadedData, { once: true }); } catch { /* ignore */ }
        try { audio.addEventListener('error',      onError,      { once: true }); } catch { /* ignore */ }
        const timer = setTimeout(() => {
            diagFn('audio.acquire.wait_ready_timeout', sessionId, contentId, {
                index,
                readyState:   typeof audio.readyState === 'number'   ? audio.readyState   : null,
                networkState: typeof audio.networkState === 'number' ? audio.networkState : null,
                timeoutMs:    WAIT_CANPLAY_TIMEOUT_MS,
            });
            // Defensive: proceed con play() aunque haya timeout. Quizás el browser
            // ya está listo pero el event no disparó. Si play() falla, lo veremos
            // como play_rejected con readyState capturado.
            finish({ ok: true, source: 'timeout' });
        }, WAIT_CANPLAY_TIMEOUT_MS);
    });
}

export function createAudioRuntime(opts = {}) {
    const audioFactory  = typeof opts.audioFactory === 'function' ? opts.audioFactory : NULL_FACTORY;
    const resolveSrc    = typeof opts.resolveSrc === 'function'   ? opts.resolveSrc   : null;
    const diagnostics   = opts.diagnostics || null;
    /**
     * Sprint M-3.2 — opcional. Cuando AudioRuntime libera o reemplaza un
     * audio activo (releaseFor, startPlayback con audio nuevo, unmount),
     * invoca audioCleanup(prevAudio) si se proveyó. Útil para que el
     * audioAdapter productivo remueva sus listeners deterministicamente
     * (sin esperar a GC). Sin cleanup, los listeners siguen vivos pero
     * con guards stale-callback que los neutralizan.
     */
    const audioCleanup  = typeof opts.audioCleanup === 'function' ? opts.audioCleanup : null;

    let container = null;
    let mounted   = false;
    /** Audio actualmente activo (si lo hay). */
    let activeAudio = null;
    /** Sesión y índice del audio activo. */
    let activeKey   = null;   // { sessionId, index }
    /** Map<sessionId, Set<`${sessionId}:${index}`>> para releaseFor sweep. */
    const failedKeys = new Map();   // sessionId → Set of `${sessionId}:${index}`

    function diag(kind, sessionId, contentId, data) {
        if (!diagnostics) return;
        diagnostics.log({ kind, sessionId, contentId, data });
    }

    function keyFor(sessionId, index) {
        return `${sessionId}:${index}`;
    }

    function mount(c) {
        if (mounted) return;
        container = c ?? null;
        mounted = true;
    }

    function unmount() {
        // Pausa cualquier audio activo y borra el rastro completo.
        if (activeAudio && typeof activeAudio.pause === 'function') {
            try { activeAudio.pause(); } catch { /* ignore */ }
        }
        // Cleanup de listeners (M-3.2): evita que el audio retenga callbacks
        // adjuntos por el audioAdapter productivo más allá de lo necesario.
        if (audioCleanup && activeAudio) {
            try { audioCleanup(activeAudio); } catch { /* ignore */ }
        }
        activeAudio = null;
        activeKey   = null;
        failedKeys.clear();
        container = null;
        mounted = false;
    }

    /**
     * preflight — verifica que (session, index) tiene un src resolvible y
     * que el audio puede inicializarse. Devuelve { ok: true } o
     * { ok: false, reason }. Caller decide si propagar como audio_unavailable
     * o audio_contract_failed.
     *
     * En tests, resolveSrc() controla outcomes (ok / null / throw).
     *
     * Sprint M-4.3 — emite audio.acquire.* family con granularidad por fase:
     *   request → provider → url|null_url|invalid_url → (caller continúa con startPlayback)
     */
    async function preflight(session, index) {
        const sessionId = session?.id ?? null;
        const contentId = session?.contentId ?? null;
        diag('audio.acquire.request', sessionId, contentId, { index });
        if (!resolveSrc) {
            // Sin resolver explícito, asumimos OK — útil para fakes triviales
            // donde la disponibilidad no se modela.
            diag('audio.preflight.ok', sessionId, contentId, { index });
            return { ok: true };
        }
        diag('audio.acquire.provider', sessionId, contentId, { index, providerKind: 'resolveSrc' });
        try {
            const src = await resolveSrc({ session, index });
            if (src === null || src === undefined) {
                rememberFail(sessionId, index);
                diag('audio.acquire.null_url', sessionId, contentId, { index, src });
                diag('audio.preflight.fail', sessionId, contentId, { index, reason: 'no_src' });
                return { ok: false, reason: 'no_src' };
            }
            if (typeof src !== 'string' || src.length === 0) {
                rememberFail(sessionId, index);
                diag('audio.acquire.invalid_url', sessionId, contentId, {
                    index, srcType: typeof src, srcLength: typeof src === 'string' ? src.length : null,
                });
                diag('audio.preflight.fail', sessionId, contentId, { index, reason: 'no_src' });
                return { ok: false, reason: 'no_src' };
            }
            diag('audio.acquire.url', sessionId, contentId, {
                index, src, srcLength: src.length,
                srcPreview: src.length > 80 ? src.slice(0, 80) + '...' : src,
            });
            diag('audio.preflight.ok', sessionId, contentId, { index, src });
            return { ok: true, src };
        } catch (err) {
            rememberFail(sessionId, index);
            diag('audio.acquire.exception', sessionId, contentId, {
                index, phase: 'preflight',
                errorName: err?.name ?? 'Error',
                errorMessage: err?.message ?? String(err),
            });
            diag('audio.preflight.fail', sessionId, contentId, { index, reason: err?.message || 'preflight_throw' });
            return { ok: false, reason: 'preflight_throw' };
        }
    }

    /**
     * startPlayback — crea el audio (vía factory), setea src, llama play().
     * Resuelve cuando play() resolvió (o rechaza con reason si falló).
     *
     * Si ya hay audio activo, lo pausa primero (single audio policy).
     *
     * Sprint M-4.3 — emite audio.acquire.* granular + meta enriquecida:
     *   load_start  → factory devolvió audio + src asignado, antes de play()
     *   canplay     → event 'canplay' del HTMLAudioElement (best-effort, no gate)
     *   play_resolved | play_rejected | exception
     *
     * NOTA SOBRE CANPLAY (invariante propuesta M-4.3, NO gating):
     * Idealmente el caller no debería transitar a 'playing' hasta confirmar
     * canplay. Por ahora canplay se REGISTRA como diagnostic (no gate) para
     * evitar romper tests con mocks que no disparan el event. La gating real
     * queda como deuda explícita post-smoke productivo.
     */
    async function startPlayback(session, index, src) {
        const sessionId = session?.id ?? null;
        const contentId = session?.contentId ?? null;

        // Pausa cualquier audio activo antes de iniciar uno nuevo.
        if (activeAudio && typeof activeAudio.pause === 'function') {
            try { activeAudio.pause(); } catch { /* ignore */ }
            // Cleanup listeners del audio reemplazado (M-3.2).
            if (audioCleanup) {
                try { audioCleanup(activeAudio); } catch { /* ignore */ }
            }
        }
        activeAudio = null;
        activeKey   = null;

        let audio;
        try {
            audio = audioFactory({ container, sessionId, index, src });
        } catch (err) {
            rememberFail(sessionId, index);
            diag('audio.acquire.exception', sessionId, contentId, {
                index, phase: 'factory',
                errorName: err?.name ?? 'Error',
                errorMessage: err?.message ?? String(err),
            });
            diag('audio.preflight.fail', sessionId, contentId, { index, reason: 'factory_throw' });
            return {
                ok: false, reason: 'factory_throw',
                meta: {
                    src, requestedIndex: index, requestedSessionId: sessionId,
                    browserError: err?.message ?? null,
                    playPromiseError: null,
                },
            };
        }
        if (!audio || typeof audio.play !== 'function') {
            rememberFail(sessionId, index);
            diag('audio.acquire.invalid_url', sessionId, contentId, {
                index, reason: 'factory_returned_invalid_audio',
                hasAudio: !!audio,
                hasPlayMethod: !!(audio && typeof audio.play === 'function'),
            });
            diag('audio.preflight.fail', sessionId, contentId, { index, reason: 'factory_invalid' });
            return {
                ok: false, reason: 'factory_invalid',
                meta: { src, requestedIndex: index, requestedSessionId: sessionId },
            };
        }
        if (typeof src === 'string' && src.length > 0) {
            try { audio.src = src; } catch (setErr) {
                diag('audio.acquire.exception', sessionId, contentId, {
                    index, phase: 'set_src',
                    errorName: setErr?.name ?? 'Error',
                    errorMessage: setErr?.message ?? String(setErr),
                });
            }
        }
        // Best-effort diagnostics — todos { once: true }, NO bloquean play().
        // Si el audio object soporta addEventListener (HTMLAudioElement real o
        // mock conformant), capturamos los momentos exactos del lifecycle.
        if (audio && typeof audio.addEventListener === 'function') {
            const safeAdd = (eventName, handler) => {
                try { audio.addEventListener(eventName, handler, { once: true }); }
                catch { /* ignore */ }
            };
            const snapshotMediaState = () => ({
                readyState:   typeof audio.readyState   === 'number' ? audio.readyState   : null,
                networkState: typeof audio.networkState === 'number' ? audio.networkState : null,
            });
            safeAdd('canplay', () => {
                diag('audio.acquire.canplay', sessionId, contentId, { index, ...snapshotMediaState() });
            });
            // M-4.3.2 — eventos adicionales del HTMLMediaElement standard.
            safeAdd('loadedmetadata', () => {
                diag('audio.acquire.loadedmetadata', sessionId, contentId, {
                    index,
                    duration: typeof audio.duration === 'number' ? audio.duration : null,
                    ...snapshotMediaState(),
                });
            });
            safeAdd('canplaythrough', () => {
                // HAVE_ENOUGH_DATA: el decode completó suficiente buffer para
                // reproducir sin pausa. Señal de éxito del decode pipeline.
                diag('audio.acquire.decode_ready', sessionId, contentId, { index, ...snapshotMediaState() });
            });
            safeAdd('error', () => {
                // Event 'error' del media element post-load = decode failure
                // (formato inválido, src corrupta, network mid-stream). Distinto
                // de play_rejected (rechazo del play() Promise).
                const mediaErr = audio.error || null;
                diag('audio.acquire.decode_failed', sessionId, contentId, {
                    index,
                    mediaErrorCode:    mediaErr?.code    ?? null,
                    mediaErrorMessage: mediaErr?.message ?? null,
                    ...snapshotMediaState(),
                });
            });
        }
        diag('audio.acquire.load_start', sessionId, contentId, {
            index, src,
            srcPreview:   typeof src === 'string' && src.length > 80 ? src.slice(0, 80) + '...' : src,
            readyState:   typeof audio.readyState === 'number'    ? audio.readyState    : null,
            networkState: typeof audio.networkState === 'number'  ? audio.networkState  : null,
        });
        // Sprint M-4.3.4 — defensive canplay gating contra premature-play AbortError.
        // Mock-safe: si audio.readyState no es numeric (tests), skip inmediato.
        // Fast path: si ya >= HAVE_CURRENT_DATA, proceed sin esperar.
        // Real browsers: espera canplay/loadeddata o timeout 4000ms (defensive proceed).
        const waitResult = await _waitForCanPlay(audio, sessionId, contentId, index, diag);
        if (!waitResult.ok) {
            // Solo entra acá si el media element disparó 'error' durante el wait.
            rememberFail(sessionId, index);
            diag('audio.acquire.play_rejected', sessionId, contentId, {
                index, reason: 'load_failed_before_play',
                phase: 'wait_canplay',
                mediaErrorCode:    waitResult.mediaErrorCode    ?? null,
                mediaErrorMessage: waitResult.mediaErrorMessage ?? null,
                readyState:        typeof audio.readyState   === 'number' ? audio.readyState   : null,
                networkState:      typeof audio.networkState === 'number' ? audio.networkState : null,
            });
            diag('audio.preflight.fail', sessionId, contentId, { index, reason: 'load_failed_before_play' });
            if (audioCleanup) { try { audioCleanup(audio); } catch { /* ignore */ } }
            return {
                ok: false, reason: 'play_rejected',
                meta: {
                    src, requestedIndex: index, requestedSessionId: sessionId,
                    browserError:     waitResult.mediaErrorMessage ?? null,
                    playPromiseError: null,
                    readyState:       typeof audio.readyState   === 'number' ? audio.readyState   : null,
                    networkState:     typeof audio.networkState === 'number' ? audio.networkState : null,
                    waitPhase:        'pre_play',
                },
            };
        }
        const playStartTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        try {
            await audio.play();
        } catch (err) {
            rememberFail(sessionId, index);
            const playEndTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            // Sprint M-3.2 — distinguir autoplay policy vs error genérico.
            // El runtime mapea reason='autoplay_blocked' a kind='audio_autoplay_blocked'.
            // Sprint M-4.3.4 — enrich diagnostic con err.code, errorConstructor,
            // currentSrc (vs src asignado), audio.error al momento de reject,
            // y timing del play() — para discriminar AbortError vs NotAllowed
            // vs NotSupported sin ambigüedad.
            const reason = isAutoplayBlocked(err) ? 'autoplay_blocked' : 'play_rejected';
            const mediaErr = audio.error || null;
            diag('audio.acquire.play_rejected', sessionId, contentId, {
                index, reason,
                errorName:         err?.name    ?? 'Error',
                errorMessage:      err?.message ?? String(err),
                errorCode:         typeof err?.code === 'number' ? err.code : null,
                errorConstructor:  err?.constructor?.name ?? null,
                isAutoplayBlocked: reason === 'autoplay_blocked',
                isAbortError:      err?.name === 'AbortError',
                isNotSupported:    err?.name === 'NotSupportedError',
                readyState:        typeof audio.readyState   === 'number' ? audio.readyState   : null,
                networkState:      typeof audio.networkState === 'number' ? audio.networkState : null,
                paused:            typeof audio.paused === 'boolean' ? audio.paused : null,
                ended:             typeof audio.ended === 'boolean' ? audio.ended : null,
                duration:          typeof audio.duration === 'number' ? audio.duration : null,
                currentTime:       typeof audio.currentTime === 'number' ? audio.currentTime : null,
                currentSrc:        typeof audio.currentSrc === 'string' ? audio.currentSrc : null,
                srcMatchesAssigned: typeof audio.currentSrc === 'string' && audio.currentSrc === src,
                mediaErrorCode:    mediaErr?.code    ?? null,
                mediaErrorMessage: mediaErr?.message ?? null,
                playDurationMs:    Math.round(playEndTs - playStartTs),
                waitSource:        waitResult.source ?? null,
            });
            diag('audio.preflight.fail', sessionId, contentId, { index, reason });
            // Cleanup del audio que falló: NO quedará activo, así que sus
            // listeners deben removerse para que GC pueda recolectarlo.
            if (audioCleanup) {
                try { audioCleanup(audio); } catch { /* ignore */ }
            }
            return {
                ok: false, reason,
                meta: {
                    src, requestedIndex: index, requestedSessionId: sessionId,
                    browserError:     null,
                    playPromiseError: err?.message ?? null,
                    errorName:        err?.name    ?? 'Error',
                    isAbortError:     err?.name === 'AbortError',
                    readyState:       typeof audio.readyState   === 'number' ? audio.readyState   : null,
                    networkState:     typeof audio.networkState === 'number' ? audio.networkState : null,
                    waitSource:       waitResult.source ?? null,
                },
            };
        }
        activeAudio = audio;
        activeKey   = { sessionId, index };
        diag('audio.acquire.play_resolved', sessionId, contentId, {
            index,
            readyState:   typeof audio.readyState === 'number'   ? audio.readyState   : null,
            networkState: typeof audio.networkState === 'number' ? audio.networkState : null,
        });
        diag('audio.start', sessionId, contentId, { index });
        return {
            ok: true,
            meta: { src, requestedIndex: index, requestedSessionId: sessionId },
        };
    }

    function pause() {
        if (!activeAudio || typeof activeAudio.pause !== 'function') return;
        try { activeAudio.pause(); } catch { /* ignore */ }
        if (activeKey) {
            diag('audio.pause', activeKey.sessionId, null, { index: activeKey.index });
        }
    }

    /**
     * Libera todo lo asociado a `session`. Pausa el audio si está activo
     * para esa sesión, y borra el set de fallos. NO afecta otras sesiones.
     */
    function releaseFor(session) {
        const sessionId = session?.id ?? null;
        if (sessionId === null) return;
        if (activeKey && activeKey.sessionId === sessionId) {
            try { activeAudio?.pause?.(); } catch { /* ignore */ }
            // Cleanup listeners del audio liberado (M-3.2).
            if (audioCleanup && activeAudio) {
                try { audioCleanup(activeAudio); } catch { /* ignore */ }
            }
            activeAudio = null;
            activeKey   = null;
        }
        failedKeys.delete(sessionId);
        diag('audio.released', sessionId, session?.contentId ?? null);
    }

    function isFailedFor(session, index) {
        const sessionId = session?.id ?? null;
        if (sessionId === null) return false;
        const set = failedKeys.get(sessionId);
        if (!set) return false;
        return set.has(keyFor(sessionId, index));
    }

    function rememberFail(sessionId, index) {
        if (sessionId === null) return;
        if (!failedKeys.has(sessionId)) failedKeys.set(sessionId, new Set());
        failedKeys.get(sessionId).add(keyFor(sessionId, index));
    }

    /**
     * getDebugState — Sprint M-4.2 — diagnostics-only read-only getter.
     *
     * Devuelve snapshot frozen del estado interno del audio runtime. NO muta
     * nada. Su único consumidor previsto es ImmersiveSession.publishSnapshot
     * para enriquecer el snapshot expuesto por runtime.getSnapshot().
     *
     * Forma:
     *   {
     *     state:            'idle' | 'playing'   — derivado de activeAudio
     *     urlLoaded:        bool                  — activeAudio?.src truthy
     *     activeSessionId:  string | null
     *     activeIndex:      number | null
     *     failedSessionsCount: number             — sólo para forensic
     *   }
     */
    function getDebugState() {
        const hasActive = !!activeAudio;
        const src       = hasActive
            ? (typeof activeAudio.src === 'string' ? activeAudio.src : null)
            : null;
        return Object.freeze({
            state:               hasActive ? 'playing' : 'idle',
            urlLoaded:           typeof src === 'string' && src.length > 0,
            activeSessionId:     activeKey?.sessionId ?? null,
            activeIndex:         activeKey?.index ?? null,
            failedSessionsCount: failedKeys.size,
        });
    }

    return Object.freeze({
        mount, unmount,
        preflight, startPlayback, pause,
        releaseFor, isFailedFor,
        getDebugState,
    });
}
