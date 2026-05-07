/**
 * groupMembershipService.test.js — pruebas del servicio central de membresías.
 *
 * Cómo correr (sin framework, solo Node):
 *   node server/__test__/groupMembershipService.test.js
 *
 * Cubre:
 *   1. addUserIdToGroup es idempotente y mantiene studentIds = memberIds
 *   2. addGroupIdToUser es idempotente
 *   3. getExplicitGroupMembers une los 3 canales (studentIds, memberIds, user.groupIds)
 *   4. applyLegacyColegioFallback solo se activa si school tiene 1 grupo
 *   5. getGroupMembers prefiere canales explícitos; usa fallback si vacío
 *   6. resolveSingleGroupForSchool — tres casos: 0, 1, multi
 *   7. validateMembershipIntegrity detecta cada tipo de issue
 */

import {
    addUserIdToGroup,
    addGroupIdToUser,
    removeUserIdFromGroup,
    removeGroupIdFromUser,
    getExplicitGroupMembers,
    applyLegacyColegioFallback,
    getGroupMembers,
    resolveSingleGroupForSchool,
    validateMembershipIntegrity,
    userIsLectorLike,
    diffIds,
    applyUserGroupsChange,
    applyGroupMembersChange,
    detachUserFromAllGroups,
    detachGroupFromAllUsers,
    unionGroupMemberIds,
    ERR,
} from '../groupMembershipService.js';

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function setEq(a, b) {
    const A = new Set(a), B = new Set(b);
    if (A.size !== B.size) return false;
    for (const x of A) if (!B.has(x)) return false;
    return true;
}

console.log('groupMembershipService — tests');

// 1. addUserIdToGroup idempotente y sincronizado
{
    const g = { id: 'g1', studentIds: [], memberIds: [] };
    ok('addUserIdToGroup new returns true', addUserIdToGroup(g, 'u1') === true);
    ok('addUserIdToGroup duplicate returns false', addUserIdToGroup(g, 'u1') === false);
    ok('studentIds == memberIds after add', setEq(g.studentIds, g.memberIds));
    ok('user added once', g.studentIds.length === 1 && g.studentIds[0] === 'u1');
    addUserIdToGroup(g, 'u2');
    ok('two users present', setEq(g.studentIds, ['u1', 'u2']));
    removeUserIdFromGroup(g, 'u1');
    ok('remove drops both arrays in sync', setEq(g.studentIds, ['u2']) && setEq(g.memberIds, ['u2']));
}

// 2. addGroupIdToUser idempotente
{
    const u = { id: 'u1' };
    ok('addGroupIdToUser new returns true', addGroupIdToUser(u, 'g1') === true);
    ok('addGroupIdToUser dup returns false', addGroupIdToUser(u, 'g1') === false);
    ok('user.groupIds correct', setEq(u.groupIds, ['g1']));
    removeGroupIdFromUser(u, 'g1');
    ok('remove leaves empty', u.groupIds.length === 0);
}

// 3. getExplicitGroupMembers une 3 canales
{
    const g = { id: 'g1', studentIds: ['u1'], memberIds: ['u2'] };
    const users = [
        { id: 'u3', groupIds: ['g1'] },
        { id: 'u4', groupIds: ['gOther'] },
    ];
    const members = getExplicitGroupMembers(g, users);
    ok('union of three channels', setEq([...members], ['u1', 'u2', 'u3']));
}

// 4. applyLegacyColegioFallback — solo single-group school
{
    const g = { id: 'g1', school: 'Villas' };
    const users = [
        { id: 'u1', colegio: 'Villas',  roles: ['lector'] },
        { id: 'u2', colegio: 'Villas',  roles: ['lector'] },
        { id: 'u3', colegio: 'Villas',  roles: ['mediador'] },   // NO incluye, no es lector
        { id: 'u4', colegio: 'Otra',    roles: ['lector'] },
    ];
    const groupsSingle = [g];
    const r1 = applyLegacyColegioFallback(g, users, groupsSingle);
    ok('single-group school: fallback used', r1.used === true);
    ok('single-group school: 2 lectores',   setEq([...r1.matched], ['u1', 'u2']));

    const groupsMulti = [g, { id: 'g2', school: 'Villas' }];
    const r2 = applyLegacyColegioFallback(g, users, groupsMulti);
    ok('multi-group school: fallback NOT used', r2.used === false);
    ok('multi-group school: matched empty',     r2.matched.size === 0);
}

