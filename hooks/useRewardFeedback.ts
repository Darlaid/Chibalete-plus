/**
 * useRewardFeedback — React bridge for RewardEngine events.
 *
 * Subscribes to a RewardEngine instance and produces a list of auto-expiring
 * toast notifications. The hook owns nothing except the toast list; all logic
 * lives in the engine.
 *
 * Toasts auto-dismiss after TOAST_TTL_MS. Cleanup is handled correctly on
 * unmount so no setState is called on a dead component.
 *
 * Usage:
 *   const toasts = useRewardFeedback(rewardEngineRef.current);
 *   // Pass toasts to <RewardToasts toasts={toasts} />
 */

import { useState, useEffect, useRef } from 'react';
import type { RewardEngine, RewardEvent } from '../engines/RewardEngine';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export type ToastVariant = 'xp' | 'levelUp' | 'streak';

export interface RewardToast {
  id: string;
  variant: ToastVariant;
  message: string;
  subtext?: string;
  /**
   * Pre-computed CSS opacity (0.50–1.0).
   * Continuously scaled: 1.0 when rewards are ≥2s apart, 0.50 when back-to-back.
   * Omit or pass 1 for full brightness (levelUp is always full).
   */
  dimOpacity?: number;
}

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

// How long each toast variant stays visible.
// levelUp gets extra time — it's a milestone worth reading.
const TOAST_TTL_MS: Record<ToastVariant, number> = {
  xp:      2000,
  streak:  2800,
  levelUp: 4000,
};

// Delay before a toast appears — small random jitter (180–220ms) prevents
// mechanical uniformity when multiple rewards fire in quick succession.
const getShowDelay = () => 180 + Math.floor(Math.random() * 40);

// Maximum simultaneous toasts. Oldest is dropped if exceeded.
const MAX_SIMULTANEOUS_TOASTS = 2;

// Only show a streak toast when the multiplier tier actually changes,
// not on every single streak increment. These are the thresholds.
const STREAK_MILESTONE_MULTIPLIERS = new Set([1.5, 1.75, 2.0]);

// ---------------------------------------------------------------------------
// HOOK
// ---------------------------------------------------------------------------

export function useRewardFeedback(engine: RewardEngine | null): RewardToast[] {
  const [toasts, setToasts] = useState<RewardToast[]>([]);

  // Track pending timeouts so we can cancel them on unmount
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Timestamp of the last reward shown — used to detect dense reward bursts.
  const lastRewardTimestampRef = useRef<number>(0);

  // Cancel all pending dismiss timers on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach(id => clearTimeout(id));
      timers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!engine) return;

    const unsubscribe = engine.subscribe((event: RewardEvent) => {
      const toastsToAdd: RewardToast[] = [];

      // Continuous density dimming: full opacity when rewards are ≥2s apart,
      // minimum 0.50 when back-to-back. Linear interpolation between the two.
      const now = Date.now();
      const timeSinceLast = lastRewardTimestampRef.current > 0
        ? now - lastRewardTimestampRef.current
        : Infinity;
      lastRewardTimestampRef.current = now;
      const dimOpacity = timeSinceLast >= 2000
        ? 1
        : Math.max(0.50, 0.50 + (timeSinceLast / 2000) * 0.50);

      switch (event.type) {
        case 'xp': {
          const xp = event.xpGained ?? 0;
          const mult = event.multiplier ?? 1;
          const inRhythm = (event.state.streak ?? 0) >= 3;
          toastsToAdd.push({
            id: uid(),
            variant: 'xp',
            message: `+${xp} XP`,
            subtext: mult > 1
              ? (inRhythm ? `×${mult} en ritmo` : `×${mult} racha`)
              : undefined,
            dimOpacity,
          });
          break;
        }

        case 'levelUp': {
          toastsToAdd.push({
            id: uid(),
            variant: 'levelUp',
            message: `Nivel ${event.newLevel}`,
            subtext: '¡Subiste de nivel!',
            // levelUp is always a milestone — never dimmed regardless of timing
            dimOpacity: 1,
          });
          break;
        }

        case 'streakChange': {
          // Only surface a toast when a new multiplier tier unlocks
          const newMult = event.newMultiplier ?? 1;
          if (STREAK_MILESTONE_MULTIPLIERS.has(newMult)) {
            toastsToAdd.push({
              id: uid(),
              variant: 'streak',
              message: `Racha ×${newMult}`,
              subtext: `${event.newStreak} bloques seguidos`,
              dimOpacity,
            });
          }
          break;
        }
      }

      if (toastsToAdd.length === 0) return;

      // Delay appearance with slight jitter to avoid colliding with audio transitions
      const showId = setTimeout(() => {
        timers.current.delete(showId);

        setToasts(prev => {
          const combined = [...prev, ...toastsToAdd];
          // Density limit: drop oldest toasts if over cap
          return combined.length > MAX_SIMULTANEOUS_TOASTS
            ? combined.slice(combined.length - MAX_SIMULTANEOUS_TOASTS)
            : combined;
        });

        // Schedule auto-dismiss for each new toast
        toastsToAdd.forEach(toast => {
          const id = setTimeout(() => {
            timers.current.delete(id);
            setToasts(prev => prev.filter(t => t.id !== toast.id));
          }, TOAST_TTL_MS[toast.variant]);
          timers.current.add(id);
        });
      }, getShowDelay());

      timers.current.add(showId);
    });

    return () => { unsubscribe(); };
  }, [engine]); // re-subscribe only if engine instance changes

  return toasts;
}

// ---------------------------------------------------------------------------
// UTIL
// ---------------------------------------------------------------------------

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
