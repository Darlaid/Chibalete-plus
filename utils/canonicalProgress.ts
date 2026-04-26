/**
 * canonicalProgress.ts
 *
 * Helpers for the cross-mode reading continuity UX (Fase D).
 *
 * Design notes:
 *   - `ProgresoLectura.porcentaje` (0-100) is the canonical cross-mode currency.
 *     All three visors (VisorTexto, VisorInmersivo, VisorPDF) write it and read it
 *     via dataService.updateProgreso / dataService.getProgresoUsuarioLibro.
 *   - Identity: all visors use the same (userId, contentId) key, so a save from one
 *     mode is always visible to the others.
 *   - Conflict resolution: last write wins via `fecha_actualizacion` (ISO timestamp).
 *     No merge, no vector clock — simple and sufficient for single-user sessions.
 *   - Resume UX threshold: 5%. Below that we treat it as "not really started" and
 *     skip the banner to avoid false positives on accidental opens.
 */

export const RESUME_THRESHOLD_PCT = 5;

/**
 * Convert a raw percentage (0-100) into a short, friendly resume label.
 * Shown inside the resume toast: "Continuando desde el 42% del libro"
 */
export function formatResumeLabel(percentage: number): string {
    const pct = Math.round(percentage);
    if (pct >= 95) return 'casi al final';
    if (pct >= 75) return `el ${pct}% del libro`;
    if (pct >= 50) return `la mitad (${pct}%)`;
    return `el ${pct}% del libro`;
}

/**
 * Determine whether a resume toast should be shown and what it should say.
 * Returns null when no toast is warranted (no progress, or below threshold).
 *
 * `fromRemote`: true when progress was just pulled from the backend (cross-device).
 * Changes the label from "Continuando donde lo dejaste" to "Actualizado desde otro dispositivo".
 */
export function getResumeToast(
    percentage: number | undefined,
    lastMode?: string | null,
    currentMode?: 'texto' | 'inmersivo' | 'pdf',
    fromRemote?: boolean,
): { label: string; crossMode: boolean; fromRemote: boolean } | null {
    if (!percentage || percentage < RESUME_THRESHOLD_PCT) return null;
    const crossMode = !!lastMode && !!currentMode && lastMode !== currentMode;
    return {
        label: formatResumeLabel(percentage),
        crossMode,
        fromRemote: !!fromRemote,
    };
}
