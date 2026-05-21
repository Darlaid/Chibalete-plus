/**
 * audioAdapter.d.mts — tipos del adapter productivo de audio V2.
 */

import type { SessionId, SessionIndex } from '../../engines/immersiveRuntimeTypes';
import type { AudioLike } from '../../engines/AudioRuntime';
import type { Diagnostics } from '../../engines/Diagnostics';

// ── createBrowserAudioAdapter ───────────────────────────────────────────────

export interface BrowserAudioAdapterOptions {
  getActiveSessionId: () => SessionId | null;
  onEnded?:           (sessionId: SessionId, index: SessionIndex) => void;
  onError?:           (sessionId: SessionId, index: SessionIndex, mediaError: unknown) => void;
  onCanPlay?:         (sessionId: SessionId, index: SessionIndex) => void;
  /** Default: globalThis.Audio. Tests pasan mock controlado. */
  audioCtor?:         new () => AudioLike & {
    addEventListener(type: string, listener: (...args: unknown[]) => void): void;
    removeEventListener(type: string, listener: (...args: unknown[]) => void): void;
    error?: unknown;
    preload?: string;
  };
  /**
   * Sprint M-3.3 — diagnostics opcional para emitir preload.start/hit/abort/release.
   * Pase runtime._internal.diagnostics.
   */
  diagnostics?:       Diagnostics | null;
}

export interface AudioFactoryArgs {
  container?: HTMLElement | null;
  sessionId: SessionId;
  index:     SessionIndex;
  src?:      string;
}

export type AudioFactory = (args: AudioFactoryArgs) => AudioLike;

// ── Preload manager (M-3.3) ─────────────────────────────────────────────────

export interface PreloadPrefetchArgs {
  session:    { id: SessionId; contentId: string };
  index:      SessionIndex;
  text?:      string;
  manifest?:  { fileByKey: Readonly<Record<string, string>> } | null;
  userId?:    string;
  fetchImpl?: typeof fetch;
}

export type PreloadPrefetchResult =
  | { ok: true;  src: string; source: 'manifest' | 'tts'; hit?: 'cache' }
  | { ok: false; reason: string; meta?: Readonly<Record<string, unknown>> };

export interface PreloadAPI {
  prefetch(args: PreloadPrefetchArgs): Promise<PreloadPrefetchResult>;
  /** Devuelve el src cacheado o null si no listo. Sin async, sin fetch. */
  peek(sessionId: SessionId, index: SessionIndex): string | null;
  /** Aborta los preloads fuera de [currentIndex - 1, currentIndex + window]. */
  cancelStaleAround(args: {
    session:      { id: SessionId };
    currentIndex: SessionIndex;
    window?:      number;
  }): number;
  /** Aborta TODOS los pending de la sesión. */
  cancelForSession(sessionId: SessionId): number;
}

export interface BrowserAudioAdapter {
  factory:            AudioFactory;
  cleanupAudio(audio: AudioLike | null | undefined): void;
  registerObjectUrl(sessionId: SessionId, url: string): void;
  /** Revoca todos los object URLs creados para esa sesión + cancela preload. Devuelve count. */
  releaseSession(sessionId: SessionId): number;
  /** Revoca todos los object URLs + limpia listeners de todos los audios trackeados. */
  releaseAll(): number;
  /** Sprint M-3.3 — preload sub-API. */
  preload:            PreloadAPI;
  /** @internal — solo para tests. */
  _state(): {
    audiosTracked: number;
    sessionsWithUrls: number;
    totalUrls: number;
    preloadCount: number;
    preloadReady: number;
  };
}

export function createBrowserAudioAdapter(opts?: BrowserAudioAdapterOptions): BrowserAudioAdapter;

// ── resolveAudioSrc ─────────────────────────────────────────────────────────

export interface ResolveAudioSrcArgs {
  session:               { id: SessionId; contentId: string };
  index:                 SessionIndex;
  text?:                 string;
  manifest?:             { fileByKey: Readonly<Record<string, string>> } | null;
  userId?:               string;
  signal?:               AbortSignal;
  fetchImpl?:            typeof fetch;
  onObjectUrlCreated?:   (sessionId: SessionId, url: string) => void;
}

export type ResolveAudioSrcResult =
  | { ok: true;  src: string; source: 'manifest' | 'tts' }
  | { ok: false; reason:
        | 'invalid_args'
        | 'no_fetch_impl'
        | 'aborted'
        | 'manifest_audio_fetch_failed'
        | 'tts_fetch_failed'
        | 'invalid_audio_response'
        | 'audio_unavailable';
      meta?: Readonly<Record<string, unknown>>;
    };

export function resolveAudioSrc(args: ResolveAudioSrcArgs): Promise<ResolveAudioSrcResult>;

// ── isAutoplayBlocked ───────────────────────────────────────────────────────

/**
 * Heurística: identifica si un error de audio.play() corresponde a la
 * autoplay policy del browser (NotAllowedError u otros). Usado por
 * AudioRuntime para distinguir audio_autoplay_blocked de audio_contract_failed.
 */
export function isAutoplayBlocked(err: unknown): boolean;

/**
 * Sprint M-3.3 — traduce MediaError (audio.error) a reason discriminada.
 * El integrator la usa en su onError callback para pasar reason al
 * dispatch({kind:'audioFailed', index, reason}).
 *
 * Mapeo:
 *   1 → 'aborted', 2 → 'network_failure',
 *   3 → 'decode_failed', 4 → 'src_not_supported', otros → 'unknown'
 */
export function mediaErrorToReason(mediaError: unknown):
  | 'aborted'
  | 'network_failure'
  | 'decode_failed'
  | 'src_not_supported'
  | 'unknown';
