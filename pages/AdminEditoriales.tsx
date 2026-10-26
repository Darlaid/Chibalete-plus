import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { Publisher, PublisherAudit } from '../types';
import { Building2, Plus, Edit2, AlertTriangle, CheckCircle, BookOpen, X, Save } from 'lucide-react';

// CHP-EDITORIAL-ROYALTIES-2026-01 F1-B — administración de editoriales.
// Usa /api/admin/publishers (F1-A). Sin borrado desde la interfaz: una
// editorial se desactiva. La editorial responsable de una obra no acredita por
// sí sola derechos económicos (eso es la matriz de derechos, F2-A).

type FormState = {
    kind: Publisher['kind'];
    legalName: string;
    tradeName: string;
    taxId: string;
    imprints: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    notes: string;
};

const EMPTY_FORM: FormState = {
    kind: 'editorial', legalName: '', tradeName: '', taxId: '', imprints: '',
    contactName: '', contactEmail: '', contactPhone: '', notes: '',
};

const toForm = (p: Publisher): FormState => ({
    kind: p.kind,
    legalName: p.legalName,
    tradeName: p.tradeName ?? '',
    taxId: p.taxId ?? '',
    imprints: (p.imprints || []).join(', '),
    contactName: p.contactName ?? '',
    contactEmail: p.contactEmail ?? '',
    contactPhone: p.contactPhone ?? '',
    notes: p.notes ?? '',
});

const toBody = (f: FormState): Partial<Publisher> => ({
    kind: f.kind,
    legalName: f.legalName.trim(),
    tradeName: f.tradeName.trim() || null,
    taxId: f.taxId.trim() || null,
    imprints: f.imprints.split(',').map(s => s.trim()).filter(Boolean),
    contactName: f.contactName.trim() || null,
    contactEmail: f.contactEmail.trim() || null,
    contactPhone: f.contactPhone.trim() || null,
    notes: f.notes.trim() || null,
});

const FIELDS: Array<{ key: keyof FormState; label: string; type?: string; required?: boolean; max: number }> = [
    { key: 'legalName', label: 'Razón social', required: true, max: 200 },
    { key: 'tradeName', label: 'Nombre comercial', max: 200 },
    { key: 'taxId', label: 'NIT / identificación tributaria', max: 40 },
    { key: 'imprints', label: 'Sellos (separados por comas)', max: 2000 },
    { key: 'contactName', label: 'Persona de contacto', max: 120 },
    { key: 'contactEmail', label: 'Correo de contacto', type: 'email', max: 160 },
    { key: 'contactPhone', label: 'Teléfono de contacto', type: 'tel', max: 40 },
];

