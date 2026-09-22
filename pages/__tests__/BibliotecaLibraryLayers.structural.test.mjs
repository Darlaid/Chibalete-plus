/**
 * BibliotecaLibraryLayers.structural.test.mjs
 * CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-3 §§3-9, 12-15, 20-26.
 *
 * Ratchet estructural sobre la superficie de producto. Las pruebas de lógica
 * viven en `utils/__tests__/libraryLayers.test.mjs`; esto comprueba lo que solo
 * se puede ver leyendo el fuente: que las pestañas existentes siguen ahí, que
 * la capa Editorial no se tocó, que el cliente no manda identidad, que no se
 * reintrodujo el filtro de catálogo en el navegador y que no apareció un
 * segundo store.
 *
 * Sin red. 0 lecturas y 0 escrituras de stores reales.
 *
 *   node pages/__tests__/BibliotecaLibraryLayers.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const page = read('pages/Biblioteca.tsx');
const client = read('services/dataService.ts');
const personalTab = read('components/library/PersonalLibraryTab.tsx');
const institutionalTab = read('components/library/InstitutionalLibraryTab.tsx');
const states = read('components/library/LibraryLayerStates.tsx');
const layers = read('utils/libraryLayers.mjs');

/** Código sin comentarios: los comentarios documentan lo prohibido y lo nombran. */
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const pageCode = codeOf(page);
const clientCode = codeOf(client);
const uiCode = codeOf(personalTab) + codeOf(institutionalTab) + codeOf(states);

// ────────────────────────────────────────────────────────────────────────────
section('[4/§20] LIBRARY_TABS: EXTENDED_NOT_REBUILT');
{
    const PREEXISTING = [
        ['biblioteca', 'Libros'],
        ['experiencias', 'Experiencias'],
        ['editorial', 'Selección Chibalete'],
        ['album', 'Libros Álbum'],
        ['lectura', 'Continuar Leyendo'],
        ['descargados', 'Disponibles Offline'],
        ['recomendados', 'Para Ti'],
        ['comunidad', 'Comunidad'],
    ];
    for (const [tab, label] of PREEXISTING) {
        ok(`la pestaña «${label}» sigue registrada`,
            page.includes(`tab="${tab}"`) && page.includes(`label="${label}"`));
    }
    ok('§4 · se añaden EXACTAMENTE dos pestañas nuevas',
        page.includes('tab="personal" label="Mi biblioteca"')
        && page.includes('tab="institucional" label="Biblioteca institucional"'));
    ok('§4 · no se crean rutas de página nuevas',
        !/\<Route[\s\S]*library/i.test(read('App.tsx')));

    // §5 — el vocabulario no puede insinuar propiedad.
    const OWNERSHIP = ['Mis libros comprados', 'Mis libros', 'Propiedad', 'Comprados', 'Licencias', 'Mi compra'];
    for (const word of OWNERSHIP) {
        ok(`§5 · la UI no dice «${word}»`,
            !page.includes(word) && !personalTab.includes(word) && !institutionalTab.includes(word));
    }
}

