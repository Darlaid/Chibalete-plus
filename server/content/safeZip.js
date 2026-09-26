/**
 * safeZip.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 3A.
 *
 * Lector ZIP mínimo para EPUB sobre node:zlib (sin dependencias). Puro:
 * Buffer → índice de entradas → bytes de una entrada. Sin filesystem.
 *
 * Contrato de seguridad (todo lo no contemplado se RECHAZA):
 *   - solo métodos 0 (stored) y 8 (deflate); sin cifrado, sin ZIP64, un disco;
 *   - EOCD exacto al final del archivo; directorio central completo y coherente
 *     con las cabeceras locales (nombre y método); datos sin solapes;
 *   - nombres: UTF-8 válido (bit 11) o ASCII; sin '\', NUL, rutas absolutas,
 *     letras de unidad, segmentos '.'/'..' ni segmentos vacíos;
 *   - sin symlinks ni tipos especiales (host Unix: solo regular/directorio);
 *   - sin duplicados, tampoco ambiguos por mayúsculas o forma Unicode;
 *   - límites: tamaño del EPUB, nº de entradas, tamaño declarado por entrada y
 *     total, ratio de compresión, y presupuesto de bytes realmente extraídos;
 *   - al extraer: inflado acotado (maxOutputLength), tamaño exacto y CRC32.
 */
import zlib from 'zlib';
import { CanonicalBookError } from './canonicalBook.js';

const MiB = 1024 * 1024;
export const ZIP_LIMITS = Object.freeze({
    maxArchiveBytes: 64 * MiB,          // EPUB comprimido
    maxEntries: 2000,
    maxEntryBytes: 16 * MiB,            // descomprimido, por entrada
    maxTotalDeclaredBytes: 512 * MiB,   // suma declarada de todas las entradas
    maxExtractedBytes: 64 * MiB,        // suma realmente inflada (solo lo que se lee)
    maxCompressionRatio: 200,           // aplicado a entradas > ratioFloorBytes
    ratioFloorBytes: 1 * MiB,
});

const SIG_EOCD = 0x06054b50, SIG_CD = 0x02014b50, SIG_LOCAL = 0x04034b50, SIG_ZIP64_LOCATOR = 0x07064b50;
const fail = (code, message) => { throw new CanonicalBookError(code, message); };

/** Valida un nombre de entrada ZIP; devuelve el nombre normalizado (sin '/' final). */
export function validateEntryName(name) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 1024) fail('ZIP_BAD_NAME', 'nombre de entrada inválido');
    if (/[\u0000-\u001F\u007F\\]/.test(name)) fail('ZIP_BAD_NAME', 'carácter no permitido en nombre de entrada');
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) fail('ZIP_ABSOLUTE_PATH', 'ruta absoluta en entrada ZIP');
    const bare = name.endsWith('/') ? name.slice(0, -1) : name;
    for (const seg of bare.split('/')) {
        if (seg === '..' || seg === '.') fail('ZIP_TRAVERSAL', 'segmento de traversal en entrada ZIP');
        if (seg === '') fail('ZIP_BAD_NAME', 'segmento vacío en entrada ZIP');
    }
    return bare;
}

function decodeName(bytes, utf8Flag) {
    if (utf8Flag) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { fail('ZIP_BAD_NAME', 'nombre UTF-8 inválido'); }
    }
    for (const b of bytes) if (b >= 0x80) fail('ZIP_BAD_NAME', 'nombre no ASCII sin marca UTF-8');
    return bytes.toString('latin1');
}

/**
 * Índice del ZIP. Devuelve { entries: Map<nombre, entrada>, read(nombre) }.
 * `read` extrae con todos los controles y descuenta del presupuesto.
 */
