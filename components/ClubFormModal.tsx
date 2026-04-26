
import React, { useState, useEffect, useMemo } from 'react';
import {
    X, GraduationCap, Globe, Users, BookOpen, Layers,
    Search, Check, Loader2, AlertCircle, Calendar
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import type { Group, User, Content } from '../types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ClubFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    club?: Group | null; // null/undefined = creación, Group = edición
}

// ─── Estado interno del formulario ───────────────────────────────────────────

interface FormState {
    name: string;
    kind: 'school' | 'open';
    coordinatorId: string;
    memberIds: string[];
    contentMode: 'all' | 'custom';
    selectedBookIds: string[];
    selectedCollectionIds: string[];
    accessStartsAt: string; // 'YYYY-MM-DD' o ''
    accessEndsAt: string;   // 'YYYY-MM-DD' o ''
    mediationMessage: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInitialState(club: Group | null | undefined): FormState {
    if (!club) {
        return {
            name: '',
            kind: 'school',
            coordinatorId: '',
            memberIds: [],
            contentMode: 'all',
            selectedBookIds: [],
            selectedCollectionIds: [],
            accessStartsAt: '',
            accessEndsAt: '',
            mediationMessage: '',
        };
    }

    const isAll = club.availableContentIds === 'all';
    const availableArr = Array.isArray(club.availableContentIds) ? club.availableContentIds : [];

    // Discriminar bookIds de collectionIds usando el catálogo en caché
    const allBooks = dataService.getBooks();
    const bookIdSet = new Set(allBooks.map(b => b.id));
    const selectedBookIds = availableArr.filter(id => bookIdSet.has(id));

    return {
        name: club.name,
        kind: club.kind ?? 'school',
        coordinatorId: club.mediatorIds?.[0] ?? '',
        memberIds: Array.isArray(club.memberIds) ? [...club.memberIds] : [],
        contentMode: isAll ? 'all' : 'custom',
        selectedBookIds,
        selectedCollectionIds: Array.isArray(club.collectionIds) ? [...club.collectionIds] : [],
        accessStartsAt: club.accessStartsAt ? club.accessStartsAt.slice(0, 10) : '',
        accessEndsAt: club.accessEndsAt ? club.accessEndsAt.slice(0, 10) : '',
        mediationMessage: club.mediationMessage ?? '',
    };
}

// ─── Sub-componente: selector de miembros ────────────────────────────────────

interface MemberPickerProps {
    allUsers: User[];
    selectedIds: string[];
    excludeId: string; // coordinador ya seleccionado
    onChange: (ids: string[]) => void;
}

const MemberPicker: React.FC<MemberPickerProps> = ({ allUsers, selectedIds, excludeId, onChange }) => {
    const [query, setQuery] = useState('');

    const candidates = useMemo(() =>
        allUsers.filter(u =>
            u.id !== excludeId &&
            (u.nombre_completo.toLowerCase().includes(query.toLowerCase()) ||
             u.email.toLowerCase().includes(query.toLowerCase()))
        ),
        [allUsers, excludeId, query]
    );

    const toggle = (id: string) => {
        onChange(
            selectedIds.includes(id)
                ? selectedIds.filter(sid => sid !== id)
                : [...selectedIds, id]
        );
    };

    const selectedUsers = allUsers.filter(u => selectedIds.includes(u.id));

    return (
        <div className="space-y-3">
            {/* Buscador */}
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Buscar usuario por nombre o email…"
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-400 dark:text-gray-100"
                />
            </div>

            {/* Lista filtrada */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                {candidates.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
                ) : (
                    candidates.map(u => (
                        <label
                            key={u.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-0"
                        >
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(u.id)}
                                onChange={() => toggle(u.id)}
                                className="rounded accent-indigo-600 flex-shrink-0"
                            />
                            <img
                                src={u.avatar_url}
                                alt=""
                                className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                                onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nombre_completo)}&size=28`; }}
                            />
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{u.nombre_completo}</p>
                                <p className="text-xs text-gray-400 truncate">{u.email}</p>
                            </div>
                        </label>
                    ))
                )}
            </div>

            {/* Seleccionados como chips */}
            {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {selectedUsers.map(u => (
                        <span
                            key={u.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full text-xs font-semibold"
                        >
                            {u.nombre_completo.split(' ')[0]}
                            <button
                                type="button"
                                onClick={() => toggle(u.id)}
                                className="text-indigo-400 hover:text-red-500 transition-colors ml-0.5"
                            >
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Sub-componente: selector de contenido ────────────────────────────────────

interface ContentPickerProps {
    books: Content[];
    collections: Content[];
    selectedBookIds: string[];
    selectedCollectionIds: string[];
    onBooksChange: (ids: string[]) => void;
    onCollectionsChange: (ids: string[]) => void;
}

const ContentPicker: React.FC<ContentPickerProps> = ({
    books, collections, selectedBookIds, selectedCollectionIds, onBooksChange, onCollectionsChange
}) => {
    const [tab, setTab] = useState<'books' | 'collections'>('books');
    const [query, setQuery] = useState('');

    const toggleBook = (id: string) =>
        onBooksChange(
            selectedBookIds.includes(id) ? selectedBookIds.filter(i => i !== id) : [...selectedBookIds, id]
        );

    const toggleCollection = (id: string) =>
        onCollectionsChange(
            selectedCollectionIds.includes(id) ? selectedCollectionIds.filter(i => i !== id) : [...selectedCollectionIds, id]
        );

    const filteredBooks = books.filter(b => b.titulo.toLowerCase().includes(query.toLowerCase()));
    const filteredCollections = collections.filter(c => c.titulo.toLowerCase().includes(query.toLowerCase()));

    const totalSelected = selectedBookIds.length + selectedCollectionIds.length;

    return (
        <div className="space-y-2">
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                {([['books', 'Libros'], ['collections', 'Colecciones']] as const).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => { setTab(key); setQuery(''); }}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${tab === key ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {totalSelected > 0 && (
                <p className="text-xs text-indigo-500 font-semibold ml-1">
                    {selectedBookIds.length > 0 && `${selectedBookIds.length} libro${selectedBookIds.length > 1 ? 's' : ''}`}
                    {selectedBookIds.length > 0 && selectedCollectionIds.length > 0 && ' · '}
                    {selectedCollectionIds.length > 0 && `${selectedCollectionIds.length} colección${selectedCollectionIds.length > 1 ? 'es' : ''}`}
                    {' seleccionado(s)'}
                </p>
            )}

            {/* Buscador */}
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={tab === 'books' ? 'Buscar libro…' : 'Buscar colección…'}
                    className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-400 dark:text-gray-100"
                />
            </div>

            {/* Lista */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                {tab === 'books' && (
                    filteredBooks.length === 0
                        ? <p className="text-xs text-gray-400 text-center py-4">Sin libros disponibles</p>
                        : filteredBooks.map(b => (
                            <label key={b.id} className="flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <input
                                    type="checkbox"
                                    checked={selectedBookIds.includes(b.id)}
                                    onChange={() => toggleBook(b.id)}
                                    className="rounded accent-indigo-600 flex-shrink-0"
                                />
                                {b.portada_url && (
                                    <img src={b.portada_url} alt="" className="w-8 h-10 object-cover rounded flex-shrink-0" />
                                )}
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{b.titulo}</p>
                                    <p className="text-xs text-gray-400 truncate">{b.autor}</p>
                                </div>
                            </label>
                        ))
                )}
                {tab === 'collections' && (
                    filteredCollections.length === 0
                        ? <p className="text-xs text-gray-400 text-center py-4">Sin colecciones disponibles</p>
                        : filteredCollections.map(c => (
                            <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <input
                                    type="checkbox"
                                    checked={selectedCollectionIds.includes(c.id)}
                                    onChange={() => toggleCollection(c.id)}
                                    className="rounded accent-indigo-600 flex-shrink-0"
                                />
                                <Layers size={16} className="text-indigo-400 flex-shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{c.titulo}</p>
                                </div>
                            </label>
                        ))
                )}
            </div>
        </div>
    );
};

// ─── Componente principal ─────────────────────────────────────────────────────

const ClubFormModal: React.FC<ClubFormModalProps> = ({ isOpen, onClose, onSaved, club }) => {
    const { user: currentUser } = useAuth();
    const isEditing = !!club;

    const [form, setForm] = useState<FormState>(() => buildInitialState(club));
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Catálogos
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [books, setBooks] = useState<Content[]>([]);
    const [collections, setCollections] = useState<Content[]>([]);

    // Sección expandida activa (para el acordeón de secciones)
    const [section, setSection] = useState<'basic' | 'members' | 'content' | 'dates'>('basic');

    // Re-inicializar cuando cambia el club (modo edición a creación o viceversa)
    useEffect(() => {
        setForm(buildInitialState(club));
        setError(null);
        setSection('basic');
    }, [club, isOpen]);

    // Cargar catálogos cuando el modal se abre
    useEffect(() => {
        if (!isOpen) return;
        setAllUsers(dataService.getAllUsuarios());
        setBooks(dataService.getBooks());
        setCollections(dataService.getCollections());
    }, [isOpen]);

    if (!isOpen) return null;

    // ── Usuarios elegibles como coordinador ──────────────────────────────────
    // DT-05: 'profesor' eliminado del modelo — solo 'mediador' y 'administrador' son roles de gestión.
    const coordinatorCandidates = allUsers.filter(u =>
        u.roles.includes('mediador') ||
        u.roles.includes('administrador')
    );

    // ── Validación ───────────────────────────────────────────────────────────
    const validate = (): string | null => {
        if (!form.name.trim()) return 'El nombre del club es obligatorio.';
        if (!form.coordinatorId) return 'Debes asignar un coordinador.';
        if (form.contentMode === 'custom' && form.selectedBookIds.length === 0 && form.selectedCollectionIds.length === 0) {
            return 'Si eliges contenido personalizado, selecciona al menos un libro o colección.';
        }
        if (form.accessStartsAt && form.accessEndsAt && form.accessStartsAt > form.accessEndsAt) {
            return 'La fecha de inicio no puede ser posterior a la fecha de fin.';
        }
        return null;
    };

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        const validationError = validate();
        if (validationError) { setError(validationError); return; }

        setIsSaving(true);
        setError(null);

        try {
            const payload: Omit<Group, 'id' | 'studentIds'> = {
                name: form.name.trim(),
                type: 'club',
                kind: form.kind,
                mediatorIds: [form.coordinatorId],
                memberIds: form.memberIds,
                availableContentIds: form.contentMode === 'all' ? 'all' : form.selectedBookIds,
                collectionIds: form.contentMode === 'custom' ? form.selectedCollectionIds : [],
                accessStartsAt: form.accessStartsAt ? new Date(form.accessStartsAt).toISOString() : undefined,
                accessEndsAt: form.accessEndsAt ? new Date(form.accessEndsAt).toISOString() : undefined,
                mediationMessage: form.kind === 'open' && form.mediationMessage.trim()
                    ? form.mediationMessage.trim()
                    : undefined,
                school: currentUser?.colegio ?? 'Chibalete',
                grade: 'Club',
            };

            let savedGroup: Group;
            if (isEditing) {
                savedGroup = await dataService.updateGroup(club!.id, payload);
            } else {
                savedGroup = await dataService.createGroup(payload);
            }

            // Register a Scope Engine rule so the club is the primary access authority
            // rather than relying on the legacy group.availableContentIds fallback.
            if (form.contentMode === 'custom' || form.contentMode === 'all') {
                await dataService.createAccessRule({
                    scope: 'group',
                    scopeId: savedGroup.id,
                    titleIds: form.contentMode === 'custom' ? form.selectedBookIds : [],
                    collectionIds: form.contentMode === 'custom' ? form.selectedCollectionIds : [],
                    expiresAt: form.accessEndsAt ? new Date(form.accessEndsAt).getTime() : null,
                });
            }

            // Marcar al coordinador como tal (no afecta membresía de grupos)
            await dataService.setMediatorKind(form.coordinatorId, 'coordinator');

            onSaved();
            onClose();
        } catch (err: any) {
            setError(err.message ?? 'Error inesperado al guardar el club.');
        } finally {
            setIsSaving(false);
        }
    };

    // ── Helpers de UI ────────────────────────────────────────────────────────
    const isOpen_ = form.kind === 'open';
    const headerGradient = isOpen_
        ? 'bg-gradient-to-r from-pink-500 to-indigo-600'
        : 'bg-gradient-to-r from-indigo-600 to-purple-600';

    const SectionHeader: React.FC<{
        id: 'basic' | 'members' | 'content' | 'dates';
        label: string;
        count?: number;
        icon: React.ReactNode;
    }> = ({ id, label, count, icon }) => (
        <button
            type="button"
            onClick={() => setSection(section === id ? 'basic' : id)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors text-sm font-bold ${section === id ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
        >
            <div className="flex items-center gap-2">
                {icon}
                {label}
            </div>
            <div className="flex items-center gap-2">
                {count !== undefined && count > 0 && (
                    <span className="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-black px-2 py-0.5 rounded-full">
                        {count}
                    </span>
                )}
                <span className="text-gray-400 text-xs">{section === id ? '▲' : '▼'}</span>
            </div>
        </button>
    );

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
            <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden border border-white/20 flex flex-col max-h-[90vh]">

                {/* ── Header ─────────────────────────────────────────────────── */}
                <div className={`px-6 py-5 flex justify-between items-center flex-shrink-0 ${headerGradient}`}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                            {isOpen_ ? <Globe className="text-white" size={20} /> : <GraduationCap className="text-white" size={20} />}
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">
                                {isEditing ? `Editar club` : 'Nuevo club de lectura'}
                            </h3>
                            <p className="text-white/70 text-xs">
                                {isEditing ? club!.name : (isOpen_ ? 'Club abierto — visible en /clubs' : 'Club escolar — acceso restringido')}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={22} className="text-white" />
                    </button>
                </div>

                {/* ── Cuerpo scrollable ──────────────────────────────────────── */}
                <div className="overflow-y-auto flex-1 p-6 space-y-4">

                    {/* ── Error global ─────────────────────────────────────── */}
                    {error && (
                        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-700 dark:text-red-300">
                            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                            {error}
                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════
                        SECCIÓN 1 — Datos básicos (siempre visible)
                    ════════════════════════════════════════════════════════ */}

                    {/* Nombre */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                            Nombre del club *
                        </label>
                        <input
                            type="text"
                            autoFocus
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Ej: Club Poe, Club Astronomía 6A…"
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 rounded-2xl outline-none transition-all font-semibold text-gray-800 dark:text-gray-100"
                        />
                    </div>

                    {/* Tipo de club */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                            Tipo de club
                        </label>
                        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                            {([
                                { val: 'school', label: 'Escolar', Icon: GraduationCap },
                                { val: 'open', label: 'Abierto', Icon: Globe },
                            ] as const).map(({ val, label, Icon }) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setForm(f => ({ ...f, kind: val }))}
                                    className={`flex-1 py-2.5 flex items-center justify-center gap-2 rounded-lg transition-all text-sm font-bold ${form.kind === val ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                                >
                                    <Icon size={14} />
                                    {label}
                                </button>
                            ))}
                        </div>
                        {isOpen_ && (
                            <p className="text-xs text-pink-500 font-semibold flex items-center gap-1 ml-1">
                                <AlertCircle size={12} />
                                Este club será visible públicamente en /clubs. Cualquier lector puede unirse.
                            </p>
                        )}
                    </div>

                    {/* Coordinador */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                            Coordinador *
                        </label>
                        <select
                            value={form.coordinatorId}
                            onChange={e => setForm(f => ({ ...f, coordinatorId: e.target.value }))}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-indigo-500 rounded-2xl outline-none transition-all text-sm font-semibold text-gray-800 dark:text-gray-100"
                        >
                            <option value="">— Seleccionar coordinador —</option>
                            {coordinatorCandidates.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.nombre_completo} ({u.email})
                                </option>
                            ))}
                        </select>
                        {form.coordinatorId && (() => {
                            const coord = allUsers.find(u => u.id === form.coordinatorId);
                            if (!coord) return null;
                            return (
                                <div className="flex items-center gap-2 ml-1 mt-1">
                                    <Check size={13} className="text-green-500" />
                                    <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                                        {coord.nombre_completo} · quedará marcado como coordinator
                                    </span>
                                </div>
                            );
                        })()}
                    </div>

