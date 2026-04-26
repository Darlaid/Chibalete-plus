/**
 * analyticsSeam.ts — Event taxonomy for album experience metrics.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 * Types + derivative utility types. Minimal runtime cost (type erasure).
 *
 * This file defines WHAT events exist and WHAT they carry.
 * analyticsService.ts defines HOW they are emitted and WHERE they go.
 *
 * ── Adding a new event ────────────────────────────────────────────────────────
 *
 * 1. Define `interface YourEvent extends AlbumEventBase { name: 'your_event'; ... }`
 * 2. Add it to the `AnalyticsEvent` union.
 * 3. Add a `// @analytics: emit 'your_event'` comment at the call site.
 * 4. Wire in VisorAlbum or the relevant hook using the `emit` factory.
 *
 * ── Questions this taxonomy can answer ───────────────────────────────────────
 *
 *   Which routes are used most / least?
 *     route_selected grouped by routeId, routeLabel
 *
 *   Which routes are completed vs. abandoned?
 *     route_selected vs route_completed — if selected >> completed, reader backs out.
 *     See "Derived signals" section below for the full abandonment definition.
 *
 *   Where do readers abandon the album?
 *     album_completed.pageIndex = albumData.length - 1 for completions;
 *     absence of album_completed = abandonment (infer from session start without end)
 *
 *   How long do readers spend per session?
 *     album_completed.elapsedMs or reread_completed.elapsedMs
 *
 *   Does rereading change behavior?
 *     Compare route_selected events where readCount = 0 vs readCount >= 1
 *     Compare leo_intervention_shown.interventionType across readCounts
 *
 *   When does Leo intervene and what happens?
 *     leo_intervention_shown.dwellKey → was a route active? (activeRouteLeoMode)
 *     leo_intervention_shown vs leo_hint_dismissed → did reader engage or let it expire?
 *
 *   Do revisited routes get different treatment?
 *     route_revisited.routeId → how often are familiar routes re-chosen?
 *
 * ── Derived signals (inference, not emission) ────────────────────────────────
 *
 * Some analytical signals are intentionally NOT emitted as events. They are
 * derived from the existing event stream. Do NOT add new events for these —
 * doing so would create redundancy and dual sources of truth.
 *
 *   ROUTE ABANDONMENT
 *   Definition: a route that was selected but not completed within the same session.
 *   How to derive:
 *     SELECT sessionId, routeId
 *     FROM events
 *     WHERE name = 'route_selected'
 *       AND NOT EXISTS (
 *         SELECT 1 FROM events e2
 *         WHERE e2.sessionId = events.sessionId
 *           AND e2.name = 'route_completed'
 *           AND e2.routeId = events.routeId
 *           AND e2.clientTs > events.clientTs
 *       )
 *
 *   Minimal dataset example:
 *     session A:
 *       route_selected  { routeId: 'jaguar',   clientTs: 1000 }
 *       route_selected  { routeId: 'tortuga',  clientTs: 1500 }  ← reader switched
 *       route_completed { routeId: 'tortuga',  clientTs: 9000 }
 *     → abandoned: 'jaguar'  (selected, no matching completed in session A)
 *     → completed: 'tortuga' (selected AND completed in session A)
 *
 *   ANTI-PATTERN — do NOT add a route_abandoned event:
 *     Emitting route_abandoned would require choosing a trigger moment (on back
 *     navigation? on route switch? on unmount?). Each choice has different
 *     false-positive rates and all of them are heuristics. The derivation above
 *     is exact, requires no heuristics, and cannot produce false positives.
 *     A direct event would create two sources of truth that can diverge.
 *
 *   Why not a direct event: abandonment requires knowing what DID NOT happen —
 *   it is a relational property of the session, not an observable moment. Emitting
 *   it directly would require deciding when to emit (on back? on page change? on
 *   unmount?), each with different false-positive rates. The inference is exact
 *   and requires no heuristics. The two source events (route_selected,
 *   route_completed) are already emitted with the correct sessionId for the JOIN.
 *
 *   ALBUM ABANDONMENT
 *   Definition: a session that started (reread_started or first route_selected)
 *   but never produced album_completed.
 *   How to derive: sessions with route_selected but no album_completed, grouped
 *   by (sessionId, contentId). last pageIndex in route_selected approximates
 *   where the reader stopped.
 *   Why not a direct event: same reason as route abandonment — it is the absence
 *   of a future event, not a present observable.
 *
 * ── Ordering contract ────────────────────────────────────────────────────────
 *
 * When a route exhausts its last region AND that also ends the last page of the
 * album, three events fire in the same synchronous call stack:
 *
 *   1. route_completed   (emit in handleAdvance, before goToNextPage call)
 *   2. album_completed   (emit inside goToNextPage, called synchronously after)
 *   3. reread_completed  (emit immediately after album_completed, same block)
 *
 * All three go through analyticsService.track() → buffer.push() without any
 * await or async gap. Push order = buffer insertion order = server arrival order
 * (flushed as a single JSON array). This ordering is structural — it does not
 * depend on timers, React render cycles, or network conditions.
 *
 * Invariant: route_completed.clientTs ≤ album_completed.clientTs ≤
 *            reread_completed.clientTs within any session where all three fire.
 *            (clientTs is Date.now() inside each track() call — same synchronous
 *            tick, so values may be equal but never out of order.)
 *
 * ── elapsedMs / sessionDuration relationship ─────────────────────────────────
 *
 * Specific events (RouteCompletedEvent, AlbumCompletedEvent, RereadCompletedEvent)
 * carry `elapsedMs: number` — milliseconds since VisorAlbum session start.
 * This is the semantically correct field name for album analytics.
 *
 * The underlying ReadingEvent schema (analyticsService.ts) has a `sessionDuration`
 * field that serves the same purpose for other viewer types (VisorTexto, VisorInmersivo).
 * In createAlbumEmitter, `elapsedMs` is mapped to `sessionDuration` for schema
 * compatibility: `sessionDuration: rest.elapsedMs ?? 0`.
 *
 * IMPORTANT: `elapsedMs` and `sessionDuration` are BOTH present in the stored
 * event (the spread `...rest` includes `elapsedMs` as an extra field alongside
 * `sessionDuration`). Consumers should read `elapsedMs` for album events, not
 * `sessionDuration`, to avoid confusion with other viewer types.
 *
 * Future: when the ReadingEvent schema is versioned, rename `sessionDuration` to
 * `elapsedMs` across all viewer types for consistency. Until then, do not remove
 * `sessionDuration` — it would break VisorTexto and VisorInmersivo consumers.
 */

