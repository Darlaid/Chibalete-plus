/**
 * eventTransport.test.mjs — CHP-STATS-INSTRUMENTATION-01A.
 *
 * Tests de comportamiento del transporte compartido. 100% herméticos:
 * storage y fetch mockeados en memoria. NO tocan events.db/insights.db/
 * progress ni ningún store real (PRODUCTION_STORE_WRITES_FROM_TESTS=0).
 */
import assert from 'node:assert';
import {
    createEventTransport, classifyResponse, TELEMETRY,
    MAX_PAYLOAD_BYTES, ULID_RE, DEFAULT_ENDPOINT,
} from '../eventTransport.mjs';

let pass = 0, fail = 0;
const T = (name, fn) => {
    try { fn(); console.log('  ✓', name); pass++; }
    catch (e) { console.error('  ✗', name, '\n    ', e && e.message); fail++; }
};
const AT = async (name, fn) => {
    try { await fn(); console.log('  ✓', name); pass++; }
    catch (e) { console.error('  ✗', name, '\n    ', e && e.message); fail++; }
};

// ── Mocks ────────────────────────────────────────────────────────────────────
function memStorage() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
        _dump: () => m,
        _raw: k => (m.has(k) ? m.get(k) : null),
    };
}
// fetch mock programable: cola de respuestas o función.
function mockFetch(script) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init, body: init && init.body });
        const next = typeof script === 'function' ? script(calls.length - 1, { url, init }) : script[Math.min(calls.length - 1, script.length - 1)];
        if (next instanceof Error) throw next;
        return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.json ?? {} };
    };
    fn.calls = calls;
    return fn;
}
const okResp = { status: 200, json: { accepted: 1 } };
const dupResp = { status: 200, json: { accepted: 0, deduplicated: 1 } };
const err500 = { status: 500 };
const err400 = { status: 400 };
const netErr = new Error('network down');

const baseEvt = (t = 't') => ({ type: `text.${t}`, mode: 'text', contentId: 'c1', interactionSessionId: 's1', payload: { page: 3 } });

console.log('eventTransport — CHP-STATS-INSTRUMENTATION-01A');

// 1. eventId created once (ULID) + created at fact time
T('1. eventId se crea una vez, formato ULID', () => {
    const tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([okResp]) });
    const e = tr.createEvent(baseEvt());
    assert.ok(ULID_RE.test(e.eventId), 'eventId debe ser ULID');
    const e2 = tr.createEvent(baseEvt());
    assert.notStrictEqual(e.eventId, e2.eventId, 'dos hechos distintos → ids distintos');
});

// 2. occurredAt created once (at fact time)
T('2. occurredAt se fija en el hecho', () => {
    let clock = 1000;
    const tr = createEventTransport({ storage: memStorage(), now: () => clock });
    const e = tr.createEvent(baseEvt());
    assert.strictEqual(e.occurredAt, 1000);
    clock = 9999;
    assert.strictEqual(e.occurredAt, 1000, 'no cambia aunque avance el reloj');
});

// 3. retry preserves BOTH eventId and occurredAt
await AT('3. retry conserva eventId y occurredAt', async () => {
    const st = memStorage();
    let clock = 500;
    const fetchImpl = mockFetch([err500, err500, okResp]);
    const tr = createEventTransport({ storage: st, fetchImpl, now: () => clock });
    const e = tr.createEvent(baseEvt());
    tr.enqueue(e);
    clock = 1_000_000; // el tiempo avanza mucho entre reintentos
    await tr.flush();          // 500 → falla
    await tr.retryQueued();    // 500 → falla
    await tr.retryQueued();    // 200 → éxito
    const bodies = fetchImpl.calls.map(c => JSON.parse(c.body).events[0]);
    assert.strictEqual(bodies.length, 3, '3 intentos');
    assert.ok(bodies.every(b => b.eventId === e.eventId), 'mismo eventId en los 3');
    assert.ok(bodies.every(b => b.occurredAt === 500), 'mismo occurredAt (500) en los 3');
});

// 4. offline enqueue (no network) — event stays queued
await AT('4. enqueue offline → queda en cola', async () => {
    const st = memStorage();
    const tr = createEventTransport({ storage: st, fetchImpl: mockFetch([netErr]) });
    const e = tr.emit(baseEvt()).event;
    assert.strictEqual(tr.queueSize(), 1);
    await tr.flush(); // red caída
    assert.strictEqual(tr.queueSize(), 1, 'sigue en cola tras fallo de red');
    assert.ok(st._raw(tr.storageKey).includes(e.eventId));
});

