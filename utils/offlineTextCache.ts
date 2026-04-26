/**
 * offlineTextCache.ts
 *
 * Minimal localStorage-based text cache for offline accessible reading.
 *
 * Design constraints (Fase B/C):
 *   - ONE book at a time — new save always replaces the previous entry.
 *   - Text-only (accessible mode). PDFs stay in IndexedDB via offlineService.
 *   - No async: localStorage is synchronous — no Promise chains in load path.
 *   - All operations are try/catch safe — failures are silent, visor keeps working.
 *   - C3: entries are validated on read — corrupt/partial entries are discarded,
 *     never served to VisorTexto as if they were valid text content.
 *
 * Why localStorage and not IndexedDB for text:
 *   - Text is a plain string, not binary — localStorage handles it natively.
 *   - Single-entry constraint removes the need for indexed queries.
 *   - Typical accessible book: 50–300 KB. Well within the 5 MB localStorage limit.
 *   - No extra async/versioning complexity needed.
 *   - QuotaExceededError is surfaced to callers via return value, not thrown.
 */

export interface OfflineTextEntry {
    contentId: string;
    title: string;
    autor: string;
    portada_url?: string;
    /** Full text content of the book. */
    texto: string;
    /** Language variant that was cached. Offline fallback only fires on a matching language. */
    language: 'es' | 'en' | 'pt';
    /** ISO 8601 timestamp of the cache write. Informational only. */
    cachedAt: string;
}

const STORAGE_KEY = 'chibalete_offline_texto';
// C3: Minimum text length to be considered a real book (not an error message or empty file).
const MIN_TEXT_LENGTH = 20;

/**
 * C3: Structural integrity check for a parsed cache entry.
 * Returns false for any entry that is missing required fields, has wrong types,
 * or whose text is suspiciously short (could be an error placeholder or truncated write).
 * A false result causes the caller to discard the entry and clear the key.
 */
function isValidEntry(entry: unknown): entry is OfflineTextEntry {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
        typeof e.contentId === 'string' && e.contentId.length > 0 &&
        typeof e.texto    === 'string' && e.texto.length >= MIN_TEXT_LENGTH &&
        typeof e.language === 'string' && ['es', 'en', 'pt'].includes(e.language) &&
        typeof e.cachedAt === 'string' && e.cachedAt.length > 0
    );
}

/**
 * Persist the accessible text for a book.
 * Always replaces the previous entry — 1-book-at-a-time by design.
 * Returns 'ok' | 'quota' | 'error' so callers can surface feedback without throwing.
 */
export function saveOfflineText(entry: OfflineTextEntry): 'ok' | 'quota' | 'error' {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
        return 'ok';
    } catch (e: any) {
        // QuotaExceededError fires when storage is full (large book in a nearly-full origin).
        if (e?.name === 'QuotaExceededError' || e?.code === 22) return 'quota';
        console.warn('[offlineTextCache] saveOfflineText failed:', e);
        return 'error';
    }
}

/**
 * Retrieve the cached entry for a SPECIFIC content ID.
 * Returns null if nothing is cached, if the cache belongs to a different book,
 * or if the stored entry fails integrity validation (corrupt data is cleared).
 * The `language` filter is intentional — if the user cached Spanish but asks for English,
 * we don't serve the wrong language silently.
 */
export function getOfflineText(
    contentId: string,
    language?: 'es' | 'en' | 'pt'
): OfflineTextEntry | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const entry: unknown = JSON.parse(raw);
        // C3: Validate before using — corrupt entries are cleared and treated as cache miss.
        if (!isValidEntry(entry)) {
            clearOfflineText();
            return null;
        }
        if (entry.contentId !== contentId) return null;
        if (language && entry.language !== language) return null;
        return entry;
    } catch {
        // JSON.parse failure (truncated write, encoding issue) — clear and return miss.
        clearOfflineText();
        return null;
    }
}

/**
 * Retrieve WHICHEVER book is currently cached, regardless of content ID.
 * Used by the download button to detect "replaces <title>" before committing.
 * C3: Also validates the entry — returns null if corrupt.
 */
export function getOfflineTextEntry(): OfflineTextEntry | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const entry: unknown = JSON.parse(raw);
        if (!isValidEntry(entry)) {
            clearOfflineText();
            return null;
        }
        return entry;
    } catch {
        clearOfflineText();
        return null;
    }
}

/** Returns true if this specific content ID is currently cached for offline reading. */
export function isTextCachedOffline(contentId: string): boolean {
    return getOfflineText(contentId) !== null;
}

/** Remove the offline text entry. */
export function clearOfflineText(): void {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
