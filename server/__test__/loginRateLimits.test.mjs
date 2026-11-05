/**
 * loginRateLimits.test.mjs — G4-PILOT-LOGIN-01.
 *
 * Los tres limitadores reales de `server/lib/loginRateLimits.mjs`, con los
 * cupos de PRODUCCIÓN, montados igual que en `server.js` sobre una app mínima
 * con `trust proxy 1`. El «edge» se simula como en producción: añade la IP real
 * al FINAL de X-Forwarded-For; lo que escriba el cliente queda a la izquierda.
 *
 *   node server/__test__/loginRateLimits.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createLoginLimiters, loginLimits, loginAccountKey, LOGIN_LIMIT_MESSAGE } from '../lib/loginRateLimits.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

const PASSWORD = 'correcta-123';
function makeApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    const L = createLoginLimiters({ rateLimit, ipKeyGenerator, isProd: true });
    const validate = (req, res, next) => (typeof req.body?.email === 'string' && req.body.email.includes('@') && typeof req.body?.password === 'string'
        ? next() : res.status(400).json({ error: 'Datos inválidos' }));
    // Igual que server.js: ip, ipFailures, validate, account, handler. Respuesta genérica.
    app.post('/api/auth/login', L.ip, L.ipFailures, validate, L.account, (req, res) => (
        req.body.password === PASSWORD && !req.body.email.startsWith('nadie')
            ? res.json({ success: true }) : res.status(401).json({ error: 'Credenciales inválidas' })));
    return new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
}
async function withApp(fn) {
    const srv = await makeApp();
    try { await fn(`http://127.0.0.1:${srv.address().port}/api/auth/login`); } finally { srv.close(); }
}
/** Petición tal como la reenvía el edge: `realIp` es la que añade el edge al final. */
const login = async (url, { email, password = PASSWORD, realIp, spoof }) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': spoof ? `${spoof}, ${realIp}` : realIp },
        body: JSON.stringify({ email, password }) });
    return { s: r.status, j: await r.json().catch(() => null) };
};
const statuses = (rs) => rs.map((r) => r.s);

console.log('\n[1] política');
await t('cupos de producción: 100 por IP, 30 fallos por IP, 5 fallos por cuenta', () => {
    assert.deepEqual(loginLimits(true), { ip: 100, ipFailures: 30, account: 5 });
    assert.ok(loginLimits(false).account >= 10, 'fuera de producción no frena pruebas locales');
});
await t('la clave de cuenta es un hash del email normalizado, sin el email en claro', () => {
    const k = loginAccountKey('  Lectora@Colegio.TEST ');
    assert.equal(k, loginAccountKey('lectora@colegio.test'));
    assert.ok(!k.includes('lectora') && /^login-acct:[0-9a-f]{32}$/.test(k));
});

console.log('\n[2] aula con IP compartida');
for (const n of [10, 20, 30, 40]) {
    await t(`${n} estudiantes válidos desde una IP: todos entran`, () => withApp(async (url) => {
        const rs = [];
        for (let i = 0; i < n; i++) rs.push(await login(url, { email: `est${i}@aula.test`, realIp: '203.0.113.10' }));
        assert.ok(rs.every((r) => r.s === 200), statuses(rs).join(','));
    }));
}
await t('un aula de 30 con 15 errores de tecleo: los 30 entran', () => withApp(async (url) => {
    const rs = [];
    for (let i = 0; i < 30; i++) {
        if (i % 2 === 0) rs.push(await login(url, { email: `est${i}@aula.test`, password: 'mal', realIp: '203.0.113.11' }));
        rs.push(await login(url, { email: `est${i}@aula.test`, realIp: '203.0.113.11' }));
    }
    const ok = rs.filter((r) => r.s === 200).length;
    assert.equal(ok, 30, statuses(rs).join(','));
    assert.ok(!rs.some((r) => r.s === 429));
}));
await t('dos aulas en IP distintas no comparten cupo', () => withApp(async (url) => {
    for (let i = 0; i < 31; i++) await login(url, { email: `x${i}@a.test`, password: 'mal', realIp: '203.0.113.12' });
    assert.equal((await login(url, { email: 'otra@b.test', realIp: '203.0.113.13' })).s, 200);
}));

