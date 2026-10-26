/**
 * adminCatalogFilters.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-C (CATÁLOGOS-02).
 *
 * Filtros de PRESENTACIÓN del catálogo administrativo (/subir-contenido, modo
 * gestión), abiertos desde /admin/editoriales. Operan sobre la lista que la
 * página ya recibe; no amplían permisos ni escriben nada.
 *
 *   editorial  id de editorial, o '__sin_editorial__' (libros sin editorial)
 *   clase      'libros' | 'recursos' (libro = tipo libro/libro_album, la misma
 *              regla que cuenta `bookCount` en el servidor)
 *   sello      texto del sello, o '__sin_sello__'
 *   estado     valor de `status`, o '__sin_estado__'
 */
import { isBookForm } from './publisherRequirement.mjs';

export const NO_PUBLISHER = '__sin_editorial__';
export const NO_IMPRINT = '__sin_sello__';
export const NO_STATUS = '__sin_estado__';
export const CONTENT_CLASSES = Object.freeze(['libros', 'recursos']);

const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const contentClassOf = (c) => (isBookForm(c?.tipo) ? 'libros' : 'recursos');
export const imprintKeyOf = (c) => textOrNull(c?.imprint) ?? NO_IMPRINT;
export const statusKeyOf = (c) => textOrNull(c?.status) ?? NO_STATUS;

/** Lee los filtros de la URL; un valor desconocido de `clase` se ignora. */
export function readCatalogFilters(searchParams) {
    const get = (k) => textOrNull(searchParams?.get?.(k) ?? null);
    const clase = get('clase');
    return { editorial: get('editorial'), clase: CONTENT_CLASSES.includes(clase) ? clase : null, sello: get('sello'), estado: get('estado') };
}

export function filterCatalog(list, { editorial = null, clase = null, sello = null, estado = null } = {}) {
    return (Array.isArray(list) ? list : []).filter((c) => {
        if (!c) return false;
        if (editorial === NO_PUBLISHER) { if (c.publisherId || !isBookForm(c.tipo)) return false; }
        else if (editorial && c.publisherId !== editorial) return false;
        if (clase && contentClassOf(c) !== clase) return false;
        if (sello && imprintKeyOf(c) !== sello) return false;
        if (estado && statusKeyOf(c) !== estado) return false;
        return true;
    });
}

/**
 * Valores presentes para ofrecer como opciones (sobre la lista ya filtrada por
 * editorial y clase): un selector solo tiene sentido si hay más de un valor.
 */
export function catalogFacets(list) {
    const imprints = new Set();
    const statuses = new Set();
    let libros = 0, recursos = 0;
    for (const c of Array.isArray(list) ? list : []) {
        if (!c) continue;
        imprints.add(imprintKeyOf(c));
        statuses.add(statusKeyOf(c));
        if (contentClassOf(c) === 'libros') libros++; else recursos++;
    }
    const sorted = (s) => [...s].sort((a, b) => a.localeCompare(b, 'es'));
    return { imprints: sorted(imprints), statuses: sorted(statuses), libros, recursos };
}
