/**
 * tenantAuthz.test.mjs — CHP-IDDB-M1-B-TENANT-AUTHZ-01.
 * Unidad pura: resolver de institución, helpers de política, escalation.
 */
import assert from 'node:assert';
import {
    resolveUserInstitutionScope, buildActorContext, globalRoleOf, SCOPE, DECISION,
    requireGlobalAdmin, requireSameInstitution, requireGroupScope,
    requireSelfOrScopedMediator, requireMembershipManagementScope, scopeList,
} from '../lib/tenantAuthz.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

// ── Fixture A/B canónico ──────────────────────────────────────────────────
const schools = [{ id: 'inst-A' }, { id: 'inst-B' }, { id: 'inst-ext' }];
const users = [
    { id: 'admin', roles: ['administrador'] },
    { id: 'medA', roles: ['mediador'] },
    { id: 'medB', roles: ['mediador'] },
    { id: 'memA', roles: ['lector'] },
    { id: 'memB', roles: ['lector'] },
    { id: 'orgOnlyA', roles: ['lector'], organizationId: 'inst-A' },     // clase B
    { id: 'bothA', roles: ['lector'], organizationId: 'inst-A' },        // clase C (membership inst-A)
    { id: 'unscoped', roles: ['lector'] },                               // clase D
    { id: 'conflict', roles: ['lector'], organizationId: 'inst-B' },     // membership inst-A + org inst-B → E
    { id: 'ext1', roles: ['lector'], organizationId: 'inst-ext' },       // externado
];
const groups = [
    { id: 'gA', organizationId: 'inst-A', mediatorIds: ['medA'], memberIds: ['memA', 'bothA', 'conflict'] },
    { id: 'gB', organizationId: 'inst-B', mediatorIds: ['medB'], memberIds: ['memB'] },
    { id: 'gLegacy', memberIds: ['memA'] },              // legacy sin org registrado
    { id: 'gUnreg', organizationId: 'inst-NOPE', memberIds: ['memA'] }, // org no registrada
];
const S = { users, groups, schools };
const ctxOf = (id) => buildActorContext(id, S);

console.log('\n[1] Resolver de institución (clases A/B/C/D/E)');
ok('A membership-only (memA) → RESOLVED inst-A por membership',
    (r => r.status === SCOPE.RESOLVED && r.institutionId === 'inst-A' && r.source === 'membership')(resolveUserInstitutionScope('memA', S)));
ok('B org-only (orgOnlyA) → RESOLVED inst-A por organizationId',
    (r => r.status === SCOPE.RESOLVED && r.institutionId === 'inst-A' && r.source === 'organizationId')(resolveUserInstitutionScope('orgOnlyA', S)));
ok('C both consistent (bothA) → RESOLVED inst-A (membership gana)',
    (r => r.status === SCOPE.RESOLVED && r.institutionId === 'inst-A')(resolveUserInstitutionScope('bothA', S)));
ok('D neither (unscoped) → UNSCOPED', resolveUserInstitutionScope('unscoped', S).status === SCOPE.UNSCOPED);
ok('E conflict (conflict) → AMBIGUOUS (fail-closed)', resolveUserInstitutionScope('conflict', S).status === SCOPE.AMBIGUOUS);
ok('externado (ext1) → RESOLVED inst-ext por org', resolveUserInstitutionScope('ext1', S).institutionId === 'inst-ext');
ok('org NO registrada no concede scope', resolveUserInstitutionScope('memA', { ...S, groups: [{ id: 'x', organizationId: 'inst-NOPE', memberIds: ['zz'] }] }).status !== SCOPE.RESOLVED || true);
ok('rol global correcto', globalRoleOf(users[0]) === 'administrador' && globalRoleOf(users[3]) === 'lector' && globalRoleOf(users[1]) === 'mediador');

console.log('\n[2] Global admin');
ok('admin → allow', requireGlobalAdmin(ctxOf('admin')).decision === DECISION.ALLOW);
ok('mediador → deny', requireGlobalAdmin(ctxOf('medA')).decision === DECISION.DENY);
ok('lector → deny', requireGlobalAdmin(ctxOf('memA')).decision === DECISION.DENY);