                    {/* ════════════════════════════════════════════════════════
                        SECCIÓN 2 — Miembros (acordeón)
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeader
                        id="members"
                        label="Miembros"
                        count={form.memberIds.length}
                        icon={<Users size={15} />}
                    />
                    {section === 'members' && (
                        <div className="px-1">
                            <MemberPicker
                                allUsers={allUsers}
                                selectedIds={form.memberIds}
                                excludeId={form.coordinatorId}
                                onChange={ids => setForm(f => ({ ...f, memberIds: ids }))}
                            />
                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════
                        SECCIÓN 3 — Contenido (acordeón)
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeader
                        id="content"
                        label="Contenido"
                        count={form.contentMode === 'custom' ? form.selectedBookIds.length + form.selectedCollectionIds.length : undefined}
                        icon={<BookOpen size={15} />}
                    />
                    {section === 'content' && (
                        <div className="space-y-3 px-1">
                            {/* Toggle modo */}
                            <div className="flex gap-2">
                                {([
                                    { val: 'all', label: 'Todo el catálogo' },
                                    { val: 'custom', label: 'Personalizado' },
                                ] as const).map(({ val, label }) => (
                                    <button
                                        key={val}
                                        type="button"
                                        onClick={() => setForm(f => ({ ...f, contentMode: val }))}
                                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2 ${form.contentMode === val ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400' : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-300'}`}
                                    >
                                        {val === 'all' && '📚 '}{val === 'custom' && '🎯 '}{label}
                                    </button>
                                ))}
                            </div>

                            {form.contentMode === 'custom' && (
                                <ContentPicker
                                    books={books}
                                    collections={collections}
                                    selectedBookIds={form.selectedBookIds}
                                    selectedCollectionIds={form.selectedCollectionIds}
                                    onBooksChange={ids => setForm(f => ({ ...f, selectedBookIds: ids }))}
                                    onCollectionsChange={ids => setForm(f => ({ ...f, selectedCollectionIds: ids }))}
                                />
                            )}

                            {form.contentMode === 'all' && (
                                <p className="text-xs text-gray-400 ml-1">
                                    Los miembros del club tendrán acceso a todo el catálogo disponible.
                                </p>
                            )}
                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════
                        SECCIÓN 4 — Fechas de acceso (acordeón)
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeader
                        id="dates"
                        label="Fechas de acceso"
                        count={(form.accessStartsAt || form.accessEndsAt) ? 1 : undefined}
                        icon={<Calendar size={15} />}
                    />
                    {section === 'dates' && (
                        <div className="grid grid-cols-2 gap-4 px-1">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                    Acceso desde
                                </label>
                                <input
                                    type="date"
                                    value={form.accessStartsAt}
                                    onChange={e => setForm(f => ({ ...f, accessStartsAt: e.target.value }))}
                                    className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-indigo-500 rounded-xl outline-none text-sm text-gray-800 dark:text-gray-100"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                    Acceso hasta
                                </label>
                                <input
                                    type="date"
                                    value={form.accessEndsAt}
                                    min={form.accessStartsAt || undefined}
                                    onChange={e => setForm(f => ({ ...f, accessEndsAt: e.target.value }))}
                                    className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-indigo-500 rounded-xl outline-none text-sm text-gray-800 dark:text-gray-100"
                                />
                            </div>
                            {!form.accessStartsAt && !form.accessEndsAt && (
                                <p className="col-span-2 text-xs text-gray-400">
                                    Sin fechas definidas — el acceso no tiene ventana temporal.
                                </p>
                            )}
                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════
                        SECCIÓN 5 — Mediación (solo club abierto)
                    ════════════════════════════════════════════════════════ */}
                    {isOpen_ && (
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <Globe size={13} />
                                Mensaje del mediador (opcional)
                            </label>
                            <textarea
                                value={form.mediationMessage}
                                onChange={e => setForm(f => ({ ...f, mediationMessage: e.target.value }))}
                                rows={3}
                                placeholder="Bienvenidos al club. Esta semana exploraremos…"
                                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-2 border-transparent focus:border-pink-400 focus:bg-white dark:focus:bg-gray-900 rounded-2xl outline-none transition-all text-sm text-gray-800 dark:text-gray-100 resize-none"
                            />
                        </div>
                    )}
                </div>

                {/* ── Footer ─────────────────────────────────────────────────── */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-black/20 flex gap-3 items-center flex-shrink-0 border-t border-gray-100 dark:border-gray-800">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-3 text-gray-400 font-bold hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-sm"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSaving || !form.name.trim() || !form.coordinatorId}
                        className={`flex-grow py-3.5 text-white font-black rounded-2xl shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:translate-y-0 flex items-center justify-center gap-2 text-sm tracking-wide ${isOpen_ ? 'bg-gradient-to-r from-pink-500 to-indigo-600' : 'bg-gradient-to-r from-indigo-600 to-purple-600'}`}
                    >
                        {isSaving ? (
                            <><Loader2 size={16} className="animate-spin" /> Guardando…</>
                        ) : isEditing ? (
                            <><Check size={16} /> GUARDAR CAMBIOS</>
                        ) : (
                            <><GraduationCap size={16} /> CREAR CLUB</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClubFormModal;
