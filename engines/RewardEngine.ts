/**
 * RewardEngine — continuidad de lectura del Modo Inmersivo (señal técnica).
 *
 * Pure TypeScript. Zero React. Zero side effects at import time.
 *
 * G4-UX-U0: ya no otorga XP, niveles ni rachas. Esos reconocimientos vivían en
 * el localStorage del navegador y contradecían al ledger del servidor (único
 * origen de verdad del XP). El nombre del archivo y de la clase se conserva por
 * compatibilidad con los guards del inmersivo (`scripts/lint-immersive-guards.mjs`)
 * y las pruebas estructurales que lo referencian.
 *
 * Lo único que queda es una medida técnica, en memoria y solo durante la sesión:
 * cuántos bloques de lectura seguidos completó el lector, sin pausas largas
 * entre ellos. La usan:
 *   - TranceEngine, para atenuar la interfaz cuando hay concentración sostenida;
 *   - la telemetría de lectura (campo `streak` de los eventos, que el servidor
 *     usa para `tranceEntryRate` y `streakBreakRate`).
 * Nada se muestra al lector como premio y nada se persiste en el navegador.
 *
 * Continuidad: el siguiente bloque debe empezar dentro de CONTINUITY_WINDOW_MS
 * desde que terminó el anterior; si no, la cuenta vuelve a 1.
 */

import type { BlockEngine, BlockEvent } from './BlockEngine';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const CONTINUITY_WINDOW_MS = 30_000; // pausa máxima entre bloques para seguir contando
const FOCUS_FLOW_MIN_BLOCKS = 3;     // bloques seguidos que activan la atenuación

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** Estado técnico de la sesión. Solo en memoria. */
export interface RewardState {
  consecutiveBlocks: number;   // bloques seguidos sin pausa larga
  blocksCompleted: number;     // bloques completados en esta sesión
  lastBlockTimestamp: number;  // Date.now() del último bloque completado (0 = ninguno)
}

export type RewardEventType = 'continuity';

export interface RewardEvent {
  type: RewardEventType;
  state: RewardState;
  previousConsecutiveBlocks: number;
}

type RewardListener = (event: RewardEvent) => void;

// ---------------------------------------------------------------------------
// ENGINE
// ---------------------------------------------------------------------------

export class RewardEngine {
  private state: RewardState = { consecutiveBlocks: 0, blocksCompleted: 0, lastBlockTimestamp: 0 };
  private readonly listeners: Set<RewardListener> = new Set();
  private readonly unsubscribeFromBlock: () => void;

  // Set true in onBlockStart if the block started within the continuity window.
  private pendingContinuation = false;

  // True when the reader has completed FOCUS_FLOW_MIN_BLOCKS blocks in a row
  // without long pauses. Read by TranceEngine.
  private isInFocusFlow = false;

  constructor(blockEngine: BlockEngine) {
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
    return { ...this.state };
  }

  /** True con FOCUS_FLOW_MIN_BLOCKS o más bloques seguidos. Lo consume TranceEngine. */
  getIsInFocusFlow(): boolean {
    return this.isInFocusFlow;
  }

  /** Unsubscribe from BlockEngine and clear listeners. Call on unmount. */
  destroy(): void {
    this.unsubscribeFromBlock();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // PRIVATE — block event handlers
  // -------------------------------------------------------------------------

  private onBlockStart(): void {
    const gap = Date.now() - this.state.lastBlockTimestamp;
    // A timestamp of 0 means no block completed yet in this session.
    this.pendingContinuation = this.state.lastBlockTimestamp > 0 && gap < CONTINUITY_WINDOW_MS;
  }

  private onBlockComplete(): void {
    const previous = this.state.consecutiveBlocks;
    const wasContinuing = this.pendingContinuation;
    this.pendingContinuation = false;

    this.state = {
      consecutiveBlocks: wasContinuing ? previous + 1 : 1,
      blocksCompleted: this.state.blocksCompleted + 1,
      lastBlockTimestamp: Date.now(),
    };

    // Updated BEFORE emitting, so listeners (TranceEngine) read the new value.
    this.isInFocusFlow = this.state.consecutiveBlocks >= FOCUS_FLOW_MIN_BLOCKS && wasContinuing;

    this.emit({ type: 'continuity', state: this.getState(), previousConsecutiveBlocks: previous });
  }

  // -------------------------------------------------------------------------
  // PRIVATE — event emission
  // -------------------------------------------------------------------------

  private emit(event: RewardEvent): void {
    if (this.listeners.size === 0) return;
    [...this.listeners].forEach(l => l(event));
  }
}
