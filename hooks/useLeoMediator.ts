/**
 * useLeoMediator — Synchronized narrative mediation decision layer.
 *
 * Decides IF, WHEN, and in WHAT MODE Leo should be present, based on:
 *   - camera state (viewerState, moveType, settle window)
 *   - interaction pipeline phase (IDLE required before Leo can appear)
 *   - dwell time in the current focus context
 *   - session-level intervention history
 *
 * Does NOT call the API, generate text, or manage chat state.
 * Returns a decision object — VisorAlbum acts on it.
 *
 * ── Design principle ──────────────────────────────────────────────────────────
 *
 * Leo must never compete with the narrative. The four-stage dwell model ensures:
 *
 *   NONE
 *     Leo is hidden. The reader is orienting, the camera is settling, the
 *     text is being processed. Leo's presence here would be noise.
 *
 *   VISIBLE
 *     Leo's button appears, but static — accessible if needed, not demanding.
 *     The reader is engaged. Leo is quietly present, like a librarian nearby.
 *
 *   PULSE (first visit only, non-reread)
 *     A single, non-repeating gentle pulse on Leo's button.
 *     "I'm here if you want to explore this together."
 *     Only on first visit — returning readers already know Leo is available.
 *
 *   INTERVENE
 *     Leo may send a pre-baked mediator hint (no API call — local variant by type).
 *     Subject to session gates: max 2 interventions, 90s cooldown between them.
 *     The hint is a question, not an explanation. Leo invites, never instructs.
 *
 * ── Timing profiles: contemplative vs standard ────────────────────────────────
 *
 * After a `reveal` move (first entry from overview into a region), the reader
 * is absorbing a new scene — image, text, and compositional space simultaneously.
 * The contemplative profile gives ~50% more time at each threshold before Leo
 * becomes visible, pulses, or intervenes.
 *
 * After `traverse` or `hold`, the reader already knows the album's rhythm.
 * The standard profile is leaner.
 *
 * `release` (return to overview) does not accumulate dwell — viewerState leaves
 * 'focus', which is a hard gate in the dwell engine.
 *
 * ── Camera settle window ──────────────────────────────────────────────────────
 *
 * After any camera-animating move (reveal/traverse/release), Leo is blocked for
 * CAMERA_SETTLE_MS. This ensures Leo never flashes during a camera animation and
 * never appears before the reader has visually arrived at the destination.
 * Max camera animation = 1100ms (reveal at max distance). Buffer = 200ms.
 *
 * ── Session gates ─────────────────────────────────────────────────────────────
 *
 * Proactive interventions are rate-limited at three levels:
 *   - Per-region: each page+region key is recorded; Leo never intervenes twice
 *     on the same region within a session.
 *   - Per-session: at most SESSION_MAX_INTERVENTIONS total.
 *   - Cooldown: INTERVENTION_COOLDOWN_MS between consecutive interventions.
 *
 * ── Note on silence ───────────────────────────────────────────────────────────
 *
 * Silence is NOT modeled as an automatic state.
 * It is the result of a deliberate evaluation where no intervention
 * is appropriate under current conditions.
 *
 * Leo does not "fallback to silence".
 * Leo decides whether to intervene or not.
 *
 * This preserves narrative intention and avoids passive behavior.
 *
 * Concretely: DwellStage 'none' means "conditions not yet met", not "Leo is
 * silent by default". Every transition in the dwell engine is an affirmative
 * decision — dwell has reached a threshold, session gates are open, the
 * camera has settled. Silence is the absence of a positive decision, not a
 * decision in itself.
 *
 * ── When silence occurs (timing map) ─────────────────────────────────────
 *
 *   t=0 to CAMERA_SETTLE_*_MS + CAMERA_BREATH_MS:
 *     Leo is hidden. Camera is settling. No Leo, no dwell.
 *     This is "arrival silence" — the image is being absorbed.
 *
 *   CAMERA_SETTLE_*_MS + 80ms to DWELL_VISIBLE_MS:
 *     Leo is present but static (isVisible=false). The reader is engaged.
 *     Dwell is accumulating. This is "present silence" — Leo is ready
 *     but waiting for an invitation from the reader's own attention.
 *
 *   overview state:
 *     Leo is always hidden (canShow = false). The reader is looking at the
 *     whole spread — no single region has focus. Leo must not interrupt
 *     this panoramic reading moment.
 *
 *   challenge state:
 *     Leo is always hidden. The reader is hunting for a region — their
 *     attention is game-directed. Leo must not compete with hit detection.
 *
 * Future maintainers: do NOT add a 'silent' stage, a silenceReason field, or
 * a "silence heuristic" that suppresses Leo based on inferred reader state.
 * If Leo should not intervene, the existing gates (canShow, dwellStage, session
 * limits) already produce that outcome through explicit, auditable logic.
 *
 * ── Integration seam ──────────────────────────────────────────────────────────
 *
 * shouldIntervene is a one-shot flag. hintText holds the pre-selected variant.
 * Both are cleared atomically by resetIntervention(), which is also called by
 * the dwell engine cleanup on region change.
 *
 * Callers do NOT need to call resetIntervention() on region change — the hook
 * handles it internally. resetIntervention() is exposed for early-dismiss from
 * user action (tap on hint, open chat, etc.).
 *
 * interventionType reflects the resolved type at intervention time (consistent
 * with hintText). Useful for customizing Leo's system prompt when chat opens.
 *
 * ── Future: proactive message generation ─────────────────────────────────────
 *
 * When /api/leo/mediate is implemented:
 *   1. Fire when shouldIntervene becomes true (use interventionType + visualContext)
 *   2. Replace the local hintText with the API-returned question
 *   3. resetIntervention() semantics stay unchanged
 *   4. No structural change to this hook needed — the API integration lives
 *      entirely in VisorAlbum's shouldIntervene useEffect.
 *
 * ── Future: adult-child mediator routing ─────────────────────────────────────
 *
 * When a mediator (teacher/parent) is co-reading, the `adult_bridge` type can
 * route to a "mediator card" instead of (or in addition to) Leo's bubble —
 * suggesting the adult ask the question. Wire via a `mediatorMode` input param;
 * the decision logic here is unchanged, only the caller's rendering differs.
 *
 * ── Future: onMoveComplete integration ───────────────────────────────────────
 *
 * Currently CAMERA_SETTLE_MS approximates when the CSS animation ends.
 * A more precise gate would listen to `transitionend` on the <img> element and
 * pass the result as an `isCameraIdle` boolean input. Architecture supports this:
 * replace `cameraSettled` state (driven by a timer here) with the passed-in bool.
 * No other change needed.
 *
 * ── Future: multimodal vs text-fallback differentiation ──────────────────────
 *
 * When the image loads successfully (MULTIMODAL_FULL degradation mode), Leo can
 * reference visual elements directly. In ALBUM_TEXT_FALLBACK, only text context
 * is available. The intervention types and variants that work well differ:
 * 'observe' variants like "¿Notaste ese detalle?" presuppose visual access.
 * Wire by passing `hasVisualAccess?: boolean` input; resolveInterventionType
 * avoids 'observe' when false and prefers 'wonder' or 'reflect' instead.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MoveType } from './useCameraController';
import type { InteractionPhase } from './useNarrativeInteraction';
import type { AlbumRegion } from '../types';

// ── Timing constants ────────────────────────────────────────────────────────────

/**
 * After a reveal move (overview → focus, first entry), Leo is blocked.
 * = max reveal animation (1100ms) + 200ms easing tail buffer.
 *
 * Reveal has the longest camera duration and introduces the most visual change
 * — the reader is absorbing a new scene for the first time. Leo must wait for
 * the image to fully arrive before becoming present.
 */
