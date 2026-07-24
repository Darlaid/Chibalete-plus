/**
 * zeroizeBuffer.js — primitiva mínima de borrado seguro de un Buffer.
 *
 * Existe para que la garantía de zeroización sea comprobable SIN exponer el
 * Buffer interno de `readSecretFile`. Deliberadamente austera:
 *  - recibe únicamente un Buffer aportado por su propio caller;
 *  - no recibe rutas, descriptores, strings ni callbacks;
 *  - no devuelve ni expone el contenido;
 *  - no permite observar ningún Buffer interno de otro módulo.
 *
 * El lector la usa sobre su propio Buffer local; una prueba la ejerce sobre un
 * Buffer sintético. Ninguna de las dos vías filtra material a la otra.
 */

/**
 * Sobrescribe por completo el Buffer recibido con ceros. No-op silencioso si el
 * argumento no es un Buffer (para no enmascarar errores en un bloque finally).
 *
 * @param {Buffer} buffer
 * @returns {void}
 */
export function zeroizeBuffer(buffer) {
    if (Buffer.isBuffer(buffer)) buffer.fill(0);
}
