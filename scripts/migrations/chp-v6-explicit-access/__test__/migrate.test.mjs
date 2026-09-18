/**
 * migrate.test.mjs — CHP-V6-EXPLICIT-ACCESS-MEMBERSHIPS-01.
 *
 * Prueba los INVARIANTES del migrador, no el dominio entero. TODO sobre
 * fixtures sintéticas en mkdtemp: ningún test toca stores reales, y no hay PII
 * (ids inventados, sin nombres ni correos reales; los dominios son .invalid).
 *
 *   node scripts/migrations/chp-v6-explicit-access/__test__/migrate.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// pathToFileURL: en Windows un import dinámico con ruta absoluta ('D:\...')
// falla con ERR_UNSUPPORTED_ESM_URL_SCHEME si no se convierte a file://.
const M = await import(pathToFileURL(path.join(HERE, '..', 'migrate.mjs')).href);
const {
    computePlan, deriveOpenCatalog, reconcileRuleAgainstGroup, assertNoCrossTenant,
    ruleIdForGroup, RULE_ID_PREFIX, GROUP_ARCHIVE_POLICY, MigrationStop, run, rollback,
} = M;

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => {
    if (cond) { console.log('  ✓', label); pass++; }
    else { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
};
const section = (t) => console.log(`\n${t}`);
const canon = (v) => JSON.stringify(v);

// ── Fixtures sintéticas ─────────────────────────────────────────────────────

const ORG_A = 'org-alpha';
const ORG_B = 'org-beta';

const CONTENT = () => [
    { id: 'c-open-1', titulo: 'Abierto 1', tipo: 'libro', status: 'disponible' },
    { id: 'c-open-2', titulo: 'Abierto 2', tipo: 'libro', status: 'disponible' },
    { id: 'c-unpublished', titulo: 'Sin publicar', tipo: 'libro', status: 'procesando' },
    { id: 'c-pedagogy', titulo: 'Guía docente', tipo: 'articulo_pedagogico', status: 'disponible' },
    { id: 'c-embedded', titulo: 'Nodo', tipo: 'guia', status: 'disponible', standalone: false },
    { id: 'c-col', titulo: 'Colección', tipo: 'libro', status: 'disponible', isCollection: true },
    { id: 'c-in-col', titulo: 'Hijo', tipo: 'libro', status: 'disponible', parentId: 'c-col' },
];
const OPEN_CATALOG = ['c-col', 'c-embedded', 'c-in-col', 'c-open-1', 'c-open-2'];

const SCHOOLS = () => [
    { id: ORG_A, name: 'Colegio Alfa' },
    { id: ORG_B, name: 'Colegio Beta' },
];

const lector = (id, org, colegio) => ({
    id, email: `${id}@example.invalid`, nombre_completo: `Lector ${id}`,
    roles: ['lector'], accountStatus: 'active', organizationId: org, colegio, groupIds: [],
});

const USERS = () => [
    lector('u-a1', ORG_A, 'Colegio Alfa'),
    lector('u-a2', ORG_A, 'Colegio Alfa'),
    lector('u-b1', ORG_B, 'Colegio Beta'),
    lector('u-c1', ORG_A, 'Colegio Gamma'),
    lector('u-d1', ORG_B, 'Colegio Delta'),
];

/** Cohorte de clasificación: incluye los casos que BLOQUEAN. */
const classificationGroups = () => [
    { id: 'g-with-rule', name: 'G1', type: 'course', organizationId: ORG_A, memberIds: ['u-a1'], studentIds: ['u-a1'] },
    { id: 'g-plain', name: 'G2', type: 'course', organizationId: ORG_A, memberIds: ['u-a2'], studentIds: ['u-a2'] },
    { id: 'g-infer', name: 'G3', type: 'course', memberIds: ['u-a1'], studentIds: ['u-a1'] },
    { id: 'g-ambiguous', name: 'G4', type: 'club', memberIds: ['u-a1', 'u-b1'], studentIds: ['u-a1', 'u-b1'] },
    { id: 'g-empty', name: 'G5', type: 'course', memberIds: [], studentIds: [] },
    { id: 'g-badorg', name: 'G6', type: 'course', organizationId: 'org-inexistente', memberIds: ['u-a2'], studentIds: ['u-a2'] },
    { id: 'g-badorg-noev', name: 'G7', type: 'course', organizationId: 'org-inexistente', memberIds: ['u-fantasma'], studentIds: ['u-fantasma'] },
    { id: 'g-fallback', name: 'G8', type: 'course', school: 'Colegio Gamma', organizationId: ORG_A, memberIds: [], studentIds: [] },
    { id: 'g-crosstenant', name: 'G9', type: 'course', school: 'Colegio Delta', organizationId: ORG_A, memberIds: [], studentIds: [] },
];

