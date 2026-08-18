
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
import { getRoutePermission, rolesForLevel } from './config/routePermissions';
import type { RouteAccess } from './utils/permissions';

// Eager loading for critical initial pages
import Bienvenida from './pages/Bienvenida';
import Auth from './pages/Auth';
import Home from './pages/Home';

/**
 * Convierte el path de una ruta al descriptor explícito de acceso RouteAccess.
 *
 * Consulta routePermissions.ts (fuente única de verdad) y mapea el AccessLevel
 * semántico al tipo discriminado RouteAccess que consume ProtectedRoute.
 *
 * Retornos posibles:
 *   { type: 'public' }         → ruta pública (sin sesión requerida)
 *   { type: 'authenticated' }  → cualquier usuario con sesión activa
 *   { type: 'roles', roles }   → usuario debe tener al menos uno de estos roles
 *   { type: 'deny' }           → ruta no registrada → acceso denegado (Fase 1F.2)
 *
 * Política de seguridad:
 *   Una ruta no registrada en routePermissions.ts NUNCA queda silenciosamente
 *   abierta. Siempre produce { type: 'deny' } + warning en DEV.
 */
function getRouteAccess(path: string): RouteAccess {
  const permission = getRoutePermission(path);

  if (!permission) {
    if (import.meta.env.DEV) {
      console.warn(
        `[routePermissions] Ruta no registrada: "${path}". ` +
        `Acceso denegado por defecto. Agrégala a config/routePermissions.ts.`
      );
    }
    return { type: 'deny' };
  }

  switch (permission.access) {
    case 'public':        return { type: 'public' };
    case 'authenticated': return { type: 'authenticated' };
    case 'mediator':      return { type: 'roles', roles: rolesForLevel('mediator') };
    case 'admin':         return { type: 'roles', roles: rolesForLevel('admin') };
    default: {
      // Protege contra futuros AccessLevel añadidos al enum sin actualizar este switch.
      const exhaustive: never = permission.access;
      if (import.meta.env.DEV) {
        console.warn(`[getRouteAccess] AccessLevel no reconocido: "${exhaustive}". Acceso denegado.`);
      }
      return { type: 'deny' };
    }
  }
}

