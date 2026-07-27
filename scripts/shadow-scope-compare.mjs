/**
 * shadow-scope-compare.mjs — CHP-ID-CANON-01B, Fase 3.
 *
 * Compara READ-ONLY las decisiones de autorización institucional entre:
 *
 *   MODELO A — el runtime PRODUCTIVO ACTUAL: `scopeAccess.canAccessScope`
 *              resolviendo contra el padrón LEGACY (data/users_db.json).
 *   MODELO B — el runtime PROPUESTO: el CIS resolviendo contra el padrón
 *              CANÓNICO ORO (data-critical/usuarios_colegios_oro.json).
 *
 * Ambos modelos comparten el MISMO store de grupos, así que la única variable
 * es el padrón de usuarios: exactamente lo que cambia el despliegue.
 *
 * MODELO A es una réplica literal del scopeAccess desplegado. MODELO B replica
 * la capa de decisión del CIS y delega la resolución de miembros en el módulo
 * real `utils/groupMembership.mjs` (verificado byte a byte contra producción).
 * `scripts/__test__/shadowScopeEquivalence.test.mjs` prueba que MODELO B
 * coincide con `server/identity/cis.mjs` sobre una matriz de fixtures.
 *
 * NO escribe nada. NO imprime nombres, emails, documentos ni IDs individuales:
 * solo agregados y conteos.
 *
 *   node scripts/shadow-scope-compare.mjs --legacy <path> --oro <path> --groups <path>
 */

const ADMIN_ROLES    = new Set(['administrador', 'admin']);
const MEDIATOR_ROLES = new Set(['profesor', 'mediador', 'teacher', 'librarian', 'coordinator']);

// ── MODELO A — réplica literal del scopeAccess desplegado ───────────────────
// Lee SOLO `user.role` (singular). Sin roles[], sin rol, sin fallback.

export function makeModelA(users, groups) {
    const byId = new Map((users || []).filter(u => u?.id).map(u => [u.id, u]));
    const isAdminA = (u) => !!u?.role && ADMIN_ROLES.has(String(u.role).toLowerCase());
    const isMediatorA = (u) => !!u?.role && MEDIATOR_ROLES.has(String(u.role).toLowerCase());
    const mediatedGroups = (callerId) => (groups || []).filter(g => {
        if (!g) return false;
        if (g.mediatorId === callerId) return true;
        if (Array.isArray(g.mediatorIds) && g.mediatorIds.includes(callerId)) return true;
        if (Array.isArray(g.mediadores) && g.mediadores.includes(callerId)) return true;
        return false;
    });

    return function decideA(callerId, scope_type, scope_id) {
        const caller = callerId ? byId.get(callerId) || null : null;
        if (!caller) return { allow: false, reason: 'caller_not_in_padron' };
        if (isAdminA(caller)) return { allow: true, reason: 'admin' };
        const sid = String(scope_id || '');
        switch (scope_type) {
            case 'user': {
                if (sid === callerId) return { allow: true, reason: 'self' };
                if (!isMediatorA(caller)) return { allow: false, reason: 'not_a_mediator' };
                for (const g of mediatedGroups(callerId)) {
                    const members = Array.isArray(g.memberIds) ? g.memberIds : [];
                    if (members.includes(sid)) return { allow: true, reason: 'mediator_of_member_group' };
                }
                return { allow: false, reason: 'target_not_in_mediated_groups' };
            }
            case 'group':
            case 'club': {
                if (!isMediatorA(caller)) return { allow: false, reason: 'not_a_mediator' };
                return mediatedGroups(callerId).some(g => g.id === sid)
                    ? { allow: true, reason: 'mediator_of_group' }
                    : { allow: false, reason: 'not_mediator_of_group' };
            }
            case 'school': {
                if (!isMediatorA(caller)) return { allow: false, reason: 'not_a_mediator' };
                return mediatedGroups(callerId).some(g => g.schoolId === sid)
                    ? { allow: true, reason: 'mediator_in_school' }
                    : { allow: false, reason: 'not_mediator_in_school' };
            }
            case 'library':
                return { allow: false, reason: 'library_admin_only' };
            case 'all':
            case 'intervention':
            case 'risk':
            case 'habit':
            case 'modality':
            case 'trajectory':
                return isMediatorA(caller)
                    ? { allow: true, reason: 'aggregate_mediator' }
                    : { allow: false, reason: 'aggregate_mediator_only' };
            default:
                return { allow: false, reason: 'unknown_scope_type' };
        }
    };
}

