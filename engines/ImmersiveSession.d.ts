/**
 * ImmersiveSession.d.ts — tipos de la sesión + state machine.
 */

import type {
  SessionId, ContentId, UserId, SessionIndex, LifecycleToken,
  SessionStatus, RuntimeAction, SessionError, GoToSource,
} from './immersiveRuntimeTypes';
import type { AudioRuntime } from './AudioRuntime';
import type { VisibilityCoordinator } from './VisibilityCoordinator';
import type { ProgressRuntime } from './ProgressRuntime';
import type { RuntimeStore } from './RuntimeStore';
import type { Diagnostics } from './Diagnostics';

export interface SessionContext {
  id:        SessionId;
  contentId: ContentId;
  userId:    UserId;
}

export interface HydrateContentArgs {
  contentId: ContentId;
}
export interface HydrateContentResult {
  totalIndices: SessionIndex;
}
export type HydrateContent = (args: HydrateContentArgs) => Promise<HydrateContentResult>;

export interface CreateSessionArgs extends SessionContext {
  lifecycleToken:      LifecycleToken;
  startIndex?:         SessionIndex;
  totalIndices?:       SessionIndex;
  audio?:              AudioRuntime | null;
  visibility?:         VisibilityCoordinator | null;
  progress?:           ProgressRuntime | null;
  store?:              RuntimeStore | null;
  diagnostics?:        Diagnostics | null;
  hydrateContent?:     HydrateContent;
  visibilityTimeoutMs?: number;
}

export interface OpResult {
  ok:      boolean;
  error?:  SessionError;
  reason?: string;
  index?:  SessionIndex;
  source?: GoToSource;
}

export interface ImmersiveSession {
  readonly id:        SessionId;
  readonly contentId: ContentId;
  readonly userId:    UserId;

  getStatus(): SessionStatus;
  getToken():  LifecycleToken;
  getRef():    SessionContext;
  getCurrentIndex(): SessionIndex;
  getTotal(): SessionIndex;

  open(): Promise<OpResult>;

  play():   Promise<OpResult>;
  pause():  Promise<OpResult>;
  resume(): Promise<OpResult>;
  goTo(index: SessionIndex, source: GoToSource): Promise<OpResult>;
  close(reason?: string): Promise<OpResult>;
  /**
   * Sprint M-3.2 — cierra la sesión SIN pasar por la OperationQueue.
   * Útil cuando una operación en flight queda colgada (audio.play() bloqueada
   * por autoplay policy, fetch lento). Sincrónico hasta status='closed'.
   * Idempotente.
   */
  forceClose(reason?: string): OpResult;

  enqueueOperation(action: RuntimeAction | { kind: 'close'; reason?: string }): Promise<OpResult>;

  assertLive(capturedToken: LifecycleToken, op: string): void;
  isLive(capturedToken: LifecycleToken): boolean;

  setVisualReady(value: boolean): void;
}

export function createImmersiveSession(args: CreateSessionArgs): ImmersiveSession;

export const TRANSITIONS: Readonly<Record<SessionStatus, ReadonlySet<SessionStatus>>>;
