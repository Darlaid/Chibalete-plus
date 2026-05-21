/**
 * membershipGovernance.test.mjs — tests unitarios de la state machine pura.
 *
 * Sprint MGL Fase 1 / M1. Cubre:
 *   - sameSchool                        (normalización + empty guard)
 *   - validateSameInstitution           (organizationId-first + colegio fallback)
 *   - countFallbackVisibleLectors       (active path counter)
 *   - resolveMaterializableUsers        (single source of truth)
 *   - detectGroupMaterializationState   (4 estados + mixedSeverity + reasonCode)
 *   - buildGovernanceIndexes            (O(N+M) precompute)
 *
 * Runner: node directo. Patrón idéntico a otros tests del proyecto
 * (`groupMembership.test.js`, `immersivePlaybackMachine.test.js`).
 *
 * Cómo correr:
 *   node utils/__tests__/membershipGovernance.test.mjs
 */

import {
    normalizeSchoolKey,
    sameSchool,
    validateSameInstitution,
    countFallbackVisibleLectors,
    resolveMaterializableUsers,
    detectGroupMaterializationState,
    buildGovernanceIndexes,
    CLASSIFIER_VERSION,
    INDEX_VERSION,
} from '../membershipGovernance.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

// ────────────────────────────────────────────────────────────────────────────
// Fixtures helpers
// ────────────────────────────────────────────────────────────────────────────

const userLector = (id, overrides = {}) => ({
    id,
    roles: ['lector'],
    nombre_completo: id,
    ...overrides,
});

const userOther = (id, role = 'mediador') => ({
    id,
    roles: [role],
});

const groupCourse = (id, school, overrides = {}) => ({
    id,
    name: id,
    type: 'course',
    school,
    studentIds: [],
    memberIds: [],
    ...overrides,
});

const userById = (users) => new Map(users.map(u => [u.id, u]));

console.log('\nmembershipGovernance — M1 + M1-delta (state machine pura + version + hardening)');

// ────────────────────────────────────────────────────────────────────────────
// normalizeSchoolKey — single normalization authority (M1-delta ajuste 1)
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[normalizeSchoolKey] single authority de normalización');
{
    ok('string normal', normalizeSchoolKey('Chibalete') === 'chibalete');
    ok('case-insensitive', normalizeSchoolKey('CHIBALETE') === 'chibalete');
    ok('trim', normalizeSchoolKey('  Chibalete  ') === 'chibalete');
    ok('empty string → ""', normalizeSchoolKey('') === '');
    ok('whitespace-only → ""', normalizeSchoolKey('   ') === '');
    ok('null → ""', normalizeSchoolKey(null) === '');
    ok('undefined → ""', normalizeSchoolKey(undefined) === '');
    ok('number → ""', normalizeSchoolKey(123) === '');
    ok('object → ""', normalizeSchoolKey({}) === '');
}

// ────────────────────────────────────────────────────────────────────────────
// sameSchool
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[sameSchool] normalización + empty-string guard');
{
    ok('match básico', sameSchool('Chibalete', 'Chibalete') === true);
    ok('match case-insensitive', sameSchool('chibalete', 'CHIBALETE') === true);
    ok('match con espacios', sameSchool('  Chibalete  ', 'Chibalete') === true);
    ok('mismatch claro', sameSchool('Chibalete', 'Otro Colegio') === false);
    ok('empty user → false', sameSchool('', 'Chibalete') === false);
    ok('empty group → false', sameSchool('Chibalete', '') === false);
    ok('empty/empty NO es match (anti-drift)', sameSchool('', '') === false);
    ok('whitespace-only NO es match', sameSchool('   ', '   ') === false);
    ok('null user → false', sameSchool(null, 'Chibalete') === false);
    ok('null group → false', sameSchool('Chibalete', null) === false);
    ok('undefined → false', sameSchool(undefined, undefined) === false);
}

