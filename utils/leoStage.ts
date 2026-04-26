import type { PedagogicalStage, LeoReaderProfile } from '../types';

/**
 * Unified pedagogical stage derivation — single source of truth for all viewers and services.
 * Rules: progress threshold OR anchor count threshold (whichever triggers first).
 */
export function derivePedagogicalStage(
    progress: number,
    anchorsOpened: number
): PedagogicalStage {
    if (progress >= 85) return 'creation';
    if (progress >= 60 || anchorsOpened >= 5) return 'reflection';
    if (progress >= 25 || anchorsOpened >= 2) return 'interpretation';
    return 'comprehension';
}

/**
 * Derives the initial difficulty level from the reader's cumulative profile.
 * Fallback to 'medio' when profile is absent.
 */
export function deriveInitialDifficulty(
    profile: LeoReaderProfile | null | undefined
): 'inicial' | 'medio' | 'avanzado' {
    if (!profile) return 'medio';
    if (profile.preferredSupportType === 'reflection') return 'avanzado';
    if (profile.preferredSupportType === 'vocabulary') return 'inicial';
    if (profile.booksCompletedCount < 2 && profile.preferredSupportType === null) return 'inicial';
    return 'medio';
}
