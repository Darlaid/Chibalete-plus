
import React, { useState, useEffect } from 'react';
import { X, Zap, Check, Clock, BookOpen, Layers, Target, Users } from 'lucide-react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import type { Content, User } from '../types';

interface QuickClubModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const QuickClubModal: React.FC<QuickClubModalProps> = ({ isOpen, onClose }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [isSaving, setIsSaving] = useState(false);
    const [allContent, setAllContent] = useState<Content[]>([]);
    
    // Quick Form State
    const [form, setForm] = useState({
        name: '',
        contentType: 'all' as 'all' | 'collection' | 'book',
        selectedContentId: '',
        durationDays: '30'
    });

    useEffect(() => {
        if (isOpen) {
            const books = dataService.getBooks();
            const cols = dataService.getCollections();
            setAllContent([...books, ...cols]);
            
            // Default select if empty
            if (form.contentType === 'book' && !form.selectedContentId && books.length > 0) {
                setForm(f => ({ ...f, selectedContentId: books[0].id }));
            } else if (form.contentType === 'collection' && !form.selectedContentId && cols.length > 0) {
                setForm(f => ({ ...f, selectedContentId: cols[0].id }));
            }
        }
    }, [isOpen]);

    const handleCreate = async () => {
        if (!form.name || !user || !user.colegio) return;

        setIsSaving(true);
        try {
            const endsAt = new Date();
            endsAt.setDate(endsAt.getDate() + parseInt(form.durationDays));

            const payload: any = {
                name: form.name,
                school: user.colegio,
                type: 'club',
                mediatorIds: [user.id],
                accessEndsAt: endsAt.toISOString(),
                grade: 'Club'
            };

            if (form.contentType === 'book') {
                payload.availableContentIds = [form.selectedContentId];
            } else if (form.contentType === 'collection') {
                payload.availableContentIds = []; 
                payload.collectionIds = [form.selectedContentId];
            } else {
                payload.availableContentIds = 'all';
            }

            const savedGroup = await dataService.createGroup(payload);
            
            // --- C1 FIX: Registro de Regla Real en Motor de Scopes ---
            const rulePayload: any = {
                scope: 'group',
                scopeId: savedGroup.id,
                expiresAt: endsAt.getTime()
            };

            if (form.contentType === 'book') {
                rulePayload.titleIds = [form.selectedContentId];
            } else if (form.contentType === 'collection') {
                rulePayload.collectionIds = [form.selectedContentId];
            } else {
                // Para 'all', podrías no crear regla (legacy logic allows it)
                // o crear una regla vacía si el motor lo soporta como "permitir todo".
                // En este sistema, 'all' se maneja mejor por el fallback legacy de Group.
            }

            if (form.contentType !== 'all') {
                await dataService.createAccessRule(rulePayload);
            }

            // Redirect to Aula Viva
            onClose();
            navigate('/aula-viva');
        } catch (err: any) {
            alert(`Error al crear club: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const collections = allContent.filter(c => c.isCollection);
    const books = allContent.filter(c => !c.isCollection);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
                {/* Header with gradient */}
                <div className="p-6 bg-gradient-to-r from-indigo-600 to-purple-600 flex justify-between items-center group">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm group-hover:scale-110 transition-transform">
                            <Zap className="text-white" size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">Nuevo Club de Lectura</h3>
                            <p className="text-indigo-100 text-xs">Crea un espacio para tus alumnos en segundos</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={24} className="text-white" />
                    </button>
                </div>

                <div className="p-8 space-y-6 overflow-y-auto max-h-[70vh]">
                    {/* Name field */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1">¿Cómo se llamará el club?</label>
                        <input 
                            type="text"
                            autoFocus
                            value={form.name}
                            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Ej: Club de lectura 5A"
                            className="w-full px-5 py-4 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 rounded-2xl outline-none transition-all text-lg font-bold text-gray-800 dark:text-gray-100 shadow-inner"
                        />
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Duration Selector */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                <Clock size={16} /> Duración
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { label: '7d', val: '7' },
                                    { label: '14d', val: '14' },
                                    { label: '30d', val: '30' }
                                ].map(d => (
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

                        {/* Content Type Selector */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                <Layers size={16} /> Contenido
                            </label>
                            <div className="flex bg-gray-100 dark:bg-gray-800/80 p-1 rounded-xl">
                                {[
                                    { label: 'Todo', val: 'all', icon: Target },
                                    { label: 'Colección', val: 'collection', icon: BookOpen },
                                    { label: 'Libro', val: 'book', icon: Zap }
                                ].map(c => (
                                    <button
                                        key={c.val}
                                        type="button"
                                        onClick={() => setForm(f => ({ ...f, contentType: c.val as any, selectedContentId: c.val === 'collection' ? (collections[0]?.id || '') : c.val === 'book' ? (books[0]?.id || '') : '' }))}
                                        className={`flex-1 py-2 flex flex-col items-center gap-1 rounded-lg transition-all ${form.contentType === c.val ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        <c.icon size={16} />
                                        <span className="text-[10px] font-black uppercase">{c.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Content Detail Selector */}
                    {form.contentType !== 'all' && (
                        <div className="space-y-2 animate-in slide-in-from-top-2">
                             <label className="text-sm font-bold text-gray-400 uppercase tracking-widest ml-1">
                                {form.contentType === 'collection' ? 'Selecciona la colección' : 'Selecciona el libro'}
                             </label>
                             <select 
                                value={form.selectedContentId}
                                onChange={e => setForm(f => ({ ...f, selectedContentId: e.target.value }))}
                                className="w-full p-4 bg-gray-50 dark:bg-gray-800 border-2 border-transparent hover:border-indigo-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-bold"
                             >
                                {form.contentType === 'collection' ? (
                                    collections.map(c => <option key={c.id} value={c.id}>{c.titulo}</option>)
                                ) : (
                                    books.map(c => <option key={c.id} value={c.id}>{c.titulo} — {c.autor}</option>)
                                )}
                             </select>
                        </div>
                    )}

                    {/* Info Card - Transparency style */}
                    <div className="bg-indigo-50 dark:bg-white/5 p-5 rounded-2xl border border-indigo-100 dark:border-white/10 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-white dark:bg-gray-800 flex items-center justify-center flex-shrink-0 shadow-sm border border-indigo-100 dark:border-white/10">
                            <Users className="text-indigo-500" size={24} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-black text-indigo-900 dark:text-indigo-300">{user?.nombre_completo}</p>
                            <p className="text-xs text-indigo-500 font-bold truncate opacity-80 uppercase tracking-wider">{user?.colegio} · Mediador</p>
                        </div>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="p-6 bg-gray-50 dark:bg-black/20 flex gap-4 items-center">
                    <button 
                        onClick={onClose}
                        className="px-6 py-4 text-gray-400 font-bold hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-sm"
                    >
                        Más tarde
                    </button>
                    <button 
                        onClick={handleCreate}
                        disabled={isSaving || !form.name || (form.contentType !== 'all' && !form.selectedContentId)}
                        className="flex-grow py-5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-500/20 dark:shadow-none hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:translate-y-0 flex items-center justify-center gap-3 text-sm tracking-wide"
                    >
                        {isSaving ? <Clock size={20} className="animate-spin text-white" /> : <Zap size={20} className="text-white fill-current" />}
                        GENERAR Y EMPEZAR
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuickClubModal;
