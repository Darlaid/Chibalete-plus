/**
 * canonicalBookEpub.test.mjs — CHP-CONTENT-CANONICAL-2026-01 PARTE 3A.
 *
 * EPUB → CanonicalBook v1 (server/content/epubImporter.js + safeZip.js +
 * strictXml.js). Los fixtures E1–E20 se construyen EN MEMORIA con un escritor
 * ZIP determinista de este archivo (sin binarios versionados, sin red, sin
 * disco). Pureza: se espían red, filesystem, reloj y aleatoriedad durante la
 * importación.
 *
 *   node server/__test__/canonicalBookEpub.test.mjs
 */
import './helpers/testMode.mjs';
import zlib from 'node:zlib';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';

const { importEpubToCanonicalBook, parseEpubArchive, resolvePackageHref } = await import('../content/epubImporter.js');
const { openZip, ZIP_LIMITS } = await import('../content/safeZip.js');
const { parseStrictXml } = await import('../content/strictXml.js');
const { validateCanonicalBook } = await import('../content/canonicalBook.js');
const { renderCanonicalBookToPlainText: render } = await import('../content/canonicalTxtRenderer.js');
const { computeContentFingerprint: fp } = await import('../contentFingerprint.js');
const { importTxtToCanonicalBook } = await import('../content/txtImporter.js');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code || e.message; } };

// ── Escritor ZIP determinista (solo para fixtures) ───────────────────────────
function buildZip(files) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of files) {
        const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data ?? '', 'utf8');
        const method = f.method ?? (f.name === 'mimetype' ? 0 : 8);
        const comp = f.rawCompressed ?? (method === 8 ? zlib.deflateRawSync(data) : data);
        const nameBytes = f.nameBytes ?? Buffer.from(f.name, 'utf8');
        const flags = f.flags ?? 0x0800;
        const crc = f.crc ?? (zlib.crc32(data) >>> 0);
        const size = f.declaredSize ?? data.length;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(size, 22);
        local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
        locals.push(local, nameBytes, comp);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(f.madeBy ?? ((3 << 8) | 20), 4); cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
        cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(size, 24);
        cd.writeUInt16LE(nameBytes.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
        cd.writeUInt32LE(((f.unixMode ?? 0o100644) << 16) >>> 0, 38); cd.writeUInt32LE(offset, 42);
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
const xhtml = (body, head = '<title>t</title>') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head>${head}</head><body>${body}</body></html>`;
function opf({ items, spine, meta = '<dc:title>Libro</dc:title><dc:language>es</dc:language>' }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">x</dc:identifier>${meta}</metadata>
  <manifest>${items.map(([id, href, mt = 'application/xhtml+xml', props]) => `<item id="${id}" href="${href}" media-type="${mt}"${props ? ` properties="${props}"` : ''}/>`).join('')}</manifest>
  <spine>${spine.map(s => (typeof s === 'string' ? `<itemref idref="${s}"/>` : `<itemref idref="${s[0]}" linear="${s[1]}"/>`)).join('')}</spine>
</package>`;
}
/** EPUB a partir de { 'Text/a.xhtml': body, ... } en orden de spine. */
function epub(docs, { opfMeta, extra = [], order, spine, items } = {}) {
    const names = Object.keys(docs);
    const files = [
        { name: 'mimetype', data: 'application/epub+zip', method: 0 },
        { name: 'META-INF/container.xml', data: CONTAINER },
        { name: 'OEBPS/content.opf', data: opf({ items: items ?? names.map((n, i) => [`d${i}`, n]), spine: spine ?? names.map((_, i) => `d${i}`), meta: opfMeta }) },
        ...names.map(n => ({ name: `OEBPS/${n}`, data: docs[n] })),
        ...extra,
    ];
    return buildZip(order ? order(files) : files);
}
const imp = (buf, extra = {}) => importEpubToCanonicalBook({ contentId: 'c-epub', epubBuffer: buf, ...extra });
const texts = (book) => book.chapters.flatMap(c => c.blocks.map(b => `${b.type[0]}:${b.text}`));

