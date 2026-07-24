/**
 * adminSecretExpress.test.js — CHP-SEC-ADMIN-FILE-01B-R2
 *
 * Valida los cuatro consumidores productivos DENTRO DE EXPRESS real (no un
 * adaptador node:http). Importa la MISMA factoría `createAdminAuth` que usa
 * server.js, monta los consumidores como middleware/handlers en una app Express
 * real, escucha en 127.0.0.1:puerto-aleatorio y envía requests HTTP reales.
 *
 * El secreto se lee SIEMPRE de la ruta canónica real /app/secrets/admin_secret
 * (helper file-only, no inyectable). Sólo sesión/usuarios son dobles sintéticos.
 *
 * Run (Linux; requiere express resoluble + /app/secrets tmpfs propiedad del
 * proceso, modo 0400). En win32 o sin ese entorno se auto-omite (skip).
 *   node server/__test__/adminSecretExpress.test.js
 */
import fs from 'node:fs';
import express from 'express';
import { createAdminAuth } from '../lib/adminAuth.js';
import { ADMIN_SECRET_PATH } from '../lib/adminSecret.js';

let pass = 0;
let fail = 0;
const okc = (label, cond, detail = '') => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};
const section = (l) => console.log(`\n${l}`);

const SENTINEL = 'SENTINEL-ENV-NEVER-RETURNED-4443332221110009998';
const SECRET_A = 'EXPR-secret-alpha-0123456789abcdefghijklmn';
const SECRET_B = 'EXPR_secret_bravo_zyxwvutsrqponmlkjihgfedc';
const CANON = ADMIN_SECRET_PATH;
const DIR = CANON.slice(0, CANON.lastIndexOf('/'));

function stageCanonical(content) {
    const tmp = `${DIR}/.stage-express`;
    fs.writeFileSync(tmp, content);
    fs.chmodSync(tmp, 0o400);
    fs.renameSync(tmp, CANON);
}
function removeCanonical() { try { fs.chmodSync(CANON, 0o600); } catch {} try { fs.unlinkSync(CANON); } catch {} }

// ── Dobles de sesión sintéticos (NO el secreto) ──────────────────────────────
const SYNTH_USERS = [
    { id: 'u-admin', roles: ['administrador'], accountStatus: 'active' },
    { id: 'u-plain', roles: ['lector'], accountStatus: 'active' },
];
const logs = [];
const auth = createAdminAuth({
    readUsers: () => SYNTH_USERS,
    isUserActive: (u) => u?.accountStatus === 'active',
    log: (m) => { logs.push(String(m)); },
});

// ── Instrumentación externa: contador de open() de la ruta canónica ──────────
const realOpen = fs.promises.open;
let opens = 0;
let spyOn = false;
fs.promises.open = function (p, ...rest) {
    if (spyOn && p === CANON) opens += 1;
    return realOpen.call(this, p, ...rest);
};

// ── App Express real con los consumidores productivos ────────────────────────
let handlerHits = 0;
const okHandler = (req, res) => { handlerHits += 1; res.status(200).json({ authorized: true }); };

function buildApp() {
    const app = express();
    app.get('/health', (req, res) => res.status(200).json({ ok: true })); // ruta neutra sin auth
    app.all('/admin-access', auth.requireAdminAccess, okHandler);
    app.all('/auth', auth.requireAuth, okHandler);
    // Ruta que ejerce isAdminRequest como lo hacen los handlers productivos.
    app.get('/is-admin', async (req, res) => {
        const v = await auth.isAdminRequest(req);
        res.status(200).json({ isAdmin: v, typeofV: typeof v });
    });
    return app;
}

