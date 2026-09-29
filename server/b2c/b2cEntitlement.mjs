/**
 * b2cEntitlement.mjs — P2-ENTITLEMENT-EXPIRY-01 (WEB-REORG P2-D1).
 *
 * «La identidad persiste. El entitlement expira.»
 *
 * Las obras y sus recursos ya los decide el motor de accesos (accessService: las reglas vencidas se
 * ignoran en cada petición). Lo que solo exigía sesión —Leo, el consumo de Experiencias, la narración
 * al vuelo (TTS)— se protege aquí con UNA regla, reutilizando el mismo motor como fuente de verdad:
 *
 *   - identidad B2C (`user.b2c === true`, la crea la provisión de la tienda):
 *       permitido si tiene AL MENOS UNA regla vigente que le aplique (B2C, colegio u otra),
 *       o rol de mediación/administración;
 *       si no, 403 ENTITLEMENT_EXPIRED (el login y la cuenta siguen funcionando);
 *   - cualquier otra identidad (colegios, mediadores, administración): SIN CAMBIOS (doctrina vigente).
 *
 * Una regla de colegio vigente sigue concediendo sus propios permisos; ninguna regla ajena se altera.
 * Si el motor falla, se deniega (fail-closed) solo a identidades B2C.
 */
export const ENTITLEMENT_EXPIRED = 'ENTITLEMENT_EXPIRED';
const PRIVILEGED_ROLES = ['administrador', 'admin', 'mediador'];

export const isB2cIdentity = (user) => !!(user && user.b2c === true);

/** Decisión pura. `appliedRules` = reglas vigentes que aplican al usuario (motor de accesos). */
export function hasActiveEntitlement(user, appliedRules) {
    if (!isB2cIdentity(user)) return true;
    const roles = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean);
    if (roles.some(r => PRIVILEGED_ROLES.includes(r))) return true;
    return Array.isArray(appliedRules) && appliedRules.length > 0;
}

/**
 * Middleware (después de requireUserAuth). `resolve(userId)` → { appliedRules }; se evalúa en cada
 * petición, sin caché propia. `onExpired: 'deny'` → 403; `'empty'` → [] (listados: estado vacío sin romper la UI).
 */
export function createB2cEntitlementGuard({ resolve, log = () => {}, onExpired = 'deny' }) {
    return function b2cEntitlementGuard(req, res, next) {
        const user = req.user;
        if (!isB2cIdentity(user)) return next();
        let applied = [];
        try { applied = (resolve(user.id) || {}).appliedRules || []; }
        catch (e) { log(`[B2C] entitlement check failed user=${user.id}: ${e?.message || e}`, 'ERROR'); applied = []; }
        if (hasActiveEntitlement(user, applied)) return next();
        log(`[B2C] entitlement expired user=${user.id} ${req.method} ${req.route?.path || req.path}`, 'ACCESS');
        if (onExpired === 'empty') return res.json([]);
        return res.status(403).json({ error: 'Tu suscripción a Chibalete+ terminó.', code: ENTITLEMENT_EXPIRED });
    };
}
