/**
 * apiRateLimit.test.mjs — SEC-API-RATELIMIT-01.
 *
 * El limitador general real de `server/lib/apiRateLimit.mjs` montado como en
 * `server.js` (`app.use('/api/', limiter)`, `trust proxy 1`), con tokens
 * firmados REALES (`signSessionToken`) y un store de sesiones sintético en
 * memoria. El «edge» se simula como en producción: añade la IP real al FINAL
 * de X-Forwarded-For; lo que escriba el cliente queda a la izquierda.
 *
 * Cupos reducidos (session 20, anonymous 10) para que cada caso sea rápido;
 * la proporción con los de producción se comprueba aparte.
 *
 *   node server/__test__/apiRateLimit.test.mjs
 */
import assert from 'node:assert/strict';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createApiLimiter, createApiSubjectResolver, apiLimits, apiRateKey, API_LIMIT_MESSAGE } from '../lib/apiRateLimit.mjs';
import { loginLimits } from '../lib/loginRateLimits.mjs';
import { signSessionToken, verifySessionToken, generateSid } from '../lib/sessionToken.js';
import { parseCookies, SESSION_COOKIE } from '../lib/sessionAuth.js';

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

// express-rate-limit avisa por console.error de configuraciones peligrosas
// (ERR_ERL_*). Cualquier aviso así es un fallo del test.
const erlWarnings = [];
const origError = console.error;
console.error = (...a) => { if (a.some((x) => String(x?.code || x).includes('ERR_ERL'))) erlWarnings.push(a); else origError(...a); };

const KEY = 'k-current-' + 'x'.repeat(40);
const KEY_PREV = 'k-previous-' + 'y'.repeat(40);
const LIMITS = { session: 20, anonymous: 10 };

/** Store de sesiones sintético: sid → estado. */
function makeWorld() {
    const sessions = new Map();
    const now = () => Math.floor(Date.now() / 1000);
    const issue = (sub, { key = KEY, cv = 0, ttl = 3600, revoked = false, rowCv = cv, rowExpired = false } = {}) => {
        const sid = generateSid();
        const iat = now();
        sessions.set(sid, { revoked, expired: rowExpired, credentialVersion: rowCv });
        return { token: signSessionToken({ sub, sid, iat, exp: iat + ttl, cv }, key), sid };
    };
    return { sessions, issue, state: { mode: 'enforce', keysFail: false, storeFail: false } };
}

function makeApp(world, { limits = LIMITS, legacyKeyGen = false } = {}) {
    const app = express();
    app.set('trust proxy', 1);
    const resolveSubject = createApiSubjectResolver({
        enabled: () => world.state.mode !== 'off',
        parseCookies, cookieName: SESSION_COOKIE,
        readVerificationKeys: async () => { if (world.state.keysFail) throw new Error('no key'); return [KEY, KEY_PREV]; },
        verifySessionToken,
        getSessionState: (sid) => { if (world.state.storeFail) throw new Error('db'); return world.sessions.get(sid) || null; },
    });
    const limiter = legacyKeyGen
        // Réplica EXACTA del limitador anterior (el que tenía el defecto).
        ? rateLimit({ windowMs: 15 * 60 * 1000, max: limits.anonymous,
            keyGenerator: (req) => req.headers['x-user-id'] || ipKeyGenerator(req),
            validate: false, standardHeaders: true, legacyHeaders: false })
        : createApiLimiter({ rateLimit, ipKeyGenerator, isProd: true, resolveSubject, limits,
            skipPaths: ['/api/health', '/api/internal/uploads-authz'] });
    app.use('/api/', limiter);
    // Ruta especializada que se monta DESPUÉS del general, como login en server.js.
    const special = rateLimit({ windowMs: 60_000, limit: 3, keyGenerator: (req) => `sp:${ipKeyGenerator(req.ip)}`, standardHeaders: true, legacyHeaders: false });
    app.post('/api/special', special, (req, res) => res.json({ ok: true }));
    app.all(/.*/, (req, res) => res.json({ ok: true, path: req.path }));
    return new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
}
async function withApp(world, opts, fn) {
    const srv = await makeApp(world, opts);
    try { await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}
const req = async (base, { path = '/api/library', ip = '10.0.0.1', spoof, token, xuid, method = 'GET', cookieRaw } = {}) => {
    const h = { 'X-Forwarded-For': spoof ? `${spoof}, ${ip}` : ip };
    if (token) h.Cookie = `${SESSION_COOKIE}=${token}`;
    if (cookieRaw) h.Cookie = cookieRaw;
    if (xuid) h['x-user-id'] = xuid;
    const r = await fetch(base + path, { method, headers: h });
    const body = await r.text();
    return { s: r.status, h: r.headers, body };
};
const many = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) out.push(await fn(i)); return out; };
const count429 = (rs) => rs.filter((r) => r.s === 429).length;

