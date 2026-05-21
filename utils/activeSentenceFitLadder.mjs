/**
 * activeSentenceFitLadder.mjs — M-5.4.10 / TASK 2 (OVERFLOW ZERO TOLERANCE).
 *
 * Decisión PURA de la escalera de fit de la frase activa. El visor IMPORTA y
 * USA esta función (los tests ejercen el código real).
 *
 * Pipeline determinista y ACOTADO:
 *   normal → long → very-long → emergency → scroll-safe
 *
 * - normal / long / very-long: reducción de tamaño tipográfico (Tailwind).
 * - emergency: reducción extra + leading mínimo.
 * - scroll-safe: ÚLTIMO recurso. NO reduce más el texto; aplica un clamp
 *   de altura = banda segura (arriba de los controles) con overflow-y
 *   interno. Garantiza CERO overlap y CERO texto oculto detrás de controles.
 *
 * Antes: tras very-long se emitía ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED y se
 * RENDÍA dejando texto potencialmente solapado. Eso desaparece: scroll-safe
 * siempre resuelve (el texto queda contenido y legible).
 *
 * PURA: sin DOM, sin I/O, sin timers. Solo decide el próximo tier.
 */

/** Orden canónico de la escalera. */
export const FIT_TIERS = Object.freeze([
    'normal', 'long', 'very-long', 'emergency', 'scroll-safe',
]);

/** scroll-safe es terminal: no hay tier siguiente. */
export const TERMINAL_TIER = 'scroll-safe';

/** Reintentos de reducción tipográfica antes de scroll-safe. */
export const MAX_SHRINK_RETRIES = 3;   // normal→long→very-long→emergency

/**
 * @param {object} p
 * @param {'normal'|'long'|'very-long'|'emergency'|'scroll-safe'} p.currentTier
 * @param {boolean} p.overlapsControls   ¿el rect medido todavía solapa controles?
 * @param {number}  p.retries            reintentos de shrink ya consumidos
 * @returns {{
 *   action: 'settled' | 'downgrade' | 'clamp-final',
 *   nextTier: string,
 *   applyScrollSafeClamp: boolean,
 *   final: boolean,
 *   reason: string,
 * }}
 */
export function decideFitTier(p) {
    const currentTier = (p && p.currentTier) || 'normal';
    const overlaps    = !!(p && p.overlapsControls);
    const retries     = (p && Number.isFinite(p.retries)) ? p.retries : 0;

    // Sin overlap → ya entra: estado final estable (sin clamp).
    if (!overlaps) {
        return {
            action: 'settled',
            nextTier: currentTier,
            applyScrollSafeClamp: currentTier === TERMINAL_TIER,
            final: true,
            reason: currentTier === TERMINAL_TIER
                ? 'fits_within_scroll_safe_band'
                : 'fits_no_overlap',
        };
    }

    // Overlap persiste pero ya estamos en scroll-safe → clamp definitivo.
    // El clamp acota la altura a la banda segura: el texto NO puede quedar
    // detrás de los controles. Esto SIEMPRE resuelve (terminal, sin loop).
    if (currentTier === TERMINAL_TIER) {
        return {
            action: 'clamp-final',
            nextTier: TERMINAL_TIER,
            applyScrollSafeClamp: true,
            final: true,
            reason: 'scroll_safe_clamp_guarantees_no_overlap',
        };
    }

    // Overlap + todavía hay reintentos de shrink → bajar un tier.
    if (retries < MAX_SHRINK_RETRIES) {
        const i = FIT_TIERS.indexOf(currentTier);
        const nextTier = FIT_TIERS[Math.min(i + 1, FIT_TIERS.length - 1)];
        return {
            action: 'downgrade',
            nextTier,
            applyScrollSafeClamp: false,
            final: false,
            reason: `shrink_${currentTier}_to_${nextTier}`,
        };
    }

    // Shrink agotado y todavía overlap → ir directo a scroll-safe (terminal).
    return {
        action: 'downgrade',
        nextTier: TERMINAL_TIER,
        applyScrollSafeClamp: true,
        final: false,   // un render más para aplicar el clamp y medir
        reason: 'shrink_exhausted_engage_scroll_safe',
    };
}
