/**
 * secretFile.js — lector estricto de archivos de secreto (file-only, fail-closed).
 *
 * Lector GENÉRICO: recibe una ruta y no conoce ningún secreto concreto. El
 * wrapper con la ruta productiva vive en `adminSecret.js`.
 *
 * Garantías de diseño:
 *  - NUNCA consulta `process.env`. No hay fallback ni ruta configurable por env.
 *  - NUNCA cachea: cada invocación reabre la ruta, de modo que una sustitución
 *    atómica (`rename(2)`) es visible en la lectura siguiente.
 *  - No lee nada en import time.
 *  - Apertura segura: `open(O_RDONLY | O_NOFOLLOW)` y toda la metadata se
 *    obtiene con `FileHandle.stat()` sobre ESE MISMO descriptor. Nunca se usa
 *    el patrón TOCTOU `stat(path)` → `readFile(path)`.
 *  - El descriptor se cierra en `finally` y el Buffer temporal se pone a cero
 *    en `finally`, también cuando la validación posterior lanza.
 *  - Los errores llevan un código funcional estable y jamás contenido, longitud
 *    exacta, hash, prefijo ni sufijo del secreto.
 */
import { constants as fsConstants, promises as fsp } from 'node:fs';
import { zeroizeBuffer } from './zeroizeBuffer.js';

/** Tamaño máximo aceptado en disco. */
export const SECRET_FILE_MAX_BYTES = 4096;
/** Longitud mínima aceptada tras normalizar el terminador final. */
export const SECRET_MIN_BYTES = 32;
/** Modo exacto exigido al archivo (owner read-only, sin grupo ni otros). */
export const SECRET_FILE_MODE = 0o400;

/**
 * Códigos funcionales estables. No describen el contenido, solo el motivo del
 * rechazo, para que puedan aparecer en logs sin filtrar material sensible.
 */
export const SECRET_FILE_ERROR_CODES = Object.freeze({
    FILE_MISSING: 'FILE_MISSING',
    SYMLINK_REJECTED: 'SYMLINK_REJECTED',
    NOT_REGULAR_FILE: 'NOT_REGULAR_FILE',
    INVALID_OWNER: 'INVALID_OWNER',
    INVALID_MODE: 'INVALID_MODE',
    INVALID_LINK_COUNT: 'INVALID_LINK_COUNT',
    EMPTY_SECRET: 'EMPTY_SECRET',
    SECRET_TOO_SHORT: 'SECRET_TOO_SHORT',
    SECRET_TOO_LARGE: 'SECRET_TOO_LARGE',
    INVALID_UTF8: 'INVALID_UTF8',
    INVALID_FORMAT: 'INVALID_FORMAT',
    READ_FAILED: 'READ_FAILED',
});

/**
 * Error tipado. `message` repite el código funcional y nada más.
 *
 * `cause` se define NO enumerable a propósito: así `JSON.stringify(err)` y los
 * serializadores de logs no arrastran el error nativo (que puede incluir la
 * ruta o detalles del filesystem).
 */
export class SecretFileError extends Error {
    constructor(code, cause) {
        super(code);
        this.name = 'SecretFileError';
        this.code = code;
        Object.defineProperty(this, 'cause', {
            value: cause,
            enumerable: false,
            writable: false,
            configurable: false,
        });
    }
}

const fail = (code, cause) => {
    throw new SecretFileError(code, cause);
};

/**
 * Traduce el errno de `open()` a un código funcional.
 * ELOOP es lo que devuelve el kernel cuando O_NOFOLLOW topa con un symlink.
 */
function mapOpenError(err) {
    switch (err?.code) {
        case 'ENOENT':
            return SECRET_FILE_ERROR_CODES.FILE_MISSING;
        case 'ELOOP':
            return SECRET_FILE_ERROR_CODES.SYMLINK_REJECTED;
        case 'EISDIR':
            return SECRET_FILE_ERROR_CODES.NOT_REGULAR_FILE;
        default:
            return SECRET_FILE_ERROR_CODES.READ_FAILED;
    }
}

