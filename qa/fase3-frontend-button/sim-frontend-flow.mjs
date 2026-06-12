/**
 * sim-frontend-flow.mjs — Simulación del cliente offlineAssignmentClient.ts contra el backend.
 *
 * Ejecuta la misma secuencia que el componente PaginaDetalleLibro hará desde el browser,
 * usando fetch() con los mismos headers (x-user-id) y body. Reporta cada paso con su
 * resultado esperado vs obtenido. No requiere abrir el navegador.
 *
 * Pre-requisito: server backend arriba en http://localhost:3000.
 */
const BASE = 'http://localhost:3000/api/offline/assignment';
const A = 'admin-super-1';
const B_USER = 'user-tono';
const BOOK_1 = 'content-1765893250573';
const BOOK_2 = 'content-1772817449967';
const GHOST_CONTENT = 'no-existe-jamas-999';

function headers(userId, withContentType = false) {
    const h = {};
    if (userId) h['x-user-id'] = userId;
    if (withContentType) h['Content-Type'] = 'application/json';
    return h;
}

async function get(userId) {
    const r = await fetch(BASE, { headers: headers(userId) });
    return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(userId, contentId) {
    const r = await fetch(BASE, {
        method: 'POST',
        headers: headers(userId, true),
        body: JSON.stringify({ contentId }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
}
async function del(userId) {
    const r = await fetch(BASE, { method: 'DELETE', headers: headers(userId) });
    return { status: r.status, body: await r.json().catch(() => null) };
}

function check(name, got, expected) {
    const ok = expected(got);
    console.log(`${ok ? '✅' : '❌'} ${name} → HTTP ${got.status}`);
    if (!ok) console.log('   GOT:', JSON.stringify(got.body).slice(0, 220));
    return ok;
}

const results = [];

console.log('\n=== Cleanup ===');
await del(A); await del(B_USER);

console.log('\n=== Test 1 — Usuario sin assignment: GET → null ===');
results.push(check('GET A vacío', await get(A), g => g.status === 200 && g.body?.assignment === null));

console.log('\n=== Test 2 — Click "Preparar para Chibalete LU" (POST BOOK_1) ===');
{
    const r = await post(A, BOOK_1);
    results.push(check('POST BOOK_1 → assignment v1', r, g =>
        g.status === 200 && g.body?.contentId === BOOK_1 && g.body?.version === 1 && g.body?.book != null
    ));
    console.log(`   Title: ${r.body?.book?.title}`);
}

console.log('\n=== Test 3 — Recargar página: GET refleja assignment real ===');
results.push(check('GET A devuelve BOOK_1', await get(A), g =>
    g.status === 200 && g.body?.contentId === BOOK_1
));

console.log('\n=== Test 4 — Reemplazo (BOOK_2): POST sin confirmación de UI (backend siempre acepta) ===');
{
    const r = await post(A, BOOK_2);
    results.push(check('POST BOOK_2 → version++', r, g =>
        g.status === 200 && g.body?.contentId === BOOK_2 && g.body?.version === 2
    ));
}

console.log('\n=== Test 5 — Mismo libro (idempotencia): version preservada ===');
{
    const r = await post(A, BOOK_2);
    results.push(check('POST BOOK_2 repetido → version sigue 2', r, g =>
        g.status === 200 && g.body?.contentId === BOOK_2 && g.body?.version === 2
    ));
}

console.log('\n=== Test 6 — contentId inexistente → 404 mapeado a reason=content_not_found ===');
{
    const r = await post(A, GHOST_CONTENT);
    results.push(check('POST ghost → 404', r, g =>
        g.status === 404 && g.body?.reason === 'content_not_found'
    ));
}

console.log('\n=== Test 7 — Body inválido (sin contentId) → 400 ===');
{
    const r = await fetch(BASE, {
        method: 'POST', headers: headers(A, true), body: JSON.stringify({}),
    });
    const body = await r.json().catch(() => null);
    results.push(check('POST {} → 400 zod', { status: r.status, body }, g =>
        g.status === 400 && Array.isArray(g.body?.details)
    ));
}

console.log('\n=== Test 8 — Sin x-user-id → 401 mapeado a reason=unauthenticated ===');
{
    const r = await fetch(BASE);
    const body = await r.json().catch(() => null);
    results.push(check('GET sin header → 401', { status: r.status, body }, g =>
        g.status === 401
    ));
}

console.log('\n=== Test 9 — Aislamiento A/B ===');
await post(A, BOOK_1);
await post(B_USER, BOOK_2);
const gA = await get(A), gB = await get(B_USER);
results.push(check('GET A devuelve BOOK_1', gA, g => g.body?.contentId === BOOK_1));
results.push(check('GET B devuelve BOOK_2', gB, g => g.body?.contentId === BOOK_2));

console.log('\n=== Test 10 — DELETE: idempotencia ===');
{
    const d1 = await del(A);
    const d2 = await del(A);
    results.push(check('DELETE A primera vez (removed=true)', d1, g => g.status === 200 && g.body?.removed === true));
    results.push(check('DELETE A segunda vez (removed=false)', d2, g => g.status === 200 && g.body?.removed === false));
    const g3 = await get(A);
    results.push(check('GET A post-DELETE → null', g3, g => g.body?.assignment === null));
}

console.log('\n=== Cleanup ===');
await del(A); await del(B_USER);

const passed = results.filter(Boolean).length;
console.log(`\n========= RESULTADO: ${passed}/${results.length} pruebas pasaron =========`);
process.exit(passed === results.length ? 0 : 1);
