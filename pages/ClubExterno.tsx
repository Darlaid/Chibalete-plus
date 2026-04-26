import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { Group, Content, Bundle, User } from '../types';
import { Globe, Sparkles, BookOpen, MessageSquare, Users, ArrowLeft, ArrowRight, BookMarked, CalendarDays, Milestone, Edit2, Check, X, Plus, Trash2, Loader2 } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────

const Avatar: React.FC<{ name: string }> = ({ name }) => (
    <div className="w-5 h-5 rounded-full bg-indigo-200 dark:bg-indigo-700 flex items-center justify-center text-[10px] font-black text-indigo-700 dark:text-indigo-200 flex-shrink-0">
        {name.charAt(0).toUpperCase()}
    </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

const ClubExterno: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const navigate = useNavigate();

    const [club, setClub] = useState<Group | null>(null);
    const [clubContent, setClubContent] = useState<Content[]>([]);
    const [bundle, setBundle] = useState<Bundle | null>(null);
    const [members, setMembers] = useState<User[]>([]);
    const [isMember, setIsMember] = useState(false);
    const [joining, setJoining] = useState(false);

    // ── Edición de mediación (solo coordinador) ───────────────────────────────
    const [editingMediation, setEditingMediation] = useState(false);
    const [mediationMessageDraft, setMediationMessageDraft] = useState('');
    const [mediationQuestionsDraft, setMediationQuestionsDraft] = useState<string[]>([]);
    const [savingMediation, setSavingMediation] = useState(false);

    // Sincronizar drafts cuando el club se carga o actualiza
    useEffect(() => {
        if (club) {
            setMediationMessageDraft(club.mediationMessage ?? '');
            setMediationQuestionsDraft(club.mediationQuestions ?? []);
        }
    }, [club]);

    const applyClub = useCallback((found: Group) => {
        setClub(found);

        const member = !!(found.memberIds?.includes(user!.id) || found.mediatorIds?.includes(user!.id));
        setIsMember(member);

        if (member) setClubContent(dataService.getClubContent(found));

        if (found.activeExperienceId) {
            const b = dataService.getBundles().find(b => b.id === found.activeExperienceId);
            if (b) setBundle(b);
        }

        // Member profiles (first 10)
        const profiles = (found.memberIds ?? [])
            .slice(0, 10)
            .map(uid => dataService.getUsuarioById(uid))
            .filter(Boolean) as User[];
        setMembers(profiles);
    }, [user]);

    useEffect(() => {
        if (!id || !user) return;

        const allGroups = dataService.getAllGroups();
        const found = allGroups.find(g => g.id === id);

        if (!found || found.type !== 'club' || found.kind !== 'open') {
            navigate('/clubs', { replace: true });
            return;
        }
        applyClub(found);
    }, [id, user, navigate, applyClub]);

    const handleJoin = async () => {
        if (!club || !user) return;
        setJoining(true);
        try {
            const updated = await dataService.joinOpenClub(club.id, user.id);
            applyClub(updated);
        } catch (err: any) {
            alert(`No se pudo unir: ${err.message}`);
        } finally {
            setJoining(false);
        }
    };

    if (!club) return null;

    const isCoordinator = !!(user && (club.mediatorIds ?? []).includes(user.id));

    // ── Datos de coordinador (resueltos en render, no en estado) ─────────────
    const coordMemberProfiles: User[] = isCoordinator
        ? (club.memberIds ?? [])
            .map(uid => dataService.getUsuarioById(uid))
            .filter(Boolean) as User[]
        : [];

    const isAllCatalog = club.availableContentIds === 'all';

    const coordBooks: Content[] = isCoordinator && !isAllCatalog && Array.isArray(club.availableContentIds)
        ? dataService.getBooks().filter(b => (club.availableContentIds as string[]).includes(b.id))
        : [];

    const coordCollections: Content[] = isCoordinator && Array.isArray(club.collectionIds) && club.collectionIds.length > 0
        ? dataService.getCollections().filter(c => (club.collectionIds as string[]).includes(c.id))
        : [];
    const memberCount = club.memberIds?.length ?? 0;
    const hasRhythm = club.readingNow || club.weeklyFocus || club.nextMilestone;

    const handleSaveMediation = async () => {
        setSavingMediation(true);
        try {
            const cleanedQuestions = mediationQuestionsDraft.map(q => q.trim()).filter(Boolean);
            await dataService.updateGroup(club.id, {
                mediationMessage: mediationMessageDraft.trim(),
                mediationQuestions: cleanedQuestions,
            });
            // Refrescar estado del club desde caché actualizado
            const refreshed = dataService.getAllGroups().find(g => g.id === club.id);
            if (refreshed) applyClub(refreshed);
            setEditingMediation(false);
        } catch (err: any) {
            alert(`Error al guardar: ${err.message}`);
        } finally {
            setSavingMediation(false);
        }
    };

    const handleCancelMediation = () => {
        setMediationMessageDraft(club.mediationMessage ?? '');
        setMediationQuestionsDraft(club.mediationQuestions ?? []);
        setEditingMediation(false);
    };

    return (
        <div className="max-w-2xl mx-auto px-4 py-8">

            {/* Back */}
            <button
                onClick={() => navigate('/clubs')}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-6 transition-colors"
            >
                <ArrowLeft size={15} />
                Todos los clubes
            </button>

            {/* ── A. HEADER ──────────────────────────────────────────────── */}
            <div className="bg-gradient-to-br from-pink-500 to-indigo-600 rounded-2xl p-6 text-white mb-6">
                <div className="flex items-center gap-2 text-pink-200 text-[11px] font-bold uppercase tracking-widest mb-3">
                    <Globe size={12} />
                    Club Abierto
                </div>

                <h1 className="text-2xl font-black mb-3 leading-tight">{club.name}</h1>

                <div className="flex flex-wrap items-center gap-3">
                    {bundle && (
                        <span className="flex items-center gap-1.5 bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">
                            <Sparkles size={11} />
                            {bundle.name}
                        </span>
                    )}
                    <span className="flex items-center gap-1.5 text-pink-200 text-xs">
                        <Users size={11} />
                        {memberCount} {memberCount === 1 ? 'miembro' : 'miembros'}
                    </span>
                </div>
            </div>

            {/* Join CTA (si no es miembro) */}
            {!isMember && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 mb-6 text-center">
                    <p className="text-amber-800 dark:text-amber-300 font-semibold mb-4 text-sm">
                        Únete al club para acceder al contenido y a la comunidad.
                    </p>
                    <button
                        onClick={handleJoin}
                        disabled={joining}
                        className="px-8 py-3 bg-gradient-to-r from-pink-500 to-indigo-600 text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-2 text-sm"
                    >
                        {joining
                            ? <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                            : <><ArrowRight size={15} /> Unirme al club</>
                        }
                    </button>
                </div>
            )}

            {/* ── Vista de miembro ────────────────────────────────────────── */}
            {isMember && (
                <div className="space-y-5">

                    {/* ── B. ESTADO ACTUAL ───────────────────────────────── */}
                    {hasRhythm && (
                        <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/60 rounded-2xl p-5">
                            <p className="text-[11px] font-black text-indigo-400 uppercase tracking-widest mb-4">
                                Ritmo del club
                            </p>
                            <div className="space-y-3">
                                {club.weeklyFocus && (
                                    <div className="flex gap-3">
                                        <CalendarDays size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wide">Esta semana</p>
                                            <p className="text-sm text-gray-800 dark:text-gray-200">{club.weeklyFocus}</p>
                                        </div>
                                    </div>
                                )}
                                {club.readingNow && (
                                    <div className="flex gap-3">
                                        <BookMarked size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wide">Estamos leyendo</p>
                                            <p className="text-sm text-gray-800 dark:text-gray-200">{club.readingNow}</p>
                                        </div>
                                    </div>
                                )}
                                {club.nextMilestone && (
                                    <div className="flex gap-3">
                                        <Milestone size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wide">Próximo momento</p>
                                            <p className="text-sm text-gray-800 dark:text-gray-200">{club.nextMilestone}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── C. MEDIACIÓN ───────────────────────────────────── */}

                    {/* Vista coordinador: siempre visible + editable */}
                    {isCoordinator && (
                        <div className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700/60 rounded-2xl p-5 space-y-4">

                            {/* Cabecera con botón de acción */}
                            <div className="flex items-center justify-between">
                                <p className="text-[11px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-1.5">
                                    <MessageSquare size={12} />
                                    Espacio de mediación
                                </p>
                                {!editingMediation ? (
                                    <button
                                        onClick={() => setEditingMediation(true)}
                                        className="flex items-center gap-1.5 text-xs font-bold text-indigo-500 hover:text-indigo-700 transition-colors"
                                    >
                                        <Edit2 size={13} /> Editar
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleCancelMediation}
                                            className="flex items-center gap-1 text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors"
                                        >
                                            <X size={13} /> Cancelar
                                        </button>
                                        <button
                                            onClick={handleSaveMediation}
                                            disabled={savingMediation}
                                            className="flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            {savingMediation
                                                ? <Loader2 size={12} className="animate-spin" />
                                                : <Check size={12} />
                                            }
                                            Guardar
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Modo lectura */}
                            {!editingMediation && (
                                <div className="space-y-3">
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Mensaje</p>
                                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                            {club.mediationMessage?.trim() || <span className="italic text-gray-400">Sin mensaje. Pulsa Editar para añadir uno.</span>}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Preguntas de reflexión</p>
                                        {(club.mediationQuestions ?? []).length === 0 ? (
                                            <p className="text-sm italic text-gray-400">Sin preguntas.</p>
                                        ) : (
                                            <ol className="space-y-2">
                                                {club.mediationQuestions!.map((q, i) => (
                                                    <li key={i} className="flex gap-3 text-sm text-gray-700 dark:text-gray-300">
                                                        <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                                                            {i + 1}
                                                        </span>
                                                        {q}
                                                    </li>
                                                ))}
                                            </ol>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Modo edición */}
                            {editingMediation && (
                                <div className="space-y-4">
                                    {/* Mensaje */}
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                                            Mensaje del mediador
                                        </label>
                                        <textarea
                                            value={mediationMessageDraft}
                                            onChange={e => setMediationMessageDraft(e.target.value)}
                                            rows={3}
                                            placeholder="Escribe un mensaje de bienvenida o guía para el club…"
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border-2 border-transparent focus:border-indigo-400 rounded-xl outline-none transition-all text-sm text-gray-800 dark:text-gray-100 resize-none"
                                        />
                                    </div>

                                    {/* Preguntas */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                                            Preguntas de reflexión
                                        </label>
                                        {mediationQuestionsDraft.map((q, i) => (
                                            <div key={i} className="flex items-center gap-2">
                                                <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-xs font-black flex items-center justify-center flex-shrink-0">
                                                    {i + 1}
                                                </span>
                                                <input
                                                    type="text"
                                                    value={q}
                                                    onChange={e => {
                                                        const updated = [...mediationQuestionsDraft];
                                                        updated[i] = e.target.value;
                                                        setMediationQuestionsDraft(updated);
                                                    }}
                                                    placeholder={`Pregunta ${i + 1}`}
                                                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-2 border-transparent focus:border-indigo-400 rounded-xl outline-none text-sm text-gray-800 dark:text-gray-100 transition-all"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setMediationQuestionsDraft(mediationQuestionsDraft.filter((_, idx) => idx !== i))}
                                                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))}
                                        {mediationQuestionsDraft.length < 5 && (
                                            <button
                                                type="button"
                                                onClick={() => setMediationQuestionsDraft([...mediationQuestionsDraft, ''])}
                                                className="flex items-center gap-1.5 text-xs font-bold text-indigo-500 hover:text-indigo-700 transition-colors ml-7"
                                            >
                                                <Plus size={13} /> Agregar pregunta
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Vista lector: igual que antes, sin cambios */}
                    {!isCoordinator && (club.mediationMessage || (club.mediationQuestions && club.mediationQuestions.length > 0)) && (
                        <div className="space-y-3">
                            {club.mediationMessage && (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                                    <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
                                        Del mediador
                                    </p>
                                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                        {club.mediationMessage}
                                    </p>
                                </div>
                            )}
                            {club.mediationQuestions && club.mediationQuestions.length > 0 && (
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                                    <div className="flex items-center gap-2 mb-3">
                                        <MessageSquare size={13} className="text-indigo-400" />
                                        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Para reflexionar</p>
                                    </div>
                                    <ol className="space-y-3">
                                        {club.mediationQuestions.map((q, i) => (
                                            <li key={i} className="flex gap-3 text-sm text-gray-700 dark:text-gray-300">
                                                <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                                                    {i + 1}
                                                </span>
                                                {q}
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── C2. VISTA COORDINADOR: MIEMBROS ────────────────── */}
                    {isCoordinator && (
                        <div className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700/60 rounded-2xl p-5">
                            <p className="text-[11px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-1.5 mb-4">
                                <Users size={12} />
                                Miembros del club
                                <span className="ml-auto text-indigo-400 font-bold text-xs normal-case tracking-normal">
                                    {coordMemberProfiles.length} {coordMemberProfiles.length === 1 ? 'miembro' : 'miembros'}
                                </span>
                            </p>

                            {coordMemberProfiles.length === 0 ? (
                                <p className="text-sm text-gray-400 italic">El club no tiene miembros todavía.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {coordMemberProfiles.map(m => (
                                        <li key={m.id} className="flex items-center gap-3">
                                            <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-[11px] font-black text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                                                {(m.nombre_completo || 'L').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight truncate">
                                                    {m.nombre_completo || '—'}
                                                </p>
                                                {m.email && (
                                                    <p className="text-xs text-gray-400 truncate">{m.email}</p>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* ── C3. VISTA COORDINADOR: MATERIALES HABILITADOS ───── */}
                    {isCoordinator && (
                        <div className="bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700/60 rounded-2xl p-5 space-y-4">
                            <p className="text-[11px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-1.5">
                                <BookOpen size={12} />
                                Materiales habilitados
                            </p>

                            {isAllCatalog ? (
                                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-4 py-3">
                                    <Sparkles size={14} className="flex-shrink-0" />
                                    Este club tiene acceso a todo el catálogo.
                                </div>
                            ) : (
                                <>
                                    {/* Libros */}
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Libros</p>
                                        {coordBooks.length === 0 ? (
                                            <p className="text-sm text-gray-400 italic">Ningún libro específico configurado.</p>
                                        ) : (
                                            <ul className="space-y-1.5">
                                                {coordBooks.map(b => (
                                                    <li key={b.id} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                                                        <BookOpen size={13} className="text-indigo-300 flex-shrink-0" />
                                                        <span className="truncate">{b.titulo}</span>
                                                        {b.autor && (
                                                            <span className="text-xs text-gray-400 flex-shrink-0">— {b.autor}</span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>

                                    {/* Colecciones */}
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Colecciones</p>
                                        {coordCollections.length === 0 ? (
                                            <p className="text-sm text-gray-400 italic">Ninguna colección configurada.</p>
                                        ) : (
                                            <ul className="space-y-1.5">
                                                {coordCollections.map(col => (
                                                    <li key={col.id} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                                                        <BookMarked size={13} className="text-pink-300 flex-shrink-0" />
                                                        <span className="truncate">{col.titulo}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>

                                    {coordBooks.length === 0 && coordCollections.length === 0 && (
                                        <p className="text-sm text-gray-400 italic">No hay materiales configurados para este club.</p>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ── D. CONTENIDO ───────────────────────────────────── */}
                    <div>
                        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <BookOpen size={12} />
                            Lecturas del club
                        </p>

                        {clubContent.length === 0 ? (
                            <div className="py-10 text-center text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
                                <BookOpen size={30} className="mx-auto mb-2 opacity-30" />
                                <p className="text-sm">No hay lecturas asignadas aún.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-100 dark:divide-gray-700/60 border border-gray-100 dark:border-gray-700/60 rounded-2xl overflow-hidden">
                                {clubContent.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => navigate(`/contenido/${c.id}`)}
                                        className="w-full flex items-center gap-4 p-4 bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors text-left group"
                                    >
                                        {c.portada_url ? (
                                            <img
                                                src={c.portada_url}
                                                alt=""
                                                className="w-10 h-14 object-cover rounded-lg shadow-sm flex-shrink-0"
                                            />
                                        ) : (
                                            <div className="w-10 h-14 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <BookOpen size={16} className="text-indigo-400" />
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-gray-900 dark:text-white text-sm group-hover:text-indigo-600 transition-colors">
                                                {c.titulo}
                                            </p>
                                            {c.autor && (
                                                <p className="text-xs text-gray-400 mt-0.5">{c.autor}</p>
                                            )}
                                        </div>
                                        <span className="text-xs font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full flex-shrink-0 group-hover:bg-indigo-100 transition-colors">
                                            Leer
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── E. MIEMBROS ────────────────────────────────────── */}
                    <div>
                        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Users size={12} />
                            Comunidad · {memberCount} {memberCount === 1 ? 'miembro' : 'miembros'}
                        </p>

                        {members.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {members.map(m => {
                                    const displayName = m.nombre_completo || (m as any).username || 'Lector';
                                    return (
                                        <div
                                            key={m.id}
                                            className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1.5"
                                            title={displayName}
                                        >
                                            <Avatar name={displayName} />
                                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 max-w-[110px] truncate">
                                                {displayName}
                                            </span>
                                        </div>
                                    );
                                })}
                                {memberCount > 10 && (
                                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1.5">
                                        <span className="text-xs font-medium text-gray-500">+{memberCount - 10} más</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-400">Sé el primero en unirte.</p>
                        )}
                    </div>

                </div>
            )}
        </div>
    );
};

export default ClubExterno;