// 5. getGroupMembers — explicit wins, fallback as last resort
{
    const g = { id: 'g1', school: 'Villas', studentIds: ['u9'] };
    const users = [
        { id: 'u9', colegio: 'X', roles: ['lector'] },
        { id: 'u8', colegio: 'Villas', roles: ['lector'] },
    ];
    const groups = [g];
    let warnCalls = 0;
    const result = getGroupMembers(g, users, { allGroups: groups, warnFn: () => warnCalls++ });
    ok('explicit channel wins: returns u9 only', setEq(result, ['u9']));
    ok('no warn when explicit channel had data', warnCalls === 0);

    const gEmpty = { id: 'g2', school: 'Villas', studentIds: [], memberIds: [] };
    const result2 = getGroupMembers(gEmpty, users, { allGroups: [gEmpty], warnFn: () => warnCalls++ });
    ok('fallback returns u8 when explicit empty', setEq(result2, ['u8']));
    ok('warn emitted on fallback', warnCalls === 1);

    const result3 = getGroupMembers(gEmpty, users, {
        allGroups: [gEmpty],
        useLegacyColegioFallback: false,
        warnFn: () => warnCalls++,
    });
    ok('fallback can be disabled by flag', result3.length === 0 && warnCalls === 1);
}

// 6. resolveSingleGroupForSchool
{
    const groups = [
        { id: 'g1', school: 'Villas' },
        { id: 'g2', school: 'Otro' },
        { id: 'g3', school: 'Otro' },
    ];
    ok('single → returns id', resolveSingleGroupForSchool('Villas', groups).groupId === 'g1');
    ok('multi → AMBIGUOUS_GROUP', resolveSingleGroupForSchool('Otro', groups).error === ERR.AMBIGUOUS_GROUP);
    ok('zero → GROUP_REQUIRED',  resolveSingleGroupForSchool('Inexistente', groups).error === ERR.GROUP_REQUIRED);
    ok('case-insensitive match',  resolveSingleGroupForSchool('  villas  ', groups).groupId === 'g1');
}

// 7. validateMembershipIntegrity detecta cada tipo de issue
{
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] },
        { id: 'u2', roles: ['lector'], colegio: 'Villas', groupIds: ['gNoExiste'] }, // orphan_userGroupId
        { id: 'u3', roles: ['lector'], colegio: 'Villas' },                          // lector_without_group
    ];
    const groups = [
        { id: 'g1', school: 'Villas', studentIds: ['u1', 'uOrphan'], memberIds: ['u1'] }, // orphan + divergence
    ];
    const r = validateMembershipIntegrity(users, groups);
    const types = new Set(r.issues.map(i => i.type));
    ok('detecta orphan_studentId',     types.has('orphan_studentId'));
    ok('detecta orphan_userGroupId',   types.has('orphan_userGroupId'));
    ok('detecta lector_without_group', types.has('lector_without_group'));
    ok('detecta studentMember_divergence', types.has('studentMember_divergence'));
}

// 8. userIsLectorLike
{
    ok('lector → true',     userIsLectorLike({ roles: ['lector'] }));
    ok('mediador → false',  !userIsLectorLike({ roles: ['mediador'] }));
    ok('admin → false',     !userIsLectorLike({ roles: ['administrador'] }));
    ok('null user → false', !userIsLectorLike(null));
    ok('no roles → false',  !userIsLectorLike({ id: 'x' }));
}

// ────────────────────────────────────────────────────────────────────────────
// Sprint 021 — helpers de diff/detach usados por los endpoints PUT/DELETE/join.
// ────────────────────────────────────────────────────────────────────────────

// 9. diffIds
{
    const d1 = diffIds(['a', 'b'], ['b', 'c']);
    ok('diffIds added',   setEq(d1.added,   ['c']));
    ok('diffIds removed', setEq(d1.removed, ['a']));
    const d2 = diffIds(null, ['x']);
    ok('diffIds null oldIds',  setEq(d2.added, ['x']) && d2.removed.length === 0);
    const d3 = diffIds(['x'], null);
    ok('diffIds null newIds',  setEq(d3.removed, ['x']) && d3.added.length === 0);
    const d4 = diffIds(['a', 'a', 'b'], ['b', 'c', 'c']);
    ok('diffIds dedupes',  setEq(d4.added, ['c']) && setEq(d4.removed, ['a']));
}

