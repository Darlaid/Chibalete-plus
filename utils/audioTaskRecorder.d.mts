/**
 * Tipos para utils/audioTaskRecorder.mjs (V8.1-PROD-02H, ciclo de vida del audio en Home).
 * El módulo es JavaScript ESM puro para poder probarlo con Node sin transpilar.
 */
import type { VoiceAuthorizationWatch } from './voiceAuthorization.mjs';

export const AUDIO_SUBMISSION_LOCAL_NOTE: string;

export function isNonTextSubmissionContent(content: unknown): boolean;

export function storedSubmissionContent(submissionType: string | undefined, content: string): string;

export interface AudioTaskState {
  isRecording: boolean;
  audioUrl: string | null;
  blocked: 'a5' | null;
}

export interface AudioTaskRecorder {
  start(): Promise<void>;
  stop(): void;
  discard(): void;
  reset(): void;
  dispose(): void;
  getState(): AudioTaskState;
}

export function createAudioTaskRecorder(deps: {
  onChange: (state: AudioTaskState) => void;
  onMicError?: (err: unknown) => void;
  checkAllowed?: () => Promise<boolean>;
  watch?: (opts: { onRevoked: () => void }) => VoiceAuthorizationWatch;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor?: typeof MediaRecorder;
  createObjectURL?: (b: Blob) => string;
  revokeObjectURL?: (u: string) => void;
  BlobCtor?: typeof Blob;
}): AudioTaskRecorder;
