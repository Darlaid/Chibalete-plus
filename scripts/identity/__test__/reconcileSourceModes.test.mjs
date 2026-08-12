/**
 * reconcileSourceModes.test.mjs — CHP-IDDB-RECONCILE-LIVE-SOURCES-01.
 *
 * Separación entre la ATESTACIÓN CONGELADA de la migración histórica (modo
 * frozen, hash-pinned) y la RECONCILIACIÓN VIVA contra las fuentes canónicas de
 * hoy (modo live, con garantías propias).
 *
 * Todo ocurre sobre fixtures sintéticas en un directorio temporal con la MISMA
 * disposición que producción (`data/` y `data-critical/`). Ningún caso toca
 * stores reales ni rutas productivas.
 *
 *   node scripts/identity/__test__/reconcileSourceModes.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../server/db/migrate.js';
import { mirrorSnapshotV2 } from '../../../server/db/identityShadowV2.js';
import { buildManifest } from '../buildImportManifest.mjs';
import { reconcileIdentityShadow, parseArgs, SOURCE_MODES } from '../reconcileIdentityShadow.mjs';
import { resolveLiveSources, CANONICAL_LIVE_SOURCES } from '../identityLiveSources.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const h8 = (v) => sha(v).slice(0, 8);
const h16 = (v) => sha(v).slice(0, 16);
const NOW = '2026-01-01T00:00:00Z';
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e.classification ?? e.message; } };
const caughtSync = (fn) => { try { fn(); return null; } catch (e) { return e.classification ?? e.message; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb_rls01_'));
const ROOT = path.join(tmp, 'root');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'data-critical'), { recursive: true });

const P = {
    padron: path.join(ROOT, 'data-critical', 'usuarios_colegios_oro.json'),
    groups: path.join(ROOT, 'data', 'groups_db.json'),
    institutions: path.join(ROOT, 'data', 'schools_db.json'),
};
const writeAt = (p, o) => { fs.writeFileSync(p, JSON.stringify(o, null, 1)); return p; };
const F = (n) => path.join(tmp, n);
const write = (n, o) => { fs.writeFileSync(F(n), JSON.stringify(o, null, 1)); return F(n); };

// ── Fixtures: reproducen la topología real (grupos legacy sin organizationId,
//    un grupo de carga apuntando a una organización inexistente, cohorte
//    sintética marcada). Si el contrato LIVE fuese demasiado estricto, estas
//    fixtures lo delatarían igual que lo haría producción.
const INST = [{ id: 'inst-a', name: 'Alfa' }, { id: 'inst-b', name: 'Beta' }];
const GROUPS = [
    { id: 'g-can', organizationId: 'inst-a', name: 'Primero A', type: 'course',
      school: 'Alfa', studentIds: ['u1', 'u2'], mediatorIds: ['u2'] },
    { id: 'g-legacy', name: 'Viejo', grade: '10', school: 'Colegio Test', studentIds: ['u1'] },
    { id: 'lt-test-group', organizationId: 'lt-org', name: 'Carga', type: 'course', studentIds: [] },
];
const USERS = [
    { id: 'u1', email: 'u1@x.cl', roles: ['lector'], accountStatus: 'active' },
    { id: 'u2', email: 'u2@x.cl', roles: ['mediador'], accountStatus: 'active' },
    { id: 'u-synth', email: 'lt@x.cl', roles: ['lector'], accountStatus: 'active', _loadtest_marker: true },
];
writeAt(P.padron, USERS); writeAt(P.groups, GROUPS); writeAt(P.institutions, INST);

// Artefactos congelados mínimos para poder construir un manifiesto 02A válido.
const MAPPING = { groups: [
    { groupAlias: 'GRP_' + h8('g-can'), resolutionClass: 'CANONICAL_ORG_ID_CONFIRMED',
      proposedOrganizationIdHash: h8('inst-a') },
    { groupAlias: 'GRP_' + h8('g-legacy'), resolutionClass: 'LEGACY_TEST_GROUP_PENDING_RETIREMENT',
      proposedOrganizationIdHash: null },
    { groupAlias: 'GRP_' + h8('lt-test-group'), resolutionClass: 'SYNTHETIC_LOADTEST_EXCLUDED',
      proposedOrganizationIdHash: null },
] };
const TOMBSTONES = { count: 0, tombstones: [] };
const ORPHANS = { orphans: [] };
const DRY01D = { counts: { users: { MIGRATABLE: 2 }, institutions: { MIGRATABLE: 2 },
    groups: { MIGRATABLE: 1 }, memberships: { MIGRATABLE: 3 }, tombstones: 0 } };
const frozenPaths = {
    padron: P.padron, groups: P.groups, institutions: P.institutions,
    mapping: write('mapping.json', MAPPING), tombstones: write('tombstones.json', TOMBSTONES),
    orphans: write('orphans.json', ORPHANS), dryRun01d: write('dryrun01d.json', DRY01D),
    attestation: write('att.json', { ok: true }),
};
const MANP = write('manifest-02a.json',
    buildManifest({ ...frozenPaths, outputDb: F('out.candidate.db'), sourceCommit: 'cafe', generatedAt: NOW }));

// ── Espejo coherente con las fixtures ────────────────────────────────────
const DBP = F('identity.db');
const db = new Database(DBP);
db.pragma('foreign_keys = ON');
runMigrations(db);
db.prepare(`INSERT INTO migration_runs(run_id,schema_version,source_hashes_json,plan_hash,status,
            started_at) VALUES ('r1','v2','{}','p','completed',?)`).run(NOW);
// El grupo de carga queda excluido, igual que en producción.
db.prepare(`INSERT INTO migration_exclusions(exclusion_id,run_id,entity,disposition,reference_hash,
            provenance,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run('exc_lt', 'r1', 'group', 'EXCLUDED', h16('lt-test-group'), 't', NOW);
const sv = (r, seq) => ({ hash: sha(JSON.stringify(r)).slice(0, 32), seq });
for (const [domain, records] of [['institutions', INST], ['users', USERS], ['groups', GROUPS]]) {
    mirrorSnapshotV2(db, { domain, records, sourceVersion: sv(records, 1),
        writerId: 'server.writeJSON', at: NOW });
}
db.close();

const snapshotDb = () => { const c = F('copy-' + Math.abs(sha(String(fs.readFileSync(DBP).length + Date.now()))
    .slice(0, 8)) + '.db'); fs.copyFileSync(DBP, c); return c; };
const restore = { padron: fs.readFileSync(P.padron), groups: fs.readFileSync(P.groups),
    institutions: fs.readFileSync(P.institutions) };
const restoreAll = () => { fs.writeFileSync(P.padron, restore.padron);
    fs.writeFileSync(P.groups, restore.groups); fs.writeFileSync(P.institutions, restore.institutions); };

try {
    // ── FASE 5 — el freeze histórico NO se debilita ──────────────────────
    console.log('\n[F5] atestación congelada: sigue fijada al byte');
    const frozenOk = await reconcileIdentityShadow({ mode: 'check', sourceMode: 'frozen',
        manifestPath: MANP, identityDbPath: DBP });
    ok('frozen PASA con la fixture exacta 02A', frozenOk.state === 'MATCH', JSON.stringify(frozenOk.counts));
    ok('frozen declara sus hashes como FIJADOS', frozenOk.attestation.hashesArePinned === true);
    ok('frozen reporta identidad de fuente canónica',
        Object.keys(frozenOk.attestation.canonicalSourceIdentity).sort().join() === 'groups,institutions,padron');

    writeAt(P.groups, [...GROUPS, { id: 'g-extra', organizationId: 'inst-b', name: 'X', type: 'course' }]);
    ok('frozen FALLA si cambia un byte de groups_db.json',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'frozen',
            manifestPath: MANP, identityDbPath: DBP })) === 'SOURCE_HASH_MISMATCH');
    restoreAll();

    writeAt(P.padron, [...USERS, { id: 'u9', email: 'u9@x.cl', roles: ['lector'], accountStatus: 'active' }]);
    ok('frozen FALLA si cambia el padrón',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'frozen',
            manifestPath: MANP, identityDbPath: DBP })) === 'SOURCE_HASH_MISMATCH');
    restoreAll();

    const movedManifest = JSON.parse(fs.readFileSync(MANP, 'utf8'));
    movedManifest.sources.groups.path = path.join(ROOT, 'data', 'no-existe.json');
    const MANP_MOVED = write('manifest-moved.json', movedManifest);
    ok('frozen FALLA si cambia la ruta',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'frozen',
            manifestPath: MANP_MOVED, identityDbPath: DBP })) !== null);

    // ── FASE 6 — contrato LIVE ───────────────────────────────────────────
    console.log('\n[F6] reconciliación viva contra las fuentes de hoy');
    const live = (extra = {}) => reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
        sourcesRoot: ROOT, identityDbPath: DBP, ...extra });

    // Caso 1 — fuentes actuales sin cambios → MATCH
    const c1 = await live();
    ok('caso 1: fuentes sin cambios → MATCH', c1.state === 'MATCH', JSON.stringify(c1.counts));
    ok('caso 1: live NO fija hashes', c1.attestation.hashesArePinned === false);
    ok('caso 1: live registra el hash ACTUAL de cada fuente',
        /^[0-9a-f]{64}$/.test(c1.attestation.canonicalSourceIdentity.groups.sha256));
    ok('caso 1: live contabiliza la cohorte sintética',
        c1.attestation.accounting.padronSynthetic === 1 && c1.attestation.accounting.padronReal === 2);

    // Caso 2 — normalizeGroup añade derivados legítimos (el defecto real)
    const normalized = JSON.parse(JSON.stringify(GROUPS));
    const legacy = normalized.find(g => g.id === 'g-legacy');
    legacy.type = 'course'; legacy.mediatorIds = []; legacy.gradeLevel = 10;
    writeAt(P.groups, normalized);
    const hashChanged = sha(fs.readFileSync(P.groups)) !== sha(restore.groups);
    const c2 = await live();
    ok('caso 2: el hash de la fuente CAMBIÓ de verdad', hashChanged);
    ok('caso 2: live no aborta por SOURCE_HASH_MISMATCH', c2.state === 'MATCH', JSON.stringify(c2.counts));
    ok('caso 2: frozen SÍ aborta con las mismas fuentes',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'frozen',
            manifestPath: MANP, identityDbPath: DBP })) === 'SOURCE_HASH_MISMATCH');
    restoreAll();

    // Caso 3 — grupo legítimamente editado: cambia el hash y el reconciliador sigue operativo
    const renamed = JSON.parse(JSON.stringify(GROUPS));
    renamed.find(g => g.id === 'g-can').name = 'Primero A (2026)';
    writeAt(P.groups, renamed);
    const c3 = await live();
    ok('caso 3: edición legítima → el instrumento sigue funcionando, sin error de fuente',
        c3.state === 'DIVERGENT' && c3.counts.groups.STALE_IN_SQLITE === 1,
        JSON.stringify(c3.counts.groups));
    ok('caso 3: el hash vivo refleja el fichero editado',
        c3.attestation.canonicalSourceIdentity.groups.sha256 === sha(fs.readFileSync(P.groups)));
    restoreAll();

    // Caso 4 — archivo incorrecto/legacy → FAIL CLOSED
    fs.rmSync(P.groups);
    ok('caso 4a: fuente canónica ausente → fail closed',
        await caught(() => live()) === 'LIVE_SOURCE_NOT_FOUND');
    restoreAll();
    const LEGACY_ROOT = path.join(tmp, 'legacyroot');
    fs.mkdirSync(path.join(LEGACY_ROOT, 'data'), { recursive: true });
    fs.mkdirSync(path.join(LEGACY_ROOT, 'data-critical'), { recursive: true });
    writeAt(path.join(LEGACY_ROOT, 'data', 'groups_db.json'), GROUPS);
    writeAt(path.join(LEGACY_ROOT, 'data', 'schools_db.json'), INST);
    // el padrón superseded NO puede ocupar el lugar del oro
    writeAt(path.join(LEGACY_ROOT, 'data-critical', 'users_db.json'), USERS);
    ok('caso 4b: sin el padrón oro no hay fallback al superseded users_db.json',
        await caught(() => live({ sourcesRoot: LEGACY_ROOT })) === 'LIVE_SOURCE_NOT_FOUND');
    ok('caso 4c: users_db.json queda vetado por basename aunque se le apunte',
        caughtSync(() => resolveLiveSources({ sourcesRoot: LEGACY_ROOT })) === 'LIVE_SOURCE_NOT_FOUND');
    ok('caso 4d: raíz inexistente → fail closed',
        caughtSync(() => resolveLiveSources({ sourcesRoot: path.join(tmp, 'nope') }))
            === 'LIVE_SOURCES_ROOT_NOT_FOUND');
    ok('caso 4e: sin raíz declarada → fail closed',
        caughtSync(() => resolveLiveSources({})) === 'LIVE_SOURCES_ROOT_REQUIRED');

    // Caso 5 — JSON malformado → FAIL CLOSED
    fs.writeFileSync(P.groups, '{ esto no es json');
    ok('caso 5a: JSON malformado → fail closed',
        await caught(() => live()) === 'LIVE_SOURCE_MALFORMED_JSON');
    fs.writeFileSync(P.groups, JSON.stringify({ groups: GROUPS }, null, 1));
    ok('caso 5b: forma inesperada (objeto en vez de array) → fail closed, NO cero filas en silencio',
        await caught(() => live()) === 'LIVE_SOURCE_SHAPE_INVALID');
    fs.writeFileSync(P.groups, '[]');
    ok('caso 5c: array vacío → fail closed', await caught(() => live()) === 'LIVE_SOURCE_EMPTY');
    writeAt(P.groups, [{ name: 'sin id' }, ...GROUPS]);
    ok('caso 5d: registro sin id → fail closed',
        await caught(() => live()) === 'LIVE_SOURCE_RECORD_WITHOUT_ID');
    writeAt(P.groups, [null, ...GROUPS]);
    ok('caso 5e: registro que no es objeto → fail closed',
        await caught(() => live()) === 'LIVE_SOURCE_RECORD_NOT_OBJECT');
    restoreAll();
    writeAt(P.institutions, [{ id: 'inst-a' }, { id: 'inst-b', name: 'Beta' }]);
    ok('caso 5f: institución sin nombre → fail closed',
        await caught(() => live()) === 'LIVE_SOURCE_INSTITUTION_WITHOUT_NAME');
    restoreAll();

    // Caso 6 — identidades canónicas duplicadas → FAIL CLOSED
    writeAt(P.padron, [...USERS, { id: 'u1', email: 'otro@x.cl', roles: ['lector'], accountStatus: 'active' }]);
    ok('caso 6a: id duplicado con contenido divergente → fail closed',
        await caught(() => live()) === 'LIVE_SOURCE_DUPLICATE_IDENTITY');
    writeAt(P.padron, [...USERS, USERS[0]]);
    ok('caso 6b: id duplicado pero idéntico se tolera',
        (await live()).state === 'MATCH');
    restoreAll();

    // Caso 7 — cohorte sintética: exclusión contractual
    const c7 = await live();
    const dbc = new Database(DBP, { readonly: true });
    const synthPresent = dbc.prepare(`SELECT COUNT(*) n FROM users WHERE canonical_id='u-synth'`).get().n;
    dbc.close();
    ok('caso 7: la identidad sintética no está en el espejo', synthPresent === 0);
    ok('caso 7: live la contabiliza y sigue en MATCH',
        c7.attestation.accounting.padronSynthetic === 1 && c7.state === 'MATCH');
    writeAt(P.padron, USERS.map(u => ({ ...u, _loadtest_marker: true })));
    ok('caso 7b: un padrón íntegramente sintético → fail closed',
        await caught(() => live()) === 'LIVE_SOURCE_PADRON_ONLY_SYNTHETIC');
    restoreAll();

    // Caso 8 — divergencia real de dominio: se reporta como divergencia, NO como fallo de fuente
    const DIVP = snapshotDb();
    const dv = new Database(DIVP);
    dv.prepare(`DELETE FROM memberships WHERE group_id='g-can' AND user_id='u2' AND role='mediator'`).run();
    dv.prepare(`UPDATE groups SET name='Nombre Torcido' WHERE group_id='g-can'`).run();
    dv.close();
    const c8 = await live({ identityDbPath: DIVP });
    ok('caso 8: divergencia real → MISSING/STALE, no error de fuente',
        c8.state === 'DIVERGENT' && c8.counts.memberships.MISSING_IN_SQLITE === 1
        && c8.counts.groups.STALE_IN_SQLITE === 1,
        JSON.stringify({ g: c8.counts.groups, m: c8.counts.memberships }));
    ok('caso 8: aun divergiendo, la atestación de fuente viva se emite',
        c8.attestation.sourceMode === 'live' && !!c8.attestation.canonicalSourceIdentity.padron.sha256);

    // ── Separación explícita de modos ────────────────────────────────────
    console.log('\n[F4/F8] los dos modos no se suplantan');
    ok('el modo por defecto es frozen, el más estricto', parseArgs([]).sourceMode === 'frozen');
    ok('--source-mode live se pide explícitamente',
        parseArgs(['--source-mode', 'live', '--sources-root', '/x']).sourceMode === 'live');
    ok('los modos declarados son exactamente frozen y live', SOURCE_MODES.join() === 'frozen,live');
    ok('modo desconocido → fail closed',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'bogus',
            sourcesRoot: ROOT, identityDbPath: DBP })) === 'SOURCE_MODE_UNKNOWN');
    ok('live + --source-manifest → ambiguo, fail closed',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'live',
            sourcesRoot: ROOT, manifestPath: MANP, identityDbPath: DBP })) === 'SOURCE_MODE_AMBIGUOUS');
    ok('frozen + --sources-root → ambiguo, fail closed',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'frozen',
            manifestPath: MANP, sourcesRoot: ROOT, identityDbPath: DBP })) === 'SOURCE_MODE_AMBIGUOUS');
    ok('live + apply → NO autorizado (apply no se amplía en esta unidad)',
        await caught(() => reconcileIdentityShadow({ mode: 'apply', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: snapshotDb() })) === 'LIVE_APPLY_NOT_AUTHORIZED');
    ok('ni siquiera con el escape interno: apply exige manifiesto atestado',
        await caught(() => reconcileIdentityShadow({ mode: 'apply', sourceMode: 'live',
            sourcesRoot: ROOT, identityDbPath: snapshotDb(), allowLiveApply: true }))
            === 'APPLY_REQUIRES_ATTESTED_MANIFEST');
    ok('live + plan sí está soportado (read-only)',
        (await live({ mode: 'plan' })).mode === 'plan');
    ok('la disposición canónica es la de producción',
        CANONICAL_LIVE_SOURCES.padron.dir === 'data-critical'
        && CANONICAL_LIVE_SOURCES.groups.dir === 'data');

    // frozen sigue exigiendo manifiesto
    ok('frozen sin manifiesto → fail closed',
        await caught(() => reconcileIdentityShadow({ mode: 'check', sourceMode: 'frozen',
            identityDbPath: DBP })) === 'MANIFEST_REQUIRED');
} catch (e) {
    console.error('\nEXCEPCIÓN NO CONTROLADA:', e);
    fail++;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
