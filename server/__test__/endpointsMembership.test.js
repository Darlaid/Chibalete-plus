/**
 * endpointsMembership.test.js — Sprint A.
 *
 * Cubre los 3 endpoints nuevos:
 *   GET    /api/groups/:groupId/candidates
 *   POST   /api/groups/:groupId/members
 *   DELETE /api/groups/:groupId/members/:userId
 *
 * Reproduce el cuerpo lockeado de cada handler (sin levantar Express),
 * usando exactamente las mismas helpers que el endpoint real importa
 * desde groupMembershipService → utils/groupMembership.mjs. Esto prueba
 * el algoritmo y la integridad bidireccional sin depender de I/O.
 *
 * Cómo correr:
 *   node server/__test__/endpointsMembership.test.js
 */

import {
    addUserIdToGroup,
    addGroupIdToUser,
    removeUserIdFromGroup,
    removeGroupIdFromUser,
    getGroupMembers,
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

// ────────────────────────────────────────────────────────────────────────────
// Réplicas de la lógica del handler (mismas helpers, mismo orden)
// ────────────────────────────────────────────────────────────────────────────

const sameSchool = (uColegio, gSchool) =>
    typeof uColegio === 'string' && typeof gSchool === 'string' &&
    uColegio.trim().toLowerCase() === gSchool.trim().toLowerCase();

function handlerListCandidates(group, users, groups) {
    if (!group) return null; // 404
    const currentMemberIds = new Set(getGroupMembers(group, users, { allGroups: groups, warnFn: () => {} }));
    const groupsByUser = new Map();
    for (const g of groups) {
        const ids = getGroupMembers(g, users, { allGroups: groups, warnFn: () => {} });
        for (const uid of ids) {
            if (!groupsByUser.has(uid)) groupsByUser.set(uid, []);
            groupsByUser.get(uid).push(g.id);
        }
    }
    const candidates = [];
    for (const u of users) {
        if (!u?.id) continue;
        if (!Array.isArray(u.roles) || !u.roles.includes('lector')) continue;
        if (currentMemberIds.has(u.id)) continue;
        const sameOrg = u.organizationId && group.organizationId && u.organizationId === group.organizationId;
        const sameStr = sameSchool(u.colegio, group.school);
        if (!sameOrg && !sameStr) continue;
        candidates.push({
            userId:        u.id,
            name:          u.nombre_completo || u.email || u.id,
            currentGroups: groupsByUser.get(u.id) || [],
        });
    }
    return { groupId: group.id, currentMemberCount: currentMemberIds.size, candidates };
}

function handlerAssignMembers(groups, users, groupId, userIds) {
    const idx = groups.findIndex(g => g?.id === groupId);
    if (idx === -1) return { error: 'group_not_found' };
    const group = groups[idx];
    const userById = new Map(users.map(u => [u?.id, u]).filter(([id]) => id));
    const assigned = [];
    const failed   = [];
    for (const uid of userIds) {
        const u = userById.get(uid);
        if (!u) { failed.push({ userId: uid, reason: 'USER_NOT_FOUND' }); continue; }
        const groupChanged = addUserIdToGroup(group, uid);
        const userChanged  = addGroupIdToUser(u, groupId);
        assigned.push({ userId: uid, alreadyMember: !groupChanged && !userChanged });
    }
    return { groupId, assigned, failed };
}

function handlerRemoveMember(groups, users, groupId, userId) {
    const idx = groups.findIndex(g => g?.id === groupId);
    if (idx === -1) return { error: 'group_not_found' };
    const u = users.find(x => x?.id === userId);
    if (!u) return { error: 'user_not_found' };
    const groupChanged = removeUserIdFromGroup(groups[idx], userId);
    const userChanged  = removeGroupIdFromUser(u, groupId);
    return { groupId, userId, removed: groupChanged || userChanged };
}

console.log('endpointsMembership — Sprint A');

// ────────────────────────────────────────────────────────────────────────────
// 1. CANDIDATES — no incluye miembros actuales
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [
        { id: 'g1', school: 'Villas', studentIds: ['u1'], memberIds: ['u1'] },
    ];
    const users = [
        { id: 'u1', nombre_completo: 'Ana',  roles: ['lector'], colegio: 'Villas' }, // ya miembro
        { id: 'u2', nombre_completo: 'Beto', roles: ['lector'], colegio: 'Villas' }, // candidato
    ];
    const r = handlerListCandidates(groups[0], users, groups);
    const ids = r.candidates.map(c => c.userId);
    ok('CANDIDATES: no incluye miembros actuales', !ids.includes('u1'));
    ok('CANDIDATES: incluye user del mismo colegio sin grupo', ids.includes('u2'));
    ok('CANDIDATES: currentMemberCount = 1', r.currentMemberCount === 1);
    ok('CANDIDATES: u2.currentGroups = []',
        r.candidates.find(c => c.userId === 'u2')?.currentGroups.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 2. CANDIDATES — multi-grupo: marca currentGroups correctamente
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [
        { id: 'g1', school: 'Villas', studentIds: [],     memberIds: [] },
        { id: 'g2', school: 'Villas', studentIds: ['u3'], memberIds: ['u3'] },
    ];
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas', nombre_completo: 'Ana' }, // sin grupo
        { id: 'u2', roles: ['lector'], colegio: 'Otro',   nombre_completo: 'Beto' },// otro colegio
        { id: 'u3', roles: ['lector'], colegio: 'Villas', nombre_completo: 'Cris' },// en g2
    ];
    const r1 = handlerListCandidates(groups[0], users, groups);
    const ids1 = r1.candidates.map(c => c.userId);
    ok('CANDIDATES multi: g1 incluye u1', ids1.includes('u1'));
    ok('CANDIDATES multi: g1 excluye u2 (otro colegio)', !ids1.includes('u2'));
    ok('CANDIDATES multi: g1 incluye u3 con currentGroups=[g2]',
        ids1.includes('u3') &&
        r1.candidates.find(c => c.userId === 'u3').currentGroups[0] === 'g2');
    // No hay heurística automática: g1 tiene 0 miembros, fallback colegio NO
    // se activa porque hay 2 grupos en la misma escuela.
    ok('CANDIDATES multi: sin heurística — g1.currentMemberCount = 0',
        r1.currentMemberCount === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. CANDIDATES — excluye no-lectores y usuarios de otro colegio.
//
// Setup multi-grupo: con 2 grupos en la misma escuela el fallback colegio
// NO se activa, así que el filtro por rol/colegio es observable. Con 1 solo
// grupo el fallback resolvería a u1 como miembro implícito (ver test 8 del
// service: "single-group school fallback used") — eso es comportamiento
// correcto de la fuente única, no un bug del endpoint.
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [
        { id: 'g1', school: 'Villas', studentIds: [], memberIds: [] },
        { id: 'g2', school: 'Villas', studentIds: ['anchor'], memberIds: ['anchor'] }, // segundo grupo desactiva fallback
    ];
    const users = [
        { id: 'anchor', roles: ['lector'], colegio: 'Villas' },
        { id: 'u1', roles: ['lector'],        colegio: 'Villas' },
        { id: 'u2', roles: ['mediador'],      colegio: 'Villas' }, // no lector
        { id: 'u3', roles: ['administrador'], colegio: 'Villas' }, // no lector
        { id: 'u4', roles: ['lector'],        colegio: 'Otra' },   // otro colegio
        { id: 'u5', roles: ['lector'] },                           // sin colegio
    ];
    const r = handlerListCandidates(groups[0], users, groups);
    const ids = r.candidates.map(c => c.userId);
    // anchor también es candidato a g1 (está en g2, no en g1) — la consigna
    // permite "usuarios en otros grupos si se permite reasignación".
    ok('CANDIDATES: solo lectores del mismo colegio', setEq(ids, ['u1', 'anchor']));
    ok('CANDIDATES: excluye sin colegio',    !ids.includes('u5'));
    ok('CANDIDATES: excluye otro colegio',   !ids.includes('u4'));
    ok('CANDIDATES: excluye mediador',       !ids.includes('u2'));
    ok('CANDIDATES: excluye administrador',  !ids.includes('u3'));
    ok('CANDIDATES: anchor con currentGroups=[g2]',
        r.candidates.find(c => c.userId === 'anchor')?.currentGroups[0] === 'g2');
}

// ────────────────────────────────────────────────────────────────────────────
// 4. ASSIGN — asigna correctamente y mantiene bidirección
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [{ id: 'g1', school: 'Villas', studentIds: [], memberIds: [] }];
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas' },
        { id: 'u2', roles: ['lector'], colegio: 'Villas' },
    ];
    const r = handlerAssignMembers(groups, users, 'g1', ['u1', 'u2']);
    ok('ASSIGN: assigned 2',                 r.assigned.length === 2);
    ok('ASSIGN: failed 0',                   r.failed.length === 0);
    ok('ASSIGN: g1.memberIds tiene u1,u2',   setEq(groups[0].memberIds, ['u1', 'u2']));
    ok('ASSIGN: studentIds == memberIds',    setEq(groups[0].studentIds, groups[0].memberIds));
    ok('ASSIGN: u1.groupIds tiene g1',       (users[0].groupIds || []).includes('g1'));
    ok('ASSIGN: u2.groupIds tiene g1',       (users[1].groupIds || []).includes('g1'));
    ok('ASSIGN: ningún alreadyMember=true',  r.assigned.every(a => a.alreadyMember === false));
}

