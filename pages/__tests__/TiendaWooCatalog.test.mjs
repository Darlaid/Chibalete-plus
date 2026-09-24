/**
 * TiendaWooCatalog.test.mjs — CHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (Fase 1).
 *
 * Render REAL de pages/Tienda.tsx (bundleado con esbuild; dataService y
 * AuthContext sustituidos por dobles) con react-dom/server, alimentado con la
 * salida REAL del adaptador (server/lib/wooCatalog.mjs) sobre el fixture fijo.
 *
 *   loading · catálogo · filtros dinámicos · colección nueva · sin tabs vacías ·
 *   COP sin decimales · oferta · agotado · stale · error · CTA · puntos intactos.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { adaptCatalog } from '../../server/lib/wooCatalog.mjs';
import {
    formatCOP, productCtaUrl, filterProducts, visibleFilters, parseStoreCatalogResponse, STORE_WEB_URL, ALL_FILTER,
} from '../../utils/storeCatalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', '__test__', 'fixtures', 'woo_store_products.json'), 'utf8')).products;
const CATALOG = { ...adaptCatalog(FX), stale: false, fetchedAt: '2026-09-24T21:00:00.000Z' };

// ── bundle de Tienda.tsx con dobles ──────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-tienda-'));
const mockDs = path.join(tmp, 'dataService.mock.mjs');
fs.writeFileSync(mockDs, `
export const dataService = {
    getStoreCatalog: () => new Promise(() => {}),
    getProductos: () => { globalThis.__getProductosCalled = true; return []; },
    redeemCoupon: () => ({ success: true, message: '' }),
};`);
const mockAuth = path.join(tmp, 'AuthContext.mock.mjs');
fs.writeFileSync(mockAuth, `export const useAuth = () => ({ user: { id: 'u-1', puntos: 1200 } });`);
const entry = path.join(tmp, 'entry.mjs');
const fwd = (p) => JSON.stringify(p.replace(/\\/g, '/'));
fs.writeFileSync(entry, `
export { default as Tienda, CatalogSection } from ${fwd(path.join(ROOT, 'pages', 'Tienda.tsx'))};
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
`);
const bundle = path.join(tmp, 'bundle.mjs');
await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'node_modules')],
    jsx: 'automatic', define: { 'import.meta.env': '{"DEV":false}' },
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    plugins: [{
        name: 'doubles',
        setup(b) {
            b.onResolve({ filter: /services\/dataService$/ }, () => ({ path: mockDs }));
            b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: mockAuth }));
        },
    }],
});
const M = await import(pathToFileURL(bundle).href);
const render = (state) => M.renderToStaticMarkup(M.createElement(M.CatalogSection, { state }));
const count = (html, re) => (html.match(re) ?? []).length;

try {
    console.log('\n[H] contrato del cliente');
    ok('COP sin decimales: 65000 → $ 65.000', /^\$\s65\.000$/.test(formatCOP(65000)), JSON.stringify(formatCOP(65000)));
    ok('COP grande: 1250000 → $ 1.250.000', /^\$\s1\.250\.000$/.test(formatCOP(1250000)), formatCOP(1250000));
    const cta = new URL(productCtaUrl('https://chibaleteeditores.com/producto/x/'));
    ok('CTA = permalink + utm_source=chibaleteplus&utm_medium=store',
        cta.origin === 'https://chibaleteeditores.com' && cta.pathname === '/producto/x/' && cta.searchParams.get('utm_source') === 'chibaleteplus' && cta.searchParams.get('utm_medium') === 'store');
    ok('sin productUrl → sin CTA', productCtaUrl(null) === null);
    ok('filtro Todo = todos; colección = solo sus libros',
        filterProducts(CATALOG.products, ALL_FILTER).length === 7 && filterProducts(CATALOG.products, 'clasicos').every(p => p.categories.some(c => c.slug === 'clasicos')));
    ok('parse rechaza una forma inválida', parseStoreCatalogResponse({ nope: 1 }) === null && parseStoreCatalogResponse(CATALOG)?.products.length === 7);

    console.log('\n[L] loading');
    const loading = render({ status: 'loading' });
    ok('estado de carga accesible', /role="status"/.test(loading) && /aria-busy="true"/.test(loading) && /Cargando catálogo/.test(loading));

    console.log('\n[R] catálogo');
    const ready = render({ status: 'ready', catalog: CATALOG });
    ok('7 tarjetas (solo libros)', count(ready, /<h3 /g) === 7, String(count(ready, /<h3 /g)));
    ok('imágenes remotas de WooCommerce, sin copiar', count(ready, /<img [^>]*src="https:\/\/chibaleteeditores\.com\/wp-content\/uploads\//g) === 6);
    ok('producto sin imagen → fallback visual (sin <img> roto)', count(ready, /<img /g) === 6);
    ok('precio COP sin decimales', ready.includes('65.000') && !/\d\.00</.test(ready) && !/\$65000/.test(ready));
    const filters = [...ready.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map(m => m[2].replace(/&#x27;/g, "'"));
    ok('filtros dinámicos: Todo + colecciones reales', JSON.stringify(filters) === JSON.stringify(['Todo', 'Clásicos', 'No ficción', "Pa' que me entienda", 'Territorios']), JSON.stringify(filters));
    ok('sin tabs heredadas ni transversales', !/>(Ropa|Accesorios|Libros Impresos|Libros|Suscripciones)</.test(ready));
    ok('«Todo» activo por defecto', /aria-pressed="true"[^>]*>Todo</.test(ready));
    const ctas = [...ready.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer"[^>]*>.*?Comprar en Chibalete Editores/g)].map(m => m[1].replace(/&amp;/g, '&'));
    ok('CTA «Comprar en Chibalete Editores» en pestaña nueva, noopener noreferrer', ctas.length === 5, String(ctas.length));
    ok('todos los CTA a chibaleteeditores.com con UTM', ctas.every(h => h.startsWith('https://chibaleteeditores.com/producto/') && h.includes('utm_source=chibaleteplus') && h.includes('utm_medium=store')));
    ok('producto con host ajeno → sin CTA (nunca enlaza fuera)', !ready.includes('evil.example'));

    console.log('\n[O] oferta y agotado');
    ok('oferta: precio de oferta + regular tachado con texto accesible', /45\.000<\/span><span class="[^"]*line-through[^"]*"><span class="sr-only">Precio anterior: <\/span>\$\s60\.000/.test(ready));
    const outCard = ready.split('<h3 ').find(c => c.includes('>Fixture agotado</h3>')) ?? '';
    ok('agotado: etiqueta «Agotado» y sin botón de compra', (outCard.match(/Agotado/g) ?? []).length >= 1 && !outCard.includes('Comprar en Chibalete Editores'));

    console.log('\n[N] colección nueva / vacías');
    const nuevo = { ...CATALOG, categories: [...CATALOG.categories, { id: 999, slug: 'coleccion-nueva', name: 'Colección nueva', count: 1 }, { id: 998, slug: 'vacia', name: 'Vacía', count: 0 }] };
    const htmlNueva = render({ status: 'ready', catalog: nuevo });
    ok('una colección nueva aparece sin tocar código', />Colección nueva</.test(htmlNueva));
    ok('una colección sin libros no genera tab', !/>Vacía</.test(htmlNueva));
    ok('visibleFilters omite count 0', !visibleFilters(nuevo.categories).some(f => f.slug === 'vacia'));

    console.log('\n[S] stale / error');
    const stale = render({ status: 'stale', catalog: { ...CATALOG, stale: true } });
    ok('stale: catálogo normal + aviso discreto', count(stale, /<h3 /g) === 7 && /catálogo guardado más reciente/.test(stale));
    const error = render({ status: 'error' });
    ok('error: mensaje exacto', error.includes('No pudimos cargar el catálogo en este momento.') && /role="alert"/.test(error));
    ok('error: CTA a la tienda web', error.includes(`href="${STORE_WEB_URL}"`) && error.includes('Visitar la tienda de Chibalete Editores'));
    ok('error: ningún producto inventado', !/<h3 /.test(error));

    console.log('\n[P] página completa y Puntos de Magia intactos');
    globalThis.__getProductosCalled = false;
    const page = M.renderToStaticMarkup(M.createElement(M.Tienda));
    ok('la Tienda arranca en carga (catálogo del servidor)', /Cargando catálogo/.test(page));
    ok('ya no lee dataService.getProductos() (localStorage)', globalThis.__getProductosCalled === false);
    ok('bloque de canje intacto', /Canje de Puntos de Magia/.test(page) && /Bono 7% OFF/.test(page) && /Bono 25% OFF/.test(page)
        && /500(<!-- -->)? pts/.test(page) && /1000(<!-- -->)? pts/.test(page) && count(page, /Solicitar Canje/g) === 2 && /Tus Puntos: (<!-- -->)?1200/.test(page));
    const src = fs.readFileSync(path.join(ROOT, 'pages', 'Tienda.tsx'), 'utf8');
    ok('canje sigue llamando a redeemCoupon igual', /dataService\.redeemCoupon\(user\.id, points, description\)/.test(src));
    ok('la página no llama a WooCommerce directamente', !/chibaleteeditores\.com\/wp-json|wc\/store/.test(src));
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}

console.log(`\nCHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (Tienda) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