// ── Base ─────────────────────────────────────────────────────────────────────

/**
 * Fields enriched automatically by createAlbumEmitter — callers never pass these.
 * AlbumEventInput (below) strips these from the call-site payload type.
 */
export interface AlbumEventBase {
    /** From AlbumSessionContext.userId */
    userId:    string;
    /** From AlbumSessionContext.contentId */
    contentId: string;
    /** Unique session ID, generated once at VisorAlbum mount */
    sessionId: string;
    /** Date.now() at emit time — client-side, useful for within-session ordering */
    clientTs:  number;
}

// ── Navigation events ────────────────────────────────────────────────────────

/**
 * User selects a narrative reading route.
 * Origin: route selector onClick, before camera moves.
 * @analytics call site: VisorAlbum route selector
 */
export interface RouteSelectedEvent extends AlbumEventBase {
    name:       'route_selected';
    routeId:    string;
    routeLabel: string;
    pageIndex:  number;
    /** True if this route was already in rereadContext.visitedRouteIds */
    isRevisit:  boolean;
}

/**
 * User re-selects a route they have visited in any prior session.
 * Fired alongside route_selected when isRevisit = true.
 * @analytics call site: VisorAlbum route selector (conditional on isVisited)
 */
export interface RouteRevisitedEvent extends AlbumEventBase {
    name:       'route_revisited';
    routeId:    string;
    pageIndex:  number;
    /**
     * Minimum 1 (route is in visitedRouteIds = visited at least once before).
     * Future: if rereadStorage tracks per-route visit counts, this becomes richer.
     */
    visitCount: number;
}

/**
 * All regions in the active route were traversed and the album advanced.
 * Marks a complete authored traversal of the route.
 * Origin: handleAdvance() route-exhausted branch.
 * @analytics call site: VisorAlbum handleAdvance before goToNextPage()
 *
 * ── Ordering guarantee ────────────────────────────────────────────────────
 * When route exhaustion also ends the last page of the album, events fire in
 * this order within the same synchronous call stack:
 *   1. route_completed   ← this event
 *   2. album_completed
 *   3. reread_completed  (only if readCount ≥ 1)
 * All three are synchronous track() calls on the same buffer array — buffer
 * insertion order is deterministic. See "Ordering contract" in the file header.
 *
 * ── Route abandonment (derived signal — do NOT add route_abandoned event) ──
 * If route_selected exists for a (sessionId, routeId) pair but route_completed
 * does NOT, the route was abandoned. This is a JOIN in the query layer, not an
 * emitted event. See "Derived signals" section in the file header for the full
 * SQL pattern and the reasoning for keeping this as inference.
 */
