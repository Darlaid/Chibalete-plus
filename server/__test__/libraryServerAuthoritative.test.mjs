/**
 * libraryServerAuthoritative.test.mjs
 * CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-1 §§8-11, 18.
 *
 * Demuestra que el conjunto visible de /biblioteca lo decide el SERVIDOR y que
 * el cliente no puede ampliarlo.
 *
 * Método (mismo patrón que `endpointsMembership.test.js`): se usa el motor de
 * acceso REAL (`createAccessService`, `fallbackMode: 'restricted'`) sobre
 * fixtures en memoria y se reproduce el cuerpo del handler de my-catalog. §0
 * comprueba contra el fuente que la réplica no ha driftado.
 *
 * Después se ejecutan las funciones REALES del cliente
 * (`utils/libraryCatalogSelection.mjs`) sobre esa salida y se comprueba la
 * paridad servidor ↔ pestaña Libros para cada identidad.
 *
 * Stores reales: 0 lecturas, 0 escrituras. Todo es memoria.
 *
 *   node server/__test__/libraryServerAuthoritative.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAccessService, createPrivilegedContentAccess, isPedagogyRestrictedItem } from '../accessService.js';
import {
    parseMyCatalogResponse,
    hydrateVisibleContent,
    deriveAlbumFromVisible,
    deriveRecommendedFromVisible,
    gateProgressByVisible,
} from '../../utils/libraryCatalogSelection.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const setEq = (a, b) => {
    const A = new Set(a), B = new Set(b);
    return A.size === B.size && [...A].every(x => B.has(x));
};

// ────────────────────────────────────────────────────────────────────────────
// FIXTURES — §18. 2 instituciones, 3 grupos, identidades de todos los casos.
// Ningún id productivo real (§9).
// ────────────────────────────────────────────────────────────────────────────
const ORG_A = 'org-alfa', ORG_B = 'org-beta';

const CONTENT = [
    { id: 'c-lib-1',  tipo: 'libro',       titulo: 'Uno',    autor: 'A', metricas: { calificacion_promedio: 4.0 } },
    { id: 'c-lib-2',  tipo: 'libro',       titulo: 'Dos',    autor: 'B', metricas: { calificacion_promedio: 5.0 } },
    { id: 'c-lib-3',  tipo: 'libro',       titulo: 'Tres',   autor: 'C', metricas: { calificacion_promedio: 3.0 } },
    { id: 'c-alb-1',  tipo: 'libro_album', titulo: 'Álbum',  autor: 'D', metricas: { calificacion_promedio: 4.5 } },
    // §7 — pieza de Experiencia: tipo pedagógico con standalone:false.
    { id: 'c-emb-1',  tipo: 'guia',        titulo: 'Nodo',   autor: 'E', standalone: false, metricas: { calificacion_promedio: 1.0 } },
    // §8-G — material pedagógico independiente: solo mediador/admin.
    { id: 'c-ped-1',  tipo: 'guia',        titulo: 'Guía',   autor: 'F', metricas: { calificacion_promedio: 2.0 } },
    // Solo de la institución B — testigo cross-tenant (§10).
    { id: 'c-beta-1', tipo: 'libro',       titulo: 'Beta',   autor: 'G', metricas: { calificacion_promedio: 4.9 } },
    // Nunca concedido a nadie (§8-H).
    { id: 'c-nadie',  tipo: 'libro',       titulo: 'Nadie',  autor: 'H', metricas: { calificacion_promedio: 5.0 } },
];

const GROUPS = [
    { id: 'g-a1', type: 'course', organizationId: ORG_A, mediatorIds: ['u-mediador'], memberIds: ['u-grupo', 'u-multi'] },
    { id: 'g-a2', type: 'club',   organizationId: ORG_A, mediatorIds: [],             memberIds: ['u-multi'] },
    { id: 'g-b1', type: 'course', organizationId: ORG_B, mediatorIds: [],             memberIds: ['u-beta'] },
];

const USERS = [
    { id: 'u-grupo',    roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' },
    { id: 'u-user',     roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' },  // §9 sin grupo
    { id: 'u-sinnada',  roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' },
    { id: 'u-multi',    roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' },
    { id: 'u-mediador', roles: ['mediador'],      organizationId: ORG_A, accountStatus: 'active' },
    { id: 'u-admin',    roles: ['administrador'], organizationId: ORG_A, accountStatus: 'active' },  // §8-F sin reglas
    { id: 'u-beta',     roles: ['lector'],        organizationId: ORG_B, accountStatus: 'active' },
    { id: 'u-off',      roles: ['lector'],        organizationId: ORG_A, accountStatus: 'disabled' }, // §11
];

const ACCESS = [
    { id: 'r-g-a1', scope: 'group', scopeId: 'g-a1', titleIds: ['c-lib-1', 'c-lib-2', 'c-emb-1', 'c-ped-1'], collectionIds: [] },
    { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c-lib-2', 'c-lib-3', 'c-alb-1'],            collectionIds: [] },
    { id: 'r-u',    scope: 'user',  scopeId: 'u-user', titleIds: ['c-lib-1', 'c-lib-3'],                     collectionIds: [] },
    { id: 'r-g-b1', scope: 'group', scopeId: 'g-b1', titleIds: ['c-beta-1'],                                 collectionIds: [] },
    // §11 — la cuenta deshabilitada tiene regla: la sesión, no el motor, la excluye.
    { id: 'r-off',  scope: 'user',  scopeId: 'u-off', titleIds: ['c-lib-1', 'c-lib-2'],                      collectionIds: [] },
];

const USERS_DB = '::users', GROUPS_DB = '::groups', ACCESS_DB = '::access';
const readJSON = (p) => p === USERS_DB ? USERS : p === GROUPS_DB ? GROUPS : p === ACCESS_DB ? ACCESS : [];

// Normalizadores mínimos para la forma del fixture (todos traen organizationId
// explícito, así que el camino legacy `colegio → school` del servidor no aplica).
const normalizeUser = (u) => (u ? { ...u } : u);
const normalizeGroup = (g) => (g ? { ...g, type: ['course', 'club'].includes(g.type) ? g.type : 'course',
    mediatorIds: g.mediatorIds ?? [], memberIds: g.memberIds ?? [] } : g);

const { getAccessibleContentIds, canUserAccessContent } = createAccessService({
    readJSON, log: () => {}, normalizeUser, normalizeGroup,
    USERS_DB, GROUPS_DB, ACCESS_DB, fallbackMode: 'restricted',
});

const PEDAGOGY_PRIVILEGED_ROLES = ['administrador', 'mediador'];
const rolesOf = (u) => u.roles ?? (u.rol ? [u.rol] : []);

// CHP-UI-PEDAGOGY-VISIBILITY-01 — school_configs en memoria para la decisión
// de rol REAL (createPrivilegedContentAccess), la misma que usa el preflight.
let SCHOOL_CONFIGS = [];
const privilegedFor = (user, contentList = CONTENT) => createPrivilegedContentAccess(user, {
    loadSchoolConfigs: () => SCHOOL_CONFIGS,
    resolveCollectionContentIds: (ids) => contentList.filter(c => c.parentId && ids.includes(c.parentId)).map(c => c.id),
});

/** Réplica de `visibleCatalogForUser` + cuerpo de `GET /api/content/my-catalog` (server.js). */
function myCatalog(user, contentList = CONTENT) {
    const { titleIds, collectionIds } = getAccessibleContentIds(user.id);
    const seesPedagogy = rolesOf(user).some(r => PEDAGOGY_PRIVILEGED_ROLES.includes(r));
    const privileged = privilegedFor(user, contentList);
    const catalog = contentList.filter(item =>
        (!privileged || privileged(item.id).allowed) &&
        (titleIds.includes(item.id) ||
            (item.collectionId && collectionIds.includes(item.collectionId)) ||
            (privileged && isPedagogyRestrictedItem(item))) &&
        (seesPedagogy || !isPedagogyRestrictedItem(item))
    );
    return { success: true, catalog: catalog.map(i => ({ id: i.id, title: i.titulo, type: i.tipo, coverImage: null, collectionId: i.collectionId ?? null })) };
}

