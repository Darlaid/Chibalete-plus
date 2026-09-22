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

import { createAccessService, isPedagogyRestrictedItem } from '../accessService.js';
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

const { getAccessibleContentIds } = createAccessService({
    readJSON, log: () => {}, normalizeUser, normalizeGroup,
    USERS_DB, GROUPS_DB, ACCESS_DB, fallbackMode: 'restricted',
});

const PEDAGOGY_PRIVILEGED_ROLES = ['administrador', 'mediador'];
const rolesOf = (u) => u.roles ?? (u.rol ? [u.rol] : []);

/** Réplica del cuerpo de `GET /api/content/my-catalog` (server.js). */
function myCatalog(user) {
    const { titleIds, collectionIds } = getAccessibleContentIds(user.id);
    const seesPedagogy = rolesOf(user).some(r => PEDAGOGY_PRIVILEGED_ROLES.includes(r));
    const catalog = CONTENT.filter(item =>
        (titleIds.includes(item.id) ||
            (item.collectionId && collectionIds.includes(item.collectionId))) &&
        (seesPedagogy || !isPedagogyRestrictedItem(item))
    );
    return { success: true, catalog: catalog.map(i => ({ id: i.id, title: i.titulo, type: i.tipo, coverImage: null, collectionId: i.collectionId ?? null })) };
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
// F. admin sin reglas → vacío
{
    const v = libraryBooksTab(byId('u-admin'));
    ok('F · admin sin reglas → Biblioteca vacía, sin bypass', v.length === 0, JSON.stringify(v.map(c => c.id)));
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

console.log(`\nlibraryServerAuthoritative: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
