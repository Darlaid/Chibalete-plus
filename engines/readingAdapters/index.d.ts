/**
 * engines/readingAdapters/index.d.ts — tipos del barrel.
 */

export type { AccessibleAdapter, AccessibleAdapterDeps } from './accessibleAdapter';
export type { GuidedAdapter, GuidedAdapterDeps }         from './guidedAdapter';
export type { PdfAdapter, PdfAdapterDeps }               from './pdfAdapter';
export type { AlbumAdapter, AlbumAdapterDeps }           from './albumAdapter';

export { createAccessibleAdapter } from './accessibleAdapter';
export { createGuidedAdapter }     from './guidedAdapter';
export { createPdfAdapter }        from './pdfAdapter';
export { createAlbumAdapter }      from './albumAdapter';
