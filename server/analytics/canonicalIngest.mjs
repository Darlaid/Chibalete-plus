/**
 * canonicalIngest.mjs — CHP-STATS-INGEST-01-PREP.
 *
 * Ingestión canónica ENDURECIDA de eventos (append-only, idempotente por
 * eventId, atribuida a identidad autenticada del servidor, sin confiar en
 * actor/tenant autoafirmados por el cliente). DORMANT: no cablea el endpoint
 * vivo `/api/v1/events` en esta unidad (sin cambio de runtime); es la autoridad
 * futura que reemplazará la validación/persistencia de ese path en una
 * activación controlada posterior.
 *
 * Cierra los gaps auditados del path vivo:
 *   - actor = contexto autenticado (verifiedContext.authenticatedUserId), NUNCA
 *     x-user-id/body → ACTOR_MISMATCH si el crudo difiere;
 *   - detección de CONFLICTO: mismo eventId + hecho distinto → 409 (no
 *     sobrescribe; el path vivo lo ignora en silencio);
 *   - receivedAt server-side; occurredAt preservado (jamás sustituido);
 *   - scan de PII / derived-state → rechazo antes de persistir;
 *   - tenant sólo desde contexto verificado (sin fabricar; sin bloquear hechos
 *     personales legítimos sin tenant);
 *   - payload ≤ 4KB.
 *
 * Deps inyectables (para tests puros y para el wiring futuro):
 *   - persist(fact) → { inserted: boolean }   (INSERT OR IGNORE atómico)
 *   - lookup(eventId) → storedFact | null      (lectura para conflicto)
 *   - now() → epoch ms                          (receivedAt server)
 * NO calcula analytics, ni deriva estado, ni toca insights. NO filtra cohortes
 * sintéticas (eso pertenece a la proyección/materialización).
 */

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
export const EVENT_NAME_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/; // {mode}.{action}
export const VALID_MODES = Object.freeze(['pdf', 'text', 'immersive', 'album', 'a11y', 'lu']);
export const PROVENANCE = Object.freeze(['web', 'lu', 'server', 'leo', 'experience', 'migration']);
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1]);
export const MAX_PAYLOAD_BYTES = 4096;
export const MIN_PLATFORM_TS = 1577836800000; // 2020-01-01Z
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

// PII / secretos prohibidos (deep-scan). `name` a secas NO se prohíbe (puede ser
// un fact legítimo tipo fieldName); sí los específicos de persona/credencial.
export const FORBIDDEN_PII_KEYS = Object.freeze([
    'email', 'correo', 'ip', 'ipaddress', 'ip_address', 'useragent', 'user_agent',
    'rawprompt', 'raw_prompt', 'rawresponse', 'raw_response', 'password', 'token',
    'phone', 'telefono', 'fullname', 'full_name', 'schoolname', 'school_name',
    'cookie', 'authorization', 'sid',
]);
// Estado derivado prohibido en el hecho (pertenece a insights.db).
export const FORBIDDEN_DERIVED_KEYS = Object.freeze([
    'streak', 'level', 'xp', 'readcount', 'read_count', 'blockscompleted', 'blocks_completed',
    'ranking', 'rank', 'recommendation', 'diagnostic', 'diagnostico', 'insights', 'score',
    'progresspercentage', 'progress_percentage',
]);
// Identidad/tenant/rol NUNCA como campo autoafirmado del sobre o payload.
export const REJECTED_ENVELOPE_KEYS = Object.freeze([
    'authsessionid', 'sid', 'role', 'roles', 'tenant', 'x-user-id', 'xuserid',
]);

