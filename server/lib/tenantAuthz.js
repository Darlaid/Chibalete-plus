/**
 * tenantAuthz.js — CHP-IDDB-M1-B-TENANT-AUTHZ-01.
 *
 * Aislamiento por INSTITUCIÓN + gobernanza de membership por actor. Autoridad de
 * tenant = institución, resuelta server-side desde relaciones CANÓNICAS
 * (memberships de grupos JSON físico + organizationId registrado). NUNCA confía
 * en x-user-id/body/query/cookie-role como autoridad; los IDs de la request son
 * INPUT a autorizar. Consume `req.auth.userId` de M1-A (o, en transición previa a
 * M1-A enforce, la identidad autenticada que server.js ya resolvió).
 *
 * Modo (`TENANT_AUTHZ_MODE`, default 'off' = comportamiento actual intacto):
 *   off     — sin scoping (no-op).
 *   shadow  — calcula la decisión y emite telemetría, pero NO bloquea ni cambia
 *             la respuesta.
 *   enforce — aplica el scoping real (deny/filtrado).
 *
 * Módulo PURO: recibe lectores de stores (users/groups/schools) inyectados; sin
 * estado global salvo la lectura del modo por env.
 */

export const TENANT_AUTHZ_MODES = Object.freeze(['off', 'shadow', 'enforce']);
export function tenantAuthzMode() {
    const v = String(process.env.TENANT_AUTHZ_MODE || 'off').toLowerCase().trim();
    return TENANT_AUTHZ_MODES.includes(v) ? v : 'off';
}
export const tenantAuthzEnabled = () => tenantAuthzMode() !== 'off';
export const tenantAuthzEnforcing = () => tenantAuthzMode() === 'enforce';

export const SCOPE = Object.freeze({ RESOLVED: 'RESOLVED', UNSCOPED: 'UNSCOPED', AMBIGUOUS: 'AMBIGUOUS' });
export const DECISION = Object.freeze({ ALLOW: 'allow', DENY: 'deny' });

const asArray = (v) => (Array.isArray(v) ? v : []);
const rolesOf = (user) => (Array.isArray(user?.roles) ? user.roles : (user?.rol ? [user.rol] : []));

/** Rol global canónico del actor. */
export function globalRoleOf(user) {
    const r = rolesOf(user);
    if (r.includes('administrador')) return 'administrador';
    if (r.includes('mediador')) return 'mediador';
    return 'lector';
}

/** Ids de organización REGISTRADOS (únicos que conceden scope). */
export function registeredOrgIds(schools) {
    return new Set(asArray(schools).map(s => s?.id).filter(Boolean));
}

const memberIdsOf = (g) => [...asArray(g?.memberIds), ...asArray(g?.studentIds)];
const mediatorIdsOf = (g) => [...asArray(g?.mediatorIds), ...(g?.teacherId ? [g.teacherId] : [])];

/** Grupos donde el usuario es mediador. */
export function mediatorGroups(groups, userId) {
    return asArray(groups).filter(g => mediatorIdsOf(g).includes(userId));
}
/** Grupos donde el usuario es miembro. */
export function memberGroups(groups, userId) {
    return asArray(groups).filter(g => memberIdsOf(g).includes(userId));
}
const groupOrg = (g, regOrgs) => {
    const o = typeof g?.organizationId === 'string' ? g.organizationId.trim() : '';
    return o && regOrgs.has(o) ? o : null;
};

/**
 * Resuelve la institución de tenant de un usuario. Prioridad EXPLÍCITA:
 * membership (autoridad primaria) → organizationId registrado. Conflicto o
 * múltiples instituciones por membership ⇒ AMBIGUOUS (fail-closed).
 * @returns {{status:string, institutionId:string|null, source:string|null}}
 */
export function resolveUserInstitutionScope(userId, { users, groups, schools }) {
    const regOrgs = registeredOrgIds(schools);
    const user = asArray(users).find(u => u?.id === userId) || null;
    // Instituciones por membership (miembro o mediador).
    const memInsts = new Set();
    for (const g of asArray(groups)) {
        if (memberIdsOf(g).includes(userId) || mediatorIdsOf(g).includes(userId)) {
            const o = groupOrg(g, regOrgs);
            if (o) memInsts.add(o);
        }
    }
    const orgId = user && typeof user.organizationId === 'string' && regOrgs.has(user.organizationId.trim())
        ? user.organizationId.trim() : null;

    if (memInsts.size > 1) return { status: SCOPE.AMBIGUOUS, institutionId: null, source: 'membership_multi' };
    if (memInsts.size === 1) {
        const memInst = [...memInsts][0];
        if (orgId && orgId !== memInst) return { status: SCOPE.AMBIGUOUS, institutionId: null, source: 'membership_vs_org' };
        return { status: SCOPE.RESOLVED, institutionId: memInst, source: 'membership' };
    }
    if (orgId) return { status: SCOPE.RESOLVED, institutionId: orgId, source: 'organizationId' };
    return { status: SCOPE.UNSCOPED, institutionId: null, source: null };
}

/**
 * Contexto de autorización de un actor autenticado. Todo se resuelve server-side.
 */
export function buildActorContext(actorId, { users, groups, schools }) {
    const regOrgs = registeredOrgIds(schools);
    const actorUser = asArray(users).find(u => u?.id === actorId) || null;
    const role = globalRoleOf(actorUser);
    const scope = resolveUserInstitutionScope(actorId, { users, groups, schools });
    const medGroupIds = new Set(mediatorGroups(groups, actorId).map(g => g?.id).filter(Boolean));
    return { actorId, actorUser, role, scope, medGroupIds, users, groups, schools, regOrgs };
}