console.log('\n[0] política y claves');
await t('cupos de producción: 1500 por cuenta y 1500 por IP; el general nunca es más estricto que el login por IP', () => {
    assert.deepEqual(apiLimits(true), { session: 1500, anonymous: 1500 });
    assert.ok(apiLimits(true).anonymous >= loginLimits(true).ip, 'el login (específico) debe ser el que frena primero');
    assert.ok(apiLimits(false).anonymous >= 10000, 'fuera de prod no frena las suites');
});
await t('la clave de sesión no contiene el userId en claro; la anónima es la IP', () => {
    const k = apiRateKey({ kind: 'session', userId: 'u-123' }, '1.2.3.4', ipKeyGenerator);
    assert.match(k, /^api-user:[0-9a-f]{32}$/);
    assert.ok(!k.includes('u-123'));
    assert.equal(apiRateKey({ kind: 'anonymous' }, '1.2.3.4', ipKeyGenerator), 'api-ip:1.2.3.4');
    assert.equal(apiRateKey({ kind: 'anonymous' }, '2001:db8:1:2:3::9', ipKeyGenerator), 'api-ip:2001:db8:1::/56');
});

console.log('\n[1] defecto anterior vs limitador nuevo');
await t('ANTES: 3× el cupo de tráfico anónimo desde una IP pasa entero (clave = objeto req)', async () => {
    const w = makeWorld();
    await withApp(w, { legacyKeyGen: true }, async (base) => {
        const rs = await many(30, () => req(base, { ip: '10.9.9.9' }));
        assert.equal(count429(rs), 0, 'el limitador viejo no limitaba nada anónimo');
    });
});
await t('ANTES: rotar x-user-id salta el límite', async () => {
    const w = makeWorld();
    await withApp(w, { legacyKeyGen: true }, async (base) => {
        const rs = await many(30, (i) => req(base, { ip: '10.9.9.9', xuid: `fake-${i}` }));
        assert.equal(count429(rs), 0);
    });
});
await t('AHORA: el mismo tráfico anónimo se corta en el cupo (10 pasan, 20 reciben 429)', async () => {
    const w = makeWorld();
    await withApp(w, {}, async (base) => {
        const rs = await many(30, () => req(base, { ip: '10.9.9.9' }));
        assert.equal(rs.filter((r) => r.s === 200).length, 10);
        assert.equal(count429(rs), 20);
    });
});

console.log('\n[2] aula detrás de una IP compartida');
await t('40 lectores con sesión, 15 peticiones cada uno (600, 60× el cupo anónimo): 0 × 429', async () => {
    const w = makeWorld();
    const students = Array.from({ length: 40 }, (_, i) => w.issue(`est${String(i + 1).padStart(2, '0')}`));
    await withApp(w, {}, async (base) => {
        // 40 navegadores concurrentes; cada uno, 15 peticiones seguidas (lectura, MOOK, progreso, grupos).
        const rs = (await Promise.all(students.map((s) => many(15, (k) =>
            req(base, { ip: '200.1.1.1', token: s.token, path: ['/api/library', '/api/mook/x', '/api/progress/s/c/sync', '/api/groups'][k % 4], method: k % 4 === 2 ? 'POST' : 'GET' }))))).flat();
        assert.equal(rs.length, 600);
        assert.equal(count429(rs), 0);
        const r = await req(base, { ip: '200.1.1.1', token: students[0].token });
        assert.equal(r.h.get('ratelimit-remaining'), String(LIMITS.session - 16), 'cada estudiante lleva su propio cubo');
    });
});
await t('el aula con sesión no consume el cupo anónimo de su IP (el anónimo sigue entero)', async () => {
    const w = makeWorld();
    const s = w.issue('est01');
    await withApp(w, {}, async (base) => {
        await many(20, () => req(base, { ip: '200.1.1.2', token: s.token }));
        const anon = await many(10, () => req(base, { ip: '200.1.1.2' }));
        assert.equal(count429(anon), 0);
        assert.equal((await req(base, { ip: '200.1.1.2' })).s, 429);
    });
});
await t('dos usuarios desde una IP: el abuso de uno no frena al otro', async () => {
    const w = makeWorld();
    const a = w.issue('abusador'); const b = w.issue('companera');
    await withApp(w, {}, async (base) => {
        const ra = await many(25, () => req(base, { ip: '200.1.1.3', token: a.token }));
        assert.equal(count429(ra), 5, 'la cuenta abusiva se corta en 20');
        const rb = await many(20, () => req(base, { ip: '200.1.1.3', token: b.token }));
        assert.equal(count429(rb), 0);
    });
});