// ── Pureza: red, filesystem, reloj, aleatoriedad ─────────────────────────────
const calls = { net: 0, fs: 0, time: 0, random: 0 };
const spy = (obj, key, bucket) => { const orig = obj[key]; obj[key] = function (...a) { calls[bucket]++; return orig.apply(this, a); }; return () => { obj[key] = orig; }; };
function pure(fn) {
    const restore = [
        spy(globalThis, 'fetch', 'net'), spy(http, 'request', 'net'), spy(https, 'request', 'net'), spy(http, 'get', 'net'),
        spy(https, 'get', 'net'), spy(net, 'connect', 'net'), spy(net, 'createConnection', 'net'), spy(dns, 'lookup', 'net'),
        spy(fs, 'readFileSync', 'fs'), spy(fs, 'openSync', 'fs'), spy(fs, 'readFile', 'fs'), spy(fs, 'existsSync', 'fs'), spy(fs, 'statSync', 'fs'),
        spy(Date, 'now', 'time'), spy(Math, 'random', 'random'),
    ];
    try { return fn(); } finally { restore.forEach(r => r()); }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('[1] estructura y contenido');
const E1 = epub({ 'Text/c1.xhtml': xhtml('<p>Hola mundo.</p>') });
const b1 = pure(() => imp(E1));
ok('E1 EPUB mínimo → CanonicalBook v1 válido', validateCanonicalBook(b1).length === 0 && b1.schemaVersion === 1 && b1.contentId === 'c-epub');
ok('E1 contrato exacto: claves schemaVersion,contentId,contentFingerprint,language,chapters', Object.keys(b1).join(',') === 'schemaVersion,contentId,contentFingerprint,language,chapters');
ok('E1 capítulo implícito sin título inventado', b1.chapters[0].implicit === true && b1.chapters[0].id === 'ch-0001' && b1.chapters[0].blocks[0].id === 'p-0001-0001');
ok('E1 language del OPF', b1.language === 'es');
ok('pureza: 0 red, 0 filesystem, 0 reloj, 0 aleatoriedad', calls.net === 0 && calls.fs === 0 && calls.time === 0 && calls.random === 0, JSON.stringify(calls));

const E2 = epub({ 'Text/c1.xhtml': xhtml('<h1>Capítulo 1</h1><p>Uno.</p>'), 'Text/c2.xhtml': xhtml('<h1>Capítulo 2</h1><p>Dos.</p>') });
const b2 = imp(E2);
ok('E2 dos documentos → dos capítulos explícitos', b2.chapters.length === 2 && b2.chapters.every(c => !c.implicit && c.blocks[0].type === 'heading'));
ok('E2 IDs ordinales', JSON.stringify(b2.chapters.map(c => [c.id, c.blocks.map(b => b.id)])) === JSON.stringify([['ch-0001', ['h-0001-0001', 'p-0001-0002']], ['ch-0002', ['h-0002-0001', 'p-0002-0002']]]));

const E3 = epub({ 'Text/c.xhtml': xhtml('<p>Antes del título.</p><h1>Parte <em>uno</em></h1><p>Texto <strong>fuerte</strong> y <a href="https://x.test">enlace</a>.</p><h2>Sección</h2><p>Línea uno<br/>línea dos</p><div>Suelto en div <span>con span</span></div><ul><li>ítem uno</li><li>ítem dos</li></ul>') });
const b3 = imp(E3);
ok('E3 headings/paragraphs, inline → texto, <br> → salto, div/li sueltos → párrafo',
    JSON.stringify(texts(b3)) === JSON.stringify(['p:Antes del título.', 'h:Parte uno', 'p:Texto fuerte y enlace.', 'h:Sección', 'p:Línea uno\nlínea dos', 'p:Suelto en div con span', 'p:ítem uno', 'p:ítem dos']), JSON.stringify(texts(b3)));
ok('E3 texto previo al primer encabezado → capítulo implícito; cada encabezado abre capítulo', b3.chapters.length === 3 && b3.chapters[0].implicit === true && !b3.chapters[1].implicit && !b3.chapters[2].implicit);
ok('E3 CanonicalBook válido', validateCanonicalBook(b3).length === 0);

const E4 = epub({ 'Text/c.xhtml': xhtml('<p>&iquest;Qu&eacute; pas&oacute;? &laquo;Ni&ntilde;o&raquo; &mdash; &#8230; &#x1F600; caf\u00e9 A&amp;B &lt;tag&gt; a&nbsp;b</p>') });
const b4 = imp(E4);
ok('E4 entidades XML/HTML/numéricas y Unicode', b4.chapters[0].blocks[0].text === '¿Qué pasó? «Niño» — … 😀 café A&B <tag> a\u00a0b', b4.chapters[0].blocks[0].text);

const E5 = epub({ 'Text/nav.xhtml': xhtml('<nav epub:type="toc"><ol><li><a href="c.xhtml">Índice X</a></li></ol></nav>'), 'Text/c.xhtml': xhtml('<nav><p>Menú</p></nav><p>Contenido real.</p><span epub:type="pagebreak" title="3">3</span><p hidden="">Oculto</p><div aria-hidden="true">Aria</div>') },
    { items: [['nav', 'Text/nav.xhtml', 'application/xhtml+xml', 'nav'], ['d1', 'Text/c.xhtml']], spine: ['nav', 'd1'] });
const b5 = imp(E5);
ok('E5 documento nav y <nav>, paginación, hidden y aria-hidden fuera del contenido', JSON.stringify(texts(b5)) === JSON.stringify(['p:Contenido real.']), JSON.stringify(texts(b5)));

const E6 = epub({ 'Text/c.xhtml': xhtml('<p onclick="alert(1)">Seguro.</p><script>alert("x")</script><p>Fin.<script type="text/javascript">var a = 1;</script></p>', '<script>evil()</script><style>p{color:red}</style>') });
const b6 = imp(E6);
const s6 = JSON.stringify(b6);
ok('E6 script (head/body/inline) y handlers on* no se filtran', JSON.stringify(texts(b6)) === JSON.stringify(['p:Seguro.', 'p:Fin.']) && !/alert|evil|onclick|color/.test(s6), JSON.stringify(texts(b6)));

const E7 = epub({ 'Text/c.xhtml': xhtml('<p>Antes.</p><iframe src="https://x.test">marco</iframe><object data="x.swf">objeto</object><embed src="x"/><p>Después.</p>') });
ok('E7 iframe/object/embed descartados', JSON.stringify(texts(imp(E7))) === JSON.stringify(['p:Antes.', 'p:Después.']));

const E8 = epub({ 'Text/c.xhtml': xhtml('<p>Texto.</p><svg xmlns="http://www.w3.org/2000/svg"><script>x()</script><foreignObject><p>Dentro de SVG</p></foreignObject><text>svg text</text></svg>') });
ok('E8 SVG (script, foreignObject, text) descartado', JSON.stringify(texts(imp(E8))) === JSON.stringify(['p:Texto.']));

const E9 = epub({ 'Text/c.xhtml': xhtml('<p>Con <img src="http://x.test/a.png" alt="alt remoto"/> imagen remota.</p>', '<link rel="stylesheet" href="https://x.test/a.css"/>') });
ok('E9 recursos remotos en XHTML: ignorados, nunca solicitados', pure(() => texts(imp(E9)))[0] === 'p:Con imagen remota.' && calls.net === 0);
const E9b = epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { items: [['d0', 'https://x.test/remote.xhtml']], spine: ['d0'] });
ok('E9 item del spine con URL remota → EPUB_REMOTE_RESOURCE (sin fetch)', pure(() => code(() => imp(E9b))) === 'EPUB_REMOTE_RESOURCE' && calls.net === 0);
for (const scheme of ['file:///etc/passwd', 'data:text/html,x', 'javascript:alert(1)', 'http://x.test/a']) {
    ok(`href con esquema rechazado: ${scheme.slice(0, 12)}`, code(() => resolvePackageHref('OEBPS', scheme)) === 'EPUB_REMOTE_RESOURCE');
}

