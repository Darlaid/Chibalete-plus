/**
 * imageDimensions.js — CHP-MOOK-COVER-UPLOAD-01A
 *
 * Lectura de ancho/alto de PNG, JPEG y WebP directamente de sus cabeceras.
 *
 * Por qué a mano y no con una librería: el repositorio prohíbe dependencias
 * innecesarias, y las tres únicas familias que acepta el uploader de cubiertas
 * declaran sus dimensiones en los primeros bytes. La superficie es pequeña y
 * conocida; añadir un decodificador completo sería traer un parser de imágenes
 * entero para leer cuatro enteros.
 *
 * Contrato: NUNCA lanza por contenido malformado. Devuelve `null` cuando no
 * puede afirmar las dimensiones — el llamador trata `null` como "rechazar",
 * que es la postura fail-closed correcta para un validador.
 */

/** Firma de los 8 bytes iniciales de todo PNG. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * PNG: el chunk IHDR es obligatoriamente el primero y lleva las dimensiones
 * como dos uint32 big-endian en los offsets 16 y 20.
 */
function pngSize(buf) {
    if (buf.length < 24) return null;
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * JPEG: hay que recorrer los segmentos hasta encontrar un marcador SOF
 * (Start Of Frame), que es el único que declara las dimensiones reales.
 * Se excluyen SOF4/SOF8/SOF12 (0xC4 DHT, 0xC8 JPG, 0xCC DAC): comparten rango
 * pero no son marcos.
 */
function jpegSize(buf) {
    if (buf.length < 4) return null;
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;

    let offset = 2;
    while (offset + 3 < buf.length) {
        if (buf[offset] !== 0xff) return null;          // desincronizado ⇒ malformado
        const marker = buf[offset + 1];

        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;                                 // marcadores sin payload
            continue;
        }
        if (marker === 0xd9 || marker === 0xda) return null;  // EOI o inicio de scan: sin SOF

        const length = buf.readUInt16BE(offset + 2);
        if (length < 2) return null;

        const isSOF = marker >= 0xc0 && marker <= 0xcf
            && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
            if (offset + 9 > buf.length) return null;    // truncado justo en el SOF
            return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
    }
    return null;
}

/**
 * WebP: contenedor RIFF con tres variantes de chunk, cada una con su propio
 * empaquetado de dimensiones.
 *   - VP8  (lossy):    dos uint16 LE, 14 bits útiles cada uno
 *   - VP8L (lossless): 28 bits empaquetados, ancho y alto menos uno
 *   - VP8X (extended): dos uint24 LE, también menos uno
 */
function webpSize(buf) {
    if (buf.length < 30) return null;
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (buf.toString('ascii', 8, 12) !== 'WEBP') return null;

    const chunk = buf.toString('ascii', 12, 16);

    if (chunk === 'VP8 ') {
        if (buf.length < 30) return null;
        return {
            width: buf.readUInt16LE(26) & 0x3fff,
            height: buf.readUInt16LE(28) & 0x3fff,
        };
    }
    if (chunk === 'VP8L') {
        if (buf.length < 25) return null;
        const bits = buf.readUInt32LE(21);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1,
        };
    }
    if (chunk === 'VP8X') {
        if (buf.length < 30) return null;
        const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
        const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
        return { width: w + 1, height: h + 1 };
    }
    return null;
}

/**
 * Devuelve `{ width, height }` o `null` si el buffer no es un PNG/JPEG/WebP
 * legible. No confía en la extensión ni en el MIME declarado: solo en bytes.
 *
 * @param {Buffer} buf Cabecera del archivo (bastan los primeros KB).
 * @returns {{width:number, height:number}|null}
 */
export function readImageDimensions(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
    try {
        const size = pngSize(buf) ?? jpegSize(buf) ?? webpSize(buf);
        if (!size) return null;
        const { width, height } = size;
        if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
        if (width <= 0 || height <= 0) return null;
        return { width, height };
    } catch {
        // Un buffer truncado puede hacer que un read* se salga de rango. Para un
        // validador eso es "no puedo afirmar nada" ⇒ null, nunca una excepción.
        return null;
    }
}
