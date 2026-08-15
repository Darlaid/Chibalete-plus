/**
 * canonicalEvent.test.mjs — CHP-STATS-EVENT-CONTRACT-01.
 * Sobre canónico + normalizer (verifiedContext) + matriz de seguridad +
 * arnés de idempotencia + fixtures golden. Cross-platform, sin I/O, sin DB.
 */
import { ulid } from '../../ulid.js';
import {
  validateCanonicalEnvelope, EVENT_ERROR, MAX_PAYLOAD_BYTES, MAX_FUTURE_SKEW_MS,
} from '../canonicalEvent.mjs';
import { normalizeCanonicalEvent } from '../normalizeCanonicalEvent.mjs';

let pass = 0, fail = 0;
const ok = (l, c) => c ? (pass++, console.log('  ✓', l)) : (fail++, console.error('  ✗', l));
const RX = 1700000000000; // receivedAt base (2023)
const OX = 1699999990000; // occurredAt base (poco antes)

// Sobre canónico válido base (ya normalizado).
const validEnvelope = (over = {}) => ({
  eventId: ulid(OX), schemaVersion: 1, eventType: 'reading_progress', mode: 'text',
  actorId: 'user-A', contentId: 'c1', interactionSessionId: 'sess-1',
  occurredAt: OX, receivedAt: RX, provenance: 'web', payload: { sentenceIndex: 3 }, ...over,
});

// ── validateCanonicalEnvelope ───────────────────────────────────────────────
console.log('\n[envelope]');
ok('válido → ok', validateCanonicalEnvelope(validEnvelope()).ok === true);
{
  const r = validateCanonicalEnvelope(validEnvelope());
  ok('payload final SIN contentId/sessionId hoisteados', r.ok && r.event.payload.contentId === undefined && r.event.payload.sessionId === undefined && r.event.payload.sentenceIndex === 3);
  ok('meta del registry presente', r.ok && !!r.meta);
}
ok('schemaVersion futura → UNSUPPORTED_VERSION', validateCanonicalEnvelope(validEnvelope({ schemaVersion: 2 })).code === EVENT_ERROR.UNSUPPORTED_VERSION);
ok('eventType desconocido → UNKNOWN_EVENT_TYPE', validateCanonicalEnvelope(validEnvelope({ eventType: 'no_such_event' })).code === EVENT_ERROR.UNKNOWN_EVENT_TYPE);
ok('eventId ULID inválido → INVALID_EVENT', validateCanonicalEnvelope(validEnvelope({ eventId: 'not-a-ulid' })).code === EVENT_ERROR.INVALID_EVENT);
ok('clave de sobre rechazada (authSessionId) → FORBIDDEN_FIELD', validateCanonicalEnvelope(validEnvelope({ authSessionId: 'sid-1' })).code === EVENT_ERROR.FORBIDDEN_FIELD);
ok('clave de sobre rechazada (role) → FORBIDDEN_FIELD', validateCanonicalEnvelope(validEnvelope({ role: 'admin' })).code === EVENT_ERROR.FORBIDDEN_FIELD);
ok('contentId requerido ausente → INVALID_EVENT', validateCanonicalEnvelope(validEnvelope({ contentId: undefined })).code === EVENT_ERROR.INVALID_EVENT);
ok('interactionSessionId requerido ausente → INVALID_EVENT', validateCanonicalEnvelope(validEnvelope({ interactionSessionId: undefined })).code === EVENT_ERROR.INVALID_EVENT);

console.log('\n[tiempo]');
ok('futuro > skew → INVALID_TIME', validateCanonicalEnvelope(validEnvelope({ occurredAt: RX + MAX_FUTURE_SKEW_MS + 1000 })).code === EVENT_ERROR.INVALID_TIME);
ok('offline viejo (2021) NO se rechaza', validateCanonicalEnvelope(validEnvelope({ occurredAt: 1610000000000, offline: true })).ok === true);
ok('occurredAt antes del piso de plataforma → INVALID_TIME', validateCanonicalEnvelope(validEnvelope({ occurredAt: 100 })).code === EVENT_ERROR.INVALID_TIME);

