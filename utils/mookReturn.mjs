/**
 * mookReturn.mjs — CHP-MOOK-CONTEXTUAL-READING-RETURN-01
 *
 * Origen MOOK de una lectura, transportado por la URL.
 *
 * Un texto puede abrirse desde Biblioteca o desde un nodo de un MOOK, y el mismo
 * contenido puede llegar por las dos vías. Así que el origen NO se deduce del
 * contenido —ni de `standalone`, ni de etiquetas, ni del `contentId`—: viaja
 * explícito desde quien abre la lectura.
 *
 * Va en la query (`?exp=…&node=…`) y no en `location.state`, porque tiene que
 * sobrevivir a una recarga del lector. Sin `document.referrer`, sin
 * localStorage/sessionStorage y sin aceptar una URL de retorno arbitraria: solo
 * dos identificadores, y el destino lo construye este módulo.
 *
 * **Son una pista de navegación, no una credencial.** El Runtime sigue
 * validando pertenencia y accesibilidad con su autoridad de siempre; traer un
 * `nodeId` en la URL no abre nada que estuviera bloqueado.
 */

export const MOOK_EXP_PARAM = 'exp';
export const MOOK_NODE_PARAM = 'node';

/**
 * Los ids del sistema son `exp-…`, `expv-…` y `n-…`: alfanuméricos con guiones.
 * Se acota la forma para no arrastrar a la URL nada que no sea un id.
 */
const ID_SHAPE = /^[A-Za-z0-9._-]{1,120}$/;

/**
 * Lee el origen MOOK de una query string.
 * @param {string} search  `location.search`, con o sin `?`.
 * @returns {{experienceId: string, nodeId: string} | null}
 */
export function readMookContext(search) {
    if (!search) return null;
    let params;
    try {
        params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    } catch { return null; }
    const experienceId = params.get(MOOK_EXP_PARAM);
    const nodeId = params.get(MOOK_NODE_PARAM);
    if (!experienceId || !nodeId) return null;
    if (!ID_SHAPE.test(experienceId) || !ID_SHAPE.test(nodeId)) return null;
    return { experienceId, nodeId };
}

/**
 * Añade el origen a una ruta interna, conservando lo que ya trajera.
 * Devuelve la ruta sin tocar si no hay contexto: quien abre desde Biblioteca no
 * debe acabar con parámetros inventados.
 *
 * @param {string} path  ruta interna, p. ej. `/leer/texto/content-1`
 * @param {{experienceId: string, nodeId: string} | null} ctx
 */
export function withMookContext(path, ctx) {
    if (!ctx || !ctx.experienceId || !ctx.nodeId) return path;
    const [base, existing = ''] = String(path).split('?');
    const params = new URLSearchParams(existing);
    params.set(MOOK_EXP_PARAM, ctx.experienceId);
    params.set(MOOK_NODE_PARAM, ctx.nodeId);
    return `${base}?${params.toString()}`;
}

/**
 * Destino de «Volver al MOOK»: la Experience de origen, pidiendo que el Runtime
 * abra ese nodo. La ruta la construye este módulo a partir de dos ids, así que
 * nunca puede convertirse en un redirect abierto.
 */
export function mookReturnPath(ctx) {
    if (!ctx || !ctx.experienceId || !ctx.nodeId) return null;
    const params = new URLSearchParams({ [MOOK_NODE_PARAM]: ctx.nodeId });
    return `/experiencias/${encodeURIComponent(ctx.experienceId)}?${params.toString()}`;
}

/**
 * ¿Puede abrirse ese nodo al volver?
 *
 * Se resuelve SOLO con la ruta que ya devolvió el servidor: el nodo tiene que
 * pertenecer al recorrido y no estar bloqueado. Un `nodeId` inventado, de otra
 * Experience o de un paso todavía cerrado devuelve `null`, y el Runtime se queda
 * en su punto canónico en vez de abrirlo.
 *
 * @param {Array<{id: string, state: string}>} routeNodes  `route.nodes`
 * @param {string} nodeId
 * @returns {string | null}  el id si es utilizable; `null` si no
 */
export function resolveReturnNode(routeNodes, nodeId) {
    if (!Array.isArray(routeNodes) || !nodeId) return null;
    const node = routeNodes.find(n => n && n.id === nodeId);
    if (!node) return null;
    if (node.state === 'locked') return null;
    return node.id;
}
