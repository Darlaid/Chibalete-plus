/**
 * readingCanonical.mjs — CHP-V6-READING-CANONICAL-PRODUCER-01.
 *
 * Producción CANÓNICA directa de los eventos de lectura. Antes de esta unidad
 * la lectura real solo escribía el vocabulario del Backbone v1
 * (`<modo>.session_start`, `<modo>.session_heartbeat`…) y el registry v2 nunca
 * recibía un `reading_started`: la semántica canónica aparecía recién en el
 * materializador, vía `legacyEventNormalizer`. Desde el cutover, el ingreso
 * traduce en el SERVIDOR y persiste el nombre del registry v2 por
 * `recordCanonicalEvent`. El cliente no cambia: sigue mandando la forma v1.
 *
 * LA TABLA NO SE REINVENTA. El nombre canónico sale de `LEGACY_EVENT_MAP`
 * (Etapa 9, congelada y probada por call-site), así que una fila escrita hoy
 * como canónica significa exactamente lo mismo que una fila histórica
 * normalizada. `legacyEventNormalizer` queda para la historia anterior al
 * cutover; sobre un nombre canónico es identidad, así que no hay doble
 * traducción.
 *
 * UNA ACCIÓN, UN EVENTO. El mismo hecho de sesión (abrir, latido, cerrar) lo
 * emitían DOS productores: el hook `useBackboneReadingSession` (→ /api/v1/events)
 * y `analyticsService` (→ /api/analytics/events, dual-write legacy). Tras el
 * cutover el autoritativo es el hook; el dual-write legacy deja de persistir
 * esos tres hechos en events.db (`analytics_db.json` no cambia). Los hechos que
 * solo emite un productor (`block_complete`, `session_completed`…) se
 * canonicalizan en su propio canal.
 *
 * Privacidad: los payloads se construyen campo a campo con lo que el schema v2
 * admite; nada del payload del cliente pasa tal cual (y el registry hace
 * `.strip()` de todos modos). Cero texto libre.
 */
import { LEGACY_EVENT_MAP } from './legacyEventNormalizer.mjs';
import { validateEvent } from './eventRegistry.js';

/**
 * Modo del visor (columna `mode` de events.db) → valor del enum `READING_MODE`
 * del registry v2. `text` es el Modo Guiado. `lu` NO es lectura (telemetría de
 * distribución de la app) y queda fuera a propósito.
 */
export const READING_MODE_TO_REGISTRY = Object.freeze({
    text:      'guided',
    immersive: 'immersive',
    pdf:       'pdf',
    album:     'album',
    a11y:      'accessible',
});

/**
 * Hechos de sesión que emiten a la vez el hook nativo y `analyticsService`.
 * Tras el cutover su única fuente autoritativa es el hook (/api/v1/events).
 */
export const SESSION_FACTS_OWNED_BY_NATIVE = Object.freeze(new Set([
    'reading_started', 'session_heartbeat', 'session_ended',
]));

/** Nombre canónico del registry para un nombre v1 de lectura, o null. */
export function canonicalReadingNameOf(v1EventName) {
    if (typeof v1EventName !== 'string') return null;
    const c = LEGACY_EVENT_MAP[v1EventName];
    return typeof c === 'string' ? c : null;
}

const nonNegInt = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined);
const nonEmpty  = (s) => (typeof s === 'string' && s.length > 0 ? s : undefined);

/**
 * Traduce un evento con forma BackboneEvent v1 (ya validado por
 * `validateBackboneEvent`) a un sobre canónico para `recordCanonicalEvent`.
 *
 * @returns {null | {event:string, envelope:object}}  null si no es un evento de
 *          lectura con equivalencia declarada: el llamador conserva su camino.
 */
