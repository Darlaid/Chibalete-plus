
import React from 'react';
import { Link } from 'react-router-dom';
import type { Content } from '../types';
import { Book, Mic, Clapperboard, Download, Bookmark as BookmarkIcon, Clock } from 'lucide-react';
import { useOffline } from '../context/OfflineContext';
import { EditorialCover } from './editorial/EditorialCover';

/**
 * Fase 4 — Editorial Cover System opt-in via localStorage flag.
 * Default OFF: ContentCard se renderiza exactamente igual que antes.
 * Cuando localStorage['EDITORIAL_COVER_SYSTEM']==='1', las portadas se
 * muestran respetando su aspect-ratio intrínseco (no más crop destructivo).
 */
function _editorialCoverEnabled(): boolean {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        return window.localStorage.getItem('EDITORIAL_COVER_SYSTEM') === '1';
    } catch { return false; }
}

interface ContentCardProps {
  content: Content;
  progress?: number;
  onUpdateProgressClick?: (content: Content) => void;
}

const ContentCard: React.FC<ContentCardProps> = ({ content, progress, onUpdateProgressClick }) => {
  const { isDownloaded } = useOffline();
  const isAvailableOffline = isDownloaded(content.id);

  const handleProgressClick = (e: React.MouseEvent) => {
    if (onUpdateProgressClick) {
      e.preventDefault();
      e.stopPropagation();
      onUpdateProgressClick(content);
    }
  };

  const processingPercent = content.processingStatus?.percentage || 0;
  // If 100%, consider IT DONE (even if backend status lags) to hide overlay
  const isProcessing = content.status === 'procesando' && processingPercent < 100;
  const isFailed = content.status === 'error' || content.processingStatus?.status === 'failed';
  // Fase 4 — opt-in al EditorialCover system. Default OFF (cero cambio prod).
  const useEditorial = _editorialCoverEnabled();

  return (
    <div className={`flex flex-col w-full flex-shrink-0 snap-start ${isProcessing ? 'opacity-80 grayscale-[0.3]' : ''}`}>
      {/* Wrapper: Link if available, Div if processing */}
      {isProcessing ? (
        <div className="block group relative cursor-not-allowed">
          <div className="relative w-full h-auto rounded-xl overflow-hidden shadow-md bg-gray-200 dark:bg-gray-800 border-2 border-dashed border-gray-400 dark:border-gray-600">
            {useEditorial ? (
              <EditorialCover
                src={content.portada_url}
                alt={`Portada de ${content.titulo}`}
                titulo={content.titulo}
                expectedShape="portrait"
                dim
              />
            ) : (
              <img
                src={content.portada_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`}
                alt={`Portada de ${content.titulo}`}
                className="w-full h-full object-cover opacity-50 blur-[1px]"
                loading="lazy"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src.includes('maxresdefault.jpg')) {
                    target.src = target.src.replace('maxresdefault.jpg', 'hqdefault.jpg');
                  } else if (!target.src.includes('ui-avatars.com')) {
                    target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`;
                  }
                }}
              />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 p-4 text-center">
              <Clock className={`text-white mb-2 ${isFailed ? '' : 'animate-pulse'}`} size={32} />
              <span className={`text-white font-bold text-xs px-3 py-1 rounded-full backdrop-blur-sm mb-2 ${isFailed ? 'bg-red-500/80' : 'bg-black/50'}`}>
                {isFailed ? 'ERROR DE PROCESO' : 'PREPARANDO AUDIO'}
              </span>

              {!isFailed && (
                <div className="w-24 h-2 bg-gray-700/50 rounded-full overflow-visible relative mt-1">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-300 relative"
                    style={{ width: `${Math.max(5, processingPercent)}%` }}
                  >
                    <div className="absolute right-0 -top-1 w-2 h-full bg-white/50 blur-[2px]"></div>
                  </div>
                </div>
              )}

              <p className="text-white/90 text-[10px] mt-2 font-mono">
                {isFailed ? 'Requiere atención' : `${processingPercent}% Completado`}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <Link to={`/contenido/${content.id}`} className="block group relative">
          <div className="relative w-full h-auto rounded-xl overflow-hidden shadow-md transition-all duration-300 motion-reduce:transition-none group-hover:shadow-xl group-hover:scale-[1.02] motion-reduce:group-hover:scale-100 bg-gray-200 dark:bg-gray-800">
            {useEditorial ? (
              <EditorialCover
                src={content.portada_url}
                alt={`Portada de ${content.titulo}`}
                titulo={content.titulo}
                expectedShape="portrait"
              />
            ) : (
              <img
                src={content.portada_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`}
                alt={`Portada de ${content.titulo}`}
                className="w-full h-full object-cover transition-transform duration-500 motion-reduce:transition-none group-hover:scale-105 motion-reduce:group-hover:scale-100"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src.includes('maxresdefault.jpg')) {
                    target.src = target.src.replace('maxresdefault.jpg', 'hqdefault.jpg');
                  } else if (!target.src.includes('ui-avatars.com')) {
                    target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(content.titulo)}&background=random&size=400`;
                  }
                }}
              />
            )}

            {/* Overlay gradient only on hover or if info present */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 motion-reduce:transition-none"></div>

            {/* Badges */}
            {content.etiquetas.includes('Nuevo') && (
              <div className="absolute top-2 left-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                NUEVO
              </div>
            )}

            {isAvailableOffline && (
              <div className="absolute top-2 right-2 bg-indigo-600/90 backdrop-blur-sm p-1.5 rounded-full text-white shadow-lg transform scale-90" title="Disponible sin conexión">
                <Download size={12} />
              </div>
            )}

            {progress !== undefined && progress > 0 && progress < 100 && (
              <div className="absolute bottom-3 left-3 right-3 h-1.5 bg-gray-700/50 backdrop-blur-sm rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progress}%` }}></div>
              </div>
            )}
          </div>
        </Link>
      )}

      <div className="mt-3 px-1">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight truncate" title={content.titulo}>
              <Link to={`/contenido/${content.id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                {content.titulo}
              </Link>
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5" title={content.autor}>{content.autor}</p>
          </div>
          {onUpdateProgressClick && progress !== undefined && progress < 100 && (
            <button
              onClick={handleProgressClick}
              className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors -mt-0.5"
              title="Actualizar progreso"
            >
              <BookmarkIcon size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContentCard;
