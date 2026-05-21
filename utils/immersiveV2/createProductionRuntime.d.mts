/**
 * createProductionRuntime.d.mts — tipos del factory productivo M-3.5.
 */

import type { ImmersiveRuntime } from '../../engines/ImmersiveRuntime';
import type { Diagnostics } from '../../engines/Diagnostics';
import type { BrowserAudioAdapter } from './audioAdapter';
import type { RuntimeAudioBinder } from './runtimeAudioBinder';

export interface ProductionRuntimeOptions {
  hydrateContent:    (args: { contentId: string }) => Promise<{ totalIndices: number }>;
  getTextForIndex?:  (index: number) => string | null;
  getManifest?:      () => { fileByKey: Readonly<Record<string, string>> } | null;
  getUserId?:        () => string | null;
  fetchImpl?:        typeof fetch;
  audioCtor?:        new () => object;
  diagnostics?:      Diagnostics;
  preloadWindow?:    number;
  visibilityTimeoutMs?: number;
  idPrefix?:         string;
}

export interface ProductionRuntimeStack {
  runtime:           ImmersiveRuntime;
  adapter:           BrowserAudioAdapter;
  binder:            RuntimeAudioBinder;
  diagnostics:       Diagnostics;
  dispose(reason?: string): Promise<{ ok: boolean; reason?: string }>;
  /** @internal — tests. */
  _state(): {
    disposed:     boolean;
    adapterState: ReturnType<BrowserAudioAdapter['_state']>;
    binderState:  ReturnType<RuntimeAudioBinder['_state']>;
  };
}

export function createProductionRuntime(opts: ProductionRuntimeOptions): ProductionRuntimeStack;