console.log('\n[3] abuso');
await t('varias cuentas atacadas desde una IP: tras 30 fallos, 429', () => withApp(async (url) => {
    const rs = [];
    for (let i = 0; i < 32; i++) rs.push(await login(url, { email: `victima${i}@a.test`, password: 'adivina', realIp: '198.51.100.20' }));
    assert.deepEqual(statuses(rs).slice(0, 30), Array(30).fill(401));
    assert.deepEqual(statuses(rs).slice(30), [429, 429]);
    assert.deepEqual(rs[31].j, LOGIN_LIMIT_MESSAGE);
}));
await t('una cuenta atacada desde 8 IP: tras 5 fallos, 429 en todas (también con la contraseña buena)', () => withApp(async (url) => {
    const rs = [];
    for (let i = 0; i < 8; i++) rs.push(await login(url, { email: 'objetivo@a.test', password: `p${i}`, realIp: `198.51.100.${30 + i}` }));
    assert.deepEqual(statuses(rs), [401, 401, 401, 401, 401, 429, 429, 429]);
    assert.equal((await login(url, { email: 'OBJETIVO@a.test ', realIp: '192.0.2.99' })).s, 429, 'misma cuenta normalizada');
    assert.equal((await login(url, { email: 'otra@a.test', realIp: '198.51.100.30' })).s, 200, 'el bloqueo es solo de esa cuenta');
}));
await t('los logins correctos no consumen el cupo de fallos de su cuenta', () => withApp(async (url) => {
    for (let i = 0; i < 12; i++) assert.equal((await login(url, { email: 'frecuente@a.test', realIp: '203.0.113.40' })).s, 200);
}));
await t('volumen desde una IP: más de 100 peticiones (aunque sean correctas) → 429', () => withApp(async (url) => {
    const rs = [];
    for (let i = 0; i < 102; i++) rs.push(await login(url, { email: `bot${i}@a.test`, realIp: '198.51.100.50' }));
    assert.equal(rs.filter((r) => r.s === 200).length, 100);
    assert.deepEqual(statuses(rs).slice(100), [429, 429]);
}));
await t('X-Forwarded-For falsificado por el cliente no cambia la IP contada', () => withApp(async (url) => {
    const rs = [];
    for (let i = 0; i < 32; i++) rs.push(await login(url, { email: `s${i}@a.test`, password: 'mal', realIp: '198.51.100.60', spoof: `10.0.0.${i}` }));
    assert.deepEqual(statuses(rs).slice(30), [429, 429], statuses(rs).join(','));
}));

console.log('\n[4] sin revelar qué cuentas existen');
await t('cuenta inexistente: mismo 401 y mismo bloqueo que una cuenta real', () => withApp(async (url) => {
    const real = [], fake = [];
    for (let i = 0; i < 6; i++) real.push(await login(url, { email: 'real@a.test', password: 'mal', realIp: `192.0.2.${i + 1}` }));
    for (let i = 0; i < 6; i++) fake.push(await login(url, { email: 'nadie@a.test', password: 'mal', realIp: `192.0.2.${i + 101}` }));
    assert.deepEqual(statuses(real), statuses(fake));
    assert.deepEqual(real[0].j, fake[0].j);
    assert.deepEqual(real[5].j, fake[5].j);
}));

console.log('\n[5] contrato en server.js');
const server = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
await t('la ruta monta las tres barreras en orden y valida antes de la de cuenta', () => {
    assert.match(server, /app\.post\('\/api\/auth\/login', loginLimiters\.ip, loginLimiters\.ipFailures, validate\(\{ body: loginSchema \}\), loginLimiters\.account, async/);
    assert.ok(!/const loginLimiter = rateLimit/.test(server), 'el limitador único anterior ya no existe');
});
await t('trust proxy 1: la IP es la que añade el edge', () => {
    assert.match(server, /app\.set\('trust proxy', 1\);/);
});
await t('una cuenta inexistente cuesta un bcrypt, como una contraseña incorrecta', () => {
    assert.match(server, /if \(userIndex === -1 \|\| !users\[userIndex\]\?\.id\) await bcrypt\.compare\(String\(password \?\? ''\), LOGIN_TIMING_HASH\);/);
    assert.match(server, /const LOGIN_TIMING_HASH = bcrypt\.hashSync\(crypto\.randomBytes\(24\)\.toString\('hex'\), 10\);/);
});
await t('los demás limitadores de credenciales no cambian', () => {
    for (const name of ['acceptInviteLimiter', 'resetRequestLimiter', 'resetConfirmLimiter', 'changePasswordIpLimiter', 'changePasswordAccountLimiter']) {
        assert.match(server, new RegExp(`const ${name} = rateLimit\\(`), name);
    }
});

console.log(`\nloginRateLimits: ${passed} tests OK`);
