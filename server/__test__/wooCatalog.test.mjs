/**
 * wooCatalog.test.mjs — CHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (Fase 1).
 *
 * Adaptador y caché del proxy de catálogo WooCommerce. SIN internet: el fetch
 * se inyecta y sirve un fixture FIJO de la Store API.
 *
 *   [A] contrato: precio normal / oferta, COP, imagen, stock, múltiples
 *       categorías, Libros exigido, Suscripciones excluida, HTML no trasladado,
 *       URL canónica, entidades decodificadas, filtros dinámicos.
 *   [C] caché: C1 fresca · C2 vencida · C3 fallo + copia ≤ 6 h · C4 fallo +
 *       copia > 6 h · C5 timeout · C6 concurrencia (una sola llamada).
 *   [U] URL remota fija y campos mínimos pedidos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    adaptProduct, adaptCatalog, createWooCatalog, catalogPageUrl, collectionFilters,
    WooCatalogUnavailableError, WOO_ORIGIN, decodeEntities, FRESH_TTL_MS, STALE_MAX_MS,
} from '../lib/wooCatalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'woo_store_products.json'), 'utf8')).products;
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const byId = (id) => FX.find(p => p.id === id);

console.log('\n[A] contrato');
{
    const p = adaptProduct(byId(353));
    ok('claves exactas del contrato',
        JSON.stringify(Object.keys(p)) === JSON.stringify(['id', 'slug', 'name', 'price', 'regularPrice', 'salePrice', 'onSale', 'currency', 'imageUrl', 'stockStatus', 'categories', 'productUrl']),
        Object.keys(p).join(','));
    ok('precio normal: número COP (65000), regular igual, salePrice null', p.price === 65000 && p.regularPrice === 65000 && p.salePrice === null && p.onSale === false);
    ok('currency COP', p.currency === 'COP');
    ok('imagen = miniatura canónica de WooCommerce', p.imageUrl === byId(353).images[0].thumbnail && p.imageUrl.startsWith(`${WOO_ORIGIN}/wp-content/`));
    ok('stock disponible → instock', p.stockStatus === 'instock');
    ok('productUrl = permalink canónico', p.productUrl === byId(353).permalink);
    ok('HTML largo NO trasladado', !JSON.stringify(p).includes('<p') && !('description' in p) && !('short_description' in p) && !('price_html' in p));
    ok('sin ISBN, medidas ni atributos', !/isbn|attributes|dimensions|weight/i.test(JSON.stringify(Object.keys(p))));

    const s = adaptProduct(byId(900001));
    ok('oferta: price 45000, regular 60000, salePrice 45000, onSale', s.price === 45000 && s.regularPrice === 60000 && s.salePrice === 45000 && s.onSale === true);
    ok('entidades decodificadas en el nombre', s.name === 'Fixture – libro en oferta', s.name);

    ok('agotado → outofstock', adaptProduct(byId(900002)).stockStatus === 'outofstock');
    ok('múltiples categorías conservadas', adaptProduct(byId(33)).categories.map(c => c.slug).join(',') === 'no-ficcion,pa-que-me-entienda,libros');
    ok('nombres de categoría sin entidades HTML', adaptProduct(byId(33)).categories.every(c => !/&#?[a-z0-9]+;/i.test(c.name)));
    ok('decodeEntities: &#8217; &#8211; &amp;', decodeEntities('Pa&#8217; &#8211; A &amp; B') === 'Pa’ – A & B');
    ok('sin Libros → excluido (suscripción)', adaptProduct(byId(345)) === null);
    ok('permalink de otro host → productUrl null', adaptProduct(byId(900003)).productUrl === null);
    ok('sin imagen → imageUrl null (fallback visual en UI)', adaptProduct(byId(900004)).imageUrl === null);

    const cat = adaptCatalog([...FX, byId(353)]);
    ok('catálogo = solo libros (7 de 8) y sin duplicados', cat.products.length === 7 && !cat.products.some(p => p.id === 345));
    const slugs = cat.categories.map(c => c.slug);
    ok('filtros = colecciones presentes, sin libros/suscripciones', JSON.stringify(slugs) === JSON.stringify(['clasicos', 'no-ficcion', 'pa-que-me-entienda', 'territorios']), slugs.join(','));
    ok('filtros con conteo real', cat.categories.find(c => c.slug === 'territorios').count === 3);
    const nueva = collectionFilters([{ categories: [{ id: 999, slug: 'coleccion-nueva', name: 'Colección nueva' }, { id: 431, slug: 'libros', name: 'Libros' }] }]);
    ok('una colección nueva aparece sola (sin lista fija)', nueva.length === 1 && nueva[0].slug === 'coleccion-nueva');
}

console.log('\n[U] URL remota fija');
{
    const u = new URL(catalogPageUrl(1));
    ok('origen = chibaleteeditores.com', u.origin === WOO_ORIGIN);
    ok('Store API pública, categoría libros', u.pathname === '/wp-json/wc/store/v1/products' && u.searchParams.get('category') === 'libros');
    ok('solo los campos necesarios (_fields)', u.searchParams.get('_fields') === 'id,slug,name,permalink,on_sale,prices,images,categories,is_in_stock');
}

// ── caché con reloj y fetch inyectados ─────────────────────────────────────
const res = (body, { status = 200, pages = 1 } = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (k.toLowerCase() === 'x-wp-totalpages' ? String(pages) : null) },
    json: async () => body,
});
function harness() {
    let t = 1_800_000_000_000;
    const calls = [];
    let mode = 'ok';
    const fetchImpl = (url, opts) => {
        calls.push(url);
        if (mode === 'ok') return Promise.resolve(res(FX));
        if (mode === 'http500') return Promise.resolve(res({ code: 'x' }, { status: 500 }));
        if (mode === 'network') return Promise.reject(new TypeError('fetch failed'));
        // hang: solo termina si se aborta
        return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    };
    const cat = createWooCatalog({ fetchImpl, now: () => t, timeoutMs: 40 });
    return { cat, calls, set: (m) => { mode = m; }, tick: (ms) => { t += ms; } };
}

console.log('\n[C] caché');
{
    const h = harness();
    const a = await h.cat.get();
    ok('primera lectura → 1 llamada, stale=false', h.calls.length === 1 && a.stale === false && a.products.length === 7);
    h.tick(FRESH_TTL_MS - 1);
    await h.cat.get();
    ok('C1 fresca (< 10 min) → sin llamada adicional', h.calls.length === 1);
    h.tick(2);
    await h.cat.get();
    ok('C2 vencida → vuelve a pedir', h.calls.length === 2);

    h.set('http500');
    h.tick(FRESH_TTL_MS + 1);
    const s = await h.cat.get();
    ok('C3 fallo + copia ≤ 6 h → copia REAL anterior con stale=true', s.stale === true && s.products.length === 7);
    ok('C3 fetchedAt = el de la copia, no ahora', new Date(s.fetchedAt).getTime() < 1_800_000_000_000 + 2 * FRESH_TTL_MS + 10);

    h.tick(STALE_MAX_MS);
    let e4 = null; try { await h.cat.get(); } catch (e) { e4 = e; }
    ok('C4 fallo + copia > 6 h → WooCatalogUnavailableError (el endpoint da 503)', e4 instanceof WooCatalogUnavailableError && e4.causeTag === 'woo_http_500', e4?.causeTag);

    h.set('ok'); await h.cat.get();
    ok('recupera al volver WooCommerce', h.cat._peek().count === 7);
}
{
    const h = harness(); h.set('hang');
    let e5 = null; const t0 = Date.now();
    try { await h.cat.get(); } catch (e) { e5 = e; }
    ok('C5 timeout sin copia → mismo contrato (woo_timeout)', e5 instanceof WooCatalogUnavailableError && e5.causeTag === 'woo_timeout' && Date.now() - t0 < 2000, e5?.causeTag);
    h.set('ok'); await h.cat.get(); h.tick(FRESH_TTL_MS + 1); h.set('hang');
    const s5 = await h.cat.get();
    ok('C5 timeout con copia ≤ 6 h → stale=true', s5.stale === true);
}
{
    const h = harness(); h.set('network');
    let en = null; try { await h.cat.get(); } catch (e) { en = e; }
    ok('red caída sin copia → woo_network', en?.causeTag === 'woo_network');
}
{
    const h = harness();
    const rs = await Promise.all(Array.from({ length: 12 }, () => h.cat.get()));
    ok('C6 12 peticiones concurrentes → 1 sola llamada a WooCommerce', h.calls.length === 1, String(h.calls.length));
    ok('C6 todas con el mismo catálogo íntegro', rs.every(r => r.products.length === 7 && JSON.stringify(r.products) === JSON.stringify(rs[0].products)));
    h.tick(FRESH_TTL_MS + 1); h.set('http500');
    const rs2 = await Promise.all(Array.from({ length: 6 }, () => h.cat.get()));
    ok('C6 concurrentes con fallo → 1 llamada y todas stale', h.calls.length === 2 && rs2.every(r => r.stale === true));
}
{
    // Paginación: respeta x-wp-totalpages.
    const calls = [];
    const cat = createWooCatalog({ fetchImpl: (url) => { calls.push(url); const page = new URL(url).searchParams.get('page'); return Promise.resolve(res(page === '1' ? FX.slice(0, 4) : FX.slice(4), { pages: 2 })); }, now: () => 0 });
    const r = await cat.get();
    ok('paginación: 2 páginas → catálogo completo', calls.length === 2 && r.products.length === 7);
}
{
    let bad = null;
    const cat = createWooCatalog({ fetchImpl: () => Promise.resolve(res({ not: 'an array' })), now: () => 0 });
    try { await cat.get(); } catch (e) { bad = e; }
    ok('respuesta no-array → woo_invalid_response (nunca un catálogo inventado)', bad?.causeTag === 'woo_invalid_response');
}

console.log(`\nCHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (wooCatalog) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
