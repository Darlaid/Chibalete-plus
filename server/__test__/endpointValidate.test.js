/**
 * endpointValidate.test.js — Sprint 022 Fase A
 *
 * Cubre el endpoint GET /api/admin/membership/validate añadido en Sprint 022.
 *
 * Estos tests NO levantan Express. Reproducen el cuerpo del handler:
 *   1. lectura de USERS_DB y GROUPS_DB (vía stub readJSON)
 *   2. invocación de validateMembershipIntegrity
 *   3. shape del response { ok, issues, counts }
 *   4. status HTTP (200 en éxito, 500 si readJSON falla)
 *
 * Stubea res con un par capturador de status/json para asertar exactamente
 * qué shape recibió el cliente. Mismo patrón ligero del resto de la suite
 * — sin supertest, sin levantamiento de servidor.
 *
 * Cómo correr:
 *   node server/__test__/endpointValidate.test.js
 */

import { validateMembershipIntegrity } from '../groupMembershipService.js';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

// ── Stub mínimo de res ───────────────────────────────────────────────────────
//
// Captura status() y json() en orden para que los asserts puedan verificar
// la respuesta exacta enviada al cliente.
function makeRes() {
    const captured = { statusCode: 200, body: null };
    const res = {
        status(code) { captured.statusCode = code; return res; },
        json(body)   { captured.body = body; return res; },
    };
    return { res, captured };
}

// ── Reproducción del handler ─────────────────────────────────────────────────
//
// Mantiene la misma forma del handler en server.js. Si el handler cambia
// de shape, este helper debe alinearse — ese es el punto del test.
function runValidateHandler({ users, groups, readJSONImpl }) {
    const { res, captured } = makeRes();
    const readJSON = readJSONImpl || ((path) => {
        if (path === 'USERS_DB')  return users;
        if (path === 'GROUPS_DB') return groups;
        throw new Error(`unexpected path: ${path}`);
    });

    try {
        const u = readJSON('USERS_DB')  || [];
        const g = readJSON('GROUPS_DB') || [];
        const result = validateMembershipIntegrity(u, g);
        const okFlag = result.issues.length === 0;
        res.status(200).json({
            ok: okFlag,
            issues: result.issues,
            counts: result.counts,
        });
    } catch {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'No se pudo ejecutar la validación de integridad.',
        });
    }
    return captured;
}

console.log('endpointValidate — Sprint 022');

// ────────────────────────────────────────────────────────────────────────────
// 1. Sin issues → ok=true, status 200
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', roles: ['lector'], groupIds: ['g1'] }];
    const groups = [{ id: 'g1', studentIds: ['u1'], memberIds: ['u1'] }];
    const r = runValidateHandler({ users, groups });
    ok('clean: status=200',          r.statusCode === 200);
    ok('clean: ok=true',             r.body?.ok === true);
    ok('clean: issues=[]',           Array.isArray(r.body.issues) && r.body.issues.length === 0);
    ok('clean: counts es objeto',    r.body && typeof r.body.counts === 'object');
}

