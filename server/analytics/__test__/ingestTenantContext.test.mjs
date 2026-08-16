/**
 * ingestTenantContext.test.mjs — CHP-STATS-INGEST-01B.
 * Ingestión canónica con contexto institucional VERIFICADO + adapter
 * verifiedContext. Persiste contra una events.db TEMPORAL ya MIGRADA (columnas
 * institution_id/group_id). Sin stores productivos.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ingestCanonicalEvent, normalizeForIngest, INGEST_OUTCOME, INGEST_ERROR } from '../canonicalIngest.mjs';
import { migrateEventsTenantColumns } from '../eventsTenantMigration.mjs';
import { verifiedContextFromAuth, hasVerifiedInstitution } from '../verifiedContext.mjs';

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.error('  ✗', n, '\n    ', e && e.message); fail++; } };

const OLD_SCHEMA = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, schema_version INTEGER NOT NULL,
  event TEXT NOT NULL, mode TEXT NOT NULL, user_id TEXT NOT NULL, content_id TEXT, session_id TEXT NOT NULL,
  client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL, elapsed_ms INTEGER, progress_fraction REAL,
  payload_json TEXT, created_at INTEGER NOT NULL);`;

// events.db temporal migrada + deps tenant-aware (persist con columnas de contexto).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_tenant_'));
const db = new Database(path.join(dir, 'events.db'));
db.pragma('journal_mode = WAL');
db.exec(OLD_SCHEMA);
migrateEventsTenantColumns(db);
const stmtInsert = db.prepare(`INSERT OR IGNORE INTO events
  (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts,
   elapsed_ms, progress_fraction, payload_json, created_at, institution_id, group_id)
  VALUES (@event_id,@schema_version,@event,@mode,@user_id,@content_id,@session_id,@client_ts,@server_ts,
   @elapsed_ms,@progress_fraction,@payload_json,@created_at,@institution_id,@group_id)`);
const stmtGet = db.prepare('SELECT * FROM events WHERE event_id = ?');
let uc = 0;
const ULID = () => ('T' + String(uc++).padStart(25, '0')).slice(0, 26).toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, '0');
const deps = {
    now: () => 1_700_000_100_000,
    persist: (f) => {
        const r = stmtInsert.run({
            event_id: f.event_id, schema_version: f.schema_version, event: f.event, mode: f.mode,
            user_id: f.user_id, content_id: f.content_id ?? null, session_id: f.session_id,
            client_ts: f.client_ts, server_ts: Date.now(), elapsed_ms: f.elapsed_ms ?? null,
            progress_fraction: f.progress_fraction ?? null,
            payload_json: f.payload ? JSON.stringify(f.payload) : null, created_at: Date.now(),
            institution_id: f.institution_id ?? null, group_id: f.group_id ?? null,
        });
        return { inserted: r.changes > 0 };
    },
    lookup: (id) => stmtGet.get(id) ?? null,
};
const rawEvt = (over = {}) => ({
    eventId: ULID(), schemaVersion: 1, event: 'text.progress', mode: 'text', userId: 'user-real-1',
    contentId: 'c1', sessionId: 'S1', clientTs: 1_700_000_000_000, payload: { sentenceCount: 10 }, ...over,
});
const ctxPersonal = { authenticatedUserId: 'user-real-1', provenance: 'web' };
const ctxInstitution = { authenticatedUserId: 'user-real-1', institutionId: 'Colegio-Villas', provenance: 'web' };
const ctxGroup = { authenticatedUserId: 'user-real-1', institutionId: 'Colegio-Villas', groupId: 'Primero-A', provenance: 'web' };

console.log('ingestTenantContext — CHP-STATS-INGEST-01B');

// 4. personal event persists tenant NULL
T('4. hecho personal → persiste con institution_id/group_id NULL', () => {
    const e = rawEvt();
    assert.strictEqual(ingestCanonicalEvent(e, ctxPersonal, deps).outcome, INGEST_OUTCOME.ACCEPTED);
    const row = stmtGet.get(e.eventId);
    assert.strictEqual(row.institution_id, null);
    assert.strictEqual(row.group_id, null);
    assert.strictEqual(row.user_id, 'user-real-1');
});

// 5. verified institution persists
T('5. institución verificada → persiste institution_id', () => {
    const e = rawEvt();
    assert.strictEqual(ingestCanonicalEvent(e, ctxInstitution, deps).outcome, INGEST_OUTCOME.ACCEPTED);
    const row = stmtGet.get(e.eventId);
    assert.strictEqual(row.institution_id, 'Colegio-Villas');
    assert.strictEqual(row.group_id, null);
});

// 6. verified group persists
T('6. grupo verificado → persiste institution_id + group_id', () => {
    const e = rawEvt();
    assert.strictEqual(ingestCanonicalEvent(e, ctxGroup, deps).outcome, INGEST_OUTCOME.ACCEPTED);
    const row = stmtGet.get(e.eventId);
    assert.strictEqual(row.institution_id, 'Colegio-Villas');
    assert.strictEqual(row.group_id, 'Primero-A');
});

// 7. spoofed institution rejected
T('7. institución autoafirmada (body) sin verificar → TENANT_MISMATCH (403)', () => {
    const r = ingestCanonicalEvent(rawEvt({ institutionId: 'Colegio-Hackeado' }), ctxPersonal, deps);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.error, INGEST_ERROR.TENANT_MISMATCH);
});
T('7b. institución body != verificada → TENANT_MISMATCH', () => {
    const r = ingestCanonicalEvent(rawEvt({ institutionId: 'Otro' }), ctxInstitution, deps);
    assert.strictEqual(r.error, INGEST_ERROR.TENANT_MISMATCH);
});

// 8. spoofed group rejected
T('8. grupo autoafirmado != verificado → TENANT_MISMATCH', () => {
    const r = ingestCanonicalEvent(rawEvt({ groupId: 'Grupo-Hackeado' }), ctxInstitution, deps);
    assert.strictEqual(r.error, INGEST_ERROR.TENANT_MISMATCH);
});

// 9. missing optional tenant allowed (body coincide con verificado ⇒ OK)
T('9. tenant opcional ausente en body pero verificado → persiste verificado', () => {
    const e = rawEvt(); // sin institutionId en el body
    assert.strictEqual(ingestCanonicalEvent(e, ctxGroup, deps).outcome, INGEST_OUTCOME.ACCEPTED);
    assert.strictEqual(stmtGet.get(e.eventId).institution_id, 'Colegio-Villas');
});
T('9b. body afirma exactamente el tenant verificado → OK', () => {
    const e = rawEvt({ institutionId: 'Colegio-Villas', groupId: 'Primero-A' });
    assert.strictEqual(ingestCanonicalEvent(e, ctxGroup, deps).outcome, INGEST_OUTCOME.ACCEPTED);
});

// 10. actor remains auth-authoritative (aunque el body traiga otro)
T('10. actor = auth incluso con contexto institucional', () => {
    const e = rawEvt({ userId: 'user-real-1' });
    const n = normalizeForIngest(e, ctxInstitution, 1_700_000_100_000);
    assert.strictEqual(n.fact.user_id, 'user-real-1');
    // spoof de actor sigue rechazado
    assert.strictEqual(normalizeForIngest(rawEvt({ userId: 'ADMIN' }), ctxInstitution, 1_700_000_100_000).error, INGEST_ERROR.ACTOR_MISMATCH);
});

// 11. no x-user-id dependency (comportamiento: headers no dan identidad ni tenant)
T('11. sin dependencia de x-user-id/body: headers no aportan identidad ni tenant', () => {
    // El adapter ignora headers por completo (solo req.auth).
    assert.strictEqual(verifiedContextFromAuth({ headers: { 'x-user-id': 'spoof', 'x-institution': 'X' } }).ok, false);
    // El normalizer no recibe req/headers: la identidad es verifiedContext.
    assert.strictEqual(ingestCanonicalEvent.length, 3, 'firma (raw, verifiedContext, deps) — sin req');
    // Un x-user-id autoafirmado en el sobre se RECHAZA (no puede colarse).
    const n = normalizeForIngest(rawEvt({ 'x-user-id': 'ADMIN' }), ctxPersonal, 1_700_000_100_000);
    assert.strictEqual(n.error, INGEST_ERROR.FORBIDDEN_FIELD);
    // Body limpio: el actor es el autenticado, el tenant NULL (personal).
    const clean = normalizeForIngest(rawEvt(), ctxPersonal, 1_700_000_100_000);
    assert.ok(clean.ok && clean.fact.user_id === 'user-real-1' && clean.fact.institution_id === null);
});

// 12. duplicate event keeps original context
T('12. duplicado del mismo hecho → conserva el contexto original', () => {
    const e = rawEvt();
    assert.strictEqual(ingestCanonicalEvent(e, ctxGroup, deps).outcome, INGEST_OUTCOME.ACCEPTED);
    const r2 = ingestCanonicalEvent(e, ctxGroup, deps);
    assert.strictEqual(r2.outcome, INGEST_OUTCOME.DUPLICATE);
    const row = stmtGet.get(e.eventId);
    assert.strictEqual(row.institution_id, 'Colegio-Villas');
    assert.strictEqual(row.group_id, 'Primero-A');
});

// 13. conflict cannot overwrite context
T('13. conflicto (mismo eventId, hecho distinto) NO sobrescribe el contexto', () => {
    const id = ULID();
    // hecho original con contexto de grupo
    assert.strictEqual(ingestCanonicalEvent(rawEvt({ eventId: id, contentId: 'ORIG' }), ctxGroup, deps).outcome, INGEST_OUTCOME.ACCEPTED);
    // intento con MISMO eventId, hecho distinto y OTRO contexto verificado
    const r = ingestCanonicalEvent(rawEvt({ eventId: id, contentId: 'HACK' }), ctxInstitution, deps);
    assert.strictEqual(r.outcome, INGEST_OUTCOME.CONFLICT);
    const row = stmtGet.get(id);
    assert.strictEqual(row.content_id, 'ORIG', 'hecho intacto');
    assert.strictEqual(row.group_id, 'Primero-A', 'contexto original intacto');
});

// ── Adapter verifiedContextFromAuth ─────────────────────────────────────────
T('adapter: req.auth personal → actor solo (sin tenant)', () => {
    const r = verifiedContextFromAuth({ auth: { userId: 'u9' } });
    assert.ok(r.ok);
    assert.strictEqual(r.context.authenticatedUserId, 'u9');
    assert.strictEqual(r.context.institutionId, undefined);
    assert.strictEqual(hasVerifiedInstitution(r.context), false);
});
T('adapter: req.auth con institución/grupo verificados (M1-B futuro)', () => {
    const r = verifiedContextFromAuth({ auth: { userId: 'u9', institutionId: 'Inst', groupId: 'G1' } });
    assert.strictEqual(r.context.institutionId, 'Inst');
    assert.strictEqual(r.context.groupId, 'G1');
    assert.ok(hasVerifiedInstitution(r.context));
});
T('adapter: sin req.auth → no hay contexto (sin fallback a x-user-id/body)', () => {
    assert.strictEqual(verifiedContextFromAuth({}).ok, false);
    assert.strictEqual(verifiedContextFromAuth({ headers: { 'x-user-id': 'spoof' } }).ok, false);
});
T('adapter→ingest end-to-end personal', () => {
    const vc = verifiedContextFromAuth({ auth: { userId: 'user-real-1' } }).context;
    assert.strictEqual(ingestCanonicalEvent(rawEvt(), vc, deps).outcome, INGEST_OUTCOME.ACCEPTED);
});

db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
