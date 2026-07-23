/**
 * scopeAccess.mjs — CHP-ID-01 (antes PASO 7 §13).
 *
 * Autorización de scopes institucionales consumiendo EXCLUSIVAMENTE el CIS
 * (server/identity/cis.mjs — CHP-ADR-01 §I). Este módulo ya NO abre archivos
 * de identidad ni conoce paths: la fuente de usuarios es config.USERS_DB y la
 * de grupos config.GROUPS_DB, resueltas dentro del CIS (cierra STAT-03/SEC-03:
 * el path hardcodeado al padrón obsoleto queda eliminado).
 *
 * Se llama DESPUÉS de `requireUserAuth`. El header x-user-id sigue siendo un
 * claim `legacy_asserted` (CHP-ADR-01 §G.13) verificado contra el canónico:
 * NO es identidad criptográficamente verificada ni habilita CHP-VAL-ISO-01.
 *
 * Política (sin cambios funcionales de fondo; ahora vía CIS):
 *   - Admin → todos los scopes, por política declarada
 *     `platform_admin_full_institutional_read` (CHP-ADR-01 §G.8).
 *   - Mediador → scope 'user' si el target es miembro de algún grupo que
 *     media; 'group'/'club' si media ese grupo; 'school' si media en esa
 *     school; agregados ('all'/cohortes) por política `mediator_aggregate_read`.
 *   - Lector → solo scope 'user' con su propio id.
 *   - Default-deny.
 *
 * Taxonomía fail-closed (CHP-ADR-01 §I-2) — sin catch-all silencioso:
 *   401 identidad ausente o no demostrable · 403 principal sin autorización ·
 *   503 canónico indisponible (IDENTITY_UNAVAILABLE, nunca presentado como 403
 *   ni como false ordinario en los guards HTTP).
 */
import { authorizeScope, IdentityUnavailableError } from '../identity/cis.mjs';

/**
 * Decisión tipificada de acceso a `(scope_type, scope_id)`.
 * @returns {{decision:'allow'|'unauthenticated'|'forbidden'|'unavailable',
 *            via?:string, cause?:string}}
 */
export function evaluateScopeAccess(callerId, scope_type, scope_id) {
    return authorizeScope(callerId, scope_type, scope_id);
}

/**
 * @deprecated Compat legacy (boolean) — usar evaluateScopeAccess (decisión
 * tipificada) o requireScopeAccess (mapeo HTTP 401/403/503).
 *
 * Contrato (CHP-ID-01-FIX-01 H2):
 *   - allow determinable            → true
 *   - deny/unauthenticated          → false
 *   - IDENTITY_UNAVAILABLE          → LANZA IdentityUnavailableError (tipificado)
 *   - error inesperado              → se propaga
 * La indisponibilidad del canónico JAMÁS se colapsa a false (CHP-ADR-01 §I-2).
 */
export function canAccessScope(callerId, scope_type, scope_id) {
    const d = evaluateScopeAccess(callerId, scope_type, scope_id);
    if (d.decision === 'unavailable') {
        throw new IdentityUnavailableError(d.cause ?? 'unavailable', { via: 'canAccessScope' });
    }
    return d.decision === 'allow';
}

/**
 * Middleware-helper para handlers institucionales. Si NO autoriza, responde
 * con el status de la taxonomía y NO continúa.
 */
export function requireScopeAccess(scope_type, scope_id, req, res) {
    const callerId = req.headers['x-user-id']; // claim legacy_asserted (CHP-ADR-01 §G.13)
    const d = evaluateScopeAccess(callerId, scope_type, scope_id);
    if (d.decision === 'allow') return true;
    if (d.decision === 'unavailable') {
        res.status(503).json({ ok: false, error: 'identity_unavailable', cause: d.cause });
        return false;
    }
    if (d.decision === 'unauthenticated') {
        res.status(401).json({ ok: false, error: 'identity_not_established' });
        return false;
    }
    res.status(403).json({ ok: false, error: 'scope_access_denied',
                            scope_type, scope_id });
    return false;
}
