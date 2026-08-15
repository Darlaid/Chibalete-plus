/**
 * normalizeCanonicalEvent.mjs — CHP-STATS-EVENT-CONTRACT-01 (DORMANT).
 *
 * Frontera de confianza: convierte un evento CRUDO (de cliente/adaptador) en un
 * evento canónico usando SÓLO `verifiedContext` como autoridad de actor, tenant,
 * provenance y receivedAt. NUNCA confía en el actor/tenant/provenance/tiempo de
 * recepción crudos del cliente. No fabrica id/actor/tiempo faltantes.
 *
 * verifiedContext (lo aporta la ingestión futura, NO esta unidad):
 *   {
 *     authenticatedUserId: string,     // autoridad de actor (req.auth.userId, M1-A)
 *     verifiedInstitutionId?: string,  // snapshot server-verified (M1-B)
 *     verifiedGroupId?: string,
 *     provenance: 'web'|'lu'|'server'|'leo'|'experience'|'migration',  // sellada por el canal
 *     receivedAt: number,              // server-owned (Date.now en ingestión)
 *   }
 *
 * Módulo PURO: sin I/O, sin reloj (receivedAt inyectado), sin lookup de identidad.
 */
import { validateCanonicalEnvelope, EVENT_ERROR, PROVENANCE, CANONICAL_SCHEMA_VERSION } from './canonicalEvent.mjs';
import { isValidUlid } from '../ulid.js';

function fail(code, detail) { return { ok: false, code, ...(detail ? { detail } : {}) }; }

function isValidVerifiedContext(ctx) {
    return !!ctx
        && typeof ctx.authenticatedUserId === 'string' && ctx.authenticatedUserId.length > 0
        && PROVENANCE.includes(ctx.provenance)
        && Number.isFinite(ctx.receivedAt);
}

/**
 * @param {object} raw   evento crudo (shape de sobre canónico, pero NO confiable)
 * @param {object} verifiedContext
 * @returns {{ok:true, event}|{ok:false, code, ...}}
 */
export function normalizeCanonicalEvent(raw, verifiedContext) {
    if (!raw || typeof raw !== 'object') return fail(EVENT_ERROR.INVALID_EVENT);
    // El contexto verificado es la ÚNICA autoridad; sin él, no hay provenance segura.
    if (!isValidVerifiedContext(verifiedContext)) return fail(EVENT_ERROR.INSUFFICIENT_PROVENANCE);

    // 1) eventId: el emisor DEBE haberlo asignado en la creación del hecho. No se fabrica.
    if (!isValidUlid(raw.eventId)) return fail(EVENT_ERROR.MISSING_EVENT_ID);

    // 2) ACTOR: autoridad = verifiedContext.authenticatedUserId. Un actorId crudo
    //    distinto es intento de suplantación → reject. (Nunca x-user-id/body como autoridad.)
    if (raw.actorId != null && String(raw.actorId) !== String(verifiedContext.authenticatedUserId)) {
        return fail(EVENT_ERROR.ACTOR_MISMATCH);
    }
    const actorId = String(verifiedContext.authenticatedUserId);

    // 3) TENANT: snapshot server-verified. Un institution/group crudo que NO coincide
    //    con el verificado es spoof → reject. Si el contexto no verifica tenant, se OMITE
    //    (no se copia el del cliente).
    if (raw.institutionId != null && verifiedContext.verifiedInstitutionId != null
        && String(raw.institutionId) !== String(verifiedContext.verifiedInstitutionId)) {
        return fail(EVENT_ERROR.TENANT_MISMATCH);
    }
    if (raw.groupId != null && verifiedContext.verifiedGroupId != null
        && String(raw.groupId) !== String(verifiedContext.verifiedGroupId)) {
        return fail(EVENT_ERROR.TENANT_MISMATCH);
    }
    // Cliente aporta tenant pero el contexto NO lo verifica → no se puede confiar → reject spoof.
    if (raw.institutionId != null && verifiedContext.verifiedInstitutionId == null) return fail(EVENT_ERROR.TENANT_MISMATCH);
    if (raw.groupId != null && verifiedContext.verifiedGroupId == null) return fail(EVENT_ERROR.TENANT_MISMATCH);

    // 4) PROVENANCE: sellada por el contexto. Un provenance crudo distinto = auto-afirmación → reject.
    if (raw.provenance != null && String(raw.provenance) !== String(verifiedContext.provenance)) {
        return fail(EVENT_ERROR.INVALID_PROVENANCE);
    }

    // 5) receivedAt: SIEMPRE server-owned. Se ignora cualquier receivedAt crudo.
    const receivedAt = verifiedContext.receivedAt;

    // 6) Construir el sobre normalizado (sólo campos de contrato; el resto se descarta,
    //    incluidas claves de sobre no confiables — el schema .strict() las rechazaría igual).
    const normalized = {
        eventId:       raw.eventId,
        schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : CANONICAL_SCHEMA_VERSION,
        eventType:     raw.eventType,
        mode:          raw.mode,
        actorId,
        occurredAt:    Number.isFinite(raw.occurredAt) ? raw.occurredAt : undefined,
        receivedAt,
        provenance:    verifiedContext.provenance,
    };
    if (verifiedContext.verifiedInstitutionId != null) normalized.institutionId = String(verifiedContext.verifiedInstitutionId);
    if (verifiedContext.verifiedGroupId != null) normalized.groupId = String(verifiedContext.verifiedGroupId);
    if (raw.contentId !== undefined) normalized.contentId = raw.contentId;
    if (raw.subresourceId != null) normalized.subresourceId = raw.subresourceId;
    if (raw.interactionSessionId != null) normalized.interactionSessionId = raw.interactionSessionId;
    if (raw.offline != null) normalized.offline = Boolean(raw.offline);
    if (raw.payload != null && typeof raw.payload === 'object') normalized.payload = raw.payload;

    // occurredAt ausente → INVALID_TIME (no se fabrica desde receivedAt).
    if (normalized.occurredAt === undefined) return fail(EVENT_ERROR.INVALID_TIME);

    // 7) Validación estructural/estricta final.
    return validateCanonicalEnvelope(normalized);
}