/** Clases de resultado. */
export const INGEST_OUTCOME = Object.freeze({
    ACCEPTED: 'accepted',        // 201: primera persistencia del hecho
    DUPLICATE: 'duplicate',      // 200: mismo eventId + mismo hecho (idempotente)
    CONFLICT: 'conflict',        // 409: mismo eventId + hecho distinto
    REJECTED: 'rejected',        // 4xx: validación/identidad
    ERROR: 'error',              // 5xx: fallo transitorio de persistencia
});
export const INGEST_ERROR = Object.freeze({
    UNAUTHENTICATED: 'UNAUTHENTICATED',       // 401
    ACTOR_MISMATCH: 'ACTOR_MISMATCH',         // 403
    TENANT_MISMATCH: 'TENANT_MISMATCH',       // 403
    INVALID_PROVENANCE: 'INVALID_PROVENANCE', // 403
    MISSING_EVENT_ID: 'MISSING_EVENT_ID',     // 400
    INVALID_TIME: 'INVALID_TIME',             // 400
    UNKNOWN_EVENT_TYPE: 'UNKNOWN_EVENT_TYPE', // 400
    UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION', // 400
    INVALID_SESSION: 'INVALID_SESSION',       // 400
    FORBIDDEN_FIELD: 'FORBIDDEN_FIELD',       // 400
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',   // 413
    PERSIST_FAILED: 'PERSIST_FAILED',         // 5xx
});
const STATUS = {
    [INGEST_ERROR.UNAUTHENTICATED]: 401,
    [INGEST_ERROR.ACTOR_MISMATCH]: 403,
    [INGEST_ERROR.TENANT_MISMATCH]: 403,
    [INGEST_ERROR.INVALID_PROVENANCE]: 403,
    [INGEST_ERROR.MISSING_EVENT_ID]: 400,
    [INGEST_ERROR.INVALID_TIME]: 400,
    [INGEST_ERROR.UNKNOWN_EVENT_TYPE]: 400,
    [INGEST_ERROR.UNSUPPORTED_VERSION]: 400,
    [INGEST_ERROR.INVALID_SESSION]: 400,
    [INGEST_ERROR.FORBIDDEN_FIELD]: 400,
    [INGEST_ERROR.PAYLOAD_TOO_LARGE]: 413,
    [INGEST_ERROR.PERSIST_FAILED]: 503,
};

function byteLength(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return Buffer.byteLength(str, 'utf8');
}

/** Deep-scan de claves prohibidas (case-insensitive), profundidad acotada. */
function scanForbiddenKeys(obj, forbidden, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    for (const k of Object.keys(obj)) {
        if (forbidden.includes(String(k).toLowerCase())) return k;
        const v = obj[k];
        if (v && typeof v === 'object') {
            const hit = scanForbiddenKeys(v, forbidden, depth + 1);
            if (hit) return hit;
        }
    }
    return null;
}

/** Huella canónica del hecho (para detección de conflicto por eventId). */
export function factFingerprint(fact) {
    // Campos que definen la identidad del hecho. server_ts/receivedAt/created_at
    // (server-owned) se excluyen a propósito: no forman parte del hecho del cliente.
    const canon = {
        event_id: fact.event_id,
        event: fact.event,
        mode: fact.mode,
        user_id: fact.user_id,
        content_id: fact.content_id ?? null,
        session_id: fact.session_id,
        client_ts: fact.client_ts,
        payload: fact.payload_json ?? (fact.payload ? JSON.stringify(fact.payload) : null),
    };
    return JSON.stringify(canon);
}

function reject(error, detail) {
    return { ok: false, outcome: INGEST_OUTCOME.REJECTED, error, status: STATUS[error] ?? 400, ...(detail ? { detail } : {}) };
}

/**
 * Normaliza + valida un evento crudo contra el contexto VERIFICADO, sin
 * persistir. La autoridad de actor/tenant/provenance/receivedAt es el servidor.
 *
 * @param {object} raw  evento crudo del cliente (backbone {mode}.{action} shape)
 * @param {object} verifiedContext  { authenticatedUserId, tenant?, provenance }
 * @param {number} receivedAt  epoch ms server-owned
 * @returns {{ok:true, fact:object} | {ok:false, error, status, detail?}}
 */
