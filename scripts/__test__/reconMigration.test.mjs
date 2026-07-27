/**
 * reconMigration.test.mjs — CHP-ID-GROUPS-RECON-01B-R1.
 *
 * Cubre el manifiesto y el migrador dry-run:
 *
 *   §A  el manifiesto respeta las decisiones humanas (D1–D7)
 *   §B  dry-run no escribe nada
 *   §C  idempotencia (segunda ejecución = cero cambios)
 *   §D  hash inesperado → STOP
 *   §E  seguridad: symlinks, path escapes, schema, BACKUP GATE
 *   §F  apply sintético + rollback byte a byte
 *   §G  ningún test toca stores reales; cero PII
 *
 * TODO ocurre sobre fixtures sintéticas en mkdtemp. Nunca se ejecuta `--apply`
 * contra producción ni se leen sus archivos.
 *
 *   node scripts/__test__/reconMigration.test.mjs
 */
import '../../server/__test__/helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MIGRATION_DIR = path.join(REPO_ROOT, 'scripts', 'migrations', 'chp-id-recon-01b');
const REAL_MANIFEST = path.join(MIGRATION_DIR, 'manifest.json');

const { runMigration, safeResolve, MigrationStop } = await import(
    pathToFileURL(path.join(MIGRATION_DIR, 'migrate.mjs')).href);

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const throwsStop = (fn, code) => {
    try { fn(); return false; }
    catch (e) { return e instanceof MigrationStop && (!code || e.code === code); }
};

console.log('reconMigration — CHP-ID-GROUPS-RECON-01B-R1');

// ── §A El manifiesto respeta las decisiones humanas ─────────────────────────
console.log('\n[A] El manifiesto respeta D1–D7');
const manifest = JSON.parse(fs.readFileSync(REAL_MANIFEST, 'utf8'));
{
    const raw = fs.readFileSync(REAL_MANIFEST, 'utf8');
    ok('estado DRY_RUN_ONLY / NOT_APPLIED',
        manifest.status.includes('DRY_RUN_ONLY') && manifest.status.includes('NOT_APPLIED')
        && manifest.status.includes('HUMAN_APPROVED_POLICY'));

    // 9. Los diez FilBo ficticios NO se mapean a FilBo 2026.
    const d1 = manifest.explicitlyNotDone.find(x => x.decision === 'D1');
    ok('9· los 10 FilBo ficticios no se mapean a FilBo 2026',
        !!d1 && d1.affectedGroups === 10 && /NO se mapean a FilBo 2026/.test(d1.statement));
    ok('9· ninguna operación menciona los grupos de la ráfaga',
        !/group-17776874/.test(raw));
    ok('9· ninguna operación crea instituciones "Filbo 20XX"',
        !manifest.operations.some(o => /Filbo 20(2[7-9]|3[0-7])/.test(JSON.stringify(o))));

    // 10 y 11. Colegio Chibalete y Colegio Test no se registran.
    const creates = manifest.operations.filter(o => o.file.endsWith('schools_db.json'));
    ok('10· Colegio Chibalete no se registra',
        !creates.some(o => /Colegio Chibalete/i.test(JSON.stringify(o.record ?? {}))));
    ok('11· Colegio Test no se registra',
        !creates.some(o => /Colegio Test/i.test(JSON.stringify(o.record ?? {}))));

    // 12. Externado se propone exactamente una vez.
    const ext = creates.filter(o => o.record?.name === 'Externado');
    ok('12· Externado se propone exactamente una vez', ext.length === 1);
    ok('12· con id estable y explícito', ext[0].record.id === 'school-externado');
    ok('12· createdAt fijo, no derivado de la hora de ejecución',
        /^\d{4}-\d{2}-\d{2}T/.test(ext[0].record.createdAt));

    // 13. Grupo 101 recibe el id fijo propuesto, por selector sin posición.
    const g101 = manifest.operations.find(o => o.id === 'OP-C-GRUPO-101-ID');
    ok('13· Grupo 101 recibe un id fijo', g101?.set?.id === 'group-historical-grupo-101');
    ok('13· el selector no usa la posición del array',
        g101.guard.selectorMustNotUseArrayPosition === true
        && !JSON.stringify(g101.selector).includes('index'));
    ok('13· queda clasificado HISTORICAL_OUT_OF_SCOPE',
        g101.resultingClassification === 'HISTORICAL_OUT_OF_SCOPE');

    // 14. Los 17 usuarios FilBo no se modifican.
    ok('14· los 17 usuarios FilBo no se modifican',
        !!d1 && d1.affectedUsers === 17 && /NO se reasignan, desactivan ni modifican/.test(d1.statement));
    const userOps = manifest.operations.filter(o => o.file.includes('usuarios_colegios_oro'));
    ok('14· la única operación sobre usuarios es la de Externado',
        userOps.length === 1 && userOps[0].id === 'OP-B-EXTERNADO-MEDIADORES');
    ok('14· esa operación solo escribe organizationId',
        JSON.stringify(Object.keys(userOps[0].set)) === JSON.stringify(['organizationId']));

    // 15. Los dos lectores FilBo sin grupo no se asignan.
    const d7 = manifest.explicitlyNotDone.find(x => x.decision === 'D7');
    ok('15· los 2 lectores sin grupo no se asignan automáticamente',
        !!d7 && d7.affectedUsers === 2 && /NO se asignan automáticamente/.test(d7.statement));
    ok('15· ninguna operación escribe groupIds',
        !manifest.operations.some(o => Object.keys(o.set ?? {}).includes('groupIds')));

    // D4 y D5.
    ok('D4· lt-org no se registra y sus 400 usuarios no se purgan',
        manifest.explicitlyNotDone.some(x => x.decision === 'D4' && x.affectedUsers === 400));
    // La única mención admisible de `schoolId` es la prosa de D5 que declara
    // explícitamente que NO se materializa. Ninguna operación puede escribirlo.
    ok('D5· ninguna operación escribe schoolId',
        !/schoolId/.test(JSON.stringify(manifest.operations)));
    ok('D5· las únicas menciones son declarativas (explicitlyNotDone + invariants)',
        (raw.match(/schoolId/g) || []).length
        === (JSON.stringify([manifest.explicitlyNotDone, manifest.invariants]).match(/schoolId/g) || []).length);
    ok('D5· ninguna operación añade un campo de clasificación',
        !manifest.operations.some(o => /ACTIVE_REAL|HISTORICAL_OUT_OF_SCOPE|SYNTHETIC/.test(
            JSON.stringify(o.set ?? {}))));

    // 20. Cero PII en el manifiesto.
    ok('20· el manifiesto no contiene emails', !/@[\w.-]+\.\w{2,}/.test(raw));
    ok('20· el manifiesto no contiene ids de usuario',
        !/"user-\d|u_[a-z]+"/.test(raw) && !/nombre_completo"\s*:\s*"/.test(raw));
    ok('20· el manifiesto declara invariantes y rollback',
        Array.isArray(manifest.invariants) && manifest.invariants.length >= 5
        && manifest.rollback?.strategy === 'byte-a-byte');
}