/**
 * Modelo del preflight `GET /api/content/:id/access` con fallbackMode
 * 'restricted' (el de estos fixtures): decisión de rol → veto pedagógico →
 * scope engine. Asignaciones: siempre vacías en el servidor actual.
 */
function preflightAllows(user, item, contentList = CONTENT) {
    const privileged = privilegedFor(user, contentList);
    if (privileged) return privileged(item.id).allowed;
    if (isPedagogyRestrictedItem(item)) return false;
    return canUserAccessContent(user.id, item.id, item).allowed;
}

/** Pestaña Libros tal y como la arma la página, con las funciones REALES. */
const libraryBooksTab = (user, cached = CONTENT) => {
    const visible = hydrateVisibleContent(parseMyCatalogResponse(myCatalog(user)), cached) ?? [];
    // `filterHidden` de Biblioteca.tsx: presentación, no acceso.
    return visible.filter(c => c && c.id && c.standalone !== false);
};
const byId = (u) => USERS.find(x => x.id === u);

// ── §0 ANTI-DRIFT ───────────────────────────────────────────────────────────
section('[0] la réplica del handler sigue coincidiendo con el fuente');
{
    const src = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
    const h = src.slice(src.indexOf("app.get('/api/content/my-catalog'"));
    const body = h.slice(0, h.indexOf('\n});'));
    ok('el handler existe', body.length > 0 && body.length < 4000);
    ok('usa requireUserAuth', body.includes('requireUserAuth'));
    ok('deriva el sujeto de req.user (sesión), no del query',
        body.includes('visibleCatalogForUser(req.user') && !body.includes('req.query.userId'));
    ok('responde { success, catalog }', body.includes('success: true') && body.includes('catalog:'));

    // 11B-2: el predicate se extrajo a visibleCatalogForUser para que las capas
    // INSTITUTIONAL/PERSONAL intersecten contra EXACTAMENTE el mismo conjunto.
    // El contrato no cambia; cambia dónde vive. Se verifica ahí.
    const p = src.slice(src.indexOf('function visibleCatalogForUser('));
    const pred = p.slice(0, p.indexOf('\n}'));
    ok('visibleCatalogForUser existe y es la única definición',
        pred.length > 0 && pred.length < 1200
        && (src.match(/function visibleCatalogForUser\(/g) || []).length === 1);
    ok('usa getAccessibleContentIds', pred.includes('getAccessibleContentIds(user.id)'));
    ok('mismo predicate de títulos/colecciones',
        pred.includes('titleIds.includes(item.id)') && pred.includes('collectionIds.includes(item.collectionId)'));
    ok('mismo predicate pedagógico', pred.includes('seesPedagogy || !isPedagogyRestrictedItem(item)'));
    // CHP-UI-PEDAGOGY-VISIBILITY-01
    ok('recorta con la decisión de rol del preflight',
        pred.includes('privilegedContentAccessFor(user)') && pred.includes('!privileged || privileged(item.id).allowed'));
    ok('pedagogía independiente solo por rol privilegiado',
        pred.includes('privileged && isPedagogyRestrictedItem(item)'));
    const pf = src.slice(src.indexOf("app.get('/api/content/:id/access'"));
    const pfBody = pf.slice(0, pf.indexOf('\n});'));
    ok('el preflight usa la MISMA decisión de rol', pfBody.includes('privilegedContentAccessFor(user)'));
    ok('el preflight ya no replica la lógica de rol/schoolConfig del mediador',
        !pfBody.includes("roles.includes('mediador')") && !pfBody.includes("roles.includes('administrador')"));
    const helper = src.slice(src.indexOf('function privilegedContentAccessFor('));
    ok('privilegedContentAccessFor delega en createPrivilegedContentAccess',
        helper.slice(0, helper.indexOf('\n}')).includes('createPrivilegedContentAccess(user'));
}

// ── §8 CASOS OBLIGATORIOS ───────────────────────────────────────────────────
section('[8] casos A–J');

// A. lector con entitlement por grupo
{
    const v = libraryBooksTab(byId('u-grupo')).map(c => c.id);
    ok('A · lector con grupo recibe sus títulos autorizados', setEq(v, ['c-lib-1', 'c-lib-2']), JSON.stringify(v));
    ok('A · no recibe el pedagógico restringido', !v.includes('c-ped-1'));
    ok('A · no recibe la pieza embebida (presentación)', !v.includes('c-emb-1'));
}
// B. lector con scope=user
{
    const v = libraryBooksTab(byId('u-user')).map(c => c.id);
    ok('B · lector user-scoped recibe sus títulos', setEq(v, ['c-lib-1', 'c-lib-3']), JSON.stringify(v));
}
// C. lector sin reglas
{
    const v = libraryBooksTab(byId('u-sinnada'));
    ok('C · lector sin reglas → catálogo vacío', v.length === 0, JSON.stringify(v.map(c => c.id)));
}
// D. multigrupo → unión deduplicada
{
    const v = libraryBooksTab(byId('u-multi')).map(c => c.id);
    ok('D · multigrupo recibe la UNIÓN', setEq(v, ['c-lib-1', 'c-lib-2', 'c-lib-3', 'c-alb-1']), JSON.stringify(v));
    ok('D · c-lib-2 (en ambos grupos) aparece UNA vez', v.filter(x => x === 'c-lib-2').length === 1);
}
// E. mediador — exactamente lo del servidor, sin bypass
{
    const v = libraryBooksTab(byId('u-mediador')).map(c => c.id);
    ok('E · mediador recibe solo lo que concede su grupo', setEq(v, ['c-lib-1', 'c-lib-2', 'c-ped-1']), JSON.stringify(v));
    ok('E · mediador NO recibe el catálogo completo', v.length < CONTENT.length);
    ok('E · el mediador sí ve pedagogía (rol, decidido en servidor)', v.includes('c-ped-1'));
}
// F. admin sin reglas → sin bypass para el contenido general
// CHP-UI-PEDAGOGY-VISIBILITY-01: el material pedagógico independiente no lleva
// grants (se concede por rol) y el preflight se lo autoriza: sí aparece.
{
    const v = libraryBooksTab(byId('u-admin')).map(c => c.id);
    ok('F · admin sin reglas → ningún contenido general, sin bypass',
        !v.some(id => !isPedagogyRestrictedItem(CONTENT.find(c => c.id === id))), JSON.stringify(v));
    ok('F · admin sin reglas → sí recibe el pedagógico independiente', setEq(v, ['c-ped-1']), JSON.stringify(v));
}
// G. pedagógico no permitido
{
    ok('G · el lector con derecho explícito sobre c-ped-1 igual no lo ve',
        !libraryBooksTab(byId('u-grupo')).some(c => c.id === 'c-ped-1'));
}
// H. no autorizado ausente aunque el catálogo general lo incluya
{
    const v = libraryBooksTab(byId('u-grupo')).map(c => c.id);
    ok('H · c-nadie está en el catálogo general…', CONTENT.some(c => c.id === 'c-nadie'));
    ok('H · …y ausente de la Biblioteca', !v.includes('c-nadie'));
}
// I. reglas duplicadas → una sola entrada
{
    const dup = { success: true, catalog: [{ id: 'c-lib-1' }, { id: 'c-lib-1' }, { id: 'c-lib-2' }] };
    const ids = parseMyCatalogResponse(dup);
    ok('I · respuesta con duplicados → ids únicos', ids.length === 2 && setEq(ids, ['c-lib-1', 'c-lib-2']), JSON.stringify(ids));
    const cachedDup = [...CONTENT, { id: 'c-lib-1', tipo: 'libro', titulo: 'Uno bis', autor: 'A', metricas: { calificacion_promedio: 0 } }];
    const h = hydrateVisibleContent(['c-lib-1'], cachedDup);
    ok('I · caché con id repetido → una sola tarjeta', h.length === 1);
}
// J. userId/roles manipulados en cliente no alteran nada
{
    section('[8-J] identidad manipulada en el cliente');
    const src = fs.readFileSync(path.join(ROOT, 'services', 'dataService.ts'), 'utf8');
    const m = src.slice(src.indexOf('async getMyCatalog('));
    const sig = m.slice(0, m.indexOf('{'));
    ok('J · getMyCatalog no acepta argumentos', /getMyCatalog\(\s*\)/.test(sig), sig.trim());
    const body = m.slice(0, m.indexOf('\n    }'));
    ok('J · no envía userId', !/userId/.test(body));
    ok('J · no envía roles', !/roles/.test(body));
    ok('J · no envía organizationId ni groupId', !/organizationId|groupId/.test(body));
    ok('J · usa la cookie de sesión', body.includes("credentials: 'include'"));
    // El conjunto del cliente no puede crecer: hidratar con ids inventados no añade nada.
    const inflado = hydrateVisibleContent(['c-lib-1', 'c-nadie', 'c-beta-1'], CONTENT).map(c => c.id);
    ok('J · el cliente sí podría pedir de más… pero la lista la emite el servidor', inflado.length === 3);
    const real = libraryBooksTab(byId('u-grupo')).map(c => c.id);
    ok('J · y el servidor nunca emitió c-nadie ni c-beta-1 para esa identidad',
        !real.includes('c-nadie') && !real.includes('c-beta-1'));
}

// ── §9 USER-SCOPED TESTIGO ──────────────────────────────────────────────────
section('[9] USER_SCOPED_LIBRARY_ACCESS');
{
    const u = byId('u-user');
    ok('el testigo no pertenece a ningún grupo',
        !GROUPS.some(g => g.memberIds.includes(u.id) || g.mediatorIds.includes(u.id)));
    const v = libraryBooksTab(u).map(c => c.id);
    ok('recibe exactamente sus 2 títulos user-scoped', setEq(v, ['c-lib-1', 'c-lib-3']), JSON.stringify(v));
    ok('funciona con fallbackMode=restricted, sin fallback legacy', v.length === 2);
}

// ── §10 CROSS-TENANT ────────────────────────────────────────────────────────
section('[10] LIBRARY_CROSS_TENANT');
{
    for (const id of ['u-grupo', 'u-user', 'u-multi', 'u-mediador', 'u-admin']) {
        ok(`${id} (org A) no obtiene el título de la institución B`,
            !libraryBooksTab(byId(id)).some(c => c.id === 'c-beta-1'));
    }
    const beta = libraryBooksTab(byId('u-beta')).map(c => c.id);
    ok('el usuario de B sí obtiene el suyo', setEq(beta, ['c-beta-1']), JSON.stringify(beta));
    ok('y ninguno de A', !beta.some(x => ['c-lib-1', 'c-lib-2', 'c-lib-3', 'c-alb-1'].includes(x)));
}

// ── §11 DISABLED / INERT ────────────────────────────────────────────────────
section('[11] cuenta deshabilitada');
{
    const src = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
    const ra = src.slice(src.indexOf('const requireUserAuth ='));
    const body = ra.slice(0, ra.indexOf('\n};'));
    ok('requireUserAuth rechaza la cuenta no activa antes del handler',
        body.includes('isUserActive(user)') && body.includes("status(401)"));
    // El motor de acceso NO es quien la excluye: su regla existe y resuelve.
    const { titleIds } = getAccessibleContentIds('u-off');
    ok('el motor de acceso sí resolvería su regla (la excluye la SESIÓN, no el motor)',
        setEq(titleIds, ['c-lib-1', 'c-lib-2']), JSON.stringify(titleIds));
    ok('con 401 el cliente es fail-closed: sin autoridad, sin catálogo',
        hydrateVisibleContent(parseMyCatalogResponse(null), CONTENT) === null);
}

// ── §18 PARIDAD SERVIDOR ↔ CLIENTE ──────────────────────────────────────────
section('[18] LIBRARY_SERVER_CLIENT_PARITY');
{
    for (const u of USERS.filter(x => x.id !== 'u-off')) {
        const server = myCatalog(u).catalog.map(r => r.id);
        const client = (hydrateVisibleContent(parseMyCatalogResponse(myCatalog(u)), CONTENT) ?? []).map(c => c.id);
        ok(`${u.id}: visible_from_my_catalog == visible_in_library (antes de presentación)`,
            setEq(server, client), `${JSON.stringify(server)} vs ${JSON.stringify(client)}`);
    }
    // La presentación solo puede restar, nunca añadir.
    for (const u of USERS.filter(x => x.id !== 'u-off')) {
        const server = new Set(myCatalog(u).catalog.map(r => r.id));
        ok(`${u.id}: la pestaña Libros ⊆ conjunto del servidor`,
            libraryBooksTab(u).every(c => server.has(c.id)));
    }
}

// ── §7 PRESENTACIÓN vs ACCESO ───────────────────────────────────────────────
section('[7] CLIENT_PRESENTATION_POLICY');
{
    const u = byId('u-grupo');
    const server = myCatalog(u).catalog.map(r => r.id);
    ok('el servidor SÍ autoriza la pieza embebida', server.includes('c-emb-1'));
    ok('y la pestaña Libros NO la muestra (standalone:false)',
        !libraryBooksTab(u).some(c => c.id === 'c-emb-1'));
    // Derivadas: mismo conjunto autorizado, distinto recorte de presentación.
    const visible = hydrateVisibleContent(parseMyCatalogResponse(myCatalog(byId('u-multi'))), CONTENT);
    const alb = deriveAlbumFromVisible(visible).map(c => c.id);
    ok('Álbum = filtro por tipo sobre el conjunto autorizado', setEq(alb, ['c-alb-1']), JSON.stringify(alb));
    const rec = deriveRecommendedFromVisible(visible).map(c => c.id);
    ok('Para Ti = orden por calificación sobre el conjunto autorizado', rec[0] === 'c-lib-2', JSON.stringify(rec));
    ok('Para Ti nunca excede el conjunto autorizado',
        rec.every(id => visible.some(c => c.id === id)));
    const prog = [{ content: { id: 'c-lib-1' } }, { content: { id: 'c-nadie' } }];
    const gated = gateProgressByVisible(prog, visible).map(i => i.content.id);
    ok('Continuar Leyendo se interseca con el conjunto autorizado', setEq(gated, ['c-lib-1']), JSON.stringify(gated));
}

// ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
section('[FC] fail-closed, nunca degradar al filtro de cliente');
{
    ok('respuesta nula → null', parseMyCatalogResponse(null) === null);
    ok('success:false → null', parseMyCatalogResponse({ success: false, catalog: [] }) === null);
    ok('sin catalog → null', parseMyCatalogResponse({ success: true }) === null);
    ok('catalog no-array → null', parseMyCatalogResponse({ success: true, catalog: 'x' }) === null);
    ok('catálogo vacío es un conjunto válido y vacío (≠ null)',
        Array.isArray(parseMyCatalogResponse({ success: true, catalog: [] })) &&
        hydrateVisibleContent([], CONTENT).length === 0);
    ok('null de autoridad → hydrate devuelve null (no el catálogo entero)',
        hydrateVisibleContent(null, CONTENT) === null);
}

// ── ESTRUCTURA: la página ya no decide acceso ───────────────────────────────
section('[E] Biblioteca.tsx no decide entitlement');
{
    const src = fs.readFileSync(path.join(ROOT, 'pages', 'Biblioteca.tsx'), 'utf8');
    ok('usa getMyCatalog', src.includes('dataService.getMyCatalog()'));
    ok('ya no llama getContenidos', !src.includes('dataService.getContenidos('));
    ok('ya no llama getLibrosAlbum', !src.includes('dataService.getLibrosAlbum('));
    ok('ya no llama getRecomendadosComunidad', !src.includes('dataService.getRecomendadosComunidad('));
    ok('conserva el filtro de presentación standalone', src.includes("standalone !== false"));
    ok('conserva hiddenContentIds', src.includes('hiddenContentIds'));
    // Otras superficies intactas.
    const ds = fs.readFileSync(path.join(ROOT, 'services', 'dataService.ts'), 'utf8');
    ok('getContenidos sigue existiendo para las demás superficies', ds.includes('getContenidos(roles: string[]'));
    ok('getLibrosAlbum sigue existiendo', ds.includes('getLibrosAlbum(roles: string[]'));
    ok('getRecomendadosComunidad sigue existiendo', ds.includes('getRecomendadosComunidad(roles: string[]'));
}

// ── PV · CHP-UI-PEDAGOGY-VISIBILITY-01 — my-catalog ⇔ preflight ────────────
section('[PV] MY_CATALOG_PREFLIGHT_PARITY (pedagogía)');
{
    // Forma real de producción: módulos 1–3 `libro` con grant; Programa y
    // módulos 4–9 `articulo_pedagogico` SIN grant (el migrador V6 los excluye).
    const PV = [
        { id: 'pv-m1', tipo: 'libro', titulo: 'MÓDULO 1', sectionIds: ['sec-ped'] },
        { id: 'pv-m2', tipo: 'libro', titulo: 'MÓDULO 2', sectionIds: ['sec-ped'] },
        { id: 'pv-m3', tipo: 'libro', titulo: 'MÓDULO 3', sectionIds: ['sec-ped'] },
        { id: 'pv-tut', tipo: 'video', titulo: 'Tutorial', sectionIds: ['sec-ped'] },
        { id: 'pv-pi', tipo: 'articulo_pedagogico', titulo: 'Programa Integral', sectionIds: ['sec-ped'] },
        ...[4, 5, 6, 7, 8, 9].map(n => ({ id: `pv-m${n}`, tipo: 'articulo_pedagogico', titulo: `MÓDULO ${n}`, sectionIds: ['sec-ped'] })),
        { id: 'pv-mook', tipo: 'articulo_pedagogico', titulo: 'Nodo MOOK', standalone: false },
        { id: 'pv-mook-ng', tipo: 'articulo_pedagogico', titulo: 'Nodo MOOK sin grant', standalone: false },
        { id: 'pv-gen', tipo: 'libro', titulo: 'General sin grant' },
    ];
    const GRANTED = ['pv-m1', 'pv-m2', 'pv-m3', 'pv-tut', 'pv-mook'];
    const PED_4_9 = ['pv-m4', 'pv-m5', 'pv-m6', 'pv-m7', 'pv-m8', 'pv-m9'];
    const ALL_PED_SECTION = ['pv-m1', 'pv-m2', 'pv-m3', 'pv-tut', 'pv-pi', ...PED_4_9];

    const users = {
        admin:     { id: 'pv-admin',    roles: ['administrador'] },
        medOpen:   { id: 'pv-med-open', roles: ['mediador'] },                         // sin schoolConfig → MEDIATOR_ROLE
        medOrg:    { id: 'pv-med-org',  roles: ['mediador'], colegio: 'Colegio PV' },  // schoolConfig restrictiva
        lector:    { id: 'pv-lector',   roles: ['lector'] },                           // sin grant
        lectorPed: { id: 'pv-lector-g', roles: ['lector'] },                           // grant explícito incl. pedagógico
    };
    USERS.push(...Object.values(users).map(u => ({ ...u, accountStatus: 'active' })));
    for (const u of [users.admin, users.medOpen, users.medOrg]) {
        ACCESS.push({ id: `r-${u.id}`, scope: 'user', scopeId: u.id, titleIds: GRANTED, collectionIds: [] });
    }
    ACCESS.push({ id: 'r-pv-lector-g', scope: 'user', scopeId: users.lectorPed.id, titleIds: ['pv-m1', 'pv-m4'], collectionIds: [] });
    // La institución del mediador deja fuera pv-m9 (pedagógico) y pv-m2 (con grant).
    SCHOOL_CONFIGS = [{ schoolName: 'Colegio PV', availableContentIds: PV.map(c => c.id).filter(id => !['pv-m9', 'pv-m2'].includes(id)) }];

    const cat = (u) => myCatalog(u, PV).catalog.map(r => r.id);
    const tab = (u) => (hydrateVisibleContent(parseMyCatalogResponse(myCatalog(u, PV)), PV) ?? []).filter(c => c.standalone !== false);
    const pedSection = (u) => tab(u).filter(c => c.sectionIds?.includes('sec-ped')).map(c => c.id);
    const item = (id) => PV.find(c => c.id === id);

    // A. admin: Módulo 4 autorizado por preflight → aparece
    ok('A · preflight admin autoriza Módulo 4', preflightAllows(users.admin, item('pv-m4'), PV));
    ok('A · Módulo 4 aparece en my-catalog del admin', cat(users.admin).includes('pv-m4'));
    // B. admin: 4–9 todos + sección Pedagogía completa
    ok('B · admin recibe Módulos 4–9', PED_4_9.every(id => cat(users.admin).includes(id)), JSON.stringify(cat(users.admin)));
    ok('B · Biblioteca → Pedagogía del admin = 1–9 + Programa + Tutorial',
        setEq(pedSection(users.admin), ALL_PED_SECTION), JSON.stringify(pedSection(users.admin)));
    // C. mediador con acceso pedagógico permitido
    ok('C · mediador sin restricción institucional ve toda la sección Pedagogía',
        setEq(pedSection(users.medOpen), ALL_PED_SECTION), JSON.stringify(pedSection(users.medOpen)));
    // D. mediador con schoolConfig que niega
    ok('D · preflight niega pv-m9 al mediador de Colegio PV', !preflightAllows(users.medOrg, item('pv-m9'), PV));
    ok('D · pv-m9 (pedagógico) NO aparece en su my-catalog', !cat(users.medOrg).includes('pv-m9'));
    ok('D · pv-m2 (con grant pero fuera de su institución) tampoco', !cat(users.medOrg).includes('pv-m2'));
    ok('D · el resto de Pedagogía sí',
        setEq(pedSection(users.medOrg), ALL_PED_SECTION.filter(id => !['pv-m9', 'pv-m2'].includes(id))),
        JSON.stringify(pedSection(users.medOrg)));
    // E. usuario normal sin grant
    ok('E · lector sin grant no recibe material pedagógico',
        !cat(users.lector).some(id => isPedagogyRestrictedItem(item(id))));
    ok('E · lector sin grant → catálogo vacío', cat(users.lector).length === 0, JSON.stringify(cat(users.lector)));
    // F. grant explícito existente sigue funcionando
    ok('F · lector con grant recibe pv-m1', cat(users.lectorPed).includes('pv-m1'));
    ok('F · …pero un grant explícito no le abre pedagogía (veto del preflight)', !cat(users.lectorPed).includes('pv-m4'));
    ok('F · mediador y admin siguen recibiendo sus grants (1–3, Tutorial)',
        ['pv-m1', 'pv-m3', 'pv-tut'].every(id => cat(users.admin).includes(id) && cat(users.medOpen).includes(id)));
    // G. standalone:false sin cambio: lo decide el grant; la pestaña lo oculta
    ok('G · nodo MOOK con grant sigue en my-catalog', cat(users.admin).includes('pv-mook'));
    ok('G · nodo MOOK sin grant NO entra por rol (no es PEDAGOGY_RESTRICTED)', !cat(users.admin).includes('pv-mook-ng'));
    ok('G · y Biblioteca no dibuja nodos MOOK (presentación)', !tab(users.admin).some(c => c.standalone === false));

    // Paridad: my-catalog ⇔ preflight en todo el fixture salvo el contenido
    // GENERAL/EMBEBIDO sin grant, que se trata aparte (NO-BYPASS).
    const NO_GRANT_NON_PED = ['pv-gen', 'pv-mook-ng'];
    const PARITY = PV.filter(c => !NO_GRANT_NON_PED.includes(c.id));
    for (const [name, u] of Object.entries(users)) {
        const inCat = new Set(cat(u));
        const mism = PARITY.filter(c => inCat.has(c.id) !== preflightAllows(u, c, PV)).map(c => c.id);
        ok(`PARITY · ${name}: MY_CATALOG_ACCESS == PREFLIGHT_ACCESS`, mism.length === 0, JSON.stringify(mism));
    }
    // Invariante dura en TODO el fixture: my-catalog ⊆ preflight.
    for (const [name, u] of Object.entries(users)) {
        ok(`SUBSET · ${name}: my-catalog ⊆ preflight`, PV.filter(c => cat(u).includes(c.id)).every(c => preflightAllows(u, c, PV)));
    }
    // Contenido no pedagógico sin grant: el preflight de rol lo concede (canal
    // legacy ADMIN_ROLE / MEDIATOR_ROLE) y Biblioteca NO lo replica (11B-1).
    ok('NO-BYPASS · admin: preflight concede pv-gen', preflightAllows(users.admin, item('pv-gen'), PV));
    ok('NO-BYPASS · …y my-catalog no lo incluye', !cat(users.admin).includes('pv-gen'));
    ok('NO-BYPASS · mediador sin restricción: tampoco', !cat(users.medOpen).includes('pv-gen'));
}

console.log(`\nlibraryServerAuthoritative: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
