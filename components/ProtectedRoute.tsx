import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessAny, isAdmin } from '../utils/permissions';
import type { AnyRole, RouteAccess } from '../utils/permissions';

interface ProtectedRouteProps {
  /**
   * Descriptor explícito de acceso (API canónica — Fase 1G).
   *
   *   { type: 'public' }         → cualquiera, sin sesión
   *   { type: 'authenticated' }  → cualquier usuario con sesión activa
   *   { type: 'roles', roles }   → usuario debe tener al menos uno de estos roles
   *   { type: 'deny' }           → acceso denegado para todos
   *
   * Obtener con getRouteAccess(path) en App.tsx.
   */
  access?: RouteAccess;

  /**
   * @deprecated Usar prop `access` en su lugar.
   * Mantenido temporalmente para compatibilidad con código pre-Fase-1G.
   * Si se provee, se usa como fuente de acceso en lugar de `access`.
   */
  roles?: AnyRole[] | null;

  children: React.ReactNode;
}

/**
 * Resuelve el acceso efectivo a partir de los props recibidos.
 *
 * Prioridad:
 *   1. `roles` (legacy, deprecated) si está presente → derivar RouteAccess equivalente
 *   2. `access` si está presente → usar directamente
 *   3. ninguno → DENY (fail closed — uso incorrecto del guard)
 *
 * POLÍTICA DE SEGURIDAD (Fase 1H):
 *   Si ProtectedRoute se usa sin `access` ni `roles`, el resultado es DENY.
 *   Esto convierte cualquier uso descuidado del guard en un error detectable
 *   en DEV y en un acceso seguro en producción. No existe fallback permisivo.
 */
function resolveAccess(
  access: RouteAccess | undefined,
  roles: AnyRole[] | null | undefined
): RouteAccess {
  // Legacy: roles null → deny
  if (roles === null) return { type: 'deny' };
  // Legacy: roles array → convertir a roles descriptor
  if (roles !== undefined) {
    // roles=[] no tiene sentido: canAccessAny con lista vacía nunca concede acceso.
    // Mejor hacer el error visible que dejar un DENY silencioso.
    if (roles.length === 0) {
      if (import.meta.env.DEV) {
        console.warn(
          '[ProtectedRoute] roles=[] no es un valor válido. ' +
          'Un array vacío siempre deniega acceso. ' +
          'Usa access={getRouteAccess(path)} o define al menos un rol.'
        );
      }
      return { type: 'deny' };
    }
    return { type: 'roles', roles };
  }
  // Nueva API: access descriptor explícito
  if (access !== undefined) return access;
  // Sin props — uso incorrecto del guard → fail closed
  if (import.meta.env.DEV) {
    console.warn(
      '[ProtectedRoute] Usado sin prop `access` ni `roles`. ' +
      'Acceso denegado por defecto (fail closed). ' +
      'Usa access={getRouteAccess(path)} o agrega la ruta a routePermissions.ts.'
    );
  }
  return { type: 'deny' };
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ access, roles, children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  const effectiveAccess = resolveAccess(access, roles);

  // DENY — ruta no registrada o acceso explícitamente denegado.
  // Nadie accede, ni siquiera el administrador. Ocurre antes de verificar sesión
  // para evitar cualquier flash de contenido o redirección costosa.
  if (effectiveAccess.type === 'deny') {
    if (import.meta.env.DEV) {
      console.error(
        `[ProtectedRoute] Acceso denegado en "${location.pathname}". ` +
        `La ruta no está registrada en routePermissions.ts o fue marcada como deny. ` +
        `Agrega una entrada en config/routePermissions.ts.`
      );
    }
    return <Navigate to="/" replace />;
  }

  // PUBLIC — no requiere sesión. Permitir sin más verificaciones.
  // NOTA DE ARQUITECTURA: { type: 'public' } existe en el modelo RouteAccess para
  // que el sistema pueda representar rutas públicas si en el futuro se decide
  // centralizar /bienvenida y /auth bajo ProtectedRoute. Por ahora esas rutas
  // son <Route> sin wrapper y este bloque solo cubre usos explícitos opcionales.
  if (effectiveAccess.type === 'public') {
    return <>{children}</>;
  }

  // Para 'authenticated' y 'roles': necesitamos saber si hay sesión.
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  // Sin usuario o forma inválida → redirigir a bienvenida (preservando destino).
  if (!user || !user.roles || !Array.isArray(user.roles)) {
    return <Navigate to="/bienvenida" state={{ from: location }} replace />;
  }

  // AUTHENTICATED — cualquier usuario con sesión activa.
  if (effectiveAccess.type === 'authenticated') {
    return <>{children}</>;
  }

  // ROLES — verificar con canAccessAny (mediador | administrador según la ruta).
  if (!canAccessAny(user, effectiveAccess.roles)) {
    // Administrador en ruta prohibida → llevar a su dashboard.
    if (isAdmin(user) && location.pathname !== '/admin-dashboard') {
      return <Navigate to="/admin-dashboard" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
