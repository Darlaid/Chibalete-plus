/**
 * adminSecretHttp.test.js — CHP-SEC-ADMIN-FILE-01B-R1
 *
 * Prueba HTTP REAL de los cuatro consumidores productivos (`getRequestHasValidPrincipal`,
 * `requireAdminAccess`, `requireAuth`, `isAdminRequest`) construidos por la MISMA
 * factoría `createAdminAuth` que usa server.js. Las requests atraviesan sockets
 * reales (node:http + fetch, sin dependencias externas para máximo aislamiento).
 *
 * El secreto se lee SIEMPRE de la ruta canónica real /app/secrets/admin_secret
 * (helper file-only, no inyectable). Sólo la sesión/autenticación ordinaria usa
 * dobles sintéticos (usuarios en memoria) — permitido por FILE-01B-R1 FASE 2.
 *
 * Run (Linux; /app/secrets tmpfs privado propiedad del proceso, modo 0400):
 *   node server/__test__/adminSecretHttp.test.js
 * En win32 o sin ese tmpfs escribible se auto-omite (skip), sin seam ni fallback.
 */
import fs from 'node:fs';
import http from 'node:http';
import { createAdminAuth } from '../lib/adminAuth.js';
import { ADMIN_SECRET_PATH } from '../lib/adminSecret.js';

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(l) { console.log(`\n${l}`); }

const SENTINEL = 'SENTINEL-ENV-NEVER-RETURNED-1112223334445556667';
const SECRET_A = 'HTTP-secret-alpha-0123456789abcdefghijklmn';
const SECRET_B = 'HTTP_secret_bravo_zyxwvutsrqponmlkjihgfedc';

const CANON = ADMIN_SECRET_PATH;
const DIR = CANON.slice(0, CANON.lastIndexOf('/'));

function stageCanonical(content) {
    const tmp = `${DIR}/.stage-http`;
    fs.writeFileSync(tmp, content);
    fs.chmodSync(tmp, 0o400);
    fs.renameSync(tmp, CANON);
}
function removeCanonical() { try { fs.chmodSync(CANON, 0o600); } catch {} try { fs.unlinkSync(CANON); } catch {} }

// ── Dobles de sesión sintéticos (autenticación ordinaria; NO el secreto) ──────
const SYNTH_USERS = [
    { id: 'u-admin', roles: ['administrador'], accountStatus: 'active' },
    { id: 'u-plain', roles: ['lector'], accountStatus: 'active' },
    { id: 'u-inactive', roles: ['administrador'], accountStatus: 'disabled' },
];
const readUsers = () => SYNTH_USERS;
const isUserActive = (user) => user?.accountStatus === 'active';
const logs = [];
const log = (msg) => { logs.push(String(msg)); };

// Los MISMOS consumidores que construye server.js.
const auth = createAdminAuth({ readUsers, isUserActive, log });

// ── Harness node:http: monta un middleware real y expone el resultado ─────────
// Adaptamos req/res al mínimo contrato Express que usan los consumidores.
function mountServer(middleware, terminal) {
    return http.createServer((req, res) => {
        let statusCode = 200;
        let bodyObj = null;
        let nextCalled = 0;
        let responded = 0;
        // Shims Express-compatibles mínimos (no reimplementan el consumidor).
        req.path = req.url.split('?')[0];
        req.ip = req.socket.remoteAddress;
        const shim = {
            status(c) { statusCode = c; return shim; },
            json(o) {
                responded++;
                bodyObj = o;
                res.statusCode = statusCode;
                res.setHeader('content-type', 'application/json');
                res.setHeader('x-responded-count', String(responded));
                res.end(JSON.stringify({ ...o, __status: statusCode }));
            },
        };
        const next = () => {
            nextCalled++;
            // terminal simula el handler protegido: responde 200 "authorized".
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.setHeader('x-next-count', String(nextCalled));
            res.end(JSON.stringify({ authorized: true, next: nextCalled, __status: 200 }));
        };
        Promise.resolve(middleware(req, shim, next)).catch((e) => {
            // Un rechazo NO manejado se convertiría aquí en 500: lo detectamos.
            res.statusCode = 599;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ unhandled: true, msg: String(e?.code || e?.name || 'err'), __status: 599 }));
        });
    });
}

