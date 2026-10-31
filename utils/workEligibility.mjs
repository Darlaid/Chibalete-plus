/**
 * workEligibility.mjs — CHP-MOOK-STUDIO-WORKREF-01.
 *
 * Qué contenido cuenta como obra y si una producción puede declararla. Módulo
 * puro, sin dependencias: lo usan Studio y el servidor, de modo que selector,
 * guardado, publicación y `resolveEvidenceWork` aplican la misma regla.
 *
 * Tipos admitidos mientras Editorial no decida otra cosa (Modelo PRIV-01 §5.1):
 * colecciones, partes, guías, podcasts y artículos no son obra.
 */
export const WORK_TIPOS = Object.freeze(['libro', 'libro_album', 'video']);

/** Motivo por el que un contenido no es una obra reconocible, o null. */
export function workBlock(content) {
    if (!content) return 'work_not_found';
    if (content.status !== 'disponible') return 'work_unavailable';
    if (content.isCollection === true) return 'work_is_collection';
    if (content.parentId) return 'work_is_part';
    if (content.standalone === false) return 'work_not_standalone';
    if (!WORK_TIPOS.includes(content.tipo)) return 'work_not_classified';
    return null;
}

/** Texto para el autor. El servidor y Studio lo comparten. */
export const WORK_BLOCK_LABELS = Object.freeze({
    work_not_found: 'La obra no existe en el catálogo.',
    work_unavailable: 'La obra no está disponible.',
    work_is_collection: 'Una colección no es una obra: elige un título.',
    work_is_part: 'Un capítulo o material asociado no cuenta como obra.',
    work_not_standalone: 'Una pieza creada solo para Experiencias no cuenta como obra.',
    work_not_classified: 'Este tipo de contenido no cuenta como obra.',
});

const OFFERING_TYPES = Object.freeze(['READING', 'VIDEO', 'AUDIO']);

/** ¿Se ofreció la obra en un nodo anterior de la ruta? `nodes`: secuencia global. */
export function workOfferedBefore(nodes, index, workRef) {
    return nodes.slice(0, index).some((n) => OFFERING_TYPES.includes(n.type) && n.resourceRef === workRef);
}
