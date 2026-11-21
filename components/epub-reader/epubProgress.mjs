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

/** Una pausa más larga que esta entre dos avances del lector abre otra sesión de lectura. */
export const EPUB_SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * V9 65D-1 — sesión de lectura del Modo EPUB, con el contrato que ya usan los demás visores
 * (`session: { sessionId, startedAt, durationSec, mode }`). Sin ella el progreso del EPUB no dejaba sesiones: el
 * tablero del mediador no tenía de dónde contar su lectura. Empieza en el primer avance del lector (no al abrir el
 * libro) y dura hasta el último avance; una pausa larga abre otra.
 */
export function createEpubReadingSession({ now = () => Date.now(), newId = () => globalThis.crypto?.randomUUID?.() ?? `epub-${Date.now()}-${Math.random().toString(36).slice(2)}`, idleMs = EPUB_SESSION_IDLE_MS } = {}) {
    let current = null;
    return {
        /** Un avance del lector a la hora `at` (por defecto, ahora). */
        touch(at = now()) {
            if (!current || at - current.lastMs > idleMs) current = { sessionId: newId(), startMs: at, lastMs: at };
            else current.lastMs = Math.max(current.lastMs, at);
        },
        /** Sesión para el cuerpo del guardado, o null si el lector todavía no avanzó. */
        payload() {
            if (!current) return null;
            return { sessionId: current.sessionId, startedAt: new Date(current.startMs).toISOString(),
                durationSec: Math.max(0, Math.round((current.lastMs - current.startMs) / 1000)), mode: 'epub' };
        },
    };
}

/** Cola de reintentos del progreso: la misma clave y la misma forma que usa la aplicación (dataService). */
export const FAILED_PROGRESS_SYNCS_KEY = 'chibalete_failed_syncs';

/**
 * V9 65D-1 — un guardado que no llegó (sin conexión, sesión vencida, servidor caído) se deja en la cola de reintentos
 * EXISTENTE de la aplicación, que lo reenvía al recuperar la conexión o al volver a abrirla. Antes se descartaba. Una
 * entrada por sesión; la misma sesión se reemplaza por su guardado más reciente. Nunca lanza.
 * @returns {boolean} si quedó en la cola
 */
export function enqueueFailedProgressSync(storage, { userId, contentId, body, now = () => Date.now() }) {
    try {
        if (!storage || !userId || !contentId || !body) return false;
        const raw = storage.getItem(FAILED_PROGRESS_SYNCS_KEY);
        const queue = raw ? JSON.parse(raw) : {};
        const sid = body.session?.sessionId;
        const key = sid ? `${userId}__${contentId}__${sid}` : `${userId}__${contentId}`;
        queue[key] = { userId, contentId, payload: JSON.stringify(body), addedAt: new Date(now()).toISOString() };
        storage.setItem(FAILED_PROGRESS_SYNCS_KEY, JSON.stringify(queue));
        return true;
    } catch { return false; }
}

/** El guardado debe reintentarse: sin respuesta, sesión vencida, demasiadas peticiones o fallo del servidor. */
export const shouldRetryProgressSync = (status) => !status || status === 401 || status === 408 || status === 429 || status >= 500;

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
 *           setTimer?: Function, clearTimer?: Function,
 *           session?: { touch: (at?: number) => void, payload: () => object|null } | null }} opts
 */
export function createEpubProgressSaver({
    send, fingerprint, initialCfi = null, delayMs = 3000, maxWaitMs = 15000,
    now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
    session = null,
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
        // V9 65D-1: el guardado lleva la sesión de lectura en curso.
        const s = session?.payload?.() ?? null;
        return send(s ? { ...body, session: s } : body, { keepalive });
    };

    return {
        /** Relocate de Foliate. Antes de arm() solo fija la posición de partida. */
        onRelocate(state) {
            if (!armed) { baselineCfi = state?.cfi ?? null; return; }
            if (!state || !isValidEpubCfi(state.cfi)) return;
            if (AUTOMATIC_RELOCATE_REASONS.has(state.reason)) return;
            if (state.cfi === (lastSentCfi ?? baselineCfi)) return;
            session?.touch?.(now());
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
