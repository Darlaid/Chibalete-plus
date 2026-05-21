/**
 * Diagnostics.d.ts — tipos públicos del sink de diagnóstico V2.
 */

import type { DiagnosticEvent, DiagnosticEventKind, SessionId, ContentId } from './immersiveRuntimeTypes';

export interface DiagnosticsCreateOptions {
  /** Tamaño máximo del ring buffer. Default: 5000. */
  capacity?: number;
}

export interface DiagnosticsLogInput {
  ts?:        number;
  sessionId?: SessionId | null;
  contentId?: ContentId | null;
  kind:       DiagnosticEventKind;
  data?:      Readonly<Record<string, unknown>>;
}

export type DiagnosticsListener = (event: DiagnosticEvent) => void;
export type DiagnosticsUnsubscribe = () => void;

export interface Diagnostics {
  log(event: DiagnosticsLogInput): void;
  /**
   * Sprint M-4.3 — listener invocado POST log con el evento ya frozen.
   * Listener throws se aíslan y NO afectan el sink ni otros listeners.
   * Backward-compatible: si no hay listeners, la performance es idéntica
   * a la del sink puro pre-M-4.3.
   */
  subscribe(listener: DiagnosticsListener): DiagnosticsUnsubscribe;
  getRecentEvents(limit?: number): readonly DiagnosticEvent[];
  /**
   * sessionId === undefined → todos los eventos.
   * sessionId === null      → solo eventos sin sessionId (errores pre-sesión).
   * sessionId === string    → subset de esa sesión.
   */
  exportTrace(sessionId?: SessionId | null): readonly DiagnosticEvent[];
  clear(): void;
}

export function createDiagnostics(opts?: DiagnosticsCreateOptions): Diagnostics;