console.log('\n[3] abuso autenticado');
await t('una cuenta, varias sesiones y varias IP comparten UN cupo', async () => {
    const w = makeWorld();
    const s1 = w.issue('multi'); const s2 = w.issue('multi');
    await withApp(w, {}, async (base) => {
        const rs = await many(24, (i) => req(base, { ip: `10.1.0.${i}`, token: i % 2 ? s1.token : s2.token }));
        assert.equal(rs.filter((r) => r.s === 200).length, 20);
        assert.equal(count429(rs), 4);
    });
});

console.log('\n[4] cabeceras falsificadas y suplantación');
await t('rotar x-user-id sin sesión: el cupo es el de la IP', async () => {
    const w = makeWorld();
    await withApp(w, {}, async (base) => {
        const rs = await many(15, (i) => req(base, { ip: '10.2.2.2', xuid: `u-${i}` }));
        assert.equal(count429(rs), 5);
    });
});
await t('x-user-id de la víctima no gasta su cupo', async () => {
    const w = makeWorld();
    const victim = w.issue('victima');
    await withApp(w, {}, async (base) => {
        await many(40, () => req(base, { ip: '10.3.3.3', xuid: 'victima' }));
        const rv = await many(20, () => req(base, { ip: '10.4.4.4', token: victim.token }));
        assert.equal(count429(rv), 0, 'la víctima conserva sus 20');
    });
});
await t('x-user-id distinto junto a una sesión válida no cambia el cubo', async () => {
    const w = makeWorld();
    const a = w.issue('a1'); const victim = w.issue('v1');
    await withApp(w, {}, async (base) => {
        await many(20, () => req(base, { ip: '10.5.5.5', token: a.token, xuid: 'v1' }));
        assert.equal((await req(base, { ip: '10.5.5.5', token: a.token, xuid: 'v1' })).s, 429);
        assert.equal(count429(await many(20, () => req(base, { ip: '10.6.6.6', token: victim.token }))), 0);
    });
});
await t('token falsificado (sub de la víctima, firma con otra clave) cuenta como anónimo', async () => {
    const w = makeWorld();
    const victim = w.issue('v2');
    const sid = generateSid(); w.sessions.set(sid, { revoked: false, expired: false, credentialVersion: 0 });
    const now = Math.floor(Date.now() / 1000);
    const forged = signSessionToken({ sub: 'v2', sid, iat: now, exp: now + 3600, cv: 0 }, 'clave-del-atacante');
    // Payload de la víctima con la firma de OTRO token válido.
    const mine = w.issue('atacante').token;
    const spliced = `${victim.token.split('.')[0]}.${mine.split('.')[1]}`;
    await withApp(w, {}, async (base) => {
        const rs = await many(12, (i) => req(base, { ip: '10.7.7.7', token: i % 2 ? forged : spliced }));
        assert.equal(count429(rs), 2, 'cupo anónimo de la IP');
        assert.equal(count429(await many(20, () => req(base, { ip: '10.8.8.8', token: victim.token }))), 0);
    });
});
await t('cookie basura, duplicada o mal codificada: anónimo, sin 500', async () => {
    const w = makeWorld();
    await withApp(w, {}, async (base) => {
        for (const c of [`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=a.b.c`, `${SESSION_COOKIE}=%E0%A4%A`, `${SESSION_COOKIE}=x; ${SESSION_COOKIE}=y`, 'otra=1']) {
            const r = await req(base, { ip: '10.10.10.10', cookieRaw: c });
            assert.ok([200, 429].includes(r.s), `estado ${r.s} para ${c}`);
        }
    });
});
await t('X-Forwarded-For del cliente (izquierda) no cambia el cubo: cuenta la IP del edge', async () => {
    const w = makeWorld();
    await withApp(w, {}, async (base) => {
        const rs = await many(15, (i) => req(base, { ip: '10.11.11.11', spoof: `1.1.1.${i}` }));
        assert.equal(count429(rs), 5);
    });
});

