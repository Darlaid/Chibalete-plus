/**
 * libraryLayerViews.test.mjs
 * CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-2 §§2, 3, 4, 18, 21, 24, 25.
 *
 * Dominio PURO de la generalización por capa. Dos preguntas:
 *
 *   1. ¿La capa EDITORIAL sigue comportándose exactamente igual después de
 *      delegar en `computeLayerView`? (§2 contrato congelado, §25 regresión)
 *   2. ¿La vista de una capa aísla su contexto y NUNCA convierte una
 *      referencia en autorización? (§4, §6, §11, §24)
 *
 * Sin I/O: el dominio de Biblioteca no abre ficheros. Stores reales: 0 lecturas,
 * 0 escrituras.
 *
 *   node server/__test__/libraryLayerViews.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    emptyLibrary, addReference, addCollection, updateCollection, reorderReference,
    computeEditorialView, computeLayerView,
    findScopedReference, findScopedCollection,
} from '../lib/libraryStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const ORG_A = 'org-alfa', ORG_B = 'org-beta';
const USER_A = 'u-ana', USER_B = 'u-bruno';

const CATALOG = [
    { id: 'c-1', titulo: 'Uno',   autor: 'A', tipo: 'libro', status: 'disponible', portada_url: '/u/1.jpg', descripcion_corta: '', etiquetas: [] },
    { id: 'c-2', titulo: 'Dos',   autor: 'B', tipo: 'libro', status: 'disponible', portada_url: '/u/2.jpg', descripcion_corta: '', etiquetas: [] },
    { id: 'c-3', titulo: 'Tres',  autor: 'C', tipo: 'libro', status: 'disponible', portada_url: '/u/3.jpg', descripcion_corta: '', etiquetas: [] },
    { id: 'c-off', titulo: 'Retirado', autor: 'D', tipo: 'libro', status: 'retirado', portada_url: '', descripcion_corta: '', etiquetas: [] },
    { id: 'c-emb', titulo: 'Nodo', autor: 'E', tipo: 'guia', status: 'disponible', standalone: false, portada_url: '', descripcion_corta: '', etiquetas: [] },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);
const FROZEN_CATALOG = JSON.stringify(CATALOG);

/** Documento con las TRES capas pobladas: el ruido de unas no debe tocar a otras. */
function richDoc() {
    const doc = emptyLibrary();

    // EDITORIAL — 1 colección publicada, 1 borrador, 1 referencia suelta.
    const ePub = addCollection(doc, { layer: 'EDITORIAL', name: 'Selección' });
    updateCollection(doc, ePub.id, { published: true });
    const eDraft = addCollection(doc, { layer: 'EDITORIAL', name: 'Borrador' });
    addReference(doc, { bookId: 'c-1', layer: 'EDITORIAL', collectionId: ePub.id }, bookExists);
    addReference(doc, { bookId: 'c-2', layer: 'EDITORIAL', collectionId: eDraft.id }, bookExists);
    addReference(doc, { bookId: 'c-3', layer: 'EDITORIAL' }, bookExists);
    addReference(doc, { bookId: 'c-off', layer: 'EDITORIAL' }, bookExists);

    // INSTITUTIONAL — dos organizaciones distintas.
    const iA = addCollection(doc, { layer: 'INSTITUTIONAL', contextId: ORG_A, name: 'Plan lector A' });
    updateCollection(doc, iA.id, { published: true });
    const iADraft = addCollection(doc, { layer: 'INSTITUTIONAL', contextId: ORG_A, name: 'Borrador A' });
    const iB = addCollection(doc, { layer: 'INSTITUTIONAL', contextId: ORG_B, name: 'Plan lector B' });
    updateCollection(doc, iB.id, { published: true });
    addReference(doc, { bookId: 'c-1', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: iA.id }, bookExists);
    addReference(doc, { bookId: 'c-2', layer: 'INSTITUTIONAL', contextId: ORG_A }, bookExists);
    addReference(doc, { bookId: 'c-3', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: iADraft.id }, bookExists);
    addReference(doc, { bookId: 'c-3', layer: 'INSTITUTIONAL', contextId: ORG_B, collectionId: iB.id }, bookExists);

    // PERSONAL — dos usuarios distintos.
    addReference(doc, { bookId: 'c-1', layer: 'PERSONAL', contextId: USER_A }, bookExists);
    addReference(doc, { bookId: 'c-2', layer: 'PERSONAL', contextId: USER_A }, bookExists);
    addReference(doc, { bookId: 'c-3', layer: 'PERSONAL', contextId: USER_B }, bookExists);

    return { doc, ids: { ePub, eDraft, iA, iADraft, iB } };
}

