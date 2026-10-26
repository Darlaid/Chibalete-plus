/**
 * libraryPublisherGroups.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-C (CATÁLOGOS-02).
 *
 * Pestaña «Editoriales» de Biblioteca: filtro de PRESENTACIÓN sobre el conjunto
 * que ya autorizó el servidor (my-catalog). No decide acceso, no amplía el
 * conjunto y no crea fichas: cada libro sigue siendo la MISMA ficha (mismo id)
 * que se ve en «Libros» y «Libros Álbum».
 *
 *   visible     conjunto autorizado ya hidratado (y filtrado por presentación)
 *   publishers  `my-catalog.publishers`: editoriales ACTIVAS con libros en ese
 *               conjunto, solo { id, name }
 *
 * Devuelve [{ publisherId, name, groups: [{ imprint, books }] }]:
 * - solo libros (`libro`, `libro_album`) de editoriales presentes en `publishers`
 *   (una inactiva o desconocida no forma bloque; sus libros siguen en «Libros»);
 * - dentro de cada editorial, un grupo por sello en orden alfabético y, al
 *   final, el grupo general (`imprint: null`) para los libros sin sello: no se
 *   les inventa uno;
 * - editoriales sin libros visibles no aparecen.
 */
export const PUBLISHER_GROUP_BOOK_TYPES = Object.freeze(['libro', 'libro_album']);

const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function groupBooksByPublisher(visible, publishers) {
    if (!Array.isArray(visible) || !Array.isArray(publishers)) return [];
    const names = new Map();
    for (const p of publishers) {
        if (p && typeof p.id === 'string' && p.id && typeof p.name === 'string' && p.name) names.set(p.id, p.name);
    }
    const byPublisher = new Map();
    const seen = new Set();
    for (const item of visible) {
        if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
        if (!PUBLISHER_GROUP_BOOK_TYPES.includes(item.tipo) || !names.has(item.publisherId)) continue;
        seen.add(item.id);
        const imprint = textOrNull(item.imprint);
        const groups = byPublisher.get(item.publisherId) || new Map();
        byPublisher.set(item.publisherId, groups);
        if (!groups.has(imprint)) groups.set(imprint, []);
        groups.get(imprint).push(item);
    }
    const byName = (a, b) => a.localeCompare(b, 'es');
    return [...byPublisher.entries()]
        .map(([publisherId, groups]) => ({
            publisherId,
            name: names.get(publisherId),
            groups: [...groups.entries()]
                .sort(([a], [b]) => (a === null) - (b === null) || (a !== null && b !== null ? byName(a, b) : 0))
                .map(([imprint, books]) => ({ imprint, books })),
        }))
        .sort((a, b) => byName(a.name, b.name));
}

/**
 * F1-C — grupos de Búsqueda. Sustituye la atribución por el texto libre
 * `editorial` (siempre «Chibalete» desde el formulario) por la editorial real
 * (`publisherId`). No cambia QUÉ resultados hay (eso lo decide quien busca):
 *   - libros y libros-álbum, un grupo por editorial con nombre público;
 *   - libros cuya editorial no tiene nombre público para quien busca (inactiva o
 *     sin libros visibles), en «Otros libros»: no se les inventa atribución;
 *   - vídeos y pódcasts, en su grupo, sin atribuir.
 * Devuelve [{ key, title, items }] sin grupos vacíos.
 */
export function groupSearchResults(results, publishers) {
    const list = Array.isArray(results) ? results : [];
    const names = new Map((Array.isArray(publishers) ? publishers : [])
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name)
        .map((p) => [p.id, p.name]));
    const books = new Map();
    const others = [];
    const media = [];
    for (const item of list) {
        if (!item || typeof item.id !== 'string') continue;
        if (PUBLISHER_GROUP_BOOK_TYPES.includes(item.tipo)) {
            if (names.has(item.publisherId)) {
                if (!books.has(item.publisherId)) books.set(item.publisherId, []);
                books.get(item.publisherId).push(item);
            } else others.push(item);
        } else if (item.tipo === 'video' || item.tipo === 'podcast') media.push(item);
    }
    const groups = [...books.entries()]
        .map(([id, items]) => ({ key: `editorial:${id}`, title: `Libros de ${names.get(id)}`, items }))
        .sort((a, b) => a.title.localeCompare(b.title, 'es'));
    if (others.length) groups.push({ key: 'otros-libros', title: 'Otros libros', items: others });
    if (media.length) groups.push({ key: 'media', title: 'Videos y podcasts', items: media });
    return groups;
}
