/**
 * utils/groupMembership.mjs — fuente única de verdad de la lógica de membresía
 * user ↔ group para Chibalete+.
 *
 * Sprint 021 Fase 2 — antes la lógica vivía duplicada en tres capas:
 *   - server/groupMembershipService.js (canónica, con I/O)
 *   - server/metricsService.js         (copia local de getGroupStudentIds)
 *   - services/dataService.ts          (implementación incompleta solo vía memberIds)
 *
 * Ahora todas las capas importan de aquí. Este módulo:
 *   - es JavaScript ESM puro (sin TypeScript, sin imports de Node)
 *   - no toca disco ni adquiere locks (helpers puros, in-memory)
 *   - corre tanto en Node como en navegador (Vite resuelve .mjs)
 *
 * Las operaciones I/O (assignUserToGroup, syncGroupMembership) viven en
 * server/groupMembershipService.js — necesitan fs y withFileLock, que no
 * existen en navegador.
 *
 * Reglas de membresía (recordatorio):
 *   - studentIds y memberIds se mantienen sincronizados — asignar a uno
 *     asigna al otro (ver addUserIdToGroup).
 *   - user.groupIds se mantiene en paralelo (relación bidireccional).
 *   - El fallback `colegio → group.school` solo se activa cuando los canales
 *     explícitos están vacíos Y la escuela tiene exactamente UN grupo.
 */

// ────────────────────────────────────────────────────────────────────────────
// Constantes públicas
// ────────────────────────────────────────────────────────────────────────────

/** El único rol que cuenta como "estudiante / lector" en Aula Viva. */
export const READER_ROLE = 'lector';

/** Códigos de error públicos del servicio (estables para clientes). */
export const ERR = Object.freeze({
    GROUP_REQUIRED:   'GROUP_REQUIRED',
    USER_NOT_FOUND:   'USER_NOT_FOUND',
    GROUP_NOT_FOUND:  'GROUP_NOT_FOUND',
    AMBIGUOUS_GROUP:  'AMBIGUOUS_GROUP',
});

// ────────────────────────────────────────────────────────────────────────────
// Internos
// ────────────────────────────────────────────────────────────────────────────

const arr  = (x) => (Array.isArray(x) ? x : []);
const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

// ────────────────────────────────────────────────────────────────────────────
// Predicados
// ────────────────────────────────────────────────────────────────────────────

/** Detecta si un usuario debe contar como lector/estudiante. */
export function userIsLectorLike(user) {
    if (!user || typeof user !== 'object') return false;
    return arr(user.roles).includes(READER_ROLE);
}

// ────────────────────────────────────────────────────────────────────────────
// Add / remove primitives — mutates input. Idempotent.
// ────────────────────────────────────────────────────────────────────────────

/** Une in-place al user en group.studentIds y group.memberIds (idempotente). */
export function addUserIdToGroup(group, userId) {
    if (!group || typeof group !== 'object' || !userId) return false;
    const sids = new Set(arr(group.studentIds));
    const mids = new Set(arr(group.memberIds));
    const before = sids.size + mids.size;
    sids.add(userId);
    mids.add(userId);
    group.studentIds = [...sids];
    group.memberIds  = [...mids];
    return (sids.size + mids.size) !== before;
}

export function removeUserIdFromGroup(group, userId) {
    if (!group || typeof group !== 'object' || !userId) return false;
    const sids = new Set(arr(group.studentIds));
    const mids = new Set(arr(group.memberIds));
    const before = sids.size + mids.size;
    sids.delete(userId);
    mids.delete(userId);
    group.studentIds = [...sids];
    group.memberIds  = [...mids];
    return (sids.size + mids.size) !== before;
}

/** Une in-place el groupId en user.groupIds (idempotente). */
export function addGroupIdToUser(user, groupId) {
    if (!user || typeof user !== 'object' || !groupId) return false;
    const set = new Set(arr(user.groupIds));
    if (set.has(groupId)) return false;
    set.add(groupId);
    user.groupIds = [...set];
    return true;
}

