/**
 * foliatePdfDisabled.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.2.
 *
 * Sustituye (solo vía vite.config.ts) el `./pdf.js` que importa
 * vendor/foliate-js/view.js. El lector EPUB de Chibalete+ no abre PDF (para
 * eso existe VisorPDF), y el pdf.js upstream construye rutas con
 * `new URL(`vendor/pdfjs/${path}`, import.meta.url)` que Vite no puede
 * empaquetar. Así pdfjs (varios MB) nunca entra al bundle. El vendor sigue
 * intacto.
 */
export const makePDF = async () => {
    throw new Error('El lector EPUB de Chibalete+ no abre archivos PDF.');
};
