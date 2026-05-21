/**
 * AudioRuntime.d.ts — tipos del adaptador de audio V2.
 */

import type { SessionId, ContentId, SessionIndex } from './immersiveRuntimeTypes';
import type { Diagnostics } from './Diagnostics';

/** Subset mínimo de HTMLAudioElement que el runtime usa. */
export interface AudioLike {
  play(): Promise<void> | void;
  pause(): void;
  src: string;
  currentTime: number;
}

export interface AudioFactoryArgs {
  container: HTMLElement | null;
  sessionId: SessionId | null;
  index:     SessionIndex;
  src?:      string;
}

export type AudioFactory = (args: AudioFactoryArgs) => AudioLike;

export interface ResolveSrcArgs {
  session: { id: SessionId; contentId: ContentId } | null;
  index:   SessionIndex;
}
export type ResolveSrc = (args: ResolveSrcArgs) => Promise<string | null> | string | null;

export interface AudioRuntimeOptions {
  audioFactory?: AudioFactory;
  resolveSrc?:   ResolveSrc;
  diagnostics?:  Diagnostics | null;
  /**
   * Sprint M-3.2 — callback opcional invocado cuando AudioRuntime libera
   * o reemplaza el audio activo. El audioAdapter productivo lo usa para
   * remover sus listeners (`ended`/`error`/`canplay`) deterministicamente.
   */
  audioCleanup?: (audio: AudioLike) => void;
}

export interface AudioPreflightResult {
  ok:      boolean;
  reason?: string;
  src?:    string;
}

export interface AudioStartPlaybackResult {
  ok:      boolean;
  reason?: string;
  /**
   * Sprint M-4.3 — diagnostic enrichment.
   * Cuando ok=false, meta contiene el contexto operacional para que el caller
   * pueda emitir errorMeta completo. Cuando ok=true, meta es opcional pero
   * útil para diagnostics downstream.
   */
  meta?: {
    src?:               string | null;
    requestedIndex?:    SessionIndex;
    requestedSessionId?: SessionId | null;
    /** mensaje del DOM error (audio.error / play().catch) */
    browserError?:      string | null;
    /** play().catch error name (NotAllowedError, NotSupportedError, ...) */
    playPromiseError?:  string | null;
    /** readyState al momento del fallo */
    readyState?:        number;
    /** networkState al momento del fallo */
    networkState?:      number;
  };
}

/**
 * Sprint M-4.3 — contrato formal de un audio acquire.
 *
 * El "acquire" engloba: resolveSrc (provider) → factory → setSrc → load_start
 * → canplay → play(). Cada fase puede fallar; el contrato uniforma el outcome
 * para que el viewer/diagnostics pueda emitir telemetría consistente.
 *
 * NO se construye este objeto directamente en AudioRuntime — los métodos
 * preflight + startPlayback emiten diagnostics granulares con esta shape
 * embedida en el `meta`. Es el tipo CONSUMIDO por scripts de auditoría.
 */
export interface AudioAcquireResult {
  ok:               boolean;
  url?:             string;
  durationMs?:      number;
  mimeType?:        string;
  preloadSource?:   'cache' | 'network' | 'tts';
  errorKind?:
    | 'no_src'
    | 'invalid_url'
    | 'factory_throw'
    | 'factory_invalid'
    | 'load_failed'
    | 'play_rejected'
    | 'autoplay_blocked'
    | 'cancelled'
    | 'unknown';
  errorMeta?:       {
    provider?:           'cache' | 'manifest' | 'tts' | 'unknown';
    requestedIndex?:     SessionIndex;
    requestedSentenceId?: SessionIndex;  // alias semántico (M-4.2 vocabulary)
    resolvedUrl?:        string | null;
    preloadState?:       string;
    browserError?:       string | null;
    playPromiseError?:   string | null;
    readyState?:         number;
    networkState?:       number;
  };
}

export interface SessionRef {
  id:        SessionId;
  contentId: ContentId;
}

/**
 * Sprint M-4.2 — read-only diagnostic snapshot del estado interno del audio.
 * Consumido por ImmersiveSession.publishSnapshot para enriquecer el snapshot
 * expuesto a viewers. NO se usa para lógica de runtime.
 */
export interface AudioDebugState {
  state:               'idle' | 'playing';
  urlLoaded:           boolean;
  activeSessionId:     SessionId | null;
  activeIndex:         SessionIndex | null;
  failedSessionsCount: number;
}

export interface AudioRuntime {
  mount(container: HTMLElement | null): void;
  unmount(): void;
  preflight(session: SessionRef, index: SessionIndex): Promise<AudioPreflightResult>;
  startPlayback(session: SessionRef, index: SessionIndex, src?: string): Promise<AudioStartPlaybackResult>;
  pause(): void;
  releaseFor(session: SessionRef): void;
  isFailedFor(session: SessionRef, index: SessionIndex): boolean;
  getDebugState(): AudioDebugState;
}

export function createAudioRuntime(opts?: AudioRuntimeOptions): AudioRuntime;
