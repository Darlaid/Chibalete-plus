/**
 * epubZipEntryResolver.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3F.1-R.
 *
 * Regresión del fallo del lector con «Me desconecto, Luego existo_v4.epub»:
 * el manifest declara `href="Me_desconecto%2C_Luego_existo_EPUB.xhtml"` (URL
 * válida) y la entrada ZIP es `Me_desconecto,_Luego_existo_EPUB.xhtml`.
 * foliate normaliza con `decodeURI`, que NO decodifica reservados (`%2C`), y su
 * zip loader busca el nombre exacto → la sección carga null → el paginador
 * falla. El adapter resuelve primero el nombre exacto y, si no existe, el
 * nombre percent-decodificado (sin tocar vendor/).
 *
 * Usa el MISMO zip.js de vendor y la MISMA normalización de foliate
 * (resolveURL de epub.js) sobre un EPUB sintético en memoria.
 *
 *   node components/epub-reader/__tests__/epubZipEntryResolver.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZipEntryResolver } from '../foliateAdapter.mjs';
import { buildZip } from '../../../server/__test__/helpers/epubFixture.mjs';
import { configure, ZipReader, BlobReader } from '../../../vendor/foliate-js/vendor/zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// Copia literal de vendor/foliate-js/epub.js resolveURL (rama sin esquema).
const foliateResolve = (url, relativeTo) => {
    const root = 'https://invalid.invalid/';
    const obj = new URL(url, root + relativeTo);
    obj.search = '';
    return decodeURI(obj.href.replace(root, ''));
};

console.log('[unidad] createZipEntryResolver');
{
    const entries = [{ filename: 'OEBPS/a,b.xhtml' }, { filename: 'OEBPS/plain.xhtml' }, { filename: 'OEBPS/100%.xhtml' }, { filename: 'OEBPS/x%2Cy.xhtml' }, { filename: 'OEBPS/x,y.xhtml' }];
    const of = createZipEntryResolver(entries);
    ok('nombre exacto (comportamiento de foliate)', of('OEBPS/plain.xhtml')?.filename === 'OEBPS/plain.xhtml');
    ok('%2C sin entrada literal → entrada con coma', of('OEBPS/a%2Cb.xhtml')?.filename === 'OEBPS/a,b.xhtml');
    ok('si existen ambas, gana el nombre exacto', of('OEBPS/x%2Cy.xhtml')?.filename === 'OEBPS/x%2Cy.xhtml');
    ok('«%» literal en el nombre: exacto sigue funcionando', of('OEBPS/100%.xhtml')?.filename === 'OEBPS/100%.xhtml');
    ok('escape malformado o inexistente → null (no lanza)', of('OEBPS/%E0%A4%A.xhtml') === null && of('OEBPS/nada.xhtml') === null);
    ok('no-string → null', of(undefined) === null && of(null) === null);
}

console.log('[regresión] EPUB con coma en el nombre de un documento del spine');
{
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">x</dc:identifier><dc:title>T</dc:title><dc:language>es</dc:language></metadata>
  <manifest><item id="c1" href="Me_desconecto%2C_Luego.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
    const zip = buildZip([
        { name: 'mimetype', data: 'application/epub+zip', method: 0 },
        { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
        { name: 'OEBPS/content.opf', data: opf },
        { name: 'OEBPS/Me_desconecto,_Luego.xhtml', data: '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hola</p></body></html>' },
    ]);
    configure({ useWebWorkers: false });
    const entries = await new ZipReader(new BlobReader(new Blob([zip]))).getEntries();
    const href = foliateResolve('Me_desconecto%2C_Luego.xhtml', 'OEBPS/content.opf');
    const exact = new Map(entries.map(e => [e.filename, e]));
    ok('foliate deja %2C sin decodificar (causa)', href === 'OEBPS/Me_desconecto%2C_Luego.xhtml', href);
    ok('… y su búsqueda exacta no encuentra la sección (lo que hacía fallar al lector)', !exact.has(href));
    ok('el resolver del adapter encuentra la sección', createZipEntryResolver(entries)(href)?.filename === 'OEBPS/Me_desconecto,_Luego.xhtml');
}

console.log('[real] EPUB fuente si está presente');
for (const [file, label] of [['Me desconecto, Luego existo_v4.epub', 'Me desconecto'], ['Aventuras_Alicia_Maravillas_EPUB_V4.epub', 'Alicia']]) {
    const p = path.join(REPO, 'EPUB test', file);
    if (!fs.existsSync(p)) { console.log(`  - ${label}: SKIP (no presente)`); continue; }
    const entries = await new ZipReader(new BlobReader(new Blob([fs.readFileSync(p)]))).getEntries();
    const of = createZipEntryResolver(entries);
    const exact = new Set(entries.map(e => e.filename));
    const opfEntry = entries.find(e => e.filename.endsWith('.opf'));
    const { TextWriter } = await import('../../../vendor/foliate-js/vendor/zip.js');
    const opfText = await opfEntry.getData(new TextWriter());
    const hrefs = [...opfText.matchAll(/<item\b[^>]*\bhref="([^"]+)"/g)].map(m => foliateResolve(m[1].replace(/&amp;/g, '&'), opfEntry.filename));
    const missingExact = hrefs.filter(h => !exact.has(h)).length;
    ok(`${label}: todos los items del manifest se resuelven (${hrefs.length}; ${missingExact} solo por nombre decodificado)`, hrefs.every(h => of(h)));
}

console.log(`\nepubZipEntryResolver — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
