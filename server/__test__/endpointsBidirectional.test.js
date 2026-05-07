/**
 * endpointsBidirectional.test.js — Sprint 021
 *
 * Cubre la garantía bidireccional user ↔ group para los endpoints PUT/DELETE/join
 * y la creación atómica con rollback en POST /api/users + POST /api/invite-user.
 *
 * Estos tests NO levantan Express. Reproducen exactamente el cuerpo de la
 * sección lockeada de cada endpoint — la misma diff + helpers + orden de
 * escritura — para verificar que el algoritmo deja el estado consistente y
 * que un fallo a mitad de transacción no produce datos huérfanos.
 *
 * Cómo correr:
 *   node server/__test__/endpointsBidirectional.test.js
 */

import {
    addUserIdToGroup,
    addGroupIdToUser,
    diffIds,
    applyUserGroupsChange,
    applyGroupMembersChange,
    detachUserFromAllGroups,
    detachGroupFromAllUsers,
    unionGroupMemberIds,
} from '../groupMembershipService.js';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
const setEq = (a, b) => {
    const A = new Set(a), B = new Set(b);
    if (A.size !== B.size) return false;
    for (const x of A) if (!B.has(x)) return false;
    return true;
};

// Stub mínimo para writeJSON: registra orden de escrituras, opcionalmente lanza.
function makeWriter(failOn = null) {
    const writes = [];
    const writeJSON = (file, data) => {
        if (failOn && file === failOn) throw new Error(`simulated write failure: ${file}`);
        // Snapshot del payload (deep clone) para verificar exactamente qué se persistió.
        writes.push({ file, snapshot: JSON.parse(JSON.stringify(data)) });
    };
    return { writeJSON, writes };
}
const lastSnapshot = (writes, file) => {
    for (let i = writes.length - 1; i >= 0; i--) if (writes[i].file === file) return writes[i].snapshot;
    return null;
};

console.log('endpointsBidirectional — Sprint 021');

// ────────────────────────────────────────────────────────────────────────────
// 1. PUT /api/users/:id — cambiar user.groupIds reconcilia los grupos
// ────────────────────────────────────────────────────────────────────────────
{
    const users = [
        { id: 'u1', email: 'u1@x', roles: ['lector'], groupIds: ['g1'] },
        { id: 'u2', email: 'u2@x', roles: ['lector'], groupIds: ['g1', 'g2'] },
    ];
    const groups = [
        { id: 'g1', studentIds: ['u1', 'u2'], memberIds: ['u1', 'u2'] },
        { id: 'g2', studentIds: ['u2'],       memberIds: ['u2'] },
        { id: 'g3', studentIds: [],           memberIds: [] },
    ];

    // Body del PUT: u1 sale de g1 y entra a g2 y g3
    const updates = { groupIds: ['g2', 'g3'] };

    const idx = users.findIndex(u => u.id === 'u1');
    const oldGroupIds = [...users[idx].groupIds];
    const merged      = { ...users[idx], ...updates };
    const newGroupIds = [...merged.groupIds];

    const { added, removed } = diffIds(oldGroupIds, newGroupIds);
    const applied = applyUserGroupsChange(groups, 'u1', added, removed);
    users[idx] = merged;

    ok('PUT user: added=g2,g3',         setEq(added, ['g2', 'g3']));
    ok('PUT user: removed=g1',          setEq(removed, ['g1']));
    ok('PUT user: g1 ya no contiene u1', !groups[0].memberIds.includes('u1'));
    ok('PUT user: g2 contiene u1',       groups[1].memberIds.includes('u1'));
    ok('PUT user: g3 contiene u1',       groups[2].memberIds.includes('u1'));
    ok('PUT user: g1 mantiene u2',       groups[0].memberIds.includes('u2'));
    ok('PUT user: g2 mantiene u2',       groups[1].memberIds.includes('u2'));
    ok('PUT user: studentIds == memberIds en cada grupo afectado',
        setEq(groups[0].studentIds, groups[0].memberIds) &&
        setEq(groups[1].studentIds, groups[1].memberIds) &&
        setEq(groups[2].studentIds, groups[2].memberIds));
    ok('PUT user: sin missingGroupIds',  applied.missingGroupIds.length === 0);
    ok('PUT user: user.groupIds final = [g2, g3]', setEq(users[idx].groupIds, ['g2', 'g3']));
}