export function openZip(buffer, limits = {}) {
    const L = { ...ZIP_LIMITS, ...limits };
    if (!Buffer.isBuffer(buffer)) {
        if (buffer instanceof Uint8Array) buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        else fail('ZIP_INVALID_INPUT', 'se esperaba un Buffer');
    }
    if (buffer.length < 22) fail('ZIP_TRUNCATED', 'archivo demasiado corto');
    if (buffer.length > L.maxArchiveBytes) fail('ZIP_TOO_LARGE', 'EPUB supera el tamaño máximo');

    // EOCD: la única firma cuyo comentario termina exactamente al final.
    let eocd = -1;
    for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 22 - 0xFFFF); p--) {
        if (buffer.readUInt32LE(p) === SIG_EOCD && p + 22 + buffer.readUInt16LE(p + 20) === buffer.length) { eocd = p; break; }
    }
    if (eocd < 0) fail('ZIP_NO_EOCD', 'no es un ZIP válido');
    if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) fail('ZIP_UNSUPPORTED', 'ZIP64 no soportado');
    const disk = buffer.readUInt16LE(eocd + 4), cdDisk = buffer.readUInt16LE(eocd + 6);
    const onDisk = buffer.readUInt16LE(eocd + 8), total = buffer.readUInt16LE(eocd + 10);
    const cdSize = buffer.readUInt32LE(eocd + 12), cdOffset = buffer.readUInt32LE(eocd + 16);
    if (disk !== 0 || cdDisk !== 0 || onDisk !== total) fail('ZIP_UNSUPPORTED', 'ZIP multidisco no soportado');
    if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) fail('ZIP_UNSUPPORTED', 'ZIP64 no soportado');
    if (total > L.maxEntries) fail('ZIP_TOO_MANY_ENTRIES', 'demasiadas entradas');
    if (cdOffset + cdSize > eocd) fail('ZIP_CORRUPT', 'directorio central fuera de rango');

    const entries = new Map();
    const seenFolded = new Set();
    const ranges = [];
    let declaredTotal = 0;
    let p = cdOffset;
    for (let k = 0; k < total; k++) {
        if (p + 46 > cdOffset + cdSize || buffer.readUInt32LE(p) !== SIG_CD) fail('ZIP_CORRUPT', 'directorio central corrupto');
        const madeBy = buffer.readUInt16LE(p + 4);
        const flags = buffer.readUInt16LE(p + 8);
        const method = buffer.readUInt16LE(p + 10);
        const crc = buffer.readUInt32LE(p + 16);
        const compSize = buffer.readUInt32LE(p + 20);
        const size = buffer.readUInt32LE(p + 24);
        const nlen = buffer.readUInt16LE(p + 28), elen = buffer.readUInt16LE(p + 30), clen = buffer.readUInt16LE(p + 32);
        const diskStart = buffer.readUInt16LE(p + 34);
        const extAttr = buffer.readUInt32LE(p + 38);
        const localOffset = buffer.readUInt32LE(p + 42);
        const next = p + 46 + nlen + elen + clen;
        if (next > cdOffset + cdSize) fail('ZIP_CORRUPT', 'directorio central corrupto');
        const nameBytes = buffer.subarray(p + 46, p + 46 + nlen);
        p = next;

        if (flags & 0x0041) fail('ZIP_ENCRYPTED', 'entrada cifrada');
        if (method !== 0 && method !== 8) fail('ZIP_UNSUPPORTED', 'método de compresión no soportado');
        if (diskStart !== 0) fail('ZIP_UNSUPPORTED', 'ZIP multidisco no soportado');
        if (compSize === 0xFFFFFFFF || size === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) fail('ZIP_UNSUPPORTED', 'ZIP64 no soportado');
        if (method === 0 && compSize !== size) fail('ZIP_CORRUPT', 'tamaños incoherentes en entrada stored');

        const rawName = decodeName(nameBytes, (flags & 0x0800) !== 0);
        const isDir = rawName.endsWith('/');
        const name = validateEntryName(rawName);
        if ((madeBy >> 8) === 3) {
            const type = (extAttr >>> 16) & 0o170000;
            if (type === 0o120000) fail('ZIP_SYMLINK', 'symlink en ZIP');
            if (type !== 0 && type !== 0o100000 && type !== 0o040000) fail('ZIP_SPECIAL_ENTRY', 'entrada ZIP no regular');
            if (type === 0o040000 && !isDir) fail('ZIP_SPECIAL_ENTRY', 'directorio sin "/" final');
        }
        const folded = name.normalize('NFC').toLowerCase();
        if (seenFolded.has(folded)) fail('ZIP_DUPLICATE_ENTRY', 'entrada duplicada o ambigua');
        seenFolded.add(folded);

        if (size > L.maxEntryBytes) fail('ZIP_ENTRY_TOO_LARGE', 'entrada supera el tamaño máximo');
        if (size > L.ratioFloorBytes && size / Math.max(compSize, 1) > L.maxCompressionRatio) fail('ZIP_RATIO', 'ratio de compresión anómalo');
        declaredTotal += size;
        if (declaredTotal > L.maxTotalDeclaredBytes) fail('ZIP_TOO_LARGE', 'tamaño descomprimido total excesivo');

        // Cabecera local coherente con el directorio central.
        if (localOffset + 30 > cdOffset || buffer.readUInt32LE(localOffset) !== SIG_LOCAL) fail('ZIP_CORRUPT', 'cabecera local inválida');
        const lMethod = buffer.readUInt16LE(localOffset + 8);
        const lnlen = buffer.readUInt16LE(localOffset + 26), lelen = buffer.readUInt16LE(localOffset + 28);
        if (lMethod !== method || lnlen !== nlen || !buffer.subarray(localOffset + 30, localOffset + 30 + lnlen).equals(nameBytes)) {
            fail('ZIP_CORRUPT', 'cabecera local no coincide con el directorio central');
        }
        const dataStart = localOffset + 30 + lnlen + lelen;
        const dataEnd = dataStart + compSize;
        if (dataEnd > cdOffset) fail('ZIP_CORRUPT', 'datos fuera de rango');
        ranges.push([localOffset, dataEnd]);
        if (!isDir) entries.set(name, { name, method, crc, compSize, size, dataStart });
    }
    if (p !== cdOffset + cdSize) fail('ZIP_CORRUPT', 'tamaño de directorio central incoherente');
    ranges.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < ranges.length; k++) {
        if (ranges[k][0] < ranges[k - 1][1]) fail('ZIP_OVERLAP', 'entradas solapadas');
    }

    let extracted = 0;
    const read = (name) => {
        const e = entries.get(name);
        if (!e) fail('ZIP_MISSING_ENTRY', `falta la entrada ${name}`);
        if (extracted + e.size > L.maxExtractedBytes) fail('ZIP_EXTRACT_BUDGET', 'presupuesto de extracción agotado');
        const data = buffer.subarray(e.dataStart, e.dataStart + e.compSize);
        let out;
        if (e.method === 0) {
            out = Buffer.from(data);
        } else {
            try { out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(e.size, 1) }); }
            catch { fail('ZIP_INFLATE', 'datos comprimidos inválidos o mayores que lo declarado'); }
        }
        if (out.length !== e.size) fail('ZIP_SIZE_MISMATCH', 'tamaño extraído distinto del declarado');
        if ((zlib.crc32(out) >>> 0) !== e.crc) fail('ZIP_CRC', 'CRC32 no coincide');
        extracted += out.length;
        return out;
    };
    return { entries, read };
}