// ────────────────────────────────────────────────────────────────────────────
// validateSameInstitution
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[validateSameInstitution] organizationId-first + colegio fallback');
{
    const u1 = userLector('u1', { colegio: 'Chibalete', organizationId: 'org-A' });
    const u2 = userLector('u2', { colegio: 'Chibalete', organizationId: 'org-B' });
    const u3 = userLector('u3', { colegio: 'Chibalete' });  // sin orgId

    const gA = groupCourse('g-A', 'Chibalete', { organizationId: 'org-A' });
    const gB = groupCourse('g-B', 'Chibalete', { organizationId: 'org-B' });
    const gNoOrg = groupCourse('g-noOrg', 'Chibalete');

    ok('organizationId match → true', validateSameInstitution(u1, gA) === true);
    // Comportamiento legacy preservado: si orgId NO matchea, la función NO
    // descarta automáticamente — cae al fallback de colegio. La intención
    // histórica es soportar transición legacy → orgId sin romper asignaciones
    // basadas solo en colegio. Si en algún futuro cambia la semántica
    // (cross-org strict), debe documentarse explícitamente y bumpear este test.
    ok('orgId mismatch + mismo colegio → true (fallback colegio sigue activo)',
       validateSameInstitution(u1, gB) === true);
    ok('user con orgId, group sin orgId → fallback colegio',
       validateSameInstitution(u1, gNoOrg) === true);
    ok('user sin orgId, group con orgId → fallback colegio',
       validateSameInstitution(u3, gA) === true);
    ok('ambos sin orgId, mismo colegio → true',
       validateSameInstitution(u3, gNoOrg) === true);

    const uOtra = userLector('uX', { colegio: 'Otra' });
    ok('colegio mismatch → false', validateSameInstitution(uOtra, gA) === false);
    ok('user null → false', validateSameInstitution(null, gA) === false);
    ok('group null → false', validateSameInstitution(u1, null) === false);
}

