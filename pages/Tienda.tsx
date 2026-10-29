
import React, { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import {
    ALL_FILTER,
    STORE_WEB_URL,
    filterProducts,
    formatCOP,
    isPurchasable,
    productCtaUrl,
    visibleFilters,
    type StoreCatalog,
    type StoreProduct,
} from '../utils/storeCatalog.mjs';
import { Tag, Gift, ShoppingBag, ShoppingCart, ExternalLink } from 'lucide-react';

// ── Catálogo WooCommerce (CHP-MAINT-STORE-WOOCOMMERCE-CATALOG-01) ─────────────
// WooCommerce es la fuente de verdad y el checkout es suyo: la tarjeta solo
// presenta y el botón lleva al producto en chibaleteeditores.com.

export type CatalogState =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready' | 'stale'; catalog: StoreCatalog };

const ProductCard: React.FC<{ product: StoreProduct }> = ({ product }) => {
    const [imgFailed, setImgFailed] = useState(false);
    const cta = productCtaUrl(product.productUrl);
    const available = isPurchasable(product);
    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col h-full">
            <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-900">
                {product.imageUrl && !imgFailed ? (
                    <img
                        src={product.imageUrl}
                        alt={product.name}
                        loading="lazy"
                        onError={() => setImgFailed(true)}
                        className="w-full h-full object-contain"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400" aria-hidden="true">
                        <ShoppingBag size={48} />
                    </div>
                )}
                {product.stockStatus !== 'instock' && (
                    <div className="absolute top-2 right-2 bg-gray-900 text-white text-xs font-bold px-2 py-1 rounded-full shadow uppercase tracking-wider">
                        Agotado
                    </div>
                )}
            </div>

            <div className="p-5 flex flex-col flex-grow">
                <h3 className="font-bold text-lg mb-3 text-gray-900 dark:text-white leading-tight">{product.name}</h3>

                <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                    {product.onSale && product.salePrice !== null ? (
                        <p className="flex items-baseline gap-2">
                            <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{formatCOP(product.salePrice)}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400 line-through">
                                <span className="sr-only">Precio anterior: </span>{formatCOP(product.regularPrice)}
                            </span>
                        </p>
                    ) : (
                        <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{formatCOP(product.price)}</p>
                    )}
                    {available && cta ? (
                        <a
                            href={cta}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            <ShoppingCart size={16} className="mr-2" aria-hidden="true" />
                            Comprar en Chibalete Editores
                            <span className="sr-only"> (se abre en una pestaña nueva)</span>
                        </a>
                    ) : (
                        <p className="text-center px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 text-sm font-bold rounded-lg">
                            Agotado
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

/** Sección de catálogo: presentación pura por estado (la usa Tienda y los tests). */
export const CatalogSection: React.FC<{ state: CatalogState }> = ({ state }) => {
    const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);

    if (state.status === 'loading') {
        return (
            <div className="text-center py-20 text-gray-500" role="status" aria-busy="true">
                <ShoppingBag size={48} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
                <p>Cargando catálogo…</p>
            </div>
        );
    }

    if (state.status === 'error') {
        return (
            <div className="text-center py-20 text-gray-600 dark:text-gray-300" role="alert">
                <ShoppingBag size={48} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
                <p className="mb-6">No pudimos cargar el catálogo en este momento.</p>
                <a
                    href={STORE_WEB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    Visitar la tienda de Chibalete Editores <ExternalLink size={16} className="ml-2" aria-hidden="true" />
                </a>
            </div>
        );
    }

    const { catalog } = state;
    const filters = visibleFilters(catalog.categories);
    // Si la colección elegida desaparece del catálogo, se vuelve a «Todo».
    const current = filters.some(f => f.slug === activeFilter) ? activeFilter : ALL_FILTER;
    const shown = filterProducts(catalog.products, current);

    return (
        <div>
            {state.status === 'stale' && (
                <p className="mb-4 text-sm text-gray-500 dark:text-gray-400" role="status">
                    Mostrando el catálogo guardado más reciente; puede no incluir los últimos cambios de la tienda.
                </p>
            )}

            {filters.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label="Colecciones">
                    {filters.map(f => (
                        <button
                            key={f.slug}
                            type="button"
                            onClick={() => setActiveFilter(f.slug)}
                            aria-pressed={current === f.slug}
                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${current === f.slug
                                ? 'bg-indigo-600 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                                }`}
                        >
                            {f.name}
                        </button>
                    ))}
                </div>
            )}

            {shown.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {shown.map(product => (
                        <ProductCard key={product.id} product={product} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-20 text-gray-500">
                    <ShoppingBag size={48} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
                    <p>No hay libros disponibles por el momento.</p>
                </div>
            )}
        </div>
    );
};

const Tienda: React.FC = () => {
    const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' });

    useEffect(() => {
        let cancelled = false;
        dataService.getStoreCatalog().then(catalog => {
            if (cancelled) return;
            setCatalogState(catalog ? { status: catalog.stale ? 'stale' : 'ready', catalog } : { status: 'error' });
        });
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="p-4 md:p-8">
            <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <ShoppingBag className="text-indigo-600" size={32} />
                        Tienda Oficial
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Lleva la magia de Chibalete al mundo real con los libros de Chibalete Editores.
                    </p>
                </div>

            </header>

            {/* REWARDS — G0: canje simulado retirado (nunca emitía cupones); sin saldo ni botones. */}
            <div className="mb-12 flex items-start gap-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-4 text-purple-800 dark:text-purple-200">
                <Gift className="shrink-0 mt-0.5" size={22} aria-hidden="true" />
                <p className="text-sm">
                    Las recompensas con Puntos de Magia estarán disponibles cuando el sistema esté habilitado.
                </p>
            </div>

            <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Libros de Chibalete Editores</h2>
            <CatalogSection state={catalogState} />

            <div className="mt-12 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-8 text-white text-center">
                <h2 className="text-2xl font-bold mb-4">¿Buscas algo para tu colegio?</h2>
                <p className="mb-6 max-w-2xl mx-auto">
                    Ofrecemos descuentos especiales por volumen para instituciones educativas que deseen adquirir ediciones impresas o merchandising para sus clubes de lectura.
                </p>
                <a href="mailto:ventas@chibalete.com" className="inline-flex items-center px-6 py-3 bg-white text-indigo-600 font-bold rounded-lg hover:bg-indigo-50 transition-colors">
                    Contactar Ventas <ExternalLink size={16} className="ml-2" />
                </a>
            </div>
        </div>
    );
};

export default Tienda;