/**
 * adminSecretRequest.js — gateway único de validación del header administrativo.
 *
 * Envuelve al helper file-only `readAdminSecret()` (validado en FILE-01A-R2) con
 * la semántica exacta que necesitan los consumidores de `server.js`:
 *
 *  - Sólo se lee el archivo cuando hay un candidato `x-admin-secret` real. Sin
 *    candidato NO se toca el disco (FILE-01B FASE 1.8).
 *  - Cualquier error del helper (archivo ausente, inseguro, inválido) se captura
 *    y se traduce a `false`: la ausencia/invalidez del archivo se comporta como
 *    credencial administrativa inválida, sin filtrar la causa interna al cliente
 *    (FASE 1.2 / 1.6). Nunca se distingue "archivo ausente" de "secreto erróneo"
 *    a nivel de respuesta.
 *  - No hay caché: cada evaluación con candidato reabre la ruta canónica, de modo
 *    que una rotación por `rename(2)` es visible en la siguiente petición.
 *  - No se registra ni el secreto leído ni el valor presentado.
 *
 * SEC-08 (comparación de tiempo constante) queda deliberadamente fuera: se
 * conserva la igualdad estricta `===` que ya usaban los consumidores.
 */
import { readAdminSecret } from './adminSecret.js';

/**
 * Normaliza el header `x-admin-secret` a un string candidato o null.
 * Rechaza ausente, vacío, array o cualquier tipo inesperado.
 *
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function candidateHeader(req) {
    const raw = req?.headers?.['x-admin-secret'];
    if (typeof raw !== 'string') return null; // ausente, array, undefined, número…
    if (raw.length === 0) return null;
    return raw;
}

/**
 * True si la request presenta un `x-admin-secret` que coincide con el secreto
 * leído del archivo canónico. Fail-closed en todo lo demás.
 *
 * @param {import('express').Request} req
 * @returns {Promise<boolean>}
 */
export async function headerMatchesAdminSecret(req) {
    const presented = candidateHeader(req);
    if (presented === null) return false; // sin candidato → no se lee el archivo

    let secret;
    try {
        secret = await readAdminSecret();
    } catch {
        return false; // archivo ausente/inseguro/inválido → credencial inválida
    }

    return presented === secret;
}
