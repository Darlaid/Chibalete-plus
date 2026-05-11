/**
 * BlockEngine — deterministic reading-block timer.
 *
 * Pure TypeScript. Zero React. Zero side effects at import time.
 *
 * Design principles:
 *   - Elapsed is always computed from wall-clock timestamps, never from
 *     tick-count accumulation. A 100ms interval that fires late doesn't
 *     cause drift; the next tick self-corrects to the real elapsed time.
 *   - Only one interval ever exists at a time. startBlock() cancels any
 *     previous interval before creating a new one.
 *   - Visibility changes (tab hide/show) pause and resume automatically.
 *   - React never controls the timer. React only observes emitted events.
 *
 * Lifecycle:
 *   idle → running → paused ↔ running → completed
 *
 * Future engines (RewardEngine, TranceEngine) can subscribe to the same
 * instance and observe the same event stream.
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export type BlockStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface BlockState {
  blockId: number;        // increments on each startBlock() call
  status: BlockStatus;
  startTime: number;      // performance.now() when last started/resumed
  duration: number;       // block duration in ms
  elapsed: number;        // accumulated elapsed ms at last pause point
}

export type BlockEventType = 'start' | 'tick' | 'complete' | 'pause' | 'resume';

export interface BlockEvent {
  type: BlockEventType;
  blockId: number;
  elapsed: number;        // ms elapsed so far
  remaining: number;      // ms remaining (0 on complete)
  progress: number;       // 0–1 fraction
  duration: number;       // total block duration in ms
}

type BlockListener = (event: BlockEvent) => void;

// Internal tick frequency. High enough for smooth UI; low enough to be cheap.
// Elapsed is timestamp-based so this only affects emission frequency, not accuracy.
const TICK_HZ = 10; // 10 Hz = 100ms interval
const TICK_INTERVAL_MS = 1000 / TICK_HZ;

// ---------------------------------------------------------------------------
// ENGINE
// ---------------------------------------------------------------------------

export class BlockEngine {
  private state: BlockState = {
    blockId: 0,
    status: 'idle',
    startTime: 0,
    duration: 0,
    elapsed: 0,
  };

  private timerId: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Set<BlockListener> = new Set();

  // Tracks whether block was running before a tab-hide event, so it can
  // be auto-resumed when the tab becomes visible again.
  private wasRunningBeforeHide = false;

  // Bound reference so addEventListener/removeEventListener match.
  private readonly onVisibilityChange: () => void;

  constructor() {
    this.onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (this.state.status === 'running') {
          this.pause();
          this.wasRunningBeforeHide = true;
        }
      } else {
        if (this.wasRunningBeforeHide) {
          this.wasRunningBeforeHide = false;
          this.resume();
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------

  /**
   * Start a fresh block with the given duration (ms).
   * Cancels any running or paused block safely before starting the new one.
   * Calling with the same duration restarts from zero.
   */
  startBlock(durationMs: number): void {
    this.cancelTimer();
    this.state = {
      blockId: this.state.blockId + 1,
      status: 'running',
      startTime: performance.now(),
      duration: durationMs,
      elapsed: 0,
    };
    this.startTimer();
    this.emit('start');
  }

  /**
   * Pause the running block.
   * Snapshots the live elapsed time so resume is accurate.
   * No-op if not currently running.
   */
  pause(): void {
    if (this.state.status !== 'running') return;
    this.cancelTimer();
    this.state = {
      ...this.state,
      status: 'paused',
      // Snapshot elapsed so resume can continue from here
      elapsed: this.state.elapsed + (performance.now() - this.state.startTime),
    };
    this.emit('pause');
  }

  /**
   * Resume a paused block.
   * Resets startTime to now so the next tick calculates correctly.
   * No-op if not paused.
   */
  resume(): void {
    if (this.state.status !== 'paused') return;
    this.state = {
      ...this.state,
      status: 'running',
      startTime: performance.now(), // elapsed carries history; startTime resets
    };
    this.startTimer();
    this.emit('resume');
  }

  /**
   * Reset to idle. Cancels any running timer.
   * Does NOT emit an event — callers should check getState() after reset.
   */
  reset(): void {
    this.cancelTimer();
    this.wasRunningBeforeHide = false;
    this.state = {
      blockId: this.state.blockId,
      status: 'idle',
      startTime: 0,
      duration: 0,
      elapsed: 0,
    };
  }

  /**
   * Force-complete the current block.
   * Emits 'complete'. Idempotent.
   *
   * ⚠️ INVARIANTE 2 — NO REINTRODUCIR navegación automática entre libros.
   * El subscriber de este evento en VisorInmersivo debe limitarse a mostrar
   * la pantalla "Lectura Completada"; NO debe llamar navigate ni cambiar de
   * contentId. El contentId de la ruta gobierna la sesión inmersiva.
   * Ver docs/immersive-mode-invariants.md (INVARIANTE 2) y la suite
   * utils/__tests__/immersiveNavigation.test.js que falla si esto se rompe.
   */
  complete(): void {
    if (this.state.status === 'completed') return;
    this.cancelTimer();
    this.state = {
      ...this.state,
      status: 'completed',
      elapsed: this.state.duration,
    };
    this.emit('complete');
  }

  /**
   * Called from the external playback system when play state changes.
   *
   * Rules:
   *   - playing=true  + status=paused  → resume()
   *   - playing=true  + status=running → no-op (already going)
   *   - playing=true  + status=idle    → no-op (caller must call startBlock first)
   *   - playing=false + status=running → pause()
   *   - anything else                  → no-op
   *
   * This method intentionally does NOT call startBlock() — callers decide
   * when a new block begins. This prevents accidental block restarts on
   * mid-session play/pause cycles.
   */
  notifyPlayback(playing: boolean): void {
    if (playing) {
      if (this.state.status === 'paused') this.resume();
    } else {
      // FIX: clear the visibility auto-resume intent whenever the caller signals a
      // deliberate pause. Without this, hiding the tab while playing sets
      // wasRunningBeforeHide=true, and if the user then manually pauses while
      // the tab is still hidden, the block would auto-resume on tab restore —
      // overriding the user's explicit intent.
      this.wasRunningBeforeHide = false;
      if (this.state.status === 'running') this.pause();
    }
  }

  /**
   * Subscribe to block events.
   * Returns an unsubscribe function — call it on component unmount.
   */
  subscribe(listener: BlockListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Synchronous snapshot of current state. */
  getState(): Readonly<BlockState> {
    return { ...this.state };
  }

  /**
   * Live elapsed time in ms.
   * Includes in-progress run time since last resume, not just the snapshotted
   * elapsed stored in state.
   */
  getLiveElapsed(): number {
    if (this.state.status === 'running') {
      return this.state.elapsed + (performance.now() - this.state.startTime);
    }
    return this.state.elapsed;
  }

  /**
   * Destroy the engine: cancel timer and remove global event listeners.
   * Call this when the owning component unmounts.
   */
  destroy(): void {
    this.cancelTimer();
    this.listeners.clear();
    this.wasRunningBeforeHide = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE — timer loop
  // -------------------------------------------------------------------------

  private startTimer(): void {
    // Single-interval guarantee: never create a second interval if one exists
    if (this.timerId !== null) return;
    this.timerId = setInterval(() => { this.tick(); }, TICK_INTERVAL_MS);
  }

  private cancelTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Core loop body. Called by the interval.
   *
   * Key principle: elapsed is computed from wall-clock difference, not from
   * the number of ticks. If the interval fires 10ms late, the elapsed is still
   * accurate. Drift is impossible.
   */
  private tick(): void {
    if (this.state.status !== 'running') {
      // Shouldn't happen (cancelTimer is always called on pause/complete),
      // but defensive: clean up stray interval if it fires out of phase.
      this.cancelTimer();
      return;
    }

    const liveElapsed = this.getLiveElapsed();

    if (liveElapsed >= this.state.duration) {
      // Duration exceeded: fire complete, not another tick
      this.complete();
      return;
    }

    this.emit('tick');
  }

  // -------------------------------------------------------------------------
  // PRIVATE — event emission
  // -------------------------------------------------------------------------

  private emit(type: BlockEventType): void {
    if (this.listeners.size === 0) return;

    const liveElapsed = Math.min(this.getLiveElapsed(), this.state.duration);
    const remaining = Math.max(0, this.state.duration - liveElapsed);
    const progress = this.state.duration > 0
      ? Math.min(1, liveElapsed / this.state.duration)
      : 0;

    const event: BlockEvent = {
      type,
      blockId: this.state.blockId,
      elapsed: liveElapsed,
      remaining,
      progress,
      duration: this.state.duration,
    };

    // Iterate over a snapshot to be safe if a listener unsubscribes during emission
    [...this.listeners].forEach(l => l(event));
  }
}
