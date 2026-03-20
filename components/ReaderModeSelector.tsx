import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Headphones, Type } from 'lucide-react';
import { dataService } from '../services/dataService';


interface ReaderModeSelectorProps {
    contentId: string;
    currentMode: 'pdf' | 'immersive' | 'text';
    onBeforeSwitch?: () => void; // Hook to force save before switching
}

const ReaderModeSelector: React.FC<ReaderModeSelectorProps> = ({ contentId, currentMode, onBeforeSwitch }) => {
    const navigate = useNavigate();


    const handleSwitch = async (targetMode: 'pdf' | 'immersive' | 'text') => {
        if (targetMode === currentMode) return;

        // 1. Force Save Current State
        if (onBeforeSwitch) {
            onBeforeSwitch();
        }

        // 2. Wait a tick to ensure sync (optional, usually sync is fast enough)
        await new Promise(resolve => setTimeout(resolve, 50));

        // 3. Navigate with correct paths mapping App.tsx
        switch (targetMode) {
            case 'pdf':
                navigate(`/leer/pdf/${contentId}`);
                break;
            case 'immersive':
                navigate(`/leer/inmersivo/${contentId}`);
                break;
            case 'text':
                navigate(`/leer/texto/${contentId}`);
                break;
        }
    };
    
    const content = dataService.getContenidoById(contentId);
    
    // Fallback if not loaded
    if (!content) return null;

    return (
        <div className="fixed top-20 right-4 z-[60] flex flex-col gap-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur rounded-2xl p-2 shadow-xl border border-gray-200 dark:border-gray-700 animate-in slide-in-from-right-10">
            {content.url_recurso && (
               <button
                   onClick={() => handleSwitch('pdf')}
                   title="Modo Visual (PDF)"
                   className={`p-3 rounded-xl transition-all ${currentMode === 'pdf' ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-indigo-500'}`}
               >
                   <BookOpen size={20} />
               </button>
            )}
            
            {content.texto_plano_url && (
               <button
                   onClick={() => handleSwitch('immersive')}
                   title="Modo Inmersivo (Audio)"
                   className={`p-3 rounded-xl transition-all ${currentMode === 'immersive' ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-indigo-500'}`}
               >
                   <Headphones size={20} />
               </button>
            )}
            
            {content.texto_plano_url && (
               <button
                   onClick={() => handleSwitch('text')}
                   title="Modo Lectura Fácil (Accesible)"
                   className={`p-3 rounded-xl transition-all ${currentMode === 'text' ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-indigo-500'}`}
               >
                   <Type size={20} />
               </button>
            )}
        </div>
    );
};

export default ReaderModeSelector;
