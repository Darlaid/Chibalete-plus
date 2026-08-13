/**
 * identityShadowCompare.test.mjs — CHP-IDDB-02C-B.
 *
 * Prueba que la comparación runtime JSON↔SQLite:
 *   1. está APAGADA por defecto y entonces no hace absolutamente nada;
 *   2. clasifica correctamente MATCH y los cuatro gaps conocidos, por POLÍTICA
 *      (la misma que usa el espejo) y no por listas de IDs;
 *   3. detecta de verdad un mismatch inyectado, y distingue el que puede
 *      cambiar una decisión de autorización (SECURITY_RELEVANT) del que no;
 *   4. jamás altera el resultado oficial: ni el array leído, ni la respuesta
 *      HTTP, ni la decisión de authn/authz, ni la base de una mutación;
 *   5. degrada a COMPARATOR_ERROR ante fallo de SQLite o del propio comparador;
 *   6. no emite PII.
 *
 * La parte de integración bootea el SERVER REAL contra stores temporales, con
 * el comparador encendido y —deliberadamente— con los flags de cutover
 * simulados, para demostrar que ni siquiera en esa combinación se sirve SQLite
 * ni se contamina una escritura (no-regresión de CHP-IDDB-READ-RMW-SEAM-01).
 *
 *   node server/__test__/identityShadowCompare.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Fixtures: mismas proporciones que producción (647/247, 20/4) ────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_shadow_cmp_'));
const P = {
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    identity: path.join(tmp, 'identity.db'),
    uploads: path.join(tmp, 'uploads'),
};
fs.mkdirSync(P.uploads, { recursive: true });

const mkUsers = () => {
    const out = [];
    for (let i = 1; i <= 247; i++) {
        out.push({
            id: `RU${String(i).padStart(3, '0')}`,
            email: `ru${String(i).padStart(3, '0')}@fixture.test`,
            password: `pw-secret-${i}`,
            roles: i === 1 ? ['administrador'] : ['lector'],
            nombre_completo: `Usuario Real ${i}`,
            accountStatus: 'active',
            organizationId: 'inst-fixture-1',
            colegio: 'Colegio Fixture',
        });
    }
    for (let i = 1; i <= 400; i++) {
        out.push({
            id: `SYN${String(i).padStart(3, '0')}`,
            email: `syn${String(i).padStart(3, '0')}@fixture.test`,
            password: `pw-syn-${i}`,
            roles: ['lector'],
            accountStatus: 'active',
            _loadtest_marker: 'loadtest-fixture',
        });
    }
    return out;
};
const mkGroups = () => {
    const out = [];
    for (let i = 1; i <= 4; i++) {
        out.push({
            id: `g-can-${i}`, name: `Curso Canónico ${i}`, type: 'course',
            organizationId: 'inst-fixture-1', school: 'Colegio Fixture',
            gradeLevel: String(i), section: 'A',
            memberIds: [`RU${String(i * 2).padStart(3, '0')}`], mediatorIds: ['RU001'],
        });
    }
    for (let i = 1; i <= 16; i++) {
        out.push({ id: `g-leg-${i}`, name: `Legacy ${i}`, type: 'course', memberIds: [] });
    }
    return out;
};
const users = mkUsers();
const groups = mkGroups();
const schools = [{ id: 'inst-fixture-1', name: 'Colegio Fixture' }];
const accessRules = [{ id: 'rule-preexistente', scope: 'group', scopeId: 'g-can-1',
    titleIds: ['t-1'], collectionIds: [], expiresAt: null }];
fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(groups, null, 2));
fs.writeFileSync(P.schools, JSON.stringify(schools, null, 2));
fs.writeFileSync(P.access, JSON.stringify(accessRules, null, 2));
fs.writeFileSync(P.content, '[]');

const { getIdentityDb, closeIdentityDb } = await import('../db/identityDb.js');
const { runMigrations } = await import('../db/migrate.js');
const { mirrorSnapshotV2 } = await import('../db/identityShadowV2.js');
process.env.IDENTITY_SQLITE_ENABLED = '1';
closeIdentityDb();
{
    const db = getIdentityDb(P.identity);
    runMigrations(db, () => {});
    const at = new Date().toISOString();
    const hashOf = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    mirrorSnapshotV2(db, { domain: 'institutions', records: schools,
        sourceVersion: { hash: hashOf(P.schools), seq: 1 }, writerId: 'fx', at });
    mirrorSnapshotV2(db, { domain: 'users', records: users,
        sourceVersion: { hash: hashOf(P.users), seq: 1 }, writerId: 'fx', at });
    mirrorSnapshotV2(db, { domain: 'groups', records: groups,
        sourceVersion: { hash: hashOf(P.groups), seq: 1 }, writerId: 'fx', at });
    const c = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    ok('fixture: espejo 247 users / 4 groups / 1 institution / 0 access_rules',
       c('users') === 247 && c('groups') === 4 && c('institutions') === 1 && c('access_rules') === 0,
       `${c('users')}/${c('groups')}/${c('institutions')}/${c('access_rules')}`);
    closeIdentityDb();
}

const CMP = await import('../db/identityShadowCompare.js');
const PATHS = { usersDb: P.users, groupsDb: P.groups, accessDb: P.access, schoolsDb: P.schools };
const enable = (domains) => {
    process.env.IDENTITY_SHADOW_COMPARE = '1';
    process.env.IDENTITY_SHADOW_COMPARE_DOMAINS = domains;
    process.env.IDENTITY_SHADOW_COMPARE_TTL_MS = '0';   // sin memo temporal en tests
    process.env.IDENTITY_DB = P.identity;
};
const disable = () => { delete process.env.IDENTITY_SHADOW_COMPARE; };
const fresh = async (domains) => {
    enable(domains);
    CMP.__resetShadowCompare();
    closeIdentityDb();
    getIdentityDb(P.identity);
    await CMP.warmupShadowCompare();
};
const snap = () => CMP.getShadowCompareSnapshot();
const dom = (d) => snap().byDomain[d];

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[1] COMPARADOR APAGADO → cero comportamiento');
{
    disable();
    CMP.__resetShadowCompare();
    const before = JSON.stringify(users);
    CMP.observeIdentityShadowRead(P.users, users, PATHS, {});
    const s = snap();
    ok('enabled=false', s.enabled === false);
    ok('0 comparaciones', s.totals.comparisons === 0);
    ok('el array oficial queda intacto', JSON.stringify(users) === before);
}

console.log('\n[2] DOMINIO CANÓNICO → MATCH + gaps por política');
{
    await fresh('users,groups,institutions,memberships,access');
    CMP.observeIdentityShadowRead(P.users, users, PATHS, {});
    const u = dom('users');
    ok('users comparado 1 vez', u.comparisons === 1);
    ok('247 usuarios canónicos MATCH', u.entities.match === 247, `match=${u.entities.match}`);
    ok('400 sintéticos → EXPECTED_COVERAGE_GAP:SYNTHETIC_USER',
       u.entities.gaps.SYNTHETIC_USER === 400, JSON.stringify(u.entities.gaps));
    ok('gap estructural CREDENTIAL_AUTHORITY presente (1 por evaluación)',
       u.entities.gaps.CREDENTIAL_AUTHORITY === 1);
    ok('0 divergencias inesperadas', u.entities.unexpected === 0);
    ok('0 divergencias de seguridad', u.entities.security === 0);
    ok('resultado de la lectura = expected_coverage_gap',
       u.results.expected_coverage_gap === 1 && u.results.unexpected_divergence === 0);
}
{
    CMP.observeIdentityShadowRead(P.groups, groups, PATHS, {});
    const g = dom('groups');
    ok('4 grupos canónicos MATCH', g.entities.match === 4, `match=${g.entities.match}`);
    ok('16 grupos legacy → EXPECTED_COVERAGE_GAP:LEGACY_GROUP',
       g.entities.gaps.LEGACY_GROUP === 16, JSON.stringify(g.entities.gaps));
    ok('0 inesperadas / 0 seguridad', g.entities.unexpected === 0 && g.entities.security === 0);
    const m = dom('memberships');
    ok('membresías derivadas comparadas', !!m && m.entities.compared > 0, JSON.stringify(m?.entities));
    ok('membresías: 0 inesperadas / 0 seguridad',
       m.entities.unexpected === 0 && m.entities.security === 0, JSON.stringify(m.entities));
    ok('membresías: todas MATCH', m.entities.match === m.entities.compared);
}
{
    CMP.observeIdentityShadowRead(P.schools, schools, PATHS, {});
    const i = dom('institutions');
    ok('institución canónica MATCH', i.entities.match === 1 && i.entities.unexpected === 0);
}
{
    CMP.observeIdentityShadowRead(P.access, accessRules, PATHS, {});
    const a = dom('access');
    ok('regla de acceso sin espejo → EXPECTED_COVERAGE_GAP:ACCESS_RULES',
       a.entities.gaps.ACCESS_RULES === 1, JSON.stringify(a.entities.gaps));
    ok('access: 0 inesperadas / 0 seguridad', a.entities.unexpected === 0 && a.entities.security === 0);
}
{
    const s = snap();
    ok('solo aparecen gaps aprobados + CREDENTIAL_AUTHORITY',
       s.gaps_outside_approved.length === 0, JSON.stringify(s.gaps_outside_approved));
    ok('official_sqlite_responses=0 declarado', s.official_sqlite_responses === 0);
    ok('official_read_backend=json', s.official_read_backend === 'json');
}

console.log('\n[3] MISMATCH ARTIFICIAL → realmente detectado');
{
    await fresh('users');
    // Campo NO relacionado con autorización.
    const mutated = users.map(u => u.id === 'RU010' ? { ...u, nombre_completo: 'Otro Nombre' } : u);
    CMP.observeIdentityShadowRead(P.users, mutated, PATHS, {});
    const u = dom('users');
    ok('1 UNEXPECTED_DIVERGENCE detectada', u.entities.unexpected === 1, JSON.stringify(u.entities));
    ok('NO se clasifica como seguridad', u.entities.security === 0);
    ok('resultado de la lectura = unexpected_divergence', u.results.unexpected_divergence === 1);
    ok('la muestra nombra el campo divergente',
       u.samples.some(s => s.fields?.includes('nombre_completo')), JSON.stringify(u.samples[0]));
}
{
    await fresh('users');
    // Campo que SÍ alimenta autorización.
    const mutated = users.map(u => u.id === 'RU010' ? { ...u, roles: ['administrador'] } : u);
    CMP.observeIdentityShadowRead(P.users, mutated, PATHS, {});
    const u = dom('users');
    ok('rol divergente → SECURITY_RELEVANT_DIVERGENCE', u.entities.security === 1, JSON.stringify(u.entities));
    ok('resultado de la lectura = security_relevant_divergence',
       u.results.security_relevant_divergence === 1);
}
{
    await fresh('users');
    // Identidad SOLO en el espejo: dirección conceder ⇒ seguridad.
    const withoutOne = users.filter(u => u.id !== 'RU011');
    CMP.observeIdentityShadowRead(P.users, withoutOne, PATHS, {});
    const u = dom('users');
    ok('identidad extra en SQLite → SECURITY_RELEVANT (podría CONCEDER)',
       u.entities.security === 1 && u.samples.some(s => s.kind === 'EXTRA_IN_SQLITE'),
       JSON.stringify(u.entities));
}
{
    await fresh('groups');
    // Grupo canónico ausente del espejo SIN política que lo explique.
    const extraGroup = [...groups, { id: 'g-can-9', name: 'Nuevo', type: 'course',
        organizationId: 'inst-fixture-1', memberIds: [] }];
    CMP.observeIdentityShadowRead(P.groups, extraGroup, PATHS, {});
    const g = dom('groups');
    ok('grupo proyectable ausente del espejo → UNEXPECTED (no se disfraza de gap)',
       g.entities.unexpected === 1, JSON.stringify(g.entities));
}

console.log('\n[4] FALLO DE SQLITE / DEL COMPARADOR → COMPARATOR_ERROR, oficial intacto');
{
    await fresh('users');
    const before = JSON.stringify(users);
    CMP.__setShadowCompareModules({
        getIdentityDb: () => { const e = new Error('database is locked'); e.code = 'SQLITE_BUSY'; throw e; },
        makeIdentityRepo: () => ({}), projectUsers: () => ({ rejected: [] }),
        projectGroups: () => ({ rows: [], rejected: [] }), projectMemberships: () => ({ rows: [] }),
    });
    CMP.observeIdentityShadowRead(P.users, users, PATHS, {});
    const s = snap();
    ok('SQLite caído → comparator_error contabilizado',
       s.totals.comparator_errors === 1 && s.byDomain.users.results.comparator_error === 1,
       JSON.stringify(s.totals));
    ok('el array oficial sigue intacto', JSON.stringify(users) === before);
}
{
    await fresh('users');
    CMP.__setShadowCompareModules({
        getIdentityDb: () => ({ prepare: () => ({ get: () => ({}), all: () => [] }) }),
        makeIdentityRepo: () => { throw new Error('comparator exploded'); },
        projectUsers: () => ({ rejected: [] }), projectGroups: () => ({ rows: [], rejected: [] }),
        projectMemberships: () => ({ rows: [] }),
    });
    let threw = false;
    try { CMP.observeIdentityShadowRead(P.users, users, PATHS, {}); } catch { threw = true; }
    ok('excepción interna del comparador NO se propaga', threw === false);
    ok('se contabiliza como comparator_error', snap().totals.comparator_errors === 1);
}
{
    // Fila malformada en el espejo: el comparador la ve como ausencia y la
    // clasifica; la lectura oficial no se entera.
    await fresh('users');
    const db = getIdentityDb(P.identity);
    db.prepare(`UPDATE users SET raw_json='{{{roto' WHERE canonical_id='RU012'`).run();
    const before = JSON.stringify(users);
    CMP.observeIdentityShadowRead(P.users, users, PATHS, {});
    const u = dom('users');
    ok('fila malformada → divergencia clasificada, sin excepción',
       u.entities.unexpected + u.entities.security >= 1, JSON.stringify(u.entities));
    ok('el array oficial sigue intacto tras la fila malformada', JSON.stringify(users) === before);
    db.prepare(`UPDATE users SET raw_json=? WHERE canonical_id='RU012'`)
        .run(JSON.stringify(users.find(x => x.id === 'RU012'), (k, v) => (k === 'password' ? undefined : v)));
}

console.log('\n[5] DOMINIO NO SOPORTADO / NO HABILITADO → ignorado');
{
    await fresh('users');
    CMP.observeIdentityShadowRead(path.join(tmp, 'progress_db.json'), [{ x: 1 }], PATHS, {});
    ok('store fuera de identidad → 0 comparaciones', snap().totals.comparisons === 0);
    CMP.observeIdentityShadowRead(P.groups, groups, PATHS, {});
    ok('dominio no habilitado en la allowlist → 0 comparaciones', snap().totals.comparisons === 0);
}

console.log('\n[6] PII-SAFE');
{
    await fresh('users,groups,institutions,memberships,access');
    const mutated = users.map(u => u.id === 'RU010' ? { ...u, roles: ['administrador'] } : u);
    CMP.observeIdentityShadowRead(P.users, mutated, PATHS, {});
    CMP.observeIdentityShadowRead(P.groups, groups, PATHS, {});
    const blob = JSON.stringify(snap());
    ok('sin correos', !/@fixture\.test/.test(blob));
    ok('sin nombres propios', !/Usuario Real|Colegio Fixture|Curso Canónico/.test(blob));
    ok('sin contraseñas', !/pw-secret|pw-syn|password/.test(blob));
    ok('sin ids crudos de usuario/grupo', !/RU0\d\d|SYN\d\d\d|g-can-|g-leg-/.test(blob));
    ok('las referencias van hasheadas (h16)',
       snap().byDomain.users.samples.every(s => !s.ref || /^[0-9a-f]{16}$/.test(s.ref)));
}

console.log('\n[7] MEMOIZACIÓN: no oculta un cambio de fuente');
{
    enable('users');
    process.env.IDENTITY_SHADOW_COMPARE_TTL_MS = '0';
    CMP.__resetShadowCompare();
    closeIdentityDb(); getIdentityDb(P.identity);
    await CMP.warmupShadowCompare();
    CMP.observeIdentityShadowRead(P.users, users, PATHS, {});
    CMP.observeIdentityShadowRead(P.users, users, PATHS, {});
    const s1 = snap();
    ok('2 lecturas comparadas, 1 sola evaluación (fuentes intactas)',
       s1.totals.comparisons === 2 && s1.totals.evaluations === 1, JSON.stringify(s1.totals));
    // Cambia la fuente JSON: la huella debe invalidar el memo y re-evaluar.
    const mutated = users.map(u => u.id === 'RU010' ? { ...u, roles: ['administrador'] } : u);
    fs.writeFileSync(P.users, JSON.stringify(mutated, null, 2));
    await sleep(15);
    CMP.observeIdentityShadowRead(P.users, mutated, PATHS, {});
    const s2 = snap();
    ok('cambio de la fuente → re-evaluación', s2.totals.evaluations === 2, JSON.stringify(s2.totals));
    ok('y la divergencia de seguridad SÍ se detecta',
       s2.byDomain.users.results.security_relevant_divergence === 1);
    fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n[8] INTEGRACIÓN: server real. A) configuración PRODUCTIVA  B) cutover SIMULADO');
disable();
const REPO_DATA = path.join(REPO, 'data');
const snapshotRepoData = () => {
    if (!fs.existsSync(REPO_DATA)) return null;
    const out = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full); else out.push(path.relative(REPO_DATA, full));
        }
    };
    walk(REPO_DATA);
    return out.sort().join('\n');
};
const dataBefore = snapshotRepoData();

const admin = { 'x-user-id': 'RU001', 'content-type': 'application/json' };
const readUsersFile = () => JSON.parse(fs.readFileSync(P.users, 'utf8'));

function boot(port, extraEnv) {
    const c = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            PORT: String(port),
            CHP_DATA_DIR: path.join(tmp, `data-${port}`),
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content,
            UPLOADS_ROOT: P.uploads,
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'offline.db'),
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            IDENTITY_DB: P.identity,
            IDENTITY_SQLITE_ENABLED: '1',
            IDENTITY_DUAL_WRITE: '1',
            IDENTITY_SHADOW_COMPARE: '1',
            IDENTITY_SHADOW_COMPARE_DOMAINS: 'users,groups,institutions,memberships,access',
            IDENTITY_SHADOW_COMPARE_TTL_MS: '0',
            ...extraEnv,
        },
    });
    const st = { child: c, log: '' };
    c.stdout.on('data', d => { st.log += d; });
    c.stderr.on('data', d => { st.log += d; });
    return st;
}
async function waitHealthy(st, port) {
    for (let i = 0; i < 120; i++) {
        if (st.child.exitCode !== null) throw new Error(`server exited rc=${st.child.exitCode}\n${st.log.slice(-1500)}`);
        try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return; } catch {}
        await sleep(500);
    }
    throw new Error(`server never healthy\n${st.log.slice(-1500)}`);
}

// ── A) CONFIGURACIÓN PRODUCTIVA: IDENTITY_READ=json + comparador ON ──────────
console.log('\n  A) configuración productiva (IDENTITY_READ=json, domains vacío)');
const portA = 4600 + (process.pid % 200);
const A = boot(portA, { IDENTITY_READ: 'json', IDENTITY_READ_DOMAINS: '' });
const baseA = `http://127.0.0.1:${portA}`;
try {
    await waitHealthy(A, portA);
    ok('el comparador se arma en el arranque', /identity-shadow-compare\] armed/.test(A.log));

    const list = await fetch(`${baseA}/api/users`, { headers: admin });
    const body = await list.json();
    ok('GET /api/users responde 200 con comparador ON', list.status === 200);
    ok('la respuesta OFICIAL es JSON íntegro (647), no el espejo (247)',
       Array.isArray(body) && body.length === 647, `len=${body?.length}`);

    const groupsResp = await fetch(`${baseA}/api/groups`, { headers: admin });
    const groupsBody = await groupsResp.json();
    ok('GET /api/groups devuelve los 20 del JSON, no los 4 del espejo',
       Array.isArray(groupsBody) && groupsBody.length === 20, `len=${groupsBody?.length}`);

    const login = await fetch(`${baseA}/api/auth/login`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ru007@fixture.test', password: 'pw-secret-7' }) });
    ok('OFFICIAL_AUTH_SOURCE=JSON: login canónico 200', login.status === 200, String(login.status));
    const loginSynth = await fetch(`${baseA}/api/auth/login`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'syn001@fixture.test', password: 'pw-syn-1' }) });
    ok('login de identidad SOLO-JSON también 200 (GAP-1 no afecta a la autoridad actual)',
       loginSynth.status === 200, String(loginSynth.status));

    const authzJsonOnly = await fetch(`${baseA}/api/users`, { headers: { 'x-user-id': 'SYN001' } });
    ok('OFFICIAL_AUTHZ_SOURCE=JSON: principal solo-JSON sigue autorizado',
       authzJsonOnly.status === 200, String(authzJsonOnly.status));

    // Espejo destruido en caliente: la respuesta oficial no depende de él.
    const sqliteBackup = fs.readFileSync(P.identity);
    fs.writeFileSync(P.identity, Buffer.from('no soy una base sqlite'));
    const listBroken = await fetch(`${baseA}/api/users`, { headers: admin });
    const bodyBroken = await listBroken.json();
    ok('con el espejo corrupto la API sigue 200 y devuelve el JSON íntegro',
       listBroken.status === 200 && Array.isArray(bodyBroken) && bodyBroken.length === 647,
       `${listBroken.status}/${bodyBroken?.length}`);
    const loginBroken = await fetch(`${baseA}/api/auth/login`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ru007@fixture.test', password: 'pw-secret-7' }) });
    ok('y el login sigue funcionando con el espejo corrupto', loginBroken.status === 200,
       String(loginBroken.status));
    fs.writeFileSync(P.identity, sqliteBackup);
} catch (e) {
    ok('escenario A ejecutable', false, String(e.message || e));
} finally {
    A.child.kill();
    await sleep(400);
}

// ── B) PEOR CASO: cutover SIMULADO + comparador ON (no-regresión RMW) ────────
console.log('\n  B) peor caso: cutover simulado (IDENTITY_READ=sqlite) + comparador ON');
const portB = portA + 1;
const B = boot(portB, { IDENTITY_READ: 'sqlite', IDENTITY_READ_DOMAINS: 'users,groups' });
const baseB = `http://127.0.0.1:${portB}`;
try {
    await waitHealthy(B, portB);
    const put = await fetch(`${baseB}/api/users/RU005`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ nombre_completo: 'Editado 02C-B' }) });
    ok('PUT usuario → 200 con comparador ON y cutover simulado', put.status === 200, String(put.status));
    const putGroup = await fetch(`${baseB}/api/groups/g-can-2`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ name: 'Grupo Editado 02C-B' }) });
    ok('PUT grupo → 200 con comparador ON y cutover simulado', putGroup.status === 200, String(putGroup.status));
    await sleep(300);
    const after = readUsersFile();
    const groupsAfter = JSON.parse(fs.readFileSync(P.groups, 'utf8'));
    ok('RMW intacta: 647→647', after.length === 647, `len=${after.length}`);
    ok('RMW intacta: 647 credenciales preservadas',
       after.every(u => typeof u.password === 'string' && u.password.length > 0));
    ok('RMW intacta: 400 sintéticos preservados',
       after.filter(u => u._loadtest_marker).length === 400);
    ok('RMW intacta: grupos 20→20 con los 16 legacy',
       groupsAfter.length === 20 && groupsAfter.filter(g => String(g.id).startsWith('g-leg-')).length === 16);
    ok('el comparador no contaminó la escritura (edición aplicada tal cual)',
       after.find(u => u.id === 'RU005')?.nombre_completo === 'Editado 02C-B');

    // Evidencia runtime del coste REAL de un cutover de users (GAP-1/GAP-3).
    // No es una regresión: es exactamente lo que el gap predice, medido.
    const synthSession = await fetch(`${baseB}/api/users`, { headers: { 'x-user-id': 'SYN001' } });
    ok('EVIDENCIA GAP-1: con cutover de users, un principal solo-JSON pierde la sesión (401)',
       synthSession.status === 401, String(synthSession.status));
    const legacyGroup = await fetch(`${baseB}/api/groups/g-leg-3/members`, { headers: admin });
    ok('EVIDENCIA GAP-3: con cutover de groups, un grupo legacy deja de existir (404)',
       legacyGroup.status === 404, String(legacyGroup.status));

    ok('data/ del repositorio intacto (harness hermético)', snapshotRepoData() === dataBefore);
} catch (e) {
    ok('escenario B ejecutable', false, String(e.message || e));
} finally {
    B.child.kill();
    await sleep(400);
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
