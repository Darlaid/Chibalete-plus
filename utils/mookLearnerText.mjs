/**
 * mookLearnerText.mjs — G4-PILOT-UX-03B-FIX.
 *
 * Textos para lectores de 7 a 11 años en el recorrido MOOK. Módulo puro, sin
 * dependencias: lo usa `pages/Experiencias.tsx` y lo prueban los tests.
 *
 * Regla: el mensaje explica la CAUSA del rechazo con palabras sencillas y dice
 * qué hacer. Nunca la oculta ni la disfraza. El servidor sigue siendo la
 * autoridad: este módulo solo traduce lo que el servidor (o la misma regla de
 * longitud, comprobada antes de enviar) ya decidió.
 */

/** Mismo conteo que el servidor (`countWords` en experienceStore.js). */
export const wordCount = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

const palabras = (n) => `${n} ${n === 1 ? 'palabra' : 'palabras'}`;

/**
 * Explicación de la regla de extensión, o null si el texto la cumple.
 * @param {number} words  palabras escritas
 * @param {number} min
 * @param {number} max
 */
export function lengthMessage(words, min, max) {
    if (words < min) {
        return `Tu texto tiene ${palabras(words)} y necesita al menos ${min}: te ${min - words === 1 ? 'falta' : 'faltan'} ${palabras(min - words)}. Puedes contar más de lo que pasó o explicar mejor tu idea.`;
    }
    if (words > max) {
        return `Tu texto tiene ${palabras(words)} y puede tener como máximo ${max}: ${words - max === 1 ? 'sobra' : 'sobran'} ${palabras(words - max)}. Intenta decirlo de forma más corta.`;
    }
    return null;
}

/** Texto bajo el campo: cuántas palabras lleva y cuánto pide la consigna. */
export function counterText(words, min, max) {
    if (words < min) return `${palabras(words)} · necesitas entre ${min} y ${max}`;
    if (words > max) return `${palabras(words)} · máximo ${max}`;
    return `${palabras(words)} · ¡extensión correcta!`;
}

const CODE_TEXT = Object.freeze({
    ACTIVITY_INCOMPLETE: 'Falta responder alguna pregunta. Escribe algo en cada una antes de enviar.',
    NODE_LOCKED: 'Este paso todavía no está disponible: primero termina los pasos anteriores.',
    INVALID_TRANSITION: 'Esta producción ya no se puede reenviar: tu mediador ya la está revisando o ya la revisó.',
    NOT_RUN_OWNER: 'Solo puedes enviar tus propias producciones.',
    NOT_EVIDENCE_OWNER: 'Solo puedes reenviar tus propias producciones.',
    NODE_NOT_FOUND: 'Este paso ya no existe en la experiencia. Avisa a tu mediador.',
    RUN_NOT_FOUND: 'No encontramos tu recorrido. Vuelve a abrir la experiencia.',
});

/**
 * Mensaje para el lector a partir de la respuesta del servidor.
 * @param {{ code?: string, error?: string }} r  respuesta de dataService
 * @param {{ words?: number, min?: number, max?: number }} [ctx]  para PRODUCTION_LENGTH
 */
export function learnerErrorMessage(r = {}, ctx = {}) {
    const { code, error } = r;
    if (code === 'PRODUCTION_LENGTH' && Number.isFinite(ctx.words) && Number.isFinite(ctx.min) && Number.isFinite(ctx.max)) {
        return lengthMessage(ctx.words, ctx.min, ctx.max) ?? 'La extensión del texto no es la que pide la consigna.';
    }
    if (code && CODE_TEXT[code]) return CODE_TEXT[code];
    if (!code && /sin conexi[oó]n/i.test(String(error ?? ''))) {
        return 'No hay conexión con Chibalete+. Tu texto sigue aquí: intenta enviarlo otra vez en un momento.';
    }
    // Sin traducción conocida: se muestra la causa tal cual, nunca se oculta.
    return error ? `No se pudo enviar: ${error}` : 'No se pudo enviar. Intenta otra vez o avisa a tu mediador.';
}
