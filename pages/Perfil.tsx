
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import type { User, Resena, Content, Bookmark, Group } from '../types';
import { Award, BookOpen, Heart, Users, Shield, Share2, Facebook, Linkedin, Instagram, Check, Loader2, X, Sparkles, Plus, Edit2, Trash2, Globe, GraduationCap, Smartphone } from 'lucide-react';
import BookmarkManager from '../components/BookmarkManager';
import StarRating from '../components/StarRating';
import ClubFormModal from '../components/ClubFormModal';

const StatItem: React.FC<{ icon: React.ReactNode; value: number | string; label: string }> = ({ icon, value, label }) => (
    <div className="flex flex-col items-center text-center">
        <div className="text-indigo-500">{icon}</div>
        <p className="text-xl font-bold">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
    </div>
);

const ResenaCard: React.FC<{ item: { review: Resena, content: Content } }> = ({ item }) => (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
        <div className="flex items-start space-x-4">
            <img src={item.content.portada_url} alt={item.content.titulo} className="w-16 h-24 object-cover rounded flex-shrink-0" />
            <div className="flex-grow">
                <h4 className="font-bold">{item.content.titulo}</h4>
                <div className="flex items-center mt-1 mb-2">
                    <StarRating currentRating={item.review.calificacion} onRatingChange={() => { }} readonly size={16} />
                </div>
                {item.review.texto && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">{item.review.texto}</p>
                )}
                <p className="text-xs text-gray-400 mt-2">{new Date(item.review.fecha).toLocaleDateString()}</p>
            </div>
        </div>
    </div>
);

const SocialConnectionCard: React.FC<{
    platform: 'facebook' | 'linkedin' | 'instagram';
    isConnected: boolean;
    isLoading: boolean;
    onToggle: (connected: boolean) => void;
    icon: React.ReactNode;
    label: string;
}> = ({ platform, isConnected, isLoading, onToggle, icon, label }) => (
    <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 transition-all hover:shadow-md">
        <div className="flex items-center space-x-4">
            <div className={`p-2 rounded-full transition-colors ${isConnected ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                {icon}
            </div>
            <div>
                <h4 className="font-bold capitalize">{label}</h4>
                <div className="flex items-center">
                    {isConnected ? (
                        <span className="text-xs text-green-600 flex items-center"><Check size={12} className="mr-1" /> Conectado</span>
                    ) : (
                        <span className="text-xs text-gray-500">No conectado</span>
                    )}
                </div>
            </div>
        </div>
        <button
            onClick={() => onToggle(!isConnected)}
            disabled={isLoading}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all flex items-center ${isLoading
                ? 'bg-gray-200 text-gray-500 cursor-wait dark:bg-gray-700'
                : isConnected
                    ? 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow'
                }`}
        >
            {isLoading && <Loader2 size={14} className="animate-spin mr-2" />}
            {isLoading
                ? (isConnected ? 'Desconectando...' : 'Conectando...')
                : (isConnected ? 'Desconectar' : 'Conectar')
            }
        </button>
    </div>
);