// 5. reload persistence — a fresh transport over same storage sees the event
await AT('5. persistencia sobre reload', async () => {
    const st = memStorage();
    const tr1 = createEventTransport({ storage: st, fetchImpl: mockFetch([netErr]) });
    const e = tr1.emit(baseEvt()).event;
    await tr1.flush(); // red caída → queda persistido
    // "reload": nuevo transporte, mismo storage subyacente.
    const tr2 = createEventTransport({ storage: st, fetchImpl: mockFetch([okResp]) });
    assert.strictEqual(tr2.queueSize(), 1, 'evento persistió al reload');
    const sentId = tr2.loadQueue()[0].eventId;
    assert.strictEqual(sentId, e.eventId, 'mismo eventId tras reload');
    const r = await tr2.flush();
    assert.strictEqual(r.outcome, 'success');
    assert.strictEqual(tr2.queueSize(), 0, 'se envió tras reload');
});

// 6. success removes event
await AT('6. éxito retira el evento de la cola', async () => {
    const tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([okResp]) });
    tr.emit(baseEvt());
    const r = await tr.flush();
    assert.strictEqual(r.outcome, 'success');
    assert.strictEqual(tr.queueSize(), 0);
});

// 6b. idempotent/duplicate 2xx also counts as acceptance → removed
await AT('6b. respuesta duplicate (2xx) = aceptación', async () => {
    const tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([dupResp]) });
    tr.emit(baseEvt());
    const r = await tr.flush();
    assert.strictEqual(r.outcome, 'success');
    assert.strictEqual(tr.queueSize(), 0);
});

// 7. 5xx preserves event
await AT('7. 5xx conserva el evento', async () => {
    const tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([err500]) });
    tr.emit(baseEvt());
    const r = await tr.flush();
    assert.strictEqual(r.outcome, 'retryable');
    assert.strictEqual(tr.queueSize(), 1);
});

// 8. network error preserves event
await AT('8. error de red conserva el evento', async () => {
    let told = null;
    const tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([netErr]), onTelemetry: t => { told = t; } });
    tr.emit(baseEvt());
    const r = await tr.flush();
    assert.strictEqual(r.outcome, 'retryable');
    assert.strictEqual(tr.queueSize(), 1);
    assert.strictEqual(told.kind, TELEMETRY.TRANSPORT_FAILURE);
    assert.strictEqual(told.retryable, true);
});

// 9. permanent 4xx → no infinite retry, explicit state, removed with telemetry
await AT('9. 4xx permanente → sin retry infinito, estado explícito', async () => {
    const tel = [];
    const tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([err400]), onTelemetry: t => tel.push(t) });
    tr.emit(baseEvt());
    const r = await tr.flush();
    assert.strictEqual(r.outcome, 'permanent_failure');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(tr.queueSize(), 0, 'poison-pill retirado (no reintenta para siempre)');
    assert.ok(tel.some(t => t.kind === TELEMETRY.PERMANENT_FAILURE), 'telemetría explícita (no silent)');
});

// 10. bounded queue (drop-oldest with explicit overflow telemetry)
await AT('10. cola acotada con telemetría de overflow', async () => {
    const tel = [];
    const tr = createEventTransport({ storage: memStorage(), maxQueue: 3, fetchImpl: mockFetch([netErr]), onTelemetry: t => tel.push(t) });
    const ids = [];
    for (let i = 0; i < 5; i++) { const e = tr.emit(baseEvt('e' + i)).event; ids.push(e.eventId); }
    assert.strictEqual(tr.queueSize(), 3, 'cap=3');
    assert.ok(tel.some(t => t.kind === TELEMETRY.OVERFLOW), 'overflow explícito (no silent drop)');
    const q = tr.loadQueue();
    assert.ok(q.every(e => e.eventId !== ids[0]), 'se descartó el más antiguo');
});

// 11. no x-user-id header (identity = cookie)
await AT('11. no envía x-user-id', async () => {
    const fetchImpl = mockFetch([okResp]);
    const tr = createEventTransport({ storage: memStorage(), fetchImpl });
    tr.emit(baseEvt());
    await tr.flush();
    const hdrs = fetchImpl.calls[0].init.headers;
    const keys = Object.keys(hdrs).map(k => k.toLowerCase());
    assert.ok(!keys.includes('x-user-id'), 'sin x-user-id');
    assert.strictEqual(fetchImpl.calls[0].init.credentials, 'same-origin', 'usa cookie de sesión');
    // el body tampoco lleva actorId autoafirmado
    const bodyEvt = JSON.parse(fetchImpl.calls[0].body).events[0];
    assert.ok(!('actorId' in bodyEvt) && !('userId' in bodyEvt), 'sin actor autoafirmado en el body');
});

