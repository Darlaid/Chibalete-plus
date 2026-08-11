/**
 * identityShadowReplayTerminal.test.mjs — CHP-IDDB-02B-D-A-R2.
 *
 * Regresión del defecto que el canary de 02B-D-A destapó sobre datos reales:
 * volver a espejar el mismo padrón dejaba 227 membresías YA aplicadas marcadas
 * como `PENDING` con `applied_at` a NULL, mientras la reconciliación decía
 * MATCH. Bookkeeping mintiendo sobre un dominio correcto.
 *
 * La causa: `recordOp()` degradaba la fila existente a PENDING ANTES de saber
 * qué se iba a hacer con ella. Las ramas de upsert de usuarios/grupos volvían a
 * fijar el estado después, pero las de MEMBRESÍA y DESACTIVACIÓN hacen
 * `continue`, así que la degradación quedaba confirmada en el COMMIT.
 *
 * Contrato que fija este test:
 *
 *   [1] replay de upsert        (user / institution / group)  → nunca PENDING
 *   [2] replay de membresía     → nunca PENDING, applied_at intacto
 *   [3] replay de desactivación → nunca PENDING, applied_at intacto
 *   [4] estado terminal (APPLIED y NOOP_ALREADY_APPLIED) no regresa
 *   [5] operation_id estable e independiente del escritor
 *   [6] attempt_count cuenta exactamente un intento por pasada
 *   [7] PENDING genuino preexistente SIGUE recuperándose (no se congela)
 *   [8] FAILED_RECONCILABLE SIGUE recuperándose
 *   [9] invariante global: ninguna pasada confirmada deja filas en PENDING
 *
 * Corre 100% aislado en ficheros temporales: NUNCA toca data/, data-critical/
 * ni ninguna ruta productiva.
 *
 *   node server/__test__/identityShadowReplayTerminal.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { mirrorSnapshotV2, operationId } from '../db/identityShadowV2.js';
import { composeWriterId } from '../db/identityWriteSurface.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02bdar2_replay_'));

const WRITER_A = composeWriterId({ runtimeInstance: 'inst-A', callSite: 'server.writeJSON' });
const WRITER_B = composeWriterId({ runtimeInstance: 'inst-B', callSite: 'server.writeJSONAsync' });

const INSTITUTIONS = [{ id: 'org_1', name: 'Institucion Uno' }];
const mkUsers = (n) => Array.from({ length: n }, (_, i) => ({
    id: `usr_${String(i + 1).padStart(4, '0')}`,
    email: `lector${i + 1}@colegio.test`,
    nombre_completo: `Lector ${i + 1}`,
    roles: [i === 0 ? 'mediador' : 'lector'],
    accountStatus: 'active',
}));

function freshDb(name) {
    const p = path.join(tmpdir, name);
    const db = new Database(p);
    db.pragma('journal_mode = WAL');
    runMigrations(db, () => {});
    db.close();
    return new Database(p);
}

/** Filas en vuelo. El invariante del espejo es que esto sea SIEMPRE cero. */
const pendingRows = (db) => db.prepare(
    `SELECT entity_type, operation_type, COUNT(*) c FROM shadow_operations
     WHERE status='PENDING' GROUP BY 1,2 ORDER BY 1,2`).all();
const pendingCount = (db) => db.prepare(
    `SELECT COUNT(*) c FROM shadow_operations WHERE status='PENDING'`).get().c;
const opRow = (db, id) => db.prepare(
    `SELECT * FROM shadow_operations WHERE operation_id=?`).get(id);
const countBy = (db, sql) => db.prepare(sql).get().c;

/**
 * La clave canónica de una membresía es su `membership_id` derivado, no una
 * cadena que el test pueda inventar: se lee del dominio ya espejado para que
 * la aserción hable del identificador REAL y no de una suposición.
 */
