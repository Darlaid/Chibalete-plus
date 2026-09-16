// CHP-LANDING-BANNER-02 — gestión del banner de /bienvenida desde Administrador → Subir.
// Las imágenes se suben con el uploader existente (dataService.uploadFile); el
// backend valida y normaliza el array completo en un único PUT. Retirar un
// slide solo quita la referencia: el archivo subido no se borra.
import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Trash } from 'lucide-react';
import { dataService, type LandingBannerSlide } from '../services/dataService';

type Status = { type: 'error' | 'success'; message: string } | null;

const inputClass = 'w-full p-2 border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-sm';

const LandingBannerManager: React.FC = () => {
    const [slides, setSlides] = useState<LandingBannerSlide[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<Status>(null);

    useEffect(() => {
        dataService.getLandingBannerAdmin()
            .then(setSlides)
            .catch((e: Error) => setStatus({ type: 'error', message: e.message }))
            .finally(() => setLoading(false));
    }, []);

    const update = (index: number, patch: Partial<LandingBannerSlide>) => {
        setSlides(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
        setStatus(null);
    };

    const move = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= slides.length) return;
        const next = [...slides];
        [next[index], next[target]] = [next[target], next[index]];
        setSlides(next);
        setStatus(null);
    };

    const remove = (index: number) => {
        setSlides(prev => prev.filter((_, i) => i !== index));
        setStatus(null);
    };

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        setStatus(null);
        try {
            const imageUrl = await dataService.uploadFile(file);
            setSlides(prev => [...prev, { id: `banner-${Date.now()}`, imageUrl, order: prev.length, active: true }]);
        } catch (err) {
            setStatus({ type: 'error', message: (err as Error).message });
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const saved = await dataService.saveLandingBanner(slides.map((s, i) => ({ ...s, order: i })));
            setSlides(saved);
            setStatus({ type: 'success', message: 'Cambios guardados.' });
        } catch (err) {
            setStatus({ type: 'error', message: (err as Error).message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold mb-2 text-gray-800 dark:text-gray-200">Banner de bienvenida</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Imágenes del carrusel de la página de bienvenida. Los cambios se publican al pulsar «Guardar cambios».
            </p>

            {loading ? (
                <p className="flex items-center text-gray-500" role="status">
                    <Loader2 className="mr-2 animate-spin" size={18} /> Cargando banner…
                </p>
            ) : (
                <>
                    {slides.length === 0 && (
                        <p className="text-gray-500 mb-6">Todavía no hay imágenes en el banner.</p>
                    )}

                    <ul className="space-y-4 mb-6">
                        {slides.map((slide, i) => (
                            <li key={`${slide.id}-${i}`} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col md:flex-row gap-4">
                                <img
                                    src={slide.imageUrl}
                                    alt={slide.title || `Imagen ${i + 1} del banner`}
                                    className="w-full md:w-48 h-28 object-cover rounded-md bg-gray-100 dark:bg-gray-900"
                                />
                                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="text-sm">
                                        <span className="block mb-1 font-medium">Título (opcional)</span>
                                        <input className={inputClass} value={slide.title ?? ''} onChange={e => update(i, { title: e.target.value })} />
                                    </label>
                                    <label className="text-sm">
                                        <span className="block mb-1 font-medium">Texto (opcional)</span>
                                        <input className={inputClass} value={slide.text ?? ''} onChange={e => update(i, { text: e.target.value })} />
                                    </label>
                                    <label className="text-sm">
                                        <span className="block mb-1 font-medium">Enlace https:// (opcional)</span>
                                        <input type="url" className={inputClass} placeholder="https://" value={slide.linkUrl ?? ''} onChange={e => update(i, { linkUrl: e.target.value })} />
                                    </label>
                                    <label className="text-sm">
                                        <span className="block mb-1 font-medium">Texto del botón (opcional)</span>
                                        <input className={inputClass} value={slide.linkLabel ?? ''} onChange={e => update(i, { linkLabel: e.target.value })} />
                                    </label>
                                    <label className="text-sm flex items-center gap-2">
                                        <input type="checkbox" checked={slide.active} onChange={e => update(i, { active: e.target.checked })} />
                                        Activo
                                    </label>
                                </div>
                                <div className="flex md:flex-col gap-2">
                                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir imagen ${i + 1}`} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40">
                                        <ArrowUp size={16} />
                                    </button>
                                    <button type="button" onClick={() => move(i, 1)} disabled={i === slides.length - 1} aria-label={`Bajar imagen ${i + 1}`} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40">
                                        <ArrowDown size={16} />
                                    </button>
                                    <button type="button" onClick={() => remove(i)} aria-label={`Quitar imagen ${i + 1} del banner`} className="p-2 rounded-lg border border-red-300 text-red-600">
                                        <Trash size={16} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <label className={`flex items-center justify-center px-4 py-2 rounded-lg border-2 border-dashed border-indigo-300 text-indigo-600 cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                            {uploading ? <Loader2 className="mr-2 animate-spin" size={18} /> : <ImagePlus className="mr-2" size={18} />}
                            {uploading ? 'Subiendo imagen…' : 'Añadir imagen'}
                            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={handleFile} disabled={uploading} />
                        </label>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving || uploading}
                            className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {saving ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                    </div>
                </>
            )}

            {status && (
                <p role={status.type === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${status.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                    {status.message}
                </p>
            )}
        </div>
    );
};

export default LandingBannerManager;
