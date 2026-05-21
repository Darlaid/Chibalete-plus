/**
 * validateActiveSentenceVisibility.js — F8 (verdadera regla madre).
 *
 * "Una frase no puede sonar si el usuario no puede VERLA destacada."
 *
 * El ack legacy validaba solo el contrato DOM (count + index + attrs). Era
 * insuficiente: React reconciliaba los atributos ANTES de que la frase
 * estuviera realmente visible (translateY mid-anim, opacity baja, container
 * scrollado, overlay tapando, virtualización fuera de viewport).
 *
 * Este validador exige verificación de visibilidad REAL antes de emitir el
 * ack, usando getBoundingClientRect + getComputedStyle.
 *
 * Diseño:
 *   - PURO. Sin React, sin DOM directo. Recibe los DOM elements y un
 *     `getStyle` injection-friendly. El visor inyecta `window.getComputedStyle`
 *     en producción; los tests inyectan stubs sin jsdom.
 *   - Devuelve { ok, reason?, metrics } — el caller decide qué loguear y si
 *     llamar pb.acknowledgeVisualHighlight.
 *
 * Reasons enumerados (orden de check):
 *   active_missing       — count === 0
 *   active_duplicate     — count > 1
 *   index_mismatch       — el data-sentence-index no coincide con expectedIndex
 *   empty_text           — textContent.trim().length === 0
 *   zero_size            — width o height del bounding rect === 0
 *   invisible_style      — display:none o visibility:hidden
 *   opacity_too_low      — opacity < minOpacity (default 0.65)
 *   outside_viewport     — el rect del elemento no se solapa con el container
 *   outside_active_band  — el centro vertical está fuera de la banda activa (5%-95%)
 *   missing_active_class — la className no incluye `requiredClass` (default 'immersive-sentence-active')
 *   contrast_suspect     — color === backgroundColor (mismo string CSS)
 *
 * Si todo pasa → { ok: true, metrics }. El visor emite visual_highlight_ack
 * y llama pb.acknowledgeVisualHighlight(currentIndex).
 *
 * Tests: utils/__tests__/validateActiveSentenceVisibility.test.js
 */

/**
 * @typedef {object} VisibilityMetrics
 * @property {number} count
 * @property {number} domIdx
 * @property {number} textLength
 * @property {{x:number,y:number,width:number,height:number,top:number,bottom:number,left:number,right:number}|null} rect
 * @property {{x:number,y:number,width:number,height:number,top:number,bottom:number,left:number,right:number}|null} containerRect
 * @property {number} opacity
 * @property {string} visibility
 * @property {string} display
 * @property {string} className
 * @property {number} centerDistanceFromContainerCenter
 * @property {boolean} centerInActiveBand
 * @property {string} color
 * @property {string} backgroundColor
 *
 * @typedef {'active_missing'|'active_duplicate'|'index_mismatch'|'empty_text'|'zero_size'|'invisible_style'|'opacity_too_low'|'outside_viewport'|'outside_active_band'|'missing_active_class'|'contrast_suspect'} VisibilityReason
 *
 * @typedef {object} VisibilityResult
 * @property {boolean} ok
 * @property {VisibilityReason=} reason
 * @property {VisibilityMetrics} metrics
 */

const DEFAULT_REQUIRED_CLASS = 'immersive-sentence-active';
const DEFAULT_MIN_OPACITY    = 0.65;
const ACTIVE_BAND_LOW        = 0.05;  // 5% del container superior
const ACTIVE_BAND_HIGH       = 0.95;  // 95% del container inferior

/**
 * Construye una snapshot defensiva de un DOMRect-like (puede ser plain object
 * de tests o un real DOMRect del navegador).
 * @param {*} r
 */
function rectSnapshot(r) {
    if (!r) return null;
    return {
        x:      r.x      ?? r.left ?? 0,
        y:      r.y      ?? r.top  ?? 0,
        width:  r.width  ?? 0,
        height: r.height ?? 0,
        top:    r.top    ?? 0,
        bottom: r.bottom ?? 0,
        left:   r.left   ?? 0,
        right:  r.right  ?? 0,
    };
}

function emptyMetrics(count, domIdx) {
    return {
        count, domIdx,
        textLength: 0,
        rect: null,
        containerRect: null,
        opacity: 0,
        visibility: '',
        display: '',
        className: '',
        centerDistanceFromContainerCenter: 0,
        centerInActiveBand: false,
        color: '',
        backgroundColor: '',
    };
}

/**
 * @param {{
 *   expectedIndex: number,
 *   activeEls: ArrayLike<{ getAttribute: (n:string)=>string|null, textContent: string|null, getBoundingClientRect: ()=>any, className: string }>,
 *   containerEl: { getBoundingClientRect: ()=>any } | null,
 *   getStyle: (el:any)=>{ opacity:string|number, visibility:string, display:string, color:string, backgroundColor:string },
 *   requiredClass?: string,
 *   minOpacity?: number,
 * }} input
 * @returns {VisibilityResult}
 */
