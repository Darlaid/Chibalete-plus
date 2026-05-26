/**
 * useNarrativeAudio
 *
 * React hook wrapping NarrativeAudioEngine.
 *
 * Handles lifecycle (create on mount, destroy on unmount, StrictMode-safe).
 * Returns stable callbacks + reactive state.
 *
 * Usage:
 *   const audio = useNarrativeAudio();
 *   audio.playAmbient(page.ambientAudioUrl);
 *   audio.playRegion(region, pageIdx, regionIdx);
 *   audio.playEffect('page_advance');
 *   audio.setMuted(true);
 *
 * isPlaying, isLoadingAudio: driven by NarrativeAudioEngine callbacks,
 * update as React state for UI binding (volume icon color, loading dots).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { NarrativeAudioEngine, type SoundEvent } from '../utils/NarrativeAudioEngine';
import type { AlbumRegion } from '../types';
import { generarAudioTTS } from '../services/geminiService';

export type { SoundEvent };

export interface NarrativeAudioControls {
    /** Crossfades to a new ambient track. Pass undefined to fade out with no replacement. */
    playAmbient:    (url?: string, loop?: boolean) => void;
    /** Plays region narration (pre-recorded or TTS) and ducks the ambient. */
    playRegion:     (region: AlbumRegion | undefined, pageIdx: number, regionIdx: number) => Promise<void>;
    /** Stops region audio and restores ambient. */
    stopRegion:     () => void;
    /** Plays a synthesized event sound. No-op when muted. */
    playEffect:     (event: SoundEvent) => void;
    /** Replays the current region audio from the start. */
    replay:         () => void;
    /** Sync mute state from UI. */
    setMuted:       (muted: boolean) => void;
    /**
     * Warm-up hint — primes the browser cache for an audio URL without playing it.
     * Call on page advance with the first audioUrl of the next page.
     * Fire-and-forget; no-op if url is empty.
     */
    preloadAudio:   (url: string) => void;
    /**
     * M4 — Prefetch del audio TTS de una región sin reproducir.
     *
     * Llamar cuando una región entra en focus para calentar _ttsCache. Si
     * playRegion ocurre en el mismo tick, comparte el promise via dedup
     * interno (_ttsInFlight) → un solo POST /api/album/tts por (page, region).
     *
     * Fire-and-forget: errores se loguean, nunca se propagan a UI.
     */
    prefetchTTS:    (text: string | undefined, pageIdx: number, regionIdx: number) => void;
    /** True while region audio or TTS is playing. */
    isPlaying:      boolean;
    /** True while TTS is being generated for the current region. */
    isLoadingAudio: boolean;
    /**
     * True when a pre-recorded URL failed AND the region had no text for TTS fallback.
     * The UI should show "No hay audio disponible" when this is true.
     * Reset by calling clearAudioFailed() — typically on region change.
     */
    audioFailed:      boolean;
    /** Resets audioFailed to false. Call on region change. */
    clearAudioFailed: () => void;
}

export function useNarrativeAudio(): NarrativeAudioControls {
    const engineRef = useRef<NarrativeAudioEngine | null>(null);
    const [isPlaying,      setIsPlaying]      = useState(false);
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const [audioFailed,    setAudioFailed]    = useState(false);

    // StrictMode-safe: double-mount calls destroy() then re-runs, creating
    // a fresh engine with no zombie Audio objects or revoked blob URLs.
    useEffect(() => {
        const engine = new NarrativeAudioEngine(generarAudioTTS);
        engine.onPlayingChange = setIsPlaying;
        engine.onLoadingChange = setIsLoadingAudio;
        engine.onAudioFailed   = () => setAudioFailed(true);
        engineRef.current = engine;
        return () => {
            engine.destroy();
            engineRef.current = null;
        };
    }, []);

    const playAmbient = useCallback((url?: string, loop = true) => {
        engineRef.current?.playAmbient(url, loop);
    }, []);

    const playRegion = useCallback((
        region:    AlbumRegion | undefined,
        pageIdx:   number,
        regionIdx: number,
    ): Promise<void> =>
        engineRef.current?.playRegion(region, pageIdx, regionIdx) ?? Promise.resolve(),
    []);

    const stopRegion      = useCallback(() => engineRef.current?.stopRegion(), []);
    const playEffect      = useCallback((event: SoundEvent) => engineRef.current?.playEffect(event), []);
    const replay          = useCallback(() => engineRef.current?.replay(), []);
    const setMuted        = useCallback((muted: boolean) => engineRef.current?.setMuted(muted), []);
    const preloadAudio    = useCallback((url: string) => engineRef.current?.preloadAudio(url), []);
    const prefetchTTS     = useCallback(
        (text: string | undefined, pageIdx: number, regionIdx: number) => {
            // Fire-and-forget — el engine resuelve siempre (loguea errores en su catch).
            engineRef.current?.prefetchTTS(text, pageIdx, regionIdx);
        },
        [],
    );
    const clearAudioFailed = useCallback(() => setAudioFailed(false), []);

    return {
        playAmbient,
        playRegion,
        stopRegion,
        playEffect,
        replay,
        setMuted,
        preloadAudio,
        prefetchTTS,
        isPlaying,
        isLoadingAudio,
        audioFailed,
        clearAudioFailed,
    };
}
