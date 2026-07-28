/**
 * migrate.test.mjs — CHP-MEM-MEDIATOR-647-01A.
 *
 * TODO sobre fixtures sintéticas en mkdtemp. Ningún test toca stores reales ni
 * contiene PII: los ids son inventados.
 *
 *   node scripts/migrations/chp-mem-mediator-647/__test__/migrate.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// pathToFileURL: en Windows un import dinámico con ruta absoluta ('D:\...')
// falla con ERR_UNSUPPORTED_ESM_URL_SCHEME si no se convierte a file://.
const {
    runMediatorRepair, rollback, MigrationStop, groupHash, userFingerprint, safeResolve,
} = await import(pathToFileURL(path.join(HERE, '..', 'migrate.mjs')).href);

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => {
    if (cond) { console.log('  ✓', label); pass++; }
    else { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
};
const section = (t) => console.log(`\n${t}`);

const MED = 'u-mediador-sintetico';
const ORG = 'org-sintetica';
const GRP = 'grp-sintetico';

const baseUser = () => ({
    id: MED, email: 'med@example.invalid', nombre_completo: 'Mediador Sintetico',
    roles: ['mediador'], accountStatus: 'active', organizationId: ORG,
    groupIds: [GRP], lastLoginAt: '2026-07-01T00:00:00.000Z',
});
const baseGroup = () => ({
    id: GRP, name: 'Grupo Sintetico', type: 'course', organizationId: ORG,
    mediatorIds: [], memberIds: [MED, 'u-lector-1', 'u-lector-2'],
    studentIds: [MED, 'u-lector-1', 'u-lector-2'], teacherId: null,
});
const otherGroup = () => ({
    id: 'grp-otro', name: 'Otro', type: 'course', organizationId: 'org-otra',
    mediatorIds: ['u-otro-mediador'], memberIds: ['u-lector-9'], studentIds: ['u-lector-9'],
});

/** Crea un entorno de fixtures aislado y devuelve {root, manifest}. */
function makeEnv({ users, groups, manifestOverrides = {} } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm647_'));
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data-critical'), { recursive: true });
    const U = users ?? [baseUser(), { id: 'u-lector-1', roles: ['lector'], organizationId: ORG, accountStatus: 'active' }];
    const G = groups ?? [baseGroup(), otherGroup()];
    fs.writeFileSync(path.join(root, 'data', 'groups_db.json'), JSON.stringify(G, null, 2));
    fs.writeFileSync(path.join(root, 'data-critical', 'padron.json'), JSON.stringify(U, null, 2));
    const grp = G.find(g => g.id === GRP);
    const usr = U.find(u => u.id === MED);
    const manifest = {
        principalId: MED, groupId: GRP, organizationId: ORG,
        groupsFile: 'data/groups_db.json', usersFile: 'data-critical/padron.json',
        expectedGroupSha256: grp ? groupHash(grp) : undefined,
        expectedUserFingerprint: usr ? userFingerprint(usr) : undefined,
        forbiddenOrganizationIds: ['lt-org'],
        ...manifestOverrides,
    };
    return { root, manifest, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const readGroups = (root) => JSON.parse(fs.readFileSync(path.join(root, 'data', 'groups_db.json'), 'utf8'));
const GATE = 'GREEN';

console.log('CHP-MEM-MEDIATOR-647 — migrador de reparación de membership');

// ── [1..5] dry-run y contrato de la operación ───────────────────────────────
section('[1] Dry-run: detecta la reparación pendiente sin escribir');
{
    const env = makeEnv();
    const before = fs.readFileSync(path.join(env.root, 'data', 'groups_db.json'));
    const r = runMediatorRepair({ root: env.root, manifest: env.manifest });
    ok('status PENDING', r.status === 'PENDING', r.status);
    ok('1 cambio', r.totalChanges === 1, String(r.totalChanges));
    ok('mediatorIds 0 → 1', r.counts.mediatorIdsBefore === 0 && r.counts.mediatorIdsAfter === 1);
    ok('sólo cambia mediatorIds', JSON.stringify(r.fieldsChanged) === '["mediatorIds"]');
    ok('nada escrito en dry-run', r.written.length === 0 && r.applied === false);
    ok('el archivo no cambió', before.equals(fs.readFileSync(path.join(env.root, 'data', 'groups_db.json'))));
    env.cleanup();
}

section('[2] Apply sintético: mediatorIds +1, memberIds y studentIds intactos');
{
    const env = makeEnv();
    const r = runMediatorRepair({ root: env.root, manifest: env.manifest, apply: true, backupEvidence: GATE });
    ok('status APPLIED', r.status === 'APPLIED', r.status);
    const G = readGroups(env.root);
    const g = G.find(x => x.id === GRP);
    ok('[3] el principal sigue en memberIds', g.memberIds.includes(MED));
    ok('[4] no se añadió a studentIds (misma cardinalidad)',
        g.studentIds.filter(x => x === MED).length === 1);
    ok('está en mediatorIds exactamente una vez', g.mediatorIds.filter(x => x === MED).length === 1);
    ok('memberIds sin cambios', JSON.stringify(g.memberIds) === JSON.stringify(baseGroup().memberIds));
    ok('studentIds sin cambios', JSON.stringify(g.studentIds) === JSON.stringify(baseGroup().studentIds));
    ok('el otro grupo no cambió', JSON.stringify(G.find(x => x.id === 'grp-otro')) === JSON.stringify(otherGroup()));
    ok('nº de grupos estable', G.length === 2);
    env.cleanup();
}

section('[5] Segundo dry-run idéntico al primero');
{
    const env = makeEnv();
    const a = runMediatorRepair({ root: env.root, manifest: env.manifest });
    const b = runMediatorRepair({ root: env.root, manifest: env.manifest });
    ok('dos dry-run producen el mismo resultado', JSON.stringify(a) === JSON.stringify(b));
    env.cleanup();
}

section('[6] Segundo apply → 0 cambios (idempotente)');
{
    const env = makeEnv();
    runMediatorRepair({ root: env.root, manifest: env.manifest, apply: true, backupEvidence: GATE });
    const after1 = fs.readFileSync(path.join(env.root, 'data', 'groups_db.json'));
    const r2 = runMediatorRepair({ root: env.root, manifest: env.manifest, apply: true, backupEvidence: GATE });
    ok('status ALREADY_APPLIED', r2.status === 'ALREADY_APPLIED', r2.status);
    ok('0 cambios', r2.totalChanges === 0);
    ok('idempotent=true', r2.idempotent === true);
    ok('el archivo no cambió en el segundo apply',
        after1.equals(fs.readFileSync(path.join(env.root, 'data', 'groups_db.json'))));
    const g = readGroups(env.root).find(x => x.id === GRP);
    ok('sin duplicado en mediatorIds', g.mediatorIds.filter(x => x === MED).length === 1);
    env.cleanup();
}

// ── [7..12] STOPs ───────────────────────────────────────────────────────────
const expectStop = (label, code, fn) => {
    try { fn(); ok(label, false, 'no lanzó'); }
    catch (e) { ok(label, e instanceof MigrationStop && e.code === code, `${e.code ?? e.message}`); }
};

section('[7] Target duplicado en el padrón → STOP');
{
    const env = makeEnv({ users: [baseUser(), baseUser()] });
    expectStop('TARGET_AMBIGUOUS', 'TARGET_AMBIGUOUS',
        () => runMediatorRepair({ root: env.root, manifest: env.manifest }));
    env.cleanup();
}

section('[8] Rol distinto de mediador → STOP');
{
    const u = { ...baseUser(), roles: ['lector'] };
    const env = makeEnv({ users: [u] });
    expectStop('ROLE_MISMATCH', 'ROLE_MISMATCH',
        () => runMediatorRepair({ root: env.root, manifest: { ...env.manifest, expectedUserFingerprint: userFingerprint(u) } }));
    env.cleanup();
}

section('[9] organizationId distinto → STOP');
{
    const u = { ...baseUser(), organizationId: 'org-ajena' };
    const env = makeEnv({ users: [u] });
    expectStop('ORGANIZATION_MISMATCH (usuario)', 'ORGANIZATION_MISMATCH',
        () => runMediatorRepair({ root: env.root, manifest: { ...env.manifest, expectedUserFingerprint: userFingerprint(u) } }));
    const g2 = { ...baseGroup(), organizationId: 'org-ajena' };
    const env2 = makeEnv({ groups: [g2] });
    expectStop('ORGANIZATION_MISMATCH (grupo)', 'ORGANIZATION_MISMATCH',
        () => runMediatorRepair({ root: env2.root, manifest: { ...env2.manifest, expectedGroupSha256: groupHash(g2) } }));
    env.cleanup(); env2.cleanup();
}

section('[10] Grupo histórico o sintético → STOP');
{
    const hist = { ...baseGroup() }; delete hist.organizationId;
    const envH = makeEnv({ groups: [hist] });
    expectStop('GROUP_NOT_ACTIVE (histórico)', 'GROUP_NOT_ACTIVE',
        () => runMediatorRepair({ root: envH.root, manifest: { ...envH.manifest, expectedGroupSha256: groupHash(hist) } }));

    const synth = { ...baseGroup(), organizationId: 'lt-org' };
    const envS = makeEnv({ users: [{ ...baseUser(), organizationId: 'lt-org' }], groups: [synth] });
    expectStop('GROUP_NOT_ACTIVE (lt-org)', 'GROUP_NOT_ACTIVE',
        () => runMediatorRepair({
            root: envS.root,
            manifest: { ...envS.manifest, organizationId: 'lt-org', expectedGroupSha256: groupHash(synth), expectedUserFingerprint: undefined },
        }));
    envH.cleanup(); envS.cleanup();
}

section('[11] Principal ya presente en mediatorIds → ALREADY_APPLIED');
{
    const g = { ...baseGroup(), mediatorIds: [MED] };
    const env = makeEnv({ groups: [g] });
    const r = runMediatorRepair({ root: env.root, manifest: { ...env.manifest, expectedGroupSha256: 'hash-que-ya-no-aplica' } });
    ok('ALREADY_APPLIED sin exigir el hash previo', r.status === 'ALREADY_APPLIED', r.status);
    ok('0 cambios', r.totalChanges === 0);
    env.cleanup();
}

section('[12] Hash de grupo inesperado → STOP');
{
    const env = makeEnv({ manifestOverrides: { expectedGroupSha256: 'f'.repeat(64) } });
    expectStop('GROUP_HASH_MISMATCH', 'GROUP_HASH_MISMATCH',
        () => runMediatorRepair({ root: env.root, manifest: env.manifest }));
    env.cleanup();
}

// ── [13..14] fingerprint semántico ──────────────────────────────────────────
section('[13] Cambio SOLO de lastLoginAt no invalida el fingerprint');
{
    const env = makeEnv();
    const p = path.join(env.root, 'data-critical', 'padron.json');
    const U = JSON.parse(fs.readFileSync(p, 'utf8'));
    U.find(u => u.id === MED).lastLoginAt = '2026-12-31T23:59:59.000Z';
    fs.writeFileSync(p, JSON.stringify(U, null, 2));
    const r = runMediatorRepair({ root: env.root, manifest: env.manifest });
    ok('la reparación sigue siendo válida tras un login', r.totalChanges === 1 && r.status === 'PENDING');
    env.cleanup();
}

section('[14] Cambio de rol / groupIds / organizationId SÍ invalida');
{
    // 14a — el fingerprint en sí: comprobación directa y exhaustiva.
    // Se prueba aquí porque algunos de estos campos tienen guards dedicados que
    // disparan ANTES (ACCOUNT_NOT_ACTIVE, ORGANIZATION_MISMATCH), de modo que
    // el end-to-end no siempre llega a la comparación de fingerprint.
    const base = baseUser();
    const fpBase = userFingerprint(base);
    ok('lastLoginAt NO altera el fingerprint',
        userFingerprint({ ...base, lastLoginAt: '2030-01-01T00:00:00.000Z' }) === fpBase);
    for (const [label, mutated] of [
        ['roles', { ...base, roles: ['lector', 'mediador'] }],
        ['groupIds', { ...base, groupIds: [GRP, 'grp-nuevo'] }],
        ['organizationId', { ...base, organizationId: 'org-ajena' }],
        ['accountStatus', { ...base, accountStatus: 'suspended' }],
        ['email', { ...base, email: 'otro@example.invalid' }],
    ]) {
        ok(`${label} SÍ altera el fingerprint`, userFingerprint(mutated) !== fpBase);
    }

    // 14b — end-to-end: campos que llegan efectivamente al chequeo de fingerprint.
    for (const [label, mut] of [
        ['roles', (u) => { u.roles = ['mediador', 'coordinator']; }],
        ['groupIds', (u) => { u.groupIds = [GRP, 'grp-nuevo']; }],
        ['email', (u) => { u.email = 'otro@example.invalid'; }],
    ]) {
        const env = makeEnv();
        const p = path.join(env.root, 'data-critical', 'padron.json');
        const U = JSON.parse(fs.readFileSync(p, 'utf8'));
        mut(U.find(u => u.id === MED));
        fs.writeFileSync(p, JSON.stringify(U, null, 2));
        expectStop(`USER_FINGERPRINT_MISMATCH (${label})`, 'USER_FINGERPRINT_MISMATCH',
            () => runMediatorRepair({ root: env.root, manifest: env.manifest }));
        env.cleanup();
    }

    // 14c — accountStatus y organizationId paran antes, con su código propio.
    for (const [label, code, mut] of [
        ['accountStatus', 'ACCOUNT_NOT_ACTIVE', (u) => { u.accountStatus = 'suspended'; }],
        ['organizationId', 'ORGANIZATION_MISMATCH', (u) => { u.organizationId = 'org-ajena'; }],
    ]) {
        const env = makeEnv();
        const p = path.join(env.root, 'data-critical', 'padron.json');
        const U = JSON.parse(fs.readFileSync(p, 'utf8'));
        mut(U.find(u => u.id === MED));
        fs.writeFileSync(p, JSON.stringify(U, null, 2));
        expectStop(`${label} → ${code} (guard dedicado, precede al fingerprint)`, code,
            () => runMediatorRepair({ root: env.root, manifest: env.manifest }));
        env.cleanup();
    }
}

// ── [15] rollback ───────────────────────────────────────────────────────────
section('[15] Rollback devuelve los bytes originales');
{
    const env = makeEnv();
    const gpath = path.join(env.root, 'data', 'groups_db.json');
    const before = fs.readFileSync(gpath);
    const beforeHash = crypto.createHash('sha256').update(before).digest('hex');
    runMediatorRepair({ root: env.root, manifest: env.manifest, apply: true, backupEvidence: GATE });
    ok('el archivo cambió tras el apply',
        crypto.createHash('sha256').update(fs.readFileSync(gpath)).digest('hex') !== beforeHash);
    const rb = rollback({ root: env.root, manifest: env.manifest });
    const after = fs.readFileSync(gpath);
    ok('rollback restaura bytes idénticos', before.equals(after));
    ok('rollback reporta el hash original', rb.sha256 === beforeHash);
    env.cleanup();
}

// ── [16] sin PII en la salida ───────────────────────────────────────────────
section('[16] Cero PII en el resultado');
{
    const env = makeEnv();
    const r = runMediatorRepair({ root: env.root, manifest: env.manifest });
    const s = JSON.stringify(r);
    ok('sin email', !s.includes('example.invalid'));
    ok('sin nombre', !s.includes('Mediador Sintetico'));
    ok('sin principalId', !s.includes(MED));
    env.cleanup();
}

// ── [17] aislamiento: ningún store real ─────────────────────────────────────
section('[17] Aislamiento de stores reales');
{
    const env = makeEnv();
    ok('root es un directorio temporal', env.root.startsWith(fs.realpathSync(os.tmpdir())) || env.root.includes('m647_'));
    expectStop('path escape rechazado', 'PATH_ESCAPE',
        () => safeResolve(env.root, '../../../etc/passwd'));
    expectStop('root obligatorio', 'ROOT_REQUIRED',
        () => runMediatorRepair({ manifest: env.manifest }));
    expectStop('apply sin backup gate → STOP', 'BACKUP_GATE_NOT_GREEN',
        () => runMediatorRepair({ root: env.root, manifest: env.manifest, apply: true, backupEvidence: 'quizas' }));
    env.cleanup();
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
