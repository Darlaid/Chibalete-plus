/**
 * readingRuntimeBridgeCore.mjs — CRR Fase 2 / núcleo testeable del bridge.
 *
 * Concentra TODA la lógica del bridge cross-visor en funciones puras (sin
 * React). El hook `hooks/useReadingRuntimeBridge.ts` es un wrapper fino que
 * delega aquí. Esta separación replica el patrón de
 * `utils/immersiveRuntimeV2Bridge.mjs` y permite tests node-only sin necesidad
 * de mockear React.
 *
 * Funciones expuestas:
 *   - createBridgeSession(opts) → { dispose, getSnapshot, subscribe, decision }
 *       Construye el runtime CRR de observación, abre sesión, registra
 *       listener visibility (si document está disponible) y persiste snapshot.
 *       Si el flag resuelve a v1, devuelve un handle "inerte" sin side effects.
 *
 *   - normalizeSnapshot(raw) → BridgeSnapshot
 *       Extrae los campos públicos del snapshot del runtime canónico.
 *
 * Garantías:
 *   - dispose() es idempotente.
 *   - Cualquier throw en construcción del runtime se traga; observation mode
 *     nunca debe propagar fallos al visor.
 *   - Sin window/document, el bridge sigue funcionando — solo skipea las
 *     partes que requieran browser globals.
 */

import { createImmersiveRuntime }  from '../engines/ImmersiveRuntime.mjs';
import { createAudioRuntime }      from '../engines/AudioRuntime.mjs';
import { createDiagnostics }       from '../engines/Diagnostics.mjs';
import {
    createNullAudioFactory,
    nullResolveSrc,
    nullCleanup,
} from '../engines/readingAdapters/_nullAudio.mjs';
import { resolveReadingRuntime } from './readingRuntimeFlag.mjs';
import {
    saveSnapshot,
    loadSnapshot,
    clearSnapshot,
} from './readingRuntimeSnapshotStore.mjs';

/**
 * @typedef {Object} BridgeSnapshot
 * @property {string|null} sessionId
 * @property {string}      status
 * @property {number}      currentIndex
 * @property {number}      totalIndices
 * @property {boolean}     isPlaying
 * @property {boolean}     visualReady
 */

/** Extrae el subset público del snapshot del runtime canónico. */
export function normalizeSnapshot(raw) {
    if (!raw) {
        return { sessionId: null, status: 'idle', currentIndex: 0, totalIndices: 0, isPlaying: false, visualReady: false };
    }
    return {
        sessionId:    raw.sessionId ?? null,
        status:       String(raw.status ?? 'idle'),
        currentIndex: typeof raw.currentIndex === 'number' ? raw.currentIndex : 0,
        totalIndices: typeof raw.totalIndices === 'number' ? raw.totalIndices : 0,
        isPlaying:    !!raw.isPlaying,
        visualReady:  !!raw.visualReady,
    };
}

/**
 * Handle inerte — devuelto cuando el flag resuelve a v1 o cuando el caller
 * pasa enabled=false. Permite que el caller llame siempre dispose() sin
 * branching.
 */
function inertHandle(decision) {
    return Object.freeze({
        decision,
        enabled: false,
        getSnapshot: () => normalizeSnapshot(null),
        subscribe: (_listener) => () => {},
        dispose: async () => ({ ok: true, reason: 'inert' }),
    });
}

/**
 * @param {object} opts
 * @param {'accessible'|'guided'|'pdf'|'album'} opts.mode
 * @param {string|null|undefined} opts.userId
 * @param {string|null|undefined} opts.contentId
 * @param {number} [opts.totalIndices]
 * @param {(args: {contentId: string}) => Promise<{totalIndices: number}>} [opts.hydrateContent]
 * @param {object} [opts.flagConfig]
 * @param {boolean} [opts.enabled] — escape hatch; false → handle inerte.
 * @param {typeof document} [opts.documentRef] — para tests; default global.
 */
