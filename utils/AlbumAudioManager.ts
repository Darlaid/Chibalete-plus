/**
 * AlbumAudioManager.ts
 *
 * Manages all audio playback in VisorAlbum: ambient page audio and per-region
 * audio (pre-recorded or on-demand TTS).
 *
 * Responsibilities:
 *   - Play / stop ambient audio when the page changes (looped)
 *   - Play region audio on focus: uses pre-recorded audioUrl if available,
 *     falls back to on-demand TTS via generarAudioTTS
 *   - In-memory TTS cache (keyed by pageIndex-regionIndex) to avoid re-fetching
 *   - Global mute toggle that silences everything
 *   - Revoke all blob URLs on destroy() to prevent memory leaks
 *
 * Usage:
 *   const mgr = new AlbumAudioManager(generarAudioTTS);
 *   mgr.onPlayingChange = (playing) => setIsPlaying(playing);
 *   mgr.onLoadingChange = (loading) => setLoadingAudio(loading);
 *
 *   mgr.setMuted(isMuted);
 *   await mgr.setPage(page);                        // on page change
 *   await mgr.setRegion(region, pageIdx, regionIdx); // on region focus
 *   mgr.stopRegionAudio();                          // on leaving focus
 *   mgr.replay();                                   // repeat current region audio
 *   mgr.destroy();                                  // on component unmount
 */

import type { AlbumPage, AlbumRegion } from '../types';

type TTSProvider = (text: string) => Promise<string | undefined>;

// Converts raw PCM bytes (Gemini TTS output) to a WAV Blob URL.
function pcmToWavUrl(pcmBase64: string, sampleRate = 24000): string {
    const binary = atob(pcmBase64);
    const len    = binary.length;
    const pcm    = new Uint8Array(len);
    for (let i = 0; i < len; i++) pcm[i] = binary.charCodeAt(i);

    const buffer = new ArrayBuffer(44 + pcm.length);
    const view   = new DataView(buffer);
    const write  = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    write(0,  'RIFF'); view.setUint32(4, 36 + pcm.length, true);
    write(8,  'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1,          true);
    view.setUint16(22, 1,  true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); write(36, 'data');
    view.setUint32(40, pcm.length, true);
    new Uint8Array(buffer, 44).set(pcm);

    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export class AlbumAudioManager {
    // Callbacks wired by the component
    onPlayingChange?: (playing: boolean) => void;
    onLoadingChange?: (loading: boolean) => void;

    private _muted     = false;
    private _ambient   = new Audio();
    private _region    = new Audio();
    private _ttsCache  = new Map<string, string>(); // `${pageIdx}-${regionIdx}` → blob URL
    private _blobUrls  = new Set<string>();         // all created blob URLs (for cleanup)
    private _tts: TTSProvider;

    constructor(ttsProvider: TTSProvider) {
        this._tts = ttsProvider;

        this._ambient.loop = true;
        this._ambient.preload = 'none';

        this._region.onplay   = () => this.onPlayingChange?.(true);
        this._region.onpause  = () => this.onPlayingChange?.(false);
        this._region.onended  = () => this.onPlayingChange?.(false);
    }

    // ── Mute control ────────────────────────────────────────────────

    setMuted(muted: boolean): void {
        this._muted = muted;
        this._ambient.muted = muted;
        this._region.muted  = muted;
        if (muted) {
            this._ambient.pause();
            this._region.pause();
        }
    }

    get muted(): boolean { return this._muted; }

    // ── Page change ─────────────────────────────────────────────────

    /**
     * Called when the viewer moves to a new page.
     * Stops region audio, starts ambient audio if present.
     */
    async setPage(page: AlbumPage): Promise<void> {
        this._stopRegionAudio();

        // Stop previous ambient track
        this._ambient.pause();
        this._ambient.src = '';

        if (page.ambientAudioUrl) {
            this._ambient.src  = page.ambientAudioUrl;
            this._ambient.loop = page.ambientAudioLoop !== false; // default: true
            if (!this._muted) {
                try { await this._ambient.play(); } catch { /* autoplay blocked */ }
            }
        }
    }

    // ── Region change ───────────────────────────────────────────────

    /**
     * Called when the viewer enters 'focus' state on a region.
     * Priority: region.audioUrl > TTS fallback > silent.
     *
     * @param region     The active AlbumRegion
     * @param pageIdx    0-based page index (used as TTS cache key)
     * @param regionIdx  0-based region index within the page
     */
    async setRegion(
        region: AlbumRegion | undefined,
        pageIdx: number,
        regionIdx: number,
    ): Promise<void> {
        this._stopRegionAudio();

        if (!region || !region.text || this._muted) return;

        // 1. Pre-recorded audio takes priority over TTS
        if (region.audioUrl) {
            this._region.src = region.audioUrl;
            try { await this._region.play(); } catch { /* blocked */ }
            return;
        }

        // 2. TTS fallback
        const cacheKey = `${pageIdx}-${regionIdx}`;

        if (this._ttsCache.has(cacheKey)) {
            this._region.src = this._ttsCache.get(cacheKey)!;
            try { await this._region.play(); } catch { /* blocked */ }
            return;
        }

        this.onLoadingChange?.(true);
        try {
            const pcmBase64 = await this._tts(region.text);
            if (!pcmBase64) return;

            const blobUrl = pcmToWavUrl(pcmBase64);
            this._blobUrls.add(blobUrl);
            this._ttsCache.set(cacheKey, blobUrl);

            // Guard: viewer may have advanced while TTS was generating
            if (!this._muted) {
                this._region.src = blobUrl;
                try { await this._region.play(); } catch { /* blocked */ }
            }
        } catch {
            // TTS failure is non-fatal — viewer continues silently
        } finally {
            this.onLoadingChange?.(false);
        }
    }

    // ── Replay / stop ───────────────────────────────────────────────

    replay(): void {
        if (this._muted || !this._region.src) return;
        this._region.currentTime = 0;
        this._region.play().catch(() => { /* blocked */ });
    }

    stopRegionAudio(): void {
        this._stopRegionAudio();
    }

    private _stopRegionAudio(): void {
        this._region.pause();
        this._region.src = '';
        this.onPlayingChange?.(false);
    }

    // ── Cleanup ─────────────────────────────────────────────────────

    /**
     * Must be called on component unmount to release all blob URLs and stop audio.
     */
    destroy(): void {
        this._ambient.pause();
        this._region.pause();
        this._blobUrls.forEach(url => URL.revokeObjectURL(url));
        this._blobUrls.clear();
        this._ttsCache.clear();
    }
}
