/**
 * useNarrativeInteraction
 *
 * A minimal interaction pipeline for narrative-paced UI in the album viewer.
 * Introduces a HIGHLIGHT → PENDING → ACTIVE rhythm between user input and
 * state transitions, so interactions feel like "anticipation → revelation"
 * rather than "tap → immediate change".
 *
 * Pipeline timing:
 *   IDLE → HIGHLIGHT (t=0)
 *        → PENDING   (t=HIGHLIGHT_DURATION_MS ≈ 80ms — device-independent)
 *        → ACTIVE    (t=delay, action fires)
 *        → IDLE      (t=delay + ~1 frame, one paint after ACTIVE)
 *
 * ── The narrative heartbeat ────────────────────────────────────────────────
 *
 * Why 80ms + 190ms (≈270ms total) works as a perceptual unit:
 *
 *   HIGHLIGHT (80ms) ≈ the systole — contact registered. Half the duration of
 *   a cardiac muscle contraction. The brain reads this as "tap received", not
 *   as a deliberate pause. It must be perceptible (hence not rAF/device-speed)
 *   but short enough to feel physical, not computational.
 *
 *   PENDING (≈190ms) ≈ the diastole — held breath. The suspension between
 *   touch and reveal. Long enough to create anticipation; short enough not to
 *   read as lag.
 *
 *   Together they form one pulse: fast contact → slow suspension → release.
 *   The total (270ms) sits inside the 200–300ms window that perception research
 *   identifies as "weighted intentionality" rather than "system slowness".
 *   The brain attributes it to narrative gravity, not latency. Above 400ms
 *   (MAX_INTERACTION_DELAY_MS) the illusion breaks.
 *
 *   Ratio: HIGHLIGHT : PENDING ≈ 1 : 2.4. Do not compress HIGHLIGHT below
 *   60ms (invisible on 60Hz) or expand PENDING above 220ms (starts feeling slow).
 *
 * ── Device-independent HIGHLIGHT timing ───────────────────────────────────
 *
 *   rAF fires at the display refresh rate (~8ms on ProMotion 120Hz vs ~16ms
 *   on 60Hz). Using a fixed setTimeout(HIGHLIGHT_DURATION_MS) makes the
 *   HIGHLIGHT window consistent across devices and avoids near-invisible
 *   HIGHLIGHT flashes on high-refresh screens.
 *
 * ── Cancellation ──────────────────────────────────────────────────────────
 *
 *   Any in-flight interaction is cancelled automatically when trigger() is
 *   called again. The interactionIdRef pattern guarantees that stale timer
 *   callbacks from a cancelled interaction never fire — even if cancel() races
 *   with a setTimeout that was already queued.
 *
 * ── onPhaseChange ─────────────────────────────────────────────────────────
 *
 *   Optional callback for analytics / evidence hooks / audio integration.
 *   Receives the new phase and PhaseChangeMeta. Not required for basic use.
 *   PhaseChangeMeta.extra is a forward-compatibility seam for future call-site
 *   context (camera, Leo annotations, audio triggers) — see type definition.
 *
 * ── Debug ─────────────────────────────────────────────────────────────────
 *
 *   localStorage.setItem('ALBUM_DEBUG', '1') enables timing logs including
 *   per-phase durations, cancel count, and cancel rate per session.
 *
 * ── Future: trigger signature evolution ───────────────────────────────────
 *
 *   When the pipeline needs to carry richer intent — camera focus, Leo evidence
 *   logging, audio cues — trigger() can evolve from:
 *
 *       trigger(action, opts?)
 *
 *   to:
 *
 *       trigger({ action, intent?, type?, meta? }, opts?)
 *
 *   The interactionIdRef pattern, applyPhase, and onPhaseChange seam are all
 *   forward-compatible with this change. The current architecture does NOT
 *   block it — opts was intentionally kept extensible for exactly this path.
 *   The guard `typeof firstArg === 'function'` would allow a non-breaking
 *   dual-mode overload during migration.
 *
 * ── Future: pointer event integration ─────────────────────────────────────
 *
 *   pointerdown → HIGHLIGHT, pointerup → PENDING: distinguishes hover-preview
 *   from committed-intent (useful for camera and mediator flows where a
 *   "hover long enough to commit" affordance is desired). Wire via separate
 *   pointerdown/pointerup handlers that call trigger(action, { skipHighlight: true })
 *   on pointerup when HIGHLIGHT is already active, bypassing the first timer.
 *   onPhaseChange is the integration seam: camera, Leo evidence, and audio
 *   subsystems should hook in here rather than forking trigger().
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ── Semantic Constants ─────────────────────────────────────────────────────────

/** Total delay from trigger() to action() fire. Default advance delay. */
export const NARRATIVE_ADVANCE_DELAY_MS = 270;