// ────────────────────────────────────────────────────────────────────────────
// 5. ASSIGN — idempotente (segundo assign no duplica)
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [{ id: 'g1', school: 'Villas', studentIds: ['u1'], memberIds: ['u1'] }];
    const users  = [{ id: 'u1', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] }];
    const r = handlerAssignMembers(groups, users, 'g1', ['u1']);
    ok('ASSIGN idem: alreadyMember=true',         r.assigned[0].alreadyMember === true);
    ok('ASSIGN idem: g1.memberIds una sola entry', groups[0].memberIds.filter(x => x === 'u1').length === 1);
    ok('ASSIGN idem: u1.groupIds una sola entry',  users[0].groupIds.filter(x => x === 'g1').length === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 6. ASSIGN — falla parcial: un user inexistente no bloquea a los demás
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [{ id: 'g1', school: 'Villas', studentIds: [], memberIds: [] }];
    const users  = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas' },
        { id: 'u3', roles: ['lector'], colegio: 'Villas' },
    ];
    const r = handlerAssignMembers(groups, users, 'g1', ['u1', 'uNoExiste', 'u3']);
    ok('ASSIGN parcial: assigned = [u1, u3]', setEq(r.assigned.map(a => a.userId), ['u1', 'u3']));
    ok('ASSIGN parcial: failed = [uNoExiste]', r.failed.length === 1 && r.failed[0].userId === 'uNoExiste');
    ok('ASSIGN parcial: reason USER_NOT_FOUND', r.failed[0].reason === 'USER_NOT_FOUND');
    ok('ASSIGN parcial: g1 contiene u1 y u3',  setEq(groups[0].memberIds, ['u1', 'u3']));
    ok('ASSIGN parcial: g1 NO contiene uNoExiste', !groups[0].memberIds.includes('uNoExiste'));
}