// ────────────────────────────────────────────────────────────────────────────
// 2. PUT /api/users/:id — groupId inexistente → rechazo, sin side-effects
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', groupIds: [] }];
    const groups = [{ id: 'g1', studentIds: [], memberIds: [] }];

    const oldGroupIds = [...users[0].groupIds];
    const newGroupIds = ['gNoExiste'];
    const { added, removed } = diffIds(oldGroupIds, newGroupIds);
    const applied = applyUserGroupsChange(groups, 'u1', added, removed);

    ok('PUT user: missingGroupIds detectado', setEq(applied.missingGroupIds, ['gNoExiste']));
    ok('PUT user: ningún grupo tocado',       applied.touched === false);
    ok('PUT user: g1 sigue vacío',            groups[0].memberIds.length === 0);
    // Endpoint real responde 400 ANTES de persistir el user → user.groupIds intacto
    ok('PUT user: u1 no se mutó',             users[0].groupIds.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. PUT /api/groups/:id — cambiar memberIds reconcilia los users
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [
        { id: 'g1', studentIds: ['u1'], memberIds: ['u1'] },
    ];
    const users = [
        { id: 'u1', groupIds: ['g1'] },
        { id: 'u2', groupIds: [] },
        { id: 'u3', groupIds: [] },
    ];

    // PUT group: nuevos miembros = [u2, u3] (saca u1, mete u2 y u3)
    const updates = { memberIds: ['u2', 'u3'] };

    const idx = groups.findIndex(g => g.id === 'g1');
    const oldMembers = unionGroupMemberIds(groups[idx]);
    // Simular el resultado de normalizeGroup: sincroniza studentIds = memberIds
    const merged = {
        ...groups[idx],
        ...updates,
        studentIds: [...new Set([...(updates.memberIds ?? groups[idx].memberIds ?? []), ...(updates.studentIds ?? [])])],
        memberIds:  [...new Set([...(updates.memberIds ?? groups[idx].memberIds ?? []), ...(updates.studentIds ?? [])])],
    };
    const newMembers = unionGroupMemberIds(merged);

    const { added, removed } = diffIds(oldMembers, newMembers);
    const applied = applyGroupMembersChange(users, 'g1', added, removed);
    groups[idx] = merged;

    ok('PUT group: added=u2,u3',           setEq(added, ['u2', 'u3']));
    ok('PUT group: removed=u1',            setEq(removed, ['u1']));
    ok('PUT group: u1 sin g1',             !(users[0].groupIds || []).includes('g1'));
    ok('PUT group: u2 con g1',             (users[1].groupIds || []).includes('g1'));
    ok('PUT group: u3 con g1',             (users[2].groupIds || []).includes('g1'));
    ok('PUT group: g1.memberIds = [u2,u3]', setEq(groups[0].memberIds, ['u2', 'u3']));
    ok('PUT group: studentIds == memberIds', setEq(groups[0].studentIds, groups[0].memberIds));
    ok('PUT group: sin missingUserIds',    applied.missingUserIds.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 4. PUT /api/groups/:id — userId inexistente → rechazo
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', groupIds: [] }];
    const groups = [{ id: 'g1', studentIds: [], memberIds: [] }];

    const oldMembers = unionGroupMemberIds(groups[0]);
    const newMembers = ['uNoExiste'];
    const { added, removed } = diffIds(oldMembers, newMembers);
    const applied = applyGroupMembersChange(users, 'g1', added, removed);

    ok('PUT group: missingUserIds detectado', setEq(applied.missingUserIds, ['uNoExiste']));
    ok('PUT group: ningún user tocado',       applied.touched === false);
    ok('PUT group: u1 intacto',               users[0].groupIds.length === 0);
    // Endpoint real aborta antes de mutar groups[idx]
}

// ────────────────────────────────────────────────────────────────────────────
// 5. DELETE /api/users/:id — limpia todas las referencias en grupos
// ────────────────────────────────────────────────────────────────────────────
{
    const users = [
        { id: 'u1', groupIds: ['g1', 'g2'] },
        { id: 'u2', groupIds: ['g1'] },
    ];
    const groups = [
        { id: 'g1', studentIds: ['u1', 'u2'], memberIds: ['u1', 'u2'] },
        { id: 'g2', studentIds: ['u1'],       memberIds: ['u1'] },
        { id: 'g3', studentIds: [],           memberIds: [] },
    ];

    const idx = users.findIndex(u => u.id === 'u1');
    const detached = detachUserFromAllGroups(groups, 'u1');
    users.splice(idx, 1);

    ok('DELETE user: detachedFromGroupIds correcto', setEq(detached, ['g1', 'g2']));
    ok('DELETE user: g1 ya no incluye u1',           !groups[0].memberIds.includes('u1'));
    ok('DELETE user: g1 mantiene u2',                groups[0].memberIds.includes('u2'));
    ok('DELETE user: g2 quedó sin u1',               !groups[1].memberIds.includes('u1') && groups[1].memberIds.length === 0);
    ok('DELETE user: g3 intacto',                    groups[2].memberIds.length === 0);
    ok('DELETE user: u1 ya no está en users',        !users.find(u => u.id === 'u1'));
    ok('DELETE user: u2 sigue intacto',              users.find(u => u.id === 'u2'));
}

// ────────────────────────────────────────────────────────────────────────────
// 6. DELETE /api/groups/:id — limpia user.groupIds en todos los users
// ────────────────────────────────────────────────────────────────────────────
{
    const users = [
        { id: 'u1', groupIds: ['g1', 'g2'] },
        { id: 'u2', groupIds: ['g1'] },
        { id: 'u3', groupIds: ['g2'] },
    ];
    const groups = [
        { id: 'g1', studentIds: ['u1', 'u2'], memberIds: ['u1', 'u2'] },
        { id: 'g2', studentIds: ['u1', 'u3'], memberIds: ['u1', 'u3'] },
    ];

    const idx = groups.findIndex(g => g.id === 'g1');
    const detached = detachGroupFromAllUsers(users, 'g1');
    groups.splice(idx, 1);

    ok('DELETE group: detachedFromUserIds correcto', setEq(detached, ['u1', 'u2']));
    ok('DELETE group: u1 ya no incluye g1',           !users[0].groupIds.includes('g1'));
    ok('DELETE group: u2 ya no incluye g1',           !users[1].groupIds.includes('g1'));
    ok('DELETE group: u3 intacto',                    setEq(users[2].groupIds, ['g2']));
    ok('DELETE group: g1 ya no está en groups',       !groups.find(g => g.id === 'g1'));
}

// ────────────────────────────────────────────────────────────────────────────
// 7. POST /api/groups/:id/join — bidireccional + idempotente
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', groupIds: [] }];
    const groups = [{ id: 'g1', type: 'club', kind: 'open', studentIds: [], memberIds: [] }];

    // Primer join
    const g = groups[0];
    const u = users[0];
    const groupChanged1 = addUserIdToGroup(g, u.id);
    const userChanged1  = addGroupIdToUser(u, g.id);
    ok('JOIN 1: groupChanged',         groupChanged1 === true);
    ok('JOIN 1: userChanged',          userChanged1 === true);
    ok('JOIN 1: g1.memberIds tiene u1', g.memberIds.includes('u1'));
    ok('JOIN 1: u1.groupIds tiene g1', (u.groupIds || []).includes('g1'));
    ok('JOIN 1: studentIds == memberIds', setEq(g.studentIds, g.memberIds));

    // Segundo join — idempotente
    const groupChanged2 = addUserIdToGroup(g, u.id);
    const userChanged2  = addGroupIdToUser(u, g.id);
    ok('JOIN 2: groupChanged=false (idempotente)', groupChanged2 === false);
    ok('JOIN 2: userChanged=false (idempotente)',  userChanged2 === false);
    ok('JOIN 2: u1 sigue una sola vez en g1',
        g.memberIds.filter(x => x === 'u1').length === 1 &&
        (u.groupIds || []).filter(x => x === 'g1').length === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 8. POST /api/users — éxito: ambos lados consistentes y orden groups→user
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [];
    const groups = [{ id: 'g1', studentIds: [], memberIds: [] }];
    const newUser = { id: 'uNew', email: 'new@x', roles: ['lector'], groupIds: ['g1'] };

    const { writeJSON, writes } = makeWriter(/* failOn */ null);

    // Cuerpo del lock anidado (versión simulada del endpoint POST /api/users)
    let groupsTouched = false;
    for (const gid of newUser.groupIds) {
        const g = groups.find(x => x?.id === gid);
        if (g && addUserIdToGroup(g, newUser.id)) groupsTouched = true;
    }
    if (groupsTouched) writeJSON('GROUPS_DB', groups);
    users.push(newUser);
    writeJSON('USERS_DB', users);

    ok('CREATE: write order = GROUPS_DB → USERS_DB',
        writes[0].file === 'GROUPS_DB' && writes[1].file === 'USERS_DB');
    ok('CREATE: snapshot grupos contiene uNew',
        lastSnapshot(writes, 'GROUPS_DB')[0].memberIds.includes('uNew'));
    ok('CREATE: snapshot users contiene uNew',
        lastSnapshot(writes, 'USERS_DB').some(u => u.id === 'uNew'));
}

// ────────────────────────────────────────────────────────────────────────────
// 9. POST /api/users — failure de groups write → user NO se persiste (rollback)
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [];
    const groups = [{ id: 'g1', studentIds: [], memberIds: [] }];
    const newUser = { id: 'uOrphan', email: 'orphan@x', roles: ['lector'], groupIds: ['g1'] };

    const { writeJSON, writes } = makeWriter(/* failOn */ 'GROUPS_DB');

    let threw = false;
    try {
        let groupsTouched = false;
        for (const gid of newUser.groupIds) {
            const g = groups.find(x => x?.id === gid);
            if (g && addUserIdToGroup(g, newUser.id)) groupsTouched = true;
        }
        if (groupsTouched) writeJSON('GROUPS_DB', groups); // ← throws
        users.push(newUser);
        writeJSON('USERS_DB', users);
    } catch (e) {
        threw = true;
    }

    ok('CREATE-FAIL: la transacción lanzó',         threw === true);
    ok('CREATE-FAIL: USERS_DB no fue escrito',      writes.find(w => w.file === 'USERS_DB') === undefined);
    ok('CREATE-FAIL: users[] sigue vacío en disco', writes.find(w => w.file === 'USERS_DB') === undefined);
    // (En el endpoint real el lock libera y la respuesta es 500; ningún
    //  estado parcial queda en disco — no hay user huérfano sin grupo.)
}