async function listen(server) {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return server.address().port;
}
async function call(port, { method = 'GET', headers = {} } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}/api/test`, { method, headers });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, nextCount: res.headers.get('x-next-count'), respCount: res.headers.get('x-responded-count') };
}

console.log('adminSecretHttp — consumidores reales vía HTTP');
console.log(`  runtime: ${process.platform} node ${process.version} uid=${process.getuid?.()} gid=${process.getgid?.()}`);

let CAN_STAGE = false;
try {
    fs.mkdirSync(DIR, { recursive: true });
    stageCanonical(SECRET_A);
    removeCanonical();
    CAN_STAGE = process.platform === 'linux';
} catch { CAN_STAGE = false; }

if (!CAN_STAGE) {
    console.log('\n  [SKIP] sin /app/secrets tmpfs escribible propiedad del proceso (diseñado para el runner).');
    console.log(`\nadminSecretHttp — pass=${pass} fail=${fail} (SKIPPED)`);
    process.exit(0);
}

const servers = [];
function srv(mw) { const s = mountServer(mw); servers.push(s); return s; }

try {
    const beforeEnv = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = SENTINEL; // env poblado — jamás debe usarse

    // ───────────────────────────── A. requireAdminAccess (non-GET) ───────────
    section('[A] requireAdminAccess — HTTP real');
    {
        const p = await listen(srv(auth.requireAdminAccess));

        stageCanonical(SECRET_A);
        let r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[A1] archivo válido + header correcto → 200 authorized', r.status === 200 && r.body.authorized === true);
        ok('[A7] next() exactamente una vez', r.nextCount === '1');

        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_B } });
        ok('[A2] header incorrecto → 401 body exacto', r.status === 401 && r.body.error === 'Unauthorized: se requiere admin secret o sesión de administrador');

        r = await call(p, { method: 'POST', headers: {} });
        ok('[A3] sin header + sin sesión → 401 exacto', r.status === 401 && r.body.error === 'Unauthorized: se requiere admin secret o sesión de administrador');

        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_B, 'x-user-id': 'u-admin' } });
        ok('[A4] header inválido + sesión admin válida → 200 (sesión conservada)', r.status === 200 && r.body.authorized === true);

        removeCanonical();
        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[A5] archivo ausente + candidato + sin sesión → 401 exacto', r.status === 401 && r.body.error === 'Unauthorized: se requiere admin secret o sesión de administrador');
        ok('[A5] sin respuesta doble', r.respCount === null || r.respCount === '1');

        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A, 'x-user-id': 'u-admin' } });
        ok('[A6] archivo ausente + sesión admin válida → 200 (sesión conservada)', r.status === 200 && r.body.authorized === true);

        r = await call(p, { method: 'POST', headers: { 'x-user-id': 'u-inactive' } });
        ok('[A] sesión admin inactiva → 401', r.status === 401);
    }

    // ───────────────────────────── B. requireAuth (non-GET) ──────────────────
    section('[B] requireAuth — HTTP real');
    {
        const p = await listen(srv(auth.requireAuth));

        stageCanonical(SECRET_A);
        let r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[B1] header correcto → 200 authorized', r.status === 200 && r.body.authorized === true);
        ok('[B7] next() exactamente una vez', r.nextCount === '1');

        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_B } });
        ok('[B4] header incorrecto → 401 body exacto', r.status === 401 && r.body.error === 'Unauthorized: Invalid Admin Secret');

        // requireAuth non-GET NO tiene camino de sesión: sólo el secreto.
        r = await call(p, { method: 'POST', headers: { 'x-user-id': 'u-admin' } });
        ok('[B] non-GET sin header → 401 (requireAuth no admite sesión en non-GET)', r.status === 401 && r.body.error === 'Unauthorized: Invalid Admin Secret');

        // GET sí admite sesión ordinaria (allowAuthenticatedGetOrReject).
        r = await call(p, { method: 'GET', headers: { 'x-user-id': 'u-plain' } });
        ok('[B2] GET + sesión ordinaria válida → 200 (sin leer archivo)', r.status === 200 && r.body.authorized === true);

        r = await call(p, { method: 'GET', headers: {} });
        ok('[B] GET sin credencial → 401 sesión', r.status === 401 && r.body.error === 'No autorizado: se requiere sesión activa');

        // archivo inseguro + sin sesión → 401 (fail-closed)
        stageCanonical(SECRET_A); fs.chmodSync(CANON, 0o644);
        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[B6] archivo inseguro + sin sesión → 401 exacto', r.status === 401 && r.body.error === 'Unauthorized: Invalid Admin Secret');
        fs.chmodSync(CANON, 0o400);
    }

    // ───────────────────────────── C. getRequestHasValidPrincipal (vía GET middleware) ──
    section('[C] getRequestHasValidPrincipal (vía requireAdminAccess GET)');
    {
        const p = await listen(srv(auth.requireAdminAccess)); // GET → usa getRequestHasValidPrincipal
        stageCanonical(SECRET_A);
        let r = await call(p, { method: 'GET', headers: { 'x-admin-secret': SECRET_A } });
        ok('[C2] GET header correcto → principal válido (200)', r.status === 200 && r.body.authorized === true);
        r = await call(p, { method: 'GET', headers: { 'x-admin-secret': SECRET_B } });
        ok('[C3] GET header incorrecto + sin sesión → 401', r.status === 401 && r.body.error === 'No autorizado: se requiere sesión activa');
        r = await call(p, { method: 'GET', headers: { 'x-user-id': 'u-plain' } });
        ok('[C4] GET sesión ordinaria válida → 200', r.status === 200 && r.body.authorized === true);
        removeCanonical();
        r = await call(p, { method: 'GET', headers: { 'x-admin-secret': SECRET_A } });
        ok('[C5] archivo ausente → sin rechazo no manejado (401, no 599)', r.status === 401);
    }

    // ───────────────────────────── D. isAdminRequest (Promise<boolean>) ──────
    section('[D] isAdminRequest — símbolo productivo real');
    {
        ok('[D5] es async (constructor AsyncFunction)', auth.isAdminRequest.constructor.name === 'AsyncFunction');
        stageCanonical(SECRET_A);
        ok('[D1] header correcto → true', (await auth.isAdminRequest({ headers: { 'x-admin-secret': SECRET_A } })) === true);
        ok('[D2] header incorrecto → false', (await auth.isAdminRequest({ headers: { 'x-admin-secret': SECRET_B } })) === false);
        ok('[D3] sin header → false', (await auth.isAdminRequest({ headers: {} })) === false);
        removeCanonical();
        let threw = false; let v;
        try { v = await auth.isAdminRequest({ headers: { 'x-admin-secret': SECRET_A } }); } catch { threw = true; }
        ok('[D4] error del helper → false sin throw', v === false && !threw);
        // Truthiness accidental: el Promise SIN await es truthy; con await es false.
        const promise = auth.isAdminRequest({ headers: {} });
        ok('[D6] Promise crudo es truthy (por eso los call sites await)', !!promise === true);
        ok('[D6] await → false', (await promise) === false);
    }

    // ───────────────────────────── E. Headers (HTTP real) ────────────────────
    section('[E] variantes de header vía HTTP');
    {
        const p = await listen(srv(auth.requireAdminAccess));
        stageCanonical(SECRET_A);
        const deny = 'Unauthorized: se requiere admin secret o sesión de administrador';
        ok('[E] ausente → 401', (await call(p, { method: 'POST', headers: {} })).status === 401);
        ok('[E] vacío → 401', (await call(p, { method: 'POST', headers: { 'x-admin-secret': '' } })).status === 401);
        ok('[E] incorrecto → 401', (await call(p, { method: 'POST', headers: { 'x-admin-secret': 'nope' } })).status === 401);
        ok('[E] correcto → 200', (await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status === 200);
        // duplicado: fetch une con coma → "A, A" ≠ A → 401
        const dup = await fetch(`http://127.0.0.1:${p}/api/test`, { method: 'POST', headers: [['x-admin-secret', SECRET_A], ['x-admin-secret', SECRET_A]] });
        ok('[E] duplicado (unido por coma) → 401', dup.status === 401);
        // HTTP recorta el whitespace circundante (RFC 9110 OWS): " A " se transporta
        // como "A" exacto y autoriza. El espacio circundante nunca llega como tal.
        ok('[E] espacios circundantes recortados por HTTP → 200 (valor canónico)', (await call(p, { method: 'POST', headers: { 'x-admin-secret': ` ${SECRET_A} ` } })).status === 200);
        // Un espacio INTERNO sí produce un valor distinto → rechazado.
        ok('[E] espacio interno → 401', (await call(p, { method: 'POST', headers: { 'x-admin-secret': `${SECRET_A.slice(0, 8)} ${SECRET_A.slice(8)}` } })).status === 401);
        ok('[E] con coma → 401', (await call(p, { method: 'POST', headers: { 'x-admin-secret': `${SECRET_A},x` } })).status === 401);
        ok('[E] excesivamente largo → 401', (await call(p, { method: 'POST', headers: { 'x-admin-secret': 'z'.repeat(3000) } })).status === 401);
    }

    // ───────────────────────────── F. errores del archivo a nivel consumidor ─
    section('[F] matriz de errores del archivo vía HTTP');
    {
        const p = await listen(srv(auth.requireAdminAccess));
        const deny = 'Unauthorized: se requiere admin secret o sesión de administrador';
        const linkSrc = `${DIR}/real_secret_f`;

        // FILE_MISSING
        removeCanonical();
        let r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[F] FILE_MISSING → 401, sin 599', r.status === 401 && r.body.error === deny);

        // SYMLINK_REJECTED
        fs.writeFileSync(linkSrc, SECRET_A); fs.chmodSync(linkSrc, 0o400);
        fs.symlinkSync(linkSrc, CANON);
        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[F] SYMLINK_REJECTED → 401, sin 599', r.status === 401 && r.body.error === deny);
        fs.unlinkSync(CANON);

        // INVALID_MODE
        stageCanonical(SECRET_A); fs.chmodSync(CANON, 0o644);
        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[F] INVALID_MODE → 401, sin 599', r.status === 401 && r.body.error === deny);
        fs.chmodSync(CANON, 0o400);

        // INVALID_OWNER (chown a otro uid; requiere root en el runner)
        let ownerTested = false;
        try {
            stageCanonical(SECRET_A);
            fs.chownSync(CANON, 65534, 65534);
            ownerTested = true;
            r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
            ok('[F] INVALID_OWNER → 401, sin 599', r.status === 401 && r.body.error === deny);
            try { fs.chownSync(CANON, process.getuid(), process.getgid()); } catch {}
        } catch { ok('[F] INVALID_OWNER (chown no permitido → omitido)', false, 'requiere root'); }

        // INVALID_FORMAT (espacio interno)
        stageCanonical(`${SECRET_A.slice(0, 8)} ${SECRET_A.slice(8)}`);
        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': `${SECRET_A.slice(0, 8)} ${SECRET_A.slice(8)}` } });
        ok('[F] INVALID_FORMAT → 401, sin 599', r.status === 401 && r.body.error === deny);

        // INVALID_UTF8
        removeCanonical();
        fs.writeFileSync(CANON, Buffer.concat([Buffer.from('w'.repeat(40)), Buffer.from([0xff, 0xfe])]));
        fs.chmodSync(CANON, 0o400);
        r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } });
        ok('[F] INVALID_UTF8 → 401, sin 599', r.status === 401 && r.body.error === deny);

        // Ningún 599 (rechazo no manejado) en toda la matriz
        removeCanonical();
        try { fs.unlinkSync(linkSrc); } catch {}
    }

    // ───────────────────────────── G. no filtración ──────────────────────────
    section('[G] no filtración de material en respuestas');
    {
        const p = await listen(srv(auth.requireAdminAccess));
        stageCanonical(`${SENTINEL}-in-file`); fs.chmodSync(CANON, 0o644); // inseguro con sentinel dentro
        const r = await call(p, { method: 'POST', headers: { 'x-admin-secret': SENTINEL } });
        const blob = JSON.stringify(r.body);
        ok('[G] respuesta no contiene el sentinel', !blob.includes(SENTINEL), blob);
        ok('[G] respuesta no contiene la ruta canónica', !blob.includes('/app/secrets'));
        ok('[G] respuesta no contiene Error.code ni stack', !/FILE_|INVALID_|at \//.test(blob), blob);
        ok('[G] ningún log contiene el sentinel', !logs.join('|').includes(SENTINEL));
        ok('[G] ningún log contiene el valor del header', !logs.join('|').includes(SENTINEL));
        fs.chmodSync(CANON, 0o400);
    }

    // ───────────────────────────── H. rotación A/B vía requests ──────────────
    section('[H] sustitución A/B observada por requests HTTP');
    {
        const p = await listen(srv(auth.requireAdminAccess));
        stageCanonical(SECRET_A);
        ok('[H2] request header A → 200', (await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status === 200);
        stageCanonical(SECRET_B);
        ok('[H4] tras rename B: header A → 401', (await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_A } })).status === 401);
        ok('[H5] header B → 200', (await call(p, { method: 'POST', headers: { 'x-admin-secret': SECRET_B } })).status === 200);
        let good = 0;
        for (let i = 0; i < 10; i++) {
            const cur = i % 2 === 0 ? SECRET_A : SECRET_B;
            const other = i % 2 === 0 ? SECRET_B : SECRET_A;
            stageCanonical(cur);
            const rc = (await call(p, { method: 'POST', headers: { 'x-admin-secret': cur } })).status === 200;
            const ro = (await call(p, { method: 'POST', headers: { 'x-admin-secret': other } })).status === 401;
            if (rc && ro) good++;
        }
        ok('[H6-8] 10 alternancias A/B correctas por request', good === 10, `ok=${good}/10`);
    }

    if (beforeEnv === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = beforeEnv;
} finally {
    for (const s of servers) { try { s.close(); } catch {} }
    removeCanonical();
    console.log(`\n  ruta canónica limpia: ${!fs.existsSync(CANON)}  servers cerrados: ${servers.length}`);
}

console.log(`\nadminSecretHttp — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