const EXISTING_RULE = {
    id: 'access-legacy-0001', scope: 'group', scopeId: 'g-with-rule',
    titleIds: ['c-open-1'], collectionIds: [], expiresAt: null,
};

const classificationState = () => ({
    groups: classificationGroups(),
    users: USERS(),
    content: CONTENT(),
    schools: SCHOOLS(),
    schoolConfigs: [],
    accessRules: [EXISTING_RULE],
});

/** Cohorte limpia (sin STOP) para apply / idempotencia / rollback. */
const cleanState = () => ({
    groups: [
        { id: 'g-with-rule', name: 'G1', type: 'course', organizationId: ORG_A, memberIds: ['u-a1'], studentIds: ['u-a1'] },
        { id: 'g-plain', name: 'G2', type: 'course', organizationId: ORG_A, memberIds: ['u-a2'], studentIds: ['u-a2'] },
        { id: 'g-infer', name: 'G3', type: 'course', memberIds: ['u-a1'], studentIds: ['u-a1'] },
        { id: 'g-fallback', name: 'G8', type: 'course', school: 'Colegio Gamma', organizationId: ORG_A },
    ],
    users: USERS(),
    content: CONTENT(),
    schools: SCHOOLS(),
    schoolConfigs: [],
    accessRules: [EXISTING_RULE],
});

// ── §1 Derivación de contenido ──────────────────────────────────────────────

section('§1 — derivación determinista del catálogo');
{
    const d = deriveOpenCatalog(CONTENT());
    ok('el catálogo abierto respeta publicación y pedagogía',
        canon(d.openCatalog) === canon(OPEN_CATALOG), canon(d.openCatalog));
    ok('cuenta lo descartado por publicación', d.droppedByPublication === 1);
    ok('cuenta lo descartado por pedagogía', d.droppedByPedagogy === 1);
    ok('un nodo de Experience (standalone:false) NO se retira',
        d.openCatalog.includes('c-embedded'));
    ok('la derivación es determinista',
        canon(deriveOpenCatalog(CONTENT()).openCatalog) === canon(d.openCatalog));
}

// ── §2 Clasificación de grupos ──────────────────────────────────────────────

section('§2 — clasificación de grupos y organización');
const cls = computePlan(classificationState(), { now: Date.UTC(2026, 8, 15) });
{
    const p = cls.plan;
    const reasonOf = (gid) => p.unresolved.find(u => u.groupId === gid)?.reason;

    ok('grupo válido con regla existente queda ya explícito y su regla intacta',
        p.rules.untouchedPreexisting === 1
        && !cls.operations.some(o => o.recordId === ruleIdForGroup('g-with-rule')),
        canon(p.rules));
    ok('grupo válido sin regla recibe regla determinista',
        cls.operations.some(o => o.store === 'access' && o.recordId === ruleIdForGroup('g-plain')));
    ok('y también availableContentIds coherente',
        cls.operations.some(o => o.store === 'groups' && o.recordId === 'g-plain'
            && o.field === 'availableContentIds' && canon(o.value) === canon(OPEN_CATALOG)));
    ok('organización inferible inequívocamente se infiere',
        p.groups.organizationInferred >= 1
        && cls.operations.some(o => o.recordId === 'g-infer' && o.field === 'organizationId' && o.value === ORG_A));
    ok('institución inexistente pero inferible se resuelve por los principals',
        cls.operations.some(o => o.recordId === 'g-badorg' && o.field === 'organizationId' && o.value === ORG_A));
    ok('dos instituciones posibles ⇒ STOP_AMBIGUOUS_ORGANIZATION',
        reasonOf('g-ambiguous') === 'STOP_AMBIGUOUS_ORGANIZATION'
        && p.conflicts.some(c => c.kind === 'STOP_AMBIGUOUS_ORGANIZATION' && c.groupId === 'g-ambiguous'));
    // B3: un grupo cuya única referencia apunta a una cuenta inexistente no
    // tiene membresías vivas ⇒ es inerte y NO se le infiere organización.
    ok('institución inválida SIN evidencia y sin principals vivos ⇒ inerte',
        reasonOf('g-badorg-noev') === undefined
        && p.orphanGroups.inertEmptyLegacy.includes('g-badorg-noev')
        && !cls.operations.some(o => o.recordId === 'g-badorg-noev'));
    ok('grupo vacío ⇒ inerte, sin escrituras',
        p.orphanGroups.inertEmptyLegacy.includes('g-empty')
        && !cls.operations.some(o => o.recordId === 'g-empty'));
    ok('no existe política canónica de archivo ⇒ no se propone archivar nada',
        GROUP_ARCHIVE_POLICY.available === false
        && p.groups.emptyProposedForArchive === 0
        && p.orphanGroups.archivableByExistingPolicy.length === 0);
    ok('el huérfano ambiguo con principals VIVOS sigue en decisión humana',
        p.orphanGroups.humanDecisionRequired.includes('g-ambiguous')
        && !p.orphanGroups.inertEmptyLegacy.includes('g-ambiguous'));
    ok('los resolubles se listan aparte',
        p.orphanGroups.deterministicallyResolvable.includes('g-infer')
        && p.orphanGroups.deterministicallyResolvable.includes('g-badorg'));
    ok('el plan no imprime datos personales',
        !JSON.stringify(p).includes('@example.invalid') && !JSON.stringify(p).includes('Lector u-'));
}