export function validateActiveSentenceVisibility(input) {
    const expectedIndex   = input.expectedIndex;
    const activeEls       = input.activeEls;
    const containerEl     = input.containerEl;
    const getStyle        = input.getStyle;
    const requiredClass   = input.requiredClass ?? DEFAULT_REQUIRED_CLASS;
    const minOpacity      = input.minOpacity    ?? DEFAULT_MIN_OPACITY;

    const count = activeEls?.length ?? 0;

    // 1. count === 0 / count > 1
    if (count === 0) return { ok: false, reason: 'active_missing',   metrics: emptyMetrics(0, -1) };
    if (count > 1)   return { ok: false, reason: 'active_duplicate', metrics: emptyMetrics(count, -1) };

    const el = activeEls[0];

    // 2. data-sentence-index === expectedIndex
    const domIdxStr = el.getAttribute('data-sentence-index');
    const domIdx    = domIdxStr !== null ? parseInt(domIdxStr, 10) : NaN;
    if (Number.isNaN(domIdx) || domIdx !== expectedIndex) {
        return { ok: false, reason: 'index_mismatch', metrics: emptyMetrics(count, Number.isNaN(domIdx) ? -1 : domIdx) };
    }

    // 3. capturar todo lo necesario para metrics (incluso si después se rechaza)
    const rect          = rectSnapshot(el.getBoundingClientRect());
    const containerRect = containerEl ? rectSnapshot(containerEl.getBoundingClientRect()) : null;
    const text          = (el.textContent ?? '').trim();
    const style         = getStyle(el);
    const opacity       = typeof style.opacity === 'number' ? style.opacity : parseFloat(String(style.opacity ?? '1'));
    const className     = el.className ?? '';

    // banda activa
    let centerDistanceFromContainerCenter = 0;
    let centerInActiveBand                = true;
    if (rect && containerRect) {
        const centerY          = rect.top + rect.height / 2;
        const containerCenterY = containerRect.top + containerRect.height / 2;
        centerDistanceFromContainerCenter = Math.abs(centerY - containerCenterY);
        const bandTop    = containerRect.top + containerRect.height * ACTIVE_BAND_LOW;
        const bandBottom = containerRect.top + containerRect.height * ACTIVE_BAND_HIGH;
        centerInActiveBand = centerY >= bandTop && centerY <= bandBottom;
    }

    /** @type {VisibilityMetrics} */
    const metrics = {
        count, domIdx,
        textLength: text.length,
        rect, containerRect,
        opacity:        Number.isFinite(opacity) ? opacity : 0,
        visibility:     style.visibility ?? '',
        display:        style.display    ?? '',
        className,
        centerDistanceFromContainerCenter,
        centerInActiveBand,
        color:           style.color           ?? '',
        backgroundColor: style.backgroundColor ?? '',
    };

    // 4. text vacío
    if (text.length === 0) return { ok: false, reason: 'empty_text', metrics };

    // 5. zero size
    if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { ok: false, reason: 'zero_size', metrics };
    }

    // 6. invisible style
    if (style.display === 'none' || style.visibility === 'hidden') {
        return { ok: false, reason: 'invisible_style', metrics };
    }

    // 7. opacity
    if (!Number.isFinite(opacity) || opacity < minOpacity) {
        return { ok: false, reason: 'opacity_too_low', metrics };
    }

    // 8. outside viewport (no overlap con container)
    if (containerRect) {
        const noOverlap =
            rect.bottom <= containerRect.top ||
            rect.top    >= containerRect.bottom ||
            rect.right  <= containerRect.left ||
            rect.left   >= containerRect.right;
        if (noOverlap) return { ok: false, reason: 'outside_viewport', metrics };

        // 9. outside active band (centro fuera del 5%-95% vertical)
        if (!centerInActiveBand) {
            return { ok: false, reason: 'outside_active_band', metrics };
        }
    }

    // 10. missing active class
    if (requiredClass && !className.split(/\s+/).includes(requiredClass)) {
        return { ok: false, reason: 'missing_active_class', metrics };
    }

    // 11. contrast suspect (heurístico mínimo: color === backgroundColor)
    if (style.color && style.backgroundColor && style.color === style.backgroundColor) {
        return { ok: false, reason: 'contrast_suspect', metrics };
    }

    return { ok: true, metrics };
}

// Export helpers para tests / debug overlay
export const _internals = Object.freeze({
    DEFAULT_REQUIRED_CLASS,
    DEFAULT_MIN_OPACITY,
    ACTIVE_BAND_LOW,
    ACTIVE_BAND_HIGH,
});