export interface RouteCompletedEvent extends AlbumEventBase {
    name:       'route_completed';
    routeId:    string;
    routeLabel: string;
    pageIndex:  number;
    /** Elapsed ms since VisorAlbum session start */
    elapsedMs:  number;
}

/**
 * Album reached 'complete' state (last region of last page).
 * Origin: goToNextPage() final branch.
 * @analytics call site: VisorAlbum goToNextPage
 *
 * ── Ordering guarantee ────────────────────────────────────────────────────
 * Always emitted AFTER route_completed when route exhaustion caused the
 * completion. Always emitted BEFORE reread_completed within the same call.
 * See "Ordering contract" in the file header.
 */
export interface AlbumCompletedEvent extends AlbumEventBase {
    name:         'album_completed';
    /** readCount AFTER this completion = rereadContext.readCount + 1 */
    newReadCount: number;
    /** Elapsed ms since VisorAlbum session start */
    elapsedMs:    number;
}

/**
 * Returning reader (readCount ≥ 1) opened the album.
 * Fires alongside the reread_open audio signal at 400ms after mount.
 * @analytics call site: VisorAlbum reread session marker useEffect
 */
export interface RereadStartedEvent extends AlbumEventBase {
    name:            'reread_started';
    /** readCount at session open — how many times completed before this session */
    readCount:       number;
    /** Routes visited across ALL prior reads */
    visitedRouteIds: string[];
}

/**
 * Returning reader completed the album.
 * Fired alongside album_completed when readCount ≥ 1.
 * @analytics call site: VisorAlbum goToNextPage
 */
export interface RereadCompletedEvent extends AlbumEventBase {
    name:            'reread_completed';
    /** readCount BEFORE this completion */
    readCount:       number;
    visitedRouteIds: string[];
    elapsedMs:       number;
}

// ── Leo events ───────────────────────────────────────────────────────────────

/**
 * Leo's proactive intervention gate fired — hint is now visible.
 * Emitted from VisorAlbum via useEffect on leoMediator.shouldIntervene = true.
 * (Not emitted from useLeoMediator directly — hook is stateless about contentId.)
 * @analytics call site: VisorAlbum leo_intervention_shown useEffect
 */
export interface LeoInterventionShownEvent extends AlbumEventBase {
    name:              'leo_intervention_shown';
    /** InterventionType value: 'observe' | 'wonder' | 'connect' | 'reflect' | 'adult_bridge' */
    interventionType:  string;
    /** `${pageIndex}:${regionIndex}` — identifies exact region */
    dwellKey:          string;
    /** rereadContext.readCount — is this a first or Nth read? */
    readCount:         number;
    /** activeRoute.leoMode if a route is active, else null */
    activeRouteLeoMode: string | null;
}

/**
 * User manually tapped the Leo hint bubble to dismiss it.
 * NOT fired on auto-dismiss (onAnimationEnd after 12s) — only explicit taps.
 * @analytics call site: VisorAlbum hint bubble onClick
 */
export interface LeoHintDismissedEvent extends AlbumEventBase {
    name:             'leo_hint_dismissed';
    interventionType: string;
    hintText:         string;
    dwellKey:         string;
}

// ── Album-level route events ─────────────────────────────────────────────────
// Separate from page-level RouteSelectedEvent / RouteCompletedEvent.
// Page-level routes are reading paths through REGIONS within a single page.
// Album-level routes are editorial sequences of PAGES through the whole album.

/**
 * User selects an album-level reading route in the full-screen selector overlay.
 * Also emitted with routeId='free' when user chooses "Leer libremente".
 * @analytics call site: VisorAlbum route selector overlay onClick
 */
export interface AlbumRouteSelectedEvent extends AlbumEventBase {
    name:      'album_route_selected';
    routeId:   string;
    routeName: string;
}

/**
 * User advanced to the next page while inside an active album-level reading route.
 * Emitted on each page advance within the route sequence (not on route entry or completion).
 * Origin: goToNextPage() route-advance branch, before setPageIndex.
 * @analytics call site: VisorAlbum goToNextPage route-advance branch
 */
export interface AlbumRouteStepEvent extends AlbumEventBase {
    name:      'album_route_step';
    routeId:   string;
    routeName: string;
    /** 1-based step index within the route sequence */
    step:      number;
    /** Total pages in the route */
    total:     number;
    /** ID of the page the reader is advancing TO */
    pageId:    string;
}

