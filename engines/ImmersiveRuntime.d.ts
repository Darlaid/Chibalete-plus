/**
 * ImmersiveRuntime.d.ts — orquestador top-level.
 */

import type {
  SessionId, ContentId, OpenSessionArgs, RuntimeAction,
  RuntimeSnapshot, Listener, Unsubscribe,
  VisibilityReport, SessionIndex, DiagnosticEvent,
} from './immersiveRuntimeTypes';
import type { AudioRuntime } from './AudioRuntime';
import type { VisibilityCoordinator } from './VisibilityCoordinator';
import type { ProgressRuntime } from './ProgressRuntime';
import type { RuntimeStore } from './RuntimeStore';
import type { Diagnostics } from './Diagnostics';
import type { ImmersiveSession, HydrateContent, OpResult } from './ImmersiveSession';

export interface ImmersiveRuntimeOptions {
  diagnostics?:        Diagnostics;
  store?:              RuntimeStore;
  audio?:              AudioRuntime;
  visibility?:         VisibilityCoordinator;
  progress?:           ProgressRuntime;
  hydrateContent?:     HydrateContent;
  visibilityTimeoutMs?: number;
  idPrefix?:           string;
}

export interface OpenSessionResult {
  ok:       boolean;
  error?:   import('./immersiveRuntimeTypes').SessionError;
  session?: ImmersiveSession;
}

export interface RuntimeDiagnosticsAccessor {
  exportTrace(sessionId?: SessionId | null): readonly DiagnosticEvent[];
  getRecentEvents(limit?: number): readonly DiagnosticEvent[];
  log(event: { kind: string; sessionId?: SessionId | null; contentId?: ContentId | null; data?: Record<string, unknown> }): void;
}

export interface ImmersiveRuntime {
  openSession(args: OpenSessionArgs): Promise<OpenSessionResult>;
  closeSession(reason?: string): Promise<OpResult>;
  /**
   * Sprint M-3.2 — cierra la sesión activa SIN esperar al openLock ni a
   * operaciones en flight. Útil para unmount inmediato cuando audio está
   * colgado. Sincrónico. Idempotente.
   */
  forceClose(reason?: string): OpResult;
  /**
   * Sprint M-3.4 — sale del estado terminal `error` reabriendo la sesión
   * con el mismo contentId/userId. Si preserveIndex (default true), conserva
   * currentIndex; si false, vuelve a 0.
   *
   * Devuelve {ok:true, reason:'no_error_to_recover'} si la sesión NO está
   * en error. Devuelve {ok:false, error: aborted} si runtime destroyed.
   */
  recoverFromError(opts?: {
    preserveIndex?: boolean;
  }): Promise<OpenSessionResult>;
  /**
   * Libera TODOS los recursos del runtime: visibility timers, audio,
   * progress queue, store listeners, diagnostics buffer. Idempotente.
   * Tras destroy, openSession devuelve {ok:false, error: aborted}.
   */
  destroy(reason?: string): Promise<{ ok: boolean; reason?: string }>;
  dispatch(action: RuntimeAction): Promise<OpResult>;
  reportVisibility(sessionId: SessionId, index: SessionIndex, result: VisibilityReport): void;
  subscribe(listener: Listener): Unsubscribe;
  getSnapshot(): RuntimeSnapshot;
  getActiveSession(): ImmersiveSession | null;
  readonly diagnostics: RuntimeDiagnosticsAccessor;
  /** Subsistemas internos — uso de tests, no del viewer. */
  readonly _internal: {
    audio:       AudioRuntime;
    visibility:  VisibilityCoordinator;
    progress:    ProgressRuntime;
    store:       RuntimeStore;
    diagnostics: Diagnostics;
  };
}

export function createImmersiveRuntime(opts?: ImmersiveRuntimeOptions): ImmersiveRuntime;