// ────────────────────────────────────────────────────────────────────────────
// countFallbackVisibleLectors
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[countFallbackVisibleLectors] solo lectores con mismo colegio');
{
    const users = [
        userLector('u1', { colegio: 'Chibalete' }),
        userLector('u2', { colegio: 'chibalete' }),  // case-insensitive
        userLector('u3', { colegio: 'Otra' }),
        userLector('u4', { colegio: 'Chibalete' }),
        userOther('m1', 'mediador'),                  // no lector
        { id: 'u5' },                                 // sin roles
        { id: 'u6', roles: ['lector'], colegio: null }, // colegio inválido
    ];
    const g = groupCourse('g1', 'Chibalete');

    ok('cuenta lectores de Chibalete', countFallbackVisibleLectors(g, users) === 3);
    ok('group sin school → 0', countFallbackVisibleLectors(groupCourse('g0', null), users) === 0);
    ok('group con school empty → 0', countFallbackVisibleLectors(groupCourse('g0', '   '), users) === 0);
    ok('users null → 0', countFallbackVisibleLectors(g, null) === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// M2.1a — countFallbackVisibleLectors ENDURECIDO: excluye soft-deleted
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[M2.1a] countFallbackVisibleLectors excluye soft-deleted');
{
    const users = [
        userLector('alive', { colegio: 'Chibalete' }),
        userLector('softdel', { colegio: 'Chibalete', deletedAt: '2026-01-01T00:00:00Z' }),
        userLector('hardel', { colegio: 'Chibalete', deleted: true }),
    ];
    const g = groupCourse('g1', 'Chibalete');
    ok('soft-deleted (deletedAt) NO se cuenta',
       countFallbackVisibleLectors(g, users) === 1);
    ok('hard-deleted (deleted=true) NO se cuenta — implícito en el assert anterior',
       true);  // mismo assert; lo dejamos explícito en label
}

// ────────────────────────────────────────────────────────────────────────────
// resolveMaterializableUsers
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[resolveMaterializableUsers] matched ∖ explicit, sorted');
{
    const users = [
        userLector('zzz', { colegio: 'Chibalete' }),
        userLector('aaa', { colegio: 'Chibalete' }),
        userLector('mmm', { colegio: 'Chibalete' }),
        userLector('xxx', { colegio: 'Otra' }),
    ];
    const groups = [groupCourse('g1', 'Chibalete')];

    // Single-school, sin explicit → todos los lectores de Chibalete son materializables
    const r1 = resolveMaterializableUsers(groups[0], users, groups);
    ok('materializable incluye todos los lectores del colegio (single-school, sin explicit)',
       r1.length === 3 && r1.includes('aaa') && r1.includes('mmm') && r1.includes('zzz'));
    ok('orden lexicográfico', r1[0] === 'aaa' && r1[1] === 'mmm' && r1[2] === 'zzz');
    ok('users de otro colegio NO incluidos', !r1.includes('xxx'));

    // Con un explicit ya asignado, ese se excluye
    const groups2 = [groupCourse('g1', 'Chibalete', { studentIds: ['aaa'], memberIds: ['aaa'] })];
    const r2 = resolveMaterializableUsers(groups2[0], users, groups2);
    ok('explicit se excluye del materializable',
       r2.length === 2 && !r2.includes('aaa'));

    // Multi-school del mismo school → fallback inactivo → 0
    const groups3 = [
        groupCourse('g1', 'Chibalete'),
        groupCourse('g2', 'Chibalete'),
    ];
    const r3 = resolveMaterializableUsers(groups3[0], users, groups3);
    ok('multi-school del mismo school → 0 (fallback no aplica)', r3.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// detectGroupMaterializationState — los 4 estados
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[detectGroupMaterializationState] STATE: empty_inert / no_school');
{
    const g = { id: 'g0', name: 'g0', type: 'course' }; // sin school
    const r = detectGroupMaterializationState(g, [], [], new Map());
    ok('state = empty_inert', r.state === 'empty_inert');
    ok('reasonCode = no_school', r.reasonCode === 'no_school');
    ok('isSingleSchool = false', r.isSingleSchool === false);
    ok('explicitCount = 0', r.explicitCount === 0);
    ok('fallbackEligibleNotExplicit = 0', r.fallbackEligibleNotExplicit === 0);
    ok('crossSchoolExplicitCount = 0', r.crossSchoolExplicitCount === 0);
    ok('mixedSeverity = null', r.mixedSeverity === null);
}

console.log('\n[detectGroupMaterializationState] STATE: empty_inert / multi_school');
{
    const groups = [
        groupCourse('g1', 'Chibalete'),
        groupCourse('g2', 'Chibalete'),  // 2 grupos misma escuela
    ];
    const users = [userLector('u1', { colegio: 'Chibalete' })];
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = empty_inert', r.state === 'empty_inert');
    ok('reasonCode = multi_school', r.reasonCode === 'multi_school');
    ok('isSingleSchool = false', r.isSingleSchool === false);
}

console.log('\n[detectGroupMaterializationState] STATE: empty_inert / no_lectores');
{
    const groups = [groupCourse('g1', 'Chibalete')];
    const users = [userOther('m1', 'mediador')]; // sin lectores
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = empty_inert', r.state === 'empty_inert');
    ok('reasonCode = no_lectores', r.reasonCode === 'no_lectores');
    ok('isSingleSchool = true', r.isSingleSchool === true);
}

console.log('\n[detectGroupMaterializationState] STATE: fallback_dependent');
{
    const groups = [groupCourse('g1', 'Chibalete')];
    const users = [
        userLector('u1', { colegio: 'Chibalete' }),
        userLector('u2', { colegio: 'Chibalete' }),
    ];
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = fallback_dependent', r.state === 'fallback_dependent');
    ok('reasonCode = single_school_implicit', r.reasonCode === 'single_school_implicit');
    ok('explicitCount = 0', r.explicitCount === 0);
    ok('fallbackEligibleNotExplicit = 2', r.fallbackEligibleNotExplicit === 2);
    ok('crossSchoolExplicitCount = 0', r.crossSchoolExplicitCount === 0);
    ok('mixedSeverity = null', r.mixedSeverity === null);
    ok('isSingleSchool = true', r.isSingleSchool === true);
}

console.log('\n[detectGroupMaterializationState] STATE: fully_explicit');
{
    const groups = [groupCourse('g1', 'Chibalete', {
        studentIds: ['u1', 'u2'],
        memberIds:  ['u1', 'u2'],
    })];
    const users = [
        userLector('u1', { colegio: 'Chibalete' }),
        userLector('u2', { colegio: 'Chibalete' }),
    ];
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = fully_explicit', r.state === 'fully_explicit');
    ok('reasonCode = no_remaining_fallback_visibility', r.reasonCode === 'no_remaining_fallback_visibility');
    ok('explicitCount = 2', r.explicitCount === 2);
    ok('fallbackEligibleNotExplicit = 0', r.fallbackEligibleNotExplicit === 0);
    ok('mixedSeverity = null', r.mixedSeverity === null);
}

console.log('\n[detectGroupMaterializationState] STATE: mixed_legacy_state / recoverable');
{
    // 2 lectores con colegio Chibalete. Uno está explícito; el otro queda como
    // fallback eligible → coexistencia recoverable (mismo colegio).
    const groups = [groupCourse('g1', 'Chibalete', {
        studentIds: ['u1'],
        memberIds:  ['u1'],
    })];
    const users = [
        userLector('u1', { colegio: 'Chibalete' }),
        userLector('u2', { colegio: 'Chibalete' }),  // no explícito → fallback eligible
    ];
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = mixed_legacy_state', r.state === 'mixed_legacy_state');
    ok('reasonCode = partial_explicitification', r.reasonCode === 'partial_explicitification');
    ok('mixedSeverity = recoverable', r.mixedSeverity === 'recoverable');
    ok('explicitCount = 1', r.explicitCount === 1);
    ok('fallbackEligibleNotExplicit = 1', r.fallbackEligibleNotExplicit === 1);
    ok('crossSchoolExplicitCount = 0', r.crossSchoolExplicitCount === 0);
}

console.log('\n[detectGroupMaterializationState] STATE: mixed_legacy_state / corrupted');
{
    // explicit u1 es de OTRO colegio (cross-school drift) +
    // u2 mismo colegio que el grupo, no explícito → fallback eligible.
    const groups = [groupCourse('g1', 'Chibalete', {
        studentIds: ['uX'],
        memberIds:  ['uX'],
    })];
    const users = [
        userLector('uX', { colegio: 'Otra' }),         // explicit cross-school
        userLector('u2', { colegio: 'Chibalete' }),    // eligible
    ];
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = mixed_legacy_state', r.state === 'mixed_legacy_state');
    ok('reasonCode = cross_school_corruption', r.reasonCode === 'cross_school_corruption');
    ok('mixedSeverity = corrupted', r.mixedSeverity === 'corrupted');
    ok('crossSchoolExplicitCount = 1', r.crossSchoolExplicitCount === 1);
}

console.log('\n[detectGroupMaterializationState] orphan explicit (id no resoluble) NO cuenta como corruption');
{
    const groups = [groupCourse('g1', 'Chibalete', {
        studentIds: ['ghost'],     // explicit pero user no existe
        memberIds:  ['ghost'],
    })];
    const users = [
        userLector('u1', { colegio: 'Chibalete' }),  // eligible
    ];
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = mixed_legacy_state', r.state === 'mixed_legacy_state');
    ok('orphan NO cuenta como cross-school', r.crossSchoolExplicitCount === 0);
    ok('mixedSeverity = recoverable (orphan ≠ corrupted)', r.mixedSeverity === 'recoverable');
}

console.log('\n[detectGroupMaterializationState] fully_explicit con crossSchool informativo');
{
    // explicit cross-school + 0 fallback eligible → fully_explicit con
    // crossSchoolExplicitCount > 0 informativo (no eleva a mixed).
    const groups = [groupCourse('g1', 'Chibalete', {
        studentIds: ['uX'],
        memberIds:  ['uX'],
    })];
    const users = [
        userLector('uX', { colegio: 'Otra' }),
    ];
    const r = detectGroupMaterializationState(groups[0], users, groups, userById(users));
    ok('state = fully_explicit', r.state === 'fully_explicit');
    ok('crossSchoolExplicitCount > 0 informativo', r.crossSchoolExplicitCount === 1);
    ok('mixedSeverity = null (no es mixed porque eligible=0)', r.mixedSeverity === null);
}

// ────────────────────────────────────────────────────────────────────────────
// buildGovernanceIndexes
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[buildGovernanceIndexes] precompute O(N+M)');
{
    const users = [
        userLector('u1', { colegio: 'Chibalete' }),
        userLector('u2', { colegio: 'Otra' }),
        userLector('u3', { colegio: 'chibalete' }),       // case-insensitive
        userLector('u4', { colegio: '   Chibalete   ' }), // whitespace
        userOther('m1', 'mediador'),                       // no lector → omitido
        userLector('u5', { colegio: null }),               // sin colegio → omitido de schools map
        userLector('u6', { colegio: '' }),                 // empty → omitido
    ];
    const groups = [
        groupCourse('g1', 'Chibalete'),
        groupCourse('g2', 'Otra'),
        groupCourse('g3', 'CHIBALETE'),
        groupCourse('g4', null),    // sin school → omitido del groupsBySchool
    ];

    const indexes = buildGovernanceIndexes(users, groups);
    ok('userById tiene todos los users con id',
       indexes.userById.size === 7);
    ok('userById permite lookup O(1)',
       indexes.userById.get('u1').id === 'u1' && indexes.userById.get('m1').roles[0] === 'mediador');

    // usersBySchool: solo lectores con colegio
    const chibaleteLectores = indexes.usersBySchool.get('chibalete') || [];
    ok('usersBySchool key normalizada lowercase',
       indexes.usersBySchool.has('chibalete'));
    ok('usersBySchool agrupa case-insensitive y trim',
       chibaleteLectores.length === 3 && chibaleteLectores.map(u => u.id).sort().join(',') === 'u1,u3,u4');
    ok('usersBySchool excluye mediadores',
       !chibaleteLectores.some(u => u.id === 'm1'));
    ok('usersBySchool excluye users sin colegio',
       !chibaleteLectores.some(u => u.id === 'u5' || u.id === 'u6'));

    const otraLectores = indexes.usersBySchool.get('otra') || [];
    ok('otra school también indexada', otraLectores.length === 1);

    // groupsBySchool: todos los groups con school
    ok('groupsBySchool key normalizada',
       indexes.groupsBySchool.has('chibalete'));
    ok('groupsBySchool agrupa case-insensitive',
       (indexes.groupsBySchool.get('chibalete') || []).length === 2);
    ok('groupsBySchool excluye groups sin school',
       (indexes.groupsBySchool.get('otra') || []).length === 1);
}

console.log('\n[buildGovernanceIndexes] inputs degenerados');
{
    const r1 = buildGovernanceIndexes(null, null);
    ok('null/null → maps vacíos',
       r1.userById.size === 0 && r1.usersBySchool.size === 0 && r1.groupsBySchool.size === 0);

    const r2 = buildGovernanceIndexes([], []);
    ok('arrays vacíos → maps vacíos',
       r2.userById.size === 0 && r2.usersBySchool.size === 0 && r2.groupsBySchool.size === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// M1-delta — versions
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[versions] CLASSIFIER_VERSION + INDEX_VERSION son números estables');
{
    ok('CLASSIFIER_VERSION es number', typeof CLASSIFIER_VERSION === 'number' && CLASSIFIER_VERSION >= 1);
    ok('INDEX_VERSION es number', typeof INDEX_VERSION === 'number' && INDEX_VERSION >= 1);
}

console.log('\n[versions] classifierVersion presente en todas las ramas');
{
    const empty = detectGroupMaterializationState({ id: 'g0' }, [], [], new Map());
    ok('empty_inert/no_school incluye classifierVersion',
       empty.classifierVersion === CLASSIFIER_VERSION);

    const groups = [groupCourse('g1', 'Chibalete')];
    const fbDep = detectGroupMaterializationState(groups[0],
        [userLector('u1', { colegio: 'Chibalete' })], groups, new Map([['u1', userLector('u1', { colegio: 'Chibalete' })]]));
    ok('fallback_dependent incluye classifierVersion',
       fbDep.classifierVersion === CLASSIFIER_VERSION);

    const groupsFE = [groupCourse('g1', 'Chibalete', { studentIds: ['u1'], memberIds: ['u1'] })];
    const fe = detectGroupMaterializationState(groupsFE[0],
        [userLector('u1', { colegio: 'Chibalete' })], groupsFE,
        new Map([['u1', userLector('u1', { colegio: 'Chibalete' })]]));
    ok('fully_explicit incluye classifierVersion', fe.classifierVersion === CLASSIFIER_VERSION);

    const usersMixed = [
        userLector('u1', { colegio: 'Chibalete' }),
        userLector('u2', { colegio: 'Chibalete' }),
    ];
    const groupsMixed = [groupCourse('g1', 'Chibalete', { studentIds: ['u1'], memberIds: ['u1'] })];
    const mixed = detectGroupMaterializationState(groupsMixed[0], usersMixed, groupsMixed, userById(usersMixed));
    ok('mixed_legacy_state incluye classifierVersion', mixed.classifierVersion === CLASSIFIER_VERSION);
}

console.log('\n[versions] indexVersion presente en buildGovernanceIndexes');
{
    const r = buildGovernanceIndexes([], []);
    ok('indexVersion presente', r.indexVersion === INDEX_VERSION);
    const r2 = buildGovernanceIndexes(null, null);
    ok('indexVersion presente incluso con inputs nulos', r2.indexVersion === INDEX_VERSION);
}

// ────────────────────────────────────────────────────────────────────────────
// M1-delta — hardening operacional de usersBySchool
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[hardening] usersBySchool excluye users data-drift / soft-deleted');
{
    const users = [
        userLector('valid1', { colegio: 'Chibalete' }),
        userLector('deleted1', { colegio: 'Chibalete', deleted: true }),
        userLector('softdel1', { colegio: 'Chibalete', deletedAt: '2026-01-01T00:00:00Z' }),
        { id: 'norol', colegio: 'Chibalete' },                       // sin roles array
        { id: 'rolnotarr', roles: 'lector', colegio: 'Chibalete' },  // roles no es array
        { roles: ['lector'], colegio: 'Chibalete' },                 // sin id
        { id: '', roles: ['lector'], colegio: 'Chibalete' },         // id vacío
        null,                                                         // null
        userLector('valid2', { colegio: 'Chibalete' }),
    ];
    const r = buildGovernanceIndexes(users, []);
    const lectores = r.usersBySchool.get('chibalete') || [];
    const ids = lectores.map(u => u.id).sort();

    ok('Solo válidos en usersBySchool (valid1, valid2)',
       ids.length === 2 && ids[0] === 'valid1' && ids[1] === 'valid2');
    ok('user con deleted:true NO incluido', !ids.includes('deleted1'));
    ok('user con deletedAt NO incluido', !ids.includes('softdel1'));
    ok('user sin roles array NO incluido', !ids.includes('norol'));
    ok('user con roles no-array NO incluido', !ids.includes('rolnotarr'));

    // userById SÍ los incluye (forensic)
    ok('userById incluye user con id válido aunque sea deleted',
       r.userById.has('deleted1') && r.userById.has('softdel1'));
    ok('userById excluye user sin id', !r.userById.has(''));
    // valid1, deleted1, softdel1, norol, rolnotarr, valid2 = 6 entries.
    // (id=='' y null se excluyen del userById.)
    ok('userById excluye null e id vacío', r.userById.size === 6);
}

console.log('\n[M2.1a] deleted lector NO contribuye a fallback eligibility (resolver + index unificados)');
{
    // M2.1a — la deuda M1-delta ("Resolver legacy AÚN incluye softdel")
    // queda CERRADA. applyLegacyColegioFallback ahora delega a
    // isOperationallyEligibleFallbackUser, el SoT compartido con el index.
    // Resultado: snapshot ↔ runtime parity garantizada por construcción.
    const users = [
        userLector('alive', { colegio: 'Chibalete' }),
        userLector('softdel', { colegio: 'Chibalete', deletedAt: '2026-01-01T00:00:00Z' }),
        userLector('hardel', { colegio: 'Chibalete', deleted: true }),
    ];
    const r = buildGovernanceIndexes(users, []);
    ok('softdel NO en usersBySchool',
       (r.usersBySchool.get('chibalete') || []).map(u => u.id).indexOf('softdel') === -1);
    ok('hardel NO en usersBySchool',
       (r.usersBySchool.get('chibalete') || []).map(u => u.id).indexOf('hardel') === -1);

    const groups = [groupCourse('g1', 'Chibalete')];
    const materializable = resolveMaterializableUsers(groups[0], users, groups);
    ok('Resolver EXCLUYE softdel (deuda M1-delta cerrada)',
       !materializable.includes('softdel'));
    ok('Resolver EXCLUYE hardel',
       !materializable.includes('hardel'));
    ok('Resolver INCLUYE alive',
       materializable.includes('alive') && materializable.length === 1);

    // Forensic: userById los preserva (no los borra de la base).
    ok('softdel preservado en userById (forensic)',
       r.userById.has('softdel'));
}

// ────────────────────────────────────────────────────────────────────────────
// M2.1a — predicates SoT (importados desde groupMembership.mjs)
// ────────────────────────────────────────────────────────────────────────────

const { isOperationallyEligibleLector, isOperationallyEligibleFallbackUser } =
    await import('../groupMembership.mjs');

console.log('\n[M2.1a] isOperationallyEligibleLector — predicate user-level SoT');
{
    ok('lector válido → true',
       isOperationallyEligibleLector({ id: 'u1', roles: ['lector'] }) === true);
    ok('null → false',
       isOperationallyEligibleLector(null) === false);
    ok('sin id → false',
       isOperationallyEligibleLector({ roles: ['lector'] }) === false);
    ok('id vacío → false',
       isOperationallyEligibleLector({ id: '', roles: ['lector'] }) === false);
    ok('roles no-array → false',
       isOperationallyEligibleLector({ id: 'u1', roles: 'lector' }) === false);
    ok('rol no-lector → false',
       isOperationallyEligibleLector({ id: 'u1', roles: ['mediador'] }) === false);
    ok('deleted=true → false',
       isOperationallyEligibleLector({ id: 'u1', roles: ['lector'], deleted: true }) === false);
    ok('deletedAt truthy → false',
       isOperationallyEligibleLector({ id: 'u1', roles: ['lector'], deletedAt: '2026-01-01' }) === false);
    ok('deletedAt vacío string → true (no es soft-delete real)',
       isOperationallyEligibleLector({ id: 'u1', roles: ['lector'], deletedAt: '' }) === true);
    ok('deleted=false → true',
       isOperationallyEligibleLector({ id: 'u1', roles: ['lector'], deleted: false }) === true);
}

console.log('\n[M2.1a] isOperationallyEligibleFallbackUser — predicate user+group SoT');
{
    const g = { id: 'g1', school: 'Chibalete' };
    ok('lector válido + colegio matching → true',
       isOperationallyEligibleFallbackUser(
           { id: 'u1', roles: ['lector'], colegio: 'Chibalete' }, g) === true);
    ok('case-insensitive school match → true',
       isOperationallyEligibleFallbackUser(
           { id: 'u1', roles: ['lector'], colegio: '  CHIBALETE  ' }, g) === true);
    ok('colegio mismatch → false',
       isOperationallyEligibleFallbackUser(
           { id: 'u1', roles: ['lector'], colegio: 'Otra' }, g) === false);
    ok('group sin school → false',
       isOperationallyEligibleFallbackUser(
           { id: 'u1', roles: ['lector'], colegio: 'Chibalete' }, { id: 'g1' }) === false);
    ok('user sin colegio → false',
       isOperationallyEligibleFallbackUser(
           { id: 'u1', roles: ['lector'] }, g) === false);
    ok('soft-deleted con matching colegio → false',
       isOperationallyEligibleFallbackUser(
           { id: 'u1', roles: ['lector'], colegio: 'Chibalete', deletedAt: '2026-01-01' }, g) === false);
    ok('group null → false',
       isOperationallyEligibleFallbackUser({ id: 'u1', roles: ['lector'], colegio: 'X' }, null) === false);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
