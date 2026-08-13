/**
 * retireSyntheticCohort.test.mjs — CHP-IDDB-02C-GAP1-SYNTHETIC-USERS-01.
 *
 * Prueba el retiro funcional reversible de la cohorte sintética con el SERVER
 * REAL sobre fixtures herméticas (647 usuarios = 247 reales + 400 sintéticos
 * atestados, grupo lt-, regla lt-access-v2 con el patrón real):
 *
 *   [1] selección de cohorte: doble atestación, STOP ante ambigüedad
 *   [2] dry-run: agregados exactos, cero mutación
 *   [3] PRE: login sintético 200, sesión GET 200, acceso 64-títulos OK;
 *       login/acceso real OK
 *   [4] APPLY por writers reales (PUT /api/users ×400 + upsert de la regla)
 *   [5] POST: login sintético 401; SESIÓN previa 401 (stateless, sin
 *       SESSION_REVOCATION_GAP); acceso sintético denegado; real intacto
 *   [6] preservación: 647 registros, progreso intacto, grupo intacto, regla
 *       presente-expirada, espejo sin insert sintético, gap del comparador
 *   [7] idempotencia  [8] interrupción/resume  [9] rollback (con ack gate)
 *   [10] escaneo de secretos del delta
 *
 *   node scripts/identity/__test__/retireSyntheticCohort.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { runMigrations } from '../../../server/db/migrate.js';
import { mirrorSnapshotV2 } from '../../../server/db/identityShadowV2.js';
import { mirrorAccess } from '../../../server/db/identityShadow.js';
import {
    DISABLED_STATUS, RETIRED_EXPIRES_AT, RetireError,
    applyRetirement, attestedUserExclusionHashes, buildRetirementRulePayload,
    buildSnapshot, loadPlanFromStores, makeHttpTransport, parseArgs,
    planRetirement, rollbackRetirement, ruleIsRetired, selectCohort,
    withDisabledSet, writeSnapshot,
} from '../retireSyntheticCohort.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const h16 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e.stop ?? e.message; } };

// ── Fixture ──────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gap1_'));
const P = {
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    progress: path.join(tmp, 'progress_db.json'),
    identity: path.join(tmp, 'identity.db'),
    uploads: path.join(tmp, 'uploads'),
    offline: path.join(tmp, 'offline.db'),
    snapshot: path.join(tmp, 'retire-snapshot.json'),
};
fs.mkdirSync(P.uploads, { recursive: true });

const SYN_PASSWORD = 'fixture-lt-pass';                 // SOLO fixture, jamás real
const SYN_HASH = bcrypt.hashSync(SYN_PASSWORD, 4);
const REAL_HASH = bcrypt.hashSync('fixture-real-pass', 4);

const users = [
    { id: 'RU001', email: 'admin@fx.test', password: REAL_HASH, roles: ['administrador'],
      accountStatus: 'active', organizationId: 'inst-fx-1', colegio: 'Colegio FX' },
];
for (let i = 2; i <= 247; i++) {
    users.push({ id: `RU${String(i).padStart(3, '0')}`, email: `r${i}@fx.test`,
        password: REAL_HASH, roles: ['lector'], accountStatus: 'active',
        organizationId: 'inst-fx-1', colegio: 'Colegio FX' });
}
const SYN_IDS = [];
for (let i = 1; i <= 400; i++) {
    const id = `lt-user-${String(i).padStart(3, '0')}`;
    SYN_IDS.push(id);
    users.push({ id, email: `lt_${i}@loadtest.fx.local`, password: SYN_HASH,
        roles: ['lector'], accountStatus: 'active', colegio: 'LoadTest FX',
        _loadtest_marker: '__loadtest__' });
}
const groups = [
    { id: 'g-can-1', name: 'Curso 1', type: 'course', organizationId: 'inst-fx-1',
      memberIds: ['RU005'], mediatorIds: ['RU002'] },
    { id: 'lt-test-group-fx', name: 'Carga FX', type: 'course',
      organizationId: 'lt-org-fx', memberIds: [...SYN_IDS] },
];
const RULE = { id: 'lt-access-v2', scope: 'group', scopeId: 'lt-test-group-fx',
    titleIds: ['t-synth-1', 't-synth-2'], collectionIds: [], expiresAt: null };
const REAL_RULE = { id: 'rule-real-ru005', scope: 'user', scopeId: 'RU005',
    titleIds: ['t-real'], collectionIds: [], expiresAt: null };

fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(groups, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-fx-1', name: 'Colegio FX' }], null, 2));
fs.writeFileSync(P.access, JSON.stringify([RULE, REAL_RULE], null, 2));
fs.writeFileSync(P.content, JSON.stringify([
    { id: 't-synth-1', title: 'S1' }, { id: 't-synth-2', title: 'S2' },
    { id: 't-real', title: 'R' }, { id: 't-libre', title: 'L' },
], null, 2));
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: { 'lt-user-001': { pct: 50 } } }));
const progressFingerprint = () =>
    crypto.createHash('sha256').update(fs.readFileSync(P.progress)).digest('hex');
const progressBefore = progressFingerprint();

{   // identity.db: espejo + exclusiones atestadas (usuarios y grupo)
    const db = new Database(P.identity);
    db.pragma('foreign_keys = ON');
    runMigrations(db);
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
    ins.run('exc_ltg', 'r-fx', 'group', 'SYNTHETIC_LOADTEST_EXCLUDED',
        h16('lt-test-group-fx'), 'fixture:01c', NOW);
    mirrorAccess(db, [RULE, REAL_RULE], () => {}, 'fixture');
    const uc = db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c;
    ok('fixture: espejo canónico users=247 (sintéticos rechazados por proyección)',
       uc === 247, `sqlite users=${uc}`);
    db.close();
}
const sqliteUsersCount = () => {
    const db = new Database(P.identity, { readonly: true });
    try { return db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c; }
    finally { db.close(); }
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[1] SELECCIÓN DE COHORTE: doble atestación estricta');
{
    const db = new Database(P.identity, { readonly: true });
    const excl = attestedUserExclusionHashes(db);
    db.close();
    ok('exclusiones atestadas = 400', excl.size === 400);
    const cohort = selectCohort(users, excl);
    ok('cohorte exacta = 400 (todas con marcador ∧ exclusión)', cohort.length === 400);
    ok('ningún usuario real seleccionado',
       cohort.every(id => id.startsWith('lt-user-')));
    ok('marcado SIN exclusión → STOP AMBIGUOUS',
       (await caught(async () => selectCohort(
           [...users, { id: 'RU-marcado', _loadtest_marker: true }], excl)))
           === 'COHORT SELECTION AMBIGUOUS');
    ok('excluido SIN marcador → STOP AMBIGUOUS',
       (await caught(async () => selectCohort(
           users.map(u => u.id === 'lt-user-001' ? { ...u, _loadtest_marker: undefined } : u),
           excl))) === 'COHORT SELECTION AMBIGUOUS');
    ok('exclusión sin registro presente → STOP AMBIGUOUS',
       (await caught(async () => selectCohort(
           users.filter(u => u.id !== 'lt-user-002'), excl)))
           === 'COHORT SELECTION AMBIGUOUS');
}

console.log('\n[2] DRY-RUN: agregados exactos, cero mutación');
let basePlan;
{
    basePlan = await loadPlanFromStores({ usersDb: P.users, accessDb: P.access,
        identityDb: P.identity, ruleId: 'lt-access-v2' });
    ok('SYNTHETIC_TOTAL=400 ACTIVE=400 DISABLED=0',
       basePlan.SYNTHETIC_TOTAL === 400 && basePlan.SYNTHETIC_ACTIVE === 400
       && basePlan.SYNTHETIC_DISABLED === 0);
    ok('RULE presente y ACTIVA', basePlan.RULE_PRESENT && basePlan.RULE_ACTIVE);
    ok('CANONICAL_USERS=247, REAL_USERS_SELECTED=0',
       basePlan.CANONICAL_USERS === 247 && basePlan.REAL_USERS_SELECTED === 0);
    ok('EXPECTED_USER_UPDATES=400, EXPECTED_RULE_UPDATES=1',
       basePlan.EXPECTED_USER_UPDATES === 400 && basePlan.EXPECTED_RULE_UPDATES === 1);
    ok('regla real ajena NO es objetivo',
       basePlan.rule.id === 'lt-access-v2');
    ok('dry-run no mutó nada',
       JSON.parse(fs.readFileSync(P.users, 'utf8')).length === 647
       && progressFingerprint() === progressBefore);
    ok('CLI: modo default dry-run y flags parsean',
       parseArgs([]).mode === 'dry-run' && parseArgs(['--apply']).mode === 'apply'
       && parseArgs(['--rollback', '--acknowledge-security-risk']).ackRisk === true);
}

// ── Server real ──────────────────────────────────────────────────────────────
const PORT = 4900 + (process.pid % 200);
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
        IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
    },
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });
async function waitHealthy() {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${bootLog.slice(-1500)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
        await sleep(400);
    }
    throw new Error(`never healthy\n${bootLog.slice(-1500)}`);
}
const H = (uid) => ({ 'x-user-id': uid, 'content-type': 'application/json' });
const login = async (email, password) => fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }) });
const decide = async (uid, cid) => {
    const r = await fetch(`${base}/api/content/${cid}/access?userId=${uid}`, { headers: H(uid) });
    const b = await r.json().catch(() => ({}));
    return { status: r.status, allowed: b.allowed === true };
};

/**
 * Transporte del fixture: usuarios por el WRITER HTTP REAL (x-user-id admin);
 * la regla por el canal componente REAL (writeJSON físico + identityWriteHook,
 * mismo seam que producción) porque el endpoint de reglas es secret-only y el
 * secreto es ruta constante no inyectable. La corrección del PAYLOAD HTTP se
 * verifica aparte contra un servidor mock; el camino secret-only completo lo
 * cubre el image canary (plan congelado).
 */
