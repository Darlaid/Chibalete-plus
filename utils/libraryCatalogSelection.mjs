/**
 * libraryCatalogSelection.mjs — CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-1.
 *
 * Selección del conjunto visible de /biblioteca a partir de la ÚNICA autoridad
 * server-side: `GET /api/content/my-catalog`.
 *
 * POR QUÉ EXISTE
 * --------------
 * El preflight 11A encontró que la biblioteca que veía el usuario la armaba el
 * navegador: `GET /api/content` devuelve el catálogo completo (solo resta el
 * material pedagógico por rol) y `dataService.getContenidos` decidía el
 * entitlement en el cliente, con un bypass explícito para `administrador` y
 * `mediador` que el servidor no aplica. Eso era una segunda política de acceso
 * viviendo en el navegador, contra la regla permanente del proyecto.
 *
 * SEPARACIÓN QUE ESTE MÓDULO HACE EXPLÍCITA
 * -----------------------------------------
 *   ACCESS FILTER        → SIEMPRE el servidor. Es la lista de ids que devuelve
 *                          my-catalog. Este módulo no la amplía nunca: solo
 *                          puede perder ids que el catálogo local no conoce.
 *   PRESENTATION FILTER  → puede vivir en el cliente, porque no decide
 *                          entitlement: `standalone === false` (piezas de
 *                          Experiencias), `hiddenContentIds` del colegio,
 *                          filtro por `tipo`, orden y paginación.
 *
 * POR QUÉ HIDRATAMOS DESDE LA CACHÉ Y NO DESDE LA RESPUESTA
 * ---------------------------------------------------------
 * La proyección de my-catalog son 5 campos (`id, title, type, coverImage,
 * collectionId`) y la tarjeta de Biblioteca necesita `titulo`, `autor`,
 * `portada_url`, `etiquetas`, `metricas`, `sectionIds` y `standalone`. Ampliar
 * el contrato del endpoint está fuera del alcance de 11B-1, así que:
 *
 *   my-catalog        → AUTORIDAD del conjunto (qué ids son visibles)
 *   catálogo cacheado → PRESENTACIÓN del conjunto (cómo se dibuja cada id)
 *
 * La metadata del catálogo general sigue llegando al navegador; esa es la deuda
 * `GENERAL_CATALOG_METADATA_EXPOSURE`, registrada y fuera de alcance. Lo que
 * cambia aquí es que /biblioteca ya no la usa para DECIDIR qué se ve.
 *
 * FAIL-CLOSED
 * -----------
 * Si la respuesta no se puede interpretar, `parseMyCatalogResponse` devuelve
 * `null` y el llamador no muestra catálogo. Nunca se degrada al filtro de
 * cliente: degradar reintroduciría exactamente la política que esta etapa
 * elimina.
 */

/** Ruta relativa al `apiUrl` del cliente. */
export const MY_CATALOG_PATH = '/content/my-catalog';

/**
 * Extrae la lista autoritativa de ids de la respuesta de my-catalog.
 *
 * @param {unknown} json cuerpo ya parseado de la respuesta
 * @returns {string[]|null} ids en el orden del servidor, o `null` si la
 *   respuesta no es interpretable (fail-closed: el llamador no debe adivinar).
 */
export function parseMyCatalogResponse(json) {
    if (!json || typeof json !== 'object') return null;
    if (json.success !== true) return null;
    if (!Array.isArray(json.catalog)) return null;
    const ids = [];
    const seen = new Set();
    for (const row of json.catalog) {
        const id = row && typeof row === 'object' ? row.id : null;
        if (typeof id !== 'string' || id === '') continue;
        if (seen.has(id)) continue;   // §8-I: una sola entrada por content id
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

/**
 * Proyecta los ids autorizados sobre el catálogo canónico ya cacheado.
 *
 * Conserva el ORDEN DEL CATÁLOGO cacheado, no el de la respuesta, para que la
 * rejilla de /biblioteca se dibuje exactamente igual que antes de esta etapa:
 * el cambio es de autoridad, no de presentación.
 *
 * Un id autorizado que el catálogo local no conoce se descarta — no se puede
 * dibujar una tarjeta sin metadata. Es una pérdida, nunca una ganancia: el
 * resultado es siempre un subconjunto de lo que el servidor autorizó.
 *
 * @param {string[]|null} authorizedIds salida de `parseMyCatalogResponse`
 * @param {Array<{id:string}>} cachedContent catálogo canónico del cliente
 * @returns {Array<object>|null} contenido visible, o `null` si no hay autoridad
 */
export function hydrateVisibleContent(authorizedIds, cachedContent) {
    if (!Array.isArray(authorizedIds)) return null;
    const allowed = new Set(authorizedIds);
    if (allowed.size === 0) return [];
    if (!Array.isArray(cachedContent)) return [];
    const out = [];
    const emitted = new Set();
    for (const item of cachedContent) {
        const id = item && typeof item === 'object' ? item.id : null;
        if (typeof id !== 'string' || !allowed.has(id)) continue;
        if (emitted.has(id)) continue;   // §8-I: dedupe también del lado caché
        emitted.add(id);
        out.push(item);
    }
    return out;
}

/**
 * Pestaña «Libros Álbum» — misma derivación que `dataService.getLibrosAlbum`,
 * pero aplicada sobre el conjunto autorizado por el servidor en vez de sobre el
 * catálogo completo filtrado en cliente. Filtro de PRESENTACIÓN por `tipo`.
 */
export function deriveAlbumFromVisible(visible) {
    return Array.isArray(visible) ? visible.filter(c => c && c.tipo === 'libro_album') : [];
}

/**
 * Pestaña «Para Ti» — misma derivación que `dataService.getRecomendadosComunidad`
 * (orden por calificación, tope 5), sobre el conjunto autorizado. Filtro de
 * PRESENTACIÓN: ordena y recorta, no decide acceso.
 */
export function deriveRecommendedFromVisible(visible, limit = 5) {
    if (!Array.isArray(visible)) return [];
    const score = (c) => (c && c.metricas && Number(c.metricas.calificacion_promedio)) || 0;
    return [...visible].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/**
 * Pestaña «Continuar Leyendo» — el historial de progreso lo arma `dataService`
 * con su propio filtro de cliente (que incluye el bypass de rol). Aquí se
 * INTERSECA con el conjunto autorizado por el servidor, de modo que el
 * resultado sea siempre un subconjunto de lo que el servidor concede: el bypass
 * deja de poder mostrar nada que el servidor no autorice.
 *
 * La intersección solo puede quitar elementos, nunca añadirlos — es fail-closed
 * por construcción.
 */
export function gateProgressByVisible(progressItems, visible) {
    if (!Array.isArray(progressItems)) return [];
    if (!Array.isArray(visible)) return [];
    const allowed = new Set(visible.map(c => c && c.id).filter(Boolean));
    return progressItems.filter(i => i && i.content && allowed.has(i.content.id));
}
