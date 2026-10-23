/**
 * protectedAccounts.test.mjs — SEC-USERS-01 / Unidad A-PROD.
 * Cuenta administrativa principal protegida + guard de último administrador.
 * Puro, sin disco ni red.
 *
 *   node server/__test__/protectedAccounts.test.mjs
 */
import {
    PRINCIPAL_ADMIN_EMAIL, protectedAdminEmails, isProtectedAdmin,
    wouldLeaveNoUsableAdmin, protectedUpdateViolation,
} from '../lib/protectedAccounts.js';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const isUserActive = (u) => !u?.accountStatus || u.accountStatus === 'active';

console.log('\n[1] lista protegida');
ok('la principal es admin@chibaleteeditores.com', PRINCIPAL_ADMIN_EMAIL === 'admin@chibaleteeditores.com');
ok('sin configuración contiene la principal', protectedAdminEmails({}).has(PRINCIPAL_ADMIN_EMAIL));
ok('PROTECTED_ADMIN_EMAILS añade, nunca retira la principal', (() => { const s = protectedAdminEmails({ PROTECTED_ADMIN_EMAILS: 'otra@x.org' }); return s.has('otra@x.org') && s.has(PRINCIPAL_ADMIN_EMAIL); })());
ok('una variable vacía no retira la principal', protectedAdminEmails({ PROTECTED_ADMIN_EMAILS: '' }).has(PRINCIPAL_ADMIN_EMAIL));
ok('comparación sin mayúsculas ni espacios', isProtectedAdmin({ email: '  Admin@ChibaleteEditores.COM ' }));
ok('otra cuenta no está protegida', !isProtectedAdmin({ email: 'admin@chibalete.com' }));
ok('registro nulo no está protegido', !isProtectedAdmin(null));

console.log('\n[2] último administrador utilizable');
const base = [
    { id: 'A', email: 'a@x', roles: ['administrador'], password: '$2b$10$h' },
    { id: 'B', email: 'b@x', roles: ['administrador'], password: '$2b$10$h' },
    { id: 'L', email: 'l@x', roles: ['lector'], password: '$2b$10$h' },
];
ok('con otro admin activo → permitido', !wouldLeaveNoUsableAdmin(base, 'A', isUserActive));
ok('si el otro admin está desactivado → bloqueado', wouldLeaveNoUsableAdmin([base[0], { ...base[1], accountStatus: 'disabled' }, base[2]], 'A', isUserActive));
ok('si el otro admin no tiene credencial (reinvitado) → bloqueado', wouldLeaveNoUsableAdmin([base[0], { ...base[1], password: undefined, accountStatus: 'invited' }], 'A', isUserActive));
ok('rol legacy «admin» cuenta como administrador', !wouldLeaveNoUsableAdmin([base[0], { id: 'C', roles: ['admin'], password: 'x' }], 'A', isUserActive));
ok('actuar sobre un lector nunca bloquea', !wouldLeaveNoUsableAdmin([base[0], base[2]], 'L', isUserActive));
ok('objetivo inexistente no bloquea', !wouldLeaveNoUsableAdmin(base, 'NOPE', isUserActive));

console.log('\n[3] edición de la cuenta protegida');
const before = { id: 'P', email: PRINCIPAL_ADMIN_EMAIL, roles: ['administrador'], nombre_completo: 'P' };
const v = (after, o = {}) => protectedUpdateViolation(before, { ...before, ...after }, { passwordChanged: false, canSetPassword: false, isUserActive, ...o });
ok('cambio de nombre → permitido', v({ nombre_completo: 'Principal' }) === null);
ok('desactivar → deactivate', v({ accountStatus: 'disabled' }) === 'deactivate');
ok('pasar a invited → deactivate', v({ accountStatus: 'invited' }) === 'deactivate');
ok('quitar administrador → remove_admin_role', v({ roles: ['lector'] }) === 'remove_admin_role');
ok('roles vacíos → remove_admin_role', v({ roles: [] }) === 'remove_admin_role');
ok('cambiar email → change_email', v({ email: 'otro@x.org' }) === 'change_email');
ok('mismo email con otra capitalización → permitido', v({ email: 'ADMIN@chibaleteeditores.com' }) === null);
ok('contraseña desde otra cuenta → set_password', v({}, { passwordChanged: true }) === 'set_password');
ok('contraseña por sí misma o por máquina → permitido', v({}, { passwordChanged: true, canSetPassword: true }) === null);

console.log(`\nprotectedAccounts — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
