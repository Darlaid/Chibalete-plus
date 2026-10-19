/**
 * epubAdmin.mjs — CHP-CONTENT-CANONICAL-2026-01 3F.1.
 *
 * Reglas puras de la UI admin para EPUB (sin React ni red):
 * - las tres operaciones del gestor (crear TXT/EPUB, crear EPUB ilustrado,
 *   añadir EPUB a un contenido existente);
 * - presentación del resumen que devuelve POST /api/upload/epub-inspect
 *   (el servidor inspecciona con el mismo parser que la importación);
 * - motivos de bloqueo. La validación real sigue siendo del servidor.
 */

export const EPUB_BOOK_FLOWS = [
    { id: 'text', title: 'Crear contenido desde TXT o EPUB', description: 'Para textos que Chibalete+ convertirá a sus modos de lectura.' },
    { id: 'illustrated', title: 'Crear contenido desde EPUB ilustrado', description: 'Conserva también la edición EPUB original y habilita su lector.' },
    { id: 'attach', title: 'Añadir EPUB a un contenido existente', description: 'Añade una edición EPUB a un título publicado sin modificar sus otros modos.' },
];

export const EPUB_ALREADY_ATTACHED_MESSAGE = 'Este contenido ya tiene una edición EPUB.';
export const EPUB_SCRIPTED_MESSAGE = 'Este EPUB contiene scripts y no se puede publicar por seguridad.';
export const EPUB_NO_TEXT_MESSAGE = 'Este EPUB no contiene texto que Chibalete+ pueda convertir a sus modos de lectura.';
export const ILLUSTRATED_KEEPS_ORIGINAL_MESSAGE = 'Se conservará la edición EPUB original y se habilitará su lector («Leer EPUB»), además de los modos de lectura de Chibalete+.';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const decimalEs = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');

/** Tamaño legible en español (MB decimales, como lo muestran los sistemas de archivos). */
export function formatEpubSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
    return `${decimalEs(bytes / 1_000_000)} MB`;
}

/** Líneas del inspector, sin detalles técnicos internos. */
export function formatEpubInspection(insp) {
    if (!insp) return [];
    return [
        plural(insp.chapters, 'capítulo', 'capítulos'),
        plural(insp.images, 'imagen', 'imágenes'),
        `Diseño: ${insp.layout === 'fixed' ? 'fijo' : 'adaptable'}`,
        insp.toc?.present ? `Tabla de contenido: sí · ${plural(insp.toc.entries, 'entrada', 'entradas')}` : 'Tabla de contenido: no',
        `Scripts: ${insp.scripts ? 'sí' : 'no'}`,
        formatEpubSize(insp.bytes),
    ];
}

/**
 * Motivo para no publicar, o null.
 * @param {object} insp resumen del servidor
 * @param {{ requiresText?: boolean }} opts crear (true) exige texto; añadir edición no
 */
export function epubInspectionBlockReason(insp, { requiresText = true } = {}) {
    if (!insp) return null;
    if (insp.scripts) return EPUB_SCRIPTED_MESSAGE;
    if (requiresText && insp.hasText === false) return EPUB_NO_TEXT_MESSAGE;
    return null;
}

/** Añadir EPUB: un contenido que ya tiene epub_url no admite otro (no se reemplaza). */
export const epubAttachBlockReason = (content) => (content?.epub_url ? EPUB_ALREADY_ATTACHED_MESSAGE : null);

/** Búsqueda simple para el selector de «Añadir EPUB»: título, autor o id. */
export function filterContentsForAttach(contents, query, limit = 20) {
    const q = String(query || '').trim().toLowerCase();
    const list = (contents || []).filter(c => c && c.id && c.tipo !== 'memoria_club');
    const hits = q ? list.filter(c => [c.titulo, c.autor, c.id].some(v => String(v || '').toLowerCase().includes(q))) : list;
    return hits.slice(0, limit);
}
