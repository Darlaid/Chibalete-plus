/**
 * readingRuntimeSnapshotStore.d.ts — tipos del store de persistencia.
 *
 * Patrón split .mjs + .d.ts. Runtime en readingRuntimeSnapshotStore.mjs.
 */

export type SnapshotMode = 'immersive' | 'accessible' | 'guided' | 'pdf' | 'album';

export interface PersistedSnapshot {
    version: 1;
    mode: SnapshotMode;
    contentId: string;
    userId: string;
    currentIndex: number;
    totalIndices: number;
    status: string;
    savedAt: number;
}

export declare function saveSnapshot(
    s: Omit<PersistedSnapshot, 'version' | 'savedAt'>,
): boolean;

export declare function loadSnapshot(
    userId: string,
    contentId: string,
    mode: SnapshotMode,
): PersistedSnapshot | null;

export declare function clearSnapshot(
    userId: string,
    contentId: string,
    mode: SnapshotMode,
): boolean;
