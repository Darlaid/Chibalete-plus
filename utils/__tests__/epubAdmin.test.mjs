/**
 * epubAdmin.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3F.1.
 *
 * Reglas puras del admin EPUB: tres operaciones, presentación del inspector
 * (ejemplo de Alicia), motivos de bloqueo, segundo EPUB bloqueado, búsqueda,
 * y que un EPUB añadido como edición no convierte al EPUB en fuente del texto.
 *
 *   node utils/__tests__/epubAdmin.test.mjs
 */
import {
    EPUB_BOOK_FLOWS, formatEpubInspection, formatEpubSize, epubInspectionBlockReason, epubAttachBlockReason,
    filterContentsForAttach, EPUB_ALREADY_ATTACHED_MESSAGE, EPUB_SCRIPTED_MESSAGE, EPUB_NO_TEXT_MESSAGE,
} from '../epubAdmin.mjs';
import { isEpubTextSource, epubSourceBlockReason, EPUB_REIMPORT_BLOCKED_MESSAGE } from '../epubSourceUpload.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

console.log('[UI] tres operaciones');
ok('tres opciones en orden: TXT/EPUB, EPUB ilustrado, añadir EPUB', EPUB_BOOK_FLOWS.map(f => f.id).join(',') === 'text,illustrated,attach');
ok('textos de la unidad', EPUB_BOOK_FLOWS[0].title === 'Crear contenido desde TXT o EPUB' && EPUB_BOOK_FLOWS[0].description === 'Para textos que Chibalete+ convertirá a sus modos de lectura.'
    && EPUB_BOOK_FLOWS[1].title === 'Crear contenido desde EPUB ilustrado' && EPUB_BOOK_FLOWS[1].description === 'Conserva también la edición EPUB original y habilita su lector.'
    && EPUB_BOOK_FLOWS[2].title === 'Añadir EPUB a un contenido existente' && EPUB_BOOK_FLOWS[2].description === 'Añade una edición EPUB a un título publicado sin modificar sus otros modos.');

console.log('[inspector]');
const ALICIA = { chapters: 13, images: 77, layout: 'reflowable', toc: { present: true, entries: 12 }, scripts: false, hasText: true, bytes: 49272977, publishable: true };
ok('Alicia → 13 capítulos / 77 imágenes / adaptable / TOC sí · 12 / scripts no / 49,3 MB',
    JSON.stringify(formatEpubInspection(ALICIA)) === JSON.stringify(['13 capítulos', '77 imágenes', 'Diseño: adaptable', 'Tabla de contenido: sí · 12 entradas', 'Scripts: no', '49,3 MB']), JSON.stringify(formatEpubInspection(ALICIA)));
ok('singulares, fijo, sin TOC, scripts sí, KB', JSON.stringify(formatEpubInspection({ chapters: 1, images: 1, layout: 'fixed', toc: { present: false, entries: 0 }, scripts: true, bytes: 1532 }))
    === JSON.stringify(['1 capítulo', '1 imagen', 'Diseño: fijo', 'Tabla de contenido: no', 'Scripts: sí', '2 KB']));
ok('tamaño: 1.532.831 B → 1,5 MB', formatEpubSize(1532831) === '1,5 MB');
ok('sin detalles técnicos internos (ni motivos ni rutas)', !formatEpubInspection({ ...ALICIA, scriptReasons: ['x.xhtml: script'] }).some(l => /xhtml|script\b/.test(l) && !l.startsWith('Scripts')));
ok('scripts → NO PUBLICABLE (crear y añadir)', epubInspectionBlockReason({ ...ALICIA, scripts: true }) === EPUB_SCRIPTED_MESSAGE && epubInspectionBlockReason({ ...ALICIA, scripts: true }, { requiresText: false }) === EPUB_SCRIPTED_MESSAGE);
ok('sin texto: bloquea crear, no añadir edición', epubInspectionBlockReason({ ...ALICIA, hasText: false }) === EPUB_NO_TEXT_MESSAGE && epubInspectionBlockReason({ ...ALICIA, hasText: false }, { requiresText: false }) === null);
ok('Alicia publicable', epubInspectionBlockReason(ALICIA) === null);

console.log('[añadir EPUB]');
ok('contenido con epub_url → «Este contenido ya tiene una edición EPUB.»', epubAttachBlockReason({ id: 'c', epub_url: '/uploads/c/x.epub' }) === EPUB_ALREADY_ATTACHED_MESSAGE && EPUB_ALREADY_ATTACHED_MESSAGE === 'Este contenido ya tiene una edición EPUB.');
ok('contenido sin EPUB → permitido', epubAttachBlockReason({ id: 'c' }) === null && epubAttachBlockReason(null) === null);
const LIST = [{ id: 'content-1', titulo: 'Alicia', autor: 'Carroll', tipo: 'libro' }, { id: 'content-2', titulo: 'Otro', autor: 'Poe', tipo: 'libro' }, { id: 'm', titulo: 'Alicia club', tipo: 'memoria_club' }];
ok('búsqueda por título/autor/id, sin memorias de club', filterContentsForAttach(LIST, 'alicia').map(c => c.id).join() === 'content-1'
    && filterContentsForAttach(LIST, 'POE').map(c => c.id).join() === 'content-2' && filterContentsForAttach(LIST, 'content-2').length === 1 && filterContentsForAttach(LIST, '').length === 2);

console.log('[fuente vs edición]');
ok('creado desde EPUB (texto = rendición canónica) → fuente', isEpubTextSource({ id: 'c', epub_url: '/uploads/c/a.epub', texto_plano_url: '/uploads/c/canonical/book.txt' }) === true);
ok('EPUB añadido a un contenido con TXT propio → edición (no fuente)', isEpubTextSource({ id: 'c', epub_url: '/uploads/c/a.epub', texto_plano_url: '/uploads/c/obra.txt' }) === false);
ok('… y su TXT sigue reemplazable desde el formulario', epubSourceBlockReason({ isUpdate: true, existingContent: { id: 'c', epub_url: '/uploads/c/a.epub', texto_plano_url: '/uploads/c/obra.txt' }, textoPlanoFile: { name: 'nuevo.txt' } }) === null);
ok('contenido creado desde EPUB: reemplazar texto sigue bloqueado', epubSourceBlockReason({ isUpdate: true, existingContent: { id: 'c', epub_url: '/uploads/c/a.epub', texto_plano_url: '/uploads/c/canonical/book.txt' }, textoPlanoFile: { name: 'n.txt' } }) === EPUB_REIMPORT_BLOCKED_MESSAGE);
ok('sin EPUB → no es fuente EPUB', isEpubTextSource({ id: 'c', texto_plano_url: '/uploads/c/obra.txt' }) === false);

console.log(`\nepubAdmin — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
