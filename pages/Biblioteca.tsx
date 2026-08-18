import React, { useState, useEffect } from 'react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import ContentCard from '../components/ContentCard';
import CommunityPostCard from '../components/CommunityPostCard';
import type { Content, ProgresoLectura, CommunityPost } from '../types';
import { Search, ChevronLeft, ChevronRight, Users, Mail, Filter, Lock } from 'lucide-react';
import { useAccessCheck } from '../hooks/useAccessCheck';

// CHP-LIB-01 — card de la capa Editorial. El candado refleja el resultado del
// preflight canónico /api/content/:id/access (Biblioteca no decide acceso);
// abrir sigue pasando por la autorización existente del visor.
const EditorialBookCard: React.FC<{ book: Content; userId?: string }> = ({ book, userId }) => {
    const access = useAccessCheck(book.id, userId);
    return (
        <div className="relative">
            <ContentCard content={book} />
            {access.status === 'denied' && (
                <div
                    className="absolute top-2 right-2 bg-gray-900/75 text-white rounded-full p-2 shadow-md"
                    title="Sin acceso — pídelo a tu mediador"
                    aria-label="Sin acceso — pídelo a tu mediador"
                >
                    <Lock size={14} />
                </div>
            )}
        </div>
    );
};

// Skeleton para grid de contenido mientras carga el estado de acceso
const AccessLoadingSkeleton: React.FC = () => (
    <div className="animate-in fade-in duration-300 mt-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                    <div className="bg-gray-200 dark:bg-gray-700 rounded-xl aspect-[2/3] mb-3" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                </div>
            ))}
        </div>
    </div>
);

const ITEMS_PER_PAGE = 20;