const membershipOpId = (db, { groupId, userId }, sourceVersion) => {
    const row = db.prepare(`SELECT membership_id FROM memberships
                            WHERE group_id=? AND user_id=?`).get(groupId, userId);
    if (!row) throw new Error(`membresía no espejada: ${groupId}/${userId}`);
    return operationId({ entityType: 'membership', operationType: 'upsert',
        canonicalKey: row.membership_id, sourceVersion });
};

const TERMINAL = new Set(['APPLIED', 'NOOP_ALREADY_APPLIED']);

try {
    // ── [1] Replay de upserts: usuario, institución y grupo ───────────────
    console.log('\n[1] replay de upsert — user / institution / group');
    {
        const db = freshDb('upsert.db');
        db.pragma('foreign_keys = ON');
        const users = mkUsers(6);
        const groups = [{ id: 'g1', organizationId: 'org_1', type: 'course', name: 'Primero A',
            studentIds: users.slice(1, 5).map(u => u.id), mediatorIds: [users[0].id] }];
        const mirror = (domain, records, hash, seq, writer = WRITER_A) => mirrorSnapshotV2(db,
            { domain, records, sourceVersion: { hash, seq }, writerId: writer,
                at: '2026-01-01T00:00:00Z' });

        mirror('institutions', INSTITUTIONS, 'sv-i', 1);
        mirror('users', users, 'sv-u', 1);
        mirror('groups', groups, 'sv-g', 1);
        ok('la primera pasada no deja nada en vuelo', pendingCount(db) === 0,
            JSON.stringify(pendingRows(db)));

        // Segunda pasada idéntica: todo debe reconocerse como ya hecho.
        const i2 = mirror('institutions', INSTITUTIONS, 'sv-i', 1);
        const u2 = mirror('users', users, 'sv-u', 1);
        const g2 = mirror('groups', groups, 'sv-g', 1);
        ok('institutions: replay íntegramente idempotente',
            i2.applied === 0 && i2.noop === 1, `${i2.applied}/${i2.noop}`);
        ok('users: replay íntegramente idempotente',
            u2.applied === 0 && u2.noop === 6, `${u2.applied}/${u2.noop}`);
        ok('groups: replay íntegramente idempotente (grupo + 5 membresías)',
            g2.applied === 0 && g2.noop === 6, `${g2.applied}/${g2.noop}`);
        ok('REGRESIÓN: el replay de upserts no deja NADA en PENDING',
            pendingCount(db) === 0, JSON.stringify(pendingRows(db)));
        ok('ninguna fila perdió applied_at',
            countBy(db, `SELECT COUNT(*) c FROM shadow_operations WHERE applied_at IS NULL`) === 0);
        db.close();
    }

    // ── [2] Replay de MEMBRESÍA — el defecto exacto de c4d0a8c ────────────
    console.log('\n[2] replay de MEMBRESÍA — la rama que hacía `continue`');
    {
        const db = freshDb('membership.db');
        db.pragma('foreign_keys = ON');
        const users = mkUsers(30);
        const groups = [{ id: 'g1', organizationId: 'org_1', type: 'course', name: 'Primero A',
            studentIds: users.slice(1).map(u => u.id), mediatorIds: [users[0].id] }];
        const mirror = (d, r, h, s) => mirrorSnapshotV2(db, { domain: d, records: r,
            sourceVersion: { hash: h, seq: s }, writerId: WRITER_A, at: '2026-01-01T00:00:00Z' });
        mirror('institutions', INSTITUTIONS, 'sv-i', 1);
        mirror('users', users, 'sv-u', 1);
        const first = mirror('groups', groups, 'sv-g', 1);

        const memId = membershipOpId(db, { groupId: 'g1', userId: users[5].id }, 'sv-g');
        const before = opRow(db, memId);
        ok('la membresía se registró como operación propia', !!before,
            'no se encontró la operación de membresía');
        ok('y quedó terminal en la primera pasada', before && TERMINAL.has(before.status),
            before && before.status);
        ok('con applied_at no nulo', !!(before && before.applied_at));
        ok('el primer espejo aplica grupo y 30 membresías',
            first.applied === 31, String(first.applied));

        // Replay.
        const second = mirror('groups', groups, 'sv-g', 1);
        const after = opRow(db, memId);
        ok('el replay reconoce las 31 operaciones como no-op',
            second.applied === 0 && second.noop === 31, `${second.applied}/${second.noop}`);
        ok('REGRESIÓN: la membresía NO regresa a PENDING',
            after.status !== 'PENDING', `quedó en ${after.status}`);
        ok('la membresía conserva estado TERMINAL', TERMINAL.has(after.status), after.status);
        ok('REGRESIÓN: applied_at NO se limpia',
            after.applied_at !== null && after.applied_at === before.applied_at,
            `${before.applied_at} → ${after.applied_at}`);
        ok('el operation_id es el mismo', after.operation_id === before.operation_id);
        ok('attempt_count cuenta exactamente las dos pasadas',
            after.attempt_count === 2, String(after.attempt_count));
        ok('REGRESIÓN: cero membresías en vuelo',
            countBy(db, `SELECT COUNT(*) c FROM shadow_operations
                         WHERE entity_type='membership' AND status='PENDING'`) === 0);
        ok('las 30 membresías siguen en el dominio',
            countBy(db, `SELECT COUNT(*) c FROM memberships`) === 30);
        ok('y el espejo entero sigue sin nada en vuelo', pendingCount(db) === 0,
            JSON.stringify(pendingRows(db)));
        db.close();
    }

    // ── [3] Replay de DESACTIVACIÓN — la otra rama que hacía `continue` ───
    console.log('\n[3] replay de DESACTIVACIÓN — la otra rama que hacía `continue`');
    {
        const db = freshDb('deactivate.db');
        db.pragma('foreign_keys = ON');
        const all = mkUsers(6);
        const kept = all.slice(0, 4);
        const gone = all.slice(4);              // usr_0005, usr_0006
        const mirror = (d, r, h, s) => mirrorSnapshotV2(db, { domain: d, records: r,
            sourceVersion: { hash: h, seq: s }, writerId: WRITER_A, at: '2026-01-01T00:00:00Z' });
        mirror('institutions', INSTITUTIONS, 'sv-i', 1);
        mirror('users', all, 'sv-u1', 1);
        const shrink = mirror('users', kept, 'sv-u2', 2);
        ok('la instantánea reducida desactiva exactamente 2 identidades',
            shrink.applied === 4 + 2, `applied=${shrink.applied}`);

        const deacId = operationId({ entityType: 'user', operationType: 'deactivate',
            canonicalKey: gone[0].id, sourceVersion: 'sv-u2' });
        const before = opRow(db, deacId);
        ok('la desactivación se registró como operación propia', !!before);
        ok('y quedó APPLIED', before && before.status === 'APPLIED', before && before.status);
        ok('con applied_at no nulo', !!(before && before.applied_at));
        ok('la identidad quedó lógicamente borrada, no eliminada',
            countBy(db, `SELECT COUNT(*) c FROM users WHERE deleted_at IS NOT NULL`) === 2);

        // Para que la rama de desactivación vuelva a visitar ESA operación, la
        // identidad tiene que estar viva otra vez: una desactivada sale de
        // `live` y no se vuelve a mirar. Se revive con una instantánea completa
        // y se reaplica la MISMA versión reducida (mismo hash → mismo
        // operation_id; seq mayor para que no se descarte por obsoleta).
        mirror('users', all, 'sv-u3', 3);
        ok('la instantánea completa revive a las dos identidades',
            countBy(db, `SELECT COUNT(*) c FROM users WHERE deleted_at IS NOT NULL`) === 0);
        mirror('users', kept, 'sv-u2', 4);
        const after = opRow(db, deacId);
        ok('REGRESIÓN: la desactivación NO regresa a PENDING',
            after.status !== 'PENDING', `quedó en ${after.status}`);
        ok('conserva estado TERMINAL', TERMINAL.has(after.status), after.status);
        ok('REGRESIÓN: applied_at NO se limpia',
            after.applied_at !== null && after.applied_at === before.applied_at,
            `${before.applied_at} → ${after.applied_at}`);
        ok('attempt_count cuenta exactamente las dos pasadas',
            after.attempt_count === 2, String(after.attempt_count));
        ok('el operation_id es el mismo', after.operation_id === before.operation_id);
        ok('REGRESIÓN: cero desactivaciones en vuelo',
            countBy(db, `SELECT COUNT(*) c FROM shadow_operations
                         WHERE operation_type='deactivate' AND status='PENDING'`) === 0);
        ok('y el espejo entero sigue sin nada en vuelo', pendingCount(db) === 0,
            JSON.stringify(pendingRows(db)));
        db.close();
    }

    // ── [4] Estado terminal bajo replay repetido y con OTRO escritor ──────
    console.log('\n[4] el estado terminal aguanta replays sucesivos y otro escritor');
    {
        const db = freshDb('terminal.db');
        db.pragma('foreign_keys = ON');
        const users = mkUsers(10);
        const groups = [{ id: 'g1', organizationId: 'org_1', type: 'club', name: 'Club Poe',
            studentIds: users.slice(1, 6).map(u => u.id), mediatorIds: [users[0].id] }];
        const mirror = (d, r, h, s, w) => mirrorSnapshotV2(db, { domain: d, records: r,
            sourceVersion: { hash: h, seq: s }, writerId: w, at: '2026-01-01T00:00:00Z' });
        mirror('institutions', INSTITUTIONS, 'sv-i', 1, WRITER_A);
        mirror('users', users, 'sv-u', 1, WRITER_A);
        mirror('groups', groups, 'sv-g', 1, WRITER_A);

        const userOp = operationId({ entityType: 'user', operationType: 'upsert',
            canonicalKey: users[3].id, sourceVersion: 'sv-u' });
        const memOp = membershipOpId(db, { groupId: 'g1', userId: users[2].id }, 'sv-g');
        const firstStatuses = [opRow(db, userOp).status, opRow(db, memOp).status];
        const firstWriter = opRow(db, memOp).writer_id;
        const firstAppliedAt = opRow(db, memOp).applied_at;
        ok('las dos operaciones nacen terminales',
            firstStatuses.every(s => TERMINAL.has(s)), firstStatuses.join('/'));

        // Tres replays más, el último desde OTRA instancia/call-site.
        mirror('users', users, 'sv-u', 1, WRITER_A);
        mirror('groups', groups, 'sv-g', 1, WRITER_A);
        mirror('users', users, 'sv-u', 1, WRITER_B);
        mirror('groups', groups, 'sv-g', 1, WRITER_B);

        const u = opRow(db, userOp), m = opRow(db, memOp);
        ok('REGRESIÓN: tras 3 pasadas nada regresó a PENDING', pendingCount(db) === 0,
            JSON.stringify(pendingRows(db)));
        ok('el upsert de usuario sigue terminal', TERMINAL.has(u.status), u.status);
        ok('la membresía sigue terminal', TERMINAL.has(m.status), m.status);
        ok('la membresía conserva su applied_at original',
            m.applied_at === firstAppliedAt, `${firstAppliedAt} → ${m.applied_at}`);
        ok('attempt_count refleja las 3 pasadas',
            u.attempt_count === 3 && m.attempt_count === 3,
            `user=${u.attempt_count} membership=${m.attempt_count}`);
        ok('el operation_id NO depende del escritor',
            memOp === membershipOpId(db, { groupId: 'g1', userId: users[2].id }, 'sv-g'));
        ok('la atribución terminal es la del escritor que la creó',
            m.writer_id === firstWriter && m.writer_id === WRITER_A,
            `${m.writer_id} vs ${firstWriter}`);
        ok('el dominio no se movió',
            countBy(db, `SELECT COUNT(*) c FROM memberships`) === 6
            && countBy(db, `SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`) === 10);
        db.close();
    }

    // ── [5] PENDING genuino preexistente: el fix NO puede congelarlo ──────
    console.log('\n[5] un PENDING genuino preexistente SIGUE recuperándose');
    {
        const db = freshDb('recover-pending.db');
        db.pragma('foreign_keys = ON');
        const users = mkUsers(8);
        const groups = [{ id: 'g1', organizationId: 'org_1', type: 'course', name: 'Primero A',
            studentIds: users.slice(1, 6).map(u => u.id), mediatorIds: [users[0].id] }];
        const mirror = (d, r, h, s) => mirrorSnapshotV2(db, { domain: d, records: r,
            sourceVersion: { hash: h, seq: s }, writerId: WRITER_A, at: '2026-01-01T00:00:00Z' });
        mirror('institutions', INSTITUTIONS, 'sv-i', 1);
        mirror('users', users, 'sv-u', 1);
        mirror('groups', groups, 'sv-g', 1);

        // Simula el estado que dejaba el defecto de c4d0a8c: filas en vuelo.
        const memOp = membershipOpId(db, { groupId: 'g1', userId: users[2].id }, 'sv-g');
        const userOp = operationId({ entityType: 'user', operationType: 'upsert',
            canonicalKey: users[4].id, sourceVersion: 'sv-u' });
        db.prepare(`UPDATE shadow_operations SET status='PENDING', applied_at=NULL
                    WHERE operation_id IN (?,?)`).run(memOp, userOp);
        ok('el escenario de partida tiene 2 operaciones en vuelo', pendingCount(db) === 2);

        // Un replay debe REPARARLAS, no congelarlas.
        mirror('users', users, 'sv-u', 1);
        mirror('groups', groups, 'sv-g', 1);
        const m = opRow(db, memOp), u = opRow(db, userOp);
        ok('la membresía en vuelo se recupera a APPLIED',
            m.status === 'APPLIED', m.status);
        ok('y recupera applied_at', !!m.applied_at);
        ok('el usuario en vuelo se recupera', TERMINAL.has(u.status), u.status);
        ok('el fix NO congela PENDING: queda todo terminal', pendingCount(db) === 0,
            JSON.stringify(pendingRows(db)));
        ok('sin duplicar filas del dominio',
            countBy(db, `SELECT COUNT(*) c FROM memberships`) === 6);
        db.close();
    }

    // ── [6] FAILED_RECONCILABLE: la recuperación tampoco se rompe ─────────
    console.log('\n[6] un FAILED_RECONCILABLE previo SIGUE recuperándose');
    {
        const db = freshDb('recover-failed.db');
        db.pragma('foreign_keys = ON');
        const users = mkUsers(8);
        const groups = [{ id: 'g1', organizationId: 'org_1', type: 'course', name: 'Primero A',
            studentIds: users.slice(1, 6).map(u => u.id), mediatorIds: [users[0].id] }];
        const mirror = (d, r, h, s) => mirrorSnapshotV2(db, { domain: d, records: r,
            sourceVersion: { hash: h, seq: s }, writerId: WRITER_A, at: '2026-01-01T00:00:00Z' });
        mirror('institutions', INSTITUTIONS, 'sv-i', 1);
        mirror('users', users, 'sv-u', 1);
        mirror('groups', groups, 'sv-g', 1);

        const memOp = membershipOpId(db, { groupId: 'g1', userId: users[3].id }, 'sv-g');
        db.prepare(`UPDATE shadow_operations SET status='FAILED_RECONCILABLE', applied_at=NULL,
                    error_classification='MIRROR_WRITE_FAILED' WHERE operation_id=?`).run(memOp);

        mirror('groups', groups, 'sv-g', 1);
        const m = opRow(db, memOp);
        ok('el fallo reconciliable se recupera a APPLIED', m.status === 'APPLIED', m.status);
        ok('y recupera applied_at', !!m.applied_at);
        ok('no quedan fallos reconciliables',
            countBy(db, `SELECT COUNT(*) c FROM shadow_operations
                         WHERE status='FAILED_RECONCILABLE'`) === 0);
        ok('ni nada en vuelo', pendingCount(db) === 0, JSON.stringify(pendingRows(db)));
        db.close();
    }

    // ── [7] Invariante global sobre un padrón con forma de producción ─────
    console.log('\n[7] invariante global: 4 pasadas sobre padrón productivo');
    {
        const db = freshDb('invariant.db');
        db.pragma('foreign_keys = ON');
        const users = mkUsers(247);
        const synthetic = Array.from({ length: 400 }, (_, i) => ({
            id: `load_${String(i + 1).padStart(4, '0')}`, email: `load${i + 1}@loadtest.test`,
            roles: ['lector'], accountStatus: 'active', _loadtest_marker: true,
        }));
        const institutions = Array.from({ length: 4 }, (_, i) => ({
            id: `org_${i + 1}`, name: `Institucion ${i + 1}` }));
        const groups = Array.from({ length: 4 }, (_, i) => ({
            id: `g${i + 1}`, organizationId: `org_${i + 1}`, type: i < 3 ? 'course' : 'club',
            name: `Grupo ${i + 1}`,
            studentIds: users.slice(i * 56 + 1, i * 56 + 57).map(u => u.id),
            mediatorIds: [users[i].id],
        }));
        const mirror = (d, r, h, s, w) => mirrorSnapshotV2(db, { domain: d, records: r,
            sourceVersion: { hash: h, seq: s }, writerId: w, at: '2026-01-01T00:00:00Z' });

        for (let round = 0; round < 4; round++) {
            const w = round % 2 === 0 ? WRITER_A : WRITER_B;
            mirror('institutions', institutions, 'sv-i', 1, w);
            mirror('users', [...users, ...synthetic], 'sv-u', 1, w);
            mirror('groups', groups, 'sv-g', 1, w);
            ok(`ronda ${round + 1}: cero operaciones en vuelo`, pendingCount(db) === 0,
                JSON.stringify(pendingRows(db)));
        }

        ok('247 identidades reales espejadas',
            countBy(db, `SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`) === 247);
        ok('los 400 sintéticos quedaron EXCLUIDOS',
            countBy(db, `SELECT COUNT(*) c FROM users WHERE canonical_id LIKE 'load_%'`) === 0);
        ok('4 instituciones y 4 grupos',
            countBy(db, `SELECT COUNT(*) c FROM institutions`) === 4
            && countBy(db, `SELECT COUNT(*) c FROM groups WHERE deleted_at IS NULL`) === 4);
        ok('cero desactivaciones inesperadas',
            countBy(db, `SELECT COUNT(*) c FROM users WHERE deleted_at IS NOT NULL`) === 0);
        ok('cero fallos reconciliables',
            countBy(db, `SELECT COUNT(*) c FROM shadow_operations
                         WHERE status='FAILED_RECONCILABLE'`) === 0);
        ok('cero filas sin applied_at',
            countBy(db, `SELECT COUNT(*) c FROM shadow_operations WHERE applied_at IS NULL`) === 0);
        ok('attempt_count llegó a 4 en todas las operaciones',
            countBy(db, `SELECT COUNT(*) c FROM shadow_operations WHERE attempt_count <> 4`) === 0,
            JSON.stringify(db.prepare(`SELECT attempt_count a, COUNT(*) c FROM shadow_operations
                                       GROUP BY 1`).all()));
        ok('quick_check=ok y FK=0', db.pragma('quick_check', { simple: true }) === 'ok'
            && db.pragma('foreign_key_check').length === 0);
        db.close();
    }
} catch (e) {
    console.error('  ✗ excepción no esperada:', e.stack || e.message);
    fail++;
} finally {
    // En Windows los ficheros SQLite recién cerrados pueden seguir bloqueados un
    // instante; la limpieza del temporal no es parte del contrato bajo prueba.
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* temporal */ }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