console.log('\n[payload/PII/derived]');
ok('PII prohibida (email) → FORBIDDEN_FIELD', validateCanonicalEnvelope(validEnvelope({ payload: { email: 'a@b.c' } })).code === EVENT_ERROR.FORBIDDEN_FIELD);
ok('PII anidada (ip) → FORBIDDEN_FIELD', validateCanonicalEnvelope(validEnvelope({ payload: { nested: { ipAddress: '1.2.3.4' } } })).code === EVENT_ERROR.FORBIDDEN_FIELD);
ok('clave de payload desconocida → UNKNOWN_PAYLOAD_KEY', validateCanonicalEnvelope(validEnvelope({ payload: { sentenceIndex: 1, bogus: 9 } })).code === EVENT_ERROR.UNKNOWN_PAYLOAD_KEY);
ok('DERIVED state (streak) rechazado → UNKNOWN_PAYLOAD_KEY', validateCanonicalEnvelope(validEnvelope({ payload: { streak: 5, level: 3 } })).code === EVENT_ERROR.UNKNOWN_PAYLOAD_KEY);
{
  // __proto__ via JSON.parse = asignación de prototipo (no own key): el spread lo
  // descarta → payload limpio y SIN polución global. Ésa es la propiedad segura.
  const proto = JSON.parse('{"__proto__":{"polluted":true},"sentenceIndex":1}');
  const r = validateCanonicalEnvelope(validEnvelope({ payload: proto }));
  ok('payload con __proto__ → sin polución global y payload limpio', r.ok === true && r.event.payload.polluted === undefined && ({}).polluted === undefined);
  // own key inyectada arbitraria (no en el schema del tipo) → rechazo estricto.
  const injected = {}; Object.defineProperty(injected, 'polluted', { value: true, enumerable: true }); injected.sentenceIndex = 1;
  ok('own key inyectada (polluted) → UNKNOWN_PAYLOAD_KEY', validateCanonicalEnvelope(validEnvelope({ payload: injected })).code === EVENT_ERROR.UNKNOWN_PAYLOAD_KEY);
}
ok('payload > 4KB → PAYLOAD_TOO_LARGE', validateCanonicalEnvelope(validEnvelope({ payload: { reason: 'x'.repeat(MAX_PAYLOAD_BYTES + 100) } })).code === EVENT_ERROR.PAYLOAD_TOO_LARGE);

// ── normalizeCanonicalEvent (frontera de confianza) ─────────────────────────
console.log('\n[normalize — verifiedContext]');
const ctx = (over = {}) => ({ authenticatedUserId: 'user-A', provenance: 'web', receivedAt: RX, ...over });
const rawClient = (over = {}) => ({
  eventId: ulid(OX), schemaVersion: 1, eventType: 'reading_progress', mode: 'text',
  contentId: 'c1', interactionSessionId: 'sess-1', occurredAt: OX, payload: { sentenceIndex: 3 }, ...over,
});
ok('online válido → ok, actor = contexto', (() => { const r = normalizeCanonicalEvent(rawClient(), ctx()); return r.ok && r.event.actorId === 'user-A'; })());
ok('actor crudo distinto → ACTOR_MISMATCH', normalizeCanonicalEvent(rawClient({ actorId: 'user-B' }), ctx()).code === EVENT_ERROR.ACTOR_MISMATCH);
ok('actor crudo == contexto → ok', normalizeCanonicalEvent(rawClient({ actorId: 'user-A' }), ctx()).ok === true);
ok('receivedAt crudo IGNORADO (server-owned)', (() => { const r = normalizeCanonicalEvent(rawClient({ receivedAt: 5 }), ctx()); return r.ok && r.event.receivedAt === RX; })());
ok('tenant crudo sin verificar → TENANT_MISMATCH', normalizeCanonicalEvent(rawClient({ institutionId: 'inst-X' }), ctx()).code === EVENT_ERROR.TENANT_MISMATCH);
ok('tenant crudo != verificado → TENANT_MISMATCH', normalizeCanonicalEvent(rawClient({ institutionId: 'inst-X' }), ctx({ verifiedInstitutionId: 'inst-Y' })).code === EVENT_ERROR.TENANT_MISMATCH);
ok('tenant crudo == verificado → ok, snapshot sellado', (() => { const r = normalizeCanonicalEvent(rawClient({ institutionId: 'inst-Y' }), ctx({ verifiedInstitutionId: 'inst-Y' })); return r.ok && r.event.institutionId === 'inst-Y'; })());
ok('snapshot verificado sin claim crudo → sellado', (() => { const r = normalizeCanonicalEvent(rawClient(), ctx({ verifiedInstitutionId: 'inst-Z', verifiedGroupId: 'g-1' })); return r.ok && r.event.institutionId === 'inst-Z' && r.event.groupId === 'g-1'; })());
ok('provenance auto-afirmada (migration) → INVALID_PROVENANCE', normalizeCanonicalEvent(rawClient({ provenance: 'migration' }), ctx()).code === EVENT_ERROR.INVALID_PROVENANCE);
ok('provenance sellada por contexto (lu)', (() => { const r = normalizeCanonicalEvent(rawClient({ eventType: 'session_started', contentId: undefined, mode: 'lu', payload: { sessionId: 'sess-1', source: 'lu', startedAt: OX } }), ctx({ provenance: 'lu' })); return r.ok && r.event.provenance === 'lu'; })());
ok('eventId ausente → MISSING_EVENT_ID (no se fabrica)', normalizeCanonicalEvent(rawClient({ eventId: undefined }), ctx()).code === EVENT_ERROR.MISSING_EVENT_ID);
ok('occurredAt ausente → INVALID_TIME (no se fabrica desde receivedAt)', normalizeCanonicalEvent(rawClient({ occurredAt: undefined }), ctx()).code === EVENT_ERROR.INVALID_TIME);
ok('contexto inválido (sin auth) → INSUFFICIENT_PROVENANCE', normalizeCanonicalEvent(rawClient(), { provenance: 'web', receivedAt: RX }).code === EVENT_ERROR.INSUFFICIENT_PROVENANCE);
ok('contexto con provenance inválida → INSUFFICIENT_PROVENANCE', normalizeCanonicalEvent(rawClient(), { authenticatedUserId: 'user-A', provenance: 'hacker', receivedAt: RX }).code === EVENT_ERROR.INSUFFICIENT_PROVENANCE);
ok('offline válido → ok', normalizeCanonicalEvent(rawClient({ offline: true, occurredAt: 1610000000000 }), ctx()).ok === true);