// ── Fixtures sintéticas + manifiesto sintético ──────────────────────────────
function makeFixtureRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recon_fx_'));
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data-critical'), { recursive: true });

    const schools = [{ id: 'org-uno', name: 'Institución Uno', createdAt: '2026-01-01T00:00:00.000Z' }];
    const groups = [
        { name: 'Grupo 101', school: 'Colegio Test', grade: '10', teacherId: 'teacher-1', studentIds: [], memberIds: [] },
        { id: 'g-real', school: 'Institución Uno', organizationId: 'org-uno', memberIds: [] },
        { id: 'g-hist', school: 'Otro', memberIds: [] },
    ];
    const users = [
        { id: 'usuario-a', colegio: 'Externado', roles: ['mediador'], accountStatus: 'active' },
        { id: 'usuario-b', colegio: 'Externado', roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active' },
        { id: 'usuario-c', colegio: 'Institución Uno', roles: ['lector'], groupIds: ['g-real'] },
    ];
    const write = (rel, data) => fs.writeFileSync(path.join(root, rel), JSON.stringify(data, null, 2) + '\n');
    write('data/schools_db.json', schools);
    write('data/groups_db.json', groups);
    write('data-critical/usuarios_colegios_oro.json', users);
    return root;
}

/** Manifiesto sintético: mismas operaciones, hashes de las fixtures. */
function makeFixtureManifest(root) {
    const m = JSON.parse(JSON.stringify(manifest));
    for (const rel of Object.keys(m.expectedInputs)) {
        const buf = fs.readFileSync(path.join(root, rel));
        m.expectedInputs[rel] = {
            sha256: sha256(buf), bytes: buf.length,
            records: JSON.parse(buf.toString('utf8')).length,
        };
    }
    m.operations.find(o => o.id === 'OP-A-EXTERNADO-REGISTRO').guard.expectedRecordsBefore = 1;
    const p = path.join(root, 'manifest.fixture.json');
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    return p;
}