// ── §2bis Estado operativo del grupo (B3) ───────────────────────────────────
// La regla es GENERAL: depende de señales del modelo (principals vivos, regla
// activa, mediador vivo, catálogo explícito), nunca de la identidad del grupo.

section('§2bis — GROUP_OPERATIONAL_STATUS');
{
    const disabled = (id, org) => ({ ...lector(id, org, 'Colegio Alfa'), accountStatus: 'disabled' });
    const base = (groups, users, accessRules = []) => computePlan({
        groups, users, content: CONTENT(), schools: SCHOOLS(), schoolConfigs: [], accessRules,
    }, { now: Date.UTC(2026, 8, 15) });
    const writesFor = (r, gid) => r.operations.filter(o =>
        o.recordId === gid || (o.store === 'access' && o.value?.scopeId === gid)).length;

    // A — cuentas activas ⇒ operativo, plan intacto.
    {
        const r = base([{ id: 'g-live', type: 'course', organizationId: ORG_A, memberIds: ['u-a1'], studentIds: ['u-a1'] }], USERS());
        ok('A · grupo con cuentas activas sigue operativo',
            r.plan.groups.inertEmptyLegacy === 0 && r.plan.groups.operational === 1);
        ok('A · y conserva su regla y su catálogo',
            r.operations.some(o => o.store === 'access' && o.recordId === ruleIdForGroup('g-live'))
            && r.operations.some(o => o.recordId === 'g-live' && o.field === 'availableContentIds'));
    }
    // B — referencias a principals inexistentes ⇒ inerte, 0 writes.
    {
        const r = base([{ id: 'g-dead', type: 'course', memberIds: ['u-noexiste'], studentIds: ['u-noexiste'] }], USERS());
        ok('B · referencias muertas ⇒ INERT_EMPTY_LEGACY_GROUP',
            r.plan.orphanGroups.inertEmptyLegacy.includes('g-dead'));
        ok('B · y cero escrituras para ese grupo', writesFor(r, 'g-dead') === 0 && r.plan.writesRequired === 0);
    }
    // C — cohorte deshabilitada + regla expirada ⇒ inerte, 0 writes.
    {
        const cohort = Array.from({ length: 400 }, (_, i) => disabled(`u-lt-${i}`, ORG_A));
        const ids = cohort.map(u => u.id);
        const expiredRule = { id: 'rule-historica', scope: 'group', scopeId: 'g-synthetic', titleIds: ['c-open-1'], collectionIds: [], expiresAt: 1 };
        const r = base([{ id: 'g-synthetic', type: 'course', memberIds: ids, studentIds: ids }], cohort, [expiredRule]);
        ok('C · 400 cuentas disabled + regla expirada ⇒ INERT_EMPTY_LEGACY_GROUP',
            r.plan.orphanGroups.inertEmptyLegacy.includes('g-synthetic'));
        ok('C · cero reglas, cero catálogo, cero memberships, cero organización',
            writesFor(r, 'g-synthetic') === 0 && r.plan.writesRequired === 0
            && r.plan.rules.toCreateOrReplace === 0 && r.plan.content.catalogsToMaterialize === 0
            && r.plan.memberships.toCreate === 0);
        ok('C · la regla expirada se preserva intacta como evidencia',
            r.plan.rules.untouchedPreexisting === 1
            && !r.operations.some(o => o.recordId === 'rule-historica'));
        ok('C · F · idempotencia: un grupo inerte sigue no-op en la segunda pasada',
            base([{ id: 'g-synthetic', type: 'course', memberIds: ids, studentIds: ids }], cohort, [expiredRule]).plan.writesRequired === 0);
    }
    // D — sin membresías vivas pero con regla ACTIVA ⇒ NO se excluye.
    {
        const activeRule = { id: 'rule-viva', scope: 'group', scopeId: 'g-ruled', titleIds: ['c-open-1'], collectionIds: [], expiresAt: null };
        const r = base([{ id: 'g-ruled', type: 'course', organizationId: ORG_A, memberIds: ['u-noexiste'], studentIds: ['u-noexiste'] }], USERS(), [activeRule]);
        ok('D · regla activa impide clasificar como inerte',
            !r.plan.orphanGroups.inertEmptyLegacy.includes('g-ruled')
            && r.plan.groups.operational === 1);
        ok('D · y la regla ajena viva se preserva sin duplicar',
            r.plan.groups.alreadyExplicit === 1 && !r.operations.some(o => o.store === 'access'));
    }
    // E — sin membresías vivas pero con otra referencia operativa ⇒ NO se excluye.
    {
        const mediador = { ...lector('u-med', ORG_A, 'Colegio Alfa'), roles: ['mediador'] };
        const r = base([{ id: 'g-med', type: 'course', organizationId: ORG_A, memberIds: [], studentIds: [], mediatorIds: ['u-med'] }], [...USERS(), mediador]);
        ok('E · un mediador vivo mantiene el grupo operativo',
            !r.plan.orphanGroups.inertEmptyLegacy.includes('g-med'));
        const rc = base([{ id: 'g-cat', type: 'course', organizationId: ORG_A, memberIds: [], studentIds: [], availableContentIds: ['c-open-1'] }], USERS());
        ok('E · un catálogo explícito declarado mantiene el grupo operativo',
            !rc.plan.orphanGroups.inertEmptyLegacy.includes('g-cat'));
    }
    // §6 — INVARIANTE: añadir grupos inertes no altera el plan de los
    // operativos. Se prueba por igualdad de planes, no por cifras fijas.
    {
        const operativos = () => [
            { id: 'g-live', type: 'course', organizationId: ORG_A, memberIds: ['u-a1'], studentIds: ['u-a1'] },
            { id: 'g-live-2', type: 'course', organizationId: ORG_B, memberIds: ['u-b1'], studentIds: ['u-b1'] },
        ];
        const cohort = Array.from({ length: 400 }, (_, i) => ({ ...lector(`u-lt-${i}`, ORG_A, 'Colegio Alfa'), accountStatus: 'disabled' }));
        const ids = cohort.map(u => u.id);
        const inertes = [
            { id: 'g-synthetic', type: 'course', memberIds: ids, studentIds: ids },
            { id: 'g-dead', type: 'course', memberIds: ['u-noexiste'], studentIds: ['u-noexiste'] },
            { id: 'g-empty2', type: 'course', memberIds: [], studentIds: [] },
        ];
        const expired = { id: 'rule-vieja', scope: 'group', scopeId: 'g-synthetic', titleIds: ['c-open-1'], collectionIds: [], expiresAt: 1 };
        const solo = base(operativos(), USERS(), []);
        const mixto = base([...operativos(), ...inertes], [...USERS(), ...cohort], [expired]);
        ok('§6 · los grupos inertes no cambian el plan de los operativos',
            canon(mixto.operations) === canon(solo.operations));
        ok('§6 · y el total de escrituras es exactamente el de los operativos',
            mixto.plan.writesRequired === solo.plan.writesRequired
            && mixto.plan.groups.inertEmptyLegacy === 3
            && mixto.plan.groups.operational === 2);
        ok('§6 · el catálogo se materializa sólo para los operativos',
            mixto.plan.content.catalogsToMaterialize === solo.plan.content.catalogsToMaterialize
            && [...mixto.materializedCatalogs.keys()].every(g => !g.startsWith('g-synthetic') && g !== 'g-dead' && g !== 'g-empty2'));
    }

    // G — sin regresión: el guard cross-tenant sigue actuando sobre operativos.
    {
        const r = base([{ id: 'g-xt', type: 'course', school: 'Colegio Delta', organizationId: ORG_A, memberIds: [], studentIds: [] }], USERS());
        ok('G · el guard cross-tenant sigue rechazando con la clasificación activa',
            r.plan.memberships.crossTenantRejected === 1
            && r.plan.conflicts.some(c => c.kind === 'CROSS_TENANT_MEMBERSHIP_REJECTED')
            && !r.operations.some(o => o.store === 'users'));
        ok('G · los grupos inertes no aparecen como unresolved',
            cls.plan.orphanGroups.inertEmptyLegacy.length > 0
            && cls.plan.unresolved.every(u => !cls.plan.orphanGroups.inertEmptyLegacy.includes(u.groupId)));
    }
}

