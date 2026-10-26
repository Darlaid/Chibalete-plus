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
ok('navegación al catálogo filtrado por editorial', /to=\{`\/subir-contenido\?editorial=\$\{encodeURIComponent\(p\.id\)\}`\}/.test(page));
ok('acceso a libros sin editorial para regularizar', /\/subir-contenido\?editorial=__sin_editorial__/.test(page));
ok('aclara que la editorial no acredita derechos económicos', /no acredita por sí sola derechos económicos/.test(page));

console.log('\n[3] formulario de carga');
ok('etiqueta «Editorial responsable» sin «(Opcional)» para libros', /\{isBookNow \? 'Editorial responsable' : 'Editorial responsable \(Opcional\)'\}/.test(form));
ok('libros: sin opción «Sin editorial asignada» (placeholder deshabilitado)', /isBookNow\s*\?\s*<option value="" disabled>Selecciona una editorial…<\/option>\s*:\s*<option value="">Sin editorial asignada<\/option>/.test(form));
ok('select required en libros', /required=\{isBookNow\}/.test(form));
ok('validación antes de subir archivos', /publisherFormBlock\(\{[\s\S]{0,400}if \(publisherBlock\)[\s\S]{0,200}return;[\s\S]*uploadIfFile\(asEpubUploadFile/.test(form));
ok('lista no cargada ⇒ no se envía publisherId (se conserva la guardada)', /\.\.\.\(publishers !== null \? \{\s*publisherId,/.test(form));
ok('reasignación: casilla de confirmación expresa y bandera en la petición', /publisherReassigning && \(/.test(form) && /type="checkbox" checked=\{publisherReassignConfirmed\}/.test(form) && /\{ publisherReassignConfirmed: true \}/.test(form));
ok('cambiar la selección anula la confirmación previa', /setPublisherId\(e\.target\.value\); setPublisherReassignConfirmed\(false\);/.test(form));
ok('gestión filtrable por ?editorial=', /searchParams\.get\('editorial'\)/.test(form) && /\{managedContents\.map\(content => \(/.test(form));
ok('los materiales hijos (recursos) no cambian de contrato', /const childContent: Content = \{(?:(?!publisherId)[\s\S]){0,2000}?\} as Content;/.test(form) && !/childContent[^\n]*publisherId/.test(form));

console.log(`\nAdminEditoriales.structural — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
