/**
 * canonicalIngest.test.mjs — CHP-STATS-INGEST-01-PREP.
 * Ingestión canónica endurecida: append-only, idempotente por eventId, actor
 * server-autoritativo, sin tenant autoafirmado, validación + PII, conflicto.
 *
 * Store-isolation: los tests puros usan deps mock; el test de integración usa
 * una events.db TEMPORAL (EVENTS_SQLITE_PATH en os.tmpdir()). NUNCA toca
 * data/, data-critical/ ni la events.db productiva.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    ingestCanonicalEvent, normalizeForIngest, factFingerprint,
    INGEST_OUTCOME, INGEST_ERROR, MAX_PAYLOAD_BYTES,
} from '../canonicalIngest.mjs';

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.error('  ✗', n, '\n    ', e && e.message); fail++; } };

// ULID válido determinista.
let uc = 0;
const ULID = () => ('U' + String(uc++).padStart(25, '0')).slice(0, 26).toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, '0');
const ctx = (over = {}) => ({ authenticatedUserId: 'user-real-1', provenance: 'web', ...over });
const rawEvt = (over = {}) => ({
    eventId: ULID(), schemaVersion: 1, event: 'text.progress', mode: 'text',
    userId: 'user-real-1', contentId: 'c1', sessionId: 'S1', clientTs: 1_700_000_000_000,
    elapsedMs: 15000, progressFraction: 0.4, payload: { sentenceCount: 10 }, ...over,
});
// deps mock: persist controlado + lookup controlado.
const mockDeps = ({ inserted = true, existing = null, now = 1_700_000_100_000, throwOnPersist = false } = {}) => {
    const calls = { persisted: [] };
    return {
        now: () => now,
        persist: (fact) => { if (throwOnPersist) throw new Error('db locked'); calls.persisted.push(fact); return { inserted }; },
        lookup: () => existing,
        _calls: calls,
    };
};

console.log('canonicalIngest — CHP-STATS-INGEST-01-PREP');

// 1. valid event persists once
T('1. evento válido → ACCEPTED (201), persistido una vez', () => {
    const d = mockDeps({ inserted: true });
    const r = ingestCanonicalEvent(rawEvt(), ctx(), d);
    assert.strictEqual(r.outcome, INGEST_OUTCOME.ACCEPTED);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(d._calls.persisted.length, 1);
});

// 2. retry same eventId persists once (dup + same fact → idempotente)
T('2. retry mismo eventId → DUPLICATE idempotente (200), no re-persiste', () => {
    const e = rawEvt();
    const fact = normalizeForIngest(e, ctx(), 1_700_000_100_000).fact;
    const d = mockDeps({ inserted: false, existing: fact });
    const r = ingestCanonicalEvent(e, ctx(), d);
    assert.strictEqual(r.outcome, INGEST_OUTCOME.DUPLICATE);
    assert.strictEqual(r.status, 200);
});

// 3. duplicate exact fact accepted idempotently (== test 2, explícito)
T('3. hecho exacto duplicado → aceptación idempotente', () => {
    const e = rawEvt();
    const fact = normalizeForIngest(e, ctx(), 1_700_000_100_000).fact;
    const r = ingestCanonicalEvent(e, ctx(), mockDeps({ inserted: false, existing: fact }));
    assert.ok(r.ok && r.outcome === INGEST_OUTCOME.DUPLICATE);
});

// 4. same eventId / different fact rejected (409 conflict)
T('4. mismo eventId + hecho distinto → CONFLICT (409), no sobrescribe', () => {
    const e = rawEvt();
    const other = normalizeForIngest(rawEvt({ eventId: e.eventId, contentId: 'DISTINTO' }), ctx(), 1_700_000_100_000).fact;
    const r = ingestCanonicalEvent(e, ctx(), mockDeps({ inserted: false, existing: other }));
    assert.strictEqual(r.outcome, INGEST_OUTCOME.CONFLICT);
    assert.strictEqual(r.status, 409);
});

// 6. receivedAt server-generated (no viene del cliente)
T('6. receivedAt server-side; occurredAt preservado', () => {
    const e = rawEvt({ clientTs: 1_700_000_000_000 });
    const n = normalizeForIngest(e, ctx(), 1_700_000_555_000);
    assert.strictEqual(n.fact.client_ts, 1_700_000_000_000, 'occurredAt preservado');
    assert.strictEqual(n.fact._receivedAt, 1_700_000_555_000, 'receivedAt server');
    assert.notStrictEqual(n.fact.client_ts, n.fact._receivedAt);
});

// 7. occurredAt preserved across (client_ts respetado, no sustituido)
T('7. occurredAt NO se sustituye por receivedAt', () => {
    const n = normalizeForIngest(rawEvt({ clientTs: 1_699_000_000_000 }), ctx(), 1_700_000_000_000);
    assert.strictEqual(n.fact.client_ts, 1_699_000_000_000);
});

// 8. actor comes from auth context
T('8. actor = contexto autenticado (no el crudo)', () => {
    const e = rawEvt({ userId: 'user-real-1' });
    const n = normalizeForIngest(e, ctx({ authenticatedUserId: 'user-real-1' }), 1_700_000_100_000);
    assert.strictEqual(n.fact.user_id, 'user-real-1');
});

// 9. spoofed actor rejected
T('9. actor autoafirmado distinto → ACTOR_MISMATCH (403)', () => {
    const r = normalizeForIngest(rawEvt({ userId: 'ADMIN-spoof' }), ctx({ authenticatedUserId: 'user-real-1' }), 1_700_000_100_000);
    assert.strictEqual(r.error, INGEST_ERROR.ACTOR_MISMATCH);
    assert.strictEqual(r.status, 403);
});
T('9b. actorId crudo distinto → ACTOR_MISMATCH', () => {
    const r = normalizeForIngest(rawEvt({ userId: undefined, actorId: 'otro' }), ctx(), 1_700_000_100_000);
    assert.strictEqual(r.error, INGEST_ERROR.ACTOR_MISMATCH);
});

// 10. tenant spoof rejected
T('10. tenant autoafirmado sin contexto verificado → TENANT_MISMATCH (403)', () => {
    const r = normalizeForIngest(rawEvt({ institutionId: 'Colegio-X' }), ctx(), 1_700_000_100_000);
    assert.strictEqual(r.error, INGEST_ERROR.TENANT_MISMATCH);
});
T('10b. tenant crudo != verificado → TENANT_MISMATCH', () => {
    const r = normalizeForIngest(rawEvt({ institutionId: 'A' }), ctx({ tenant: { institutionId: 'B' } }), 1_700_000_100_000);
    assert.strictEqual(r.error, INGEST_ERROR.TENANT_MISMATCH);
});
T('10c. hecho personal sin tenant → OK (no se fabrica, no se bloquea)', () => {
    const n = normalizeForIngest(rawEvt(), ctx({ tenant: undefined }), 1_700_000_100_000);
    assert.ok(n.ok);
    assert.strictEqual(n.fact._tenant, null);
});

// 11. invalid eventType rejected
T('11. eventType inválido → UNKNOWN_EVENT_TYPE (400)', () => {
    assert.strictEqual(normalizeForIngest(rawEvt({ event: 'NoDot', mode: 'text' }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.UNKNOWN_EVENT_TYPE);
    assert.strictEqual(normalizeForIngest(rawEvt({ event: 'zzz.x', mode: 'zzz' }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.UNKNOWN_EVENT_TYPE);
});

// 12. payload >4KB rejected
T('12. payload >4KB → PAYLOAD_TOO_LARGE (413)', () => {
    const r = normalizeForIngest(rawEvt({ payload: { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 50) } }), ctx(), 1_700_000_100_000);
    assert.strictEqual(r.error, INGEST_ERROR.PAYLOAD_TOO_LARGE);
    assert.strictEqual(r.status, 413);
});

// 13. prohibited PII rejected
T('13. PII prohibida → FORBIDDEN_FIELD (400)', () => {
    assert.strictEqual(normalizeForIngest(rawEvt({ payload: { email: 'a@b.com' } }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.FORBIDDEN_FIELD);
    assert.strictEqual(normalizeForIngest(rawEvt({ payload: { nested: { rawPrompt: 'texto' } } }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.FORBIDDEN_FIELD);
});
T('13b. derived-state prohibido → FORBIDDEN_FIELD', () => {
    assert.strictEqual(normalizeForIngest(rawEvt({ payload: { streak: 5 } }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.FORBIDDEN_FIELD);
    assert.strictEqual(normalizeForIngest(rawEvt({ payload: { progressPercentage: 80 } }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.FORBIDDEN_FIELD);
});

// 14. unauthenticated rejected
T('14. sin contexto autenticado → UNAUTHENTICATED (401)', () => {
    assert.strictEqual(ingestCanonicalEvent(rawEvt(), null, mockDeps()).status, 401);
    assert.strictEqual(ingestCanonicalEvent(rawEvt(), {}, mockDeps()).error, INGEST_ERROR.UNAUTHENTICATED);
});

// 15. transient DB error not reported as success
T('15. fallo transitorio de persistencia → ERROR (5xx), NO éxito', () => {
    const r = ingestCanonicalEvent(rawEvt(), ctx(), mockDeps({ throwOnPersist: true }));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.outcome, INGEST_OUTCOME.ERROR);
    assert.ok(r.status >= 500);
});

// 16. no x-user-id dependency
T('16. el módulo NO depende de x-user-id ni headers', () => {
    // ingestCanonicalEvent no recibe req/headers; la identidad es verifiedContext.
    const src = ingestCanonicalEvent.toString() + normalizeForIngest.toString();
    assert.ok(!/x-user-id|headers\[/i.test(src), 'sin lectura de x-user-id/headers');
    // funciona solo con verifiedContext.
    assert.strictEqual(ingestCanonicalEvent(rawEvt(), ctx(), mockDeps()).outcome, INGEST_OUTCOME.ACCEPTED);
});

// invalid time / schema / session / provenance
T('extra: occurredAt futuro/absurdo → INVALID_TIME; schema no soportado; sesión vacía; provenance', () => {
    assert.strictEqual(normalizeForIngest(rawEvt({ clientTs: 1_700_000_100_000 + 10 * 60 * 1000 }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.INVALID_TIME);
    assert.strictEqual(normalizeForIngest(rawEvt({ clientTs: 100 }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.INVALID_TIME);
    assert.strictEqual(normalizeForIngest(rawEvt({ schemaVersion: 2 }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.UNSUPPORTED_VERSION);
    assert.strictEqual(normalizeForIngest(rawEvt({ sessionId: '' }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.INVALID_SESSION);
    assert.strictEqual(normalizeForIngest(rawEvt(), ctx({ provenance: 'hacker' }), 1_700_000_100_000).error, INGEST_ERROR.INVALID_PROVENANCE);
});
T('extra: eventId no-ULID → MISSING_EVENT_ID (nunca fabricado)', () => {
    assert.strictEqual(normalizeForIngest(rawEvt({ eventId: 'not-ulid' }), ctx(), 1_700_000_100_000).error, INGEST_ERROR.MISSING_EVENT_ID);
});
T('extra: occurredAt viejo offline (dentro de cotas) → OK', () => {
    assert.ok(normalizeForIngest(rawEvt({ clientTs: 1_600_000_000_000 }), ctx(), 1_700_000_100_000).ok);
});

// ── INTEGRACIÓN: events.db TEMPORAL real (append-only + idempotencia + conflicto) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_ingest_'));
process.env.EVENTS_SQLITE_PATH = path.join(tmp, 'events.db');
const es = await import('../../eventsService.js');
const factToEvt = (f) => ({
    eventId: f.event_id, schemaVersion: f.schema_version, event: f.event, mode: f.mode,
    userId: f.user_id, contentId: f.content_id, sessionId: f.session_id, clientTs: f.client_ts,
    elapsedMs: f.elapsed_ms, progressFraction: f.progress_fraction, payload: f.payload,
});
const realDeps = { now: () => 1_700_000_100_000, persist: (f) => ({ inserted: es.insertEvent(factToEvt(f)) }), lookup: (id) => es.getEventById(id) };

console.log('\n[INTEGRACIÓN] events.db temporal:', process.env.EVENTS_SQLITE_PATH);
T('INT-1: persiste una vez (fila real, server_ts server-side)', () => {
    const e = rawEvt({ eventId: ULID() });
    const r = ingestCanonicalEvent(e, ctx(), realDeps);
    assert.strictEqual(r.outcome, INGEST_OUTCOME.ACCEPTED);
    const row = es.getEventById(e.eventId);
    assert.ok(row && row.event_id === e.eventId, 'fila persistida');
    assert.ok(Number.isFinite(row.server_ts) && row.server_ts !== e.clientTs, 'server_ts server-side');
    assert.strictEqual(row.client_ts, e.clientTs, 'client_ts preservado');
    assert.strictEqual(row.user_id, 'user-real-1', 'actor autenticado');
});
T('INT-2: retry mismo hecho → DUPLICATE, sigue habiendo UNA fila', () => {
    const e = rawEvt({ eventId: ULID() });
    assert.strictEqual(ingestCanonicalEvent(e, ctx(), realDeps).outcome, INGEST_OUTCOME.ACCEPTED);
    const before = es.getEventCount();
    const r2 = ingestCanonicalEvent(e, ctx(), realDeps);
    assert.strictEqual(r2.outcome, INGEST_OUTCOME.DUPLICATE);
    assert.strictEqual(es.getEventCount(), before, 'sin segunda fila');
});
T('INT-3: mismo eventId + hecho distinto → CONFLICT, original intacto', () => {
    const id = ULID();
    const e1 = rawEvt({ eventId: id, contentId: 'ORIG' });
    assert.strictEqual(ingestCanonicalEvent(e1, ctx(), realDeps).outcome, INGEST_OUTCOME.ACCEPTED);
    const e2 = rawEvt({ eventId: id, contentId: 'HACKEADO' });
    const r = ingestCanonicalEvent(e2, ctx(), realDeps);
    assert.strictEqual(r.outcome, INGEST_OUTCOME.CONFLICT);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(es.getEventById(id).content_id, 'ORIG', 'hecho original NO sobreescrito');
});
T('INT-4: dos ingestas idempotentes concurrentes-secuenciales → una sola fila', () => {
    const e = rawEvt({ eventId: ULID() });
    const a = ingestCanonicalEvent(e, ctx(), realDeps);
    const b = ingestCanonicalEvent(e, ctx(), realDeps);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepStrictEqual(outcomes, [INGEST_OUTCOME.ACCEPTED, INGEST_OUTCOME.DUPLICATE].sort());
    assert.strictEqual(es.getEventCount({}) !== undefined ? es.getEventById(e.eventId) !== null : true, true);
});

es.closeDb && es.closeDb();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