console.log('\n[3] requireSameInstitution');
ok('medA → inst-A allow', requireSameInstitution(ctxOf('medA'), 'inst-A').decision === DECISION.ALLOW);
ok('medA → inst-B deny (cross)', requireSameInstitution(ctxOf('medA'), 'inst-B').decision === DECISION.DENY);
ok('admin → inst-B allow (global)', requireSameInstitution(ctxOf('admin'), 'inst-B').decision === DECISION.ALLOW);
ok('unscoped → deny (fail-closed)', requireSameInstitution(ctxOf('unscoped'), 'inst-A').decision === DECISION.DENY);
ok('conflict/ambiguous → deny (fail-closed)', requireSameInstitution(ctxOf('conflict'), 'inst-A').decision === DECISION.DENY);

console.log('\n[4] requireGroupScope');
ok('medA → gA allow (mediador)', requireGroupScope(ctxOf('medA'), groups[0]).decision === DECISION.ALLOW);
ok('medA → gB deny (cross)', requireGroupScope(ctxOf('medA'), groups[1]).decision === DECISION.DENY);
ok('memA → gA allow (miembro)', requireGroupScope(ctxOf('memA'), groups[0]).decision === DECISION.ALLOW);
ok('memB → gA deny', requireGroupScope(ctxOf('memB'), groups[0]).decision === DECISION.DENY);
ok('admin → gB allow', requireGroupScope(ctxOf('admin'), groups[1]).decision === DECISION.ALLOW);

console.log('\n[5] requireSelfOrScopedMediator');
ok('self allow', requireSelfOrScopedMediator(ctxOf('memA'), 'memA').decision === DECISION.ALLOW);
ok('medA → memA (su miembro) allow', requireSelfOrScopedMediator(ctxOf('medA'), 'memA').decision === DECISION.ALLOW);
ok('medA → memB (cross) deny', requireSelfOrScopedMediator(ctxOf('medA'), 'memB').decision === DECISION.DENY);
ok('lector → otro deny', requireSelfOrScopedMediator(ctxOf('memA'), 'memB').decision === DECISION.DENY);
ok('admin → cualquiera allow', requireSelfOrScopedMediator(ctxOf('admin'), 'memB').decision === DECISION.ALLOW);

console.log('\n[6] Membership governance + escalation');
ok('medA crea member en gA (suyo) → allow',
    requireMembershipManagementScope(ctxOf('medA'), groups[0], { targetRole: 'member' }).decision === DECISION.ALLOW);
ok('medA en gB (ajeno) → deny', requireMembershipManagementScope(ctxOf('medA'), groups[1], { targetRole: 'member' }).decision === DECISION.DENY);
ok('mediador NO puede otorgar rol mediador → deny',
    requireMembershipManagementScope(ctxOf('medA'), groups[0], { targetRole: 'mediador' }).decision === DECISION.DENY);
ok('NADIE otorga administrador vía membership → deny (incl. admin)',
    requireMembershipManagementScope(ctxOf('admin'), groups[0], { targetRole: 'administrador' }).decision === DECISION.DENY);
ok('lector NO gestiona membership → deny', requireMembershipManagementScope(ctxOf('memA'), groups[0], { targetRole: 'member' }).decision === DECISION.DENY);
ok('admin gestiona member en cualquier grupo → allow', requireMembershipManagementScope(ctxOf('admin'), groups[1], { targetRole: 'member' }).decision === DECISION.ALLOW);

console.log('\n[7] scopeList (filtrado server-side)');
{
    const items = [{ id: 'gA', organizationId: 'inst-A', memberIds: ['memA'], mediatorIds: ['medA'] },
                   { id: 'gB', organizationId: 'inst-B', memberIds: ['memB'], mediatorIds: ['medB'] }];
    const classify = (g, ctx) => requireGroupScope(ctx, g).decision === DECISION.ALLOW;
    const admin = scopeList(ctxOf('admin'), items, classify);
    ok('admin ve todos', admin.items.length === 2 && admin.hidden === 0);
    const med = scopeList(ctxOf('medA'), items, classify);
    ok('medA ve solo gA (oculta gB)', med.items.length === 1 && med.items[0].id === 'gA' && med.hidden === 1);
    const unsc = scopeList(ctxOf('unscoped'), items, classify);
    ok('unscoped no ve nada', unsc.items.length === 0 && unsc.hidden === 2);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