export function removeGroupIdFromUser(user, groupId) {
    if (!user || typeof user !== 'object' || !groupId) return false;
    const set = new Set(arr(user.groupIds));
    if (!set.has(groupId)) return false;
    set.delete(groupId);
    user.groupIds = [...set];
    return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Membership resolution — explicit channels + controlled legacy fallback.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Combina los tres canales explícitos:
 *   1. group.studentIds
 *   2. group.memberIds
 *   3. user.groupIds que apunte al group.id
 *
 * Devuelve un Set con los userIds resultantes. NO incluye el fallback por
 * `colegio` — eso lo hace `getGroupMembers` controlado por flags.
 */
export function getExplicitGroupMembers(group, users) {
    if (!group || typeof group !== 'object') return new Set();
    const ids = new Set([...arr(group.studentIds), ...arr(group.memberIds)]);
    if (Array.isArray(users)) {
        for (const u of users) {
            if (u && arr(u.groupIds).includes(group.id)) ids.add(u.id);
        }
    }
    return ids;
}

/**
 * `colegio` legacy: cuando los canales explícitos están vacíos y la escuela
 * tiene exactamente un grupo, devolvemos los lectores cuyo `user.colegio`
 * coincide. NO se activa para escuelas con múltiples grupos (no podemos
 * adivinar a cuál pertenecen).
 *
 * Devuelve { matched: Set<userId>, used: bool, reason?: string }.
 */
export function applyLegacyColegioFallback(group, users, allGroups) {
    const out = { matched: new Set(), used: false, reason: null };
    if (!group?.school || typeof group.school !== 'string') {
        out.reason = 'group has no school field';
        return out;
    }
    const schoolKey = norm(group.school);
    const peers     = (allGroups || [])
        .filter(g => g?.school && norm(g.school) === schoolKey);
    if (peers.length !== 1) {
        out.reason = `school has ${peers.length} groups (expected 1)`;
        return out;
    }
    if (!Array.isArray(users)) {
        out.reason = 'users not provided';
        return out;
    }
    for (const u of users) {
        if (!userIsLectorLike(u)) continue;
        if (typeof u.colegio !== 'string') continue;
        if (norm(u.colegio) !== schoolKey) continue;
        out.matched.add(u.id);
    }
    out.used = out.matched.size > 0;
    return out;
}

/**
 * Función primaria: lista de userIds que cuentan como miembros de un grupo.
 * Esta es la ÚNICA implementación válida — todas las capas (backend metrics,
 * frontend dataService, scripts) deben usar esta función.
 *
 * @param {object}  group       — record de groups_db
 * @param {object[]} users      — array completo de users_db
 * @param {object}  opts
 * @param {object[]} [opts.allGroups] — necesario si usas fallback legacy
 * @param {boolean} [opts.useLegacyColegioFallback=true]
 * @param {(msg: string, meta: object) => void} [opts.warnFn]
 *        — callback para emitir un warning cuando se activa el fallback.
 *
 * @returns {string[]} userIds
 */
export function getGroupMembers(group, users, opts = {}) {
    const {
        allGroups,
        useLegacyColegioFallback = true,
        warnFn = (msg, meta) => console.warn(msg, meta),
    } = opts;

    const explicit = getExplicitGroupMembers(group, users);
    if (explicit.size > 0 || !useLegacyColegioFallback) {
        return [...explicit];
    }

    const fallback = applyLegacyColegioFallback(group, users, allGroups);
    if (fallback.used) {
        warnFn('[MEMBERSHIP_FALLBACK] colegio→group fallback activated', {
            groupId: group.id,
            school:  group.school,
            count:   fallback.matched.size,
        });
        return [...fallback.matched];
    }
    return []; // explicit vacío y fallback no aplicable
}

/**
 * Devuelve la lista canónica de miembros de un grupo (union studentIds + memberIds).
 * Versión liviana usada por el diff de PUT /api/groups/:id (no aplica fallback).
 */
export function unionGroupMemberIds(group) {
    if (!group || typeof group !== 'object') return [];
    return [...new Set([...arr(group.studentIds), ...arr(group.memberIds)])];
}

// ────────────────────────────────────────────────────────────────────────────
// Resolución de grupo único — para creación/invitación con `schoolId` solo.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Si el caller solo aporta el nombre de la escuela y ésta tiene exactamente
 * UN grupo, devuelve ese groupId. Si tiene 0 o >1, devuelve null y un código
 * de error que el caller puede usar para responder al cliente.
 */
export function resolveSingleGroupForSchool(schoolNameOrSlug, groups) {
    if (!schoolNameOrSlug) return { groupId: null, error: ERR.GROUP_REQUIRED };
    const key = norm(schoolNameOrSlug);
    const matches = (groups || []).filter(g => g?.school && norm(g.school) === key);
    if (matches.length === 0) return { groupId: null, error: ERR.GROUP_REQUIRED };
    if (matches.length > 1)   return { groupId: null, error: ERR.AMBIGUOUS_GROUP };
    return { groupId: matches[0].id, error: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Validador de integridad
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validador de integridad. Devuelve { issues: [...], counts: {...} }.
 * Tipos de issue:
 *   - 'orphan_studentId'    studentId no resuelve a un user
 *   - 'orphan_memberId'     memberId no resuelve a un user
 *   - 'orphan_userGroupId'  user.groupIds apunta a group inexistente
 *   - 'lector_without_group' user lector sin user.groupIds y sin estar en
 *                            ningún group.studentIds/memberIds
 *   - 'studentMember_divergence' studentIds y memberIds difieren en >0 ids
 *   - 'school_with_users_no_group' colegio con lectores pero sin grupo
 */
export function validateMembershipIntegrity(users, groups) {
    const issues = [];
    const userById  = new Map((users  || []).map(u => [u?.id, u]).filter(([id]) => id));
    const groupById = new Map((groups || []).map(g => [g?.id, g]).filter(([id]) => id));
    const groupsBySchool = new Map();
    for (const g of groups || []) {
        if (!g?.school) continue;
        const k = norm(g.school);
        if (!groupsBySchool.has(k)) groupsBySchool.set(k, []);
        groupsBySchool.get(k).push(g);
    }

    // 1) orphan studentIds / memberIds
    for (const g of groups || []) {
        if (!g?.id) continue;
        for (const id of arr(g.studentIds)) {
            if (!userById.has(id)) issues.push({ type: 'orphan_studentId', groupId: g.id, userId: id });
        }
        for (const id of arr(g.memberIds)) {
            if (!userById.has(id)) issues.push({ type: 'orphan_memberId', groupId: g.id, userId: id });
        }
        // 2) studentIds vs memberIds divergence
        const sset = new Set(arr(g.studentIds));
        const mset = new Set(arr(g.memberIds));
        const onlyInS = [...sset].filter(x => !mset.has(x));
        const onlyInM = [...mset].filter(x => !sset.has(x));
        if (onlyInS.length || onlyInM.length) {
            issues.push({
                type:    'studentMember_divergence',
                groupId: g.id,
                onlyInStudentIds: onlyInS,
                onlyInMemberIds:  onlyInM,
            });
        }
    }

    // 3) orphan user.groupIds
    // 4) lector sin grupo
    const userInGroupIndex = new Set();
    for (const g of groups || []) {
        for (const id of arr(g.studentIds)) userInGroupIndex.add(id);
        for (const id of arr(g.memberIds))  userInGroupIndex.add(id);
    }
    for (const u of users || []) {
        if (!u?.id) continue;
        for (const gid of arr(u.groupIds)) {
            if (!groupById.has(gid)) {
                issues.push({ type: 'orphan_userGroupId', userId: u.id, groupId: gid });
            }
        }
        if (userIsLectorLike(u)) {
            const hasOwnGroup  = arr(u.groupIds).length > 0;
            const isMember     = userInGroupIndex.has(u.id);
            if (!hasOwnGroup && !isMember) {
                issues.push({ type: 'lector_without_group', userId: u.id, colegio: u.colegio || null });
            }
        }
    }

    // 5) escuelas con lectores pero sin grupo
    const lectoresByColegio = new Map();
    for (const u of users || []) {
        if (!userIsLectorLike(u) || typeof u.colegio !== 'string') continue;
        const k = norm(u.colegio);
        if (!lectoresByColegio.has(k)) lectoresByColegio.set(k, 0);
        lectoresByColegio.set(k, lectoresByColegio.get(k) + 1);
    }
    for (const [school, n] of lectoresByColegio.entries()) {
        if (!groupsBySchool.has(school)) {
            issues.push({ type: 'school_with_users_no_group', school, lectorCount: n });
        }
    }

    return {
        issues,
        counts: issues.reduce((acc, i) => {
            acc[i.type] = (acc[i.type] || 0) + 1;
            return acc;
        }, {}),
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Sprint 021 Fase 1 — pure delta helpers para endpoints PUT/DELETE/join.
// ────────────────────────────────────────────────────────────────────────────

/** Diff entre dos arrays de IDs. Devuelve { added, removed }. */
export function diffIds(oldIds, newIds) {
    const oldArr = Array.isArray(oldIds) ? oldIds : [];
    const newArr = Array.isArray(newIds) ? newIds : [];
    const oldSet = new Set(oldArr);
    const newSet = new Set(newArr);
    return {
        added:   [...newSet].filter(x => !oldSet.has(x)),
        removed: [...oldSet].filter(x => !newSet.has(x)),
    };
}

/**
 * Aplica un cambio en `user.groupIds` al array de groups in-memory.
 * Para cada gid añadido: addUserIdToGroup. Para cada removido: removeUserIdFromGroup.
 * Mutates `groups`. Devuelve { addedTo, removedFrom, missingGroupIds, touched }.
 */
export function applyUserGroupsChange(groups, userId, addedGroupIds, removedGroupIds) {
    const out = { addedTo: [], removedFrom: [], missingGroupIds: [], touched: false };
    for (const gid of arr(addedGroupIds)) {
        const g = (groups || []).find(x => x?.id === gid);
        if (!g) { out.missingGroupIds.push(gid); continue; }
        if (addUserIdToGroup(g, userId)) { out.addedTo.push(gid); out.touched = true; }
    }
    for (const gid of arr(removedGroupIds)) {
        const g = (groups || []).find(x => x?.id === gid);
        if (!g) { out.missingGroupIds.push(gid); continue; }
        if (removeUserIdFromGroup(g, userId)) { out.removedFrom.push(gid); out.touched = true; }
    }
    return out;
}

/**
 * Aplica un cambio en `group.memberIds`/`studentIds` al array de users in-memory.
 * Para cada uid añadido: addGroupIdToUser. Para cada removido: removeGroupIdFromUser.
 * Mutates `users`. Devuelve { addedTo, removedFrom, missingUserIds, touched }.
 */
export function applyGroupMembersChange(users, groupId, addedUserIds, removedUserIds) {
    const out = { addedTo: [], removedFrom: [], missingUserIds: [], touched: false };
    for (const uid of arr(addedUserIds)) {
        const u = (users || []).find(x => x?.id === uid);
        if (!u) { out.missingUserIds.push(uid); continue; }
        if (addGroupIdToUser(u, groupId)) { out.addedTo.push(uid); out.touched = true; }
    }
    for (const uid of arr(removedUserIds)) {
        const u = (users || []).find(x => x?.id === uid);
        if (!u) { out.missingUserIds.push(uid); continue; }
        if (removeGroupIdFromUser(u, groupId)) { out.removedFrom.push(uid); out.touched = true; }
    }
    return out;
}

/**
 * Quita un userId de studentIds y memberIds en TODOS los grupos.
 * Usado al borrar un user. Mutates `groups`. Devuelve la lista de groupIds tocados.
 */
export function detachUserFromAllGroups(groups, userId) {
    const detached = [];
    for (const g of groups || []) {
        if (removeUserIdFromGroup(g, userId)) detached.push(g.id);
    }
    return detached;
}

/**
 * Quita un groupId de groupIds en TODOS los users.
 * Usado al borrar un grupo. Mutates `users`. Devuelve la lista de userIds tocados.
 */
export function detachGroupFromAllUsers(users, groupId) {
    const detached = [];
    for (const u of users || []) {
        if (removeGroupIdFromUser(u, groupId)) detached.push(u.id);
    }
    return detached;
}