export function createBridgeSession(opts) {
    const {
        mode, userId, contentId, totalIndices,
        hydrateContent, flagConfig, enabled,
        documentRef,
    } = opts;

    if (mode === 'immersive') {
        return inertHandle({ runtime: 'v1', reason: 'immersive_uses_dedicated_bridge', bucket: -1, override: 'none', mode });
    }
    if (enabled === false) {
        return inertHandle({ runtime: 'v1', reason: 'caller_disabled', bucket: -1, override: 'none', mode });
    }
    const decision = resolveReadingRuntime(userId, mode, flagConfig);
    if (decision.runtime !== 'v2') {
        return inertHandle(decision);
    }
    if (!userId || !contentId) {
        return inertHandle({ ...decision, runtime: 'v1', reason: 'missing_user_or_content' });
    }

    const persisted = loadSnapshot(userId, contentId, mode);
    const startIndex = persisted?.currentIndex ?? 0;
    const hydrate = hydrateContent
        ?? (async () => ({ totalIndices: totalIndices ?? persisted?.totalIndices ?? 0 }));

    let diagnostics, audio, runtime;
    try {
        diagnostics = createDiagnostics();
        audio = createAudioRuntime({
            audioFactory: createNullAudioFactory(),
            audioCleanup: nullCleanup,
            diagnostics,
            resolveSrc:   nullResolveSrc,
        });
        runtime = createImmersiveRuntime({
            audio, diagnostics,
            hydrateContent: hydrate,
            idPrefix:       `obs-${mode}`,
        });
    } catch (_err) {
        return inertHandle({ ...decision, runtime: 'v1', reason: 'runtime_build_failed' });
    }

    let disposed = false;
    const externalListeners = new Set();
    let lastSnapshot = normalizeSnapshot(null);
    let lastPersisted = null;

    const internalUnsub = runtime.subscribe?.((raw) => {
        const next = normalizeSnapshot(raw);
        lastSnapshot = next;
        // Persistir solo cuando cambia el índice o el status (no spam).
        const persistKey = lastPersisted;
        const changed = !persistKey
            || persistKey.idx !== next.currentIndex
            || persistKey.status !== next.status;
        if (changed && next.sessionId) {
            saveSnapshot({
                mode, userId, contentId,
                currentIndex: next.currentIndex,
                totalIndices: next.totalIndices,
                status:       next.status,
            });
            lastPersisted = { idx: next.currentIndex, status: next.status };
        }
        for (const l of [...externalListeners]) {
            try { l(next); } catch { /* aislamiento */ }
        }
    });

    const doc = documentRef ?? (typeof document !== 'undefined' ? document : null);
    let visibilityHandler = null;
    if (doc && typeof doc.addEventListener === 'function') {
        visibilityHandler = () => {
            try {
                diagnostics?.log?.({
                    kind: 'visibility.report',
                    data: { hidden: doc.hidden === true, mode },
                });
            } catch { /* ignore */ }
        };
        try { doc.addEventListener('visibilitychange', visibilityHandler, { passive: true }); }
        catch { visibilityHandler = null; }
    }

    // Open session async; no esperamos al caller.
    (async () => {
        try {
            await runtime.openSession({
                contentId, userId,
                startIndex,
                totalIndices: totalIndices ?? persisted?.totalIndices ?? 0,
            });
        } catch { /* observation; nunca propagar */ }
    })();

    async function dispose(reason) {
        if (disposed) return { ok: true, reason: 'already_disposed' };
        disposed = true;
        try { internalUnsub?.(); } catch { /* ignore */ }
        externalListeners.clear();
        if (doc && visibilityHandler) {
            try { doc.removeEventListener('visibilitychange', visibilityHandler); } catch { /* ignore */ }
            visibilityHandler = null;
        }
        try {
            const last = runtime.getSnapshot?.();
            if (last && last.totalIndices > 0
                && last.currentIndex >= last.totalIndices - 1) {
                clearSnapshot(userId, contentId, mode);
            }
            await runtime.destroy?.(reason ?? 'bridge_dispose');
        } catch { /* ignore */ }
        return { ok: true };
    }

    return Object.freeze({
        decision,
        enabled: true,
        getSnapshot: () => lastSnapshot,
        subscribe: (listener) => {
            if (typeof listener !== 'function') return () => {};
            externalListeners.add(listener);
            return () => externalListeners.delete(listener);
        },
        dispose,
    });
}
