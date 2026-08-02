/**
 * importIdentityCandidate.test.mjs — CHP-IDDB-02A.
 *
 * Ejercita el importador real contra fixtures SINTÉTICAS en un directorio
 * temporal. Ningún caso lee ni escribe stores reales, y el propio importador
 * rechaza por contrato cualquier ruta productiva.
 *
 *   node scripts/identity/__test__/importIdentityCandidate.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
    importIdentityCandidate, assertSafeOutputPath, logicalHash, canonicalJson,
} from '../importIdentityCandidate.mjs';
import { buildManifest } from '../buildImportManifest.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const h8 = (v) => sha(v).slice(0, 8);
const h16 = (v) => sha(v).slice(0, 16);
const NOW = '2026-01-01T00:00:00Z';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02a_import_'));
const F = (n) => path.join(tmp, n);
const write = (n, obj) => { fs.writeFileSync(F(n), JSON.stringify(obj, null, 1)); return F(n); };

// ── Fixtures sintéticas ──────────────────────────────────────────────────
// inst-a con un grupo canónico; inst-b registrada y SIN grupos.
// g-can: u1 miembro, u2 miembro Y mediador (doble rol), u-fantasma referenciado
//        pero ausente del padrón. g-legacy y g-synth quedan fuera.
const INST = [{ id: 'inst-a', name: 'Alfa' }, { id: 'inst-b', name: 'Beta' }];
const GROUPS = [
    { id: 'g-can', organizationId: 'inst-a', name: 'Primero A', type: 'course',
      gradeLevel: '1', school: 'Alfa', studentIds: ['u1', 'u2', 'u-fantasma'],
      memberIds: ['u1'], mediatorIds: ['u2'] },
    { id: 'g-legacy', name: 'Club Viejo', type: 'course', school: 'Colegio Test', studentIds: ['u1'] },
    { id: 'g-synth', name: 'Carga', type: 'course', school: 'Carga', studentIds: ['u-synth'] },
];
const USERS = [
    { id: 'u1', email: 'U1@X.CL', roles: ['lector'], accountStatus: 'active',
      nombre_completo: 'Uno', password: '$2b$10$secreto' },
    { id: 'u2', email: 'u2@x.cl', roles: ['mediador'], accountStatus: 'active', password: '$2b$10$otro' },
    { id: 'u3', email: 'u3@x.cl', roles: ['lector'], accountStatus: 'active' },  // sin grupo
    { id: 'u-synth', email: 'lt@x.cl', roles: ['lector'], _loadtest_marker: true },
];
const MAPPING = {
    cutUtc: NOW, policyVersion: '1.0.0',
    groups: [
        { groupAlias: 'GRP_' + h8('g-can'), resolutionClass: 'CANONICAL_ORG_ID_CONFIRMED',
          proposedOrganizationIdHash: h8('inst-a') },
        { groupAlias: 'GRP_' + h8('g-legacy'), resolutionClass: 'LEGACY_TEST_GROUP_PENDING_RETIREMENT',
          proposedOrganizationIdHash: null },
        { groupAlias: 'GRP_' + h8('g-synth'), resolutionClass: 'SYNTHETIC_LOADTEST_EXCLUDED',
          proposedOrganizationIdHash: null },
    ],
};
const TOMBSTONES = {
    policyVersion: '1.0.0', createdInProduction: false, count: 1,
    tombstones: [{
        tombstoneId: 'TS_' + h16('u-fantasma').slice(0, 12), legacyIdentityHash: h16('u-fantasma'),
        classification: 'DELETED_IDENTITY_TOMBSTONE_REQUIRED', source: ['groups'],
        firstSeenAt: null, lastSeenAt: null, referenceCount: 1, authenticationAllowed: false,
        provenance: { absenceCause: 'TEST' }, reviewedAt: NOW, policyVersion: '1.0.0',
    }],
};
const ORPHANS = {
    policyVersion: '1.0.0',
    orphans: [
        { alias: 'USR_' + h8('u-fantasma'), disposition: 'DELETED_IDENTITY_TOMBSTONE_REQUIRED',
          legacyIdentityHash: h16('u-fantasma') },
        { alias: 'USR_' + h8('u-super'), disposition: 'SUPERSEDED_PADRON_SNAPSHOT_NOT_IMPORTED',
          legacyIdentityHash: h16('u-super') },
    ],
};
const DRY01D = {
    unit: 'CHP-IDDB-01D',
    counts: {
        users: { MIGRATABLE: 2, MIGRATABLE_WITH_WARNING: 1, EXCLUDED_SYNTHETIC: 1 },
        institutions: { MIGRATABLE: 2 },
        groups: { MIGRATABLE: 1, EXCLUDED_SYNTHETIC: 1, LEGACY_TEST_GROUP_PENDING_RETIREMENT: 1 },
        memberships: { MIGRATABLE: 3, EXCLUDED_SYNTHETIC: 1,
            LEGACY_GROUP_MEMBERSHIP_PENDING_RETIREMENT: 1, DELETED_IDENTITY_REFERENCE_RESOLVED: 1 },
        tombstones: 1,
    },
    planSha256: 'fixture',
};

const paths = {
    padron: write('padron_oro.json', USERS),
    groups: write('groups_db.json', GROUPS),
    institutions: write('schools_db.json', INST),
    mapping: write('mapping.json', MAPPING),
    tombstones: write('tombstones.json', TOMBSTONES),
    orphans: write('orphans.json', ORPHANS),
    dryRun01d: write('dryrun01d.json', DRY01D),
    attestation: write('attestation.json', { artifactsByteIdentical: 9 }),
};
const OUT = F('identity.candidate.db');
const mkManifest = (over = {}) => {
    const m = buildManifest({ ...paths, outputDb: OUT, sourceCommit: 'deadbee', generatedAt: NOW });
    return { ...m, ...over };
};
const run = (manifest, opts = {}) => importIdentityCandidate({
    manifestPath: write(opts.manifestName ?? 'manifest.json', manifest),
    outputPath: opts.output ?? OUT, repoRoot: opts.repoRoot, mode: opts.mode ?? 'apply',
    beforeCommit: opts.beforeCommit, log: () => {},
});
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e.classification ?? e.message; } };

try {
    console.log('\n[4] dry-run repetido: determinístico y sin escribir');
    const manifest = mkManifest();
    const d1 = await run(manifest, { mode: 'dry-run' });
    const d2 = await run(manifest, { mode: 'dry-run' });
    ok('mismo planHash en dos dry-run', d1.planHash === d2.planHash);
    ok('mismo runId', d1.runId === d2.runId && /^run_[0-9a-f]{16}$/.test(d1.runId));
    ok('el dry-run no escribe la candidate', !fs.existsSync(OUT));
    ok('conteos reconciliados contra el plan congelado de 01D',
        d1.counts.users === 3 && d1.counts.institutions === 2 && d1.counts.groups === 1
        && d1.counts.memberships === 3 && d1.counts.tombstones === 1, canonicalJson(d1.counts));

    console.log('\n[5] apply inicial');
    const a1 = await run(manifest);
    ok('resultado APPLIED', a1.result === 'APPLIED' && a1.applied === true);
    ok('la candidate existe', fs.existsSync(OUT));
    ok('no quedan ficheros parciales', !fs.existsSync(OUT + '.partial'));
    const db = new Database(OUT, { readonly: true });
    ok('quick_check ok', db.pragma('quick_check', { simple: true }) === 'ok');
    ok('integrity_check ok', db.pragma('integrity_check', { simple: true }) === 'ok');
    ok('foreign_key_check sin filas', db.pragma('foreign_key_check').length === 0);
    ok('users = 3 (sintético excluido)', db.prepare('SELECT COUNT(*) c FROM users').get().c === 3);
    ok('institutions = 2', db.prepare('SELECT COUNT(*) c FROM institutions').get().c === 2);
    ok('groups = 1 (legacy y sintético fuera)', db.prepare('SELECT COUNT(*) c FROM groups').get().c === 1);
    ok('memberships = 3', db.prepare('SELECT COUNT(*) c FROM memberships').get().c === 3);
    ok('tombstones = 1', db.prepare('SELECT COUNT(*) c FROM identity_tombstones').get().c === 1);
    ok('migration_run completado',
        db.prepare(`SELECT status FROM migration_runs`).get().status === 'completed');
    const hash1 = logicalHash(db);

    console.log('\n[12] usuario sintético jamás importado');
    ok('la cohorte de carga no está en users',
        db.prepare(`SELECT COUNT(*) c FROM users WHERE canonical_id='u-synth'`).get().c === 0);
    ok('queda registrada como exclusión',
        db.prepare(`SELECT COUNT(*) c FROM migration_exclusions
                    WHERE entity='user' AND disposition='SYNTHETIC_LOADTEST_QUARANTINED'`).get().c === 1);

    console.log('\n[13] grupo legacy jamás importado');
    ok('g-legacy y g-synth fuera de groups',
        db.prepare(`SELECT COUNT(*) c FROM groups WHERE group_id IN ('g-legacy','g-synth')`).get().c === 0);
    ok('sus exclusiones quedan registradas',
        db.prepare(`SELECT COUNT(*) c FROM migration_exclusions WHERE entity='group'`).get().c === 2);
    ok('sus membresías tampoco se importan',
        db.prepare(`SELECT COUNT(*) c FROM memberships WHERE group_id LIKE 'g-%'
                    AND group_id <> 'g-can'`).get().c === 0);

    console.log('\n[14] ninguna membresía fabricada');
    ok('el usuario sin grupo no recibe membresía inventada',
        db.prepare(`SELECT COUNT(*) c FROM memberships WHERE user_id='u3'`).get().c === 0);
    ok('la referencia rota no genera usuario ni membresía',
        db.prepare(`SELECT COUNT(*) c FROM users WHERE canonical_id='u-fantasma'`).get().c === 0
        && db.prepare(`SELECT COUNT(*) c FROM memberships WHERE user_id='u-fantasma'`).get().c === 0);
    ok('queda como referencia eliminada resuelta',
        db.prepare(`SELECT COUNT(*) c FROM migration_exclusions
                    WHERE disposition='DELETED_IDENTITY_REFERENCE'`).get().c === 1);

    console.log('\n[15/16/17] tombstone, doble rol e institución sin grupos');
    ok('tombstone no autenticable',
        db.prepare(`SELECT COUNT(*) c FROM identity_tombstones
                    WHERE authentication_allowed <> 0`).get().c === 0);
    ok('el tombstone tiene alias que lo resuelve',
        db.prepare(`SELECT COUNT(*) c FROM identity_aliases WHERE tombstone_id IS NOT NULL`).get().c === 1);
    ok('doble rol preservado como dos membresías',
        db.prepare(`SELECT COUNT(*) c FROM memberships WHERE user_id='u2' AND group_id='g-can'`).get().c === 2);
    ok('institución sin grupos importada y marcada no direccionable',
        db.prepare(`SELECT addressable FROM institutions WHERE institution_id='inst-b'`).get().addressable === 0);
    ok('institución con grupos marcada direccionable',
        db.prepare(`SELECT addressable FROM institutions WHERE institution_id='inst-a'`).get().addressable === 1);
    ok('cuatro aliases institucionales derivados, uno por institución',
        db.prepare(`SELECT COUNT(*) c FROM institution_aliases`).get().c === 2);

    console.log('\n[R] privacidad: la candidate no custodia credenciales');
    ok('no hay columna de contraseña en users',
        !db.prepare(`PRAGMA table_info(users)`).all().some(c => /password|credential_hash/i.test(c.name)));
    ok('raw_json no contiene el hash de contraseña',
        !db.prepare(`SELECT raw_json FROM users`).all().some(r => /\$2[aby]\$/.test(r.raw_json)));
    ok('las exclusiones guardan hash, no identificadores crudos',
        db.prepare(`SELECT reference_hash FROM migration_exclusions`).all()
            .every(r => /^[0-9a-f]{16}$/.test(r.reference_hash)));
    db.close();

    console.log('\n[6] segundo apply idéntico: no-op');
    const a2 = await run(manifest);
    ok('resultado NOOP_ALREADY_APPLIED', a2.result === 'NOOP_ALREADY_APPLIED' && a2.applied === false);
    const db2 = new Database(OUT, { readonly: true });
    ok('sin duplicados: mismos conteos',
        db2.prepare('SELECT COUNT(*) c FROM users').get().c === 3
        && db2.prepare('SELECT COUNT(*) c FROM memberships').get().c === 3
        && db2.prepare('SELECT COUNT(*) c FROM migration_runs').get().c === 1);
    ok('mismo hash lógico (volcado canónico, no comparación byte a byte)',
        logicalHash(db2) === hash1);
    db2.close();

    console.log('\n[7] interrupción antes del commit');
    const OUT2 = F('interrupt.candidate.db');
    const m2 = { ...mkManifest(), outputPath: OUT2 };
    const cls = await caught(() => run(m2, {
        output: OUT2, manifestName: 'manifest2.json',
        beforeCommit: () => { throw new Error('corte simulado antes del commit'); },
    }));
    ok('la importación falla en vez de dejar algo a medias', cls !== null, String(cls));
    ok('no queda candidate', !fs.existsSync(OUT2));
    ok('no queda temporal', !fs.existsSync(OUT2 + '.partial'));
    const a3 = await run(m2, { output: OUT2, manifestName: 'manifest2.json' });
    ok('la reanudación posterior aplica limpio', a3.result === 'APPLIED');
    const db3 = new Database(OUT2, { readonly: true });
    ok('la candidate reanudada es completa y válida',
        db3.pragma('integrity_check', { simple: true }) === 'ok'
        && db3.prepare('SELECT COUNT(*) c FROM users').get().c === 3);
    ok('el hash lógico coincide con el de la primera candidate', logicalHash(db3) === hash1);
    db3.close();

    console.log('\n[8] mismo run_id con fuente distinta → falla cerrado');
    const OUT3 = F('conflict.candidate.db');
    fs.copyFileSync(OUT, OUT3);
    fs.writeFileSync(paths.padron, JSON.stringify([...USERS,
        { id: 'u4', email: 'u4@x.cl', roles: ['lector'], accountStatus: 'active' }], null, 1));
    const mAlt = mkManifest();                       // hashes y plan nuevos...
    const forgedSource = { ...mAlt, runId: manifest.runId };  // ...con el run_id viejo
    const c8 = await caught(() => run(forgedSource, { output: OUT3, manifestName: 'manifest3.json' }));
    ok('rechazado por run_id que no corresponde a la fuente',
        c8 === 'SOURCE_OR_PLAN_MISMATCH_FOR_RUN_ID', String(c8));
    fs.writeFileSync(paths.padron, JSON.stringify(USERS, null, 1));   // restaura la fixture

    console.log('\n[9] mismo run_id con plan distinto → falla cerrado');
    const mPlan = mkManifest({ expectedPlanHash: sha('otro-plan') });
    const c9 = await caught(() => run(mPlan, { output: OUT3, manifestName: 'manifest4.json' }));
    ok('rechazado por plan que no coincide', c9 === 'IMPORT_NONDETERMINISTIC', String(c9));
    const c9b = await caught(() => run({ ...mkManifest(), runId: 'run_0000000000000000' },
        { output: OUT3, manifestName: 'manifest5.json' }));
    ok('run_id arbitrario rechazado', c9b === 'SOURCE_OR_PLAN_MISMATCH_FOR_RUN_ID', String(c9b));

    console.log('\n[10] rutas productivas rechazadas');
    for (const [p, label] of [
        ['/var/www/chibalete/data-critical/identity.candidate.db', 'mount productivo'],
        ['/opt/chibaleteplus/identity.candidate.db', 'directorio de despliegue'],
        [path.join(tmp, 'data-critical', 'x.candidate.db'), 'directorio de stores'],
        [path.join(tmp, 'identity.db'), 'nombre productivo'],
    ]) {
        const c = await caught(async () => assertSafeOutputPath(p, null));
        ok(`rechaza ${label}`, c === 'PRODUCTION_PATH_REJECTED', `${p} → ${c}`);
    }
    const inRepo = await caught(async () => assertSafeOutputPath(
        path.join(tmp, 'repo', 'x.candidate.db'), path.join(tmp, 'repo')));
    ok('rechaza un destino dentro del repositorio', inRepo === 'PRODUCTION_PATH_REJECTED', String(inRepo));
    const noOut = await caught(async () => assertSafeOutputPath(null, null));
    ok('exige --output explícito', noOut === 'OUTPUT_REQUIRED', String(noOut));
    process.env.IDENTITY_DB = F('configured.candidate.db');
    const cfg = await caught(async () => assertSafeOutputPath(F('configured.candidate.db'), null));
    ok('rechaza la ruta configurada como IDENTITY_DB', cfg === 'PRODUCTION_PATH_REJECTED', String(cfg));
    delete process.env.IDENTITY_DB;

    console.log('\n[11] destino desconocido preexistente rechazado');
    const OUT4 = F('foreign.candidate.db');
    const foreign = new Database(OUT4);
    foreign.exec(`CREATE TABLE cualquiera (x TEXT)`);
    foreign.close();
    const c11 = await caught(() => run(mkManifest(), { output: OUT4, manifestName: 'manifest6.json' }));
    ok('no sobrescribe un fichero que no reconoce', c11 === 'UNKNOWN_OUTPUT_FILE', String(c11));
    ok('el fichero ajeno queda intacto', fs.existsSync(OUT4));

    console.log('\n[18] la fuente superseded se rechaza por contrato');
    const supersededPath = F('users_db.json');
    fs.writeFileSync(supersededPath, JSON.stringify(USERS));
    const mSup = mkManifest();
    mSup.sources = { ...mSup.sources, padron: { path: supersededPath, sha256: null } };
    const c18 = await caught(() => run(mSup, { mode: 'dry-run', manifestName: 'manifest7.json' }));
    ok('users_db.json rechazado como fuente', c18 === 'SOURCE_OF_TRUTH_CHANGED', String(c18));
    const backupPath = F('users_db.backup.123.json');
    fs.writeFileSync(backupPath, JSON.stringify(USERS));
    const mBk = mkManifest();
    mBk.sources = { ...mBk.sources, padron: { path: backupPath, sha256: null } };
    const c18b = await caught(() => run(mBk, { mode: 'dry-run', manifestName: 'manifest8.json' }));
    ok('un backup rechazado como fuente', c18b === 'SOURCE_OF_TRUTH_CHANGED', String(c18b));

    console.log('\n[fuentes] cualquier cambio de fuente sin manifiesto se detecta');
    const mTamper = mkManifest();
    fs.writeFileSync(paths.groups, JSON.stringify([...GROUPS], null, 2));  // mismo contenido, otro formato
    const cT = await caught(() => run(mTamper, { mode: 'dry-run', manifestName: 'manifest9.json' }));
    ok('hash de fuente distinto → parada', cT === 'SOURCE_HASH_MISMATCH', String(cT));
    fs.writeFileSync(paths.groups, JSON.stringify(GROUPS, null, 1));

    console.log('\n[19] aislamiento de stores');
    ok('todo lo escrito vive bajo el directorio temporal',
        fs.readdirSync(tmp).length > 0 && fs.readdirSync(tmp).every(f => !path.isAbsolute(f)));
    ok('no se creó ninguna ruta productiva',
        !fs.existsSync('/var/www/chibalete') || !fs.existsSync('/var/www/chibalete/data-critical/identity.db'));
} catch (e) {
    console.error('  ✗ excepción no esperada:', e.stack || e.message);
    fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
