/**
 * engines/readingAdapters/index.mjs — barrel del CRR multi-modo (Fase 1).
 *
 * Cada adapter es una factory pura: createXxxAdapter(deps) → { runtime, dispose,
 * diagnostics, _state }. NO se cablea a ningún visor en esta fase — los
 * exports están listos para Fase 2 (adopción real visor-por-visor).
 *
 * El inmersivo sigue con su stack histórico en utils/immersiveV2/. Estos
 * adapters complementan, NO reemplazan.
 */

export { createAccessibleAdapter } from './accessibleAdapter.mjs';
export { createGuidedAdapter }     from './guidedAdapter.mjs';
export { createPdfAdapter }        from './pdfAdapter.mjs';
export { createAlbumAdapter }      from './albumAdapter.mjs';
