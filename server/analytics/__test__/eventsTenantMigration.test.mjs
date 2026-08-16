/**
 * eventsTenantMigration.test.mjs — CHP-STATS-INGEST-01B.
 * Migración aditiva/idempotente de events.db (columnas de contexto). Usa una
 * events.db TEMPORAL con el schema ANTIGUO; no toca stores productivos.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateEventsTenantColumns, eventsTenantColumnsPresent, TENANT_COLUMNS } from '../eventsTenantMigration.mjs';

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.error('  ✗', n, '\n    ', e && e.message); fail++; } };

// Schema ANTIGUO de events (sin columnas de contexto) — réplica de eventsService.
const OLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  schema_version INTEGER NOT NULL,
  event TEXT NOT NULL,
  mode TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content_id TEXT,
  session_id TEXT NOT NULL,
  client_ts INTEGER NOT NULL,
  server_ts INTEGER NOT NULL,
  elapsed_ms INTEGER,
  progress_fraction REAL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);`;

function freshOldDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_mig_'));
    const p = path.join(dir, 'events.db');
    const db = new Database(p);
    db.pragma('journal_mode = WAL');
    db.exec(OLD_SCHEMA);
    return { db, dir, p };
}
const seed = (db, id, extra = {}) => db.prepare(`INSERT INTO events
  (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
  VALUES (@event_id,1,'text.progress','text',@user_id,'c1','S1',1700000000000,1700000000500,15000,0.4,@payload_json,1700000000500)`)
  .run({ event_id: id, user_id: extra.user_id ?? 'u1', payload_json: extra.payload_json ?? '{"sentenceCount":10}' });

console.log('eventsTenantMigration — CHP-STATS-INGEST-01B');

// 1. old schema migrates safely (columnas nuevas presentes)
T('1. schema antiguo migra: columnas de contexto añadidas', () => {
    const { db, dir } = freshOldDb();
    try {
        assert.strictEqual(eventsTenantColumnsPresent(db), false, 'antes: sin columnas');
        const r = migrateEventsTenantColumns(db);
        assert.deepStrictEqual(r.applied.sort(), TENANT_COLUMNS.map(c => c.name).sort());
        assert.strictEqual(eventsTenantColumnsPresent(db), true, 'después: presentes');
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// 2. migration twice is idempotent
T('2. segunda corrida = no-op idempotente', () => {
    const { db, dir } = freshOldDb();
    try {
        migrateEventsTenantColumns(db);
        const r2 = migrateEventsTenantColumns(db);
        assert.strictEqual(r2.alreadyMigrated, true);
        assert.deepStrictEqual(r2.applied, []);
        assert.deepStrictEqual(r2.skipped.sort(), TENANT_COLUMNS.map(c => c.name).sort());
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// 3. existing events unchanged (datos intactos + nuevas columnas NULL)
T('3. eventos históricos intactos; contexto queda NULL (sin backfill)', () => {
    const { db, dir } = freshOldDb();
    try {
        seed(db, 'A0000000000000000000000001');
        seed(db, 'A0000000000000000000000002', { user_id: 'u2' });
        const before = db.prepare('SELECT event_id,user_id,payload_json,client_ts FROM events ORDER BY event_id').all();
        migrateEventsTenantColumns(db);
        const after = db.prepare('SELECT event_id,user_id,payload_json,client_ts,institution_id,group_id FROM events ORDER BY event_id').all();
        assert.strictEqual(after.length, 2, 'mismo nº de filas');
        for (let i = 0; i < before.length; i++) {
            assert.strictEqual(after[i].event_id, before[i].event_id);
            assert.strictEqual(after[i].user_id, before[i].user_id);
            assert.strictEqual(after[i].payload_json, before[i].payload_json);
            assert.strictEqual(after[i].client_ts, before[i].client_ts);
            assert.strictEqual(after[i].institution_id, null, 'institution_id NULL');
            assert.strictEqual(after[i].group_id, null, 'group_id NULL');
        }
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// migración exige la tabla base
T('extra: sin tabla events → error explícito (no fabrica schema base)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_mig_'));
    const db = new Database(path.join(dir, 'e.db'));
    try {
        assert.throws(() => migrateEventsTenantColumns(db), /tabla events ausente/);
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// solo ALTER ADD COLUMN (aditivo) — sin DROP/DELETE en el módulo
T('extra: el módulo es aditivo (sin DROP/DELETE)', () => {
    const src = migrateEventsTenantColumns.toString();
    assert.ok(!/DROP|DELETE|TRUNCATE/i.test(src), 'sin DROP/DELETE/TRUNCATE');
    assert.ok(/ADD COLUMN/i.test(src), 'usa ADD COLUMN');
});

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
