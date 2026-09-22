/**
 * libraryLayers.test.mjs
 * CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-3 §§6, 11, 24, 25, 27, 28, 29.
 *
 * Lógica PURA del cliente de las capas INSTITUTIONAL y PERSONAL. Aquí se
 * demuestran las partes de las matrices PUI/IUI que son decisiones de
 * presentación: qué estado se dibuja, qué se envía, qué se oculta y qué NO se
 * puede reconstruir desde el cliente.
 *
 * Sin red, sin React, sin stores. 0 lecturas y 0 escrituras de stores reales.
 *
 *   node utils/__tests__/libraryLayers.test.mjs
 */
import fs from 'node:fs';
import {
    LIBRARY_PATHS, LIBRARY_ERROR_TEXT, PRIVATE_ENTITY_FIELDS,
    parseLayerView, presentCollection, presentReference,
    layerReferences, isLayerViewEmpty, layerViewState,
    savedReferenceIdByBookId, viewWithoutReference,
    personalReferencePayload, institutionalReferencePayload,
    institutionalCollectionPayload, institutionalCollectionPatch,
    referencePositionPayload, payloadLeaksContext,
    libraryErrorText, mayPresentInstitutionalManagement,
} from '../libraryLayers.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const book = (id, titulo) => ({ id, titulo, autor: 'A', tipo: 'libro', portada_url: '', descripcion_corta: '', etiquetas: [] });

/** Respuesta real de GET /api/library/personal (forma de 11B-2). */
const personalResponse = {
    layer: 'PERSONAL',
    collections: [],
    unassigned: [
        { id: 'ref-p2', bookId: 'c-2', collectionId: null, position: 1, book: book('c-2', 'Dos') },
        { id: 'ref-p1', bookId: 'c-1', collectionId: null, position: 0, book: book('c-1', 'Uno') },
    ],
};

/** Respuesta real de GET /api/library/institutional. */
const institutionalResponse = {
    layer: 'INSTITUTIONAL',
    collections: [
        {
            id: 'col-b', name: 'Segunda', description: '', published: true, position: 1,
            references: [{ id: 'ref-i3', bookId: 'c-3', collectionId: 'col-b', position: 0, book: book('c-3', 'Tres') }],
        },
        {
            id: 'col-a', name: 'Primera', description: 'desc', published: true, position: 0,
            references: [{ id: 'ref-i1', bookId: 'c-1', collectionId: 'col-a', position: 0, book: book('c-1', 'Uno') }],
        },
    ],
    unassigned: [{ id: 'ref-i2', bookId: 'c-2', collectionId: null, position: 0, book: book('c-2', 'Dos') }],
};

// ────────────────────────────────────────────────────────────────────────────
section('[2] contrato: el cliente lee lo que el servidor devuelve, sin reinterpretarlo');
{
    ok('las rutas son las de 11B-2 y no hay un segundo contrato',
        LIBRARY_PATHS.personal === '/library/personal'
        && LIBRARY_PATHS.institutional === '/library/institutional'
        && LIBRARY_PATHS.personalReferences === '/library/personal/references'
        && LIBRARY_PATHS.institutionalReferences === '/library/institutional/references'
        && LIBRARY_PATHS.institutionalCollections === '/library/institutional/collections');

    const v = parseLayerView(institutionalResponse, 'INSTITUTIONAL');
    ok('las colecciones se ordenan por position',
        v.collections.map(c => c.name).join(',') === 'Primera,Segunda', JSON.stringify(v.collections.map(c => c.name)));
    ok('las referencias sueltas se ordenan por position',
        parseLayerView(personalResponse, 'PERSONAL').unassigned.map(r => r.bookId).join(',') === 'c-1,c-2');
    ok('la metadata del libro se conserva tal cual llega', v.collections[0].references[0].book.titulo === 'Uno');
}