/**
 * User exhausted the active album-level reading route (reached the last page in sequence).
 * Emitted synchronously BEFORE album_completed in the same call stack.
 * @analytics call site: VisorAlbum goToNextPage completion block
 */
export interface AlbumRouteCompletedEvent extends AlbumEventBase {
    name:      'album_route_completed';
    routeId:   string;
    routeName: string;
    elapsedMs: number;
}

// ── Action events ────────────────────────────────────────────────────────────

/**
 * An editorial region action was executed by the reader.
 * Emitted for jump, return, and leo actions in handleAdvance.
 * Passive actions (audio, text) are not emitted — their presence is implied
 * by the pageIndex/regionIndex of the surrounding navigation events.
 * @analytics call site: VisorAlbum handleAdvance action dispatcher
 */
export interface AlbumActionTriggeredEvent extends AlbumEventBase {
    name:        'album_action_triggered';
    /** RegionActionType that was executed */
    actionType:  string;
    pageIndex:   number;
    regionIndex: number;
    regionId:    string;
    /** Page navigated to for 'jump'; null for other action types */
    targetPageId: string | null;
}

// ── Media events (4.3 Media System) ─────────────────────────────────────────

/**
 * A region's audio started playing (pre-recorded or from asset).
 * Fired inside NarrativeAudioEngine.playRegion when doPlay() is called
 * for a non-TTS source (effectiveAudioUrl is present).
 * NOT fired for TTS playback — TTS is implicit from route / focus events.
 *
 * @analytics call site: VisorAlbum via useNarrativeAudio onPlayStart callback
 */
export interface AlbumMediaPlayedEvent extends AlbumEventBase {
    name:          'album_media_played';
    /** The resolved audio URL that was played */
    audioUrl:      string;
    /** mediaAssetId if the audio came from the media library, else null */
    mediaAssetId:  string | null;
    pageIndex:     number;
    regionIndex:   number;
    regionId:      string;
}

/**
 * An audio file was successfully uploaded to the media library from the editor.
 * Fired client-side after /api/upload returns success and the asset is added to
 * albumMediaAssets state. Helps understand editor usage patterns.
 *
 * Note: this event does NOT share AlbumEventBase (no sessionId / contentId in
 * the editor context). It is emitted directly via analyticsService.track() with
 * contentId from the editor form state.
 */
export interface AlbumMediaUploadedEvent {
    name:             'album_media_uploaded';
    contentId:        string;
    userId:           string;
    clientTs:         number;
    /** AlbumMediaAsset.id assigned to the new asset */
    assetId:          string;
    mimeType:         string;
    fileSizeBytes:    number;
    originalFileName: string;
}

// ── Union + input type ────────────────────────────────────────────────────────

/**
 * All album analytics events fired from VisorAlbum (reader-side).
 * Discriminated by `name`. Processed by createAlbumEmitter.
 *
 * AlbumMediaUploadedEvent is intentionally EXCLUDED — it fires from the editor
 * (SubirContenido), not from a reading session, and does not share AlbumEventBase.
 * It is exported above for documentation; emit it via analyticsService.track() directly.
 */
export type AnalyticsEvent =
    | RouteSelectedEvent
    | RouteRevisitedEvent
    | RouteCompletedEvent
    | AlbumCompletedEvent
    | RereadStartedEvent
    | RereadCompletedEvent
    | LeoInterventionShownEvent
    | LeoHintDismissedEvent
    | AlbumRouteSelectedEvent
    | AlbumRouteStepEvent
    | AlbumRouteCompletedEvent
    | AlbumActionTriggeredEvent
    | AlbumMediaPlayedEvent;

/**
 * Distributive Omit — works correctly on discriminated unions.
 * Each member of the union has the specified keys removed individually,
 * preserving the `name` discriminant for TypeScript narrowing.
 *
 * Used to derive AlbumEventInput: the type callers pass to emit(),
 * without the base fields that createAlbumEmitter injects automatically.
 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/**
 * The type callers pass to emit() — the event payload without base fields.
 * TypeScript narrows this by `name`, so each event gets its own field requirements.
 *
 * Example:
 *   emit({ name: 'route_selected', routeId: '...', routeLabel: '...', pageIndex: 2, isRevisit: false });
 *   //    ^ TypeScript enforces all non-base fields for RouteSelectedEvent
 */
export type AlbumEventInput = DistributiveOmit<AnalyticsEvent, keyof AlbumEventBase>;
