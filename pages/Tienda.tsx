
import React, { useState } from 'react';
import { dataService } from '../services/dataService';
import type { Product } from '../types';
import { useAuth } from '../context/AuthContext';
import { Tag, Gift, ShoppingBag, ShoppingCart, ExternalLink } from 'lucide-react';

const RewardCard: React.FC<{ points: number, discount: string, onRedeem: (pts: number, desc: string) => void }> = ({ points, discount, onRedeem }) => (
    <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl p-6 text-white shadow-lg flex flex-col justify-between h-full transform hover:scale-105 transition-transform">
        <div>
            <div className="flex justify-between items-start mb-4">
                <Gift size={32} className="text-purple-200" />
                <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm">Canjeable</span>
            </div>
            <h3 className="text-2xl font-bold mb-2">Bono {discount}</h3>
            <p className="text-purple-100 text-sm mb-4">Canjea tus puntos por un código de descuento único para la tienda física.</p>
        </div>
        <div>
            <div className="text-3xl font-bold mb-4">{points} pts</div>
            <button
                onClick={() => onRedeem(points, `Bono ${discount}`)}
                className="w-full py-2 bg-white text-indigo-600 font-bold rounded-lg hover:bg-indigo-50 transition-colors shadow-md"
            >
                Solicitar Canje
            </button>
        </div>
    </div>
);

const ProductCard: React.FC<{ product: Product }> = ({ product }) => {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col h-full">
            <div className="relative aspect-square overflow-hidden">
                <img
                    src={product.imagen_url}
                    alt={product.nombre}
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                />
                <div className="absolute top-2 right-2 bg-white dark:bg-gray-900 text-xs font-bold px-2 py-1 rounded-full shadow uppercase tracking-wider">
                    {product.categoria.replace('_', ' ')}
                </div>
            </div>

            <div className="p-5 flex flex-col flex-grow">
                <h3 className="font-bold text-lg mb-1 text-gray-900 dark:text-white leading-tight">{product.nombre}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-4 flex-grow">{product.descripcion}</p>

                <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-700 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">${product.precio.toFixed(2)}</span>
                        <a
                            href={product.url_compra}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            <ShoppingCart size={16} className="mr-2" />
                            Comprar
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

const Tienda: React.FC = () => {
    const { user } = useAuth();
    const [activeFilter, setActiveFilter] = useState<'todos' | 'libros' | 'ropa' | 'accesorios'>('todos');
    const products = dataService.getProductos();

    const handleRedeem = (points: number, description: string) => {
        if (!user) {
            alert("Inicia sesión para canjear puntos.");
            return;
        }

        if (confirm(`¿Solicitar canje de ${points} puntos por ${description}?`)) {
            const result = dataService.redeemCoupon(user.id, points, description);
            if (result.success) {
                alert(`¡Solicitud enviada!\nEl administrador revisará tu solicitud y te enviará el código pronto.`);
            } else {
                alert(`Error: ${result.message}`);
            }
        }
    };

    const filteredProducts = activeFilter === 'todos'
        ? products
        : products.filter(p => {
            if (activeFilter === 'libros') return p.categoria === 'libro_impreso';
            return p.categoria === activeFilter || p.categoria === 'papeleria';
        });

    const FilterButton: React.FC<{ filter: string, label: string }> = ({ filter, label }) => (
        <button
            onClick={() => setActiveFilter(filter as any)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${activeFilter === filter
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
        >
            {label}
        </button>
    );

    return (
        <div className="p-4 md:p-8">
            <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <ShoppingBag className="text-indigo-600" size={32} />
                        Tienda Oficial
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Lleva la magia de Chibalete al mundo real. Libros, ropa y accesorios exclusivos.
                    </p>
                    {user && (
                        <div className="mt-2 inline-block bg-purple-100 dark:bg-purple-900 border border-purple-200 dark:border-purple-700 px-3 py-1 rounded-full text-sm font-bold text-purple-700 dark:text-purple-300">
                            ✨ Tus Puntos: {user.puntos || 0}
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    <FilterButton filter="todos" label="Todo" />
                    <FilterButton filter="libros" label="Libros Impresos" />
                    <FilterButton filter="ropa" label="Ropa" />
                    <FilterButton filter="accesorios" label="Accesorios" />
                </div>
            </header>

            {/* REWARDS SECTION */}
            <div className="mb-12">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-gray-800 dark:text-white">
                    <Gift className="text-purple-600" />
                    Canje de Puntos de Magia
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <RewardCard points={500} discount="7% OFF" onRedeem={handleRedeem} />
                    <RewardCard points={1000} discount="25% OFF" onRedeem={handleRedeem} />
                </div>
            </div>

            <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Catálogo de Productos</h2>
            {filteredProducts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredProducts.map(product => (
                        <ProductCard key={product.id} product={product} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-20 text-gray-500">
                    <ShoppingBag size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No hay productos disponibles en esta categoría por el momento.</p>
                </div>
            )}

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