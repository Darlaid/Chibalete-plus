/**
 * RuntimeStore.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Store inmutable + observable del snapshot del runtime. Es la única
 * superficie que los viewers (React, debug tools, Diagnostics dashboard)
 * leen. NO es un reducer — la mutación se decide en ImmersiveSession; el
 * store solo recibe el snapshot ya construido y lo difunde.
 *
 * Garantías:
 *   - getSnapshot() devuelve un objeto frozen (Object.freeze).
 *   - replace(snap) congela el input antes de almacenarlo.
 *   - subscribe(listener) devuelve unsubscribe; los listeners reciben
 *     el snapshot nuevo después de cada replace.
 *   - Si un listener throws, NO interrumpe la difusión a los demás
 *     (try/catch wrapper). El error se loguea via console.error.
 *
 * NO usa React, NO usa proxies, NO observa estructuralmente. Es un slot
 * con observers básicos. Patrón equivalente a un BehaviorSubject mínimo.
 */

const INITIAL_SNAPSHOT = Object.freeze({
    sessionId:          null,
    contentId:          null,
    userId:             null,
    status:             'idle',
    currentIndex:       0,
    totalIndices:       0,
    lifecycleToken:     null,
    lastError:          null,
    visualReady:        false,
    // ── Sprint M-4.2 — diagnostic enrichments ──
    isPlaying:          false,
    audioState:         'idle',
    audioUrlLoaded:     false,
    activeSentenceId:   0,
    pendingTransition:  false,
    playbackGeneration: null,
});

export function createRuntimeStore(initialSnapshot = INITIAL_SNAPSHOT) {
    let snapshot = freezeSnapshot(initialSnapshot);
    const listeners = new Set();

    function getSnapshot() {
        return snapshot;
    }

    /**
     * Subscribe — devuelve unsubscribe(). Los listeners se invocan después
     * de cada replace. NO se invocan inmediatamente al subscribirse — el
     * caller puede leer getSnapshot() si necesita el estado inicial.
     */
    function subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /**
     * replace(next): reemplaza el snapshot atómicamente y notifica a todos
     * los listeners. El input se freeze defensivamente. Si next es ===
     * snapshot actual, NO se notifica (no-op semántico).
     */
    function replace(next) {
        if (next === snapshot) return;
        const frozen = freezeSnapshot(next);
        snapshot = frozen;
        for (const fn of [...listeners]) {
            try {
                fn(frozen);
            } catch (err) {
                // No romper la difusión por un listener mal portado.
                // El runtime debe seguir funcionando.
                // eslint-disable-next-line no-console
                console.error('[RuntimeStore] listener throw:', err);
            }
        }
    }

    /**
     * reset — limpia el store. Sprint M-3.4 acepta `opts.notify=true` que
     * notifica el snapshot final (INITIAL_SNAPSHOT) a TODOS los listeners
     * ANTES de limpiar el set. Sin notify, mantiene comportamiento legacy
     * (silent reset).
     *
     * Caso de uso M-3.4: `runtime.destroy()` llama `reset({notify:true})`
     * para que el binder/integrator vea el cierre y libere recursos
     * (objectURLs, listeners de audio) antes de quedar desconectado.
     */
    function reset(opts = {}) {
        const wasFrozen = INITIAL_SNAPSHOT;
        snapshot = wasFrozen;
        if (opts && opts.notify === true) {
            // Notify ANTES de clear — listeners reciben el snapshot final.
            for (const fn of [...listeners]) {
                try {
                    fn(wasFrozen);
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[RuntimeStore] listener throw on reset:', err);
                }
            }
        }
        listeners.clear();
    }

    return Object.freeze({ getSnapshot, subscribe, replace, reset });
}

export { INITIAL_SNAPSHOT };

// ── helpers internos ────────────────────────────────────────────────────────

function freezeSnapshot(snap) {
    if (!snap || typeof snap !== 'object') {
        return INITIAL_SNAPSHOT;
    }
    if (Object.isFrozen(snap)) return snap;
    // Freeze shallow — los campos primitivos no necesitan deep freeze, y
    // lastError es un objeto plain frozen aparte (lo congela la session).
    return Object.freeze({ ...snap });
}
