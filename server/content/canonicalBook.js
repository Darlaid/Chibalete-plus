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
 *       blocks: [{            // bloque de texto
 *         id: 'h-0001-0001' | 'p-0001-0002',
 *         type: 'heading' | 'paragraph',
 *         text: string,         // texto EXACTO de la fuente (líneas unidas por \n)
 *         level?: 1..6,         // solo heading (3C.1); ausente = 1 (TXT, artefactos 2B)
 *         separatorBefore?: string, // solo si difiere del separador por defecto
 *       } | {                   // imagen del flujo editorial (3C.1)
 *         id: 'img-0001-0001',
 *         type: 'image',
 *         src: string,          // referencia INTERNA normalizada, nunca una URL:
 *                               // al importar, ruta del recurso en el paquete (EPUB);
 *                               // persistido (3C.2), 'media/<sha256>.<ext>' relativo
 *                               // al directorio del artefacto canónico
 *         alt?: string,         // exactamente el de la fuente; ausente = sin alt
 *       }],
 *     }],
 *     trailing?: string,        // espacio en blanco tras el último bloque, si lo hay
 *   }
 *
 * - El título de un capítulo explícito es su primer bloque `heading`; no se
 *   duplica en el capítulo (una sola autoridad). El heading es el primer bloque
 *   de TEXTO del capítulo: solo imágenes pueden precederlo. Un capítulo puede
 *   contener solo imágenes (implícito).
 * - No hay rawText: la rendición TXT se deriva de los bloques de TEXTO; las
 *   imágenes no forman parte de ella ni del contentFingerprint. `separatorBefore`
 *   y `trailing` existen solo para que la ida y vuelta sea exacta.
 * - contentVersion NO vive aquí: es la versión textual del Content (1B);
 *   schemaVersion es la versión de este contrato.
 * - IDs ordinales y deterministas, estables para la MISMA versión canónica.
 *   Entre versiones de texto distintas la identidad la dan
 *   contentFingerprint + contentVersion. Los bloques de texto se numeran por su
 *   ordinal entre los de TEXTO del capítulo y las imágenes por su ordinal entre
 *   las imágenes: añadir o quitar imágenes no renumera el texto.
 */

export const CANONICAL_SCHEMA_VERSION = 1;
export const CANONICAL_BLOCK_TYPES = Object.freeze(['heading', 'paragraph', 'image']);
export const CANONICAL_TEXT_BLOCK_TYPES = Object.freeze(['heading', 'paragraph']);
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
/** blockOrdinal = ordinal entre los bloques de texto, o entre las imágenes, del capítulo. */
export const blockId = (type, chapterOrdinal, blockOrdinal) =>
    `${type === 'heading' ? 'h' : type === 'image' ? 'img' : 'p'}-${pad(chapterOrdinal)}-${pad(blockOrdinal)}`;

export const isTextBlock = (block) => CANONICAL_TEXT_BLOCK_TYPES.includes(block?.type);

/** Nivel semántico de un heading (1..6); el que no lo declara es de nivel 1. */
export const headingLevel = (block) => block?.level ?? 1;

/** Título del capítulo derivado de su encabezado; null si es implícito. */
export function chapterTitle(chapter) {
    const first = chapter?.blocks?.find(isTextBlock);
    return first && first.type === 'heading' ? first.text.trim() : null;
}

// Referencia interna de un medio: ruta relativa normalizada dentro del paquete
// fuente. Sin esquema (http:, data:, javascript:…), sin raíz absoluta, sin '\',
// sin '.', '..' ni segmentos vacíos, sin query/fragmento ni controles.
const MAX_MEDIA_SRC_CHARS = 512;
export function isSafeCanonicalMediaSrc(src) {
    if (typeof src !== 'string' || !src || src.length > MAX_MEDIA_SRC_CHARS) return false;
    if (/[\u0000-\u001f\u007f\\?#:]/.test(src) || src.startsWith('/')) return false;
    return src.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
}

const BLOCK_KEYS = Object.freeze({
    heading: new Set(['id', 'type', 'text', 'level', 'separatorBefore']),
    paragraph: new Set(['id', 'type', 'text', 'separatorBefore']),
    image: new Set(['id', 'type', 'src', 'alt']),
});

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
        const heading = (ch.blocks || []).find(isTextBlock)?.type === 'heading';
        if (ch.implicit === true && heading) problems.push(`${ch.id}: implícito con encabezado`);
        if (ch.implicit !== true && !heading) problems.push(`${ch.id}: explícito sin encabezado`);
        let textOrdinal = 0, imageOrdinal = 0;
        (ch.blocks || []).forEach((b) => {
            if (!b || !CANONICAL_BLOCK_TYPES.includes(b.type)) { problems.push(`${ch.id}: tipo ${b?.type}`); return; }
            const extra = Object.keys(b).filter(k => !BLOCK_KEYS[b.type].has(k));
            if (extra.length) problems.push(`${b.id}: campos no admitidos ${extra.join(',')}`);
            const ordinal = b.type === 'image' ? ++imageOrdinal : ++textOrdinal;
            if (b.id !== blockId(b.type, ci + 1, ordinal)) problems.push(`${ch.id}: id de bloque ${b.id}`);
            if (b.type === 'image') {
                if (!isSafeCanonicalMediaSrc(b.src)) problems.push(`${b.id}: src inválido`);
                if ('alt' in b && typeof b.alt !== 'string') problems.push(`${b.id}: alt no es string`);
            } else {
                if (typeof b.text !== 'string' || !b.text.trim()) problems.push(`${b.id}: texto vacío`);
                if (b.type === 'heading' && ordinal !== 1) problems.push(`${b.id}: encabezado fuera de posición`);
                if ('level' in b && !(Number.isInteger(b.level) && b.level >= 1 && b.level <= 6)) problems.push(`${b.id}: level inválido`);
            }
            if (ids.has(b.id)) problems.push(`id duplicado ${b.id}`);
            ids.add(b.id);
        });
    });
    return problems;
}