// ────────────────────────────────────────────────────────────────────────────
// 7. ASSIGN — grupo inexistente
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [{ id: 'g1', school: 'Villas', studentIds: [], memberIds: [] }];
    const users  = [{ id: 'u1', roles: ['lector'], colegio: 'Villas' }];
    const r = handlerAssignMembers(groups, users, 'gNoExiste', ['u1']);
    ok('ASSIGN: grupo inexistente → error', r.error === 'group_not_found');
    ok('ASSIGN: u1 NO se asignó a nada',    !(users[0].groupIds || []).length);
}

// ────────────────────────────────────────────────────────────────────────────
// 8. REMOVE — elimina correctamente y limpia bidirección
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [{ id: 'g1', school: 'Villas', studentIds: ['u1', 'u2'], memberIds: ['u1', 'u2'] }];
    const users  = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] },
        { id: 'u2', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] },
    ];
    const r = handlerRemoveMember(groups, users, 'g1', 'u1');
    ok('REMOVE: removed=true',                  r.removed === true);
    ok('REMOVE: g1 ya no incluye u1',           !groups[0].memberIds.includes('u1'));
    ok('REMOVE: g1 mantiene u2',                groups[0].memberIds.includes('u2'));
    ok('REMOVE: u1.groupIds ya no incluye g1',  !(users[0].groupIds || []).includes('g1'));
    ok('REMOVE: u2.groupIds intacto',           (users[1].groupIds || []).includes('g1'));
    ok('REMOVE: studentIds == memberIds',       setEq(groups[0].studentIds, groups[0].memberIds));
}

