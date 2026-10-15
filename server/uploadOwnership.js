/**
 * uploadOwnership.js — CHP-CONTENT-CANONICAL-2026-01 3D.3-R4.
 *
 * Propiedad de los archivos de /uploads por subárbol: /uploads/<owner>/... es
 * de <owner> (el parentId con el que se subió); un archivo en la raíz de
 * /uploads no tiene dueño ('').
 *
 * - Dedup: la clave es owner + hash, así un upload nunca recibe la URL de un
 *   archivo de OTRO contenido (alias cruzado → un DELETE ajeno lo borraba).
 * - DELETE: solo puede borrar lo que vive bajo /uploads/<id>/ y que ningún
 *   otro registro sigue referenciando.
 *
 * Funciones puras (sin fs): server.js decide qué hacer con el resultado.
 */

const UPLOADS_PREFIX = '/uploads/';

/** Dueño de una ruta relativa a UPLOAD_DIR ('a/b.jpg' → 'a'; 'b.jpg' → ''). */
export function uploadOwnerOfRel(relPath) {
    const parts = String(relPath).split(/[\\/]/).filter(Boolean);
    return parts.length > 1 ? parts[0] : '';
}

/** Dueño de una URL /uploads/...; null si no es una URL de uploads. */
export function uploadOwnerOfUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(UPLOADS_PREFIX)) return null;
    return uploadOwnerOfRel(url.slice(UPLOADS_PREFIX.length));
}

/** Clave del índice de dedup: mismo hash solo se reutiliza dentro del mismo dueño. */
export const uploadDedupKey = (owner, hash) => `${owner || ''}:${hash}`;

/** Todas las URLs /uploads/... de un registro, a cualquier profundidad. */
export function collectUploadUrls(record) {
    const urls = new Set();
    const walk = (v) => {
        if (typeof v === 'string') { if (v.startsWith(UPLOADS_PREFIX)) urls.add(v); }
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(record);
    return urls;
}

/**
 * Referencias de OTROS registros (id !== contentId) a URLs de uploads.
 * @returns {Map<string, string[]>} url → ids que la referencian
 */
export function uploadReferencesExcept(contentList, contentId) {
    const refs = new Map();
    for (const c of Array.isArray(contentList) ? contentList : []) {
        if (!c || c.id === contentId) continue;
        for (const url of collectUploadUrls(c)) {
            if (!refs.has(url)) refs.set(url, []);
            refs.get(url).push(c.id);
        }
    }
    return refs;
}

/** Ids de otros registros que referencian algo bajo `prefix` (p. ej. '/uploads/<id>/'). */
export function externalReferrersUnder(refs, prefix) {
    const ids = new Set();
    for (const [url, by] of refs) if (url.startsWith(prefix)) by.forEach(i => ids.add(i));
    return [...ids].sort();
}
