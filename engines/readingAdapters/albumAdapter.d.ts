/**
 * albumAdapter.d.ts — tipos del adapter del Modo Álbum.
 */

import type { RuntimeSnapshot } from '../immersiveRuntimeTypes';

export interface AlbumAdapterDeps {
    /** Hydrate del álbum — `totalIndices` debe ser el número de láminas. */
    hydrateContent: (args: { contentId: string }) => Promise<{ totalIndices: number }>;
    diagnostics?: { log: (e: { kind: string; data?: object }) => void };
    visibilityTimeoutMs?: number;
    idPrefix?: string;
}

export interface AlbumAdapter {
    readonly mode: 'album';
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

export declare function createAlbumAdapter(deps: AlbumAdapterDeps): AlbumAdapter;
