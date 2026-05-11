/**
 * ContentQueue — next-content selection and preloading.
 *
 * Pure functions. Zero React. Zero side effects at import time.
 *
 * ⚠️ INVARIANTE 12 — ContentQueue NO gobierna reproducción.
 * `getNextContent` es una sugerencia para UI (banner "Próximo →"). NO debe
 * llamar navigate, NO debe mutar playback, NO debe tocar route ni storage
 * del browser. Cualquier transición real entre libros requiere acción manual
 * del usuario canalizada por `assertManualNavigation` con reason whitelisted.
 *
 * El test engines/__tests__/contentQueue.test.js falla si alguien introduce
 * un side effect (navigate, fetch fuera de preloadContentText, hooks de React,
 * timers, storage, audio writes). Ver docs/immersive-mode-invariants.md.
 *
 * Selection priority for the next immersive read:
 *   1. Next sibling in same collection (same parentId, alphabetical by id)
 *   2. Highest tag-overlap with current content
 *   3. Same author
 *   4. Most-read available book (popularity fallback)
 *
 * Preloading warms the browser's HTTP cache so StartupEngine gets an instant
 * response when it fetches the same URL. Fire-and-forget; errors are silent.
 */

import type { Content } from '../types';

// ---------------------------------------------------------------------------
// SELECTION
// ---------------------------------------------------------------------------

/**
 * Returns the best next content to read after `current`, chosen from
 * `allContent`. Only considers books with a readable text URL.
 * Returns null if no suitable next content is found.
 */
export function getNextContent(
  current: Content,
  allContent: Content[]
): Content | null {
  // Only books that have a plain-text URL (required for immersive reading)
  const candidates = allContent.filter(
    c => c.id !== current.id && !!c.texto_plano_url && c.status !== 'error'
  );

  if (candidates.length === 0) return null;

  // 1. Next sibling in the same collection
  if (current.parentId) {
    const sibling = candidates
      .filter(c => c.parentId === current.parentId)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (sibling) return sibling;
  }

  // 2. Highest tag overlap
  if (current.etiquetas?.length > 0) {
    const scored = candidates
      .map(c => ({
        content: c,
        score: c.etiquetas?.filter(t => current.etiquetas.includes(t)).length ?? 0,
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) return scored[0].content;
  }

  // 3. Same author
  const sameAuthor = candidates.find(c => c.autor === current.autor);
  if (sameAuthor) return sameAuthor;

  // 4. Most read available book
  return candidates.sort(
    (a, b) => (b.metricas?.veces_leido ?? 0) - (a.metricas?.veces_leido ?? 0)
  )[0] ?? null;
}

// ---------------------------------------------------------------------------
// PRELOADING
// ---------------------------------------------------------------------------

/**
 * Warms the browser HTTP cache for a content's text file.
 * StartupEngine will later fetch the same URL and receive an instant cache hit.
 * Errors are silently swallowed — preloading is best-effort.
 */
export async function preloadContentText(content: Content): Promise<void> {
  if (!content.texto_plano_url) return;
  try {
    await fetch(content.texto_plano_url, { cache: 'force-cache' });
  } catch {
    // Best-effort — non-blocking
  }
}
