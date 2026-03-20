
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Content } from '../types';
import { ChevronLeft, X, ZoomIn } from 'lucide-react';

const GaleriaIlustraciones: React.FC<{ content: Content }> = ({ content }) => {
    const navigate = useNavigate();
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const images = content.ilustraciones_url || [];

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white">
                <p>Este libro no tiene ilustraciones en la galería.</p>
                <button onClick={() => navigate(`/contenido/${content.id}`)} className="mt-4 text-indigo-400 hover:underline">Volver</button>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-black text-white p-4">
            <header className="flex items-center mb-8">
                <button onClick={() => navigate(`/contenido/${content.id}`)} className="p-2 rounded-full hover:bg-white/20 mr-4">
                    <ChevronLeft size={24} />
                </button>
                <h1 className="text-xl font-bold">Galería: {content.titulo}</h1>
            </header>

            <div className="columns-1 sm:columns-2 md:columns-3 gap-4 max-w-6xl mx-auto space-y-4">
                {images.map((img, idx) => (
                    <div
                        key={idx}
                        className="break-inside-avoid relative group overflow-hidden rounded-lg cursor-pointer border border-gray-800 hover:border-indigo-500 transition-all"
                        onClick={() => setSelectedImage(img)}
                    >
                        <img src={img} alt={`Ilustración ${idx + 1}`} className="w-full h-auto transition-transform duration-500 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <ZoomIn className="text-white drop-shadow-md" size={32} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Lightbox Modal */}
            {selectedImage && (
                <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 animate-in fade-in">
                    <button
                        onClick={() => setSelectedImage(null)}
                        className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/30 rounded-full text-white"
                    >
                        <X size={32} />
                    </button>
                    <img
                        src={selectedImage}
                        alt="Full screen"
                        className="max-w-full max-h-full object-contain shadow-2xl"
                    />
                </div>
            )}
        </div>
    );
};

export default GaleriaIlustraciones;
