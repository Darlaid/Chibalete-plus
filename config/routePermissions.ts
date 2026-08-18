/**
 * config/routePermissions.ts
 *
 * Fuente canónica de permisos de rutas para el frontend de Chibalete+.
 *
 * DISEÑO:
 *   Cada ruta se describe con un nivel de acceso semántico (AccessLevel).
 *   getRouteAccess() en App.tsx convierte ese nivel al tipo discriminado
 *   RouteAccess (de utils/permissions.ts) que consume ProtectedRoute.
 *
 * NIVELES DE ACCESO (AccessLevel):
 *   'public'        → No requiere autenticación.
 *                     Existe en el modelo para poder representar rutas públicas.
 *                     Por ahora /bienvenida y /auth NO usan ProtectedRoute —
 *                     son <Route> directos. Reservado para futura centralización.
 *   'authenticated' → Cualquier usuario con sesión activa
 *   'mediator'      → mediador | administrador
 *   'admin'         → solo administrador
 *
 * DT-05: 'profesor' eliminado del modelo de roles. Era alias legacy de 'mediador'.
 * Historial: /aula-viva, /dashboard/curso, /reportes/curso corregidos en DT-02.
 *
 * Ver: docs/rbac-model.md
 */

import type { AnyRole } from '@/utils/permissions';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Nivel de acceso semántico para una ruta.
 * Renombrado desde 'RouteAccess' (Fase 1G) para evitar colisión con el tipo
 * discriminado RouteAccess de utils/permissions.ts.
 */
export type AccessLevel = 'public' | 'authenticated' | 'mediator' | 'admin';

export interface RoutePermission {
  /** Patrón de ruta. Los segmentos dinámicos usan prefijo ':' (ej. ':id'). */
  path: string;
  access: AccessLevel;
  /** Descripción funcional de la ruta. */
  description: string;
}

// ---------------------------------------------------------------------------
// Resolución de niveles a roles — fuente única de verdad
// ---------------------------------------------------------------------------

/**
 * Devuelve el array de roles concretos para un AccessLevel que requiere roles.
 *
 * FUENTE ÚNICA DE VERDAD para el mapping AccessLevel → roles concretos.
 * Es la única función en el sistema que contiene los arrays de roles por nivel.
 * Cualquier otro componente (App.tsx, getRolesForAccess, tests) debe llamar
 * a esta función — nunca duplicar los arrays inline.
 *
 * Solo acepta los niveles que implican roles ('mediator' | 'admin').
 * Los niveles 'public' y 'authenticated' no tienen roles asociados y no
 * se representan aquí para evitar retornos ambiguos.
 *
 * DT-05: 'profesor' eliminado — rolesForLevel ya no lo incluye.
 * Ver: docs/rbac-model.md
 */
export function rolesForLevel(level: 'mediator' | 'admin'): AnyRole[] {
  // Guard runtime: protege contra casts incorrectos (ej. 'authenticated' as any).
  if (level !== 'mediator' && level !== 'admin') {
    if (import.meta.env.DEV) {
      console.warn(`[rolesForLevel] Nivel inválido recibido: "${level}". Devuelve [].`);
    }
    return [];
  }
  switch (level) {
    case 'mediator':
      return ['mediador', 'administrador'];
    case 'admin':
      return ['administrador'];
  }
}

/**
 * Convierte cualquier AccessLevel al array de roles concretos.
 *
 * @deprecated Preferir getRouteAccess() en App.tsx (devuelve RouteAccess discriminado).
 * Si necesitas los roles en bruto, usa rolesForLevel() directamente.
 *
 * Retorna undefined para 'public' y 'authenticated' (sin restricción de rol).
 */
export function getRolesForAccess(access: AccessLevel): AnyRole[] | undefined {
  if (access === 'mediator' || access === 'admin') return rolesForLevel(access);
  return undefined; // public | authenticated — sin restricción de rol
}

// ---------------------------------------------------------------------------
// Mapa canónico de rutas
// ---------------------------------------------------------------------------

/**
 * Mapa completo de rutas de la aplicación y su AccessLevel.
 * Toda ruta protegida en App.tsx debe tener una entrada aquí.
 * Si una ruta no está registrada, getRouteAccess() devuelve { type: 'deny' }.
 */
