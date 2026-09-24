/**
 * storeCatalog.mjs — CHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (Fase 1).
 *
 * Contrato del CLIENTE para el catálogo de la Tienda (GET /api/store/catalog).
 * Módulo puro: sin React, sin fetch. Lo usan `dataService`, `pages/Tienda.tsx`
 * y los tests.
 *
 * WooCommerce es la fuente de verdad y el checkout es suyo: el botón de compra
 * lleva al permalink del producto con atribución UTM; Chibalete+ no procesa pagos.
 */

export const STORE_CATALOG_PATH = '/store/catalog';
/** Tienda web canónica (CTA del estado de error). */
export const STORE_WEB_URL = 'https://chibaleteeditores.com/tienda/';
export const STORE_UTM = Object.freeze({ utm_source: 'chibaleteplus', utm_medium: 'store' });
export const ALL_FILTER = 'todos';

/**
 * @typedef {{ id:number, slug:string, name:string, price:number, regularPrice:number,
 *   salePrice:number|null, onSale:boolean, currency:string, imageUrl:string|null,
 *   stockStatus:'instock'|'outofstock', categories:Array<{id:number,slug:string,name:string}>,
 *   productUrl:string|null }} StoreProduct
 * @typedef {{ id:number, slug:string, name:string, count:number }} StoreCollection
 * @typedef {{ products: StoreProduct[], categories: StoreCollection[], stale: boolean, fetchedAt: string|null }} StoreCatalog
 */

/**
 * Valida la respuesta del servidor. null si no tiene la forma esperada.
 * @returns {StoreCatalog | null}
 */
export function parseStoreCatalogResponse(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.products) || !Array.isArray(body.categories)) return null;
    const products = body.products.filter(p =>
        p && Number.isInteger(p.id) && typeof p.name === 'string' && Number.isFinite(p.price));
    return {
        products,
        categories: body.categories.filter(c => c && typeof c.slug === 'string' && typeof c.name === 'string'),
        stale: body.stale === true,
        fetchedAt: typeof body.fetchedAt === 'string' ? body.fetchedAt : null,
    };
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
/** 65000 → "$ 65.000" (pesos colombianos, sin decimales). */
export function formatCOP(n) {
    return Number.isFinite(n) ? COP.format(n) : '';
}

/** Libros de una colección; ALL_FILTER devuelve todos. */
export function filterProducts(products, slug) {
    if (!slug || slug === ALL_FILTER) return products;
    return products.filter(p => p.categories.some(c => c.slug === slug));
}

/** Filtros visibles: «Todo» + colecciones que tienen al menos un libro. */
export function visibleFilters(categories) {
    return [{ slug: ALL_FILTER, name: 'Todo' }, ...categories.filter(c => c.count > 0).map(c => ({ slug: c.slug, name: c.name }))];
}

/** Permalink de WooCommerce + atribución. null si el producto no trae URL válida. */
export function productCtaUrl(productUrl) {
    if (typeof productUrl !== 'string' || !productUrl) return null;
    try {
        const u = new URL(productUrl);
        for (const [k, v] of Object.entries(STORE_UTM)) u.searchParams.set(k, v);
        return u.toString();
    } catch { return null; }
}

/** El CTA solo invita a comprar lo que se puede comprar. */
export function isPurchasable(p) {
    return p.stockStatus === 'instock' && !!productCtaUrl(p.productUrl);
}
