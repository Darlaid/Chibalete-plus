/**
 * RewardEngine — reading-block progression system.
 *
 * Pure TypeScript. Zero React. Zero side effects at import time.
 *
 * Subscribes directly to a BlockEngine instance and transforms block
 * completions into XP, streaks, and level progression.
 *
 * Design principles:
 *   - Non-intrusive: reward events are emitted, never forced onto the UI.
 *   - Deterministic: same inputs always produce same outputs.
 *   - Persistent: state survives page refreshes via localStorage.
 *   - Streak-aware: tracks inter-block timing to reward consistency.
 *
 * XP formula:
 *   xpGained = BASE_XP * streakMultiplier(streak)
 *
 * Level thresholds (cumulative XP):
 *   threshold(n) = 25 * (n-1) * n
 *   Level 1: 0  |  2: 50  |  3: 150  |  4: 300  |  5: 500  |  6: 750 …
 *   Each level requires 50 more XP than the previous one.
 *
 * Streak multipliers:
 *   1 block  → 1.0×
 *   2 blocks → 1.5×
 *   3 blocks → 1.75×
 *   4+ blocks → 2.0×
 *
 * Streak window: next block must start within STREAK_WINDOW_MS of the
 * previous block completing, otherwise the streak resets.
 */

import type { BlockEngine, BlockEvent } from './BlockEngine';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const BASE_XP = 10;
const STREAK_WINDOW_MS = 30_000; // 30 seconds between blocks to maintain streak

const STREAK_MULTIPLIERS: Record<number, number> = {
  1: 1.0,
  2: 1.5,
  3: 1.75,
};
const MAX_STREAK_MULTIPLIER = 2.0; // applied at streak 4+

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Persisted subset of state — stored to localStorage. */
interface PersistedRewardState {
  xp: number;
  level: number;
  streak: number;
  blocksCompleted: number;
  lastBlockTimestamp: number; // Date.now() at last block completion
}

/** Full runtime state — includes computed fields for convenience. */
export interface RewardState extends PersistedRewardState {
  xpInCurrentLevel: number;   // XP earned within the current level span
  xpForCurrentLevel: number;  // total XP span for the current level
  levelProgress: number;      // 0–1 fraction of progress through current level
  xpToNextLevel: number;      // XP still needed to reach next level
  multiplier: number;         // active streak multiplier
}

export type RewardEventType = 'xp' | 'levelUp' | 'streakChange';

export interface RewardEvent {
  type: RewardEventType;
  state: RewardState;
  // xp
  xpGained?: number;
  multiplier?: number;
  // levelUp
  oldLevel?: number;
  newLevel?: number;
  // streakChange
  oldStreak?: number;
  newStreak?: number;
  newMultiplier?: number;
}

type RewardListener = (event: RewardEvent) => void;

// ---------------------------------------------------------------------------
// ENGINE
// ---------------------------------------------------------------------------

export class RewardEngine {
  private state: PersistedRewardState;
  private readonly storageKey: string;
  private readonly listeners: Set<RewardListener> = new Set();
  private readonly unsubscribeFromBlock: () => void;

  // Set true in onBlockStart if the block started within the streak window.
  // Read in onBlockComplete to decide whether to increment or reset streak.
  private pendingStreakContinuation = false;

  // True when the reader has been in a continuous reading flow (streak >= 3
  // with no gaps). Internal only — no UI driven from this yet.
  private isInFocusFlow = false;

  constructor(blockEngine: BlockEngine, userId?: string) {
    this.storageKey = `chibalete_rewards_${userId || 'guest'}`;
    this.state = this.loadState();

    // Subscribe to block events. Unsubscribe handle is stored for destroy().
    this.unsubscribeFromBlock = blockEngine.subscribe((event: BlockEvent) => {
      if (event.type === 'start') {
        this.onBlockStart();
      } else if (event.type === 'complete') {
        this.onBlockComplete();
      }
    });
  }

  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------