// ────────────────────────────────────────────────────────────────────────────
section('[20] EDITORIAL_UI: UNCHANGED');
{
    ok('la rama editorial sigue existiendo intacta',
        page.includes("if (activeTab === 'editorial')") && page.includes('EditorialBookCard'));
    ok('sigue leyendo su propia fuente', page.includes('dataService.getEditorialLibrary()'));
    ok('el cliente editorial no cambió de contrato',
        client.includes("fetch(`${this.apiUrl}/library/editorial`, { credentials: 'include' })")
        && client.includes("{ layer: 'EDITORIAL', collections: [], unassigned: [] }"));
    ok('§20 · el estado editorial NO se comparte con las capas nuevas',
        pageCode.includes('const [editorial, setEditorial]')
        && pageCode.includes('const [personal, setPersonal]')
        && pageCode.includes('const [institutional, setInstitutional]'));
    ok('§20 · el estado editorial tiene UN solo escritor, el suyo',
        (pageCode.match(/setEditorial\(/g) || []).length === 1);
    ok('§20 · y las capas nuevas tienen los suyos, separados',
        (pageCode.match(/setPersonal\(/g) || []).length >= 1
        && (pageCode.match(/setInstitutional\(/g) || []).length >= 1
        && !pageCode.includes('setEditorial(personal') && !pageCode.includes('setPersonal(editorial'));
    ok('§20 · el candado del preflight sigue siendo cosa de la capa editorial',
        page.includes('useAccessCheck(book.id, userId)'));
}

// ────────────────────────────────────────────────────────────────────────────
section('[21/§22] LIBRARY_BOOKS: SERVER_AUTHORITATIVE (11B-1 intacto)');
{
    ok('§21 · la pestaña Libros sigue alimentándose de my-catalog',
        pageCode.includes('dataService.getMyCatalog()'));
    ok('§21 · NO se reintrodujo getContenidos en la página',
        !pageCode.includes('dataService.getContenidos('));
    ok('§21 · sigue siendo fail-closed (sin degradar al filtro de cliente)',
        pageCode.includes('const authorized = visible ?? []'));
    ok('§22 · no hay ningún bypass por rol en la página',
        !/roles.*includes\(['"](administrador|mediador)['"]\)/.test(pageCode),
        (pageCode.match(/.*roles.*/g) || []).slice(0, 3).join(' | '));
    ok('§17 · la fuente para curar institucional es el conjunto autorizado, no el catálogo general',
        pageCode.includes('catalog={miBiblioteca') && !pageCode.includes('catalog={this.content'));
}

// ────────────────────────────────────────────────────────────────────────────
section('[3/§25] el cliente no manda identidad ni contexto');
{
    const libraryBlock = clientCode.slice(clientCode.indexOf('private async readLayerView'));
    ok('el bloque de cliente de las dos capas existe', libraryBlock.length > 500);

    for (const forbidden of ['userId', 'contextId', 'organizationId', 'groupId', 'scopeId', 'roles']) {
        ok(`§3 · ninguna función del cliente Library acepta ni envía "${forbidden}"`,
            !libraryBlock.includes(forbidden),
            libraryBlock.split('\n').filter(l => l.includes(forbidden)).join(' | '));
    }
    ok('§3 · la identidad viaja solo en la cookie de sesión',
        (libraryBlock.match(/credentials: 'include'/g) || []).length >= 2);
    ok('§3 · no se construye un cliente de auth paralelo',
        !libraryBlock.includes('x-user-id') && !libraryBlock.includes('Authorization'));

    const REQUIRED = [
        'getInstitutionalLibrary', 'createInstitutionalCollection', 'updateInstitutionalCollection',
        'addInstitutionalReference', 'updateInstitutionalReference', 'deleteInstitutionalReference',
        'getPersonalLibrary', 'addPersonalReference', 'updatePersonalReference', 'deletePersonalReference',
    ];
    for (const fn of REQUIRED) {
        ok(`§3 · existe ${fn}()`, new RegExp(`async ${fn}\\(`).test(client));
    }
    ok('§3 · los payloads salen del módulo puro (única definición del contrato)',
        libraryBlock.includes('personalReferencePayload(bookId)')
        && libraryBlock.includes('institutionalReferencePayload(bookId, collectionId)')
        && libraryBlock.includes('institutionalCollectionPayload(name, description)'));
    ok('§25 · las respuestas de CRUD se proyectan antes de llegar a la UI',
        libraryBlock.includes('presentCollection(') && libraryBlock.includes('presentReference('));
}

// ────────────────────────────────────────────────────────────────────────────
section('[6/12] PERSONAL/INSTITUTIONAL_LIBRARY_SOURCE: SERVER_ONLY');
{
    ok('§6 · Mi biblioteca se alimenta solo de GET /api/library/personal',
        pageCode.includes('dataService.getPersonalLibrary()'));
    ok('§12 · Biblioteca institucional solo de GET /api/library/institutional',
        pageCode.includes('dataService.getInstitutionalLibrary()'));

    // Las dos pestañas dibujan la vista del servidor; no vuelven a intersectar.
    for (const [name, src] of [['PersonalLibraryTab', codeOf(personalTab)], ['InstitutionalLibraryTab', codeOf(institutionalTab)]]) {
        for (const forbidden of ['getMyCatalog', 'getContenidos', 'useAccessCheck', 'titleIds', 'hiddenContentIds', 'accessService']) {
            ok(`${name} no usa "${forbidden}"`, !src.includes(forbidden));
        }
        ok(`${name} no filtra por rol el contenido que muestra`,
            !/references[\s\S]{0,200}roles/.test(src));
    }
    ok('§12 · la pestaña institucional no cruza la vista con my-catalog',
        !codeOf(institutionalTab).includes('miBiblioteca'));
}

// ────────────────────────────────────────────────────────────────────────────
section('[24/§23] LOADING ≠ EMPTY, y ERROR sin fallback');
{
    for (const [name, src] of [['PersonalLibraryTab', personalTab], ['InstitutionalLibraryTab', institutionalTab]]) {
        ok(`${name} distingue los cuatro estados con layerViewState`, src.includes('layerViewState('));
        ok(`${name} dibuja LOADING antes que EMPTY`,
            src.indexOf("=== 'loading'") < src.indexOf("=== 'empty'"));
        ok(`${name} dibuja ERROR sin ofrecer otra fuente`,
            src.includes('LibraryError') && !src.includes('getContenidos') && !src.includes('downloadedContent'));
    }
    ok('§23 · las capas nuevas no leen el caché offline',
        !codeOf(personalTab).includes('useOffline') && !codeOf(institutionalTab).includes('useOffline'));
    ok('§23 · Descargados conserva su comportamiento',
        pageCode.includes("case 'descargados':") && pageCode.includes('filterHidden(downloadedContent)'));
    ok('§24 · un fallo de escritura muestra el error del servidor, no éxito',
        pageCode.includes('if (!r.ok) setLibraryNotice(libraryErrorText(r.status, r.body))')
        && pageCode.includes('if (!r.ok) { setLibraryNotice(libraryErrorText(r.status, r.body)); return; }'));
}

// ────────────────────────────────────────────────────────────────────────────
section('[7/8/9] acciones de la capa PERSONAL');
{
    ok('§7 · el empty state invita a guardar, sin hablar de ausencia de propiedad',
        personalTab.includes('Aquí puedes guardar los libros disponibles en Chibalete+ que quieras tener más a mano.'));
    ok('§7 · el CTA lleva a la pestaña Libros',
        personalTab.includes('actionLabel="Explorar libros"')
        && pageCode.includes("onExplore={() => handleTabChange('biblioteca')}"));
    ok('§8 · la acción de guardar vive en la pestaña Libros',
        pageCode.includes("activeTab === 'biblioteca'") && pageCode.includes('renderSavable('));
    ok('§8 · guardar llama a addPersonalReference sin más datos',
        pageCode.includes('dataService.addPersonalReference(bookId)'));
    ok('§8 · sin la vista personal NO se dibuja el botón (no se adivina)',
        pageCode.includes('savedMap ? savedMap.get(book.id) : undefined') && pageCode.includes('{savedMap && ('));
    ok('§9 · quitar llama a deletePersonalReference',
        pageCode.includes('dataService.deletePersonalReference(referenceId)'));
    ok('§9 · la UI declara que quitar no borra contenido, acceso ni progreso',
        personalTab.includes('no lo elimina de Chibalete+ ni cambia tu acceso ni tu progreso'));
    ok('§9 · no se añadió ningún modal de confirmación nuevo',
        !uiCode.includes('Modal') && !uiCode.includes('window.confirm'));
    ok('§10 · no se introdujo drag-and-drop ni librería nueva para reordenar',
        !uiCode.includes('draggable') && !uiCode.includes('onDragStart') && !uiCode.includes('dnd'));
}

// ────────────────────────────────────────────────────────────────────────────
section('[13/14/15/16] capa INSTITUTIONAL');
{
    ok('§13 · el empty state es neutro',
        institutionalTab.includes('Aún no hay una biblioteca institucional que mostrar'));
    ok('§13 · no se ofrece selector de institución',
        !/instituci[oó]n/i.test((codeOf(institutionalTab).match(/<select[\s\S]*?<\/select>/g) || []).join(' '))
        && !/elige .*(colegio|instituci)/i.test(institutionalTab));
    ok('§13 · el empty state no nombra organizaciones, grupos ni ids',
        !/organizationId|groupId|scope_id|colegio/i.test(codeOf(institutionalTab)));
    ok('§14 · el gestor autorizado puede empezar a organizar desde el vacío',
        institutionalTab.includes('{canManage && (') && institutionalTab.includes('NewCollectionControl'));
    ok('§15 · canManage es presentación: decide qué se dibuja, no qué se permite',
        pageCode.includes('canManage={mayPresentInstitutionalManagement(user)}'));
    ok('§15 · el componente no autoriza: no consulta reglas ni scopes',
        !codeOf(institutionalTab).includes('evaluateScopeAccess') && !codeOf(institutionalTab).includes('scope'));
    ok('§16 · CRUD mínimo: crear colección, publicar/despublicar, añadir y quitar',
        pageCode.includes('dataService.createInstitutionalCollection(name)')
        && pageCode.includes('dataService.updateInstitutionalCollection(collectionId, { published })')
        && pageCode.includes('dataService.addInstitutionalReference(bookId, collectionId)')
        && pageCode.includes('dataService.deleteInstitutionalReference(referenceId)'));
    ok('§16 · no se inventaron workflows, sharing, plantillas ni analytics',
        !/workflow|sharing|template|analytics|approve/i.test(codeOf(institutionalTab)));
    ok('§18/§19 · la UI dice explícitamente que curar no concede acceso',
        institutionalTab.includes('No concede acceso'));
}

// ────────────────────────────────────────────────────────────────────────────
section('[26] sin estado global nuevo');
{
    for (const forbidden of ['redux', 'createContext', 'indexedDB', 'localStorage', 'sessionStorage', 'zustand']) {
        ok(`§26 · las capas nuevas no introducen "${forbidden}"`,
            !uiCode.includes(forbidden) && !codeOf(layers).includes(forbidden));
    }
    ok('§26 · el estado vive en useState/useCallback de la página',
        pageCode.includes('useState<LayerState>') && pageCode.includes('React.useCallback'));
    ok('§26 · «guardado» es derivado, no un segundo store persistente',
        pageCode.includes('savedReferenceIdByBookId(personal.view)'));
}

// ────────────────────────────────────────────────────────────────────────────
section('[M1-A] el navegador sigue sin emitir x-user-id');
{
    for (const [name, src] of [['Biblioteca.tsx', page], ['PersonalLibraryTab', personalTab],
        ['InstitutionalLibraryTab', institutionalTab], ['libraryLayers.mjs', layers]]) {
        ok(`${name} no emite el header legacy`, !/['"]x-user-id['"]\s*:/.test(src));
    }
}

console.log(`\nBibliotecaLibraryLayers.structural: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