// ── §2ter Cross-tenant sobre mediatorIds (ISOLATION-MEDIATOR-01) ────────────
// Un mediador es un principal del grupo igual que un miembro: su regla de
// scope `group` le aplica. El guard debe tratarlo con la misma semántica.

section('§2ter — cross-tenant en mediatorIds');
{
    const mediador = (id, org) => ({ ...lector(id, org, 'Colegio Alfa'), roles: ['mediador'] });
    const usersXT = () => [...USERS(), mediador('u-med-a', ORG_A), mediador('u-med-a2', ORG_A), mediador('u-med-b', ORG_B)];
    const viasOf = (v) => [...new Set(v.map(x => x.via))].sort();

    // A — mediador de la misma organización ⇒ permitido.
    {
        const g = [{ id: 'g-a', type: 'course', organizationId: ORG_A, mediatorIds: ['u-med-a'], memberIds: [], studentIds: [] }];
        ok('A · mediador de la MISMA organización no es violación',
            assertNoCrossTenant(g, usersXT(), SCHOOLS()).length === 0);
    }
    // B — mediador de otra organización ⇒ violación.
    {
        const g = [{ id: 'g-b', type: 'course', organizationId: ORG_A, mediatorIds: ['u-med-b'], memberIds: [], studentIds: [] }];
        const v = assertNoCrossTenant(g, usersXT(), SCHOOLS());
        ok('B · mediador de OTRA organización ⇒ CROSS_TENANT_VIOLATION',
            v.length === 1 && v[0].groupId === 'g-b' && v[0].via === 'mediatorIds');
    }
    // C — dos válidos + uno cross-tenant ⇒ el grupo falla.
    {
        const g = [{ id: 'g-c', type: 'course', organizationId: ORG_A, mediatorIds: ['u-med-a', 'u-med-a2', 'u-med-b'], memberIds: [], studentIds: [] }];
        const v = assertNoCrossTenant(g, usersXT(), SCHOOLS());
        ok('C · un solo mediador ajeno basta para que el grupo falle',
            v.length === 1 && v[0].groupId === 'g-c');
    }
    // D — memberIds/studentIds conservan su comportamiento exacto.
    {
        const gMember = [{ id: 'g-d', type: 'course', organizationId: ORG_A, memberIds: ['u-b1'], studentIds: ['u-b1'] }];
        const v = assertNoCrossTenant(gMember, usersXT(), SCHOOLS());
        ok('D · miembro ajeno en memberIds+studentIds sigue contando UNA vez',
            v.length === 1 && v[0].groupId === 'g-d');
        const gOk = [{ id: 'g-d2', type: 'course', organizationId: ORG_A, memberIds: ['u-a1'], studentIds: ['u-a1'] }];
        ok('D · miembro de la misma organización sigue sin ser violación',
            assertNoCrossTenant(gOk, usersXT(), SCHOOLS()).length === 0);
        // el canal se reporta, y para miembros sigue siendo memberIds
        ok('D · el canal reportado distingue la vía', viasOf(v).join() === 'memberIds');
    }
    // E — referencia muerta: tenant no resoluble ⇒ NO es violación (política previa).
    {
        const g = [{ id: 'g-e', type: 'course', organizationId: ORG_A, mediatorIds: ['u-inexistente'], teacherId: 'u-inexistente', memberIds: [], studentIds: [] }];
        ok('E · mediatorId muerto no se convierte en principal vivo',
            assertNoCrossTenant(g, usersXT(), SCHOOLS()).length === 0);
        const gNoOrg = [{ id: 'g-e2', type: 'course', organizationId: ORG_A, mediatorIds: ['u-sin-org'], memberIds: [], studentIds: [] }];
        ok('E · principal sin organizationId no es violación (misma política)',
            assertNoCrossTenant(gNoOrg, [...usersXT(), { id: 'u-sin-org', roles: ['mediador'] }], SCHOOLS()).length === 0);
    }
    // F — accountStatus: el guard no lo evalúa, ni antes ni ahora.
    {
        const disabled = { ...mediador('u-med-b-off', ORG_B), accountStatus: 'disabled' };
        const g = [{ id: 'g-f', type: 'course', organizationId: ORG_A, mediatorIds: ['u-med-b-off'], memberIds: [], studentIds: [] }];
        ok('F · el guard mantiene su contrato: no introduce elegibilidad por accountStatus',
            assertNoCrossTenant(g, [...usersXT(), disabled], SCHOOLS()).length === 1);
    }
    // teacherId colgante cross-org también se cubre.
    {
        const g = [{ id: 'g-t', type: 'course', organizationId: ORG_A, teacherId: 'u-med-b', mediatorIds: [], memberIds: [], studentIds: [] }];
        const v = assertNoCrossTenant(g, usersXT(), SCHOOLS());
        ok('teacherId de otra organización también se detecta',
            v.length === 1 && v[0].via === 'teacherId');
    }
    // grupo sin organización válida: se sigue saltando entero.
    {
        const g = [{ id: 'g-noorg', type: 'course', mediatorIds: ['u-med-b'], memberIds: ['u-b1'], studentIds: [] }];
        ok('grupo sin organización válida se sigue omitiendo',
            assertNoCrossTenant(g, usersXT(), SCHOOLS()).length === 0);
    }
}

