/**
 * libraryLayers.mjs — CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-3.
 *
 * Lógica PURA de las capas INSTITUTIONAL y PERSONAL de Biblioteca en el
 * cliente. Sin React, sin fetch, sin estado global: solo el contrato.
 *
 * QUÉ DECIDE ESTE MÓDULO Y QUÉ NO
 * -------------------------------
 *   NO decide entitlement. Jamás. Las dos vistas que llegan del servidor YA
 *   son la intersección `curaduría ∩ entitlement` (11B-2): el cliente las
 *   dibuja tal cual y no vuelve a cruzarlas con roles, grupos, organización ni
 *   my-catalog. Si un libro no viene, no se dibuja; no hay forma de revivirlo
 *   desde estado local.
 *
 *   SÍ decide presentación: aplanar, ordenar, distinguir LOADING/EMPTY/ERROR/
 *   CONTENT, saber qué libro ya está guardado para etiquetar el botón, y
 *   PROYECTAR las respuestas quitando lo que la UI no debe ni renderizar ni
 *   guardar (`layer`, `contextId`, `scope_id`…).
 *
 * FAIL-CLOSED
 * -----------
 * `parseLayerView` devuelve `null` cuando la respuesta no es interpretable.
 * `null` significa «no sé qué hay», y el llamador debe mostrar ERROR — nunca
 * EMPTY y nunca un catálogo alternativo. Degradar a otra fuente reintroduciría
 * la política que 11B-1 y 11B-2 sacaron del navegador.
 */

/** Rutas relativas al `apiUrl` del cliente. Única definición. */
export const LIBRARY_PATHS = Object.freeze({
    institutional:            '/library/institutional',
    institutionalCollections: '/library/institutional/collections',
    institutionalReferences:  '/library/institutional/references',
    personal:                 '/library/personal',
    personalReferences:       '/library/personal/references',
});

/**
 * Campos que la UI no debe renderizar ni conservar (§25). El servidor los
 * incluye en las respuestas de CRUD (una colección recién creada trae su
 * `layer` y su `contextId`); la proyección los descarta en el cliente.
 */
export const PRIVATE_ENTITY_FIELDS = Object.freeze(['layer', 'contextId', 'scope_id', 'scope_type']);

/** Proyección de PRESENTACIÓN de una colección. Sin contexto ni capa. */
export function presentCollection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    return {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        published: raw.published === true,
        position: Number.isFinite(raw.position) ? raw.position : 0,
        references: Array.isArray(raw.references)
            ? raw.references.map(presentReference).filter(Boolean)
            : [],
    };
}

/** Proyección de PRESENTACIÓN de una referencia. `book` viene del servidor. */
export function presentReference(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.bookId !== 'string' || !raw.bookId) return null;
    const out = {
        id: raw.id,
        bookId: raw.bookId,
        collectionId: typeof raw.collectionId === 'string' ? raw.collectionId : null,
        position: Number.isFinite(raw.position) ? raw.position : 0,
    };
    // `book` solo se conserva cuando el servidor lo proyectó (las vistas sí lo
    // traen; la respuesta de un POST de referencia no).
    if (raw.book && typeof raw.book === 'object') out.book = raw.book;
    return out;
}

/**
 * Interpreta la respuesta de `GET /api/library/{institutional,personal}`.
 *
 * @param {unknown} json cuerpo ya parseado
 * @param {string} expectedLayer 'INSTITUTIONAL' | 'PERSONAL'
 * @returns {{collections:Array, unassigned:Array}|null} `null` = fail-closed.
 */
export function parseLayerView(json, expectedLayer) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    if (json.layer !== expectedLayer) return null;
    if (!Array.isArray(json.collections) || !Array.isArray(json.unassigned)) return null;
    return {
        collections: json.collections
            .map(presentCollection)
            .filter(Boolean)
            .sort((a, b) => a.position - b.position),
        unassigned: json.unassigned
            .map(presentReference)
            .filter(Boolean)
            .sort((a, b) => a.position - b.position),
    };
}

/** Todas las referencias de una vista, colecciones primero y luego sueltas. */
export function layerReferences(view) {
    if (!view || typeof view !== 'object') return [];
    const fromCollections = Array.isArray(view.collections)
        ? view.collections.flatMap(c => (Array.isArray(c.references) ? c.references : []))
        : [];
    const loose = Array.isArray(view.unassigned) ? view.unassigned : [];
    return [...fromCollections, ...loose];
}

/** Una vista es vacía cuando no tiene NINGUNA referencia que mostrar. */
export function isLayerViewEmpty(view) {
    return layerReferences(view).length === 0;
}

/**
 * Estado de render de una pestaña. LOADING y EMPTY son estados DISTINTOS (§24):
 * nunca se anuncia «no hay nada» mientras la respuesta está en vuelo.
 *
 * @returns {'loading'|'error'|'empty'|'content'}
 */