export const ROUTE_PERMISSIONS: RoutePermission[] = [
  // --- Públicas (sin sesión) ---
  {
    path: '/bienvenida',
    access: 'public',
    description: 'Pantalla de inicio / landing para usuarios no autenticados',
  },
  {
    path: '/auth',
    access: 'public',
    description: 'Login y registro',
  },

  // --- Acceso general (cualquier usuario autenticado) ---
  {
    path: '/',
    access: 'authenticated',
    description: 'Home — feed principal del lector',
  },
  {
    path: '/biblioteca',
    access: 'authenticated',
    description: 'Catálogo de libros accesibles para el usuario',
  },
  {
    path: '/experiencias',
    access: 'authenticated',
    description: 'Experiencias — rutas pedagógicas (CHP-MOOK-01, piloto)',
  },
  {
    path: '/multimedia',
    access: 'authenticated',
    description: 'Contenido multimedia (audio, video)',
  },
  {
    path: '/trivia',
    access: 'authenticated',
    description: 'Minijuego de trivia de lectura',
  },
  {
    path: '/tienda',
    access: 'authenticated',
    description: 'Canje de puntos por recompensas',
  },
  {
    path: '/bitacora',
    access: 'authenticated',
    description: 'Bitácora personal de lectura del usuario',
  },
  {
    path: '/buscar',
    access: 'authenticated',
    description: 'Búsqueda de contenido',
  },
  {
    path: '/perfil/:id',
    access: 'authenticated',
    description: 'Perfil de usuario (propio o ajeno)',
  },
  {
    path: '/soporte',
    access: 'authenticated',
    description: 'Página de soporte y ayuda',
  },
  {
    path: '/chibalete-lu',
    access: 'authenticated',
    description: 'Descarga e información de Chibalete LU (app Android liviana) — disponible para todos los usuarios autenticados',
  },
  {
    path: '/clubs',
    access: 'authenticated',
    description: 'Listado de clubes de lectura',
  },
  {
    path: '/clubs/:id',
    access: 'authenticated',
    description: 'Detalle de club externo',
  },
  {
    path: '/aula-viva',
    access: 'authenticated',
    description: 'Aula Viva — vista de grupos para lectores y mediadores',
  },
  {
    path: '/contenido/:id',
    access: 'authenticated',
    description: 'Hub de detalle de contenido (delega acceso real al AccessWrapper)',
  },
  {
    path: '/leer/pdf/:id',
    access: 'authenticated',
    description: 'Visor PDF',
  },
  {
    path: '/leer/texto/:id',
    access: 'authenticated',
    description: 'Visor de texto con TTS',
  },
  {
    path: '/leer/inmersivo/:id',
    access: 'authenticated',
    description: 'Visor inmersivo accesible',
  },
  {
    path: '/leer/accesible/:id',
    access: 'authenticated',
    description: 'Modo Accesible (mode=a11y) — visor con AccessWrapper, paridad con PDF/Texto/Álbum',
  },
  {
    path: '/ver/album/:id',
    access: 'authenticated',
    description: 'Visor de libro-álbum guiado',
  },
  {
    path: '/galeria/:id',
    access: 'authenticated',
    description: 'Galería de ilustraciones',
  },

  // --- Acceso de mediador (mediador | administrador) ---
  {
    path: '/dashboard/curso/:courseId',
    access: 'mediator',
    description: 'Dashboard pedagógico de un grupo/curso específico',
  },
  {
    path: '/reportes/curso/:id',
    access: 'mediator',
    description: 'Informe de lectura por curso',
  },
  {
    path: '/subir-contenido',
    access: 'admin',
    description: 'Subida y gestión de contenido educativo',
  },

  // --- Acceso exclusivo de administrador ---
  {
    path: '/admin-dashboard',
    access: 'admin',
    description: 'Panel de administración general',
  },
  {
    path: '/admin/metricas',
    access: 'admin',
    description: 'Dashboard de métricas de lectura a nivel institución',
  },
  {
    path: '/reportes/colegio/:id',
    access: 'admin',
    description: 'Informe de lectura a nivel de colegio',
  },
  {
    path: '/admin/usuarios',
    access: 'admin',
    description: 'Gestión de usuarios de la institución',
  },
  {
    path: '/admin/productos',
    access: 'admin',
    description: 'Gestión de productos de la tienda',
  },
  {
    path: '/admin/recompensas',
    access: 'admin',
    description: 'Configuración de recompensas y canje',
  },
  {
    path: '/admin/experiencias',
    access: 'admin',
    description: 'Gestión de experiencias gamificadas',
  },
];

// ---------------------------------------------------------------------------
// Helpers de consulta
// ---------------------------------------------------------------------------

/**
 * Busca la configuración de permisos de una ruta dada.
 * Maneja segmentos dinámicos (:param) comparando por estructura.
 *
 * @example
 * getRoutePermission('/admin/usuarios') // { path: '/admin/usuarios', access: 'admin', ... }
 * getRoutePermission('/dashboard/curso/abc123') // { path: '/dashboard/curso/:courseId', ... }
 */
export function getRoutePermission(pathname: string): RoutePermission | undefined {
  // Primero: coincidencia exacta (más frecuente, más rápida)
  const exact = ROUTE_PERMISSIONS.find(r => r.path === pathname);
  if (exact) return exact;

  // Segundo: coincidencia con patrones dinámicos
  return ROUTE_PERMISSIONS.find(r => matchesPattern(r.path, pathname));
}

/**
 * Comprueba si un pathname concreto coincide con un patrón de ruta.
 * Los segmentos que empiezan con ':' se aceptan como comodín.
 *
 * @example
 * matchesPattern('/dashboard/curso/:courseId', '/dashboard/curso/abc') // true
 * matchesPattern('/admin/usuarios', '/admin/usuarios')                 // true
 * matchesPattern('/admin/usuarios', '/admin/productos')                // false
 */
function matchesPattern(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every(
    (segment, i) => segment.startsWith(':') || segment === pathParts[i]
  );
}
