/**
 * publisherImprint.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-C (CATÁLOGOS-02).
 *
 * Unidad pura de `resolveImprint` y `publicPublishersForCatalog`.
 * Sin red ni stores (PublisherError viene del módulo, sin abrir la base).
 *
 *   node server/royalties/__test__/publisherImprint.test.mjs
 */
import { resolveImprint, publicPublishersForCatalog } from '../publisherAssignment.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code || e.message; } };

const SELLOS = { 'pub-a': ['A Uno', 'A Dos'], 'pub-b': ['B Uno'] };
let lookups = 0;
const imprintsFor = (pid) => { lookups++; return SELLOS[pid] ?? []; };
const run = (o) => resolveImprint({ imprintsFor, ...o });

console.log('\n[resolveImprint]');
ok('alta sin imprint → sin sello', run({ sent: false, stored: null, publisherId: 'pub-a' }).imprint === null);
ok('alta con sello de su editorial', run({ sent: true, value: 'A Dos', stored: null, publisherId: 'pub-a' }).imprint === 'A Dos');
ok('recorta espacios', run({ sent: true, value: '  A Uno ', stored: null, publisherId: 'pub-a' }).imprint === 'A Uno');
ok('sello ajeno → imprint_invalid', codeOf(() => run({ sent: true, value: 'B Uno', stored: null, publisherId: 'pub-a' })) === 'imprint_invalid');
ok('sello inexistente → imprint_invalid', codeOf(() => run({ sent: true, value: 'Z', stored: null, publisherId: 'pub-a' })) === 'imprint_invalid');
ok('no-texto → imprint_invalid', codeOf(() => run({ sent: true, value: 7, stored: null, publisherId: 'pub-a' })) === 'imprint_invalid');
ok('sello sin editorial → imprint_invalid', codeOf(() => run({ sent: true, value: 'A Uno', stored: null, publisherId: null })) === 'imprint_invalid');
ok("'' quita el sello", run({ sent: true, value: '', stored: { publisherId: 'pub-a', imprint: 'A Uno' }, publisherId: 'pub-a' }).imprint === null);
ok('null quita el sello', run({ sent: true, value: null, stored: { publisherId: 'pub-a', imprint: 'A Uno' }, publisherId: 'pub-a' }).imprint === null);
lookups = 0;
ok('no enviado → conserva el guardado', run({ sent: false, stored: { publisherId: 'pub-a', imprint: 'Retirado' }, publisherId: 'pub-a' }).imprint === 'Retirado');
ok('…aunque ya no esté en la lista, y sin consultar la base', lookups === 0);
ok('reenviar el mismo sello retirado, misma editorial → se conserva', run({ sent: true, value: 'Retirado', stored: { publisherId: 'pub-a', imprint: 'Retirado' }, publisherId: 'pub-a' }).imprint === 'Retirado');
ok('reasignar conservando un sello ajeno a la nueva → imprint_invalid (no se borra)',
    codeOf(() => run({ sent: false, stored: { publisherId: 'pub-a', imprint: 'A Uno' }, publisherId: 'pub-b' })) === 'imprint_invalid');
ok('reasignar con un sello de la nueva → ok', run({ sent: true, value: 'B Uno', stored: { publisherId: 'pub-a', imprint: 'A Uno' }, publisherId: 'pub-b' }).imprint === 'B Uno');
ok("reasignar quitando el sello ('') → ok", run({ sent: true, value: '', stored: { publisherId: 'pub-a', imprint: 'A Uno' }, publisherId: 'pub-b' }).imprint === null);
ok('cambiar a otro sello de la misma editorial', run({ sent: true, value: 'A Dos', stored: { publisherId: 'pub-a', imprint: 'A Uno' }, publisherId: 'pub-a' }).imprint === 'A Dos');

console.log('\n[publicPublishersForCatalog]');
const PUBS = [
    { id: 'pub-a', status: 'active', legalName: 'A Legal S.A.S.', tradeName: 'Alfa', taxId: '900', contactEmail: 'x@a.test', notes: 'n', imprints: ['A Uno'] },
    { id: 'pub-b', status: 'active', legalName: 'Beta Legal', tradeName: null },
    { id: 'pub-i', status: 'inactive', legalName: 'Inactiva' },
    { id: 'pub-g', status: 'active', legalName: 'Solo guías' },
];
const CAT = [
    { id: '1', tipo: 'libro', publisherId: 'pub-b' }, { id: '2', tipo: 'libro_album', publisherId: 'pub-a' },
    { id: '3', tipo: 'libro', publisherId: 'pub-i' }, { id: '4', tipo: 'guia', publisherId: 'pub-g' }, { id: '5', tipo: 'libro' },
];
const out = publicPublishersForCatalog(CAT, PUBS);
ok('activas con libros visibles, por nombre', JSON.stringify(out) === JSON.stringify([{ id: 'pub-a', name: 'Alfa' }, { id: 'pub-b', name: 'Beta Legal' }]), JSON.stringify(out));
ok('sin NIT, contacto, notas, sellos ni estado', out.every((p) => JSON.stringify(Object.keys(p).sort()) === '["id","name"]'));
ok('catálogo vacío → []', publicPublishersForCatalog([], PUBS).length === 0);
ok('entradas inválidas → []', publicPublishersForCatalog(null, null).length === 0);

console.log(`\npublisherImprint — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