/**
 * How long HIGHLIGHT lasts before transitioning to PENDING.
 * Fixed (not rAF-based) for device-independent timing across 60/90/120Hz displays.
 * See "narrative heartbeat" in module JSDoc for the perceptual rationale.
 */
export const HIGHLIGHT_DURATION_MS = 80;

/** Hard ceiling on any caller-provided delay. Above this it feels like lag. */
export const MAX_INTERACTION_DELAY_MS = 400;

// ── Types ─────────────────────────────────────────────────────────────────────

export type InteractionPhase = 'IDLE' | 'HIGHLIGHT' | 'PENDING' | 'ACTIVE';

export interface PhaseChangeMeta {
    /** Time elapsed since trigger() was called, in milliseconds. */
    elapsed:   number;
    /** Phase being left. */
    prevPhase: InteractionPhase;
    /**
     * Optional call-site context — forward-compatibility seam for future
     * integrations (camera evidence, audio triggers, Leo annotations).
     *
     * No current code path populates this field. It is passed through from the
     * internal applyPhase(newPhase, prevPhase, extra?) helper to onPhaseChange,
     * allowing downstream consumers to receive structured context without a
     * breaking API change. Future callers: populate via applyPhase third arg.
     */
    extra?: Record<string, unknown>;
}

export interface UseNarrativeInteractionResult {
    phase:        InteractionPhase;
    trigger:      (action: () => void, opts?: { delay?: number }) => void;
    cancel:       () => void;
    /** Convenience: true while phase is HIGHLIGHT or PENDING */
    isActivating: boolean;
}

// ── Debug ─────────────────────────────────────────────────────────────────────