const AdminEditoriales: React.FC = () => {
    const { user } = useAuth();
    const [publishers, setPublishers] = useState<Publisher[] | null>(null);
    const [audit, setAudit] = useState<PublisherAudit | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [editing, setEditing] = useState<string | 'new' | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        const [list, census] = await Promise.all([
            dataService.getAdminPublishers({ withCounts: true }),
            dataService.getPublisherAudit(),
        ]);
        setLoadError(list === null);
        if (list !== null) setPublishers(list);
        setAudit(census);
    }, []);

    useEffect(() => { load(); }, [load]);

    if (!user || !user.roles.includes('administrador')) {
        return <div className="p-8 text-center text-red-500">Acceso restringido a administradores.</div>;
    }

    const startNew = () => { setEditing('new'); setForm(EMPTY_FORM); setError(null); setNotice(null); };
    const startEdit = (p: Publisher) => { setEditing(p.id); setForm(toForm(p)); setError(null); setNotice(null); };
    const cancel = () => { setEditing(null); setError(null); };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.legalName.trim()) { setError('La razón social es obligatoria.'); return; }
        setSaving(true);
        setError(null);
        try {
            const saved = await dataService.savePublisher(editing === 'new' ? null : editing, toBody(form));
            setNotice(editing === 'new' ? `Editorial «${saved.tradeName || saved.legalName}» creada.` : 'Cambios guardados.');
            setEditing(null);
            await load();
        } catch (err: any) {
            setError(err?.message || 'No se pudo guardar la editorial.');
        } finally {
            setSaving(false);
        }
    };

    const toggleStatus = async (p: Publisher) => {
        const next = p.status === 'active' ? 'inactive' : 'active';
        setError(null);
        setNotice(null);
        try {
            await dataService.savePublisher(p.id, { status: next });
            setNotice(next === 'active'
                ? `«${p.tradeName || p.legalName}» activada.`
                : `«${p.tradeName || p.legalName}» desactivada. Sus libros conservan la asociación; no podrá asignarse a libros nuevos.`);
            await load();
        } catch (err: any) {
            setError(err?.message || 'No se pudo cambiar el estado.');
        }
    };

    const pendingBooks = audit ? audit.missing.length + audit.unknown.length : 0;

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
            <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold flex items-center text-indigo-700 dark:text-indigo-400">
                        <Building2 className="mr-3" size={32} aria-hidden="true" /> Editoriales
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 max-w-2xl">
                        Todo libro tiene una editorial responsable. La editorial responsable identifica la obra para su trazabilidad;
                        no acredita por sí sola derechos económicos ni la condición de beneficiario.
                    </p>
                </div>
                <button type="button" onClick={startNew} className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700">
                    <Plus size={18} className="mr-1" aria-hidden="true" /> Nueva editorial
                </button>
            </header>

            {audit && (
                <div role="status" className={`mb-6 p-4 rounded-xl border text-sm flex flex-wrap items-center gap-2 ${pendingBooks === 0
                    ? 'border-green-200 bg-green-50 text-green-900 dark:bg-green-900/20 dark:text-green-200 dark:border-green-800'
                    : 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800'}`}>
                    {pendingBooks === 0
                        ? <><CheckCircle size={16} aria-hidden="true" /> {audit.booksWithPublisher} de {audit.books} libros con editorial responsable válida.</>
                        : <>
                            <AlertTriangle size={16} aria-hidden="true" />
                            {pendingBooks} libro(s) por regularizar: {audit.missing.length} sin editorial, {audit.unknown.length} con una editorial inexistente.
                            <Link to="/subir-contenido?editorial=__sin_editorial__" className="underline font-semibold">Ver libros sin editorial</Link>
                        </>}
                </div>
            )}

            {loadError && (
                <div role="alert" className="mb-6 p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200 text-sm">
                    No se pudo cargar el registro de editoriales. Reintenta en unos minutos.
                </div>
            )}
            {error && <div role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200 text-sm">{error}</div>}
            {notice && <div role="status" className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200 text-sm">{notice}</div>}

            {editing && (
                <form onSubmit={submit} className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6" aria-labelledby="ed-form-title">
                    <div className="flex items-center justify-between mb-4">
                        <h2 id="ed-form-title" className="text-lg font-bold">{editing === 'new' ? 'Nueva editorial' : 'Editar editorial'}</h2>
                        <button type="button" onClick={cancel} aria-label="Cerrar formulario" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X size={18} /></button>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="ed-kind" className="block text-sm font-medium mb-1">Tipo de titular</label>
                            <select id="ed-kind" value={form.kind} onChange={(e) => setForm(f => ({ ...f, kind: e.target.value as FormState['kind'] }))}
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg">
                                <option value="editorial">Editorial</option>
                                <option value="tercero">Tercero con derechos</option>
                            </select>
                        </div>
                        {FIELDS.map(({ key, label, type, required, max }) => (
                            <div key={key}>
                                <label htmlFor={`ed-${key}`} className="block text-sm font-medium mb-1">{label}{required ? '' : ' (opcional)'}</label>
                                <input id={`ed-${key}`} type={type || 'text'} value={form[key]} required={required} maxLength={max}
                                    onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
                                    className="w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg" />
                            </div>
                        ))}
                        <div className="md:col-span-2">
                            <label htmlFor="ed-notes" className="block text-sm font-medium mb-1">Notas administrativas (opcional)</label>
                            <textarea id="ed-notes" rows={3} maxLength={1000} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg resize-none" />
                            <p className="text-xs text-gray-500 mt-1">Sin datos bancarios: este registro solo guarda identificación y contacto.</p>
                        </div>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={cancel} className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 font-semibold">Cancelar</button>
                        <button type="submit" disabled={saving} className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50">
                            <Save size={16} className="mr-1" aria-hidden="true" /> {saving ? 'Guardando…' : 'Guardar'}
                        </button>
                    </div>
                </form>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
                {publishers === null ? (
                    <p className="p-6 text-gray-500">{loadError ? 'Sin datos.' : 'Cargando editoriales…'}</p>
                ) : (
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 uppercase">
                            <tr>
                                <th scope="col" className="p-3">Editorial</th>
                                <th scope="col" className="p-3">Identificación</th>
                                <th scope="col" className="p-3">Contacto</th>
                                <th scope="col" className="p-3">Sellos</th>
                                <th scope="col" className="p-3">Libros</th>
                                <th scope="col" className="p-3">Estado</th>
                                <th scope="col" className="p-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {publishers.map(p => (
                                <tr key={p.id}>
                                    <td className="p-3">
                                        <div className="font-medium text-gray-900 dark:text-gray-100">{p.tradeName || p.legalName}</div>
                                        {p.tradeName && p.tradeName !== p.legalName && <div className="text-xs text-gray-500">{p.legalName}</div>}
                                        <div className="text-xs text-gray-400">{p.kind === 'editorial' ? 'Editorial' : 'Tercero con derechos'}</div>
                                    </td>
                                    <td className="p-3 text-gray-500">{p.taxId || '—'}</td>
                                    <td className="p-3 text-gray-500">
                                        {p.contactName || p.contactEmail || p.contactPhone
                                            ? <>{p.contactName && <div>{p.contactName}</div>}{p.contactEmail && <div>{p.contactEmail}</div>}{p.contactPhone && <div>{p.contactPhone}</div>}</>
                                            : '—'}
                                    </td>
                                    <td className="p-3 text-gray-500">{p.imprints?.length ? p.imprints.join(', ') : '—'}</td>
                                    <td className="p-3">
                                        <Link to={`/subir-contenido?editorial=${encodeURIComponent(p.id)}`} className="inline-flex items-center text-indigo-600 dark:text-indigo-400 hover:underline"
                                            aria-label={`Ver los contenidos de ${p.tradeName || p.legalName}`}>
                                            <BookOpen size={14} className="mr-1" aria-hidden="true" /> {p.bookCount ?? 0}
                                        </Link>
                                        {(p.contentCount ?? 0) > (p.bookCount ?? 0) && (
                                            <div className="text-xs text-gray-400">+{(p.contentCount ?? 0) - (p.bookCount ?? 0)} recursos</div>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${p.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                                            {p.status === 'active' ? 'Activa' : 'Inactiva'}
                                        </span>
                                    </td>
                                    <td className="p-3 text-right whitespace-nowrap">
                                        <button type="button" onClick={() => startEdit(p)}
                                            className="mr-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-200 font-bold inline-flex items-center">
                                            <Edit2 size={14} className="mr-1" aria-hidden="true" /> Editar
                                        </button>
                                        <button type="button" onClick={() => toggleStatus(p)}
                                            className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 font-bold">
                                            {p.status === 'active' ? 'Desactivar' : 'Activar'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default AdminEditoriales;