const CAMERA_SETTLE_REVEAL_MS = 1_300;

/**
 * After a traverse move (focus → different region, same page), Leo is blocked.
 * = max traverse animation (1000ms) + 100ms easing tail buffer.
 *
 * Traverse is more efficient than reveal — the reader is already in the album's
 * rhythm and the camera distance is typically shorter. 100ms buffer (vs 200ms
 * for reveal) is sufficient: the reader's eye tracks the camera motion and
 * arrives at the destination sooner relative to the animation end.
 *
 * Net effect: Leo's gate opens ~200ms earlier on traverse than on reveal.
 * Over a full album reading (many traversals), this adds up to a more
 * responsive presence without ever feeling premature.
 */
const CAMERA_SETTLE_TRAVERSE_MS = 1_100;

// ── Standard timing profile ─────────────────────────────────────────────────────
// Used after traverse, hold, or initial render.
// Reader knows the album's rhythm; Leo can appear somewhat sooner.

/**
 * Leo becomes VISIBLE. 3s: reader has scanned the region text and image area.
 * Before this, Leo would appear before the reveal has been absorbed.
 */
const DWELL_VISIBLE_MS = 3_000;

/**
 * Leo PULSES. 12s: reader has lingered. A single gentle pulse says
 * "I'm here if you want" without demanding attention.
 */
