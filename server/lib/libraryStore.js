/**
 * libraryStore.js — CHP-LIB-01 (contrato: docs/adr/CHP_ADR_BIBLIOTECA.md).
 *
 * Dominio PURO de Biblioteca: referencias + colecciones. Sin I/O (el server
 * persiste con sus helpers canónicos readJSON/writeJSON/withFileLock; los
 * tests operan sobre objetos planos).
 *
 * Invariantes del ADR que este módulo garantiza:
 *  - Biblioteca = referencia + organización + contexto. JAMÁS copia un Book:
 *    `bookId` apunta al contenido canónico de content.json y aquí no se
 *    almacena NINGUNA metadata canónica (título/autor/archivos viven fuera).
 *  - Unicidad (layer, contextId, collectionId, bookId): re-añadir es no-op
 *    idempotente, nunca duplica.
 *  - Este módulo NO conoce el access engine: no lee access_db, no emite
 *    campos de autorización. La lectura efectiva la decide el preflight
 *    canónico /api/content/:id/access — Biblioteca solo organiza.
 */

export const LAYERS = Object.freeze(['EDITORIAL', 'INSTITUTIONAL', 'PERSONAL']);

export function emptyLibrary() {
    return { collections: [], references: [] };
}

/** Normaliza un doc leído de disco (tolerante a archivo ausente/parcial). */
export function normalizeLibrary(raw) {
    const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        collections: Array.isArray(doc.collections) ? doc.collections : [],
        references: Array.isArray(doc.references) ? doc.references : [],
    };
}

const nowIso = () => new Date().toISOString();
const sameScope = (r, layer, contextId, collectionId) =>
    r.layer === layer &&
    (r.contextId ?? null) === (contextId ?? null) &&
    (r.collectionId ?? null) === (collectionId ?? null);

function assertLayer(layer) {
    if (!LAYERS.includes(layer)) {
        const e = new Error(`layer inválida: ${layer}`);
        e.code = 'INVALID_LAYER';
        throw e;
    }
}

/**
 * Añade una referencia. Idempotente por unicidad
 * (layer, contextId, collectionId, bookId): si ya existe, devuelve la
 * existente con `created:false` y NO duplica.
 * `bookExists` es el verificador de integridad contra el catálogo canónico.
 */
export function addReference(doc, { bookId, layer = 'EDITORIAL', contextId = null, collectionId = null, position }, bookExists) {
    assertLayer(layer);
    if (!bookId || typeof bookId !== 'string') {
        const e = new Error('bookId requerido');
        e.code = 'INVALID_BOOK_ID';
        throw e;
    }
    if (typeof bookExists === 'function' && !bookExists(bookId)) {
        const e = new Error(`bookId no existe en el catálogo canónico: ${bookId}`);
        e.code = 'BOOK_NOT_FOUND';
        throw e;
    }
    if (collectionId != null && !doc.collections.some(c => c.id === collectionId)) {
        const e = new Error(`collectionId no existe: ${collectionId}`);
        e.code = 'COLLECTION_NOT_FOUND';
        throw e;
    }
    const existing = doc.references.find(r => sameScope(r, layer, contextId, collectionId) && r.bookId === bookId);
    if (existing) return { reference: existing, created: false };

    const siblings = doc.references.filter(r => sameScope(r, layer, contextId, collectionId));
    const ref = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        bookId,
        layer,
        contextId: contextId ?? null,
        collectionId: collectionId ?? null,
        position: Number.isFinite(position) ? position : siblings.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
    doc.references.push(ref);
    return { reference: ref, created: true };
}

/** Elimina una referencia. NUNCA toca el contenido canónico. */
export function removeReference(doc, refId) {
    const idx = doc.references.findIndex(r => r.id === refId);
    if (idx === -1) return false;
    doc.references.splice(idx, 1);
    return true;
}

/** Reordena una referencia dentro de su scope. */
export function reorderReference(doc, refId, position) {
    const ref = doc.references.find(r => r.id === refId);
    if (!ref) return null;
    ref.position = Number(position) || 0;
    ref.updatedAt = nowIso();
    return ref;
}