// ── §3 Membresías ───────────────────────────────────────────────────────────

section('§3 — membresías');
{
    const p = cls.plan;
    ok('las membresías explícitas existentes se preservan y NO se recrean',
        p.memberships.preserved >= 6
        && !cls.operations.some(o => o.store === 'groups' && o.recordId === 'g-plain' && o.field === 'memberIds'),
        canon(p.memberships));
    ok('el fallback colegio determinado por el runtime se materializa',
        p.memberships.toCreate === 1
        && cls.operations.some(o => o.store === 'groups' && o.recordId === 'g-fallback' && o.field === 'memberIds'
            && canon(o.value) === canon(['u-c1'])));
    ok('la bidirección user.groupIds se materializa a la vez',
        cls.operations.some(o => o.store === 'users' && o.recordId === 'u-c1' && o.field === 'groupIds'
            && canon(o.value) === canon(['g-fallback'])));
    ok('cross-tenant rechazado (u-d1 es de otra organización)',
        p.memberships.crossTenantRejected === 1
        && p.conflicts.some(c => c.kind === 'CROSS_TENANT_MEMBERSHIP_REJECTED' && c.groupId === 'g-crosstenant')
        && !cls.operations.some(o => o.recordId === 'g-crosstenant' && o.field === 'memberIds'));
}

