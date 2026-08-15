/**
 * sessionSigningKey.js — CHP-IDDB-M1-A-SESSION-IDENTITY-01.
 *
 * Claves de firma de sesión file-only (mismo modelo endurecido que
 * admin_secret): NUNCA en .env versionado, leídas del bind mount `/app/secrets`.
 *
 *  - `current` (obligatoria): se firma SIEMPRE con ella.
 *  - `previous` (opcional): solo para VERIFICAR durante la ventana de gracia de
 *    rotación (≤ vida máxima de sesión, 12 h). Ausente ⇒ solo se acepta current.
 *
 * Sin caché: cada lectura reabre el archivo (rotación por rename visible al
 * instante). Ausencia/invalidez de la clave current ⇒ fail-closed (lanza) — el
 * caller lo traduce a "no se puede emitir/verificar sesión", nunca a x-user-id.
 */
import { readSecretFile, SecretFileError } from './secretFile.js';

export const SESSION_KEY_CURRENT_PATH  = '/app/secrets/session_signing_key';
export const SESSION_KEY_PREVIOUS_PATH = '/app/secrets/session_signing_key.previous';

/** Permite override hermético en tests (jamás se toma de env en producción). */
function paths() {
    return {
        current:  process.env.SESSION_KEY_CURRENT_PATH  || SESSION_KEY_CURRENT_PATH,
        previous: process.env.SESSION_KEY_PREVIOUS_PATH || SESSION_KEY_PREVIOUS_PATH,
    };
}

/**
 * Clave con la que se FIRMA (current). Fail-closed si no está disponible.
 * @returns {Promise<string>}
 */
export async function readCurrentSigningKey() {
    return readSecretFile(paths().current);
}

/**
 * Todas las claves aceptadas para VERIFICAR (current + previous si existe).
 * Nunca lanza por ausencia de previous; sí propaga si current falla.
 * @returns {Promise<string[]>}
 */
export async function readVerificationKeys() {
    const { previous } = paths();
    const current = await readCurrentSigningKey();
    const keys = [current];
    try {
        const prev = await readSecretFile(previous);
        if (prev && prev !== current) keys.push(prev);
    } catch (e) {
        // Ausencia/invalidez de previous NO es error: rotación sin clave anterior.
        if (!(e instanceof SecretFileError)) throw e;
    }
    return keys;
}
