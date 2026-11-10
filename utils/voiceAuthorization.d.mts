/**
 * Tipos para utils/voiceAuthorization.mjs (V8.1-PROD-02F, decisión A5).
 * El módulo es JavaScript ESM puro para poder probarlo con Node sin transpilar.
 */

export const VOICE_RECHECK_MS: number;

export function isVoiceCaptureAllowed(fetchImpl?: typeof fetch): Promise<boolean>;

export interface VoiceAuthorizationWatch {
  stop(): void;
  checkNow(): Promise<void>;
}

export function watchVoiceAuthorization(opts: {
  onRevoked: () => void;
  check?: () => Promise<boolean>;
  intervalMs?: number;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}): VoiceAuthorizationWatch;
