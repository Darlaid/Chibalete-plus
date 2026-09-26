/**
 * canonicalTxtRenderer.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 2A.
 *
 * renderCanonicalBookToPlainText(book) → TXT determinista (LF, sin BOM, sin
 * Markdown, sin HTML, sin rótulos inventados). Los bloques se unen con una
 * línea en blanco salvo que el bloque declare `separatorBefore`; así, para un
 * libro importado desde TXT la rendición es la fuente normalizada y
 * conserva su contentFingerprint.
 */
import { DEFAULT_FIRST_SEPARATOR, DEFAULT_BLOCK_SEPARATOR } from './canonicalBook.js';

export function renderCanonicalBookToPlainText(book) {
    let out = '';
    let first = true;
    for (const chapter of book.chapters) {
        for (const block of chapter.blocks) {
            const separator = block.separatorBefore ?? (first ? DEFAULT_FIRST_SEPARATOR : DEFAULT_BLOCK_SEPARATOR);
            out += separator + block.text;
            first = false;
        }
    }
    return out + (book.trailing ?? '');
}
