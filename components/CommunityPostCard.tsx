
import React, { useState } from 'react';
import type { CommunityPost } from '../types';
import { User, Star, BookOpen, Users, Heart } from 'lucide-react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';

interface CommunityPostCardProps {
    post: CommunityPost;
}

const CommunityPostCard: React.FC<CommunityPostCardProps> = ({ post }) => {
    const { user } = useAuth();
    const [userRating, setUserRating] = useState(0);
    const [hasRated, setHasRated] = useState(false);
    const [currentAvg, setCurrentAvg] = useState(post.calificacion_comunidad);
    const [isSaved, setIsSaved] = useState(user?.saved_posts?.includes(post.id) || false);

    const handleRate = (rating: number) => {
        if (hasRated) return;
        dataService.rateCommunityPost(post.id, rating);
        setHasRated(true);
        setUserRating(rating);
        // Optimistic update for UI
        const newAvg = ((post.calificacion_comunidad * post.votos) + rating) / (post.votos + 1);
        setCurrentAvg(newAvg);
    };

    const handleToggleSave = () => {
        if (!user) return;
        const newState = dataService.toggleSavedPost(user.id, post.id);
        setIsSaved(newState);
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 mb-4 transition-transform hover:scale-[1.01] min-w-[300px]">
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                    <img src={post.autor_avatar} alt={post.autor_nombre} className="w-10 h-10 rounded-full mr-3 object-cover" />
                    <div>
                        <p className="font-bold text-gray-900 dark:text-white">{post.autor_nombre}</p>
                        <p className="text-xs text-gray-500">
                            {new Date(post.fecha).toLocaleDateString()} • 
                            {post.tipo === 'resena' ? ' Reseña Literaria' : ' Club de Lectura'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full">
                        <Star size={14} className="text-yellow-500 mr-1 fill-current" />
                        <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{currentAvg.toFixed(1)}</span>
                    </div>
                    {user && (
                        <button 
                            onClick={handleToggleSave}
                            className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${isSaved ? 'text-red-500' : 'text-gray-400'}`}
                            title={isSaved ? "Quitar de mis reseñas guardadas" : "Guardar en mi anaquel"}
                        >
                            <Heart size={20} className={isSaved ? "fill-current" : ""} />
                        </button>
                    )}
                </div>
            </div>

            <div className="mb-4">
                {post.tipo === 'resena' && post.libro_titulo && (
                    <div className="flex items-center text-sm text-indigo-600 dark:text-indigo-400 mb-2 font-semibold">
                        <BookOpen size={16} className="mr-2"/> Sobre: "{post.libro_titulo}"
                    </div>
                )}
                {post.tipo === 'club' && post.club_nombre && (
                    <div className="flex items-center text-sm text-purple-600 dark:text-purple-400 mb-2 font-semibold">
                        <Users size={16} className="mr-2"/> {post.club_nombre}
                    </div>
                )}
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line line-clamp-4">
                    {post.contenido}
                </p>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <span className="text-xs text-gray-500">¿Te resultó útil?</span>
                <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(star => (
                        <button
                            key={star}
                            onClick={() => handleRate(star)}
                            disabled={hasRated}
                            className={`p-1 transition-colors ${hasRated ? 'cursor-default' : 'hover:scale-110'}`}
                        >
                            <Star 
                                size={18} 
                                className={`${
                                    (hasRated ? userRating : 0) >= star 
                                    ? 'text-yellow-400 fill-current' 
                                    : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
                                }`} 
                            />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CommunityPostCard;
