/**
 * SubirContenidoEpubAdmin.structural.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3F.1.
 *
 * Ratchet estructural del admin EPUB: tres opciones en el MISMO gestor; TXT y
 * EPUB por el formulario y pipeline existentes; ilustrado = mismo pipeline con
 * inspector y mensaje editorial (sin flags ni schema nuevos); «Añadir EPUB»
 * sube bajo el contentId EXISTENTE y adjunta solo epub_url. Sin red ni stores.
 *
 *   node pages/__tests__/SubirContenidoEpubAdmin.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const page = read('pages', 'SubirContenido.tsx');
const attach = read('components', 'admin', 'AttachEpubPanel.tsx');
const inspector = read('components', 'admin', 'EpubInspectorCard.tsx');
const ds = read('services', 'dataService.ts');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

console.log('[UI] tres opciones');
ok('«¿Qué quieres hacer?» con las tres operaciones (EPUB_BOOK_FLOWS) solo al crear', /uploadMode === 'new' && !editingId && \(\s*<div[\s\S]{0,300}¿Qué quieres hacer\?[\s\S]{0,300}EPUB_BOOK_FLOWS\.map/.test(page));
ok('cada opción es un botón con aria-pressed', /onClick=\{\(\) => \{\s*setBookFlow\(flow\.id\)[\s\S]{0,600}aria-pressed=\{bookFlow === flow\.id\}/.test(page));
ok('«Añadir EPUB» muestra el panel y oculta formulario, materiales y botón de publicar',
    /\{attachFlow && <AttachEpubPanel contents=\{existingParents\} \/>\}/.test(page) && /uploadMode === 'new' && !attachFlow && \(/.test(page)
    && /uploadMode !== 'banner' && !attachFlow && \(\s*<div className="bg-gray-50/.test(page) && /uploadMode !== 'banner' && !attachFlow && \(\s*<div className="pt-4">/.test(page));

console.log('[crear TXT/EPUB e ilustrado]');
ok('sin formulario paralelo: un solo input sc-texto-es y el mismo uploader/POST', (page.match(/id="sc-texto-es"/g) || []).length === 1
    && /saveContentToApi\(epubUrl \? withEpubSource\(newContent, epubUrl\) : newContent\)/.test(page));
ok('ilustrado: EPUB como recurso principal en el MISMO estado (textoPlanoFile → mismo pipeline)', /id="sc-epub-ilustrado"[^\n]{0,80}accept="\.epub,application\/epub\+zip"[^\n]{0,80}handleMainFileChange\(e, 'textoPlanoFile'\)/.test(page));
ok('ilustrado: mensaje de que se conserva la edición EPUB original', /ILLUSTRATED_KEEPS_ORIGINAL_MESSAGE/.test(page));
ok('ilustrado: sin flags ni schema nuevos en el payload', !/illustratedContent|epubContent|isIllustrated|illustrated:/.test(page));
ok('inspector en ilustrado y al elegir EPUB en TXT/EPUB', (page.match(/<EpubInspectorCard /g) || []).length === 2);
ok('submit: ilustrado exige EPUB y un EPUB no publicable no se envía (error inline)', /bookFlow === 'illustrated' && !isEpubFile\(mainContent\.textoPlanoFile\) \? 'Selecciona el EPUB ilustrado\.'/.test(page)
    && /isEpubFile\(mainContent\.textoPlanoFile\) \? epubInspectBlock : null/.test(page) && /if \(epubFlowBlock\) \{\s*setUploadError\(epubFlowBlock\);/.test(page));
ok('el bloqueo 3F.1 va antes de subir nada', page.indexOf('epubFlowBlock') < page.indexOf("uploadIfFile(mainContent.coverFile, 'Portada')"));

console.log('[inspector]');
ok('inspecciona con el servidor (dataService.inspectEpub), sin parser propio', /dataService\.inspectEpub\(file\)/.test(inspector) && !/JSZip|unzip|DOMParser|foliate/i.test(inspector));
ok('título «EPUB detectado» y líneas de formatEpubInspection', /EPUB detectado/.test(inspector) && /formatEpubInspection\(state\.inspection\)/.test(inspector));
ok('no publicable visible', /No publicable: \{block\}/.test(inspector));
ok('dataService.inspectEpub → POST /upload/epub-inspect (multipart, cookie)', /\/upload\/epub-inspect`, \{ method: 'POST', credentials: 'same-origin', body: formData \}/.test(ds));

console.log('[añadir EPUB]');
ok('sube con el uploader existente BAJO el contentId seleccionado (R4)', /dataService\.uploadFile\(asEpubUploadFile\(file\), selected\.id\)/.test(attach));
ok('adjunta con attachEpubEdition (solo epub_url)', /dataService\.attachEpubEdition\(selected\.id, uploadedUrl\)/.test(attach)
    && /\/content\/\$\{encodeURIComponent\(contentId\)\}\/epub-edition`/.test(ds) && /body: JSON\.stringify\(\{ epub_url: epubUrl \}\)/.test(ds));
ok('si falla tras subir, purga best-effort del huérfano', /if \(uploadedUrl\) dataService\.purgeOrphanFile\(uploadedUrl\)/.test(attach));
ok('contenido con EPUB → bloqueado con el mensaje (sin reemplazo)', /epubAttachBlockReason\(selected\)/.test(attach) && /\{alreadyBlock\}/.test(attach));
ok('muestra título, autor, id, PDF y EPUB', ['Título: ', 'Autor: ', 'Id: ', 'PDF: ', 'EPUB: '].every(t => attach.includes(t)));
ok('inspector sin exigir texto (edición, no fuente)', /<EpubInspectorCard file=\{file\} requiresText=\{false\}/.test(attach));
ok('el panel no llama a saveContentToApi (no reimporta)', !/saveContentToApi/.test(attach));

console.log(`\nSubirContenidoEpubAdmin.structural — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
