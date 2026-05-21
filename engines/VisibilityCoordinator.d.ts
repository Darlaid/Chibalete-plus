/**
 * VisibilityCoordinator.d.ts — tipos del coordinador viewer-driven.
 */

import type {
  SessionId, ContentId, SessionIndex,
  VisibilityReport, SessionError,
} from './immersiveRuntimeTypes';
import type { Diagnostics } from './Diagnostics';
import type { SessionRef } from './AudioRuntime';

export interface VisibilityCoordinatorOptions {
  /** Default timeout para awaitConfirmation. Default: 5000ms. */
  timeoutMs?:    number;
  diagnostics?:  Diagnostics | null;
}

export interface AwaitOptions {
  timeoutMs?: number;
}

export interface VisibilityCoordinator {
  /**
   * Devuelve una promesa que resuelve cuando el viewer reporte
   * visible:true para (session, index), o rechaza con visibility_timeout
   * si nadie reporta dentro del timeout.
   */
  awaitConfirmation(
    session:  SessionRef,
    index:    SessionIndex,
    options?: AwaitOptions,
  ): Promise<{ visible: true }>;

  /** Punto de entrada del viewer. Reportes huérfanos se descartan silenciosamente. */
  reportFromViewer(
    sessionId: SessionId,
    index:     SessionIndex,
    result:    VisibilityReport,
  ): void;

  /** Cancela TODAS las pendientes de la sesión. Las promesas rechazan con `aborted`. */
  cancelForSession(sessionId: SessionId): void;

  /**
   * Cancela TODAS las pendientes de TODAS las sesiones. Usado por
   * runtime.destroy() para garantizar limpieza completa de timers.
   */
  cancelAll(reason?: string): void;
}

export function createVisibilityCoordinator(
  opts?: VisibilityCoordinatorOptions,
): VisibilityCoordinator;
