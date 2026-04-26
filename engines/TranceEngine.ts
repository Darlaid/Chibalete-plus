/**
 * TranceEngine — deep-focus UI fade system.
 *
 * Pure TypeScript. Zero React. Zero side effects at import time.
 *
 * Subscribes to RewardEngine and gradually increases an intensity value
 * (0 → 1) when the reader enters a focus flow (streak >= 3, continuous).
 * Deactivates instantly when the flow breaks or playback stops.
 *
 * The UI layer uses `intensity` to proportionally reduce the opacity of
 * chrome elements (header, controls, Leo button), letting the reading text
 * dominate. All visual smoothness is handled by CSS `transition` on the
 * consumer side — the engine only provides the target value.
 *
 * Lifecycle:
 *   idle (intensity=0) ←→ active (intensity ramps 0→1 over RAMP_DURATION_MS)
 *
 * Activation:  rewardEngine.getIsInFocusFlow() === true  (after a block completes)
 * Deactivation: streak breaks  OR  notifyPlayback(false) called
 */

import type { RewardEngine } from './RewardEngine';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/** Wall-clock duration from activation to full intensity (ms). */
const RAMP_DURATION_MS = 45_000;

/** How often intensity is recomputed and emitted while active (ms). */
const RAMP_TICK_MS = 2_000;

/**
 * Intensity ceiling. Capping below 1.0 ensures chrome elements are never
 * fully invisible, preserving a minimal sense of user control at peak flow.
 * At 0.92 the header sits at ~8% opacity and controls at ~18% — perceivable
 * but non-distracting.
 */
const MAX_INTENSITY = 0.92;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface TranceState {
  isActive: boolean;
  intensity: number;             // 0–MAX_INTENSITY (0.92), increases gradually while active

  // Derived signals for the UI layer. Thresholds are intentionally conservative
  // so the fade feels organic rather than stepped.
  shouldFadeUI: boolean;         // intensity >= 0.25 — subtle chrome dimming
  shouldHideControls: boolean;   // intensity >= 0.55 — controls noticeably faint
  shouldReduceContrast: boolean; // intensity >= 0.70 — max immersion
}

type TranceListener = (state: TranceState) => void;

const INITIAL_STATE: TranceState = {
  isActive: false,
  intensity: 0,
  shouldFadeUI: false,
  shouldHideControls: false,
  shouldReduceContrast: false,
};

// ---------------------------------------------------------------------------
// ENGINE
// ---------------------------------------------------------------------------

export class TranceEngine {
  private state: TranceState = { ...INITIAL_STATE };

  private activationTime = 0;
  private rampTimerId: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Set<TranceListener> = new Set();
  private readonly unsubscribeFromReward: () => void;

  // Current streak carried from RewardEngine for sessionMomentum calculation.
  private currentStreak = 0;

  constructor(rewardEngine: RewardEngine) {
    // Subscribe to all reward events.
    // isInFocusFlow is updated in RewardEngine *before* the xp event fires,
    // so by the time we read it here the flag already reflects the new state.
    this.unsubscribeFromReward = rewardEngine.subscribe((event) => {
      // Keep streak in sync — used by getSessionMomentum()
      if (event.state) this.currentStreak = event.state.streak ?? 0;

      const inFlow = rewardEngine.getIsInFocusFlow();
      if (inFlow && !this.state.isActive) {
        this.activate();
      } else if (!inFlow && this.state.isActive) {
        this.deactivate();
      }
    });
  }

  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------

  /**
   * Notify the engine that playback state changed.
   * Stopping playback immediately deactivates trance — we don't wait for the
   * next block completion to confirm the streak is broken.
   */
  notifyPlayback(playing: boolean): void {
    if (!playing && this.state.isActive) {
      this.deactivate();
    }
    // play = true: we intentionally do NOT re-activate here.
    // Activation only comes from a confirmed focus-flow signal in RewardEngine.
  }

  subscribe(listener: TranceListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getState(): TranceState {
    return { ...this.state };
  }

  /**
   * Composite 0–1 score reflecting how deep the reader is in a focus session.
   * Combines streak depth (40%), time-in-flow (25%), and current trance intensity (35%).
   * Returns 0 when no flow is active.
   */
  getSessionMomentum(): number {
    const streakFactor = Math.min(1, this.currentStreak / 10);
    const flowDurationFactor = this.state.isActive
      ? Math.min(1, (Date.now() - this.activationTime) / RAMP_DURATION_MS)
      : 0;
    return streakFactor * 0.40 + flowDurationFactor * 0.25 + this.state.intensity * 0.35;
  }

  /**
   * Tear down: cancel ramp interval, unsubscribe from RewardEngine, clear listeners.
   * Call when the owning component unmounts.
   */
  destroy(): void {
    this.cancelRamp();
    this.unsubscribeFromReward();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // PRIVATE
  // -------------------------------------------------------------------------

  private activate(): void {
    this.activationTime = Date.now();
    this.state = { ...this.state, isActive: true };
    this.startRamp();
    this.emit();
  }

  private deactivate(): void {
    this.cancelRamp();
    this.activationTime = 0;
    // Reset to zero immediately. The CSS transition on the consumer handles
    // the visual ease-out — no need to ramp down in the engine.
    this.state = { ...INITIAL_STATE };
    this.emit();
  }

  private startRamp(): void {
    if (this.rampTimerId !== null) return; // already running

    this.rampTimerId = setInterval(() => {
      if (!this.state.isActive) {
        this.cancelRamp();
        return;
      }

      const elapsed = Date.now() - this.activationTime;
      const progress = Math.min(1, elapsed / RAMP_DURATION_MS);
      // easeInOutQuad: gentle ramp-in (avoids abrupt early jump) and soft
      // saturation approach at the top (avoids sudden full-intensity snap).
      // Capped at MAX_INTENSITY to preserve minimal chrome visibility.
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const intensity = Math.min(MAX_INTENSITY, eased);

      this.state = {
        ...this.state,
        intensity,
        shouldFadeUI: intensity >= 0.25,
        shouldHideControls: intensity >= 0.55,
        shouldReduceContrast: intensity >= 0.70,
      };

      this.emit();

      if (progress >= 1) this.cancelRamp(); // reached max, stop ticking
    }, RAMP_TICK_MS);
  }

  private cancelRamp(): void {
    if (this.rampTimerId !== null) {
      clearInterval(this.rampTimerId);
      this.rampTimerId = null;
    }
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = { ...this.state };
    [...this.listeners].forEach(l => l(snapshot));
  }
}