const Perfil: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user: currentUser, logout } = useAuth();
    const [user, setUser] = useState<User | null>(null);
    const [activeTab, setActiveTab] = useState<'originales' | 'reseñas' | 'favoritos' | 'redes' | 'admin' | 'glosario'>('reseñas');
    const [vocabWords, setVocabWords] = useState<string[]>([]);
    const [resenas, setResenas] = useState<{ review: Resena, content: Content }[]>([]);
    const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
    const navigate = useNavigate();

    // Force refresh to update UI when local mock data changes
    const [refreshKey, setRefreshKey] = useState(0);

    // ── Club management (admin tab) ───────────────────────────────────────────
    const [clubs, setClubs] = useState<Group[]>([]);
    const [clubFilter, setClubFilter] = useState<'all' | 'school' | 'open'>('all');
    const [clubModalOpen, setClubModalOpen] = useState(false);
    const [editingClub, setEditingClub] = useState<Group | null>(null);
    const [deletingClubId, setDeletingClubId] = useState<string | null>(null);

    // ── Mis clubes (coordinador) ──────────────────────────────────────────────
    const [myClubs, setMyClubs] = useState<Group[]>([]);

    // ── ICDLI reading metrics (solo perfil propio) ────────────────────────────
    const [icdliMetrics, setIcdliMetrics] = useState<{
        level: string; composite: number; totalSessions: number; distinctContentsRead: number;
    } | null>(null);
    const [icdliLoading, setIcdliLoading] = useState(false);

    useEffect(() => {
        if (id) {
            const userData = dataService.getUsuarioById(id);
            setUser(userData || null);
            if (userData) {
                setResenas(dataService.getResenasByUsuario(userData.id));
                if (currentUser?.id === userData.id && currentUser.roles.includes('administrador')) {
                    setActiveTab('admin');
                } else {
                    setActiveTab('reseñas');
                }
            }
        }
    }, [id, currentUser, refreshKey]);

    const handleLogout = (e: React.MouseEvent) => {
        e.preventDefault();
        if (window.confirm('¿Estás seguro de que quieres cerrar sesión?')) {
            logout();
            navigate('/bienvenida', { replace: true });
        }
    };

    const handleSocialToggle = (platform: 'facebook' | 'instagram' | 'linkedin', isConnected: boolean) => {
        if (user) {
            setConnectingPlatform(platform);

            // Simulate network request delay
            setTimeout(() => {
                dataService.updateSocialConnection(user.id, platform, isConnected);
                setRefreshKey(prev => prev + 1); // Trigger re-render
                setConnectingPlatform(null);

                if (isConnected) {
                    alert(`¡Conectado a ${platform.charAt(0).toUpperCase() + platform.slice(1)} exitosamente!`);
                }
            }, 1500);
        }
    };

    const calculateAge = (birthDateString?: string) => {
        if (!birthDateString) return 0;
        const today = new Date();
        const birthDate = new Date(birthDateString);
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    }

    useEffect(() => {
        if (activeTab === 'glosario' && currentUser && user && currentUser.id === user.id) {
            try {
                const raw = localStorage.getItem(`chibalete_vocab_${currentUser.id}`);
                setVocabWords(raw ? JSON.parse(raw) : []);
            } catch (_) {
                setVocabWords([]);
            }
        }
    }, [activeTab, currentUser, user]);

    // Fetch ICDLI metrics para el perfil propio. Fire-and-forget — no bloquea el render.
    useEffect(() => {
        if (!user?.id || !currentUser?.id || currentUser.id !== user.id) return;
        setIcdliLoading(true);
        fetch(`/api/metrics/student/${user.id}`, {
            headers: { 'x-user-id': currentUser.id },
        })
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
                if (data?.summary && data.summary.totalSessions > 0) {
                    setIcdliMetrics({
                        level:                data.summary.level,
                        composite:            data.summary.composite,
                        totalSessions:        data.summary.totalSessions,
                        distinctContentsRead: data.summary.distinctContentsRead,
                    });
                }
            })
            .catch(() => {})
            .finally(() => setIcdliLoading(false));
    }, [user?.id, currentUser?.id]);

    // ── Mis clubes (coordinador) ─────────────────────────────────────────────
    const loadMyClubs = () => {
        if (!currentUser) return;
        const allGroups = dataService.getAllGroups();
        const coordClubs = allGroups.filter(g =>
            g.type === 'club' &&
            g.kind === 'open' &&
            (g.mediatorIds ?? []).includes(currentUser.id)
        );
        setMyClubs(coordClubs);
    };

    useEffect(() => {
        loadMyClubs();
    }, [currentUser]);

    // ── Club helpers (admin) ─────────────────────────────────────────────────
    const reloadClubs = () => {
        setClubs(dataService.getAllGroups().filter(g => g.type === 'club'));
    };

    useEffect(() => {
        if (activeTab === 'admin') reloadClubs();
    }, [activeTab]);

    const handleDeleteClub = async (clubId: string) => {
        if (!window.confirm('¿Eliminar este club? Los miembros perderán acceso.')) return;
        setDeletingClubId(clubId);
        try {
            // Limpiar asociaciones antes de borrar para evitar groupIds huérfanos
            await dataService.updateGroup(clubId, { memberIds: [], mediatorIds: [] });
            await dataService.deleteGroup(clubId);
            reloadClubs();
        } catch (err: any) {
            alert(`Error al eliminar el club: ${err.message}`);
        } finally {
            setDeletingClubId(null);
        }
    };

    const handleClubModalClose = () => {
        setClubModalOpen(false);
        setEditingClub(null);
    };

    const filteredClubs = clubs.filter(c =>
        clubFilter === 'all' ? true :
        clubFilter === 'school' ? (c.kind === 'school' || !c.kind) :
        c.kind === 'open'
    );

    const handleDeleteVocab = (word: string) => {
        if (!currentUser) return;
        const updated = vocabWords.filter(w => w !== word);
        setVocabWords(updated);
        localStorage.setItem(`chibalete_vocab_${currentUser.id}`, JSON.stringify(updated));
    };

    if (!user) {
        return <div>Usuario no encontrado</div>;
    }

    const isOwnProfile = currentUser?.id === user.id;
    const isAdmin = currentUser?.roles.includes('administrador');
    const userAge = calculateAge(user.fecha_nacimiento);
    const isOldEnough = userAge >= 15;

    const TabButton: React.FC<{ tab: 'originales' | 'reseñas' | 'favoritos' | 'redes' | 'admin' | 'glosario', label: string }> = ({ tab, label }) => (
        <button
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-semibold rounded-t-lg transition-colors whitespace-nowrap ${activeTab === tab ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'text-gray-500 hover:text-gray-700'}`}
        >
            {label}
        </button>
    )

    return (
        <>
        <div className="p-4 md:p-8">
            <header className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-8 mb-8">
                <img src={user.avatar_url} alt="Avatar" className="w-32 h-32 rounded-full ring-4 ring-indigo-500 object-cover shadow-lg" />
                <div className="text-center md:text-left">
                    <h1 className="text-3xl font-bold">{user.nombre_completo}</h1>
                    <p className="text-lg text-gray-500">@{user.nombre_usuario}</p>
                    <p className="mt-2 max-w-md">{user.bio_corta}</p>
                    {isOwnProfile && (
                        <div className="mt-4 flex items-center justify-center md:justify-start space-x-2">
                            <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Editar perfil</button>
                            <button type="button" onClick={handleLogout} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Cerrar Sesión</button>
                        </div>
                    )}
                </div>
            </header>

            <div className={`grid gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md mb-8 ${isOwnProfile ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
                <StatItem icon={<BookOpen />} value={user.libros_leidos} label="Leídos" />
                <StatItem icon={<Users />} value={user.seguidores} label="Seguidores" />
                <StatItem icon={<Users />} value={user.seguidos} label="Seguidos" />
                <StatItem icon={<Award />} value={user.nivel_lectura} label="Nivel" />
                {isOwnProfile && (
                    <StatItem icon={<Sparkles className="text-yellow-500" />} value={user.puntos ?? 0} label="Puntos de Magia" />
                )}
            </div>

            {/* ── Widget Chibalete LU — perfil propio, todos los roles ────────── */}
            {isOwnProfile && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-4 border border-indigo-100 dark:border-indigo-800/40 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 shrink-0">
                            <Smartphone size={18} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">Chibalete LU</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">App para Android — lee sin conexión, misma cuenta</p>
                        </div>
                    </div>
                    <a
                        href="/chibalete-lu"
                        className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                        Ver y descargar
                    </a>
                </div>
            )}

            {/* ── Widget ICDLI — solo perfil propio ─────────────────────────── */}
            {isOwnProfile && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6 border border-gray-100 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                        <BookOpen size={14} />
                        Perfil lector
                    </h3>
                    {icdliLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <Loader2 size={14} className="animate-spin" />
                            Cargando…
                        </div>
                    ) : icdliMetrics ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center">
                                <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{icdliMetrics.level}</p>
                                <p className="text-xs text-gray-500">Nivel lector</p>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-bold text-gray-800 dark:text-gray-100">
                                    {Math.min(100, Math.round(icdliMetrics.composite))}
                                    <span className="text-sm font-normal text-gray-400">/100</span>
                                </p>
                                <p className="text-xs text-gray-500">Score</p>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{icdliMetrics.totalSessions}</p>
                                <p className="text-xs text-gray-500">Sesiones</p>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{icdliMetrics.distinctContentsRead}</p>
                                <p className="text-xs text-gray-500">Títulos leídos</p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400">Aún no hay suficiente información de lectura.</p>
                    )}
                </div>
            )}

            <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
                <nav className="-mb-px flex space-x-4">
                    <TabButton tab="originales" label="Originales" />
                    <TabButton tab="reseñas" label="Reseñas" />
                    <TabButton tab="favoritos" label="Favoritos" />
                    {isOwnProfile && <TabButton tab="glosario" label="Mi Glosario" />}
                    {isOwnProfile && <TabButton tab="redes" label="Redes Sociales" />}
                    {isOwnProfile && isAdmin && <TabButton tab="admin" label="Administración" />}
                </nav>
            </div>

            <div className="mt-8">
                {activeTab === 'reseñas' && (
                    <div className="space-y-4">
                        {resenas.length > 0 ? resenas.map(item => <ResenaCard key={item.review.id} item={item} />) : <p className="text-gray-500 text-center py-8">Aún no hay reseñas.</p>}
                    </div>
                )}
                {activeTab === 'originales' && <p className="text-gray-500 text-center py-8">Próximamente: Contenidos creados por {user.nombre_completo}.</p>}
                {activeTab === 'favoritos' && <p className="text-gray-500 text-center py-8">Próximamente: Contenidos favoritos de {user.nombre_completo}.</p>}

                {activeTab === 'glosario' && isOwnProfile && (
                    <div className="max-w-2xl">
                        <div className="mb-6">
                            <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                                <BookOpen size={20} className="text-indigo-500" />
                                Mi Glosario de Lectura
                            </h2>
                            <p className="text-sm text-gray-500">Palabras guardadas por Leo durante tus sesiones de lectura.</p>
                        </div>
                        {vocabWords.length === 0 ? (
                            <div className="text-center py-12 text-gray-400">
                                <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
                                <p className="font-semibold">Tu glosario está vacío.</p>
                                <p className="text-sm mt-1">Cuando leas con Leo, las palabras nuevas aparecerán aquí.</p>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {vocabWords.map((word, i) => (
                                    <span
                                        key={`${word}-${i}`}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full text-sm font-medium border border-indigo-100 dark:border-indigo-800"
                                    >
                                        {word}
                                        <button
                                            onClick={() => handleDeleteVocab(word)}
                                            className="ml-0.5 text-indigo-400 hover:text-red-500 transition-colors"
                                            title="Eliminar palabra"
                                        >
                                            <X size={12} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'redes' && isOwnProfile && (
                    <div className="space-y-4 max-w-2xl mx-auto md:mx-0">
                        <div className="mb-6">
                            <h2 className="text-xl font-bold mb-2 flex items-center"><Share2 className="mr-2 text-indigo-500" /> Gestionar Conexiones</h2>
                            <p className="text-gray-500 text-sm">Conecta tus redes sociales para compartir tus lecturas favoritas, logros y reseñas con tu comunidad. Solo tú decides qué compartir.</p>
                        </div>

                        {/* Eligibility Check: Grade 9+ or No Grade (Subscriber/Adult) */}
                        {(() => {
                            const parseGrade = (c: string | undefined) => {
                                if (!c) return 99; // No course = Adult/Subscriber -> Eligible
                                const num = parseInt(c);
                                return isNaN(num) ? 0 : num;
                            };
                            const isEligible = parseGrade(user.curso) >= 9;

                            if (!isEligible) {
                                return (
                                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-6 text-center">
                                        <div className="w-12 h-12 bg-orange-100 dark:bg-orange-800 rounded-full flex items-center justify-center mx-auto mb-3">
                                            <Shield className="text-orange-500" size={24} />
                                        </div>
                                        <h3 className="font-bold text-lg text-gray-800 dark:text-gray-200 mb-2">Opción Restringida</h3>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            La conexión a redes sociales está disponible únicamente para suscriptores y estudiantes a partir de <strong>grado 9°</strong>.
                                        </p>
                                    </div>
                                );
                            }

                            return (
                                <div className="space-y-4">
                                    <SocialConnectionCard
                                        platform="facebook"
                                        label="Facebook"
                                        icon={<Facebook size={24} />}
                                        isConnected={user.social_connections?.facebook || false}
                                        isLoading={connectingPlatform === 'facebook'}
                                        onToggle={(val) => handleSocialToggle('facebook', val)}
                                    />
                                    <SocialConnectionCard
                                        platform="instagram"
                                        label="Instagram"
                                        icon={<Instagram size={24} />}
                                        isConnected={user.social_connections?.instagram || false}
                                        isLoading={connectingPlatform === 'instagram'}
                                        onToggle={(val) => handleSocialToggle('instagram', val)}
                                    />
                                    <SocialConnectionCard
                                        platform="linkedin"
                                        label="LinkedIn"
                                        icon={<Linkedin size={24} />}
                                        isConnected={user.social_connections?.linkedin || false}
                                        isLoading={connectingPlatform === 'linkedin'}
                                        onToggle={(val) => handleSocialToggle('linkedin', val)}
                                    />
                                </div>
                            );
                        })()}
                    </div>
                )}

                {activeTab === 'admin' && isOwnProfile && isAdmin && (
                    <div>
                        <h2 className="text-2xl font-bold mb-4 flex items-center"><Shield className="mr-2 text-indigo-500" /> Panel de Administración</h2>
                        <BookmarkManager />

                        {/* ── Gestión de Clubes ──────────────────────────── */}
                        <div className="mt-10">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <Users size={20} className="text-indigo-500" />
                                        Gestión de Clubes
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-0.5">Clubes activos en la plataforma</p>
                                </div>
                                <button
                                    onClick={() => { setEditingClub(null); setClubModalOpen(true); }}
                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-semibold"
                                >
                                    <Plus size={15} /> Nuevo club
                                </button>
                            </div>

                            {/* Filtros */}
                            <div className="flex gap-2 mb-4">
                                {([
                                    { val: 'all', label: 'Todos' },
                                    { val: 'school', label: 'Escolares' },
                                    { val: 'open', label: 'Abiertos' },
                                ] as const).map(({ val, label }) => (
                                    <button
                                        key={val}
                                        onClick={() => setClubFilter(val)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${clubFilter === val ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* Lista */}
                            {filteredClubs.length === 0 ? (
                                <div className="text-center py-10 text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                                    <Users size={32} className="mx-auto mb-2 opacity-30" />
                                    <p className="font-semibold">
                                        {clubs.length === 0 ? 'Aún no hay clubes' : `Sin clubes ${clubFilter === 'school' ? 'escolares' : 'abiertos'}`}
                                    </p>
                                    <p className="text-sm mt-1">Usa "Nuevo club" para crear uno.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredClubs.map(club => {
                                        const coordinator = club.mediatorIds?.[0]
                                            ? dataService.getUsuarioById(club.mediatorIds[0])
                                            : null;
                                        const isDeleting = deletingClubId === club.id;
                                        return (
                                            <div key={club.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-4">
                                                {/* Ícono tipo */}
                                                <div className={`flex-shrink-0 p-2 rounded-lg ${club.kind === 'open' ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-500' : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500'}`}>
                                                    {club.kind === 'open' ? <Globe size={18} /> : <GraduationCap size={18} />}
                                                </div>

                                                {/* Datos */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="font-bold text-gray-800 dark:text-gray-100 truncate">{club.name}</p>
                                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${club.kind === 'open' ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'}`}>
                                                            {club.kind === 'open' ? 'Abierto' : 'Escolar'}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-500">
                                                        <span>👤 {coordinator?.nombre_completo ?? '—'}</span>
                                                        <span>👥 {(club.memberIds ?? []).length} miembros</span>
                                                        <span>📅 {club.accessEndsAt ? new Date(club.accessEndsAt).toLocaleDateString('es-ES') : 'Sin límite'}</span>
                                                    </div>
                                                </div>

                                                {/* Acciones */}
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <button
                                                        onClick={() => { setEditingClub(club); setClubModalOpen(true); }}
                                                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                                                        title="Editar club"
                                                    >
                                                        <Edit2 size={15} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteClub(club.id)}
                                                        disabled={isDeleting}
                                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                                                        title="Eliminar club"
                                                    >
                                                        {isDeleting
                                                            ? <Loader2 size={15} className="animate-spin" />
                                                            : <Trash2 size={15} />
                                                        }
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Mis clubes (solo visible al coordinador en su propio perfil) ── */}
            {isOwnProfile && myClubs.length > 0 && (
                <div className="mt-10">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <Users size={20} className="text-indigo-500" />
                        Mis clubes
                    </h2>
                    <div className="space-y-2">
                        {myClubs.map(club => (
                            <div
                                key={club.id}
                                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-4"
                            >
                                <div className={`flex-shrink-0 p-2 rounded-lg ${club.kind === 'open' ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-500' : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500'}`}>
                                    {club.kind === 'open' ? <Globe size={18} /> : <GraduationCap size={18} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-gray-800 dark:text-gray-100 truncate">{club.name}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {club.kind === 'open' ? 'Club abierto' : 'Club escolar'} · {(club.memberIds ?? []).length} miembro{(club.memberIds ?? []).length !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                <button
                                    onClick={() => navigate(`/clubs/${club.id}`)}
                                    className="flex-shrink-0 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-semibold"
                                >
                                    Abrir
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        {/* ── ClubFormModal: creación y edición de clubes desde admin ── */}
        <ClubFormModal
            isOpen={clubModalOpen}
            onClose={handleClubModalClose}
            onSaved={reloadClubs}
            club={editingClub}
        />
        </>
    );
};

export default Perfil;
