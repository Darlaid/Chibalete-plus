/**
 * EpubOriginalLink.structural.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.3.
 * «Leer EPUB» en la ficha: solo con epub_url, a la derecha de «Leer en PDF»
 * (acciones terciarias), lejos de Inmersivo/Guiado/Accesible, y el enlace solo
 * lleva el contentId. CP-4D: son modos de lectura, no «originales» que se
 * entregan. Sin red ni stores.
 *
 *   node pages/__tests__/EpubOriginalLink.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasEpubOriginal, epubReaderHref, contentDetailHref, readEpubContentId, EPUB_READER_ENTRY } from '../../utils/epubReaderLink.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const page = fs.readFileSync(path.join(ROOT, 'pages', 'PaginaDetalleLibro.tsx'), 'utf8');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

console.log('[helper]');
const aliciaTxt = { id: 'content-1773325007384', tipo: 'libro', url_recurso: '/uploads/content-1773325007384/taco.pdf', texto_plano_url: '/uploads/x.txt' };
const aliciaEpub = { id: 'content-1792094844503', tipo: 'libro', url_recurso: '', epub_url: '/uploads/content-1792094844503/a.epub', texto_plano_url: '/uploads/content-1792094844503/canonical/book.txt' };
ok('Alicia TXT (sin epub_url) → sin EPUB original', hasEpubOriginal(aliciaTxt) === false);
ok('Alicia EPUB → con EPUB original', hasEpubOriginal(aliciaEpub) === true);
ok('álbum con epub_url → no aplica', hasEpubOriginal({ ...aliciaEpub, tipo: 'libro_album' }) === false);
ok('sin contenido / epub_url vacío → no', !hasEpubOriginal(null) && !hasEpubOriginal({ epub_url: '' }));
const href = epubReaderHref(aliciaEpub.id);
ok('href = entrada propia + solo contentId', href === `${EPUB_READER_ENTRY}?contentId=content-1792094844503` && !href.includes('uploads') && !href.includes('.epub'));
ok('contentId se codifica', epubReaderHref('a b&c') === '/epub-reader.html?contentId=a%20b%26c');
ok('volver a la ficha (HashRouter)', contentDetailHref('content-1') === '/#/contenido/content-1');
ok('readEpubContentId acepta ids válidos y rechaza basura', readEpubContentId('?contentId=content-1792094844503') === 'content-1792094844503' && readEpubContentId('?contentId=../x') === null && readEpubContentId('') === null);

console.log('\n[ficha]');
const tertiary = page.slice(page.indexOf('{/* Tertiary Actions Grid */}'), page.indexOf('{/* Tertiary Actions Grid */}') + 2500);
const pdfAt = tertiary.indexOf('Leer en PDF');
const epubAt = tertiary.indexOf('Leer EPUB');
ok('«Leer EPUB» vive en las acciones terciarias', epubAt > 0);
ok('… a la derecha (después) de «Leer en PDF»', pdfAt > 0 && epubAt > pdfAt);
ok('CP-4D: sin «Ver … original» (no se presenta como entrega del archivo)', !/Ver (PDF|EPUB) [Oo]riginal/.test(page));
ok('… solo si hasEpubOriginal(content)', /\{hasEpubOriginal\(content\) && \(\s*<a href=\{epubReaderHref\(content\.id\)\}/.test(page));
ok('… enlace con contentId, nunca epub_url', !/href=\{[^}]*epub_url/.test(page));
const secondary = page.slice(page.indexOf('/leer/inmersivo/${content.id}`, \'inmersivo\''), page.indexOf('{/* Tertiary Actions Grid */}'));
ok('no está junto a Inmersivo/Guiado/Accesible', secondary.length > 0 && !secondary.includes('EPUB'));
ok('modo PDF: «Leer en PDF» con la misma condición', /<Book size=\{16\}\/> Leer en PDF/.test(page) && /content\.tipo !== 'libro_album' && content\.url_recurso && \(/.test(page));

console.log(`\nEpubOriginalLink.structural — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
