/**
 * NarrativeAudioEngine
 *
 * Manages all audio in VisorAlbum with narrative intention.
 *
 * ── Three audio layers ────────────────────────────────────────────────────────
 *
 *   AMBIENT  — looped page atmosphere. Always quiet (AMBIENT_BASE = 0.30).
 *              Crossfades smoothly on page change (500ms) so transitions feel
 *              like turning a page, not cutting a file.
 *
 *   REGION   — pre-recorded narration or on-demand TTS. Full clarity (1.0).
 *              Ducks the ambient on start (250ms ramp to 0.07) and restores it
 *              on end (700ms ramp back to 0.30) so narration is always
 *              intelligible without fighting background sound.
 *
 *   EFFECTS  — synthesized event sounds. No asset files. Web Audio API only.
 *              Short (50–300ms), quiet (EFFECT_LEVEL = 0.55), purpose-built for
 *              each event type. They mark rhythm without demanding attention.
 *
 * ── Design principle ──────────────────────────────────────────────────────────
 *
 * Audio is not decoration and not constant. It is a guide — it marks arrival,
 * confirms intent, and breathes with the experience. If a sound competes with
 * what the reader sees or hears, it has failed.
 *
 * The ducking ratio (AMBIENT_DUCK / AMBIENT_BASE = 0.07 / 0.30 ≈ 23%) is
 * intentional: ambient drops enough to be clearly below narration, but does
 * not disappear — its continued presence preserves the atmospheric texture
 * that makes regions feel inhabited.
 *
 * ── Crossfade timing ──────────────────────────────────────────────────────────
 *
 * CROSSFADE_MS = 500ms. Both ramps run simultaneously from the moment
 * playAmbient() is called. The slot flip happens first, so _activeAmb always
 * refers to the incoming track — duck/unduck always target the right element
 * even if called mid-crossfade.
 *
 * ── Effect sounds ─────────────────────────────────────────────────────────────
 *
 *   page_advance   — soft noise burst + bandpass (paper flutter, 80ms)
 *   region_enter   — sine glide C5→E5 (gentle arrival, 70ms)
 *   challenge_hit  — two-tone C5+E5 confirmation (warm, staggered, 150ms)
 *   challenge_miss — descending triangle 300→130Hz (soft thud, 110ms)
 *   complete       — rising arpeggio C5-E5-G5-C6 (4 notes × 80ms = 300ms)
 *   hint_appear    — single ping C6 (very quiet, 60ms)
 *
 * All effects use the AudioContext currentTime for scheduling — they are
 * sub-frame-accurate regardless of when playEffect() is called.
 *
 * ── Silence as narrative state ────────────────────────────────────────────────
 *
 * Silence is not modeled as a state. It is the natural outcome when no layer
 * is active. But it is ALWAYS intentional — the system produces silence
 * in defined, documented moments:
 *
 *   Traveling silence (camera start → camera end, ~700–1100ms):
 *     The camera is in motion. region_enter has fired. No new audio intervenes.
 *     The reader is in visual transit — audio would compete, not accompany.
 *     Closed by camera_arrive at transitionend.
 *
 *   Exploration silence (rapid region traversal):
 *     When the reader taps quickly, playRegion() preempts itself via _stopRegion().
 *     The duck/unduck cycle resets; ambient plays near AMBIENT_BASE. The system
 *     correctly yields to the reader's pace. No TTS heard — no narration imposed.
 *
 *   Post-narration breath (700ms after TTS end):
 *     _unduck() restores ambient over UNDUCK_RAMP_MS = 700ms. This slow ramp
 *     IS the silence-to-atmosphere transition. Do not shorten it.
 *
 *   Challenge silence (viewerState === 'challenge'):
 *     Region audio stops; ambient continues. The reader is hunting — focused,
 *     not receiving narration. Ambient provides spatial presence without
 *     directing attention. This is the "listening forward" silence.
 *
 * Do not add a 'mute' mode or a 'silence' SoundEvent. Silence is the default.
 * It requires no representation — only protection from unintentional noise.
 *
 * ── AudioContext lifecycle ────────────────────────────────────────────────────
 *
 * The AudioContext is created lazily on the first playEffect() call, after a
 * user gesture. This satisfies browser autoplay policies. It is closed in
 * destroy() to release hardware resources.
 *
 * ── Replaces AlbumAudioManager ────────────────────────────────────────────────
 *
 * Same constructor pattern, same callback interface, same TTS cache design.
 * Migration: s/AlbumAudioManager/NarrativeAudioEngine/, add playEffect() calls.
 */

import type { AlbumRegion } from '../types';

// ── Volume constants ────────────────────────────────────────────────────────────

/** Ambient at rest. Low enough not to compete with content. */
const AMBIENT_BASE  = 0.30;

/** Ambient while region narration is playing. Present but subordinate. */
const AMBIENT_DUCK  = 0.07;