const DWELL_PULSE_MS = 12_000;

/**
 * Leo can INTERVENE. 20s: reader is either deeply engaged or quietly stuck.
 * Leo offers a question to open reflection.
 */
const DWELL_INTERVENE_MS = 20_000;

// ── Contemplative timing profile ────────────────────────────────────────────────
// Used after reveal (overview → focus, first entry into a region).
//
// After a reveal, the reader is absorbing a new scene for the first time —
// image, typography, and compositional space simultaneously. Research on
// picture-book comprehension suggests 4–8s for initial scene orientation,
// with richer illustrations requiring longer processing time.
//
// Contemplative profile gives ~50% more time at each stage so Leo never
// appears while the reader is still "arriving" at the image.

/** VISIBLE after reveal: 5s. Total from tap: ~8.3s (1300 settle + 5s dwell). */
const DWELL_VISIBLE_REVEAL_MS = 5_000;

/** PULSE after reveal: 16s. Total from tap: ~19.3s. */
const DWELL_PULSE_REVEAL_MS   = 16_000;

/**
 * INTERVENE after reveal: 25s. Total from tap: ~28.3s.
 * A reader still in this region after 28 seconds is genuinely dwelling.
 * Children who read quickly will have navigated away before this fires.
 */
const DWELL_INTERVENE_REVEAL_MS = 25_000;

// ── Session gates ────────────────────────────────────────────────────────────────

/**
 * Maximum proactive interventions per session.
 * 2: enough to establish Leo's presence without making it feel recurring.
 * With SESSION_MAX = 2 and COOLDOWN = 90s, Leo intervenes at most twice,
 * at least 90s apart — quiet, not systematic.
 */
const SESSION_MAX_INTERVENTIONS = 2;

/**
 * Minimum time between consecutive proactive interventions.
 * 90s: enough for a child to read, interact, and settle on the next region
 * before a new invitation could fire.
 */
const INTERVENTION_COOLDOWN_MS = 90_000;

/**
 * Breath window between camera arrival and Leo's first possible appearance.
 *
 * After CAMERA_SETTLE_*_MS elapses, Leo does not appear immediately —
 * this additional 80ms lets the reader's eye rest on the newly-arrived image
 * before Leo becomes visible. The difference is perceptual, not functional:
 * Leo does not arrive "at the same time" as the image; it arrives "after."
 *
 * 80ms = duration of the HIGHLIGHT phase in useNarrativeInteraction.
 * This creates a temporal echo of the pipeline's heartbeat: the same unit
 * that marks "contact registered" in interaction also marks "image settled"
 * in mediator timing.
 *
 * Range: 50–120ms. Below 50ms: imperceptible. Above 120ms: starts to feel
 * like a delayed reaction rather than a natural breath.
 *
 * ── Silence note ─────────────────────────────────────────────────────────
 * During this 80ms window, no new audio or visual element fires.
 * It is the quietest moment in the entry sequence: the camera has stopped,
 * the image has arrived, the narration may be loading — and nothing yet
 * competes for the reader's attention. Leo's presence begins after this pause.
 */
const CAMERA_BREATH_MS = 80;

// ── Types ───────────────────────────────────────────────────────────────────────

/** Mirrors VisorAlbum's ViewerState — no import needed (structural compat). */
type AlbumViewerState = 'overview' | 'focus' | 'challenge' | 'complete';

/**
 * Semantic type of Leo's next intervention.
 *
 * Every value is an active question posture — Leo asking, not explaining.
 * There is no 'none' or 'passive' value here. When Leo has nothing to ask,
 * shouldIntervene is false and interventionType is never consumed.
 * The type only matters when a decision to intervene has already been made.
 *
 * ── Taxonomy ──
 *
 *   observe      → directs attention to something in the scene.
 *                  "Mira bien este rincón." Not "what do you see?" (too schooly).
 *                  Maps from: pedagogicalObjective = 'literal'.
 *
 *   wonder       → opens inferential space without closing it.
 *                  "Algo aquí no está del todo explicado..." Not a leading question.
 *                  Maps from: pedagogicalObjective = 'inferential', and default.
 *
 *   connect      → bridges image/story to the reader's personal world.
 *                  "¿Esto te recuerda algo que conoces?"
 *                  Maps from: pedagogicalObjective = 'writing'.
 *
 *   reflect      → invites genuine reaction, not evaluation.
 *                  "¿Qué harías tú en ese lugar?" Not "¿estás de acuerdo?"
 *                  Maps from: pedagogicalObjective = 'reflective'.
 *
 *   adult_bridge → natural invitation to share the reading moment.
 *                  "Si estás con alguien, cuéntale qué está pasando aquí."
 *                  NOT a directive ("pide ayuda a un adulto" — condescending).
 *                  Fires at most once per session: first reading, first region
 *                  of a page, session's first intervention.
 *
 * ── What was removed ──
 *
 *   notice  → replaced by 'observe'. "¿Qué ves en esta parte?" was too
 *             school-exercise-like. Observation directed at a specific part
 *             of the image feels more like invitation than quiz.
 *
 *   predict → was reserved for 'overview' state. Since dwell only accumulates
 *             in 'focus', this type never fired. Removed rather than left as
 *             dead code. Can be re-added if overview dwell is implemented.
 */
