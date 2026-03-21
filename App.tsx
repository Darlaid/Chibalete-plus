
import React, { Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OfflineProvider, useOffline } from './context/OfflineContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import ContentRouter from './components/ContentRouter';
import { dataService } from './services/dataService';
import { useAccessCheck } from './hooks/useAccessCheck';

// Eager loading for critical initial pages
import Bienvenida from './pages/Bienvenida';
import Auth from './pages/Auth';
import Home from './pages/Home';

// Lazy loading for heavy or role-specific components
const Biblioteca = React.lazy(() => import('./pages/Biblioteca'));
const Multimedia = React.lazy(() => import('./pages/Multimedia'));
const Busqueda = React.lazy(() => import('./pages/Busqueda'));
const Perfil = React.lazy(() => import('./pages/Perfil'));

const Soporte = React.lazy(() => import('./pages/Soporte'));
const Tienda = React.lazy(() => import('./pages/Tienda'));
const Trivia = React.lazy(() => import('./pages/Trivia'));
const SubirContenido = React.lazy(() => import('./pages/SubirContenido'));
const AdminUsuarios = React.lazy(() => import('./pages/AdminUsuarios'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const AulaViva = React.lazy(() => import('./pages/AulaViva'));
const VisorPDF = React.lazy(() => import('./pages/VisorPDF'));
const VisorTexto = React.lazy(() => import('./pages/VisorTexto'));
const VisorInmersivo = React.lazy(() => import('./pages/VisorInmersivo'));
const VisorAlbum = React.lazy(() => import('./pages/VisorAlbum'));
const GaleriaIlustraciones = React.lazy(() => import('./components/GaleriaIlustraciones'));
const Bitacora = React.lazy(() => import('./pages/Bitacora'));
const AdminProductos = React.lazy(() => import('./pages/AdminProductos'));
const AdminRecompensas = React.lazy(() => import('./pages/AdminRecompensas'));
const AdminExperiencias = React.lazy(() => import('./pages/AdminExperiencias'));



const LoadingSpinner: React.FC = () => (
    <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-indigo-500"></div>
    </div>
);


const getFriendlyReason = (rawReason?: string): string => {
    if (!rawReason) return 'Este contenido no está disponible en tu acceso actual.';
    
    const lower = rawReason.toLowerCase();
    
    if (lower.includes('expirad') || lower.includes('expired')) {
        return 'Tu acceso a este contenido ha expirado.';
    }
    if (lower.includes('política restrictiva') || lower.includes('fuera de tu catálogo') || lower.includes('bloqueado por reglas')) {
        return 'Este contenido no hace parte de tus libros habilitados.';
    }
    if (lower.includes('sesión') || lower.includes('usuario no encontrado')) {
        return 'Debes iniciar sesión para ver este contenido.';
    }
    if (lower.includes('error') || lower.includes('servidor')) {
        return 'Hubo un problema al verificar tu acceso. Intenta nuevamente.';
    }
    
    // Fallback si el backend manda algo nuevo
    return 'Este contenido no está disponible en tu acceso actual.';
};

// --- Fase Hardening E2: Pantalla de acceso denegado (vista segura) ---
const AccessDeniedView: React.FC<{ reason?: string }> = ({ reason }) => {
    const navigate = useNavigate();
    const friendlyMessage = getFriendlyReason(reason);
    
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-8 text-center">
            <div className="text-6xl mb-4">🔒</div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Acceso no autorizado</h1>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm">
                {friendlyMessage}
            </p>
            <button
                onClick={() => navigate(-1)}
                className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow"
            >
                ← Volver
            </button>
        </div>
    );
};

// --- Fase Hardening E2: AccessWrapper unificado ---
// Componente HOC que hace preflight real antes de pasar el contenido al visor.
// El visor NUNCA se renderiza si el servidor no autoriza.
const AccessWrapper: React.FC<{ children: (content: import('./types').Content) => React.ReactNode }> = ({ children }) => {
    const { id } = useParams();
    const { user } = useAuth();
    const content = dataService.getContenidoById(id || '');
    const access = useAccessCheck(id || '', user?.id);

    // Contenido no encontrado en caché local → redirigir sin revelar nada
    if (!content) return <Navigate to="/" replace />;

    // Esperando veredicto del servidor → mostrar spinner neutro
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

    // Acceso denegado o error de servidor → vista segura, sin revelar el contenido
    if (access.status === 'denied' || access.status === 'error') {
        return <AccessDeniedView reason={access.reason} />;
    }

    // Acceso concedido por el servidor → renderizar el visor
    return <>{children(content)}</>;
};

// Wrappers específicos por tipo de visor — solo configuran qué componente renderizar
const PDFWrapper = () => (
    <AccessWrapper>{(content) => <VisorPDF content={content} />}</AccessWrapper>
);

const TextWrapper = () => (
    <AccessWrapper>{(content) => <VisorTexto content={content} />}</AccessWrapper>
);

const ImmersiveWrapper = () => (
    <AccessWrapper>{(content) => <VisorInmersivo content={content} />}</AccessWrapper>
);

const AlbumWrapper = () => (
    <AccessWrapper>{(content) => <VisorAlbum content={content} />}</AccessWrapper>
);

const GalleryWrapper = () => (
    <AccessWrapper>{(content) => <GaleriaIlustraciones content={content} />}</AccessWrapper>
);

const AppContent: React.FC = () => {
    const { user, isLoading: isAuthLoading } = useAuth();
    const { isLoading: isOfflineLoading } = useOffline();

    if (isAuthLoading || isOfflineLoading) {
        return <LoadingSpinner />;
    }

    return (
        <Suspense fallback={<LoadingSpinner />}>
            <Routes>
                <Route path="/bienvenida" element={<Bienvenida />} />
                <Route path="/auth" element={<Auth />} />



                {/* Protected Routes */}
                <Route path="/" element={
                    <ProtectedRoute><Layout><Home /></Layout></ProtectedRoute>
                } />
                <Route path="/biblioteca" element={
                    <ProtectedRoute><Layout><Biblioteca /></Layout></ProtectedRoute>
                } />
                <Route path="/multimedia" element={
                    <ProtectedRoute><Layout><Multimedia /></Layout></ProtectedRoute>
                } />
                <Route path="/trivia" element={
                    <ProtectedRoute><Layout><Trivia /></Layout></ProtectedRoute>
                } />
                <Route path="/tienda" element={
                    <ProtectedRoute><Layout><Tienda /></Layout></ProtectedRoute>
                } />
                <Route path="/bitacora" element={
                    <ProtectedRoute><Layout><Bitacora /></Layout></ProtectedRoute>
                } />
                <Route path="/buscar" element={
                    <ProtectedRoute><Layout><Busqueda /></Layout></ProtectedRoute>
                } />
                <Route path="/perfil/:id" element={
                    <ProtectedRoute><Layout><Perfil /></Layout></ProtectedRoute>
                } />

                <Route path="/soporte" element={
                    <ProtectedRoute><Layout><Soporte /></Layout></ProtectedRoute>
                } />

                {/* Aula Viva for Teachers/Admins AND Students */}
                <Route path="/aula-viva" element={
                    <ProtectedRoute roles={['profesor', 'administrador', 'lector']}><Layout><AulaViva /></Layout></ProtectedRoute>
                } />

                {/* Admin Dashboard */}
                <Route path="/admin-dashboard" element={
                    <ProtectedRoute roles={['administrador']}><Layout><AdminDashboard /></Layout></ProtectedRoute>
                } />

                {/* Content Detail Hub */}
                <Route path="/contenido/:id" element={
                    <ProtectedRoute><ContentRouter /></ProtectedRoute>
                } />

                {/* Specific Reading Modes */}
                <Route path="/leer/pdf/:id" element={
                    <ProtectedRoute><PDFWrapper /></ProtectedRoute>
                } />
                <Route path="/leer/texto/:id" element={
                    <ProtectedRoute><TextWrapper /></ProtectedRoute>
                } />
                <Route path="/leer/inmersivo/:id" element={
                    <ProtectedRoute><ImmersiveWrapper /></ProtectedRoute>
                } />
                <Route path="/ver/album/:id" element={
                    <ProtectedRoute><AlbumWrapper /></ProtectedRoute>
                } />
                <Route path="/galeria/:id" element={
                    <ProtectedRoute><GalleryWrapper /></ProtectedRoute>
                } />

                <Route path="/subir-contenido" element={
                    <ProtectedRoute roles={['administrador', 'profesor', 'mediador']}><Layout><SubirContenido /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/usuarios" element={
                    <ProtectedRoute roles={['administrador']}><Layout><AdminUsuarios /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/productos" element={
                    <ProtectedRoute roles={['administrador']}><Layout><AdminProductos /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/recompensas" element={
                    <ProtectedRoute roles={['administrador']}><Layout><AdminRecompensas /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/experiencias" element={
                    <ProtectedRoute roles={['administrador']}><Layout><AdminExperiencias /></Layout></ProtectedRoute>
                } />

                {/* Fallback route */}
                <Route path="*" element={<Navigate to={user ? "/" : "/bienvenida"} replace />} />
            </Routes>
        </Suspense>
    );
};

const App: React.FC = () => {
    return (
        <AuthProvider>
            <OfflineProvider>
                <ErrorBoundary>
                    <HashRouter>
                        <AppContent />
                    </HashRouter>
                </ErrorBoundary>
            </OfflineProvider>
        </AuthProvider>
    );
};

export default App;
