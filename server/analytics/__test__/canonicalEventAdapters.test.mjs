/**
 * canonicalEventAdapters.test.mjs — CHP-STATS-EVENT-CONTRACT-01.
 * Adaptadores de compat + clasificación de migración + mapeo events.db.
 * Cross-platform, sin I/O, sin DB.
 */
import { ulid } from '../../ulid.js';
import {
  legacyNameToCanonical, adaptBackboneV1ToRaw, classifyMigration,
  MIGRATION_CLASS, ADAPT_ERROR,
} from '../canonicalEventAdapters.mjs';
import { normalizeCanonicalEvent } from '../normalizeCanonicalEvent.mjs';

let pass = 0, fail = 0;
const ok = (l, c) => c ? (pass++, console.log('  ✓', l)) : (fail++, console.error('  ✗', l));
const OX = 1699999990000, RX = 1700000000000;

// ── Aliases deliberados ─────────────────────────────────────────────────────
console.log('\n[aliases]');
ok('text.session_start → session_started', legacyNameToCanonical('text.session_start') === 'session_started');
ok('pdf.page_change → pdf_page_changed', legacyNameToCanonical('pdf.page_change') === 'pdf_page_changed');
ok('immersive.progress → reading_progress', legacyNameToCanonical('immersive.progress') === 'reading_progress');
ok('immersive.audio_play → audio_started', legacyNameToCanonical('immersive.audio_play') === 'audio_started');
ok('nombre ya canónico se conserva', legacyNameToCanonical('reading_completed') === 'reading_completed');
ok('block_complete → null (gap deliberado, NO se inventa)', legacyNameToCanonical('immersive.block_complete') === null);
ok('lu.page_view → null (telemetría producto)', legacyNameToCanonical('lu.page_view') === null);
ok('desconocido → null', legacyNameToCanonical('foo.bar_baz') === null);

// ── Adapter backbone v1 → raw → normalize ───────────────────────────────────
console.log('\n[adapter v1]');
{
  const v1 = { eventId: ulid(OX), schemaVersion: 1, event: 'text.progress', mode: 'text', userId: 'user-A', contentId: 'c1', sessionId: 'sess-1', clientTs: OX, elapsedMs: 1234, payload: { sentenceIndex: 2 } };
  const a = adaptBackboneV1ToRaw(v1);
  ok('adapta v1 válido → raw ok', a.ok === true && a.raw.eventType === 'reading_progress');
  ok('actorId crudo = claimed (userId), NO autoridad', a.ok && a.raw.actorId === 'user-A');
  const n = normalizeCanonicalEvent(a.raw, { authenticatedUserId: 'user-A', provenance: 'web', receivedAt: RX });
  ok('normaliza el raw adaptado → ok', n.ok === true && n.event.eventType === 'reading_progress');
  ok('elapsedMs pasa como señal de payload', n.ok && n.event.payload.elapsedMs === 1234);
}
ok('v1 sin eventId → INSUFFICIENT_PROVENANCE (no fabrica)', adaptBackboneV1ToRaw({ event: 'text.progress', mode: 'text', userId: 'u', contentId: 'c', sessionId: 's', clientTs: OX }).code === ADAPT_ERROR.INSUFFICIENT_PROVENANCE);
ok('v1 con nombre sin canónico → NO_CANONICAL_MAPPING', adaptBackboneV1ToRaw({ eventId: ulid(OX), event: 'immersive.block_complete', mode: 'immersive', userId: 'u', clientTs: OX }).code === ADAPT_ERROR.NO_CANONICAL_MAPPING);
ok('v1 sin clientTs → INSUFFICIENT_PROVENANCE', adaptBackboneV1ToRaw({ eventId: ulid(OX), event: 'text.progress', mode: 'text', userId: 'u', contentId: 'c', sessionId: 's' }).code === ADAPT_ERROR.INSUFFICIENT_PROVENANCE);
{
  // adapter NO copia derived state como autoridad; si viene en payload, el canónico lo rechaza.
  const v1 = { eventId: ulid(OX), schemaVersion: 1, event: 'text.progress', mode: 'text', userId: 'user-A', contentId: 'c1', sessionId: 'sess-1', clientTs: OX, payload: { streak: 9 } };
  const a = adaptBackboneV1ToRaw(v1);
  const n = normalizeCanonicalEvent(a.raw, { authenticatedUserId: 'user-A', provenance: 'web', receivedAt: RX });
  ok('derived state (streak) del v1 → rechazado por el canónico', n.ok === false && n.code === 'UNKNOWN_PAYLOAD_KEY');
}

// ── Clasificación de migración ──────────────────────────────────────────────
console.log('\n[migración]');
ok('native v1 verificado → DIRECTLY_COMPATIBLE', classifyMigration({ source: 'events.db.native', provenanceVerified: true, eventId: ulid(OX), event: 'text.progress', userId: 'u', serverTs: RX }) === MIGRATION_CLASS.DIRECTLY_COMPATIBLE);
ok('legacy con actor+tiempo → NORMALIZABLE', classifyMigration({ source: 'analytics_db', eventId: ulid(OX), event: 'session_start', userId: 'u', clientTs: OX }) === MIGRATION_CLASS.NORMALIZABLE);
ok('sin eventId (playback log) → INVALID_FOR_CANONICAL_REPLAY', classifyMigration({ source: 'playback_events.log', event: 'text.progress', userId: 'u', clientTs: OX }) === MIGRATION_CLASS.INVALID_FOR_CANONICAL_REPLAY);
ok('sin actor → INSUFFICIENT_PROVENANCE', classifyMigration({ eventId: ulid(OX), event: 'session_start', clientTs: OX }) === MIGRATION_CLASS.INSUFFICIENT_PROVENANCE);
ok('sin tiempo → INSUFFICIENT_PROVENANCE', classifyMigration({ eventId: ulid(OX), event: 'session_start', userId: 'u' }) === MIGRATION_CLASS.INSUFFICIENT_PROVENANCE);
ok('nombre sin canónico → INVALID_FOR_CANONICAL_REPLAY', classifyMigration({ eventId: ulid(OX), event: 'block_complete', userId: 'u', clientTs: OX }) === MIGRATION_CLASS.INVALID_FOR_CANONICAL_REPLAY);

// ── Mapeo de columnas events.db → sobre canónico (sin abrir DB) ──────────────
console.log('\n[events.db mapping]');
{
  // Fila events.db simulada (columnas reales del schema).
  const row = { event_id: ulid(OX), schema_version: 1, event: 'text.progress', mode: 'text', user_id: 'user-A', content_id: 'c1', session_id: 'sess-1', client_ts: OX, server_ts: RX, elapsed_ms: 10, progress_fraction: 0.5, payload_json: '{"sentenceIndex":2}' };
  const raw = {
    eventId: row.event_id, schemaVersion: row.schema_version,
    eventType: legacyNameToCanonical(row.event), mode: row.mode,
    actorId: row.user_id, contentId: row.content_id, interactionSessionId: row.session_id,
    occurredAt: row.client_ts, payload: JSON.parse(row.payload_json),
  };
  const n = normalizeCanonicalEvent(raw, { authenticatedUserId: row.user_id, provenance: 'migration', receivedAt: row.server_ts });
  ok('fila events.db mapea a canónico (event_id→eventId, user_id→actorId, client_ts→occurredAt, server_ts→receivedAt, session_id→interactionSessionId)',
     n.ok === true && n.event.eventId === row.event_id && n.event.actorId === 'user-A' && n.event.occurredAt === OX && n.event.receivedAt === RX && n.event.interactionSessionId === 'sess-1');
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