async function req(port, path, { method = 'GET', headers = {} } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

console.log('adminSecretExpress — consumidores reales dentro de Express');
console.log(`  runtime: ${process.platform} node ${process.version} express ${express.version || '5.x'} uid=${process.getuid?.()}`);

let CAN_STAGE = false;
try {
    fs.mkdirSync(DIR, { recursive: true });
    stageCanonical(SECRET_A);
    removeCanonical();
    CAN_STAGE = process.platform === 'linux';
} catch { CAN_STAGE = false; }

if (!CAN_STAGE) {
    console.log('\n  [SKIP] sin /app/secrets tmpfs escribible propiedad del proceso (diseñado para el runner).');
    console.log(`\nadminSecretExpress — pass=${pass} fail=${fail} (SKIPPED)`);
    process.exit(0);
}

let server = null;
try {
    const beforeEnv = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = SENTINEL; // env poblado — jamás debe usarse

    // ─────────────── FASE 3 — import/app/startup sin lectura ────────────────
    section('[3] import, creación de app y startup SIN lectura del secreto');
    {
        removeCanonical();
        spyOn = true; opens = 0;
        // import productivo fresco bajo el spy → 0 lecturas en import
        await import(`../lib/adminAuth.js?fresh=${Date.now()}`);
        okc('[3.1-2] import de adminAuth (y deps) → 0 open()', opens === 0, `opens=${opens}`);

        opens = 0;
        const app = buildApp();
        okc('[3.3] creación de la app Express → 0 open()', opens === 0, `opens=${opens}`);

        server = app.listen(0, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        const port = server.address().port;
        okc('[3.4] listener iniciado sin fallo (sin archivo)', typeof port === 'number' && port > 0);

        opens = 0;
        let r = await req(port, '/health');
        okc('[3.5] ruta neutra /health → 200 y 0 open()', r.status === 200 && r.body.ok === true && opens === 0, `opens=${opens}`);

        opens = 0;
        r = await req(port, '/admin-access', { method: 'POST' }); // sin header
        okc('[3.6] request sin x-admin-secret → 0 open()', opens === 0, `opens=${opens}`);

        stageCanonical(SECRET_A);
        opens = 0;
        r = await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        okc('[3.7] primer request con candidato → exactamente 1 open()', opens === 1, `opens=${opens}`);
        okc('[3.7] y autoriza (200)', r.status === 200 && r.body.authorized === true);
        spyOn = false;

        server.close(); server = null;
    }

    // ─────────────── FASE 4 — matriz Express real ──────────────────────────
    const app = buildApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;
    const denyAdmin = 'Unauthorized: se requiere admin secret o sesión de administrador';
    const denyAuth = 'Unauthorized: Invalid Admin Secret';
    const denySession = 'No autorizado: se requiere sesión activa';

    section('[4A] requireAdminAccess (Express)');
    {
        stageCanonical(SECRET_A);
        handlerHits = 0;
        let r = await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        okc('[4A] header correcto → 200', r.status === 200 && r.body.authorized === true);
        okc('[4A] handler alcanzado exactamente una vez (next 1x, sin doble)', handlerHits === 1, `hits=${handlerHits}`);

        r = await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_B } });
        okc('[4A] header incorrecto → 401 exacto', r.status === 401 && r.body.error === denyAdmin);

        r = await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_B, 'x-user-id': 'u-admin' } });
        okc('[4A] header inválido + sesión admin válida → 200 (sesión conservada)', r.status === 200 && r.body.authorized === true);

        removeCanonical();
        r = await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        okc('[4A] archivo ausente + sin sesión → 401 exacto', r.status === 401 && r.body.error === denyAdmin);
        r = await req(port, '/admin-access', { method: 'POST', headers: { 'x-user-id': 'u-admin' } });
        okc('[4A] archivo ausente + sesión admin válida → 200', r.status === 200 && r.body.authorized === true);
    }

    section('[4B] requireAuth (Express)');
    {
        stageCanonical(SECRET_A);
        let r = await req(port, '/auth', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        okc('[4B] header correcto → 200', r.status === 200 && r.body.authorized === true);
        r = await req(port, '/auth', { method: 'POST', headers: { 'x-admin-secret': SECRET_B } });
        okc('[4B] header incorrecto → 401 exacto', r.status === 401 && r.body.error === denyAuth);
        r = await req(port, '/auth', { method: 'GET', headers: { 'x-user-id': 'u-plain' } });
        okc('[4B] GET + sesión ordinaria → 200', r.status === 200 && r.body.authorized === true);
        stageCanonical(SECRET_A); fs.chmodSync(CANON, 0o644);
        r = await req(port, '/auth', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        okc('[4B] archivo inseguro + sin sesión → 401', r.status === 401 && r.body.error === denyAuth);
        fs.chmodSync(CANON, 0o400);
    }

    section('[4C] getRequestHasValidPrincipal (vía GET) e [4D] isAdminRequest');
    {
        stageCanonical(SECRET_A);
        let r = await req(port, '/admin-access', { method: 'GET', headers: { 'x-admin-secret': SECRET_A } });
        okc('[4C] GET header correcto → 200', r.status === 200);
        r = await req(port, '/admin-access', { method: 'GET', headers: { 'x-admin-secret': SECRET_B } });
        okc('[4C] GET incorrecto + sin sesión → 401', r.status === 401 && r.body.error === denySession);
        r = await req(port, '/admin-access', { method: 'GET', headers: { 'x-user-id': 'u-plain' } });
        okc('[4C] GET sesión ordinaria → 200', r.status === 200);

        r = await req(port, '/is-admin', { headers: { 'x-admin-secret': SECRET_A } });
        okc('[4D] isAdminRequest header correcto → true (boolean)', r.body.isAdmin === true && r.body.typeofV === 'boolean');
        r = await req(port, '/is-admin', { headers: { 'x-admin-secret': SECRET_B } });
        okc('[4D] isAdminRequest incorrecto → false', r.body.isAdmin === false);
        r = await req(port, '/is-admin', {});
        okc('[4D] isAdminRequest sin header → false', r.body.isAdmin === false);
        removeCanonical();
        r = await req(port, '/is-admin', { headers: { 'x-admin-secret': SECRET_A } });
        okc('[4D] isAdminRequest archivo ausente → false (200, sin 5xx)', r.status === 200 && r.body.isAdmin === false);
    }

    section('[4E] headers vía Express (contrato OWS ratificado)');
    {
        stageCanonical(SECRET_A);
        okc('[4E] ausente → 401', (await req(port, '/admin-access', { method: 'POST', headers: {} })).status === 401);
        okc('[4E] vacío → 401', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': '' } })).status === 401);
        okc('[4E] incorrecto → 401', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': 'nope' } })).status === 401);
        okc('[4E] canónico → 200', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status === 200);
        // OWS exterior: Express/Node lo normaliza; el valor observado es el canónico exacto.
        const ows = await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': `  ${SECRET_A}  ` } });
        okc('[4E] canónico con OWS exterior (normalizado por Express) → 200', ows.status === 200);
        okc('[4E] espacio interno → 401', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': `${SECRET_A.slice(0, 8)} ${SECRET_A.slice(8)}` } })).status === 401);
        okc('[4E] con coma → 401', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': `${SECRET_A},x` } })).status === 401);
        const dup = await fetch(`http://127.0.0.1:${port}/admin-access`, { method: 'POST', headers: [['x-admin-secret', SECRET_A], ['x-admin-secret', SECRET_A]] });
        okc('[4E] duplicado (unido por coma) → 401', dup.status === 401);
        okc('[4E] excesivamente largo → 401', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': 'z'.repeat(3000) } })).status === 401);
    }

    section('[4F] errores del archivo (Express) + A/B + no filtración');
    {
        const linkSrc = `${DIR}/real_secret_expr`;
        const cases = [];
        removeCanonical();
        cases.push(['FILE_MISSING', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status]);
        fs.writeFileSync(linkSrc, SECRET_A); fs.chmodSync(linkSrc, 0o400); fs.symlinkSync(linkSrc, CANON);
        cases.push(['SYMLINK_REJECTED', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status]);
        fs.unlinkSync(CANON);
        stageCanonical(SECRET_A); fs.chmodSync(CANON, 0o644);
        cases.push(['INVALID_MODE', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status]);
        fs.chmodSync(CANON, 0o400);
        try {
            stageCanonical(SECRET_A); fs.chownSync(CANON, 65534, 65534);
            cases.push(['INVALID_OWNER', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status]);
            try { fs.chownSync(CANON, process.getuid(), process.getgid()); } catch {}
        } catch { cases.push(['INVALID_OWNER(skip-no-root)', 401]); }
        stageCanonical(`${SECRET_A.slice(0, 8)} ${SECRET_A.slice(8)}`);
        cases.push(['INVALID_FORMAT', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': `${SECRET_A.slice(0, 8)} ${SECRET_A.slice(8)}` } })).status]);
        removeCanonical();
        fs.writeFileSync(CANON, Buffer.concat([Buffer.from('w'.repeat(40)), Buffer.from([0xff, 0xfe])])); fs.chmodSync(CANON, 0o400);
        cases.push(['INVALID_UTF8', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status]);
        const allDeny = cases.every(([, s]) => s === 401);
        okc(`[4F] todos los errores → 401 sin 5xx: ${cases.map(([n, s]) => `${n}=${s}`).join(' ')}`, allDeny);
        try { fs.unlinkSync(linkSrc); } catch {}

        // A/B por requests
        stageCanonical(SECRET_A);
        okc('[4L] A→200', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status === 200);
        stageCanonical(SECRET_B);
        okc('[4L] tras rename B: A→401', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status === 401);
        okc('[4L] B→200', (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SECRET_B } })).status === 200);
        let good = 0;
        for (let i = 0; i < 10; i++) {
            const cur = i % 2 === 0 ? SECRET_A : SECRET_B;
            const other = i % 2 === 0 ? SECRET_B : SECRET_A;
            stageCanonical(cur);
            const rc = (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': cur } })).status === 200;
            const ro = (await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': other } })).status === 401;
            if (rc && ro) good++;
        }
        okc('[4L] 10 alternancias A/B por request', good === 10, `ok=${good}/10`);

        // No filtración
        stageCanonical(`${SENTINEL}-in-file`); fs.chmodSync(CANON, 0o644);
        const r = await req(port, '/admin-access', { method: 'POST', headers: { 'x-admin-secret': SENTINEL } });
        const blob = JSON.stringify(r.body);
        okc('[4M] respuesta sin sentinel / ruta / Error.code / stack', !blob.includes(SENTINEL) && !blob.includes('/app/secrets') && !/FILE_|INVALID_|at \//.test(blob), blob);
        okc('[4M] logs sin sentinel', !logs.join('|').includes(SENTINEL));
        fs.chmodSync(CANON, 0o400);
    }

    if (beforeEnv === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = beforeEnv;
} finally {
    if (server) { try { server.close(); } catch {} }
    fs.promises.open = realOpen;
    removeCanonical();
    console.log(`\n  ruta canónica limpia: ${!fs.existsSync(CANON)}`);
}

console.log(`\nadminSecretExpress — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
