/**
 * readingRuntimeFlag.d.ts — tipos del resolver multi-modo.
 *
 * Patrón split .mjs + .d.ts (idéntico a utils/groupMembership). Los tipos se
 * declaran acá; el runtime vive en readingRuntimeFlag.mjs.
 */

import type { ImmersiveRuntimeConfig, RuntimeDecision } from './immersiveRuntimeFlag';

export type ReadingMode = 'immersive' | 'accessible' | 'guided' | 'pdf' | 'album';

export interface ReadingRuntimeConfig {
    killSwitch: boolean;
    /** Porcentaje 0..100 por modo. Default 0 para todos = nadie usa V2. */
    cohortPct: Partial<Record<ReadingMode, number>>;
}

export interface ReadingRuntimeDecision extends RuntimeDecision {
    mode: ReadingMode;
}

export declare function resolveReadingRuntime(
    userId: string | null | undefined,
    mode: ReadingMode,
    cfg?: ReadingRuntimeConfig,
): ReadingRuntimeDecision;

export declare function resolveImmersiveViaReadingFlag(
    userId: string | null | undefined,
    cfg?: ImmersiveRuntimeConfig,
): RuntimeDecision;

export type { ImmersiveRuntimeConfig, RuntimeDecision };
