/**
 * loginIdentity.mjs — CHP V9 F3-D2.
 *
 * Resolución de la identidad en `POST /api/auth/login`: correo electrónico o usuario de acceso
 * (`loginId`) de una cuenta representada (V9 F3-D1). Solo decide QUÉ cuenta se intenta; la
 * verificación de contraseña, el estado de la cuenta, la sesión y los límites de intentos son los
 * mismos de siempre y no viven aquí.
 *
 * Dos espacios disjuntos, decididos por la FORMA del identificador ya normalizado:
 *  - con forma de `loginId` (`lec-xxxx-xxxx-xxxx`) ⇒ se busca SOLO en el campo `loginId`;
 *  - cualquier otra cosa ⇒ se busca SOLO en `email`, exactamente como antes.
 * Así un correo nunca resuelve a un usuario ni un usuario a un correo (sin colisiones), y el
 * contacto del representante (`representedBy.email`) no es un identificador de acceso: nunca se
 * consulta. Una cuenta representada tiene `email` vacío y el identificador nunca es vacío, de modo
 * que tampoco entra por la búsqueda por correo.
 *
 * Funciones puras: no leen ni escriben nada.
 */
import { B2C_LOGIN_ID_RX } from '../b2c/b2cProvisioning.mjs';

/** ¿El identificador (ya normalizado) tiene forma de usuario de acceso? */
export const isLoginIdForm = (identifier) => typeof identifier === 'string' && B2C_LOGIN_ID_RX.test(identifier);

/** ¿Esta cuenta responde a ese identificador normalizado? Misma regla para buscar y para revalidar bajo el lock. */
export function matchesLoginIdentifier(user, identifier, normalizeEmail) {
    if (!user || typeof identifier !== 'string' || identifier === '') return false;
    if (isLoginIdForm(identifier)) return typeof user.loginId === 'string' && user.loginId === identifier;
    return normalizeEmail(user.email) === identifier;
}

/** Índice de la cuenta que responde al identificador normalizado, o -1. */
export function findLoginIndex(users, identifier, normalizeEmail) {
    if (!Array.isArray(users) || typeof identifier !== 'string' || identifier === '') return -1;
    return users.findIndex((u) => matchesLoginIdentifier(u, identifier, normalizeEmail));
}
