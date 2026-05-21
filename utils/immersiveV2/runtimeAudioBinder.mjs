/**
 * runtimeAudioBinder.mjs — Sprint Inmersivo V2 / Fase M-3.4.
 *
 * Helper oficial que encapsula el wire-up entre `ImmersiveRuntime` y
 * `audioAdapter` (createBrowserAudioAdapter). Esta lógica antes vivía como
 * boilerplate en cada test/integrator (snapshot subscriber + preload trigger
 * + releaseSession en cierre); ahora tiene un punto único de verdad,
 * documentado y testeado.
 *
 * Responsabilidades:
 *   1. Subscribir a `runtime.subscribe(snapshot)`.
 *   2. Detectar transiciones relevantes:
 *      - sessionId cambió → liberar URLs de la sesión anterior.
 *      - status='closed' (mismo sessionId) → liberar URLs.
 *      - currentIndex cambió → cancelar preloads stale + disparar preload nuevo.
 *      - status='playing' o 'ready' → disparar preload del/los siguientes.
 *      - status='paused' / 'error' / 'closing' / 'closed' → NO disparar preload.
 *   3. Exponer `dispose()` que unsubscribe del runtime.
 *
 * Limitaciones intencionales (M-3.4):
 *   - NO toca React, DOM, ni window.
 *   - NO crea timers (setTimeout, setInterval, RAF).
 *   - NO abre/cierra sesiones, NO llama goTo, NO llama play.
 *   - NO mantiene cache propio — delega TODO al `audioAdapter.preload`.
 *   - NO crea singletons globales — cada bind es independiente.
 *
 * Fire-and-forget: `prefetch()` retorna una promise; el binder NO la espera
 * y NO la rejecta. Errores del prefetch quedan reflejados en el resultado
 * del propio prefetch (que el adapter loguea via diagnostics).
 *
 * Idempotencia: snapshots repetidos (mismo sessionId/status/currentIndex)
 * NO disparan preload de nuevo; el peek interno + check de estado lo evitan.
 */

const PRELOAD_TRIGGER_STATUSES = new Set(['playing', 'ready']);

/**
 * bindRuntimeAudio — conecta runtime ↔ audioAdapter para preload + cleanup
 * automáticos. Devuelve `{ dispose() }`.
 *
 * @param {object} args
 * @param {object} args.runtime — ImmersiveRuntime instance
 * @param {object} args.audioAdapter — createBrowserAudioAdapter result
 * @param {(index: number) => string | null} [args.getTextForIndex]
 *        Si está, el binder pasa el texto al prefetch (para fallback TTS).
 *        Sin este getter, los prefetches que dependen de TTS se skipean.
 * @param {() => object | null} [args.getManifest] — manifest normalizado.
 * @param {() => string | null} [args.getUserId]
 * @param {() => Function} [args.getFetchImpl]
 * @param {number} [args.preloadWindow=2] — cuántos clips adelante prefetchear.
 * @param {object} [args.diagnostics] — diagnostics opcional para emitir
 *        binder.attach / binder.preload.request / binder.preload.skip /
 *        binder.release.session / binder.dispose.
 */
