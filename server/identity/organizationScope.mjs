/**
 * organizationScope.mjs — CHP-ID-GROUPS-RECON-01B.
 *
 * Contrato institucional canónico. `organizationId` es la ÚNICA autoridad de
 * organización; `schoolId` no se lee ni se escribe en ninguna parte del
 * runtime, y el nombre del colegio (`group.school` / `user.colegio`) NUNCA
 * concede scope.
 *
 * ── Por qué no hay campo nuevo ──────────────────────────────────────────────
 * La clasificación operativa se DERIVA de contratos que ya existen, en vez de
 * abrir una segunda base de autoridad paralela o una lista de nombres:
 *
 *   ACTIVE_REAL              group.organizationId presente Y registrado en
 *                            schools_db.
 *   SYNTHETIC_OUT_OF_SCOPE   el grupo tiene miembros y TODOS los que resuelven
 *                            en el padrón llevan `_loadtest_marker` (el marcador
 *                            sintético que ya usan los usuarios de carga).
 *   HISTORICAL_OUT_OF_SCOPE  todo lo demás: sin organizationId, o con uno que
 *                            no está registrado, o sin `id` estructural.
 *
 * Consecuencias buscadas: un grupo histórico no puede adquirir scope por
 * coincidencia textual (haría falta registrar la institución Y ponerle el
 * organizationId), y un grupo sintético no aparece en el scope real aunque
 * alguien registrara `lt-org`… salvo que sus miembros dejen de ser sintéticos,
 * que es exactamente el criterio que queremos.
 *
 * Este módulo es PURO: no abre archivos, no muta nada, no lanza.
 */

/** Clasificación operativa de un grupo frente al scope institucional. */
export const GROUP_CLASS = Object.freeze({
    ACTIVE_REAL:             'ACTIVE_REAL',
    HISTORICAL_OUT_OF_SCOPE: 'HISTORICAL_OUT_OF_SCOPE',
    SYNTHETIC_OUT_OF_SCOPE:  'SYNTHETIC_OUT_OF_SCOPE',
});

/** Motivos tipificados de denegación institucional (sin PII). */
export const SCOPE_REASON = Object.freeze({
    ORGANIZATION_NOT_REGISTERED: 'ORGANIZATION_NOT_REGISTERED',
    GROUP_HISTORICAL:            'GROUP_HISTORICAL',
    GROUP_SYNTHETIC:             'GROUP_SYNTHETIC',
    ORGANIZATION_MISMATCH:       'ORGANIZATION_MISMATCH',
    GROUP_NOT_IN_ACTIVE_SCOPE:   'GROUP_NOT_IN_ACTIVE_SCOPE',
});

const arr = (x) => (Array.isArray(x) ? x : []);

/**
 * Ids de organización REGISTRADOS. Solo estos pueden conceder scope.
 * @param {object[]} schools contenido de schools_db.json
 * @returns {Set<string>}
 */
export function registeredOrganizationIds(schools) {
    const out = new Set();
    for (const s of arr(schools)) {
        if (s && typeof s.id === 'string' && s.id.trim()) out.add(s.id.trim());
    }
    return out;
}

/** Marcador sintético ya existente en el padrón de usuarios. */
export function isSyntheticUser(user) {
    return !!(user && user._loadtest_marker);
}

/**
 * Miembros declarados de un grupo por los canales explícitos del propio grupo.
 * NO incluye el fallback por nombre de colegio: ese camino es textual y no
 * puede participar en decisiones de scope.
 */
export function declaredMemberIds(group) {
    return [...new Set([...arr(group?.memberIds), ...arr(group?.studentIds)])];
}

/**
 * Un grupo es sintético si tiene miembros y todos los que resuelven en el
 * padrón son sintéticos. Un grupo vacío NUNCA es sintético (sería vacuamente
 * cierto): cae en histórico.
 */
export function isSyntheticGroup(group, usersById) {
    const ids = declaredMemberIds(group);
    if (ids.length === 0) return false;
    let resolved = 0;
    for (const id of ids) {
        const u = usersById?.get?.(id);
        if (!u) continue;
        resolved++;
        if (!isSyntheticUser(u)) return false;
    }
    return resolved > 0;
}

/**
 * Clasifica un grupo. `usersById` es opcional: sin él no se puede distinguir
 * sintético de histórico, y se devuelve histórico (fail-closed hacia fuera del
 * scope, nunca hacia dentro).
 *
 * @returns {{ class: string, organizationId: string|null, reason: string|null }}
 */
export function classifyGroup(group, { registeredOrgIds, usersById } = {}) {
    const registered = registeredOrgIds instanceof Set ? registeredOrgIds : new Set();

    if (!group || typeof group !== 'object' || typeof group.id !== 'string' || !group.id) {
        // Sin id estructural no hay clave estable: nunca puede sostener scope.
        return { class: GROUP_CLASS.HISTORICAL_OUT_OF_SCOPE, organizationId: null,
                 reason: SCOPE_REASON.GROUP_HISTORICAL };
    }

    const org = typeof group.organizationId === 'string' && group.organizationId.trim()
        ? group.organizationId.trim() : null;

    if (org && registered.has(org)) {
        return { class: GROUP_CLASS.ACTIVE_REAL, organizationId: org, reason: null };
    }

    if (usersById && isSyntheticGroup(group, usersById)) {
        return { class: GROUP_CLASS.SYNTHETIC_OUT_OF_SCOPE, organizationId: org,
                 reason: SCOPE_REASON.GROUP_SYNTHETIC };
    }

    return {
        class: GROUP_CLASS.HISTORICAL_OUT_OF_SCOPE,
        organizationId: org,
        // Distinguimos "declara una organización que nadie registró" de "no
        // declara ninguna": ayuda a diagnosticar sin exponer datos.
        reason: org ? SCOPE_REASON.ORGANIZATION_NOT_REGISTERED : SCOPE_REASON.GROUP_HISTORICAL,
    };
}

/** true solo si el grupo puede sostener scope institucional. */
export function isActiveRealGroup(group, ctx) {
    return classifyGroup(group, ctx).class === GROUP_CLASS.ACTIVE_REAL;
}

/**
 * organizationId efectivo de un grupo, o null si el grupo no está en scope.
 * Nunca deriva la organización de `group.school`.
 */
export function activeOrganizationIdOf(group, ctx) {
    const c = classifyGroup(group, ctx);
    return c.class === GROUP_CLASS.ACTIVE_REAL ? c.organizationId : null;
}

/**
 * Resumen agregado por clase. Para diagnóstico y reportes; sin PII.
 * @returns {{ACTIVE_REAL:number, HISTORICAL_OUT_OF_SCOPE:number, SYNTHETIC_OUT_OF_SCOPE:number}}
 */
export function summarizeGroups(groups, ctx) {
    const tally = {
        [GROUP_CLASS.ACTIVE_REAL]: 0,
        [GROUP_CLASS.HISTORICAL_OUT_OF_SCOPE]: 0,
        [GROUP_CLASS.SYNTHETIC_OUT_OF_SCOPE]: 0,
    };
    for (const g of arr(groups)) tally[classifyGroup(g, ctx).class]++;
    return tally;
}
