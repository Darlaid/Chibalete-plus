/**
 * epubProgress.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.6.
 *
 * Persistencia de la posición del Modo EPUB sobre el progreso EXISTENTE
 * (GET /api/progress/item + POST …/sync con `canonicalProgress.epub`).
 * Lógica pura (sin React ni DOM) para poder probarla en Node.
 *
 * - Fingerprint de la fuente: SHA-256 (Web Crypto) de los bytes EXACTOS que
 *   sirvió GET /api/content/:id/epub → `sha256:<64 hex>`. No es el
 *   contentFingerprint textual (book.txt).
 * - Restaurar solo si el fingerprint guardado == el del EPUB descargado y el
 *   CFI es válido. Si no coincide, se abre desde el inicio sin borrar nada.
 * - Guardado: nunca el relocate de apertura/restauración (antes de arm()) ni
 *   los de re-maquetación automática de foliate (reason 'anchor'/'selection');
 *   con debounce y un máximo de espera; flush explícito al salir.
 */

export const EPUB_CFI_MAX_LENGTH = 4096;
const FINGERPRINT_RX = /^sha256:[0-9a-f]{64}$/;

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * @param {Blob|ArrayBuffer|ArrayBufferView} source bytes del EPUB ya descargados
 * @param {SubtleCrypto} [subtle]
 */
export async function computeEpubFingerprint(source, subtle = globalThis.crypto?.subtle) {
    if (!subtle) throw new Error('Web Crypto no disponible');
    const bytes = (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) ? source : await source.arrayBuffer();
    return `sha256:${toHex(await subtle.digest('SHA-256', bytes))}`;
}

// Relocates que NO son un avance del lector (foliate paginator: re-anclaje tras
// re-maquetar o al seleccionar texto).
const AUTOMATIC_RELOCATE_REASONS = new Set(['anchor', 'selection']);

export const isValidEpubCfi = (cfi) =>
    typeof cfi === 'string' && cfi.startsWith('epubcfi(') && cfi.length <= EPUB_CFI_MAX_LENGTH;

/** CFI a restaurar, o null (sin progreso EPUB, fingerprint distinto o CFI inválido). */
export function pickRestoreCfi(progress, fingerprint) {
    const epub = progress?.canonicalProgress?.epub;
    if (!epub || typeof fingerprint !== 'string' || !FINGERPRINT_RX.test(fingerprint)) return null;
    if (epub.contentFingerprint !== fingerprint) return null;
    return isValidEpubCfi(epub.cfi) ? epub.cfi : null;
}

/** Cuerpo de POST …/sync para un estado de relocate, o null si no es una posición válida. */
export function toEpubSyncBody(state, fingerprint, nowIso = () => new Date().toISOString()) {
    if (!state || !isValidEpubCfi(state.cfi)) return null;
    const { sectionIndex, fraction } = state;
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return null;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
    if (typeof fingerprint !== 'string' || !FINGERPRINT_RX.test(fingerprint)) return null;
    return {
        canonicalProgress: {
            globalPercentage: Math.round(fraction * 10000) / 100,
            epub: { cfi: state.cfi, sectionIndex, fraction, contentFingerprint: fingerprint },
        },
        updatedAt: nowIso(),
    };
}

/**
 * @param {{ send: (body: object, opts: {keepalive: boolean}) => unknown, fingerprint: string, initialCfi?: string|null,
 *           delayMs?: number, maxWaitMs?: number, now?: () => number,
 *           setTimer?: Function, clearTimer?: Function }} opts
 */
export function createEpubProgressSaver({
    send, fingerprint, initialCfi = null, delayMs = 3000, maxWaitMs = 15000,
    now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
}) {
    let armed = false;
    // Posición de partida (CFI restaurado o el del relocate de apertura): volver
    // a emitirla no es un avance del lector.
    let baselineCfi = initialCfi;
    let lastSentCfi = null;
    let pending = null;
    let pendingSince = 0;
    let timer = null;

    const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

    const flush = ({ keepalive = false } = {}) => {
        stop();
        if (!pending) return null;
        const body = toEpubSyncBody(pending, fingerprint);
        pending = null;
        if (!body) return null;
        lastSentCfi = body.canonicalProgress.epub.cfi;
        return send(body, { keepalive });
    };

    return {
        /** Relocate de Foliate. Antes de arm() solo fija la posición de partida. */
        onRelocate(state) {
            if (!armed) { baselineCfi = state?.cfi ?? null; return; }
            if (!state || !isValidEpubCfi(state.cfi)) return;
            if (AUTOMATIC_RELOCATE_REASONS.has(state.reason)) return;
            if (state.cfi === (lastSentCfi ?? baselineCfi)) return;
            if (!pending) pendingSince = now();
            pending = state;
            stop();
            if (now() - pendingSince >= maxWaitMs) { flush(); return; }
            timer = setTimer(() => { timer = null; flush(); }, delayMs);
        },
        /** A partir de aquí los relocates son del lector (apertura y restauración ya pasaron). */
        arm() { armed = true; },
        flush,
        dispose() { stop(); pending = null; },
        get armed() { return armed; },
    };
}
