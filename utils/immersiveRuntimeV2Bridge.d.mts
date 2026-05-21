/**
 * immersiveRuntimeV2Bridge.d.ts — tipos del bridge viewer ↔ runtime V2.
 */

import type {
  SessionId, ContentId, UserId, SessionIndex,
  GoToSource, SessionError,
} from '../engines/immersiveRuntimeTypes';
import type { ImmersiveRuntime, ImmersiveRuntimeOptions } from '../engines/ImmersiveRuntime';
import type { OpResult } from '../engines/ImmersiveSession';

export type ViewerRuntimeOptions = ImmersiveRuntimeOptions;

export function createViewerRuntime(opts?: ViewerRuntimeOptions): ImmersiveRuntime;

export function dispatchPlay(runtime: ImmersiveRuntime): Promise<OpResult>;
export function dispatchPause(runtime: ImmersiveRuntime): Promise<OpResult>;
export function dispatchResume(runtime: ImmersiveRuntime): Promise<OpResult>;
export function dispatchGoTo(
  runtime: ImmersiveRuntime,
  index: SessionIndex,
  source?: GoToSource,
): Promise<OpResult>;
export function dispatchPrev(runtime: ImmersiveRuntime): Promise<OpResult>;
export function dispatchNext(runtime: ImmersiveRuntime): Promise<OpResult>;

export interface ReportResult {
  dispatched: boolean;
  reason?: 'stale_session' | 'invalid_index' | 'out_of_range';
}

export function reportVisible(
  runtime: ImmersiveRuntime,
  sessionId: SessionId,
  index: SessionIndex,
): ReportResult;

export function reportInvisible(
  runtime: ImmersiveRuntime,
  sessionId: SessionId,
  index: SessionIndex,
  reason?: string,
): ReportResult;

export interface OpenContentArgs {
  contentId:    ContentId;
  userId:       UserId;
  startIndex?:  SessionIndex;
  totalIndices?: SessionIndex;
}

export interface OpenContentResult {
  ok: boolean;
  sessionId?: SessionId;
  error?: SessionError;
}

export function openContent(
  runtime: ImmersiveRuntime,
  args: OpenContentArgs,
): Promise<OpenContentResult>;

export function closeActive(
  runtime: ImmersiveRuntime,
  reason?: string,
): Promise<OpResult>;
