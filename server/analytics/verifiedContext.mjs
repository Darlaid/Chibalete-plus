/**
 * verifiedContext.mjs — CHP-STATS-INGEST-01B.
 *
 * Adapter server-side que construye el `verifiedContext` (autoridad de actor +
 * contexto institucional verificado) para `canonicalIngest`, a partir del
 * contexto autenticado del request (`req.auth`, M1-A/M1-B). NUNCA consulta el
 * body ni x-user-id como autoridad.
 *
 * DORMANT: no se cablea al endpoint productivo en esta unidad.
 *
 * Contrato de salida:
 *   { authenticatedUserId, institutionId?, groupId?, provenance }
 *
 * Dependencia real de M1-B: el snapshot institucional verificado
 * (institutionId/groupId) sólo estará disponible cuando M1-B esté desplegado y
 * poble `req.auth` con el tenant resuelto server-side. Mientras tanto el adapter
 * soporta el CONTEXTO PERSONAL autenticado (actor sólo, tenant NULL) sin
 * bloquear la ingestión de hechos personales legítimos. No duplica la lógica de
 * resolución de M1-B; sólo LEE lo que M1-B haya verificado.
 */

/**
 * @param {object} req  request con `req.auth` poblado por el middleware M1-A/M1-B
 * @param {object} [opts]  { provenance }  provenance sellada por el servidor (default 'web')
 * @returns {{ok:true, context:object} | {ok:false, reason:string}}
 */
export function verifiedContextFromAuth(req, opts = {}) {
    const auth = req && req.auth;
    // Autoridad de actor: SOLO la sesión firmada (M1-A). Sin fallback a
    // req.user/x-user-id/body: si no hay sesión verificada, no hay contexto.
    if (!auth || !auth.userId) {
        return { ok: false, reason: 'no_authenticated_actor' };
    }
    const context = {
        authenticatedUserId: String(auth.userId),
        provenance: opts.provenance ?? 'web',
    };
    // Contexto institucional VERIFICADO: sólo si M1-B lo resolvió en req.auth.
    // Nombres tolerantes a la convención real que exponga M1-B; se toma sólo lo
    // que el servidor haya verificado (nunca del body).
    const institutionId = auth.institutionId ?? auth.organizationId ?? auth.tenant?.institutionId ?? null;
    const groupId = auth.groupId ?? auth.tenant?.groupId ?? null;
    if (institutionId != null) context.institutionId = String(institutionId);
    if (groupId != null) context.groupId = String(groupId);
    return { ok: true, context };
}

/**
 * True si el contexto lleva tenant institucional verificado (vs personal).
 */
export function hasVerifiedInstitution(context) {
    return !!(context && context.institutionId != null);
}
