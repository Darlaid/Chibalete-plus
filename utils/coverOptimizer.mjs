/**
 * coverOptimizer.mjs — CHP-MOOK-COVER-UPLOAD-01A-R1
 *
 * Deriva la cubierta que se sube, a partir del original que elige el operador.
 *
 * Por qué existe: un original editorial pesa lo que pesa —el arte de
 * «¿Estás aquí?» son 6,7 MB a 3334 × 1875— y hacer que alguien lo recomprima a
 * mano fuera del sistema convertía un límite técnico en trabajo humano. El
 * Studio lo hace solo: decodifica, redibuja a 1600 × 900 y codifica.
 *
 * **El archivo original NUNCA se modifica.** Se lee, se decodifica en memoria y
 * se descarta. Lo que viaja al backend es un Blob nuevo.
 *
 * Está en `.mjs` y no en `.ts` a propósito: así las pruebas de Node pueden
 * ejercitar la lógica sin un navegador. Las primitivas que solo existen en el
 * navegador —decodificar, redibujar, codificar— se inyectan, de modo que los
 * tests prueban la ESCALERA DE DECISIÓN y el navegador prueba los píxeles.
 */

import {
    COVER_ALLOWED_MIME,
    COVER_SOURCE_MAX_BYTES,
    COVER_UPLOAD_MAX_BYTES,
    COVER_TARGET,
    COVER_QUALITY_LADDER,
    checkCoverDimensions,
} from './coverContract.js';

/** Códigos estables; la UI decide cómo se muestran. */
export const OPTIMIZE_ERROR = Object.freeze({
    MIME_NOT_ALLOWED: 'MIME_NOT_ALLOWED',
    SOURCE_TOO_LARGE: 'SOURCE_TOO_LARGE',
    DECODE_FAILED: 'DECODE_FAILED',
    ENCODE_FAILED: 'ENCODE_FAILED',
    STILL_TOO_LARGE: 'STILL_TOO_LARGE',
});

const MB = (n) => (n / (1024 * 1024)).toFixed(1);

/**
 * @typedef {object} OptimizeDeps
 * @property {(file:Blob)=>Promise<{width:number,height:number}|null>} decodeSize
 *   Devuelve las dimensiones reales del original, o `null` si no se puede decodificar.
 * @property {(file:Blob, opts:{width:number,height:number,type:string,quality:number})=>Promise<Blob|null>} render
 *   Redibuja el original al tamaño pedido y lo codifica. `null` si el códec falla.
 * @property {()=>boolean} supportsWebp
 */

/**
 * @param {{size:number,type:string}} file  El archivo elegido por el operador.
 * @param {OptimizeDeps} deps
 * @returns {Promise<{ok:true, blob:Blob, type:string, quality:number,
 *                    sourceBytes:number, outputBytes:number,
 *                    width:number, height:number, sourceSize:{width:number,height:number}}
 *                  | {ok:false, code:string, error:string}>}
 */
export async function optimizeCover(file, deps) {
    if (!COVER_ALLOWED_MIME.includes(file.type)) {
        return {
            ok: false,
            code: OPTIMIZE_ERROR.MIME_NOT_ALLOWED,
            error: 'El archivo no es una imagen JPG, PNG o WebP.',
        };
    }

    // El tope de SELECCIÓN, no el de transmisión. Se comprueba antes de
    // decodificar: no tiene sentido gastar memoria en algo que se va a rechazar.
    if (file.size > COVER_SOURCE_MAX_BYTES) {
        return {
            ok: false,
            code: OPTIMIZE_ERROR.SOURCE_TOO_LARGE,
            // El número se DERIVA de la constante. Escribirlo a mano hacía que
            // el mensaje mintiera en cuanto el tope cambiaba, que es justo lo
            // que pasó al pasar de 20 a 50 MiB.
            error: `La imagen pesa ${MB(file.size)} MB y el máximo que se puede `
                + `seleccionar es ${Math.round(COVER_SOURCE_MAX_BYTES / (1024 * 1024))} MB.`,
        };
    }

    const size = await deps.decodeSize(file);
    if (!size) {
        return {
            ok: false,
            code: OPTIMIZE_ERROR.DECODE_FAILED,
            error: 'No se pudo leer la imagen. Puede estar corrupta o incompleta.',
        };
    }

    // Ratio y mínimo se juzgan sobre el ORIGINAL. Redibujar a 1600 × 900 haría
    // pasar por válida cualquier proporción, así que la comprobación tiene que
    // ocurrir antes: es la diferencia entre optimizar y deformar en silencio.
    const dims = checkCoverDimensions(size.width, size.height);
    if (!dims.ok) return { ok: false, code: dims.code, error: dims.error };

    const type = deps.supportsWebp() ? 'image/webp' : 'image/jpeg';

    // Escalera fija y en orden: sin búsqueda binaria, para que la misma imagen
    // produzca siempre exactamente el mismo archivo.
    for (const quality of COVER_QUALITY_LADDER) {
        const blob = await deps.render(file, {
            width: COVER_TARGET.width, height: COVER_TARGET.height, type, quality,
        });
        if (!blob) {
            return {
                ok: false,
                code: OPTIMIZE_ERROR.ENCODE_FAILED,
                error: 'No se pudo procesar la imagen en este navegador.',
            };
        }
        if (blob.size <= COVER_UPLOAD_MAX_BYTES) {
            return {
                ok: true, blob, type, quality,
                sourceBytes: file.size, outputBytes: blob.size,
                width: COVER_TARGET.width, height: COVER_TARGET.height,
                sourceSize: size,
            };
        }
    }

    // Sucede solo con originales patológicos. Se avisa y NO se envía: subir algo
    // que el servidor rechazaría sería gastar la red del operador para nada.
    return {
        ok: false,
        code: OPTIMIZE_ERROR.STILL_TOO_LARGE,
        error: 'La imagen no pudo reducirse por debajo de 5 MB. Prueba con una versión menos pesada.',
    };
}

/**
 * Primitivas reales del navegador. Se construyen aparte para que
 * `optimizeCover` no dependa del DOM y siga siendo testeable en Node.
 *
 * `createImageBitmap` decodifica fuera del hilo principal y no toca el archivo
 * en disco: recibe el Blob que el input entregó, en memoria.
 */
export function browserDeps() {
    return {
        async decodeSize(file) {
            try {
                const bmp = await createImageBitmap(file);
                const out = { width: bmp.width, height: bmp.height };
                bmp.close?.();
                return out;
            } catch { return null; }
        },

        async render(file, { width, height, type, quality }) {
            let bmp;
            try { bmp = await createImageBitmap(file); } catch { return null; }
            try {
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bmp, 0, 0, width, height);
                const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
                // `toBlob` ignora en silencio un tipo no soportado y devuelve PNG.
                // Si eso pasa, es un fallo de códec y hay que tratarlo como tal.
                if (!blob || (blob.type && blob.type !== type)) return null;
                return blob;
            } catch {
                return null;
            } finally {
                bmp.close?.();
            }
        },

        supportsWebp() {
            try {
                const c = document.createElement('canvas');
                c.width = 1; c.height = 1;
                return c.toDataURL('image/webp').startsWith('data:image/webp');
            } catch { return false; }
        },
    };
}
