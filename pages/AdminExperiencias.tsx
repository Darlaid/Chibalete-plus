import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { Bundle, Content } from '../types';
import { Plus, Edit2, Trash2, X, Save, BookOpen, Sparkles } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

type FormState = {
    name: string;
    shortDescription: string;
    summary: string;
    includesText: string;   // una línea por elemento
    contentIds: string[];
    tagsText: string;       // separadas por coma
};

const emptyForm = (): FormState => ({
    name: '', shortDescription: '', summary: '',
    includesText: '', contentIds: [], tagsText: ''
});

const bundleToForm = (b: Bundle): FormState => ({
    name: b.name,
    shortDescription: b.shortDescription || b.description || '',
    summary: b.summary || '',
    includesText: (b.includes || []).join('\n'),
    contentIds: [...b.contentIds],
    tagsText: (b.tags || []).join(', ')
});

const formToPayload = (form: FormState): Omit<Bundle, 'id'> => ({
    name: form.name.trim(),
    shortDescription: form.shortDescription.trim(),
    description: form.shortDescription.trim(),        // compat legacy
    summary: form.summary.trim(),
    includes: form.includesText.split('\n').map(s => s.trim()).filter(Boolean),
    contentIds: form.contentIds,
    tags: form.tagsText.split(',').map(s => s.trim()).filter(Boolean)
});

// ─── Component ───────────────────────────────────────────────────────────────

const AdminExperiencias: React.FC = () => {
    const { user } = useAuth();

    const [experiences, setExperiences] = useState<Bundle[]>([]);
    const [catalog, setCatalog] = useState<Content[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setExperiences(dataService.getBundles());
        if (user) {
            setCatalog(
                dataService.getContenidos(user.roles, user.id)
                    .filter(c => c.tipo === 'libro' || c.tipo === 'guia' || !!c.isCollection)
            );
        }
    }, [user]);

    if (!user?.roles.includes('administrador')) {
        return <div className="p-8 text-center text-gray-500">Acceso Denegado</div>;
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    const openCreate = () => {
        setEditingId(null);
        setForm(emptyForm());
        setError('');
        setShowModal(true);
    };

    const openEdit = (b: Bundle) => {
        setEditingId(b.id);
        setForm(bundleToForm(b));
        setError('');
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('¿Eliminar esta experiencia? Esta acción no se puede deshacer.')) return;
        try {
            await dataService.deleteBundle(id);
            setExperiences(dataService.getBundles());
        } catch {
            alert('Error al eliminar la experiencia.');
        }
    };

    const toggleContentId = (id: string) => {
        setForm(prev => ({
            ...prev,
            contentIds: prev.contentIds.includes(id)
                ? prev.contentIds.filter(x => x !== id)
                : [...prev.contentIds, id]
        }));
    };

    const handleSave = async () => {
        if (!form.name.trim()) { setError('El nombre es obligatorio.'); return; }
        setSaving(true);
        setError('');
        try {
            if (editingId) {
                await dataService.updateBundle(editingId, formToPayload(form));
            } else {
                await dataService.createBundle(formToPayload(form));
            }
            setExperiences(dataService.getBundles());
            setShowModal(false);
        } catch {
            setError('Error al guardar. Verifica la conexión con el servidor.');
        } finally {
            setSaving(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">

            {/* Header */}
            <header className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold flex items-center text-indigo-700 dark:text-indigo-400">
                        <Sparkles className="mr-3" size={30} /> Experiencias
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Gestiona las experiencias de lectura disponibles para mediadores.
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold shadow transition-colors"
                >
                    <Plus size={18} className="mr-2" /> Nueva Experiencia
                </button>
            </header>

            {/* List */}
            {experiences.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                    <Sparkles size={40} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-gray-500">No hay experiencias definidas.</p>
                    <button onClick={openCreate} className="mt-3 text-indigo-600 text-sm hover:underline">
                        Crear la primera
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {experiences.map(b => (
                        <div
                            key={b.id}
                            className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <p className="font-bold text-lg">{b.name}</p>
                                    {b.tags?.map(t => (
                                        <span key={t} className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded dark:bg-amber-900/30 dark:text-amber-300">
                                            {t}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {b.shortDescription || b.description}
                                </p>
                                {b.includes && b.includes.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {b.includes.map(inc => (
                                            <span key={inc} className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                                                {inc}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-gray-400 mt-2">
                                    {b.contentIds.length} contenido{b.contentIds.length !== 1 ? 's' : ''}
                                    <span className="ml-2 font-mono opacity-60">{b.id}</span>
                                </p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <button
                                    onClick={() => openEdit(b)}
                                    title="Editar"
                                    className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button
                                    onClick={() => handleDelete(b.id)}
                                    title="Eliminar"
                                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal Crear / Editar */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">

                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold">
                                {editingId ? 'Editar Experiencia' : 'Nueva Experiencia'}
                            </h3>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-5">

                            {/* Nombre */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    Nombre <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                                    placeholder="Ej: Primeros Lectores"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            {/* Descripción corta */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    Descripción corta
                                </label>
                                <input
                                    type="text"
                                    value={form.shortDescription}
                                    onChange={e => setForm(p => ({ ...p, shortDescription: e.target.value }))}
                                    placeholder="Tagline para mostrar en tarjetas"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            {/* Resumen */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    Resumen
                                </label>
                                <textarea
                                    value={form.summary}
                                    onChange={e => setForm(p => ({ ...p, summary: e.target.value }))}
                                    rows={3}
                                    placeholder="Descripción extendida de la experiencia"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                />
                            </div>

                            {/* Incluye */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    Incluye <span className="text-gray-400 font-normal normal-case">(una línea por elemento)</span>
                                </label>
                                <textarea
                                    value={form.includesText}
                                    onChange={e => setForm(p => ({ ...p, includesText: e.target.value }))}
                                    rows={3}
                                    placeholder={"3 libros\n2 guías de comprensión\nActividades semanales"}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
                                />
                            </div>

                            {/* Contenido */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                                    Contenido habilitado
                                </label>
                                {catalog.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">No hay libros en el catálogo.</p>
                                ) : (
                                    <div className="space-y-1 max-h-52 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50">
                                        {catalog.map(c => (
                                            <label
                                                key={c.id}
                                                className="flex items-center gap-2 cursor-pointer hover:bg-white dark:hover:bg-gray-800 px-2 py-1.5 rounded transition-colors"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={form.contentIds.includes(c.id)}
                                                    onChange={() => toggleContentId(c.id)}
                                                    className="accent-indigo-600 w-4 h-4"
                                                />
                                                <BookOpen size={12} className="text-gray-400 flex-shrink-0" />
                                                <span className="text-sm font-medium">{c.titulo}</span>
                                                <span className="text-xs text-gray-400 ml-auto">{c.tipo}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-gray-400 mt-1">
                                    {form.contentIds.length} seleccionado{form.contentIds.length !== 1 ? 's' : ''}
                                </p>
                            </div>

                            {/* Etiquetas */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    Etiquetas <span className="text-gray-400 font-normal normal-case">(separadas por coma)</span>
                                </label>
                                <input
                                    type="text"
                                    value={form.tagsText}
                                    onChange={e => setForm(p => ({ ...p, tagsText: e.target.value }))}
                                    placeholder="primaria, cuento, iniciación"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            {error && (
                                <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                                    {error}
                                </p>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold text-sm disabled:opacity-50 transition-colors"
                            >
                                <Save size={15} className="mr-2" />
                                {saving ? 'Guardando…' : 'Guardar'}
                            </button>
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminExperiencias;
