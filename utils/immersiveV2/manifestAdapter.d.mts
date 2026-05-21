/**
 * manifestAdapter.d.mts — tipos del loader de manifest TTS para V2.
 */

export type ManifestVersion = 1 | 2;

export interface ManifestNormalized {
  ok:               true;
  version:          ManifestVersion;
  fileByKey:        Readonly<Record<string, string>>;
  sentencesByKey?:  Readonly<Record<string, readonly string[]>>;
}

export type ManifestFailureReason =
  | 'invalid_args'
  | 'no_fetch_impl'
  | 'aborted'
  | 'fetch_failed'
  | 'invalid_json'
  | 'invalid_shape';

export interface ManifestFailure {
  ok:      false;
  reason:  ManifestFailureReason;
  meta?:   Readonly<Record<string, unknown>>;
}

export type LoadManifestResult = ManifestNormalized | ManifestFailure;

export type FetchImpl = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok:     boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface LoadManifestArgs {
  contentId:  string;
  signal?:    AbortSignal;
  fetchImpl?: FetchImpl;
}

export function loadManifest(args: LoadManifestArgs): Promise<LoadManifestResult>;

export function normalizeRaw(raw: unknown): LoadManifestResult;