export type InterventionType = 'observe' | 'wonder' | 'connect' | 'reflect' | 'adult_bridge';

/**
 * Variant pool per intervention type.
 *
 * 3–4 variants each. Rotation is sequential (not random): variants cycle in
 * order and reset only at session start. This prevents immediate repetition
 * while keeping the selection deterministic and testable.
 *
 * Quality criteria for each variant:
 *   ✓ Short — fits in a speech bubble without wrapping excessively
 *   ✓ Open — does not imply a right answer
 *   ✓ Situational — plausible for any album, not one specific book
 *   ✓ Natural — sounds like a thoughtful person, not an app prompt
 *   ✗ NOT schooly ("describe lo que ves", "¿por qué crees que?")
 *   ✗ NOT leading ("¿no crees que...?")
 *   ✗ NOT generic ("¿qué piensas?")
 */
export const MEDIATOR_VARIANTS: Record<InterventionType, readonly string[]> = {
    observe: [
        'Mira bien este rincón.',
        '¿Notaste algo que casi no se ve?',
        'Hay algo aquí que vale la pena mirar dos veces.',
        'Fíjate también en lo que hay alrededor.',      // broadens gaze to context
    ],
    wonder: [
        'Algo aquí no está del todo explicado...',
        '¿Qué imaginas que siente en este momento?',
        '¿Qué crees que va a pasar?',
        '¿Qué habrá pasado justo antes de este momento?', // backward temporal inference
    ],
    connect: [
        '¿Esto te recuerda algo que conoces?',
        '¿Conoces a alguien como este personaje?',
        '¿Alguna vez sentiste algo así?',
        'Si tuvieras que contarle esto a alguien, ¿por dónde empezarías?', // narrative reconstruction
    ],
    reflect: [
        '¿Qué te pareció lo que hizo?',
        '¿Qué harías tú en ese lugar?',
        '¿Esto te gustó o te inquietó?',
        '¿Cambiarías algo de lo que pasó?',             // counterfactual invitation
    ],
    adult_bridge: [
        'Si estás con alguien, cuéntale qué está pasando aquí.',
        '¿Qué le contarías de esta imagen a alguien que no la conoce?',
        'Vale la pena ver esto con otra persona.',
        'Esta imagen tiene algo para contar. ¿La ven juntos?', // collective invitation
    ],
};

export interface LeoMediatorInput {
    viewerState:      AlbumViewerState;
    /** From useCameraController — drives camera settle window + timing profile. */
    moveType:         MoveType;
    /** From useNarrativeInteraction — Leo blocked unless IDLE. */
    interactionPhase: InteractionPhase;
    pageIndex:        number;
    regionIndex:      number;
    /**
     * Minimal region context — only the fields the mediator needs for decision.
     * Pass currentRegion directly; unused fields are ignored.
     */
    currentRegion?:   Pick<AlbumRegion, 'id' | 'type' | 'pedagogicalObjective'>;
    /**
     * True if the reader has previously completed (≥90%) this album.
     * Suppresses the pulse invite and adult_bridge type — returning readers
     * already know Leo is available and are less likely to be co-reading.
     */
    isReread:         boolean;
    /**
     * Leo intervention type bias from the active narrative route.
     *
     * When set, takes precedence over the region's pedagogicalObjective
     * in resolveInterventionType — so a "Ruta del personaje" (leoMode='observe')
     * consistently invites the reader to look at visual details, regardless of
     * what each region's own pedagogicalObjective says.
     *
     * Undefined when: no route is active, or the active route has no leoMode.
     * In both cases, region.pedagogicalObjective drives the type as usual.
     *
     * adult_bridge is always resolved from session state, never from leoMode —
     * routes cannot force or suppress the adult bridge invitation.
     */
    activeRouteLeoMode?: InterventionType;

