/**
 * canonicalBook.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 2A.
 *
 * CanonicalBook es la representación editorial interna, neutral de formato:
 * la produce hoy el importador TXT y mañana un importador EPUB, y de ella
 * derivan los modos de lectura y la rendición TXT (LU, transición de visores).
 * No es A11yBook, ni HTML, ni el manifest del TTS.
 *
 * schemaVersion 1 (se amplía solo de forma aditiva):
 *
 *   {
 *     schemaVersion: 1,
 *     contentId: string,
 *     contentFingerprint: 'sha256:<64 hex>',   // autoridad del servidor (1B)
 *     language?: string,
 *     chapters: [{
 *       id: 'ch-0001',
 *       implicit?: true,        // sin encabezado en la fuente; NO se inventa título
 *       blocks: [{
 *         id: 'h-0001-0001' | 'p-0001-0002',
 *         type: 'heading' | 'paragraph',
 *         text: string,         // texto EXACTO de la fuente (líneas unidas por \n)
 *         separatorBefore?: string, // solo si difiere del separador por defecto
 *       }],
 *     }],
 *     trailing?: string,        // espacio en blanco tras el último bloque, si lo hay
 *   }
 *
 * - El título de un capítulo explícito es su primer bloque `heading`; no se
 *   duplica en el capítulo (una sola autoridad).
 * - No hay rawText: la rendición TXT se deriva de los bloques. `separatorBefore`
 *   y `trailing` existen solo para que la ida y vuelta sea exacta.
 * - contentVersion NO vive aquí: es la versión textual del Content (1B);
 *   schemaVersion es la versión de este contrato.
 * - IDs ordinales y deterministas, estables para la MISMA versión canónica.
 *   Entre versiones de texto distintas la identidad la dan
 *   contentFingerprint + contentVersion.
 */

export const CANONICAL_SCHEMA_VERSION = 1;
export const CANONICAL_BLOCK_TYPES = Object.freeze(['heading', 'paragraph']);
export const MAX_CANONICAL_SOURCE_CHARS = 20 * 1024 * 1024;

// Separadores por defecto de la rendición TXT.
export const DEFAULT_FIRST_SEPARATOR = '';
export const DEFAULT_BLOCK_SEPARATOR = '\n\n';

const FINGERPRINT_RX = /^sha256:[0-9a-f]{64}$/;

export class CanonicalBookError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'CanonicalBookError';
        this.code = code;
    }
}

const pad = (n) => String(n).padStart(4, '0');
export const chapterId = (chapterOrdinal) => `ch-${pad(chapterOrdinal)}`;
export const blockId = (type, chapterOrdinal, blockOrdinal) =>
    `${type === 'heading' ? 'h' : 'p'}-${pad(chapterOrdinal)}-${pad(blockOrdinal)}`;

/** Título del capítulo derivado de su encabezado; null si es implícito. */
export function chapterTitle(chapter) {
    const first = chapter?.blocks?.[0];
    return first && first.type === 'heading' ? first.text.trim() : null;
}

export function assertValidFingerprint(fingerprint) {
    if (typeof fingerprint !== 'string' || !FINGERPRINT_RX.test(fingerprint)) {
        throw new CanonicalBookError('INVALID_FINGERPRINT', 'contentFingerprint debe ser sha256:<64 hex>');
    }
}

/**
 * Valida la forma de un CanonicalBook v1. Devuelve la lista de problemas
 * (vacía si es válido). No lanza: sirve a tests y a futuros consumidores.
 */
export function validateCanonicalBook(book) {
    const problems = [];
    if (!book || typeof book !== 'object') return ['book no es un objeto'];
    if (book.schemaVersion !== CANONICAL_SCHEMA_VERSION) problems.push('schemaVersion distinto de 1');
    if (typeof book.contentId !== 'string' || !book.contentId) problems.push('contentId inválido');
    if (typeof book.contentFingerprint !== 'string' || !FINGERPRINT_RX.test(book.contentFingerprint)) problems.push('contentFingerprint inválido');
    if (!Array.isArray(book.chapters) || book.chapters.length === 0) problems.push('chapters vacío');
    const ids = new Set();
    (book.chapters || []).forEach((ch, ci) => {
        if (ch.id !== chapterId(ci + 1)) problems.push(`capítulo ${ci}: id ${ch.id}`);
        if (ids.has(ch.id)) problems.push(`id duplicado ${ch.id}`);
        ids.add(ch.id);
        const heading = ch.blocks?.[0]?.type === 'heading';
        if (ch.implicit === true && heading) problems.push(`${ch.id}: implícito con encabezado`);
        if (ch.implicit !== true && !heading) problems.push(`${ch.id}: explícito sin encabezado`);
        (ch.blocks || []).forEach((b, bi) => {
            if (!CANONICAL_BLOCK_TYPES.includes(b.type)) problems.push(`${ch.id}: tipo ${b.type}`);
            if (b.id !== blockId(b.type, ci + 1, bi + 1)) problems.push(`${ch.id}: id de bloque ${b.id}`);
            if (typeof b.text !== 'string' || !b.text.trim()) problems.push(`${b.id}: texto vacío`);
            if (b.type === 'heading' && bi !== 0) problems.push(`${b.id}: encabezado fuera de posición`);
            if (ids.has(b.id)) problems.push(`id duplicado ${b.id}`);
            ids.add(b.id);
        });
    });
    return problems;
}
