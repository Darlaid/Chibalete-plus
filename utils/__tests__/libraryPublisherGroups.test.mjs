/**
 * libraryPublisherGroups.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-C (CATÁLOGOS-02).
 *
 * Lógica pura de presentación: pestaña «Editoriales», grupos de Búsqueda,
 * lectura de `my-catalog.publishers`, filtros del catálogo administrativo y
 * regla del formulario para el sello. Sin red ni stores.
 *
 *   node utils/__tests__/libraryPublisherGroups.test.mjs
 */
import { groupBooksByPublisher, groupSearchResults } from '../libraryPublisherGroups.mjs';
import { parseMyCatalogPublishers, parseMyCatalogResponse, hydrateVisibleContent } from '../libraryCatalogSelection.mjs';
import { readCatalogFilters, filterCatalog, catalogFacets, NO_PUBLISHER, NO_IMPRINT } from '../adminCatalogFilters.mjs';
import { imprintFormBlock } from '../publisherRequirement.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const book = (id, tipo, publisherId, imprint) => ({ id, tipo, titulo: id, publisherId, ...(imprint ? { imprint } : {}) });
const CH = 'pub-ch', EXT = 'pub-ext', INA = 'pub-ina';
const PUBS = [{ id: CH, name: 'Chibalete Editores' }, { id: EXT, name: 'Externa' }];
const VISIBLE = [
    book('b1', 'libro', CH, 'Estado Sólido'), book('b2', 'libro', CH, 'Chibalete Editores'), book('b3', 'libro', CH),
    book('a1', 'libro_album', CH, 'Estado Sólido'), book('e1', 'libro', EXT), book('e2', 'libro', EXT),
    book('i1', 'libro', INA), book('g1', 'guia', CH), book('v1', 'video', CH), book('b1', 'libro', CH, 'Estado Sólido'),
];

console.log('\n[1] pestaña «Editoriales»');
const blocks = groupBooksByPublisher(VISIBLE, PUBS);
ok('un bloque por editorial pública, por nombre', JSON.stringify(blocks.map((b) => b.name)) === '["Chibalete Editores","Externa"]');
const ch = blocks[0];
ok('Chibalete: sellos en orden alfabético y el grupo general al final',
    JSON.stringify(ch.groups.map((g) => g.imprint)) === JSON.stringify(['Chibalete Editores', 'Estado Sólido', null]), JSON.stringify(ch.groups.map((g) => g.imprint)));
ok('libro y libro-álbum en el mismo sello', JSON.stringify(ch.groups[1].books.map((b) => b.id)) === '["b1","a1"]');
ok('libro sin sello va al grupo general (no se inventa uno)', JSON.stringify(ch.groups[2].books.map((b) => b.id)) === '["b3"]');
ok('editorial sin sellos: un solo grupo general', blocks[1].groups.length === 1 && blocks[1].groups[0].imprint === null);
ok('inactiva o sin nombre público: sin bloque', !blocks.some((b) => b.publisherId === INA));
ok('guías y vídeos no entran (solo libros)', !blocks.flatMap((b) => b.groups.flatMap((g) => g.books)).some((b) => ['g1', 'v1'].includes(b.id)));
const flat = blocks.flatMap((b) => b.groups.flatMap((g) => g.books));
ok('cada ficha una sola vez y la MISMA (mismo objeto, mismo id)', flat.length === new Set(flat.map((b) => b.id)).size && flat.find((b) => b.id === 'b1') === VISIBLE[0]);
ok('sin editoriales públicas → []', groupBooksByPublisher(VISIBLE, []).length === 0);
ok('editorial sin libros visibles → sin bloque', groupBooksByPublisher([book('e1', 'libro', EXT)], PUBS).length === 1);
ok('entradas inválidas → []', groupBooksByPublisher(null, null).length === 0);

console.log('\n[2] Búsqueda');
const groups = groupSearchResults(VISIBLE.slice(0, 9), PUBS);
ok('grupos por editorial real, «Otros libros» y medios', JSON.stringify(groups.map((g) => g.title)) === JSON.stringify(['Libros de Chibalete Editores', 'Libros de Externa', 'Otros libros', 'Videos y podcasts']), JSON.stringify(groups.map((g) => g.title)));
ok('incluye libros-álbum', groups[0].items.some((i) => i.id === 'a1'));
ok('un libro externo NO sale como Chibalete', !groups[0].items.some((i) => i.publisherId === EXT));
ok('libro sin nombre público → «Otros libros», sin atribución', JSON.stringify(groups[2].items.map((i) => i.id)) === '["i1"]');
ok('el texto libre `editorial` ya no atribuye', groupSearchResults([{ id: 'x', tipo: 'libro', editorial: 'Chibalete', publisherId: EXT }], PUBS)[0].title === 'Libros de Externa');
ok('sin resultados → sin grupos', groupSearchResults([], PUBS).length === 0);

