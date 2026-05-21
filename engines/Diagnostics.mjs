/**
 * Diagnostics.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Buffer cronológico de eventos del runtime. Cada transición, callback,
 * preflight, visibility report y operación de queue deja un evento
 * estructurado. exportTrace(sessionId) filtra al subset de una sesión y
 * devuelve los eventos en orden temporal — base para el "diagnostic timeline"
 * que cualquier herramienta de debugging consume.
 *
 * NO mantiene estado de sesión. NO valida transiciones. Solo registra y
 * sirve. Es un sink puro.
 *
 * El buffer es CIRCULAR con tamaño máximo configurable (default 5000)
 * para evitar growth no acotado en sesiones largas. Lo viejo se descarta.
 *
 * Patrón: una instancia compartida por runtime; los componentes (session,
 * audio, visibility, progress) la inyectan o la reciben por construcción.
 */

const DEFAULT_CAPACITY = 5000;

export function createDiagnostics(opts = {}) {
    const capacity = Math.max(1, Number.isFinite(opts.capacity) ? opts.capacity : DEFAULT_CAPACITY);
    const buf = [];   // ring buffer simple — splice cuando cap superado
    // Sprint M-4.3 — listeners para subscribe(): consumidores activos pueden
    // reaccionar a eventos en tiempo real (e.g., el viewer V2 emite
    // console.log [V2] audio.acquire.* tras cada diag emit del AudioRuntime).
    // Listener throws se aíslan para no romper el sink ni otros listeners.
    const listeners = new Set();

    /**
     * Registra un evento. Acepta { sessionId?, contentId?, kind, data? }.
     * `ts` se setea automáticamente al wall-clock ms si no viene.
     */
    function log(event) {
        if (!event || typeof event !== 'object' || typeof event.kind !== 'string') {
            return;   // defensive: no romper el runtime por log mal formado
        }
        const e = Object.freeze({
            ts:         typeof event.ts === 'number' ? event.ts : Date.now(),
            sessionId:  event.sessionId ?? null,
            contentId:  event.contentId ?? null,
            kind:       event.kind,
            data:       event.data ? Object.freeze({ ...event.data }) : undefined,
        });
        buf.push(e);
        if (buf.length > capacity) buf.shift();
        // Notify subscribers — fire & forget, isolated per listener.
        if (listeners.size > 0) {
            for (const fn of [...listeners]) {
                try { fn(e); } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('[Diagnostics] listener throw:', err);
                }
            }
        }
    }

    /**
     * Sprint M-4.3 — subscribe(listener) → unsubscribe.
     * Listeners se invocan POST log() con el event ya frozen. No reciben
     * eventos pasados (caller puede leer getRecentEvents si los necesita).
     * Backward-compatible: el sink existente sigue funcionando idéntico
     * cuando no hay listeners registrados.
     */
    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /**
     * Devuelve los últimos N eventos (default = todos). Inmutable: el caller
     * recibe una copia. Los eventos son frozen.
     */
    function getRecentEvents(limit) {
        if (typeof limit !== 'number' || limit <= 0) return buf.slice();
        return buf.slice(-Math.floor(limit));
    }

    /**
     * Filtra al subset de una sesión, ordenado cronológicamente. Cuando
     * sessionId es null, devuelve TODOS los eventos sin sessionId asociado
     * (útil para errores pre-sesión).
     */
    function exportTrace(sessionId) {
        if (sessionId === undefined) return buf.slice();
        return buf.filter(e => e.sessionId === sessionId);
    }

    /** Vacía el buffer. Usado por tests o por close hard del runtime. */
    function clear() {
        buf.length = 0;
    }

    return Object.freeze({ log, subscribe, getRecentEvents, exportTrace, clear });
}
