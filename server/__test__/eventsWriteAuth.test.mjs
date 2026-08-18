/**
 * eventsWriteAuth.test.mjs — CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01.
 *
 * Unit tests del guard de escritura de eventos. Cubre la matriz del gap:
 * cookie-only acepta, header-only rechaza (aunque compat lo aceptaría en
 * otras rutas), mismatch rechaza, off byte-neutro, fail-closed.
 */
import assert from 'node:assert';
import { createEventsWriteAuth } from '../lib/eventsWriteAuth.js';

const mkRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
};

const run = async (mw, req = {}) => {
    const res = mkRes();
    let nexted = false;
    await mw(req, res, () => { nexted = true; });
    return { res, nexted, req };
};

let failures = [];
const onFailure = (r) => failures.push(r);
const mk = (enabled, decision) => createEventsWriteAuth({
    sessionEnabled: () => enabled,
    authenticate: async () => (typeof decision === 'function' ? decision() : decision),
    onFailure,
});

// ── off: next() sin efectos (contrato legacy del handler intacto) ─────────────
{
    failures = [];
    const mw = mk(false, () => { throw new Error('authenticate NO debe llamarse en off'); });
    const { nexted, req } = await run(mw, { headers: { 'x-user-id': 'u1' } });
    assert.equal(nexted, true, 'off: debe pasar al handler');
    assert.equal(req.auth, undefined, 'off: no debe fabricar req.auth');
    assert.deepEqual(failures, [], 'off: sin métricas de fallo');
}

// ── caso A: cookie de sesión válida, sin x-user-id → ACEPTA ──────────────────
{
    failures = [];
    const mw = mk(true, {
        ok: true, userId: 'u1', authMethod: 'session',
        req_auth: { userId: 'u1', sessionId: 's1', authMethod: 'session' },
    });
    const { nexted, req } = await run(mw, { headers: {} });
    assert.equal(nexted, true, 'A: sesión válida debe aceptar');
    assert.equal(req.auth?.userId, 'u1', 'A: req.auth canónico poblado');
    assert.deepEqual(failures, []);
}

// ── caso B: sin cookie + x-user-id crudo (compat lo aceptaría) → RECHAZA ─────
{
    failures = [];
    // authenticate en compat devuelve ok con authMethod legacy — el guard lo veta.
    const mw = mk(true, {
        ok: true, userId: 'u1', authMethod: 'legacy_x_user_id',
        req_auth: { userId: 'u1', sessionId: null, authMethod: 'legacy_x_user_id' },
    });
    const { res, nexted, req } = await run(mw, { headers: { 'x-user-id': 'u1' } });
    assert.equal(nexted, false, 'B: header-only NO debe escribir eventos');
    assert.equal(res.statusCode, 401, 'B: 401');
    assert.equal(req.auth, undefined, 'B: sin identidad fabricada');
    assert.deepEqual(failures, ['session_required_event_write'], 'B: razón dedicada');
}

// ── caso C: cookie user A + x-user-id user B → authenticate ya deniega ───────
{
    failures = [];
    const mw = mk(true, { ok: false, status: 401, reason: 'subject_mismatch' });
    const { res, nexted } = await run(mw, { headers: { 'x-user-id': 'uB' } });
    assert.equal(nexted, false, 'C: mismatch no pasa');
    assert.equal(res.statusCode, 401);
    assert.deepEqual(failures, ['subject_mismatch']);
}

// ── caso D: sin auth alguna → 401 ────────────────────────────────────────────
{
    failures = [];
    const mw = mk(true, { ok: false, status: 401, reason: 'session_required' });
    const { res, nexted } = await run(mw, { headers: {} });
    assert.equal(nexted, false, 'D: sin auth no pasa');
    assert.equal(res.statusCode, 401);
    assert.deepEqual(failures, ['session_required']);
}

// ── enforce + SESSION_LEGACY_ALLOW: legacy tampoco escribe eventos ───────────
{
    failures = [];
    const mw = mk(true, {
        ok: true, userId: 'u1', authMethod: 'legacy_x_user_id',
        req_auth: { userId: 'u1', sessionId: null, authMethod: 'legacy_x_user_id' },
    });
    const { res, nexted } = await run(mw, { headers: { 'x-user-id': 'u1' } });
    assert.equal(nexted, false, 'allowlist legacy NO reabre la atribución de eventos');
    assert.equal(res.statusCode, 401);
}

// ── fail-closed: authenticate lanza → 503, jamás next() ──────────────────────
{
    failures = [];
    const mw = mk(true, () => { throw new Error('boom'); });
    const { res, nexted } = await run(mw, { headers: {} });
    assert.equal(nexted, false, 'fail-closed: no pasa');
    assert.equal(res.statusCode, 503);
    assert.deepEqual(failures, ['auth_unavailable']);
}

// ── onFailure que lanza no rompe la respuesta ────────────────────────────────
{
    const mw = createEventsWriteAuth({
        sessionEnabled: () => true,
        authenticate: async () => ({ ok: false, status: 401, reason: 'no_session' }),
        onFailure: () => { throw new Error('metric down'); },
    });
    const { res, nexted } = await run(mw, { headers: {} });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 401, 'métrica caída no altera la denegación');
}

// ── factoría valida sus dependencias ─────────────────────────────────────────
{
    assert.throws(() => createEventsWriteAuth({}), /obligatorios/);
}

console.log('eventsWriteAuth.test.mjs OK — 9 escenarios');
