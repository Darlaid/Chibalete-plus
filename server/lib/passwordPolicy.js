/**
 * passwordPolicy.js — SEC-USERS-01 / Unidad A.
 *
 * Política mínima para contraseñas NUEVAS (creación, activación, reset y cambio
 * administrativo). No sustituye las reglas de longitud que ya aplica cada ruta:
 * el caller pasa `minLength` cuando su contrato previo la exigía.
 *
 *   - Rechaza contraseñas predeterminadas conocidas (p. ej. la que la UI
 *     proponía por defecto al crear usuarios).
 *   - Rechaza valores con formato bcrypt aportados por el cliente: el servidor
 *     es el único que genera hashes. Antes `hashPasswordIfNeeded` guardaba tal
 *     cual cualquier valor que empezara por `$2`.
 *   - Rechaza la contraseña igual al email o a su parte local.
 *
 * Nunca registra ni devuelve el valor evaluado.
 */
import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 10;

// Comparación tras trim + minúsculas. Lista corta y explícita: no pretende ser
// un diccionario, solo cerrar los valores conocidos de este proyecto y los
// triviales más comunes.
export const KNOWN_DEFAULT_PASSWORDS = new Set([
    'chibalete123', 'chibalete', 'chibaleteplus', 'chibalete+',
    'chibalete2024', 'chibalete2025', 'chibalete2026',
    'password', 'password1', 'password123', 'contraseña', 'contrasena',
    '12345678', '123456789', '1234567890', 'qwerty123', 'abc12345',
    'admin123', 'administrador', 'lector123', 'profesor123', 'mediador123',
]);

const BCRYPT_LIKE = /^\$2[abxy]?\$/;

export const PASSWORD_POLICY_ERRORS = Object.freeze({
    invalid:       'La contraseña es obligatoria.',
    too_short:     'La contraseña es demasiado corta.',
    hash_not_allowed: 'Formato de contraseña no permitido.',
    default_password: 'Esa contraseña es predeterminada o demasiado común. Elige otra.',
    matches_email: 'La contraseña no puede coincidir con el email.',
});

/**
 * @param {unknown} password
 * @param {{ email?: string, minLength?: number }} [opts]
 * @returns {{ ok: true } | { ok: false, code: keyof PASSWORD_POLICY_ERRORS, message: string }}
 */
export function checkNewPassword(password, { email, minLength } = {}) {
    const fail = (code) => ({ ok: false, code, message: PASSWORD_POLICY_ERRORS[code] });
    if (typeof password !== 'string' || password.length === 0) return fail('invalid');
    if (Number.isInteger(minLength) && password.length < minLength) return fail('too_short');
    if (BCRYPT_LIKE.test(password)) return fail('hash_not_allowed');
    const norm = password.trim().toLowerCase();
    if (KNOWN_DEFAULT_PASSWORDS.has(norm)) return fail('default_password');
    if (typeof email === 'string' && email.includes('@')) {
        const e = email.trim().toLowerCase();
        if (norm === e || norm === e.split('@')[0]) return fail('matches_email');
    }
    return { ok: true };
}

/** Hash SIEMPRE generado por el servidor (nunca pasa un valor tal cual). */
export async function hashNewPassword(password) {
    return bcrypt.hash(password, BCRYPT_COST);
}