console.log('\n[5] sesiones no vivas');
for (const [name, opts] of [
    ['revocada (logout / reset)', { revoked: true }],
    ['fila expirada', { rowExpired: true }],
    ['credentialVersion distinta en el store', { rowCv: 1 }],
    ['token expirado', { ttl: -10 }],
]) {
    await t(`sesión ${name}: cuenta como anónima`, async () => {
        const w = makeWorld();
        const s = w.issue('dead', opts);
        await withApp(w, {}, async (base) => {
            const rs = await many(12, () => req(base, { ip: '10.12.12.12', token: s.token }));
            assert.equal(count429(rs), 2);
        });
    });
}
await t('sid desconocido en el store: anónimo', async () => {
    const w = makeWorld();
    const s = w.issue('ghost'); w.sessions.clear();
    await withApp(w, {}, async (base) => { assert.equal(count429(await many(11, () => req(base, { ip: '10.13.13.13', token: s.token }))), 1); });
});
await t('clave previous (rotación): sigue siendo sesión', async () => {
    const w = makeWorld();
    const s = w.issue('rot', { key: KEY_PREV });
    await withApp(w, {}, async (base) => { assert.equal(count429(await many(20, () => req(base, { ip: '10.14.14.14', token: s.token }))), 0); });
});
await t('store o clave no disponibles: anónimo (no 500, no se cae a x-user-id)', async () => {
    for (const fail of ['keysFail', 'storeFail']) {
        const w = makeWorld();
        const s = w.issue('x');
        w.state[fail] = true;
        await withApp(w, {}, async (base) => {
            const rs = await many(11, () => req(base, { ip: '10.15.15.15', token: s.token, xuid: 'x' }));
            assert.equal(count429(rs), 1, fail);
            assert.ok(rs.every((r) => [200, 429].includes(r.s)));
        });
    }
});
await t('modo de sesión off: todo por IP', async () => {
    const w = makeWorld(); w.state.mode = 'off';
    const s = w.issue('off');
    await withApp(w, {}, async (base) => { assert.equal(count429(await many(11, () => req(base, { ip: '10.16.16.16', token: s.token }))), 1); });
});

console.log('\n[6] exenciones, rutas especializadas, 429 y reinicio');
await t('/api/health y el autorizador interno de uploads nunca se limitan', async () => {
    const w = makeWorld();
    await withApp(w, {}, async (base) => {
        assert.equal(count429(await many(25, () => req(base, { ip: '10.17.17.17', path: '/api/health' }))), 0);
        assert.equal(count429(await many(25, () => req(base, { ip: '10.17.17.17', path: '/api/internal/uploads-authz' }))), 0);
        assert.equal(count429(await many(10, () => req(base, { ip: '10.17.17.17' }))), 0, 'las exenciones no gastan cupo');
    });
});
await t('el limitador específico sigue actuando por debajo del general', async () => {
    const w = makeWorld();
    await withApp(w, {}, async (base) => {
        const rs = await many(5, () => req(base, { ip: '10.18.18.18', path: '/api/special', method: 'POST' }));
        assert.deepEqual(rs.map((r) => r.s), [200, 200, 200, 429, 429]);
    });
});
await t('429 coherente: JSON, RateLimit-* estándar, Retry-After, sin cabeceras X-RateLimit legacy ni identidad', async () => {
    const w = makeWorld();
    const s = w.issue('hdr-user');
    await withApp(w, {}, async (base) => {
        const ok = await req(base, { ip: '10.19.19.19', token: s.token });
        assert.equal(ok.h.get('ratelimit-limit'), '20');
        assert.equal(ok.h.get('ratelimit-remaining'), '19');
        const anonOk = await req(base, { ip: '10.19.19.19' });
        assert.equal(anonOk.h.get('ratelimit-limit'), '10');
        await many(19, () => req(base, { ip: '10.19.19.19', token: s.token }));
        const r = await req(base, { ip: '10.19.19.19', token: s.token });
        assert.equal(r.s, 429);
        assert.deepEqual(JSON.parse(r.body), API_LIMIT_MESSAGE);
        assert.ok(Number(r.h.get('retry-after')) > 0);
        assert.equal(r.h.get('x-ratelimit-limit'), null);
        const all = [...r.h.entries()].map(([k, v]) => `${k}:${v}`).join('\n') + r.body;
        assert.ok(!all.includes('hdr-user'), 'el 429 no revela el userId');
    });
});
await t('reinicio de una réplica: contador en memoria a cero (techo por réplica, documentado)', async () => {
    const w = makeWorld();
    await withApp(w, {}, async (base) => { assert.equal(count429(await many(11, () => req(base, { ip: '10.20.20.20' }))), 1); });
    await withApp(w, {}, async (base) => { assert.equal(count429(await many(10, () => req(base, { ip: '10.20.20.20' }))), 0); });
});
await t('dos réplicas: cada una aplica su cupo; el techo efectivo es 2× y sigue acotado', async () => {
    const w = makeWorld();
    const srvA = await makeApp(w); const srvB = await makeApp(w);
    try {
        const A = `http://127.0.0.1:${srvA.address().port}`; const B = `http://127.0.0.1:${srvB.address().port}`;
        const rs = await many(30, (i) => req(i % 2 ? A : B, { ip: '10.21.21.21' }));
        assert.equal(rs.filter((r) => r.s === 200).length, 20);
    } finally { srvA.close(); srvB.close(); }
});

