/**
 * createProductionRuntime.mjs — Sprint Inmersivo V2 / Fase M-3.5.
 *
 * Factory oficial que arma el stack PRODUCTIVO completo. Antes de M-3.5
 * cada test/integrator construía manualmente:
 *
 *   adapter = createBrowserAudioAdapter({onEnded, onError, ...})
 *   audio   = createAudioRuntime({audioFactory, audioCleanup, resolveSrc})
 *   runtime = createImmersiveRuntime({audio, hydrateContent})
 *   binder  = bindRuntimeAudio({runtime, audioAdapter: adapter, ...})
 *
 * Ahora un solo call:
 *
 *   const stack = createProductionRuntime({
 *     hydrateContent, getTextForIndex, getManifest, getUserId,
 *     fetchImpl, audioCtor, diagnostics,
 *   });
 *   stack.runtime.openSession(...)
 *   stack.dispose()
 *
 * dispose() es idempotente y libera TODO: binder.dispose + runtime.destroy
 * (que internamente force-close + audio.unmount + store.reset notify).
 *
 * NO React. NO DOM. NO singletons. Cada call crea un stack independiente.
 */

import { createImmersiveRuntime }      from '../../engines/ImmersiveRuntime.mjs';
import { createAudioRuntime }          from '../../engines/AudioRuntime.mjs';
import { createDiagnostics }           from '../../engines/Diagnostics.mjs';
import {
    createBrowserAudioAdapter,
    resolveAudioSrc,
    mediaErrorToReason,
} from './audioAdapter.mjs';
import { bindRuntimeAudio }            from './runtimeAudioBinder.mjs';

/**
 * createProductionRuntime — arma el stack y devuelve { runtime, dispose, diagnostics }.
 *
 * @param {object} opts
 * @param {(args: {contentId: string}) => Promise<{totalIndices: number}>} opts.hydrateContent
 *   Llamado por openSession. El integrator (viewer M-3.5) lo construye con
 *   sentenceAdapter + StartupEngine. DEBE actualizar las refs internas que
 *   getTextForIndex/getManifest leen.
 *
 * @param {(index: number) => string | null} [opts.getTextForIndex]
 *   Para fallback TTS al resolver src de cada índice (también usado por el
 *   binder para preload). Sin este getter, no hay fallback TTS — solo manifest.
 *
 * @param {() => object | null} [opts.getManifest]
 *   Devuelve el manifest normalizado (manifestAdapter.normalizeRaw). Si null,
 *   resolveAudioSrc cae directo a TTS.
 *
 * @param {() => string | null} [opts.getUserId]
 *   Para header x-user-id en /api/tts. Sin esto, TTS no se intenta.
 *
 * @param {typeof fetch} [opts.fetchImpl] — default: globalThis.fetch.
 * @param {new () => object} [opts.audioCtor] — default: globalThis.Audio.
 *
 * @param {object} [opts.diagnostics] — externa; default: createDiagnostics().
 *
 * @param {number} [opts.preloadWindow=2]
 * @param {number} [opts.visibilityTimeoutMs] — para VisibilityCoordinator.
 * @param {string} [opts.idPrefix]
 */
export function createProductionRuntime(opts = {}) {
    const {
        hydrateContent,
        getTextForIndex,
        getManifest,
        getUserId,
        fetchImpl,
        audioCtor,
        diagnostics: extDiagnostics,
        preloadWindow = 2,
        visibilityTimeoutMs,
        idPrefix,
    } = opts;

    const diagnostics = extDiagnostics ?? createDiagnostics();
    let runtime = null;   // chicken-and-egg: adapter necesita ref a runtime
    let binder  = null;
    let disposed = false;

    // ── Audio adapter (M-3.2): listeners stale-aware + URL registry. ──────
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => runtime?.getActiveSession()?.id ?? null,
        onEnded: (sid, idx) => {
            if (!runtime) return;
            void runtime.dispatch({ kind: 'audioEnded', index: idx });
        },
        onError: (sid, idx, mediaError) => {
            if (!runtime) return;
            const reason = mediaErrorToReason(mediaError);
            void runtime.dispatch({ kind: 'audioFailed', index: idx, reason });
        },
        // onCanPlay opcional: M-3.5 no lo wirea — el viewer reporta visibility
        // por separado al detectar render. Si M-3.6+ quiere usar canplay como
        // signal de "audio listo", se conecta aquí.
        audioCtor,
        diagnostics,
    });

    // ── AudioRuntime: factory + cleanup del adapter, resolveSrc productivo. ─
    const audio = createAudioRuntime({
        audioFactory: adapter.factory,
        audioCleanup: adapter.cleanupAudio,
        diagnostics,
        resolveSrc: async ({ session, index, signal }) => {
            // 1. Cache hit del preload manager.
            const cached = adapter.preload.peek(session.id, index);
            if (cached) return cached;

            // 2. Resolución productiva con cascada manifest → /api/tts.
            const text     = typeof getTextForIndex === 'function' ? getTextForIndex(index) : null;
            const manifest = typeof getManifest     === 'function' ? getManifest()          : null;
            const userId   = typeof getUserId       === 'function' ? getUserId()            : null;

            const result = await resolveAudioSrc({
                session, index,
                text, manifest, userId,
                signal, fetchImpl,
                onObjectUrlCreated: adapter.registerObjectUrl,
            });
            return result.ok ? result.src : null;
        },
    });

    // ── Runtime (orquestador). ─────────────────────────────────────────────
    runtime = createImmersiveRuntime({
        audio,
        diagnostics,
        hydrateContent,
        visibilityTimeoutMs,
        idPrefix,
    });

    // ── Binder: preload automático + releaseSession en cambio/cierre. ──────
    binder = bindRuntimeAudio({
        runtime,
        audioAdapter: adapter,
        getTextForIndex,
        getManifest,
        getUserId,
        getFetchImpl: () => fetchImpl,
        preloadWindow,
        diagnostics,
    });

    /**
     * dispose — libera TODO. Idempotente. Síncrono al kick-off pero llama
     * runtime.destroy() que es async (esperamos via promise; si caller no
     * espera, el cleanup completa eventual).
     */
    async function dispose(reason) {
        if (disposed) return { ok: true, reason: 'already_disposed' };
        disposed = true;
        try { binder?.dispose(); } catch { /* ignore */ }
        try { await runtime.destroy(reason ?? 'production_runtime_dispose'); } catch { /* ignore */ }
        // releaseAll del adapter es defensivo: si quedó algún URL del
        // preload no asociado a sesión cerrada (edge case), lo limpiamos.
        try { adapter.releaseAll(); } catch { /* ignore */ }
        return { ok: true };
    }

    function _state() {
        return {
            disposed,
            adapterState: adapter._state(),
            binderState: binder._state(),
        };
    }

    return Object.freeze({
        runtime,
        adapter,        // expuesto para tests y observabilidad; el viewer no debería tocarlo
        binder,         // mismo
        diagnostics,
        dispose,
        _state,
    });
}