// ────────────────────────────────────────────────────────────────────────────
// 2. orphan_studentId — group apunta a userId que no existe
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', roles: ['lector'], groupIds: ['g1'] }];
    const groups = [{ id: 'g1', studentIds: ['u1', 'uGhost'], memberIds: ['u1', 'uGhost'] }];
    const r = runValidateHandler({ users, groups });
    const orphans = r.body.issues.filter(i => i.type === 'orphan_studentId');
    ok('orphan_studentId: detectado',     orphans.length === 1);
    ok('orphan_studentId: userId=uGhost', orphans[0]?.userId === 'uGhost');
    ok('orphan_studentId: groupId=g1',    orphans[0]?.groupId === 'g1');
    ok('orphan_studentId: counts incluye 1', r.body.counts.orphan_studentId === 1);
    ok('orphan_studentId: ok=false',      r.body.ok === false);
    ok('orphan_studentId: status=200',    r.statusCode === 200);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. orphan_memberId — memberIds apunta a userId inexistente
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', roles: ['lector'], groupIds: ['g1'] }];
    const groups = [{ id: 'g1', studentIds: ['u1'], memberIds: ['u1', 'uGhost'] }];
    const r = runValidateHandler({ users, groups });
    const orphMember = r.body.issues.filter(i => i.type === 'orphan_memberId');
    ok('orphan_memberId: detectado',      orphMember.length === 1);
    ok('orphan_memberId: counts',         r.body.counts.orphan_memberId === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 4. orphan_userGroupId — user.groupIds apunta a group inexistente
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', roles: ['lector'], groupIds: ['gFantasma'] }];
    const groups = [{ id: 'g1', studentIds: ['u1'], memberIds: ['u1'] }];
    const r = runValidateHandler({ users, groups });
    const orphG = r.body.issues.filter(i => i.type === 'orphan_userGroupId');
    ok('orphan_userGroupId: detectado',         orphG.length === 1);
    ok('orphan_userGroupId: userId=u1',         orphG[0]?.userId === 'u1');
    ok('orphan_userGroupId: groupId=gFantasma', orphG[0]?.groupId === 'gFantasma');
    ok('orphan_userGroupId: counts',            r.body.counts.orphan_userGroupId === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 5. studentMember_divergence — studentIds y memberIds difieren
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [
        { id: 'u1', roles: ['lector'], groupIds: ['g1'] },
        { id: 'u2', roles: ['lector'], groupIds: ['g1'] },
    ];
    const groups = [{ id: 'g1', studentIds: ['u1', 'u2'], memberIds: ['u1'] }];
    const r = runValidateHandler({ users, groups });
    const div = r.body.issues.filter(i => i.type === 'studentMember_divergence');
    ok('divergence: detectado',                  div.length === 1);
    ok('divergence: onlyInStudentIds=[u2]',      Array.isArray(div[0]?.onlyInStudentIds) && div[0].onlyInStudentIds.includes('u2'));
    ok('divergence: onlyInMemberIds=[]',         Array.isArray(div[0]?.onlyInMemberIds) && div[0].onlyInMemberIds.length === 0);
    ok('divergence: counts',                     r.body.counts.studentMember_divergence === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 6. lector_without_group — user lector sin groupIds y sin estar en grupo
//    (cubre "user_without_group" del spec del sprint)
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [{ id: 'u1', roles: ['lector'], groupIds: [] }];
    const groups = [{ id: 'g1', studentIds: [], memberIds: [] }];
    const r = runValidateHandler({ users, groups });
    const lone = r.body.issues.filter(i => i.type === 'lector_without_group');
    ok('lector_without_group: detectado', lone.length === 1);
    ok('lector_without_group: userId=u1', lone[0]?.userId === 'u1');
    ok('lector_without_group: counts',    r.body.counts.lector_without_group === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 7. school_with_users_no_group — colegio con lectores pero sin grupo
//    (cubre "group_without_members" del spec — el colegio existe pero no
//    tiene grupo creado, por lo que ningún lector puede asignarse)
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [
        { id: 'u1', roles: ['lector'], colegio: 'Escuela Sur', groupIds: [] },
        { id: 'u2', roles: ['lector'], colegio: 'Escuela Sur', groupIds: [] },
    ];
    const groups = []; // no hay grupo para "Escuela Sur"
    const r = runValidateHandler({ users, groups });
    const noGroupSchool = r.body.issues.filter(i => i.type === 'school_with_users_no_group');
    ok('school_with_users_no_group: detectado',     noGroupSchool.length === 1);
    ok('school_with_users_no_group: school=correcto', /escuela sur/i.test(noGroupSchool[0]?.school || ''));
    ok('school_with_users_no_group: lectorCount=2', noGroupSchool[0]?.lectorCount === 2);
    ok('school_with_users_no_group: counts',        r.body.counts.school_with_users_no_group === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 8. Bidirectional mismatch — user.groupIds incluye gX pero gX no lista al user.
//    Esto se manifiesta como `lector_without_group` cuando el user no aparece
//    en ningún otro grupo, O como `orphan_userGroupId` si gX no existe.
//    El validador NO emite un tipo separado "bidirectional_mismatch" porque
//    cualquier mismatch real cae en uno de esos dos buckets.
// ────────────────────────────────────────────────────────────────────────────
{
    // Caso A: user dice estar en g1, pero g1 no lo lista. g1 SÍ existe.
    // El validador NO lo reporta — es legítimo que un user diga "yo creo
    // estar en g1" mientras g1 todavía no lo registró (race entre escrituras).
    // En cambio el caso B (user→grupo inexistente) sí se reporta.
    const usersA  = [{ id: 'u1', roles: ['lector'], groupIds: ['g1'] }];
    const groupsA = [{ id: 'g1', studentIds: [], memberIds: [] }];
    const rA = runValidateHandler({ users: usersA, groups: groupsA });
    // Esto NO debe ser detectado como mismatch — la fuente de verdad es la
    // unión de los tres canales explícitos. Ver getExplicitGroupMembers.
    // Sí puede aparecer lector_without_group si u1 no está en otro grupo.
    const mismatchAsLone = rA.body.issues.filter(i => i.type === 'lector_without_group');
    ok('bidirectional A: NO se reporta como tipo nuevo', !rA.body.issues.find(i => i.type === 'bidirectional_mismatch'));
    ok('bidirectional A: u1 NO se considera huérfano (groupIds lo cuenta)', mismatchAsLone.length === 0);

    // Caso B: user→grupo inexistente. SÍ se reporta como orphan_userGroupId.
    const usersB  = [{ id: 'u1', roles: ['lector'], groupIds: ['gNoExiste'] }];
    const groupsB = [];
    const rB = runValidateHandler({ users: usersB, groups: groupsB });
    const orphB = rB.body.issues.filter(i => i.type === 'orphan_userGroupId');
    ok('bidirectional B: orphan_userGroupId detectado', orphB.length === 1);
}

// ────────────────────────────────────────────────────────────────────────────
// 9. Múltiples issues en simultáneo — counts agregados correctamente
// ────────────────────────────────────────────────────────────────────────────
{
    const users  = [
        { id: 'u1', roles: ['lector'], groupIds: ['gX'] },          // orphan_userGroupId
        { id: 'u2', roles: ['lector'], groupIds: [] },              // lector_without_group
    ];
    const groups = [
        { id: 'g1', studentIds: ['uGhost'], memberIds: ['uGhost'] }, // orphan_studentId + orphan_memberId
        { id: 'g2', studentIds: ['u1', 'u2'], memberIds: ['u1'] },   // divergence
    ];
    const r = runValidateHandler({ users, groups });
    ok('multi: ok=false',                          r.body.ok === false);
    ok('multi: orphan_studentId>=1',               r.body.counts.orphan_studentId >= 1);
    ok('multi: orphan_memberId>=1',                r.body.counts.orphan_memberId >= 1);
    ok('multi: orphan_userGroupId>=1',             r.body.counts.orphan_userGroupId >= 1);
    ok('multi: studentMember_divergence>=1',       r.body.counts.studentMember_divergence >= 1);
    ok('multi: total issues = suma de counts',
        r.body.issues.length ===
        Object.values(r.body.counts).reduce((a, b) => a + b, 0));
}

// ────────────────────────────────────────────────────────────────────────────
// 10. Error path — readJSON falla → status 500 + body con error/message
// ────────────────────────────────────────────────────────────────────────────
{
    const r = runValidateHandler({
        users:  [],
        groups: [],
        readJSONImpl: () => { throw new Error('ENOENT'); },
    });
    ok('error: status=500',                  r.statusCode === 500);
    ok('error: body.error existe',           typeof r.body?.error === 'string');
    ok('error: body.message existe',         typeof r.body?.message === 'string');
    ok('error: NO expone el error técnico',  !/ENOENT/.test(r.body.message || ''));
}

// ────────────────────────────────────────────────────────────────────────────
// Cierre
// ────────────────────────────────────────────────────────────────────────────
console.log(`\nendpointValidate — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
