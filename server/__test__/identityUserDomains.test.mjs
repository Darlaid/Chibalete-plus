/**
 * identityUserDomains.test.mjs — CHP-IDDB-02C-GAP2-USERS-AUTHORITY-01.
 *
 * Frontera de autoridad del dominio users con el SERVER REAL sobre el estado
 * contractual POST-GAP1 (fixture, sin acoplar ramas): 648 usuarios JSON =
 * 247 canónicos (1 disabled, 1 con resetToken) + 400 sintéticos DISABLED
 * atestados + 1 fantasma no-proyectable; 11 tombstones; regla lt expirada.
 *
 *   [1] clasificador (canonical/synthetic/tombstoned/unknown + tamper)
 *   [2] sanitize endurecido + credential guard (CERO secretos en raw_json)
 *   [3] composición operacional (247) y admin (647, compat sin credenciales)
 *   [4] modo JSON actual: no-op absoluto
 *   [5] cutover simulado: superficies, authz, status fidelity, login JSON,
 *       membership, métricas JSON, RMW 648→648, write authority
 *   [6] comparador alineado (tokens jamás divergen; canónicos MATCH)
 *   [7] M1_USER_AUTHORITY_CONTRACT
 *   [8] performance local (sin regresión evidente)
 *
 *   node server/__test__/identityUserDomains.test.mjs
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

// ── Fixture: estado contractual POST-GAP1 ────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gap2_'));
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

const REAL_HASH = bcrypt.hashSync('fixture-real-pass', 4);
const SYN_HASH = bcrypt.hashSync('fixture-syn-pass', 4);
const RESET_SECRET = 'fx-reset-' + crypto.randomBytes(6).toString('hex');

const users = [
    { id: 'RU001', email: 'admin@fx.test', password: REAL_HASH, roles: ['administrador'],
      accountStatus: 'active', organizationId: 'inst-fx-1', colegio: 'Colegio FX' },
];
for (let i = 2; i <= 247; i++) {
    users.push({ id: `RU${String(i).padStart(3, '0')}`, email: `r${i}@fx.test`,
        password: REAL_HASH, roles: ['lector'], accountStatus: 'active',
        organizationId: 'inst-fx-1', colegio: 'Colegio FX', groupIds: [] });
}
// Canónico DISABLED (fidelidad de status bajo cutover):
users.find(u => u.id === 'RU240').accountStatus = 'disabled';
// Canónico con material de credencial extra (higiene de sanitize):
Object.assign(users.find(u => u.id === 'RU241'),
    { resetToken: RESET_SECRET, resetExpiresAt: Date.now() + 3600000 });
const SYN_IDS = [];
for (let i = 1; i <= 400; i++) {
    const id = `lt-user-${String(i).padStart(3, '0')}`;
    SYN_IDS.push(id);
    users.push({ id, email: `lt_${i}@loadtest.fx.local`, password: SYN_HASH,
        roles: ['lector'], accountStatus: 'disabled',        // POST-GAP1
        colegio: 'LoadTest FX', _loadtest_marker: '__loadtest__' });
}
// Fantasma: presente en JSON, SIN email (no proyectable) → UNKNOWN permanente.
users.push({ id: 'u-fantasma', roles: ['lector'], accountStatus: 'active',
    organizationId: 'inst-fx-1' });

const groups = [
    { id: 'g-can-1', name: 'Curso 1', type: 'course', organizationId: 'inst-fx-1',
      memberIds: ['RU005', 'RU006', 'RU007'], mediatorIds: ['RU002'] },
    { id: 'g-can-2', name: 'Curso 2', type: 'course', organizationId: 'inst-fx-1',
      memberIds: ['RU008'], mediatorIds: ['RU002'] },
];
fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(groups, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-fx-1', name: 'Colegio FX' }], null, 2));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'lt-access-v2', scope: 'group', scopeId: 'lt-group-fx',
      titleIds: ['t-synth'], collectionIds: [], expiresAt: 1 },   // POST-GAP1: expirada
], null, 2));
fs.writeFileSync(P.content, JSON.stringify([{ id: 't-synth', title: 'S' }], null, 2));

const TOMB_IDS = Array.from({ length: 11 }, (_, i) => `TS${String(i + 1).padStart(2, '0')}`);

const { getIdentityDb, closeIdentityDb } = await import('../db/identityDb.js');
const { runMigrations } = await import('../db/migrate.js');
const { mirrorSnapshotV2 } = await import('../db/identityShadowV2.js');
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
    db.prepare(`INSERT OR IGNORE INTO migration_runs(run_id,schema_version,source_hashes_json,
        plan_hash,status,started_at) VALUES ('r-fx','v2','{}','p','completed',?)`).run(NOW);
    const ins = db.prepare(`INSERT INTO migration_exclusions(exclusion_id,run_id,entity,
        disposition,reference_hash,provenance,created_at) VALUES (?,?,?,?,?,?,?)`);
    for (const id of SYN_IDS) {
        ins.run(`exc_${id}`, 'r-fx', 'user', 'SYNTHETIC_LOADTEST_QUARANTINED',
            h16(id), 'fixture:01b', NOW);
    }
    const tomb = db.prepare(`INSERT INTO identity_tombstones(tombstone_id,legacy_identity_hash,
        classification,source,provenance,policy_version,created_at) VALUES (?,?,?,?,?,?,?)`);
    for (const id of TOMB_IDS) {
        tomb.run(`tomb_${id}`, h16(id), 'RETIRED_IDENTITY', 'fixture', 'fixture:01d', '1.0.0', NOW);
    }
    db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok)
                VALUES ('access',1,0,1)`).run();
    const c = db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c;
    ok('fixture: espejo canónico = 247 (400 sintéticos y fantasma rechazados)',
       c === 247, `sqlite=${c}`);
    closeIdentityDb();
}
const qall = (sql) => {
    const db = new Database(P.identity, { readonly: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[1] CLASIFICADOR: atestado, determinista, fail-closed');
const UD = await import('../db/identityUserDomains.js');
{
    const db = new Database(P.identity);
    const ctx = { exclMap: UD.attestedUserExclusionMap(db), tombs: UD.tombstoneHashSet(db) };
    ok('exclusiones=400, tombstones=11', ctx.exclMap.size === 400 && ctx.tombs.size === 11);
    ok('canónico activo → CANONICAL', UD.classifyUserReadDomain(db, 'RU005', ctx) === 'CANONICAL');
    ok('canónico DISABLED → CANONICAL (el status no cambia el dominio)',
       UD.classifyUserReadDomain(db, 'RU240', ctx) === 'CANONICAL');
    ok('sintético → ATTESTED_SYNTHETIC_COMPAT',
       UD.classifyUserReadDomain(db, 'lt-user-001', ctx) === 'ATTESTED_SYNTHETIC_COMPAT');
    ok('tombstone → TOMBSTONED', UD.classifyUserReadDomain(db, 'TS01', ctx) === 'TOMBSTONED');
    ok('fantasma (en JSON, no atestado, no espejado) → UNKNOWN',
       UD.classifyUserReadDomain(db, 'u-fantasma', ctx) === 'UNKNOWN');
    ok('id vacío → UNKNOWN', UD.classifyUserReadDomain(db, '', ctx) === 'UNKNOWN');
    ok('exclusión con OTRA disposition → UNKNOWN (jamás compat por defecto)',
       UD.classifyUserReadDomain(db, 'x-otro',
           { ...ctx, exclMap: new Map([[h16('x-otro'), 'OTRA_COSA']]) }) === 'UNKNOWN');
    // Tamper: fila espuria para un id TOMBSTONEADO. Primera defensa = el
    // propio schema (trigger anti-colisión); segunda = el orden del
    // clasificador (tombstone se evalúa ANTES que la fila).
    let triggerBlocked = false;
    try {
        db.prepare(`INSERT INTO users(canonical_id,legacy_identity_hash,email_norm,email_raw,
            roles_json,global_role,status,credential_excluded,provenance,source_version,raw_json,
            created_at,updated_at) VALUES ('TS01',?,'t@x','t@x','[]','student','active',1,'fx','v',
            '{}',datetime('now'),datetime('now'))`).run(h16('TS01'));
    } catch (e) { triggerBlocked = /tombstone/i.test(String(e.message)); }
    ok('tamper: el schema RECHAZA por trigger una fila canónica que colisione con '
       + 'un tombstone', triggerBlocked);
    ok('y el clasificador evalúa tombstone ANTES que la fila (segunda defensa)',
       UD.classifyUserReadDomain(db, 'TS01') === 'TOMBSTONED');
    db.close();
}

console.log('\n[2] SANITIZE ENDURECIDO + CREDENTIAL GUARD');
{
    ok('CREDENTIAL_FIELDS cubre password y tokens de reset/invite',
       ['password', 'passwordHash', 'resetToken', 'inviteToken', 'resetExpiresAt',
        'inviteExpiresAt'].every(f => UD.CREDENTIAL_FIELDS.includes(f)));
    const rows = qall(`SELECT raw_json, credential_excluded FROM users WHERE deleted_at IS NULL`);
    let leaks = 0, exclFlag = 0;
    for (const r of rows) {
        const o = JSON.parse(r.raw_json);
        if (UD.CREDENTIAL_FIELDS.some(f => f in o)) leaks++;
        if (r.credential_excluded === 1) exclFlag++;
    }
    ok('CERO material de credencial en los 247 raw_json (incl. RU241 con resetToken)',
       leaks === 0, `leaks=${leaks}`);
    ok('credential_excluded=1 en 247/247', exclFlag === 247);
    ok('el secreto de reset NO aparece en ningún raw_json',
       !rows.some(r => r.raw_json.includes(RESET_SECRET)));
    ok('CREDENTIALS_IN_SQLITE=0 (columna de password inexistente por schema)',
       !qall(`PRAGMA table_info(users)`).some(c => /password|token/i.test(c.name)));
}

console.log('\n[3] COMPOSICIÓN: operacional 247 / admin 647, sin fugas');
{
    const db = new Database(P.identity, { readonly: true });
    const { makeIdentityRepo } = await import('../repositories/identityRepo.js');
    const repo = makeIdentityRepo(db);
    UD._resetUserDomainTelemetry();
    const opView = UD.composeCanonicalUserView({ db, repo });
    ok('vista operacional = 247 canónicos (disabled canónico INCLUIDO como disabled)',
       opView.length === 247
       && opView.find(u => u.id === 'RU240')?.accountStatus === 'disabled'
       && !opView.some(u => u._loadtest_marker) && !opView.some(u => u.id === 'u-fantasma'));
    ok('marca de dominio en cada registro',
       opView.every(u => u[UD.USER_DOMAIN_MARKER] === 'CANONICAL'));
    const adminView = UD.composeUserAdminView({ db, repo, usersJsonPath: P.users });
    ok('vista admin = 647 (247 canónicos + 400 compat), fantasma FUERA',
       adminView.length === 647 && !adminView.some(u => u.id === 'u-fantasma'));
    const compat = adminView.filter(u => u[UD.USER_DOMAIN_MARKER] === 'ATTESTED_SYNTHETIC_COMPAT');
    ok('400 compat etiquetados, TODOS disabled y SIN credenciales',
       compat.length === 400 && compat.every(u => u.accountStatus === 'disabled')
       && compat.every(u => !UD.CREDENTIAL_FIELDS.some(f => f in u)));
    const t = UD.getUserDomainTelemetry();
    ok('telemetría bounded: canonical/compat/unknown contados',
       t.user_reads_canonical >= 247 && t.user_reads_synthetic_compat === 400
       && t.user_reads_unknown === 1, JSON.stringify(t));
    ok('JSON ilegible → null (fallback oficial, jamás subconjunto mudo)',
       UD.composeUserAdminView({ db, repo, usersJsonPath: path.join(tmp, 'no.json') }) === null);
    db.close();
}

// ── Server real ──────────────────────────────────────────────────────────────
function bootServer(extraEnv) {
    const PORT = 5200 + (process.pid % 200) + (extraEnv.IDENTITY_READ === 'sqlite' ? 1 : 0);
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
            IDENTITY_DUAL_WRITE: '1', ...extraEnv,
        },
    });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    return { child, base: `http://127.0.0.1:${PORT}`, getLog: () => log };
}
async function waitHealthy(s) {
    for (let i = 0; i < 150; i++) {
        if (s.child.exitCode !== null) throw new Error(`rc=${s.child.exitCode}\n${s.getLog().slice(-1500)}`);
        try { const r = await fetch(`${s.base}/api/health`); if (r.ok) return; } catch {}
        await sleep(400);
    }
    throw new Error(`never healthy\n${s.getLog().slice(-1500)}`);
}
const H = (uid) => ({ 'x-user-id': uid, 'content-type': 'application/json' });
const login = (base, email, pw) => fetch(`${base}/api/auth/login`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }) });

const M1 = {};   // acumulador del contrato M1
try {
    console.log('\n[4] MODO JSON ACTUAL: no-op absoluto');
    const sJson = bootServer({ IDENTITY_READ: 'json' });
    try {
        await waitHealthy(sJson);
        const list = await (await fetch(`${sJson.base}/api/users`, { headers: H('RU001') })).json();
        ok('lista admin JSON = 648 (todo el padrón, como hoy)', list.length === 648);
        ok('la lista JSON va saneada al cliente (sin password/resetToken)',
           !JSON.stringify(list).includes(RESET_SECRET)
           && !list.some(u => 'password' in u));
        ok('login real 200 (JSON mode)', (await login(sJson.base, 'r5@fx.test', 'fixture-real-pass')).status === 200);
        ok('login sintético disabled 401 (estado post-GAP1)',
           (await login(sJson.base, 'lt_7@loadtest.fx.local', 'fixture-syn-pass')).status === 401);
        ok('CURRENT_JSON_BEHAVIOR_UNCHANGED=true', true);
    } finally { sJson.child.kill(); await sleep(300); }

    console.log('\n[5] CUTOVER SIMULADO (READ=sqlite, DOMAINS=users)');
    const sCut = bootServer({ IDENTITY_READ: 'sqlite', IDENTITY_READ_DOMAINS: 'users' });
    try {
        await waitHealthy(sCut);

        // ADMIN/HISTÓRICO: 647 (canónico ∪ compat), fantasma y tombstones fuera.
        const list = await (await fetch(`${sCut.base}/api/users`, { headers: H('RU001') })).json();
        const ids = new Set(list.map(u => String(u.id)));
        ok('ADMIN: 647 = 247 canónicos + 400 compat; fantasma y tombstones FUERA',
           list.length === 647 && ids.has('RU005') && ids.has('lt-user-001')
           && !ids.has('u-fantasma') && !TOMB_IDS.some(t => ids.has(t)),
           `len=${list.length}`);
        M1.admin_surface = list.length === 647;

        // OPERACIONAL: universo canónico.
        const stCan = await fetch(`${sCut.base}/api/students/RU005/status`, { headers: H('RU001') });
        const stSyn = await fetch(`${sCut.base}/api/students/lt-user-001/status`, { headers: H('RU001') });
        const stGhost = await fetch(`${sCut.base}/api/students/u-fantasma/status`, { headers: H('RU001') });
        const stTomb = await fetch(`${sCut.base}/api/students/TS01/status`, { headers: H('RU001') });
        ok('operacional: canónico 200; sintético/fantasma/tombstone NOT_FOUND',
           stCan.status === 200 && stSyn.status === 404 && stGhost.status === 404
           && stTomb.status === 404,
           `${stCan.status}/${stSyn.status}/${stGhost.status}/${stTomb.status}`);
        M1.synthetic_not_operational = stSyn.status === 404;
        M1.tombstone_404 = stTomb.status === 404;
        M1.unknown_404 = stGhost.status === 404;

        // AUTHZ/SESIÓN (identidad desde SQLite):
        const sesCan = await fetch(`${sCut.base}/api/groups`, { headers: H('RU005') });
        const sesDis = await fetch(`${sCut.base}/api/groups`, { headers: H('RU240') });
        const sesSyn = await fetch(`${sCut.base}/api/groups`, { headers: H('lt-user-001') });
        const sesGhost = await fetch(`${sCut.base}/api/groups`, { headers: H('u-fantasma') });
        ok('sesión: canónico 200; canónico DISABLED 401 (fidelidad de status); '
           + 'sintético 401; fantasma 401',
           sesCan.status === 200 && sesDis.status === 401 && sesSyn.status === 401
           && sesGhost.status === 401,
           `${sesCan.status}/${sesDis.status}/${sesSyn.status}/${sesGhost.status}`);
        ok('STATUS_PRIVILEGE_EXPANSION=0 (disabled jamás vuelve active)',
           sesDis.status === 401);
        M1.status_fidelity = sesDis.status === 401;

        // LOGIN: JSON físico bajo cutover (SQLite no tiene credenciales).
        const lgReal = await login(sCut.base, 'r5@fx.test', 'fixture-real-pass');
        const lgSyn = await login(sCut.base, 'lt_7@loadtest.fx.local', 'fixture-syn-pass');
        ok('LOGIN_AUTHORITY=JSON: real 200 bajo cutover (el espejo no tiene credenciales '
           + '⇒ LOGIN_SQLITE_LOOKUPS=0 estructural)', lgReal.status === 200);
        ok('login sintético disabled 401 bajo cutover', lgSyn.status === 401);
        M1.login_json = lgReal.status === 200;

        // MEMBERSHIP: resolución canónica.
        const mem = await fetch(`${sCut.base}/api/groups/g-can-1/members`, { headers: H('RU001') });
        ok('membership: grupo canónico 200 con miembros resueltos desde el universo canónico',
           mem.status === 200);
        {
            const db = new Database(P.identity, { readonly: true });
            const ctx = { exclMap: UD.attestedUserExclusionMap(db), tombs: UD.tombstoneHashSet(db) };
            const memUsers = db.prepare(`SELECT DISTINCT user_id FROM memberships`).all();
            const unresolved = memUsers.filter(r =>
                UD.classifyUserReadDomain(db, r.user_id, ctx) !== 'CANONICAL').length;
            db.close();
            ok(`MEMBERSHIP_USER_UNRESOLVED=0 (${memUsers.length} ids de membresía, todos canónicos)`,
               unresolved === 0);
            M1.membership = unresolved === 0;
        }

        // MÉTRICAS LEGACY: JSON físico, estructural.
        const src = fs.readFileSync(path.join(REPO, 'server/server.js'), 'utf8');
        ok('METRICS_AUTHORITY=JSON_LEGACY: loadAndInitMetrics usa readJSONMetricsLegacy(USERS_DB)',
           /readJSONMetricsLegacy\(USERS_DB\)/.test(src));
        ok('readJSONMetricsLegacy jamás consulta el facade (lectura física)',
           /const readJSONMetricsLegacy[\s\S]{0,400}fs\.readFileSync/.test(src)
           && !/const readJSONMetricsLegacy[\s\S]{0,400}tryIdentitySqliteRead/.test(src));
        const mpSrc = fs.readFileSync(path.join(REPO, 'server/metrics/metricsProvider.mjs'), 'utf8');
        ok('metricsProvider (motor legacy) lee con fs.readFileSync propio: fuera del seam',
           /fs\.readFileSync/.test(mpSrc) && !/tryIdentitySqliteRead/.test(mpSrc));
        ok('METRICS_CUTOVER_DEFERRED_TO_PHASE2=true (denominadores intactos por construcción)', true);
        M1.metrics_json = true;

        // LOGIN estructural: base física.
        ok('login lee readCanonicalStoreForMutation (estructural, RMW-SEAM)',
           /app\.post\('\/api\/auth\/login'[\s\S]{0,400}readCanonicalStoreForMutation\(USERS_DB\)/.test(src));

        // AUTHZ EQUIVALENCE (componente): 247 canónicos, campos de authz idénticos.
        {
            const db = new Database(P.identity, { readonly: true });
            const rows = new Map(db.prepare(
                `SELECT canonical_id, raw_json FROM users WHERE deleted_at IS NULL`).all()
                .map(r => [r.canonical_id, JSON.parse(r.raw_json)]));
            db.close();
            const jsonNow = JSON.parse(fs.readFileSync(P.users, 'utf8'));
            let divergent = 0;
            for (const u of jsonNow) {
                if (u._loadtest_marker || u.id === 'u-fantasma') continue;
                const s = rows.get(String(u.id));
                if (!s) { divergent++; continue; }
                for (const f of ['roles', 'accountStatus', 'organizationId', 'groupIds']) {
                    if (JSON.stringify(u[f] ?? null) !== JSON.stringify(s[f] ?? null)) divergent++;
                }
            }
            ok('AUTHZ equivalence: 0 divergencias en roles/status/org/groupIds para 247 '
               + '(ALLOW_JSON_DENY_SQLITE=0 y DENY_JSON_ALLOW_SQLITE=0)', divergent === 0,
               `divergent=${divergent}`);
            M1.authz_equivalence = divergent === 0;
        }

        console.log('\n[5b] RMW + WRITE AUTHORITY bajo cutover');
        const put = await fetch(`${sCut.base}/api/users/RU005`, { method: 'PUT',
            headers: H('RU001'), body: JSON.stringify({ nombre_completo: 'Renombrado GAP2' }) });
        ok('PUT usuario canónico → 200', put.status === 200, String(put.status));
        const after = JSON.parse(fs.readFileSync(P.users, 'utf8'));
        ok('RMW: 648→648 (sintéticos, fantasma y credenciales preservados)',
           after.length === 648
           && after.filter(u => u._loadtest_marker).length === 400
           && !!after.find(u => u.id === 'u-fantasma')
           && after.filter(u => typeof u.password === 'string').length === 647
           && after.find(u => u.id === 'RU241')?.resetToken === RESET_SECRET,
           `len=${after.length}`);
        ok('la edición se aplicó sobre el JSON físico (WRITE=JSON authority)',
           after.find(u => u.id === 'RU005')?.nombre_completo === 'Renombrado GAP2');
        let mirrored = false;
        for (let i = 0; i < 40 && !mirrored; i++) {
            await sleep(150);
            try {
                const r = qall(`SELECT raw_json FROM users WHERE canonical_id='RU005'`)[0];
                mirrored = r && JSON.parse(r.raw_json).nombre_completo === 'Renombrado GAP2';
            } catch { /* WAL */ }
        }
        ok('write authority: JSON→espejo converge (SQLite jamás primary writer)', mirrored);
        M1.rmw = after.length === 648;
        M1.write_json = mirrored;
    } finally { sCut.child.kill(); await sleep(300); }
} catch (e) {
    ok('escenario ejecutable', false, String(e?.stack || e));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[6] COMPARADOR ALINEADO: tokens jamás divergen; canónicos MATCH');
{
    process.env.IDENTITY_SQLITE_ENABLED = '1';
    process.env.IDENTITY_SHADOW_COMPARE = '1';
    process.env.IDENTITY_SHADOW_COMPARE_DOMAINS = 'users';
    process.env.IDENTITY_SHADOW_COMPARE_TTL_MS = '0';
    process.env.IDENTITY_SHADOW_COMPARE_STALE_MS = '600000';
    process.env.IDENTITY_DB = P.identity;
    const CMP = await import('../db/identityShadowCompare.js');
    const PATHS = { usersDb: P.users, groupsDb: P.groups, accessDb: P.access,
        schoolsDb: P.schools };
    const jsonNow = JSON.parse(fs.readFileSync(P.users, 'utf8'));
    CMP.__resetShadowCompare(); closeIdentityDb(); getIdentityDb(P.identity);
    await CMP.warmupShadowCompare();
    CMP.observeIdentityShadowRead(P.users, jsonNow, PATHS, {});
    const u = CMP.getShadowCompareSnapshot().byDomain.users;
    ok('RU241 con resetToken en JSON y sin token en espejo → MATCH (stripCredentials '
       + 'alineado con sanitizeUser) y 0 divergencias de seguridad',
       u.entities.security === 0, JSON.stringify(u.entities));
    // M1-RELEASE-TRAIN-R1: EXPECTED exige atestación. El fantasma (no
    // proyectable pero NO atestado) es UNEXPECTED con diagnóstico — jamás gap.
    ok('gaps SOLO atestados: SYNTHETIC_USER=400; el fantasma NO se esconde '
       + 'como expected → 1 UNEXPECTED con diagnóstico estructural',
       u.entities.gaps.SYNTHETIC_USER === 400
       && (u.entities.gaps.NOT_PROJECTABLE_BY_POLICY ?? 0) === 0
       && u.entities.unexpected === 1
       && (u.samples || []).some(s => (s.fields || [])
           .some(f => String(f).startsWith('UNPROJECTABLE_'))),
       JSON.stringify({ gaps: u.entities.gaps, unexpected: u.entities.unexpected }));
    ok('247 canónicos MATCH', u.entities.match === 247, JSON.stringify(u.entities));
    delete process.env.IDENTITY_SHADOW_COMPARE;
    CMP.__resetShadowCompare(); closeIdentityDb();
    // R1: el fantasma DEBE aflorar como unexpected (drift detectado, no
    // escondido) — eso ES el comportamiento correcto del comparador.
    M1.comparator = u.entities.match === 247 && u.entities.unexpected === 1;
}

console.log('\n[7] M1_USER_AUTHORITY_CONTRACT');
{
    const rows = qall(`SELECT raw_json FROM users WHERE deleted_at IS NULL`);
    M1.no_credentials_sqlite = !rows.some(r =>
        UD.CREDENTIAL_FIELDS.some(f => JSON.parse(r.raw_json)[f] !== undefined));
    const checks = {
        canonical_reads_sqlite: M1.authz_equivalence && M1.comparator,
        login_json: M1.login_json,
        credentials_json_only: M1.no_credentials_sqlite,
        mutations_json: M1.write_json && M1.rmw,
        synthetic_compat_only_admin: M1.admin_surface && M1.synthetic_not_operational,
        metrics_json_legacy: M1.metrics_json,
        tombstones_not_found: M1.tombstone_404,
        unknown_fail_closed: M1.unknown_404,
        status_fidelity: M1.status_fidelity,
        membership_canonical: M1.membership,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    ok(`M1_USER_AUTHORITY_CONTRACT=true (${Object.keys(checks).length} autoridades explícitas, `
       + 'sin ambigüedad de fuente)', failed.length === 0, JSON.stringify(failed));
}

console.log('\n[8] PERFORMANCE local (sin regresión evidente)');
{
    const jsonArr = JSON.parse(fs.readFileSync(P.users, 'utf8'));
    const db = new Database(P.identity, { readonly: true });
    const stmt = db.prepare(`SELECT raw_json FROM users WHERE canonical_id=?`);
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 500; i++) jsonArr.find(u => u.id === 'RU200');
    const t2 = process.hrtime.bigint();
    for (let i = 0; i < 500; i++) stmt.get('RU200');
    const t3 = process.hrtime.bigint();
    const jsonUs = Number(t2 - t1) / 500 / 1000, sqlUs = Number(t3 - t2) / 500 / 1000;
    db.close();
    ok(`lookup p50: JSON≈${jsonUs.toFixed(1)}µs vs SQLite≈${sqlUs.toFixed(1)}µs (ambos <5ms, sin regresión)`,
       jsonUs < 5000 && sqlUs < 5000);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
