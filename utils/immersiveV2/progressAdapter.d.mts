/**
 * progressAdapter.d.mts — tipos de restoreProgress / commitProgress para V2.
 */

import type { ProgresoLectura } from '../../types';
import type { SessionError, SessionId } from '../../engines/immersiveRuntimeTypes';

/** Subset del dataService que el adapter consume — testeable con stubs. */
export interface ProgressDataServiceLike {
  getProgresoUsuarioLibro(
    userId:    string,
    contentId: string,
  ): ProgresoLectura | undefined;

  updateProgreso(
    userId:        string,
    contentId:     string,
    page:          number,
    totalPages:    number,
    canonicalIndex?: number,
    deviceMode?:   'pdf' | 'text' | 'immersive',
    metricsPatch?: { lastMode?: ProgresoLectura['lastMode']; elapsedMs?: number },
    anchor?:       { type: 'text' | 'sentence' | 'page'; value: number },
    viewportHint?: number,
  ): void;
}

// ── restoreProgress ─────────────────────────────────────────────────────────

export type RestoreSource = 'anchor' | 'sentence_index' | 'default';

export interface RestoreProgressArgs {
  userId:        string;
  contentId:     string;
  totalIndices?: number;
  dataService:   ProgressDataServiceLike;
}

export interface RestoreProgressResult {
  startIndex: number;
  source:     RestoreSource;
  clamped:    boolean;
}

export function restoreProgress(args: RestoreProgressArgs): Promise<RestoreProgressResult>;

// ── commitProgress ──────────────────────────────────────────────────────────

export interface CommitProgressArgs {
  sessionId?:         SessionId;
  userId:             string;
  contentId:          string;
  index:              number;
  totalIndices?:      number;
  sessionDurationMs?: number;
  dataService:        ProgressDataServiceLike;
}

export type CommitProgressResult =
  | { ok: true }
  | { ok: false; error: SessionError };

export function commitProgress(args: CommitProgressArgs): Promise<CommitProgressResult>;
