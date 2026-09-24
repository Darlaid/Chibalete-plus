/**
 * storeCatalogEndpoint.test.mjs — CHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (Fase 1).
 *
 * GET /api/store/catalog con el servidor REAL y un WooCommerce FALSO local
 * (fixture fijo; sin internet). `CHP_TEST_WOO_ORIGIN` solo se honra con
 * NODE_ENV=test: en runtime la URL remota es fija.
 *
 *   E1 sin sesión → 401.
 *   E2 lector / mediador / admin → 200 (sin autorización por rol).
 *   E3 contrato: solo libros, filtros de colección, stale=false, fetchedAt.
 *   E4 la petición del cliente NO elige host/url/endpoint (query ignorada).
 *   E5 WooCommerce caído sin copia → 503 tipificado, sin detalles internos.
 *   E6 Cache-Control: no-store (la frescura la controla el servidor).
 *   E7 caché server-side: varias lecturas → 1 llamada a WooCommerce.
 */
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FX = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'woo_store_products.json'), 'utf8')).products;
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── WooCommerce falso ────────────────────────────────────────────────────────
const wooRequests = [];
const woo = http.createServer((req, res) => {
    wooRequests.push(req.url);
    const u = new URL(req.url, 'http://x');
    const books = FX.filter(p => p.categories.some(c => c.slug === u.searchParams.get('category')));
    res.writeHead(200, { 'content-type': 'application/json', 'x-wp-totalpages': '1' });
    res.end(JSON.stringify(books));
});
await new Promise(r => woo.listen(0, '127.0.0.1', r));
const WOO = `http://127.0.0.1:${woo.address().port}`;
// Un origen al que nadie responde (WooCommerce caído).
const dead = http.createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r));
const DEAD = `http://127.0.0.1:${dead.address().port}`; await new Promise(r => dead.close(r));

// ── stores temporales ────────────────────────────────────────────────────────
const ORG = 'org-alfa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_store_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), uploads: path.join(tmp, 'uploads') };
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
const USERS = [
    { id: 'lec-1', roles: ['lector'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active' },
    { id: 'med-1', roles: ['mediador'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
];
fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify([{ id: 'g-1', type: 'course', organizationId: ORG, mediatorIds: ['med-1'], memberIds: ['lec-1'], studentIds: ['lec-1'] }], null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG, name: 'Colegio Alfa' }], null, 2));
fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.content, '[]');

function spawnApi(port, wooOrigin) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_TEST_WOO_ORIGIN: wooOrigin,
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            PROGRESS_SQLITE_PATH: path.join(P.data, 'progress.db'),
            EVENTS_SQLITE_PATH: path.join(P.data, 'events.db'),
            ARCHIVE_SQLITE_PATH: path.join(P.data, 'events.archive.db'),
            INSIGHTS_SQLITE_PATH: path.join(P.data, 'insights.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, 'offline_assignments.db'),
            IDENTITY_DB: path.join(P.data, 'identity.db'),
            SESSIONS_DB: path.join(P.data, 'sessions.db'),
            LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
        },
    });
    let bootLog = '';
    child.stdout.on('data', d => { bootLog += d; });
    child.stderr.on('data', d => { bootLog += d; });
    child._boot = () => bootLog;
    return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-2000)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-2000)}`);
}

// Rango propio 5320–5399 (+80 para el segundo); 5040 = servicio de Windows.
const PORT = ((p) => (p === 5040 ? 5041 : p))(5320 + (process.pid % 80));
const PORT_DOWN = PORT + 80;
const BASE = `http://127.0.0.1:${PORT}`, BASE_DOWN = `http://127.0.0.1:${PORT_DOWN}`;
const ROUTE = '/api/store/catalog';
const GET = (uid, url = ROUTE, base = BASE) => fetch(`${base}${url}`, uid ? { headers: { 'x-user-id': uid } } : {});
const json = async (r) => { try { return await r.json(); } catch { return null; } };

