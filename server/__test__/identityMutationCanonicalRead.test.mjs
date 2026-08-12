/**
 * identityMutationCanonicalRead.test.mjs — CHP-IDDB-READ-RMW-SEAM-01.
 *
 * Demuestra, con el SERVER REAL booteado contra stores temporales, que bajo un
 * cutover de lectura simulado (IDENTITY_READ=sqlite + dominios habilitados):
 *
 *   1. el read path normal SIGUE siendo conmutable (sirve el espejo SQLite);
 *   2. toda MUTACIÓN lee su base del JSON canónico FÍSICO: nada se trunca
 *      (647 users → 647; 20 groups → 20), las credenciales y los 400
 *      sintéticos solo-JSON sobreviven, y el login sigue funcionando;
 *   3. si el canónico falta o no parsea, la mutación FALLA (fail-closed):
 *      ni fallback SQLite, ni store vacío, ni subconjunto;
 *   4. el guard de regresión (assertWritableIdentityPayload) rehúsa persistir
 *      un array servido desde SQLite sobre un store de identidad.
 *
 * El escenario replica las cardinalidades reales del hallazgo de 02C-A:
 * JSON 647 (247 reales + 400 sintéticos `_loadtest_marker`) vs espejo 247;
 * JSON 20 grupos (4 canónicos + 16 legacy) vs espejo 4.
 *
 * Cómo correr:
 *   node server/__test__/identityMutationCanonicalRead.test.mjs
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

// ── Fixtures: mismas cardinalidades que el hallazgo (647/247, 20/4) ──────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rmw_seam_'));
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

const users = [];
for (let i = 1; i <= 247; i++) {
    users.push({
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
    users.push({
        id: `SYN${String(i).padStart(3, '0')}`,
        email: `syn${String(i).padStart(3, '0')}@fixture.test`,
        password: `pw-syn-${i}`,
        roles: ['lector'],
        accountStatus: 'active',
        _loadtest_marker: 'loadtest-fixture',
    });
}
const groups = [];
for (let i = 1; i <= 4; i++) {
    groups.push({
        id: `g-can-${i}`, name: `Curso Canónico ${i}`, type: 'course',
        organizationId: 'inst-fixture-1', school: 'Colegio Fixture',
        gradeLevel: String(i), section: 'A',
        memberIds: [`RU${String(i * 2).padStart(3, '0')}`], mediatorIds: ['RU001'],
    });
}
for (let i = 1; i <= 16; i++) {
    groups.push({ id: `g-leg-${i}`, name: `Legacy ${i}`, type: 'course', memberIds: [] });
}
fs.writeFileSync(P.users, JSON.stringify(users, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(groups, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'inst-fixture-1', name: 'Colegio Fixture' }], null, 2));
fs.writeFileSync(P.access, JSON.stringify([{
    id: 'rule-preexistente', scope: 'group', scopeId: 'g-can-1',
    titleIds: ['t-1'], collectionIds: [], expiresAt: null,
}], null, 2));
fs.writeFileSync(P.content, '[]');

// Espejo SQLite por el MISMO camino que producción (v2). El dominio access no
// se espeja (access_rules queda VACÍA, como en producción): bajo el flag, el
// facade sirve [] para access — el caso exacto que borraría las reglas JSON.
{
    const { getIdentityDb, closeIdentityDb } = await import('../db/identityDb.js');
    const { runMigrations } = await import('../db/migrate.js');
    const { mirrorSnapshotV2 } = await import('../db/identityShadowV2.js');
    closeIdentityDb();
    const db = getIdentityDb(P.identity);
    runMigrations(db, () => {});
    const at = new Date().toISOString();
    const hashOf = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    mirrorSnapshotV2(db, { domain: 'institutions', records: [{ id: 'inst-fixture-1', name: 'Colegio Fixture' }],
        sourceVersion: { hash: 'fx-inst-1', seq: 1 }, writerId: 'fixture:rmw', at });
    mirrorSnapshotV2(db, { domain: 'users', records: users,
        sourceVersion: { hash: hashOf(P.users), seq: 1 }, writerId: 'fixture:rmw', at });
    mirrorSnapshotV2(db, { domain: 'groups', records: groups,
        sourceVersion: { hash: hashOf(P.groups), seq: 1 }, writerId: 'fixture:rmw', at });
    // Auditoría del dominio access (vacío pero ok=1): habilita el gate 3 del
    // facade para 'access', reproduciendo el peor caso.
    db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok) VALUES ('access',1,0,1)`).run();
    const u = db.prepare('SELECT count(*) c FROM users').get().c;
    const g = db.prepare('SELECT count(*) c FROM groups').get().c;
    closeIdentityDb();
    ok('fixture: espejo 247/4 vs JSON 647/20', u === 247 && g === 4, `sqlite users=${u} groups=${g}`);
}

// ── Server real, flags de cutover simulado en LOS TRES dominios ──────────────
const PORT = 4100 + (process.pid % 400);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        USERS_DB: P.users,
        GROUPS_DB: P.groups,
        SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access,
        CONTENT_DB: P.content,
        UPLOADS_ROOT: P.uploads,
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        IDENTITY_DB: P.identity,
        IDENTITY_SQLITE_ENABLED: '1',
        IDENTITY_DUAL_WRITE: '1',
        IDENTITY_READ: 'sqlite',
        IDENTITY_READ_DOMAINS: 'users,groups,access',
    },
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitHealthy() {
    for (let i = 0; i < 120; i++) {
        if (child.exitCode !== null) throw new Error(`server exited rc=${child.exitCode}\n${bootLog.slice(-2000)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
        await sleep(500);
    }
    throw new Error(`server never healthy\n${bootLog.slice(-2000)}`);
}
const readUsersFile = () => JSON.parse(fs.readFileSync(P.users, 'utf8'));
const readGroupsFile = () => JSON.parse(fs.readFileSync(P.groups, 'utf8'));
const admin = { 'x-user-id': 'RU001', 'content-type': 'application/json' };

try {
    await waitHealthy();

    console.log('\n[1] READ SEAM SIGUE CONMUTABLE (respuestas desde SQLite)');
    const list = await fetch(`${base}/api/users`, { headers: admin });
    const listBody = await list.json();
    ok('GET /api/users responde 200', list.status === 200, String(list.status));
    ok('lectura normal sirve el espejo (247, no 647) → READ_SEAM_STILL_SWITCHABLE',
       Array.isArray(listBody) && listBody.length === 247, `len=${listBody?.length}`);

    console.log('\n[2] USERS: NO TRUNCAMIENTO (base de mutación = JSON físico)');
    const put1 = await fetch(`${base}/api/users/RU005`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ nombre_completo: 'Renombrado Seam' }) });
    ok('PUT usuario canónico → 200', put1.status === 200, String(put1.status));
    const put2 = await fetch(`${base}/api/users/SYN001`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ nombre_completo: 'Sintético Tocado' }) });
    ok('PUT usuario SOLO-JSON → 200 (la base vio los 647) → MUTATION_BASE_SOURCE=JSON',
       put2.status === 200, String(put2.status));
    let after = readUsersFile();
    ok('cardinalidad preservada 647→647', after.length === 647, `len=${after.length}`);
    ok('las 647 credenciales sobreviven (ninguna desaparece)',
       after.every(u => typeof u.password === 'string' && u.password.length > 0));
    ok('los 400 sintéticos solo-JSON sobreviven',
       after.filter(u => u._loadtest_marker).length === 400);
    ok('la edición sí se aplicó', after.find(u => u.id === 'RU005')?.nombre_completo === 'Renombrado Seam');

    console.log('\n[3] LOGIN bajo cutover simulado (lee y reescribe el canónico)');
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ru007@fixture.test', password: 'pw-secret-7' }) });
    ok('login con credencial JSON → 200 (el espejo sin credenciales NO es la base)',
       login.status === 200, String(login.status));
    let lastLoginPersisted = false;
    for (let i = 0; i < 20 && !lastLoginPersisted; i++) {  // writeJSONAsync es post-respuesta
        await sleep(250);
        const u7 = readUsersFile().find(u => u.id === 'RU007');
        lastLoginPersisted = typeof u7?.lastLoginAt === 'string';
    }
    after = readUsersFile();
    ok('lastLoginAt persistido por la vía RMW del login', lastLoginPersisted);
    ok('el write del login NO truncó el padrón', after.length === 647, `len=${after.length}`);

    console.log('\n[4] GROUPS: NO TRUNCAMIENTO');
    const putG = await fetch(`${base}/api/groups/g-can-2`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ name: 'Curso Canónico 2 (editado)' }) });
    ok('PUT grupo canónico → 200', putG.status === 200, String(putG.status));
    const gAfter = readGroupsFile();
    ok('cardinalidad preservada 20→20', gAfter.length === 20, `len=${gAfter.length}`);
    ok('los 16 grupos legacy solo-JSON sobreviven',
       gAfter.filter(g => String(g.id).startsWith('g-leg-')).length === 16);
    ok('la edición sí se aplicó', gAfter.find(g => g.id === 'g-can-2')?.name === 'Curso Canónico 2 (editado)');

    console.log('\n[6] FAIL-CLOSED del canónico (corrupto y ausente)');
    const goodUsers = fs.readFileSync(P.users);
    fs.writeFileSync(P.users, '{{{ corrupto');
    const putBad = await fetch(`${base}/api/users/RU006`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ nombre_completo: 'No debe aplicar' }) });
    ok('canónico corrupto → mutación FALLA (no 2xx)', putBad.status >= 500, String(putBad.status));
    ok('el store corrupto NO fue reemplazado por subset/vacío',
       fs.readFileSync(P.users, 'utf8') === '{{{ corrupto');
    fs.unlinkSync(P.users);
    const putGone = await fetch(`${base}/api/users/RU006`, { method: 'PUT', headers: admin,
        body: JSON.stringify({ nombre_completo: 'No debe aplicar' }) });
    ok('canónico AUSENTE → mutación FALLA (sin fallback SQLite)', putGone.status >= 500, String(putGone.status));
    ok('no se creó un store desde SQLite ni vacío → CANONICAL_MUTATION_READ_FAILS_CLOSED',
       !fs.existsSync(P.users));
    fs.writeFileSync(P.users, goodUsers);
} catch (e) {
    ok('escenario ejecutable', false, String(e.message || e));
} finally {
    child.kill();
    await sleep(500);
}

console.log('\n[5] ACCESS: el seam serviría [] y canónico+guard lo neutralizan');
{
    // POST /api/access exige el admin secret file-only (ruta constante
    // /app/secrets/admin_secret, no inyectable) → el dominio access se prueba
    // a nivel de componente: mismo mutate helper + mismo write seam que los
    // dominios probados extremo a extremo arriba.
    process.env.IDENTITY_READ = 'sqlite';
    process.env.IDENTITY_READ_DOMAINS = 'access';
    process.env.IDENTITY_SQLITE_ENABLED = '1';
    process.env.IDENTITY_DB = P.identity;
    const facade = await import('../db/identityReadFacade.js');
    await facade.warmupReadFacade();
    const paths = { usersDb: P.users, groupsDb: P.groups, accessDb: P.access };
    const served = facade.tryIdentitySqliteRead(P.access, paths, () => {});
    ok('el facade SÍ serviría access desde SQLite: [] (0 reglas) — el hazard es real',
       Array.isArray(served) && served.length === 0,
       `served=${JSON.stringify(served)}`);
    ok('el array servido viene marcado como sqlite-served',
       served?.[facade.IDENTITY_SQLITE_SERVED] === true);
    let guardBlocked = false;
    try { facade.assertWritableIdentityPayload(P.access, served, paths); } catch (e) {
        guardBlocked = /IDENTITY_MUTATION_SQLITE_GUARD/.test(e.message);
    }
    ok('persistir ese [] sobre ACCESS_DB queda RECHAZADO por el guard', guardBlocked);
    const rules = JSON.parse(fs.readFileSync(P.access, 'utf8'));
    ok('la base canónica física conserva la regla preexistente (1 regla)',
       rules.length === 1 && rules[0].id === 'rule-preexistente');
}

console.log('\n[7] GUARD DE REGRESIÓN (assertWritableIdentityPayload)');
{
    const facade = await import('../db/identityReadFacade.js');
    const paths = { usersDb: P.users, groupsDb: P.groups, accessDb: P.access };
    const tagged = [{ id: 'x' }];
    Object.defineProperty(tagged, facade.IDENTITY_SQLITE_SERVED, { value: true });
    let threw = false;
    try { facade.assertWritableIdentityPayload(P.users, tagged, paths); } catch (e) {
        threw = /IDENTITY_MUTATION_SQLITE_GUARD/.test(e.message);
    }
    ok('array servido desde SQLite → el write seam lo RECHAZA', threw);
    let quiet = true;
    try { facade.assertWritableIdentityPayload(P.users, [{ id: 'y' }], paths); } catch { quiet = false; }
    ok('array canónico (sin marca) → pasa', quiet);
    let nonIdentity = true;
    try { facade.assertWritableIdentityPayload('/otro/store.json', tagged, paths); } catch { nonIdentity = false; }
    ok('store no-identidad → guard no interviene', nonIdentity);
}

console.log('\n[8] ANCLAS ESTRUCTURALES (los mutators protegidos no vuelven al seam)');
{
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    const count = (re) => (src.match(re) || []).length;
    ok('lecturas base de mutación de USERS_DB usan el canónico (≥13)',
       count(/readCanonicalStoreForMutation\(USERS_DB\)/g) >= 13);
    ok('lecturas base de mutación de GROUPS_DB usan el canónico (≥12)',
       count(/readCanonicalStoreForMutation\(GROUPS_DB\)/g) >= 12);
    ok('lectura base de mutación de ACCESS_DB usa el canónico (≥1)',
       count(/readCanonicalStoreForMutation\(ACCESS_DB\)/g) >= 1);
    ok('ambos write seams invocan el guard',
       count(/assertWritableIdentityPayload\(file, data/g) >= 2);
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