export function normalizeForIngest(raw, verifiedContext, receivedAt) {
    if (!verifiedContext || !verifiedContext.authenticatedUserId) {
        return reject(INGEST_ERROR.UNAUTHENTICATED);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return reject(INGEST_ERROR.MISSING_EVENT_ID);
    }
    // eventId: nunca fabricado aquí (la identidad se crea en el hecho, 01A/01B).
    if (typeof raw.eventId !== 'string' || !ULID_RE.test(raw.eventId)) {
        return reject(INGEST_ERROR.MISSING_EVENT_ID);
    }
    // Actor: AUTORIDAD = contexto autenticado. El crudo no manda.
    const actorId = verifiedContext.authenticatedUserId;
    const claimedActor = raw.userId ?? raw.actorId;
    if (claimedActor != null && String(claimedActor) !== String(actorId)) {
        return reject(INGEST_ERROR.ACTOR_MISMATCH);
    }
    // schemaVersion
    const version = raw.schemaVersion;
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
        return reject(INGEST_ERROR.UNSUPPORTED_VERSION);
    }
    // eventType: {mode}.{action} + mode válido (vocabulario backbone vivo).
    const eventName = raw.event ?? raw.type;
    if (typeof eventName !== 'string' || !EVENT_NAME_RE.test(eventName)) {
        return reject(INGEST_ERROR.UNKNOWN_EVENT_TYPE);
    }
    const mode = raw.mode ?? eventName.split('.')[0];
    if (!VALID_MODES.includes(mode)) {
        return reject(INGEST_ERROR.UNKNOWN_EVENT_TYPE);
    }
    // session
    const sessionId = raw.sessionId ?? raw.interactionSessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return reject(INGEST_ERROR.INVALID_SESSION);
    }
    // occurredAt (client fact time): preservado; receivedAt server-owned.
    const occurredAt = Number.isFinite(raw.clientTs) ? raw.clientTs
        : (Number.isFinite(raw.occurredAt) ? raw.occurredAt : null);
    if (occurredAt == null || !Number.isFinite(occurredAt)
        || occurredAt < MIN_PLATFORM_TS
        || occurredAt > receivedAt + MAX_FUTURE_SKEW_MS) {
        return reject(INGEST_ERROR.INVALID_TIME);
    }
    // provenance sellada por el contexto (no autoafirmada).
    const provenance = verifiedContext.provenance ?? 'web';
    if (!PROVENANCE.includes(provenance)) {
        return reject(INGEST_ERROR.INVALID_PROVENANCE);
    }
    if (raw.provenance != null && String(raw.provenance) !== String(provenance)) {
        return reject(INGEST_ERROR.INVALID_PROVENANCE);
    }
    // tenant: sólo desde el contexto verificado; el crudo no puede autoafirmarlo.
    // Ausencia de tenant es válida (hecho personal legítimo). No se fabrica.
    const rawTenant = raw.institutionId ?? raw.groupId ?? raw.tenant;
    if (rawTenant != null && verifiedContext.tenant == null) {
        return reject(INGEST_ERROR.TENANT_MISMATCH); // cliente afirma tenant no verificado
    }
    if (rawTenant != null && verifiedContext.tenant != null
        && String(rawTenant) !== String(verifiedContext.tenant.institutionId ?? verifiedContext.tenant)) {
        return reject(INGEST_ERROR.TENANT_MISMATCH);
    }
    // payload
    let payload = raw.payload;
    if (payload !== undefined && payload !== null) {
        if (typeof payload !== 'object' || Array.isArray(payload)) {
            return reject(INGEST_ERROR.FORBIDDEN_FIELD, 'payload no es objeto');
        }
        const pii = scanForbiddenKeys(payload, FORBIDDEN_PII_KEYS);
        if (pii) return reject(INGEST_ERROR.FORBIDDEN_FIELD, `pii:${pii}`);
        const derived = scanForbiddenKeys(payload, FORBIDDEN_DERIVED_KEYS);
        if (derived) return reject(INGEST_ERROR.FORBIDDEN_FIELD, `derived:${derived}`);
        const bytes = byteLength(JSON.stringify(payload));
        if (bytes > MAX_PAYLOAD_BYTES) return reject(INGEST_ERROR.PAYLOAD_TOO_LARGE, `${bytes}b`);
    } else {
        payload = null;
    }
    // Claves prohibidas de identidad en el sobre crudo (además de las tratadas).
    const envHit = scanForbiddenKeys(raw, REJECTED_ENVELOPE_KEYS, 0);
    if (envHit && !['tenant', 'roles', 'role'].includes(String(envHit).toLowerCase())) {
        // tenant/role ya tratados arriba; el resto (authSessionId/sid/xUserId) → rechazo.
        return reject(INGEST_ERROR.FORBIDDEN_FIELD, `envelope:${envHit}`);
    }

    // Hecho canónico a persistir. user_id = actor AUTENTICADO (no el crudo).
    // client_ts = occurredAt preservado; server_ts lo pone la capa de persistencia.
    const fact = {
        event_id: raw.eventId,
        schema_version: version,
        event: eventName,
        mode,
        user_id: actorId,
        content_id: raw.contentId ?? null,
        session_id: sessionId,
        client_ts: occurredAt,
        elapsed_ms: Number.isFinite(raw.elapsedMs) ? Math.max(0, Math.round(raw.elapsedMs)) : null,
        progress_fraction: Number.isFinite(raw.progressFraction) ? raw.progressFraction : null,
        payload,
        // metadata de contexto (no se persiste como columna hoy — ver doc):
        _provenance: provenance,
        _tenant: verifiedContext.tenant ?? null,
        _receivedAt: receivedAt,
    };
    return { ok: true, fact };
}

