/**
 * runtimeAudioBinder.d.mts — tipos del helper oficial wire-up runtime ↔ audio.
 */

import type { ImmersiveRuntime } from '../../engines/ImmersiveRuntime';
import type { Diagnostics } from '../../engines/Diagnostics';
import type { BrowserAudioAdapter } from './audioAdapter';

export interface BindRuntimeAudioArgs {
  runtime:           ImmersiveRuntime;
  audioAdapter:      BrowserAudioAdapter;
  /**
   * Devuelve el texto de la oración para fallback TTS. Si no se provee,
   * el binder no dispara prefetches (el fallback TTS necesita texto).
   */
  getTextForIndex?:  (index: number) => string | null;
  /** Devuelve el manifest normalizado (manifestAdapter.loadManifest output). */
  getManifest?:      () => { fileByKey: Readonly<Record<string, string>> } | null;
  getUserId?:        () => string | null;
  getFetchImpl?:     () => typeof fetch;
  /** Cuántos clips adelante prefetchear. Default 2. */
  preloadWindow?:    number;
  /** Diagnostics opcional para emitir binder.attach/dispose/preload.*/
  diagnostics?:      Diagnostics | null;
}

export interface RuntimeAudioBinder {
  dispose(): void;
  /** @internal — tests. */
  _state(): {
    disposed:         boolean;
    prevSessionId:    string | null;
    prevStatus:       string;
    prevCurrentIndex: number;
    preloadWindow:    number;
  };
}

export function bindRuntimeAudio(args: BindRuntimeAudioArgs): RuntimeAudioBinder;