function makeFixtureTransport() {
    const http = makeHttpTransport({ base, adminUserId: 'RU001' });
    return {
        updateUserStatus: http.updateUserStatus,
        async upsertAccessRule(payload) {
            const { makeIdentityWriteHook, _resetIdentityWriteHook } =
                await import('../../../server/db/identityWriteHook.js');
            const { closeIdentityDb } = await import('../../../server/db/identityDb.js');
            const rules = JSON.parse(fs.readFileSync(P.access, 'utf8'));
            const i = rules.findIndex(r => String(r.id) === String(payload.id));
            if (i >= 0) rules[i] = payload; else rules.push(payload);
            const tmpF = P.access + '.tmp';
            fs.writeFileSync(tmpF, JSON.stringify(rules, null, 2));
            fs.renameSync(tmpF, P.access);
            process.env.IDENTITY_DUAL_WRITE = '1';
            process.env.IDENTITY_SQLITE_ENABLED = '1';
            process.env.IDENTITY_DB = P.identity;
            _resetIdentityWriteHook(); closeIdentityDb();
            makeIdentityWriteHook({ usersDb: P.users, groupsDb: P.groups,
                accessDb: P.access, schoolsDb: P.schools, log: () => {},
                writerId: 'server.writeJSON' })(P.access, rules);
            await sleep(600);          // settle del espejo async
            closeIdentityDb();
            return { ok: true, status: 200 };
        },
    };
}