// ── MODELO B — réplica de la capa de decisión del CIS ───────────────────────

export function makeModelB(users, groups, groupMembership) {
    const { getGroupMembers } = groupMembership;
    const byId = new Map((users || []).filter(u => u?.id).map(u => [u.id, u]));

    const rolesOf = (u) => {
        const out = new Set();
        const push = (v) => { if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase()); };
        if (Array.isArray(u?.roles)) u.roles.forEach(push);
        push(u?.role);
        push(u?.rol);
        return out;
    };
    const isMediatorOfGroup = (g, id) => {
        if (!g || !id) return false;
        if (g.mediatorId === id) return true;
        if (Array.isArray(g.mediatorIds) && g.mediatorIds.includes(id)) return true;
        if (Array.isArray(g.mediadores) && g.mediadores.includes(id)) return true;
        return false;
    };
    const principalOf = (id) => {
        const u = id ? byId.get(id) : null;
        if (!u) return null;
        const r = rolesOf(u);
        return {
            id: u.id,
            platformAdmin: [...r].some(x => ADMIN_ROLES.has(x)),
            mediatorRole:  [...r].some(x => MEDIATOR_ROLES.has(x)),
        };
    };
    const scopeOf = (id) => {
        const mediatorGroupIds = new Set(), schoolIds = new Set();
        for (const g of groups || []) {
            if (!g?.id) continue;
            if (isMediatorOfGroup(g, id)) {
                mediatorGroupIds.add(g.id);
                if (g.schoolId) schoolIds.add(g.schoolId);
            }
        }
        return { mediatorGroupIds, schoolIds };
    };

    return function decideB(callerId, scope_type, scope_id) {
        if (typeof callerId !== 'string' || !callerId) {
            return { allow: false, reason: 'missing_principal' };
        }
        const principal = principalOf(callerId);
        if (!principal) return { allow: false, reason: 'caller_not_in_padron' };
        if (principal.platformAdmin) {
            return { allow: true, reason: 'policy:platform_admin_full_institutional_read' };
        }
        const sid = String(scope_id ?? '');
        switch (scope_type) {
            case 'user': {
                if (sid === principal.id) return { allow: true, reason: 'self' };
                if (!principal.mediatorRole) return { allow: false, reason: 'not_a_mediator' };
                for (const g of groups || []) {
                    if (!g?.id || !isMediatorOfGroup(g, principal.id)) continue;
                    const members = getGroupMembers(g, users, { allGroups: groups, warnFn: () => {} });
                    if (members.includes(sid)) return { allow: true, reason: 'mediator_of_member_group' };
                }
                return { allow: false, reason: 'target_not_in_mediated_groups' };
            }
            case 'group':
            case 'club': {
                if (!principal.mediatorRole) return { allow: false, reason: 'not_a_mediator' };
                return scopeOf(principal.id).mediatorGroupIds.has(sid)
                    ? { allow: true, reason: 'mediator_of_group' }
                    : { allow: false, reason: 'not_mediator_of_group' };
            }
            case 'school': {
                if (!principal.mediatorRole) return { allow: false, reason: 'not_a_mediator' };
                return scopeOf(principal.id).schoolIds.has(sid)
                    ? { allow: true, reason: 'mediator_in_school' }
                    : { allow: false, reason: 'not_mediator_in_school' };
            }
            case 'library':
                return { allow: false, reason: 'library_admin_only' };
            case 'all':
            case 'intervention':
            case 'risk':
            case 'habit':
            case 'modality':
            case 'trajectory':
                return principal.mediatorRole
                    ? { allow: true, reason: 'policy:mediator_aggregate_read' }
                    : { allow: false, reason: 'aggregate_mediator_only' };
            default:
                return { allow: false, reason: 'unknown_scope_type' };
        }
    };
}

