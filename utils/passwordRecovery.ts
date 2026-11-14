/**
 * V9 F4-B2 — recuperación de contraseña.
 *
 * Chibalete+ no envía correos: la solicitud se hace en la página pública de la tienda, que pide el enlace a la
 * app por su canal firmado y lo envía al correo registrado de la cuenta (V9 F4-A / F4-B1). Aquí solo se enlaza
 * esa página; el enlace del correo vuelve a `/#/reset-password?token=…`, que ya existía.
 *
 * La dirección es fija y no lleva ningún dato de quien la abre (ni correo, ni usuario, ni token).
 */
export const STORE_PASSWORD_RECOVERY_URL = 'https://chibaleteeditores.com/?chplus-clave=1';
