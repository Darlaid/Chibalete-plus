/**
 * CHP-CONTENT-PROTECTION-2026-01 — CP-4A: disuasión de extracción en el cliente.
 *
 * Todo lo de este módulo es FRICCIÓN, no prevención: quien
 * recibe los bytes puede extraerlos (DevTools, OCR, captura). La protección
 * fuerte sigue en el servidor (autorización, política de originales) y en LU
 * (FLAG_SECURE). No decide acceso, no carga contenido, no conoce contratos.
 *
 * Sin dependencias del DOM al importar: se prueba en Node.
 */

/** Controles donde copiar, arrastrar y el menú contextual siguen intactos. */
export const EDITABLE_SELECTOR =
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-chp-allow-copy]';

/** Texto que queda en el portapapeles si alguien copia del área editorial. */
export const PROTECTED_CLIPBOARD_TEXT = 'Contenido protegido en Chibalete+';

/**
 * Política por superficie. `accessible` conserva copiar, arrastrar y menú
 * contextual: lo usan herramientas de lectura asistida (leer en voz alta,
 * traducir, pegar en un lector externo). La accesibilidad manda sobre una
 * fricción cosmética. La impresión protegida aplica a todas. Sin marca de
 * agua en ninguna superficie (WATERMARK_POLICY: PROHIBITED).
 */
export const SURFACE_POLICIES = Object.freeze({
    standard: Object.freeze({ blockCopy: true, blockContextMenu: true, blockDrag: true }),
    accessible: Object.freeze({ blockCopy: false, blockContextMenu: false, blockDrag: false }),
});

export function surfacePolicy(mode) {
    return SURFACE_POLICIES[mode] ?? SURFACE_POLICIES.standard;
}

/** true si el evento nace en un control editable (o fuera de un Element). */
export function isEditableTarget(target) {
    const el = target && target.nodeType === 3 ? target.parentElement : target;
    if (!el || typeof el.closest !== 'function') return true; // fail-open: no rompemos UI desconocida
    return el.closest(EDITABLE_SELECTOR) != null;
}

/**
 * Decide si un evento de extracción se intercepta. `type` es el tipo DOM
 * ('copy' | 'cut' | 'contextmenu' | 'dragstart').
 */
export function shouldIntercept(type, target, mode = 'standard') {
    const p = surfacePolicy(mode);
    const enabled = type === 'copy' || type === 'cut' ? p.blockCopy
        : type === 'contextmenu' ? p.blockContextMenu
            : type === 'dragstart' ? p.blockDrag
                : false;
    return enabled && !isEditableTarget(target);
}

/** Manejador común (React o addEventListener): solo actúa si corresponde. */
export function interceptExtraction(event, mode = 'standard') {
    if (!shouldIntercept(event.type, event.target, mode)) return false;
    event.preventDefault();
    if ((event.type === 'copy' || event.type === 'cut') && event.clipboardData) {
        try { event.clipboardData.setData('text/plain', PROTECTED_CLIPBOARD_TEXT); } catch { /* noop */ }
    }
    return true;
}

/**
 * Engancha la fricción a un documento ajeno al árbol de React (iframes de
 * Foliate). Devuelve la función que la retira.
 */
export function attachExtractionFriction(doc, mode = 'standard') {
    if (!doc || typeof doc.addEventListener !== 'function') return () => {};
    const handler = (e) => { interceptExtraction(e, mode); };
    const types = ['copy', 'cut', 'contextmenu', 'dragstart'];
    for (const t of types) doc.addEventListener(t, handler);
    return () => { for (const t of types) doc.removeEventListener(t, handler); };
}

/**
 * CSS de impresión. Mientras una superficie editorial está montada,
 * `html[data-chp-protected]` oculta toda la página al imprimir (y por tanto en
 * «Guardar como PDF») y deja solo el aviso, sin marcador ni marca de agua.
 * Las páginas administrativas no montan la superficie y se imprimen como
 * siempre.
 */
export const PROTECTED_PRINT_CSS = `
@media print {
  html[data-chp-protected] body > * { display: none !important; }
  html[data-chp-protected] body { background: #fff !important; }
  html[data-chp-protected] body::before {
    content: "Contenido protegido en Chibalete+";
    display: block; margin: 30vh auto 0; text-align: center;
    font: 700 22pt system-ui, sans-serif; color: #111;
  }
}
`;
