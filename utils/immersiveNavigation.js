/**
 * immersiveNavigation.js — Bloqueo central de auto-navegación entre libros.
 *
 * Materializa la INVARIANTE 2 de docs/immersive-mode-invariants.md:
 *   "No hay navegación automática entre libros."
 *
 * Toda transición a otro contentId DEBE pasar por assertManualNavigation con
 * una razón explícita de la enumeración whitelisted. Cualquier otra razón:
 *   - en dev/test: lanza error (regresión = test rojo).
 *   - en prod: bloquea, devuelve false, loguea fatal.
 *
 * Esta función es la ÚNICA puerta de salida hacia `navigate('/leer/inmersivo/${id}')`.
 */

/**
 * Razones de navegación manual permitidas. Cualquier otra string aquí causa
 * que la navegación sea rechazada — incluso si el navigate() venía de código
 * con buenas intenciones. INV-2.
 */
export const MANUAL_NAVIGATION_REASONS = Object.freeze([
    'user_click_next',          // banner "Próximo →" del visor inmersivo
    'user_click_book_card',     // tarjeta de libro en Biblioteca / Home
    'user_explicit_navigation', // botón Volver, click en breadcrumb, etc.
]);

/**
 * @param {string} reason
 * @returns {boolean}
 */
export function isAllowedManualNavReason(reason) {
    return MANUAL_NAVIGATION_REASONS.includes(reason);
}

/**
 * Valida si una navegación a otro contentId es legítima. Si fromContentId
 * es igual a toContentId (refresh / mismo libro), siempre se permite. Si
 * difieren, exige reason en MANUAL_NAVIGATION_REASONS.
 *
 * @param {object} params
 * @param {string} params.fromContentId   contentId activo del visor.
 * @param {string} params.toContentId     contentId destino.
 * @param {string} params.reason          Razón declarada de la navegación.
 * @param {string} [params.source]        Etiqueta del call site (para logs).
 * @param {boolean} [params.isDev=false]  Throw en dev para detectar regresión.
 * @returns {{ok: boolean, reason: string}}
 */
export function assertManualNavigation({
    fromContentId,
    toContentId,
    reason,
    source = 'unknown',
    isDev = false,
}) {
    // Navegación al mismo libro: siempre OK (refresh, reload, etc.)
    if (fromContentId && toContentId && fromContentId === toContentId) {
        return { ok: true, reason: 'same_content_id' };
    }
    // Cross-content: exige reason whitelisted
    if (!isAllowedManualNavReason(reason)) {
        const msg = `autonav_blocked source=${source} from=${fromContentId} to=${toContentId} reason=${reason}`;
        if (isDev) throw new Error(`[IMMERSIVE_FATAL_AUTONAV_BLOCKED] ${msg}`);
        return { ok: false, reason: msg };
    }
    return { ok: true, reason };
}
