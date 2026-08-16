/**
 * readerEventCore.test.mjs — CHP-STATS-INSTRUMENTATION-01B.
 * Tests de la lógica de instrumentación de lectores (Texto/PDF/Álbum) sobre el
 * transporte compartido. 100% herméticos (storage/fetch mock; sin stores reales).
 */
import assert from 'node:assert';
import { createElapsedTracker, buildReaderEvent, READER_MODES } from '../readerEventCore.mjs';
import { createEventTransport, ULID_RE } from '../eventTransport.mjs';

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.error('  ✗', n, '\n    ', e && e.message); fail++; } };
const AT = async (n, f) => { try { await f(); console.log('  ✓', n); pass++; } catch (e) { console.error('  ✗', n, '\n    ', e && e.message); fail++; } };

function memStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
function mockFetch(script) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init, body: init && init.body });
        const next = script[Math.min(calls.length - 1, script.length - 1)];
        if (next instanceof Error) throw next;
        return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => ({}) };
    };
    fn.calls = calls;
    return fn;
}
// ULID mínimo válido para IDs deterministas de test.
let ulidN = 0;
const testUlid = () => ('TEST' + String(ulidN++).padStart(22, '0')).slice(0, 26);

console.log('readerEventCore — CHP-STATS-INSTRUMENTATION-01B');

// ── elapsedMs INCREMENTAL (golden FASE 12) ──────────────────────────────────
T('12. elapsedMs delta golden 10/15/15 (no acumulado)', () => {
    const tr = createElapsedTracker(0);
    assert.strictEqual(tr.delta(10_000), 10_000);
    assert.strictEqual(tr.delta(25_000), 15_000);
    assert.strictEqual(tr.delta(40_000), 15_000);
});
T('elapsed tracker: reset reinicia el checkpoint', () => {
    const tr = createElapsedTracker(0);
    tr.delta(10_000);
    tr.reset(100_000);
    assert.strictEqual(tr.delta(105_000), 5_000, 'delta desde el nuevo checkpoint');
});
T('elapsed nunca negativo', () => {
    const tr = createElapsedTracker(1000);
    assert.strictEqual(tr.delta(500), 0, 'reloj hacia atrás → 0, no negativo');
});

// ── buildReaderEvent: identidad + shape dual ────────────────────────────────
T('evento dual: transporte (eventId/occurredAt/type) + backbone (event/clientTs/userId/sessionId)', () => {
    const e = buildReaderEvent({ eventId: testUlid(), now: 500, mode: 'text', action: 'progress', userId: 'u1', contentId: 'c1', interactionSessionId: 'S1', elapsedMs: 15_000, progressFraction: 0.42, payload: { sentenceCount: 10 } });
    // transporte
    assert.strictEqual(e.occurredAt, 500);
    assert.strictEqual(e.type, 'text.progress');
    // backbone
    assert.strictEqual(e.event, 'text.progress');
    assert.strictEqual(e.clientTs, 500, 'clientTs == occurredAt (mismo hecho)');
    assert.strictEqual(e.userId, 'u1');
    assert.strictEqual(e.sessionId, 'S1');
    assert.strictEqual(e.mode, 'text');
    assert.strictEqual(e.elapsedMs, 15_000);
    assert.strictEqual(e.progressFraction, 0.42);
    assert.deepStrictEqual(e.payload, { sentenceCount: 10 });
});
T('action inválida → null; guest/no-session → null', () => {
    assert.strictEqual(buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'text', action: 'Bad Name', userId: 'u', interactionSessionId: 'S' }), null);
    assert.strictEqual(buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'text', action: 'progress', userId: 'guest', interactionSessionId: 'S' }), null);
    assert.strictEqual(buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'text', action: 'progress', userId: 'u', interactionSessionId: '' }), null);
});
T('progressFraction se acota [0..1]', () => {
    assert.strictEqual(buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'pdf', action: 'progress', userId: 'u', interactionSessionId: 'S', progressFraction: 1.9 }).progressFraction, 1);
    assert.strictEqual(buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'pdf', action: 'progress', userId: 'u', interactionSessionId: 'S', progressFraction: -3 }).progressFraction, 0);
});
T('fact-only: no fabrica derived state; solo lo que pasa el caller', () => {
    const e = buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'album', action: 'progress', userId: 'u', interactionSessionId: 'S', payload: { currentSlide: 3, totalSlides: 12 } });
    const forbidden = ['streak', 'level', 'xp', 'readCount', 'blocksCompleted', 'progressPercentage'];
    for (const k of forbidden) assert.ok(!(k in e) && !(e.payload && k in e.payload), `sin ${k}`);
});
T('modos backbone válidos', () => {
    assert.deepStrictEqual(READER_MODES, ['pdf', 'text', 'immersive', 'album', 'a11y', 'lu']);
});

