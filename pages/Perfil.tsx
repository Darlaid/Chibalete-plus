
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import type { User, Resena, Content, Bookmark } from '../types';
import { Award, BookOpen, Heart, Users, Shield, Share2, Facebook, Linkedin, Instagram, Check, Loader2 } from 'lucide-react';
import BookmarkManager from '../components/BookmarkManager';
import StarRating from '../components/StarRating';

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
    const [activeTab, setActiveTab] = useState<'originales' | 'reseñas' | 'favoritos' | 'redes' | 'admin'>('reseñas');
    const [resenas, setResenas] = useState<{ review: Resena, content: Content }[]>([]);
    const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
    const navigate = useNavigate();

    // Force refresh to update UI when local mock data changes
    const [refreshKey, setRefreshKey] = useState(0);

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

    if (!user) {
        return <div>Usuario no encontrado</div>;
    }

    const isOwnProfile = currentUser?.id === user.id;
    const isAdmin = currentUser?.roles.includes('administrador');
    const userAge = calculateAge(user.fecha_nacimiento);
    const isOldEnough = userAge >= 15;

    const TabButton: React.FC<{ tab: 'originales' | 'reseñas' | 'favoritos' | 'redes' | 'admin', label: string }> = ({ tab, label }) => (
        <button
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-semibold rounded-t-lg transition-colors whitespace-nowrap ${activeTab === tab ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'text-gray-500 hover:text-gray-700'}`}
        >
            {label}
        </button>
    )

    return (
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

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md mb-8">
                <StatItem icon={<BookOpen />} value={user.libros_leidos} label="Leídos" />
                <StatItem icon={<Users />} value={user.seguidores} label="Seguidores" />
                <StatItem icon={<Users />} value={user.seguidos} label="Seguidos" />
                <StatItem icon={<Award />} value={user.nivel_lectura} label="Nivel" />
            </div>

            <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
                <nav className="-mb-px flex space-x-4">
                    <TabButton tab="originales" label="Originales" />
                    <TabButton tab="reseñas" label="Reseñas" />
                    <TabButton tab="favoritos" label="Favoritos" />
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
                    </div>
                )}
            </div>
        </div>
    );
};

export default Perfil;