    /**
     * Human-readable label of the active narrative route (e.g. "Ruta del personaje").
     * NOT yet used by this hook — reserved for future route-aware hint text.
     *
     * ── Future: route-named intervention text ────────────────────────────────
     *
     * When /api/leo/mediate (or enriched local variants) adds route awareness,
     * hints can reference the reading path by name:
     *   "Vamos por el personaje... ¿qué ves en su expresión?"
     *   "Sigamos mirando el paisaje... ¿hay algo al fondo que no notaste?"
     *
     * Wire by including activeRouteLabel in the API request body alongside
     * interventionType and visualContext. shouldIntervene's gate already fires
     * at the right moment — no structural change to this hook needed.
     *
     * For local (non-API) variants: add activeRouteLabel as a second parameter
     * to pickVariant() and use string interpolation when route-specific
     * MEDIATOR_VARIANTS are introduced. The pickVariant function already
     * receives type; adding label is backward-compatible.
     */
    activeRouteLabel?: string;

    /**
     * How many times the reader has completed this album (from rereadStorage).
     * 0 = first read (never completed). 1 = second read. 2+ = third read or beyond.
     *
     * Used to bias Leo's intervention type progressively:
     *   readCount 0 → no bias (first encounter; follow region/route as authored)
     *   readCount 1 → observe → wonder  (second read: shift toward inference)
     *   readCount 2+→ observe → reflect  (subsequent: shift toward reflection)
     *
     * The bias only applies when:
     *   - activeRouteLeoMode is NOT set (routes override this)
     *   - The resolved type from pedagogicalObjective is 'observe' — the most
     *     detail-literal type, least interesting on re-encounter
     *
     * Other types (wonder, connect, reflect) are left unchanged: they are
     * already at varying depths of engagement and don't need progressive shift.
     *
     * Absent or 0 → first-read behavior (no change).
     */
    readCount?: number;
}

export interface LeoMediatorResult {
    /**
     * Leo is allowed to be rendered and visible in the current state.
     *
     * False when: challenge mode, HIGHLIGHT/PENDING pipeline, camera settling,
     * or dwell < DWELL_VISIBLE_MS (or _REVEAL variant for reveal entries).
     *
     * Implementation: CSS visibility should be used rather than unmounting
     * Chatbot, to preserve chat history state across visibility transitions.
     */
    isVisible:         boolean;

    /**
     * Leo's button should apply a gentle, non-repeating pulse animation.
     * Fires once: after DWELL_PULSE_MS on the first visit to a region.
     * Clears when dwell advances to 'intervene' or region changes.
     * Never fires on reread sessions or revisited regions.
     */
    shouldPulse:       boolean;

    /**
     * One-shot: Leo should display a mediator hint for the current region.
     * Fires when session gates are open and dwell >= DWELL_INTERVENE_MS.
     *
     * When this is true, hintText is already populated with the selected variant.
     * Calling resetIntervention() clears both flags. The dwell engine also clears
     * them on region change — callers do not need to call reset on navigation.
     */
    shouldIntervene:   boolean;

    /**
     * Resolved type at intervention time. Consistent with hintText.
     * Useful for customizing Leo's system prompt when chat is opened after hint.
     * Default 'wonder' before any intervention has fired.
     */
    interventionType:  InterventionType;

    /**
     * Pre-selected variant text for the current intervention.
     * Null when no intervention is active.
     *
     * Render this directly — no need to map through MEDIATOR_VARIANTS.
     * The rotation index is tracked internally so variants don't repeat
     * consecutively across regions in the same session.
     */
    hintText:          string | null;

    /**
     * Clears shouldIntervene and hintText.
     * Call on: hint tap, chat open, or any early-dismiss user action.
     * Do NOT call on region change — the hook handles that internally.
     */
    resetIntervention: () => void;
}

// ── Intervention type mapping ─────────────────────────────────────────────────────

const OBJECTIVE_TO_INTERVENTION: Record<string, InterventionType> = {
    literal:     'observe',
    inferential: 'wonder',
    reflective:  'reflect',
    writing:     'connect',
};