/** Master gain for synthesized effects. */
const EFFECT_LEVEL  = 0.55;

/** Ambient → ambient crossfade on page change. */
const CROSSFADE_MS  = 500;

/** Ambient → duck when region audio starts. */
const DUCK_RAMP_MS  = 250;

/** Duck → ambient when region audio ends. Slower: natural breath. */
const UNDUCK_RAMP_MS = 700;

// ── Types ───────────────────────────────────────────────────────────────────────

type TTSProvider = (text: string) => Promise<string | undefined>;

export type SoundEvent =
    | 'page_advance'    // soft paper-turn noise burst
    | 'region_enter'    // gentle arrival chime (fires at camera START)
    | 'camera_arrive'   // barely-perceptible closure tap (fires at camera END via transitionend)
    | 'route_enter'     // two-voice soft opening — "you've chosen a reading path" (fires in overview, before camera)
    | 'reread_open'     // descending memory mark — "this is not the first time" (fires once at session mount)
    | 'challenge_hit'   // warm two-tone confirmation
    | 'challenge_miss'  // soft descending thud
    | 'complete'        // rising arpeggio
    | 'hint_appear';    // very quiet ping

// ── PCM → WAV ───────────────────────────────────────────────────────────────────

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

// ── Engine ──────────────────────────────────────────────────────────────────────

export class NarrativeAudioEngine {

    // Callbacks wired by the component.
    onPlayingChange?: (playing: boolean) => void;
    onLoadingChange?: (loading: boolean) => void;
    /**
     * Fires when a pre-recorded URL fails to load AND the region has no text
     * to fall back to via TTS. The UI should show "No hay audio disponible"
     * so the child isn't left with a tap that does nothing.
     */
    onAudioFailed?:  () => void;

    // ── Ambient ping-pong slots ──────────────────────────────────────
    // Two elements allow simultaneous crossfade: one fades out, one fades in.
    // _activeSlot always points to the incoming (or currently playing) track.
    private _ambA = new Audio();
    private _ambB = new Audio();
    private _activeSlot: 'A' | 'B' = 'A';

    // ── Region / TTS ─────────────────────────────────────────────────
    private _region = new Audio();
    private _tts:     TTSProvider;
    private _ttsCache = new Map<string, string>(); // `${pageIdx}-${regionIdx}` → blob URL
    private _blobUrls = new Set<string>();          // for cleanup

    // ── Web Audio (effects only) ──────────────────────────────────────
    private _ctx: AudioContext | null = null;

    // ── Per-element rAF frame IDs ─────────────────────────────────────
    // WeakMap so pausing/stopping the element does not prevent GC.
    private _fadeFrames = new WeakMap<HTMLAudioElement, number>();

    // ── TTS generation guard ──────────────────────────────────────────
    // Incremented on every playRegion() call. TTS async callbacks compare
    // their captured ID against the current value: a mismatch means a newer
    // playRegion() or stopRegion() preempted this request. Without this guard,
    // TTS that was generating for region A could play after the reader has
    // navigated to region B (the original AlbumAudioManager had this bug too).
    private _regionGen = 0;

    // ── TTS fallback for pre-recorded URL errors ──────────────────────
    // Set before calling _doPlay() with a pre-recorded URL so that, if
    // the browser fires onerror (404, decode error, network loss), the
    // engine transparently re-tries via TTS instead of silently failing.
    // Cleared by _stopRegion() and by the onerror handler itself.
    private _fallbackText: string | undefined = undefined;
    private _fallbackKey:  string | undefined = undefined;

    // ── State ────────────────────────────────────────────────────────
    private _muted = false;

    /**
     * Set to true when playAmbient() catches an autoplay-policy rejection.
     * Cleared and ambient resumed on the first call to playEffect() —
     * which is always post-gesture (AudioContext creation requires user interaction).
     *
     * Pattern: playAmbient loads the element and sets volume but cannot start
     * playback without a prior user gesture. playEffect() is the earliest
     * reliable post-gesture moment we control. On that call, we retry the ambient.
     */
    private _ambientPending = false;

    /**
     * Region pending — analogous to _ambientPending but for narration playback.
     * If the FIRST region.play() is blocked (autoplay policy after a long await,
     * e.g. TTS network fetch consuming user-activation), we queue { src, gen }
     * here and retry on the next playEffect() (post-gesture moment).
     * Cleared on success or on a newer playRegion (gen mismatch makes retry a no-op).
     */
    private _regionPending: { src: string; gen: number } | null = null;

