/**
 * useReadingRuntimeBridge — CRR Fase 2 / hook React (wrapper fino).
 *
 * Toda la lógica vive en `utils/readingRuntimeBridgeCore.mjs`. El hook es
 * solo el "pegamento" entre el ciclo de vida de React y el factory del core.
 * Esa separación se mantiene a propósito (espeja `immersiveRuntimeV2Bridge.mjs`):
 * permite tests node-only del bridge sin mockear React, y deja el componente
 * React libre de lógica compleja.
 *
 * Modo OBSERVACIÓN: el hook NUNCA toca audio, focus, screen readers ni el
 * lifecycle del visor. Si el flag CRR está OFF (default), el efecto del
 * hook ni siquiera se ejecuta — `enabled: false`, snapshot null.
 */

import { useEffect, useMemo, useState } from 'react';
// El core es .mjs sin .d.ts barrel; TypeScript resuelve el módulo vía
// bundler resolution + allowJs. El contrato del factory está documentado en
// el header del core y testeado en
// utils/__tests__/readingRuntimeBridgeCore.test.mjs.
import { createBridgeSession } from '../utils/readingRuntimeBridgeCore.mjs';
import {
    resolveReadingRuntime,
    type ReadingMode,
    type ReadingRuntimeConfig,
    type ReadingRuntimeDecision,
} from '../utils/readingRuntimeFlag';

export interface BridgeSnapshot {
    sessionId: string | null;
    status: string;
    currentIndex: number;
    totalIndices: number;
    isPlaying: boolean;
    visualReady: boolean;
}

export interface UseReadingRuntimeBridgeOpts {
    /** Modo del visor — ver mapping en docs/CHIBALETE-READING-RUNTIME.md §8. */
    mode: Exclude<ReadingMode, 'immersive'>;
    userId: string | null | undefined;
    contentId: string | null | undefined;
    totalIndices?: number;
    hydrateContent?: (args: { contentId: string }) => Promise<{ totalIndices: number }>;
    flagConfig?: ReadingRuntimeConfig;
    /** Escape hatch — false → bridge inerte aún con flag a v2. */
    enabled?: boolean;
}

export interface UseReadingRuntimeBridgeResult {
    enabled: boolean;
    decision: ReadingRuntimeDecision;
    snapshot: BridgeSnapshot | null;
}

export function useReadingRuntimeBridge(
    opts: UseReadingRuntimeBridgeOpts,
): UseReadingRuntimeBridgeResult {
    const { mode, userId, contentId, totalIndices, hydrateContent, flagConfig, enabled } = opts;

    // Decisión del flag — separada del effect para que el caller obtenga la
    // razón aun cuando no haya cambio efectivo.
    const decision = useMemo<ReadingRuntimeDecision>(() => {
        if (enabled === false) {
            return { runtime: 'v1', reason: 'caller_disabled', bucket: -1, override: 'none', mode };
        }
        return resolveReadingRuntime(userId, mode, flagConfig);
    }, [userId, mode, enabled, flagConfig]);

    const [snapshot, setSnapshot] = useState<BridgeSnapshot | null>(null);

    useEffect(() => {
        if (decision.runtime !== 'v2') return;
        if (!userId || !contentId) return;

        let cancelled = false;
        const session = createBridgeSession({
            mode, userId, contentId, totalIndices, hydrateContent, flagConfig,
        });
        if (!session.enabled) return;

        const unsubscribe = session.subscribe((snap: BridgeSnapshot) => {
            if (cancelled) return;
            setSnapshot(snap);
        });

        return () => {
            cancelled = true;
            try { unsubscribe(); } catch { /* ignore */ }
            // dispose es async pero no esperamos — el cleanup de React es síncrono.
            void session.dispose('bridge_unmount');
        };
    }, [decision.runtime, userId, contentId, mode, totalIndices, hydrateContent, flagConfig]);

    if (decision.runtime !== 'v2') {
        return { enabled: false, decision, snapshot: null };
    }
    return { enabled: true, decision, snapshot };
}
