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
    ok('institución inválida SIN evidencia no se infiere',
        reasonOf('g-badorg-noev') === 'INVALID_ORGANIZATION_REFERENCE_NO_EVIDENCE'
        && !cls.operations.some(o => o.recordId === 'g-badorg-noev' && o.field === 'organizationId'));
    ok('grupo vacío queda sin resolver', reasonOf('g-empty') === 'EMPTY_GROUP_NO_EVIDENCE');
    ok('no existe política canónica de archivo ⇒ no se propone archivar nada',
        GROUP_ARCHIVE_POLICY.available === false
        && p.groups.emptyProposedForArchive === 0
        && p.orphanGroups.archivableByExistingPolicy.length === 0);
    ok('los huérfanos no resolubles caen en decisión humana',
        p.orphanGroups.humanDecisionRequired.includes('g-empty')
        && p.orphanGroups.humanDecisionRequired.includes('g-badorg-noev')
        && p.orphanGroups.humanDecisionRequired.includes('g-ambiguous'));
    ok('los resolubles se listan aparte',
        p.orphanGroups.deterministicallyResolvable.includes('g-infer')
        && p.orphanGroups.deterministicallyResolvable.includes('g-badorg'));
    ok('el plan no imprime datos personales',
        !JSON.stringify(p).includes('@example.invalid') && !JSON.stringify(p).includes('Lector u-'));
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