// ── §B dry-run no escribe nada ──────────────────────────────────────────────
console.log('\n[B] dry-run no escribe nada');
const root = makeFixtureRoot();
const fixtureManifest = makeFixtureManifest(root);
{
    const snap = (rel) => sha256(fs.readFileSync(path.join(root, rel)));
    const before = Object.keys(manifest.expectedInputs).map(snap);

    const out = runMigration({ root, manifestPath: fixtureManifest });
    ok('modo por defecto es DRY_RUN', out.mode === 'DRY_RUN');
    ok('no se marca como aplicado', out.applied === false);
    ok('detecta los 3 cambios pendientes', out.totalChanges === 4, String(out.totalChanges));
    ok('ningún archivo cambió tras el dry-run',
        Object.keys(manifest.expectedInputs).map(snap).join() === before.join());
    ok('no se creó ningún respaldo en dry-run',
        !fs.existsSync(path.join(root, 'data', 'schools_db.json.pre-CHP-ID-RECON-01B')));
    ok('el diff es agregado y sin PII',
        out.diff.every(d => typeof d.records === 'number' && Array.isArray(d.fields))
        && !JSON.stringify(out.diff).includes('usuario-'));
    ok('el diff nombra las 3 operaciones', out.diff.length === 3);
}

// ── §C idempotencia del dry-run ─────────────────────────────────────────────
console.log('\n[C] idempotencia');
{
    const a = runMigration({ root, manifestPath: fixtureManifest });
    const b = runMigration({ root, manifestPath: fixtureManifest });
    ok('16· dos dry-runs producen el mismo resultado',
        JSON.stringify(a.diff) === JSON.stringify(b.diff) && a.totalChanges === b.totalChanges);
}

// ── §D hash inesperado → STOP ───────────────────────────────────────────────
console.log('\n[D] guardas de entrada');
{
    ok('17· hash inesperado contra el manifiesto real → STOP',
        throwsStop(() => runMigration({ root, manifestPath: REAL_MANIFEST }), 'INPUT_HASH_MISMATCH'));

    const tampered = makeFixtureRoot();
    const tm = makeFixtureManifest(tampered);
    fs.appendFileSync(path.join(tampered, 'data', 'groups_db.json'), ' ');
    ok('17· cualquier byte alterado tras generar el manifiesto → STOP',
        throwsStop(() => runMigration({ root: tampered, manifestPath: tm }), 'INPUT_HASH_MISMATCH'));

    fs.writeFileSync(path.join(tampered, 'data', 'groups_db.json'), '{"no":"array"}');
    ok('schema inválido → STOP',
        throwsStop(() => runMigration({ root: tampered, manifestPath: tm, enforceHashes: false }),
            'SCHEMA_INVALID'));
    fs.rmSync(tampered, { recursive: true, force: true });

    ok('root ausente → STOP', throwsStop(() => runMigration({}), 'ROOT_REQUIRED'));
    ok('archivo de entrada ausente → STOP',
        throwsStop(() => runMigration({ root: os.tmpdir(), manifestPath: fixtureManifest }), 'INPUT_MISSING'));
}

// ── §E seguridad de rutas y BACKUP GATE ─────────────────────────────────────
console.log('\n[E] seguridad');
{
    ok('path escape rechazado',
        throwsStop(() => safeResolve(root, '../fuera.json'), 'PATH_ESCAPE'));
    ok('path absoluto rechazado',
        throwsStop(() => safeResolve(root, path.join(os.tmpdir(), 'x.json')), 'PATH_ESCAPE'));

    let symlinkTested = false;
    try {
        const linkDir = path.join(root, 'data-link');
        fs.symlinkSync(path.join(root, 'data'), linkDir, 'junction');
        symlinkTested = throwsStop(() => safeResolve(root, 'data-link/groups_db.json'), 'SYMLINK_REJECTED');
        fs.rmSync(linkDir, { recursive: true, force: true });
    } catch { symlinkTested = 'skip'; }
    ok('symlink rechazado (o no soportado por el SO)',
        symlinkTested === true || symlinkTested === 'skip', String(symlinkTested));

    ok('apply sin evidencia de BACKUP GATE → STOP',
        throwsStop(() => runMigration({ root, manifestPath: fixtureManifest, apply: true }),
            'BACKUP_GATE_NOT_GREEN'));
    ok('apply con evidencia distinta de GREEN → STOP',
        throwsStop(() => runMigration({ root, manifestPath: fixtureManifest, apply: true,
            backupEvidence: 'YELLOW' }), 'BACKUP_GATE_NOT_GREEN'));
}