// 12. payload bound (>4KB rechazado explícito, no encolado)
await AT('12. payload >4KB rechazado explícito', async () => {
    const tel = [];
    const tr = createEventTransport({ storage: memStorage(), onTelemetry: t => tel.push(t) });
    const big = tr.createEvent({ type: 'text.big', mode: 'text', payload: { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 100) } });
    const r = tr.enqueue(big);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'payload_too_large');
    assert.strictEqual(tr.queueSize(), 0);
    assert.ok(tel.some(t => t.kind === TELEMETRY.PAYLOAD_TOO_LARGE));
});

// 13. multi-send same eventId (retry sends same id; also idempotent enqueue)
await AT('13. multi-send → mismo eventId; enqueue idempotente', async () => {
    const fetchImpl = mockFetch([err500, err500]);
    const tr = createEventTransport({ storage: memStorage(), fetchImpl });
    const e = tr.createEvent(baseEvt());
    tr.enqueue(e);
    tr.enqueue(e); // duplicado lógico → no crea segunda entrada
    assert.strictEqual(tr.queueSize(), 1, 'enqueue idempotente por eventId');
    await tr.flush();
    await tr.retryQueued();
    const ids = fetchImpl.calls.map(c => JSON.parse(c.body).events[0].eventId);
    assert.deepStrictEqual(ids, [e.eventId, e.eventId], 'ambos envíos mismo eventId');
});

// 14. no silent drop — every non-success path is observable (telemetry or queue)
await AT('14. cero silent drop', async () => {
    // network → queda en cola
    let tel = [];
    let tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([netErr]), onTelemetry: t => tel.push(t) });
    tr.emit(baseEvt()); await tr.flush();
    assert.ok(tr.queueSize() === 1 && tel.length >= 1, 'red: cola + telemetría');
    // 5xx → cola
    tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([err500]) });
    tr.emit(baseEvt()); await tr.flush();
    assert.strictEqual(tr.queueSize(), 1, '5xx: cola');
    // 4xx → telemetría explícita
    tel = [];
    tr = createEventTransport({ storage: memStorage(), fetchImpl: mockFetch([err400]), onTelemetry: t => tel.push(t) });
    tr.emit(baseEvt()); await tr.flush();
    assert.ok(tel.some(t => t.kind === TELEMETRY.PERMANENT_FAILURE), '4xx: telemetría');
    // overflow → telemetría
    tel = [];
    tr = createEventTransport({ storage: memStorage(), maxQueue: 1, fetchImpl: mockFetch([netErr]), onTelemetry: t => tel.push(t) });
    tr.emit(baseEvt('a')); tr.emit(baseEvt('b'));
    assert.ok(tel.some(t => t.kind === TELEMETRY.OVERFLOW), 'overflow: telemetría');
});

// Extra: maxBatch envía por tandas sin perder el resto
await AT('maxBatch: drena en tandas sin silent-loss', async () => {
    const fetchImpl = mockFetch([okResp, okResp]);
    const tr = createEventTransport({ storage: memStorage(), fetchImpl });
    for (let i = 0; i < 5; i++) tr.emit(baseEvt('b' + i));
    assert.strictEqual(tr.queueSize(), 5);
    const r1 = await tr.flush({ maxBatch: 2 });
    assert.strictEqual(r1.sent, 2, 'envía 2');
    assert.strictEqual(tr.queueSize(), 3, 'quedan 3');
    await tr.flush({ maxBatch: 2 });
    assert.strictEqual(tr.queueSize(), 1, 'quedan 1');
    // el primer body sólo llevó 2 eventos
    assert.strictEqual(JSON.parse(fetchImpl.calls[0].body).events.length, 2);
});

// Extra: classifyResponse unit
T('classifyResponse mapea correctamente', () => {
    assert.strictEqual(classifyResponse({ ok: true, status: 200 }), 'success');
    assert.strictEqual(classifyResponse({ networkError: true }), 'retryable');
    assert.strictEqual(classifyResponse({ status: 500 }), 'retryable');
    assert.strictEqual(classifyResponse({ status: 429 }), 'retryable');
    assert.strictEqual(classifyResponse({ status: 400 }), 'permanent');
    assert.strictEqual(classifyResponse({ status: 401 }), 'permanent');
    assert.strictEqual(classifyResponse({ status: 403 }), 'permanent');
});

// Extra: endpoint default + beacon path leaves events queued (no confirm)
await AT('beacon deja eventos en cola (server deduplica)', async () => {
    const st = memStorage();
    let beaconCalls = 0;
    const tr = createEventTransport({ storage: st, sendBeacon: () => { beaconCalls++; return true; } });
    tr.emit(baseEvt());
    const r = await tr.flush({ useBeacon: true });
    assert.strictEqual(r.outcome, 'beacon_sent');
    assert.strictEqual(beaconCalls, 1);
    assert.strictEqual(tr.queueSize(), 1, 'beacon no confirma → queda en cola');
    assert.strictEqual(tr.endpoint, DEFAULT_ENDPOINT);
});

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