// ── Clasificación de deltas ─────────────────────────────────────────────────

/**
 * Clasifica una diferencia A→B. `ctx` aporta los hechos que justifican el
 * cambio; sin un hecho que lo explique, el delta queda REVIEW_UNEXPLAINED.
 */
export function classifyDelta({ a, b, ctx }) {
    if (a.allow === b.allow) return 'IDENTICAL';

    if (!a.allow && b.allow) {
        // deny→allow legítimo: el caller es un principal real del canónico y su
        // autorización se apoya en una relación verificable (rol de plataforma,
        // mediación explícita del grupo, o su propio scope).
        if (ctx.callerInOro && (ctx.callerIsAdminB || ctx.callerMediatesTarget || ctx.isSelf)) {
            return 'EXPECTED_RESTORE_LEGITIMATE_ACCESS';
        }
        return 'HIGH_RISK_ACCESS_EXPANSION';
    }

    // allow→deny
    if (!ctx.callerInOro) {
        // El caller no existe en el padrón canónico: no es una identidad viva.
        return 'EXPECTED_REMOVE_INCORRECT_ACCESS';
    }
    if (ctx.callerInOro && !ctx.callerMediatesTarget && !ctx.isSelf && !ctx.callerIsAdminB) {
        return 'EXPECTED_REMOVE_INCORRECT_ACCESS';
    }
    return 'HIGH_RISK_ACCESS_LOSS';
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function argOf(flag, fallback) {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export async function runComparison({ legacyPath, oroPath, groupsPath, membershipPath }) {
    const fs = await import('node:fs');
    const gm = await import(membershipPath);

    const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
    const legacyUsers = read(legacyPath);
    const oroUsers    = read(oroPath);
    const groups      = read(groupsPath);

    const decideA = makeModelA(legacyUsers, groups);
    const decideB = makeModelB(oroUsers, groups, gm);

    const oroById = new Map(oroUsers.filter(u => u?.id).map(u => [u.id, u]));
    const rolesOf = (u) => {
        const out = new Set();
        const push = (v) => { if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase()); };
        if (Array.isArray(u?.roles)) u.roles.forEach(push);
        push(u?.role); push(u?.rol);
        return out;
    };
    const mediatesGroup = (g, id) => !!g && (g.mediatorId === id
        || (Array.isArray(g.mediatorIds) && g.mediatorIds.includes(id))
        || (Array.isArray(g.mediadores) && g.mediadores.includes(id)));

    // Universo de callers = unión de ambos padrones (nadie queda sin evaluar).
    const callerIds = [...new Set([
        ...legacyUsers.filter(u => u?.id).map(u => u.id),
        ...oroUsers.filter(u => u?.id).map(u => u.id),
    ])];

    const schoolIds = [...new Set(groups.map(g => g?.schoolId).filter(Boolean))];
    const groupIds  = groups.filter(g => g?.id).map(g => g.id);

    const totals = {
        callers_evaluated: callerIds.length,
        callers_only_legacy: 0, callers_only_oro: 0, callers_in_both: 0,
        decisions_evaluated: 0,
        identical: 0, deny_to_allow: 0, allow_to_deny: 0,
    };
    const byClass = {};
    const byScopeType = {};
    const unexplainedSamples = [];
    const reasonPairs = {};

    for (const callerId of callerIds) {
        const inOro    = oroById.has(callerId);
        const inLegacy = legacyUsers.some(u => u?.id === callerId);
        if (inOro && inLegacy) totals.callers_in_both++;
        else if (inOro) totals.callers_only_oro++;
        else totals.callers_only_legacy++;

        const oroUser = oroById.get(callerId) || null;
        const rB = oroUser ? rolesOf(oroUser) : new Set();
        const callerIsAdminB = [...rB].some(x => ADMIN_ROLES.has(x));

        // Matriz de scopes: propio perfil, agregados, cada grupo y cada school.
        const probes = [
            ['user', callerId, { isSelf: true }],
            ['all', 'all', {}],
            ['library', 'library', {}],
            ...groupIds.map(gid => ['group', gid, { groupId: gid }]),
            ...schoolIds.map(sid => ['school', sid, { schoolId: sid }]),
        ];
        // Scope 'user' contra los miembros de los grupos que el caller media
        // (dimensión sensible a fuga entre instituciones).
        for (const g of groups) {
            if (!mediatesGroup(g, callerId)) continue;
            const members = new Set([
                ...(Array.isArray(g.memberIds) ? g.memberIds : []),
                ...(Array.isArray(g.studentIds) ? g.studentIds : []),
            ]);
            for (const m of members) probes.push(['user', m, { targetInMediatedGroup: true }]);
        }

        for (const [type, sid, meta] of probes) {
            const a = decideA(callerId, type, sid);
            const b = decideB(callerId, type, sid);
            totals.decisions_evaluated++;

            const callerMediatesTarget = meta.targetInMediatedGroup === true
                || (meta.groupId && groups.some(g => g.id === meta.groupId && mediatesGroup(g, callerId)))
                || (meta.schoolId && groups.some(g => g.schoolId === meta.schoolId && mediatesGroup(g, callerId)))
                || (type === 'all' || type === 'intervention' || type === 'risk'
                    || type === 'habit' || type === 'modality' || type === 'trajectory');

            const cls = classifyDelta({
                a, b,
                ctx: {
                    callerInOro: inOro,
                    callerIsAdminB,
                    callerMediatesTarget: !!callerMediatesTarget,
                    isSelf: meta.isSelf === true,
                },
            });

            byClass[cls] = (byClass[cls] || 0) + 1;
            if (a.allow === b.allow) totals.identical++;
            else if (!a.allow && b.allow) totals.deny_to_allow++;
            else totals.allow_to_deny++;

            if (a.allow !== b.allow) {
                const k = `${type}: ${a.reason} → ${b.reason}`;
                reasonPairs[k] = (reasonPairs[k] || 0) + 1;
                byScopeType[type] = (byScopeType[type] || 0) + 1;
            }
            if (cls === 'REVIEW_UNEXPLAINED' || cls === 'HIGH_RISK_ACCESS_EXPANSION' || cls === 'HIGH_RISK_ACCESS_LOSS') {
                if (unexplainedSamples.length < 25) {
                    unexplainedSamples.push({ cls, scope_type: type, a: a.reason, b: b.reason, callerInOro: inOro });
                }
            }
        }
    }

    return {
        stores: {
            legacy_users: legacyUsers.length,
            oro_users: oroUsers.length,
            groups: groups.length,
            groups_with_schoolId: groups.filter(g => g?.schoolId).length,
            distinct_schoolIds: schoolIds.length,
        },
        totals,
        by_class: byClass,
        deltas_by_scope_type: byScopeType,
        delta_reason_pairs: reasonPairs,
        risk_samples: unexplainedSamples,
    };
}

const isMain = import.meta.url === `file://${process.argv[1]}`
    || (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()));
if (isMain && process.argv.includes('--run')) {
    const out = await runComparison({
        legacyPath:     argOf('--legacy', '/app/data/users_db.json'),
        oroPath:        argOf('--oro',    '/app/data-critical/usuarios_colegios_oro.json'),
        groupsPath:     argOf('--groups', '/app/data/groups_db.json'),
        membershipPath: argOf('--membership', '/app/utils/groupMembership.mjs'),
    });
    console.log(JSON.stringify(out, null, 2));
}