let api, apiDown;
async function main() {
    api = spawnApi(PORT, WOO);
    await waitHealthy(BASE, api);

    console.log('\n[E1] sin sesión');
    ok('sin sesión → 401', (await GET(null)).status === 401);
    ok('…y no se consultó WooCommerce', wooRequests.length === 0);

    console.log('\n[E2] cualquier sesión válida');
    const bodies = {};
    for (const uid of ['lec-1', 'med-1', 'adm']) {
        const r = await GET(uid);
        bodies[uid] = await json(r);
        ok(`${uid} → 200`, r.status === 200, String(r.status));
        ok(`${uid} Cache-Control: no-store`, r.headers.get('cache-control') === 'no-store', String(r.headers.get('cache-control')));
    }
    ok('mismo catálogo para todos los roles', JSON.stringify(bodies['lec-1']) === JSON.stringify(bodies.adm));

    console.log('\n[E3] contrato');
    const b = bodies['lec-1'];
    ok('forma { products, categories, stale, fetchedAt }', JSON.stringify(Object.keys(b ?? {}).sort()) === '["categories","fetchedAt","products","stale"]');
    ok('stale=false con WooCommerce sano', b.stale === false && !Number.isNaN(Date.parse(b.fetchedAt)));
    ok('solo libros (7), la suscripción no aparece', b.products.length === 7 && !b.products.some(p => p.id === 345));
    ok('cada producto con el contrato exacto', b.products.every(p => JSON.stringify(Object.keys(p)) === '["id","slug","name","price","regularPrice","salePrice","onSale","currency","imageUrl","stockStatus","categories","productUrl"]'));
    ok('filtros = colecciones con libros', JSON.stringify(b.categories.map(c => c.slug)) === '["clasicos","no-ficcion","pa-que-me-entienda","territorios"]');
    ok('sin HTML ni datos internos de WordPress', !/<p|price_html|short_description|wp-json|_links/.test(JSON.stringify(b)));

    console.log('\n[E4] el cliente no elige el origen');
    const before = wooRequests.length;
    const evil = await GET('lec-1', `${ROUTE}?host=evil.example&url=${encodeURIComponent('https://evil.example/x')}&endpoint=/wp-json/wp/v2/users&category=suscripciones`);
    const eb = await json(evil);
    ok('query de override ignorada: mismo catálogo', evil.status === 200 && JSON.stringify(eb.products) === JSON.stringify(b.products));
    ok('WooCommerce solo recibió peticiones de la URL fija', wooRequests.every(u => u.startsWith('/wp-json/wc/store/v1/products?') && u.includes('category=libros') && !u.includes('evil')));
    ok('la caché sirvió la lectura (sin llamada nueva)', wooRequests.length === before);
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    const i = src.indexOf(`app.get('${ROUTE}'`);
    const handler = src.slice(i, src.indexOf('\n});', i));
    ok('el handler no lee req.query / req.body / req.params', i > 0 && !/req\.(query|body|params)/.test(handler));

    console.log('\n[E7] caché server-side');
    ok('5 lecturas (3 roles + override + …) → 1 sola llamada a WooCommerce', wooRequests.length === 1, String(wooRequests.length));

    console.log('\n[E5] WooCommerce caído sin copia');
    apiDown = spawnApi(PORT_DOWN, DEAD);
    await waitHealthy(BASE_DOWN, apiDown);
    const d = await GET('lec-1', ROUTE, BASE_DOWN);
    const db = await json(d);
    ok('→ 503', d.status === 503, String(d.status));
    ok('error tipificado, sin detalles internos', JSON.stringify(db) === '{"error":"store_catalog_unavailable"}', JSON.stringify(db));
    ok('nunca un catálogo inventado', !('products' in (db ?? {})));

    console.log('\n[STORES]');
    ok('users byte-idéntico', fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        try { api?.kill('SIGKILL'); } catch { /* */ }
        try { apiDown?.kill('SIGKILL'); } catch { /* */ }
        woo.close();
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
        console.log(`\nCHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (endpoint) — ${pass} ✓, ${fail} ✗`);
        process.exit(fail ? 1 : 0);
    });
