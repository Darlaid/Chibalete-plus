/**
 * b2cPasswordReset.mjs — CHP V9 F4-A.
 *
 * Solicitud de recuperación de contraseña de una cuenta B2C, pedida por la tienda por el canal
 * autenticado de `/api/b2c/*` (HMAC, igual que la provisión). La app no tiene correo saliente: la
 * tienda entrega el enlace. El token solo viaja en la respuesta FIRMADA a la tienda; el endpoint
 * público de solicitud sigue sin emitir nada y `reset-confirm` es el de siempre.
 *
 * Una solicitud se refiere a UNA identidad lectora concreta, resuelta con la misma regla que el
 * inicio de sesión (`loginIdentity.mjs`): un correo resuelve la cuenta que entra con ese correo; un
 * usuario de acceso (`lec-…`), la cuenta representada de ese usuario. El contacto del adulto
 * (`representedBy.email`) NO es un identificador: pedir con ese correo nunca alcanza las cuentas de
 * sus hijos. El destinatario lo decide el servidor: correo propio (cuenta adulta) o contacto del
 * adulto (cuenta representada).
 *
 * Solo cuentas B2C (`b2c: true`) activas y sin rol privilegiado: las institucionales siguen
 * recuperándose por su administrador. La solicitud no cambia la contraseña, las sesiones, la
 * versión de credencial, las decisiones ni el acceso; solo anota el resumen del token y su vencimiento.
 * Del token se guarda únicamente su SHA-256 (`resetToken = "sha256:<hex>"`).
 *
 * Funciones puras: no leen ni escriben nada.
 */
import crypto from 'node:crypto';
import { B2cError, B2C_SOURCES, isRepresentedAccount } from './b2cProvisioning.mjs';
import { findLoginIndex } from '../lib/loginIdentity.mjs';

export const B2C_RESET_TTL_MS = 60 * 60 * 1000;          // 1 h, como el restablecimiento existente
export const B2C_RESET_COOLDOWN_MS = 15 * 60 * 1000;     // una emisión por cuenta cada 15 min
export const RESET_TOKEN_HASH_PREFIX = 'sha256:';
const PRIVILEGED_ROLES = ['administrador', 'mediador'];

/** Valor que se almacena en `resetToken` para un token dado. */
export const hashResetToken = (token) => RESET_TOKEN_HASH_PREFIX + crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

/**
 * ¿El token presentado corresponde al valor almacenado? Un valor con prefijo `sha256:` solo se
 * compara por resumen (presentar el propio resumen no sirve); un valor heredado en claro, por igualdad.
 */
export function resetTokenMatches(stored, presented) {
    if (typeof stored !== 'string' || stored === '' || typeof presented !== 'string' || presented === '') return false;
    const a = Buffer.from(stored.startsWith(RESET_TOKEN_HASH_PREFIX) ? hashResetToken(presented) : presented, 'utf8');
    const b = Buffer.from(stored, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Valida y normaliza la entrada de /api/b2c/password-reset. Lanza B2cError(400, …). */
export function validatePasswordResetInput(body, normalizeEmail) {
    const b = body && typeof body === 'object' ? body : {};
    if (!B2C_SOURCES.includes(b.source)) throw new B2cError(400, 'invalid_source');
    if (typeof b.identifier !== 'string') throw new B2cError(400, 'invalid_identifier');
    const identifier = normalizeEmail(b.identifier);
    if (identifier.length < 3 || identifier.length > 254) throw new B2cError(400, 'invalid_identifier');
    return { source: b.source, identifier };
}

const isActive = (u) => !u.accountStatus || u.accountStatus === 'active';
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Decide (bajo el lock de usuarios) si se emite un token y para quién.
 * Devuelve `{ issue: false, reason }` o `{ issue: true, index, user, delivery }`:
 *  - `user`     : el registro con el resumen del token y su vencimiento (lo único que cambia);
 *  - `delivery` : lo que recibe la tienda por el canal firmado.
 * `reason` es solo para el registro del servidor; hacia la tienda todo «no emitido» es idéntico.
 */
export function planPasswordReset({ users, input, nowMs, token, normalizeEmail }) {
    const index = findLoginIndex(users, input.identifier, normalizeEmail);
    if (index === -1) return { issue: false, reason: 'unknown' };
    const user = users[index];
    if (user.b2c !== true) return { issue: false, reason: 'not_b2c' };
    if ((Array.isArray(user.roles) ? user.roles : []).some((r) => PRIVILEGED_ROLES.includes(r))) return { issue: false, reason: 'privileged' };
    if (!isActive(user)) return { issue: false, reason: 'not_active' };
    const represented = isRepresentedAccount(user);
    const deliverTo = normalizeEmail(represented ? user.representedBy.email : user.email);
    if (!isEmail(deliverTo)) return { issue: false, reason: 'no_recipient' };
    // Una emisión vigente y reciente no se reemplaza: pedir de nuevo no invalida el enlace ya enviado
    // ni llena el buzón del destinatario.
    if (typeof user.resetToken === 'string' && Number.isFinite(user.resetExpiresAt)
        && nowMs < user.resetExpiresAt && nowMs - (user.resetExpiresAt - B2C_RESET_TTL_MS) < B2C_RESET_COOLDOWN_MS) {
        return { issue: false, reason: 'cooldown' };
    }
    const expiresAt = nowMs + B2C_RESET_TTL_MS;
    return {
        issue: true, index,
        user: { ...user, resetToken: hashResetToken(token), resetExpiresAt: expiresAt },
        delivery: {
            status: 'issued', deliverTo, resetUrl: `/#/reset-password?token=${token}`, expiresAt,
            account: represented ? { kind: 'represented', loginId: user.loginId } : { kind: 'adult' },
        },
    };
}
