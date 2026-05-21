/**
 * sentenceAdapter.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Carga las oraciones para un contenido. Reutiliza `engines/StartupEngine.ts`
 * AS-IS — NO reescribimos el parser.
 *
 * Restricción técnica: StartupEngine es TypeScript y los tests corren con
 * node directo (no compila .ts). Para mantenerlo intocable, este adapter
 * recibe `engineFactory` inyectado:
 *
 *   engineFactory({ contentId, textUrl, signal }) → engine
 *
 * Donde `engine` cumple el contrato de StartupEngine:
 *   {
 *     start(): void,
 *     getState(): { status, sentences, sentenceToChunk, anchorsMap, manifest },
 *     subscribe(listener): () => void   // unsubscribe
 *   }
 *
 * En producción (M-3.5+), el viewer V2 hace:
 *
 *   import { StartupEngine } from '../../engines/StartupEngine';
 *   const engineFactory = ({contentId, textUrl, signal}) =>
 *       new StartupEngine(contentId, textUrl, signal);
 *
 * En tests, se inyecta un fake controlado.
 *
 * Contratos:
 *   - hydrateSentences resuelve a {ok:true, sentences, totalIndices, rawManifest?}
 *     o {ok:false, reason, meta?}.
 *   - Aborts del signal se traducen a reason='aborted' SIN throw.
 *   - Si el engine queda en 'ready' con sentences=[] → reason='no_sources'.
 *   - El adapter NO retiene el engine después de resolver — si el engine
 *     emite más eventos post-resolve, son ignorados (unsubscribe explícito).
 */

/**
 * hydrateSentences — orquesta el ciclo idle → loading → ready del
 * StartupEngine inyectado y traduce el resultado al shape del adapter.
 *
 * Sprint M-4 fix — `timeoutMs` (opcional) garantiza que el viewer NUNCA
 * queda colgado en `opening` indefinidamente. Si el engine no llega a
 * `ready` antes del timeout (típico: service worker que intercepta y no
 * responde, red bloqueada, fetch que jamás resuelve), settle con
 * `{ok:false, reason:'hydration_timeout'}`.
 *
 * Sin `timeoutMs` (default null), preserva comportamiento M-3.1 — el
 * adapter espera al engine indefinidamente. El viewer M-4 pasa 15000.
 *
 * @returns {Promise<
 *   | { ok: true, sentences: string[], totalIndices: number, rawManifest: unknown }
 *   | { ok: false, reason: 'invalid_args' | 'aborted' | 'no_sources' | 'start_failed' | 'hydration_timeout', meta?: object }
 * >}
 */
export function hydrateSentences({ contentId, textUrl, signal, engineFactory, timeoutMs } = {}) {
    if (typeof contentId !== 'string' || contentId.length === 0) {
        return Promise.resolve({
            ok: false, reason: 'invalid_args',
            meta: { reason: 'missing_contentId' },
        });
    }
    if (typeof engineFactory !== 'function') {
        return Promise.resolve({
            ok: false, reason: 'invalid_args',
            meta: { reason: 'missing_engineFactory' },
        });
    }
    if (signal?.aborted) {
        return Promise.resolve({ ok: false, reason: 'aborted' });
    }

    return new Promise((resolve) => {
        let resolved = false;
        let unsub = null;
        let timeoutId = null;

        function settle(result) {
            if (resolved) return;
            resolved = true;
            try { unsub?.(); } catch { /* ignore */ }
            if (timeoutId !== null) {
                try { clearTimeout(timeoutId); } catch { /* ignore */ }
            }
            try { signal?.removeEventListener?.('abort', onAbort); } catch { /* ignore */ }
            resolve(result);
        }

        function onAbort() {
            settle({ ok: false, reason: 'aborted' });
        }

        // Sprint M-4 — timeout defensivo. Si engine no llega a ready,
        // settle con hydration_timeout. Esto evita que el viewer quede
        // en opening 0/0 indefinidamente cuando un fetch jamás resuelve.
        if (typeof timeoutMs === 'number' && timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                settle({
                    ok: false, reason: 'hydration_timeout',
                    meta: { timeoutMs, contentId },
                });
            }, timeoutMs);
        }

        if (signal) {
            try { signal.addEventListener('abort', onAbort, { once: true }); } catch { /* ignore */ }
        }

        let engine;
        try {
            engine = engineFactory({ contentId, textUrl, signal });
        } catch (e) {
            settle({
                ok: false, reason: 'start_failed',
                meta: { reason: 'engineFactory_throw', error: e?.message ?? String(e) },
            });
            return;
        }
        if (!engine
            || typeof engine.start !== 'function'
            || typeof engine.subscribe !== 'function'
            || typeof engine.getState !== 'function') {
            settle({
                ok: false, reason: 'start_failed',
                meta: { reason: 'invalid_engine_contract' },
            });
            return;
        }

        // Subscribe ANTES de start() para no perder transición ready inmediata.
        try {
            unsub = engine.subscribe((state) => {
                if (state?.status !== 'ready') return;
                if (signal?.aborted) {
                    settle({ ok: false, reason: 'aborted' });
                    return;
                }
                const sentences = Array.isArray(state.sentences)
                    ? state.sentences.filter((s) => typeof s === 'string')
                    : [];
                if (sentences.length === 0) {
                    settle({ ok: false, reason: 'no_sources' });
                    return;
                }
                settle({
                    ok: true,
                    sentences,
                    totalIndices: sentences.length,
                    rawManifest: state.manifest ?? null,
                });
            });
        } catch (e) {
            settle({
                ok: false, reason: 'start_failed',
                meta: { reason: 'subscribe_throw', error: e?.message ?? String(e) },
            });
            return;
        }

        // Por si el engine YA estuviera ready al subscribir (engineFactory que
        // devolvió un engine pre-cargado, raro pero defensivo).
        try {
            const initial = engine.getState();
            if (initial?.status === 'ready') {
                // El subscribe ya disparó (algunas implementaciones notifican
                // al subscribir). Si NO disparó, forzamos la rama:
                if (!resolved) {
                    const sentences = Array.isArray(initial.sentences)
                        ? initial.sentences.filter((s) => typeof s === 'string')
                        : [];
                    if (sentences.length === 0) {
                        settle({ ok: false, reason: 'no_sources' });
                    } else {
                        settle({
                            ok: true,
                            sentences,
                            totalIndices: sentences.length,
                            rawManifest: initial.manifest ?? null,
                        });
                    }
                    return;
                }
            }
        } catch { /* ignore — engine.getState debería ser puro */ }

        // Disparar la hidratación.
        try {
            engine.start();
        } catch (e) {
            settle({
                ok: false, reason: 'start_failed',
                meta: { reason: 'engine_start_throw', error: e?.message ?? String(e) },
            });
        }
    });
}