console.log('\n[2] seguridad ZIP');
const withEntry = (name, extra = {}) => epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { extra: [{ name, data: 'pwn', ...extra }] });
ok('E10 entrada ../ → ZIP_TRAVERSAL', code(() => imp(withEntry('../evil.txt'))) === 'ZIP_TRAVERSAL');
ok('E10 entrada a/../../ → ZIP_TRAVERSAL', code(() => imp(withEntry('OEBPS/../../evil.txt'))) === 'ZIP_TRAVERSAL');
ok('E10 entrada con "\\" → ZIP_BAD_NAME', code(() => imp(withEntry('..\\evil.txt'))) === 'ZIP_BAD_NAME');
ok('E10 href ../ que escapa de la raíz → EPUB_PATH_ESCAPE', code(() => resolvePackageHref('OEBPS', '../../x.xhtml')) === 'EPUB_PATH_ESCAPE');
ok('E10 href ../ dentro de la raíz → permitido', resolvePackageHref('OEBPS/Text', '../Styles/a.css') === 'OEBPS/Styles/a.css');
ok('E10 href %2e%2e codificado → EPUB_PATH_ESCAPE', code(() => resolvePackageHref('', '%2e%2e/x')) === 'EPUB_PATH_ESCAPE');
ok('E11 ruta absoluta /etc → ZIP_ABSOLUTE_PATH', code(() => imp(withEntry('/etc/passwd'))) === 'ZIP_ABSOLUTE_PATH');
ok('E11 letra de unidad C: → ZIP_ABSOLUTE_PATH', code(() => imp(withEntry('C:/win.ini'))) === 'ZIP_ABSOLUTE_PATH');
ok('E11 byte NUL en nombre → ZIP_BAD_NAME', code(() => imp(withEntry('a\u0000b'))) === 'ZIP_BAD_NAME');
ok('E11 href absoluto en OPF → EPUB_BAD_HREF', code(() => resolvePackageHref('OEBPS', '/etc/passwd')) === 'EPUB_BAD_HREF');
ok('symlink ZIP → ZIP_SYMLINK', code(() => imp(withEntry('OEBPS/link', { unixMode: 0o120777 }))) === 'ZIP_SYMLINK');
ok('entrada especial (FIFO) → ZIP_SPECIAL_ENTRY', code(() => imp(withEntry('OEBPS/fifo', { unixMode: 0o010644 }))) === 'ZIP_SPECIAL_ENTRY');
ok('nombre no ASCII sin marca UTF-8 → ZIP_BAD_NAME', code(() => imp(withEntry('x', { nameBytes: Buffer.from([0x61, 0xE9]), flags: 0 }))) === 'ZIP_BAD_NAME');
ok('entrada cifrada → ZIP_ENCRYPTED', code(() => imp(withEntry('OEBPS/enc', { flags: 0x0801 }))) === 'ZIP_ENCRYPTED');
ok('método no soportado → ZIP_UNSUPPORTED', code(() => imp(withEntry('OEBPS/bz', { method: 12, rawCompressed: Buffer.from('xx') }))) === 'ZIP_UNSUPPORTED');
ok('CRC incorrecto → ZIP_CRC', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: fs_ => fs_.map(f => f.name === 'OEBPS/Text/c.xhtml' ? { ...f, crc: 1 } : f) }))) === 'ZIP_CRC');
ok('no ZIP → ZIP_NO_EOCD', code(() => imp(Buffer.from('esto no es un zip, solo texto plano de prueba'))) === 'ZIP_NO_EOCD');
ok('entrada no Buffer → ZIP_INVALID_INPUT', code(() => imp('x'.repeat(40))) === 'ZIP_INVALID_INPUT');

