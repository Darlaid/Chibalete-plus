/**
 * epubSourceUpload.mjs — CHP-CONTENT-CANONICAL-2026-01 PARTE 3D.1.
 *
 * Reglas de la UI admin (SubirContenido) para usar un EPUB como fuente del
 * texto de un contenido NUEVO. La validación real (magic bytes, estructura,
 * imágenes, persistencia canónica) es del servidor: aquí no se replica.
 *
 * - El EPUB se sube por el mismo /api/upload, declarado como application/epub+zip
 *   (no se confía en el MIME que ponga el navegador).
 * - El POST /api/content lleva `epub_url` y NO `texto_plano_url`: el servidor
 *   fija la rendición canónica, la versión textual y los defaults.
 * - EPUB_REIMPORT sigue PROHIBIDO: un contenido con epub_url no admite otra
 *   fuente de texto, y un EPUB solo puede crear contenido nuevo.
 */
export const EPUB_MIME = 'application/epub+zip';

export const EPUB_REIMPORT_BLOCKED_MESSAGE =
    'Por ahora los contenidos EPUB no pueden reemplazarse. Crea un nuevo contenido o conserva la versión actual.';
export const EPUB_ONLY_NEW_CONTENT_MESSAGE =
    'Por ahora un EPUB solo puede usarse para crear un contenido nuevo. Crea un nuevo contenido para este EPUB o conserva la versión actual.';

export const isEpubFile = (file) => !!file && typeof file.name === 'string' && /\.epub$/i.test(file.name);

/** El mismo archivo, declarado como application/epub+zip para /api/upload. */
export function asEpubUploadFile(file) {
    if (file.type === EPUB_MIME) return file;
    return new File([file], file.name, { type: EPUB_MIME, lastModified: file.lastModified });
}

/**
 * Motivo para bloquear el guardado, o null.
 * @param {{ isUpdate: boolean, existingContent?: { epub_url?: string } | null, textoPlanoFile?: File | null }} args
 */
export function epubSourceBlockReason({ isUpdate, existingContent, textoPlanoFile }) {
    if (existingContent?.epub_url && textoPlanoFile) return EPUB_REIMPORT_BLOCKED_MESSAGE;
    if (isUpdate && isEpubFile(textoPlanoFile)) return EPUB_ONLY_NEW_CONTENT_MESSAGE;
    return null;
}

/** Payload del contenido con el EPUB como fuente: epub_url sí, texto_plano_url no. */
export function withEpubSource(content, epubUrl) {
    const { texto_plano_url: _discarded, ...rest } = content;
    return { ...rest, epub_url: epubUrl };
}