/**
 * Ingesta un evento: normaliza + valida + persiste idempotente append-only con
 * detección de conflicto. NO fabrica identidad. NO muta hechos previos.
 *
 * @param {object} raw
 * @param {object} verifiedContext  { authenticatedUserId, tenant?, provenance }
 * @param {object} deps  { persist(fact)->{inserted}, lookup(eventId)->fact|null, now()->ms }
 * @returns {{ok, outcome, status, error?, eventId?}}
 */
export function ingestCanonicalEvent(raw, verifiedContext, deps) {
    const now = (deps && typeof deps.now === 'function') ? deps.now() : Date.now();
    const norm = normalizeForIngest(raw, verifiedContext, now);
    if (!norm.ok) return norm;
    const fact = norm.fact;

    // Persistencia atómica INSERT OR IGNORE (idempotente por event_id UNIQUE).
    let inserted;
    try {
        const r = deps.persist(fact);
        inserted = !!(r && r.inserted);
    } catch (e) {
        return { ok: false, outcome: INGEST_OUTCOME.ERROR, error: INGEST_ERROR.PERSIST_FAILED, status: STATUS[INGEST_ERROR.PERSIST_FAILED], detail: String(e && e.message || e) };
    }

    if (inserted) {
        return { ok: true, outcome: INGEST_OUTCOME.ACCEPTED, status: 201, eventId: fact.event_id };
    }

    // No insertado ⇒ el event_id ya existía. Comparar el hecho para distinguir
    // duplicado idempotente (mismo hecho) de CONFLICTO (hecho distinto). La
    // atomicidad de INSERT OR IGNORE garantiza que el ganador ya está fijo; el
    // perdedor sólo LEE y compara (sin carrera check-then-insert).
    let existing = null;
    try { existing = deps.lookup(fact.event_id); } catch { existing = null; }
    if (!existing) {
        // Raro: dedup pero no encontrado (rotación/archivado concurrente). Tratar
        // como aceptado idempotente (append-only; no reintentar mutando).
        return { ok: true, outcome: INGEST_OUTCOME.DUPLICATE, status: 200, eventId: fact.event_id };
    }
    if (factFingerprint(existing) === factFingerprint(fact)) {
        return { ok: true, outcome: INGEST_OUTCOME.DUPLICATE, status: 200, eventId: fact.event_id };
    }
    return { ok: false, outcome: INGEST_OUTCOME.CONFLICT, status: 409, error: 'EVENT_ID_CONFLICT', eventId: fact.event_id };
}