const E15 = withEntry('OEBPS/Text/c.xhtml');
ok('E15 ruta duplicada exacta → ZIP_DUPLICATE_ENTRY', code(() => imp(E15)) === 'ZIP_DUPLICATE_ENTRY');
ok('E15 duplicado ambiguo por mayúsculas → ZIP_DUPLICATE_ENTRY', code(() => imp(withEntry('OEBPS/TEXT/C.XHTML'))) === 'ZIP_DUPLICATE_ENTRY');
ok('E15 duplicado ambiguo NFC/NFD → ZIP_DUPLICATE_ENTRY',
    code(() => imp(epub({ 'Text/caf\u00e9.xhtml': xhtml('<p>x</p>') }, { extra: [{ name: 'OEBPS/Text/cafe\u0301.xhtml', data: 'x' }] }))) === 'ZIP_DUPLICATE_ENTRY');

const zeros = Buffer.alloc(2 * 1024 * 1024);
ok('E16 bomba (ratio > 200 en entrada > 1 MiB) → ZIP_RATIO', code(() => imp(withEntry('OEBPS/bomb.bin', { data: zeros }))) === 'ZIP_RATIO');
ok('E16 tamaño declarado mentido (100 B, infla 2 MiB) → ZIP_INFLATE, acotado',
    code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.map(x => x.name === 'OEBPS/Text/c.xhtml' ? { ...x, rawCompressed: zlib.deflateRawSync(zeros), declaredSize: 100, crc: 0 } : x) }))) === 'ZIP_INFLATE');
