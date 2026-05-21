/**
 * readingRuntimeSnapshotStore.mjs — CRR Fase 2 / persistencia de snapshots.
 *
 * Runtime puro JS. Tipos en readingRuntimeSnapshotStore.d.ts.
 *
 * Persistencia mínima en localStorage para que el bridge pueda restaurar la
 * posición de lectura cuando la sesión se reabra (reload, navegación,
 * background/foreground prolongado). NO duplica el progress_db backend — es
 * una pista local para arrancar la sesión CRR cerca del último índice visto.
 *
 * Diseño:
 *  - Una clave por (userId, contentId, mode). Permite migrar mode-por-mode
 *    sin colisiones cross-modo del mismo libro.
 *  - Payload chico (~120 bytes).
 *  - Defensivo: todo throw catcheado, getter devuelve null en ese caso.
 *  - TTL implícito: registros viejos (>30 días) se descartan al leer.
 */

const PREFIX = 'crr_snap';
const VERSION = 1;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function buildKey(userId, contentId, mode) {
    return `${PREFIX}__${mode}__${userId}__${contentId}`;
}

function safeLocalStorage() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        return window.localStorage;
    } catch { return null; }
}

/**
 * @param {{mode:string,userId:string,contentId:string,currentIndex:number,totalIndices:number,status:string}} s
 * @returns {boolean}
 */
export function saveSnapshot(s) {
    const ls = safeLocalStorage();
    if (!ls) return false;
    if (!s || !s.userId || !s.contentId) return false;
    const payload = {
        version: VERSION,
        savedAt: Date.now(),
        ...s,
    };
    try {
        ls.setItem(buildKey(s.userId, s.contentId, s.mode), JSON.stringify(payload));
        return true;
    } catch {
        return false;
    }
}

export function loadSnapshot(userId, contentId, mode) {
    const ls = safeLocalStorage();
    if (!ls) return null;
    if (!userId || !contentId) return null;
    try {
        const raw = ls.getItem(buildKey(userId, contentId, mode));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== VERSION) return null;
        if (typeof parsed.currentIndex !== 'number') return null;
        if (typeof parsed.savedAt !== 'number') return null;
        if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
            try { ls.removeItem(buildKey(userId, contentId, mode)); } catch { /* ignore */ }
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function clearSnapshot(userId, contentId, mode) {
    const ls = safeLocalStorage();
    if (!ls) return false;
    if (!userId || !contentId) return false;
    try {
        ls.removeItem(buildKey(userId, contentId, mode));
        return true;
    } catch {
        return false;
    }
}