console.log('\n[7] copia corta de las claves (V7-LOGIN-RELEASE-01)');
function keyedResolver({ ttl = 5000 } = {}) {
    const st = { reads: 0, keys: [KEY], fail: false, t: 1_000_000 };
    const sessions = new Map();
    const resolve = createApiSubjectResolver({
        enabled: () => true, parseCookies, cookieName: SESSION_COOKIE, verifySessionToken,
        readVerificationKeys: async () => { st.reads++; if (st.fail) throw new Error('no key'); return st.keys; },
        getSessionState: (sid) => sessions.get(sid) || null,
        keysTtlMs: ttl, now: () => st.t,
    });
    const issue = (sub, key = KEY) => {
        const sid = generateSid(); const iat = Math.floor(Date.now() / 1000);
        sessions.set(sid, { revoked: false, expired: false, credentialVersion: 0 });
        return { headers: { cookie: `${SESSION_COOKIE}=${signSessionToken({ sub, sid, iat, exp: iat + 3600, cv: 0 }, key)}` } };
    };
    return { st, resolve, issue };
}
await t('dentro del TTL: 500 peticiones con sesión, UNA lectura de claves', async () => {
    const { st, resolve, issue } = keyedResolver();
    const r = issue('cache-u');
    for (let i = 0; i < 500; i++) assert.equal((await resolve(r)).kind, 'session');
    assert.equal(st.reads, 1);
});
await t('sin cookie no se leen claves', async () => {
    const { st, resolve } = keyedResolver();
    for (let i = 0; i < 50; i++) await resolve({ headers: {} });
    assert.equal(st.reads, 0);
});
await t('al vencer el TTL se relee', async () => {
    const { st, resolve, issue } = keyedResolver();
    const r = issue('cache-u');
    await resolve(r); st.t += 4999; await resolve(r); assert.equal(st.reads, 1);
    st.t += 2; await resolve(r); assert.equal(st.reads, 2);
});
await t('un fallo de lectura no se guarda: anónimo y reintento en la siguiente', async () => {
    const { st, resolve, issue } = keyedResolver();
    const r = issue('cache-u');
    st.fail = true;
    assert.equal((await resolve(r)).kind, 'anonymous');
    assert.equal((await resolve(r)).kind, 'anonymous');
    assert.equal(st.reads, 2, 'cada petición reintenta mientras falla');
    st.fail = false;
    assert.equal((await resolve(r)).kind, 'session');
    await resolve(r);
    assert.equal(st.reads, 3);
});
await t('rotación: la clave nueva vale como sesión tras ≤ TTL; antes cuenta como anónimo, nunca como otra cuenta', async () => {
    const { st, resolve, issue } = keyedResolver();
    await resolve(issue('pre'));
    const NEW = 'k-rotated-' + 'z'.repeat(40);
    st.keys = [NEW, KEY];
    const fresh = issue('post-rot', NEW);
    assert.equal((await resolve(fresh)).kind, 'anonymous', 'dentro del TTL aún no conoce la clave nueva');
    st.t += 5001;
    const s = await resolve(fresh);
    assert.equal(s.kind, 'session'); assert.equal(s.userId, 'post-rot');
});

assert.equal(erlWarnings.length, 0, `express-rate-limit avisó: ${JSON.stringify(erlWarnings.map((a) => String(a[0]?.code || a[0])))}`);
console.error = origError;
console.log(`\napiRateLimit: ${passed} pruebas OK`);
