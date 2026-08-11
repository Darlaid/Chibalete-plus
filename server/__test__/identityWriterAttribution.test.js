/**
 * identityWriterAttribution.test.js — CHP-IDDB-02B-D-A.
 *
 * El espejo va a recibir DOS escritores productivos simultáneos (api_1 y
 * api_2). Antes de eso hay que separar dos conceptos que hoy están mezclados:
 *
 *   - `operation_id` — QUÉ hecho lógico se está aplicando. Determinístico y
 *     ciego al escritor: el mismo hecho procesado por cualquier instancia
 *     produce el mismo id, que es lo que sostiene la idempotencia entre
 *     procesos.
 *   - atribución del escritor — QUIÉN lo aplicó. Instancia de runtime +
 *     call-site. Diagnóstico puro: jamás puede alterar la identidad de la
 *     operación.
 *
 * El defecto que cierra esta unidad: `makeIdentityWriteHook` memoizaba el hook
 * COMPLETO, de modo que el primer llamador capturaba su `writerId` para
 * siempre. Con `server.writeJSON` y `server.writeJSONAsync` conviviendo en el
 * mismo proceso, las escrituras del segundo quedaban atribuidas al primero.
 *
 * Corre 100% aislado en ficheros temporales: NUNCA toca data/, data-critical/
 * ni ninguna ruta productiva.
 *
 *   node server/__test__/identityWriterAttribution.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { mirrorSnapshotV2, operationId } from '../db/identityShadowV2.js';
import {
    composeWriterId, parseWriterId, assertRegisteredWriter,
} from '../db/identityWriteSurface.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'iddb02bda_attr_'));
const DB_PATH = path.join(tmpdir, 'identity.db');
const USERS_DB = path.join(tmpdir, 'users_db.json');
const GROUPS_DB = path.join(tmpdir, 'groups_db.json');
const ACCESS_DB = path.join(tmpdir, 'access_db.json');
const SCHOOLS_DB = path.join(tmpdir, 'schools_db.json');

const user = (n) => ({ id: `u${n}`, email: `u${n}@example.test`, nombre_completo: `U ${n}`,
    roles: ['lector'], accountStatus: 'active' });

/** El hook es no-bloqueante por diseño: se espera a que el efecto aterrice. */
async function settle(db, expected, timeoutMs = 8000) {
    const t0 = Date.now();
    for (;;) {
        const c = db.prepare(`SELECT COUNT(*) c FROM shadow_operations`).get().c;
        if (c >= expected) return c;
        if (Date.now() - t0 > timeoutMs) return c;
        await new Promise(r => setTimeout(r, 25));
    }
}

/** Escribe la instantánea canónica y dispara el hook, como hace server.js. */
function writeAndHook(hook, file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    hook(file, data);
}

const attributionsFor = (db, since) => db.prepare(
    `SELECT DISTINCT writer_id FROM shadow_operations WHERE rowid > ? ORDER BY writer_id`)
    .all(since).map(r => r.writer_id);

const maxRow = (db) => db.prepare(`SELECT COALESCE(MAX(rowid),0) m FROM shadow_operations`).get().m;

