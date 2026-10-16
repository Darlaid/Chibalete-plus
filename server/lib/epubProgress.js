/**
 * epubProgress.js — CHP-CONTENT-CANONICAL-2026-01 3E.6.
 *
 * Posición del Modo EPUB dentro del MISMO registro de progreso
 * (`canonicalProgress.epub`), sin un segundo sistema de progreso.
 *
 *   canonicalProgress.epub = { cfi, sectionIndex, fraction, contentFingerprint, updatedAt }
 *
 * - cfi: string que empieza por `epubcfi(`, máximo 4096. Nunca se trunca:
 *   inválido o demasiado largo → se rechaza el guardado entero.
 * - sectionIndex: entero ≥ 0. fraction: número 0–1.
 * - contentFingerprint: `sha256:<64 hex>` de los BYTES del EPUB fuente
 *   (calculado por el lector sobre lo que sirve GET /api/content/:id/epub).
 *   No es el contentFingerprint textual (book.txt) de nivel superior.
 *
 * Merge (lo decide el servidor):
 *   - guardado legacy (Guiado/PDF/Inmersivo/LU: el payload no trae `epub`):
 *     comportamiento histórico para el resto de campos + se conserva el `epub`
 *     existente tal cual;
 *   - guardado EPUB (el payload trae `epub`): se actualizan `epub` y
 *     `globalPercentage`; sentenceIndex, totalSentences, anchor, viewportHint,
 *     contentAnchor, contentFingerprint, contentVersion y lastInteractedMode
 *     quedan intactos.
 */

export const EPUB_CFI_MAX_LENGTH = 4096;
const EPUB_FINGERPRINT_RX = /^sha256:[0-9a-f]{64}$/;

const fail = (reason) => ({ ok: false, reason });

/** @returns {{ok:true, value:object} | {ok:false, reason:string}} */
export function validateEpubProgress(epub) {
    if (!epub || typeof epub !== 'object' || Array.isArray(epub)) return fail('epub_not_object');
    const { cfi, sectionIndex, fraction, contentFingerprint } = epub;
    if (typeof cfi !== 'string' || !cfi.startsWith('epubcfi(')) return fail('epub_cfi_invalid');
    if (cfi.length > EPUB_CFI_MAX_LENGTH) return fail('epub_cfi_too_long');
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return fail('epub_section_invalid');
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return fail('epub_fraction_invalid');
    if (typeof contentFingerprint !== 'string' || !EPUB_FINGERPRINT_RX.test(contentFingerprint)) return fail('epub_fingerprint_invalid');
    return { ok: true, value: { cfi, sectionIndex, fraction, contentFingerprint } };
}

export const isEpubProgressSave = (incoming) =>
    !!incoming && typeof incoming === 'object' && Object.prototype.hasOwnProperty.call(incoming, 'epub');

/**
 * @param {object|null|undefined} existing  canonicalProgress persistido (o nada)
 * @param {object} incoming                 payload.canonicalProgress
 * @param {{ normalize: Function, updatedAt: string }} opts
 * @returns {{ok:true, canonicalProgress:object, epubSave:boolean} | {ok:false, reason:string}}
 */
export function mergeCanonicalProgress(existing, incoming, { normalize, updatedAt }) {
    if (!isEpubProgressSave(incoming)) {
        const canonicalProgress = normalize(incoming);
        if (existing?.epub) canonicalProgress.epub = existing.epub;
        return { ok: true, canonicalProgress, epubSave: false };
    }
    const v = validateEpubProgress(incoming.epub);
    if (!v.ok) return v;
    const base = existing && typeof existing === 'object' ? { ...existing } : normalize({});
    if (incoming.globalPercentage !== undefined) {
        base.globalPercentage = normalize({ globalPercentage: incoming.globalPercentage }).globalPercentage;
    }
    base.epub = { ...v.value, updatedAt };
    return { ok: true, canonicalProgress: base, epubSave: true };
}
