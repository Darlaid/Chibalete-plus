/**
 * canonicalEvent.mjs — CHP-STATS-EVENT-CONTRACT-01 (DORMANT).
 *
 * Sobre canónico de eventos + validación estructural pura. Capa NUEVA sobre el
 * `eventRegistry.js` (autoridad de payload por tipo) y `ulid.js` (id). NO se
 * cablea a ningún writer productivo: es una capa de validación dormida.
 * Diseño congelado en docs/ops/STATS_EVENT_CONTRACT_00.md.
 *
 * DOCTRINA:
 *   - events.db = hechos append-only; el evento describe QUÉ PASÓ, no inferencia.
 *   - Autoridad de actor/tenant/provenance/receivedAt = verifiedContext (server),
 *     NUNCA el cliente crudo (ver normalizeCanonicalEvent.mjs).
 *   - eventId (ULID) = autoridad de idempotencia.
 *   - Sin fabricar id/actor/tiempo/contenido.
 *
 * Módulo PURO: sin I/O, sin reloj propio (receivedAt se inyecta), sin lookup de
 * identidad. `crypto`/Zod ya son dependencias del repo.
 */
import { z } from 'zod';
import { isValidUlid } from '../ulid.js';
import { validateEvent as validatePayload, REGISTRY_VERSION, EVENT_NAMES } from './eventRegistry.js';

// ── Constantes de contrato (congeladas -00) ─────────────────────────────────
export const CANONICAL_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1]);
export const MAX_PAYLOAD_BYTES = 4096;            // ≤4 KB serializado
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;  // reloj adelantado tolerado
export const MIN_PLATFORM_TS = 1_577_836_800_000; // 2020-01-01Z: piso de sanidad (no un tope histórico)

export const PROVENANCE = Object.freeze(['web', 'lu', 'server', 'leo', 'experience', 'migration']);
export const CANONICAL_MODE = Object.freeze([
    'immersive', 'text', 'guided', 'pdf', 'album', 'accessible', 'audio', 'lu', 'leo', 'aula_viva', 'system',
]);

/** Códigos de error tipados. Nunca filtran payload crudo. */
export const EVENT_ERROR = Object.freeze({
    INVALID_EVENT:          'INVALID_EVENT',
    UNSUPPORTED_VERSION:    'UNSUPPORTED_VERSION',
    UNKNOWN_EVENT_TYPE:     'UNKNOWN_EVENT_TYPE',
    ACTOR_MISMATCH:         'ACTOR_MISMATCH',
    TENANT_MISMATCH:        'TENANT_MISMATCH',
    INVALID_PROVENANCE:     'INVALID_PROVENANCE',
    INVALID_TIME:           'INVALID_TIME',
    PAYLOAD_TOO_LARGE:      'PAYLOAD_TOO_LARGE',
    FORBIDDEN_FIELD:        'FORBIDDEN_FIELD',
    UNKNOWN_PAYLOAD_KEY:    'UNKNOWN_PAYLOAD_KEY',
    INSUFFICIENT_PROVENANCE:'INSUFFICIENT_PROVENANCE',
    MISSING_EVENT_ID:       'MISSING_EVENT_ID',
});

/**
 * Campos rechazados como AUTORIDAD en el sobre (nunca confiables desde cliente).
 * authSessionId = sesión de SEGURIDAD, no pedagógica. role/tenant/x-user-id =
 * autoafirmación. Su presencia en el sobre crudo es intento de spoof → reject.
 */
export const REJECTED_ENVELOPE_KEYS = Object.freeze([
    'authSessionId', 'sid', 'role', 'roles', 'tenant', 'x-user-id', 'xUserId',
]);

/**
 * Identificadores directos PII prohibidos en cualquier payload canónico
 * (defensa en profundidad; el `.strip()`/allowlist del registry es la primaria).
 * NO se incluye 'name' (legítimo en esquemas institucionales) — el allowlist por
 * tipo lo cubre en eventos de lector.
 */
export const FORBIDDEN_PII_KEYS = Object.freeze([
    'email', 'correo', 'ip', 'ipaddress', 'ip_address', 'useragent', 'user_agent',
    'rawprompt', 'raw_prompt', 'rawresponse', 'raw_response', 'password', 'token',
    'phone', 'telefono', 'fullname', 'full_name', 'schoolname', 'school_name',
]);

