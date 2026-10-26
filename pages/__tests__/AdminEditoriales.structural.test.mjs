/**
 * AdminEditoriales.structural.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-B.
 *
 * Ratchet estructural del front: página /admin/editoriales solo para
 * administradores y sin borrado; formulario de carga con editorial
 * obligatoria para libros, sin «Sin editorial asignada» en libros,
 * confirmación expresa de reasignación y sin pérdida de la asociación si la
 * lista de editoriales no carga. Sin red ni stores.
 *
 *   node pages/__tests__/AdminEditoriales.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const page = read('pages', 'AdminEditoriales.tsx');
const form = read('pages', 'SubirContenido.tsx');
const app = read('App.tsx');
const perms = read('config', 'routePermissions.ts');
const nav = read('components', 'Navbar.tsx');
const ds = read('services', 'dataService.ts');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

console.log('[1] ruta y acceso');
ok('ruta /admin/editoriales con ProtectedRoute', /path="\/admin\/editoriales"[\s\S]{0,200}ProtectedRoute access=\{getRouteAccess\('\/admin\/editoriales'\)\}[\s\S]{0,80}<AdminEditoriales \/>/.test(app));
ok('permiso de la ruta: admin', /path: '\/admin\/editoriales',\s*access: 'admin'/.test(perms));
ok('la página se protege también por rol', /user\.roles\.includes\('administrador'\)/.test(page));
ok('entrada «Editoriales» solo en el bloque de administración (escritorio y móvil)', (nav.match(/to: '\/admin\/editoriales'/g) || []).length === 2 && /userIsAdmin \? \[[\s\S]{0,700}\/admin\/editoriales/.test(nav));

console.log('\n[2] administración de editoriales');
ok('reutiliza /api/admin/publishers (alta POST, edición PUT)', /admin\/publishers\$\{id \? `\/\$\{encodeURIComponent\(id\)\}` : ''\}/.test(ds) && /method: id \? 'PUT' : 'POST'/.test(ds));
ok('sin borrado desde la interfaz', !/method:\s*'DELETE'/.test(page) && !/deletePublisher|Eliminar/.test(page) && !/admin\/publishers[^\n]*DELETE/.test(ds));
ok('activar / desactivar por status', /status: next/.test(page) && /'Desactivar' : 'Activar'/.test(page));
ok('identificación, contacto y sellos', ['legalName', 'tradeName', 'taxId', 'imprints', 'contactName', 'contactEmail', 'contactPhone'].every((k) => page.includes(`key: '${k}'`)));
ok('número de libros asociados (withCounts)', /getAdminPublishers\(\{ withCounts: true \}\)/.test(page) && /p\.bookCount/.test(page));
// F1-C (CATÁLOGOS-02): el conteo de libros y el de recursos abren cada uno su catálogo filtrado.
ok('navegación al catálogo filtrado por editorial: libros', /to=\{`\/subir-contenido\?editorial=\$\{encodeURIComponent\(p\.id\)\}&clase=libros`\}/.test(page));
ok('navegación al catálogo filtrado por editorial: recursos', /to=\{`\/subir-contenido\?editorial=\$\{encodeURIComponent\(p\.id\)\}&clase=recursos`\}/.test(page));
ok('acceso a libros sin editorial para regularizar', /\/subir-contenido\?editorial=__sin_editorial__/.test(page));
ok('aclara que la editorial no acredita derechos económicos', /no acredita por sí sola derechos económicos/.test(page));

console.log('\n[3] formulario de carga');
ok('etiqueta «Editorial responsable» sin «(Opcional)» para libros', /\{isBookNow \? 'Editorial responsable' : 'Editorial responsable \(Opcional\)'\}/.test(form));
ok('libros: sin opción «Sin editorial asignada» (placeholder deshabilitado)', /isBookNow\s*\?\s*<option value="" disabled>Selecciona una editorial…<\/option>\s*:\s*<option value="">Sin editorial asignada<\/option>/.test(form));
ok('select required en libros', /required=\{isBookNow\}/.test(form));
ok('validación antes de subir archivos', /publisherFormBlock\(\{[\s\S]{0,800}if \(publisherBlock \|\| imprintBlock\)[\s\S]{0,200}return;[\s\S]*uploadIfFile\(asEpubUploadFile/.test(form));
ok('lista no cargada ⇒ no se envía publisherId (se conserva la guardada)', /\.\.\.\(publishers !== null \? \{\s*publisherId,/.test(form));
ok('reasignación: casilla de confirmación expresa y bandera en la petición', /publisherReassigning && \(/.test(form) && /type="checkbox" checked=\{publisherReassignConfirmed\}/.test(form) && /\{ publisherReassignConfirmed: true \}/.test(form));
ok('cambiar la selección anula la confirmación previa', /setPublisherId\(e\.target\.value\); setPublisherReassignConfirmed\(false\);/.test(form));
ok('gestión filtrable por ?editorial=', /searchParams\.get\('editorial'\)/.test(form) && /\{managedContents\.map\(content => \(/.test(form));
ok('los materiales hijos (recursos) no cambian de contrato', /const childContent: Content = \{(?:(?!publisherId)[\s\S]){0,2000}?\} as Content;/.test(form) && !/childContent[^\n]*publisherId/.test(form));

console.log('\n[4] F1-C (CATÁLOGOS-02): sello, catálogo administrativo y Búsqueda');
const search = read('pages', 'Busqueda.tsx');
ok('selector «Sello» con los sellos de la editorial elegida y «Sin sello»', /id="sc-imprint"/.test(form) && /<option value="">Sin sello<\/option>/.test(form) && /selectedPublisherImprints\.map/.test(form));
ok('el sello viaja con la editorial (solo si la lista cargó; \'\' = sin sello)', /\.\.\.\(publishers !== null \? \{\s*publisherId,\s*imprint,/.test(form));
ok('validación del sello antes de subir archivos (espejo del servidor)', /imprintFormBlock\(\{/.test(form));
ok('editar carga el sello guardado', /setImprint\(content\.imprint \|\| ''\);\s*setOriginalImprint\(content\.imprint \|\| ''\);/.test(form));
ok('filtros clase/sello/estado de presentación sobre la misma lista', /readCatalogFilters\(searchParams\)/.test(form) && /const managedContents = filterCatalog\(existingParents, catalogFilters\);/.test(form));
ok('«Editar» abre la ficha desde el catálogo filtrado', /onClick=\{\(\) => handleEditContent\(content\)\}/.test(form));
ok('fichas nuevas sin el texto fijo editorial: \'Chibalete\'', !/editorial: 'Chibalete'/.test(form));
ok('Búsqueda agrupa por editorial real, no por el texto libre', /groupSearchResults\(results, publishers\)/.test(search) && !/\.editorial ===/.test(search));
ok('Búsqueda toma los nombres de my-catalog, no de endpoints administrativos', /dataService\.getMyCatalog\(\)\.then\(\(\) => setPublishers\(dataService\.getVisiblePublishers\(\)\)\)/.test(search) && !/getAdminPublishers|admin\/publishers/.test(search));
ok('Búsqueda conserva su fuente de resultados', /dataService\.buscarContenido\(query, user\.roles\)/.test(search));

console.log(`\nAdminEditoriales.structural — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
