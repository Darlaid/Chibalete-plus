/**
 * epubFixture.mjs — EPUB sintéticos EN MEMORIA para tests (3C.2).
 * Sin binarios versionados ni contenido editorial: textos inventados e
 * "imágenes" que solo tienen la firma del formato (no se decodifican).
 */
import zlib from 'node:zlib';

export function buildZip(files) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of files) {
        const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data ?? '', 'utf8');
        const method = f.method ?? (f.name === 'mimetype' ? 0 : 8);
        const comp = method === 8 ? zlib.deflateRawSync(data) : data;
        const nameBytes = Buffer.from(f.name, 'utf8');
        const crc = zlib.crc32(data) >>> 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
        locals.push(local, nameBytes, comp);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE((3 << 8) | 20, 4); cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(method, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
        cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(nameBytes.length, 28);
        cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); cd.writeUInt32LE(offset, 42);
        centrals.push(cd, nameBytes);
        offset += 30 + nameBytes.length + comp.length;
    }
    const cdBuf = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cdBuf, eocd]);
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

export const xhtml = (body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;

/** Firmas mínimas; `seed` cambia los bytes (y por tanto el sha256). */
export const IMG = {
    png: (seed = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from(`png-${seed}`)]),
    jpeg: (seed = 0) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from(`jpg-${seed}`)]),
    gif: (seed = 0) => Buffer.from(`GIF89a-${seed}`),
    webp: (seed = 0) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from(`WEBP-${seed}`)]),
    svg: () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'),
};

/**
 * docs: { 'Text/c.xhtml': xhtml(...) } en orden de spine.
 * images: { 'Images/a.png': { mediaType, data } } declaradas en el manifest.
 * extra: entradas ZIP adicionales sin declarar ({ name, data }).
 */
export function makeEpub(docs, images = {}, { extra = [], mimetype = 'application/epub+zip' } = {}) {
    const names = Object.keys(docs);
    const items = [
        ...names.map((n, i) => `<item id="d${i}" href="${n}" media-type="application/xhtml+xml"/>`),
        ...Object.entries(images).map(([n, img], i) => `<item id="i${i}" href="${n}" media-type="${img.mediaType}"/>`),
    ].join('');
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">x</dc:identifier><dc:title>Libro</dc:title><dc:language>es</dc:language></metadata>
  <manifest>${items}</manifest>
  <spine>${names.map((_, i) => `<itemref idref="d${i}"/>`).join('')}</spine>
</package>`;
    return buildZip([
        { name: 'mimetype', data: mimetype, method: 0 },
        { name: 'META-INF/container.xml', data: CONTAINER },
        { name: 'OEBPS/content.opf', data: opf },
        ...names.map(n => ({ name: `OEBPS/${n}`, data: docs[n] })),
        ...Object.entries(images).map(([n, img]) => ({ name: `OEBPS/${n}`, data: img.data, method: 0 })),
        ...extra.map(e => ({ ...e, name: e.name })),
    ]);
}