// Checked once at module load to keep hot paths clean.
const ALBUM_DEBUG =
    typeof window !== 'undefined' && window.localStorage?.getItem('ALBUM_DEBUG') === '1';

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNarrativeInteraction(
    defaultDelay: number = NARRATIVE_ADVANCE_DELAY_MS,
    onPhaseChange?: (phase: InteractionPhase, meta: PhaseChangeMeta) => void,
): UseNarrativeInteractionResult {
    const [phase, setPhase] = useState<InteractionPhase>('IDLE');

    // Timer slots — one per pipeline stage to allow independent clearing.
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

    const mountedRef        = useRef(true);
    const t0Ref             = useRef(0);

    // Interaction ID — incremented on every trigger() and cancel().
    // Timer callbacks capture their ID at birth; they no-op if the current ID
    // no longer matches (i.e., a newer interaction or cancel() preempted them).
    const interactionIdRef  = useRef(0);

    // Phase ref — tracks current phase synchronously so cancel() can read
    // prevPhase without nesting setPhase inside a setPhase updater callback.
    const currentPhaseRef   = useRef<InteractionPhase>('IDLE');

    // Debug counters — only allocated/tracked when ALBUM_DEBUG is true.
    // Using refs (not state) so tracking is zero-overhead in production.
    const cancelCountRef    = useRef(0);
    const triggerCountRef   = useRef(0);
    const phaseTimesRef     = useRef<Partial<Record<InteractionPhase, number>>>({});

    // Stable ref to onPhaseChange so applyPhase never needs to be recreated.
    const onPhaseChangeRef  = useRef(onPhaseChange);
    useEffect(() => { onPhaseChangeRef.current = onPhaseChange; }, [onPhaseChange]);

    // Cleanup on unmount — prevents callbacks from firing on dead components.
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
            if (activeTimerRef.current)    clearTimeout(activeTimerRef.current);
        };
    }, []);

    /**
     * applyPhase — stable helper that advances the phase and notifies consumers.
     *
     * useCallback(fn, []) is safe here because all mutable state is accessed via
     * refs (no stale-closure risk).
     *
     * @param newPhase  - Phase to transition to.
     * @param prevPhase - Phase being left (for meta / debug).
     * @param extra     - Optional call-site context. Forwarded as-is through
     *                    PhaseChangeMeta.extra to onPhaseChange consumers.
     *                    No current path uses this; it is the forward-compat seam
     *                    for camera, audio, and Leo integrations.
     */
    const applyPhase = useCallback((
        newPhase:  InteractionPhase,
        prevPhase: InteractionPhase,
        extra?:    Record<string, unknown>,
    ) => {
        if (!mountedRef.current) return;

        const elapsed = performance.now() - t0Ref.current;
        currentPhaseRef.current = newPhase;

        if (ALBUM_DEBUG) {
            phaseTimesRef.current[newPhase] = elapsed;
            console.log(`[NarrativeInteraction] ${prevPhase} → ${newPhase}  elapsed=${elapsed.toFixed(1)}ms`);

            // On ACTIVE: emit a summary of per-phase durations and cancel rate.
            // This is the "product metric" view — each line is one complete interaction.
            if (newPhase === 'ACTIVE') {
                const t = phaseTimesRef.current;
                const tHL = t['HIGHLIGHT'] ?? 0;
                const tPE = t['PENDING']   ?? elapsed;
                const tAC = elapsed;
                const dHL = (tPE - tHL).toFixed(1);
                const dPE = (tAC - tPE).toFixed(1);
                const rate = triggerCountRef.current > 0
                    ? `${cancelCountRef.current}/${triggerCountRef.current}`
                    : '—';
                console.log(
                    `[NarrativeInteraction] ↳ HL=${dHL}ms  PE=${dPE}ms` +
                    `  total=${tAC.toFixed(1)}ms  cancelRate=${rate}`,
                );
            }
        }

        setPhase(newPhase);
        onPhaseChangeRef.current?.(newPhase, { elapsed, prevPhase, extra });
    }, []);

    const cancel = useCallback(() => {
        // Invalidate current interaction — any in-flight timers will no-op.
        interactionIdRef.current += 1;

        if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; }
        if (activeTimerRef.current)    { clearTimeout(activeTimerRef.current);    activeTimerRef.current    = null; }

        // Read prevPhase from ref — avoids nesting setPhase inside setPhase updater.
        if (mountedRef.current && currentPhaseRef.current !== 'IDLE') {
            applyPhase('IDLE', currentPhaseRef.current);
        }

        if (ALBUM_DEBUG) {
            cancelCountRef.current += 1;
            const rate = triggerCountRef.current > 0
                ? `${cancelCountRef.current}/${triggerCountRef.current}`
                : '—';
            console.log(`[NarrativeInteraction] cancel  total=${cancelCountRef.current}  rate=${rate}`);
        }
    }, [applyPhase]);

    const trigger = useCallback(
        (action: () => void, opts?: { delay?: number }) => {
            // Latest tap wins — cancel any in-flight interaction first.
            if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; }
            if (activeTimerRef.current)    { clearTimeout(activeTimerRef.current);    activeTimerRef.current    = null; }

            // Mint a new interaction ID. Timer callbacks compare against this ID
            // at execution time; a mismatch means this interaction was superseded.
            const myId = ++interactionIdRef.current;

            const delay = Math.min(opts?.delay ?? defaultDelay, MAX_INTERACTION_DELAY_MS);
            t0Ref.current = performance.now();

            if (ALBUM_DEBUG) {
                triggerCountRef.current += 1;
                phaseTimesRef.current = {};
                console.log(`[NarrativeInteraction] trigger  id=${myId}  delay=${delay}ms  #${triggerCountRef.current}`);
            }

            // ── Phase 1: HIGHLIGHT ─────────────────────────────────────────
            applyPhase('HIGHLIGHT', 'IDLE');

            // ── Phase 2: PENDING ───────────────────────────────────────────
            // Fixed setTimeout(HIGHLIGHT_DURATION_MS) instead of rAF: device-
            // independent timing. rAF fires at refresh rate (~8ms on 120Hz vs
            // ~16ms on 60Hz) — too short on high-refresh screens for HIGHLIGHT
            // to be perceptible. 80ms is consistently visible on all displays.
            highlightTimerRef.current = setTimeout(() => {
                if (!mountedRef.current || interactionIdRef.current !== myId) return;
                highlightTimerRef.current = null;
                applyPhase('PENDING', 'HIGHLIGHT');
            }, HIGHLIGHT_DURATION_MS);

            // ── Phase 3: ACTIVE ────────────────────────────────────────────
            // Action fires after the full delay. The remaining PENDING window
            // is (delay - HIGHLIGHT_DURATION_MS). Scheduled from t=0 at the
            // full delay so total elapsed from trigger() to action() is always
            // exactly `delay` regardless of HIGHLIGHT_DURATION_MS.
            activeTimerRef.current = setTimeout(() => {
                if (!mountedRef.current || interactionIdRef.current !== myId) return;
                activeTimerRef.current = null;

                applyPhase('ACTIVE', 'PENDING');
                action();

                // ── Return to IDLE ─────────────────────────────────────────
                // One paint after ACTIVE so the phase is observable by consumers
                // that want to animate on the transition out (e.g., evidence hooks).
                requestAnimationFrame(() => {
                    if (mountedRef.current && interactionIdRef.current === myId) {
                        applyPhase('IDLE', 'ACTIVE');
                    }
                });
            }, delay);
        },
        [defaultDelay, applyPhase],
    );

    return {
        phase,
        trigger,
        cancel,
        isActivating: phase === 'HIGHLIGHT' || phase === 'PENDING',
    };
}
