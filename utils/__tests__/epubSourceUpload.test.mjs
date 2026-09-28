/**
 * epubSourceUpload.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3D.1.
 * Reglas de la UI admin para EPUB como fuente (utils/epubSourceUpload.mjs).
 *
 *   node utils/__tests__/epubSourceUpload.test.mjs
 */
import {
    EPUB_MIME, EPUB_REIMPORT_BLOCKED_MESSAGE, EPUB_ONLY_NEW_CONTENT_MESSAGE,
    isEpubFile, asEpubUploadFile, epubSourceBlockReason, withEpubSource,
} from '../epubSourceUpload.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const epub = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Libro.EPUB', { type: '' });
const epubZip = new File([new Uint8Array([1])], 'libro.epub', { type: 'application/zip' });
const txt = new File(['hola'], 'texto.txt', { type: 'text/plain' });

ok('isEpubFile: .epub (sin importar mayúsculas) sí; .txt, .zip, null no',
    isEpubFile(epub) && isEpubFile(epubZip) && !isEpubFile(txt) && !isEpubFile(new File(['x'], 'a.zip')) && !isEpubFile(null) && !isEpubFile(undefined));
const up = asEpubUploadFile(epub);
ok('asEpubUploadFile: declara application/epub+zip sin tocar nombre ni bytes', up.type === EPUB_MIME && up.name === 'Libro.EPUB' && up.size === epub.size);
ok('asEpubUploadFile: MIME del navegador (application/zip) no se respeta', asEpubUploadFile(epubZip).type === EPUB_MIME);
const already = new File([new Uint8Array([1])], 'x.epub', { type: EPUB_MIME });
ok('asEpubUploadFile: ya correcto → mismo objeto', asEpubUploadFile(already) === already);

ok('nuevo contenido + EPUB → permitido', epubSourceBlockReason({ isUpdate: false, existingContent: null, textoPlanoFile: epub }) === null);
ok('nuevo contenido + TXT → permitido (sin cambios)', epubSourceBlockReason({ isUpdate: false, existingContent: null, textoPlanoFile: txt }) === null);
ok('editar contenido EPUB con otro EPUB → bloqueado (reimport)', epubSourceBlockReason({ isUpdate: true, existingContent: { epub_url: '/uploads/c/x.epub' }, textoPlanoFile: epub }) === EPUB_REIMPORT_BLOCKED_MESSAGE);
ok('editar contenido EPUB con un TXT → bloqueado (reemplazo de fuente)', epubSourceBlockReason({ isUpdate: true, existingContent: { epub_url: '/uploads/c/x.epub' }, textoPlanoFile: txt }) === EPUB_REIMPORT_BLOCKED_MESSAGE);
ok('editar contenido EPUB sin archivo nuevo (solo metadata) → permitido', epubSourceBlockReason({ isUpdate: true, existingContent: { epub_url: '/uploads/c/x.epub' }, textoPlanoFile: null }) === null);
ok('editar contenido TXT con un EPUB → bloqueado (solo contenido nuevo)', epubSourceBlockReason({ isUpdate: true, existingContent: { texto_plano_url: '/uploads/c/a.txt' }, textoPlanoFile: epub }) === EPUB_ONLY_NEW_CONTENT_MESSAGE);
ok('editar contenido TXT con otro TXT → permitido (flujo actual intacto)', epubSourceBlockReason({ isUpdate: true, existingContent: { texto_plano_url: '/uploads/c/a.txt' }, textoPlanoFile: txt }) === null);
ok('mensaje de reimportación = el acordado', EPUB_REIMPORT_BLOCKED_MESSAGE.startsWith('Por ahora los contenidos EPUB no pueden reemplazarse.'));

const content = { id: 'c-1', titulo: 'T', texto_plano_url: undefined, metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos' };
const payload = withEpubSource({ ...content, texto_plano_url: '/uploads/c-1/viejo.txt' }, '/uploads/c-1/libro.epub');
ok('withEpubSource: añade epub_url', payload.epub_url === '/uploads/c-1/libro.epub');
ok('withEpubSource: NO incluye texto_plano_url (ni como clave)', !('texto_plano_url' in payload) && !JSON.stringify(payload).includes('texto_plano_url'));
ok('withEpubSource: conserva el resto de la metadata y no muta el original', payload.titulo === 'T' && payload.publico_objetivo === 'todos' && content.epub_url === undefined);

console.log(`\nepubSourceUpload — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
