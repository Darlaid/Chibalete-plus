/**
 * groupMembershipService.js — wrapper de I/O sobre la lógica pura de membresía.
 *
 * Sprint 021 Fase 2 — toda la lógica pura vive en `utils/groupMembership.mjs`,
 * compartida entre backend y frontend. Este archivo solo añade los wrappers
 * que dependen de Node (fs + locks cross-process).
 *
 * Por qué mantener este archivo:
 *   - server.js, scripts y tests ya importan desde aquí. Mantener el path
 *     evita un cambio en cascada por la sola reorganización.
 *   - Los wrappers de I/O (assignUserToGroup, etc.) son útiles para scripts
 *     y para futuros endpoints que no quieran replicar el patrón
 *     mutateUsers/mutateGroups manual.
 *
 * Re-exporta TODAS las helpers puras del módulo compartido. No re-implementa
 * nada — si hay que cambiar la regla de membresía, se cambia en
 * utils/groupMembership.mjs y todas las capas lo heredan.
 */

import fs from 'node:fs';
import { withFileLock } from './usersLock.js';

// Re-export PURO desde la fuente única de verdad.
// El frontend (services/dataService.ts) y metricsService.js importan
// EXACTAMENTE las mismas funciones — no hay re-implementación.
export {
    READER_ROLE,
    ERR,
    userIsLectorLike,
    addUserIdToGroup,
    removeUserIdFromGroup,
    addGroupIdToUser,
    removeGroupIdFromUser,
    getExplicitGroupMembers,
    applyLegacyColegioFallback,
    getGroupMembers,
    unionGroupMemberIds,
    resolveSingleGroupForSchool,
    validateMembershipIntegrity,
    diffIds,
    applyUserGroupsChange,
    applyGroupMembersChange,
    detachUserFromAllGroups,
    detachGroupFromAllUsers,
} from '../utils/groupMembership.mjs';

// Necesitamos las primitivas para los wrappers de I/O — re-import local.
import {
    addUserIdToGroup    as _addUserIdToGroup,
    removeUserIdFromGroup as _removeUserIdFromGroup,
    addGroupIdToUser    as _addGroupIdToUser,
    removeGroupIdFromUser as _removeGroupIdFromUser,
    ERR as _ERR,
} from '../utils/groupMembership.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);

// ────────────────────────────────────────────────────────────────────────────
// I/O wrappers — combinan las helpers puras con locks cross-process.
// Para uso desde scripts (no necesarios desde server.js, que ya tiene locks).
// ────────────────────────────────────────────────────────────────────────────

function readJsonAtomic(file) {
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, data) {
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

/**
 * Asigna un usuario a un grupo y mantiene la bidirección. Atómico across
 * api_1/api_2 vía locks. Diseñado para scripts y tests; los endpoints del
 * server pueden seguir usando los helpers puros dentro de mutateUsers/mutateGroups.
 */
export async function assignUserToGroup({ userId, groupId, GROUPS_DB, USERS_DB }) {
    if (!userId || !groupId) throw new Error('assignUserToGroup: userId y groupId obligatorios');
    if (!GROUPS_DB || !USERS_DB) throw new Error('assignUserToGroup: paths GROUPS_DB y USERS_DB obligatorios');

    let groupChanged = false;
    let userChanged  = false;

    await withFileLock(GROUPS_DB, () => {
        const groups = readJsonAtomic(GROUPS_DB);
        const g = groups.find(x => x.id === groupId);
        if (!g) throw new Error(`${_ERR.GROUP_NOT_FOUND}: ${groupId}`);
        groupChanged = _addUserIdToGroup(g, userId);
        if (groupChanged) writeJsonAtomic(GROUPS_DB, groups);
    }, 'groupsLock');

    await withFileLock(USERS_DB, () => {
        const users = readJsonAtomic(USERS_DB);
        const u = users.find(x => x.id === userId);
        if (!u) throw new Error(`${_ERR.USER_NOT_FOUND}: ${userId}`);
        userChanged = _addGroupIdToUser(u, groupId);
        if (userChanged) writeJsonAtomic(USERS_DB, users);
    }, 'usersLock');

    return { groupChanged, userChanged };
}

export async function removeUserFromGroup({ userId, groupId, GROUPS_DB, USERS_DB }) {
    if (!userId || !groupId) throw new Error('removeUserFromGroup: userId y groupId obligatorios');

    let groupChanged = false;
    let userChanged  = false;

    await withFileLock(GROUPS_DB, () => {
        const groups = readJsonAtomic(GROUPS_DB);
        const g = groups.find(x => x.id === groupId);
        if (!g) throw new Error(`${_ERR.GROUP_NOT_FOUND}: ${groupId}`);
        groupChanged = _removeUserIdFromGroup(g, userId);
        if (groupChanged) writeJsonAtomic(GROUPS_DB, groups);
    }, 'groupsLock');

    await withFileLock(USERS_DB, () => {
        const users = readJsonAtomic(USERS_DB);
        const u = users.find(x => x.id === userId);
        if (!u) return;
        userChanged = _removeGroupIdFromUser(u, groupId);
        if (userChanged) writeJsonAtomic(USERS_DB, users);
    }, 'usersLock');

    return { groupChanged, userChanged };
}

/**
 * Sincroniza la bidirección para un grupo:
 *   - todo userId que esté en group.studentIds/memberIds debe tener
 *     group.id en su user.groupIds
 *   - todo user con group.id en user.groupIds debe estar listado en
 *     group.studentIds/memberIds (si es lector)
 * Limpia orphan studentIds/memberIds (IDs de users que no existen).
 */
export async function syncGroupMembership({ groupId, GROUPS_DB, USERS_DB }) {
    let summary = { added: 0, removed: 0, orphansCleaned: 0 };

    await withFileLock(GROUPS_DB, () => {
        const groups = readJsonAtomic(GROUPS_DB);
        const users  = readJsonAtomic(USERS_DB);
        const userById = new Map(users.map(u => [u?.id, u]).filter(([id]) => id));
        const g = groups.find(x => x.id === groupId);
        if (!g) throw new Error(`${_ERR.GROUP_NOT_FOUND}: ${groupId}`);

        // 1) clean orphans
        const before = arr(g.studentIds).length + arr(g.memberIds).length;
        g.studentIds = arr(g.studentIds).filter(id => userById.has(id));
        g.memberIds  = arr(g.memberIds).filter(id => userById.has(id));
        const after  = g.studentIds.length + g.memberIds.length;
        summary.orphansCleaned = before - after;

        // 2) pull users with groupIds.includes(g.id) into the group
        for (const u of users) {
            if (arr(u.groupIds).includes(g.id)) {
                if (_addUserIdToGroup(g, u.id)) summary.added++;
            }
        }

        writeJsonAtomic(GROUPS_DB, groups);

        // 3) push group.id into user.groupIds for every member
        const targetIds = new Set([...arr(g.studentIds), ...arr(g.memberIds)]);
        let usersChanged = false;
        for (const u of users) {
            if (targetIds.has(u.id) && _addGroupIdToUser(u, g.id)) usersChanged = true;
        }
        if (usersChanged) writeJsonAtomic(USERS_DB, users);
    }, 'groupsLock');

    return summary;
}