ok('E16 presupuesto de extracción acotado → ZIP_EXTRACT_BUDGET', code(() => imp(E2, { limits: { maxExtractedBytes: 600 } })) === 'ZIP_EXTRACT_BUDGET');
ok('E16 demasiadas entradas → ZIP_TOO_MANY_ENTRIES', code(() => imp(E2, { limits: { maxEntries: 3 } })) === 'ZIP_TOO_MANY_ENTRIES');
ok('EPUB comprimido demasiado grande → ZIP_TOO_LARGE', code(() => imp(E2, { limits: { maxArchiveBytes: 500 } })) === 'ZIP_TOO_LARGE');
ok('E17 entrada sobredimensionada (límite por defecto, 17 MiB declarados) → ZIP_ENTRY_TOO_LARGE',
    code(() => imp(withEntry('OEBPS/big.bin', { declaredSize: 17 * 1024 * 1024 }))) === 'ZIP_ENTRY_TOO_LARGE');
ok('E17 entrada sobredimensionada (límite 1000 B) → ZIP_ENTRY_TOO_LARGE', code(() => imp(withEntry('OEBPS/big.bin', { data: 'x'.repeat(2000), method: 0 }), { limits: { maxEntryBytes: 1000 } })) === 'ZIP_ENTRY_TOO_LARGE');
ok('límites por defecto documentados', ZIP_LIMITS.maxArchiveBytes === 64 * 2 ** 20 && ZIP_LIMITS.maxEntries === 2000 && ZIP_LIMITS.maxEntryBytes === 16 * 2 ** 20
    && ZIP_LIMITS.maxExtractedBytes === 64 * 2 ** 20 && ZIP_LIMITS.maxCompressionRatio === 200);
{
    // Entradas solapadas: dos entradas del directorio central apuntan a la misma cabecera local.
    const z = buildZip([{ name: 'mimetype', data: 'application/epub+zip', method: 0 }, { name: 'a', data: 'hola' }]);
    const cdStart = z.readUInt32LE(z.length - 6);
    const secondCd = cdStart + 46 + 'mimetype'.length;
    const twisted = Buffer.from(z); twisted.writeUInt32LE(0, secondCd + 42);
    ok('entradas solapadas / cabecera local incoherente → rechazo', ['ZIP_OVERLAP', 'ZIP_CORRUPT'].includes(code(() => openZip(twisted))));
}