// Lazy loading for heavy or role-specific components
const Biblioteca = React.lazy(() => import('./pages/Biblioteca'));
const Experiencias = React.lazy(() => import('./pages/Experiencias'));
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
// PASO 5 — centro operativo pedagógico longitudinal (ruta paralela, no
// reemplaza ./pages/AulaViva existente).
const AulaVivaOperacional = React.lazy(() => import('./pages/AulaVivaOperacional'));
const VisorPDF = React.lazy(() => import('./pages/VisorPDF'));
const VisorTexto = React.lazy(() => import('./pages/VisorTexto'));
const VisorInmersivo = React.lazy(() => import('./pages/VisorInmersivo'));
const VisorAlbum = React.lazy(() => import('./pages/VisorAlbum'));
// Modo Accesible (mode='a11y') — Fase 0 hardening: protegido con ProtectedRoute + AccessWrapper.
const VisorAccesible = React.lazy(() => import('./pages/VisorAccesible'));
const GaleriaIlustraciones = React.lazy(() => import('./components/GaleriaIlustraciones'));
const Bitacora = React.lazy(() => import('./pages/Bitacora'));
const AdminProductos = React.lazy(() => import('./pages/AdminProductos'));
const AdminRecompensas = React.lazy(() => import('./pages/AdminRecompensas'));
const AdminExperiencias = React.lazy(() => import('./pages/AdminExperiencias'));
const Clubs = React.lazy(() => import('./pages/Clubs'));
const ClubExterno = React.lazy(() => import('./pages/ClubExterno'));
const DashboardMediador = React.lazy(() => import('./pages/DashboardMediador'));
const DashboardAdminLectura = React.lazy(() => import('./pages/DashboardAdminLectura'));
const InformeVisor = React.lazy(() => import('./pages/InformeVisor'));
const ActivarCuenta = React.lazy(() => import('./pages/ActivarCuenta'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const ChibaleteLU = React.lazy(() => import('./pages/ChibaleteLU'));



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
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">No tienes acceso a este contenido</h1>
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

// --- UX-3B: Pantalla de error técnico de acceso (con reintentar) ---
//
// Distinta de AccessDeniedView: aquí el usuario probablemente SÍ tiene
// acceso, pero el server no pudo verificarlo (5xx, red caída, sesión).
// Ofrecer reintentar es la acción correcta — no enviar al usuario "atrás"
// a navegar otra vez como si no tuviera permisos. Soporte agradece.
const AccessErrorView: React.FC<{ reason?: string; onRetry: () => void }> = ({ reason, onRetry }) => {
    const navigate = useNavigate();
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-8 text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">No pudimos verificar tu acceso</h1>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm">
                {reason || 'Hubo un problema temporal al verificar tu acceso. Intenta de nuevo.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
                <button
                    onClick={onRetry}
                    className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow"
                >
                    Reintentar
                </button>
                <button
                    onClick={() => navigate(-1)}
                    className="px-5 py-2 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-100 font-medium rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors"
                >
                    ← Volver
                </button>
            </div>
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

    // UX-3B — diferenciamos denegación (no tienes acceso) de error técnico
    // (no pudimos verificar). Esta última ofrece "Reintentar"; la primera no.
    if (access.status === 'denied') {
        return <AccessDeniedView reason={access.reason} />;
    }
    if (access.status === 'error') {
        return <AccessErrorView reason={access.reason} onRetry={access.retry} />;
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

// ImmersiveWrapper bypasses the blocking AccessWrapper intentionally.
// VisorInmersivo renders Phase 0 (shell + placeholder) immediately, then runs
// the access check in the background and shows a soft denial overlay if needed.
const ImmersiveWrapper = () => {
    const { id } = useParams();
    const content = dataService.getContenidoById(id || '');
    if (!content) return <Navigate to="/" replace />;
    return <VisorInmersivo content={content} />;
};

// ═══════════════════════════════════════════════════════════════════════════
// DEV ONLY — NO PROD ROUTE
// ═══════════════════════════════════════════════════════════════════════════
//
// Sprint Inmersivo V2 / Fase M-4 — smoke local manual obligatorio.
//
// Este wrapper monta `VisorInmersivoV2` (runtime nuevo) en una ruta paralela
// `/visor-v2-local/:id` que NO sustituye la ruta productiva
// `/leer/inmersivo/:id` (esa sigue montando V1).
//
// Doble guard:
//   1. localStorage.IMMERSIVE_RUNTIME === 'v2-local'
//      Sin esto, muestra instrucciones; NO renderiza el viewer V2.
//   2. La ruta misma vive bajo path local-only y no aparece en menús.
//
// REGLAS:
//   - NO commitear este bloque a producción.
//   - NO mergear a main mientras V1 sea la ruta canónica.
//   - Diff localizado intencionalmente para revertir trivialmente
//     (eliminar este bloque + la <Route> de abajo + el lazy import).
//
// Para activar smoke local:
//   1. localStorage.setItem('IMMERSIVE_RUNTIME', 'v2-local')
//   2. (opcional) window.__IMMERSIVE_V2_DEBUG__ = true
//   3. Visitar http://localhost:5173/#/visor-v2-local/<contentId>
//
// Para desactivar:
//   localStorage.removeItem('IMMERSIVE_RUNTIME')
// ═══════════════════════════════════════════════════════════════════════════
const VisorInmersivoV2 = React.lazy(() => import('./pages/VisorInmersivoV2'));

const ImmersiveV2LocalWrapper = () => {
    const { id } = useParams();
    const flagOk = typeof window !== 'undefined'
        && window.localStorage?.getItem('IMMERSIVE_RUNTIME') === 'v2-local';
    if (!flagOk) {
        return (
            <div style={{ padding: 40, fontFamily: 'monospace', color: '#222', background: '#fff' }}>
                <h1 style={{ fontSize: 24, marginBottom: 16 }}>Visor V2 — bloqueado (DEV ONLY)</h1>
                <p style={{ marginBottom: 12 }}>Este viewer es smoke local. Activá con:</p>
                <pre style={{ background: '#f4f4f4', padding: 12, borderRadius: 4 }}>
{`localStorage.setItem('IMMERSIVE_RUNTIME', 'v2-local')
location.reload()`}
                </pre>
                <p style={{ marginTop: 16 }}>Para diagnostics panel adicional:</p>
                <pre style={{ background: '#f4f4f4', padding: 12, borderRadius: 4 }}>
{`window.__IMMERSIVE_V2_DEBUG__ = true`}
                </pre>
                <p style={{ marginTop: 24, color: '#888' }}>
                    V1 sigue siendo la ruta productiva: <code>/leer/inmersivo/:id</code>
                </p>
            </div>
        );
    }
    const content = dataService.getContenidoById(id || '');
    if (!content) return <Navigate to="/" replace />;
    return (
        <Suspense fallback={<LoadingSpinner />}>
            <VisorInmersivoV2 content={content} />
        </Suspense>
    );
};
// ═══════════════════════════════════════════════════════════════════════════
// END DEV ONLY block
// ═══════════════════════════════════════════════════════════════════════════

const AlbumWrapper = () => (
    <AccessWrapper>{(content) => <VisorAlbum content={content} />}</AccessWrapper>
);

// Modo Accesible: replica el patrón bloqueante de PDF/Texto/Álbum.
// El visor NUNCA renderiza contenido si el servidor no autoriza.
const AccesibleWrapper = () => (
    <AccessWrapper>{(content) => <VisorAccesible content={content} />}</AccessWrapper>
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
                <Route path="/activar" element={<ActivarCuenta />} />
                <Route path="/reset-password" element={<ResetPassword />} />

                {/* Protected Routes — todos los accesos pasan por getRouteAccess() → routePermissions.ts */}
                <Route path="/" element={
                    <ProtectedRoute access={getRouteAccess('/')}><Layout><Home /></Layout></ProtectedRoute>
                } />
                <Route path="/experiencias" element={
                    <ProtectedRoute access={getRouteAccess('/experiencias')}><Layout><Experiencias /></Layout></ProtectedRoute>
                } />
                <Route path="/biblioteca" element={
                    <ProtectedRoute access={getRouteAccess('/biblioteca')}><Layout><Biblioteca /></Layout></ProtectedRoute>
                } />
                <Route path="/multimedia" element={
                    <ProtectedRoute access={getRouteAccess('/multimedia')}><Layout><Multimedia /></Layout></ProtectedRoute>
                } />
                <Route path="/trivia" element={
                    <ProtectedRoute access={getRouteAccess('/trivia')}><Layout><Trivia /></Layout></ProtectedRoute>
                } />
                <Route path="/tienda" element={
                    <ProtectedRoute access={getRouteAccess('/tienda')}><Layout><Tienda /></Layout></ProtectedRoute>
                } />
                <Route path="/bitacora" element={
                    <ProtectedRoute access={getRouteAccess('/bitacora')}><Layout><Bitacora /></Layout></ProtectedRoute>
                } />
                <Route path="/buscar" element={
                    <ProtectedRoute access={getRouteAccess('/buscar')}><Layout><Busqueda /></Layout></ProtectedRoute>
                } />
                <Route path="/perfil/:id" element={
                    <ProtectedRoute access={getRouteAccess('/perfil/:id')}><Layout><Perfil /></Layout></ProtectedRoute>
                } />

                <Route path="/soporte" element={
                    <ProtectedRoute access={getRouteAccess('/soporte')}><Layout><Soporte /></Layout></ProtectedRoute>
                } />
                <Route path="/chibalete-lu" element={
                    <ProtectedRoute access={getRouteAccess('/chibalete-lu')}><Layout><ChibaleteLU /></Layout></ProtectedRoute>
                } />

                {/* Clubes Externos */}
                <Route path="/clubs" element={
                    <ProtectedRoute access={getRouteAccess('/clubs')}><Layout><Clubs /></Layout></ProtectedRoute>
                } />
                <Route path="/clubs/:id" element={
                    <ProtectedRoute access={getRouteAccess('/clubs/:id')}><Layout><ClubExterno /></Layout></ProtectedRoute>
                } />

                {/* Aula Viva — cualquier usuario autenticado (lector, mediador, admin) */}
                <Route path="/aula-viva" element={
                    <ProtectedRoute access={getRouteAccess('/aula-viva')}><Layout><AulaViva /></Layout></ProtectedRoute>
                } />
                {/* PASO 5 — Centro operativo Aula Viva. Reusa el access check de /aula-viva. */}
                <Route path="/aula-viva/operacional" element={
                    <ProtectedRoute access={getRouteAccess('/aula-viva')}><Layout><AulaVivaOperacional /></Layout></ProtectedRoute>
                } />

                {/* Mediator Course Dashboard */}
                <Route path="/dashboard/curso/:courseId" element={
                    <ProtectedRoute access={getRouteAccess('/dashboard/curso/:courseId')}><Layout><DashboardMediador /></Layout></ProtectedRoute>
                } />

                {/* Admin Dashboard */}
                <Route path="/admin-dashboard" element={
                    <ProtectedRoute access={getRouteAccess('/admin-dashboard')}><Layout><AdminDashboard /></Layout></ProtectedRoute>
                } />

                {/* Admin Reading Metrics Dashboard */}
                <Route path="/admin/metricas" element={
                    <ProtectedRoute access={getRouteAccess('/admin/metricas')}><Layout><DashboardAdminLectura /></Layout></ProtectedRoute>
                } />

                {/* Report Views */}
                <Route path="/reportes/curso/:id" element={
                    <ProtectedRoute access={getRouteAccess('/reportes/curso/:id')}><Layout><InformeVisor type="course" /></Layout></ProtectedRoute>
                } />
                <Route path="/reportes/colegio/:id" element={
                    <ProtectedRoute access={getRouteAccess('/reportes/colegio/:id')}><Layout><InformeVisor type="school" /></Layout></ProtectedRoute>
                } />

                {/* Content Detail Hub */}
                <Route path="/contenido/:id" element={
                    <ProtectedRoute access={getRouteAccess('/contenido/:id')}><ContentRouter /></ProtectedRoute>
                } />

                {/* Specific Reading Modes */}
                <Route path="/leer/pdf/:id" element={
                    <ProtectedRoute access={getRouteAccess('/leer/pdf/:id')}><PDFWrapper /></ProtectedRoute>
                } />
                <Route path="/leer/texto/:id" element={
                    <ProtectedRoute access={getRouteAccess('/leer/texto/:id')}><TextWrapper /></ProtectedRoute>
                } />
                <Route path="/leer/inmersivo/:id" element={
                    <ProtectedRoute access={getRouteAccess('/leer/inmersivo/:id')}><ImmersiveWrapper /></ProtectedRoute>
                } />
                {/* DEV ONLY — NO PROD ROUTE — Sprint Inmersivo V2 / Fase M-4 smoke local.
                    El acceso requiere localStorage.IMMERSIVE_RUNTIME==='v2-local'.
                    Sin guard, el wrapper muestra instrucciones y NO renderiza V2.
                    Eliminar esta Route + el wrapper + el lazy import al cerrar M-4. */}
                <Route path="/visor-v2-local/:id" element={
                    <ProtectedRoute access={getRouteAccess('/leer/inmersivo/:id')}><ImmersiveV2LocalWrapper /></ProtectedRoute>
                } />
                <Route path="/leer/accesible/:id" element={
                    <ProtectedRoute access={getRouteAccess('/leer/accesible/:id')}><AccesibleWrapper /></ProtectedRoute>
                } />
                <Route path="/ver/album/:id" element={
                    <ProtectedRoute access={getRouteAccess('/ver/album/:id')}><AlbumWrapper /></ProtectedRoute>
                } />
                <Route path="/galeria/:id" element={
                    <ProtectedRoute access={getRouteAccess('/galeria/:id')}><GalleryWrapper /></ProtectedRoute>
                } />

                <Route path="/subir-contenido" element={
                    <ProtectedRoute access={getRouteAccess('/subir-contenido')}><Layout><SubirContenido /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/usuarios" element={
                    <ProtectedRoute access={getRouteAccess('/admin/usuarios')}><Layout><AdminUsuarios /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/productos" element={
                    <ProtectedRoute access={getRouteAccess('/admin/productos')}><Layout><AdminProductos /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/recompensas" element={
                    <ProtectedRoute access={getRouteAccess('/admin/recompensas')}><Layout><AdminRecompensas /></Layout></ProtectedRoute>
                } />
                <Route path="/admin/experiencias" element={
                    <ProtectedRoute access={getRouteAccess('/admin/experiencias')}><Layout><AdminExperiencias /></Layout></ProtectedRoute>
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
