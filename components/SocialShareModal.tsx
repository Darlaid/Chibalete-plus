
import React, { useState } from 'react';
import { Facebook, Linkedin, Instagram, X, Copy, Check } from 'lucide-react';
import type { Content, User } from '../types';

interface SocialShareModalProps {
    content: Content;
    user: User;
    onClose: () => void;
}

const SocialShareModal: React.FC<SocialShareModalProps> = ({ content, user, onClose }) => {
    const [comment, setComment] = useState('');
    const [copied, setCopied] = useState(false);

    const connections = user.social_connections || { facebook: false, instagram: false, linkedin: false };
    
    const shareText = `${comment} - Leyendo: "${content.titulo}" en Chibalete+`;
    const shareUrl = window.location.href; // Or specific content URL
    
    const wordCount = comment.trim() === '' ? 0 : comment.trim().split(/\s+/).length;
    const MAX_WORDS = 100;
    const isOverLimit = wordCount > MAX_WORDS;

    const handleFacebookShare = () => {
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`;
        window.open(url, '_blank', 'width=600,height=400');
    };

    const handleLinkedInShare = () => {
        // LinkedIn supports text via the feed endpoint
        const url = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
        window.open(url, '_blank', 'width=600,height=600');
    };

    const handleInstagramShare = () => {
        // Web API doesn't allow direct Instagram posting.
        // We copy text to clipboard and redirect to Instagram.
        navigator.clipboard.writeText(shareText + ' ' + shareUrl);
        setCopied(true);
        setTimeout(() => {
            window.open('https://www.instagram.com/', '_blank');
            setCopied(false);
        }, 1000);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-700">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-indigo-600 text-white">
                    <h3 className="font-bold text-lg">Compartir Lectura</h3>
                    <button onClick={onClose} className="hover:bg-indigo-700 p-1 rounded"><X size={20} /></button>
                </div>

                <div className="p-6">
                    <div className="flex items-center space-x-4 mb-6">
                        <img src={content.portada_url} alt={content.titulo} className="w-16 h-24 object-cover rounded shadow-md" />
                        <div>
                            <p className="font-bold text-gray-900 dark:text-white">{content.titulo}</p>
                            <p className="text-sm text-gray-500">{content.autor}</p>
                        </div>
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300 flex justify-between">
                            <span>Tu comentario:</span>
                            <span className={`text-xs ${isOverLimit ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                {wordCount}/{MAX_WORDS} palabras
                            </span>
                        </label>
                        <textarea 
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Escribe aquí qué te parece este libro..."
                            className={`w-full p-3 rounded-lg border ${isOverLimit ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:ring-indigo-500'} dark:bg-gray-800 resize-none focus:ring-2 outline-none`}
                            rows={3}
                        />
                        {isOverLimit && <p className="text-xs text-red-500 mt-1">Tu comentario es demasiado largo. Por favor, redúcelo a 100 palabras o menos.</p>}
                    </div>

                    <div className="space-y-3">
                        <button 
                            onClick={handleFacebookShare}
                            disabled={!connections.facebook || isOverLimit}
                            className={`w-full flex items-center justify-center py-3 rounded-lg font-bold transition-all ${connections.facebook && !isOverLimit ? 'bg-[#1877F2] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700'}`}
                        >
                            <Facebook className="mr-2" size={20} />
                            {connections.facebook ? 'Compartir en Facebook' : 'Facebook no conectado'}
                        </button>

                        <button 
                            onClick={handleLinkedInShare}
                            disabled={!connections.linkedin || isOverLimit}
                            className={`w-full flex items-center justify-center py-3 rounded-lg font-bold transition-all ${connections.linkedin && !isOverLimit ? 'bg-[#0A66C2] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700'}`}
                        >
                            <Linkedin className="mr-2" size={20} />
                            {connections.linkedin ? 'Compartir en LinkedIn' : 'LinkedIn no conectado'}
                        </button>

                        <div className="relative group">
                            <button 
                                onClick={handleInstagramShare}
                                disabled={!connections.instagram || isOverLimit}
                                className={`w-full flex items-center justify-center py-3 rounded-lg font-bold transition-all ${connections.instagram && !isOverLimit ? 'bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700'}`}
                            >
                                {copied ? <Check className="mr-2" size={20}/> : <Instagram className="mr-2" size={20} />}
                                {connections.instagram ? (copied ? '¡Copiado! Abriendo Instagram...' : 'Copiar y Abrir Instagram') : 'Instagram no conectado'}
                            </button>
                            {connections.instagram && (
                                <p className="text-xs text-center text-gray-500 mt-1">
                                    *Instagram web no permite publicación directa. Copiaremos tu texto para que lo pegues.
                                </p>
                            )}
                        </div>
                    </div>
                    
                    {!connections.facebook && !connections.instagram && !connections.linkedin && (
                         <p className="text-center text-xs text-red-500 mt-4">
                             Conecta tus redes sociales en tu Perfil para compartir.
                         </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SocialShareModal;