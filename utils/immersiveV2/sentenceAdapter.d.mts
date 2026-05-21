/**
 * sentenceAdapter.d.mts — tipos del hydrator de oraciones para V2.
 */

/**
 * Subset mínimo del StartupEngine que el adapter consume. Mantenemos esta
 * interface aquí (en lugar de importar el .ts directamente) para que el
 * adapter pueda testearse sin compilación TypeScript.
 */
export interface StartupEngineLike {
  start(): void;
  getState(): {
    status:    'idle' | 'loading' | 'ready';
    sentences: readonly string[];
    manifest?: unknown;
  };
  subscribe(listener: (state: {
    status:    'idle' | 'loading' | 'ready';
    sentences: readonly string[];
    manifest?: unknown;
  }) => void): () => void;
}

export interface EngineFactoryArgs {
  contentId: string;
  textUrl?:  string;
  signal?:   AbortSignal;
}

export type EngineFactory = (args: EngineFactoryArgs) => StartupEngineLike;

export interface HydrateSentencesArgs {
  contentId:      string;
  textUrl?:       string;
  signal?:        AbortSignal;
  engineFactory:  EngineFactory;
  /**
   * Sprint M-4 — opcional. Si > 0, settle con hydration_timeout cuando
   * engine no llega a ready en ese tiempo. Default: sin timeout.
   * Viewer M-4 pasa 15000.
   */
  timeoutMs?:     number;
}

export type HydrateSentencesFailureReason =
  | 'invalid_args'
  | 'aborted'
  | 'no_sources'
  | 'start_failed'
  | 'hydration_timeout';

export type HydrateSentencesResult =
  | { ok: true;  sentences: readonly string[]; totalIndices: number; rawManifest: unknown }
  | { ok: false; reason: HydrateSentencesFailureReason; meta?: Readonly<Record<string, unknown>> };

export function hydrateSentences(args: HydrateSentencesArgs): Promise<HydrateSentencesResult>;
