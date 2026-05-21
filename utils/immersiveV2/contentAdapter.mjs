/**
 * contentAdapter.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Resuelve un `contentId` → `Content` consultando un `dataService` inyectado
 * (NO importado como singleton — el caller pasa la instancia). Valida los
 * campos mínimos que el runtime V2 necesita para abrir una sesión.
 *
 * PURO. Sin React. Sin side effects al import. Sin estado global mutable.
 * Sin AbortSignal — la lectura es síncrona contra la cache local del
 * dataService.
 *
 * Diseño:
 *   - dataService es inyectable porque (a) el viewer productivo lo conoce,
 *     (b) los tests pasan stubs sin tocar el singleton real.
 *   - Errores formales con shape estable: { kind, reason?, meta? }. Cada
 *     `kind` mapea a la taxonomy del runtime V2 (immersiveRuntimeTypes.d.ts).
 *   - NO lanza excepciones: siempre devuelve { ok, ... }. Excepciones de
 *     dataService se capturan y traducen.
 */

/**
 * resolveContent — devuelve el Content normalizado o un error formal.
 *
 * @param {object} args
 * @param {string} args.contentId
 * @param {{ getContenidoById: (id: string) => unknown }} args.dataService
 */
export function resolveContent({ contentId, dataService } = {}) {
    if (typeof contentId !== 'string' || contentId.length === 0) {
        return { ok: false, error: makeErr('invariant_violated', {
            op: 'resolveContent', reason: 'invalid_contentId',
        }) };
    }
    if (!dataService || typeof dataService.getContenidoById !== 'function') {
        return { ok: false, error: makeErr('invariant_violated', {
            op: 'resolveContent', reason: 'invalid_dataService',
        }) };
    }
    let content;
    try {
        content = dataService.getContenidoById(contentId);
    } catch (e) {
        // dataService nunca debería throw, pero defensive.
        return { ok: false, error: makeErr('content_not_found', {
            op: 'resolveContent', reason: 'getContenidoById_throw',
            meta: { contentId, error: e?.message ?? String(e) },
        }) };
    }
    if (content == null || typeof content !== 'object') {
        return { ok: false, error: makeErr('content_not_found', {
            op: 'resolveContent', reason: 'not_found',
            meta: { contentId },
        }) };
    }
    if (typeof content.id !== 'string' || content.id.length === 0) {
        return { ok: false, error: makeErr('content_invalid', {
            op: 'resolveContent', reason: 'missing_id',
            meta: { contentId },
        }) };
    }
    if (typeof content.titulo !== 'string' || content.titulo.length === 0) {
        return { ok: false, error: makeErr('content_invalid', {
            op: 'resolveContent', reason: 'missing_titulo',
            meta: { contentId, id: content.id },
        }) };
    }
    return { ok: true, content };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function makeErr(kind, fields = {}) {
    return Object.freeze({ kind, ...fields });
}
