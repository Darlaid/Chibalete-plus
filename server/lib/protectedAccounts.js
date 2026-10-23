/**
 * protectedAccounts.js — SEC-USERS-01 / Unidad A-PROD.
 *
 * Decisión de Dirección: `admin@chibaleteeditores.com` es la cuenta
 * administrativa principal y debe permanecer activa. Ningún flujo de gestión de
 * usuarios (reinvitar, desactivar, editar, borrar) puede desactivarla, quitarle
 * el rol administrador, cambiarle el email ni fijarle una contraseña desde otra
 * cuenta.
 *
 * La lista es ADITIVA: PROTECTED_ADMIN_EMAILS (coma) añade cuentas, nunca
 * retira la principal, de modo que un error de configuración no puede dejarla
 * sin protección. No es un sistema de roles: es una lista cerrada de emails.
 */
export const PRINCIPAL_ADMIN_EMAIL = 'admin@chibaleteeditores.com';

const norm = (e) => String(e ?? '').trim().toLowerCase();

export function protectedAdminEmails(env = process.env) {
    const extra = String(env.PROTECTED_ADMIN_EMAILS || '').split(',').map(norm).filter(Boolean);
    return new Set([PRINCIPAL_ADMIN_EMAIL, ...extra]);
}

export function isProtectedAdmin(user, emails = protectedAdminEmails()) {
    return !!user && emails.has(norm(user.email));
}

const isAdminRole = (u) => Array.isArray(u?.roles) && u.roles.some(r => r === 'administrador' || r === 'admin');

/**
 * ¿Dejaría la acción sin ninguna otra cuenta administrativa capaz de entrar?
 * «Capaz de entrar» = activa y con credencial. Se evalúa sobre el padrón leído
 * bajo lock, excluyendo al objetivo.
 */
export function wouldLeaveNoUsableAdmin(users, targetId, isUserActive) {
    const target = users.find(u => u?.id === targetId);
    if (!target || !isAdminRole(target)) return false;
    return !users.some(u => u?.id && u.id !== targetId && isAdminRole(u) && isUserActive(u) && !!u.password);
}

/**
 * Valida un PUT sobre una cuenta protegida. `before`/`after` son el registro
 * antes y después del merge. `canSetPassword` = el actor es la propia cuenta
 * o la autoridad de máquina (admin-secret file-only), que es la vía de
 * recuperación operativa.
 * @returns {null | string} código de rechazo
 */
export function protectedUpdateViolation(before, after, { passwordChanged, canSetPassword, isUserActive }) {
    if (!isUserActive(after)) return 'deactivate';
    if (!Array.isArray(after.roles) || !after.roles.includes('administrador')) return 'remove_admin_role';
    if (norm(after.email) !== norm(before.email)) return 'change_email';
    if (passwordChanged && !canSetPassword) return 'set_password';
    return null;
}