// ── §F apply sintético + rollback byte a byte ───────────────────────────────
console.log('\n[F] apply sintético y rollback');
{
    const rels = Object.keys(manifest.expectedInputs);
    const originals = new Map(rels.map(r => [r, fs.readFileSync(path.join(root, r))]));

    const applied = runMigration({ root, manifestPath: fixtureManifest, apply: true,
                                   backupEvidence: 'GREEN' });
    ok('apply explícito ejecuta los cambios', applied.applied === true && applied.totalChanges === 4);

    const groups = JSON.parse(fs.readFileSync(path.join(root, 'data/groups_db.json'), 'utf8'));
    const schools = JSON.parse(fs.readFileSync(path.join(root, 'data/schools_db.json'), 'utf8'));
    const users = JSON.parse(fs.readFileSync(path.join(root, 'data-critical/usuarios_colegios_oro.json'), 'utf8'));

    ok('13· Grupo 101 recibió el id fijo',
        groups.find(g => g.name === 'Grupo 101')?.id === 'group-historical-grupo-101');
    ok('el conteo de grupos no cambió', groups.length === 3);
    ok('Grupo 101 conservó todos sus campos',
        ['name', 'school', 'grade', 'teacherId', 'studentIds', 'memberIds']
            .every(k => k in groups.find(g => g.id === 'group-historical-grupo-101')));
    ok('12· Externado quedó registrado una sola vez',
        schools.filter(s => s.name === 'Externado').length === 1 && schools.length === 2);
    ok('los mediadores de Externado recibieron organizationId',
        users.filter(u => u.colegio === 'Externado').every(u => u.organizationId === 'school-externado'));
    ok('ningún otro usuario fue tocado',
        users.find(u => u.id === 'usuario-c').organizationId === undefined);
    ok('el conteo de usuarios no cambió', users.length === 3);
    ok('D5· no se escribió schoolId en ningún store',
        !JSON.stringify({ groups, schools, users }).includes('schoolId'));

    // Idempotencia del apply.
    const again = runMigration({ root, manifestPath: makeFixtureManifest(root), apply: true,
                                 backupEvidence: 'GREEN' });
    ok('16· una segunda ejecución no produce cambios',
        again.totalChanges === 0 && again.idempotent === true);

    // 18. Rollback byte a byte desde los respaldos.
    let restored = 0;
    for (const rel of rels) {
        const backup = path.join(root, `${rel}.pre-CHP-ID-RECON-01B`);
        if (!fs.existsSync(backup)) continue;
        fs.copyFileSync(backup, path.join(root, rel));
        restored++;
    }
    ok('18· se respaldó cada archivo modificado', restored === 3, String(restored));
    ok('18· rollback restaura los bytes originales exactos',
        rels.every(r => sha256(fs.readFileSync(path.join(root, r))) === sha256(originals.get(r))));
}

// ── §G higiene ──────────────────────────────────────────────────────────────
console.log('\n[G] higiene');
{
    const migrateSrc = fs.readFileSync(path.join(MIGRATION_DIR, 'migrate.mjs'), 'utf8');
    ok('19· el migrador no conoce ninguna ruta productiva',
        !/\/app\/|\/var\/www\//.test(migrateSrc));
    ok('19· --root es obligatorio (sin default)', /ROOT_REQUIRED/.test(migrateSrc));
    ok('el apply usa temporal + rename atómico',
        /\.tmp\.\$\{process\.pid\}/.test(migrateSrc) && /renameSync/.test(migrateSrc));
    ok('el apply respalda antes de escribir', /BACKUP_SUFFIX/.test(migrateSrc));

    // 19. Los stores reales del repositorio siguen intactos.
    const realGroups = path.join(REPO_ROOT, 'data', 'groups_db.json');
    ok('19· ningún store real fue modificado por este test',
        !fs.existsSync(path.join(REPO_ROOT, 'data', 'schools_db.json.pre-CHP-ID-RECON-01B'))
        && !fs.existsSync(`${realGroups}.pre-CHP-ID-RECON-01B`));
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
