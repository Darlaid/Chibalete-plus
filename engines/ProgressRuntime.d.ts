/**
 * ProgressRuntime.d.ts — política de persistencia.
 */

import type { SessionId, ContentId, UserId, SessionIndex } from './immersiveRuntimeTypes';
import type { Diagnostics } from './Diagnostics';
import type { AudioRuntime, SessionRef } from './AudioRuntime';

export interface ProgressCommitInput {
  sessionId: SessionId;
  contentId: ContentId | undefined;
  userId:    UserId | undefined;
  index:     SessionIndex;
}
export type ProgressCommit = (input: ProgressCommitInput) => void | Promise<void>;

export interface ProgressPolicy {
  /** Índice mínimo a partir del cual se permite save. Default 0. */
  minIndex?: SessionIndex;
  /** Si true (default) requiere markVisualConfirmed previo. */
  requireVisualConfirmed?: boolean;
}

export interface ProgressSession {
  id:        SessionId;
  contentId: ContentId;
  userId:    UserId;
}

export interface ProgressRuntimeOptions {
  commit?:       ProgressCommit;
  policy?:       ProgressPolicy;
  audioRuntime?: AudioRuntime | null;
  diagnostics?:  Diagnostics  | null;
}

export interface ScheduleResult {
  scheduled: boolean;
  reason?:   string;
}
export interface FlushResult {
  flushed: number;
}

export interface ProgressRuntime {
  registerSession(session: ProgressSession): void;
  markVisualConfirmed(session: SessionRef, index: SessionIndex): void;
  canSave(session: SessionRef, index: SessionIndex): boolean;
  schedule(session: SessionRef, index: SessionIndex): ScheduleResult;
  flushPending(session: SessionRef): FlushResult;
  releaseFor(session: SessionRef): void;
}

export function createProgressRuntime(opts?: ProgressRuntimeOptions): ProgressRuntime;