export function toCanonicalReadingEnvelope(evt) {
    if (!evt || typeof evt !== 'object') return null;
    const event = canonicalReadingNameOf(evt.event);
    const registryMode = READING_MODE_TO_REGISTRY[evt.mode];
    if (!event || !registryMode) return null;

    const contentId = nonEmpty(evt.contentId);
    const sessionId = nonEmpty(evt.sessionId);
    const elapsedMs = nonNegInt(evt.elapsedMs);
    const fraction  = typeof evt.progressFraction === 'number' && Number.isFinite(evt.progressFraction)
        ? Math.max(0, Math.min(1, evt.progressFraction)) : undefined;

    let payload;
    switch (event) {
        case 'reading_started':
            payload = { contentId, mode: registryMode, sessionId,
                startedAt: nonNegInt(evt.clientTs) ?? Date.now() };
            break;
        case 'session_heartbeat':
            payload = { sessionId, elapsedMs };
            break;
        case 'session_ended':
            payload = { sessionId, totalMs: elapsedMs };
            break;
        case 'reading_progress':
            payload = { contentId, sessionId, elapsedMs,
                percentage: fraction === undefined ? undefined : Math.round(fraction * 1000) / 10 };
            break;
        case 'reading_completed':
            payload = { contentId, sessionId, totalTimeMs: elapsedMs };
            break;
        default:
            return null; // tabla ampliada sin schema aquí → no se inventa un payload
    }
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

    return {
        event,
        envelope: {
            eventId:          evt.eventId,
            event,
            mode:             evt.mode,            // columna: modo del visor (lo usan los agregadores)
            userId:           evt.userId,
            contentId:        contentId ?? null,
            sessionId:        sessionId ?? '',
            clientTs:         nonNegInt(evt.clientTs),
            elapsedMs:        elapsedMs ?? null,
            progressFraction: fraction ?? null,
            version:          1,
            payload,
        },
    };
}

/**
 * Valida contra el registry y, solo si es válido, persiste por el sink canónico.
 * A diferencia de `recordCanonicalEvent` (recovery-first), un evento de lectura
 * inválido se RECHAZA: el ingreso HTTP ya tiene su contador `rejected` y no se
 * guarda un marcador vacío por cada latido malformado.
 *
 * @returns {{status:'accepted'|'deduplicated'|'rejected', code?:string}}
 */
export function recordCanonicalReading(envelope, record, log = () => {}) {
    const v = validateEvent(envelope.event, envelope.payload, envelope.version);
    if (!v.ok) return { status: 'rejected', code: v.code };
    const r = record(envelope, log);
    if (r?.duplicate) return { status: 'deduplicated' };
    if (r?.inserted) return { status: 'accepted' };
    return { status: 'rejected', code: r?.code || 'insert_failed' };
}

// ── Compatibilidad de los agregadores del Backbone v1 ───────────────────────
// `backboneMetrics` y `backboneFunnels` (Dashboard de Lectura) leen la ACCIÓN
// del sufijo `<modo>.<acción>` y la procedencia de `payload._source`. Una fila
// canónica no tiene punto ni `_source` (el registry lo recorta), así que sin
// esto dejarían de contar las sesiones posteriores al cutover.

const CANONICAL_TO_BACKBONE_ACTION = Object.freeze({
    reading_started:   'session_start',
    session_heartbeat: 'session_heartbeat',
    session_ended:     'session_end',
    reading_progress:  'progress',
    reading_completed: 'completed',
});

/** true si el nombre es un evento de lectura canónico (sin prefijo de modo). */
export function isCanonicalReadingEventName(eventName) {
    return typeof eventName === 'string' && Object.hasOwn(CANONICAL_TO_BACKBONE_ACTION, eventName);
}

/** Acción v1 de una fila: sufijo si trae modo, equivalente si es canónica. */
export function backboneActionOf(eventName) {
    if (typeof eventName !== 'string') return null;
    const dot = eventName.indexOf('.');
    if (dot >= 0) return eventName.slice(dot + 1);
    return CANONICAL_TO_BACKBONE_ACTION[eventName] ?? eventName;
}
