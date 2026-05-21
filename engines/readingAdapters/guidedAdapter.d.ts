/**
 * guidedAdapter.d.ts — tipos del adapter del Modo Guiado.
 *
 * En Fase 1 la forma es idéntica al accessible adapter; mantenemos el tipo
 * separado para que el contrato pueda divergir sin romper consumidores.
 */

import type { AccessibleAdapterDeps } from './accessibleAdapter';
import type { RuntimeSnapshot } from '../immersiveRuntimeTypes';

export type GuidedAdapterDeps = AccessibleAdapterDeps;

export interface GuidedAdapter {
    readonly mode: 'guided';
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

export declare function createGuidedAdapter(deps: GuidedAdapterDeps): GuidedAdapter;