    constructor(ttsProvider: TTSProvider) {
        this._tts = ttsProvider;

        for (const el of [this._ambA, this._ambB]) {
            el.loop    = true;
            el.volume  = 0;
            el.preload = 'none';
        }

        this._region.onplay  = () => this.onPlayingChange?.(true);
        this._region.onpause = () => this.onPlayingChange?.(false);
        this._region.onended = () => {
            this.onPlayingChange?.(false);
            this._unduck();
        };

        // ── Pre-recorded URL error → TTS fallback ────────────────────
        // onerror fires for media load failures (404, decode, network) —
        // NOT for autoplay blocks (those are caught by the play() rejection).
        // If fallback text + key are stored, transparently re-try via TTS
        // so the reader never sees a broken-audio state.
        this._region.onerror = () => {
            const text = this._fallbackText;
            const key  = this._fallbackKey;
            const gen  = this._regionGen;
            // Always clear fallback to prevent double-fire.
            this._fallbackText = undefined;
            this._fallbackKey  = undefined;
            if (!text || !key || this._muted || gen !== this._regionGen) {
                if (gen === this._regionGen) {
                    this._unduck();
                    // No text → no TTS fallback. Notify UI so it can show
                    // "No hay audio disponible" rather than a silent tap.
                    if (!text) this.onAudioFailed?.();
                }
                return;
            }
            if (import.meta.env.DEV) {
                console.warn('[NarrativeAudio] pre-recorded URL error — falling back to TTS');
            }
            this._unduck(); // Reset duck from failed play attempt
            // Async TTS fallback — same logic as the TTS path in playRegion().
            (async () => {
                if (gen !== this._regionGen) return;
                if (this._ttsCache.has(key)) {
                    await this._doPlay(this._ttsCache.get(key)!, gen);
                    return;
                }
                this.onLoadingChange?.(true);
                try {
                    const pcm = await this._tts(text);
                    if (!pcm || gen !== this._regionGen) return;
                    const blobUrl = pcmToWavUrl(pcm);
                    this._blobUrls.add(blobUrl);
                    this._ttsCache.set(key, blobUrl);
                    if (gen === this._regionGen && !this._muted) {
                        await this._doPlay(blobUrl, gen);
                    }
                } catch { /* TTS also failed — viewer stays silent, no error shown */ } finally {
                    if (gen === this._regionGen) this.onLoadingChange?.(false);
                }
            })();
        };
    }

    // ── Slot helpers ─────────────────────────────────────────────────

    private get _activeAmb(): HTMLAudioElement {
        return this._activeSlot === 'A' ? this._ambA : this._ambB;
    }
    private get _outgoingAmb(): HTMLAudioElement {
        return this._activeSlot === 'A' ? this._ambB : this._ambA;
    }

    // ── Volume ramp (rAF-based, linear) ──────────────────────────────

    /**
     * Smoothly ramps el.volume from its current value to `target` over
     * `durationMs`. Cancels any in-flight ramp on the same element.
     * Calls onDone() once the target is reached (useful for cleanup).
     */
    private _ramp(
        el:         HTMLAudioElement,
        target:     number,
        durationMs: number,
        onDone?:    () => void,
    ): void {
        const prev = this._fadeFrames.get(el);
        if (prev !== undefined) cancelAnimationFrame(prev);

        const startVol = el.volume;
        const startT   = performance.now();

        const tick = () => {
            const progress = Math.min((performance.now() - startT) / durationMs, 1);
            el.volume = Math.max(0, Math.min(1, startVol + (target - startVol) * progress));
            if (progress < 1) {
                this._fadeFrames.set(el, requestAnimationFrame(tick));
            } else {
                this._fadeFrames.delete(el);
                onDone?.();
            }
        };
        this._fadeFrames.set(el, requestAnimationFrame(tick));
    }

    // ── Mute ─────────────────────────────────────────────────────────

    setMuted(muted: boolean): void {
        this._muted = muted;
        for (const el of [this._ambA, this._ambB, this._region]) {
            el.muted = muted;
            if (muted) el.pause();
        }
        if (!muted && this._activeAmb.src) {
            this._activeAmb.play().catch(() => { /* autoplay blocked */ });
        }
    }

    get muted(): boolean { return this._muted; }

    // ── Ambient ───────────────────────────────────────────────────────

    /**
     * Crossfades to a new ambient track. Outgoing fades to 0, incoming fades to
     * AMBIENT_BASE. Both ramps run simultaneously.
     *
     * Slot flip happens BEFORE both ramps so _activeAmb immediately refers to
     * the incoming track — duck/unduck stay correct even mid-crossfade.
     */
    async playAmbient(url: string | undefined, loop = true): Promise<void> {
        const outgoing = this._outgoingAmb; // pre-flip reference

        // Flip slot first — activeAmb now points to the incoming element.
        this._activeSlot = this._activeSlot === 'A' ? 'B' : 'A';
        const incoming = this._activeAmb;  // post-flip reference

        // Cancel any in-flight ramps.
        for (const el of [outgoing, incoming]) {
            const frame = this._fadeFrames.get(el);
            if (frame !== undefined) { cancelAnimationFrame(frame); this._fadeFrames.delete(el); }
        }

        // Fade out outgoing — stop and clear src once silent.
        if (outgoing.src) {
            this._ramp(outgoing, 0, CROSSFADE_MS, () => {
                outgoing.pause();
                outgoing.src = '';
            });
        }

        if (!url) {
            // No ambient for this page — incoming stays silent.
            incoming.src = '';
            return;
        }

        incoming.src    = url;
        incoming.loop   = loop;
        incoming.volume = 0;

        if (!this._muted) {
            try {
                await incoming.play();
                this._ambientPending = false; // playing — no retry needed
                this._ramp(incoming, AMBIENT_BASE, CROSSFADE_MS);
            } catch {
                // Autoplay policy blocked play — element has src + volume ready.
                // Will resume on the first playEffect() call (post-gesture).
                incoming.volume = AMBIENT_BASE;
                this._ambientPending = true;
                if (import.meta.env.DEV) {
                    console.log('[NarrativeAudio] ambient blocked by autoplay policy — queued for post-gesture resume');
                }
            }
        } else {
            incoming.volume = AMBIENT_BASE;
        }
    }

