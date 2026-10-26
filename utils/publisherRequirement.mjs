/**
 * publisherRequirement.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-B.
 *
 * Regla del FORMULARIO de carga para la editorial responsable. Es solo una
 * ayuda de UX: el servidor (server/royalties/publisherAssignment.mjs) decide
 * con autoridad y rechaza igualmente.
 */

export const BOOK_FORM_TYPES = Object.freeze(['libro', 'libro_album']);

/** ¿El formulario guarda un libro? (tipo libro/álbum, nuevo o guardado; el EPUB no cambia el tipo) */
export function isBookForm(tipo, { storedTipo = null } = {}) {
    return BOOK_FORM_TYPES.includes(tipo) || BOOK_FORM_TYPES.includes(storedTipo);
}

/**
 * Motivo por el que el formulario no debe guardar, o null.
 *   publishersLoaded   la lista de editoriales cargó (si no, no se envía publisherId)
 *   publisherId        selección actual ('' = ninguna)
 *   originalPublisherId editorial guardada de la ficha que se edita ('' si no tiene)
 *   reassignConfirmed  el administrador marcó la confirmación de cambio
 */
export function publisherFormBlock({ isBook, isUpdate, publishersLoaded, publisherId, originalPublisherId = '', reassignConfirmed = false }) {
    if (!publishersLoaded) {
        // Al editar, el servidor conserva la editorial guardada; al crear un libro, no hay cuál.
        return isBook && !isUpdate ? 'No se pudo cargar la lista de editoriales. Un libro nuevo necesita su editorial responsable: recarga la página e inténtalo de nuevo.' : null;
    }
    if (isBook && !publisherId) {
        return originalPublisherId
            ? 'Un libro no puede quedar sin editorial responsable. Selecciona una editorial.'
            : 'Selecciona la editorial responsable del libro.';
    }
    if (isPublisherReassignment({ isUpdate, publisherId, originalPublisherId }) && !reassignConfirmed) {
        return 'Confirma expresamente el cambio de editorial responsable antes de guardar.';
    }
    return null;
}

/** ¿La selección cambia la editorial de una ficha que ya tenía una? */
export function isPublisherReassignment({ isUpdate, publisherId, originalPublisherId = '' }) {
    return !!isUpdate && !!originalPublisherId && !!publisherId && publisherId !== originalPublisherId;
}
