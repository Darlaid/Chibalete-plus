/**
 * identityGroupDomains.test.mjs — CHP-IDDB-02C-GAP3-GROUPS-01.
 *
 * Frontera explícita de dominios de lectura de grupos, probada con el SERVER
 * REAL sobre fixtures herméticas que replican la topología productiva
 * (20 grupos JSON = 4 canónicos + 15 legacy atestados + 1 sintético; más un
 * grupo DESCONOCIDO inyectado para el caso fail-closed):
 *
 *   [1] clasificador: fuente atestada única, sin heurísticas
 *   [2] composición: canónico ∪ compat, dedupe, UNKNOWN fuera, telemetría
 *   [3] modo JSON actual: CURRENT_JSON_BEHAVIOR_UNCHANGED
 *   [4] cutover simulado de groups: 4 SQLite + 16 compat, unknown 404,
 *       membresías canónicas sin compat, regla sintética preservada,
 *       authz sin expansión, RMW 21→21
 *   [5] comparador alineado: compat ⇒ gap esperado con clase; unknown ⇒
 *       divergencia (jamás escondido como legacy)
 *
 *   node server/__test__/identityGroupDomains.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const h16 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Fixtures: topología 20+1 (4 canónicos, 15 legacy, 1 sintético, 1 unknown) ─
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gap3_'));
const P = {
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    identity: path.join(tmp, 'identity.db'),
    uploads: path.join(tmp, 'uploads'),
    offline: path.join(tmp, 'offline.db'),
};
fs.mkdirSync(P.uploads, { recursive: true });

const users = [
    { id: 'RU001', email: 'a@fx.test', password: 'pw-1', roles: ['administrador'],
      accountStatus: 'active', organizationId: 'inst-fx-1', colegio: 'Colegio FX' },
];
for (let i = 2; i <= 12; i++) {
    users.push({ id: `RU${String(i).padStart(3, '0')}`, email: `r${i}@fx.test`,
        password: `pw-${i}`, roles: ['lector'], accountStatus: 'active',
        organizationId: 'inst-fx-1', colegio: 'Colegio FX' });
}
for (let i = 1; i <= 5; i++) {
    // M1 RELEASE TRAIN (post-GAP1): la cohorte sintética está RETIRADA —
    // cuentas disabled y regla expirada. El grupo sigue siendo compat atestada.
    users.push({ id: `SYN${i}`, email: `s${i}@fx.test`, password: `pw-s${i}`,
        roles: ['lector'], accountStatus: 'disabled', _loadtest_marker: 'fx' });
}
// Miembro del grupo DESCONOCIDO (para el caso authz fail-closed):
users.push({ id: 'RU099', email: 'x@fx.test', password: 'pw-x', roles: ['lector'],
    accountStatus: 'active', organizationId: 'inst-fx-1', colegio: 'Colegio FX' });

const CANON = [];
for (let i = 1; i <= 4; i++) {
    CANON.push({ id: `g-can-${i}`, name: `Curso ${i}`, type: 'course',
        organizationId: 'inst-fx-1', school: 'Colegio FX', gradeLevel: String(i),
        section: 'A', memberIds: [`RU${String(i + 1).padStart(3, '0')}`],
        mediatorIds: ['RU002'] });
}
const LEGACY = [];
for (let i = 1; i <= 15; i++) {
    LEGACY.push({ id: `g-leg-${i}`, name: `Legacy ${i}`, type: 'course',
        grade: `${i}A`, school: 'Colegio Viejo',
        memberIds: i <= 3 ? [`RU${String(i + 8).padStart(3, '0')}`] : [] });
}
const SYNTH = { id: 'lt-group-fx', name: 'Carga FX', type: 'course',
    organizationId: 'lt-org-fx', memberIds: ['SYN1', 'SYN2', 'SYN3', 'SYN4', 'SYN5'] };
const UNKNOWN = { id: 'g-rogue-nuevo', name: 'Nuevo No Atestado', type: 'course',
    memberIds: ['RU099'] };
const groups21 = [...CANON, ...LEGACY, SYNTH, UNKNOWN];

fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(groups21, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-fx-1', name: 'Colegio FX' }], null, 2));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'lt-access-fx', scope: 'group', scopeId: 'lt-group-fx',
      titleIds: ['t-synth'], collectionIds: [], expiresAt: 1 },   // post-GAP1: expirada
    // Regla hacia el grupo DESCONOCIDO: en modo JSON concede; bajo cutover el
    // grupo es UNKNOWN ⇒ la membresía no resuelve ⇒ DENY (dirección segura).
    { id: 'rule-rogue', scope: 'group', scopeId: 'g-rogue-nuevo',
      titleIds: ['t-rogue'], collectionIds: [], expiresAt: null },
], null, 2));
fs.writeFileSync(P.content, JSON.stringify([
    { id: 't-synth', title: 'T Synth', parentId: null },
    { id: 't-rogue', title: 'T Rogue', parentId: null },
    { id: 't-libre', title: 'T Libre', parentId: null },
], null, 2));

// ── identity.db: espejo v2 por el camino real + exclusiones ATESTADAS ───────
const { getIdentityDb, closeIdentityDb } = await import('../db/identityDb.js');
const { runMigrations } = await import('../db/migrate.js');
const { mirrorSnapshotV2 } = await import('../db/identityShadowV2.js');
const NOW = new Date().toISOString();
{
    closeIdentityDb();
    const db = getIdentityDb(P.identity);
    runMigrations(db, () => {});
    const hashOf = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const seq = Date.now();          // >= mtime de los JSON: espejo asentado
    mirrorSnapshotV2(db, { domain: 'institutions',
        records: [{ id: 'inst-fx-1', name: 'Colegio FX' }],
        sourceVersion: { hash: 'fx-i', seq }, writerId: 'server.writeJSON', at: NOW });
    mirrorSnapshotV2(db, { domain: 'users', records: users,
        sourceVersion: { hash: hashOf(P.users), seq }, writerId: 'server.writeJSON', at: NOW });
    mirrorSnapshotV2(db, { domain: 'groups', records: groups21,
        sourceVersion: { hash: hashOf(P.groups), seq }, writerId: 'server.writeJSON', at: NOW });
    const ins = db.prepare(`INSERT INTO migration_exclusions(exclusion_id,run_id,entity,
        disposition,reference_hash,provenance,created_at) VALUES (?,?,?,?,?,?,?)`);
    db.prepare(`INSERT OR IGNORE INTO migration_runs(run_id,schema_version,source_hashes_json,
        plan_hash,status,started_at) VALUES ('r-fx','v2','{}','p','completed',?)`).run(NOW);
    for (const g of LEGACY) {
        ins.run(`exc_${g.id}`, 'r-fx', 'group',
            'LEGACY_TEST_GROUP_PENDING_RETIREMENT', h16(g.id), 'fixture:01c-r1', NOW);
    }
    ins.run('exc_lt', 'r-fx', 'group', 'SYNTHETIC_LOADTEST_EXCLUDED',
        h16(SYNTH.id), 'fixture:01c-r1', NOW);
    // Auditoría access (vacía pero ok) para el gate 3 del facade en 'access'.
    db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok)
                VALUES ('access',2,0,1)`).run();
    const g = db.prepare(`SELECT COUNT(*) c FROM groups WHERE deleted_at IS NULL`).get().c;
    ok('fixture: espejo canónico = 4 (legacy/sintético/unknown NO proyectados)',
       g === 4, `sqlite groups=${g}`);
    const m = db.prepare(`SELECT COUNT(*) c FROM memberships`).get().c;
    ok('fixture: membresías canónicas > 0 y solo de los 4', m > 0);
    closeIdentityDb();
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[1] CLASIFICADOR: fuente atestada única, fail-closed');
const GD = await import('../db/identityGroupDomains.js');
{
    const db = new Database(P.identity, { readonly: false });
    const excl = GD.attestedGroupExclusionMap(db);
    ok('mapa de exclusiones atestadas = 16', excl.size === 16);
    ok('4 canónicos → CANONICAL',
       CANON.every(g => GD.classifyGroupReadDomain(db, g.id, excl) === 'CANONICAL'));
    ok('15 legacy → ATTESTED_LEGACY_COMPAT',
       LEGACY.every(g => GD.classifyGroupReadDomain(db, g.id, excl) === 'ATTESTED_LEGACY_COMPAT'));
    ok('sintético → ATTESTED_SYNTHETIC_COMPAT',
       GD.classifyGroupReadDomain(db, SYNTH.id, excl) === 'ATTESTED_SYNTHETIC_COMPAT');
    ok('desconocido → UNKNOWN (jamás compat: no está atestado)',
       GD.classifyGroupReadDomain(db, UNKNOWN.id, excl) === 'UNKNOWN');
    ok('id vacío → UNKNOWN', GD.classifyGroupReadDomain(db, '', excl) === 'UNKNOWN');
    // Fila espuria SOLO en SQLite con institución NO registrada: primera línea
    // de defensa = el propio schema (FK) la rechaza…
    let fkBlocked = false;
    try {
        db.prepare(`INSERT INTO groups(group_id,institution_id,name,type,status,provenance,
                    raw_json,created_at,updated_at)
                    VALUES ('g-espurio','inst-fantasma','X','course','active','fixture','{}',
                    datetime('now'),datetime('now'))`).run();
    } catch (e) { fkBlocked = /FOREIGN KEY/i.test(String(e.message)); }
    ok('el schema v2 rechaza por FK una fila con institución no registrada', fkBlocked);
    // …y segunda línea = el clasificador: en una base MANIPULADA (FK off) la
    // fila existe pero NO se vuelve confiable por «existir en SQLite».
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO groups(group_id,institution_id,name,type,status,provenance,
                raw_json,created_at,updated_at)
                VALUES ('g-espurio','inst-fantasma','X','course','active','fixture','{}',
                datetime('now'),datetime('now'))`).run();
    ok('fila espuria (base manipulada) → UNKNOWN, jamás CANONICAL',
       GD.classifyGroupReadDomain(db, 'g-espurio') === 'UNKNOWN');
    db.prepare(`DELETE FROM groups WHERE group_id='g-espurio'`).run();
    db.pragma('foreign_keys = ON');
    db.close();
}

console.log('\n[2] COMPOSICIÓN: canónico ∪ compat, UNKNOWN fuera, telemetría bounded');
{
    const db = new Database(P.identity, { readonly: false });
    const { makeIdentityRepo } = await import('../repositories/identityRepo.js');
    const repo = makeIdentityRepo(db);
    GD._resetGroupDomainTelemetry();
    const counted = {};
    const view = GD.composeGroupReadView({ db, repo, groupsJsonPath: P.groups,
        onCount: (cls, n) => { counted[cls] = (counted[cls] || 0) + n; } });
    ok('vista compuesta = 20 (21 JSON − 1 unknown)', view.length === 20, `len=${view?.length}`);
    const ids = new Set(view.map(g => String(g.id)));
    ok('los 4 canónicos presentes', CANON.every(g => ids.has(g.id)));
    ok('los 16 compat presentes', [...LEGACY, SYNTH].every(g => ids.has(g.id)));
    ok('el desconocido EXCLUIDO (fail-closed, sin fallback)', !ids.has(UNKNOWN.id));
    ok('dedupe por id exacto: sin duplicados', ids.size === view.length);
    const marks = view.map(g => g[GD.GROUP_DOMAIN_MARKER]);
    ok('provenance por registro: 4 canónicos + 15 legacy + 1 sintético',
       marks.filter(m => m === 'CANONICAL').length === 4
       && marks.filter(m => m === 'ATTESTED_LEGACY_COMPAT').length === 15
       && marks.filter(m => m === 'ATTESTED_SYNTHETIC_COMPAT').length === 1,
       JSON.stringify(counted));
    ok('la marca es no-enumerable (invisible en JSON.stringify)',
       !JSON.stringify(view[0]).includes('groupDomain'));
    ok('telemetría por callback: canonical=4 compat=15+1 unknown=1',
       counted.canonical === 4 && counted.compat_legacy === 15
       && counted.compat_synthetic === 1 && counted.unknown_excluded === 1);
    const t = GD.getGroupDomainTelemetry();
    ok('telemetría bounded del módulo coincide',
       t.group_reads_canonical === 4 && t.group_reads_compat_legacy === 15
       && t.group_reads_compat_synthetic === 1 && t.group_reads_unknown === 1
       && t.group_listing_compat_items === 16 && t.compositions === 1, JSON.stringify(t));
    ok('JSON ilegible → null (el facade cae a lectura oficial JSON, contada)',
       GD.composeGroupReadView({ db, repo, groupsJsonPath: path.join(tmp, 'nope.json') }) === null);
    db.close();
}

// ── Server real: helpers de arranque ────────────────────────────────────────
function bootServer(extraEnv) {
    const PORT = 4600 + (process.pid % 300) + (extraEnv.IDENTITY_READ === 'sqlite' ? 1 : 0);
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
            ...extraEnv,
        },
    });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    return { child, base: `http://127.0.0.1:${PORT}`, getLog: () => log };
}
async function waitHealthy(s) {
    for (let i = 0; i < 120; i++) {
        if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.getLog().slice(-1500)}`);
        try { const r = await fetch(`${s.base}/api/health`); if (r.ok) return; } catch {}
        await sleep(400);
    }
    throw new Error(`never healthy\n${s.getLog().slice(-1500)}`);
}
const H = (uid) => ({ 'x-user-id': uid, 'content-type': 'application/json' });
async function decide(base, uid, contentId) {
    const r = await fetch(`${base}/api/content/${contentId}/access?userId=${uid}`,
        { headers: H(uid) });
    const b = await r.json().catch(() => ({}));
    return { status: r.status, allowed: b.allowed === true };
}

try {
    // ════════════════════════════════════════════════════════════════════
    console.log('\n[3] MODO JSON ACTUAL: comportamiento intacto (frontera = no-op)');
    const sJson = bootServer({ IDENTITY_READ: 'json' });
    let jsonBaseline = {};
    try {
        await waitHealthy(sJson);
        const list = await (await fetch(`${sJson.base}/api/groups`, { headers: H('RU001') })).json();
        ok('GET /api/groups sirve los 21 (incluido el no atestado): JSON manda',
           Array.isArray(list) && list.length === 21, `len=${list?.length}`);
        const dSyn = await decide(sJson.base, 'SYN1', 't-synth');
        const dRogue = await decide(sJson.base, 'RU099', 't-rogue');
        const dLibre = await decide(sJson.base, 'RU099', 't-libre');
        jsonBaseline = { dSyn, dRogue, dLibre };
        ok('SYNTHETIC_ACCESS_INACTIVE=true en modo JSON (post-GAP1: regla expirada '
           + 'no concede)', dSyn.allowed === false, JSON.stringify(dSyn));
        ok('regla hacia grupo no atestado concede HOY en modo JSON (baseline a preservar '
           + 'solo en dirección DENY bajo cutover)', dRogue.allowed === true);
        ok('CURRENT_JSON_BEHAVIOR_UNCHANGED=true (lista completa + decisiones del '
           + 'estado post-GAP1)', list.length === 21 && dSyn.allowed === false
           && dRogue.allowed === true);
    } finally { sJson.child.kill(); await sleep(300); }

    // ════════════════════════════════════════════════════════════════════
    console.log('\n[4] CUTOVER SIMULADO DE GROUPS: 4 SQLite + 16 compat, unknown 404');
    const sCut = bootServer({ IDENTITY_READ: 'sqlite', IDENTITY_READ_DOMAINS: 'groups',
        IDENTITY_SHADOW_COMPARE: '1', IDENTITY_SHADOW_COMPARE_DOMAINS: 'groups',
        IDENTITY_SHADOW_COMPARE_TTL_MS: '0', IDENTITY_SHADOW_COMPARE_STALE_MS: '0' });
    try {
        await waitHealthy(sCut);
        const list = await (await fetch(`${sCut.base}/api/groups`, { headers: H('RU001') })).json();
        const ids = new Set(list.map(g => String(g.id)));
        ok('listado compuesto = 20 (4 canónicos + 16 compat)', list.length === 20,
           `len=${list?.length}`);
        ok('canónicos y compat presentes; DESCONOCIDO fuera',
           CANON.every(g => ids.has(g.id)) && [...LEGACY, SYNTH].every(g => ids.has(g.id))
           && !ids.has(UNKNOWN.id));
        const rMem = await fetch(`${sCut.base}/api/groups/g-can-1/members`, { headers: H('RU001') });
        ok('membresía canónica resuelve bajo cutover (200)', rMem.status === 200);
        const rUnk = await fetch(`${sCut.base}/api/groups/${UNKNOWN.id}/members`, { headers: H('RU001') });
        ok('UNKNOWN → 404 contractual, SIN fallback silencioso (SILENT_FALLBACKS=0)',
           rUnk.status === 404, String(rUnk.status));

        const dSyn = await decide(sCut.base, 'SYN1', 't-synth');
        ok('SYNTHETIC_COMPAT_PRESENT=true ∧ SYNTHETIC_ACCESS_INACTIVE=true '
           + '(post-GAP1: el grupo se sirve por compat pero la regla expirada '
           + 'no concede en NINGÚN modo — misma dirección DENY)',
           ids.has(SYNTH.id) && dSyn.allowed === false
           && jsonBaseline.dSyn.allowed === false, JSON.stringify(dSyn));
        const dRogue = await decide(sCut.base, 'RU099', 't-rogue');
        ok('UNKNOWN jamás concede bajo cutover (JSON ALLOW → cutover DENY: dirección segura)',
           dRogue.allowed === false, JSON.stringify(dRogue));
        const dLibre = await decide(sCut.base, 'RU099', 't-libre');
        ok('contenido no concedido: DENY en ambos modos (cero expansión de authz)',
           dLibre.allowed === false && jsonBaseline.dLibre.allowed === false,
           JSON.stringify({ cut: dLibre, json: jsonBaseline.dLibre }));

        console.log('\n[4b] RMW SAFETY bajo cutover: base física, 21→21');
        const put = await fetch(`${sCut.base}/api/groups/g-can-2`, { method: 'PUT',
            headers: H('RU001'), body: JSON.stringify({ name: 'Curso 2 (editado)' }) });
        ok('PUT grupo canónico → 200', put.status === 200, String(put.status));
        const after = JSON.parse(fs.readFileSync(P.groups, 'utf8'));
        ok('cardinalidad física preservada 21→21 (legacy, sintético y unknown sobreviven)',
           after.length === 21, `len=${after.length}`);
        ok('la edición sí se aplicó sobre el JSON físico',
           after.find(g => g.id === 'g-can-2')?.name === 'Curso 2 (editado)');
        ok('los 15 legacy + sintético + unknown intactos en el store físico',
           after.filter(g => g.id.startsWith('g-leg-')).length === 15
           && !!after.find(g => g.id === SYNTH.id) && !!after.find(g => g.id === UNKNOWN.id));
        // El espejo del PUT es async (fire-and-forget): esperar a que asiente
        // antes de matar el server, o la sección [5] vería una divergencia de
        // propagación que no es objeto de esta suite.
        let settled = false;
        for (let i = 0; i < 40 && !settled; i++) {
            await sleep(150);
            try {
                const dbc = new Database(P.identity, { readonly: true });
                const row = dbc.prepare(
                    `SELECT raw_json FROM groups WHERE group_id='g-can-2' AND deleted_at IS NULL`).get();
                dbc.close();
                settled = !!row && JSON.parse(row.raw_json).name === 'Curso 2 (editado)';
            } catch { /* WAL en uso */ }
        }
        ok('el dual-write del PUT asentó en el espejo antes de continuar', settled);

    } finally { sCut.child.kill(); await sleep(300); }

    // ════════════════════════════════════════════════════════════════════
    console.log('\n[5] COMPARADOR ALINEADO (componente): compat ⇒ gap con clase; '
        + 'unknown ⇒ divergencia, jamás escondido');
    {
        process.env.IDENTITY_SQLITE_ENABLED = '1';
        process.env.IDENTITY_SHADOW_COMPARE = '1';
        process.env.IDENTITY_SHADOW_COMPARE_DOMAINS = 'groups';
        process.env.IDENTITY_SHADOW_COMPARE_TTL_MS = '0';
        process.env.IDENTITY_SHADOW_COMPARE_STALE_MS = '0';
        process.env.IDENTITY_DB = P.identity;
        const CMP = await import('../db/identityShadowCompare.js');
        const PATHS = { usersDb: P.users, groupsDb: P.groups, accessDb: P.access,
            schoolsDb: P.schools };
        const jsonNow = JSON.parse(fs.readFileSync(P.groups, 'utf8'));

        // Dirección 1 — HOY (read=json): oficial = JSON crudo. Además se
        // inyecta EN MEMORIA un grupo org-válido fuera de banda (`g-oob`):
        // el caso «productivo legítimo ausente» que JAMÁS puede esconderse.
        const withOob = [...jsonNow, { id: 'g-oob-real', name: 'Fuera de Banda',
            type: 'course', organizationId: 'inst-fx-1', memberIds: [] }];
        CMP.__resetShadowCompare(); closeIdentityDb(); getIdentityDb(P.identity);
        await CMP.warmupShadowCompare();
        CMP.observeIdentityShadowRead(P.groups, withOob, PATHS, {});
        let g = CMP.getShadowCompareSnapshot().byDomain.groups;
        ok('oficial JSON: 17 gaps LEGACY_GROUP = 16 atestados + 1 estructural '
           + '(el rogue sin org no es proyectable: política preexistente, motivo distinto)',
           g.entities.gaps.LEGACY_GROUP === 17, JSON.stringify(g.entities.gaps));
        ok('el grupo org-válido fuera de banda NO se esconde → 1 divergencia inesperada',
           g.entities.unexpected === 1 && g.entities.match === 4, JSON.stringify(g.entities));
        const policies = (g.samples || []).map(s => String(s.policy || ''));
        ok('el motivo del gap declara la clase compat (migration_exclusion:legacy/synthetic)',
           policies.some(p => p === 'migration_exclusion:legacy')
           || policies.some(p => p === 'migration_exclusion:synthetic'),
           JSON.stringify(policies.slice(0, 4)));

        // Dirección 2 — bajo cutover: oficial = vista compuesta (unknown fuera).
        const db2 = getIdentityDb(P.identity);
        const { makeIdentityRepo } = await import('../repositories/identityRepo.js');
        const composed = GD.composeGroupReadView({ db: db2,
            repo: makeIdentityRepo(db2), groupsJsonPath: P.groups });
        CMP.__resetShadowCompare(); closeIdentityDb(); getIdentityDb(P.identity);
        await CMP.warmupShadowCompare();
        CMP.observeIdentityShadowRead(P.groups, composed, PATHS, {});
        g = CMP.getShadowCompareSnapshot().byDomain.groups;
        ok('oficial compuesto: 16 gaps atestados y 0 inesperadas (el unknown quedó '
           + 'excluido ANTES, por el boundary — no por el comparador)',
           g.entities.gaps.LEGACY_GROUP === 16 && g.entities.unexpected === 0,
           JSON.stringify(g.entities));
        ok('coverage NO se convirtió en MATCH artificial: los compat siguen como gap',
           g.entities.match === 4, JSON.stringify(g.entities));
        delete process.env.IDENTITY_SHADOW_COMPARE;
        CMP.__resetShadowCompare(); closeIdentityDb();
    }
} catch (e) {
    ok('escenario ejecutable', false, String(e?.stack || e));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
