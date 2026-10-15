/**
 * EpubDetailReadability.structural.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3D.3-R2.
 *
 * La ficha (PaginaDetalleLibro) ya trata texto_plano_url como fuente legible.
 * El «Sin archivo legible» del primer EPUB creado por UI venía de la caché
 * cliente: saveContentToApi guardaba el PAYLOAD (sin texto_plano_url, porque
 * withEpubSource lo omite) y no el registro que devuelve el servidor (que fija
 * texto_plano_url = canonical/book.txt). Sin red ni stores.
 *
 *   node pages/__tests__/EpubDetailReadability.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEpubSource } from '../../utils/epubSourceUpload.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const ficha = fs.readFileSync(path.join(ROOT, 'pages', 'PaginaDetalleLibro.tsx'), 'utf8');
const ds = fs.readFileSync(path.join(ROOT, 'services', 'dataService.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// Predicado real de la ficha, extraído del fuente (sin duplicarlo).
const cond = ficha.match(/\{\((content\.url_recurso \|\| content\.texto_plano_url)\) \? \(/)?.[1];
ok('la ficha decide «legible» con url_recurso || texto_plano_url', !!cond);
const readable = new Function('content', `return !!(${cond});`);

// Forma real del registro Alicia EPUB en producción (read-only, 2026-10-15).
const aliciaServer = {
    id: 'content-1792075191597', tipo: 'libro', url_recurso: '',
    epub_url: '/uploads/content-1792075191597/aventuras_alicia_maravillas_epub_v4-1792075201264-341789848.epub',
    texto_plano_url: '/uploads/content-1792075191597/canonical/book.txt', ttsStatus: 'generando',
};
// Lo que el cliente enviaba (y cacheaba): withEpubSource quita texto_plano_url.
const aliciaPayload = withEpubSource({ id: aliciaServer.id, tipo: 'libro', url_recurso: '' }, aliciaServer.epub_url);

ok('1. sin url_recurso + texto_plano_url → legible', readable({ url_recurso: '', texto_plano_url: '/uploads/x/a.txt' }));
ok('2. registro EPUB del servidor (canonical/book.txt) → legible (NO «Sin archivo legible»)', readable(aliciaServer));
ok('2b. el payload EPUB cacheado antes → NO legible (reproduce el defecto)', !readable(aliciaPayload));
ok('3. url_recurso presente (PDF) → legible, como antes', readable({ url_recurso: '/uploads/x/a.pdf' }));
ok('4. ambos ausentes → «Sin archivo legible»', !readable({ url_recurso: '' }) && /Sin archivo legible/.test(ficha));
ok('5. ttsStatus=error_proveedor + texto → sigue legible (TTS no condiciona)', readable({ ...aliciaServer, ttsStatus: 'error_proveedor' }) && !/ttsStatus/.test(ficha));
ok('6. TXT existente → legible y CTA con texto abre el flujo textual de siempre',
    readable({ texto_plano_url: '/uploads/c/t.txt' }) && /if \(content\.texto_plano_url\) goRead\(`\/leer\/inmersivo\/\$\{content\.id\}`, 'leer-ahora'\);\s*else goRead\(`\/leer\/pdf\/\$\{content\.id\}`, 'leer-ahora'\);/.test(ficha));
ok('la ficha nunca abre epub_url como lector', !/epub_url/.test(ficha));

// Guardado: la caché local refleja el registro del servidor, no el payload.
const save = ds.slice(ds.indexOf('async saveContentToApi('), ds.indexOf('async deleteContent('));
ok('saveContentToApi usa body.content del servidor si es el mismo id',
    /const saved: Content = body\?\.content\?\.id === contentItem\.id \? body\.content : contentItem;/.test(save));
ok('saveContentToApi reemplaza por id (no duplica en edición) o añade si es nuevo',
    /findIndex\(c => c\.id === saved\.id\)/.test(save) && /this\.content\[idx\] = saved;/.test(save) && /this\.agregarContenido\(saved\)/.test(save));
ok('saveContentToApi ya no cachea el payload crudo', !/this\.agregarContenido\(contentItem\)/.test(save));

console.log(`\nEpubDetailReadability.structural — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
