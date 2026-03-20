import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Content } from '../types';
import { Play, Pause, Download, ChevronLeft, UserPen, X } from 'lucide-react';

const VisorAudio: React.FC<{ content: Content }> = ({ content }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showBioModal, setShowBioModal] = useState(false);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const changeSpeed = (rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4 overflow-y-auto">
      <Link to="/" className="absolute top-4 left-4 p-2 rounded-full bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm hover:bg-white dark:hover:bg-gray-800 z-10" aria-label="Volver">
        <ChevronLeft />
      </Link>

      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center mt-12 mb-8">
        <img
          src={content.portada_url}
          alt={content.titulo}
          className="w-48 h-48 rounded-lg mx-auto mb-6 shadow-md object-cover"
        />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{content.titulo}</h1>
        <p className="text-indigo-600 dark:text-indigo-400 font-medium mb-6 cursor-pointer hover:underline flex items-center justify-center gap-2" onClick={() => setShowBioModal(true)}>
          {content.autor} <UserPen size={14} />
        </p>

        <audio ref={audioRef} src={content.url_recurso} onEnded={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />

        <div className="flex items-center justify-center space-x-6 my-8">
          <button onClick={() => alert('Función de descarga no implementada.')} className="text-gray-500 hover:text-indigo-500 transition-colors" aria-label="Descargar podcast">
            <Download size={24} />
          </button>
          <button onClick={togglePlay} className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center text-4xl shadow-lg hover:bg-indigo-700 transition-transform transform hover:scale-105 active:scale-95" aria-label={isPlaying ? 'Pausar' : 'Reproducir'}>
            {isPlaying ? <Pause size={40} /> : <Play size={40} className="ml-1" />}
          </button>
          <div className="relative">
            <button onClick={() => { }} className="text-gray-500 font-bold w-12 h-12 flex items-center justify-center rounded-full border-2 border-gray-300 dark:border-gray-600 text-sm">
              {playbackRate}x
            </button>
          </div>
        </div>

        <div className="flex justify-center space-x-2 mb-8">
          {[0.5, 1, 1.5, 2].map(rate => (
            <button key={rate} onClick={() => changeSpeed(rate)} className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${playbackRate === rate ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}>
              {rate}x
            </button>
          ))}
        </div>

        {/* Metadata Section */}
        <div className="text-left border-t border-gray-200 dark:border-gray-700 pt-6">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">Descripción</h3>
          <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed mb-4">
            {content.descripcion_corta || "No hay descripción disponible."}
          </p>

          <div className="flex flex-wrap gap-2">
            {content.etiquetas.map(tag => (
              <span key={tag} className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

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

export default VisorAudio;