// ── SESSION per opening (FASE 13) ───────────────────────────────────────────
T('13. sesión por apertura: S1 != S2; eventos de una apertura comparten sesión', () => {
    // Apertura A → S1
    const S1 = testUlid();
    const a1 = buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'text', action: 'session_start', userId: 'u', interactionSessionId: S1 });
    const a2 = buildReaderEvent({ eventId: testUlid(), now: 2, mode: 'text', action: 'progress', userId: 'u', interactionSessionId: S1 });
    assert.strictEqual(a1.sessionId, a2.sessionId, 'misma sesión durante la apertura');
    // Nueva apertura → S2
    const S2 = testUlid();
    const b1 = buildReaderEvent({ eventId: testUlid(), now: 3, mode: 'text', action: 'session_start', userId: 'u', interactionSessionId: S2 });
    assert.notStrictEqual(a1.sessionId, b1.sessionId, 'S1 != S2 (nueva apertura)');
});

// ── Golden sequence + transporte: OPEN→PROGRESS→PROGRESS→CLOSE (FASE 15) ─────
await AT('15. secuencia dorada Texto: elapsed deltas 0/10/15/15, mismo sessionId, eventId único', async () => {
    const st = memStorage();
    const fetchImpl = mockFetch([{ status: 200 }]);
    const transport = createEventTransport({ storage: st, fetchImpl, generateId: testUlid, storageKey: 'q' });
    const S = testUlid();
    const el = createElapsedTracker(0);
    const seq = [];
    const push = (action, now, frac) => {
        const e = buildReaderEvent({ eventId: testUlid(), now, mode: 'text', action, userId: 'u', contentId: 'c', interactionSessionId: S, elapsedMs: action === 'session_start' ? 0 : el.delta(now), progressFraction: frac });
        transport.enqueue(e); seq.push(e);
    };
    push('session_start', 0, 0);   // elapsed 0
    push('progress', 10_000, 0.2); // +10s
    push('progress', 25_000, 0.5); // +15s
    push('session_end', 40_000, 0.7); // +15s
    assert.deepStrictEqual(seq.map(e => e.elapsedMs), [0, 10_000, 15_000, 15_000], 'deltas incrementales');
    assert.ok(seq.every(e => e.sessionId === S), 'misma interactionSessionId');
    assert.strictEqual(new Set(seq.map(e => e.eventId)).size, 4, 'eventId único por hecho');
    const r = await transport.flush();
    assert.strictEqual(r.outcome, 'success');
    assert.strictEqual(transport.queueSize(), 0);
});

// ── Offline/retry por familia (FASE 11): mismo eventId/occurredAt ───────────
await AT('11. offline→online: mismo eventId/occurredAt tras retry (PDF)', async () => {
    const st = memStorage();
    const fetchImpl = mockFetch([new Error('offline'), { status: 200 }]);
    const transport = createEventTransport({ storage: st, fetchImpl, generateId: testUlid, storageKey: 'q' });
    const S = testUlid();
    const e = buildReaderEvent({ eventId: testUlid(), now: 777, mode: 'pdf', action: 'progress', userId: 'u', contentId: 'c', interactionSessionId: S, elapsedMs: 5000, payload: { currentPage: 3 } });
    transport.enqueue(e);
    await transport.flush();       // offline → queda
    assert.strictEqual(transport.queueSize(), 1);
    await transport.retryQueued(); // online → éxito
    assert.strictEqual(transport.queueSize(), 0);
    const bodies = fetchImpl.calls.map(c => JSON.parse(c.body).events[0]);
    assert.ok(bodies.every(b => b.eventId === e.eventId && b.occurredAt === 777 && b.clientTs === 777), 'identidad estable');
});

// ── Privacy (FASE 14) ───────────────────────────────────────────────────────
await AT('14. sin x-user-id ni PII; identidad por cookie', async () => {
    const fetchImpl = mockFetch([{ status: 200 }]);
    const transport = createEventTransport({ storage: memStorage(), fetchImpl, generateId: testUlid, storageKey: 'q' });
    const e = buildReaderEvent({ eventId: testUlid(), now: 1, mode: 'album', action: 'progress', userId: 'u1', contentId: 'c', interactionSessionId: 'S', payload: { currentSlide: 2 } });
    transport.enqueue(e);
    await transport.flush();
    const hdrs = fetchImpl.calls[0].init.headers;
    assert.ok(!Object.keys(hdrs).map(k => k.toLowerCase()).includes('x-user-id'), 'sin header x-user-id');
    assert.strictEqual(fetchImpl.calls[0].init.credentials, 'same-origin', 'cookie de sesión');
    const body = JSON.parse(fetchImpl.calls[0].body).events[0];
    // el body puede llevar userId (contrato backbone vivo) pero NO PII
    for (const k of ['email', 'correo', 'name', 'schoolName', 'token', 'rawPrompt']) {
        assert.ok(!(k in body) && !(body.payload && k in body.payload), `sin ${k}`);
    }
});

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