// ── Arnés de idempotencia (fake persistence en memoria) ─────────────────────
console.log('\n[idempotencia]');
function makeStore() {
  const byId = new Map();
  const material = (e) => JSON.stringify({ t: e.eventType, a: e.actorId, c: e.contentId ?? null, s: e.interactionSessionId ?? null, o: e.occurredAt, p: e.payload ?? {} });
  return {
    ingest(e) {
      const prev = byId.get(e.eventId);
      if (!prev) { byId.set(e.eventId, material(e)); return 'accepted'; }
      return prev === material(e) ? 'duplicate' : 'conflict';
    },
  };
}
{
  const store = makeStore();
  const base = validateCanonicalEnvelope(validEnvelope()).event;
  ok('primer evento → accepted', store.ingest(base) === 'accepted');
  ok('mismo eventId + mismo material → duplicate', store.ingest(base) === 'duplicate');
  const tampered = { ...base, actorId: 'user-EVIL' };
  ok('mismo eventId + material distinto → conflict (no duplicate silencioso)', store.ingest(tampered) === 'conflict');
  const later = validateCanonicalEnvelope(validEnvelope({ eventId: ulid(OX + 60000), occurredAt: OX + 60000 })).event;
  ok('acción repetida legítima + nuevo eventId → accepted', store.ingest(later) === 'accepted');
}

// ── Golden fixtures (RAW → verifiedContext → NORMALIZED) ─────────────────────
console.log('\n[golden fixtures]');
const golden = [
  { name: 'ONLINE_READER', raw: rawClient(), ctx: ctx(), expectType: 'reading_progress', expectProv: 'web' },
  { name: 'OFFLINE_LU', raw: { eventId: ulid(OX), schemaVersion: 1, eventType: 'session_started', mode: 'lu', occurredAt: 1610000000000, offline: true, interactionSessionId: 'lu-s1', payload: { sessionId: 'lu-s1', source: 'lu', startedAt: 1610000000000 } }, ctx: ctx({ provenance: 'lu' }), expectType: 'session_started', expectProv: 'lu' },
  { name: 'MEDIA', raw: { eventId: ulid(OX), schemaVersion: 1, eventType: 'audio_started', mode: 'immersive', occurredAt: OX, interactionSessionId: 'sess-1', payload: { sessionId: 'sess-1', runtime: 'v2' } }, ctx: ctx(), expectType: 'audio_started', expectProv: 'web' },
  { name: 'LEO', raw: { eventId: ulid(OX), schemaVersion: 1, eventType: 'leo_interaction_started', mode: 'leo', occurredAt: OX, interactionSessionId: 'leo-s1', payload: { sessionId: 'leo-s1', kind: 'hint' } }, ctx: ctx({ authenticatedUserId: 'srv', provenance: 'server' }), expectType: 'leo_interaction_started', expectProv: 'server' },
  { name: 'ACTIVITY', raw: { eventId: ulid(OX), schemaVersion: 1, eventType: 'teacher_reviewed_recommendation', mode: 'aula_viva', occurredAt: OX, payload: { recommendationId: 'r1', accepted: true } }, ctx: ctx({ authenticatedUserId: 'teacher-1', provenance: 'server' }), expectType: 'teacher_reviewed_recommendation', expectProv: 'server' },
  { name: 'MIGRATION', raw: { eventId: ulid(OX), schemaVersion: 1, eventType: 'reading_completed', mode: 'text', occurredAt: 1610000000000, contentId: 'c9', interactionSessionId: 's9', payload: {} }, ctx: ctx({ provenance: 'migration' }), expectType: 'reading_completed', expectProv: 'migration' },
];
for (const g of golden) {
  const r = normalizeCanonicalEvent(g.raw, g.ctx);
  ok(`${g.name} → normaliza ok, type=${g.expectType}, prov=${g.expectProv}`, r.ok && r.event.eventType === g.expectType && r.event.provenance === g.expectProv);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