// ── Requisitos de sobre por tipo (capa canónica; el registry es autoridad de payload) ──
// Sólo declara requisitos NO derivables del payload. Default: no exige content ni
// session en el sobre (muchos tipos los llevan en payload). offlineAllowed limita
// qué provenances aceptan offline=true.
const REQUIREMENTS = {
    // lectura: sesión de interacción y contenido son identidad de sobre
    reading_started:   { contentRequired: true, sessionRequired: true },
    reading_progress:  { contentRequired: true, sessionRequired: true },
    reading_completed: { contentRequired: true, sessionRequired: true },
    reading_paused:    { contentRequired: true, sessionRequired: true },
    reading_resumed:   { contentRequired: true, sessionRequired: true },
    pdf_page_changed:  { contentRequired: true, sessionRequired: true },
    album_page_changed:{ contentRequired: true, sessionRequired: true },
    session_started:   { sessionRequired: true },
    session_ended:     { sessionRequired: true },
    session_heartbeat: { sessionRequired: true },
    leo_interaction_started:   { sessionRequired: true },
    leo_interaction_completed: { sessionRequired: true },
};
const DEFAULT_REQ = Object.freeze({ contentRequired: false, sessionRequired: false });

export function requirementsFor(eventType) {
    return REQUIREMENTS[eventType] ? { ...DEFAULT_REQ, ...REQUIREMENTS[eventType] } : DEFAULT_REQ;
}

// ── Schema estructural del sobre (Zod estricto) ─────────────────────────────
// receivedAt es DERIVED (server-owned); en el sobre ya normalizado debe existir,
// pero el cliente NO lo aporta (el normalizer lo inyecta desde verifiedContext).
const ulidField = z.string().refine(isValidUlid, { message: 'eventId debe ser un ULID válido' });

export const canonicalEnvelopeSchema = z.object({
    eventId:              ulidField,
    schemaVersion:        z.number().int(),
    eventType:            z.string().min(1),
    mode:                 z.enum(CANONICAL_MODE),
    actorId:              z.string().min(1),
    institutionId:        z.string().min(1).optional(),
    groupId:              z.string().min(1).optional(),
    contentId:            z.string().min(1).nullable().optional(),
    subresourceId:        z.string().min(1).optional(),
    interactionSessionId: z.string().min(1).optional(),
    occurredAt:           z.number().int(),
    receivedAt:           z.number().int(),
    provenance:           z.enum(PROVENANCE),
    offline:              z.boolean().optional(),
    payload:              z.record(z.unknown()).optional(),
}).strict();   // .strict() → rechaza claves de sobre desconocidas (incl. REJECTED_ENVELOPE_KEYS)

/** Escaneo profundo de claves PII prohibidas (case-insensitive). */
export function scanForbiddenKeys(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    for (const k of Object.keys(obj)) {
        if (FORBIDDEN_PII_KEYS.includes(k.toLowerCase())) return k;
        const v = obj[k];
        if (v && typeof v === 'object') {
            const hit = scanForbiddenKeys(v, depth + 1);
            if (hit) return hit;
        }
    }
    return null;
}

