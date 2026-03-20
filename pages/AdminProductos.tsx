import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { Upload, DollarSign, Tag, Book, FileText, Plus, Image as ImageIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AdminProductos: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        nombre: '',
        autor: '',
        isbn: '',
        descripcion: '',
        precio: '',
        precio_descuento_puntos: '',
        categoria: 'libro_impreso',
        imagen_url: ''
    });

    const [imgPreview, setImgPreview] = useState<string | null>(null);
    const [wordCount, setWordCount] = useState(0);

    const checkWordCount = (text: string) => {
        const count = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        setWordCount(count);
        return count;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;

        if (name === 'descripcion') {
            checkWordCount(value);
        }

        if (name === 'imagen_url') {
            setImgPreview(value);
        }

        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Basic Validation
        if (!formData.nombre || !formData.precio || !formData.descripcion) {
            alert('Por favor completa los campos obligatorios.');
            return;
        }

        // Add Product
        dataService.addProduct({
            nombre: formData.nombre,
            autor: formData.autor,
            isbn: formData.isbn,
            descripcion: formData.descripcion,
            precio: parseFloat(formData.precio),
            precio_descuento_puntos: formData.precio_descuento_puntos ? parseInt(formData.precio_descuento_puntos) : undefined,
            categoria: formData.categoria as any,
            imagen_url: formData.imagen_url || 'https://via.placeholder.com/300x400?text=Sin+Imagen',
            url_compra: '#' // Placeholder internal link
        });

        alert('Producto creado exitosamente.');
        navigate('/tienda'); // Redirect to Store to see it
    };

    if (!user || !user.roles.includes('administrador')) {
        return <div className="p-8 text-center">Acceso Denegado</div>;
    }

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
            <header className="mb-8 max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold flex items-center text-indigo-700 dark:text-indigo-400">
                    <Upload className="mr-3" size={32} /> Subir Producto a Tienda
                </h1>
                <p className="text-gray-500 dark:text-gray-400">Agrega nuevos ítems al catálogo (Libros, Ropa, Memorabilia)</p>
            </header>

            <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">

                        {/* BASIC INFO ROW */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold mb-2 flex items-center"><Tag size={16} className="mr-2 text-indigo-500" /> Nombre del Producto <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    name="nombre"
                                    value={formData.nombre}
                                    onChange={handleChange}
                                    className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-indigo-500"
                                    placeholder="Ej. Camiseta Oficial Chibalete"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold mb-2 flex items-center"><Tag size={16} className="mr-2 text-indigo-500" /> Categoría</label>
                                <select
                                    name="categoria"
                                    value={formData.categoria}
                                    onChange={handleChange}
                                    className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="libro_impreso">Libro Impreso</option>
                                    <option value="ropa">Ropa / Vestuario</option>
                                    <option value="memorabilia">Memorabilia / Coleccionables</option>
                                    <option value="papeleria">Papelería</option>
                                    <option value="accesorios">Accesorios</option>
                                </select>
                            </div>
                        </div>

                        {/* BOOK SPECIFICS ROW - Conditionally show or just enable always? User said "Libros, ropa..." so fields like Author/ISBN matter mostly for books but can be optional */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-lg border border-indigo-100 dark:border-indigo-900/30">
                            <div>
                                <label className="block text-sm font-bold mb-2 flex items-center text-indigo-800 dark:text-indigo-300"><Book size={16} className="mr-2" /> Autor (Solo Libros)</label>
                                <input
                                    type="text"
                                    name="autor"
                                    value={formData.autor}
                                    onChange={handleChange}
                                    className="w-full p-3 rounded-lg border border-indigo-200 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-indigo-500"
                                    placeholder="Ej. Gabriel García Márquez"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold mb-2 flex items-center text-indigo-800 dark:text-indigo-300"><Book size={16} className="mr-2" /> ISBN / Código</label>
                                <input
                                    type="text"
                                    name="isbn"
                                    value={formData.isbn}
                                    onChange={handleChange}
                                    className="w-full p-3 rounded-lg border border-indigo-200 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-indigo-500"
                                    placeholder="Ej. 978-3-16-148410-0"
                                />
                            </div>
                        </div>

                        {/* PRICE ROW */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold mb-2 flex items-center"><DollarSign size={16} className="mr-2 text-green-600" /> Precio (COP) <span className="text-red-500">*</span></label>
                                <input
                                    type="number"
                                    name="precio"
                                    value={formData.precio}
                                    onChange={handleChange}
                                    className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-green-500 font-mono text-lg"
                                    placeholder="0"
                                    min="0"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold mb-2 flex items-center text-purple-600 dark:text-purple-400"><Tag size={16} className="mr-2" /> Precio en Puntos (Descuento)</label>
                                <input
                                    type="number"
                                    name="precio_descuento_puntos"
                                    value={formData.precio_descuento_puntos}
                                    onChange={handleChange}
                                    className="w-full p-3 rounded-lg border border-purple-200 dark:border-gray-600 bg-purple-50 dark:bg-gray-700 focus:ring-2 focus:ring-purple-500 font-mono text-lg text-purple-700 dark:text-purple-300"
                                    placeholder="Ej. 500 Puntos"
                                    min="0"
                                />
                                <p className="text-xs text-purple-400 mt-1">Opcional. Permite canje parcial o total.</p>
                            </div>
                        </div>

                        {/* DESCRIPTION */}
                        <div>
                            <label className="block text-sm font-bold mb-2 flex items-center"><FileText size={16} className="mr-2 text-gray-500" /> Descripción (Aprox 300 palabras) <span className="text-red-500">*</span></label>
                            <textarea
                                name="descripcion"
                                value={formData.descripcion}
                                onChange={handleChange}
                                rows={6}
                                className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-indigo-500"
                                placeholder="Describe el producto detalladamente..."
                                required
                            />
                            <div className="flex justify-between mt-1 text-xs">
                                <span className={`${wordCount > 350 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                    {wordCount} palabras
                                </span>
                                <span className="text-gray-400">Recomendado: ~300</span>
                            </div>
                        </div>

                        {/* IMAGE URL */}
                        <div>
                            <label className="block text-sm font-bold mb-2 flex items-center"><ImageIcon size={16} className="mr-2 text-gray-500" /> URL de Imagen <span className="text-red-500">*</span></label>
                            <div className="flex gap-4 items-start">
                                <input
                                    type="text"
                                    name="imagen_url"
                                    value={formData.imagen_url}
                                    onChange={handleChange}
                                    className="flex-1 p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:ring-2 focus:ring-indigo-500"
                                    placeholder="https://..."
                                    required
                                />
                                {imgPreview && (
                                    <div className="w-24 h-24 rounded-lg border border-gray-200 overflow-hidden bg-gray-100 flex-shrink-0">
                                        <img src={imgPreview} alt="Preview" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/100?text=Error')} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="pt-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-4">
                            <button
                                type="button"
                                onClick={() => navigate('/admin-dashboard')}
                                className="px-6 py-3 rounded-lg font-bold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                className="px-8 py-3 rounded-lg font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg transition-all flex items-center transform hover:scale-105"
                            >
                                <Plus size={20} className="mr-2" /> Publicar Producto
                            </button>
                        </div>

                    </form>
                </div>
            </div>
        </div>
    );
};

export default AdminProductos;