export function bindRuntimeAudio(args = {}) {
    const {
        runtime,
        audioAdapter,
        getTextForIndex,
        getManifest,
        getUserId,
        getFetchImpl,
        preloadWindow = 2,
        diagnostics = null,
    } = args;

    if (!runtime || typeof runtime.subscribe !== 'function' || typeof runtime.getSnapshot !== 'function') {
        throw makeBindError('invalid_runtime');
    }
    if (!audioAdapter || !audioAdapter.preload || typeof audioAdapter.releaseSession !== 'function') {
        throw makeBindError('invalid_audioAdapter');
    }

    const window = Math.max(1, Number.isFinite(preloadWindow) ? preloadWindow : 2);

    // Estado interno — captura del último snapshot visto para detectar transiciones.
    let prevSessionId    = null;
    let prevStatus       = 'idle';
    let prevCurrentIndex = -1;
    let disposed         = false;

    // Inicializar con el snapshot actual para no disparar release fantasma.
    const initial = runtime.getSnapshot();
    prevSessionId    = initial.sessionId;
    prevStatus       = initial.status;
    prevCurrentIndex = initial.currentIndex;

    function diag(kind, sessionId, data) {
        if (!diagnostics || typeof diagnostics.log !== 'function') return;
        diagnostics.log({ kind, sessionId, data });
    }

    function maybeFirePreload(snap) {
        if (!PRELOAD_TRIGGER_STATUSES.has(snap.status)) return;
        if (typeof snap.sessionId !== 'string' || snap.sessionId.length === 0) return;
        if (typeof getTextForIndex !== 'function') {
            diag('binder.preload.skip', snap.sessionId, { reason: 'no_text_getter' });
            return;
        }
        const total = snap.totalIndices;
        const cur   = snap.currentIndex;
        for (let off = 1; off <= window; off++) {
            const targetIndex = cur + off;
            if (total > 0 && targetIndex >= total) break;
            // Cache hit: skip silencioso.
            if (audioAdapter.preload.peek(snap.sessionId, targetIndex)) {
                diag('binder.preload.skip', snap.sessionId, { index: targetIndex, reason: 'cached' });
                continue;
            }
            const text = getTextForIndex(targetIndex);
            if (typeof text !== 'string' || text.length === 0) {
                diag('binder.preload.skip', snap.sessionId, { index: targetIndex, reason: 'no_text' });
                continue;
            }
            const manifest = typeof getManifest === 'function' ? getManifest() : null;
            const userId   = typeof getUserId   === 'function' ? getUserId()   : null;
            const fetchImpl = typeof getFetchImpl === 'function' ? getFetchImpl() : undefined;
            diag('binder.preload.request', snap.sessionId, { index: targetIndex });
            // Fire-and-forget: errores se reflejan en el adapter, no propagamos.
            try {
                const p = audioAdapter.preload.prefetch({
                    session: { id: snap.sessionId, contentId: snap.contentId },
                    index:    targetIndex,
                    text, manifest, userId, fetchImpl,
                });
                if (p && typeof p.catch === 'function') {
                    p.catch(() => { /* swallowed — adapter ya tiene reason */ });
                }
            } catch { /* síncrono throw del adapter — swallowed */ }
        }
    }

    function listener(snap) {
        if (disposed) return;

        const sessionChanged = prevSessionId !== snap.sessionId;
        const justClosed     = snap.status === 'closed' && prevStatus !== 'closed';
        const indexChanged   = prevCurrentIndex !== snap.currentIndex;

        // 1) Liberar URLs cacheados de la sesión anterior cuando rota o cierra.
        if ((sessionChanged || justClosed) && prevSessionId) {
            try {
                audioAdapter.releaseSession(prevSessionId);
            } catch { /* ignore */ }
            diag('binder.release.session', null, { releasedSessionId: prevSessionId });
        }

        // 2) Cancel stale preloads alrededor del nuevo currentIndex.
        if (snap.sessionId && (sessionChanged || indexChanged)) {
            try {
                audioAdapter.preload.cancelStaleAround({
                    session:      { id: snap.sessionId },
                    currentIndex: snap.currentIndex,
                    window,
                });
            } catch { /* ignore */ }
        }

        // 3) Disparar preload del/los próximos clips si estamos en estado activo.
        maybeFirePreload(snap);

        prevSessionId    = snap.sessionId;
        prevStatus       = snap.status;
        prevCurrentIndex = snap.currentIndex;
    }

    const unsubscribe = runtime.subscribe(listener);
    diag('binder.attach', initial.sessionId, { preloadWindow: window });

    function dispose() {
        if (disposed) return;
        disposed = true;
        try { unsubscribe(); } catch { /* ignore */ }
        diag('binder.dispose', prevSessionId, null);
    }

    function _state() {
        return {
            disposed, prevSessionId, prevStatus, prevCurrentIndex, preloadWindow: window,
        };
    }

    return Object.freeze({ dispose, _state });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function makeBindError(reason) {
    const err = new Error(`[runtimeAudioBinder] ${reason}`);
    err.kind = 'invariant_violated';
    err.reason = reason;
    return err;
}
