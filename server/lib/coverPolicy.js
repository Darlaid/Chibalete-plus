/**
 * coverPolicy.js — CHP-MOOK-COVER-UPLOAD-01A
 *
 * Validación de servidor para la cubierta de una Experience.
 *
 * Los números viven en `coverContract.js` (sin dependencias de Node) para que
 * el Studio valide contra exactamente los mismos valores. Aquí se añade lo que
 * solo el backend puede hacer: mirar los bytes reales del archivo.
 *
 * La validación de frontend es cortesía —evita subir 5 MB para nada—; la que
 * manda es esta, ejecutada sobre el archivo ya escrito en disco.
 */

import { readImageDimensions } from './imageDimensions.js';
import {
    COVER_ALLOWED_MIME,
    COVER_UPLOAD_MAX_BYTES,
    checkCoverDimensions,
} from '../../utils/coverContract.js';

// Re-exportados para que los consumidores de backend tengan una sola puerta.
export {
    COVER_RECOMMENDED, COVER_MIN, COVER_RATIO, COVER_RATIO_TOLERANCE,
    COVER_SOURCE_MAX_BYTES, COVER_UPLOAD_MAX_BYTES, COVER_TARGET, COVER_TARGET_BYTES,
    COVER_QUALITY_LADDER, COVER_MAX_PIXELS, COVER_ALLOWED_MIME, COVER_HELP_TEXT,
    checkCoverDimensions,
} from '../../utils/coverContract.js';

/** Extensión canónica por MIME real. El nombre original nunca decide la extensión. */
const EXT_BY_MIME = Object.freeze({
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
});

export function extensionForMime(mime) {
    return EXT_BY_MIME[mime] ?? null;
}

/**
 * Valida una cubierta candidata a partir de sus bytes.
 *
 * @param {object} input
 * @param {Buffer} input.buffer  Cabecera del archivo (los primeros KB bastan).
 * @param {string|null} input.mime  MIME REAL, detectado por magic bytes.
 * @param {number} input.size  Tamaño en bytes del archivo completo.
 * @returns {{ok: true, width: number, height: number, mime: string}
 *          | {ok: false, code: string, error: string}}
 */
export function validateCover({ buffer, mime, size }) {
    if (!COVER_ALLOWED_MIME.includes(mime)) {
        return {
            ok: false,
            code: 'MIME_NOT_ALLOWED',
            error: 'El archivo no es una imagen JPG, PNG o WebP. '
                + 'Comprueba que no hayas renombrado otro tipo de archivo.',
        };
    }

    if (!Number.isFinite(size) || size <= 0) {
        return { ok: false, code: 'EMPTY_FILE', error: 'El archivo está vacío.' };
    }

    if (size > COVER_UPLOAD_MAX_BYTES) {
        const mb = (size / (1024 * 1024)).toFixed(1);
        return {
            ok: false,
            code: 'TOO_LARGE',
            error: `La imagen pesa ${mb} MB y el máximo es 5 MB. Guárdala con más compresión.`,
        };
    }

    const dims = readImageDimensions(buffer);
    if (!dims) {
        return {
            ok: false,
            code: 'UNREADABLE',
            error: 'No se pudieron leer las dimensiones de la imagen. '
                + 'Puede estar corrupta o incompleta.',
        };
    }

    const verdict = checkCoverDimensions(dims.width, dims.height);
    if (!verdict.ok) return verdict;

    return { ok: true, width: dims.width, height: dims.height, mime };
}