// ────────────────────────────────────────────────────────────────────────────
// 9. REMOVE — idempotente: segundo remove devuelve removed=false
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [{ id: 'g1', school: 'Villas', studentIds: [], memberIds: [] }];
    const users  = [{ id: 'u1', roles: ['lector'], colegio: 'Villas', groupIds: [] }];
    const r = handlerRemoveMember(groups, users, 'g1', 'u1');
    ok('REMOVE idem: removed=false', r.removed === false);
    ok('REMOVE idem: g1 sigue vacío', groups[0].memberIds.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 10. REMOVE — grupo o user inexistentes
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [{ id: 'g1', school: 'Villas', studentIds: ['u1'], memberIds: ['u1'] }];
    const users  = [{ id: 'u1', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] }];

    const r1 = handlerRemoveMember(groups, users, 'gNoExiste', 'u1');
    ok('REMOVE 404: grupo inexistente', r1.error === 'group_not_found');
    ok('REMOVE 404 grupo: u1 sigue en g1', groups[0].memberIds.includes('u1'));

    const r2 = handlerRemoveMember(groups, users, 'g1', 'uNoExiste');
    ok('REMOVE 404: user inexistente', r2.error === 'user_not_found');
    ok('REMOVE 404 user: g1 intacto',  groups[0].memberIds.includes('u1'));
}

// ────────────────────────────────────────────────────────────────────────────
// 11. FLUJO END-TO-END MULTI-GRUPO (validación manual simulada)
//
// Simula el escenario operativo real: colegio "Villas" con 2 grupos, 1 lector
// sin grupo. El flujo completo: candidatos → asignación → verificación de
// "aparece en Aula Viva" (= getGroupMembers lo lista) y "ya no aparece en
// candidatos" después.
// ────────────────────────────────────────────────────────────────────────────
{
    const groups = [
        { id: 'g1', school: 'Villas', name: '6A', studentIds: ['existing'], memberIds: ['existing'] },
        { id: 'g2', school: 'Villas', name: '6B', studentIds: [],           memberIds: [] },
    ];
    const users = [
        { id: 'existing', roles: ['lector'], colegio: 'Villas', groupIds: ['g1'] },
        { id: 'newbie',   roles: ['lector'], colegio: 'Villas', nombre_completo: 'Newbie' }, // sin grupo
    ];

    // Step 1 — listar candidatos para g1: newbie aparece, existing no
    const c1 = handlerListCandidates(groups[0], users, groups);
    ok('E2E step 1: candidatos g1 incluyen newbie', c1.candidates.some(c => c.userId === 'newbie'));
    ok('E2E step 1: candidatos g1 NO incluyen existing', !c1.candidates.some(c => c.userId === 'existing'));
    ok('E2E step 1: newbie.currentGroups = []', c1.candidates.find(c => c.userId === 'newbie').currentGroups.length === 0);

    // Step 2 — asignar newbie a g1
    const a = handlerAssignMembers(groups, users, 'g1', ['newbie']);
    ok('E2E step 2: assigned newbie', a.assigned[0].userId === 'newbie' && a.assigned[0].alreadyMember === false);

    // Step 3 — verificar bidirección (proxy de "aparece en Aula Viva")
    const membersAfter = getGroupMembers(groups[0], users, { allGroups: groups, warnFn: () => {} });
    ok('E2E step 3: getGroupMembers(g1) incluye newbie', membersAfter.includes('newbie'));
    ok('E2E step 3: newbie.groupIds incluye g1', users.find(u => u.id === 'newbie').groupIds.includes('g1'));
    ok('E2E step 3: studentIds == memberIds', setEq(groups[0].studentIds, groups[0].memberIds));

    // Step 4 — listar candidatos para g1 de nuevo: newbie ya NO aparece
    const c2 = handlerListCandidates(groups[0], users, groups);
    ok('E2E step 4: candidatos g1 ya NO incluyen newbie', !c2.candidates.some(c => c.userId === 'newbie'));

    // Step 5 — desde g2 ver newbie con currentGroups=['g1']
    const c3 = handlerListCandidates(groups[1], users, groups);
    const newbieC = c3.candidates.find(c => c.userId === 'newbie');
    ok('E2E step 5: candidatos g2 incluyen newbie', !!newbieC);
    ok('E2E step 5: newbie.currentGroups en g2 = [g1]', newbieC && setEq(newbieC.currentGroups, ['g1']));

    // Step 6 — remover newbie de g1
    const r = handlerRemoveMember(groups, users, 'g1', 'newbie');
    ok('E2E step 6: removed=true', r.removed === true);
    ok('E2E step 6: g1 ya no contiene newbie', !groups[0].memberIds.includes('newbie'));
    ok('E2E step 6: newbie.groupIds vacío', users.find(u => u.id === 'newbie').groupIds.length === 0);

    // Step 7 — candidatos para g1 vuelven a incluir a newbie
    const c4 = handlerListCandidates(groups[0], users, groups);
    ok('E2E step 7: candidatos g1 vuelven a incluir newbie',
        c4.candidates.some(c => c.userId === 'newbie' && c.currentGroups.length === 0));
}

console.log('');
console.log(`endpointsMembership — pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
