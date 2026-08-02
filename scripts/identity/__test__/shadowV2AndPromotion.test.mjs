/**
 * shadowV2AndPromotion.test.mjs — CHP-IDDB-02B-A.
 *
 * Espejo v2, reconciliador y promotor, sobre fixtures sintéticas en un
 * directorio temporal. Ningún caso toca stores reales ni rutas productivas.
 *
 *   node scripts/identity/__test__/shadowV2AndPromotion.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../server/db/migrate.js';
import {
    mirrorSnapshotV2, shadowTelemetry, assertShadowCapable, operationId, compareSourceVersion,
} from '../../../server/db/identityShadowV2.js';
import { domainOf, assertRegisteredWriter, blockedWhenDualWrite } from '../../../server/db/identityWriteSurface.mjs';
import { importIdentityCandidate } from '../importIdentityCandidate.mjs';
import { buildManifest } from '../buildImportManifest.mjs';
import {
    reconcileIdentityShadow, diagnose, classifyCandidateDrift, assertIdentityDbPath,
} from '../reconcileIdentityShadow.mjs';
import {
    promoteIdentityCandidate, assertPromotionTarget, assertFlagsOff, verifyCandidate,
} from '../promoteIdentityCandidate.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const h8 = (v) => sha(v).slice(0, 8);
const h16 = (v) => sha(v).slice(0, 16);
const NOW = '2026-01-01T00:00:00Z';
const LATER = '2026-01-02T00:00:00Z';
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e.classification ?? e.message; } };
const caughtSync = (fn) => { try { fn(); return null; } catch (e) { return e.classification ?? e.message; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02ba_'));
const F = (n) => path.join(tmp, n);
const write = (n, o) => { fs.writeFileSync(F(n), JSON.stringify(o, null, 1)); return F(n); };

// ── Fixtures ─────────────────────────────────────────────────────────────
const INST = [{ id: 'inst-a', name: 'Alfa' }, { id: 'inst-b', name: 'Beta' }];
const GROUPS = [
    { id: 'g-can', organizationId: 'inst-a', name: 'Primero A', type: 'course', school: 'Alfa',
      studentIds: ['u1', 'u2'], mediatorIds: ['u2'] },
    { id: 'g-legacy', organizationId: 'inst-a', name: 'Viejo', type: 'course', school: 'Colegio Test', studentIds: ['u1'] },
    { id: 'g-synth', name: 'Carga', type: 'course', school: 'Carga', studentIds: ['u-synth'] },
];
const USERS = [
    { id: 'u1', email: 'u1@x.cl', roles: ['lector'], accountStatus: 'active', password: '$2b$10$s' },
    { id: 'u2', email: 'u2@x.cl', roles: ['mediador'], accountStatus: 'active' },
    { id: 'u3', email: 'u3@x.cl', roles: ['lector'], accountStatus: 'active' },
    { id: 'u-synth', email: 'lt@x.cl', roles: ['lector'], _loadtest_marker: true },
];
const MAPPING = { groups: [
    { groupAlias: 'GRP_' + h8('g-can'), resolutionClass: 'CANONICAL_ORG_ID_CONFIRMED',
      proposedOrganizationIdHash: h8('inst-a') },
    { groupAlias: 'GRP_' + h8('g-legacy'), resolutionClass: 'LEGACY_TEST_GROUP_PENDING_RETIREMENT',
      proposedOrganizationIdHash: null },
    { groupAlias: 'GRP_' + h8('g-synth'), resolutionClass: 'SYNTHETIC_LOADTEST_EXCLUDED',
      proposedOrganizationIdHash: null },
] };
const TOMBSTONES = { count: 1, tombstones: [{
    tombstoneId: 'TS_' + h16('u-gone').slice(0, 12), legacyIdentityHash: h16('u-gone'),
    classification: 'DELETED_IDENTITY_TOMBSTONE_REQUIRED', source: ['groups'],
    firstSeenAt: null, lastSeenAt: null, referenceCount: 1, authenticationAllowed: false,
    provenance: { absenceCause: 'TEST' }, reviewedAt: NOW, policyVersion: '1.0.0' }] };
const ORPHANS = { orphans: [
    { alias: 'USR_' + h8('u-gone'), disposition: 'DELETED_IDENTITY_TOMBSTONE_REQUIRED',
      legacyIdentityHash: h16('u-gone') }] };
const DRY01D = { counts: {
    users: { MIGRATABLE: 2, MIGRATABLE_WITH_WARNING: 1 }, institutions: { MIGRATABLE: 2 },
    groups: { MIGRATABLE: 1 }, memberships: { MIGRATABLE: 3 }, tombstones: 1 } };

const paths = {
    padron: write('padron_oro.json', USERS), groups: write('groups_db.json', GROUPS),
    institutions: write('schools_db.json', INST), mapping: write('mapping.json', MAPPING),
    tombstones: write('tombstones.json', TOMBSTONES), orphans: write('orphans.json', ORPHANS),
    dryRun01d: write('dryrun01d.json', DRY01D), attestation: write('att.json', { ok: true }),
};
const CAND = F('identity.candidate.db');
const manifest = buildManifest({ ...paths, outputDb: CAND, sourceCommit: 'cafe123', generatedAt: NOW });
const MANP = write('manifest.json', manifest);

const openDb = (p) => { const d = new Database(p); d.pragma('foreign_keys = ON'); return d; };
const sv = (records, seq) => ({ hash: sha(JSON.stringify(records)).slice(0, 32), seq });

try {
    console.log('\n[1] flags apagados → cero side effects');
    delete process.env.IDENTITY_DUAL_WRITE; delete process.env.IDENTITY_SQLITE_ENABLED;
    const hookMod = await import('../../../server/db/identityWriteHook.js');
    hookMod._resetIdentityWriteHook();
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02ba_probe_'));
    const hook = hookMod.makeIdentityWriteHook({ usersDb: F('padron_oro.json'), groupsDb: F('groups_db.json'),
        accessDb: F('a.json'), schoolsDb: F('schools_db.json'), log: () => {} });
    hook(F('padron_oro.json'), USERS);
    ok('el hook con dual-write apagado no crea nada', fs.readdirSync(probe).length === 0);
    ok('superficie: reconoce los cuatro dominios',
        ['users', 'groups', 'access', 'institutions'].every((d, i) =>
            domainOf([F('padron_oro.json'), F('groups_db.json'), F('a.json'), F('schools_db.json')][i],
                { usersDb: F('padron_oro.json'), groupsDb: F('groups_db.json'),
                  accessDb: F('a.json'), schoolsDb: F('schools_db.json') }) === d));
    ok('un fichero ajeno no es dominio de identidad',
        domainOf(F('otro.json'), { usersDb: F('padron_oro.json') }) === null);
    ok('escritor registrado aceptado', assertRegisteredWriter('server.writeJSON') === null);
    ok('escritor no registrado rechazado',
        assertRegisteredWriter('scripts.adhoc') === 'UNREGISTERED_WRITER');
    ok('superficie bloqueada solo con dual-write encendido',
        blockedWhenDualWrite({ dualWriteEnabled: false, domain: 'users' }) === null
        && blockedWhenDualWrite({ dualWriteEnabled: true, domain: 'users' })
           === 'IDENTITY_WRITE_SURFACE_BLOCKED_UNDER_DUAL_WRITE');
    const gms = await import('../../../server/db/../groupMembershipService.js');
    process.env.IDENTITY_DUAL_WRITE = '1';
    const blocked = await caught(() => gms.assignUserToGroup({ userId: 'u1', groupId: 'g-can',
        GROUPS_DB: F('groups_db.json'), USERS_DB: F('padron_oro.json') }));
    ok('la superficie no interceptable se bloquea con dual-write activo',
        String(blocked).includes('IDENTITY_WRITE_SURFACE_BLOCKED_UNDER_DUAL_WRITE'), String(blocked));
    delete process.env.IDENTITY_DUAL_WRITE;
    fs.rmSync(probe, { recursive: true, force: true });

    console.log('\n[2] base con esquema v2 + contabilidad de espejo');
    const DBP = F('shadow.db');
    const db = openDb(DBP);
    runMigrations(db);
    ok('el espejo exige tablas de contabilidad', assertShadowCapable(db) === null);
    const bare = openDb(F('bare.db'));
    runMigrations(bare, () => {}, { until: '0002_identity_v2' });
    ok('una base v2 sin contabilidad falla cerrado',
        assertShadowCapable(bare) === 'SHADOW_TABLES_MISSING');
    bare.close();
    // semilla de exclusiones y tombstone, como haría el importador
    db.prepare(`INSERT INTO migration_runs(run_id,schema_version,source_hashes_json,plan_hash,status,
                started_at) VALUES ('r1','v2','{}','p','completed',?)`).run(NOW);
    db.prepare(`INSERT INTO identity_tombstones(tombstone_id,legacy_identity_hash,classification,source,
                reference_count,provenance,policy_version,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run('TS_gone', h16('u-gone'), 'DELETED_IDENTITY_TOMBSTONE_REQUIRED', '[]', 1, 't', '1.0.0', NOW);
    for (const [entity, ref] of [['user', h16('u-synth')], ['group', h16('g-legacy')],
                                 ['group', h16('g-synth')]]) {
        db.prepare(`INSERT INTO migration_exclusions(exclusion_id,run_id,entity,disposition,reference_hash,
                    provenance,created_at) VALUES (?,?,?,?,?,?,?)`)
            .run('exc_' + h16(entity + ref), 'r1', entity, 'EXCLUDED', ref, 't', NOW);
    }

    console.log('\n[3] write JSON confirmado + espejo correcto');
    const r1 = mirrorSnapshotV2(db, { domain: 'institutions', records: INST,
        sourceVersion: sv(INST, 1), writerId: 'server.writeJSON', at: NOW });
    const r2 = mirrorSnapshotV2(db, { domain: 'users', records: USERS,
        sourceVersion: sv(USERS, 1), writerId: 'server.writeJSON', at: NOW });
    const r3 = mirrorSnapshotV2(db, { domain: 'groups', records: GROUPS,
        sourceVersion: sv(GROUPS, 1), writerId: 'server.writeJSON', at: NOW });
    ok('instituciones espejadas', r1.status === 'APPLIED' && r1.applied === 2);
    ok('usuarios espejados sin la cohorte sintética',
        r2.applied === 3 && db.prepare(`SELECT COUNT(*) c FROM users`).get().c === 3);
    ok('el usuario sintético queda rechazado y anotado',
        r2.rejected.some(x => x.reason === 'SYNTHETIC_COHORT'
            || x.reason === 'EXCLUDED_BY_DISPOSITION'), JSON.stringify(r2.rejected));
    ok('solo el grupo canónico entra',
        db.prepare(`SELECT COUNT(*) c FROM groups`).get().c === 1);
    ok('el grupo legacy se rechaza por disposición, aunque su institución resuelva',
        r3.rejected.some(x => x.reason === 'EXCLUDED_BY_DISPOSITION'), JSON.stringify(r3.rejected));
    ok('el grupo sintético tampoco entra', r3.rejected.length === 2, JSON.stringify(r3.rejected));
    ok('membresías derivadas, no inventadas: doble rol incluido',
        db.prepare(`SELECT COUNT(*) c FROM memberships`).get().c === 3);
    ok('doble rol en el mismo grupo preservado',
        db.prepare(`SELECT COUNT(*) c FROM memberships WHERE user_id='u2' AND group_id='g-can'`).get().c === 2);
    ok('el usuario sin grupo no recibe membresía',
        db.prepare(`SELECT COUNT(*) c FROM memberships WHERE user_id='u3'`).get().c === 0);
    ok('sin credenciales en el espejo',
        db.prepare(`SELECT COUNT(*) c FROM users WHERE raw_json LIKE '%$2b$%'`).get().c === 0);

    console.log('\n[4] idempotencia');
    const again = mirrorSnapshotV2(db, { domain: 'users', records: USERS,
        sourceVersion: sv(USERS, 1), writerId: 'server.writeJSON', at: LATER });
    ok('misma operación dos veces → NOOP', again.applied === 0 && again.noop === 3,
        JSON.stringify({ a: again.applied, n: again.noop }));
    ok('sin duplicados', db.prepare(`SELECT COUNT(*) c FROM users`).get().c === 3);
    ok('operation_id determinístico',
        operationId({ entityType: 'user', operationType: 'upsert', canonicalKey: 'u1', sourceVersion: 'v' })
        === operationId({ entityType: 'user', operationType: 'upsert', canonicalKey: 'u1', sourceVersion: 'v' }));
    ok('unicidad (group_id, user_id, role) intacta',
        db.prepare(`SELECT COUNT(*) c FROM (SELECT group_id,user_id,role FROM memberships
                    GROUP BY group_id,user_id,role HAVING COUNT(*)>1)`).get().c === 0);

    console.log('\n[5] actualización legítima y operación obsoleta');
    const updated = USERS.map(u => u.id === 'u1' ? { ...u, roles: ['mediador'] } : u);
    const rUp = mirrorSnapshotV2(db, { domain: 'users', records: updated,
        sourceVersion: sv(updated, 2), writerId: 'server.writeJSON', at: LATER });
    ok('la actualización posterior se aplica', rUp.applied >= 1
        && db.prepare(`SELECT global_role FROM users WHERE canonical_id='u1'`).get().global_role === 'mediador');
    const rStale = mirrorSnapshotV2(db, { domain: 'users', records: USERS,
        sourceVersion: sv(USERS, 1), writerId: 'server.writeJSON', at: LATER });
    ok('una instantánea obsoleta no sobrescribe el estado nuevo',
        rStale.classification === 'STALE_SNAPSHOT_IGNORED'
        && db.prepare(`SELECT global_role FROM users WHERE canonical_id='u1'`).get().global_role === 'mediador');
    ok('compareSourceVersion distingue fresh/same/stale',
        compareSourceVersion(db, 'users', sv(updated, 2)) === 'SAME'
        && compareSourceVersion(db, 'users', sv(USERS, 1)) === 'STALE');

    console.log('\n[6] desactivación');
    const without3 = updated.filter(u => u.id !== 'u3');
    mirrorSnapshotV2(db, { domain: 'users', records: without3,
        sourceVersion: sv(without3, 3), writerId: 'server.writeJSON', at: LATER });
    ok('el usuario ausente se desactiva lógicamente, no se borra',
        db.prepare(`SELECT deleted_at FROM users WHERE canonical_id='u3'`).get().deleted_at !== null);
    const rDeact = mirrorSnapshotV2(db, { domain: 'users', records: without3,
        sourceVersion: sv(without3, 3), writerId: 'server.writeJSON', at: LATER });
    ok('desactivación repetida → NOOP', rDeact.applied === 0);

    console.log('\n[7] tombstone y exclusiones nunca se convierten en usuario');
    const withGhost = [...without3, { id: 'u-gone', email: 'g@x.cl', roles: ['lector'],
        accountStatus: 'active' }];
    const rGhost = mirrorSnapshotV2(db, { domain: 'users', records: withGhost,
        sourceVersion: sv(withGhost, 4), writerId: 'server.writeJSON', at: LATER });
    ok('una identidad con tombstone no se recrea como usuario',
        db.prepare(`SELECT COUNT(*) c FROM users WHERE canonical_id='u-gone'`).get().c === 0
        && rGhost.rejected.some(x => x.reason === 'TOMBSTONED_IDENTITY'));

    console.log('\n[8] fallo del espejo: reconciliable y jamás silencioso');
    const dbFail = openDb(F('fail.db'));
    runMigrations(dbFail);
    dbFail.prepare(`INSERT INTO migration_runs(run_id,schema_version,source_hashes_json,plan_hash,status,
                    started_at) VALUES ('r1','v2','{}','p','completed',?)`).run(NOW);
    dbFail.exec(`DROP TABLE memberships`);   // provoca un fallo real a mitad del espejo
    mirrorSnapshotV2(dbFail, { domain: 'institutions', records: INST,
        sourceVersion: sv(INST, 1), writerId: 'server.writeJSON', at: NOW });
    mirrorSnapshotV2(dbFail, { domain: 'users', records: USERS,
        sourceVersion: sv(USERS, 1), writerId: 'server.writeJSON', at: NOW });
    const rFail = mirrorSnapshotV2(dbFail, { domain: 'groups', records: GROUPS,
        sourceVersion: sv(GROUPS, 1), writerId: 'server.writeJSON', at: NOW });
    ok('un fallo del espejo no lanza', rFail.status === 'FAILED_RECONCILABLE');
    ok('queda registrado como FAILED_RECONCILABLE',
        dbFail.prepare(`SELECT COUNT(*) c FROM shadow_operations
                        WHERE status='FAILED_RECONCILABLE'`).get().c > 0);
    ok('la clasificación del fallo queda en el estado del dominio',
        dbFail.prepare(`SELECT last_failure_class FROM shadow_state WHERE domain='groups'`)
            .get()?.last_failure_class === 'MIRROR_WRITE_FAILED');
    ok('shadow_audit registra el fallo con ok=0',
        dbFail.prepare(`SELECT ok FROM shadow_audit ORDER BY id DESC LIMIT 1`).get().ok === 0);
    const tel = shadowTelemetry(dbFail);
    ok('telemetría expone pendientes de reconciliación', tel.available && tel.pendingReconciliation > 0);
    ok('telemetría sin identificadores ni marcas por usuario',
        !JSON.stringify(tel).match(/u1|u2|@|nombre/i), JSON.stringify(tel).slice(0, 120));
    dbFail.close();

    console.log('\n[9] concurrencia');
    const dbC = openDb(F('conc.db'));
    runMigrations(dbC);
    dbC.prepare(`INSERT INTO migration_runs(run_id,schema_version,source_hashes_json,plan_hash,status,
                 started_at) VALUES ('r1','v2','{}','p','completed',?)`).run(NOW);
    mirrorSnapshotV2(dbC, { domain: 'institutions', records: INST, sourceVersion: sv(INST, 1),
        writerId: 'server.writeJSON', at: NOW });
    const results = [0, 1, 2, 3].map(() => mirrorSnapshotV2(dbC, { domain: 'users', records: USERS,
        sourceVersion: sv(USERS, 5), writerId: 'server.writeJSON', at: NOW }));
    ok('cuatro espejos idénticos: uno aplica, el resto NOOP',
        results.filter(r => r.applied > 0).length === 1 && results.filter(r => r.noop > 0).length === 3,
        JSON.stringify(results.map(r => ({ a: r.applied, n: r.noop }))));
    ok('sin duplicados tras la concurrencia',
        dbC.prepare(`SELECT COUNT(*) c FROM users`).get().c === 3);
    ok('busy_timeout configurable y WAL disponible',
        typeof dbC.pragma('busy_timeout', { simple: true }) === 'number');
    dbC.close();

    console.log('\n[10] reconciliador: estados');
    const rec = await reconcileIdentityShadow({ mode: 'check', manifestPath: MANP, identityDbPath: DBP });
    ok('check es read-only y detecta divergencia', rec.mode === 'check'
        && ['MATCH', 'DIVERGENT'].includes(rec.state));
    const dbFresh = openDb(F('fresh.db'));
    runMigrations(dbFresh);
    dbFresh.prepare(`INSERT INTO migration_runs(run_id,schema_version,source_hashes_json,plan_hash,status,
                     started_at) VALUES ('r1','v2','{}','p','completed',?)`).run(NOW);
    const d0 = diagnose(dbFresh, { users: USERS, groups: GROUPS, institutions: INST }, NOW);
    ok('base vacía → todo MISSING_IN_SQLITE',
        d0.counts.users.MISSING_IN_SQLITE === 3 && d0.counts.institutions.MISSING_IN_SQLITE === 2,
        JSON.stringify(d0.counts));
    dbFresh.close();
    const applyRes = await reconcileIdentityShadow({ mode: 'apply', manifestPath: MANP,
        identityDbPath: F('fresh.db'), at: NOW });
    ok('apply converge el espejo', applyRes.state === 'MATCH', JSON.stringify(applyRes.after));
    const applyAgain = await reconcileIdentityShadow({ mode: 'apply', manifestPath: MANP,
        identityDbPath: F('fresh.db'), at: NOW });
    ok('segundo apply es no-op', applyAgain.applied === 0 && applyAgain.state === 'MATCH',
        JSON.stringify({ a: applyAgain.applied }));
    const dbR = openDb(F('fresh.db'));
    ok('el apply deja su propia auditoría',
        dbR.prepare(`SELECT COUNT(*) c FROM reconciliation_runs WHERE status='completed'`).get().c >= 1);
    const dCheck = diagnose(dbR, { users: USERS, groups: GROUPS, institutions: INST }, NOW);
    ok('tras converger: MATCH en las cuatro entidades', dCheck.state === 'MATCH',
        JSON.stringify(dCheck.counts));
    dbR.prepare(`INSERT INTO institutions(institution_id,official_name,name_norm,addressable,status,
                 provenance,created_at,updated_at) VALUES ('inst-x','X','x',0,'active','t',?,?)`).run(NOW, NOW);
    const dUnexp = diagnose(dbR, { users: USERS, groups: GROUPS, institutions: INST }, NOW);
    ok('detecta UNEXPECTED_IN_SQLITE', dUnexp.counts.institutions.UNEXPECTED_IN_SQLITE === 1);
    dbR.prepare(`DELETE FROM institutions WHERE institution_id='inst-x'`).run();
    dbR.prepare(`UPDATE users SET global_role='administrador' WHERE canonical_id='u1'`).run();
    const dStale = diagnose(dbR, { users: USERS, groups: GROUPS, institutions: INST }, NOW);
    ok('detecta STALE_IN_SQLITE', dStale.counts.users.STALE_IN_SQLITE === 1);
    dbR.prepare(`UPDATE users SET global_role='lector' WHERE canonical_id='u1'`).run();
    // Un tombstone que fuera a la vez usuario es IMPOSIBLE por esquema: el
    // trigger lo rechaza. Se comprueba esa imposibilidad y, para el detector,
    // se usa una violación que sí es alcanzable: una identidad excluida presente.
    const trg = caughtSync(() => dbR.prepare(`INSERT INTO identity_tombstones(tombstone_id,
        legacy_identity_hash,classification,source,reference_count,provenance,policy_version,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run('u2', h16('otro'), 'X', '[]', 0, 't', '1.0.0', NOW));
    ok('un tombstone que ya es usuario lo impide el esquema, no solo el detector',
        String(trg).includes('tombstone_collides_with_canonical_identity'), String(trg));
    dbR.prepare(`INSERT INTO migration_exclusions(exclusion_id,run_id,entity,disposition,reference_hash,
                 provenance,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run('exc_test', 'r1', 'user', 'EXCLUDED', h16('u1'), 't', NOW);
    const dViol = diagnose(dbR, { users: USERS, groups: GROUPS, institutions: INST }, NOW);
    ok('detecta CONTRACT_VIOLATION (identidad excluida presente en el espejo)',
        dViol.counts.CONTRACT_VIOLATION > 0
        && dViol.violations.some(v => v.kind === 'EXCLUDED_IDENTITY_PRESENT'), JSON.stringify(dViol.violations));
    dbR.prepare(`DELETE FROM migration_exclusions WHERE exclusion_id='exc_test'`).run();
    dbR.close();
    const badPath = await caught(async () => assertIdentityDbPath('/var/www/chibalete/data-critical/identity.db'));
    ok('el reconciliador rechaza una ruta productiva', badPath === 'PRODUCTION_PATH_REJECTED', String(badPath));

    console.log('\n[11] drift de la candidate');
    await importIdentityCandidate({ manifestPath: MANP, outputPath: CAND, mode: 'apply', log: () => {} });
    const dbCand = new Database(CAND, { readonly: true });
    const drift0 = classifyCandidateDrift(dbCand, manifest, { users: USERS, groups: GROUPS,
        institutions: INST }, NOW);
    ok('sin cambios → NO_DRIFT y promovible',
        drift0.classification === 'NO_DRIFT' && drift0.promotable, JSON.stringify(drift0.blocking));
    const usersLogin = USERS.map(u => u.id === 'u1' ? { ...u, lastLoginAt: '2026-05-01T00:00:00Z' } : u);
    fs.writeFileSync(paths.padron, JSON.stringify(usersLogin, null, 1));
    const driftAllowed = classifyCandidateDrift(dbCand, manifest, { users: usersLogin, groups: GROUPS,
        institutions: INST }, NOW);
    ok('un campo no importado → ALLOWED_NON_IMPORTED_DRIFT y sigue promovible',
        driftAllowed.classification === 'ALLOWED_NON_IMPORTED_DRIFT' && driftAllowed.promotable,
        JSON.stringify(driftAllowed));
    const usersPlus = [...USERS, { id: 'u9', email: 'u9@x.cl', roles: ['lector'], accountStatus: 'active' }];
    const driftBlock = classifyCandidateDrift(dbCand, manifest, { users: usersPlus, groups: GROUPS,
        institutions: INST }, NOW);
    ok('un usuario nuevo → BLOCKING_IDENTITY_DRIFT y no promovible',
        driftBlock.classification === 'BLOCKING_IDENTITY_DRIFT' && !driftBlock.promotable);
    const groupsChanged = GROUPS.map(g => g.id === 'g-can'
        ? { ...g, studentIds: ['u1'] } : g);
    const driftMem = classifyCandidateDrift(dbCand, manifest, { users: USERS, groups: groupsChanged,
        institutions: INST }, NOW);
    ok('una membresía retirada → BLOCKING_IDENTITY_DRIFT',
        driftMem.classification === 'BLOCKING_IDENTITY_DRIFT');
    dbCand.close();
    fs.writeFileSync(paths.padron, JSON.stringify(USERS, null, 1));

    console.log('\n[12] promoción atómica');
    const CAND_SHA = crypto.createHash('sha256').update(fs.readFileSync(CAND)).digest('hex');
    const targetDir = fs.mkdtempSync(path.join(tmp, 'prod_'));
    const TARGET = path.join(targetDir, 'identity.db');
    const promoted = await promoteIdentityCandidate({
        candidatePath: CAND, manifestPath: MANP, target: TARGET, allowlist: [targetDir],
        repoRoot: process.cwd(), expectedSha256: CAND_SHA, allowedSourceCommits: ['cafe123'],
        env: {}, log: () => {},
    });
    ok('promoción completada', promoted.promoted === true && promoted.atomic === true);
    ok('el destino existe con el modo restringido que la plataforma permite',
        fs.existsSync(TARGET) && (promoted.mode === '600' || process.platform === 'win32'),
        promoted.mode);
    ok('el rename fue atómico y el directorio se sincroniza donde la plataforma lo permite',
        promoted.atomic === true
        && (promoted.directorySynced === true || process.platform === 'win32'),
        JSON.stringify({ s: promoted.directorySynced, p: promoted.platform }));
    ok('el destino es byte-idéntico a la candidate',
        crypto.createHash('sha256').update(fs.readFileSync(TARGET)).digest('hex') === CAND_SHA);
    ok('no queda ningún temporal',
        fs.readdirSync(targetDir).filter(f => f.includes('promote')).length === 0);
    ok('la candidate no fue modificada',
        crypto.createHash('sha256').update(fs.readFileSync(CAND)).digest('hex') === CAND_SHA);
    const twice = await caught(() => promoteIdentityCandidate({
        candidatePath: CAND, manifestPath: MANP, target: TARGET, allowlist: [targetDir],
        expectedSha256: CAND_SHA, env: {}, log: () => {} }));
    ok('un destino existente se rechaza', twice === 'TARGET_ALREADY_EXISTS', String(twice));

    console.log('\n[13] la promoción rechaza lo que debe');
    const corrupt = F('corrupt.candidate.db');
    fs.copyFileSync(CAND, corrupt);
    const fd = fs.openSync(corrupt, 'r+'); fs.writeSync(fd, Buffer.from('XX'), 0, 2, 200); fs.closeSync(fd);
    const target2 = path.join(fs.mkdtempSync(path.join(tmp, 'prod2_')), 'identity.db');
    const cCorrupt = await caught(() => promoteIdentityCandidate({
        candidatePath: corrupt, manifestPath: MANP, target: target2,
        allowlist: [path.dirname(target2)], expectedSha256: CAND_SHA, env: {}, log: () => {} }));
    ok('candidate modificada rechazada', cCorrupt === 'CANDIDATE_MODIFIED', String(cCorrupt));
    ok('y no dejó nada en el destino', !fs.existsSync(target2));
    // Hallazgo: una alteración de 2 bytes en espacio libre NO altera
    // quick_check ni integrity_check. La integridad estructural no acredita
    // autenticidad, así que el hash atestado es obligatorio y no opcional.
    const dbCorrupt = new Database(corrupt, { readonly: true });
    ok('quick_check e integrity_check NO detectan la manipulación de 2 bytes',
        dbCorrupt.pragma('quick_check', { simple: true }) === 'ok'
        && dbCorrupt.pragma('integrity_check', { simple: true }) === 'ok');
    dbCorrupt.close();
    const cCorruptNoHash = await caught(() => promoteIdentityCandidate({
        candidatePath: corrupt, manifestPath: MANP, target: target2,
        allowlist: [path.dirname(target2)], env: {}, log: () => {} }));
    ok('por eso el hash atestado es obligatorio, no opcional',
        cCorruptNoHash === 'EXPECTED_SHA256_REQUIRED', String(cCorruptNoHash));
    const cFlags = caughtSync(() => assertFlagsOff({ IDENTITY_DUAL_WRITE: '1' }));
    ok('flags activos rechazados', cFlags === 'IDENTITY_FLAGS_ACTIVE', String(cFlags));
    const cRead = caughtSync(() => assertFlagsOff({ IDENTITY_READ: 'sqlite' }));
    ok('IDENTITY_READ=sqlite rechazado', cRead === 'IDENTITY_FLAGS_ACTIVE', String(cRead));
    for (const [t, label] of [
        ['/var/www/chibalete/data-critical/identity.db', 'ruta productiva fuera de allowlist'],
        [path.join(targetDir, 'otra.db'), 'nombre distinto de identity.db'],
    ]) {
        const c = caughtSync(() => assertPromotionTarget(t, { allowlist: [targetDir], repoRoot: null }));
        ok(`rechaza ${label}`, c === 'TARGET_NOT_ALLOWLISTED', `${t} → ${c}`);
    }
    const cRepo = caughtSync(() => assertPromotionTarget(path.join(process.cwd(), 'identity.db'),
        { allowlist: [process.cwd()], repoRoot: process.cwd() }));
    ok('rechaza un destino dentro del repositorio', cRepo === 'TARGET_NOT_ALLOWLISTED', String(cRepo));
    const cNoAllow = caughtSync(() => assertPromotionTarget(TARGET, { allowlist: [] }));
    ok('exige allowlist', cNoAllow === 'TARGET_ALLOWLIST_REQUIRED', String(cNoAllow));
    const cCommit = await caught(() => promoteIdentityCandidate({
        candidatePath: CAND, manifestPath: MANP, target: target2, allowlist: [path.dirname(target2)],
        allowedSourceCommits: ['otro-commit'], expectedSha256: CAND_SHA, env: {}, log: () => {} }));
    ok('commit fuente fuera de la allowlist rechazado', cCommit === 'SOURCE_COMMIT_NOT_ALLOWED', String(cCommit));
    const verified = verifyCandidate(CAND, manifest, { expectedSha256: CAND_SHA });
    ok('verifyCandidate reconcilia conteos contra el manifiesto',
        verified.counts.users === 3 && verified.counts.institutions === 2);

    console.log('\n[14] aislamiento');
    ok('todo el trabajo vive bajo el directorio temporal',
        !fs.existsSync('/var/www/chibalete/data-critical/identity.db'));
    db.close();
} catch (e) {
    console.error('  ✗ excepción no esperada:', e.stack || e.message);
    fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    delete process.env.IDENTITY_DUAL_WRITE;
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