console.log('\n[3] paquete EPUB');
ok('E12 container.xml mal formado → XML_*', /^XML_/.test(code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.map(x => x.name === 'META-INF/container.xml' ? { ...x, data: '<container><rootfiles>' } : x) }))) || ''));
ok('E12 container.xml sin rootfile → EPUB_BAD_CONTAINER', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.map(x => x.name === 'META-INF/container.xml' ? { ...x, data: '<container><rootfiles/></container>' } : x) }))) === 'EPUB_BAD_CONTAINER');
ok('sin container.xml → EPUB_NO_CONTAINER', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.filter(x => x.name !== 'META-INF/container.xml') }))) === 'EPUB_NO_CONTAINER');
ok('mimetype incorrecto → EPUB_BAD_MIMETYPE', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.map(x => x.name === 'mimetype' ? { ...x, data: 'application/zip' } : x) }))) === 'EPUB_BAD_MIMETYPE');
ok('sin mimetype → EPUB_NO_MIMETYPE', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.filter(x => x.name !== 'mimetype') }))) === 'EPUB_NO_MIMETYPE');
ok('E13 OPF ausente → EPUB_NO_OPF', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.filter(x => x.name !== 'OEBPS/content.opf') }))) === 'EPUB_NO_OPF');
ok('E14 href del spine ausente en el ZIP → EPUB_SPINE_RESOURCE_MISSING', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { items: [['d0', 'Text/c.xhtml'], ['d1', 'Text/falta.xhtml']], spine: ['d0', 'd1'] }))) === 'EPUB_SPINE_RESOURCE_MISSING');
ok('E14 itemref sin item → EPUB_SPINE_REF_MISSING', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { spine: ['d0', 'nope'] }))) === 'EPUB_SPINE_REF_MISSING');
ok('itemref repetido → EPUB_SPINE_DUPLICATE', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { spine: ['d0', 'd0'] }))) === 'EPUB_SPINE_DUPLICATE');
ok('id duplicado en manifest → EPUB_DUPLICATE_ID', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { items: [['d0', 'Text/c.xhtml'], ['d0', 'Text/c.xhtml']] }))) === 'EPUB_DUPLICATE_ID');
ok('spine vacío → EPUB_EMPTY_SPINE', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { spine: [] }))) === 'EPUB_EMPTY_SPINE');
ok('XHTML mal formado → XML_MISMATCHED_TAG', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>abierto</div>') }))) === 'XML_MISMATCHED_TAG');
ok('entidad HTML desconocida → XML_UNKNOWN_ENTITY (fail-closed)', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>&foo;</p>') }))) === 'XML_UNKNOWN_ENTITY');
ok('XHTML no UTF-8 declarado → XML_ENCODING', code(() => imp(epub({ 'Text/c.xhtml': '<?xml version="1.0" encoding="ISO-8859-1"?><html><body><p>x</p></body></html>' }))) === 'XML_ENCODING');
ok('XHTML con bytes no UTF-8 → EPUB_ENCODING', code(() => imp(epub({ 'Text/c.xhtml': Buffer.from([0x3c, 0x68, 0x3e, 0xff, 0x3c, 0x2f, 0x68, 0x3e]) }))) === 'EPUB_ENCODING');
ok('linear="no" fuera del orden de lectura', JSON.stringify(texts(imp(epub({ 'Text/a.xhtml': xhtml('<p>A</p>'), 'Text/n.xhtml': xhtml('<p>Nota</p>') }, { spine: ['d0', ['d1', 'no']] })))) === '["p:A"]');
ok('item del spine no XHTML (imagen) se ignora', JSON.stringify(texts(imp(epub({ 'Text/a.xhtml': xhtml('<p>A</p>') }, { items: [['d0', 'Text/a.xhtml'], ['img', 'Text/a.xhtml', 'image/png']], spine: ['img', 'd0'] })))) === '["p:A"]');

console.log('\n[4] XML: DTD / XXE');
const XXE = `<?xml version="1.0"?><!DOCTYPE html [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><html xmlns="http://www.w3.org/1999/xhtml"><body><p>&xxe;</p></body></html>`;
ok('E18 DOCTYPE con entidad externa (XXE) → XML_DTD_FORBIDDEN, sin lectura de disco', pure(() => code(() => imp(epub({ 'Text/c.xhtml': XXE })))) === 'XML_DTD_FORBIDDEN' && calls.fs === 0);
const LOL = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><html><body><p>&lol2;</p></body></html>`;
ok('E18 billion laughs → XML_DTD_FORBIDDEN', code(() => imp(epub({ 'Text/c.xhtml': LOL }))) === 'XML_DTD_FORBIDDEN');
ok('E18 XXE en el OPF → XML_DTD_FORBIDDEN', code(() => imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { order: f => f.map(x => x.name === 'OEBPS/content.opf' ? { ...x, data: x.data.replace('<package', '<!DOCTYPE package [<!ENTITY e SYSTEM "http://x.test/">]><package') } : x) }))) === 'XML_DTD_FORBIDDEN');
ok('<!ENTITY> suelto → XML_DTD_FORBIDDEN', code(() => parseStrictXml('<!ENTITY a "b"><r/>')) === 'XML_DTD_FORBIDDEN');
const EPUB2 = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>EPUB 2 &eacute;</p></body></html>`;
ok('DOCTYPE externo de XHTML 1.1 (EPUB 2): aceptado y NUNCA resuelto', pure(() => texts(imp(epub({ 'Text/c.xhtml': EPUB2 })))[0]) === 'p:EPUB 2 é' && calls.net === 0 && calls.fs === 0);
ok('entidades HTML no se aceptan en OPF/container (solo XML)', code(() => parseStrictXml('<a>&eacute;</a>')) === 'XML_UNKNOWN_ENTITY');
ok('XInclude no se procesa (se trata como elemento desconocido)', JSON.stringify(texts(imp(epub({ 'Text/c.xhtml': xhtml('<p>A</p><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd"/>') })))) === '["p:A"]');
ok('profundidad acotada → XML_TOO_DEEP', code(() => parseStrictXml('<a>'.repeat(300) + '</a>'.repeat(300))) === 'XML_TOO_DEEP');
ok('carácter de control → XML_INVALID_CHAR', code(() => parseStrictXml('<a>\u0001</a>')) === 'XML_INVALID_CHAR');

console.log('\n[5] orden, vacío, determinismo, fingerprint');
const E19 = epub({ 'Text/c.xhtml': xhtml('<div><img src="a.png" alt="solo imagen"/></div>') });
ok('E19 EPUB sin texto → EPUB_NO_TEXT', code(() => imp(E19)) === 'EPUB_NO_TEXT');
const docs20 = { 'Text/z-primero.xhtml': xhtml('<h1>Primero</h1><p>1</p>'), 'Text/a-segundo.xhtml': xhtml('<h1>Segundo</h1><p>2</p>') };
const E20 = epub(docs20, { order: f => [f[0], f[4], f[3], f[2], f[1]] });
ok('E20 orden del spine ≠ orden del ZIP → manda el spine', JSON.stringify(texts(imp(E20))) === JSON.stringify(['h:Primero', 'p:1', 'h:Segundo', 'p:2']));
const E20same = epub(docs20);
ok('determinismo: mismo contenido con otro orden ZIP → libro idéntico', JSON.stringify(imp(E20)) === JSON.stringify(imp(E20same)));
ok('determinismo: dos importaciones → mismos bytes', JSON.stringify(imp(E3)) === JSON.stringify(imp(E3)));
ok('stored vs deflate → libro idéntico', JSON.stringify(imp(epub({ 'Text/c.xhtml': xhtml('<p>Hola mundo.</p>') }, { order: f => f.map(x => ({ ...x, method: 0 })) }))) === JSON.stringify(b1));
for (const [name, b] of [['E1', b1], ['E2', b2], ['E3', b3], ['E4', b4], ['E5', b5]]) {
    ok(`${name}: contentFingerprint = fingerprint 1B de la rendición TXT`, b.contentFingerprint === fp(render(b)));
}
ok('fingerprint = identidad del TEXTO, no del archivo (stored/deflate distintos, mismo fp)', imp(epub({ 'Text/c.xhtml': xhtml('<p>Hola mundo.</p>') }, { order: f => f.map(x => ({ ...x, method: 0 })) })).contentFingerprint === b1.contentFingerprint);
ok('mismo texto por TXT y por EPUB → mismo contentFingerprint', importTxtToCanonicalBook({ contentId: 'c', text: 'Capítulo 1\n\nUno.', contentFingerprint: fp('Capítulo 1\n\nUno.') }).contentFingerprint
    === imp(epub({ 'Text/c.xhtml': xhtml('<h1>Capítulo 1</h1><p>Uno.</p>') })).contentFingerprint);
ok('contentFingerprint del llamador coincidente → aceptado', imp(E1, { contentFingerprint: b1.contentFingerprint }).contentFingerprint === b1.contentFingerprint);
ok('contentFingerprint del llamador distinto → FINGERPRINT_MISMATCH', code(() => imp(E1, { contentFingerprint: 'sha256:' + '0'.repeat(64) })) === 'FINGERPRINT_MISMATCH');
ok('language del llamador prevalece; inválido se omite', imp(E1, { language: 'pt-BR' }).language === 'pt-BR' && !('language' in imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { opfMeta: '<dc:title>t</dc:title><dc:language>no válido!</dc:language>' }))));
ok('contentId obligatorio', code(() => importEpubToCanonicalBook({ epubBuffer: E1 })) === 'INVALID_CONTENT_ID');
// E4 queda fuera: su «<tag>» es texto legítimo (viene de &lt;tag&gt;).
const leak = JSON.stringify([b1, b2, b3, b5, imp(E6), imp(E7), imp(E8), imp(E9)].map(texts));
const leakRx = /<[a-z/]|\.xhtml|\.opf|OEBPS|epub|href|style|https?:/i;
ok('sin HTML ni rastros del EPUB en los bloques (tags, rutas, OPF, CSS, URLs)', !leakRx.test(leak), String(leak.match(leakRx)));

