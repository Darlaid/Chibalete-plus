/**
 * b2cProvisioningSecret.js — acceso file-only al secreto DEDICADO de la integración
 * tienda → Chibalete+ (WEB-REORG P2-C, CHP-B2C-PROVISIONING-01).
 *
 * Mismo contrato que `adminSecret.js`:
 *  - ruta canónica constante dentro del bind mount read-only `/app/secrets`;
 *  - sin argumentos, sin entorno, sin fallback, sin caché (una rotación por `rename(2)`
 *    se ve en la petición siguiente);
 *  - nada se lee en import time.
 *
 * Es un secreto DISTINTO del ADMIN_SECRET: comprometer la tienda no concede
 * administración de la app, y rotarlo no afecta a ninguna otra integración.
 */
import { readSecretFile } from './secretFile.js';

/** Ruta canónica dentro del contenedor. Constante, nunca configurable. */
export const B2C_PROVISIONING_SECRET_PATH = '/app/secrets/b2c_provisioning_secret';

/**
 * @returns {Promise<string>} El secreto normalizado.
 * @throws {import('./secretFile.js').SecretFileError} Fail-closed ante archivo ausente o inválido.
 */
export async function readB2cProvisioningSecret() {
    return readSecretFile(B2C_PROVISIONING_SECRET_PATH);
}
