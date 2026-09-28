/**
 * SubirContenidoEpub.structural.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3D.1.
 *
 * Ratchet estructural de la UI admin: el EPUB entra por el MISMO formulario y
 * el MISMO /api/upload + POST /api/content; TXT/PDF no cambian; la reimportación
 * EPUB queda bloqueada. La lógica vive en utils/epubSourceUpload.mjs (probada
 * en utils/__tests__/epubSourceUpload.test.mjs). Sin red ni stores.
 *
 *   node pages/__tests__/SubirContenidoEpub.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const page = fs.readFileSync(path.join(ROOT, 'pages', 'SubirContenido.tsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const esInput = page.match(/<input id="sc-texto-es"[^>]*>/)?.[0] ?? '';
ok('el selector de Texto (ES) acepta .epub además de .txt/.md', /accept="[^"]*\.txt[^"]*\.md[^"]*\.epub/.test(esInput), esInput);
ok('sin formulario paralelo: un solo input de texto ES', (page.match(/id="sc-texto-es"/g) || []).length === 1);
ok('otros selectores sin .epub (EN, PT, portada, recurso)', !/id="sc-texto-(en|pt)"[^>]*\.epub/.test(page) && !/id="sc-portada"[^>]*\.epub/.test(page));
ok('usa las reglas compartidas de utils/epubSourceUpload.mjs', /from '\.\.\/utils\/epubSourceUpload\.mjs'/.test(page));
ok('el EPUB se sube por el uploader existente, declarado application/epub+zip', /uploadIfFile\(asEpubUploadFile\(mainContent\.textoPlanoFile/.test(page));
ok('con EPUB no se sube como TXT', /const txtEsUrl = epubSource \? undefined : await uploadIfFile\(mainContent\.textoPlanoFile, 'Texto plano \(ES\)'\)/.test(page));
ok('el POST usa withEpubSource (epub_url, sin texto_plano_url) solo si hay EPUB', /saveContentToApi\(epubUrl \? withEpubSource\(newContent, epubUrl\) : newContent\)/.test(page));
ok('TXT: el payload conserva texto_plano_url como antes', /texto_plano_url: txtEsUrl \|\| existingContent\?\.texto_plano_url/.test(page));
ok('bloqueo de reimportación antes de subir nada', page.indexOf('epubSourceBlockReason(') > 0 && page.indexOf('epubSourceBlockReason(') < page.indexOf("uploadIfFile(mainContent.coverFile, 'Portada')"));
ok('el bloqueo usa el error inline y libera el formulario', /if \(epubBlock\) \{\s*setUploadError\(epubBlock\);\s*setIsUploading\(false\);\s*submittingRef\.current = false;\s*return;/.test(page));
ok('EPUB como archivo principal sigue rechazado (orienta al campo correcto)', /resourceFile\.name\.toLowerCase\(\)\.endsWith\('\.epub'\)/.test(page));
ok('errores del EPUB: se muestra el mensaje del servidor', /No se pudo publicar el EPUB: \$\{errorMessage\}/.test(page));
ok('la UI no fija canónicos ni versión (autoridad del servidor)', !/canonicalBookUrl|contentFingerprint|contentVersion/.test(page));

console.log(`\nSubirContenidoEpub.structural — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