// ── §4 Contenido: configuración institucional y ambigüedad ──────────────────

section('§4 — contenido derivado del resolver real');
{
    const st = classificationState();
    st.schoolConfigs = [{
        schoolName: 'Colegio Alfa',
        availableContentIds: ['c-open-1', 'c-unpublished', 'c-pedagogy'],
        collectionIds: ['c-col'],
    }];
    const { operations } = computePlan(st, { now: Date.UTC(2026, 8, 15) });
    const op = operations.find(o => o.recordId === 'g-plain' && o.field === 'availableContentIds');
    ok('la restricción institucional activa se respeta y se intersecta con el catálogo abierto',
        canon(op.value) === canon(['c-in-col', 'c-open-1']), canon(op?.value));

    const amb = computePlan(st, { now: Date.UTC(2026, 8, 15) }).plan;
    ok('miembros con conjuntos efectivos divergentes ⇒ STOP_AMBIGUOUS_CONTENT',
        amb.conflicts.some(c => c.kind === 'STOP_AMBIGUOUS_CONTENT' && c.groupId === 'g-ambiguous'),
        canon(amb.conflicts.map(c => c.kind)));

    const st2 = classificationState();
    st2.groups = [{ id: 'g-old', name: 'X', type: 'course', organizationId: ORG_A, memberIds: ['u-a1'], studentIds: ['u-a1'], accessEndsAt: '2020-01-01T00:00:00.000Z' }];
    const inactive = computePlan(st2, { now: Date.UTC(2026, 8, 15) });
    ok('un grupo fuera de vigencia no recibe catálogo (hoy no concede nada)',
        inactive.plan.groups.inactive === 1
        && !inactive.operations.some(o => o.field === 'availableContentIds'));

    const st3 = classificationState();
    st3.groups = [{ id: 'g-legacy', name: 'Y', type: 'course', organizationId: ORG_A, memberIds: ['u-a1'], studentIds: ['u-a1'], availableContentIds: ['c-open-2'] }];
    const legacy = computePlan(st3, { now: Date.UTC(2026, 8, 15) });
    ok('un catálogo legacy ya explícito se preserva intacto',
        legacy.plan.groups.alreadyExplicit === 1
        && !legacy.operations.some(o => o.recordId === 'g-legacy'));
}

// ── §5 Apply / idempotencia / reconciliación / rollback ─────────────────────

function materialize(state) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-v6-explicit-'));
    const w = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 2));
    w('groups_db.json', state.groups);
    w('access_db.json', state.accessRules);
    w('content.json', state.content);
    w('schools_db.json', state.schools);
    w('school_configs.json', state.schoolConfigs);
    w('users_db.json', state.users);
    return { dir, usersFile: path.join(dir, 'users_db.json') };
}
const readStore = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const rawStore = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const NOW = Date.UTC(2026, 8, 15);

