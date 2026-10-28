/**
 * publisherCatalog.mjs — PLAN-EDITORIALES-INFORMES-01 / EDITORIALES-CATALOGO-01.
 *
 * Catálogo de una editorial en su ficha administrativa (/admin/editoriales),
 * calculado sobre la MISMA lista canónica que la gestión de contenido
 * (dataService.getContenidos(['administrador'])) y con las mismas reglas que el
 * servidor: libro = tipo libro/libro_album (isBookForm, igual que `bookCount`),
 * editorial = `publisherId` actual, sello = `imprint` de la obra.
 *
 * Solo presentación: no deduce sellos de colecciones, títulos ni autores, no
 * asigna nada y no escribe. Los sellos registrados sin libros se muestran
 * vacíos; un sello guardado que ya no figura en la editorial se señala aparte.
 */
import { isBookForm } from './publisherRequirement.mjs';
import { imprintKeyOf, NO_IMPRINT } from './adminCatalogFilters.mjs';

export { NO_IMPRINT };

const byTitle = (a, b) => String(a.titulo ?? '').localeCompare(String(b.titulo ?? ''), 'es') || String(a.id).localeCompare(String(b.id));

/** ISBN registrado en la obra, si existe; el modelo canónico no lo exige. */
export const isbnOf = (c) => (typeof c?.isbn === 'string' && c.isbn.trim() ? c.isbn.trim() : null);

/**
 * @param {object[]} contents  lista canónica completa
 * @param {{id:string, imprints?:string[]}} publisher
 * @returns {{ books:number, resources:number, groups:{ key:string, imprint:string|null, registered:boolean, books:object[] }[] }}
 *   groups: sellos registrados (en su orden, aunque estén vacíos), luego sellos
 *   guardados que no están registrados y por último «Sin sello asignado».
 */
export function publisherCatalog(contents, publisher) {
    const seen = new Set();
    const own = (Array.isArray(contents) ? contents : [])
        .filter((c) => c && c.id && c.publisherId && c.publisherId === publisher?.id && !seen.has(c.id) && seen.add(c.id));
    const books = own.filter((c) => isBookForm(c.tipo));
    const registered = [...new Set((publisher?.imprints || []).map((s) => String(s).trim()).filter(Boolean))];
    const groups = registered.map((imprint) => ({ key: imprint, imprint, registered: true, books: [] }));
    const index = new Map(groups.map((g) => [g.key, g]));
    const none = { key: NO_IMPRINT, imprint: null, registered: true, books: [] };
    for (const b of books) {
        const k = imprintKeyOf(b);
        if (k === NO_IMPRINT) { none.books.push(b); continue; }
        if (!index.has(k)) { const g = { key: k, imprint: k, registered: false, books: [] }; index.set(k, g); groups.push(g); }
        index.get(k).books.push(b);
    }
    groups.push(none);
    for (const g of groups) g.books.sort(byTitle);
    return { books: books.length, resources: own.length - books.length, groups };
}
