/**
 * Reader Mode Registry — fuente única de verdad para los modos de lectura.
 *
 * ── Convención semántica ──────────────────────────────────────────────────────
 *
 * PRESENTE (UI activa hoy):
 *   'pdf'        → "Modo Visual (PDF)"     /leer/pdf/:id        VisorPDF
 *   'text'       → "Modo Guiado"            /leer/texto/:id      VisorTexto
 *   'immersive'  → "Modo Inmersivo"         /leer/inmersivo/:id  VisorInmersivo
 *   'album'      → "Modo Álbum"             /ver/album/:id       VisorAlbum
 *
 * LEGACY (compatibilidad con datos vivos — NO reutilizar):
 *   'accessible' → corresponde al actual "Modo Guiado" (= 'text').
 *                  Persiste en progress_db.json (canonicalProgress.lastInteractedMode)
 *                  y en reportes históricos (modeUsage.accessible).
 *                  Backend lo sigue aceptando para no romper continuidad de datos.
 *                  Código nuevo NO debe escribir este valor; usar 'text'.
 *
 * RESERVADO (futuro — no implementado):
 *   'a11y'       → identificador del nuevo Modo Accesible.
 *                  Ruta reservada: /leer/accesible/:id (NO registrada en App.tsx aún).
 *                  Cuando se construya, este será el ID interno definitivo.
 *                  NO emitir al backend hasta que el endpoint lo valide.
 *
 * Nota crítica: 'accessible' y 'a11y' son valores DISTINTOS por diseño —
 * el primero es histórico (= text/Modo Guiado), el segundo es el nuevo
 * modo a construir desde cero. NUNCA mezclarlos.
 */

export type ReaderMode =
    | 'pdf'
    | 'text'
    | 'immersive'
    | 'album'
    | 'accessible'  // legacy — equivalente a 'text'
    | 'a11y';       // reservado — nuevo Modo Accesible

/**
 * Modos aceptados por el backend hoy (ver server/server.js validación de
 * canonicalProgress.lastInteractedMode). NO incluir 'a11y' aquí hasta que
 * el endpoint lo valide explícitamente.
 */
export const BACKEND_READER_MODES: readonly ReaderMode[] = [
    'pdf',
    'text',
    'accessible', // legacy — preservado para no romper progreso histórico
    'immersive',
] as const;

/**
 * Modos con visor implementado y ruta activa en App.tsx.
 * 'accessible' no aparece — su ruta efectiva es la de 'text' (/leer/texto/).
 * 'a11y' no aparece — aún no implementado.
 */
export const ACTIVE_READER_MODES: readonly ReaderMode[] = [
    'pdf',
    'text',
    'immersive',
    'album',
] as const;

/**
 * Ruta reservada para el futuro Modo Accesible.
 * Mantener este símbolo aquí para que el día que se implemente sea evidente
 * cuál es la ruta canónica. NO registrar en App.tsx hasta que exista el visor.
 */
export const RESERVED_A11Y_ROUTE = '/leer/accesible/:id' as const;

/**
 * Etiqueta visible al usuario para cada modo.
 * 'accessible' (legacy) se mapea a "Modo Guiado" para que cualquier UI que
 * todavía reciba ese valor de un dato persistido lo muestre con la nomenclatura
 * actual sin necesidad de migrar la base de datos.
 */
export function getReaderModeLabel(mode: ReaderMode): string {
    switch (mode) {
        case 'pdf':        return 'Modo Visual (PDF)';
        case 'text':       return 'Modo Guiado';
        case 'immersive':  return 'Modo Inmersivo';
        case 'album':      return 'Modo Álbum';
        case 'accessible': return 'Modo Guiado';     // legacy → mismo label que 'text'
        case 'a11y':       return 'Modo Accesible';  // reservado — label cuando se implemente
    }
}

/**
 * Ruta canónica para un modo, opcionalmente sustituyendo `:id`.
 * Devuelve undefined para 'a11y' (la ruta está reservada pero no implementada).
 * Para 'accessible' devuelve la ruta de 'text' por equivalencia legacy.
 */
export function getReaderModeRoute(mode: ReaderMode, contentId?: string): string | undefined {
    const id = contentId ?? ':id';
    switch (mode) {
        case 'pdf':        return `/leer/pdf/${id}`;
        case 'text':       return `/leer/texto/${id}`;
        case 'immersive':  return `/leer/inmersivo/${id}`;
        case 'album':      return `/ver/album/${id}`;
        case 'accessible': return `/leer/texto/${id}`; // legacy → ruta del Modo Guiado
        case 'a11y':       return undefined;            // reservado — sin ruta activa todavía
    }
}

/** True si el modo tiene visor implementado y se puede navegar. */
export function isReaderModeImplemented(mode: ReaderMode): boolean {
    return mode !== 'a11y';
}

/**
 * Normaliza un valor legacy al canónico actual.
 * Útil cuando se lee `lastInteractedMode` de un registro persistido y se
 * quiere comparar con el modo activo del visor sin caer en falsos negativos.
 *
 *   normalizeReaderMode('accessible') === 'text'
 *   normalizeReaderMode('text')       === 'text'
 *   normalizeReaderMode('a11y')       === 'a11y'   (no se normaliza — es nuevo)
 */
export function normalizeReaderMode(mode: ReaderMode): Exclude<ReaderMode, 'accessible'> {
    return mode === 'accessible' ? 'text' : mode;
}
