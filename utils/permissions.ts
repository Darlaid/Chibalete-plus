/**
 * utils/permissions.ts
 *
 * Helpers canónicos para evaluar roles de usuario en Chibalete+.
 *
 * MODELO DE ROLES (DT-05: migración completada):
 *   Canónicos: lector | mediador | administrador
 *
 *   El rol legacy 'profesor' fue eliminado en DT-04 / DT-05.
 *   - Todos los usuarios con 'profesor' fueron migrados a 'mediador' + mediatorKind:'teacher'
 *   - 'profesor' ya no es un rol válido en tipos ni en la BD
 *   - normalizeRoles() sigue mapeando 'profesor' → 'mediador' como red de seguridad
 *     en caso de datos legacy que escapen del proceso de migración
 */

import type { User } from '@/types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Roles canónicos del sistema. */
export type CanonicalRole = 'lector' | 'mediador' | 'administrador';

/**
 * Alias canónico — DT-05: 'profesor' eliminado del modelo.
 * Mantenemos el export `AnyRole` para compatibilidad de imports existentes;
 * ahora es idéntico a CanonicalRole.
 */
export type AnyRole = CanonicalRole;

// ---------------------------------------------------------------------------
// Constantes internas
// ---------------------------------------------------------------------------

/** Roles válidos para normalización. */
const VALID_ROLES: CanonicalRole[] = ['lector', 'mediador', 'administrador'];

// ---------------------------------------------------------------------------
// normalizeRoles
// ---------------------------------------------------------------------------

/**
 * Sanitiza y normaliza un array de roles de entrada (p.ej. desde la BD o un CSV).
 *
 * - Mapea el rol legacy 'profesor' → 'mediador' (red de seguridad post-DT-04)
 * - Filtra valores no reconocidos
 * - Si el resultado está vacío, devuelve ['lector'] como fallback seguro
 *
 * @example
 * normalizeRoles(['mediador'])        // ['mediador']
 * normalizeRoles(['profesor'])        // ['mediador'] ← legacy, mapeado automáticamente
 * normalizeRoles(['admin'])           // ['lector']   ← 'admin' no es válido
 * normalizeRoles([])                  // ['lector']
 * normalizeRoles(null)                // ['lector']
 * normalizeRoles(['mediador', 'xyz']) // ['mediador']
 */
export function normalizeRoles(raw: unknown): CanonicalRole[] {
  if (!Array.isArray(raw) || raw.length === 0) return ['lector'];
  const filtered = (raw as string[])
    .map(r => r === 'profesor' ? 'mediador' : r)   // DT-05 safety net: mapear legacy
    .filter((r): r is CanonicalRole => VALID_ROLES.includes(r as CanonicalRole));
  return filtered.length > 0 ? filtered : ['lector'];
}

// ---------------------------------------------------------------------------
// Predicados básicos
// ---------------------------------------------------------------------------

/**
 * Comprueba si el usuario tiene exactamente el rol indicado.
 * Para verificar acceso de mediador usa isMediator() en su lugar.
 */
export function hasRole(user: User | null | undefined, role: CanonicalRole): boolean {
  if (!user?.roles || !Array.isArray(user.roles)) return false;
  return user.roles.includes(role as User['roles'][number]);
}

/** Devuelve true si el usuario tiene rol 'lector'. */
export function isReader(user: User | null | undefined): boolean {
  return hasRole(user, 'lector');
}

/**
 * Devuelve true si el usuario tiene rol 'mediador'.
 * DT-05: simplificado — 'profesor' ya no existe como rol válido.
 */
export function isMediator(user: User | null | undefined): boolean {
  return hasRole(user, 'mediador');
}

/** Devuelve true si el usuario tiene rol 'administrador'. */
export function isAdmin(user: User | null | undefined): boolean {
  return hasRole(user, 'administrador');
}

// ---------------------------------------------------------------------------
// canAccessAny
// ---------------------------------------------------------------------------

/**
 * Devuelve true si el usuario tiene al menos uno de los roles requeridos.
 *
 * DT-05: eliminada la equivalencia especial profesor ≡ mediador —
 * ya no existe ningún usuario con 'profesor' en la BD.
 *
 * @example
 * canAccessAny(user, ['mediador', 'administrador']) // true si el usuario tiene alguno de esos roles
 * canAccessAny(user, ['administrador'])             // true solo para admins
 */
export function canAccessAny(
  user: User | null | undefined,
  requiredRoles: CanonicalRole[]
): boolean {
  if (!user?.roles || !Array.isArray(user.roles)) return false;
  return requiredRoles.some(required =>
    user.roles.includes(required as User['roles'][number])
  );
}

// ---------------------------------------------------------------------------
// hasMediatorRole / hasAdminRole — helpers para APIs con roles: string[]
// ---------------------------------------------------------------------------

/**
 * Comprueba si un array de roles contiene el rol de mediador.
 *
 * Útil en servicios (p.ej. dataService) que reciben `roles: string[]` como
 * parámetro en lugar de un objeto User completo.
 *
 * Defensivo: acepta `undefined` y cualquier valor no-array → devuelve `false`.
 *
 * DT-05 safety net: también acepta 'profesor' como alias legacy para cubrir
 * cualquier dato residual que haya escapado la migración DT-04.
 * Esta excepción puede eliminarse cuando se confirme que ningún registro
 * en producción contiene 'profesor' tras un ciclo completo.
 *
 * CONTRATO:
 *   - Entrada inválida (undefined, null, no-array) → false, nunca lanza
 *   - 'mediador' o 'profesor' → true
 *   - Otros roles → false
 *
 * @example
 * hasMediatorRole(['mediador'])   // true
 * hasMediatorRole(['profesor'])   // true ← safety net legacy (DT-05)
 * hasMediatorRole(['lector'])     // false
 * hasMediatorRole(undefined)      // false (no lanza)
 */
export function hasMediatorRole(roles?: string[]): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.includes('mediador') || roles.includes('profesor'); // 'profesor': safety net post-DT-04
}

/**
 * Comprueba si un array de roles contiene 'administrador'.
 * Complemento de hasMediatorRole para usarse en APIs con roles: string[].
 *
 * Defensivo: acepta `undefined` y cualquier valor no-array → devuelve `false`.
 *
 * @example
 * hasAdminRole(['administrador']) // true
 * hasAdminRole(['mediador'])      // false
 * hasAdminRole(undefined)         // false (no lanza)
 */
export function hasAdminRole(roles?: string[]): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.includes('administrador');
}

// ---------------------------------------------------------------------------
// RouteAccess — descriptor explícito de acceso a ruta
// ---------------------------------------------------------------------------

/**
 * Descriptor discriminado de acceso a una ruta protegida.
 *
 * Variantes:
 *   { type: 'public' }         → cualquiera, sin sesión requerida
 *   { type: 'authenticated' }  → cualquier usuario con sesión activa
 *   { type: 'roles', roles }   → usuario debe tener al menos uno de estos roles
 *   { type: 'deny' }           → acceso denegado para todos (ruta no mapeada)
 *
 * Usado por: ProtectedRoute, getRouteAccess (App.tsx)
 */
export type RouteAccess =
  | { type: 'public' }
  | { type: 'authenticated' }
  | { type: 'roles'; roles: CanonicalRole[] }
  | { type: 'deny' };
