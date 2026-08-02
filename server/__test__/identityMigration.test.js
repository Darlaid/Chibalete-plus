/**
 * identityMigration.test.js — P1-A migration + dual-write consistency tests.
 *
 * Corre 100% aislado en un identity.db TEMPORAL (NUNCA toca prod ni data/).
 * Ejercita el código real (migrate.js / identityShadow.js / identityRepo.js)
 * con shapes idénticos a los JSON reales (users:array, groups:{name,school,
 * grade,teacherId,studentIds}, access:{id,scope,scopeId,titleIds,...}).
 *
 *   node server/__test__/identityMigration.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations, rollbackLast } from '../db/migrate.js';
import { mirrorUsers, mirrorGroups, mirrorAccess } from '../db/identityShadow.js';
import { makeIdentityRepo } from '../repositories/identityRepo.js';

let pass = 0, fail = 0;
const ok = (l, c, h='') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmp = path.join(os.tmpdir(), `identity_test_${Date.now()}.db`);
const db = new Database(tmp);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

try {
    console.log('\n[1] migraciones idempotentes + versionadas');
    // CHP-IDDB-02A: esta suite valida el CONTRATO v1 (users por id JSON,
    // group_members student/teacher, espejo shadow). Desde que existe
    // 0002_identity_v2 una base nueva migraría a v2, donde ese contrato ya no
    // aplica, así que se ancla explícitamente en 0001. El contrato v2 tiene su
    // propia suite en server/__test__/identitySchemaV2.test.js.
    const V1 = { until: '0001_identity' };
    const r1 = runMigrations(db, () => {}, V1);
    ok('aplica 0001_identity', r1.applied.includes('0001_identity'), JSON.stringify(r1));
    const r2 = runMigrations(db, () => {}, V1);
    ok('reaplicar = no-op (idempotente)', r2.applied.length === 0 && r2.already.includes('0001_identity'));
    ok('tablas creadas', ['users','groups','group_members','access_rules','shadow_audit']
        .every(t => db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t)));

    console.log('\n[2] dual-write shadow — shapes reales');
    const users = [
        { id: 'u1', email: ' Ana@Mail.COM ', password: '$2x', roles: ['lector'], nombre_completo: 'Ana', accountStatus: 'active' },
        { id: 'u2', email: 'prof@x.cl', password: '$2y', roles: ['mediador','teacher'], accountStatus: 'active' },
        { id: 'u3', email: 'admin@x.cl', roles: ['administrador'] },
    ];
    const groups = [
        { name: 'Primero A', school: 'Esc1', grade: '1', teacherId: 'u2', studentIds: ['u1','u3'] },
        { name: 'Club Poe',  school: 'Esc1', grade: null, teacherId: 'u2', studentIds: ['u1'] },
    ];
    const access = [
        { id: 'a1', scope: 'group', scopeId: 'Primero A', titleIds: ['t1'], collectionIds: [], expiresAt: null },
    ];
    ok('mirrorUsers ok',  mirrorUsers(db, users) === true);
    ok('mirrorGroups ok', mirrorGroups(db, groups) === true);
    ok('mirrorAccess ok', mirrorAccess(db, access) === true);

    const repo = makeIdentityRepo(db);
    console.log('\n[3] lossless round-trip + normalización');
    ok('users count == 3', repo.users.all().length === 3);
    ok('email normalizado (lookup case/space-insensitive)',
       repo.users.byEmail('ana@mail.com')?.id === 'u1');
    ok('round-trip lossless (raw_json idéntico al original)',
       JSON.stringify(repo.users.byId('u2')) === JSON.stringify(users[1]));
    ok('memberships normalizadas: u1 en 2 grupos como student',
       repo.groups.membershipsOfUser('u1').filter(m => m.role==='student').length === 2);
    ok('teacher normalizado: u2 teacher en 2 grupos',
       repo.groups.membershipsOfUser('u2').filter(m => m.role==='teacher').length === 2);
    ok('access by scope', repo.access.byScope('group','Primero A').length === 1);

    console.log('\n[4] re-sync = sin drift (delete + update reflejado)');
    const users2 = [ { ...users[0], nombre_completo: 'Ana María' } ]; // u2,u3 borrados; u1 editado
    mirrorUsers(db, users2);
    ok('tras re-sync solo 1 user activo', repo.users.all().length === 1);
    ok('update reflejado', repo.users.byId('u1')?.nombre_completo === 'Ana María');
    ok('u2 ya no visible (soft-delete)', repo.users.byId('u2') === null);

    console.log('\n[5] consistency audit + idempotencia de mirror');
    mirrorUsers(db, users2); mirrorUsers(db, users2);
    ok('idempotente: sigue 1 user', repo.users.all().length === 1);
    const rep = repo.consistencyReport();
    ok('shadow_audit registró y todos ok=1', rep.length > 0 && rep.every(r => r.ok === 1),
       JSON.stringify(rep.slice(0,3)));

    console.log('\n[6] rollback reversible');
    const rb = rollbackLast(db);
    ok('rollback 0001', rb === '0001_identity');
    ok('tabla users eliminada por DOWN',
       !db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`).get());
} finally {
    db.close();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.existsSync(f) && fs.unlinkSync(f); } catch {} }
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