  subscribe(listener: RewardListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getState(): RewardState {
    return this.buildRuntimeState(this.state);
  }

  /** True when streak >= 3 and blocks have been continuous. UI hook for future Trance Mode. */
  getIsInFocusFlow(): boolean {
    return this.isInFocusFlow;
  }

  /**
   * Clean up: unsubscribe from BlockEngine, save state, clear listeners.
   * Call when the owning component unmounts.
   */
  destroy(): void {
    this.unsubscribeFromBlock();
    this.saveState();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // PRIVATE — block event handlers
  // -------------------------------------------------------------------------

  private onBlockStart(): void {
    const now = Date.now();
    const gap = now - this.state.lastBlockTimestamp;
    // A timestamp of 0 means this is the very first block ever — start a fresh streak.
    this.pendingStreakContinuation =
      this.state.lastBlockTimestamp > 0 && gap < STREAK_WINDOW_MS;
  }

  private onBlockComplete(): void {
    const oldLevel = this.state.level;
    const oldStreak = this.state.streak;

    // --- Streak ---
    const wasContinuing = this.pendingStreakContinuation;
    const newStreak = wasContinuing ? this.state.streak + 1 : 1;
    this.pendingStreakContinuation = false;

    // --- XP ---
    const multiplier = this.getMultiplier(newStreak);
    const xpGained = Math.round(BASE_XP * multiplier);
    const newXp = this.state.xp + xpGained;

    // --- Level ---
    const newLevel = this.computeLevel(newXp);

    this.state = {
      xp: newXp,
      level: newLevel,
      streak: newStreak,
      blocksCompleted: this.state.blocksCompleted + 1,
      lastBlockTimestamp: Date.now(),
    };

    this.saveState();

    // Update focus-flow flag: engaged when streak is high and continuation was unbroken
    this.isInFocusFlow = newStreak >= 3 && wasContinuing;

    // Emit events in order: streakChange → xp → levelUp
    if (newStreak !== oldStreak) {
      const oldMult = this.getMultiplier(oldStreak);
      const newMult = this.getMultiplier(newStreak);
      // Only emit when the multiplier tier actually changes.
      // At streak 4+ (all 2.0×), no further streakChange events are needed.
      if (oldMult !== newMult) {
        this.emit({
          type: 'streakChange',
          state: this.buildRuntimeState(this.state),
          oldStreak,
          newStreak,
          newMultiplier: newMult,
        });
      }
    }

    this.emit({
      type: 'xp',
      state: this.buildRuntimeState(this.state),
      xpGained,
      multiplier,
    });

    if (newLevel > oldLevel) {
      this.emit({
        type: 'levelUp',
        state: this.buildRuntimeState(this.state),
        oldLevel,
        newLevel,
      });
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE — XP / level math
  // -------------------------------------------------------------------------

  /**
   * Cumulative XP threshold to reach level n.
   * threshold(1) = 0, threshold(2) = 50, threshold(3) = 150 …
   * Each level requires 50 more XP than the previous.
   * Formula: 25 * (n-1) * n
   */
  private xpThreshold(level: number): number {
    if (level <= 1) return 0;
    return 25 * (level - 1) * level;
  }

  /** XP span (width) of a given level. Level n spans xpThreshold(n+1) - xpThreshold(n). */
  private xpSpanForLevel(level: number): number {
    return this.xpThreshold(level + 1) - this.xpThreshold(level);
  }

  /** Highest level whose threshold ≤ totalXp. */
  private computeLevel(totalXp: number): number {
    let level = 1;
    while (this.xpThreshold(level + 1) <= totalXp) {
      level++;
    }
    return level;
  }

  private getMultiplier(streak: number): number {
    if (streak >= 4) return MAX_STREAK_MULTIPLIER;
    return STREAK_MULTIPLIERS[streak] ?? 1.0;
  }

  // -------------------------------------------------------------------------
  // PRIVATE — runtime state builder (adds computed fields)
  // -------------------------------------------------------------------------

  private buildRuntimeState(s: PersistedRewardState): RewardState {
    const levelStart = this.xpThreshold(s.level);
    const levelSpan = this.xpSpanForLevel(s.level);
    const xpInCurrentLevel = s.xp - levelStart;
    const levelProgress = levelSpan > 0 ? Math.min(1, xpInCurrentLevel / levelSpan) : 1;

    return {
      ...s,
      xpInCurrentLevel,
      xpForCurrentLevel: levelSpan,
      levelProgress,
      xpToNextLevel: Math.max(0, levelSpan - xpInCurrentLevel),
      multiplier: this.getMultiplier(s.streak),
    };
  }

  // -------------------------------------------------------------------------
  // PRIVATE — persistence
  // -------------------------------------------------------------------------

  private loadState(): PersistedRewardState {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedRewardState>;
        // Validate required fields to guard against corrupt/stale data
        if (
          typeof parsed.xp === 'number' &&
          typeof parsed.level === 'number' &&
          typeof parsed.streak === 'number'
        ) {
          return {
            xp: parsed.xp,
            level: parsed.level,
            streak: parsed.streak,
            blocksCompleted: parsed.blocksCompleted ?? 0,
            lastBlockTimestamp: parsed.lastBlockTimestamp ?? 0,
          };
        }
      }
    } catch { /* localStorage unavailable or corrupt */ }

    return {
      xp: 0,
      level: 1,
      streak: 0,
      blocksCompleted: 0,
      lastBlockTimestamp: 0,
    };
  }

  private saveState(): void {
    try {
      const toSave: PersistedRewardState = {
        xp: this.state.xp,
        level: this.state.level,
        streak: this.state.streak,
        blocksCompleted: this.state.blocksCompleted,
        lastBlockTimestamp: this.state.lastBlockTimestamp,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(toSave));
    } catch { /* localStorage full or unavailable */ }
  }

  // -------------------------------------------------------------------------
  // PRIVATE — event emission
  // -------------------------------------------------------------------------

  private emit(event: RewardEvent): void {
    if (this.listeners.size === 0) return;
    [...this.listeners].forEach(l => l(event));
  }
}
