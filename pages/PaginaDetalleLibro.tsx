import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import type { Content } from '../types';
import { Book, FileText, Image as ImageIcon, ChevronLeft, Star, Send, UserPen, X, Zap, Play, Eye, WifiOff, Download, CheckCircle, Loader2, Glasses } from 'lucide-react';
import { getOfflineTextEntry, saveOfflineText } from '../utils/offlineTextCache';
import type { OfflineTextEntry } from '../utils/offlineTextCache';
import StarRating from '../components/StarRating';
import ContentCard from '../components/ContentCard';

const PaginaDetalleLibro: React.FC<{ content: Content }> = ({ content }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [relatedContent, setRelatedContent] = useState<Content[]>([]);
    const [reviewText, setReviewText] = useState('');
    const [reviewSubmitted, setReviewSubmitted] = useState(false);
    const [showBioModal, setShowBioModal] = useState(false);
    const [progress, setProgress] = useState<any>(null);

    // B5: Offline download state for accessible mode (texto_plano_url only).
    type OfflineStatus = 'none' | 'this' | 'other' | 'downloading' | 'error' | 'quota';
    const [offlineStatus, setOfflineStatus] = useState<OfflineStatus>('none');
    const [offlineCachedEntry, setOfflineCachedEntry] = useState<OfflineTextEntry | null>(null);

    useEffect(() => {
        Promise.resolve(dataService.getContenidosHijos(content.id, user?.roles || [])).then(children => {
            const filtered = children.filter(c => c.tipo !== 'contexto_pedagogico');
            setRelatedContent(filtered);
        });
        if(user) {
            const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
            setProgress(prog);
            dataService.addToHistory(user.id, content.id);
        }
        // B5: Check offline status on mount — derive from localStorage cache.
        if (content.texto_plano_url) {
            const entry = getOfflineTextEntry();
            setOfflineCachedEntry(entry);
            if (!entry) setOfflineStatus('none');
            else if (entry.contentId === content.id) setOfflineStatus('this');
            else setOfflineStatus('other');
        }
    }, [content.id, user]);

    const handleCommunityReviewSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !reviewText.trim()) return;
        dataService.addCommunityPost({
            tipo: 'resena',
            autor_id: user.id,
            autor_nombre: user.nombre_completo,
            autor_avatar: user.avatar_url,
            contenido: reviewText,
            libro_id: content.id,
            libro_titulo: content.titulo,
            estado: 'aprobado',
            calificacion_comunidad: 5,
            votos: 0
        });
        setReviewSubmitted(true);
        setReviewText('');
    };

    // B5: Download the accessible text for offline reading.
    // Only runs if content.texto_plano_url is set. Replaces any previous offline book.
    const handleDownloadOffline = async () => {
        if (!content.texto_plano_url) return;
        setOfflineStatus('downloading');
        try {
            const res = await fetch(content.texto_plano_url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const texto = await res.text();
            const result = saveOfflineText({
                contentId: content.id,
                title: content.titulo,
                autor: content.autor,
                portada_url: content.portada_url,
                texto,
                language: 'es',
                cachedAt: new Date().toISOString(),
            });
            if (result === 'quota') { setOfflineStatus('quota'); return; }
            if (result === 'error') { setOfflineStatus('error'); return; }
            const saved = getOfflineTextEntry();
            setOfflineCachedEntry(saved);
            setOfflineStatus('this');
        } catch (e) {
            console.error('[PaginaDetalleLibro] offline download failed:', e);
            setOfflineStatus('error');
        }
    };

    const ActionButton: React.FC<{ icon: React.ReactNode, label: string, subLabel?: string, onClick: () => void, primary?: boolean, accent?: string }> = ({ icon, label, subLabel, onClick, primary, accent }) => (
        <button 
            onClick={onClick}
            className={`relative flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-300 group w-full sm:w-auto sm:min-w-[140px]
                ${primary 
                    ? 'bg-white text-black shadow-lg hover:scale-105 border-none' 
                    : 'bg-black/20 backdrop-blur-md border border-white/10 text-white hover:bg-white/10 hover:border-white/30'
                }
            `}
        >
            {accent && <span className="absolute -top-3 bg-yellow-400 text-black text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">{accent}</span>}
            <div className={`mb-2 ${primary ? 'text-indigo-600' : 'text-white/80 group-hover:text-white'}`}>
                {icon}
            </div>
            <span className="font-bold text-sm leading-none">{label}</span>
            {subLabel && <span className={`text-[10px] mt-1 ${primary ? 'text-gray-500' : 'text-white/50'}`}>{subLabel}</span>}
        </button>
    );

    return (
        <div className="relative min-h-screen bg-gray-900 text-white overflow-hidden">
            {/* Immersive Background Layer */}
            <div className="absolute inset-0 z-0">
                <img 
                    src={content.portada_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`} 
                    alt="" 
                    className="w-full h-full object-cover opacity-30 blur-3xl scale-110" 
                    onError={(e) => {
                        const target = e.currentTarget;
                        if (target.src.includes('maxresdefault.jpg')) {
                            target.src = target.src.replace('maxresdefault.jpg', 'hqdefault.jpg');
                        } else if (!target.src.includes('ui-avatars.com')) {
                            target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`;
                        }
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-gray-900/90 via-gray-900/40 to-gray-900/10" />
            </div>

            <div className="relative z-10 p-6 md:p-12 max-w-7xl mx-auto">
                {/* Breadcrumb / Back */}
                <Link to="/biblioteca" className="inline-flex items-center text-white/60 hover:text-white mb-8 transition-colors">
                    <ChevronLeft size={20} className="mr-1"/> Volver
                </Link>

                <div className="flex flex-col md:flex-row gap-10 lg:gap-16">
                    {/* Hero Cover */}
                    <div className="w-full md:w-1/3 lg:w-[280px] flex-shrink-0">
                        <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/50 aspect-[2/3] group">
                            <img 
                                src={content.portada_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`} 
                                alt={content.titulo} 
                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                                onError={(e) => {
                                    const target = e.currentTarget;
                                    if (target.src.includes('maxresdefault.jpg')) {
                                        target.src = target.src.replace('maxresdefault.jpg', 'hqdefault.jpg');
                                    } else if (!target.src.includes('ui-avatars.com')) {
                                        target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`;
                                    }
                                }}
                            />
                            {progress && progress.porcentaje > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm p-3 border-t border-white/10">
                                    <p className="text-xs text-white/80 mb-1 font-bold">Tu progreso</p>
                                    <div className="w-full bg-white/20 rounded-full h-1.5">
                                        <div className="bg-green-400 h-1.5 rounded-full shadow-[0_0_10px_rgba(74,222,128,0.5)]" style={{ width: `${progress.porcentaje}%` }}></div>
                                    </div>
                                    <p className="text-[10px] text-right mt-1 text-green-400">{progress.porcentaje}% completado</p>
                                </div>
                            )}
                        </div>
                        
                        {/* Quick Stats Below Cover */}
                        <div className="flex justify-center gap-4 mt-6 text-sm font-medium text-white/70">
                            <div className="flex items-center gap-1"><Star size={16} className="text-yellow-400 fill-yellow-400"/> {content.metricas.calificacion_promedio}</div>
                            <div className="w-px h-4 bg-white/20"></div>
                            <div>{content.metricas.veces_leido} lecturas</div>
                        </div>

                        {/* B5: Offline download button — only for books with accessible text */}
                        {content.texto_plano_url && (
                            <div className="mt-4">
                                {offlineStatus === 'this' ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-green-500/20 border border-green-400/30 text-green-300 text-xs font-semibold">
                                        <CheckCircle size={14} />
                                        Disponible sin conexión
                                    </div>
                                ) : offlineStatus === 'downloading' ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white/70 text-xs">
                                        <Loader2 size={14} className="animate-spin" />
                                        Descargando...
                                    </div>
                                ) : offlineStatus === 'quota' ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-500/20 border border-red-400/30 text-red-300 text-xs">
                                        <WifiOff size={14} />
                                        Sin espacio disponible
                                    </div>
                                ) : offlineStatus === 'error' ? (
                                    <button onClick={handleDownloadOffline} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-500/20 border border-red-400/30 text-red-300 text-xs hover:bg-red-500/30 transition-colors">
                                        <WifiOff size={14} />
                                        Error — reintentar
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleDownloadOffline}
                                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white/80 hover:text-white text-xs font-semibold transition-all"
                                        title={offlineStatus === 'other' && offlineCachedEntry
                                            ? `Reemplazará "${offlineCachedEntry.title}"`
                                            : 'Guardar para leer sin internet'}
                                    >
                                        <Download size={14} />
                                        {offlineStatus === 'other'
                                            ? 'Reemplazar libro offline'
                                            : 'Guardar para leer offline'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Info & Actions */}
                    <div className="flex-1 pt-2">
                        <h1 className="text-4xl md:text-6xl font-bold mb-2 leading-tight tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-300">
                            {content.titulo}
                        </h1>
                        <h2 className="text-xl md:text-2xl text-indigo-400 font-medium mb-6 flex items-center cursor-pointer hover:underline" onClick={() => setShowBioModal(true)}>
                            {content.autor} <UserPen size={16} className="ml-2 opacity-50"/>
                        </h2>
                        
                        <p className="text-lg text-gray-300 leading-relaxed mb-8 max-w-3xl">
                            {content.descripcion_corta}
                        </p>
                        
                        <div className="flex flex-wrap gap-2 mb-10">
                            {content.etiquetas.map(tag => (
                                <span key={tag} className="px-3 py-1 bg-white/10 text-gray-300 rounded-full text-xs uppercase tracking-wide backdrop-blur-sm border border-white/5">
                                    {tag}
                                </span>
                            ))}
                        </div>

                        {/* Action Buttons - Hierarchical */}
                        <div className="space-y-6">
                            <div className="flex flex-wrap gap-4">
                                {/* Primary CTA */}
                                {content.tipo === 'libro_album' ? (
                                    <button 
                                        onClick={() => navigate(`/ver/album/${content.id}`)}
                                        className="flex items-center px-8 py-4 bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-400 hover:to-orange-500 text-black rounded-full font-bold text-lg shadow-[0_0_30px_rgba(234,179,8,0.4)] hover:-translate-y-1 transition-all duration-300"
                                    >
                                        <Eye size={24} className="mr-3" /> 
                                        Iniciar Experiencia Visual
                                    </button>
                                ) : (
                                    <>
                                        {/* Dynamic Primary Button logic: PDF > TXT > Fallback */}
                                        {(content.url_recurso || content.texto_plano_url) ? (
                                          <button 
                                            onClick={() => {
                                                if (content.texto_plano_url) navigate(`/leer/inmersivo/${content.id}`);
                                                else navigate(`/leer/pdf/${content.id}`);
                                            }}
                                            className="flex items-center px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold text-lg shadow-[0_0_30px_rgba(79,70,229,0.4)] hover:shadow-[0_0_40px_rgba(79,70,229,0.6)] hover:-translate-y-1 transition-all duration-300"
                                          >
                                            <Play size={24} className="fill-current mr-3" /> 
                                            {progress && progress.porcentaje > 0 ? "Reanudar Lectura" : "Leer Ahora"}
                                          </button>
                                        ) : (
                                          <button 
                                            disabled
                                            className="flex items-center px-8 py-4 bg-gray-600 text-gray-400 cursor-not-allowed rounded-full font-bold text-lg transition-all duration-300"
                                          >
                                            <Eye size={24} className="mr-3 opacity-50" /> 
                                            Sin archivo legible
                                          </button>
                                        )}
                                    </>
                                )}
                                
                                {/* Secondary Actions (Show only if NOT album, and ONLY if resources exist) */}
                                {content.tipo !== 'libro_album' && (
                                    <>
                                      {content.texto_plano_url && (
                                        <button onClick={() => navigate(`/leer/inmersivo/${content.id}`)} className="flex items-center px-6 py-4 bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur text-white rounded-full font-semibold transition-all">
                                            <Zap size={20} className="mr-2 text-yellow-400"/> Inmersivo
                                        </button>
                                      )}
                                      {content.texto_plano_url && (
                                        <button onClick={() => navigate(`/leer/texto/${content.id}`)} className="flex items-center px-6 py-4 bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur text-white rounded-full font-semibold transition-all">
                                            <FileText size={20} className="mr-2 text-green-400"/> Guiado
                                        </button>
                                      )}
                                      {content.texto_plano_url && (
                                        <button onClick={() => navigate(`/leer/accesible/${content.id}`)} className="flex items-center px-6 py-4 bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur text-white rounded-full font-semibold transition-all">
                                            <Glasses size={20} className="mr-2 text-blue-400"/> Accesible
                                        </button>
                                      )}
                                    </>
                                )}
                            </div>

                            {/* Tertiary Actions Grid */}
                            <div className="flex gap-4 pt-4 border-t border-white/10">
                                {content.tipo !== 'libro_album' && content.url_recurso && (
                                    <button onClick={() => navigate(`/leer/pdf/${content.id}`)} className="flex items-center text-sm text-gray-400 hover:text-white transition-colors gap-2 px-3 py-2 rounded-lg hover:bg-white/5">
                                        <Book size={16}/> Ver PDF Original
                                    </button>
                                )}
                                {content.ilustraciones_url && content.ilustraciones_url.length > 0 && (
                                    <button 
                                        onClick={() => navigate(`/galeria/${content.id}`)}
                                        className="flex items-center text-sm text-gray-400 hover:text-white transition-colors gap-2 px-3 py-2 rounded-lg hover:bg-white/5"
                                    >
                                        <ImageIcon size={16}/> Galería de Arte
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Ecosystem Section */}
                <div className="mt-20">
                    <h3 className="text-2xl font-bold mb-8 flex items-center text-white/90">
                        <div className="w-1 h-8 bg-indigo-500 rounded-full mr-4"></div>
                        Ecosistema de Aprendizaje
                    </h3>
                    
                    {relatedContent.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
                            {relatedContent.map(child => (
                                <ContentCard key={child.id} content={child} />
                            ))}
                        </div>
                    ) : (
                        <div className="bg-white/5 rounded-xl p-8 text-center border border-white/5">
                            <p className="text-gray-400 italic">No hay materiales adicionales disponibles para este título aún.</p>
                        </div>
                    )}
                </div>

                {/* Community Review Section */}
                <div className="mt-16 max-w-3xl">
                    <h3 className="text-xl font-bold mb-6 flex items-center text-white/90 border-b border-white/10 pb-4">
                        <Send className="mr-3 text-indigo-400"/> Tu Opinión Cuenta
                    </h3>
                    <div className="bg-white/5 backdrop-blur-sm p-6 rounded-xl border border-white/10">
                        {reviewSubmitted ? (
                            <div className="text-center py-6 animate-in fade-in">
                                <div className="mx-auto w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mb-3">
                                    <Send className="text-green-400"/>
                                </div>
                                <p className="font-bold text-green-400">¡Reseña Enviada!</p>
                                <p className="text-sm text-gray-400 mt-2">Gracias por compartir tu voz con la comunidad.</p>
                                <button onClick={() => setReviewSubmitted(false)} className="mt-4 text-indigo-400 text-xs hover:text-indigo-300 underline">Escribir otra</button>
                            </div>
                        ) : (
                            <form onSubmit={handleCommunityReviewSubmit}>
                                <textarea
                                    value={reviewText}
                                    onChange={(e) => setReviewText(e.target.value)}
                                    placeholder="¿Qué sentiste al leer este libro? ¿Qué aprendiste? Escribe tu reseña aquí..."
                                    className="w-full p-4 rounded-xl bg-black/30 border border-white/10 text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all min-h-[120px]"
                                    required
                                />
                                <div className="flex justify-end mt-4">
                                    <button type="submit" className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-500 transition-colors">
                                        Publicar Reseña
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            </div>

            {/* Author Bio Modal */}
            {showBioModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
                    <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 border border-white/10">
                        <div className="relative bg-gradient-to-b from-indigo-900 to-gray-900 p-8 text-center">
                            <button onClick={() => setShowBioModal(false)} className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full text-white"><X size={20}/></button>
                            <div className="w-24 h-24 bg-white/10 backdrop-blur rounded-full mx-auto mb-4 overflow-hidden p-1 border-2 border-white/20 shadow-xl">
                                <img 
                                    src={`https://ui-avatars.com/api/?name=${encodeURIComponent(content.autor)}&background=random&size=200`} 
                                    alt={content.autor} 
                                    className="w-full h-full object-cover rounded-full"
                                />
                            </div>
                            <h2 className="text-2xl font-bold text-white">{content.autor}</h2>
                            <p className="text-indigo-300 text-sm font-medium">Autor(a) Destacado</p>
                        </div>
                        <div className="p-8 max-h-[50vh] overflow-y-auto custom-scrollbar">
                            <p className="text-gray-300 leading-relaxed whitespace-pre-line font-reading">
                                {content.biografia_autor}
                            </p>
                        </div>
                        <div className="p-4 border-t border-white/10 text-center bg-black/20">
                            <button onClick={() => setShowBioModal(false)} className="text-white/60 hover:text-white text-sm font-semibold transition-colors">Cerrar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PaginaDetalleLibro;