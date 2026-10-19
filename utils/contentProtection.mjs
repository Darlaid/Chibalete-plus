/**
 * CHP-CONTENT-PROTECTION-2026-01 — CP-4A: disuasión de extracción en el cliente.
 *
 * Todo lo de este módulo es FRICCIÓN y TRAZABILIDAD, no prevención: quien
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
 * fricción cosmética. Impresión y marca de agua aplican a todas.
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
 * Marcador corto de cuenta: FNV-1a 32 bits del id, 6 hex. No revela el id ni
 * datos personales; internamente se correlaciona recalculándolo sobre
 * users_db (no se guarda nada nuevo). Sin id → marcador neutro.
 */
export function viewerMarker(userId) {
    if (!userId) return '------';
    let h = 0x811c9dc5;
    const s = String(userId);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
}

const MAX_INSTITUTION = 28;

/** Institución abreviada; nunca nombre, correo ni documento de la persona. */
export function shortInstitution(name) {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return clean.length > MAX_INSTITUTION ? `${clean.slice(0, MAX_INSTITUTION - 1)}…` : clean;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * «Chibalete+ · Colegio X · A7F2C1 · 18/10/26» (fecha local, sin hora exacta).
 * @param {{ userId?: string | null, institution?: string | null, now?: Date }} [opts]
 */
export function watermarkLabel({ userId, institution, now = new Date() } = {}) {
    const date = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${pad2(now.getFullYear() % 100)}`;
    return ['Chibalete+', shortInstitution(institution), viewerMarker(userId), date]
        .filter(Boolean)
        .join(' · ');
}

function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

export const WATERMARK_TILE = Object.freeze({ width: 380, height: 220 });

/**
 * Baldosa SVG como data URI: una sola imagen de fondo repetida. Cero nodos de
 * texto en el DOM (fuera del árbol de accesibilidad), sin canvas ni timers.
 * Gris semitransparente: legible en fondos claros y oscuros sin competir con
 * el texto.
 */
export function watermarkTileDataUri(label) {
    const { width, height } = WATERMARK_TILE;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
        + `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" `
        + `transform="rotate(-24 ${width / 2} ${height / 2})" `
        + `font-family="system-ui, sans-serif" font-size="13" font-weight="600" `
        + `fill="rgb(128,128,128)" fill-opacity="0.22">${escapeXml(label)}</text></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

/**
 * Desplazamiento de la baldosa, fijado una vez por montaje: la marca no cae
 * siempre en el mismo píxel. `rand` inyectable para tests.
 */
export function watermarkOffset(rand = Math.random) {
    const { width, height } = WATERMARK_TILE;
    return `${Math.floor(rand() * width)}px ${Math.floor(rand() * height)}px`;
}

/**
 * CSS de impresión. Mientras una superficie editorial está montada,
 * `html[data-chp-protected]` oculta toda la página al imprimir (y por tanto en
 * «Guardar como PDF») y deja solo el aviso + el marcador. Las páginas
 * administrativas no montan la superficie y se imprimen como siempre.
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
  html[data-chp-protected] body::after {
    content: attr(data-chp-mark);
    display: block; margin-top: 12pt; text-align: center;
    font: 400 11pt system-ui, sans-serif; color: #555;
  }
}
`;
