import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { JournalEntry } from '../types';
import { Plus, Save, Trash2, Calendar, BookOpen, PenTool, Edit3, X, Share, ClipboardList, Send, ThumbsUp, Star } from 'lucide-react';
import Chatbot from '../components/Chatbot';

const Bitacora: React.FC = () => {
    const { user } = useAuth();
    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const [filter, setFilter] = useState<'all' | 'tasks' | 'reviews'>('all');
    const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    // Editor State
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const [editTags, setEditTags] = useState('');

    // Leo Greeting State
    const [leoMessage, setLeoMessage] = useState<string | null>(null);

    useEffect(() => {
        if (user) {
            refreshEntries();
        }
    }, [user]);

    const refreshEntries = () => {
        if (!user) return;
        const userEntries = dataService.getJournalEntries(user.id);
        setEntries(userEntries);

        // Leo Onboarding if empty
        if (userEntries.length === 0) {
            setLeoMessage("¡Hola! 🦀 Bienvenido a tu Bitácora. Este es tu espacio privado para escribir lo que sientes al leer. ¿Por qué no empiezas escribiendo sobre tu personaje favorito?");
        }
    };

    const handleCreateNew = () => {
        setIsEditing(true);
        setSelectedEntry(null);
        setEditTitle('');
        setEditContent('');
        setEditTags('');
    };

    const handleSelectEntry = (entry: JournalEntry) => {
        setSelectedEntry(entry);
        setIsEditing(false);
        setEditTitle(entry.title);
        setEditContent(entry.content);
        setEditTags(entry.tags?.join(', ') || '');
    };

    const handleSave = () => {
        if (!user || !editTitle.trim()) return;

        const tagsArray = editTags.split(',').map(t => t.trim()).filter(Boolean);

        if (selectedEntry) {
            // Update
            dataService.updateJournalEntry(selectedEntry.id, {
                title: editTitle,
                content: editContent,
                tags: tagsArray
            });
        } else {
            // Create
            dataService.addJournalEntry({
                userId: user.id,
                title: editTitle,
                content: editContent,
                date: new Date().toISOString().split('T')[0],
                tags: tagsArray,
                type: 'personal',
                status: 'draft'
            });
        }

        refreshEntries();
        setIsEditing(false);
        // Keep selected if updating, clear if creating (or select new)
        if (selectedEntry) {
            // Optimistic update of selected entry state
            setSelectedEntry({ ...selectedEntry, title: editTitle, content: editContent, tags: tagsArray });
        } else {
            setSelectedEntry(null);
        }
    };

    const handleDelete = (id: string) => {
        if (window.confirm("¿Seguro que quieres borrar esta entrada?")) {
            dataService.deleteJournalEntry(id);
            refreshEntries();
            if (selectedEntry?.id === id) {
                setSelectedEntry(null);
                setIsEditing(false);
            }
        }
    };

    const handleCopyToClipboard = () => {
        if (selectedEntry) {
            navigator.clipboard.writeText(`${selectedEntry.title}\n\n${selectedEntry.content}`);
            alert("Contenido copiado al portapapeles. Puedes pegarlo en una tarea.");
        }
    };

    const handleSubmitTask = () => {
        if (!selectedEntry || selectedEntry.type !== 'task_draft') return;
        if (window.confirm(`¿Enviar "${selectedEntry.title}" como solución a la tarea?`)) {
            const success = dataService.submitJournalEntry(selectedEntry.id);
            if (success) {
                alert("¡Tarea enviada con éxito! 🎉");
                refreshEntries();
                // Update local selected state to reflect submission
                setSelectedEntry({ ...selectedEntry, status: 'submitted' });
            } else {
                alert("Hubo un error al enviar la tarea.");
            }
        }
    }

    const handlePublishReview = () => {
        if (!selectedEntry) return;
        const ratingStr = prompt("Califica el libro (1-5):", "5");
        if (!ratingStr) return;
        const rating = parseInt(ratingStr);
        if (isNaN(rating) || rating < 1 || rating > 5) {
            alert("Por favor ingresa un número válido del 1 al 5.");
            return;
        }

        const success = dataService.publishJournalEntryAsReview(selectedEntry.id, rating);
        if (success) {
            alert("¡Reseña publicada en la comunidad! 🌟");
            refreshEntries();
            setSelectedEntry({ ...selectedEntry, status: 'published', type: 'review_draft' });
        } else {
            alert("No pudimos vincular esta entrada a un libro. Asegúrate de que fue creada desde una tarea o menciona el libro explícitamente.");
        }
    }

    const filteredEntries = entries.filter(e => {
        if (filter === 'all') return true;
        if (filter === 'tasks') return e.type === 'task_draft';
        if (filter === 'reviews') return e.type === 'review_draft';
        return true;
    });

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col md:flex-row gap-6">

            {/* Sidebar / List */}
            <div className="w-full md:w-1/3 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden h-[80vh]">
                <div className="p-6 border-b border-gray-100 dark:border-gray-700 bg-indigo-50 dark:bg-indigo-900/20">
                    <h1 className="text-2xl font-bold flex items-center text-indigo-700 dark:text-indigo-300">
                        <BookOpen className="mr-3" /> Mi Bitácora
                    </h1>
                    <button
                        onClick={handleCreateNew}
                        className="mt-4 w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center shadow-lg"
                    >
                        <Plus className="mr-2" size={20} /> Nueva Entrada
                    </button>

                    {/* Filter Tabs */}
                    <div className="flex mt-6 bg-white dark:bg-gray-900 rounded-lg p-1 border border-gray-200 dark:border-gray-700">
                        {['all', 'tasks', 'reviews'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f as any)}
                                className={`flex-1 text-xs font-bold py-2 rounded-md transition-colors capitalize ${filter === f ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-200' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                            >
                                {f === 'all' ? 'Todo' : f === 'tasks' ? 'Tareas' : 'Reseñas'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {filteredEntries.length === 0 ? (
                        <p className="text-center text-gray-400 mt-10 italic">No hay entradas en esta categoría.</p>
                    ) : (
                        filteredEntries.map(entry => (
                            <div
                                key={entry.id}
                                onClick={() => handleSelectEntry(entry)}
                                className={`p-4 rounded-xl cursor-pointer border transition-all hover:shadow-md relative overflow-hidden group 
                                    ${selectedEntry?.id === entry.id
                                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-500'
                                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-300'}`}
                            >
                                {/* Type Badge */}
                                <div className={`absolute top-0 right-0 px-2 py-0.5 rounded-bl-lg text-[10px] font-bold uppercase
                                    ${entry.type === 'task_draft' ? 'bg-amber-100 text-amber-700' :
                                        entry.type === 'review_draft' ? 'bg-purple-100 text-purple-700' :
                                            'bg-gray-100 text-gray-500'}`}>
                                    {entry.type === 'task_draft' ? 'Tarea' : entry.type === 'review_draft' ? 'Reseña' : 'Personal'}
                                </div>
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 truncate pr-10">{entry.title}</h3>
                                <div className="flex justify-between items-center mt-2">
                                    <span className="text-xs text-gray-500 flex items-center"><Calendar size={12} className="mr-1" /> {entry.date}</span>
                                    {entry.status === 'submitted' && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded font-bold">ENVIADO</span>}
                                    {entry.status === 'published' && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded font-bold">PUBLICADO</span>}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Editor / Viewer Area */}
            <div className="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 md:p-10 flex flex-col h-[80vh]">
                {isEditing ? (
                    <div className="flex flex-col h-full animate-in fade-in">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold flex items-center"><Edit3 className="mr-2 text-indigo-500" /> {selectedEntry ? 'Editar Entrada' : 'Escribiendo...'}</h2>
                            <button onClick={() => { setIsEditing(false); if (!selectedEntry) setSelectedEntry(null); }} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"><X /></button>
                        </div>

                        <input
                            type="text"
                            placeholder="Título de hoy..."
                            className="text-2xl font-bold w-full mb-4 p-2 border-b-2 border-transparent focus:border-indigo-500 bg-transparent outline-none placeholder-gray-300"
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            autoFocus
                        />

                        <textarea
                            className="flex-1 w-full resize-none p-4 bg-gray-50 dark:bg-gray-900 rounded-xl outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/30 leading-relaxed text-lg"
                            placeholder="Empieza a escribir tus pensamientos..."
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                        ></textarea>

                        <div className="mt-4 flex items-center gap-4">
                            <input
                                type="text"
                                placeholder="Etiquetas (separadas por coma)"
                                className="flex-1 p-3 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-900 text-sm"
                                value={editTags}
                                onChange={e => setEditTags(e.target.value)}
                            />
                            <button
                                onClick={handleSave}
                                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center shadow-lg"
                            >
                                <Save className="mr-2" size={20} /> Guardar
                            </button>
                        </div>
                    </div>
                ) : selectedEntry ? (
                    <div className="flex flex-col h-full animate-in fade-in">
                        <div className="flex justify-between items-start mb-6 border-b border-gray-100 dark:border-gray-700 pb-4">
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{selectedEntry.title}</h1>
                                    {selectedEntry.status === 'submitted' && <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded-full border border-green-200">Enviado</span>}
                                </div>
                                <p className="text-sm text-gray-500 flex items-center gap-3">
                                    <span className="flex items-center"><Calendar size={14} className="mr-1" /> {selectedEntry.date}</span>
                                    {selectedEntry.type === 'task_draft' && <span className="flex items-center text-amber-600"><ClipboardList size={14} className="mr-1" /> Tarea: {selectedEntry.sourceTitle}</span>}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => { setIsEditing(true); setEditTitle(selectedEntry.title); setEditContent(selectedEntry.content); }} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Editar"><Edit3 size={20} /></button>
                                <button onClick={handleCopyToClipboard} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" title="Copiar texto"><Share size={20} /></button>
                                <button onClick={() => handleDelete(selectedEntry.id)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Borrar"><Trash2 size={20} /></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto prose dark:prose-invert max-w-none text-lg leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {selectedEntry.content}
                        </div>

                        {/* Footer Actions */}
                        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                            <div className="flex gap-2">
                                {selectedEntry.tags && selectedEntry.tags.map(t => (
                                    <span key={t} className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-bold text-gray-600 dark:text-gray-400">#{t}</span>
                                ))}
                            </div>

                            {/* SMART ACTION BUTTONS */}
                            <div className="flex gap-2">
                                {selectedEntry.type === 'task_draft' && selectedEntry.status === 'draft' && (
                                    <button
                                        onClick={handleSubmitTask}
                                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg flex items-center font-bold hover:bg-indigo-700 shadow-md"
                                    >
                                        <Send size={16} className="mr-2" /> Enviar Tarea
                                    </button>
                                )}
                                {selectedEntry.type === 'personal' && (
                                    <button
                                        onClick={handlePublishReview}
                                        className="px-4 py-2 text-gray-500 hover:text-indigo-600 rounded-lg flex items-center font-bold transition-colors"
                                    >
                                        <Star size={16} className="mr-2" /> Convertir en Reseña
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <PenTool size={64} className="mb-6 opacity-20" />
                        <p className="text-xl font-medium">Selecciona una entrada o crea una nueva.</p>
                        <p className="text-sm mt-2">Tu escritura es el reflejo de tu lectura.</p>
                    </div>
                )}
            </div>

            <Chatbot initialMessage={leoMessage} />
        </div>
    );
};

export default Bitacora;
