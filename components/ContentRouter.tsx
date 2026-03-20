
import React from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { useAccessCheck } from '../hooks/useAccessCheck';
import PaginaDetalleLibro from '../pages/PaginaDetalleLibro';
import VisorAudio from '../pages/VisorAudio';
import VisorVideo from '../pages/VisorVideo';

const ContentRouter: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const navigate = useNavigate();
    const access = useAccessCheck(id || '', user?.id);

    if (!id) {
        return <div className="p-4">Cargando contenido...</div>;
    }

    const content = dataService.getContenidoById(id);

    if (!content) {
        return <Navigate to="/" replace />;
    }

    // --- Fase Hardening E2: Preflight de acceso (micro-parche) ---
    // Spinner neutro mientras el servidor emite el veredicto
    if (access.status === 'checking') {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto mb-4" />
                    <p className="text-sm text-gray-400">Verificando acceso…</p>
                </div>
            </div>
        );
    }

    // Acceso denegado o error de red → vista segura sin revelar contenido
    if (access.status === 'denied' || access.status === 'error') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-8 text-center">
                <div className="text-6xl mb-4">🔒</div>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Acceso no autorizado</h1>
                <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm">
                    {access.reason || 'No tienes permiso para acceder a este contenido con tu cuenta actual.'}
                </p>
                <button
                    onClick={() => navigate(-1)}
                    className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow"
                >
                    ← Volver
                </button>
            </div>
        );
    }

    // Acceso concedido → despachar al visor correcto según tipo
    switch (content.tipo) {
        case 'libro':
        case 'libro_album':
        case 'articulo_pedagogico':
        case 'guia':
            return <PaginaDetalleLibro content={content} />;
        case 'podcast':
            return <VisorAudio content={content} />;
        case 'video':
            return <VisorVideo content={content} />;
        default:
            return <div className="p-4">Tipo de contenido no soportado.</div>;
    }
};

export default ContentRouter;