/**
 * Sólo se acepta ASCII visible (0x21–0x7E). Eso excluye de un plumazo espacios,
 * tabs, saltos internos, NUL y cualquier control, sin necesidad de listarlos.
 */
function isVisibleAscii(value) {
    for (let i = 0; i < value.length; i += 1) {
        const cp = value.charCodeAt(i);
        if (cp < 0x21 || cp > 0x7e) return false;
    }
    return true;
}

/**
 * Lee y valida un archivo de secreto.
 *
 * @param {string} filePath Ruta absoluta al archivo.
 * @returns {Promise<string>} El secreto normalizado.
 * @throws {SecretFileError}
 */
export async function readSecretFile(filePath) {
    if (typeof fsConstants.O_NOFOLLOW !== 'number' || typeof process.getuid !== 'function') {
        // Plataforma sin semántica POSIX: fail-closed, nunca degradar la apertura.
        fail(SECRET_FILE_ERROR_CODES.READ_FAILED);
    }

    let handle = null;
    let buffer = null;
    try {
        try {
            handle = await fsp.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        } catch (err) {
            fail(mapOpenError(err), err);
        }

        // Toda la metadata sale del descriptor ya abierto (sin TOCTOU).
        const st = await handle.stat();

        if (!st.isFile()) fail(SECRET_FILE_ERROR_CODES.NOT_REGULAR_FILE);
        if (st.uid !== process.getuid() || st.gid !== process.getgid()) {
            fail(SECRET_FILE_ERROR_CODES.INVALID_OWNER);
        }
        if ((st.mode & 0o7777) !== SECRET_FILE_MODE) fail(SECRET_FILE_ERROR_CODES.INVALID_MODE);
        if (st.nlink !== 1) fail(SECRET_FILE_ERROR_CODES.INVALID_LINK_COUNT);
        if (st.size > SECRET_FILE_MAX_BYTES) fail(SECRET_FILE_ERROR_CODES.SECRET_TOO_LARGE);
        if (st.size === 0) fail(SECRET_FILE_ERROR_CODES.EMPTY_SECRET);

        buffer = Buffer.alloc(st.size);

        let bytesRead;
        try {
            ({ bytesRead } = await handle.read(buffer, 0, st.size, 0));
        } catch (err) {
            fail(SECRET_FILE_ERROR_CODES.READ_FAILED, err);
        }
        // Revalidación del tamaño ya leído, no sólo del anunciado por stat().
        if (bytesRead !== st.size) fail(SECRET_FILE_ERROR_CODES.READ_FAILED);
        if (bytesRead > SECRET_FILE_MAX_BYTES) fail(SECRET_FILE_ERROR_CODES.SECRET_TOO_LARGE);

        let decoded;
        try {
            decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (err) {
            fail(SECRET_FILE_ERROR_CODES.INVALID_UTF8, err);
        }

        // Se tolera exactamente UN terminador final: ninguno, un LF o un CRLF.
        let value = decoded;
        if (value.endsWith('\r\n')) value = value.slice(0, -2);
        else if (value.endsWith('\n')) value = value.slice(0, -1);

        if (value.length === 0) fail(SECRET_FILE_ERROR_CODES.EMPTY_SECRET);
        // Un segundo terminador (o un CR suelto) ya no es admisible.
        if (!isVisibleAscii(value)) fail(SECRET_FILE_ERROR_CODES.INVALID_FORMAT);
        if (Buffer.byteLength(value, 'utf8') < SECRET_MIN_BYTES) {
            fail(SECRET_FILE_ERROR_CODES.SECRET_TOO_SHORT);
        }

        return value;
    } finally {
        // Zeroización y cierre son independientes: un fallo al cerrar no puede
        // impedir borrar el Buffer, ni al revés. Cada uno en su propio try.
        try {
            zeroizeBuffer(buffer);
        } catch {
            // El borrado nunca debe propagar ni enmascarar el error original.
        }
        if (handle) {
            try {
                await handle.close();
            } catch {
                // El cierre no puede enmascarar el error original ni filtrar nada.
            }
        }
    }
}
