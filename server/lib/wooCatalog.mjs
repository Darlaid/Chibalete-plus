/**
 * wooCatalog.mjs — CHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01 (Fase 1).
 *
 * Proxy de SOLO LECTURA del catálogo de libros de la tienda WooCommerce de
 * Chibalete Editores para la sección Tienda de Chibalete+.
 *
 *   WooCommerce = fuente de verdad (precios, stock, imágenes, permalinks).
 *   Chibalete+  = presentación. Nunca procesa compras ni guarda el catálogo.
 *
 * Autoridad remota FIJA en el servidor (`WOO_ORIGIN`): ninguna parte de la
 * petición del cliente (query, body, headers) elige host, URL ni endpoint, así
 * que el proxy no puede usarse como redirect abierto. La única excepción es
 * `CHP_TEST_WOO_ORIGIN`, que solo se honra con NODE_ENV=test (tests herméticos).
 *
 * Qué es un libro: pertenecer a la categoría EXPLÍCITA de WooCommerce `libros`
 * (creada para esto; las colecciones siguen siendo categorías aparte). La
 * Store API ya filtra por ella y aquí se vuelve a exigir, por defensa.
 *
 * Caché en memoria por réplica (mismo patrón que `_jsonCache` de server.js):
 *   fresco (< 10 min)            → se sirve sin llamar a WooCommerce;
 *   vencido                       → se intenta WooCommerce;
 *   WooCommerce falla, copia ≤ 6 h → se sirve la copia REAL anterior, stale=true;
 *   WooCommerce falla, sin copia  → WooCatalogUnavailableError (el endpoint da 503).
 * Nunca se inventa un catálogo. Peticiones concurrentes comparten una sola
 * llamada en vuelo. Sin DB, sin scheduler, sin Redis.
 */

export const WOO_ORIGIN = 'https://chibaleteeditores.com';
export const BOOK_CATEGORY_SLUG = 'libros';
/** Categorías que no son filtros de colección: la transversal y las ajenas a libros. */
export const NON_COLLECTION_SLUGS = new Set(['libros', 'suscripciones', 'uncategorized', 'sin-categorizar']);

export const FRESH_TTL_MS = 10 * 60 * 1000;
export const STALE_MAX_MS = 6 * 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 5_000;
const PER_PAGE = 100;
const MAX_PAGES = 10;

/** Solo los campos que usa el contrato: ni descripciones HTML ni atributos. */
const FIELDS = 'id,slug,name,permalink,on_sale,prices,images,categories,is_in_stock';

export class WooCatalogUnavailableError extends Error {
    constructor(cause) {
        super(`WOO_CATALOG_UNAVAILABLE: ${cause}`);
        this.name = 'WooCatalogUnavailableError';
        this.causeTag = cause;   // woo_timeout | woo_network | woo_http_<n> | woo_invalid_response
    }
}

function wooOrigin() {
    if (process.env.NODE_ENV === 'test' && process.env.CHP_TEST_WOO_ORIGIN) return process.env.CHP_TEST_WOO_ORIGIN;
    return WOO_ORIGIN;
}

export function catalogPageUrl(page, origin = wooOrigin()) {
    const q = new URLSearchParams({
        category: BOOK_CATEGORY_SLUG,
        per_page: String(PER_PAGE),
        page: String(page),
        _fields: FIELDS,
    });
    return `${origin}/wp-json/wc/store/v1/products?${q.toString()}`;
}

// Entidades que WordPress deja en los nombres (p. ej. «Pa&#8217; que me entienda»).
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
    return String(s ?? '')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** "65000" con currency_minor_unit 0 → 65000. Precio ausente o inválido → null. */
function money(raw, minorUnit) {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const unit = Number.isInteger(minorUnit) && minorUnit >= 0 ? minorUnit : 0;
    return n / 10 ** unit;
}

/** Permalink aceptado solo si apunta a la tienda canónica. */
function productUrlOf(permalink) {
    if (typeof permalink !== 'string') return null;
    try {
        const u = new URL(permalink);
        return u.origin === WOO_ORIGIN && u.protocol === 'https:' ? u.toString() : null;
    } catch { return null; }
}

/**
 * Producto de la Store API → contrato interno. null si no es un libro válido.
 * @returns {null | {id:number, slug:string, name:string, price:number, regularPrice:number,
 *   salePrice:number|null, onSale:boolean, currency:string, imageUrl:string|null,
 *   stockStatus:'instock'|'outofstock', categories:Array<{id:number,slug:string,name:string}>,
 *   productUrl:string|null}}
 */
