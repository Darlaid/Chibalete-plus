
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNarrativeInteraction, NARRATIVE_ADVANCE_DELAY_MS } from '../hooks/useNarrativeInteraction';
import { useCameraController, type MoveType } from '../hooks/useCameraController';
import { useLeoMediator } from '../hooks/useLeoMediator';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { generarMicroResumenRecordatorio } from '../services/geminiService';
import type { Content, AlbumPage, AlbumRegion, AlbumReadingRoute, RegionAction, VisualContext } from '../types';
import { getObjectContainRect, viewportToImagePercent, isPointInRegion } from '../utils/albumGeometry';
import { getRereadContext, incrementReadCount, recordRouteVisit, recordAlbumRouteSelected, recordAlbumRouteProgress } from '../utils/rereadStorage';
import { createAlbumEmitter, generateSessionId } from '../services/analyticsService';
// Sprint Data Backbone — Fase 4B: paridad de sesión vía /api/v1/events.
// Convive con createAlbumEmitter legacy. NO lo reemplaza.
import { useBackboneReadingSession } from '../hooks/useBackboneReadingSession';
import { useNarrativeAudio } from '../hooks/useNarrativeAudio';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, HelpCircle, Volume2, VolumeX, RotateCcw, Eye, EyeOff } from 'lucide-react';
import confetti from 'canvas-confetti';
import Chatbot from '../components/Chatbot';

// Normalize album data — backfills missing ids/text/coords, migrates legacy
// isInteractive into the canonical type field, and synthesizes region.action
// from legacy type='audio'/'nav' fields (2.0-C unified action model).
function normalizeAlbumData(raw: unknown[]): AlbumPage[] {
    return (raw as AlbumPage[]).map((page, pi) => ({
        ...page,
        id: page.id || `page-${pi}`,
        text: page.text || '',
        regions: (page.regions || []).map((region: AlbumRegion, ri: number) => {
            // ── Canonical type: synthesize from legacy isInteractive when absent ──
            const type: AlbumRegion['type'] =
                region.type ?? (region.isInteractive ? 'challenge' : 'focus');

            const isChallenge = type === 'challenge';
            const hint = region.interactiveHint?.trim() ?? '';

            // ── 2.0-C: Synthesize canonical action from legacy type or explicit field ──
            // Priority: 1. explicit action field (new content, 2.0-C+)
            //           2. legacy type='audio' → action.type='audio'
            //           3. legacy type='nav'   → action.type='jump'
            //           4. absence: resolveRegionAction() returns defaults at call time
            let action: RegionAction | undefined = region.action;
            if (!action) {
                if (type === 'audio') {
                    action = { type: 'audio', audioUrl: region.audioUrl };
                } else if (type === 'nav') {
                    action = { type: 'jump', targetPageId: region.navTargetPageId };
                }
            }

            return {
                ...region,
                id: region.id || `region-${pi}-${ri}`,
                text: region.text || '',
                type,                                   // canonical — drives state machine
                action,                                 // canonical action (synthesized or explicit)
                x: Math.max(0, Math.min(100, region.x ?? 0)),
                y: Math.max(0, Math.min(100, region.y ?? 0)),
                width: Math.max(1, Math.min(100, region.width ?? 10)),
                height: Math.max(1, Math.min(100, region.height ?? 10)),
                interactiveHint: isChallenge ? (hint || undefined) : undefined,
                // @deprecated — preserved for backward compat; type is canonical
                isInteractive: isChallenge ? true : undefined,
            };
        }),
    }));
}

/**
 * Returns the effective action for a region.
 * Uses region.action (canonical, 2.0-C) when present.
 * Falls back to type-based defaults for regions without an explicit action.
 * Pure — no side effects.
 */
function resolveRegionAction(region: AlbumRegion): RegionAction {
    if (region.action) return region.action;
    switch (region.type) {
        case 'focus':         return { type: 'read' };
        case 'contemplative': return { type: 'none' };
        case 'challenge':     return { type: 'none' }; // challenge game is the action
        default:              return { type: 'none' };
    }
}

// Explicit state machine type
type ViewerState = 'overview' | 'focus' | 'challenge' | 'complete';

// ── Experimental: narrative overlay blend mode ─────────────────────────────
//
// WHAT: mix-blend-mode: screen blends the overlay using the formula:
//   result = 1 - (1 - source) × (1 - dest)
// For a white source (1.0) this always yields 1 — mathematically equivalent
// to normal alpha compositing with white. The real benefit emerges when the
// overlay color shifts from pure white to a tinted tone (warm amber, cool
// silver): screen then adds luminance to dark areas without washing out light
// areas (self-limiting property: white on white stays white).
//
// WHY NOT ACTIVE: three reasons —
//
//   1. No visual benefit with a pure white overlay (screen(white, x) = 1 = same
//      as normal blending). The benefit is coupled to a future color change.
//
//   2. Cross-browser compositing risk: Safari has documented bugs with
//      mix-blend-mode inside elements that contain a will-change: transform
//      descendant (our <img> has will-change-transform). Chrome also has edge
//      cases with blend modes inside opacity stacking contexts. Activating
//      before testing on iOS Safari / older Chrome could introduce visual
//      artifacts (flickering, color shifts, incorrect compositing).
//
//   3. blend-mode compositing is GPU-composited separately from the normal
//      layer — this can break assumptions about rendering order inside a
//      stacking context and cause unexpected interactions with backdrop-filter
//      or other transform layers added in the future.
//
// WHEN TO ACTIVATE:
//   - When the overlay color changes from white to a tinted tone
//   - After explicit testing on iOS Safari 16+, Chrome Android, and Firefox
//   - After verifying no visual regression on the <img will-change-transform>
//     compositing path
//
// HOW TO TEST (manual):
//   1. Set USE_BLEND_MODE = true temporarily
//   2. Open an album with a dark illustration (night scene, dark forest)
//   3. Tap to advance — observe if the brightening feels more "organic" vs
//      normal blending. On pure white overlay: no visual difference expected.
//   4. Open an album with a light illustration — verify no unwanted brightening
//   5. Test on iOS Safari: confirm no flickering or color shift during transition
//   6. Test with zoom active (overview → focus transform): confirm overlay
//      does not interfere with the scale/translate animation
//   7. If artefacts appear: set false immediately, do not ship
const USE_BLEND_MODE = false;