/** Tamaño serializado del payload en bytes UTF-8. */
export function payloadBytes(payload) {
    if (payload === undefined || payload === null) return 0;
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

/**
 * Valida un sobre YA normalizado (post verifiedContext). Puro/estructural.
 * NO confía en nada: sólo comprueba forma, versión, tipo, tiempo, payload, PII.
 *
 * @returns {{ok:true, event:object, meta:object} | {ok:false, code:string, issues?:Array}}
 */
export function validateCanonicalEnvelope(evt) {
    // 1) versión soportada (fail-closed en futura)
    if (!evt || typeof evt !== 'object') return { ok: false, code: EVENT_ERROR.INVALID_EVENT };
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(evt.schemaVersion)) {
        return { ok: false, code: EVENT_ERROR.UNSUPPORTED_VERSION };
    }
    // 2) estructura del sobre (strict → claves desconocidas/rechazadas fallan)
    const parsed = canonicalEnvelopeSchema.safeParse(evt);
    if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 10).map(i => ({ path: i.path.join('.') || '(root)', message: i.message }));
        // Distinguir clave de sobre rechazada explícita
        const badKey = Object.keys(evt).find(k => REJECTED_ENVELOPE_KEYS.includes(k));
        if (badKey) return { ok: false, code: EVENT_ERROR.FORBIDDEN_FIELD, issues: [{ path: badKey, message: 'clave de sobre no confiable' }] };
        return { ok: false, code: EVENT_ERROR.INVALID_EVENT, issues };
    }
    const e = parsed.data;
    if (!isValidUlid(e.eventId)) return { ok: false, code: EVENT_ERROR.MISSING_EVENT_ID };

    // 3) tipo registrado
    if (!EVENT_NAMES.includes(e.eventType)) return { ok: false, code: EVENT_ERROR.UNKNOWN_EVENT_TYPE };

    // 4) tiempo: receivedAt server-owned; occurredAt acotado (skew futuro duro; pasado offline permitido)
    if (!Number.isFinite(e.receivedAt) || e.receivedAt < MIN_PLATFORM_TS) return { ok: false, code: EVENT_ERROR.INVALID_TIME };
    if (!Number.isFinite(e.occurredAt) || e.occurredAt < MIN_PLATFORM_TS) return { ok: false, code: EVENT_ERROR.INVALID_TIME };
    if (e.occurredAt > e.receivedAt + MAX_FUTURE_SKEW_MS) return { ok: false, code: EVENT_ERROR.INVALID_TIME };

    // 5) requisitos de identidad de sobre por tipo
    const req = requirementsFor(e.eventType);
    if (req.contentRequired && !e.contentId) return { ok: false, code: EVENT_ERROR.INVALID_EVENT, issues: [{ path: 'contentId', message: 'requerido por el tipo' }] };
    if (req.sessionRequired && !e.interactionSessionId) return { ok: false, code: EVENT_ERROR.INVALID_EVENT, issues: [{ path: 'interactionSessionId', message: 'requerido por el tipo' }] };

    // 6) payload: PII prohibida + tamaño + validación estricta por registry.
    //    La identidad de sobre (contentId/interactionSessionId) se HOISTEA a nivel
    //    de sobre; el registry (autoridad de payload) la espera como contentId/
    //    sessionId → se inyecta para validar, y se retira del payload final para no
    //    duplicar (events.db la guarda en columnas content_id/session_id).
    const rawPayload = e.payload ?? {};
    const forbidden = scanForbiddenKeys(rawPayload);
    if (forbidden) return { ok: false, code: EVENT_ERROR.FORBIDDEN_FIELD, issues: [{ path: forbidden, message: 'campo PII prohibido' }] };
    if (payloadBytes(rawPayload) > MAX_PAYLOAD_BYTES) return { ok: false, code: EVENT_ERROR.PAYLOAD_TOO_LARGE };

    const registryInput = { ...rawPayload };
    if (e.contentId != null && registryInput.contentId === undefined) registryInput.contentId = e.contentId;
    if (e.interactionSessionId != null && registryInput.sessionId === undefined) registryInput.sessionId = e.interactionSessionId;

    const pv = validatePayload(e.eventType, registryInput, e.schemaVersion === 1 ? undefined : e.schemaVersion);
    if (!pv.ok) {
        if (pv.code === 'unknown_event') return { ok: false, code: EVENT_ERROR.UNKNOWN_EVENT_TYPE };
        if (pv.code === 'unsupported_version') return { ok: false, code: EVENT_ERROR.UNSUPPORTED_VERSION };
        return { ok: false, code: EVENT_ERROR.INVALID_EVENT, issues: pv.issues };
    }
    // 7) claves desconocidas del payload crudo → REJECT en el path canónico
    //    (el registry hace .strip(); aquí exigimos rechazo explícito). Se comparan
    //    las claves del payload CRUDO (sin la identidad hoisteada) contra lo validado.
    const extraKeys = Object.keys(rawPayload).filter(k => !(k in pv.payload) && k !== 'contentId' && k !== 'sessionId');
    if (extraKeys.length > 0) return { ok: false, code: EVENT_ERROR.UNKNOWN_PAYLOAD_KEY, issues: extraKeys.slice(0, 10).map(k => ({ path: k, message: 'clave de payload no permitida por el tipo' })) };

    // Payload canónico final = payload validado SIN la identidad hoisteada (vive en el sobre).
    const finalPayload = { ...pv.payload };
    delete finalPayload.contentId;
    delete finalPayload.sessionId;

    const clean = { ...e, payload: finalPayload };
    return { ok: true, event: Object.freeze(clean), meta: pv.meta };
}

export { REGISTRY_VERSION };
