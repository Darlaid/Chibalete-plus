import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Content } from '../types';
import { ChevronLeft, Clapperboard, UserPen, X } from 'lucide-react';

const VisorVideo: React.FC<{ content: Content }> = ({ content }) => {
    const [videoError, setVideoError] = useState(false);
    const [showBioModal, setShowBioModal] = useState(false);

    const { isYoutube, youtubeEmbedUrl } = useMemo(() => {
        const url = content.url_recurso || '';
        // Simple robust check for YT
        const isYt = url.includes('youtube.com') || url.includes('youtu.be');

        let embedSrc = url;
        if (isYt) {
            // Extract ID
            let videoId = '';
            if (url.includes('embed/')) {
                videoId = url.split('embed/')[1].split('?')[0];
            } else if (url.includes('v=')) {
                videoId = url.split('v=')[1].split('&')[0];
            } else if (url.includes('youtu.be/')) {
                videoId = url.split('youtu.be/')[1].split('?')[0];
            }

            if (videoId) {
                // Fix Error 153: Use nocookie domain + referrerPolicy
                embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
            }
        }

        return { isYoutube: isYt, youtubeEmbedUrl: embedSrc };
    }, [content.url_recurso]);

    return (
        <div className="bg-black min-h-screen flex flex-col">
            <header className="p-4 flex items-center space-x-4 text-white z-10">
                <Link to="/" className="p-2 rounded-full hover:bg-white/10" aria-label="Volver">
                    <ChevronLeft />
                </Link>
                <div>
                    <h1 className="text-xl font-bold">{content.titulo}</h1>
                    <p className="text-sm text-gray-400 hover:text-white cursor-pointer flex items-center gap-2" onClick={() => setShowBioModal(true)}>
                        {content.autor} <UserPen size={12} />
                    </p>
                </div>
            </header>

            <main className="flex-grow flex items-center justify-center">
                <div className="w-full max-w-4xl aspect-video bg-gray-900 rounded-lg overflow-hidden shadow-2xl relative">
                    {/* Error Overlay */}
                    {videoError && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-900/90 text-center p-6">
                            <div className="bg-red-500/10 p-4 rounded-full mb-4">
                                <Clapperboard size={48} className="text-red-500" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">Error al reproducir video</h3>
                            <p className="text-gray-400 mb-6 max-w-md">
                                No se pudo cargar el recurso de video. Verifica tu conexión o intenta más tarde.
                            </p>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-6 py-2 bg-white text-black font-bold rounded-full hover:bg-gray-200 transition-colors"
                            >
                                Reintentar
                            </button>
                        </div>
                    )}

                    {isYoutube ? (
                        <iframe
                            className="w-full h-full"
                            src={youtubeEmbedUrl}
                            title={content.titulo}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            referrerPolicy="strict-origin-when-cross-origin"
                        ></iframe>
                    ) : (
                        <video
                            className="w-full h-full"
                            controls
                            playsInline
                            preload="metadata"
                            src={content.url_recurso}
                            onError={(e) => {
                                console.error("Video Error:", e);
                                setVideoError(true);
                            }}
                        >
                            Tu navegador no soporta el tag de video.
                        </video>
                    )}
                </div>
            </main>

            <section className="p-4 md:p-8 max-w-4xl mx-auto w-full text-white">
                <div className="flex flex-wrap gap-2 mb-4">
                    {content.etiquetas.map(tag => (
                        <span key={tag} className="px-2 py-1 bg-gray-800 text-gray-300 rounded text-xs border border-gray-700">
                            {tag}
                        </span>
                    ))}
                </div>
                <h2 className="text-lg font-semibold mb-2">Descripción</h2>
                <p className="text-gray-300 leading-relaxed">{content.descripcion_corta || "Sin descripción."}</p>
            </section>

            {/* Author Bio Modal */}
            {showBioModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 border border-gray-200 dark:border-gray-700">
                        <div className="relative bg-gradient-to-br from-indigo-600 to-purple-700 p-6 text-center text-white">
                            <button onClick={() => setShowBioModal(false)} className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-full text-white transition-colors"><X size={20} /></button>
                            <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full mx-auto mb-3 overflow-hidden p-1 border-2 border-white/50 shadow-lg">
                                <img
                                    src={`https://ui-avatars.com/api/?name=${encodeURIComponent(content.autor)}&background=random&size=200`}
                                    alt={content.autor}
                                    className="w-full h-full object-cover rounded-full"
                                />
                            </div>
                            <h2 className="text-xl font-bold">{content.autor}</h2>
                            <p className="text-indigo-100 text-xs uppercase tracking-wider font-semibold">Creador de Contenido</p>
                        </div>
                        <div className="p-6 max-h-[50vh] overflow-y-auto custom-scrollbar">
                            <p className="text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line text-sm">
                                {content.biografia_autor || "No hay información biográfica disponible para este autor."}
                            </p>
                        </div>
                        <div className="p-4 border-t border-gray-100 dark:border-gray-800 text-center bg-gray-50 dark:bg-gray-800/50">
                            <button onClick={() => setShowBioModal(false)} className="text-indigo-600 dark:text-indigo-400 text-sm font-bold hover:underline">Cerrar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VisorVideo;