const VisorAlbum: React.FC<{ content: Content }> = ({ content }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const albumData = useMemo(() => normalizeAlbumData(content.album_data || []), [content.album_data]);

    // Navigation State — declared BEFORE any useMemo that reads these values.
    // Rule: no hook may reference a variable not yet declared in the same component body.
    const [pageIndex, setPageIndex] = useState(0);
    const [regionIndex, setRegionIndex] = useState(0);
    const [viewerState, setViewerState] = useState<ViewerState>('overview');
    const [showText, setShowText] = useState(true);

    // Double-page spread detection.
    // A spread is formed when:
    //   currentPage.pageType === 'double' && currentPage.doublePageMode === 'with_next'
    //   AND the next page exists with doublePageMode === 'with_previous'
    // We expose the companion (right-hand) page so the renderer can show both images.
    // The camera system only activates in focus/challenge states, so overview can freely
    // use a two-image layout without breaking translate(x%,y%) coordinate assumptions.
    //
    // Hardening: guards against empty albumData, out-of-range pageIndex, and missing
    // imageUrl on the companion page. Returns null in any degenerate case so the
    // renderer falls back to single-image mode without crashing.
    const spreadCompanion: AlbumPage | null = useMemo(() => {
        if (!albumData || albumData.length === 0) return null;
        if (pageIndex < 0 || pageIndex >= albumData.length) return null;
        const current = albumData[pageIndex];
        if (
            current?.pageType === 'double' &&
            current?.doublePageMode === 'with_next'
        ) {
            const next = albumData[pageIndex + 1];
            if (next?.doublePageMode === 'with_previous' && next?.imageUrl) return next;
        }
        return null;
    }, [albumData, pageIndex]);

    // Out-of-range guard — if albumData changes (e.g. content prop update) and the
    // current pageIndex falls beyond the new length, clamp it to the last valid page.
    // Dependency array intentionally omits setPageIndex (stable setter).
    useEffect(() => {
        if (albumData.length > 0 && pageIndex >= albumData.length) {
            setPageIndex(Math.max(0, albumData.length - 1));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [albumData]);

    // Non-linear navigation stack — page indices pushed when a type='nav' region
    // jumps to a target page. handleNavReturn pops the last index to go back.
    const [navStack, setNavStack] = useState<number[]>([]);

    // Narrative route — null when no route is chosen (linear navigation, current behavior).
    // Set by the route selector UI; cleared on page change. When set, handleAdvance
    // follows regionIds order instead of the default array-index increment.
    const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

    // Album-level reading routes — curated editorial paths through pages.
    // activeAlbumRouteId: null = free reading (linear); set = follow route sequence.
    // isSelectingAlbumRoute: true at mount when routes exist; shows full-screen selector.
    const albumRoutes: AlbumReadingRoute[] = useMemo(() => content.readingRoutes ?? [], [content.readingRoutes]);
    const [activeAlbumRouteId, setActiveAlbumRouteId] = useState<string | null>(null);
    const [isSelectingAlbumRoute, setIsSelectingAlbumRoute] = useState(
        (content.readingRoutes?.length ?? 0) > 0,
    );

    // Gamification State
    const [showHint, setShowHint] = useState(false);
    const [isMissAnimating, setIsMissAnimating] = useState(false);

    // Audio — lifecycle managed by useNarrativeAudio (StrictMode-safe)
    const [isMuted, setIsMuted] = useState(false);
    const audio = useNarrativeAudio();

    // ── First-use UX state ──────────────────────────────────────────
    // hasInteracted: true after the first meaningful navigation tap.
    // Used to dismiss onboarding hints and nav zone overlay.
    const [hasInteracted, setHasInteracted] = useState(false);

    // navHintActive: drives the 3.5s nav-zone hint overlay (first read only).
    // Transitions false after the timer. The overlay renders while this is true
    // AND rereadContext/pageIndex/hasInteracted conditions are met (see showNavHint).
    const [navHintActive, setNavHintActive] = useState(true);

    // ── Leo state ────────────────────────────────────────────────────
    // openChatTrigger: incremented to imperatively open the Chatbot.
    // Used when the user taps the Leo hint bubble — tap should open the chat.
    const [openChatTrigger, setOpenChatTrigger] = useState(0);

    // leoActionNonce: set when a region with action.type='leo' fires.
    // Chatbot watches the nonce — when it changes, it injects action.leoPrompt
    // as a Leo message and opens the chat. Reset to null after the trigger is consumed.
    const [leoActionNonce, setLeoActionNonce] = useState<{ message: string; id: number } | null>(null);

    // isLoadingRecap: true while the Gemini recap call is in flight.
    // Passed to Chatbot so it can show "Leo está recordando..." if opened early.
    const [isLoadingRecap, setIsLoadingRecap] = useState(false);

    // Route-end state: set when completing via a route so the completion screen can name the route.
    const [completedAlbumRouteName, setCompletedAlbumRouteName] = useState<string | null>(null);

    // ── BLOQUE 1: Positioned discovery dots ─────────────────────────
    // Stores screen-space centroid positions (viewport px) for 1–2 regions
    // of the current page. Computed after image loads via getObjectContainRect.
    // Used to render discovery ripples on actual region locations, not center.
    const [discoveryDotPositions, setDiscoveryDotPositions] = useState<{x: number, y: number}[]>([]);

    // ── BLOQUE 2: Leo tap + timeout ──────────────────────────────────
    // leoWasTapped: shows "pensando…" in overlay immediately after tap.
    // Auto-clears after 2.5s so the overlay never looks stuck/frozen.
    const [leoWasTapped, setLeoWasTapped] = useState(false);
    const leoTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── FORTALECIMIENTO B1: Progressive discovery ──────────────────
    // Tracks which region IDs the user has visited on the CURRENT page.
    // Resets on page change. Used to target the discovery ripple at the
    // next unvisited region rather than always showing the same one.
    const [visitedRegionIdsOnPage, setVisitedRegionIdsOnPage] = useState<Set<string>>(new Set());
    // Exploration nudge — brief "hay N más" toast after returning to overview
    // when unvisited regions remain. One-shot per page.
    const [explorationNudgeVisible, setExplorationNudgeVisible] = useState(false);
    const explorationNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const explorationNudgeShownRef = useRef(false);

    // ── FORTALECIMIENTO B3: Jump exploration hint ─────────────────
    // One-shot per session: brief contextual hint after the reader's
    // first non-linear jump (type='jump' action). Teaches that the
    // book has multi-directional navigation without explicit instruction.
    const jumpHintShownRef = useRef(false);
    const jumpHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showJumpExplorationHint, setShowJumpExplorationHint] = useState(false);

    // ── BLOQUE 6: Replay affordance ──────────────────────────────────
    // Tracks whether audio played at least once in the current region so
    // we can show a "Repetir" button after playback ends.
    const [audioHasPlayedOnce, setAudioHasPlayedOnce] = useState(false);
    const prevIsPlayingRef = useRef(false);

    // Refs
    const imgRef              = useRef<HTMLImageElement>(null); // For challenge hit detection (image content rect)
    // lastAlbumRoutePageRef: stores the last page ID the user was on WHILE inside an album route.
    // Used by handleReturnToRoute to navigate back when the user drifted outside the route.
    const lastAlbumRoutePageRef = useRef<string | null>(null);
    const challengeTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
    const missAnimTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionStartRef     = useRef<number>(Date.now());
    const saveTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
    // sessionIdRef: stable for the lifetime of this VisorAlbum mount.
    // Generated once — shared across all analytics events in this session.
    const sessionIdRef        = useRef(generateSessionId());
    // Tracks camera move type for the transitionend handler — a ref avoids
    // re-attaching the listener on every render while always reading the
    // current move type inside the handler closure.
    const cameraLastMoveTypeRef = useRef<MoveType>('initial');

    // Narrative interaction pipeline — HIGHLIGHT → PENDING → ACTIVE rhythm.
    // Introduces ~270ms of intentional anticipation before state transitions
    // so the album feels like "touch → anticipation → reveal", not "tap → snap".
    // back, challenge clicks, and keyboard ArrowLeft remain immediate by design.
    const interaction = useNarrativeInteraction(NARRATIVE_ADVANCE_DELAY_MS);

    // narrativeOpacity: two-step dimming for narrative anticipation.
    //   HIGHLIGHT → 0.988 (barely there — "contact registered, not yet committed")
    //   PENDING   → 0.974 (slightly deeper — "committed, held breath before reveal")
    //   IDLE/ACTIVE → 1   (fully opaque)
    // Values are continuous enough not to feel steppy, distinct enough to
    // read as two separate states in debug logs. Challenge state bypasses
    // entirely — challenge hit-detection must never show the nav cue.
    const narrativeOpacity =
        viewerState === 'challenge' ? 1 :
        interaction.phase === 'PENDING'   ? 0.974 :
        interaction.phase === 'HIGHLIGHT' ? 0.988 : 1;

    // narrativeTransition: asymmetric easing per phase.
    //
    // CSS principle: when both `opacity` and `transition` change in the same
    // React render, the browser applies the NEW transition to animate from the
    // OLD opacity value. This means the transition defined for the destination
    // phase controls the animation INTO that phase — exactly what we need.
    //
    //   → HIGHLIGHT: 50ms ease-out  — fast tactile snap (contact, not wait)
    //   → PENDING:   80ms ease-out  — smooth settle into anticipation
    //   → IDLE/ACTIVE: 130ms ease-in-out — organic release back to full opacity
    const narrativeTransition =
        interaction.phase === 'HIGHLIGHT' ? 'opacity 50ms ease-out' :
        interaction.phase === 'PENDING'   ? 'opacity 80ms ease-out' :
        /* IDLE or ACTIVE */                'opacity 130ms ease-in-out';

    // narrativeFallbackOpacity: additive white overlay for dark-scene reinforcement.
    //
    // Problem: opacity 0.988 → 0.974 adds only ~3–5 luminance units to a dark scene
    // (avg pixel ≈30/255). That delta is imperceptible on OLED or near-black images.
    //
    // Solution: a white overlay at 1–2% adds the SAME ~3–5 absolute luminance units,
    // but the relative perceptual impact scales inversely with the scene's brightness:
    //   dark scene  (V≈30):  +3/30 ≈ 10% relative change → perceptible ✓
    //   normal scene (V≈150): +3/150 ≈ 2% relative change → barely noticeable ✓
    //   light scene  (V≈220): +3/220 ≈ 1.4% relative change → invisible ✓
    //
    // This self-adapts without any pixel analysis. The overlay lives inside the
    // opacity container so it shares the same stacking context and timing rhythm.
    //
    // Challenge state: always 0 — game mode must never show nav cues.
    //
    // Future hook-in: if per-page luminance metadata becomes available (e.g.,
    // content.album_data[i].avgLuminance), this value can be boosted dynamically:
    //   const boost = page.avgLuminance < 60 ? 1.5 : 1;
    //   narrativeFallbackOpacity * boost
    // This structure is already compatible — no refactor needed.
    const narrativeFallbackOpacity =
        viewerState === 'challenge'             ? 0 :
        interaction.phase === 'PENDING'         ? 0.022 :
        interaction.phase === 'HIGHLIGHT'       ? 0.012 : 0;

    // Recap / Leo State
    const [leoRecapMessage, setLeoRecapMessage] = useState<string | null>(null);
    const [checkedRecap, setCheckedRecap] = useState(false);

    // isReread: true if the reader has substantially completed this album before.
    // Computed once at mount from saved progress (synchronous localStorage read).
    // Suppresses the Leo pulse invite — returning readers know Leo is available.
    const isReread = useMemo(() => {
        if (!user) return false;
        const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
        return (prog?.porcentaje ?? 0) >= 90;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, content.id]);

    // emit — session-scoped analytics emitter. Wraps analyticsService.track()
    // with userId, contentId, and sessionId pre-bound. Stable for session lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const emit = useMemo(() => createAlbumEmitter({
        userId:    user?.id ?? 'anonymous',
        contentId: content.id,
        sessionId: sessionIdRef.current,
    }), []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── BACKBONE v1: paridad de sesión ──────────────────────────────────────
    // Emite album.session_start / session_heartbeat / session_end / progress
    // hacia /api/v1/events. Convive con createAlbumEmitter legacy y con la
    // persistencia de progreso vía dataService.updateProgreso. NO los reemplaza.
    const backboneSession = useBackboneReadingSession({
        enabled:    !!user?.id && !!content?.id && albumData.length > 0,
        userId:     user?.id,
        contentId:  content.id,
        mode:       'album',
        getProgressFraction: () =>
            albumData.length > 0 ? (pageIndex + 1) / albumData.length : 0,
        getPayload: () => ({
            source:       'VisorAlbum',
            currentSlide: pageIndex + 1,
            totalSlides:  albumData.length,
        }),
    });

    // rereadContext: snapshot at mount — how many times the user has completed
    // this album and which routes they've visited across all reads.
    // Intentionally NOT reactive: we want the read-count that was true when the
    // session started, not one that changes if completion fires mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const rereadContext = useMemo(
        () => (user ? getRereadContext(user.id, content.id) : { readCount: 0, visitedRouteIds: [] }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [user?.id, content.id],
    );

    const currentPage: AlbumPage = albumData[pageIndex];
    const currentRegion: AlbumRegion | undefined = currentPage?.regions[regionIndex];

    // Route state — resolved from the current page's narrativeRoutes.
    // Stable memo: pageRoutes is a new array only when currentPage changes.
    const pageRoutes = useMemo(
        () => currentPage?.narrativeRoutes ?? [],
        [currentPage],
    );
    const activeRoute = useMemo(
        () => (activeRouteId ? pageRoutes.find(r => r.id === activeRouteId) ?? null : null),
        [activeRouteId, pageRoutes],
    );
    const hasRoutes = pageRoutes.length > 0;

    const hasAlbumRoutes = albumRoutes.length > 0;
    const activeAlbumRoute = useMemo(
        () => (activeAlbumRouteId ? albumRoutes.find(r => r.id === activeAlbumRouteId) ?? null : null),
        [activeAlbumRouteId, albumRoutes],
    );

    // isOutOfRoute: true when a route is active but the current page is not in its sequence.
    // This happens after a type='nav' region jump to a page outside the route.
    const isOutOfRoute = useMemo(
        () => Boolean(activeAlbumRoute && currentPage && !activeAlbumRoute.sequence.includes(currentPage.id)),
        [activeAlbumRoute, currentPage],
    );

    // albumRoutePosition: 1-based step counter within the active route.
    // null when no route is active, or when the current page is outside the route.
    const albumRoutePosition = useMemo(() => {
        if (!activeAlbumRoute || !currentPage || isOutOfRoute) return null;
        const pos = activeAlbumRoute.sequence.indexOf(currentPage.id);
        return pos >= 0 ? { step: pos + 1, total: activeAlbumRoute.sequence.length } : null;
    }, [activeAlbumRoute, currentPage, isOutOfRoute]);

    // showNavHint: mount condition for the nav-zone overlay.
    // navHintActive controls CSS opacity (fade-out after 3.5s) but NOT mounting —
    // the div must stay in DOM long enough for the transition to play before
    // hasInteracted (first tap) unmounts it.
    const showNavHint = rereadContext.readCount === 0 && pageIndex === 0 && !hasInteracted;

    // Route progress — current step (1-based) and total within the active route.
    // Derived: no extra state, zero overhead when no route is active.
    // Available for: progress dots in the badge UI, future metrics, future Leo context.
    // null when no route is active, or when currentRegion.id is not in the route
    // (e.g. after a challenge advances via regionIndex + 1 outside route logic).
    const routeProgress = useMemo(() => {
        if (!activeRoute || !currentRegion) return null;
        const step = activeRoute.regionIds.indexOf(currentRegion.id);
        return step >= 0 ? { step: step + 1, total: activeRoute.regionIds.length } : null;
    }, [activeRoute, currentRegion]);

    // visualContext — canonical payload sent to Leo via <Chatbot>.
    //
    // Computed synchronously with useMemo so Leo always sees the current viewer
    // state without a one-render lag (useEffect + setState would update a cycle late).
    //
    // State-to-payload rules:
    //   overview  → no active region; regionId/regionType null; regionText = page.text
    //   focus     → active region; all region fields populated
    //   challenge → same as focus (regionType will be 'challenge' by normalizer guarantee)
    //   complete  → undefined (album done; no further Leo context needed)
    const visualContext = useMemo((): VisualContext | undefined => {
        if (!currentPage || viewerState === 'complete') return undefined;

        // Region is "active" only when the viewer is zoomed into a specific region.
        // In overview the user sees the whole page — no region is focused.
        const activeRegion =
            (viewerState === 'focus' || viewerState === 'challenge') ? currentRegion : undefined;

        return {
            imageUrl:  currentPage.imageUrl,
            pageIndex,
            pageId:    currentPage.id,
            bookTitle: content.titulo,
            pageType:  currentPage.pageType ?? (currentPage.doubleSpread ? 'double' : 'single'),
            doublePageMode: currentPage.doublePageMode,
            // overview: null (no region focused); focus/challenge: region identity
            regionId:             activeRegion?.id              ?? null,
            // overview: page narrative text (what Leo should discuss); focus/challenge: region text
            regionText:           activeRegion ? (activeRegion.text  || '') : (currentPage.text || ''),
            regionType:           activeRegion?.type             ?? null,
            pedagogicalObjective: activeRegion?.pedagogicalObjective ?? null,
            leoHint:              activeRegion?.leoHint              ?? null,
            // ── 2.0-B: Narrative route context ───────────────────────
            // Forwarded to Leo so future server-side prompts can reference
            // the reading path by name and mode. null = no route active.
            activeRouteName:    activeRoute?.label   ?? null,
            activeRouteLeoMode: activeRoute?.leoMode ?? null,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewerState, pageIndex, currentPage, currentRegion, content.titulo, activeRoute]);

    // Nav-zone hint timer — auto-dismisses after 3.5s on first read.
    // Uses an empty-deps effect so it runs once at mount regardless of state.
    // The hint is already invisible for returning readers (showNavHint gates on readCount).
    useEffect(() => {
        const id = setTimeout(() => setNavHintActive(false), 3500);
        return () => clearTimeout(id);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Check for returning-user recap
    useEffect(() => {
        const checkInactivity = async () => {
            if (!user || checkedRecap) return;
            setCheckedRecap(true);
            // Skip recap on the 3rd+ read: experienced readers know the story.
            // On first and second reads the recap serves as an orientation anchor.
            if (rereadContext.readCount >= 2) return;
            const progress = dataService.getProgresoUsuarioLibro(user.id, content.id);
            if (progress && progress.porcentaje > 0) {
                setIsLoadingRecap(true);
                try {
                    const recap = await generarMicroResumenRecordatorio(content.descripcion_corta, content.titulo, user.id);
                    setLeoRecapMessage(recap);
                } catch (e) { console.error(e); } finally {
                    setIsLoadingRecap(false);
                }
            }
        };
        checkInactivity();
    }, [user, content, checkedRecap]);

    // Session open + resume from last saved page
    useEffect(() => {
        if (!user) return;
        dataService.recordReaderOpen(user.id, content.id, 'album');
        sessionStartRef.current = Date.now();

        if (albumData.length > 0) {
            const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
            if (prog && prog.porcentaje > 0) {
                const wasAlbum = !prog.lastMode || prog.lastMode === 'album';
                if (wasAlbum) {
                    const resumePage = Math.min(
                        Math.floor((prog.porcentaje / 100) * albumData.length),
                        albumData.length - 1
                    );
                    if (resumePage > 0) setPageIndex(resumePage);
                }
            }
        }

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current);
            if (missAnimTimerRef.current) clearTimeout(missAnimTimerRef.current);
            if (explorationNudgeTimerRef.current) clearTimeout(explorationNudgeTimerRef.current);
            if (jumpHintTimerRef.current) clearTimeout(jumpHintTimerRef.current);
            //
            // ── Future: analyticsService.flush() on SPA navigation ──────────────
            //
            // analyticsService already flushes on `window.beforeunload` (tab close).
            // That covers hard navigations but NOT React SPA transitions: when the
            // user taps the back button or navigates away within the app, React
            // unmounts VisorAlbum and this cleanup runs — without triggering beforeunload.
            //
            // To add SPA flush robustness, add here:
            //   import { flush } from '../services/analyticsService';
            //   flush();
            //
            // Why NOT implemented yet:
            //   1. The buffer auto-flushes every 60s (FLUSH_INTERVAL_MS). Normal reading
            //      sessions (typically 2–10 min) will flush at least once during the session.
            //   2. The most critical event, album_completed, is emitted BEFORE the component
            //      reaches 'complete' state and before the user has any navigation affordance —
            //      it is safely in the buffer well before SPA unmount.
            //   3. In React StrictMode (dev), effects run twice: this cleanup would flush an
            //      empty buffer on the first unmount, then the real session data would accumulate
            //      normally. Low risk, but adds noise in dev logs.
            //   4. Implementing without a test suite risks double-flushing edge cases.
            //
            // This is a ROBUSTNESS improvement for partially-read sessions, not a bug fix
            // for completed ones. Implement in the same sprint that adds session_abandoned
            // or partial_read tracking if/when those metrics become necessary.
        };
    }, [user, content.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Mid-session progress save (debounced 1000ms after page change)
    useEffect(() => {
        if (!user || albumData.length === 0) return;
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            dataService.updateProgreso(
                user.id, content.id,
                pageIndex + 1, albumData.length,
                undefined, undefined,
                { lastMode: 'album', elapsedMs: Date.now() - sessionStartRef.current }
            );
            // Backbone v1: album.progress paralelo al save legacy.
            backboneSession.emitEvent('progress', {
                progressFraction: (pageIndex + 1) / albumData.length,
                payload: { currentSlide: pageIndex + 1, totalSlides: albumData.length },
            });
        }, 1000);
    }, [pageIndex, user, content.id, albumData.length, backboneSession]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reread session marker — fires once at mount, only when the reader has
    // completed this album at least once before (readCount ≥ 1).
    //
    // The 400ms delay is deliberate:
    //   - Engine is fully initialized (useNarrativeAudio effect has run)
    //   - Ambient crossfade has started (page ambient useEffect fires on mount)
    //   - No other effect is competing — overview has no TTS, no camera, no interaction
    //   - StrictMode-safe: cleanup clears the timer before the remount reschedules it
    //
    // The signal is reread_open — a descending E4→C4 tone, gain 0.0154 effective,
    // 250ms duration. Subliminal: ~20× quieter than AMBIENT_BASE at 0.30.
    // Semantically: the inverted region_enter — "recognition" vs "discovery."
    //
    useEffect(() => {
        if (rereadContext.readCount < 1) return;
        const id = setTimeout(() => {
            audio.playEffect('reread_open');
            emit({
                name:            'reread_started',
                readCount:       rereadContext.readCount,
                visitedRouteIds: rereadContext.visitedRouteIds,
            });
        }, 400);
        return () => clearTimeout(id);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Sync mute toggle into audio engine
    useEffect(() => {
        audio.setMuted(isMuted);
    }, [isMuted]); // eslint-disable-line react-hooks/exhaustive-deps

    // BLOQUE 6: Track first-play in current region for replay affordance.
    // prevIsPlayingRef avoids double-fire on the same isPlaying=true value.
    useEffect(() => {
        if (audio.isPlaying && !prevIsPlayingRef.current) {
            setAudioHasPlayedOnce(true);
        }
        prevIsPlayingRef.current = audio.isPlaying;
    }, [audio.isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

    // BLOQUE 1 / FORTALECIMIENTO B1: Compute centroid positions for ALL regions.
    // Positions are indexed 1:1 with currentPage.regions so the progressive
    // discovery system can target any specific unvisited region by its array index.
    // (Previously computed only 2 picks — now computes all so any region can be targeted.)
    useEffect(() => {
        const regions = currentPage?.regions;
        if (!regions?.length) { setDiscoveryDotPositions([]); return; }

        const compute = () => {
            const img = imgRef.current;
            if (!img) return;
            const rect = getObjectContainRect(img);
            if (rect.width === 0) return; // image not rendered yet

            // Compute centroids for every region — indexed 1:1 with regions array.
            // Progressive discovery selects which one to highlight based on visit state.
            setDiscoveryDotPositions(regions.map(r => ({
                x: rect.left + (r.x + r.width  / 2) / 100 * rect.width,
                y: rect.top  + (r.y + r.height / 2) / 100 * rect.height,
            })));
        };

        compute();
        // Fallback: re-run when image finishes loading (may be 0×0 on first compute).
        const img = imgRef.current;
        img?.addEventListener('load', compute, { once: true });
        return () => img?.removeEventListener('load', compute);
    }, [pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // BLOQUE 2: Auto-clear "Leo está pensando…" after 2.5s.
    // The Chatbot opens within milliseconds; the overlay should never look stuck.
    useEffect(() => {
        if (!leoWasTapped) return;
        if (leoTapTimerRef.current) clearTimeout(leoTapTimerRef.current);
        leoTapTimerRef.current = setTimeout(() => {
            setLeoWasTapped(false);
            leoTapTimerRef.current = null;
        }, 2500);
        return () => {
            if (leoTapTimerRef.current) clearTimeout(leoTapTimerRef.current);
        };
    }, [leoWasTapped]); // eslint-disable-line react-hooks/exhaustive-deps

    // BLOQUE 3 + 4 + 6: Reset all per-region transient states on region change.
    useEffect(() => {
        setLeoWasTapped(false);
        setAudioHasPlayedOnce(false);
        prevIsPlayingRef.current = false;
        audio.clearAudioFailed();
        if (leoTapTimerRef.current) {
            clearTimeout(leoTapTimerRef.current);
            leoTapTimerRef.current = null;
        }
    }, [pageIndex, regionIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // FORTALECIMIENTO B1: Record which region the user is currently viewing.
    // Fires when the viewer enters focus on a region — adds that region's ID
    // to the per-page visited set so discovery can target unvisited regions next.
    useEffect(() => {
        if (viewerState === 'focus' && currentRegion?.id) {
            setVisitedRegionIdsOnPage(prev => {
                if (prev.has(currentRegion.id)) return prev;
                const next = new Set(prev);
                next.add(currentRegion.id);
                return next;
            });
        }
    }, [viewerState, currentRegion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // FORTALECIMIENTO B1: Reset per-page discovery tracking on page advance.
    useEffect(() => {
        setVisitedRegionIdsOnPage(new Set());
        setExplorationNudgeVisible(false);
        explorationNudgeShownRef.current = false;
        if (explorationNudgeTimerRef.current) { clearTimeout(explorationNudgeTimerRef.current); explorationNudgeTimerRef.current = null; }
    }, [pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // FORTALECIMIENTO B1: Exploration nudge — fires 3s after returning to overview
    // when at least one region has been visited but unvisited regions remain.
    // One-shot per page: explorationNudgeShownRef prevents repeat firing.
    useEffect(() => {
        if (explorationNudgeTimerRef.current) { clearTimeout(explorationNudgeTimerRef.current); explorationNudgeTimerRef.current = null; }

        const pageRegions = currentPage?.regions;
        const unvisitedCount = pageRegions
            ? pageRegions.filter(r => !visitedRegionIdsOnPage.has(r.id)).length
            : 0;

        if (
            viewerState !== 'overview' ||
            !hasInteracted ||
            explorationNudgeShownRef.current ||
            visitedRegionIdsOnPage.size === 0 || // hasn't visited any on this page yet
            unvisitedCount === 0 ||              // already visited all
            rereadContext.readCount > 0          // not shown to returning readers
        ) return;

        explorationNudgeTimerRef.current = setTimeout(() => {
            explorationNudgeTimerRef.current = null;
            explorationNudgeShownRef.current = true;
            setExplorationNudgeVisible(true);
            // Auto-fade after 4s: the nudge is informational, not persistent.
            explorationNudgeTimerRef.current = setTimeout(() => {
                setExplorationNudgeVisible(false);
                explorationNudgeTimerRef.current = null;
            }, 4000);
        }, 3000);

        return () => {
            if (explorationNudgeTimerRef.current) { clearTimeout(explorationNudgeTimerRef.current); explorationNudgeTimerRef.current = null; }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewerState, hasInteracted, visitedRegionIdsOnPage.size, pageIndex]);

    // Page change → crossfade to new ambient track
    useEffect(() => {
        audio.playAmbient(currentPage?.ambientAudioUrl, currentPage?.ambientAudioLoop !== false);
    }, [pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // Region / state change → play narration (pre-recorded or TTS) + entry chime
    useEffect(() => {
        if (viewerState === 'focus' && currentRegion) {
            audio.playEffect('region_enter');
            audio.playRegion(currentRegion, pageIndex, regionIndex);

            // @analytics: emit 'album_media_played' when region has pre-recorded audio.
            // Only fires for explicit audio sources (action.audioUrl or legacy audioUrl);
            // NOT fired for TTS (TTS playback is implicit from focus navigation events).
            const effectiveAudioUrl = currentRegion.action?.audioUrl ?? currentRegion.audioUrl;
            if (effectiveAudioUrl) {
                emit({
                    name:          'album_media_played',
                    audioUrl:      effectiveAudioUrl,
                    mediaAssetId:  currentRegion.action?.mediaAssetId ?? null,
                    pageIndex,
                    regionIndex,
                    regionId:      currentRegion.id,
                });
            }
        } else {
            audio.stopRegion();
        }
    }, [pageIndex, regionIndex, viewerState]); // eslint-disable-line react-hooks/exhaustive-deps

    // Page advance preload — warm browser cache for first audio of next page.
    // Fires after React commits the new pageIndex. Best-effort: no-op when muted
    // or when the next page has no pre-recorded audio.
    useEffect(() => {
        const nextPage = albumData[pageIndex + 1];
        if (!nextPage) return;
        // Find first pre-recorded audio URL in any region of the next page.
        const firstAudioUrl = nextPage.regions
            .map(r => r.action?.audioUrl ?? r.audioUrl)
            .find(url => !!url);
        if (firstAudioUrl) audio.preloadAudio(firstAudioUrl);
    }, [pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // CameraController — manages zoom, pan, easing, and duration.
    // Replaces the former transformStyle useMemo with a dedicated hook that
    // classifies camera moves (entry / traverse / release) and applies the
    // appropriate narrative easing curve and duration to each.
    // See hooks/useCameraController.ts for full documentation.
    const camera = useCameraController(viewerState, currentRegion);

    // Keep the ref current every render — the transitionend handler reads it.
    cameraLastMoveTypeRef.current = camera.lastMoveType;

    // Camera arrival cue — fires at CSS transitionend, not at move start.
    //
    // This is the real synchronization point: instead of a setTimeout approximating
    // when the animation ends, we listen for the actual CSS transition completion
    // on the animated <img> element. The arrival cue (camera_arrive) fires here —
    // completing the audio bookend that region_enter (at camera START) opened.
    //
    // Filtering:
    //   e.target !== img    — ignores bubbled transitionend from child elements
    //   e.propertyName !== 'transform' — ignores opacity or other transitions
    //   moveType check      — no arrival cue on 'release' (no destination) or
    //                         'initial'/'hold' (no CSS transition fires for 0ms)
    //
    // Fallback: useLeoMediator still uses CAMERA_SETTLE_*_MS timers internally.
    // The arrival cue is audio-only — Leo's gate is not yet wired to transitionend.
    // See useLeoMediator.ts "Future: onMoveComplete integration" for the path forward.
    useEffect(() => {
        const img = imgRef.current;
        if (!img) return;

        const onTransitionEnd = (e: TransitionEvent) => {
            if (e.target !== img || e.propertyName !== 'transform') return;
            const moveType = cameraLastMoveTypeRef.current;
            // reveal and traverse: camera arrived at a focus point — close the motion.
            // release: camera dissolved back to overview — no arrival, no cue.
            if (moveType === 'reveal' || moveType === 'traverse') {
                audio.playEffect('camera_arrive');
            }
        };

        img.addEventListener('transitionend', onTransitionEnd);
        return () => img.removeEventListener('transitionend', onTransitionEnd);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Deps intentionally empty: permanent listener. move type read from ref;
    // audio.playEffect is stable (useCallback with no deps in useNarrativeAudio).

    // Narrative route visit tracking — fires on page-level route (activeRouteId) changes.
    // Tracks visitedRouteIds for the per-page route selector's "visited" affordance.
    useEffect(() => {
        if (activeRouteId && user) {
            recordRouteVisit(user.id, content.id, activeRouteId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRouteId]);

    // Album route selection — persists lastAlbumRouteId to localStorage.
    // This is a SEPARATE effect from narrative route tracking above.
    // Fires when the user picks an album-level route in the selector overlay.
    useEffect(() => {
        if (activeAlbumRouteId && user) {
            recordAlbumRouteSelected(user.id, content.id, activeAlbumRouteId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAlbumRouteId]);

    // Track last in-route page for handleReturnToRoute.
    // Updated whenever the user is on a page that belongs to the active route.
    useEffect(() => {
        if (activeAlbumRoute && currentPage && !isOutOfRoute) {
            lastAlbumRoutePageRef.current = currentPage.id;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage?.id, isOutOfRoute]);

    // LeoMediator — synchronized mediation decision layer.
    // Decides if, when, and how Leo should be present based on camera state,
    // interaction pipeline phase, dwell time, and session context.
    // See hooks/useLeoMediator.ts for full documentation.
    const leoMediator = useLeoMediator({
        viewerState,
        moveType:            camera.lastMoveType,
        interactionPhase:    interaction.phase,
        pageIndex,
        regionIndex,
        currentRegion,
        isReread,
        activeRouteLeoMode:  activeRoute?.leoMode,
        activeRouteLabel:    activeRoute?.label,
        readCount:           rereadContext.readCount,
    });

    // Mediator hint is driven directly by leoMediator.hintText — no local state needed.
    // The hook clears hintText on region change and on resetIntervention().

    // Mediator hint arrived — quiet ping to signal its presence without demanding attention.
    useEffect(() => {
        if (leoMediator.hintText) audio.playEffect('hint_appear');
    }, [leoMediator.hintText]); // eslint-disable-line react-hooks/exhaustive-deps

    // Leo intervention shown — emitted once per shouldIntervene → true transition.
    // Kept separate from the hint_appear effect so each concern stays isolated.
    // Not emitted from useLeoMediator directly: the hook has no userId/contentId.
    useEffect(() => {
        if (!leoMediator.shouldIntervene) return;
        emit({
            name:               'leo_intervention_shown',
            interventionType:   leoMediator.interventionType,
            dwellKey:           `${pageIndex}:${regionIndex}`,
            readCount:          rereadContext.readCount,
            activeRouteLeoMode: activeRoute?.leoMode ?? null,
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leoMediator.shouldIntervene]);

    // ── State Machine ──────────────────────────────────────────────

    // Non-linear page jump — called by type='nav' region activation.
    // Pushes the current page index onto navStack so handleNavReturn can restore it.
    const goToPageById = (pageId: string) => {
        const targetIdx = albumData.findIndex(p => p.id === pageId);
        if (targetIdx < 0) {
            // Broken nav reference — page no longer exists in this album.
            // Non-fatal: viewer stays on current page. Editor should fix this via validation V4d.
            if (import.meta.env.DEV) {
                console.warn(
                    `[VisorAlbum] nav region points to unknown pageId "${pageId}".`,
                    `Available ids: [${albumData.map(p => p.id).join(', ')}]`,
                    `Current pageIndex: ${pageIndex}`,
                );
            }
            return;
        }
        setNavStack(prev => [...prev, pageIndex]);
        audio.playEffect('page_advance');
        setPageIndex(targetIdx);
        setViewerState('overview');
        setRegionIndex(0);
        setActiveRouteId(null);

        // FORTALECIMIENTO B3: One-shot exploration hint on first non-linear jump.
        // Teaches that the book supports multi-directional navigation without
        // an explicit tutorial. Fires once per session and auto-fades in 5s.
        if (!jumpHintShownRef.current) {
            jumpHintShownRef.current = true;
            setShowJumpExplorationHint(true);
            if (jumpHintTimerRef.current) clearTimeout(jumpHintTimerRef.current);
            jumpHintTimerRef.current = setTimeout(() => {
                setShowJumpExplorationHint(false);
                jumpHintTimerRef.current = null;
            }, 5000);
        }
    };

    // Return from non-linear jump — pops the last index from navStack.
    const handleNavReturn = () => {
        if (navStack.length === 0) {
            if (import.meta.env.DEV) {
                console.warn('[VisorAlbum] handleNavReturn called with empty navStack — region action.type="return" without a preceding jump?');
            }
            return;
        }
        const returnIdx = navStack[navStack.length - 1];
        setNavStack(prev => prev.slice(0, -1));
        audio.playEffect('page_advance');
        setPageIndex(returnIdx);
        setViewerState('overview');
        setRegionIndex(0);
        setActiveRouteId(null);
    };

    // Return to the active album route after drifting out via a nav-region jump.
    // Navigates back to the last page the user was on WHILE inside the route.
    // Falls back to the route's first page if no in-route page was recorded.
    const handleReturnToRoute = () => {
        if (!activeAlbumRoute) return;
        const returnPageId = lastAlbumRoutePageRef.current ?? activeAlbumRoute.sequence[0] ?? null;
        if (!returnPageId) return;
        const returnIdx = albumData.findIndex(p => p.id === returnPageId);
        if (returnIdx < 0) return;
        audio.playEffect('page_advance');
        setPageIndex(returnIdx);
        setViewerState('overview');
        setRegionIndex(0);
        setActiveRouteId(null);
        setNavStack([]);
    };

    const goToNextPage = () => {
        // Album-route-aware: when a reading route is active, advance along its page sequence.
        if (activeAlbumRoute) {
            const posInRoute = activeAlbumRoute.sequence.indexOf(currentPage?.id ?? '');
            if (posInRoute >= 0) {
                if (posInRoute < activeAlbumRoute.sequence.length - 1) {
                    // Advance to next page in route.
                    const nextPageId = activeAlbumRoute.sequence[posInRoute + 1];
                    const nextIdx = albumData.findIndex(p => p.id === nextPageId);
                    if (nextIdx >= 0) {
                        const nextStep = posInRoute + 2; // 1-based
                        // @analytics: emit 'album_route_step'
                        emit({
                            name:      'album_route_step',
                            routeId:   activeAlbumRoute.id,
                            routeName: activeAlbumRoute.name,
                            step:      nextStep,
                            total:     activeAlbumRoute.sequence.length,
                            pageId:    nextPageId,
                        });
                        if (user) {
                            recordAlbumRouteProgress(user.id, content.id, nextStep, nextPageId);
                        }
                        audio.playEffect('page_advance');
                        setPageIndex(nextIdx);
                        setViewerState('overview');
                        setRegionIndex(0);
                        setActiveRouteId(null);
                        return;
                    }
                }
                // Last page in route (or next page missing) → complete.
            } else {
                // Current page is outside the route (e.g. after a nav-region jump).
                // Fall back to linear navigation; do NOT complete.
                if (pageIndex < albumData.length - 1) {
                    audio.playEffect('page_advance');
                    setPageIndex(prev => prev + 1);
                    setViewerState('overview');
                    setRegionIndex(0);
                    setActiveRouteId(null);
                    return;
                }
                // At the last page of the album → complete.
            }
        } else if (pageIndex < albumData.length - 1) {
            // Linear navigation — no route active.
            // Skip with_previous companion pages: they are shown as part of the
            // preceding spread and must not appear as standalone pages.
            audio.playEffect('page_advance');
            const rawNext = pageIndex + 1;
            // rawNext is already < albumData.length (condition above guarantees it).
            // For the skip: rawNext + 1 must also be in bounds before we use it.
            const skipCompanion =
                albumData[rawNext]?.doublePageMode === 'with_previous' &&
                rawNext + 1 <= albumData.length - 1;
            const nextIndex = skipCompanion ? rawNext + 1 : rawNext;
            // Final clamp — defensive, should never be needed given the checks above.
            setPageIndex(Math.min(nextIndex, albumData.length - 1));
            setViewerState('overview');
            setRegionIndex(0);
            setActiveRouteId(null);
            return;
        }
        // Completion — route exhausted, last linear page, or last album page outside route.
        {
            const elapsedMs = Date.now() - sessionStartRef.current;
            // Album route completed — emitted before album_completed so event ordering is:
            //   album_route_completed → album_completed → (reread_completed if applicable)
            if (activeAlbumRoute) {
                emit({
                    name:      'album_route_completed',
                    routeId:   activeAlbumRoute.id,
                    routeName: activeAlbumRoute.name,
                    elapsedMs,
                });
                setCompletedAlbumRouteName(activeAlbumRoute.name || null);
            }
            if (user) {
                dataService.marcarComoTerminado(user.id, content.id);
                incrementReadCount(user.id, content.id);
                emit({ name: 'album_completed', newReadCount: rereadContext.readCount + 1, elapsedMs });
                if (rereadContext.readCount >= 1) {
                    emit({
                        name:            'reread_completed',
                        readCount:       rereadContext.readCount,
                        visitedRouteIds: rereadContext.visitedRouteIds,
                        elapsedMs,
                    });
                }
            }
            audio.playEffect('complete');
            setViewerState('complete');
        }
    };

    // overview → focus → challenge → (auto-advance) → focus/next-page
    //
    // Route-aware: when activeRoute is set, "next region" follows the route's
    // regionIds order instead of the default array-index increment.
    // When activeRoute is null → identical to pre-route behavior (no regression).
    const handleAdvance = () => {
        if (viewerState === 'challenge') return; // Locked during game
        // First meaningful navigation — dismiss onboarding hints.
        if (!hasInteracted) { setHasInteracted(true); setNavHintActive(false); }

        if (viewerState === 'overview') {
            if ((currentPage.regions?.length ?? 0) > 0) {
                if (activeRoute) {
                    // Enter at the route's first region (not necessarily index 0).
                    const firstId  = activeRoute.regionIds[0];
                    const firstIdx = currentPage.regions.findIndex(r => r.id === firstId);
                    setViewerState('focus');
                    setRegionIndex(firstIdx >= 0 ? firstIdx : 0);
                } else {
                    setViewerState('focus');
                    setRegionIndex(0);
                }
            } else {
                goToNextPage();
            }
        } else if (viewerState === 'focus') {
            const region = currentPage.regions[regionIndex];
            const regionType = region?.type ?? 'focus';

            // challenge: state machine transition — locks viewer into challenge state.
            // The challenge game itself IS the action; no action dispatch needed.
            if (regionType === 'challenge') {
                setViewerState('challenge');
                return;
            }

            // ── 2.0-C: Unified action dispatch ────────────────────────────────
            // resolveRegionAction returns canonical action (explicit field or type default).
            // Legacy type='nav'/'audio' regions have action synthesized by normalizer,
            // so all regions reach this path with a resolved action.
            if (region) {
                const action = resolveRegionAction(region);

                if (action.type === 'jump') {
                    const targetId = action.targetPageId ?? region.navTargetPageId;
                    if (targetId) {
                        emit({ name: 'album_action_triggered', actionType: 'jump', pageIndex, regionIndex, regionId: region.id, targetPageId: targetId });
                        goToPageById(targetId);
                        return;
                    }
                    // No target configured — fall through to advance (misconfigured region).
                }

                if (action.type === 'return') {
                    emit({ name: 'album_action_triggered', actionType: 'return', pageIndex, regionIndex, regionId: region.id, targetPageId: null });
                    handleNavReturn();
                    return;
                }

                if (action.type === 'leo') {
                    emit({ name: 'album_action_triggered', actionType: 'leo', pageIndex, regionIndex, regionId: region.id, targetPageId: null });
                    setLeoWasTapped(true); // BLOQUE 4: show "pensando" state in overlay
                    if (action.leoPrompt) {
                        // Inject Leo prompt as a message and open chat
                        setLeoActionNonce({ message: action.leoPrompt, id: Date.now() });
                    } else {
                        // No prompt: open chat empty (Leo reads visualContext for context)
                        setOpenChatTrigger(prev => prev + 1);
                    }
                    return; // Stay on this region — reader chats, then taps to advance
                }

                // 'none', 'read', 'audio', 'text': no navigation side effect —
                // fall through to the normal region/page advance below.
            }

            if (activeRoute) {
                // Follow route order: find current position in route, advance to next.
                const currentId    = currentRegion?.id ?? '';
                const posInRoute   = activeRoute.regionIds.indexOf(currentId);
                const hasNextInRoute =
                    posInRoute >= 0 && posInRoute < activeRoute.regionIds.length - 1;

                if (hasNextInRoute) {
                    const nextId  = activeRoute.regionIds[posInRoute + 1];
                    const nextIdx = currentPage.regions.findIndex(r => r.id === nextId);
                    if (nextIdx >= 0) {
                        setRegionIndex(nextIdx);
                        return;
                    }
                }
                // Route exhausted (or region not found) → advance page.
                //
                // Ordering guarantee: route_completed is emitted here, synchronously,
                // BEFORE the goToNextPage() call below. goToNextPage() may emit
                // album_completed and reread_completed. All three go through
                // analyticsService.track() → buffer.push() with no async gap between
                // them — buffer insertion order is deterministic.
                // Invariant: route_completed.clientTs ≤ album_completed.clientTs.
                // See analyticsSeam.ts "Ordering contract" for the full guarantee.
                emit({
                    name:       'route_completed',
                    routeId:    activeRoute.id,
                    routeLabel: activeRoute.label,
                    pageIndex,
                    elapsedMs:  Date.now() - sessionStartRef.current,
                });
                goToNextPage();
            } else {
                // Linear fallback — existing behavior.
                if (regionIndex < currentPage.regions.length - 1) {
                    setRegionIndex(prev => prev + 1);
                } else {
                    goToNextPage();
                }
            }
        }
    };

    const handleBack = () => {
        // Cancels any advance interaction in-flight before going back.
        // Back must feel immediately responsive — it is a correction, not a reveal.
        interaction.cancel();
        if (viewerState === 'challenge') return; // Locked during game
        // First meaningful navigation — dismiss onboarding hints.
        if (!hasInteracted) { setHasInteracted(true); setNavHintActive(false); }

        if (viewerState === 'focus') {
            if (activeRoute) {
                // Route-aware back: go to previous region in route, or return to overview.
                const currentId  = currentRegion?.id ?? '';
                const posInRoute = activeRoute.regionIds.indexOf(currentId);
                if (posInRoute > 0) {
                    const prevId  = activeRoute.regionIds[posInRoute - 1];
                    const prevIdx = currentPage.regions.findIndex(r => r.id === prevId);
                    if (prevIdx >= 0) {
                        setRegionIndex(prevIdx);
                        return;
                    }
                }
                // At start of route → return to overview (route stays selected).
                setViewerState('overview');
            } else {
                if (regionIndex > 0) {
                    setRegionIndex(prev => prev - 1);
                } else {
                    setViewerState('overview');
                }
            }
        } else if (viewerState === 'overview') {
            if (activeAlbumRoute) {
                const posInRoute = activeAlbumRoute.sequence.indexOf(currentPage?.id ?? '');
                if (posInRoute > 0) {
                    const prevPageId = activeAlbumRoute.sequence[posInRoute - 1];
                    const prevIdx = albumData.findIndex(p => p.id === prevPageId);
                    if (prevIdx >= 0) {
                        setPageIndex(prevIdx);
                        setViewerState('overview');
                        setRegionIndex(0);
                        setActiveRouteId(null);
                        return;
                    }
                }
                // At the first page of the route → re-open the selector.
                setIsSelectingAlbumRoute(true);
            } else if (pageIndex > 0) {
                // Skip over with_previous companions: they are never the left-hand
                // spread anchor, so going back past them means going back one more.
                // rawPrev is always >= 0 because pageIndex > 0.
                const rawPrev = pageIndex - 1;
                const isCompanion = albumData[rawPrev]?.doublePageMode === 'with_previous';
                // If rawPrev is a companion, step back one more but clamp to 0.
                // Math.max(0, rawPrev - 1) is always safe: rawPrev >= 0 → rawPrev - 1 >= -1.
                const targetPrev = isCompanion ? Math.max(0, rawPrev - 1) : rawPrev;
                setPageIndex(targetPrev);
                setViewerState('overview');
                setRegionIndex(0);
                setActiveRouteId(null); // previous page starts fresh
            }
        }
    };

    // Keyboard navigation — locked in challenge state
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (viewerState === 'challenge') return;
            if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); interaction.trigger(handleAdvance); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); handleBack(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageIndex, regionIndex, viewerState, activeRouteId]);

    // Challenge click handler — uses imgRef for pixel-accurate hit detection.
    //
    // The zoom transform is applied to the <img> element itself (not the container).
    // The img uses max-w-full max-h-full, so the browser sizes the element box to
    // match the image content exactly — there is no internal letterboxing within
    // the element. getObjectContainRect returns the element rect unchanged (aspect
    // ratios match) and viewportToImagePercent maps post-transform viewport coords
    // into image-percentage space. Clicks outside the image area return null from
    // viewportToImagePercent and are treated as misses.
    const handleChallengeClick = (e: React.MouseEvent<HTMLDivElement>) => {
        // Cancel any pending navigation before processing the challenge hit.
        interaction.cancel();
        if (viewerState !== 'challenge' || !currentRegion || !imgRef.current) return;

        const imageRect = getObjectContainRect(imgRef.current);
        const pt        = viewportToImagePercent(e.clientX, e.clientY, imageRect);

        // Click landed on letterbox (outside image area) — always a miss
        const hit = pt !== null && isPointInRegion(pt.x, pt.y, currentRegion);

        if (hit) {
            audio.playEffect('challenge_hit');
            try {
                confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
            } catch (err) {
                console.warn('confetti failed', err);
            }
            setShowHint(false);
            // Stay in 'challenge' during the success delay so the TTS effect cannot
            // re-trigger on the just-solved region. After the delay, both viewerState
            // and regionIndex are updated in the same React batch (React 18 automatic
            // batching), so TTS fires exactly once against the *next* region.
            if (challengeTimerRef.current) clearTimeout(challengeTimerRef.current);
            challengeTimerRef.current = setTimeout(() => {
                // Route-aware advance: if a route is active, follow its order.
                if (activeRoute) {
                    const currentId  = currentRegion?.id ?? '';
                    const posInRoute = activeRoute.regionIds.indexOf(currentId);
                    const hasNext    = posInRoute >= 0 && posInRoute < activeRoute.regionIds.length - 1;
                    if (hasNext) {
                        const nextId  = activeRoute.regionIds[posInRoute + 1];
                        const nextIdx = currentPage.regions.findIndex(r => r.id === nextId);
                        if (nextIdx >= 0) {
                            setViewerState('focus');
                            setRegionIndex(nextIdx);
                            return;
                        }
                    }
                    // Route exhausted after challenge
                    emit({
                        name:       'route_completed',
                        routeId:    activeRoute.id,
                        routeLabel: activeRoute.label,
                        pageIndex,
                        elapsedMs:  Date.now() - sessionStartRef.current,
                    });
                    goToNextPage();
                } else if (regionIndex < currentPage.regions.length - 1) {
                    setViewerState('focus');         // batched ↓
                    setRegionIndex(prev => prev + 1); // single render, TTS fires for new region only
                } else {
                    goToNextPage(); // internally sets overview or complete — no TTS
                }
            }, 800); // 800ms: confetti runs ~1s, transition starts while it's still visible
        } else {
            // Miss — shake animation; use a ref so the timeout is cancelled on unmount
            audio.playEffect('challenge_miss');
            setIsMissAnimating(true);
            if (missAnimTimerRef.current) clearTimeout(missAnimTimerRef.current);
            missAnimTimerRef.current = setTimeout(() => {
                setIsMissAnimating(false);
                missAnimTimerRef.current = null;
            }, 400);
        }
    };

    // ── Audio Controls ─────────────────────────────────────────────

    const toggleMute  = () => setIsMuted(prev => !prev); // synced to engine via useEffect
    const replayAudio = () => audio.replay();

    // BLOQUE 2: Confetti celebration on album/route completion.
    useEffect(() => {
        if (viewerState !== 'complete') return;
        try {
            confetti({ particleCount: 140, spread: 80, origin: { y: 0.55 }, colors: ['#818cf8', '#a78bfa', '#c084fc', '#f9a8d4', '#fde68a', '#6ee7b7'] });
        } catch { /* ignore — confetti is enhancement only */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewerState]);

    // ── Completion Screen ──────────────────────────────────────────

    if (viewerState === 'complete') {
        return (
            <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50 text-white px-4">
                <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8 text-center max-w-sm w-full shadow-2xl">
                    <div className="text-5xl mb-4">✨</div>
                    <h2 className="text-3xl font-bold mb-2">¡Terminaste!</h2>
                    {completedAlbumRouteName ? (
                        <p className="text-indigo-300/80 text-sm mb-1 font-medium">{completedAlbumRouteName}</p>
                    ) : null}
                    <p className="text-white/40 text-sm mb-8 font-serif italic">{content.titulo}</p>

                    {/* Primary CTA */}
                    <button
                        onClick={() => navigate(`/contenido/${content.id}`)}
                        className="w-full px-6 py-3 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl font-semibold transition-colors mb-3"
                    >
                        Volver al libro
                    </button>

                    {/* Re-read with route selector — only when routes exist */}
                    {hasAlbumRoutes && (
                        <button
                            onClick={() => {
                                setPageIndex(0);
                                setRegionIndex(0);
                                setActiveRouteId(null);
                                setActiveAlbumRouteId(null);
                                setNavStack([]);
                                setIsSelectingAlbumRoute(true);
                                setViewerState('overview');
                            }}
                            className="w-full px-6 py-2.5 border border-white/20 hover:bg-white/10 text-white/80 rounded-2xl text-sm font-medium transition-colors mb-2"
                        >
                            Leer de nuevo · otra ruta
                        </button>
                    )}

                    {/* Exit to library */}
                    <button
                        onClick={() => navigate('/')}
                        className="w-full text-white/30 hover:text-white/55 text-sm py-2 transition-colors"
                    >
                        Ir a mi biblioteca
                    </button>
                </div>
            </div>
        );
    }

    if (!currentPage) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center text-white/50 text-sm">
                Este álbum no tiene páginas cargadas.
            </div>
        );
    }

    // ── Overlay computed vars ──────────────────────────────────────
    // Extracted from JSX to avoid IIFE patterns in the render body.
    // These depend on currentRegion which is declared above.

    // FORTALECIMIENTO B1: Progressive discovery system.
    // _regions / _unvisitedRegions: local aliases to avoid recomputing in JSX.
    const _regions          = currentPage?.regions ?? [];
    const _unvisitedRegions = _regions.filter(r => !visitedRegionIdsOnPage.has(r.id));

    // _discoveryTargetRegion: which region to highlight next.
    //   · Before first tap ever: first region (orient the user — "tap here").
    //   · After visiting ≥1 region on this page: first unvisited region (guide exploration).
    //   · Otherwise (hasInteracted but 0 visited on this page): undefined → no ripple.
    //     The user already knows to tap; they don't need the initial orientation hint.
    const _discoveryTargetRegion =
        !hasInteracted                        ? _regions[0] :
        visitedRegionIdsOnPage.size > 0       ? _unvisitedRegions[0] :
                                                undefined;

    const _discoveryTargetIdx = _discoveryTargetRegion
        ? _regions.indexOf(_discoveryTargetRegion)
        : -1;

    // Single viewport-px position for the active discovery target (or null = hidden).
    const _discoveryTargetPos = (
        _discoveryTargetIdx >= 0 &&
        discoveryDotPositions.length > _discoveryTargetIdx
    ) ? discoveryDotPositions[_discoveryTargetIdx] : null;

    // Show discovery ripple: overview + first read + there's a target to show.
    // After all regions on a page are visited, _discoveryTargetRegion is undefined
    // → this becomes false automatically (no ripple when everything is explored).
    const showDiscoveryHint =
        viewerState === 'overview' &&
        rereadContext.readCount === 0 &&
        _regions.length > 0 &&
        _discoveryTargetRegion !== undefined &&
        (
            !hasInteracted ||                    // before first tap: orient
            visitedRegionIdsOnPage.size > 0      // after visit: guide to next
        );

    const _overlayResolvedAction = currentRegion ? resolveRegionAction(currentRegion) : null;
    const overlayIsAudio   = !!currentRegion && (currentRegion.type === 'audio' || _overlayResolvedAction?.type === 'audio');
    const overlayIsText    = _overlayResolvedAction?.type === 'text';
    const overlayIsLeo     = _overlayResolvedAction?.type === 'leo';
    const overlayIsNone    = _overlayResolvedAction?.type === 'none';
    const overlayIsSilentContemplative = !!currentRegion && currentRegion.type === 'contemplative' && overlayIsNone;

    /** True when the narrative region panel should be visible at all. */
    const showNarrativeOverlay: boolean = !!currentRegion
        && currentRegion.type !== 'nav'
        && showText
        && (viewerState === 'focus' || viewerState === 'challenge')
        && (() => {
            if (overlayIsSilentContemplative) return false;
            if (viewerState === 'challenge') return true;
            if (currentRegion.text) return true;
            if (overlayIsAudio) return true;
            if (overlayIsText && _overlayResolvedAction?.text) return true;
            if (overlayIsLeo) return true;
            return false;
        })();

    // ── Main Render ────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 bg-black overflow-hidden flex flex-col">
            {/* Miss animation keyframes — injected inline for Tailwind CDN compatibility */}
            <style>{`
                @keyframes miss-shake {
                    0%, 100% { transform: translateX(0); }
                    20% { transform: translateX(-8px); }
                    40% { transform: translateX(8px); }
                    60% { transform: translateX(-5px); }
                    80% { transform: translateX(5px); }
                }
                .animate-miss-shake { animation: miss-shake 400ms ease-in-out; }

                /* BLOQUE 1 — Discovery ripple: 3 expanding rings telling the child
                   "this image is interactive". Fires once per page load on first read.
                   pointer-events:none — never blocks taps. */
                @keyframes discovery-ripple {
                    0%   { transform: translate(-50%,-50%) scale(0.2); opacity: 0.65; }
                    80%  { transform: translate(-50%,-50%) scale(1.8); opacity: 0; }
                    100% { transform: translate(-50%,-50%) scale(1.8); opacity: 0; }
                }
                .animate-discovery-ripple-1 {
                    animation: discovery-ripple 1.6s ease-out 3 forwards;
                }
                .animate-discovery-ripple-2 {
                    animation: discovery-ripple 1.6s ease-out 3 0.4s forwards;
                }
                .animate-discovery-ripple-3 {
                    animation: discovery-ripple 1.6s ease-out 3 0.8s forwards;
                }

                @keyframes leo-invite-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); transform: scale(1); }
                    40%       { box-shadow: 0 0 0 8px rgba(99,102,241,0.25); transform: scale(1.04); }
                    70%       { box-shadow: 0 0 0 12px rgba(99,102,241,0); }
                }
                .animate-leo-invite {
                    animation: leo-invite-pulse 2.4s cubic-bezier(0.4,0,0.6,1) 2;
                }

                /* Leo mediator hint bubble — 12s lifetime.
                   0–8%:   slide up + fade in (≈960ms)
                   8–85%:  fully visible
                   85–100%: fade out (≈1800ms), then onAnimationEnd fires resetIntervention */
                @keyframes leo-hint-appear {
                    0%   { opacity: 0; transform: translateY(8px); }
                    8%   { opacity: 1; transform: translateY(0); }
                    85%  { opacity: 1; transform: translateY(0); }
                    100% { opacity: 0; transform: translateY(0); }
                }
                .animate-leo-hint {
                    animation: leo-hint-appear 12s ease forwards;
                }
            `}</style>

            {/* Album-level route selector overlay — shown at mount when readingRoutes exist,
                and again when the user taps "↺ Elegir ruta". Full-screen modal over the viewer.
                Selecting a route sets activeAlbumRouteId and jumps to the route's first page.
                "Leer libremente" clears the active route and uses linear navigation.
                FASE D/H: shows book context, last-chosen route suggestion, fade-in animation. */}
            {isSelectingAlbumRoute && (
                <div
                    className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center px-6 py-12 overflow-y-auto"
                    style={{ animation: 'selector-fade-in 180ms ease' }}
                >
                    <style>{`@keyframes selector-fade-in { from { opacity:0; transform:scale(0.98) } to { opacity:1; transform:scale(1) } }`}</style>

                    {/* Book identity */}
                    <div className="text-center mb-8 max-w-xs">
                        <p className="text-white/30 text-xs uppercase tracking-widest mb-1 select-none">
                            {content.autor || 'Álbum ilustrado'}
                        </p>
                        <h2 className="text-white text-lg font-bold leading-snug mb-2">{content.titulo}</h2>
                        {content.descripcion_corta && (
                            <p className="text-white/40 text-xs leading-relaxed line-clamp-3">{content.descripcion_corta}</p>
                        )}
                        <p className="text-white/25 text-xs mt-4 select-none">¿Cómo quieres leer este álbum?</p>
                    </div>

                    <div className="w-full max-w-xs space-y-3">
                        {albumRoutes.map(route => {
                            const isActive   = activeAlbumRouteId === route.id;
                            const isLastChosen = !isActive && rereadContext.lastAlbumRouteId === route.id;
                            return (
                                <button
                                    key={route.id}
                                    onClick={() => {
                                        const firstPageId = route.sequence[0];
                                        const firstIdx = firstPageId
                                            ? albumData.findIndex(p => p.id === firstPageId)
                                            : -1;
                                        // Emit before state changes so no async gap.
                                        emit({ name: 'album_route_selected', routeId: route.id, routeName: route.name });
                                        setActiveAlbumRouteId(route.id);
                                        setIsSelectingAlbumRoute(false);
                                        if (firstIdx >= 0) {
                                            setPageIndex(firstIdx);
                                            setViewerState('overview');
                                            setRegionIndex(0);
                                            setActiveRouteId(null);
                                            setNavStack([]);
                                        }
                                        audio.playEffect('route_enter');
                                    }}
                                    className={`w-full text-left border rounded-2xl p-4 transition-all active:scale-[0.98] ${
                                        isActive
                                            ? 'bg-indigo-500/20 border-indigo-400/40'
                                            : isLastChosen
                                            ? 'bg-white/8 border-white/20 hover:bg-white/12'
                                            : 'bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/25'
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        {route.icon && (
                                            <span className="text-2xl mt-0.5 leading-none">{route.icon}</span>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-white font-semibold text-sm leading-snug">
                                                    {route.name || 'Ruta sin nombre'}
                                                </p>
                                                {isActive && (
                                                    <span className="text-indigo-400 text-xs">activa</span>
                                                )}
                                                {isLastChosen && (
                                                    <span className="text-white/35 text-xs">
                                                        ↩ Continuar
                                                        {rereadContext.lastAlbumRouteStep != null
                                                            ? ` · lámina ${rereadContext.lastAlbumRouteStep + 1}`
                                                            : ' donde ibas'}
                                                    </span>
                                                )}
                                            </div>
                                            {route.description && (
                                                <p className="text-white/45 text-xs mt-0.5 leading-snug">{route.description}</p>
                                            )}
                                            <p className="text-white/25 text-xs mt-1.5">
                                                {route.sequence.length} {route.sequence.length === 1 ? 'lámina' : 'láminas'}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                        <button
                            onClick={() => {
                                emit({ name: 'album_route_selected', routeId: 'free', routeName: 'libre' });
                                setActiveAlbumRouteId(null);
                                setIsSelectingAlbumRoute(false);
                            }}
                            className="w-full text-center text-white/30 hover:text-white/50 text-sm py-3 transition-colors"
                        >
                            Explorar sin guía
                        </button>
                    </div>
                </div>
            )}

            {/* Out-of-route bar — shown when the user drifted outside the active route via a nav jump.
                Provides a low-friction return affordance without interrupting the reading flow.
                z-[45]: above page route indicator (z-40), below header (z-50).
                pointer-events-none container with pointer-events-auto on the button only. */}
            {isOutOfRoute && !isSelectingAlbumRoute && viewerState !== 'challenge' && (
                <div className="absolute top-[64px] left-0 right-0 z-[45] flex justify-center pointer-events-none">
                    <div className="flex items-center gap-0 bg-black/50 backdrop-blur-sm border border-amber-500/20 rounded-full overflow-hidden">
                        <span className="text-amber-400/70 text-xs px-3 py-1 select-none">
                            Fuera de la ruta
                        </span>
                        <button
                            onClick={handleReturnToRoute}
                            className="pointer-events-auto text-amber-300/80 hover:text-amber-200 text-xs px-3 py-1 border-l border-amber-500/20 hover:bg-amber-500/10 transition-colors"
                        >
                            Retomar ↩
                        </button>
                        <button
                            onClick={() => setActiveAlbumRouteId(null)}
                            className="pointer-events-auto text-white/30 hover:text-white/50 text-xs px-2 py-1 border-l border-white/10 hover:bg-white/5 transition-colors"
                            title="Continuar libremente"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            {/* Header Controls */}
            <div className="absolute top-0 left-0 right-0 z-50 p-4 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
                <button
                    onClick={() => navigate(`/contenido/${content.id}`)}
                    className="pointer-events-auto p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10"
                >
                    <ChevronLeft />
                </button>

                <div className="flex flex-col items-center gap-1 self-center">
                    <span className="pointer-events-none select-none text-white text-sm bg-black/30 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10">
                        {spreadCompanion
                            ? `${pageIndex + 1}–${pageIndex + 2} / ${albumData.length} · doble`
                            : `${pageIndex + 1} / ${albumData.length}`}
                    </span>
                    {/* Return button — visible only when inside a non-linear nav jump */}
                    {navStack.length > 0 && (
                        <button
                            onClick={handleNavReturn}
                            className="pointer-events-auto select-none text-white/80 text-xs bg-black/40 backdrop-blur-sm px-3 py-0.5 rounded-full border border-white/10 hover:bg-white/20 transition-colors"
                        >
                            ← Volver
                        </button>
                    )}
                    {/* Album route affordance — shows route name + step position during reading (FASE F) */}
                    {activeAlbumRoute && !isSelectingAlbumRoute && !isOutOfRoute && albumRoutePosition && (
                        <span className="pointer-events-none select-none text-white/45 text-xs">
                            {activeAlbumRoute.icon ? `${activeAlbumRoute.icon} ` : ''}{activeAlbumRoute.name} · {albumRoutePosition.step}/{albumRoutePosition.total}
                        </span>
                    )}
                    {/* Album route switcher — visible when album-level routes exist */}
                    {hasAlbumRoutes && !isSelectingAlbumRoute && (
                        <button
                            onClick={() => setIsSelectingAlbumRoute(true)}
                            className="pointer-events-auto select-none text-white/60 text-xs bg-black/40 backdrop-blur-sm px-3 py-0.5 rounded-full border border-white/10 hover:bg-white/20 transition-colors"
                        >
                            {activeAlbumRoute ? '↺' : '↺ Elegir ruta'}
                        </button>
                    )}
                </div>

                <div className="pointer-events-auto flex gap-2">
                    {/* Replay audio — only useful in focus when narration is playing */}
                    {viewerState === 'focus' && (
                        <button
                            onClick={replayAudio}
                            className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10"
                            title="Repetir audio"
                        >
                            <RotateCcw size={20} />
                        </button>
                    )}
                    {/* Mute toggle — always visible so the user can silence at any point.
                        Ambient starts before focus state; user must be able to mute from overview. */}
                    <button
                        onClick={toggleMute}
                        className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10"
                        title={isMuted ? 'Activar sonido' : 'Silenciar'}
                    >
                        {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} className={audio.isPlaying ? 'text-indigo-400' : ''} />}
                    </button>

                    <button
                        onClick={() => setShowText(!showText)}
                        className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10"
                        title={showText ? 'Ocultar texto' : 'Mostrar texto'}
                    >
                        {showText ? <Eye size={20} /> : <EyeOff size={20} className="text-white/50" />}
                    </button>

                    {/* Zoom toggle — manual shortcut to enter/exit focus */}
                    <button
                        onClick={() => {
                            if (viewerState === 'overview') {
                                if ((currentPage.regions?.length ?? 0) > 0) {
                                    // Entering focus is a reveal — pipe through narrative pipeline.
                                    interaction.trigger(() => {
                                        setViewerState('focus');
                                        setRegionIndex(0);
                                    });
                                }
                            } else if (viewerState === 'focus') {
                                // Exiting focus is a correction — immediate, no delay.
                                interaction.cancel();
                                setViewerState('overview');
                            }
                        }}
                        className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10"
                    >
                        {viewerState === 'overview' ? <ZoomIn /> : <ZoomOut />}
                    </button>
                </div>
            </div>

            {/* Active route indicator — route label + implicit progress dots.
                Dots: filled indigo = steps already visited, dim = steps ahead.
                Non-numerical, non-schooly. Max ~8–10 dots for typical routes.
                Disappears in overview (selector takes over). pointer-events-none. */}
            {activeRoute && viewerState === 'focus' && (
                <div className="absolute top-[72px] left-0 right-0 z-40 flex justify-center pointer-events-none">
                    <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm border border-white/10 px-3 py-1 rounded-full">
                        <span className="text-white/50 text-xs select-none">
                            {activeRoute.icon ? `${activeRoute.icon} ${activeRoute.label}` : activeRoute.label}
                        </span>
                        {routeProgress && (
                            <span
                                className="flex items-center gap-[3px]"
                                aria-label={`Paso ${routeProgress.step} de ${routeProgress.total}`}
                            >
                                {activeRoute.regionIds.map((_, i) => (
                                    <span
                                        key={i}
                                        className={`block w-1 h-1 rounded-full transition-colors duration-300 ${
                                            i < routeProgress.step ? 'bg-indigo-400/60' : 'bg-white/20'
                                        }`}
                                    />
                                ))}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Main Canvas */}
            <div className="flex-1 relative flex items-center justify-center w-full h-full">
                {/* Shake wrapper — separate from zoom container to prevent transform conflict */}
                <div className={`relative w-full h-full flex items-center justify-center ${isMissAnimating ? 'animate-miss-shake' : ''}`}>
                    {/* Image container — flex-centers the img; does NOT carry the zoom transform.
                        The transform is on the <img> itself so translate(x%, y%) operates in
                        image-coordinate space (no letterboxing within a max-w/max-h element).
                        Narrative opacity pulse lives here — opacity + fallback overlay act as
                        a unit: opacity dims the whole container, overlay adds a compensating
                        white tint that is self-weighted by scene luminance.

                        SPREAD LAYOUT (overview only):
                        When spreadCompanion is present AND we are in overview state, render
                        two images side by side (left anchor + right companion) using a flex
                        row. Both images use max-h-full so they scale to the same height and
                        their combined width fills the viewport naturally.
                        In focus/challenge state, revert to single-image layout so the camera
                        system's translate(x%,y%) coordinate assumptions are preserved — the
                        transform is applied only to the active region's page image.          */}
                    <div
                        className="relative w-full h-full flex items-center justify-center"
                        style={{ opacity: narrativeOpacity, transition: narrativeTransition }}
                    >
                        {spreadCompanion && viewerState === 'overview' && currentPage?.imageUrl ? (
                            /* ── Two-image spread layout (overview only) ─────────────────
                               Both images use max-h-full + flex-1 so they share the same
                               rendered height and together fill the available viewport width.
                               No camera transform applied in overview state — camera system
                               coordinate assumptions are preserved.
                               Guard: spreadCompanion.imageUrl is checked inside the memo
                               (returns null if missing), and currentPage.imageUrl is checked
                               in the condition above — neither <img> can receive an empty src. */
                            <div className="flex h-full w-full items-center justify-center">
                                <img
                                    ref={imgRef}
                                    src={currentPage.imageUrl}
                                    alt=""
                                    draggable={false}
                                    className="select-none object-contain max-h-full flex-1 min-w-0"
                                />
                                {/* Binding fold seam — between the two real page images */}
                                <div
                                    className="flex-none self-stretch z-[3] pointer-events-none"
                                    style={{
                                        width: '1px',
                                        background: 'linear-gradient(to bottom, transparent 5%, rgba(0,0,0,0.18) 20%, rgba(0,0,0,0.22) 50%, rgba(0,0,0,0.18) 80%, transparent 95%)',
                                    }}
                                />
                                <img
                                    src={spreadCompanion.imageUrl}
                                    alt=""
                                    draggable={false}
                                    className="select-none object-contain max-h-full flex-1 min-w-0"
                                />
                            </div>
                        ) : (
                            /* ── Single-image layout (default, and all focus/challenge states) ──
                               max-w-full max-h-full ensures the element box = image content area,
                               making translate(x%,y%) directly image-space for the camera system. */
                            <img
                                ref={imgRef}
                                src={currentPage.imageUrl}
                                alt=""
                                draggable={false}
                                className="select-none object-contain max-w-full max-h-full will-change-transform"
                                style={camera.transformStyle}
                            />
                        )}

                        {/* Narrative reinforcement overlay — dark-scene fallback.
                            White at 1–2% opacity: imperceptible on light images, readable on
                            dark illustrations. Lives inside the opacity container so it shares
                            the same stacking context, timing, and easing rhythm.
                            Shares narrativeTransition — both layers beat in sync.
                            z-[2]: above <img>, below challenge overlay (z-[31]).
                            pointer-events:none — transparent to all clicks and hit detection.
                            Challenge state: opacity=0 (challenge overlay handles interaction).
                            Always in DOM (not conditional) so the CSS transition fades
                            smoothly from 0 rather than mounting at a non-zero value. */}
                        <div
                            className="absolute inset-0 z-[2] pointer-events-none"
                            style={{
                                background: 'white',
                                opacity: narrativeFallbackOpacity,
                                transition: narrativeTransition,
                                // USE_BLEND_MODE: inactive by default — see module constant above.
                                // No visual effect with pure white overlay (screen(white,x)=1 = normal).
                                // Benefit unlocks when background color shifts to a tinted tone.
                                ...(USE_BLEND_MODE ? { mixBlendMode: 'screen' as const } : {}),
                            }}
                        />

                        {/* Challenge overlay — absolute inset-0 on the container, not the img.
                            Intercepts all clicks; handleChallengeClick converts viewport coords
                            to image-space via getObjectContainRect(imgRef.current).
                            Nav zones are pointerEvents:none in challenge state (see below). */}
                        {viewerState === 'challenge' && (
                            <div
                                className="absolute inset-0 z-[31] cursor-crosshair"
                                onClick={handleChallengeClick}
                            />
                        )}

                        {/* FORTALECIMIENTO B1 — Progressive discovery ripple.
                            Single target: the NEXT unvisited region (not all at once).
                            Before first tap: targets the first region (orient).
                            After a visit: targets the first still-unvisited region (guide).
                            This teaches "there are multiple points" without overwhelming.
                            fixed: getObjectContainRect returns viewport coordinates.
                            pointer-events:none — never intercepts taps. */}
                        {showDiscoveryHint && _discoveryTargetPos && (
                            <React.Fragment>
                                <span className="fixed w-16 h-16 rounded-full border-2 border-white/55 animate-discovery-ripple-1 pointer-events-none z-[32]"
                                      style={{ left: _discoveryTargetPos.x, top: _discoveryTargetPos.y, transform: 'translate(-50%,-50%)' }} />
                                <span className="fixed w-16 h-16 rounded-full border-2 border-white/35 animate-discovery-ripple-2 pointer-events-none z-[32]"
                                      style={{ left: _discoveryTargetPos.x, top: _discoveryTargetPos.y, transform: 'translate(-50%,-50%)' }} />
                                <span className="fixed w-16 h-16 rounded-full border-2 border-white/20 animate-discovery-ripple-3 pointer-events-none z-[32]"
                                      style={{ left: _discoveryTargetPos.x, top: _discoveryTargetPos.y, transform: 'translate(-50%,-50%)' }} />
                            </React.Fragment>
                        )}
                    </div>
                </div>
            </div>

            {/* Contemplative orientation hint — first-read only.
                Silent contemplative regions look broken to a first-time reader:
                the camera zooms but nothing happens. A brief, fading label anchors the
                experience ("this is intentional — look, feel, continue when ready").
                12s total lifetime matching the Leo hint. pointer-events:none. */}
            {viewerState === 'focus' && overlayIsSilentContemplative && rereadContext.readCount === 0 && (
                <div
                    className="absolute bottom-8 left-0 right-0 z-40 flex justify-center pointer-events-none"
                    style={{ animation: 'leo-hint-appear 8s ease forwards' }}
                >
                    <span className="text-white/35 text-sm font-serif italic select-none bg-black/20 backdrop-blur-sm px-4 py-1.5 rounded-full">
                        Mira con calma · toca para continuar
                    </span>
                </div>
            )}

            {/* Text / Narrative Overlay — 2.0-C unified action model
                ── Visibility logic ────────────────────────────────────────────
                Hidden for: legacy type='nav' (immediate jump, no panel)
                            contemplative without action (pure silent observation)
                Shown for: challenge (challenge UI), focus (narrative text),
                           audio action (listening affordance), text action (overlay),
                           leo action (Leo affordance), contemplative+leo (Leo panel) */}
            {showNarrativeOverlay && (
                <div className={`absolute bottom-8 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[600px] z-40 transition-all duration-500 ${viewerState === 'challenge' ? 'scale-105' : ''}`}>
                    {/* BLOQUE 4: Leo-specific container styling — distinct bg/border so Leo
                        reads as a character, not a generic system panel. */}
                    <div className={`backdrop-blur-xl rounded-2xl p-6 text-center shadow-2xl border ${
                        viewerState === 'challenge'
                            ? 'bg-black/80 border-yellow-400/50'
                            : overlayIsLeo
                            ? 'bg-indigo-950/85 border-indigo-500/35'
                            : 'bg-black/60 border-white/10'
                    }`}>
                        {viewerState === 'challenge' ? (
                            <div className="flex flex-col items-center animate-in zoom-in">
                                <div className="bg-yellow-400 text-black rounded-full p-2 mb-2">
                                    <HelpCircle size={32} />
                                </div>
                                <p className="text-yellow-200 font-bold text-lg mb-1">¡Desafío de Leo!</p>
                                <p className="text-white text-xl font-serif italic">
                                    {currentRegion.interactiveHint
                                        ? `"${currentRegion.interactiveHint}"`
                                        : 'Toca la imagen para encontrar algo especial'}
                                </p>
                                <p className="text-xs text-gray-400 mt-2 uppercase tracking-wider">Toca la pantalla para encontrarlo</p>
                            </div>
                        ) : overlayIsLeo ? (
                            /* BLOQUE 4 — Leo affordance panel: distinct identity, thinking state */
                            <div>
                                {/* Leo identity badge */}
                                <div className="flex items-center justify-center gap-1.5 mb-3">
                                    <span className="text-indigo-400 text-base leading-none">✦</span>
                                    <span className="text-indigo-300/70 text-xs font-semibold uppercase tracking-widest select-none">Leo</span>
                                </div>
                                {leoWasTapped ? (
                                    /* "Thinking" state — shows from tap until chat opens */
                                    <div className="flex items-center justify-center gap-2 text-indigo-200/70 text-sm">
                                        <div className="w-1.5 h-1.5 bg-indigo-400/70 rounded-full animate-bounce" />
                                        <div className="w-1.5 h-1.5 bg-indigo-400/70 rounded-full animate-bounce delay-75" />
                                        <div className="w-1.5 h-1.5 bg-indigo-400/70 rounded-full animate-bounce delay-150" />
                                        <span className="font-serif italic ml-1">Leo está pensando…</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-3 text-indigo-300/80 text-sm animate-leo-invite">
                                        <span className="font-serif italic text-indigo-200/90">
                                            Toca para hablar con Leo
                                        </span>
                                    </div>
                                )}
                            </div>
                        ) : overlayIsAudio && !currentRegion!.text ? (
                            /* Audio-only region — all states + BLOQUES 3/4/5 */
                            <div className="flex flex-col items-center gap-2">
                                {/* BLOQUE 3 — Audio failed (URL error, no text fallback) */}
                                {audio.audioFailed ? (
                                    <div className="flex items-center gap-2 text-white/45 text-sm">
                                        <VolumeX size={16} className="text-white/30" />
                                        <span className="font-serif italic">No hay audio disponible</span>
                                    </div>
                                ) : (
                                    <>
                                        {/* BLOQUE 5 — Consistent state row: icon + label always the same shape */}
                                        <div className="flex items-center gap-3 text-white/70 text-sm">
                                            <Volume2 size={18} className={
                                                audio.isPlaying      ? 'text-indigo-400 animate-pulse' :
                                                audio.isLoadingAudio ? 'text-indigo-300/60' :
                                                                       'text-white/50'
                                            } />
                                            <span className="font-serif italic">
                                                {audio.isLoadingAudio ? 'Cargando…'
                                                 : audio.isPlaying    ? 'Escuchando…'
                                                 :                      'Toca para escuchar'}
                                            </span>
                                        </div>
                                        {/* BLOQUE 4 — Replay: always visible once audio is ready (not loading).
                                            Subtle before first play; prominent after. */}
                                        {!audio.isLoadingAudio && (
                                            <button
                                                onClick={replayAudio}
                                                className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-colors ${
                                                    audioHasPlayedOnce && !audio.isPlaying
                                                        ? 'text-white/65 hover:text-white hover:bg-white/10'
                                                        : 'text-white/25 hover:text-white/45 hover:bg-white/5'
                                                }`}
                                            >
                                                <RotateCcw size={12} />
                                                Repetir
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="relative">
                                {/* Loading indicator for TTS narration */}
                                {audio.isLoadingAudio && !isMuted ? (
                                    <div className="flex justify-center mb-2">
                                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce mr-1"></div>
                                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce mr-1 delay-75"></div>
                                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                                    </div>
                                ) : null}
                                {currentRegion!.text && (
                                    <p className="text-white text-lg md:text-2xl font-serif leading-relaxed">
                                        {currentRegion!.text}
                                    </p>
                                )}
                                {/* action.type='text' — secondary overlay panel */}
                                {overlayIsText && _overlayResolvedAction?.text && (
                                    <div className={`${currentRegion!.text ? 'mt-3 pt-3 border-t border-white/10' : ''}`}>
                                        <p className="text-indigo-200/80 text-sm md:text-base font-serif italic leading-relaxed">
                                            {_overlayResolvedAction.text}
                                        </p>
                                    </div>
                                )}
                                {/* BLOQUE 4 — Replay: visible from entry for text regions (TTS auto-plays).
                                    Subtle before first play, prominent after. */}
                                {!audio.isLoadingAudio && !isMuted && (
                                    <div className="mt-3 pt-3 border-t border-white/10 flex justify-center">
                                        <button
                                            onClick={replayAudio}
                                            className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-colors ${
                                                audioHasPlayedOnce && !audio.isPlaying
                                                    ? 'text-white/50 hover:text-white/80 hover:bg-white/10'
                                                    : 'text-white/20 hover:text-white/40 hover:bg-white/5'
                                            }`}
                                        >
                                            <RotateCcw size={12} />
                                            Repetir
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Page-level text overlay in overview */}
            {showText && viewerState === 'overview' && currentPage.text && (
                <div className="absolute bottom-20 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[600px] z-40 pointer-events-none">
                    <div className="backdrop-blur-xl bg-black/60 border border-white/10 rounded-2xl p-5 text-center shadow-2xl">
                        <p className="text-white text-lg md:text-2xl font-serif leading-relaxed">
                            {currentPage.text}
                        </p>
                    </div>
                </div>
            )}

            {/* Active album route pill — shown in overview when a route is active.
                Orients the reader: "you're inside a named reading path."
                Position: just below the header (top-[64px]), same level as out-of-route bar.
                Only in overview — in focus state, the route indicator dots already appear. */}
            {activeAlbumRoute && viewerState === 'overview' && !isOutOfRoute && !isSelectingAlbumRoute && (
                <div className="absolute top-[64px] left-0 right-0 z-40 flex justify-center pointer-events-none">
                    <span className="text-white/50 text-xs bg-black/35 backdrop-blur-sm border border-white/10 px-3 py-0.5 rounded-full select-none">
                        {activeAlbumRoute.icon ? `${activeAlbumRoute.icon} ` : ''}{activeAlbumRoute.name}
                        {albumRoutePosition ? ` · ${albumRoutePosition.step}/${albumRoutePosition.total}` : ''}
                    </span>
                </div>
            )}

            {/* "Toca para explorar" — first-read onboarding hint, no routes.
                Shows on any first-visit overview page (with or without page text)
                as long as there are regions to explore. Disappears on first interaction.
                Not shown to returning readers (readCount ≥ 1 → they know the flow). */}
            {viewerState === 'overview' && !hasRoutes && !hasInteracted && rereadContext.readCount === 0 && (currentPage.regions?.length ?? 0) > 0 && (
                <div className="absolute bottom-10 left-0 right-0 text-center z-40 pointer-events-none">
                    <span className="bg-black/50 backdrop-blur text-white px-4 py-2 rounded-full text-sm animate-pulse">
                        Toca para explorar
                    </span>
                </div>
            )}

            {/* FORTALECIMIENTO B1 — Exploration nudge: "hay N más por explorar".
                Auto-fades in/out. Fires once per page, 3s after returning to overview
                with unvisited regions remaining. Teaches multiplicity without nagging.
                Reuses leo-hint-appear animation (12s curve compressed to 4s here). */}
            {explorationNudgeVisible && _unvisitedRegions.length > 0 && viewerState === 'overview' && (
                <div
                    className="absolute bottom-10 left-0 right-0 z-40 flex justify-center pointer-events-none"
                    style={{ animation: 'leo-hint-appear 4s ease forwards' }}
                >
                    <span className="text-white/50 text-xs bg-black/35 backdrop-blur px-3 py-1.5 rounded-full select-none">
                        {_unvisitedRegions.length === 1
                            ? 'Hay 1 zona más por explorar'
                            : `Hay ${_unvisitedRegions.length} zonas más por explorar`}
                    </span>
                </div>
            )}

            {/* FORTALECIMIENTO B3 — Jump exploration hint: one-shot on first non-linear jump.
                Appears at the top (below header) to avoid conflicting with page content.
                Teaches non-linear navigation by naming it: "puedes saltar entre láminas".
                Auto-fades in 5s. Never repeats (jumpHintShownRef). */}
            {showJumpExplorationHint && (
                <div
                    className="absolute top-20 left-0 right-0 z-[45] flex justify-center pointer-events-none"
                    style={{ animation: 'leo-hint-appear 5s ease forwards' }}
                >
                    <span className="text-white/55 text-xs bg-black/40 backdrop-blur-sm border border-white/10 px-3 py-1.5 rounded-full select-none">
                        En este libro puedes saltar entre láminas
                    </span>
                </div>
            )}

            {/* "Elige un camino" — first-read hint when the page has narrative routes.
                The route selector is visible but ambiguous to a first-time user.
                This nudge labels the affordance without breaking the visual language. */}
            {viewerState === 'overview' && hasRoutes && !hasInteracted && rereadContext.readCount === 0 && (
                <div className="absolute bottom-[5.5rem] left-0 right-0 text-center z-40 pointer-events-none">
                    <span className="bg-black/40 backdrop-blur text-white/70 px-3 py-1 rounded-full text-xs">
                        Elige un camino
                    </span>
                </div>
            )}

            {/* Narrative route selector — appears in overview when the page defines reading paths.
                Tapping a route sets it as the active reading path and enters focus at its first region.
                The chosen route stays highlighted if the reader backs to overview mid-route,
                so they can re-enter where they were or switch paths.
                Tapping the navigation zone (advance) without choosing a route uses linear order. */}
            {viewerState === 'overview' && hasRoutes && (
                <div className="absolute bottom-8 left-0 right-0 z-40 flex justify-center flex-wrap gap-2 px-6">
                    {pageRoutes.map(route => {
                        const isActive  = activeRouteId === route.id;
                        const isVisited = !isActive && rereadContext.visitedRouteIds.includes(route.id);
                        return (
                            <button
                                key={route.id}
                                onClick={() => {
                                    // First meaningful interaction — dismiss onboarding hints.
                                    if (!hasInteracted) { setHasInteracted(true); setNavHintActive(false); }
                                    // Micro entrance mark — fires before camera move.
                                    // route_enter: two-voice soft opening (C4+E4, 142ms, gain 0.021 effective).
                                    // No competition: overview has no TTS, no duck cycle, no camera transition.
                                    emit({
                                        name:       'route_selected',
                                        routeId:    route.id,
                                        routeLabel: route.label,
                                        pageIndex,
                                        isRevisit:  isVisited,
                                    });
                                    if (isVisited) {
                                        emit({
                                            name:       'route_revisited',
                                            routeId:    route.id,
                                            pageIndex,
                                            visitCount: rereadContext.visitedRouteIds.filter(id => id === route.id).length,
                                        });
                                    }
                                    audio.playEffect('route_enter');
                                    setActiveRouteId(route.id);
                                    const firstId  = route.regionIds[0];
                                    const firstIdx = currentPage.regions.findIndex(r => r.id === firstId);
                                    interaction.trigger(() => {
                                        setViewerState('focus');
                                        setRegionIndex(firstIdx >= 0 ? firstIdx : 0);
                                    });
                                }}
                                className={`flex items-center gap-1.5 backdrop-blur-sm border text-sm px-4 py-2 rounded-full transition-all ${
                                    isActive
                                        ? 'bg-indigo-500/80 border-indigo-400/50 shadow-lg text-white'
                                        : isVisited
                                        ? 'bg-black/30 border-indigo-400/35 text-white/60 hover:bg-white/10 hover:text-white'
                                        : 'bg-black/50 border-white/15 text-white hover:bg-white/10'
                                }`}
                            >
                                {route.icon && <span className="text-base leading-none">{route.icon}</span>}
                                {route.label}
                                {isVisited && (
                                    // Visited indicator: small check mark, visible at any screen size.
                                    // Replaces the former w-1 h-1 dot (4×4px, ~1.8:1 contrast — unusable).
                                    <span className="text-indigo-400/70 text-xs flex-shrink-0 leading-none" aria-hidden="true">✓</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Nav-zone hint overlay — first read, first page, before first tap.
                Shows dim left/right chevrons for 3.5s to signal the 30/70 tap zones.
                pointer-events:none — does not block any interaction.
                z-[35]: above nav zones (30) and challenge overlay (31), below UI chrome (40+).
                CSS opacity transition fades it out when navHintActive flips false. */}
            {showNavHint && (
                <div
                    className="absolute inset-0 z-[35] pointer-events-none flex items-center justify-between px-5"
                    style={{
                        opacity:    navHintActive ? 1 : 0,
                        transition: 'opacity 600ms ease-out',
                    }}
                >
                    <ChevronLeft  className="text-white/40" size={44} />
                    <ChevronRight className="text-white/55" size={44} />
                </div>
            )}

            {/* Navigation Zones — two zones (30% back / 70% advance), disabled in challenge */}
            <div
                className="absolute inset-0 flex z-30"
                style={{ pointerEvents: viewerState === 'challenge' ? 'none' : 'auto' }}
            >
                <div className="w-[30%] h-full" onClick={handleBack} />
                {/* Advance zone — routed through the narrative pipeline for rhythm.
                    The ~270ms delay between tap and state change is intentional: it
                    creates anticipation before the zoom reveal. Back zone above remains
                    immediate (corrections must feel responsive). */}
                <div className="w-[70%] h-full" onClick={() => interaction.trigger(handleAdvance)} />
            </div>

            {/* Mediator hint bubble — appears above Leo's button after dwell threshold.
                Pre-baked question (no API call). Dismisses on tap or region change.
                z-[51]: one above Chatbot's z-50 so it renders on top of the button.
                Transitions in/out with opacity to avoid layout shift. */}
            {leoMediator.hintText && (
                <div
                    className="fixed bottom-24 md:bottom-[5.5rem] right-6 z-[51] max-w-[200px] animate-leo-hint"
                    onClick={() => {
                        // Manual tap = explicit dismissal → emit analytics, then open chat.
                        // The hint is a question — tapping it should open the conversation,
                        // not just dismiss the bubble. Opens chat via openChatTrigger increment.
                        // onAnimationEnd (12s auto-expire) is NOT emitted: that path means the
                        // reader didn't interact with the hint — a different signal.
                        emit({
                            name:             'leo_hint_dismissed',
                            interventionType: leoMediator.interventionType,
                            hintText:         leoMediator.hintText ?? '',
                            dwellKey:         `${pageIndex}:${regionIndex}`,
                        });
                        leoMediator.resetIntervention();
                        setOpenChatTrigger(prev => prev + 1);
                    }}
                    onAnimationEnd={leoMediator.resetIntervention}
                >
                    <div className="bg-indigo-500/90 backdrop-blur-sm text-white text-sm rounded-2xl rounded-br-none px-3 py-2 shadow-lg leading-snug cursor-pointer select-none">
                        {leoMediator.hintText}
                    </div>
                    {/* Speech bubble tail pointing down-right toward Leo button */}
                    <div className="w-0 h-0 ml-auto mr-3 border-l-8 border-l-transparent border-t-8 border-t-indigo-500/90" />
                </div>
            )}

            {/* Integrated Chatbot for Visual Literacy + Recap */}
            <Chatbot
                visualContext={visualContext}
                initialMessage={leoRecapMessage}
                isPulsing={leoMediator.shouldPulse}
                isHidden={!leoMediator.isVisible}
                openTrigger={openChatTrigger}
                isRecapLoading={isLoadingRecap}
                leoActionNonce={leoActionNonce}
            />

            {/* Audio is managed by NarrativeAudioEngine via useNarrativeAudio — no <audio> element needed here */}
        </div>
    );
};

export default VisorAlbum;
