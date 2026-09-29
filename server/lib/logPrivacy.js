/**
 * logPrivacy.js — CHP-PRIVACY-LOGGING-01 (WEB-REORG P2-D1).
 *
 * Los registros operativos identifican a las personas por su id técnico (`user=<id>`), nunca por el correo.
 * Solo cuando no existe una identidad (p. ej. un login fallido con un correo desconocido) se registra una
 * forma REDACTADA, suficiente para correlacionar intentos sin exponer la dirección completa.
 */
export function redactEmail(email) {
    if (typeof email !== 'string' || !email.includes('@')) return 'unknown';
    const [local, domain] = email.trim().toLowerCase().split('@');
    if (!local || !domain) return 'unknown';
    return `${local[0]}***@${domain}`;
}