console.log('\n[3] my-catalog.publishers (cliente)');
ok('lee id y name; descarta inválidos y repetidos', JSON.stringify(parseMyCatalogPublishers({ publishers: [{ id: 'a', name: 'A', taxId: 'x' }, { id: 'a', name: 'A' }, { id: '', name: 'B' }, { id: 'c' }, null] })) === '[{"id":"a","name":"A"}]');
ok('servidor anterior (sin clave) → []', JSON.stringify(parseMyCatalogPublishers({ success: true, catalog: [] })) === '[]');
ok('cuerpo ilegible → []', JSON.stringify(parseMyCatalogPublishers(null)) === '[]');
const resp = { success: true, catalog: [{ id: 'b1' }], publishers: PUBS };
ok('la clave nueva no cambia la autoridad del conjunto', JSON.stringify(parseMyCatalogResponse(resp)) === '["b1"]'
    && hydrateVisibleContent(parseMyCatalogResponse(resp), VISIBLE).length === 1);

console.log('\n[4] catálogo administrativo');
const LIST = [...VISIBLE.slice(0, 9), { id: 'n1', tipo: 'libro' }, { id: 'p1', tipo: 'podcast', publisherId: CH, status: 'procesando' }];
LIST.forEach((c) => { if (!c.status) c.status = 'disponible'; });
const fx = (q) => readCatalogFilters(new URLSearchParams(q));
ok('lee editorial, clase, sello y estado de la URL', JSON.stringify(fx('editorial=pub-ch&clase=libros&sello=X&estado=error')) === '{"editorial":"pub-ch","clase":"libros","sello":"X","estado":"error"}');
ok('clase desconocida se ignora', fx('clase=todo').clase === null);
const ids = (f) => filterCatalog(LIST, f).map((c) => c.id).join(',');
ok('editorial: todo su contenido (libros y recursos)', ids({ editorial: CH }) === 'b1,b2,b3,a1,g1,v1,p1');
ok('libros de la editorial', ids({ editorial: CH, clase: 'libros' }) === 'b1,b2,b3,a1');
ok('recursos de la editorial', ids({ editorial: CH, clase: 'recursos' }) === 'g1,v1,p1');
ok('por sello', ids({ editorial: CH, sello: 'Estado Sólido' }) === 'b1,a1');
ok('sin sello', ids({ editorial: CH, clase: 'libros', sello: NO_IMPRINT }) === 'b3');
ok('por estado', ids({ editorial: CH, estado: 'procesando' }) === 'p1');
ok('libros sin editorial (regularizar)', ids({ editorial: NO_PUBLISHER }) === 'n1');
ok('sin filtros: todo el catálogo', filterCatalog(LIST, {}).length === LIST.length);
const facets = catalogFacets(filterCatalog(LIST, { editorial: CH }));
ok('conteos libros/recursos = regla del servidor (libro, libro_album)', facets.libros === 4 && facets.recursos === 3);
ok('opciones de sello y estado presentes', JSON.stringify(facets.imprints) === JSON.stringify(['__sin_sello__', 'Chibalete Editores', 'Estado Sólido']) && JSON.stringify(facets.statuses) === '["disponible","procesando"]', JSON.stringify(facets));
ok('filtrar no muta la lista', LIST.length === 11 && LIST[0].id === 'b1');

console.log('\n[5] formulario: sello');
const blk = (o) => imprintFormBlock({ publisherImprints: ['A Uno'], publisherId: 'pa', originalPublisherId: 'pa', ...o });
ok('sin sello → ok', blk({ imprint: '' }) === null);
ok('sello de la editorial → ok', blk({ imprint: 'A Uno' }) === null);
ok('sello ajeno → bloqueo', typeof blk({ imprint: 'B Uno' }) === 'string');
ok('sello guardado retirado de la lista, misma editorial → se conserva', blk({ imprint: 'Viejo', originalImprint: 'Viejo' }) === null);
ok('…y al cambiar de editorial → bloqueo que lo explica', /no pertenece a la nueva editorial/.test(blk({ imprint: 'Viejo', originalImprint: 'Viejo', originalPublisherId: 'pz' }) || ''));
ok('sello sin editorial → bloqueo', typeof blk({ imprint: 'A Uno', publisherId: '' }) === 'string');

console.log(`\nlibraryPublisherGroups — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
