
import React, { useState, useEffect } from 'react';
import { X, Zap, Clock, BookOpen, Layers, Target, Users, Globe, GraduationCap, MessageSquare, Sparkles, Plus, Trash2 } from 'lucide-react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import type { Content, Bundle } from '../types';

interface QuickClubModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const QuickClubModal: React.FC<QuickClubModalProps> = ({ isOpen, onClose }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [isSaving, setIsSaving] = useState(false);
    const [allContent, setAllContent] = useState<Content[]>([]);
    const [bundles, setBundles] = useState<Bundle[]>([]);

    const [form, setForm] = useState({
        name: '',
        kind: 'school' as 'school' | 'open',
        contentType: 'all' as 'all' | 'collection' | 'book',
        selectedContentId: '',
        durationDays: '30',
        // Open club specific
        activeExperienceId: '',
        mediationMessage: '',
        mediationQuestions: [''] as string[]
    });

    useEffect(() => {
        if (isOpen) {
            const books = dataService.getBooks();
            const cols = dataService.getCollections();
            setAllContent([...books, ...cols]);
            setBundles(dataService.getBundles());

            if (form.contentType === 'book' && !form.selectedContentId && books.length > 0) {
                setForm(f => ({ ...f, selectedContentId: books[0].id }));
            } else if (form.contentType === 'collection' && !form.selectedContentId && cols.length > 0) {
                setForm(f => ({ ...f, selectedContentId: cols[0].id }));
            }
        }
    }, [isOpen]);

    // ── Question helpers ──────────────────────────────────────────────────────

    const addQuestion = () => {
        if (form.mediationQuestions.length < 3) {
            setForm(f => ({ ...f, mediationQuestions: [...f.mediationQuestions, ''] }));
        }
    };

    const updateQuestion = (i: number, val: string) => {
        setForm(f => {
            const q = [...f.mediationQuestions];
            q[i] = val;
            return { ...f, mediationQuestions: q };
        });
    };

    const removeQuestion = (i: number) => {
        setForm(f => ({
            ...f,
            mediationQuestions: f.mediationQuestions.filter((_, idx) => idx !== i)
        }));
    };

    // ── Submit ────────────────────────────────────────────────────────────────

    const handleCreate = async () => {
        if (!form.name || !user) return;
        if (!user.colegio) {
            alert('Tu cuenta no tiene un colegio asociado. Pide al administrador que configure el campo "colegio" en tu perfil antes de crear un club.');
            return;
        }

        setIsSaving(true);
        try {
            const payload: any = {
                name: form.name,
                school: user.colegio,
                type: 'club',
                kind: form.kind,
                mediatorIds: [user.id],
                grade: 'Club'
            };

            if (form.kind === 'school') {
                // ── Flujo existente sin cambios ──────────────────────────────
                const endsAt = new Date();
                endsAt.setDate(endsAt.getDate() + parseInt(form.durationDays));
                payload.accessEndsAt = endsAt.toISOString();

                if (form.contentType === 'book') {
                    payload.availableContentIds = [form.selectedContentId];
                } else if (form.contentType === 'collection') {
                    payload.availableContentIds = [];
                    payload.collectionIds = [form.selectedContentId];
                } else {
                    payload.availableContentIds = 'all';
                }

                const savedGroup = await dataService.createGroup(payload);

                const rulePayload: any = {
                    scope: 'group',
                    scopeId: savedGroup.id,
                    expiresAt: endsAt.getTime()
                };
                if (form.contentType === 'book') rulePayload.titleIds = [form.selectedContentId];
                else if (form.contentType === 'collection') rulePayload.collectionIds = [form.selectedContentId];
                if (form.contentType !== 'all') await dataService.createAccessRule(rulePayload);

                onClose();
                navigate('/aula-viva');

            } else {
                // ── Flujo club abierto ───────────────────────────────────────
                if (form.activeExperienceId) {
                    const bundle = bundles.find(b => b.id === form.activeExperienceId);
                    payload.activeExperienceId = form.activeExperienceId;
                    payload.availableContentIds = bundle?.contentIds ?? [];
                } else {
                    payload.availableContentIds = 'all';
                }

                const cleanQuestions = form.mediationQuestions.map(q => q.trim()).filter(Boolean);
                if (form.mediationMessage.trim()) payload.mediationMessage = form.mediationMessage.trim();
                if (cleanQuestions.length > 0) payload.mediationQuestions = cleanQuestions;

                const savedGroup = await dataService.createGroup(payload);
                onClose();
                navigate(`/clubs/${savedGroup.id}`);
            }
        } catch (err: any) {
            alert(`Error al crear club: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const collections = allContent.filter(c => c.isCollection);
    const books = allContent.filter(c => !c.isCollection);
    const isOpen_ = form.kind === 'open';
    const canSubmit = !isSaving && !!form.name && !!user?.colegio && (
        isOpen_ || (form.contentType === 'all' || !!form.selectedContentId)
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">

                {/* Header */}
                <div className={`p-6 flex justify-between items-center ${isOpen_ ? 'bg-gradient-to-r from-pink-500 to-indigo-600' : 'bg-gradient-to-r from-indigo-600 to-purple-600'}`}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                            {isOpen_ ? <Globe className="text-white" size={22} /> : <Zap className="text-white" size={22} />}
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">Nuevo Club de Lectura</h3>
                            <p className="text-white/70 text-xs">
                                {isOpen_ ? 'Club abierto — cualquier lector puede unirse' : 'Club escolar — para tus alumnos'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={24} className="text-white" />
                    </button>
                </div>

                <div className="p-8 space-y-6 overflow-y-auto max-h-[70vh]">

                    {/* Nombre */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1">
                            ¿Cómo se llamará el club?
                        </label>
                        <input
                            type="text"
                            autoFocus
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Ej: Club de lectura 5A"
                            className="w-full px-5 py-4 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 rounded-2xl outline-none transition-all text-lg font-bold text-gray-800 dark:text-gray-100 shadow-inner"
                        />
                    </div>

                    {/* Tipo de club */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1">
                            Tipo de club
                        </label>
                        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                            {[
                                { val: 'school', label: 'Escolar', Icon: GraduationCap },
                                { val: 'open',   label: 'Abierto', Icon: Globe }
                            ].map(({ val, label, Icon }) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setForm(f => ({ ...f, kind: val as any }))}
                                    className={`flex-1 py-2.5 flex items-center justify-center gap-2 rounded-lg transition-all text-sm font-bold ${form.kind === val ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                                >
                                    <Icon size={15} />
                                    {label}
                                </button>
                            ))}
                        </div>
                        {isOpen_ && (
                            <p className="text-xs text-pink-500 font-medium ml-1">
                                Visible en /clubes — cualquier usuario autenticado puede unirse.
                            </p>
                        )}
                    </div>

                    {/* ── ESCOLAR: duración + contenido (sin cambios) ────────── */}
                    {!isOpen_ && (
                        <>
                            <div className="grid md:grid-cols-2 gap-6">
                                {/* Duration */}
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                        <Clock size={14} /> Duración
                                    </label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[{ label: '7d', val: '7' }, { label: '14d', val: '14' }, { label: '30d', val: '30' }].map(d => (
                                            <button
                                                key={d.val}
                                                type="button"
                                                onClick={() => setForm(f => ({ ...f, durationDays: d.val }))}
                                                className={`py-3 rounded-xl border-2 font-black text-sm transition-all ${form.durationDays === d.val ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200 dark:shadow-none' : 'bg-white dark:bg-gray-800 text-gray-400 border-gray-100 dark:border-gray-700 hover:border-indigo-200'}`}
                                            >
                                                {d.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Content Type */}
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                        <Layers size={14} /> Contenido
                                    </label>
                                    <div className="flex bg-gray-100 dark:bg-gray-800/80 p-1 rounded-xl">
                                        {[
                                            { label: 'Todo',     val: 'all',        icon: Target },
                                            { label: 'Colección', val: 'collection', icon: BookOpen },
                                            { label: 'Libro',    val: 'book',       icon: Zap }
                                        ].map(c => (
                                            <button
                                                key={c.val}
                                                type="button"
                                                onClick={() => setForm(f => ({
                                                    ...f,
                                                    contentType: c.val as any,
                                                    selectedContentId: c.val === 'collection' ? (collections[0]?.id || '') : c.val === 'book' ? (books[0]?.id || '') : ''
                                                }))}
                                                className={`flex-1 py-2 flex flex-col items-center gap-1 rounded-lg transition-all ${form.contentType === c.val ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                                            >
                                                <c.icon size={15} />
                                                <span className="text-[10px] font-black uppercase">{c.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {form.contentType !== 'all' && (
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1">
                                        {form.contentType === 'collection' ? 'Selecciona la colección' : 'Selecciona el libro'}
                                    </label>
                                    <select
                                        value={form.selectedContentId}
                                        onChange={e => setForm(f => ({ ...f, selectedContentId: e.target.value }))}
                                        className="w-full p-4 bg-gray-50 dark:bg-gray-800 border-2 border-transparent hover:border-indigo-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-bold"
                                    >
                                        {form.contentType === 'collection'
                                            ? collections.map(c => <option key={c.id} value={c.id}>{c.titulo}</option>)
                                            : books.map(c => <option key={c.id} value={c.id}>{c.titulo} — {c.autor}</option>)
                                        }
                                    </select>
                                </div>
                            )}
                        </>
                    )}

                    {/* ── ABIERTO: experiencia + mediación ──────────────────── */}
                    {isOpen_ && (
                        <>
                            {/* Experiencia */}
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                    <Sparkles size={14} /> Experiencia (opcional)
                                </label>
                                <select
                                    value={form.activeExperienceId}
                                    onChange={e => setForm(f => ({ ...f, activeExperienceId: e.target.value }))}
                                    className="w-full p-4 bg-gray-50 dark:bg-gray-800 border-2 border-transparent hover:border-pink-200 rounded-2xl outline-none focus:ring-2 focus:ring-pink-400 transition-all text-sm font-bold dark:text-gray-100"
                                >
                                    <option value="">Sin experiencia</option>
                                    {bundles.map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                                {form.activeExperienceId && (
                                    <p className="text-xs text-gray-400 ml-1">
                                        {bundles.find(b => b.id === form.activeExperienceId)?.shortDescription}
                                    </p>
                                )}
                            </div>

                            {/* Mensaje del mediador */}
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                    <MessageSquare size={14} /> Mensaje del mediador (opcional)
                                </label>
                                <textarea
                                    value={form.mediationMessage}
                                    onChange={e => setForm(f => ({ ...f, mediationMessage: e.target.value }))}
                                    rows={3}
                                    placeholder="Ej: Bienvenidos al club. Esta semana exploraremos..."
                                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-pink-400 focus:bg-white dark:focus:bg-gray-900 rounded-2xl outline-none transition-all text-sm text-gray-800 dark:text-gray-100 resize-none"
                                />
                            </div>

                            {/* Preguntas de reflexión */}
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1">
                                    Preguntas de reflexión (máx. 3)
                                </label>
                                <div className="space-y-2">
                                    {form.mediationQuestions.map((q, i) => (
                                        <div key={i} className="flex gap-2 items-center">
                                            <span className="w-5 h-5 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 text-xs font-black flex items-center justify-center flex-shrink-0">
                                                {i + 1}
                                            </span>
                                            <input
                                                type="text"
                                                value={q}
                                                onChange={e => updateQuestion(i, e.target.value)}
                                                placeholder={`Pregunta ${i + 1}`}
                                                className="flex-1 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-pink-400 rounded-xl outline-none transition-all text-sm dark:text-gray-100"
                                            />
                                            {form.mediationQuestions.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeQuestion(i)}
                                                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {form.mediationQuestions.length < 3 && (
                                        <button
                                            type="button"
                                            onClick={addQuestion}
                                            className="flex items-center gap-1.5 text-xs font-bold text-pink-500 hover:text-pink-700 transition-colors ml-7 mt-1"
                                        >
                                            <Plus size={13} />
                                            Agregar pregunta
                                        </button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Info del mediador */}
                    <div className="bg-indigo-50 dark:bg-white/5 p-4 rounded-2xl border border-indigo-100 dark:border-white/10 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-white dark:bg-gray-800 flex items-center justify-center flex-shrink-0 shadow-sm border border-indigo-100 dark:border-white/10">
                            <Users className="text-indigo-500" size={20} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-black text-indigo-900 dark:text-indigo-300">{user?.nombre_completo}</p>
                            <p className="text-xs text-indigo-500 font-bold truncate opacity-80 uppercase tracking-wider">{user?.colegio} · Mediador</p>
                        </div>
                    </div>
                </div>

                {/* Warning: missing colegio */}
                {!user?.colegio && (
                    <div className="mx-8 mb-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl text-xs text-amber-800 dark:text-amber-300 font-semibold">
                        Tu cuenta no tiene un colegio asociado. El administrador debe configurar el campo "colegio" en tu perfil para poder crear clubes.
                    </div>
                )}

                {/* Footer */}
                <div className="p-6 bg-gray-50 dark:bg-black/20 flex gap-4 items-center">
                    <button
                        onClick={onClose}
                        className="px-6 py-4 text-gray-400 font-bold hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-sm"
                    >
                        Más tarde
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!canSubmit}
                        className={`flex-grow py-5 text-white font-black rounded-2xl shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:translate-y-0 flex items-center justify-center gap-3 text-sm tracking-wide ${isOpen_ ? 'bg-gradient-to-r from-pink-500 to-indigo-600 shadow-pink-500/20 dark:shadow-none hover:shadow-pink-500/40' : 'bg-gradient-to-r from-indigo-600 to-purple-600 shadow-indigo-500/20 dark:shadow-none hover:shadow-indigo-500/40'}`}
                    >
                        {isSaving
                            ? <Clock size={18} className="animate-spin text-white" />
                            : isOpen_
                                ? <><Globe size={18} className="text-white" /> CREAR CLUB ABIERTO</>
                                : <><Zap size={18} className="text-white fill-current" /> GENERAR Y EMPEZAR</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuickClubModal;