section('§5 — apply, idempotencia y reconciliación');
{
    const { dir, usersFile } = materialize(cleanState());
    const before = {
        groups: rawStore(dir, 'groups_db.json'),
        access: rawStore(dir, 'access_db.json'),
        users: rawStore(dir, 'users_db.json'),
    };

    const dry = await run({ root: dir, usersFile, mode: 'dry-run', now: NOW });
    ok('dry-run es el modo por defecto y no escribe',
        dry.applied === false && rawStore(dir, 'groups_db.json') === before.groups);
    ok('el plan se calcula completo antes de escribir', dry.plan.writesRequired > 0);

    let refused = null;
    try { await run({ root: dir, usersFile, mode: 'apply', now: NOW }); }
    catch (e) { refused = e; }
    ok('apply sin --manifest-out se rechaza (sin rollback no se escribe)',
        refused instanceof MigrationStop && refused.code === 'MANIFEST_OUT_REQUIRED');
    ok('y no tocó nada', rawStore(dir, 'groups_db.json') === before.groups);

    process.env.IDENTITY_DUAL_WRITE = '1';
    let blocked = null;
    try { await run({ root: dir, usersFile, mode: 'apply', manifestOut: path.join(dir, 'm.json'), now: NOW }); }
    catch (e) { blocked = e; }
    delete process.env.IDENTITY_DUAL_WRITE;
    ok('con IDENTITY_DUAL_WRITE el apply se bloquea (mismo guard canónico)',
        blocked instanceof MigrationStop
        && blocked.code === 'IDENTITY_WRITE_SURFACE_BLOCKED_UNDER_DUAL_WRITE');
    ok('y tampoco tocó nada', rawStore(dir, 'groups_db.json') === before.groups);

    const manifestPath = path.join(dir, 'rollback.manifest.json');
    const applied = await run({ root: dir, usersFile, mode: 'apply', manifestOut: manifestPath, now: NOW });
    ok('apply exige opción explícita y se ejecuta', applied.status === 'APPLIED' && applied.applied === true);
    ok('el manifiesto de preimagen existe', fs.existsSync(manifestPath));
    ok('primera aplicación converge: 0 escrituras pendientes', applied.postState.writesRequired === 0);
    ok('reconciliación regla ↔ availableContentIds sin divergencias',
        applied.postState.reconciliation.mismatches.length === 0
        && applied.postState.reconciliation.checked >= 2, canon(applied.postState.reconciliation));
    ok('cero relaciones cross-tenant tras el apply', applied.postState.crossTenantViolations === 0);

    const groupsAfter = readStore(dir, 'groups_db.json');
    const accessAfter = readStore(dir, 'access_db.json');
    ok('la regla preexistente sigue byte a byte en su sitio',
        canon(accessAfter.find(r => r.id === EXISTING_RULE.id)) === canon(EXISTING_RULE));
    ok('el grupo con regla ajena no recibió catálogo materializado',
        groupsAfter.find(g => g.id === 'g-with-rule').availableContentIds === undefined);
    ok('la regla creada usa el id determinista y expiresAt null',
        accessAfter.some(r => r.id === ruleIdForGroup('g-plain') && r.expiresAt === null
            && canon(r.titleIds) === canon(OPEN_CATALOG)));
    ok('la organización inferida quedó persistida',
        groupsAfter.find(g => g.id === 'g-infer').organizationId === ORG_A);
    ok('la membresía del fallback quedó explícita y bidireccional',
        canon(groupsAfter.find(g => g.id === 'g-fallback').memberIds) === canon(['u-c1'])
        && canon(readStore(dir, 'users_db.json').find(u => u.id === 'u-c1').groupIds) === canon(['g-fallback']));

    const second = await run({ root: dir, usersFile, mode: 'apply', manifestOut: path.join(dir, 'm2.json'), now: NOW });
    ok('segunda aplicación = no-op', second.status === 'NO_OP' && second.plan.writesRequired === 0);
    ok('el no-op no escribe manifiesto nuevo', !fs.existsSync(path.join(dir, 'm2.json')));

    const dup = readStore(dir, 'access_db.json').filter(r => r.id.startsWith(RULE_ID_PREFIX));
    ok('cero duplicados de regla', dup.length === new Set(dup.map(r => r.id)).size);
    ok('cero duplicados de membresía',
        readStore(dir, 'groups_db.json').every(g => {
            const m = g.memberIds || []; const s = g.studentIds || [];
            return m.length === new Set(m).size && s.length === new Set(s).size;
        }));

    const verified = await run({ root: dir, usersFile, mode: 'verify', now: NOW });
    ok('verify reporta RECONCILED', verified.status === 'RECONCILED');
    ok('assertNoCrossTenant sobre el estado final = 0',
        assertNoCrossTenant(readStore(dir, 'groups_db.json'), readStore(dir, 'users_db.json'), SCHOOLS()).length === 0);

    section('§6 — rollback específico');
    const rb = await rollback({ manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) });
    ok('el rollback restituye todos los registros tocados',
        rb.restored === dry.plan.writesRequired && rb.skipped.length === 0, canon(rb.skipped));
    ok('groups_db vuelve exactamente al estado previo', rawStore(dir, 'groups_db.json') === before.groups);
    ok('access_db vuelve exactamente al estado previo', rawStore(dir, 'access_db.json') === before.access);
    ok('users_db vuelve exactamente al estado previo', rawStore(dir, 'users_db.json') === before.users);

    const replan = await run({ root: dir, usersFile, mode: 'dry-run', now: NOW });
    ok('tras el rollback el plan vuelve a ser el original',
        replan.plan.writesRequired === dry.plan.writesRequired);

    fs.rmSync(dir, { recursive: true, force: true });
}