// ────────────────────────────────────────────────────────────────────────────
section('[24] FAIL-CLOSED: una respuesta ilegible es ERROR, nunca EMPTY');
{
    for (const [label, json] of [
        ['null', null], ['string', 'x'], ['array', []],
        ['capa equivocada', { layer: 'EDITORIAL', collections: [], unassigned: [] }],
        ['sin collections', { layer: 'PERSONAL', unassigned: [] }],
        ['collections no-array', { layer: 'PERSONAL', collections: 'x', unassigned: [] }],
        ['unassigned no-array', { layer: 'PERSONAL', collections: [], unassigned: null }],
    ]) {
        ok(`${label} → null (no interpretable)`, parseLayerView(json, 'PERSONAL') === null);
    }
    ok('la respuesta de la capa institucional no se acepta como personal',
        parseLayerView(institutionalResponse, 'PERSONAL') === null);
    ok('…ni al revés', parseLayerView(personalResponse, 'INSTITUTIONAL') === null);

    ok('una vista vacía SÍ es interpretable (≠ null)',
        JSON.stringify(parseLayerView({ layer: 'PERSONAL', collections: [], unassigned: [] }, 'PERSONAL'))
        === JSON.stringify({ collections: [], unassigned: [] }));
}

// ────────────────────────────────────────────────────────────────────────────
section('[24/PUI1/IUI1] LOADING, EMPTY, ERROR y CONTENT son estados distintos');
{
    const empty = { collections: [], unassigned: [] };
    ok('idle → loading (nunca EMPTY mientras no se ha pedido)',
        layerViewState({ status: 'idle', view: null }) === 'loading');
    ok('loading → loading', layerViewState({ status: 'loading', view: null }) === 'loading');
    ok('loading con vista previa sigue siendo loading',
        layerViewState({ status: 'loading', view: empty }) === 'loading');
    ok('error → error', layerViewState({ status: 'error', view: null }) === 'error');
    ok('ready con view null → error (fail-closed), NO empty',
        layerViewState({ status: 'ready', view: null }) === 'error');
    ok('PUI1/IUI1 · ready con vista vacía → empty',
        layerViewState({ status: 'ready', view: empty }) === 'empty');
    ok('PUI2/IUI2 · ready con contenido → content',
        layerViewState({ status: 'ready', view: parseLayerView(personalResponse, 'PERSONAL') }) === 'content');

    ok('una vista solo con colecciones VACÍAS sigue siendo empty',
        isLayerViewEmpty({ collections: [{ id: 'c', references: [] }], unassigned: [] }));
}