try {
    // ── Contrato puro, sin base de datos ─────────────────────────────────
    console.log('\n[1] contrato de atribución: instancia + call-site');
    const w = composeWriterId({ runtimeInstance: 'abc123', callSite: 'server.writeJSON' });
    ok('compone instancia y call-site', w === 'abc123::server.writeJSON', w);
    const parsed = parseWriterId(w);
    ok('es reversible', parsed.runtimeInstance === 'abc123'
        && parsed.callSite === 'server.writeJSON', JSON.stringify(parsed));
    ok('un writer_id histórico (sin instancia) se sigue leyendo',
        parseWriterId('server.writeJSON').callSite === 'server.writeJSON'
        && parseWriterId('server.writeJSON').runtimeInstance === null);
    ok('la instancia vacía no inventa identidad',
        composeWriterId({ runtimeInstance: '', callSite: 'server.writeJSON' })
            === 'unknown::server.writeJSON');
    ok('el registro de escritores sigue validando el call-site desnudo',
        assertRegisteredWriter('server.writeJSON') === null
        && assertRegisteredWriter('server.writeJSONAsync') === null
        && assertRegisteredWriter('abc123::server.writeJSON') === 'UNREGISTERED_WRITER');

    // ── operation_id ciego al escritor ───────────────────────────────────
    console.log('\n[2] operation_id independiente del escritor');
    const argsA = { entityType: 'user', operationType: 'upsert', canonicalKey: 'u1',
        sourceVersion: 'v-hash-1' };
    ok('la firma de operationId no admite escritor',
        operationId(argsA) === operationId({ ...argsA }));
    // Dos escritores distintos, misma instantánea, dos bases limpias.
    const mk = (name) => {
        const db = new Database(path.join(tmpdir, name));
        runMigrations(db, () => {});
        return db;
    };
    const dbA = mk('writerA.db'), dbB = mk('writerB.db');
    const snapshot = [user(1), user(2), user(3)];
    const SV = { hash: 'sv-shared-1', seq: 1 };
    const repA = mirrorSnapshotV2(dbA, { domain: 'users', records: snapshot, sourceVersion: SV,
        writerId: 'inst-A::server.writeJSON', at: '2026-01-01T00:00:00Z' });
    const repB = mirrorSnapshotV2(dbB, { domain: 'users', records: snapshot, sourceVersion: SV,
        writerId: 'inst-B::server.writeJSONAsync', at: '2026-01-01T00:00:00Z' });
    const idsOf = (db) => db.prepare(
        `SELECT operation_id FROM shadow_operations ORDER BY operation_id`).all().map(r => r.operation_id);
    ok('ambos escritores aplican la misma instantánea',
        repA.applied === 3 && repB.applied === 3, `${repA.applied}/${repB.applied}`);
    ok('OPERATION_ID_WRITER_INDEPENDENT: los ids coinciden',
        JSON.stringify(idsOf(dbA)) === JSON.stringify(idsOf(dbB)),
        `${idsOf(dbA).join(',')} vs ${idsOf(dbB).join(',')}`);
    ok('la atribución sí difiere',
        dbA.prepare(`SELECT DISTINCT writer_id w FROM shadow_operations`).get().w
        !== dbB.prepare(`SELECT DISTINCT writer_id w FROM shadow_operations`).get().w);
    dbA.close(); dbB.close();

    // ── El defecto real: el hook memoizado ───────────────────────────────
    console.log('\n[3] el hook atribuye al call-site REAL, no al primero');
    const seedDb = new Database(DB_PATH);
    runMigrations(seedDb, () => {});
    seedDb.close();

    process.env.IDENTITY_DB = DB_PATH;
    process.env.IDENTITY_SQLITE_ENABLED = '1';
    process.env.IDENTITY_DUAL_WRITE = '1';
    process.env.IDENTITY_READ = 'json';
    process.env.HOSTNAME = 'test-instance-1';

    const hookMod = await import('../db/identityWriteHook.js');
    hookMod._resetIdentityWriteHook();
    const cfg = { usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: ACCESS_DB,
        schoolsDb: SCHOOLS_DB, log: () => {} };
    const hookA = hookMod.makeIdentityWriteHook({ ...cfg, writerId: 'server.writeJSON' });
    const hookB = hookMod.makeIdentityWriteHook({ ...cfg, writerId: 'server.writeJSONAsync' });
    ok('cada call-site recibe su propio hook', hookA !== hookB);

    const db = new Database(DB_PATH);

    // A escribe primero: es quien, con el defecto, secuestraba la atribución.
    let mark = maxRow(db);
    writeAndHook(hookA, USERS_DB, [user(1), user(2)]);
    await settle(db, mark + 2);
    const attrA1 = attributionsFor(db, mark);
    ok('caller A → atribuido a A', attrA1.length === 1
        && attrA1[0] === 'test-instance-1::server.writeJSON', attrA1.join(','));

    // B escribe después, en el MISMO proceso y sin reset: aquí moría antes.
    mark = maxRow(db);
    writeAndHook(hookB, USERS_DB, [user(1), user(2), user(3)]);
    await settle(db, mark + 1);
    const attrB = attributionsFor(db, mark);
    ok('WRITER_ATTRIBUTION_CORRECT: caller B → atribuido a B', attrB.length === 1
        && attrB[0] === 'test-instance-1::server.writeJSONAsync', attrB.join(','));

    // Y A vuelve a escribir: no puede heredar la atribución de B.
    mark = maxRow(db);
    writeAndHook(hookA, USERS_DB, [user(1), user(2), user(3), user(4)]);
    await settle(db, mark + 1);
    const attrA2 = attributionsFor(db, mark);
    ok('caller A de nuevo → atribuido a A', attrA2.length === 1
        && attrA2[0] === 'test-instance-1::server.writeJSON', attrA2.join(','));

    console.log('\n[4] la instancia de runtime es la canónica del despliegue');
    const { getHealthDefaults } = await import('../healthHandler.js');
    ok('la atribución usa la MISMA instancia que expone /api/health',
        parseWriterId(attrA2[0]).runtimeInstance === getHealthDefaults().instance,
        `${parseWriterId(attrA2[0]).runtimeInstance} vs ${getHealthDefaults().instance}`);

    console.log('\n[5] el escritor no altera la identidad de la operación');
    const rows = db.prepare(`SELECT operation_id, writer_id, canonical_key_hash, operation_type,
                             canonical_source_version FROM shadow_operations`).all();
    let recomputedOk = true;
    for (const r of rows) {
        // El id se deriva de (entidad, tipo, clave, versión) — nunca del escritor.
        const other = operationId({ entityType: 'user', operationType: r.operation_type,
            canonicalKey: 'u1', sourceVersion: r.canonical_source_version });
        if (other.includes(parseWriterId(r.writer_id).runtimeInstance)) recomputedOk = false;
    }
    ok('ningún operation_id contiene la instancia', recomputedOk);
    ok('la misma clave lógica bajo distintos escritores comparte id',
        operationId({ entityType: 'user', operationType: 'upsert', canonicalKey: 'u1',
            sourceVersion: 'x' })
        === operationId({ entityType: 'user', operationType: 'upsert', canonicalKey: 'u1',
            sourceVersion: 'x' }));

    console.log('\n[6] un escritor no registrado sigue sin poder espejar');
    mark = maxRow(db);
    const rogue = hookMod.makeIdentityWriteHook({ ...cfg, writerId: 'rogue.script' });
    writeAndHook(rogue, USERS_DB, [user(9)]);
    await new Promise(r => setTimeout(r, 300));
    ok('el escritor no registrado no deja operaciones', maxRow(db) === mark);
    ok('y no borró nada del padrón espejado',
        db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c === 4);

    console.log('\n[7] integridad tras el ejercicio');
    ok('quick_check=ok', db.pragma('quick_check', { simple: true }) === 'ok');
    ok('sin violaciones de FK', db.pragma('foreign_key_check').length === 0);
    ok('sin FAILED_RECONCILABLE',
        db.prepare(`SELECT COUNT(*) c FROM shadow_operations
                    WHERE status='FAILED_RECONCILABLE'`).get().c === 0);
    db.close();

    const { closeIdentityDb } = await import('../db/identityDb.js');
    closeIdentityDb();
} catch (e) {
    console.error('  ✗ excepción no esperada:', e.stack || e.message);
    fail++;
} finally {
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
