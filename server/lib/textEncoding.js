/**
 * textEncoding.js — TXT-UTF8-GUARD-01.
 *
 * Validación estricta de archivos de texto: UTF-8 válido o rechazo. Nunca
 * convierte Windows-1252/Latin-1 ni sustituye bytes inválidos por U+FFFD:
 * `fs.readFileSync(p, 'utf8')` lo hace en silencio, y así llegaron los «�» a
 * la sincronización TTS de una obra (docs/ops/IMMERSIVE_UTF8_01.md).
 * Lectura por bloques: no carga el archivo entero para validarlo.
 */
import fs from 'node:fs';

const CHUNK = 64 * 1024;

/**
 * @param {string} filePath
 * @returns {{ ok: true, bytes: number } | { ok: false, code: 'TXT_EMPTY'|'TXT_BINARY'|'TXT_NOT_UTF8', offset?: number }}
 */
export function inspectTextFile(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const buf = Buffer.alloc(CHUNK);
        let offset = 0;
        for (;;) {
            const n = fs.readSync(fd, buf, 0, CHUNK, offset);
            if (n === 0) break;
            const slice = buf.subarray(0, n);
            const nul = slice.indexOf(0);
            if (nul !== -1) return { ok: false, code: 'TXT_BINARY', offset: offset + nul };
            try {
                decoder.decode(slice, { stream: true });
            } catch {
                return { ok: false, code: 'TXT_NOT_UTF8', offset };
            }
            offset += n;
        }
        if (offset === 0) return { ok: false, code: 'TXT_EMPTY' };
        try {
            decoder.decode(); // secuencia multibyte truncada al final del archivo
        } catch {
            return { ok: false, code: 'TXT_NOT_UTF8', offset };
        }
        return { ok: true, bytes: offset };
    } finally {
        fs.closeSync(fd);
    }
}

/** Lee un TXT exigiendo UTF-8 válido. Lanza un Error con `code` = 'TXT_NOT_UTF8' si no lo es. */
export function readUtf8Strict(filePath) {
    const bytes = fs.readFileSync(filePath);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw Object.assign(new Error('El texto no es UTF-8 válido'), { code: 'TXT_NOT_UTF8' });
    }
}

/** Mensajes para el administrador (sin detalles internos). */
export const TEXT_UPLOAD_MESSAGES = Object.freeze({
    TXT_NOT_UTF8: 'El archivo de texto no está en UTF-8. Guárdalo con codificación «UTF-8» (en el Bloc de notas: Guardar como → Codificación: UTF-8) y vuelve a subirlo.',
    TXT_EMPTY: 'El archivo de texto está vacío.',
    TXT_BINARY: 'El contenido real del archivo no coincide con su extensión o contiene código binario no seguro.',
});
