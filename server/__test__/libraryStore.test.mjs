/**
 * libraryStore.test.mjs — CHP-LIB-01.
 *
 * Gates obligatorios de la unidad:
 *  §7 no-duplicación (referencia ≠ copia de Book)
 *  §8 autorización (Biblioteca no concede acceso; publication_state se respeta)
 *  §11 modelo (constraints, unicidad, ciclo de vida)
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    LAYERS, emptyLibrary, normalizeLibrary,
    addReference, removeReference, reorderReference,
    addCollection, updateCollection, computeEditorialView,
} from '../lib/libraryStore.js';
import { mapBundlesToEditorial } from '../../scripts/library/migrateEditorialBundles.mjs';

const CATALOG = [
    { id: 'content-A', titulo: 'Libro A', autor: 'X', tipo: 'libro', status: 'disponible', portada_url: '/uploads/a.jpg', descripcion_corta: '', etiquetas: [] },
    { id: 'content-B', titulo: 'Libro B', autor: 'Y', tipo: 'libro', status: 'disponible', portada_url: '/uploads/b.jpg', descripcion_corta: '', etiquetas: [] },
    { id: 'content-C', titulo: 'Libro C', autor: 'Z', tipo: 'libro', status: 'retirado', portada_url: '/uploads/c.jpg', descripcion_corta: '', etiquetas: [] },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);
const frozenCatalog = JSON.stringify(CATALOG);

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

// ── §11 modelo y constraints ────────────────────────────────────────────────
t('capas congeladas exactas', () => {
    assert.deepEqual([...LAYERS], ['EDITORIAL', 'INSTITUTIONAL', 'PERSONAL']);
});

t('layer inválida rechazada', () => {
    assert.throws(() => addReference(emptyLibrary(), { bookId: 'content-A', layer: 'PIRATA' }, bookExists), /layer inválida/);
});

t('bookId inexistente en catálogo canónico rechazado (integridad)', () => {
    assert.throws(() => addReference(emptyLibrary(), { bookId: 'content-NOPE' }, bookExists), (e) => e.code === 'BOOK_NOT_FOUND');
});

t('collectionId inexistente rechazado', () => {
    assert.throws(() => addReference(emptyLibrary(), { bookId: 'content-A', collectionId: 'col-nope' }, bookExists), (e) => e.code === 'COLLECTION_NOT_FOUND');
});

t('unicidad (layer, contextId, collectionId, bookId): re-añadir = no-op idempotente', () => {
    const doc = emptyLibrary();
    const first = addReference(doc, { bookId: 'content-A' }, bookExists);
    const second = addReference(doc, { bookId: 'content-A' }, bookExists);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.reference.id, first.reference.id);
    assert.equal(doc.references.length, 1);
});

t('mismo libro en contextos distintos SÍ genera referencias distintas (Caso D)', () => {
    const doc = emptyLibrary();
    const col = addCollection(doc, { name: 'Col 1' });
    addReference(doc, { bookId: 'content-A' }, bookExists);
    addReference(doc, { bookId: 'content-A', collectionId: col.id }, bookExists);
    addReference(doc, { bookId: 'content-A', layer: 'PERSONAL', contextId: 'user-1' }, bookExists);
    assert.equal(doc.references.length, 3);
});

// ── §7 NO DUPLICACIÓN (gate obligatorio) ────────────────────────────────────
t('§7 añadir referencia NO crea Book, NO copia metadata canónica, apunta al mismo bookId', () => {
    const doc = emptyLibrary();
    const { reference } = addReference(doc, { bookId: 'content-A' }, bookExists);
    // 1-2: el catálogo canónico existe y NO fue mutado (ni un byte)
    assert.equal(JSON.stringify(CATALOG), frozenCatalog);
    // 3: no hay ningún Book dentro de library
    assert.deepEqual(Object.keys(reference).sort(), ['bookId', 'collectionId', 'contextId', 'createdAt', 'id', 'layer', 'position', 'updatedAt']);
    assert.ok(!('titulo' in reference) && !('portada_url' in reference) && !('url_recurso' in reference), 'la referencia no almacena metadata canónica');
    // 6: apunta al mismo bookId
    assert.equal(reference.bookId, 'content-A');
});

t('§7 eliminar la referencia NO elimina el contenido; re-añadir no duplica', () => {
    const doc = emptyLibrary();
    const { reference } = addReference(doc, { bookId: 'content-A' }, bookExists);
    assert.equal(removeReference(doc, reference.id), true);
    assert.equal(doc.references.length, 0);
    assert.equal(JSON.stringify(CATALOG), frozenCatalog, 'el Book canónico sobrevive a la referencia');
    addReference(doc, { bookId: 'content-A' }, bookExists);
    addReference(doc, { bookId: 'content-A' }, bookExists);
    assert.equal(doc.references.length, 1, 're-añadir tras borrar no duplica');
});

// ── §8 AUTORIZACIÓN Y VISIBILIDAD (gate obligatorio) ────────────────────────
t('§8-A referencia + publicado → visible en la vista editorial', () => {
    const doc = emptyLibrary();
    const col = addCollection(doc, { name: 'Selección' });
    updateCollection(doc, col.id, { published: true });
    addReference(doc, { bookId: 'content-A', collectionId: col.id }, bookExists);
    const view = computeEditorialView(doc, CATALOG);
    assert.equal(view.collections.length, 1);
    assert.equal(view.collections[0].references[0].bookId, 'content-A');
});

t('§8-B la vista NO contiene NINGÚN campo de autorización (Biblioteca no concede acceso)', () => {
    const doc = emptyLibrary();
    addReference(doc, { bookId: 'content-A' }, bookExists);
    const json = JSON.stringify(computeEditorialView(doc, CATALOG));
    for (const forbidden of ['allowed', 'entitled', 'entitlement', 'access']) {
        assert.ok(!json.includes(`"${forbidden}"`), `la vista no debe emitir "${forbidden}" — abrir pasa por el preflight canónico`);
    }
});

t('§8-C unpublished no se expone: colección sin publicar oculta; libro retirado oculto (Caso G)', () => {
    const doc = emptyLibrary();
    const col = addCollection(doc, { name: 'Borrador' }); // published=false por defecto
    addReference(doc, { bookId: 'content-A', collectionId: col.id }, bookExists);
    addReference(doc, { bookId: 'content-C' }, bookExists); // status=retirado
    const view = computeEditorialView(doc, CATALOG);
    assert.equal(view.collections.length, 0, 'colección no publicada invisible para lectores');
    assert.equal(view.unassigned.length, 0, 'libro no disponible = referencia dormida, no visible');
    const admin = computeEditorialView(doc, CATALOG, { includeUnpublished: true });
    assert.equal(admin.collections.length, 1, 'el administrador sí ve la colección borrador');
});

t('§8-D libro sin referencia editorial NO aparece en la capa', () => {
    const doc = emptyLibrary();
    addReference(doc, { bookId: 'content-A' }, bookExists);
    const json = JSON.stringify(computeEditorialView(doc, CATALOG));
    assert.ok(!json.includes('content-B'), 'content-B no está referenciado → ausente de Editorial');
});

t('§8-E estructural: el dominio de Biblioteca no conoce el access engine', () => {
    const raw = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'libraryStore.js'), 'utf8');
    // Analizar SOLO código (los comentarios documentan la prohibición y la mencionan).
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['access_db', 'ACCESS_DB', 'accessRule', 'grantAccess', 'readJSON', 'writeJSON', 'fs.']) {
        assert.ok(!code.includes(forbidden), `el código de libraryStore.js no debe contener "${forbidden}" — dominio puro, autoridad = preflight existente`);
    }
});

// ── vista: proyección y orden ───────────────────────────────────────────────
t('vista proyecta metadata canónica al vuelo (join, no copia) y respeta position', () => {
    const doc = emptyLibrary();
    const col = addCollection(doc, { name: 'Orden' });
    updateCollection(doc, col.id, { published: true });
    const r1 = addReference(doc, { bookId: 'content-A', collectionId: col.id }, bookExists).reference;
    addReference(doc, { bookId: 'content-B', collectionId: col.id }, bookExists);
    reorderReference(doc, r1.id, 99);
    const refs = computeEditorialView(doc, CATALOG).collections[0].references;
    assert.deepEqual(refs.map(r => r.bookId), ['content-B', 'content-A'], 'orden por position');
    assert.equal(refs[1].book.titulo, 'Libro A', 'metadata viene del catálogo canónico en el join');
});

t('referencia a libro borrado del catálogo se omite sin romper la vista', () => {
    const doc = emptyLibrary();
    addReference(doc, { bookId: 'content-A' }, bookExists);
    const view = computeEditorialView(doc, CATALOG.filter(c => c.id !== 'content-A'));
    assert.equal(view.unassigned.length, 0);
});

t('normalizeLibrary tolera archivo ausente/array/basura', () => {
    assert.deepEqual(normalizeLibrary([]), { collections: [], references: [] });
    assert.deepEqual(normalizeLibrary(null), { collections: [], references: [] });
    assert.deepEqual(normalizeLibrary({ collections: 'x' }), { collections: [], references: [] });
});

// ── §9 migración editorial (mapping puro) ───────────────────────────────────
t('migración: bundles → colecciones publicadas + referencias; idempotente; huérfanos reportados sin migrar', () => {
    const bundles = [
        { id: 'b1', name: 'Primeros', shortDescription: 'd', contentIds: ['content-A', 'content-B', 'content-A'] },
        { id: 'b2', name: 'Rotos', contentIds: ['content-NOPE'] },
    ];
    const { doc, report } = mapBundlesToEditorial(bundles, CATALOG, emptyLibrary());
    assert.equal(report.bundlesDetected, 2);
    assert.equal(report.collectionsCreated, 2);
    assert.equal(report.referencesCreated, 2, 'A y B; el A repetido dedupe');
    assert.equal(report.duplicatesSkipped, 1);
    assert.deepEqual(report.orphanContentIds, [{ bundleId: 'b2', bookId: 'content-NOPE' }]);
    assert.ok(doc.collections.every(c => c.published === true), 'bundles expuestos hoy migran publicados');
    // idempotencia: re-ejecutar sobre el resultado no crea nada nuevo
    const again = mapBundlesToEditorial(bundles, CATALOG, doc);
    assert.equal(again.report.referencesCreated, 0);
    assert.equal(again.report.collectionsCreated, 0);
    assert.equal(again.doc.references.length, doc.references.length);
});

console.log(`libraryStore.test.mjs OK — ${passed} escenarios`);