const allow = (resourceClass, reason = 'ok') => ({ decision: DECISION.ALLOW, reason, resourceClass });
const deny = (resourceClass, reason) => ({ decision: DECISION.DENY, reason, resourceClass });

/** Admin global explícito (rol server-side). Máquina (admin_secret) se decide fuera. */
export function requireGlobalAdmin(ctx, resourceClass = 'global') {
    return ctx.role === 'administrador' ? allow(resourceClass, 'global_admin') : deny(resourceClass, 'not_global_admin');
}

/** El actor pertenece a `institutionId`. Fail-closed si UNSCOPED/AMBIGUOUS. */
export function requireSameInstitution(ctx, institutionId, resourceClass = 'institution') {
    if (ctx.role === 'administrador') return allow(resourceClass, 'global_admin');
    if (ctx.scope.status !== SCOPE.RESOLVED) return deny(resourceClass, `actor_${ctx.scope.status.toLowerCase()}`);
    if (!institutionId) return deny(resourceClass, 'target_no_institution');
    return ctx.scope.institutionId === institutionId ? allow(resourceClass, 'same_institution') : deny(resourceClass, 'cross_institution');
}

/** Lectura de un grupo: admin; mediador del grupo; miembro del grupo. */
export function requireGroupScope(ctx, group, resourceClass = 'group') {
    if (ctx.role === 'administrador') return allow(resourceClass, 'global_admin');
    if (!group || !group.id) return deny(resourceClass, 'group_not_found');
    const gid = group.id;
    if (ctx.medGroupIds.has(gid)) return allow(resourceClass, 'mediator_of_group');
    if (memberIdsOf(group).includes(ctx.actorId)) return allow(resourceClass, 'member_of_group');
    return deny(resourceClass, 'out_of_group_scope');
}

/**
 * Lectura de datos de un usuario objetivo (perfil/progreso/Aula Viva/Leo):
 * self ∪ admin ∪ mediador que comparte un grupo mediado con el target en su
 * institución. Fail-closed en cualquier otro caso.
 */
export function requireSelfOrScopedMediator(ctx, targetUserId, resourceClass = 'user') {
    if (ctx.actorId && ctx.actorId === targetUserId) return allow(resourceClass, 'self');
    if (ctx.role === 'administrador') return allow(resourceClass, 'global_admin');
    if (ctx.role !== 'mediador') return deny(resourceClass, 'not_mediator');
    if (ctx.scope.status !== SCOPE.RESOLVED) return deny(resourceClass, `actor_${ctx.scope.status.toLowerCase()}`);
    // El target debe ser miembro de algún grupo que el actor media (misma institución por construcción).
    for (const g of ctx.groups) {
        if (ctx.medGroupIds.has(g?.id) && memberIdsOf(g).includes(targetUserId)) {
            return allow(resourceClass, 'mediator_scope');
        }
    }
    return deny(resourceClass, 'target_out_of_mediator_scope');
}

/**
 * Gestión de membership en un grupo (create/role-change/revoke). Admin global,
 * o mediador del grupo en su institución. NUNCA se concede rol administrador por
 * esta vía; un mediador no puede otorgar `administrador` ni operar fuera de sus
 * grupos/su institución.
 */
export function requireMembershipManagementScope(ctx, group, { targetRole = 'member' } = {}, resourceClass = 'membership') {
    const roleToGrant = String(targetRole || 'member');
    if (roleToGrant === 'administrador') {
        // Solo admin global puede tocar autoridad de admin; y aun así membership
        // no otorga global_role — se rechaza por diseño (no es su vía).
        if (ctx.role === 'administrador') return deny(resourceClass, 'admin_role_not_via_membership');
        return deny(resourceClass, 'cannot_grant_admin');
    }
    if (ctx.role === 'administrador') return allow(resourceClass, 'global_admin');
    if (ctx.role !== 'mediador') return deny(resourceClass, 'not_mediator');
    if (!group || !group.id) return deny(resourceClass, 'group_not_found');
    if (!ctx.medGroupIds.has(group.id)) return deny(resourceClass, 'not_mediator_of_group');
    // Institución del grupo debe coincidir con la del actor.
    const inst = groupOrg(group, ctx.regOrgs);
    const sameInst = requireSameInstitution(ctx, inst, resourceClass);
    if (sameInst.decision === DECISION.DENY) return sameInst;
    if (roleToGrant === 'mediador' || roleToGrant === 'mediator') {
        // Un mediador no puede crear/otorgar rol mediador (evita auto/peer escalation);
        // reservado a admin global.
        return deny(resourceClass, 'mediator_cannot_grant_mediator');
    }
    return allow(resourceClass, 'mediator_in_scope');
}

/**
 * Filtra una lista de recursos al scope del actor. `classify(item, ctx)` devuelve
 * true si el actor puede verlo. Admin global ve todo. Devuelve {items, hidden}.
 */
export function scopeList(ctx, items, classify) {
    if (ctx.role === 'administrador') return { items: asArray(items), hidden: 0 };
    const kept = [];
    let hidden = 0;
    for (const it of asArray(items)) {
        if (classify(it, ctx)) kept.push(it); else hidden++;
    }
    return { items: kept, hidden };
}