const flat = (view) => [
    ...view.unassigned.map(r => r.bookId),
    ...view.collections.flatMap(c => c.references.map(r => r.bookId)),
];

// ────────────────────────────────────────────────────────────────────────────
section('[2/25] EDITORIAL_LIBRARY_CONTRACT: el contrato editorial no se mueve');

{
    const { doc } = richDoc();

    // La vista editorial es EXACTAMENTE la vista genérica sobre EDITORIAL.
    const legacy = computeEditorialView(doc, CATALOG);
    const generic = computeLayerView(doc, CATALOG, { layer: 'EDITORIAL' });
    ok('computeEditorialView ≡ computeLayerView(EDITORIAL), byte a byte',
        JSON.stringify(legacy) === JSON.stringify(generic));

    const legacyAdmin = computeEditorialView(doc, CATALOG, { includeUnpublished: true });
    const genericAdmin = computeLayerView(doc, CATALOG, { layer: 'EDITORIAL', includeUnpublished: true });
    ok('…también con includeUnpublished',
        JSON.stringify(legacyAdmin) === JSON.stringify(genericAdmin));

    ok('la vista editorial declara layer EDITORIAL', legacy.layer === 'EDITORIAL');

    // El ruido de INSTITUTIONAL/PERSONAL no entra en Editorial.
    ok('Editorial ignora colecciones de otras capas',
        legacy.collections.length === 1 && legacy.collections[0].name === 'Selección',
        JSON.stringify(legacy.collections.map(c => c.name)));
    ok('Editorial ignora referencias de otras capas',
        flat(legacy).join(',') === 'c-3,c-1',
        flat(legacy).join(','));
    ok('Editorial oculta la colección borrador para lectores',
        !legacy.collections.some(c => c.name === 'Borrador'));
    ok('Editorial oculta el libro retirado (Caso G)', !flat(legacy).includes('c-off'));
    ok('el administrador sí ve el borrador editorial',
        legacyAdmin.collections.some(c => c.name === 'Borrador'));
    ok('…y sigue sin ver las colecciones institucionales',
        !legacyAdmin.collections.some(c => c.name.includes('Plan lector')));

    ok('el catálogo canónico no fue mutado', JSON.stringify(CATALOG) === FROZEN_CATALOG);
}

// ────────────────────────────────────────────────────────────────────────────
section('[3] LAYER_VIEW: GENERIC — misma función, scope distinto');