export function addCollection(doc, { layer = 'EDITORIAL', contextId = null, name, description = '' }) {
    assertLayer(layer);
    if (!name || !String(name).trim()) {
        const e = new Error('name requerido');
        e.code = 'INVALID_NAME';
        throw e;
    }
    const col = {
        id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        layer,
        contextId: contextId ?? null,
        name: String(name).trim(),
        description: String(description ?? ''),
        published: false,
        position: doc.collections.filter(c => c.layer === layer && (c.contextId ?? null) === (contextId ?? null)).length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
    doc.collections.push(col);
    return col;
}

export function updateCollection(doc, colId, patch) {
    const col = doc.collections.find(c => c.id === colId);
    if (!col) return null;
    if (patch.name !== undefined) col.name = String(patch.name).trim();
    if (patch.description !== undefined) col.description = String(patch.description);
    if (patch.published !== undefined) col.published = !!patch.published;
    if (patch.position !== undefined) col.position = Number(patch.position) || 0;
    col.updatedAt = nowIso();
    return col;
}

/**
 * Localiza una referencia EXIGIENDO su scope (layer + contextId).
 *
 * Existe para que una mutación no pueda alcanzar una referencia de otro
 * contexto adivinando su id: el caller resuelve `contextId` en el servidor y
 * esta función devuelve `null` si la referencia pertenece a otra capa u otro
 * contexto (el caller responde 404, indistinguible de inexistente — ADR §6.1).
 */
export function findScopedReference(doc, refId, { layer, contextId }) {
    assertLayer(layer);
    const ref = doc.references.find(r => r.id === refId);
    if (!ref) return null;
    if (ref.layer !== layer) return null;
    if ((ref.contextId ?? null) !== (contextId ?? null)) return null;
    return ref;
}

/** Igual que findScopedReference, para colecciones. */
export function findScopedCollection(doc, colId, { layer, contextId }) {
    assertLayer(layer);
    const col = doc.collections.find(c => c.id === colId);
    if (!col) return null;
    if (col.layer !== layer) return null;
    if ((col.contextId ?? null) !== (contextId ?? null)) return null;
    return col;
}

/**
 * Vista de UNA capa para lectores. Generalización de la vista editorial
 * (CHP-V6-LIBRARY-INSTITUTIONAL-01 §3): mismo cómputo, mismo contrato de
 * respuesta, mismo orden; lo único que varía es el scope consultado y el
 * conjunto visible que el caller inyecta.
 *
 * Aplica los componentes de la fórmula que le corresponden a la capa:
 *  - reference: solo libros referenciados en (layer, contextId) aparecen;
 *  - publication_state: libros con status !== 'disponible' se OCULTAN
 *    (referencias dormidas, Caso G) y colecciones no publicadas se ocultan
 *    salvo includeUnpublished;
 *  - entitlement/membership: NO se calculan aquí. `visibleBookIds` es un
 *    conjunto YA resuelto por el caller con la autoridad canónica de acceso;
 *    este módulo solo intersecta. `null` = sin intersección (capa EDITORIAL,
 *    cuya apertura sigue gateada por el preflight canónico).
 *
 * `contentList` es el catálogo canónico: la vista solo PROYECTA su metadata,
 * jamás la copia a disco.
 *
 * @param {object} doc
 * @param {Array}  contentList
 * @param {{layer?:string, contextId?:string|null, includeUnpublished?:boolean,
 *          visibleBookIds?:Set<string>|null}} [options]
 *   `contextId` OMITIDO = cualquier contexto (comportamiento histórico de la
 *   capa editorial, cuyo contexto es global/null).
 */
export function computeLayerView(doc, contentList, options = {}) {
    const { layer = 'EDITORIAL', includeUnpublished = false, visibleBookIds = null } = options;
    assertLayer(layer);
    const matchAnyContext = !('contextId' in options);
    const wanted = options.contextId ?? null;
    const inScope = (e) => e.layer === layer
        && (matchAnyContext || (e.contextId ?? null) === wanted);

    const byId = new Map((contentList || []).map(c => [c.id, c]));
    // V4 (CHP-MOOK-V4-REALIGN-01): `standalone === false` marca contenido
    // canónico destinado a Experiencias que NO se descubre como obra
    // independiente en Biblioteca (ausente ⇒ true; dimensión separada de
    // publication_state y de entitlement — el access engine no cambia).
    const visibleBook = (bookId) => {
        if (visibleBookIds && !visibleBookIds.has(bookId)) return null;
        const book = byId.get(bookId);
        return book && book.status === 'disponible' && book.standalone !== false ? book : null;
    };
    const projectRef = (r) => {
        const book = visibleBook(r.bookId);
        if (!book) return null;
        return {
            id: r.id,
            bookId: r.bookId,
            collectionId: r.collectionId ?? null,
            position: r.position,
            book: {
                id: book.id,
                titulo: book.titulo,
                autor: book.autor,
                tipo: book.tipo,
                portada_url: book.portada_url,
                descripcion_corta: book.descripcion_corta,
                etiquetas: book.etiquetas,
            },
        };
    };
    const layerRefs = doc.references.filter(inScope);
    const collections = doc.collections
        .filter(c => inScope(c) && (includeUnpublished || c.published))
        .sort((a, b) => a.position - b.position)
        .map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            published: c.published,
            position: c.position,
            references: layerRefs
                .filter(r => r.collectionId === c.id)
                .sort((a, b) => a.position - b.position)
                .map(projectRef)
                .filter(Boolean),
        }));
    const unassigned = layerRefs
        .filter(r => r.collectionId == null)
        .sort((a, b) => a.position - b.position)
        .map(projectRef)
        .filter(Boolean);
    return { layer, collections, unassigned };
}

/**
 * Vista de la capa EDITORIAL para lectores. Delega en `computeLayerView` sin
 * cambiar NADA de su contrato: mismo scope (EDITORIAL, cualquier contexto —
 * el contexto editorial es global/null), misma respuesta, sin intersección de
 * entitlement (la apertura la decide el preflight canónico).
 */
export function computeEditorialView(doc, contentList, { includeUnpublished = false } = {}) {
    return computeLayerView(doc, contentList, { layer: 'EDITORIAL', includeUnpublished });
}
