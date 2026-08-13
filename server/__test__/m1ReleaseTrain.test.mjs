/**
 * m1ReleaseTrain.test.mjs — CHP-IDDB-M1-RELEASE-TRAIN-00.
 *
 * Fixture contractual COMPLETO del estado M1 (post-GAP1, fronteras GAP3+GAP2
 * integradas) con el server real y CUTOVER SIMULTÁNEO de groups+users,
 * manteniendo LOGIN/WRITES/METRICS en JSON:
 *
 *   users:  648 JSON = 247 canónicos (1 disabled, 1 con resetToken)
 *           + 400 sintéticos DISABLED atestados + 1 fantasma no-proyectable
 *   groups: 21 JSON = 4 canónicos + 15 legacy atestados + 1 sintético
 *           atestado + 1 rogue no atestado
 *   access: lt-access-v2 EXPIRADA (post-GAP1) + regla real activa
 *   tombstones: 11 · memberships canónicas: derivadas de los 4 grupos
 *
 *   node server/__test__/m1ReleaseTrain.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const h16 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_m1_'));
const P = {
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'), identity: path.join(tmp, 'identity.db'),
    uploads: path.join(tmp, 'uploads'), offline: path.join(tmp, 'offline.db'),
};
fs.mkdirSync(P.uploads, { recursive: true });

const REAL_HASH = bcrypt.hashSync('m1-real-pass', 4);
const SYN_HASH = bcrypt.hashSync('m1-syn-pass', 4);

const users = [{ id: 'RU001', email: 'admin@fx.test', password: REAL_HASH,
    roles: ['administrador'], accountStatus: 'active', organizationId: 'inst-fx-1',
    colegio: 'Colegio FX' }];
for (let i = 2; i <= 247; i++) {
    users.push({ id: `RU${String(i).padStart(3, '0')}`, email: `r${i}@fx.test`,
        password: REAL_HASH, roles: ['lector'], accountStatus: 'active',
        organizationId: 'inst-fx-1', colegio: 'Colegio FX' });
}
users.find(u => u.id === 'RU240').accountStatus = 'disabled';
users.find(u => u.id === 'RU241').resetToken = 'm1-reset-' + crypto.randomBytes(4).toString('hex');
const SYN_IDS = [];
for (let i = 1; i <= 400; i++) {
    const id = `lt-user-${String(i).padStart(3, '0')}`;
    SYN_IDS.push(id);
    users.push({ id, email: `lt_${i}@loadtest.fx.local`, password: SYN_HASH,
        roles: ['lector'], accountStatus: 'disabled', _loadtest_marker: '__loadtest__' });
}
users.push({ id: 'u-fantasma', roles: ['lector'], accountStatus: 'active' });

const CANON_GROUPS = [];
for (let i = 1; i <= 4; i++) {
    CANON_GROUPS.push({ id: `g-can-${i}`, name: `Curso ${i}`, type: 'course',
        organizationId: 'inst-fx-1', memberIds: [`RU${String(i + 4).padStart(3, '0')}`],
        mediatorIds: ['RU002'] });
}
const LEGACY_GROUPS = [];
for (let i = 1; i <= 15; i++) {
    LEGACY_GROUPS.push({ id: `g-leg-${i}`, name: `Legacy ${i}`, type: 'course',
        grade: `${i}A`, memberIds: [] });
}
const SYNTH_GROUP = { id: 'lt-group-fx', name: 'Carga', type: 'course',
    organizationId: 'lt-org-fx', memberIds: [...SYN_IDS.slice(0, 20)] };
const ROGUE_GROUP = { id: 'g-rogue', name: 'Rogue', type: 'course', memberIds: [] };
const groups = [...CANON_GROUPS, ...LEGACY_GROUPS, SYNTH_GROUP, ROGUE_GROUP];

fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(groups, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-fx-1', name: 'Colegio FX' }], null, 2));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'lt-access-v2', scope: 'group', scopeId: 'lt-group-fx',
      titleIds: ['t-synth'], collectionIds: [], expiresAt: 1 },
    { id: 'rule-real', scope: 'user', scopeId: 'RU005',
      titleIds: ['t-real'], collectionIds: [], expiresAt: null },
], null, 2));
fs.writeFileSync(P.content, JSON.stringify([
    { id: 't-synth', title: 'S' }, { id: 't-real', title: 'R' },
    { id: 't-libre', title: 'L' }], null, 2));

const TOMB_IDS = Array.from({ length: 11 }, (_, i) => `TS${String(i + 1).padStart(2, '0')}`);
const { getIdentityDb, closeIdentityDb } = await import('../db/identityDb.js');
const { runMigrations } = await import('../db/migrate.js');
const { mirrorSnapshotV2 } = await import('../db/identityShadowV2.js');
const { mirrorAccess } = await import('../db/identityShadow.js');
{
    closeIdentityDb();
    const db = getIdentityDb(P.identity);
    runMigrations(db, () => {});
    const NOW = new Date().toISOString();
    const seq = Date.now();
    mirrorSnapshotV2(db, { domain: 'institutions',
        records: [{ id: 'inst-fx-1', name: 'Colegio FX' }],
        sourceVersion: { hash: 'i', seq }, writerId: 'server.writeJSON', at: NOW });
    mirrorSnapshotV2(db, { domain: 'users', records: users,
        sourceVersion: { hash: 'u', seq }, writerId: 'server.writeJSON', at: NOW });
    mirrorSnapshotV2(db, { domain: 'groups', records: groups,
        sourceVersion: { hash: 'g', seq }, writerId: 'server.writeJSON', at: NOW });
    mirrorAccess(db, JSON.parse(fs.readFileSync(P.access, 'utf8')), () => {}, 'm1-fixture');
    db.prepare(`INSERT OR IGNORE INTO migration_runs(run_id,schema_version,source_hashes_json,
        plan_hash,status,started_at) VALUES ('r-m1','v2','{}','p','completed',?)`).run(NOW);
    const ins = db.prepare(`INSERT INTO migration_exclusions(exclusion_id,run_id,entity,
        disposition,reference_hash,provenance,created_at) VALUES (?,?,?,?,?,?,?)`);
    for (const id of SYN_IDS) {
        ins.run(`exc_${id}`, 'r-m1', 'user', 'SYNTHETIC_LOADTEST_QUARANTINED',
            h16(id), 'fx', NOW);
    }
    for (const g of LEGACY_GROUPS) {
        ins.run(`exc_${g.id}`, 'r-m1', 'group', 'LEGACY_TEST_GROUP_PENDING_RETIREMENT',
            h16(g.id), 'fx', NOW);
    }
    ins.run('exc_ltg', 'r-m1', 'group', 'SYNTHETIC_LOADTEST_EXCLUDED',
        h16(SYNTH_GROUP.id), 'fx', NOW);
    const tomb = db.prepare(`INSERT INTO identity_tombstones(tombstone_id,legacy_identity_hash,
        classification,source,provenance,policy_version,created_at) VALUES (?,?,?,?,?,?,?)`);
    for (const id of TOMB_IDS) tomb.run(`t_${id}`, h16(id), 'RETIRED', 'fx', 'fx', '1', NOW);
    const uc = db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c;
    const gc = db.prepare(`SELECT COUNT(*) c FROM groups WHERE deleted_at IS NULL`).get().c;
    const ac = db.prepare(`SELECT COUNT(*) c FROM access_rules WHERE deleted_at IS NULL`).get().c;
    ok('fixture M1: espejo 247 users / 4 groups / 2 access_rules',
       uc === 247 && gc === 4 && ac === 2, `${uc}/${gc}/${ac}`);
    closeIdentityDb();
}

const PORT = 5600 + (process.pid % 200);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: path.join(tmp, 'data'),
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1',
        IDENTITY_DUAL_WRITE: '1',
        IDENTITY_READ: 'sqlite', IDENTITY_READ_DOMAINS: 'users,groups',
    },
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });
const H = (uid) => ({ 'x-user-id': uid, 'content-type': 'application/json' });

try {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`rc=${child.exitCode}\n${bootLog.slice(-1500)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
        await sleep(400);
    }

    console.log('\n[M1] CUTOVER DUAL groups+users; login/writes/metrics JSON');
    ok('login real 200 (LOGIN=JSON bajo cutover dual)',
       (await fetch(`${base}/api/auth/login`, { method: 'POST',
           headers: { 'content-type': 'application/json' },
           body: JSON.stringify({ email: 'r5@fx.test', password: 'm1-real-pass' }) })).status === 200);
    ok('login sintético disabled 401',
       (await fetch(`${base}/api/auth/login`, { method: 'POST',
           headers: { 'content-type': 'application/json' },
           body: JSON.stringify({ email: 'lt_7@loadtest.fx.local', password: 'm1-syn-pass' }) })).status === 401);

    const ulist = await (await fetch(`${base}/api/users`, { headers: H('RU001') })).json();
    const uids = new Set(ulist.map(u => String(u.id)));
    ok('users ADMIN: 647 (247 SQLite + 400 compat), fantasma y tombstones fuera',
       ulist.length === 647 && uids.has('RU005') && uids.has('lt-user-001')
       && !uids.has('u-fantasma') && !uids.has('TS01'), `len=${ulist.length}`);

    const glist = await (await fetch(`${base}/api/groups`, { headers: H('RU001') })).json();
    const gids = new Set(glist.map(g => String(g.id)));
    ok('groups: 20 (4 SQLite + 15 legacy compat + 1 sintético compat), rogue FUERA',
       glist.length === 20 && gids.has('g-can-1') && gids.has('g-leg-15')
       && gids.has('lt-group-fx') && !gids.has('g-rogue'), `len=${glist.length}`);

    const dSyn = await (await fetch(`${base}/api/content/t-synth/access?userId=lt-user-001`,
        { headers: H('lt-user-001') })).json().catch(() => ({}));
    ok('synthetic access INACTIVO (regla expirada + cohorte fuera del universo '
       + 'operativo): allowed=false', dSyn.allowed !== true);

    const dReal = await (await fetch(`${base}/api/content/t-real/access?userId=RU005`,
        { headers: H('RU005') })).json();
    ok('access equivalence: regla real concede bajo cutover dual', dReal.allowed === true);

    const mem = await fetch(`${base}/api/groups/g-can-1/members`, { headers: H('RU001') });
    ok('membresías canónicas resolubles (grupo SQLite + users SQLite)', mem.status === 200);

    ok('tombstone → 404',
       (await fetch(`${base}/api/students/TS01/status`, { headers: H('RU001') })).status === 404);
    ok('unknown user → 404',
       (await fetch(`${base}/api/students/u-fantasma/status`, { headers: H('RU001') })).status === 404);
    ok('unknown group → 404',
       (await fetch(`${base}/api/groups/g-rogue/members`, { headers: H('RU001') })).status === 404);

    const src = fs.readFileSync(path.join(REPO, 'server/server.js'), 'utf8');
    ok('métricas: universo JSON físico intacto (loadAndInitMetrics pineado + '
       + 'metricsProvider ya-físico)',
       /readJSONMetricsLegacy\(USERS_DB\)/.test(src));

    console.log('\n[M1] RMW dual + credenciales fuera de SQLite');
    const putU = await fetch(`${base}/api/users/RU006`, { method: 'PUT',
        headers: H('RU001'), body: JSON.stringify({ nombre_completo: 'M1 Edit' }) });
    const putG = await fetch(`${base}/api/groups/g-can-2`, { method: 'PUT',
        headers: H('RU001'), body: JSON.stringify({ name: 'Curso 2 M1' }) });
    const uAfter = JSON.parse(fs.readFileSync(P.users, 'utf8'));
    const gAfter = JSON.parse(fs.readFileSync(P.groups, 'utf8'));
    ok('RMW: users 648→648 y groups 21→21 con base física JSON',
       putU.status === 200 && putG.status === 200
       && uAfter.length === 648 && gAfter.length === 21,
       `${putU.status}/${putG.status}/${uAfter.length}/${gAfter.length}`);
    ok('credenciales preservadas en JSON (647 con password) y fantasma/rogue vivos',
       uAfter.filter(u => typeof u.password === 'string').length === 647
       && !!uAfter.find(u => u.id === 'u-fantasma') && !!gAfter.find(g => g.id === 'g-rogue'));
    {
        const db = new Database(P.identity, { readonly: true });
        const leaks = db.prepare(`SELECT raw_json FROM users WHERE deleted_at IS NULL`).all()
            .filter(r => /password|resetToken|inviteToken/.test(r.raw_json)).length;
        db.close();
        ok('CREDENTIALS_IN_SQLITE=0 tras mutaciones', leaks === 0);
    }
} catch (e) {
    ok('escenario ejecutable', false, String(e?.stack || e));
} finally {
    child.kill(); await sleep(400);
}

console.log('\n[M1] COMPARADOR integrado: 0 inesperadas / 0 seguridad / 0 errores');
{
    process.env.IDENTITY_SQLITE_ENABLED = '1';
    process.env.IDENTITY_SHADOW_COMPARE = '1';
    process.env.IDENTITY_SHADOW_COMPARE_DOMAINS = 'users,groups,institutions,memberships,access';
    process.env.IDENTITY_SHADOW_COMPARE_TTL_MS = '0';
    process.env.IDENTITY_SHADOW_COMPARE_STALE_MS = '600000';
    process.env.IDENTITY_DB = P.identity;
    const CMP = await import('../db/identityShadowCompare.js');
    const PATHS = { usersDb: P.users, groupsDb: P.groups, accessDb: P.access,
        schoolsDb: P.schools };
    CMP.__resetShadowCompare(); closeIdentityDb(); getIdentityDb(P.identity);
    await CMP.warmupShadowCompare();
    // Esperar settle de los espejos de las mutaciones del server (async).
    await sleep(1500);
    CMP.observeIdentityShadowRead(P.users, JSON.parse(fs.readFileSync(P.users, 'utf8')), PATHS, {});
    CMP.observeIdentityShadowRead(P.groups, JSON.parse(fs.readFileSync(P.groups, 'utf8')), PATHS, {});
    CMP.observeIdentityShadowRead(P.access, JSON.parse(fs.readFileSync(P.access, 'utf8')), PATHS, {});
    const s = CMP.getShadowCompareSnapshot();
    const tot = ['users', 'groups', 'access', 'memberships'].map(d => s.byDomain[d])
        .filter(Boolean);
    const unexpected = tot.reduce((a, d) => a + d.entities.unexpected, 0);
    const security = tot.reduce((a, d) => a + d.entities.security, 0);
    ok('UNEXPECTED=0, SECURITY=0, ERRORS=0 en el árbol integrado',
       unexpected === 0 && security === 0 && s.totals.comparator_errors === 0,
       JSON.stringify({ unexpected, security,
           gaps: Object.fromEntries(tot.map((d, i) =>
               [['users', 'groups', 'access', 'memberships'][i], d.entities.gaps])) }));
    ok('gaps solo los contractuales: SYNTHETIC_USER=400 + fantasma estructural; '
       + 'LEGACY_GROUP=17 (16 atestados + 1 estructural del rogue org-less, '
       + 'motivo distinto — semántica verificada en GAP3)',
       s.byDomain.users.entities.gaps.SYNTHETIC_USER === 400
       && (s.byDomain.users.entities.gaps.NOT_PROJECTABLE_BY_POLICY ?? 0) === 1
       && s.byDomain.groups.entities.gaps.LEGACY_GROUP === 17,
       JSON.stringify({ u: s.byDomain.users.entities.gaps,
           g: s.byDomain.groups.entities.gaps }));
    ok('access: 2 reglas MATCH (espejo de la integración converge)',
       s.byDomain.access.entities.match === 2,
       JSON.stringify(s.byDomain.access.entities));
    delete process.env.IDENTITY_SHADOW_COMPARE;
    CMP.__resetShadowCompare(); closeIdentityDb();
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