{
    const { doc, ids } = richDoc();

    const vA = computeLayerView(doc, CATALOG, { layer: 'INSTITUTIONAL', contextId: ORG_A });
    ok('INSTITUTIONAL de A declara su layer', vA.layer === 'INSTITUTIONAL');
    ok('A ve su colección publicada y su referencia suelta',
        flat(vA).sort().join(',') === 'c-1,c-2', flat(vA).join(','));
    ok('A NO ve el borrador de A sin includeUnpublished',
        !vA.collections.some(c => c.name === 'Borrador A'));
    const vACur = computeLayerView(doc, CATALOG, { layer: 'INSTITUTIONAL', contextId: ORG_A, includeUnpublished: true });
    ok('el curador de A sí ve su borrador y su contenido',
        vACur.collections.some(c => c.name === 'Borrador A') && flat(vACur).includes('c-3'));

    const vB = computeLayerView(doc, CATALOG, { layer: 'INSTITUTIONAL', contextId: ORG_B });
    ok('B ve solo lo suyo', flat(vB).join(',') === 'c-3', flat(vB).join(','));
    ok('la vista de A no nombra nada de B',
        !JSON.stringify(vA).includes('Plan lector B') && !JSON.stringify(vA).includes(ORG_B));
    ok('la vista de B no nombra nada de A',
        !JSON.stringify(vB).includes('Plan lector A') && !JSON.stringify(vB).includes(ORG_A));

    const pA = computeLayerView(doc, CATALOG, { layer: 'PERSONAL', contextId: USER_A });
    const pB = computeLayerView(doc, CATALOG, { layer: 'PERSONAL', contextId: USER_B });
    ok('PERSONAL de A es solo de A', flat(pA).sort().join(',') === 'c-1,c-2', flat(pA).join(','));
    ok('PERSONAL de B es solo de B', flat(pB).join(',') === 'c-3', flat(pB).join(','));
    ok('PERSONAL no tiene colecciones (ADR §3.3)', pA.collections.length === 0 && pB.collections.length === 0);
    ok('la vista personal de A no nombra a B', !JSON.stringify(pA).includes(USER_B));

    // Contexto inexistente: vacío, nunca "todo".
    const vGhost = computeLayerView(doc, CATALOG, { layer: 'INSTITUTIONAL', contextId: 'org-que-no-existe' });
    ok('un contexto desconocido devuelve vacío, no el conjunto completo',
        vGhost.collections.length === 0 && vGhost.unassigned.length === 0);

    // Orden conservado.
    const solo = emptyLibrary();
    const col = addCollection(solo, { layer: 'INSTITUTIONAL', contextId: ORG_A, name: 'Orden' });
    updateCollection(solo, col.id, { published: true });
    const r1 = addReference(solo, { bookId: 'c-1', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: col.id }, bookExists).reference;
    addReference(solo, { bookId: 'c-2', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: col.id }, bookExists);
    reorderReference(solo, r1.id, 99);
    const ordered = computeLayerView(solo, CATALOG, { layer: 'INSTITUTIONAL', contextId: ORG_A });
    ok('el orden por position se conserva en cualquier capa',
        ordered.collections[0].references.map(r => r.bookId).join(',') === 'c-2,c-1');

    // Estado de publicación y standalone, iguales que en Editorial.
    const st = emptyLibrary();
    addReference(st, { bookId: 'c-off', layer: 'PERSONAL', contextId: USER_A }, bookExists);
    addReference(st, { bookId: 'c-emb', layer: 'PERSONAL', contextId: USER_A }, bookExists);
    addReference(st, { bookId: 'c-1',   layer: 'PERSONAL', contextId: USER_A }, bookExists);
    const stv = computeLayerView(st, CATALOG, { layer: 'PERSONAL', contextId: USER_A });
    ok('publication_state se aplica igual en PERSONAL (retirado oculto)',
        !flat(stv).includes('c-off'));
    ok('standalone:false se oculta igual en PERSONAL', !flat(stv).includes('c-emb'));
    ok('la referencia viva sigue visible', flat(stv).includes('c-1'));

    // Referencia a contenido inexistente: se omite, no rompe (contrato actual).
    const gh = emptyLibrary();
    gh.references.push({ id: 'ref-x', bookId: 'c-borrado', layer: 'PERSONAL', contextId: USER_A, collectionId: null, position: 0 });
    const ghv = computeLayerView(gh, CATALOG, { layer: 'PERSONAL', contextId: USER_A });
    ok('referencia a contenido inexistente se omite sin romper la vista',
        ghv.unassigned.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[4/24] REFERENCE_TO_DENIED_CONTENT: la referencia no concede acceso');

{
    const { doc } = richDoc();

    // El usuario solo tiene derecho a c-1. c-2 y c-3 están referenciados en su
    // capa personal y en la institucional de su organización — y no aparecen.
    const entitled = new Set(['c-1']);

    const vA = computeLayerView(doc, CATALOG, { layer: 'INSTITUTIONAL', contextId: ORG_A, visibleBookIds: entitled });
    ok('INSTITUTIONAL: la referencia a contenido NO autorizado desaparece',
        flat(vA).join(',') === 'c-1', flat(vA).join(','));

    const pA = computeLayerView(doc, CATALOG, { layer: 'PERSONAL', contextId: USER_A, visibleBookIds: entitled });
    ok('PERSONAL: la referencia a contenido NO autorizado desaparece',
        flat(pA).join(',') === 'c-1', flat(pA).join(','));

    // Entitlement retirado por completo (§13): la referencia sigue en el store.
    const none = new Set();
    const vNone = computeLayerView(doc, CATALOG, { layer: 'PERSONAL', contextId: USER_A, visibleBookIds: none });
    ok('sin entitlement alguno la vista personal queda vacía', flat(vNone).length === 0);
    ok('…pero las referencias siguen persistidas en el documento',
        doc.references.filter(r => r.layer === 'PERSONAL' && r.contextId === USER_A).length === 2);

    // La intersección NUNCA amplía: un id autorizado sin referencia no aparece.
    const wide = new Set(['c-1', 'c-2', 'c-3', 'c-off', 'c-emb']);
    const vWide = computeLayerView(doc, CATALOG, { layer: 'PERSONAL', contextId: USER_B, visibleBookIds: wide });
    ok('el entitlement no inventa referencias (B sigue con una sola)',
        flat(vWide).join(',') === 'c-3', flat(vWide).join(','));

    // EDITORIAL sigue SIN intersección: su contrato no cambia.
    ok('EDITORIAL no recibe visibleBookIds desde su firma pública',
        JSON.stringify(computeEditorialView(doc, CATALOG))
        === JSON.stringify(computeLayerView(doc, CATALOG, { layer: 'EDITORIAL' })));
}

// ────────────────────────────────────────────────────────────────────────────
section('[8/12] scope obligatorio en mutaciones: adivinar un id no basta');

{
    const { doc, ids } = richDoc();
    const refA = doc.references.find(r => r.layer === 'INSTITUTIONAL' && r.contextId === ORG_A && r.collectionId === null);
    const refPersonalA = doc.references.find(r => r.layer === 'PERSONAL' && r.contextId === USER_A);
    const refEditorial = doc.references.find(r => r.layer === 'EDITORIAL' && r.collectionId === null);
    const beforeFinds = JSON.stringify(doc);

    ok('la referencia propia se localiza en su scope',
        !!findScopedReference(doc, refA.id, { layer: 'INSTITUTIONAL', contextId: ORG_A }));
    ok('la MISMA referencia es invisible desde otra organización',
        findScopedReference(doc, refA.id, { layer: 'INSTITUTIONAL', contextId: ORG_B }) === null);
    ok('…y desde otra capa', findScopedReference(doc, refA.id, { layer: 'PERSONAL', contextId: ORG_A }) === null);
    ok('una referencia personal es invisible para otro usuario',
        findScopedReference(doc, refPersonalA.id, { layer: 'PERSONAL', contextId: USER_B }) === null);
    ok('una referencia editorial no se alcanza desde la capa personal',
        findScopedReference(doc, refEditorial.id, { layer: 'PERSONAL', contextId: USER_A }) === null);
    ok('id inexistente → null', findScopedReference(doc, 'ref-inventada', { layer: 'PERSONAL', contextId: USER_A }) === null);

    ok('la colección propia se localiza en su scope',
        !!findScopedCollection(doc, ids.iA.id, { layer: 'INSTITUTIONAL', contextId: ORG_A }));
    ok('la colección de otra organización es indistinguible de inexistente',
        findScopedCollection(doc, ids.iB.id, { layer: 'INSTITUTIONAL', contextId: ORG_A }) === null);
    ok('una colección editorial no se alcanza desde la capa institucional',
        findScopedCollection(doc, ids.ePub.id, { layer: 'INSTITUTIONAL', contextId: ORG_A }) === null);

    ok('localizar no muta el documento ni un byte', JSON.stringify(doc) === beforeFinds);
}

// ────────────────────────────────────────────────────────────────────────────
section('[18] COLLECTION_SEMANTICS: preservadas, sin dedupe global inventado');

{
    const doc = emptyLibrary();
    const c1 = addCollection(doc, { layer: 'INSTITUTIONAL', contextId: ORG_A, name: 'Primero' });
    const c2 = addCollection(doc, { layer: 'INSTITUTIONAL', contextId: ORG_A, name: 'Segundo' });
    updateCollection(doc, c1.id, { published: true });
    updateCollection(doc, c2.id, { published: true });
    addReference(doc, { bookId: 'c-1', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: c1.id }, bookExists);
    addReference(doc, { bookId: 'c-1', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: c2.id }, bookExists);
    const v = computeLayerView(doc, CATALOG, { layer: 'INSTITUTIONAL', contextId: ORG_A });
    ok('el mismo bookId puede vivir en dos colecciones de la misma capa',
        v.collections.length === 2 && v.collections.every(c => c.references[0].bookId === 'c-1'));
    ok('no se inventa dedupe global por obra', flat(v).length === 2);

    // La unicidad contractual (layer, contextId, collectionId, bookId) sigue.
    const again = addReference(doc, { bookId: 'c-1', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: c1.id }, bookExists);
    ok('re-añadir en la misma colección es no-op idempotente', again.created === false);
    ok('el mismo libro en dos contextos genera referencias distintas',
        addReference(doc, { bookId: 'c-1', layer: 'INSTITUTIONAL', contextId: ORG_B }, bookExists).created === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('[21] LIBRARY_API_PRIVACY: la vista no filtra internos');

{
    const { doc } = richDoc();
    for (const [name, view] of [
        ['INSTITUTIONAL', computeLayerView(doc, CATALOG, { layer: 'INSTITUTIONAL', contextId: ORG_A, visibleBookIds: new Set(['c-1', 'c-2']) })],
        ['PERSONAL', computeLayerView(doc, CATALOG, { layer: 'PERSONAL', contextId: USER_A, visibleBookIds: new Set(['c-1', 'c-2']) })],
    ]) {
        const json = JSON.stringify(view);
        for (const forbidden of ['allowed', 'entitled', 'entitlement', 'access', 'appliedRules', 'organizationId', 'contextId', 'memberIds', 'mediatorIds', 'groupId']) {
            ok(`${name} no emite "${forbidden}"`, !json.includes(`"${forbidden}"`));
        }
        ok(`${name} no filtra el identificador del contexto ajeno`, !json.includes(ORG_B) && !json.includes(USER_B));
        const ref = view.unassigned[0] ?? view.collections[0]?.references[0];
        ok(`${name} proyecta solo los campos del contrato`,
            ref && JSON.stringify(Object.keys(ref).sort()) === JSON.stringify(['book', 'bookId', 'collectionId', 'id', 'position']),
            JSON.stringify(ref && Object.keys(ref)));
    }
}

// ────────────────────────────────────────────────────────────────────────────
section('[27] el dominio de Biblioteca sigue sin conocer el access engine');

{
    const raw = fs.readFileSync(path.join(__dirname, '..', 'lib', 'libraryStore.js'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['access_db', 'ACCESS_DB', 'accessRule', 'grantAccess', 'readJSON', 'writeJSON', 'fs.', 'resolveUserContentAccess']) {
        ok(`libraryStore.js no contiene "${forbidden}"`, !code.includes(forbidden));
    }
    ok('computeLayerView recibe el conjunto visible ya resuelto (no lo calcula)',
        code.includes('visibleBookIds') && !code.includes('titleIds'));
}

console.log(`\nlibraryLayerViews: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
