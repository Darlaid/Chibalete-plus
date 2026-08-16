/**
 * readerEventCore.mjs — CHP-STATS-INSTRUMENTATION-01B.
 *
 * Lógica PURA y node-testable que usa el hook `useBackboneReadingSession` para
 * cumplir los P0/P1 de la auditoría 00:
 *   - elapsedMs INCREMENTAL (delta desde el último checkpoint, no acumulado);
 *   - construcción de un evento con identidad estable (eventId/occurredAt en el
 *     hecho) compatible con:
 *       (a) la cola del transporte compartido 01A (`utils/eventTransport.mjs`,
 *           que exige eventId ULID + occurredAt numérico + type string), y
 *       (b) el endpoint vivo `/api/v1/events` (`validateBackboneEvent`, que exige
 *           `event`={mode}.{action}, `userId`, `sessionId`, `clientTs`).
 *
 * NO contiene React ni DOM: el ciclo de sesión (una interactionSessionId por
 * APERTURA del lector) lo gobierna el effect del hook; aquí solo vive la
 * mecánica testeable. NO calcula analytics, ni deriva estado, ni toca stores.
 */

/**
 * Rastreador de tiempo incremental. Cada `delta(now)` devuelve el tiempo
 * transcurrido desde el checkpoint anterior y avanza el checkpoint.
 *
 * Golden (ms): tracker(0) → delta(10000)=10000 → delta(25000)=15000 →
 * delta(40000)=15000. NUNCA 10000/25000/40000 (eso sería acumulado).
 *
 * @param {number} startTs  ms del inicio de la interacción (checkpoint inicial)
 */
export function createElapsedTracker(startTs) {
    let last = Number.isFinite(startTs) ? startTs : 0;
    return {
        /** Delta desde el checkpoint anterior; avanza el checkpoint a `now`. */
        delta(now) {
            const n = Number.isFinite(now) ? now : last;
            const d = Math.max(0, n - last);
            last = n;
            return d;
        },
        /** Reinicia el checkpoint (nueva apertura de lector). */
        reset(ts) { last = Number.isFinite(ts) ? ts : 0; },
        /** Checkpoint actual (para tests/telemetría). */
        checkpoint() { return last; },
    };
}

/** Modos válidos del backbone vivo (eventsService.validateBackboneEvent). */
export const READER_MODES = Object.freeze(['pdf', 'text', 'immersive', 'album', 'a11y', 'lu']);
const ACTION_NAME_RX = /^[a-z][a-z0-9_]*$/;

function clampFraction(n) {
    if (n === undefined || n === null || !Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(1, n));
}

/**
 * Construye un evento de lectura con IDENTIDAD ESTABLE, de forma dual para
 * satisfacer a la vez la cola del transporte (eventId/occurredAt/type) y el
 * endpoint backbone (event/clientTs/userId/sessionId). `occurredAt` y `clientTs`
 * son el MISMO instante (el hecho); `type` y `event` son el mismo nombre
 * `{mode}.{action}`. El transporte reenvía el objeto verbatim → mismos
 * eventId/occurredAt en cada retry.
 *
 * fact-only: no fabrica estado derivado; el caller pasa payload contextual y una
 * fracción de progreso opcional (señal permitida por el contrato).
 *
 * @returns {object|null} evento listo para `transport.enqueue`, o null si inválido
 */
export function buildReaderEvent({
    eventId,
    now,
    mode,
    action,
    userId,
    contentId = null,
    interactionSessionId,
    elapsedMs,
    progressFraction,
    payload,
}) {
    if (typeof action !== 'string' || !ACTION_NAME_RX.test(action)) return null;
    if (typeof mode !== 'string') return null;
    if (!userId || userId === 'guest') return null;
    if (!interactionSessionId) return null;
    const fullName = `${mode}.${action}`;
    const ts = Number.isFinite(now) ? now : 0;
    const evt = {
        // — identidad + cola del transporte 01A —
        eventId,
        occurredAt: ts,
        type: fullName,
        schemaVersion: 1,
        // — contrato del endpoint backbone vivo —
        event: fullName,
        mode,
        userId,
        contentId: contentId ?? null,
        sessionId: interactionSessionId,
        clientTs: ts,
    };
    if (elapsedMs !== undefined && Number.isFinite(elapsedMs)) evt.elapsedMs = Math.max(0, Math.round(elapsedMs));
    const frac = clampFraction(progressFraction);
    if (frac !== undefined) evt.progressFraction = frac;
    if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) evt.payload = payload;
    return evt;
}