export function adaptProduct(p) {
    if (!p || typeof p !== 'object' || !Number.isInteger(p.id)) return null;
    const cats = Array.isArray(p.categories) ? p.categories : [];
    if (!cats.some(c => c?.slug === BOOK_CATEGORY_SLUG)) return null;
    const pr = p.prices ?? {};
    const minor = pr.currency_minor_unit;
    const price = money(pr.price, minor);
    const regularPrice = money(pr.regular_price, minor) ?? price;
    if (price === null) return null;
    const onSale = p.on_sale === true;
    const img = Array.isArray(p.images) ? p.images[0] : null;
    return {
        id: p.id,
        slug: String(p.slug ?? ''),
        name: decodeEntities(p.name),
        price,
        regularPrice,
        // La Store API repite `sale_price = price` cuando NO hay oferta: solo cuenta con on_sale.
        salePrice: onSale ? money(pr.sale_price, minor) ?? price : null,
        onSale,
        currency: String(pr.currency_code || 'COP'),
        imageUrl: (img && (img.thumbnail || img.src)) || null,
        stockStatus: p.is_in_stock === true ? 'instock' : 'outofstock',
        categories: cats.map(c => ({ id: c.id, slug: String(c.slug ?? ''), name: decodeEntities(c.name) })),
        productUrl: productUrlOf(p.permalink),
    };
}

/** Filtros de colección = categorías presentes en los libros, sin las transversales. */
export function collectionFilters(products) {
    const bySlug = new Map();
    for (const p of products) for (const c of p.categories) {
        if (NON_COLLECTION_SLUGS.has(c.slug) || !c.slug) continue;
        const e = bySlug.get(c.slug) ?? { id: c.id, slug: c.slug, name: c.name, count: 0 };
        e.count++;
        bySlug.set(c.slug, e);
    }
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Respuesta completa de WooCommerce (todas las páginas) → { products, categories }. */
export function adaptCatalog(rawProducts) {
    const seen = new Set();
    const products = [];
    for (const raw of rawProducts) {
        const p = adaptProduct(raw);
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        products.push(p);
    }
    return { products, categories: collectionFilters(products) };
}

async function fetchPage(fetchImpl, url, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
        res = await fetchImpl(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    } catch (e) {
        throw new WooCatalogUnavailableError(ac.signal.aborted ? 'woo_timeout' : 'woo_network');
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new WooCatalogUnavailableError(`woo_http_${res.status}`);
    let body;
    try { body = await res.json(); } catch { throw new WooCatalogUnavailableError('woo_invalid_response'); }
    if (!Array.isArray(body)) throw new WooCatalogUnavailableError('woo_invalid_response');
    const pages = Number(res.headers?.get?.('x-wp-totalpages')) || 1;
    return { body, pages };
}

async function fetchCatalog(fetchImpl, timeoutMs) {
    const all = [];
    let pages = 1;
    for (let page = 1; page <= Math.min(pages, MAX_PAGES); page++) {
        const r = await fetchPage(fetchImpl, catalogPageUrl(page), timeoutMs);
        all.push(...r.body);
        pages = r.pages;
    }
    return adaptCatalog(all);
}

/**
 * Crea el catálogo con caché. `fetchImpl`, `now` y `timeoutMs` son inyectables
 * para los tests; en runtime se usan `fetch` y `Date.now`.
 */
export function createWooCatalog({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
    let entry = null;        // { payload:{products,categories}, fetchedAt:number }
    let inflight = null;     // Promise compartida entre peticiones concurrentes

    const view = (e, stale) => ({
        products: e.payload.products,
        categories: e.payload.categories,
        stale,
        fetchedAt: new Date(e.fetchedAt).toISOString(),
    });

    return {
        async get() {
            const t = now();
            if (entry && t - entry.fetchedAt < FRESH_TTL_MS) return view(entry, false);
            if (!inflight) {
                inflight = fetchCatalog(fetchImpl, timeoutMs)
                    .then(payload => { entry = { payload, fetchedAt: now() }; return entry; })
                    .finally(() => { inflight = null; });
            }
            try {
                return view(await inflight, false);
            } catch (e) {
                if (entry && now() - entry.fetchedAt <= STALE_MAX_MS) return view(entry, true);
                throw e instanceof WooCatalogUnavailableError ? e : new WooCatalogUnavailableError('woo_network');
            }
        },
        /** Solo tests / diagnóstico. */
        _peek: () => (entry ? { fetchedAt: entry.fetchedAt, count: entry.payload.products.length } : null),
    };
}
