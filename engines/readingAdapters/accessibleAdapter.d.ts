/**
 * accessibleAdapter.d.ts — tipos del adapter del Modo Accesible.
 *
 * Sin audio (corrige asunción de Phase 1A). La forma de deps coincide con
 * pdfAdapter / albumAdapter (no requiere getTextForIndex, fetchImpl,
 * audioCtor, ni getUserId).
 */

import type { RuntimeSnapshot } from '../immersiveRuntimeTypes';

export interface AccessibleAdapterDeps {
    /** Hydrate del contenido — `totalIndices` = segmentos/párrafos navegables. */
    hydrateContent: (args: { contentId: string }) => Promise<{ totalIndices: number }>;
    diagnostics?: { log: (e: { kind: string; data?: object }) => void };
    visibilityTimeoutMs?: number;
    idPrefix?: string;
}

export interface AccessibleAdapter {
    readonly mode: 'accessible';
    readonly runtime: {
        openSession: (args: { contentId: string; userId: string; startIndex?: number; totalIndices?: number }) => Promise<{ ok: boolean; session?: unknown; error?: unknown }>;
        closeSession: (reason?: string) => Promise<{ ok: boolean; reason?: string }>;
        dispatch: (action: unknown) => Promise<unknown>;
        getSnapshot: () => RuntimeSnapshot;
        subscribe: (listener: (s: RuntimeSnapshot) => void) => () => void;
        destroy: (reason?: string) => Promise<unknown>;
        reportVisibility?: (sessionId: string, index: number, result: { visible: boolean; reason?: string }) => void;
    };
    readonly diagnostics: {
        log: (e: { kind: string; data?: object }) => void;
        exportTrace?: (sessionId: string) => unknown[];
    };
    readonly dispose: (reason?: string) => Promise<{ ok: boolean; reason?: string }>;
    readonly _state: () => Readonly<Record<string, unknown>>;
}

export declare function createAccessibleAdapter(deps: AccessibleAdapterDeps): AccessibleAdapter;
