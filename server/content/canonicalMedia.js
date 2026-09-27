/**
 * canonicalMedia.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 3C.2.
 *
 * materializeCanonicalMedia(epubBuffer, book) → { book, media }. Puro: Buffer +
 * objeto → objeto. Sin filesystem, sin red, sin fechas, sin aleatoriedad.
 *
 * - Lee del ZIP (safeZip.js) SOLO los `image.src` que el CanonicalBook referencia.
 * - Cada `src` debe ser una imagen aceptada por el importador (existe en el ZIP y
 *   está declarada en el manifest con un tipo raster admitido).
 * - Tipo REAL por magic bytes: JPEG, PNG, GIF o WebP, y debe coincidir con el
 *   media-type declarado. Cualquier discrepancia → rechazo (fail-closed). SVG
 *   queda fuera: nunca llega aquí.
 * - Identidad por contenido: `media/<sha256(bytes)>.<ext>`. Mismo contenido →
 *   misma ruta (se materializa una vez); nombres de origen iguales con bytes
 *   distintos no colisionan. El nombre del ZIP no sobrevive.
 * - El libro devuelto es una copia con `src` reescrito; id, alt, orden y
 *   capítulos no cambian. La rendición TXT ignora las imágenes, así que el
 *   contentFingerprint es el mismo antes y después (se verifica).
 *
 * `src` materializado es relativo al directorio del artefacto canónico
 * (/uploads/<contentId>/canonical/).
 */
import crypto from 'crypto';
import { computeContentFingerprint } from '../contentFingerprint.js';
import { CanonicalBookError } from './canonicalBook.js';
import { renderCanonicalBookToPlainText } from './canonicalTxtRenderer.js';
import { openZip } from './safeZip.js';
import { parseEpubArchive } from './epubImporter.js';

const fail = (code, message) => { throw new CanonicalBookError(code, message); };

export const CANONICAL_MEDIA_DIR = 'media';
const MEDIA_EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' });
export const CANONICAL_MEDIA_SRC_RX = /^media\/[0-9a-f]{64}\.(?:jpg|png|gif|webp)$/;

const startsWith = (bytes, sig, at = 0) => bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
const ascii = (s) => [...s].map(c => c.charCodeAt(0));

/** Tipo real por firma; null si no es JPEG/PNG/GIF/WebP. */
export function detectImageMediaType(bytes) {
    if (!Buffer.isBuffer(bytes)) return null;
    if (startsWith(bytes, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
    if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
    if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
    return null;
}

export function materializeCanonicalMedia(epubBuffer, book, { limits } = {}) {
    const { imageMediaTypes } = parseEpubArchive(epubBuffer, { limits });
    const zip = openZip(epubBuffer, limits);
    const refs = new Map(); // src del ZIP → media/<sha>.<ext>
    const media = [];
    const materialized = new Set();

    for (const chapter of book.chapters) {
        for (const block of chapter.blocks) {
            if (block.type !== 'image' || refs.has(block.src)) continue;
            const declared = imageMediaTypes.get(block.src);
            if (!declared) fail('MEDIA_NOT_IN_EPUB', 'imagen del libro no aceptada en este EPUB');
            const bytes = zip.read(block.src);
            const detected = detectImageMediaType(bytes);
            if (!detected) fail('MEDIA_UNKNOWN_BYTES', 'el contenido de la imagen no es JPEG/PNG/GIF/WebP');
            if (detected !== declared) fail('MEDIA_TYPE_MISMATCH', 'el tipo real de la imagen no coincide con el declarado en el manifest');
            const ref = `${CANONICAL_MEDIA_DIR}/${crypto.createHash('sha256').update(bytes).digest('hex')}.${MEDIA_EXTENSIONS[detected]}`;
            refs.set(block.src, ref);
            if (!materialized.has(ref)) {
                materialized.add(ref);
                media.push({ path: ref, mediaType: detected, bytes });
            }
        }
    }

    const out = JSON.parse(JSON.stringify(book));
    for (const chapter of out.chapters) {
        for (const block of chapter.blocks) if (block.type === 'image') block.src = refs.get(block.src);
    }
    if (computeContentFingerprint(renderCanonicalBookToPlainText(out)) !== book.contentFingerprint) {
        fail('MEDIA_FINGERPRINT_DRIFT', 'la materialización alteró el texto canónico');
    }
    return { book: out, media };
}
