import type { LeoSessionMemory } from '../services/geminiService';

export type LeoTriggerReason = 'welcome_back' | 'confusion' | 'retention' | 'checkpoint' | 'anchor' | null;

const CHECKPOINT_THRESHOLDS = [20, 40, 60, 80] as const;

export interface LeoTriggerInput {
  memory: LeoSessionMemory;
  currentIndex: number;
  progress: number;        // 0–100
  inactivityMs: number;
  isReturningUser: boolean;
}

/**
 * Pure, deterministic function that decides whether and why Leo should trigger.
 * No side effects. Evaluate rules in priority order and return on first match.
 */
export function shouldTriggerLeo(input: LeoTriggerInput): LeoTriggerReason {
  const { memory, progress, inactivityMs, isReturningUser } = input;

  // 1. Welcome back returning user who has made meaningful progress
  if (isReturningUser && progress > 5) {
    return 'welcome_back';
  }

  // 2. Confusion signals from reading behavior
  const pauses = memory.behavior?.pauses ?? 0;
  const replays = memory.behavior?.replays ?? 0;
  if (replays >= 2 || pauses >= 3) {
    return 'confusion';
  }

  // 3. Inactivity — reader may have drifted off
  if (inactivityMs > 45_000) {
    return 'retention';
  }

  // 4. Progress checkpoint (crosses 20 / 40 / 60 / 80)
  const prevProgress = memory.sessionReadingProgress ?? 0;
  const crossedCheckpoint = CHECKPOINT_THRESHOLDS.some(
    (threshold) => prevProgress < threshold && progress >= threshold
  );
  if (crossedCheckpoint) {
    return 'checkpoint';
  }

  return null;
}