    // ── Duck / unduck ─────────────────────────────────────────────────

    /**
     * Ramps active ambient to AMBIENT_DUCK.
     * Called automatically when region audio starts.
     */
    private _duck(): void {
        this._ramp(this._activeAmb, AMBIENT_DUCK, DUCK_RAMP_MS);
    }

    /**
     * Ramps active ambient back to AMBIENT_BASE.
     * Called automatically when region audio ends or is stopped.
     * Slower ramp (UNDUCK_RAMP_MS) feels like a natural breath returning.
     */
    private _unduck(): void {
        this._ramp(this._activeAmb, AMBIENT_BASE, UNDUCK_RAMP_MS);
    }

    // ── Region audio ─────────────────────────────────────────────────

    /**
     * Internal helper: sets src, ducks, and starts playback.
     * Captures generation ID so stale async callbacks no-op cleanly.
     * Used by playRegion() and the onerror TTS fallback handler.
     */
    private async _doPlay(src: string, gen: number): Promise<void> {
        if (gen !== this._regionGen) return;
        this._region.src = src;
        this._duck();
        try {
            await this._region.play();
            // Success — drop any prior pending retry from a blocked attempt.
            this._regionPending = null;
        } catch {
            // Autoplay blocked — unduck since nothing is playing.
            // Queue retry for next post-gesture call. The gen guard ensures
            // a stale pending is silently skipped if a newer playRegion runs.
            if (gen === this._regionGen) {
                this._unduck();
                this._regionPending = { src, gen };
            }
        }
    }

    /**
     * Plays region narration (pre-recorded or TTS) and ducks the ambient.
     * Priority: region.action?.audioUrl (canonical) > region.audioUrl (legacy) > TTS > silent.
     *
     * Generation guard: each call captures the current _regionGen ID. Any
     * async continuation that finds a newer ID was preempted — it exits
     * silently without touching _region state.
     *
     * Fallback: if effectiveAudioUrl is set but the browser fires onerror
     * (404, decode error, network loss), the onerror handler in the constructor
     * transparently re-tries via TTS using _fallbackText/_fallbackKey.
     */
    async playRegion(
        region:    Pick<AlbumRegion, 'text' | 'audioUrl' | 'action'> | undefined,
        pageIdx:   number,
        regionIdx: number,
    ): Promise<void> {
        this._stopRegion();
        // Canonical audio: region.action?.audioUrl (2.0-C+).
        // Legacy audio:    region.audioUrl (type='audio' regions, pre-2.0-C).
        const effectiveAudioUrl = region?.action?.audioUrl ?? region?.audioUrl;
        // Allow playback if there is pre-recorded audio even when text is absent
        // (action.type='audio' or legacy type='audio' regions have audioUrl with no narrative text).
        if ((!region?.text && !effectiveAudioUrl) || this._muted) return;

        // Mint a new generation. Async callbacks below compare against this.
        const gen = ++this._regionGen;

        if (effectiveAudioUrl) {
            // Store fallback context before playing: if the URL 404s or fails
            // to decode, onerror will pick this up and run TTS instead.
            this._fallbackText = region?.text || undefined;
            this._fallbackKey  = `${pageIdx}-${regionIdx}`;
            await this._doPlay(effectiveAudioUrl, gen);
            return;
        }

        // No pre-recorded URL — run TTS path directly.
        this._fallbackText = undefined;
        this._fallbackKey  = undefined;

        const key = `${pageIdx}-${regionIdx}`;
        if (this._ttsCache.has(key)) {
            await this._doPlay(this._ttsCache.get(key)!, gen);
            return;
        }

        this.onLoadingChange?.(true);
        try {
            const ttsResult = await this._tts(region.text);

            // Guard: region changed while TTS was generating.
            // Store in cache regardless (avoids re-fetching if user returns),
            // but do not play it — the current region is already different.
            if (!ttsResult) return;

            // v4.0.7: el provider puede devolver URL del backend (cuando VITE_GEMINI_API_KEY
            // no está en el bundle — caso producción) o PCM base64 (legacy Gemini local).
            // Detectamos por prefijo. URLs van directo a audio.src sin pcmToWavUrl;
            // solo blobs locales se trackean en _blobUrls para revoke en destroy().
            let src: string;
            if (ttsResult.startsWith('/') || ttsResult.startsWith('http://') || ttsResult.startsWith('https://')) {
                src = ttsResult;
            } else {
                src = pcmToWavUrl(ttsResult);
                this._blobUrls.add(src);
            }
            this._ttsCache.set(key, src);

            if (gen === this._regionGen && !this._muted) await this._doPlay(src, gen);
        } catch {
            // TTS failure is non-fatal — viewer continues silently.
        } finally {
            if (gen === this._regionGen) this.onLoadingChange?.(false);
        }
    }

