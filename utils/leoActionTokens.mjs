// @ts-check
/**
 * leoActionTokens.mjs — CHP-GAMIFICACION-G0-01.
 *
 * Contrato del CLIENTE para el token legacy `[AWARD_POINTS:n]` de Leo.
 * Módulo puro: sin React, sin fetch. Lo usa `components/Chatbot.tsx`.
 *
 * El token ya no otorga puntos: el servidor lo borra (`server/leoAwardTokens.js`)
 * y este módulo lo vuelve a borrar en el cliente como segunda barrera, por si
 * una respuesta llega por otra vía. Copia deliberada de la regex del servidor:
 * las réplicas de la API solo montan `server/`, así que no pueden importar `utils/`.
 */

export const AWARD_POINTS_TOKEN_RE = /\\?\[\s*award[\s_-]*points\b[^\]\n]*\\?\]?/gi;

/**
 * Devuelve `text` sin ningún token de puntos.
 * @param {string} text
 * @returns {string}
 */
export function stripAwardPointsTokens(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(AWARD_POINTS_TOKEN_RE, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