// ────────────────────────────────────────────────────────────────────────────
section('[25] LIBRARY_UI_PRIVACY: la UI no renderiza ni guarda internos');
{
    // Una colección recién creada llega del servidor CON su layer y contextId.
    const rawCreated = {
        id: 'col-new', layer: 'INSTITUTIONAL', contextId: 'org-alfa',
        name: 'Nueva', description: '', published: false, position: 0,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const projected = presentCollection(rawCreated);
    ok('el identificador de la organización NO sobrevive a la proyección',
        !JSON.stringify(projected).includes('org-alfa'), JSON.stringify(projected));
    for (const f of PRIVATE_ENTITY_FIELDS) {
        ok(`la colección proyectada no conserva "${f}"`, !(f in projected));
    }
    ok('conserva exactamente los campos de presentación',
        JSON.stringify(Object.keys(projected).sort()) === JSON.stringify(['description', 'id', 'name', 'position', 'published', 'references']),
        JSON.stringify(Object.keys(projected)));

    const rawRef = { id: 'ref-x', bookId: 'c-1', layer: 'PERSONAL', contextId: 'u-ana', collectionId: null, position: 0, createdAt: 'x', updatedAt: 'y' };
    const pref = presentReference(rawRef);
    ok('el userId del contexto personal NO sobrevive a la proyección',
        !JSON.stringify(pref).includes('u-ana'), JSON.stringify(pref));
    ok('la referencia proyectada conserva solo lo necesario',
        JSON.stringify(Object.keys(pref).sort()) === JSON.stringify(['bookId', 'collectionId', 'id', 'position']),
        JSON.stringify(Object.keys(pref)));

    // Un 403 del CIS incluye el scope_id (= el id de la organización).
    const cis403 = { ok: false, error: 'scope_access_denied', scope_type: 'organization', scope_id: 'org-alfa' };
    const msg = libraryErrorText(403, cis403);
    ok('IUI9 · el mensaje de 403 no filtra el identificador de la organización',
        !msg.includes('org-alfa') && msg === LIBRARY_ERROR_TEXT.forbidden, msg);
    ok('…ni el tipo de scope', !msg.includes('organization'));
    ok('403 organization_required también da un mensaje neutro',
        libraryErrorText(403, { ok: false, error: 'organization_required' }) === LIBRARY_ERROR_TEXT.forbidden);
    ok('PUI/§8 · 403 content_not_available tiene su propio texto, sin reglas',
        libraryErrorText(403, { ok: false, error: 'content_not_available' }) === LIBRARY_ERROR_TEXT.not_available);
    ok('401 remite a la sesión', libraryErrorText(401, null) === LIBRARY_ERROR_TEXT.unauthenticated);
    ok('404 es neutro', libraryErrorText(404, null) === LIBRARY_ERROR_TEXT.not_found);
    ok('PUI7 · 5xx/red → mensaje de indisponibilidad, sin alternativa',
        libraryErrorText(500, null) === LIBRARY_ERROR_TEXT.unavailable
        && libraryErrorText(0, null) === LIBRARY_ERROR_TEXT.unavailable);
    const allTexts = Object.values(LIBRARY_ERROR_TEXT).join(' ');
    ok('ningún mensaje sugiere ver otro catálogo mientras tanto',
        !/cat[aá]logo|mientras tanto|offline/i.test(allTexts), allTexts);
}

// ────────────────────────────────────────────────────────────────────────────
section('[PUI3/IUI4/§3] los payloads no llevan identidad ni contexto');
{
    const payloads = {
        personalReference: personalReferencePayload('c-1'),
        institutionalReferenceSuelta: institutionalReferencePayload('c-1'),
        institutionalReferenceEnColeccion: institutionalReferencePayload('c-1', 'col-a'),
        institutionalCollection: institutionalCollectionPayload('  Club  ', 'desc'),
        position: referencePositionPayload(3),
        collectionPatch: institutionalCollectionPatch({ name: ' X ', published: true, description: 'd' }),
    };
    for (const [name, p] of Object.entries(payloads)) {
        ok(`${name} no arrastra userId/contextId/organizationId/roles`, !payloadLeaksContext(p), JSON.stringify(p));
    }
    ok('PUI3 · el payload personal es EXACTAMENTE { bookId }',
        JSON.stringify(payloads.personalReference) === JSON.stringify({ bookId: 'c-1' }));
    ok('IUI4 · el payload institucional suelto es EXACTAMENTE { bookId }',
        JSON.stringify(payloads.institutionalReferenceSuelta) === JSON.stringify({ bookId: 'c-1' }));
    ok('IUI4 · con colección añade solo collectionId',
        JSON.stringify(payloads.institutionalReferenceEnColeccion) === JSON.stringify({ bookId: 'c-1', collectionId: 'col-a' }));
    ok('el nombre de colección se normaliza sin inventar campos',
        JSON.stringify(payloads.institutionalCollection) === JSON.stringify({ name: 'Club', description: 'desc' }));
    ok('el patch de colección solo admite name/description/published',
        JSON.stringify(Object.keys(institutionalCollectionPatch({
            name: 'X', published: true, description: 'd',
            contextId: 'org-alfa', layer: 'EDITORIAL', position: 9,
        })).sort()) === JSON.stringify(['description', 'name', 'published']));

    // El detector que usan estas pruebas tiene que servir de algo.
    ok('el detector de fugas reconoce un payload contaminado',
        payloadLeaksContext({ bookId: 'c-1', userId: 'u-ana' })
        && payloadLeaksContext({ bookId: 'c-1', contextId: 'org-alfa' })
        && payloadLeaksContext({ bookId: 'c-1', organizationId: 'org-alfa' }));
}

// ────────────────────────────────────────────────────────────────────────────
section('[PUI4/PUI5/§8] «guardado» es estado derivado del servidor');
{
    const view = parseLayerView(personalResponse, 'PERSONAL');
    const map = savedReferenceIdByBookId(view);
    ok('PUI4 · un libro guardado resuelve su referenceId', map.get('c-1') === 'ref-p1');
    ok('un libro NO guardado no está en el mapa', map.get('c-9') === undefined);
    ok('el mapa cubre exactamente lo que devolvió el servidor', map.size === 2);

    const instMap = savedReferenceIdByBookId(parseLayerView(institutionalResponse, 'INSTITUTIONAL'));
    ok('el mapa también recorre las referencias dentro de colecciones', instMap.size === 3);

    // PUI5 — quitar refleja lo ya ocurrido en el servidor, no lo anticipa.
    const after = viewWithoutReference(view, 'ref-p1');
    ok('PUI5 · la referencia quitada desaparece de la vista',
        layerReferences(after).map(r => r.bookId).join(',') === 'c-2');
    ok('PUI5 · quitar no toca las demás', layerReferences(after).length === 1);
    ok('quitar un id inexistente no altera la vista',
        JSON.stringify(viewWithoutReference(view, 'ref-zzz')) === JSON.stringify(view));
    ok('quitar dentro de una colección funciona igual',
        layerReferences(viewWithoutReference(parseLayerView(institutionalResponse, 'INSTITUTIONAL'), 'ref-i1'))
            .map(r => r.bookId).sort().join(',') === 'c-2,c-3');
}

// ────────────────────────────────────────────────────────────────────────────
section('[PUI6/§11] EXPIRED_PERSONAL_REFERENCE: NOT_RENDERED');
{
    // El servidor deja de devolver c-2 porque su entitlement expiró. La
    // referencia sigue existiendo en library_db, pero el cliente no tiene por
    // dónde reconstruirla: solo dibuja lo que vino en ESTA respuesta.
    const antes = parseLayerView(personalResponse, 'PERSONAL');
    const despues = parseLayerView({
        layer: 'PERSONAL', collections: [],
        unassigned: [{ id: 'ref-p1', bookId: 'c-1', collectionId: null, position: 0, book: book('c-1', 'Uno') }],
    }, 'PERSONAL');

    ok('antes de expirar el libro estaba', layerReferences(antes).some(r => r.bookId === 'c-2'));
    ok('PUI6 · después no aparece', !layerReferences(despues).some(r => r.bookId === 'c-2'));
    ok('PUI6 · tampoco queda marcado como «guardado» en la pestaña Libros',
        savedReferenceIdByBookId(despues).get('c-2') === undefined);
    ok('PUI6 · la vista nueva NO se fusiona con la anterior',
        layerReferences(despues).length === 1);
    ok('PUI6 · una referencia sin `book` no se puede dibujar y no cuenta como contenido',
        layerReferences(parseLayerView({
            layer: 'PERSONAL', collections: [],
            unassigned: [{ id: 'r', bookId: 'c-2', collectionId: null, position: 0 }],
        }, 'PERSONAL')).filter(r => r.book).length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[IUI7/IUI8/§29] LIBRARY_LAYER_ISOLATION: las capas no se contaminan');
{
    // El mismo bookId vive en las tres capas: 1 entidad de contenido, 3
    // referencias con ids distintos. Ninguna operación cruza de capa.
    const personalV = parseLayerView({
        layer: 'PERSONAL', collections: [],
        unassigned: [{ id: 'ref-p1', bookId: 'c-1', collectionId: null, position: 0, book: book('c-1', 'Uno') }],
    }, 'PERSONAL');
    const instV = parseLayerView({
        layer: 'INSTITUTIONAL',
        collections: [{ id: 'col-a', name: 'A', description: '', published: true, position: 0,
            references: [{ id: 'ref-i1', bookId: 'c-1', collectionId: 'col-a', position: 0, book: book('c-1', 'Uno') }] }],
        unassigned: [],
    }, 'INSTITUTIONAL');

    ok('§29 · el mismo bookId aparece en ambas capas con referencias distintas',
        layerReferences(personalV)[0].bookId === layerReferences(instV)[0].bookId
        && layerReferences(personalV)[0].id !== layerReferences(instV)[0].id);

    const instSnapshot = JSON.stringify(instV);
    const personalTrasQuitar = viewWithoutReference(personalV, 'ref-p1');
    ok('§29 · quitar de PERSONAL vacía esa capa', isLayerViewEmpty(personalTrasQuitar));
    ok('§29 · …y no toca INSTITUTIONAL', JSON.stringify(instV) === instSnapshot);

    const personalSnapshot = JSON.stringify(personalV);
    const instTrasQuitar = viewWithoutReference(instV, 'ref-i1');
    ok('§29 · quitar de INSTITUTIONAL vacía esa capa', isLayerViewEmpty(instTrasQuitar));
    ok('§29 · …y no toca PERSONAL', JSON.stringify(personalV) === personalSnapshot);

    ok('IUI7 · el id de una referencia institucional no resuelve nada en la vista personal',
        savedReferenceIdByBookId(personalV).get('c-1') !== 'ref-i1');
    ok('IUI8 · quitar por un id de otra capa no altera la vista',
        JSON.stringify(viewWithoutReference(personalV, 'ref-i1')) === personalSnapshot);
}

// ────────────────────────────────────────────────────────────────────────────
section('[IUI5/§15/§22] CLIENT_INSTITUTIONAL_AUTHORITY: PRESENTATION_ONLY');
{
    ok('IUI5 · a un lector no se le ofrecen los controles de gestión',
        mayPresentInstitutionalManagement({ roles: ['lector'] }) === false);
    ok('al mediador sí', mayPresentInstitutionalManagement({ roles: ['mediador'] }) === true);
    ok('al administrador también', mayPresentInstitutionalManagement({ roles: ['administrador'] }) === true);
    ok('§15 · ante la duda (sin usuario) se muestra lectura, no gestión',
        mayPresentInstitutionalManagement(null) === false
        && mayPresentInstitutionalManagement(undefined) === false
        && mayPresentInstitutionalManagement({}) === false
        && mayPresentInstitutionalManagement({ roles: 'mediador' }) === false);
    // §22 · ROLE_BYPASS: ZERO. El rol solo puede decidir si se DIBUJA un
    // control. Ninguna otra función del módulo lo mira siquiera: se comprueba
    // sobre el fuente, porque es una propiedad del módulo, no de una llamada.
    const src = fs.readFileSync(new URL('../libraryLayers.mjs', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // `payloadLeaksContext` y `PRIVATE_ENTITY_FIELDS` existen precisamente para
    // NOMBRAR lo prohibido, así que se excluyen del recuento; lo que se mide es
    // si alguna función de la vista mira esos campos para decidir algo.
    const guardAt = code.indexOf('export function mayPresentInstitutionalManagement');
    const viewCode = code
        .slice(0, guardAt)
        .replace(/export function payloadLeaksContext[\s\S]*?\n}/, '')
        .replace(/export const PRIVATE_ENTITY_FIELDS[\s\S]*?;/, '');
    ok('§22 · ninguna función de vista mira «roles» para decidir qué se muestra',
        !viewCode.includes('roles'), viewCode.split('\n').filter(l => l.includes('roles')).join(' | '));
    ok('§22 · el guard de presentación devuelve un booleano, jamás una vista',
        typeof mayPresentInstitutionalManagement({ roles: ['mediador'] }) === 'boolean');
    ok('§6/§12 · el módulo no conoce my-catalog ni el motor de acceso',
        !viewCode.includes('my-catalog') && !viewCode.includes('titleIds')
        && !viewCode.includes('accessService') && !viewCode.includes('organizationId')
        && !viewCode.includes('entitlement'),
        viewCode.split('\n').filter(l => /my-catalog|titleIds|accessService|organizationId|entitlement/.test(l)).join(' | '));
}

console.log(`\nlibraryLayers: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