console.log('\n[6] metadata de accesibilidad (solo diagnóstico)');
const A11Y = '<dc:title>t</dc:title><dc:language>es</dc:language><meta property="schema:accessMode">textual</meta><meta property="schema:accessibilityFeature">structuralNavigation</meta><meta property="schema:accessibilityHazard">none</meta><meta property="schema:accessibilitySummary">Resumen.</meta>';
const pa = parseEpubArchive(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { opfMeta: A11Y }));
ok('a11y EPUB 3 completa → PRESENT', pa.a11yStatus === 'PRESENT' && pa.a11y.accessMode[0] === 'textual');
const pb = parseEpubArchive(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { opfMeta: '<dc:language>es</dc:language><meta name="schema:accessMode" content="textual"/>' }));
ok('a11y EPUB 2 parcial → PARTIAL', pb.a11yStatus === 'PARTIAL' && pb.a11y.accessMode[0] === 'textual');
ok('sin a11y → ABSENT', parseEpubArchive(E1).a11yStatus === 'ABSENT');
ok('la metadata a11y NO entra en CanonicalBook', !('a11y' in imp(epub({ 'Text/c.xhtml': xhtml('<p>x</p>') }, { opfMeta: A11Y }))));

console.log(`\ncanonicalBookEpub — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
