/**
 * pdfAdapter.d.ts — tipos del adapter del Modo PDF.
 */

import type { RuntimeSnapshot } from '../immersiveRuntimeTypes';

export interface PdfAdapterDeps {
    /** Hydrate del PDF — `totalIndices` debe ser el número de páginas. */
    hydrateContent: (args: { contentId: string }) => Promise<{ totalIndices: number }>;
    diagnostics?: { log: (e: { kind: string; data?: object }) => void };
    visibilityTimeoutMs?: number;
    idPrefix?: string;
}

export interface PdfAdapter {
    readonly mode: 'pdf';
    readonly runtime: {
        openSession: (args: { contentId: string; userId: string; startIndex?: number; totalIndices?: number }) => Promise<{ ok: boolean; session?: unknown; error?: unknown }>;
        closeSession: (reason?: string) => Promise<{ ok: boolean; reason?: string }>;
        dispatch: (action: unknown) => Promise<unknown>;
        getSnapshot: () => RuntimeSnapshot;
        subscribe: (listener: (s: RuntimeSnapshot) => void) => () => void;
        destroy: (reason?: string) => Promise<unknown>;
    };
    readonly diagnostics: {
        log: (e: { kind: string; data?: object }) => void;
        exportTrace?: (sessionId: string) => unknown[];
    };
    readonly dispose: (reason?: string) => Promise<{ ok: boolean; reason?: string }>;
    readonly _state: () => Readonly<Record<string, unknown>>;
}

export declare function createPdfAdapter(deps: PdfAdapterDeps): PdfAdapter;