try {
    await waitHealthy();

    console.log('\n[3] PRE: la cohorte es funcional (el riesgo es real)');
    const preSynLogin = await login('lt_7@loadtest.fx.local', SYN_PASSWORD);
    ok('login sintético 200 (PRE)', preSynLogin.status === 200, String(preSynLogin.status));
    const preSynGet = await fetch(`${base}/api/groups`, { headers: H('lt-user-007') });
    ok('sesión sintética: GET autenticado 200 (PRE)', preSynGet.status === 200);
    const preSynAccess = await decide('lt-user-007', 't-synth-1');
    ok('acceso sintético por lt-access-v2 (PRE)', preSynAccess.allowed === true);
    const preRealLogin = await login('r5@fx.test', 'fixture-real-pass');
    ok('login real 200 (PRE)', preRealLogin.status === 200);
    const preRealAccess = await decide('RU005', 't-real');
    ok('acceso real por su regla (PRE)', preRealAccess.allowed === true);

    console.log('\n[4] APPLY: writers reales, orden regla→cuentas, snapshot previo');
    const usersPre = JSON.parse(fs.readFileSync(P.users, 'utf8'));
    writeSnapshot(P.snapshot, buildSnapshot(basePlan, usersPre));
    const snap = JSON.parse(fs.readFileSync(P.snapshot, 'utf8'));
    ok('snapshot: 400 estados previos + expiración previa, SIN credenciales',
       Object.keys(snap.statuses).length === 400
       && snap.rule.previousExpiresAt === null
       && !JSON.stringify(snap).includes(SYN_PASSWORD)
       && !JSON.stringify(snap).includes('$2'));
    ok('snapshot declara ROLLBACK_REINTRODUCES_SECURITY_RISK=true',
       snap.ROLLBACK_REINTRODUCES_SECURITY_RISK === true);

    const transport = makeFixtureTransport();
    const t0 = Date.now();
    const applied = await applyRetirement({
        plan: withDisabledSet(basePlan, usersPre), transport,
        log: () => {} });
    ok(`apply: rule_updates=1, user_updates=400, failed=0 (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
       applied.rule_updates === 1 && applied.user_updates === 400
       && applied.user_failed === 0, JSON.stringify(applied));

    console.log('\n[5] POST: retiro efectivo, cero regresión real');
    const postSynLogin = await login('lt_7@loadtest.fx.local', SYN_PASSWORD);
    ok('SYNTHETIC_LOGIN_DISABLED=true (misma credencial → 401 genérico)',
       postSynLogin.status === 401, String(postSynLogin.status));
    const postSynGet = await fetch(`${base}/api/groups`, { headers: H('lt-user-007') });
    ok('sesión previa sintética → 401 (stateless revalida status: '
       + 'sin SESSION_REVOCATION_GAP)', postSynGet.status === 401, String(postSynGet.status));
    let denied = false;
    for (let i = 0; i < 45 && !denied; i++) {          // cache ACCESS_DB ≤30 s
        const d = await decide('lt-user-007', 't-synth-1');
        denied = d.allowed === false;
        if (!denied) await sleep(1000);
    }
    ok('SYNTHETIC_RULE_APPLIES=false (regla expirada, tras TTL de caché)', denied);
    const postRealLogin = await login('r5@fx.test', 'fixture-real-pass');
    ok('REAL_LOGIN_REGRESSION=0 (login real sigue 200)', postRealLogin.status === 200);
    const postRealAccess = await decide('RU005', 't-real');
    ok('acceso real sin regresión', postRealAccess.allowed === true);
    ok('SYNTHETIC_IDOR_AMPLIFICATION_REMOVED=true (sin sesión nueva posible; '
       + 'el IDOR base sigue abierto y NO se declara cerrado)',
       postSynLogin.status === 401 && postSynGet.status === 401);

    console.log('\n[6] PRESERVACIÓN total');
    // El login real de [5] persiste lastLoginAt vía writeJSONAsync POST-respuesta
    // y su espejo es async: esperar a que el store y el espejo asienten antes de
    // fotografiar, o el comparador vería una copia vieja contra un espejo nuevo.
    {
        let settled = false;
        for (let i = 0; i < 40 && !settled; i++) {
            const u5 = JSON.parse(fs.readFileSync(P.users, 'utf8'))
                .find(u => u.id === 'RU005');
            settled = typeof u5?.lastLoginAt === 'string'
                && (Date.now() - Date.parse(u5.lastLoginAt)) < 120000;
            if (!settled) await sleep(250);
        }
        await sleep(1000);
    }
    const after = JSON.parse(fs.readFileSync(P.users, 'utf8'));
    ok('647 registros preservados', after.length === 647, `len=${after.length}`);
    const synAfter = after.filter(u => u._loadtest_marker);
    ok('400 sintéticos presentes, TODOS disabled, credencial intacta (sin borrar)',
       synAfter.length === 400
       && synAfter.every(u => u.accountStatus === DISABLED_STATUS)
       && synAfter.every(u => typeof u.password === 'string' && u.password.length > 0));
    ok('247 reales intactos (status active)',
       after.filter(u => !u._loadtest_marker && (u.accountStatus ?? 'active') === 'active')
           .length === 247);
    const rulesAfter = JSON.parse(fs.readFileSync(P.access, 'utf8'));
    const ruleAfter = rulesAfter.find(r => r.id === 'lt-access-v2');
    ok('regla PRESENTE como evidencia, expirada, resto de campos íntegros',
       Boolean(ruleAfter) && ruleAfter.expiresAt === RETIRED_EXPIRES_AT
       && JSON.stringify(ruleAfter.titleIds) === JSON.stringify(RULE.titleIds)
       && ruleIsRetired(ruleAfter));
    ok('regla real intacta', JSON.stringify(rulesAfter.find(r => r.id === 'rule-real-ru005'))
       === JSON.stringify(REAL_RULE));
    const groupsAfter = JSON.parse(fs.readFileSync(P.groups, 'utf8'));
    ok('grupo sintético preservado con sus 400 memberIds',
       (groupsAfter.find(g => g.id === 'lt-test-group-fx')?.memberIds ?? []).length === 400);
    ok('SYNTHETIC_PROGRESS_PRESERVED=true (fingerprint idéntico)',
       progressFingerprint() === progressBefore);
    ok('espejo: users canónicos siguen 247 — NINGÚN insert sintético',
       sqliteUsersCount() === 247, `sqlite=${sqliteUsersCount()}`);
    {
        const db = new Database(P.identity, { readonly: true });
        const exc = db.prepare(`SELECT COUNT(*) c FROM migration_exclusions
                                WHERE entity='user'`).get().c;
        const mirroredRule = JSON.parse(db.prepare(
            `SELECT raw_json FROM access_rules WHERE id='lt-access-v2'`).get().raw_json);
        db.close();
        ok('exclusiones atestadas intactas (400)', exc === 400);
        ok('mirrorAccess espejó la expiración (dual-write del canal componente)',
           mirroredRule.expiresAt === RETIRED_EXPIRES_AT);
    }
    {   // Comparador: el gap SYNTHETIC_USER se mantiene — GAP-1 no se maquilla
        process.env.IDENTITY_SHADOW_COMPARE = '1';
        process.env.IDENTITY_SHADOW_COMPARE_DOMAINS = 'users';
        process.env.IDENTITY_SHADOW_COMPARE_TTL_MS = '0';
        process.env.IDENTITY_SHADOW_COMPARE_STALE_MS = '600000';
        process.env.IDENTITY_DB = P.identity;
        const CMP = await import('../../../server/db/identityShadowCompare.js');
        const { getIdentityDb, closeIdentityDb } = await import('../../../server/db/identityDb.js');
        CMP.__resetShadowCompare(); closeIdentityDb(); getIdentityDb(P.identity);
        await CMP.warmupShadowCompare();
        CMP.observeIdentityShadowRead(P.users, after,
            { usersDb: P.users, groupsDb: P.groups, accessDb: P.access, schoolsDb: P.schools }, {});
        const u = CMP.getShadowCompareSnapshot().byDomain.users;
        ok('comparador: EXPECTED gap SYNTHETIC_USER=400 se mantiene tras el retiro',
           u.entities.gaps.SYNTHETIC_USER === 400, JSON.stringify(u.entities.gaps));
        ok('comparador: 0 inesperadas / 0 seguridad tras el retiro',
           u.entities.unexpected === 0 && u.entities.security === 0,
           JSON.stringify(u.entities));
        delete process.env.IDENTITY_SHADOW_COMPARE;
        CMP.__resetShadowCompare(); closeIdentityDb();
    }

    console.log('\n[7] IDEMPOTENCIA: segunda pasada = 0 cambios');
    const plan2 = withDisabledSet(await loadPlanFromStores({ usersDb: P.users,
        accessDb: P.access, identityDb: P.identity, ruleId: 'lt-access-v2' }),
        JSON.parse(fs.readFileSync(P.users, 'utf8')));
    ok('re-censo: ACTIVE=0 DISABLED=400 RULE inactiva',
       plan2.SYNTHETIC_ACTIVE === 0 && plan2.SYNTHETIC_DISABLED === 400
       && plan2.RULE_ACTIVE === false);
    const applied2 = await applyRetirement({ plan: plan2, transport, log: () => {} });
    ok('RETIREMENT_IDEMPOTENT=true (0 user updates, 0 rule updates, 0 failed)',
       applied2.user_updates === 0 && applied2.rule_updates === 0
       && applied2.user_failed === 0, JSON.stringify(applied2));

    console.log('\n[9] ROLLBACK lógico (gate de reconocimiento + restauración)');
    ok('sin --acknowledge-security-risk → rechazado',
       (await caught(() => rollbackRetirement({ snapshot: snap,
           currentRule: ruleAfter, transport, acknowledgeSecurityRisk: false })))
           === 'ROLLBACK NOT ACKNOWLEDGED');
    const rb = await rollbackRetirement({ snapshot: snap, currentRule: ruleAfter,
        transport, acknowledgeSecurityRisk: true, log: () => {} });
    ok('rollback: 400 estados + 1 regla restaurados',
       rb.user_restores === 400 && rb.rule_restores === 1, JSON.stringify(rb));
    const rbLogin = await login('lt_7@loadtest.fx.local', SYN_PASSWORD);
    ok('estado semántico PRE restaurado: login sintético vuelve a 200 (solo fixture)',
       rbLogin.status === 200, String(rbLogin.status));
    const rulesRb = JSON.parse(fs.readFileSync(P.access, 'utf8'));
    ok('expiración previa restaurada (null)',
       rulesRb.find(r => r.id === 'lt-access-v2').expiresAt === null);
} catch (e) {
    ok('escenario ejecutable', false, String(e?.stack || e));
} finally {
    child.kill();
    await sleep(300);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[8] INTERRUPCIÓN/RESUME (tool-level, transporte en memoria)');
{
    const mem = users.map(u => ({ ...u, accountStatus: 'active' }));
    const rules = [{ ...RULE }];
    const memTransport = {
        async updateUserStatus(id, status) {
            const u = mem.find(x => String(x.id) === id);
            if (!u) return { ok: false, status: 404 };
            u.accountStatus = status;
            return { ok: true, status: 200 };
        },
        async upsertAccessRule(payload) {
            const i = rules.findIndex(r => r.id === payload.id);
            rules[i >= 0 ? i : rules.length] = payload;
            return { ok: true, status: 200 };
        },
    };
    const db = new Database(P.identity, { readonly: true });
    const excl = attestedUserExclusionHashes(db);
    db.close();
    const mkPlan = () => withDisabledSet(planRetirement({ users: mem, rules,
        exclusionHashes: excl, isSyntheticGroup: () => true }), mem);
    const first = await applyRetirement({ plan: mkPlan(), transport: memTransport,
        maxUserOps: 150 });
    ok('interrupción a 150: regla YA expirada (estado intermedio seguro: '
       + 'concesión cerrada, jamás cuentas+acceso ampliado)',
       first.interrupted === true && first.user_updates === 150
       && first.rule_updates === 1
       && ruleIsRetired(rules.find(r => r.id === RULE.id)));
    const midDisabled = mem.filter(u => u._loadtest_marker
        && u.accountStatus === DISABLED_STATUS).length;
    ok('estado intermedio: 150 disabled, 250 pendientes, 0 reales tocados',
       midDisabled === 150
       && mem.filter(u => !u._loadtest_marker && u.accountStatus !== 'active').length === 0);
    const resume = await applyRetirement({ plan: mkPlan(), transport: memTransport });
    ok('RETIREMENT_RESUMABLE=true (resume completa exactamente los 250, regla noop)',
       resume.user_updates === 250 && resume.rule_updates === 0
       && mem.filter(u => u._loadtest_marker && u.accountStatus === DISABLED_STATUS)
           .length === 400, JSON.stringify(resume));
}

console.log('\n[10] PAYLOAD HTTP de la regla (mock) + escaneo de secretos del delta');
{
    const httpMod = await import('node:http');
    let captured = null;
    const srv = httpMod.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            captured = { method: req.method, url: req.url,
                secret: req.headers['x-admin-secret'], body: JSON.parse(body) };
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{}');
        });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const mockBase = `http://127.0.0.1:${srv.address().port}`;
    const t = makeHttpTransport({ base: mockBase, adminSecret: 'fx-secret' });
    await t.upsertAccessRule(buildRetirementRulePayload(RULE));
    srv.close();
    ok('POST /api/access con x-admin-secret y regla ÍNTEGRA + expiresAt pasado',
       captured?.method === 'POST' && captured.url === '/api/access'
       && captured.secret === 'fx-secret'
       && captured.body.id === RULE.id
       && captured.body.expiresAt === RETIRED_EXPIRES_AT
       && JSON.stringify(captured.body.titleIds) === JSON.stringify(RULE.titleIds));

    const delta = [
        path.join(REPO, 'scripts/identity/retireSyntheticCohort.mjs'),
        path.join(__dirname, 'retireSyntheticCohort.test.mjs'),
    ];
    // La aguja del password real se construye partida para que el propio
    // escáner no se auto-detecte por su literal.
    const secretRe = new RegExp(['Lt' + 'Pass', 'AKIA[0-9A-Z]{16}',
        '-----BEGIN [A-Z ]*PRIVATE KEY',
        '\\$2[aby]\\$\\d\\d\\$[./A-Za-z0-9]{20,}'].join('|'));
    for (const f of delta) {
        ok(`${path.basename(f)}: sin credenciales reales ni hashes embebidos`,
           !secretRe.test(fs.readFileSync(f, 'utf8')));
    }
    ok('el snapshot y las salidas no contienen el campo password',
       !fs.readFileSync(P.snapshot, 'utf8').includes('"password"'));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
