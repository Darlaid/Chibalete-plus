/**
 * leoAwardTokens.js — CHP-GAMIFICACION-G0-01.
 *
 * Neutraliza el token legacy `[AWARD_POINTS:n]` en las respuestas de Leo.
 *
 * POR QUÉ EXISTE. El prompt de chat instruía al modelo a otorgar «Puntos de
 * Magia» escribiendo `[AWARD_POINTS: n]`; el cliente sumaba cualquier n > 0 a
 * un saldo sin libro de movimientos ni tope en el servidor. La instrucción ya
 * se retiró del prompt, pero el modelo (o un lector que se lo pida) puede
 * volver a producir el token. Este módulo lo borra de la respuesta antes de
 * que salga del servidor, sea cual sea el valor o el espaciado.
 *
 * Solo toca el token de puntos: `[SAVE_VOCAB:…]` e `[INTERACTION_TYPE:…]`
 * son mecanismos legítimos y quedan intactos.
 *
 * Módulo puro: sin I/O ni dependencias.
 */

// Variantes cubiertas: mayúsculas/minúsculas, espacios dentro de los
// corchetes, separador `_`, `-` o espacio, valor arbitrario (negativo,
// decimal, texto, vacío, sin «:»), corchetes escapados en markdown y token
// sin cerrar al final de una línea.
export const AWARD_POINTS_TOKEN_RE = /\\?\[\s*award[\s_-]*points\b[^\]\n]*\\?\]?/gi;

/** Devuelve `text` sin ningún token de puntos. Valores no-string se devuelven tal cual. */
export function stripAwardPointsTokens(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(AWARD_POINTS_TOKEN_RE, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Aplica la limpieza al `answer` de un resultado de handler Leo (`{ answer }`). */
export function sanitizeLeoResult(result) {
    if (!result || typeof result.answer !== 'string') return result;
    return { ...result, answer: stripAwardPointsTokens(result.answer) };
}