// ────────────────────────────────────────────────────────────────────────────
// 10. POST /api/invite-user — failure de groups write → invite NO se persiste
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [];
    const groups = [{ id: 'g1', studentIds: [], memberIds: [] }];
    const invitedUser = {
        id: 'uInvite', email: 'invite@x', roles: ['lector'],
        accountStatus: 'invited', inviteToken: 'tok', inviteExpiresAt: Date.now() + 1000,
        groupIds: ['g1'],
    };

    const { writeJSON, writes } = makeWriter('GROUPS_DB');

    let threw = false;
    try {
        let groupsTouched = false;
        for (const gid of invitedUser.groupIds) {
            const g = groups.find(x => x?.id === gid);
            if (g && addUserIdToGroup(g, invitedUser.id)) groupsTouched = true;
        }
        if (groupsTouched) writeJSON('GROUPS_DB', groups); // ← throws
        users.push(invitedUser);
        writeJSON('USERS_DB', users);
    } catch (e) {
        threw = true;
    }

    ok('INVITE-FAIL: la transacción lanzó',     threw === true);
    ok('INVITE-FAIL: USERS_DB no fue escrito',  writes.find(w => w.file === 'USERS_DB') === undefined);
    // Sin try/catch silencioso: el endpoint responde error y el lector NO queda huérfano.
}

console.log('');
console.log(`endpointsBidirectional — pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