    stopRegion(): void { this._stopRegion(); }

    private _stopRegion(): void {
        // Invalidate any in-flight TTS generation for this region.
        this._regionGen++;
        // Clear fallback so a stale onerror from the previous URL cannot fire.
        this._fallbackText = undefined;
        this._fallbackKey  = undefined;
        this._region.pause();
        this._region.src = '';
        this._unduck();
        this.onPlayingChange?.(false);
        // BLOQUE 6: Force-clear loading state on region stop.
        // If TTS was in-flight when this fires, the async callback's `finally`
        // will skip onLoadingChange(false) because gen !== _regionGen. Without
        // this call the UI loading indicator would stay true indefinitely when
        // the user navigates away from a TTS-loading region.
        this.onLoadingChange?.(false);
    }

    replay(): void {
        if (this._muted || !this._region.src) return;
        this._region.currentTime = 0;
        this._region.play().catch(() => { /* blocked */ });
    }

    /**
     * Warm-up hint for the browser's audio pipeline.
     *
     * Creates a temporary <audio> element with preload="auto" and discards it
     * after the browser has had a chance to fetch headers / buffer the file.
     * This primes the network cache so playRegion() starts without a cold fetch.
     *
     * ── Design limits ──────────────────────────────────────────────────────────
     * - Fire-and-forget: does NOT play anything; does NOT affect mute state.
     * - Effective for files served with caching headers (Cache-Control/ETag).
     * - No-op if the URL is empty/falsy.
     * - Should be called at most once per unique URL per session (caller's responsibility).
     * - Does NOT guarantee gapless playback — it is a best-effort warm-up only.
     */
    preloadAudio(url: string): void {
        if (!url) return;
        const hint = new Audio();
        hint.preload = 'auto';
        hint.src = url;
        // We hold no reference — the GC can collect it after the browser has buffered.
        // The browser's internal cache is what we're warming, not the JS object.
    }

    // ── Synthesized effects ───────────────────────────────────────────

    /**
     * Plays a synthesized event sound using the Web Audio API.
     * No asset files — all sounds are generated procedurally.
     * AudioContext is created lazily on first call (satisfies autoplay policy).
     * Effects are scheduled using ctx.currentTime for sub-frame accuracy.
     */
    playEffect(event: SoundEvent): void {
        if (this._muted) return;

        if (!this._ctx) {
            try { this._ctx = new AudioContext(); } catch { return; }
        }
        const ctx = this._ctx;
        if (ctx.state === 'suspended') ctx.resume();

        // Post-gesture ambient resume — autoplay may have been blocked at mount.
        // This is the first reliable post-gesture moment in the audio pipeline.
        if (this._ambientPending) {
            this._ambientPending = false;
            const amb = this._activeAmb;
            if (amb.src && !this._muted) {
                // Soft fade-in from 0 so the ambient enters organically, not abruptly.
                amb.volume = 0;
                amb.play()
                    .then(() => this._ramp(amb, AMBIENT_BASE, 800))
                    .catch(() => { this._ambientPending = true; }); // still blocked — try again next event
            }
        }

        // Post-gesture region resume — region narration may have been blocked
        // at first tap if a long await (TTS fetch) consumed the user-activation flag.
        // Same pattern as ambient: set src, duck, play; on failure re-queue.
        // Gen guard makes stale pendings (older than current _regionGen) a no-op.
        if (this._regionPending && this._regionPending.gen === this._regionGen) {
            const { src, gen } = this._regionPending;
            this._regionPending = null;
            if (!this._muted) {
                this._region.src = src;
                this._duck();
                this._region.play().catch(() => {
                    // Still blocked — re-queue for next event, but only if gen still current.
                    if (gen === this._regionGen) {
                        this._unduck();
                        this._regionPending = { src, gen };
                    }
                });
            }
        }

        // Master gain for this event — allows per-effect level adjustment.
        const master = ctx.createGain();
        master.gain.value = EFFECT_LEVEL;
        master.connect(ctx.destination);

        const t = ctx.currentTime;

        switch (event) {
            case 'page_advance':   this._fxPageAdvance(ctx, master, t);   break;
            case 'region_enter':   this._fxRegionEnter(ctx, master, t);   break;
            case 'camera_arrive':  this._fxCameraArrive(ctx, master, t);  break;
            case 'route_enter':    this._fxRouteEnter(ctx, master, t);    break;
            case 'reread_open':    this._fxRereadOpen(ctx, master, t);    break;
            case 'challenge_hit':  this._fxChallengeHit(ctx, master, t);  break;
            case 'challenge_miss': this._fxMiss(ctx, master, t);          break;
            case 'complete':       this._fxComplete(ctx, master, t);      break;
            case 'hint_appear':    this._fxHint(ctx, master, t);          break;
        }
    }

