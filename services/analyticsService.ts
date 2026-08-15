/**
 * analyticsService — lightweight reading event tracker.
 *
 * Events are buffered in memory and flushed in batches to /api/analytics/events.
 * Uses fetch with keepalive=true so in-flight requests survive page unload.
 * Completely fire-and-forget — failures are silently dropped to preserve the
 * reading experience.
 *
 * Usage:
 *   import * as analyticsService from '../services/analyticsService';
 *   analyticsService.track({ event: 'session_start', userId: '...', ... });
 *   analyticsService.flush(); // on component unmount
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface ReadingEvent {
  event: string;         // event name
  userId: string;
  contentId: string;
  timestamp: number;     // Date.now()
  streak: number;        // active streak at event time
  level: number;         // reader level at event time
  sessionDuration: number; // ms elapsed since session_start for this content
  [key: string]: unknown;  // extra fields per event type (nextContentId, oldLevel, etc.)
}

// ---------------------------------------------------------------------------
// INTERNALS
// ---------------------------------------------------------------------------

const ENDPOINT = '/api/analytics/events';
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 60_000; // periodic auto-flush
const HEARTBEAT_INTERVAL_MS = 60_000; // 60s between heartbeats

let buffer: ReadingEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function send(batch: ReadingEvent[]): void {
  const userId = batch[0]?.userId;
  // fetch with keepalive: request survives tab close / navigation
  fetch(ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(batch),
    headers: {
      'Content-Type': 'application/json',
    },
    keepalive: true,
  }).catch(() => {}); // never let analytics errors surface
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/** Queue a reading event. Auto-flushes when the batch reaches BATCH_SIZE. */
export function track(event: ReadingEvent): void {
  buffer.push(event);
  if (buffer.length >= BATCH_SIZE) flush();
}

/**
 * Flush all buffered events immediately.
 * Call on component unmount and on content transitions to avoid data loss.
 */
export function flush(): void {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0); // drain atomically
  send(batch);
}

// ---------------------------------------------------------------------------
// HEARTBEAT
// ---------------------------------------------------------------------------

export interface HeartbeatContext {
  userId: string;
  contentId: string;
  /** Ref to the session start timestamp (Date.now() value). */
  sessionStartRef: { current: number };
}

/**
 * Starts a 60s heartbeat for the current reading session.
 * Emits `session_heartbeat` events carrying elapsed time so the metrics
 * service can use them as a floor when `session_end` is missing (hard close).
 *
 * Calling startHeartbeat() while one is already running stops the old one first.
 * Call stopHeartbeat() on component unmount.
 */
export function startHeartbeat(ctx: HeartbeatContext): void {
  stopHeartbeat(); // clear any existing heartbeat
  if (typeof window === 'undefined') return;

  heartbeatTimer = setInterval(() => {
    try {
      track({
        event: 'session_heartbeat',
        userId: ctx.userId,
        contentId: ctx.contentId,
        timestamp: Date.now(),
        streak: 0,
        level: 0,
        sessionDuration: 0,
        elapsedMs: Date.now() - ctx.sessionStartRef.current,
      });
      // Flush immediately so heartbeats survive hard closes
      flush();
    } catch {
      // Never surface heartbeat errors
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/** Stops the current heartbeat timer, if any. */
export function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// AUTO-FLUSH (module-level, browser only)
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  // Flush on page/tab close — covers hard navigations and browser close
  window.addEventListener('beforeunload', flush);

  // Periodic flush in long sessions
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// ALBUM EMITTER — typed factory for VisorAlbum narrative events
// ---------------------------------------------------------------------------
//
// Usage in VisorAlbum:
//   const sessionId = generateSessionId();
//   const emit      = createAlbumEmitter({ userId, contentId, sessionId });
//   emit({ name: 'route_selected', routeId: '...', routeLabel: '...', ... });
//
// The factory wraps track() so album events go through the same buffer and
// flush mechanism as all other reading events. The `name` discriminant maps
// to ReadingEvent.event; all event-specific fields go into the index signature.
// streak / level / sessionDuration are set to 0 for album navigation events —
// they are gamification-layer fields not relevant to narrative navigation.
// `elapsedMs` on specific events carries timing data for those that need it.
//
// Dev logging: each emit prints a structured log line to console so events are
// visible during development without opening the network tab.

import type { AlbumEventInput } from '../utils/analyticsSeam';

export interface AlbumSessionContext {
  userId:    string;
  contentId: string;
  sessionId: string;
}

export type EmitFn = (input: AlbumEventInput) => void;

/**
 * Returns a stable `emit(input)` function bound to the given session context.
 * Call once at VisorAlbum mount (useMemo with [] deps).
 * The returned function is safe to call from effects, callbacks, and handlers.
 */
export function createAlbumEmitter(ctx: AlbumSessionContext): EmitFn {
  return function emit(input: AlbumEventInput): void {
    try {
      const { name, ...rest } = input as { name: string } & Record<string, unknown>;

      if (import.meta.env.DEV) {
        // Single-line structured log — visible in console without noise.
        console.log(
          `%c[album:analytics] ${name}`,
          'color:#818cf8;font-weight:bold',
          { sessionId: ctx.sessionId, contentId: ctx.contentId, ...rest },
        );
      }

      track({
        event:           name,
        userId:          ctx.userId,
        contentId:       ctx.contentId,
        timestamp:       Date.now(),
        streak:          0,   // gamification field — not relevant for album navigation events
        level:           0,   // gamification field — not relevant for album navigation events
        //
        // elapsedMs → sessionDuration mapping (compatibility bridge, not conceptual equivalence)
        //
        // ReadingEvent.sessionDuration is the legacy field used by VisorTexto and
        // VisorInmersivo for "ms elapsed since session start." Album events use
        // `elapsedMs` as the semantically correct name for the same value.
        //
        // This line maps elapsedMs → sessionDuration so album events conform to the
        // shared ReadingEvent schema and server consumers don't need event-type forks.
        // Events without elapsedMs (route_selected, leo_intervention_shown, etc.)
        // correctly receive 0 — they are point-in-time events, not duration measurements.
        //
        // Both fields are present in the stored payload: `sessionDuration` via this
        // line, `elapsedMs` via the `...rest` spread below. Consumers of album events
        // should read `elapsedMs` for clarity; `sessionDuration` is for schema compat.
        //
        // Future: when ReadingEvent is versioned, rename sessionDuration → elapsedMs
        // across all viewer types. Do NOT do this until VisorTexto and VisorInmersivo
        // consumers are updated — it would silently break their duration tracking.
        sessionDuration: (rest.elapsedMs as number | undefined) ?? 0,
        sessionId:       ctx.sessionId,
        ...rest,
      });
    } catch {
      // Type error or unexpected shape — non-fatal. Never let analytics
      // surface as a visible error in the reading experience.
    }
  };
}

/**
 * Generates a session ID: 8 random base-36 chars + timestamp suffix.
 * Collision probability is negligible for per-user, per-session IDs.
 * No external library needed.
 */
export function generateSessionId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
