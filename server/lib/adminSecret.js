/**
 * adminSecret.js — acceso file-only al ADMIN_SECRET productivo.
 *
 * Wrapper delgado sobre el lector estricto de `secretFile.js`, con la ruta
 * canónica fijada como constante del módulo.
 *
 * Contrato deliberadamente cerrado:
 *  - `readAdminSecret()` no acepta argumentos: un consumidor no puede inyectar
 *    otra ruta.
 *  - La ruta NO se toma del entorno (ni de variables tipo *_FILE ni de nada
 *    equivalente) y NO existe fallback al secreto del entorno.
 *  - No hay caché: cada llamada reabre el archivo, de modo que una rotación por
 *    `rename(2)` atómico se ve en la siguiente petición sin reiniciar el proceso.
 *  - No se lee nada en import time: importar este módulo con el archivo ausente
 *    es inocuo.
 *
 * El archivo vive en el bind mount read-only `/app/secrets` instalado por
 * CHP-SEC-ADMIN-NETMOUNT-01C. Debe pertenecer al UID/GID efectivos del proceso
 * y tener modo 0400.
 *
 * INTEGRACIÓN (FILE-01B): los consumidores de server.js validan el header
 * administrativo exclusivamente a través de este módulo (vía el gateway
 * `headerMatchesAdminSecret`). No queda ninguna lectura del secreto desde el
 * entorno.
 */
import { readSecretFile } from './secretFile.js';

/** Ruta canónica dentro del contenedor. Constante, nunca configurable. */
export const ADMIN_SECRET_PATH = '/app/secrets/admin_secret';

/**
 * Lee el ADMIN_SECRET desde la ruta canónica.
 *
 * @returns {Promise<string>} El secreto normalizado.
 * @throws {import('./secretFile.js').SecretFileError} Fail-closed ante archivo
 *         ausente, inseguro o con contenido inválido.
 */
export async function readAdminSecret() {
    return readSecretFile(ADMIN_SECRET_PATH);
}
