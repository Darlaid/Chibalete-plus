/**
 * useCameraController
 *
 * Manages camera framing for the album viewer.
 *
 * Separates camera intent from viewer state machine:
 *   VisorAlbum handles WHAT to show (region index, viewer state)
 *   useCameraController handles HOW to show it (scale, pan, easing, duration)
 *
 * ── Coordinate contract ────────────────────────────────────────────────────
 *
 * All coordinates follow the albumGeometry.ts contract:
 *   0%,0% = top-left of rendered image content
 *   100%,100% = bottom-right of rendered image content
 *
 * The returned transform is:
 *   scale(S) translate(Tx%, Ty%)
 *   with transformOrigin: center center
 *
 * Mathematical proof that regionCenter maps to element center:
 *   origin = (50%, 50%) = element center (ox, oy)
 *   translate = (50 - regionCenterX, 50 - regionCenterY)
 *   ⟹ after scale(S) translate(T): regionCenter → (ox, oy) ✓
 *
 * ── Scale framing strategy ─────────────────────────────────────────────────
 *
 * Goal: region fills fillFactor% of the viewport, with breathing room.
 *
 * Problem with naive `scale = fillFactor / maxDim`:
 *   A 5%×5% region gives scale = 65/5 = 13x — excessive, loses context.
 *
 * Solution: `effectiveDim = max(maxDim, minRegionDim)`
 *   Treats small regions as if they were minRegionDim wide for the scale
 *   calculation. The region remains centered precisely, but the camera
 *   doesn't over-commit on tiny subjects — preserving compositional context.
 *
 * ── CameraHint — editorial framing overrides ──────────────────────────────
 *
 * Individual regions can carry a `cameraHint` to express editorial intent:
 *
 *   biasY:   vertical viewport shift (+ = more space above the subject).
 *            Typical use: faces/characters need headroom. A biasY of +6
 *            shifts the camera slightly down so the subject appears in the
 *            lower-center, with breathing room above.
 *            Range: -10 to +10. Neutral: 0.
 *
 *   padding: reduces zoom aggressiveness (0 = default, 0.4 = 40% less zoom).
 *            Useful for regions that are compositionally meaningful only with
 *            their surroundings — e.g., a small character in a wide landscape.
 *            Range: 0 to 0.5.
 *
 * These fields are ready to receive from AlbumRegion when the schema adds
 * `cameraHint?: CameraHint`. VisorAlbum passes `currentRegion?.cameraHint`
 * to useCameraController. No structural change needed.
 *
 * ── Easing philosophy ──────────────────────────────────────────────────────
 *
 * Three movement archetypes, each with a distinct cubic-bezier:
 *
 * reveal   cubic-bezier(0.22, 0.9, 0.36, 1)  ← Softened ExpoOut
 *   Strong initial momentum → gradual, organic final approach.
 *   The camera "commits" to the destination with confidence but settles
 *   without snapping into place. Reads as: "eyes drawn to subject, landing
 *   gently." vs the previous (0.16, 1, 0.3, 1), P1 is slightly wider and
 *   less aggressive — the initial burst is confident but not abrupt.
 *   Used for the first entry from overview (most dramatic moment).
 *   Duration: distance-scaled around 900ms base.
 *
 * traverse cubic-bezier(0.4, 0, 0.2, 1)  ← Material standard
 *   Clean, efficient movement between known subjects. Fast midpoint,
 *   clean deceleration. No drama — just purposeful navigation.
 *   Duration: distance-scaled around 700ms base.
 *
 * release  cubic-bezier(0.4, 0, 0.6, 1)  ← EaseInOut, front-weighted
 *   "Stepping back, releasing the focus." Slightly front-weighted to
 *   feel like the camera exhales rather than snapping back.
 *   Duration: distance-scaled around 550ms base.
 *
 * ── Distance-based duration ────────────────────────────────────────────────
 *
 * Duration scales with the camera movement distance: a small pan between
 * adjacent regions takes less time than a large traversal across the image.
 *
 * Distance metric:
 *   panDist   = Euclidean pan in image-% space
 *   scaleDist = |log2(newScale / oldScale)| × 30
 *               (log2 space: perceptually uniform; ×30 calibrates so a 2x
 *               scale change contributes ~30 units, ≈ a 30% pan)
 *   distance  = panDist + scaleDist
 *
 * Duration = clamp((distance / pivot) × base, min, max)
 *
 * Pivot is the "reference" distance at which the base duration applies.
 * Short moves → snappy; long moves → extended, weighted.
 *
 * ── Micro-hold before camera start (PLANNED, NOT YET IMPLEMENTED) ─────────
 *
 * A 40–80ms hold between ACTIVE phase start and first camera pixel movement
 * would amplify the sense of intentionality: the interaction pipeline creates
 * anticipation (HIGHLIGHT → PENDING), ACTIVE fires and the state changes, and
 * then the camera "takes a breath" before committing to the move.
 *
 * Implementation requires useCameraController to receive the phase from
 * useNarrativeInteraction (via onPhaseChange or a shared ref) to delay the
 * CSS transition start. Current CSS-only architecture cannot delay transition
 * start after the transform changes — it requires a JS-side hold:
 *
 *   onPhaseChange = (phase) => {
 *     if (phase === 'ACTIVE') {
 *       holdTimerRef.current = setTimeout(() => camera.unlock(), HOLD_MS);
 *     }
 *   }
 *
 * where camera.unlock() triggers a React state update that releases the
 * queued transform. Architecture supports this — no structural change needed.
 *
 * ── Anticipatory micro-zoom during PENDING (PLANNED, NOT YET IMPLEMENTED) ─
 *
 * During PENDING phase (the "diastole" — held breath before reveal), the
 * camera could apply a subtle 1.02–1.04× scale nudge toward the next region,
 * giving the viewer a physical sense that "something is about to happen here"
 * before the full camera move fires at ACTIVE.
 *
 * The effect is directional: the micro-zoom nudges toward the destination
 * region's center, not uniformly. This requires knowing the next target
 * region during PENDING — before ACTIVE fires and state changes.
 *
 * Implementation sketch:
 *   1. VisorAlbum exposes a `pendingRegion` ref set on tap (before the
 *      interaction pipeline fires ACTIVE).
 *   2. useCameraController receives `pendingRegion` as an optional arg.
 *   3. During PENDING phase (detected via onPhaseChange seam):
 *      - Compute a partial frame: lerp(currentFrame, targetFrame, 0.15)
 *        or apply a fixed 1.03× scale with slight translate toward target.
 *      - Use a fast transition: `transform 80ms ease-out`
 *   4. At ACTIVE, the full frame transition takes over — the micro-zoom
 *      "merges into" the main move without a visible step discontinuity
 *      (provided the PENDING nudge delta is small, ≤ 3–4% of the total move).
 *
 * Integration seam: onPhaseChange callback in useNarrativeInteraction already
 * supports this — no breaking changes to either hook's public API needed.
 * The pendingRegion ref pattern prevents stale-closure issues (same as
 * isInitialRef / prevFrameRef). CSS transition continuity is preserved
 * because CSS picks up mid-transition states cleanly at small deltas.
 *
 * ── Integration with interaction pipeline ─────────────────────────────────
 *
 * The narrative pipeline (HIGHLIGHT → PENDING → ACTIVE, ~270ms) fires before
 * React state changes. The camera starts moving at ACTIVE time — which is
 * when VisorAlbum updates viewerState/currentRegion and triggers a re-render.
 * The pipeline provides the "anticipation"; the camera provides the "reveal."
 * They are complementary, not redundant.
 *
 * ── Future extension points ────────────────────────────────────────────────
 *
 * - onMoveComplete callback: fires when CSS transitionend occurs on the img.
 *   Wire via ref + transitionend event listener. Useful for: Leo triggering
 *   after camera settles, audio cue on arrival, evidence logging.
 *
 * - lastMoveType in CameraControllerResult: already exposed. Consumers
 *   (analytics, Leo) can read the move type on each render.
 *
 * - currentFrame in CameraControllerResult: already exposed. Leo can use
 *   scale + translate to describe spatial relationships in the current view.
 *
 * - Mediator preview: useCameraController(previewRegion, 'focus', config)
 *   can drive a live preview in the admin/mediator panel without coupling
 *   to VisorAlbum's state machine.
 */

import { useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { AlbumRegion } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Mirrors VisorAlbum's ViewerState. Structurally compatible — no import needed. */
type AlbumViewerState = 'overview' | 'focus' | 'challenge' | 'complete';

/** Computed camera position in image-relative coordinates. */
export interface CameraFrame {
    scale:      number;
    /** Pan in % of rendered image width. */
    translateX: number;
    /** Pan in % of rendered image height. */
    translateY: number;
}

/**
 * Per-region editorial framing hints.
 *
 * Ready to receive from AlbumRegion once the schema adds `cameraHint?: CameraHint`.
 * Until then, pass explicitly as the 4th arg to useCameraController, or leave
 * undefined for pure mathematical centering.
 */
export interface CameraHint {
    /**
     * Vertical viewport bias in image-% units.
     *
     * Positive → more space ABOVE the region (face/character headroom).
     *   Example: +6 for a standing character — camera frames slightly lower,
     *   leaving breathing room above their head.
     *
     * Negative → more space BELOW (ground anchoring, text).
     *
     * Range: -10 to +10. Default: 0 (pure mathematical center).
     *
     * Implementation: added to translateY after centering calculation.
     * translateY = 50 - regionCenterY + biasY
     * A positive biasY moves the image DOWN in the viewport, revealing more
     * of what is above the region.
     */
    biasY?: number;

    /**
     * Padding factor in 0–0.5 range. Reduces zoom aggressiveness.
     *
     * 0   = no extra padding — default fillFactor applies (region fills ~65% of viewport).
     * 0.3 = 30% less zoom — region fills ~45%, showing more context.
     *
     * Useful for regions that are compositionally meaningful only with their
     * surroundings: a small object in a wide landscape, a detail that references
     * the larger scene.
     *
     * Implementation: applied as a multiplier on fillFactor:
     *   effectiveFill = fillFactor × (1 - padding)
     */
    padding?: number;

    /**
     * Semantic composition preset. Maps to sensible biasY + padding defaults
     * without requiring per-region manual tuning.
     *
     *   'portrait'  → biasY +6, padding 0.05
     *     Faces and characters: headroom above, close framing.
     *     The camera frames slightly lower so the subject has air above.
     *
     *   'object'    → biasY  0, padding 0.10
     *     Objects, details, symbols: centered, slight context.
     *
     *   'landscape' → biasY -2, padding 0.25
     *     Wide scenes, establishing shots: ground-anchored, lots of context.
     *     Negative biasY anchors the subject toward the bottom of frame,
     *     giving the scene visual weight.
     *
     * Explicit biasY or padding values always override the preset.
     * This allows "portrait with extra padding" → { composition: 'portrait', padding: 0.2 }.
     */
    composition?: 'portrait' | 'object' | 'landscape';
}

export interface CameraConfig {
    /**
     * Region fills this % of the viewport dimension (default: 65).
     * Higher = tighter framing. 65 preserves compositional context.
     */
    fillFactor?:   number;
    /**
     * Minimum effective region dimension used for scale calculation (default: 15).
     * Prevents excessive zoom on small regions by treating them as if they were
     * at least this wide/tall. The actual centering is unaffected.
     */
    minRegionDim?: number;
    /**
     * Maximum allowed scale multiplier (default: 7.0).
     * Safety ceiling — reached only with custom configs lowering minRegionDim.
     */
    maxScale?:     number;
    /**
     * Minimum scale when entering a zoomed state (default: 1.4).
     * Ensures even large regions feel "entered", not just reshuffled.
     */
    minScale?:     number;
}

/**
 * Classification of the current camera movement.
 * Exposed in CameraControllerResult for analytics, evidence logging, Leo.
 */
export type MoveType = 'initial' | 'reveal' | 'traverse' | 'release' | 'hold';

export interface CameraControllerResult {
    /**
     * Drop-in replacement for the <img> style prop.
     * Includes transform, transformOrigin, and transition.
     */
    transformStyle: CSSProperties;
    /**
     * Current computed frame — for analytics, Leo evidence, future consumers.
     * Equals IDENTITY_FRAME when in overview state.
     */
    currentFrame:   CameraFrame;
    /**
     * Type of the current camera move — for analytics and integration hooks.
     * 'initial' = first render (no animation); 'hold' = state change with no
     * camera movement (e.g., focus ↔ challenge on the same region).
     */
    lastMoveType:   MoveType;
}

// Internal — not exported.
interface DurationSpec {
    base:  number;  // duration (ms) at reference distance
    min:   number;  // floor — very short moves never feel too snappy
    max:   number;  // ceiling — very long moves don't become tedious
    pivot: number;  // reference distance at which base applies
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULTS: Required<CameraConfig> = {
    fillFactor:   65,
    minRegionDim: 15,
    maxScale:     7.0,
    minScale:     1.4,
};

/**
 * Easing curves — see module JSDoc for per-curve rationale.
 *
 * reveal: Softened ExpoOut (0.22, 0.9, 0.36, 1).
 *   Compared to strict ExpoOut (0.16, 1, 0.3, 1):
 *   - P1x: 0.16 → 0.22  (slightly wider acceleration ramp)
 *   - P1y: 1.0  → 0.90  (less abrupt initial burst)
 *   - P2x: 0.3  → 0.36  (slightly longer deceleration zone)
 *   Net effect: same strong forward momentum, but the initial leap is
 *   less "snap"-like and the final arrival is more organic. The difference
 *   is subtle but perceptible: frame-by-frame, the camera "breathes" into
 *   its destination rather than locking in.
 */
const EASING = {
    reveal:   'cubic-bezier(0.22, 0.9, 0.36, 1)',   // Softened ExpoOut
    traverse: 'cubic-bezier(0.4, 0, 0.2, 1)',        // Material standard
    release:  'cubic-bezier(0.4, 0, 0.6, 1)',        // EaseInOut, front-weighted
} as const;

/**
 * Duration bounds per move type.
 *
 * Duration scales with movement distance: short moves → snappy,
 * long moves → extended. The pivot is the "calibration distance"
 * at which the base duration applies exactly.
 *
 * reveal pivot=55:
 *   A typical first-focus entry from overview pans ~30–50% and changes
 *   scale significantly. Distance ~50–65 → lands near the 900ms base.
 *
 * traverse pivot=40:
 *   Adjacent regions: dist ~10–20 → ~400ms (snappy).
 *   Standard traversal: dist ~40 → 700ms.
 *   Cross-page traversal: dist ~70 → ~1000ms (weighted, intentional).
 *
 * release pivot=50:
 *   Return from tight close-up (scale 4x, large pan): dist ~80 → capped 700ms.
 *   Return from gentle focus (scale 1.5x, small pan): dist ~20 → ~380ms.
 *
 * ── Dynamic pivot (PLANNED, NOT YET IMPLEMENTED) ──────────────────────────
 *
 * The current pivot is a fixed constant per move type — a single "reference
 * distance" calibrated against typical album layouts. This works well for
 * average layouts but produces slightly off-tempo durations on pages where
 * all regions are either very small (dense detail pages) or very large
 * (minimal, wide-format pages).
 *
 * Dynamic pivot would compute pivot from the page's region density:
 *
 *   avgRegionDim = mean(regions.map(r => Math.max(r.width, r.height)))
 *   pivotScale   = avgRegionDim / REFERENCE_AVG_DIM   (e.g. REFERENCE_AVG_DIM = 30)
 *   dynamicPivot = basePivot * pivotScale
 *
 * Effect:
 *   Dense page (avgDim ~10): pivot shrinks → durations feel punchier,
 *     matching the rapid attention shifts the layout demands.
 *   Spacious page (avgDim ~50): pivot grows → durations extend, matching
 *     the longer visual paths the reader needs to take.
 *
 * Implementation requires passing the page's region array (or its derived
 * avgRegionDim) into useCameraController as part of CameraConfig or a new
 * page-level hint. No structural change needed — config already accepts
 * optional overrides. Add `pivotScale?: number` to CameraConfig and apply
 * in DURATION_BOUNDS lookup: `spec.pivot * (config.pivotScale ?? 1)`.
 */
const DURATION_BOUNDS: Record<'reveal' | 'traverse' | 'release', DurationSpec> = {
    reveal:   { base: 900, min: 700,  max: 1100, pivot: 55 },
    traverse: { base: 700, min: 400,  max: 1000, pivot: 40 },
    release:  { base: 550, min: 380,  max: 700,  pivot: 50 },
};

export const IDENTITY_FRAME: CameraFrame = { scale: 1, translateX: 0, translateY: 0 };

/**
 * Perceptual floor for micro-movements.
 *
 * When a camera move is very short (dist < MICRO_MOVE_DIST), the proportional
 * duration formula produces durations that feel too snappy — the camera
 * snaps rather than moves. Below this threshold, duration is floored to
 * MICRO_MOVE_MIN_MS regardless of the formula result.
 *
 * MICRO_MOVE_DIST = 8 camera units:
 *   Typical adjacent-region traversal with similar scale: dist ~10–20.
 *   A "micro-move" (dist < 8) is a nearly-imperceptible pan of a small
 *   region to a slightly different position on the same page — e.g., two
 *   small regions close together. Below 8, the camera distance is smaller
 *   than a 8% pan with no scale change.
 *
 * MICRO_MOVE_MIN_MS = 280ms:
 *   At 60fps, 280ms = 17 frames. The eye needs at least ~10–12 frames to
 *   "read" a smooth movement as intentional (not a glitch). 280ms at the
 *   fast end of the easing curve gives ~180ms of visible deceleration —
 *   enough to feel like a deliberate camera gesture, not a jump cut.
 *   Chosen to sit between the HIGHLIGHT (80ms) and PENDING (190ms) beats:
 *   the camera still completes within one heartbeat after ACTIVE fires.
 */
const MICRO_MOVE_DIST   = 8;    // camera units — below this, apply perceptual floor
const MICRO_MOVE_MIN_MS = 280;  // ms — minimum duration for micro-movements

/**
 * Composition presets for CameraHint.
 *
 * Maps semantic composition intent to concrete biasY + padding values.
 * Applied when CameraHint.composition is set, before explicit overrides.
 *
 * Explicit biasY or padding always take precedence over the preset:
 *   { composition: 'portrait', padding: 0.2 } → biasY: 6 (from preset), padding: 0.2 (explicit)
 */
const COMPOSITION_PRESETS: Record<
    NonNullable<CameraHint['composition']>,
    Pick<CameraHint, 'biasY' | 'padding'>
> = {
    portrait:  { biasY:  6, padding: 0.05 },  // faces: headroom above, close framing
    object:    { biasY:  0, padding: 0.10 },  // objects/details: centered, slight context
    landscape: { biasY: -2, padding: 0.25 },  // wide scenes: ground-anchored, more context
};

// ── Pure computation ───────────────────────────────────────────────────────────

/**
 * Computes the camera frame for a given region and optional editorial hint.
 *
 * @param region  AlbumRegion with x, y, width, height in image-% coordinates.
 * @param cfg     Framing configuration (with defaults already applied).
 * @param hint    Optional editorial overrides (biasY, padding). See CameraHint.
 */
export function computeFrame(
    region: AlbumRegion,
    cfg:    Required<CameraConfig>,
    hint?:  CameraHint,
): CameraFrame {
    const maxDim = Math.max(region.width, region.height);
    // Minimum clamp preserves context around small subjects.
    const effectiveDim = Math.max(maxDim, cfg.minRegionDim);

    // Resolve composition preset — explicit hint fields override preset values.
    const preset  = hint?.composition ? COMPOSITION_PRESETS[hint.composition] : {};
    const biasY   = hint?.biasY   ?? preset.biasY   ?? 0;
    const padding = hint?.padding ?? preset.padding ?? 0;

    // padding reduces zoom: effectiveFill = fillFactor × (1 - padding)
    const paddingFactor  = Math.max(0, Math.min(padding, 0.5));
    const effectiveFill  = cfg.fillFactor * (1 - paddingFactor);

    const rawScale = effectiveFill / effectiveDim;
    const scale    = Math.max(cfg.minScale, Math.min(rawScale, cfg.maxScale));

    const centerX    = region.x + region.width  / 2;
    const centerY    = region.y + region.height / 2;
    const translateX = 50 - centerX;
    // biasY (positive) moves image DOWN → more space ABOVE region.
    const translateY = 50 - centerY + biasY;

    return { scale, translateX, translateY };
}

/**
 * Computes a perceptually-weighted distance between two camera frames.
 *
 * Combines pan (Euclidean, image-% space) and scale change (log2 space).
 *
 * Why log2 for scale?
 *   Scale changes feel proportional in log space: 1x→2x "feels" like 2x→4x.
 *   A 2x change (log2=1) contributes 30 units — calibrated to be roughly
 *   equivalent to a 30% pan, making combined distances intuitive.
 *
 * @returns Combined distance in "camera units" (not pixels).
 */
export function movementDistance(from: CameraFrame, to: CameraFrame): number {
    const panDist = Math.sqrt(
        (to.translateX - from.translateX) ** 2 +
        (to.translateY - from.translateY) ** 2,
    );
    const safeFromScale = Math.max(from.scale, 0.01); // guard against log2(0)
    const scaleDist = Math.abs(Math.log2(to.scale / safeFromScale)) * 30;
    return panDist + scaleDist;
}

/**
 * Maps a movement distance to a clamped duration in milliseconds.
 *
 * Linear: duration = (distance / pivot) × base, clamped to [min, max].
 * At distance=pivot → base. Scales proportionally outside that point.
 *
 * Perceptual floor: micro-movements (dist < MICRO_MOVE_DIST) are floored to
 * MICRO_MOVE_MIN_MS so they read as deliberate gestures, not glitches.
 * The floor is applied after the clamp — it can only raise the duration,
 * never lower it below spec.min.
 */
export function durationForDistance(dist: number, spec: DurationSpec): number {
    const raw = (dist / spec.pivot) * spec.base;
    let duration = Math.round(Math.max(spec.min, Math.min(raw, spec.max)));
    if (dist < MICRO_MOVE_DIST) duration = Math.max(duration, MICRO_MOVE_MIN_MS);
    return duration;
}

/**
 * Classifies the current camera move into one of five archetypes.
 *
 *   initial  — first render: no animation (avoids jarring entry on resume).
 *   reveal   — overview → focus/challenge: most dramatic, slowest + reveal easing.
 *   traverse — focus/challenge → different region: efficient, distance-scaled.
 *   release  — any → overview: "stepping back", slightly faster.
 *   hold     — focus ↔ challenge, same region: no transform change, 0ms.
 */
export function classifyMove(
    viewerState:  AlbumViewerState,
    regionId:     string | undefined,
    prevState:    AlbumViewerState,
    prevRegionId: string | undefined,
    isInitial:    boolean,
): MoveType {
    if (isInitial)                                          return 'initial';
    if (viewerState === 'overview')                         return 'release';
    if (prevState === 'overview')                           return 'reveal';
    if (regionId !== prevRegionId)                          return 'traverse';
    /* focus ↔ challenge, same region — transform unchanged */ return 'hold';
}

/**
 * Builds the CSS transition string for a classified camera move,
 * with distance-scaled duration.
 */
export function buildTransition(moveType: MoveType, dist: number): string {
    if (moveType === 'initial' || moveType === 'hold') return 'transform 0ms linear';
    const spec     = DURATION_BOUNDS[moveType];
    const duration = durationForDistance(dist, spec);
    return `transform ${duration}ms ${EASING[moveType]}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * @param viewerState   Current album viewer state.
 * @param currentRegion Active AlbumRegion (undefined in overview/complete).
 * @param config        Optional framing overrides. Stable reference preferred.
 * @param hint          Optional per-region editorial hint. Pass currentRegion?.cameraHint
 *                      when AlbumRegion schema includes the field.
 */
export function useCameraController(
    viewerState:   AlbumViewerState,
    currentRegion: AlbumRegion | undefined,
    config?:       CameraConfig,
    hint?:         CameraHint,
): CameraControllerResult {
    const cfg = { ...DEFAULTS, ...config };

    // isInitialRef: suppresses entry animation on first render.
    // Without this, resuming a session at a focused region would animate
    // from scale=1 to the saved position — jarring for the user.
    const isInitialRef    = useRef(true);

    // Prev-state refs: hold values from the PREVIOUS render.
    // Read during render (stale = correct); updated in useEffect after paint.
    const prevStateRef    = useRef<AlbumViewerState>('overview');
    const prevRegionIdRef = useRef<string | undefined>(undefined);
    const prevFrameRef    = useRef<CameraFrame>(IDENTITY_FRAME);

    const isIdentity = viewerState === 'overview' || !currentRegion;
    const frame      = isIdentity
        ? IDENTITY_FRAME
        : computeFrame(currentRegion, cfg, hint);

    const moveType = classifyMove(
        viewerState,
        currentRegion?.id,
        prevStateRef.current,
        prevRegionIdRef.current,
        isInitialRef.current,
    );

    const dist       = movementDistance(prevFrameRef.current, frame);
    const transition = buildTransition(moveType, dist);

    // Update refs after computing — ensures subsequent renders see current
    // values as "previous". Dependency-less useEffect runs after every paint.
    useEffect(() => {
        isInitialRef.current    = false;
        prevStateRef.current    = viewerState;
        prevRegionIdRef.current = currentRegion?.id;
        prevFrameRef.current    = frame;
    });

    const transformStyle: CSSProperties = {
        transform:       isIdentity
            ? 'none'
            : `scale(${frame.scale}) translate(${frame.translateX}%, ${frame.translateY}%)`,
        transformOrigin: 'center center',
        transition,
    };

    return { transformStyle, currentFrame: frame, lastMoveType: moveType };
}
