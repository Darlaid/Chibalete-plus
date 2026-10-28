/**
 * publisherCatalog.test.mjs — EDITORIALES-CATALOGO-01.
 *
 * Agrupación por sello del catálogo de una editorial (puro, sin red ni stores)
 * y paridad del conteo de libros con el servidor (publisherCompliance, que da
 * `bookCount` en /api/admin/publishers?withCounts=1).
 *
 *   node utils/__tests__/publisherCatalog.test.mjs
 */
import { publisherCatalog, isbnOf, NO_IMPRINT } from '../publisherCatalog.mjs';
import { publisherCompliance } from '../../server/royalties/publisherAssignment.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const A = { id: 'pub-a', imprints: ['Sello Uno', 'Sello Dos', 'Sello Vacío'] };   // varios sellos, uno sin libros
const B = { id: 'pub-b', imprints: ['Único'] };                                    // un sello
const C = { id: 'pub-c', imprints: [] };                                           // sin catálogo
const book = (id, extra = {}) => ({ id, titulo: `Libro ${id}`, autor: 'Autora', tipo: 'libro', status: 'disponible', publisherId: 'pub-a', ...extra });
const LIST = [
    book('a1', { imprint: 'Sello Uno', isbn: '978-958-00-0000-1' }),
    book('a2', { imprint: 'Sello Uno', tipo: 'libro_album' }),
    book('a3', { imprint: 'Sello Dos' }),
    book('a4'),                                                     // sin sello
    book('a5', { titulo: 'Estado Sólido', autor: 'Sello Dos' }),    // no se deduce sello por título ni autoría
    book('a6', { imprint: 'Sello Retirado' }),                       // sello guardado que ya no figura en la editorial
    book('a7', { parentId: 'col-1', isCollection: false }),          // libro dentro de una colección: sin sello propio
    book('a1', { imprint: 'Sello Uno' }),                            // duplicado del mismo id
    { id: 'g1', titulo: 'Guía', tipo: 'guia', publisherId: 'pub-a' },                       // recurso
    { id: 'p1', titulo: 'Contexto', tipo: 'contexto_pedagogico', publisherId: 'pub-a' },    // recurso pedagógico
    book('b1', { publisherId: 'pub-b', imprint: 'Único', isbn: '  ' }),
    book('r1', { publisherId: 'pub-b' }),                            // reasignado A → B: hoy cuenta solo en B
    book('x1', { publisherId: null }),                               // sin editorial
];

console.log('[1] editorial con varios sellos');
const a = publisherCatalog(LIST, A);
const g = (cat, key) => cat.groups.find((x) => x.key === key);
ok('total de libros sin recursos ni duplicados (7)', a.books === 7, String(a.books));
ok('recursos aparte (guía y contexto pedagógico)', a.resources === 2);
ok('orden: sellos registrados, no registrados, «Sin sello asignado» al final',
    a.groups.map((x) => x.key).join('|') === ['Sello Uno', 'Sello Dos', 'Sello Vacío', 'Sello Retirado', NO_IMPRINT].join('|'), a.groups.map((x) => x.key).join('|'));
ok('Sello Uno: a1 y a2 (libro álbum incluido), sin duplicar a1', g(a, 'Sello Uno').books.map((b) => b.id).join() === 'a1,a2');
ok('sello registrado sin libros se mantiene visible y vacío', g(a, 'Sello Vacío').books.length === 0 && g(a, 'Sello Vacío').registered);
ok('sello guardado no registrado: se muestra y se marca', g(a, 'Sello Retirado').books.map((b) => b.id).join() === 'a6' && g(a, 'Sello Retirado').registered === false);
ok('sin sello: a4, a5 (título/autoría no asignan sello) y a7 (colección no asigna sello)', g(a, NO_IMPRINT).books.map((b) => b.id).sort().join() === 'a4,a5,a7');
ok('Σ títulos por grupo = total de libros', a.groups.reduce((s, x) => s + x.books.length, 0) === a.books);
ok('ningún título en dos grupos', new Set(a.groups.flatMap((x) => x.books.map((b) => b.id))).size === a.books);

console.log('\n[2] editorial de un sello, reasignación y sin catálogo');
const b = publisherCatalog(LIST, B);
ok('editorial de un sello: b1 en «Único», r1 (reasignado) sin sello', g(b, 'Único').books.map((x) => x.id).join() === 'b1' && g(b, NO_IMPRINT).books.map((x) => x.id).join() === 'r1');
ok('el libro reasignado ya no cuenta en la editorial anterior', !a.groups.some((x) => x.books.some((y) => y.id === 'r1')));
const c = publisherCatalog(LIST, C);
ok('editorial sin catálogo: 0 libros, solo «Sin sello asignado» vacío', c.books === 0 && c.resources === 0 && c.groups.length === 1 && c.groups[0].key === NO_IMPRINT);
ok('lista vacía o nula no rompe', publisherCatalog(null, A).books === 0 && publisherCatalog([], A).groups.length === 4);

console.log('\n[3] ISBN');
ok('ISBN registrado', isbnOf(LIST[0]) === '978-958-00-0000-1');
ok('sin ISBN (ausente o en blanco) → null', isbnOf(LIST[2]) === null && isbnOf(LIST[10]) === null);

console.log('\n[4] paridad con el conteo del servidor (bookCount)');
const uniq = [...new Map(LIST.map((x) => [x.id, x])).values()];
const { byPublisher } = publisherCompliance(uniq, [A, B, C]);
ok('pub-a: libros y contenidos = servidor', byPublisher['pub-a'].books === a.books && byPublisher['pub-a'].contents === a.books + a.resources);
ok('pub-b: libros = servidor', byPublisher['pub-b'].books === b.books);
ok('pub-c: sin entrada en el servidor y 0 libros', !byPublisher['pub-c'] && c.books === 0);

console.log('\n[5] solo lectura');
const before = JSON.stringify(LIST);
publisherCatalog(LIST, A); publisherCatalog(LIST, B);
ok('no modifica la lista ni asigna sellos', JSON.stringify(LIST) === before);

console.log(`\npublisherCatalog — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