/**
 * Resolves the intervention type at gate-check time (not render time).
 *
 * Priority order:
 *   1. adult_bridge — session + reading conditions (always evaluated first;
 *      routes cannot override or suppress the adult bridge invitation).
 *   2. activeRouteLeoMode — editorial route bias (overrides region objective
 *      when a narrative route with a leoMode is active).
 *   3. region.pedagogicalObjective — per-region default.
 *   4. 'wonder' — fallback when no objective is set.
 *
 * adult_bridge criteria:
 *   - First reading only (!isReread): adults are most likely present during
 *     a child's first encounter with an album.
 *   - First region of the page (regionIndex === 0): natural pause point —
 *     the establishing shot of a new spread is a good moment to share.
 *   - Not yet fired this session (!adultBridgeFired): one adult_bridge per
 *     session is enough — a second would feel like a system pattern, not a
 *     human gesture.
 *
 * The caller (gate effect) marks adultBridgeFiredRef after this returns 'adult_bridge'.
 */
function resolveInterventionType(
    regionIndex:        number,
    isReread:           boolean,
    adultBridgeFired:   boolean,
    region?:            Pick<AlbumRegion, 'type' | 'pedagogicalObjective'>,
    activeRouteLeoMode?: InterventionType,
    readCount:          number = 0,
): InterventionType {
    // adult_bridge always wins when session conditions are met.
    if (!isReread && !adultBridgeFired && regionIndex === 0) {
        return 'adult_bridge';
    }
    // Route bias overrides per-region objective — consistent voice per reading path.
    // Routes also bypass the readCount bias: the route's editorial intent is explicit.
    if (activeRouteLeoMode) return activeRouteLeoMode;

    const obj     = region?.pedagogicalObjective;
    const fromObj = obj ? (OBJECTIVE_TO_INTERVENTION[obj] ?? 'wonder') : 'wonder';

    // Progressive rereading bias — only shifts 'observe' (the most literal type).
    // Other types are already at varying depths; no progressive shift needed.
    //   readCount 1 (second read): literal scanning → inferential wondering
    //   readCount 2+ (third+): literal scanning → genuine reflection
    if (fromObj === 'observe') {
        if (readCount >= 2) return 'reflect';
        if (readCount >= 1) return 'wonder';
    }

    return fromObj;
}

// ── Dwell stage ───────────────────────────────────────────────────────────────────

/** Progressive dwell state — never goes backward within a single dwell session. */
type DwellStage = 'none' | 'visible' | 'pulse' | 'intervene';

// ── Hook ──────────────────────────────────────────────────────────────────────────