    // ── Effect synthesis ──────────────────────────────────────────────

    /**
     * page_advance — soft noise burst through a bandpass filter.
     * Evokes paper: airy, warm, 100ms.
     *
     * Tuning rationale:
     *   frequency 700Hz (was 900): warmer register, closer to real paper rustle.
     *   Q 1.0 (was 0.7): more focused at 700Hz, less "electronic noise" quality.
     *   gain 0.20 (was 0.28): balanced with other events — page turn should not
     *     be louder than a challenge confirmation. 0.20 × EFFECT_LEVEL = 0.110,
     *     sitting between challenge_miss (0.099) and challenge_hit (0.077/note).
     *   tail 0.11s (was 0.09s): slight extension for the "whoosh" to feel
     *     complete rather than cut off at the bandpass peak.
     */
    private _fxPageAdvance(ctx: AudioContext, dest: AudioNode, t: number): void {
        const frames = Math.round(ctx.sampleRate * 0.10);
        const buf    = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data   = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

        const src   = ctx.createBufferSource();
        src.buffer  = buf;
        const bpf   = ctx.createBiquadFilter();
        bpf.type    = 'bandpass';
        bpf.frequency.value = 700;
        bpf.Q.value = 1.0;
        const g     = ctx.createGain();
        g.gain.setValueAtTime(0.20, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);

        src.connect(bpf); bpf.connect(g); g.connect(dest);
        src.start(t); src.stop(t + 0.11);
    }