// 10. unionGroupMemberIds
{
    const g1 = { id: 'g', studentIds: ['u1'], memberIds: ['u2'] };
    ok('union de studentIds + memberIds', setEq(unionGroupMemberIds(g1), ['u1', 'u2']));
    ok('union sin grupo → []',            unionGroupMemberIds(null).length === 0);
}

// 11. applyUserGroupsChange — añade y quita el user en los grupos correctos
{
    const groups = [
        { id: 'g1', studentIds: ['u1'], memberIds: ['u1'] },
        { id: 'g2', studentIds: [],     memberIds: [] },
    ];
    const r = applyUserGroupsChange(groups, 'u1', ['g2'], ['g1']);
    ok('apply: addedTo correcto',   setEq(r.addedTo,   ['g2']));
    ok('apply: removedFrom correcto', setEq(r.removedFrom, ['g1']));
    ok('apply: g1 ya no contiene u1', !groups[0].memberIds.includes('u1') && !groups[0].studentIds.includes('u1'));
    ok('apply: g2 ahora contiene u1', groups[1].memberIds.includes('u1') && groups[1].studentIds.includes('u1'));
    ok('apply: touched=true',        r.touched === true);
}

// 12. applyUserGroupsChange — gid inexistente → missingGroupIds
{
    const groups = [{ id: 'g1', studentIds: [], memberIds: [] }];
    const r = applyUserGroupsChange(groups, 'u1', ['gNoExiste'], []);
    ok('apply: gid inexistente registrado', setEq(r.missingGroupIds, ['gNoExiste']));
    ok('apply: addedTo vacío',              r.addedTo.length === 0);
    ok('apply: touched=false',              r.touched === false);
}

// 13. applyGroupMembersChange — espejo del anterior
{
    const users = [
        { id: 'u1', groupIds: ['g1'] },
        { id: 'u2', groupIds: [] },
    ];
    const r = applyGroupMembersChange(users, 'g1', ['u2'], ['u1']);
    ok('group→users: addedTo correcto',     setEq(r.addedTo,     ['u2']));
    ok('group→users: removedFrom correcto', setEq(r.removedFrom, ['u1']));
    ok('group→users: u1 sin g1', !(users[0].groupIds || []).includes('g1'));
    ok('group→users: u2 con g1',  (users[1].groupIds || []).includes('g1'));
}

// 14. applyGroupMembersChange — uid inexistente
{
    const users = [{ id: 'u1', groupIds: [] }];
    const r = applyGroupMembersChange(users, 'g1', ['uNoExiste'], []);
    ok('group→users: missingUserIds registrado', setEq(r.missingUserIds, ['uNoExiste']));
    ok('group→users: touched=false',             r.touched === false);
}

// 15. detachUserFromAllGroups
{
    const groups = [
        { id: 'g1', studentIds: ['u1', 'u2'], memberIds: ['u1', 'u2'] },
        { id: 'g2', studentIds: ['u1'],       memberIds: ['u1'] },
        { id: 'g3', studentIds: ['u2'],       memberIds: ['u2'] },
    ];
    const detached = detachUserFromAllGroups(groups, 'u1');
    ok('detachUser: grupos correctos',       setEq(detached, ['g1', 'g2']));
    ok('detachUser: g1 ya no incluye u1',    !groups[0].memberIds.includes('u1'));
    ok('detachUser: g2 ya no incluye u1',    !groups[1].memberIds.includes('u1'));
    ok('detachUser: g3 intacto',             setEq(groups[2].memberIds, ['u2']));
}

// 16. detachGroupFromAllUsers
{
    const users = [
        { id: 'u1', groupIds: ['g1', 'g2'] },
        { id: 'u2', groupIds: ['g1'] },
        { id: 'u3', groupIds: ['g2'] },
    ];
    const detached = detachGroupFromAllUsers(users, 'g1');
    ok('detachGroup: users correctos',         setEq(detached, ['u1', 'u2']));
    ok('detachGroup: u1 ya no incluye g1',     !(users[0].groupIds || []).includes('g1'));
    ok('detachGroup: u2 ya no incluye g1',     !(users[1].groupIds || []).includes('g1'));
    ok('detachGroup: u3 intacto',              setEq(users[2].groupIds, ['g2']));
}

console.log('');
console.log(`groupMembershipService — pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