export function useLeoMediator({
    viewerState,
    moveType,
    interactionPhase,
    pageIndex,
    regionIndex,
    currentRegion,
    isReread,
    activeRouteLeoMode,
    activeRouteLabel,
    readCount = 0,
}: LeoMediatorInput): LeoMediatorResult {

    // ── Camera settle window ──────────────────────────────────────────────────
    //
    // Any camera-animating move (reveal/traverse/release) marks the camera as
    // unsettled for CAMERA_SETTLE_MS. Static moves (initial/hold) are excluded:
    // 'initial' has no animation; 'hold' is a zero-duration no-op.
    const [cameraSettled, setCameraSettled] = useState(true);
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // initial and hold: no camera animation — camera is already settled.
        // release: Leo doesn't show in overview (viewerState gate), so settling
        //   for release is a no-op in practice. Skip it to avoid unnecessary
        //   state churn on every back navigation.
        if (moveType === 'initial' || moveType === 'hold' || moveType === 'release') return;

        setCameraSettled(false);
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);

        // Per-move settle window: reveal needs full 1300ms (image + scene orientation);
        // traverse uses 1100ms (shorter animation, reader already in rhythm).
        // CAMERA_BREATH_MS is added as a breath after the animation ends —
        // Leo appears "after the image has arrived", not simultaneously with it.
        const settleMs = (moveType === 'reveal'
            ? CAMERA_SETTLE_REVEAL_MS
            : CAMERA_SETTLE_TRAVERSE_MS
        ) + CAMERA_BREATH_MS;

        settleTimerRef.current = setTimeout(() => setCameraSettled(true), settleMs);

        return () => {
            if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        };
    }, [moveType]);

    // ── canShow — master gate ─────────────────────────────────────────────────
    //
    // All three conditions must be true before Leo is even considered:
    //   1. Not in challenge (game mode — Leo must not compete with hit detection)
    //   2. Pipeline is IDLE (navigation intent in progress → Leo is distraction)
    //   3. Camera has settled (animation complete → reader has arrived)
    const canShow = useMemo(() => (
        viewerState !== 'challenge' &&
        viewerState !== 'complete'  &&
        interactionPhase === 'IDLE' &&
        cameraSettled
    ), [viewerState, interactionPhase, cameraSettled]);

    // ── Refs for dwell effect closure ─────────────────────────────────────────
    //
    // These are updated every render so the dwell effect can capture current
    // values without them appearing as deps (which would reset the dwell timer).
    // Pattern: always-current ref, captured once at dwell start.
    const moveTypeRef           = useRef<MoveType>(moveType);
    const regionIndexRef        = useRef(regionIndex);
    const isRereadRef           = useRef(isReread);
    const currentRegionRef      = useRef(currentRegion);
    const activeRouteLeoModeRef = useRef<InterventionType | undefined>(activeRouteLeoMode);
    // activeRouteLabelRef: not used internally yet — held for future API context building.
    // When /api/leo/mediate receives route-aware prompts, read this ref in the
    // shouldIntervene gate effect and include it in the request body.
    const activeRouteLabelRef   = useRef<string | undefined>(activeRouteLabel);
    const readCountRef          = useRef(readCount);

    moveTypeRef.current           = moveType;
    regionIndexRef.current        = regionIndex;
    isRereadRef.current           = isReread;
    currentRegionRef.current      = currentRegion;
    activeRouteLeoModeRef.current = activeRouteLeoMode;
    activeRouteLabelRef.current   = activeRouteLabel;
    readCountRef.current          = readCount;

    // ── Dwell engine ──────────────────────────────────────────────────────────
    //
    // dwellKey: identifies the current focus session. Changing pageIndex or
    // regionIndex resets the dwell timer — each new region starts fresh.
    // Using indices (not region.id) handles regions without assigned ids.
    const dwellKey = `${pageIndex}:${regionIndex}`;

    const [dwellStage, setDwellStage] = useState<DwellStage>('none');

    // Visit tracking — per session. Set keyed by dwellKey.
    // First visit = this key has not been seen before in this session.
    const visitedRef = useRef<Set<string>>(new Set());

    // Timer slots — tracked so cleanup is precise.
    const dwellTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    // Intervention state — cleared by resetIntervention() and by dwell cleanup.
    const [shouldIntervene, setShouldIntervene] = useState(false);
    const [interventionType, setInterventionType] = useState<InterventionType>('wonder');
    const [hintText, setHintText] = useState<string | null>(null);

    // ── Variant rotation ──────────────────────────────────────────────────────
    //
    // Sequential rotation per type — cycles through variants without repetition
    // until all have been shown, then restarts. Tracking is per-session.
    const variantIndexRef = useRef<Partial<Record<InterventionType, number>>>({});

    const pickVariant = useCallback((type: InterventionType): string => {
        const variants = MEDIATOR_VARIANTS[type];
        const idx = variantIndexRef.current[type] ?? 0;
        variantIndexRef.current[type] = (idx + 1) % variants.length;
        return variants[idx];
    }, []);

    // ── Session intervention tracking ─────────────────────────────────────────
    const interventionCountRef    = useRef(0);
    const lastInterventionAtRef   = useRef(-INTERVENTION_COOLDOWN_MS); // open on first check
    const interventionFiredForRef = useRef<Set<string>>(new Set());
    const adultBridgeFiredRef     = useRef(false);

    // ── Dwell effect ──────────────────────────────────────────────────────────
    //
    // Runs when canShow changes (pipeline, challenge, camera) or dwellKey changes
    // (region navigation). Captures moveType at dwell start to select timing profile.
    useEffect(() => {
        dwellTimersRef.current.forEach(clearTimeout);
        dwellTimersRef.current = [];

        // Dwell only in 'focus'. overview/challenge/complete don't accumulate.
        if (!canShow || viewerState !== 'focus') {
            setDwellStage('none');
            // Clear any in-flight hint so it doesn't persist across navigation.
            setShouldIntervene(false);
            setHintText(null);
            return;
        }

        // Capture values at dwell start — these define this dwell session.
        const capturedMoveType   = moveTypeRef.current;
        const capturedIsFirstVisit = !visitedRef.current.has(dwellKey);
        const capturedIsReread   = isRereadRef.current;
        visitedRef.current.add(dwellKey);

        // Select timing profile based on how the camera arrived.
        // reveal → contemplative (more time for the image to breathe).
        // traverse / hold / initial → standard.
        const isContemplative = capturedMoveType === 'reveal';
        const dVisible   = isContemplative ? DWELL_VISIBLE_REVEAL_MS   : DWELL_VISIBLE_MS;
        const dPulse     = isContemplative ? DWELL_PULSE_REVEAL_MS     : DWELL_PULSE_MS;
        const dIntervene = isContemplative ? DWELL_INTERVENE_REVEAL_MS : DWELL_INTERVENE_MS;

        // Schedule stage transitions. Each timer only advances from the
        // expected predecessor to prevent double-advancement from stale timers.
        const t1 = setTimeout(
            () => setDwellStage(s => s === 'none' ? 'visible' : s),
            dVisible,
        );

        // Pulse: first visit, non-reread, contemplative or standard (both eligible).
        const t2 = (!capturedIsReread && capturedIsFirstVisit)
            ? setTimeout(
                () => setDwellStage(s => s === 'visible' ? 'pulse' : s),
                dPulse,
            )
            : null;

        const t3 = setTimeout(
            () => setDwellStage(s => (s === 'visible' || s === 'pulse') ? 'intervene' : s),
            dIntervene,
        );

        dwellTimersRef.current = [t1, t3, ...(t2 !== null ? [t2] : [])];

        return () => {
            dwellTimersRef.current.forEach(clearTimeout);
            dwellTimersRef.current = [];
            setDwellStage('none');
            // Clear hint on dwell reset — region changed or focus was lost.
            setShouldIntervene(false);
            setHintText(null);
        };
        // viewerState included to prevent dwell on non-focus states.
        // moveTypeRef/regionIndexRef/isRereadRef are deliberately NOT deps:
        // they are captured via refs at dwell start, so mid-dwell changes
        // (e.g. a rapid second navigate) don't reset the existing timer chain.
        // The dwellKey dep already handles region change resets.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canShow, dwellKey, viewerState]);

    // ── Proactive intervention gate ────────────────────────────────────────────
    //
    // Fires at most once per region, at most SESSION_MAX_INTERVENTIONS per
    // session, with INTERVENTION_COOLDOWN_MS between consecutive interventions.
    // Resolves type and picks variant atomically in the same state update batch.
    useEffect(() => {
        if (dwellStage !== 'intervene') return;

        // Experienced readers (readCount ≥ 1) get one extra intervention per session.
        // They navigate more confidently and are ready for more depth.
        const sessionMax = readCountRef.current >= 1
            ? SESSION_MAX_INTERVENTIONS + 1
            : SESSION_MAX_INTERVENTIONS;

        const sessionGateOpen =
            interventionCountRef.current    <  sessionMax                       &&
            !interventionFiredForRef.current.has(dwellKey)                      &&
            (performance.now() - lastInterventionAtRef.current) >= INTERVENTION_COOLDOWN_MS;

        if (sessionGateOpen) {
            // Resolve type using captured (not stale) values from refs.
            const resolvedType = resolveInterventionType(
                regionIndexRef.current,
                isRereadRef.current,
                adultBridgeFiredRef.current,
                currentRegionRef.current,
                activeRouteLeoModeRef.current,
                readCountRef.current,
            );
            const hint = pickVariant(resolvedType);

            // Atomic state update — all three in the same React 18 batch.
            // @analytics: emit 'leo_intervention_shown' (interventionType, dwellKey, readCount, contentId)
            //   Sprint 7: pass contentId via LeoMediatorInput or via a separate analyticsRef.
            setShouldIntervene(true);
            setInterventionType(resolvedType);
            setHintText(hint);

            // Update session counters.
            if (resolvedType === 'adult_bridge') adultBridgeFiredRef.current = true;
            interventionFiredForRef.current.add(dwellKey);
            interventionCountRef.current      += 1;
            lastInterventionAtRef.current      = performance.now();
        }
    }, [dwellStage, dwellKey, pickVariant]);

    const resetIntervention = useCallback(() => {
        // @analytics: emit 'leo_hint_dismissed' (interventionType, hintText, dwellKey, contentId)
        //   Only when shouldIntervene was true at the time of dismissal.
        //   Sprint 7: check shouldIntervene ref before emitting to distinguish
        //   manual dismiss from automatic region-change reset.
        setShouldIntervene(false);
        setHintText(null);
        // interventionType intentionally NOT cleared: it remains readable after
        // dismissal so callers can still use it for system prompt customization
        // when the user opens chat following a dismissed hint.
    }, []);

    // ── Derived outputs ────────────────────────────────────────────────────────

    // isVisible: canShow AND dwell is past the VISIBLE threshold.
    const isVisible = canShow && dwellStage !== 'none';

    // shouldPulse: visible, dwell reached pulse stage, not yet intervening.
    const shouldPulse =
        isVisible &&
        dwellStage === 'pulse' &&
        !shouldIntervene;

    return {
        isVisible,
        shouldPulse,
        shouldIntervene,
        interventionType,
        hintText,
        resetIntervention,
    };
}