section('§7 — rollback no pisa actividad ajena posterior');
{
    const { dir, usersFile } = materialize(cleanState());
    const manifestPath = path.join(dir, 'rb.json');
    await run({ root: dir, usersFile, mode: 'apply', manifestOut: manifestPath, now: NOW });

    // Actividad ajena: un tercero reescribe el catálogo de g-plain y añade un
    // grupo nuevo después del apply.
    const groups = readStore(dir, 'groups_db.json');
    groups.find(g => g.id === 'g-plain').availableContentIds = ['c-open-2'];
    groups.push({ id: 'g-nuevo', name: 'Z', type: 'course', organizationId: ORG_A, memberIds: [], studentIds: [] });
    fs.writeFileSync(path.join(dir, 'groups_db.json'), JSON.stringify(groups, null, 2));

    const rb = await rollback({ manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) });
    const after = readStore(dir, 'groups_db.json');
    ok('el campo modificado por un tercero NO se pisa',
        canon(after.find(g => g.id === 'g-plain').availableContentIds) === canon(['c-open-2'])
        && rb.skipped.some(s => s.why === 'MODIFIED_AFTER_APPLY'));
    ok('el registro ajeno posterior sobrevive intacto', after.some(g => g.id === 'g-nuevo'));
    ok('el resto sí se revierte', after.find(g => g.id === 'g-infer').organizationId === undefined);

    fs.rmSync(dir, { recursive: true, force: true });
}

section('§8 — estado parcialmente migrado');
{
    const { dir, usersFile } = materialize(cleanState());
    const full = computePlan({ ...cleanState() }, { now: NOW });

    // Simula una interrupción: solo se aplican las operaciones de `access`.
    const partial = full.operations.filter(o => o.store === 'access');
    await M.applyOperations(
        M.resolvePaths({ root: dir, usersFile }), partial, { direction: 'forward' });

    const resumed = await run({ root: dir, usersFile, mode: 'dry-run', now: NOW });
    ok('el plan replanifica exactamente lo que falta',
        resumed.plan.writesRequired === full.operations.length - partial.length,
        `${resumed.plan.writesRequired} vs ${full.operations.length - partial.length}`);
    ok('no reprograma las reglas ya escritas',
        !resumed.plan.conflicts.some(c => c.kind.startsWith('STOP_')));

    const done = await run({ root: dir, usersFile, mode: 'apply', manifestOut: path.join(dir, 'p.json'), now: NOW });
    ok('reanudar converge al mismo estado final', done.postState.writesRequired === 0);
    const rec = reconcileRuleAgainstGroup(readStore(dir, 'groups_db.json'), readStore(dir, 'access_db.json'));
    ok('y reconcilia ambas estructuras', rec.mismatches.length === 0 && rec.checked >= 2);

    fs.rmSync(dir, { recursive: true, force: true });
}

section('§9 — apply bloqueado por conflictos STOP');
{
    const { dir, usersFile } = materialize(classificationState());
    let err = null;
    try { await run({ root: dir, usersFile, mode: 'apply', manifestOut: path.join(dir, 'x.json'), now: NOW }); }
    catch (e) { err = e; }
    ok('un STOP en el plan impide cualquier escritura',
        err instanceof MigrationStop && err.code === 'BLOCKING_CONFLICTS');
    ok('y no se escribió manifiesto', !fs.existsSync(path.join(dir, 'x.json')));
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
