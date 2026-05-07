/**
 * membershipSingleSourceOfTruth.test.js — Sprint 021 Fase 2.
 *
 * Verifica la garantía: "no puede haber dos formas de saber quién pertenece
 * a un grupo".
 *
 * Cubre:
 *   A. Identidad referencial: la función getGroupMembers que importa el
 *      backend service es exactamente la misma instancia que la del módulo
 *      compartido utils/groupMembership.mjs.
 *   B. Equivalencia funcional para los 4 escenarios canónicos de membresía
 *      (canales explícitos, fallback aplicable, fallback no aplicable, mix).
 *   C. La composición que hace metricsService (resolveGroupMemberIds) y la
 *      que hace dataService.getGroupStudents producen el mismo conjunto de
 *      IDs dada la misma entrada. Esto demuestra que las 3 capas
 *      (groupMembershipService, metricsService, dataService) están sobre la
 *      misma fuente de verdad sin re-implementar lógica.
 *   D. Verifica que metricsService NO redefine getGroupStudentIds (regression
 *      guard contra reintroducción de la copia eliminada).
 *
 * Cómo correr:
 *   node server/__test__/membershipSingleSourceOfTruth.test.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { getGroupMembers as getGroupMembersFromService } from '../groupMembershipService.js';
import { getGroupMembers as getGroupMembersFromUtils }   from '../../utils/groupMembership.mjs';

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

console.log('membershipSingleSourceOfTruth — Sprint 021 Fase 2');

// ────────────────────────────────────────────────────────────────────────────
// A. IDENTIDAD REFERENCIAL
// ────────────────────────────────────────────────────────────────────────────
{
    ok('groupMembershipService.getGroupMembers === utils.getGroupMembers',
        getGroupMembersFromService === getGroupMembersFromUtils,
        'el service no debe envolver la helper — debe re-exportar la misma referencia');
}

// ────────────────────────────────────────────────────────────────────────────
// B. EQUIVALENCIA FUNCIONAL — 4 escenarios
// ────────────────────────────────────────────────────────────────────────────

function compareScenarios(label, group, users, allGroups) {
    const opts = { allGroups, warnFn: () => {} };
    const fromService = getGroupMembersFromService(group, users, opts);
    const fromUtils   = getGroupMembersFromUtils(group, users, opts);
    ok(`${label}: outputs coinciden`, setEq(fromService, fromUtils),
        `service=${JSON.stringify(fromService)} utils=${JSON.stringify(fromUtils)}`);
}

// B1 — canales explícitos populated
{
    const g = { id: 'g1', school: 'Villas', studentIds: ['u1'], memberIds: ['u2'] };
    const users = [
        { id: 'u1', roles: ['lector'] },
        { id: 'u2', roles: ['lector'] },
        { id: 'u3', roles: ['lector'], groupIds: ['g1'] },
    ];
    compareScenarios('B1 canales explícitos', g, users, [g]);
    const out = getGroupMembersFromUtils(g, users, { allGroups: [g], warnFn: () => {} });
    ok('B1 conjunto correcto = {u1,u2,u3}', setEq(out, ['u1', 'u2', 'u3']));
}

// B2 — explícitos vacíos + fallback aplicable (single-school)
{
    const g = { id: 'g1', school: 'Villas', studentIds: [], memberIds: [] };
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas' },
        { id: 'u2', roles: ['lector'], colegio: 'Villas' },
    ];
    compareScenarios('B2 fallback colegio', g, users, [g]);
    const out = getGroupMembersFromUtils(g, users, { allGroups: [g], warnFn: () => {} });
    ok('B2 fallback resuelve {u1,u2}', setEq(out, ['u1', 'u2']));
}

// B3 — explícitos vacíos + fallback NO aplicable (multi-school)
{
    const g1 = { id: 'g1', school: 'Villas', studentIds: [], memberIds: [] };
    const g2 = { id: 'g2', school: 'Villas', studentIds: ['u9'], memberIds: ['u9'] };
    const users = [
        { id: 'u1', roles: ['lector'], colegio: 'Villas' },
        { id: 'u9', roles: ['lector'] },
    ];
    compareScenarios('B3 multi-school sin fallback', g1, users, [g1, g2]);
    const out = getGroupMembersFromUtils(g1, users, { allGroups: [g1, g2], warnFn: () => {} });
    ok('B3 fallback NO se activa → []', out.length === 0);
}

// B4 — mix de los tres canales explícitos
{
    const g = { id: 'g1', school: 'Otra', studentIds: ['u1'], memberIds: ['u2'] };
    const users = [
        { id: 'u1', roles: ['lector'] },
        { id: 'u2', roles: ['lector'] },
        { id: 'u3', roles: ['lector'], groupIds: ['g1'] },
        { id: 'u4', roles: ['lector'], colegio: 'Otra' }, // no debe entrar (canales explícitos != vacío)
    ];
    compareScenarios('B4 mix studentIds/memberIds/groupIds', g, users, [g]);
    const out = getGroupMembersFromUtils(g, users, { allGroups: [g], warnFn: () => {} });
    ok('B4 conjunto correcto = {u1,u2,u3} (u4 excluido)',
        setEq(out, ['u1', 'u2', 'u3']));
}

// ────────────────────────────────────────────────────────────────────────────
// C. EQUIVALENCIA DE COMPOSICIÓN — metricsService vs dataService
// ────────────────────────────────────────────────────────────────────────────
//
// Reproduce la composición exacta que hace cada capa:
//   - metricsService.resolveGroupMemberIds(group):
//       getGroupMembers(group, _users, { allGroups: _groups })
//   - dataService.getGroupStudents(groupId):
//       const memberIds = getGroupMembers(group, this.users, { allGroups: this.groups })
//       const userById  = new Map(this.users.map(u => [u.id, u]))
//       return memberIds.map(id => userById.get(id)).filter(Boolean)
//
// Si las dos capas pasan por la misma helper con los mismos argumentos, la
// salida (en términos de IDs) debe coincidir exactamente.
{
    const groups = [
        { id: 'g1', school: 'Villas', studentIds: ['u1'], memberIds: ['u2'] },
        { id: 'g2', school: 'Otra',   studentIds: [],     memberIds: [] },
    ];
    const users = [
        { id: 'u1', nombre_completo: 'Ana',  roles: ['lector'] },
        { id: 'u2', nombre_completo: 'Beto', roles: ['lector'] },
        { id: 'u3', nombre_completo: 'Cris', roles: ['lector'], groupIds: ['g1'] },
        { id: 'u4', nombre_completo: 'Dafne', roles: ['lector'], colegio: 'Otra' }, // fallback en g2
    ];

    // Composición metricsService
    const metricsResolveG1 = getGroupMembersFromService(groups[0], users, { allGroups: groups, warnFn: () => {} });
    const metricsResolveG2 = getGroupMembersFromService(groups[1], users, { allGroups: groups, warnFn: () => {} });

    // Composición dataService
    function dataServiceLikeGetStudentsIds(groupId) {
        const group = groups.find(g => g.id === groupId);
        if (!group) return [];
        const memberIds = getGroupMembersFromUtils(group, users, { allGroups: groups, warnFn: () => {} });
        const userById = new Map(users.map(u => [u.id, u]));
        return memberIds.map(id => userById.get(id)).filter(Boolean).map(u => u.id);
    }
    const dataResolveG1 = dataServiceLikeGetStudentsIds('g1');
    const dataResolveG2 = dataServiceLikeGetStudentsIds('g2');

    ok('C1 metrics(g1) === dataService(g1)',  setEq(metricsResolveG1, dataResolveG1),
        `metrics=${JSON.stringify(metricsResolveG1)} data=${JSON.stringify(dataResolveG1)}`);
    ok('C1 g1 = {u1,u2,u3}',                  setEq(metricsResolveG1, ['u1', 'u2', 'u3']));
    ok('C2 metrics(g2) === dataService(g2)',  setEq(metricsResolveG2, dataResolveG2),
        `metrics=${JSON.stringify(metricsResolveG2)} data=${JSON.stringify(dataResolveG2)}`);
    ok('C2 g2 = {u4} (fallback colegio)',     setEq(metricsResolveG2, ['u4']));
}

// ────────────────────────────────────────────────────────────────────────────
// D. REGRESSION GUARD — ninguna capa redefine la helper
// ────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT  = path.resolve(path.dirname(__filename), '..', '..');

function readSource(relPath) {
    return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

{
    const metricsSrc = readSource('server/metricsService.js');
    ok('metricsService NO define getGroupStudentIds',
        !/function\s+getGroupStudentIds\s*\(/.test(metricsSrc),
        'la copia local de getGroupStudentIds debe estar eliminada');
    ok('metricsService importa getGroupMembers del service',
        /import\s*\{\s*getGroupMembers\s*\}\s*from\s*['"]\.\/groupMembershipService\.js['"]/.test(metricsSrc));
}

{
    const dataSrc = readSource('services/dataService.ts');
    ok('dataService importa getGroupMembers de utils/groupMembership.mjs',
        /import\s*\{\s*getGroupMembers\s*\}\s*from\s*['"]\.\.\/utils\/groupMembership\.mjs['"]/.test(dataSrc));
    // getGroupStudents debe usar getGroupMembers (no la versión vieja con solo memberIds.includes)
    const getGroupStudentsBlock = dataSrc.match(/getGroupStudents\s*\([^)]*\)\s*:\s*User\[\]\s*\{[\s\S]*?\n\s{4}\}/);
    ok('getGroupStudents existe',
        getGroupStudentsBlock !== null);
    ok('getGroupStudents usa getGroupMembers (no re-implementa filter por memberIds)',
        getGroupStudentsBlock && /getGroupMembers\s*\(/.test(getGroupStudentsBlock[0]),
        'debe delegar en la helper compartida');
}

{
    const serviceSrc = readSource('server/groupMembershipService.js');
    ok('groupMembershipService re-exporta desde utils',
        /from\s*['"]\.\.\/utils\/groupMembership\.mjs['"]/.test(serviceSrc));
    // Las primitivas puras NO deben estar redefinidas en el service (solo I/O wrappers).
    ok('groupMembershipService no redefine addUserIdToGroup',
        !/^export\s+function\s+addUserIdToGroup\s*\(/m.test(serviceSrc),
        'addUserIdToGroup debe venir de utils/groupMembership.mjs vía re-export');
    ok('groupMembershipService no redefine getGroupMembers',
        !/^export\s+function\s+getGroupMembers\s*\(/m.test(serviceSrc),
        'getGroupMembers debe venir de utils/groupMembership.mjs vía re-export');
}

console.log('');
console.log(`membershipSingleSourceOfTruth — pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
