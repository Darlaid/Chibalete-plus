/**
 * identitySchemaV2.test.js — CHP-IDDB-02A.
 *
 * Cubre la migración v2, sus invariantes duras y la inercia del módulo
 * dormido. Corre 100% aislado en ficheros temporales: NUNCA toca data/,
 * data-critical/ ni ninguna ruta productiva.
 *
 *   node server/__test__/identitySchemaV2.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations, rollbackLast } from '../db/migrate.js';
import { mirrorUsers, mirrorGroups, mirrorAccess } from '../db/identityShadow.js';
import { makeIdentityRepo } from '../repositories/identityRepo.js';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02a_schema_'));
const newDb = (name) => {
    const p = path.join(tmpdir, name);
    const db = new Database(p);
    db.pragma('foreign_keys = ON');
    return { db, p };
};
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const NOW = '2026-01-01T00:00:00Z';

try {
    console.log('\n[1] migración sobre una base nueva');
    const { db } = newDb('fresh.db');
    const r = runMigrations(db);
    ok('aplica 0001 y 0002 en orden',
        r.applied[0] === '0001_identity' && r.applied[1] === '0002_identity_v2', JSON.stringify(r.applied));
    ok('0001_identity se conserva en el historial',
        db.prepare(`SELECT COUNT(*) c FROM _migrations WHERE version='0001_identity'`).get().c === 1);
    const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(t => t.name);
    ok('tablas v2 presentes', ['users', 'institutions', 'groups', 'memberships', 'identity_aliases',
        'institution_aliases', 'identity_tombstones', 'migration_runs', 'migration_exclusions']
        .every(t => tables.includes(t)), tables.join(','));
    ok('shadow_audit se conserva', tables.includes('shadow_audit'));
    ok('access_rules se conserva', tables.includes('access_rules'));
    ok('group_members v1 retirada', !tables.includes('group_members'));
    ok('schema version = 2', db.pragma('user_version', { simple: true }) === 2);
    ok('reaplicar es no-op', runMigrations(db).applied.length === 0);
    ok('groups NO usa school::grade::name como PK',
        db.prepare(`PRAGMA table_info(groups)`).all().find(c => c.pk === 1).name === 'group_id');
    ok('foreign_keys activable y sin violaciones', db.pragma('foreign_key_check').length === 0);

    console.log('\n[2] v1 vacía → v2, y reversibilidad');
    const { db: db2 } = newDb('v1empty.db');
    runMigrations(db2, () => {}, undefined);
    ok('v1 vacía migra sin pérdida', db2.pragma('user_version', { simple: true }) === 2);
    // access_rules con filas sobrevive la migración (dominio que v2 no redefine)
    const { db: db3 } = newDb('v1access.db');
    db3.exec(`CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    runMigrations(db3);
    rollbackLast(db3);
    const t3 = db3.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(t => t.name);
    ok('rollback de 0002 restaura la forma v1',
        t3.includes('group_members') && !t3.includes('memberships')
        && db3.pragma('user_version', { simple: true }) === 1, t3.join(','));

    console.log('\n[3] v1 NO vacía se rechaza (fail-closed, sin destruir nada)');
    const { db: db4 } = newDb('v1full.db');
    const only0001 = { applied: [] };
    // Aplica solo 0001 simulando una instalación v1 previa con datos.
    db4.exec(`CREATE TABLE _migrations (version TEXT PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const sql0001 = fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)),
            '..', 'db', 'migrations', '0001_identity.sql'), 'utf8');
    db4.exec(sql0001.slice(sql0001.indexOf('-- UP') + 5, sql0001.indexOf('-- DOWN')));
    db4.prepare(`INSERT INTO _migrations(version) VALUES ('0001_identity')`).run();
    db4.prepare(`INSERT INTO users(id,email_norm,raw_json) VALUES ('legacy-1','a@b.c','{"id":"legacy-1"}')`).run();
    only0001.applied.push('0001_identity');
    const err = throws(() => runMigrations(db4));
    ok('la migración v2 aborta ante filas v1', err !== null, String(err));
    ok('la fila v1 sigue intacta tras el rechazo',
        db4.prepare(`SELECT COUNT(*) c FROM users`).get().c === 1);
    ok('no quedó registrada como aplicada',
        db4.prepare(`SELECT COUNT(*) c FROM _migrations WHERE version='0002_identity_v2'`).get().c === 0);
    ok('no quedó la tabla temporal de precondición',
        !db4.prepare(`SELECT name FROM sqlite_master WHERE name='_v2_requires_empty_v1_domain_tables'`).get());

    console.log('\n[4] invariantes del modelo');
    const seed = (d) => {
        d.prepare(`INSERT INTO institutions(institution_id,official_name,name_norm,addressable,status,
                   provenance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
            .run('inst-a', 'Alfa', 'alfa', 1, 'active', 'test', NOW, NOW);
        d.prepare(`INSERT INTO institutions(institution_id,official_name,name_norm,addressable,status,
                   provenance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
            .run('inst-b', 'Beta', 'beta', 0, 'active', 'test', NOW, NOW);
        d.prepare(`INSERT INTO groups(group_id,institution_id,name,type,status,provenance,raw_json,
                   created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
            .run('g1', 'inst-a', 'Primero A', 'course', 'active', 'test', '{}', NOW, NOW);
        d.prepare(`INSERT INTO users(canonical_id,legacy_identity_hash,email_norm,global_role,status,
                   provenance,source_version,raw_json,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run('u1', 'h_u1', 'u1@x.cl', 'lector', 'active', 'test', 'v', '{"id":"u1"}', NOW, NOW);
        d.prepare(`INSERT INTO users(canonical_id,legacy_identity_hash,email_norm,global_role,status,
                   provenance,source_version,raw_json,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run('u2', 'h_u2', 'u2@x.cl', 'mediador', 'active', 'test', 'v', '{"id":"u2"}', NOW, NOW);
        d.prepare(`INSERT INTO identity_tombstones(tombstone_id,legacy_identity_hash,classification,
                   source,reference_count,provenance,policy_version,created_at)
                   VALUES (?,?,?,?,?,?,?,?)`)
            .run('TS_1', 'h_gone', 'DELETED_IDENTITY_TOMBSTONE_REQUIRED', '[]', 3, 'test', '1.0.0', NOW);
    };
    const mem = (d, g, u, role) => d.prepare(
        `INSERT INTO memberships(membership_id,user_id,group_id,institution_id,role,status,provenance,
         created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(`m_${g}_${u}_${role}`, u, g, 'inst-a', role, 'active', 'test', NOW, NOW);
    const { db: d } = newDb('model.db');
    runMigrations(d);
    seed(d);
    ok('institución sin grupos es válida',
        d.prepare(`SELECT COUNT(*) c FROM institutions WHERE institution_id='inst-b'`).get().c === 1);
    mem(d, 'g1', 'u1', 'member');
    mem(d, 'g1', 'u2', 'member');
    mem(d, 'g1', 'u2', 'mediator');
    ok('doble rol en el mismo grupo: dos membresías',
        d.prepare(`SELECT COUNT(*) c FROM memberships WHERE group_id='g1' AND user_id='u2'`).get().c === 2);
    ok('(group,user,role) es único',
        throws(() => mem(d, 'g1', 'u2', 'member')) !== null);
    ok('membresía a usuario inexistente rechazada',
        throws(() => mem(d, 'g1', 'fantasma', 'member')) !== null);
    ok('membresía a tombstone rechazada',
        (throws(() => mem(d, 'g1', 'TS_1', 'member')) || '').includes('membership_to_tombstone_forbidden'));
    ok('institución incoherente con el grupo rechazada',
        throws(() => d.prepare(
            `INSERT INTO memberships(membership_id,user_id,group_id,institution_id,role,status,provenance,
             created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
            .run('m_bad', 'u1', 'g1', 'inst-b', 'member', 'active', 'test', NOW, NOW)) !== null);
    ok('rol inválido rechazado', throws(() => mem(d, 'g1', 'u1', 'espectador')) !== null);
    ok('grupo sin institución registrada rechazado',
        throws(() => d.prepare(`INSERT INTO groups(group_id,institution_id,name,type,status,provenance,
             raw_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
            .run('g9', 'inst-inexistente', 'X', 'course', 'active', 't', '{}', NOW, NOW)) !== null);

    console.log('\n[5] tombstones');
    ok('tombstone no autenticable por CHECK, no por defecto',
        throws(() => d.prepare(`UPDATE identity_tombstones SET authentication_allowed=1
                                WHERE tombstone_id='TS_1'`).run()) !== null);
    ok('la tabla no tiene columna de credencial ni de rol',
        !d.prepare(`PRAGMA table_info(identity_tombstones)`).all()
            .some(c => /password|credential|role|rol/i.test(c.name)));
    ok('tombstone que colisiona con identidad canónica rechazado',
        (throws(() => d.prepare(`INSERT INTO identity_tombstones(tombstone_id,legacy_identity_hash,
             classification,source,reference_count,provenance,policy_version,created_at)
             VALUES (?,?,?,?,?,?,?,?)`)
            .run('TS_2', 'h_u1', 'X', '[]', 0, 't', '1.0.0', NOW)) || '')
            .includes('tombstone_collides_with_canonical_identity'));
    ok('identidad canónica sobre un tombstone existente rechazada',
        (throws(() => d.prepare(`INSERT INTO users(canonical_id,legacy_identity_hash,email_norm,
             global_role,status,provenance,source_version,raw_json,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run('u9', 'h_gone', 'u9@x.cl', 'lector', 'active', 't', 'v', '{}', NOW, NOW)) || '')
            .includes('canonical_identity_collides_with_tombstone'));

    console.log('\n[6] aliases mutuamente excluyentes');
    const alias = (id, la, uid, tid) => d.prepare(
        `INSERT INTO identity_aliases(alias_id,legacy_alias,user_id,tombstone_id,status,provenance,
         policy_version,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, la, uid, tid, 'active', 't', '1.0.0', NOW);
    alias('a1', 'h_u1', 'u1', null);
    alias('a2', 'h_gone', null, 'TS_1');
    ok('alias a identidad y alias a tombstone conviven',
        d.prepare(`SELECT COUNT(*) c FROM identity_aliases`).get().c === 2);
    ok('alias con ambos destinos rechazado', throws(() => alias('a3', 'h_x', 'u1', 'TS_1')) !== null);
    ok('alias sin destino rechazado', throws(() => alias('a4', 'h_y', null, null)) !== null);
    ok('dos aliases activos con el mismo legacy rechazados',
        throws(() => alias('a5', 'h_u1', 'u2', null)) !== null);
    d.prepare(`INSERT INTO institution_aliases(alias_id,alias_original,alias_normalized,institution_id,
               status,provenance,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run('ia1', 'Alfa', 'alfa', 'inst-a', 'active', 't', NOW);
    ok('alias institucional duplicado activo rechazado',
        throws(() => d.prepare(`INSERT INTO institution_aliases(alias_id,alias_original,alias_normalized,
             institution_id,status,provenance,created_at) VALUES (?,?,?,?,?,?,?)`)
            .run('ia2', 'ALFA', 'alfa', 'inst-b', 'active', 't', NOW)) !== null);

    console.log('\n[7] identityRepo contra el esquema v2');
    const repo = makeIdentityRepo(d);
    ok('detecta esquema v2', repo.schemaVersion() === 2);
    ok('lectura de usuario por id canónico', repo.users.byId('u1')?.id === 'u1');
    ok('usuario inexistente devuelve null (no lanza, no inventa)', repo.users.byId('nadie') === null);
    ok('lectura por email normalizado', repo.users.byEmail(' U1@X.CL ')?.id === 'u1');
    ok('institución legible', repo.institutions.byId('inst-a')?.official_name === 'Alfa');
    ok('institución sin grupos devuelve lista vacía, no error',
        Array.isArray(repo.institutions.groupsOf('inst-b')) && repo.institutions.groupsOf('inst-b').length === 0);
    ok('grupo legible', repo.groupsV2.byId('g1')?.institution_id === 'inst-a');
    ok('memberships con doble rol preservado',
        repo.memberships.ofUser('u2').map(m => m.role).sort().join(',') === 'mediator,member');
    ok('usuario sin membership devuelve lista vacía', repo.memberships.ofUser('u1').length === 1
        && repo.memberships.ofUser('nadie').length === 0);
    ok('alias resuelve a identidad', repo.aliases.resolve('h_u1')?.target === 'user');
    ok('alias resuelve a tombstone', repo.aliases.resolve('h_gone')?.target === 'tombstone');
    ok('alias inexistente devuelve null', repo.aliases.resolve('h_nope') === null);
    ok('tombstone legible y no autenticable',
        repo.tombstones.byHash('h_gone')?.authentication_allowed === 0 && !repo.tombstones.anyAuthenticable());
    ok('users.all() sigue devolviendo el JSON reconstruido (contrato de la facade)',
        repo.users.all().length === 2 && repo.users.all()[0].id === 'u1');
    ok('access.all() sigue funcionando', Array.isArray(repo.access.all()));

    console.log('\n[8] el espejo v1 se niega ante un esquema v2 (fail-closed)');
    ok('mirrorUsers rechaza', mirrorUsers(d, [{ id: 'x', email: 'x@x.cl' }]) === false);
    ok('mirrorGroups rechaza', mirrorGroups(d, [{ name: 'g', school: 's' }]) === false);
    ok('no dañó las identidades importadas',
        d.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c === 2);
    ok('queda auditado por qué',
        d.prepare(`SELECT detail FROM shadow_audit ORDER BY id DESC LIMIT 1`).get()
            ?.detail === 'v1_shadow_incompatible_with_v2_schema');
    ok('mirrorAccess sigue permitido (dominio que v2 no redefine)',
        mirrorAccess(d, [{ id: 'a1', scope: 'group', scopeId: 'g1' }]) === true);

    console.log('\n[9] módulo dormido: cero efectos con los flags apagados');
    delete process.env.IDENTITY_SQLITE_ENABLED;
    delete process.env.IDENTITY_DUAL_WRITE;
    delete process.env.IDENTITY_READ;
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02a_dormant_'));
    const before = fs.readdirSync(probe);
    const identityDb = await import('../db/identityDb.js');
    const writeHook = await import('../db/identityWriteHook.js');
    const readFacade = await import('../db/identityReadFacade.js');
    // En una máquina de desarrollo puede existir un identity.db local previo.
    // La invariante que importa no es que no exista, sino que el módulo
    // dormido no lo cree ni lo toque. Se compara estado, no presencia.
    const snap = (p) => {
        const all = [p, `${p}-wal`, `${p}-shm`];
        return all.map(f => fs.existsSync(f)
            ? `${path.basename(f)}:${fs.statSync(f).size}:${fs.statSync(f).mtimeMs}` : `${path.basename(f)}:ausente`)
            .join('|');
    };
    const dbBefore = snap(identityDb.DEFAULT_DB_PATH);
    ok('importar los módulos no crea ficheros', fs.readdirSync(probe).length === before.length);
    ok('importar los módulos no toca la ruta por defecto',
        snap(identityDb.DEFAULT_DB_PATH) === dbBefore);
    const boot = await writeHook.bootstrapIdentityDb(() => {});
    ok('bootstrap con el flag apagado no hace nada y lo dice', boot === false);
    ok('el bootstrap no crea ni modifica la ruta por defecto',
        snap(identityDb.DEFAULT_DB_PATH) === dbBefore);
    const hook = writeHook.makeIdentityWriteHook({
        usersDb: path.join(probe, 'users.json'), groupsDb: path.join(probe, 'groups.json'),
        accessDb: path.join(probe, 'access.json'), log: () => {},
    });
    hook(path.join(probe, 'users.json'), [{ id: 'x' }]);
    ok('el write hook con dual-write apagado no abre conexión ni escribe',
        snap(identityDb.DEFAULT_DB_PATH) === dbBefore && fs.readdirSync(probe).length === before.length);
    ok('la facade de lectura devuelve null (cae a JSON)',
        readFacade.tryIdentitySqliteRead('/tmp/nope-users.json',
            { usersDb: '/tmp/nope-users.json', groupsDb: '', accessDb: '' }) === null);
    ok('el warmup con el flag apagado no calienta nada', await readFacade.warmupReadFacade() === false);
    fs.rmSync(probe, { recursive: true, force: true });

    console.log('\n[10] aislamiento de stores');
    ok('todo el trabajo ocurrió bajo el directorio temporal',
        fs.readdirSync(tmpdir).every(f => f.endsWith('.db') || f.endsWith('-wal') || f.endsWith('-shm')));
} catch (e) {
    console.error('  ✗ excepción no esperada:', e.stack || e.message);
    fail++;
} finally {
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
