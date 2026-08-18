/**
 * legacyAnalyticsDropGuard.test.mjs — CHP-M1A-LU-ANALYTICS-401-LOOP-MITIGATION-01.
 *
 * Mitigación temporal del loop de logout de la app Android LU: en compat,
 * header-only sobre /api/analytics/events recibe 202 accept-and-drop (sin
 * escritura, sin identidad). Todo lo demás cae al guard estricto intacto.
 * Estructural: la mitigación existe SOLO en la ruta analytics — las otras
 * tres rutas de escritura de eventos conservan el 401 estricto.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLegacyAnalyticsDropGuard } from '../lib/eventsWriteAuth.js';

const mkRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
};

const run = (mw, req = {}) => {
    const res = mkRes();
    let nexted = false;
    mw(req, res, () => { nexted = true; });
    return { res, nexted };
};

let drops = 0;
const mk = (mode, hasCookie) => createLegacyAnalyticsDropGuard({
    sessionMode: typeof mode === 'function' ? mode : () => mode,
    hasSessionCookie: typeof hasCookie === 'function' ? hasCookie : () => hasCookie,
    onDrop: () => { drops += 1; },
});

// ── caso LU: compat + x-user-id + sin cookie → 202 accept-and-drop ───────────
{
    drops = 0;
    const { res, nexted } = run(mk('compat', false), { headers: { 'x-user-id': 'u-lu' } });
    assert.equal(nexted, false, 'LU header-only NO debe llegar al guard estricto ni al handler');
    assert.equal(res.statusCode, 202, 'LU: 202 Accepted');
    assert.deepEqual(res.body, {
        ok: true, accepted: false, dropped: true,
        reason: 'legacy_android_analytics_requires_session',
    }, 'LU: cuerpo controlado de drop');
    assert.equal(drops, 1, 'LU: onDrop registrado');
}

// ── cookie-only válido → next() (el guard estricto autentica y ESCRIBE) ──────
{
    drops = 0;
    const { nexted } = run(mk('compat', true), { headers: { cookie: 'chp_session=x' } });
    assert.equal(nexted, true, 'cookie-only debe pasar al guard estricto (escritura normal)');
    assert.equal(drops, 0);
}

// ── cookie + header (mismatch o match) → next() (authenticate decide, 401 si mismatch)
{
    drops = 0;
    const { nexted } = run(mk('compat', true), { headers: { cookie: 'chp_session=x', 'x-user-id': 'uB' } });
    assert.equal(nexted, true, 'cookie∧header lo resuelve authenticate (mismatch → 401 estricto)');
    assert.equal(drops, 0);
}

// ── sin auth alguna → next() (401 del guard estricto; no es el cliente LU) ───
{
    drops = 0;
    const { nexted } = run(mk('compat', false), { headers: {} });
    assert.equal(nexted, true, 'sin header ni cookie: 401 estricto aguas abajo');
    assert.equal(drops, 0);
}

// ── off → next() puro (contrato legacy byte-idéntico) ────────────────────────
{
    drops = 0;
    const { nexted } = run(mk('off', false), { headers: { 'x-user-id': 'u1' } });
    assert.equal(nexted, true, 'off: la mitigación no existe');
    assert.equal(drops, 0);
}

// ── enforce → next() (header-only conserva el 401 estricto: sin bypass) ──────
{
    drops = 0;
    const { nexted } = run(mk('enforce', false), { headers: { 'x-user-id': 'u1' } });
    assert.equal(nexted, true, 'enforce: 401 estricto intacto, la mitigación NO aplica');
    assert.equal(drops, 0);
}

// ── error interno del predicado → next() (el guard estricto es fail-closed) ──
{
    drops = 0;
    const { nexted } = run(mk(() => { throw new Error('boom'); }, false), { headers: { 'x-user-id': 'u1' } });
    assert.equal(nexted, true, 'error del predicado: decide el guard estricto');
    assert.equal(drops, 0);
}

// ── onDrop que lanza no rompe el 202 ─────────────────────────────────────────
{
    const mw = createLegacyAnalyticsDropGuard({
        sessionMode: () => 'compat',
        hasSessionCookie: () => false,
        onDrop: () => { throw new Error('metric down'); },
    });
    const { res, nexted } = run(mw, { headers: { 'x-user-id': 'u1' } });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 202, 'métrica caída no altera el drop');
}

// ── factoría valida dependencias ─────────────────────────────────────────────
{
    assert.throws(() => createLegacyAnalyticsDropGuard({}), /obligatorios/);
}

// ── ESTRUCTURAL: la mitigación existe SOLO en /api/analytics/events ──────────
{
    const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
    const src = fs.readFileSync(serverPath, 'utf8');

    const analyticsLines = src.split('\n').filter(l => l.includes("app.post('/api/analytics/events'"));
    assert.equal(analyticsLines.length, 1, 'registro único de /api/analytics/events');
    const line = analyticsLines[0];
    assert.ok(line.includes('legacyAnalyticsAcceptAndDrop'), 'analytics lleva la mitigación');
    assert.ok(
        line.indexOf('legacyAnalyticsAcceptAndDrop') < line.indexOf('requireEventsWriteAuth'),
        'la mitigación va ANTES del guard estricto'
    );

    for (const route of ['/api/v1/events', '/api/playback-events', '/api/events']) {
        const rl = src.split('\n').filter(l => l.includes(`app.post('${route}'`));
        assert.equal(rl.length, 1, `registro único de ${route}`);
        assert.ok(
            !rl[0].includes('legacyAnalyticsAcceptAndDrop'),
            `${route} NO debe llevar la mitigación (401 estricto conservado)`
        );
        assert.ok(rl[0].includes('requireEventsWriteAuth'), `${route} conserva el guard estricto`);
    }

    assert.ok(
        src.includes('createLegacyAnalyticsDropGuard({'),
        'server.js instancia la mitigación desde la factoría del lib'
    );
}

console.log('legacyAnalyticsDropGuard.test.mjs OK — 10 escenarios + estructural');