export function layerViewState({ status, view }) {
    if (status === 'idle' || status === 'loading') return 'loading';
    if (status === 'error' || view === null || view === undefined) return 'error';
    return isLayerViewEmpty(view) ? 'empty' : 'content';
}

/**
 * Mapa `bookId → referenceId` de la vista personal. Es lo que permite etiquetar
 * un libro como «guardado» en la pestaña Libros y resolver el DELETE sin pedir
 * nada más al servidor. Es estado DERIVADO de la última respuesta, no un
 * segundo store persistente.
 */
export function savedReferenceIdByBookId(view) {
    const map = new Map();
    for (const ref of layerReferences(view)) {
        if (ref && typeof ref.bookId === 'string' && !map.has(ref.bookId)) map.set(ref.bookId, ref.id);
    }
    return map;
}

/**
 * Quita una referencia de la vista en memoria tras un DELETE confirmado por el
 * servidor. No reordena ni inventa nada: solo refleja lo ya ocurrido.
 */
export function viewWithoutReference(view, referenceId) {
    if (!view || typeof view !== 'object') return view;
    const drop = (list) => (Array.isArray(list) ? list.filter(r => r && r.id !== referenceId) : []);
    return {
        ...view,
        collections: Array.isArray(view.collections)
            ? view.collections.map(c => ({ ...c, references: drop(c.references) }))
            : [],
        unassigned: drop(view.unassigned),
    };
}

// ────────────────────────────────────────────────────────────────────────────
// PAYLOADS — lo único que el cliente envía. Estas funciones son la definición
// del contrato de escritura: si algo no está aquí, no viaja.
//
// JAMÁS viajan: userId, contextId, organizationId, groupId, scope, roles. La
// identidad y el contexto los deriva el servidor de la sesión firmada (11B-2).
// ────────────────────────────────────────────────────────────────────────────

export function personalReferencePayload(bookId) {
    return { bookId };
}

export function institutionalReferencePayload(bookId, collectionId = null) {
    const payload = { bookId };
    if (typeof collectionId === 'string' && collectionId) payload.collectionId = collectionId;
    return payload;
}

export function institutionalCollectionPayload(name, description = '') {
    return { name: String(name ?? '').trim(), description: String(description ?? '') };
}

export function referencePositionPayload(position) {
    return { position: Number(position) || 0 };
}

/** Campos admitidos al editar una colección, según el CRUD de 11B-2. */
export function institutionalCollectionPatch(patch) {
    const out = {};
    if (patch && typeof patch === 'object') {
        if (typeof patch.name === 'string') out.name = patch.name.trim();
        if (typeof patch.description === 'string') out.description = patch.description;
        if (typeof patch.published === 'boolean') out.published = patch.published;
    }
    return out;
}

/** true si algún payload arrastra identidad o contexto. Usado por los tests. */
export function payloadLeaksContext(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const forbidden = ['userId', 'contextId', 'organizationId', 'groupId', 'scope', 'scopeId', 'roles', 'layer'];
    return forbidden.some(k => Object.prototype.hasOwnProperty.call(payload, k));
}

// ────────────────────────────────────────────────────────────────────────────
// ERRORES — mensajes neutros. El cuerpo de un 403 del CIS trae `scope_id` (el
// identificador de la organización); no se muestra ni se guarda (§25).
// ────────────────────────────────────────────────────────────────────────────

export const LIBRARY_ERROR_TEXT = Object.freeze({
    unauthenticated: 'Tu sesión no está activa. Vuelve a iniciar sesión.',
    forbidden:       'No tienes permiso para hacer este cambio.',
    not_available:   'Este libro no está disponible para tu cuenta.',
    not_found:       'Ese elemento ya no existe.',
    unavailable:     'No pudimos cargar esta biblioteca. Inténtalo de nuevo.',
});

/**
 * Traduce una respuesta fallida a un mensaje neutro.
 * NUNCA devuelve razones internas, ids de regla, de grupo ni de organización.
 */
export function libraryErrorText(status, body) {
    if (status === 401) return LIBRARY_ERROR_TEXT.unauthenticated;
    if (status === 404) return LIBRARY_ERROR_TEXT.not_found;
    if (status === 403) {
        const code = body && typeof body === 'object' ? body.error : null;
        if (code === 'content_not_available') return LIBRARY_ERROR_TEXT.not_available;
        return LIBRARY_ERROR_TEXT.forbidden;
    }
    return LIBRARY_ERROR_TEXT.unavailable;
}

/**
 * ¿Se le MUESTRAN al usuario los controles de gestión institucional?
 *
 * PRESENTACIÓN, NO AUTORIZACIÓN (§15). El servidor decide con el CIS y responde
 * 403 pase lo que pase aquí; esto solo evita ofrecer a un lector un botón que
 * siempre fallaría. Ante la duda —sin roles legibles— devuelve `false`: se
 * muestra lectura, no gestión.
 */
export function mayPresentInstitutionalManagement(user) {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    return roles.includes('mediador') || roles.includes('administrador');
}
