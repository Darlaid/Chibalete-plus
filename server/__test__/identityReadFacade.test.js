/**
 * identityReadFacade.test.js — P4-A cutover de lectura, aislado (temp db).
 * Ejercita el código real (identityReadFacade + repo + migrate + shadow).
 *   node server/__test__/identityReadFacade.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getIdentityDb, closeIdentityDb } from '../db/identityDb.js';
import { runMigrations } from '../db/migrate.js';
import { mirrorUsers } from '../db/identityShadow.js';

let pass = 0, fail = 0;
const ok = (l,c,h='') => c ? (console.log('  ✓',l),pass++) : (console.error('  ✗',l,h),fail++);

const tmp = path.join(os.tmpdir(), `idfacade_${Date.now()}.db`);
const PATHS = { usersDb: '/X/users.json', groupsDb: '/X/groups.json', accessDb: '/X/access.json' };
const users = [
    { id: 'u1', email: 'A@x.cl', roles: ['lector'], nombre_completo: 'Ana' },
    { id: 'u2', email: 'b@x.cl', roles: ['mediador'] },
];

closeIdentityDb();
const db = getIdentityDb(tmp);          // singleton apunta al temp
// CHP-IDDB-02A: la fixture se construye con el espejo v1 (mirrorUsers), que
// solo es válido sobre el esquema v1, así que la base se ancla en 0001. La
// facade en sí es agnóstica de versión: lee por identityRepo, que soporta v1 y
// v2. La lectura sobre v2 se cubre en server/__test__/identitySchemaV2.test.js.
runMigrations(db, () => {}, { until: '0001_identity' });
mirrorUsers(db, users);                  // SQLite == JSON, shadow_audit ok=1

const facade = await import('../db/identityReadFacade.js');

try {
    console.log('\n[1] default IDENTITY_READ=json → facade NO interviene (JSON intacto)');
    delete process.env.IDENTITY_READ; delete process.env.IDENTITY_READ_DOMAINS;
    process.env.IDENTITY_SQLITE_ENABLED = '1';
    ok('json default → null (cae a JSON)',
       facade.tryIdentitySqliteRead(PATHS.usersDb, PATHS, () => {}) === null);

    console.log('\n[2] IDENTITY_READ=sqlite + dominio habilitado + shadow ok → sirve SQLite');
    process.env.IDENTITY_READ = 'sqlite';
    process.env.IDENTITY_READ_DOMAINS = 'users';
    await facade.warmupReadFacade();
    const got = facade.tryIdentitySqliteRead(PATHS.usersDb, PATHS, () => {});
    ok('devuelve array', Array.isArray(got) && got.length === 2, JSON.stringify(got));
    ok('byte-equivalente al JSON original (lossless)',
       JSON.stringify(got) === JSON.stringify(users));

    console.log('\n[3] dominio NO habilitado → fallback JSON (null)');
    process.env.IDENTITY_READ_DOMAINS = 'groups';
    ok('users no en lista → null', facade.tryIdentitySqliteRead(PATHS.usersDb, PATHS, () => {}) === null);

    console.log('\n[4] recovery-first: shadow last audit ok=0 → fallback JSON');
    process.env.IDENTITY_READ_DOMAINS = 'users';
    db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok,detail)
                VALUES ('users',2,1,0,'forced_mismatch')`).run();
    ok('shadow no-ok → null (NUNCA sirve divergente)',
       facade.tryIdentitySqliteRead(PATHS.usersDb, PATHS, () => {}) === null);

    console.log('\n[5] archivo no-identidad → null (passthrough)');
    ok('otro archivo → null', facade.tryIdentitySqliteRead('/data/progress_db.json', PATHS, () => {}) === null);

    console.log('\n[6] excepción interna → null (el cutover JAMÁS rompe lecturas)');
    // Restaurar ok y romper la db → debe caer a JSON sin lanzar.
    db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok) VALUES ('users',2,2,1)`).run();
    closeIdentityDb(); fs.rmSync(tmp, { force: true });
    let threw = false;
    let r;
    try { r = facade.tryIdentitySqliteRead(PATHS.usersDb, PATHS, () => {}); } catch { threw = true; }
    ok('no lanza', threw === false);
    ok('devuelve null → readJSON usará JSON', r === null);
} finally {
    closeIdentityDb();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.existsSync(f) && fs.unlinkSync(f); } catch {} }
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