const Biblioteca: React.FC = () => {
    const { user, accessReady } = useAuth();
    const { downloadedContent } = useOffline();
    const [activeTab, setActiveTab] = useState('biblioteca');
    const [enProgreso, setEnProgreso] = useState<{ content: Content, progress: ProgresoLectura }[]>([]);
    const [miBiblioteca, setMiBiblioteca] = useState<Content[]>([]);
    const [librosAlbum, setLibrosAlbum] = useState<Content[]>([]);
    const [recomendados, setRecomendados] = useState<Content[]>([]);
    const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');

    // --- SECTIONS & FILTERING STATE ---
    const [sections, setSections] = useState<any[]>([]);
    const [schoolConfig, setSchoolConfig] = useState<{ hiddenContentIds: string[] }>({ hiddenContentIds: [] });

    // CHP-LIB-01 — capa Editorial (carga perezosa al activar la pestaña)
    const [editorial, setEditorial] = useState<{ collections: any[]; unassigned: any[] } | null>(null);
    useEffect(() => {
        if (activeTab === 'editorial' && user && editorial === null) {
            dataService.getEditorialLibrary().then(v => setEditorial({ collections: v.collections ?? [], unassigned: v.unassigned ?? [] }));
        }
    }, [activeTab, user, editorial]);

    useEffect(() => {
        if (user && accessReady) {
            // Parallel loading for optimization
            Promise.all([
                dataService.getContenidosEnProgreso(user.id, user.roles),
                dataService.getContenidos(user.roles, user.id),
                dataService.getLibrosAlbum(user.roles, user.id),
                dataService.getRecomendadosComunidad(user.roles, user.id),
                dataService.getCommunityPosts('aprobado'),
                dataService.getSections(),
                user.colegio ? dataService.getSchoolConfig(user.colegio) : Promise.resolve({ hiddenContentIds: [] })
            ]).then(([prog, lib, albums, rec, posts, secs, conf]) => {
                setEnProgreso(prog);
                setMiBiblioteca(lib);
                setLibrosAlbum(albums);
                setRecomendados(rec);
                setCommunityPosts(posts);
                setSections(secs.sort((a: any, b: any) => a.order - b.order));
                setSchoolConfig(conf);
            });
        }
    }, [user, accessReady]);

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        setCurrentPage(1);
    };

    const TabButton: React.FC<{ tab: string, label: string, highlight?: boolean }> = ({ tab, label, highlight }) => (
        <button
            onClick={() => handleTabChange(tab)}
            className={`px-5 py-2 font-medium rounded-full text-sm transition-all duration-200 whitespace-nowrap ${activeTab === tab
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30 scale-105'
                : (highlight ? 'bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700')
                }`}
        >
            {label}
        </button>
    );

    const renderContent = () => {
        // Mostrar skeleton mientras el motor de acceso no está listo.
        // Evita flash de contenido incorrecto sin bloquear la navegación.
        if (!accessReady && activeTab === 'biblioteca') {
            return <AccessLoadingSkeleton />;
        }

        let items: (Content | { content: Content, progress: ProgresoLectura } | CommunityPost)[] = [];
        let showPagination = false;
        let totalPages = 0;
        let displayedItems: any[] = [];
        let groupedMode = false; // "Sections" mode

        // 1. FILTERING (Optimization: Filter early)
        const filterHidden = (list: Content[]) => {
            if (!schoolConfig.hiddenContentIds.length) return list;
            const hiddenSet = new Set(schoolConfig.hiddenContentIds);
            return list.filter(c => c && c.id && !hiddenSet.has(c.id));
        };

        // CHP-LIB-01 — capa EDITORIAL: dos niveles máximo (colección → libro).
        if (activeTab === 'editorial') {
            if (!editorial) return <AccessLoadingSkeleton />;
            const hiddenSet = new Set(schoolConfig.hiddenContentIds);
            const visibleRefs = (refs: any[]) => refs.filter(r => r?.book && !hiddenSet.has(r.bookId));
            const cols = editorial.collections
                .map(c => ({ ...c, references: visibleRefs(c.references) }))
                .filter(c => c.references.length > 0);
            const unassigned = visibleRefs(editorial.unassigned);
            if (cols.length === 0 && unassigned.length === 0) {
                return (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                        <Filter size={48} className="mb-4 opacity-20" />
                        <p>La selección editorial estará disponible pronto.</p>
                    </div>
                );
            }
            return (
                <div className="animate-in fade-in duration-500 space-y-12 mt-8">
                    {cols.map(col => (
                        <div key={col.id}>
                            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">{col.name}</h3>
                            {col.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{col.description}</p>}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 mt-4">
                                {col.references.map((r: any) => (
                                    <EditorialBookCard key={r.id} book={r.book} userId={user?.id} />
                                ))}
                            </div>
                        </div>
                    ))}
                    {unassigned.length > 0 && (
                        <div>
                            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4">Más de la selección</h3>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                                {unassigned.map((r: any) => (
                                    <EditorialBookCard key={r.id} book={r.book} userId={user?.id} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        if (activeTab === 'comunidad') {
            // ... (Existing Community Render - omit for brevity if unchanged, but need to include it or keep logic)
            // Since I'm replacing the whole renderContent, I must include it.
            return (
                <div className="mt-8 max-w-4xl mx-auto animate-in slide-in-from-bottom-4">
                    {/* Club de Lectura Banner */}
                    <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-8 text-white shadow-xl mb-12 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
                        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
                            <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-sm">
                                <Users size={40} className="text-white" />
                            </div>
                            <div className="flex-1">
                                <h2 className="text-2xl font-bold mb-2">Clubes de Lectura Escolares</h2>
                                <p className="mb-6 text-indigo-100 text-sm md:text-base max-w-2xl">
                                    Conecta con otros lectores. Envíanos las memorias, fotos y conclusiones de tu club para ser publicadas en el muro de la comunidad.
                                </p>
                                <a href="mailto:contacto@chibaleteeditores.com" className="inline-flex items-center bg-white text-indigo-600 px-5 py-3 rounded-xl font-bold hover:bg-indigo-50 transition-colors shadow-lg">
                                    <Mail size={18} className="mr-2" /> Enviar Memorias
                                </a>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">Muro de la Comunidad</h3>
                        <div className="text-sm text-gray-500">Más recientes</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {communityPosts.length > 0 ? (
                            communityPosts.map(post => (
                                <div key={post.id} className="w-full">
                                    <CommunityPostCard post={post} />
                                </div>
                            ))
                        ) : (
                            <div className="col-span-2 text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                                <p className="text-gray-500">Aún no hay publicaciones en la comunidad.</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        switch (activeTab) {
            case 'lectura':
                items = enProgreso.filter(i => !schoolConfig.hiddenContentIds.includes(i.content.id));
                displayedItems = items;
                break;
            case 'biblioteca':
                items = filterHidden(miBiblioteca);
                // Search Logic
                if (searchQuery) {
                    items = (items as Content[]).filter(c => c.titulo.toLowerCase().includes(searchQuery.toLowerCase()) || c.autor.toLowerCase().includes(searchQuery.toLowerCase()));
                    groupedMode = false; // Disable sections when searching
                } else if (sections.length > 0) {
                    groupedMode = true; // Enable sections view by default if no search
                }

                if (!groupedMode) {
                    if (items.length > ITEMS_PER_PAGE) {
                        showPagination = true;
                        totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
                        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
                        displayedItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);
                    } else {
                        displayedItems = items;
                    }
                }
                break;
            case 'album':
                items = filterHidden(librosAlbum);
                displayedItems = items;
                break;
            case 'descargados':
                items = filterHidden(downloadedContent);
                displayedItems = items;
                break;
            case 'recomendados':
                items = filterHidden(recomendados);
                displayedItems = items;
                break;
            default:
                return <p className="mt-8 text-center text-gray-500">Próximamente.</p>;
        }

        if (items.length === 0 && !groupedMode) {
            return (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <Filter size={48} className="mb-4 opacity-20" />
                    <p>No encontramos libros disponibles.</p>
                </div>
            )
        }

        // RENDER GROUPED SECTIONS
        if (groupedMode) {
            // Organize content into sections
            // Items in 'miBiblioteca' that have a sectionId match.
            // Items with NO section or sections not in the list go to "General / Otros"
            const contentList = items as Content[];

            return (
                <div className="animate-in fade-in duration-500 space-y-12 mt-8">
                    {sections.map(sec => {
                        const secContent = contentList.filter(c => c.sectionIds?.includes(sec.id));
                        if (secContent.length === 0) return null; // Optimization: Don't render empty sections

                        return (
                            <div key={sec.id}>
                                <div className="flex items-center gap-2 mb-4">
                                    {/* We could use sec.icono here to render specific icon */}
                                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">{sec.titulo}</h3>
                                    {sec.unlockCost > 0 && !sec.isPublic && (
                                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                                            {sec.unlockCost} pts
                                        </span>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                                    {secContent.map(content => (
                                        <ContentCard key={content.id} content={content} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}

                    {/* General / Other Content (Not in any section) */}
                    {(() => {
                        const sectionedIds = new Set(sections.flatMap(s => contentList.filter(c => c.sectionIds?.includes(s.id)).map(c => c.id)));
                        const others = contentList.filter(c => !sectionedIds.has(c.id));
                        if (others.length === 0) return null;

                        return (
                            <div>
                                <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4">General</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                                    {others.map(content => (
                                        <ContentCard key={content.id} content={content} />
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

        // RENDER STANDARD GRID
        return (
            <div className="animate-in fade-in duration-500">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 mt-8 items-start">
                    {displayedItems.map(item => {
                        const content = 'content' in item ? (item as any).content : item;
                        const progress = 'progress' in item ? (item as any).progress : undefined;
                        return <ContentCard key={content.id} content={content} progress={progress?.porcentaje} />;
                    })}
                </div>

                {showPagination && totalPages > 1 && (
                    <div className="flex justify-center items-center space-x-4 mt-12 mb-8">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:shadow-none transition-all"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <span className="text-sm font-bold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-full">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:shadow-none transition-all"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>
                )}
            </div>
        )
    };


    return (
        <div className="p-4 md:p-8 md:pt-10 max-w-[1600px] mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
                <div>
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">Biblioteca</h1>
                    <p className="text-gray-500 dark:text-gray-400">Explora todo nuestro catálogo de conocimiento.</p>
                </div>
            </div>

            {activeTab === 'biblioteca' && (
                <div className="relative mb-8 max-w-2xl">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Search className="text-gray-400" size={20} />
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar título, autor o tema..."
                        className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none shadow-sm transition-shadow hover:shadow-md"
                    />
                </div>
            )}

            <div className="flex space-x-3 overflow-x-auto pb-4 scrollbar-hide">
                <TabButton tab="biblioteca" label="Libros" />
                <TabButton tab="editorial" label="Selección Chibalete" />
                <TabButton tab="album" label="Libros Álbum" highlight={true} />
                <TabButton tab="lectura" label="Continuar Leyendo" />
                <TabButton tab="descargados" label="Disponibles Offline" />
                <TabButton tab="recomendados" label="Para Ti" />
                <TabButton tab="comunidad" label="Comunidad" />
            </div>

            {renderContent()}

        </div>
    );
};

export default Biblioteca;
