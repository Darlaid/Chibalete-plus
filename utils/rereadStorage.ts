/**
 * rereadStorage — Lightweight persistence for album rereading context.
 *
 * Tracks how many times a user has completed an album and which narrative
 * routes they've visited. Used to vary Leo's intervention type bias on
 * subsequent reads, and to visually mark visited routes in the selector.
 *
 * Storage: localStorage, key = `reread_${userId}_${contentId}`.
 * All operations are try/caught — quota errors and private-mode restrictions
 * are non-fatal. Callers receive a safe default (first-read state) on failure.
 *
 * ── Current design notes ──────────────────────────────────────────────────
 *
 *   - readCount is incremented when the album reaches 'complete' state, not
 *     on page advance — so interrupted sessions don't inflate the count.
 *   - visitedRouteIds accumulates across reads — a route visited on read 2
 *     stays marked on read 3 so the reader can seek out unvisited paths.
 *   - lastRouteId is the most recent route the reader took. Not used yet —
 *     reserved for future "continue this route" affordances.
 *
 * ── Future evolution (DO NOT implement until Sprint 7+) ───────────────────
 *
 * The stored shape is intentionally flat and minimal. When richer signals are
 * needed, extend by adding new fields to RereadContext (types/index.ts) and
 * adding corresponding write calls here. getRereadContext() already uses `??`
 * fallbacks — old stored objects will parse correctly with new field defaults.
 * No migration script needed.
 *
 * Planned additions and their call sites:
 *
 *   partialReadCount: number
 *     When to write: session end (visibility change / beforeunload) when
 *     progress > 20% but 'complete' state was NOT reached this session.
 *     Call site: VisorAlbum unmount / pagehide event listener.
 *     Function to add: recordPartialRead(userId, contentId)
 *
 *   totalReadingTimeMs: number
 *     When to write: session end — add (Date.now() - sessionStartRef) to total.
 *     Call site: same as partialReadCount (VisorAlbum unmount).
 *     Function to add: addReadingTime(userId, contentId, elapsedMs)
 *
 *   lastCompletedAt: string (ISO)
 *     When to write: alongside incrementReadCount(), at 'complete' state.
 *     Already has the right call site — just add the field to the patch.
 *     No new function needed — extend incrementReadCount() patch object.
 *
 *   rereadDepthScore: number (0–1, computed, NOT stored)
 *     Derived from readCount + visitedRouteIds + lastCompletedAt + total routes.
 *     Compute lazily in a new getRereadDepthScore(ctx, totalRoutes) function.
 *     Never persist — always recompute from stored primitives.
 *
 * ── Analytics seam ────────────────────────────────────────────────────────
 *
 * recordRouteVisit and incrementReadCount are the two write functions called
 * from VisorAlbum. Sprint 7 can add analytics emission here WITHOUT changing
 * the call sites — the functions already have access to userId, contentId,
 * and the updated context object. Example:
 *
 *   export function incrementReadCount(userId, contentId) {
 *     const ctx = getRereadContext(userId, contentId);
 *     const next = { readCount: ctx.readCount + 1, lastCompletedAt: new Date().toISOString() };
 *     updateRereadContext(userId, contentId, next);
 *     emitAnalyticsEvent({ name: 'reread_completed', userId, contentId, ...next }); // Sprint 7
 *   }
 */

import type { RereadContext } from '../types';

const storageKey = (userId: string, contentId: string): string =>
    `reread_${userId}_${contentId}`;

export function getRereadContext(userId: string, contentId: string): RereadContext {
    try {
        const raw = localStorage.getItem(storageKey(userId, contentId));
        if (!raw) return { readCount: 0, visitedRouteIds: [] };
        const parsed = JSON.parse(raw) as Partial<RereadContext>;
        return {
            readCount:            parsed.readCount            ?? 0,
            visitedRouteIds:      parsed.visitedRouteIds      ?? [],
            lastRouteId:          parsed.lastRouteId,
            lastAlbumRouteId:     parsed.lastAlbumRouteId,
            lastAlbumRouteStep:   parsed.lastAlbumRouteStep,
            lastAlbumRoutePageId: parsed.lastAlbumRoutePageId,
        };
    } catch {
        return { readCount: 0, visitedRouteIds: [] };
    }
}

export function updateRereadContext(
    userId: string,
    contentId: string,
    patch: Partial<RereadContext>,
): void {
    try {
        const current = getRereadContext(userId, contentId);
        localStorage.setItem(
            storageKey(userId, contentId),
            JSON.stringify({ ...current, ...patch }),
        );
    } catch { /* quota / private mode — non-fatal */ }
}

/**
 * Records that the user visited a given route on this album.
 * Idempotent: calling again with the same routeId has no extra effect
 * on visitedRouteIds (deduped), but always updates lastRouteId.
 */
export function recordRouteVisit(userId: string, contentId: string, routeId: string): void {
    const ctx = getRereadContext(userId, contentId);
    const alreadyVisited = ctx.visitedRouteIds.includes(routeId);
    updateRereadContext(userId, contentId, {
        visitedRouteIds: alreadyVisited
            ? ctx.visitedRouteIds
            : [...ctx.visitedRouteIds, routeId],
        lastRouteId: routeId,
    });
}

/**
 * Records that the user selected an album-level reading route.
 * Updates lastAlbumRouteId so the selector can suggest resumption on next open.
 * Separate from recordRouteVisit which tracks page-level narrative routes.
 */
export function recordAlbumRouteSelected(userId: string, contentId: string, routeId: string): void {
    updateRereadContext(userId, contentId, { lastAlbumRouteId: routeId });
}

/**
 * Persists the reader's current position within an album-level route.
 * Data only — no auto-resume is implemented; consumers may read these
 * values in the future to offer a "continue" affordance.
 */
export function recordAlbumRouteProgress(
    userId: string,
    contentId: string,
    step: number,
    pageId: string,
): void {
    updateRereadContext(userId, contentId, {
        lastAlbumRouteStep:   step,
        lastAlbumRoutePageId: pageId,
    });
}

/**
 * Increments the completion counter for this album.
 * Call once when the viewer reaches 'complete' state.
 */
export function incrementReadCount(userId: string, contentId: string): void {
    const ctx = getRereadContext(userId, contentId);
    updateRereadContext(userId, contentId, { readCount: ctx.readCount + 1 });
}