    /**
     * camera_arrive — barely-perceptible sub-22ms thud at camera rest.
     *
     * Designed to be BELOW the threshold of conscious attention.
     * Its role is not to be heard — it is to complete the physical sensation
     * of the camera landing. Like a lens clicking into focus, or a book
     * closing softly: the sound is felt more than heard.
     *
     * Effective gain: 0.055 × EFFECT_LEVEL(0.55) = 0.030.
     * With ambient at 0.30, this is ~10× quieter than the ambient layer —
     * well below masking threshold in most listening environments.
     *
     * Frequency: 200Hz sine. At 18ms duration this is only ~3.6 cycles —
     * too few for the ear to register a pitch. The brain hears it as a
     * soft low-frequency transient: a "thud" with no tonal character.
     *
     * This fires at camera END (via transitionend in VisorAlbum), not START.
     * region_enter fires at camera START — they bookend the camera motion.
     *
     * Does NOT fire on 'release' (return to overview): there is no arrival
     * point on release — the camera dissolves back to the full spread.
     * Does NOT fire on 'initial' or 'hold': no CSS transition runs.
     *
     * ── Silence note ─────────────────────────────────────────────────────
     * Between region_enter (camera start) and camera_arrive (camera end),
     * there is intentional silence in the effects layer. The ambient plays
     * unchanged and TTS may be loading. This window — typically 700–1100ms —
     * is the "traveling" silence: the reader is in motion, not yet arrived.
     * Nothing competes with the visual movement. The camera_arrive tap
     * closes this window.
     */
    private _fxCameraArrive(ctx: AudioContext, dest: AudioNode, t: number): void {
        const osc = ctx.createOscillator();
        osc.type  = 'sine';
        osc.frequency.value = 200; // sub-bass — physical thud, not a pitch
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.055, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + 0.022);
    }

    /**
     * route_enter — two-voice soft opening: C4 (261Hz) + E4 (329Hz), major third.
     *
     * Character: "you've chosen a reading path."
     * A soft harmonic confirmation that a reading mode has been selected.
     *
     * Design choices:
     *   Register: C4+E4 (mid) vs region_enter (C5+E5 high glide) — lower, warmer,
     *     less "alert" quality. The reader is orienting, not arriving.
     *   12ms stagger: voices "open" sequentially, not as a chord. The ear registers
     *     this as "spreading out" — an expanding gesture, not a hit.
     *   Major third: affirmative without being triumphant. Not the same pitches as
     *     challenge_hit (C5+E5, staggered 40ms, louder, faster), which is celebratory.
     *   Timing: fires in overview before the camera moves. This is the only audio
     *     event in the window between route selection and camera movement —
     *     no competition with region_enter (camera start), TTS, or ambient duck.
     *
     * Effective gain: 0.038 × EFFECT_LEVEL(0.55) = 0.021.
     *   vs hint_appear: 0.0495 effective — route_enter is ~2.4× quieter than hint_appear.
     *   vs ambient:     ratio ≈ 1:14 at AMBIENT_BASE(0.30). Perceptible but not loud.
     *   This is intentional: the route choice is confirmed, not announced.
     *
     * Duration: 130ms total per voice (110ms exponential decay + 20ms tail margin).
     * Combined sound: ~142ms (voice 1 onset + 12ms stagger + 130ms decay).
     */
    private _fxRouteEnter(ctx: AudioContext, dest: AudioNode, t: number): void {
        [261, 329].forEach((freq, i) => {
            const osc   = ctx.createOscillator();
            osc.type    = 'sine';
            osc.frequency.value = freq;
            const onset = t + i * 0.012; // 12ms stagger — opening, not hitting
            const g     = ctx.createGain();
            g.gain.setValueAtTime(0.038, onset);
            g.gain.exponentialRampToValueAtTime(0.0001, onset + 0.110);
            osc.connect(g); g.connect(dest);
            osc.start(onset); osc.stop(onset + 0.130);
        });
    }

    /**
     * region_enter — sine glide C5 → E5 (523 → 659 Hz).
     * Quiet arrival. The rising pitch signals "new space" without demanding
     * attention. 70ms — barely longer than the HIGHLIGHT phase.
     */
    private _fxRegionEnter(ctx: AudioContext, dest: AudioNode, t: number): void {
        const osc = ctx.createOscillator();
        osc.type  = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.linearRampToValueAtTime(659, t + 0.07);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.10, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + 0.12);
    }

    /**
     * reread_open — single descending glide E4 → C4 (329 → 261 Hz).
     * The formal inverse of region_enter.
     *
     * ── Relationship to region_enter ──────────────────────────────────────────
     *
     *   region_enter  — ascending C5 → E5 (523 → 659 Hz)
     *     "new space" — discovery, first encounter, rising into the unknown.
     *     Short (70ms glide), brighter register, gain 0.10 (0.055 effective).
     *
     *   reread_open   — descending E4 → C4 (329 → 261 Hz)
     *     "recognition" — familiarity, memory, settling back into known ground.
     *     Slower (150ms glide), warmer register, gain 0.028 (0.0154 effective).
     *
     * Same waveform (sine), same interval (major third), same shape (glide).
     * Three dimensions inverted: direction (↓ vs ↑), register (mid vs high),
     * volume (subliminal vs perceptible). The brain registers the pattern
     * without consciously parsing it — it "sounds familiar" without explaining why.
     *
     * ── Gain calibration ──────────────────────────────────────────────────────
     *
     *   Effective gain: 0.028 × EFFECT_LEVEL(0.55) = 0.0154.
     *   camera_arrive: 0.055 × 0.55 = 0.0302 — "below conscious attention."
     *   reread_open:   0.028 × 0.55 = 0.0154 — half that. Truly subliminal.
     *   At AMBIENT_BASE (0.30): ratio ≈ 1:20. Felt, not heard.
     *
     * ── Timing context ────────────────────────────────────────────────────────
     *
     * Fires at 400ms after mount (see VisorAlbum "reread session marker" effect).
     * At t=400ms: ambient is mid-crossfade (CROSSFADE_MS=500ms), rising from 0
     * to AMBIENT_BASE. The 0.0154 effective gain sits 20× below the ambient that
     * is itself still arriving — maximum possible masking. Only the subconscious
     * registers it.
     *
     * This is intentional. The signal is not a notification. It is a mark.
     *
     * ── Duration ──────────────────────────────────────────────────────────────
     *
     * 250ms total (150ms glide + 100ms tail). Twice as long as region_enter's
     * 120ms — memory lingers; arrival is immediate.
     */
    private _fxRereadOpen(ctx: AudioContext, dest: AudioNode, t: number): void {
        const osc = ctx.createOscillator();
        osc.type  = 'sine';
        osc.frequency.setValueAtTime(329, t);                        // E4 — familiar, warm
        osc.frequency.linearRampToValueAtTime(261, t + 0.15);        // → C4 — settling, resolving
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.028, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);       // long, patient decay
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + 0.25);
    }

    /**
     * challenge_hit — two-tone C5 + E5, staggered 40ms.
     * The stagger makes it feel warm and slightly musical rather than
     * digital. Major third = affirmative without being triumphant.
     */
    private _fxChallengeHit(ctx: AudioContext, dest: AudioNode, t: number): void {
        [523, 659].forEach((freq, i) => {
            const osc   = ctx.createOscillator();
            osc.type    = 'sine';
            osc.frequency.value = freq;
            const onset = t + i * 0.04;
            const g     = ctx.createGain();
            g.gain.setValueAtTime(0, onset);
            g.gain.linearRampToValueAtTime(0.14, onset + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, onset + 0.15);
            osc.connect(g); g.connect(dest);
            osc.start(onset); osc.stop(onset + 0.18);
        });
    }

    /**
     * challenge_miss — triangle wave descending 300 → 130 Hz.
     * Soft, rounded, not punishing — more of a "try again" than a "wrong".
     */
    private _fxMiss(ctx: AudioContext, dest: AudioNode, t: number): void {
        const osc = ctx.createOscillator();
        osc.type  = 'triangle';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(130, t + 0.10);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + 0.15);
    }

    /**
     * complete — rising arpeggio C5-E5-G5-C6 (C major chord, notes 80ms apart).
     * 300ms total. Resolved, warm, conclusive — not celebratory fanfare.
     */
    private _fxComplete(ctx: AudioContext, dest: AudioNode, t: number): void {
        [523, 659, 784, 1047].forEach((freq, i) => {
            const osc   = ctx.createOscillator();
            osc.type    = 'sine';
            osc.frequency.value = freq;
            const onset = t + i * 0.08;
            const g     = ctx.createGain();
            g.gain.setValueAtTime(0, onset);
            g.gain.linearRampToValueAtTime(0.16, onset + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, onset + 0.22);
            osc.connect(g); g.connect(dest);
            osc.start(onset); osc.stop(onset + 0.26);
        });
    }

    /**
     * hint_appear — single C6 ping (1047 Hz), very quiet, 60ms.
     * Registers as "something arrived" without triggering an alert response.
     *
     * Gain raised from 0.06 to 0.09 (effective: 0.09 × 0.55 = 0.0495):
     *   At 0.06 the ping was effectively inaudible when ambient is at 0.30 —
     *   the ~5.5dB difference against ambient was too small to cut through,
     *   especially on device speakers (poor high-frequency response at low levels).
     *   0.09 remains well below conscious attention threshold but reliably
     *   perceptible — equivalent to a very distant high-hat hit.
     */
    private _fxHint(ctx: AudioContext, dest: AudioNode, t: number): void {
        const osc = ctx.createOscillator();
        osc.type  = 'sine';
        osc.frequency.value = 1047;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.09, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + 0.09);
    }

    // ── Future: per-route ambient differentiation ────────────────────────────
    //
    // NarrativeRoute (types/index.ts) has two reserved fields that are NOT yet
    // active. When editorial use cases emerge, wire them here:
    //
    //   route.ambientOverride?: string
    //     A route-specific ambient loop URL. On route entry, VisorAlbum would pass
    //     route.ambientOverride to playAmbient() instead of page.ambientAudioUrl:
    //
    //       Current:  audio.playAmbient(currentPage.ambientAudioUrl)
    //       Future:   audio.playAmbient(route.ambientOverride ?? currentPage.ambientAudioUrl)
    //
    //     Crossfade (CROSSFADE_MS = 500ms) is already handled by playAmbient() —
    //     no structural change to this class needed. The route-entry interaction.trigger
    //     callback in VisorAlbum is the correct hook point (fires before camera move).
    //
    //     On route exit (goToNextPage / setActiveRouteId(null)), restore to page
    //     ambient: audio.playAmbient(currentPage.ambientAudioUrl).
    //
    //   route.audioMode?: 'calm' | 'tense' | 'wonder' | 'sparse'
    //     An abstract ambient character hint. Would drive subtle per-instance gain
    //     adjustments for the route duration:
    //       'calm'   → AMBIENT_BASE × 0.75 — quieter, more contemplative
    //       'tense'  → AMBIENT_BASE × 1.10 — slightly louder, more present
    //       'wonder' → AMBIENT_BASE × 1.00 — default, no change
    //       'sparse' → AMBIENT_BASE × 0.45 — very quiet; the reader notices
    //                  the absence of sound as much as its presence
    //
    //     Implementation: add setAudioMode(mode) that adjusts a per-instance
    //     _ambientBase (replacing the module const in _duck/_unduck references).
    //     Restored to default on setAudioMode(undefined) or route reset.
    //
    //     ⚠ DO NOT implement until calibrated with actual album audio content.
    //       The multipliers above are illustrative. Editorial tuning ("how quiet
    //       is 'sparse' for a forest-scene album?") requires listening tests.
    //       Wrong values here would feel broken, not subtle.

    // ── Cleanup ───────────────────────────────────────────────────────

    /**
     * Must be called on component unmount to release all resources:
     * stops audio, cancels rAF loops, revokes blob URLs, closes AudioContext.
     */
    destroy(): void {
        for (const el of [this._ambA, this._ambB, this._region]) {
            el.pause();
            el.src = '';
            const frame = this._fadeFrames.get(el);
            if (frame !== undefined) cancelAnimationFrame(frame);
        }
        this._blobUrls.forEach(url => URL.revokeObjectURL(url));
        this._blobUrls.clear();
        this._ttsCache.clear();
        this._ctx?.close();
    }
}
