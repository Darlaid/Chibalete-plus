/**
 * epubReaderLink.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.3.
 *
 * Enlace al lector EPUB de Chibalete+ (entrada propia epub-reader.html, con su
 * CSP). Solo viaja el contentId: el servidor resuelve el archivo y autoriza en
 * GET /api/content/:id/epub. epub_url nunca sale hacia el cliente como enlace.
 */
export const EPUB_READER_ENTRY = '/epub-reader.html';

/** El contenido tiene EPUB original (y no es un álbum). */
export const hasEpubOriginal = (content) =>
    !!content && content.tipo !== 'libro_album' && typeof content.epub_url === 'string' && content.epub_url.length > 0;

export const epubReaderHref = (contentId) => `${EPUB_READER_ENTRY}?contentId=${encodeURIComponent(contentId)}`;

/** Ficha del contenido en la SPA (HashRouter), para volver desde el lector. */
export const contentDetailHref = (contentId) => `/#/contenido/${encodeURIComponent(contentId)}`;

/** contentId seguro desde la query del lector (mismo alfabeto que los ids de contenido). */
export const readEpubContentId = (search) => {
    const id = new URLSearchParams(search).get('contentId');
    return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
};
