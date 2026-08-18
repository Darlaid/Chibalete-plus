/**
 * eventsWriteAuth.js — CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01.
 *
 * Guard de ESCRITURA de eventos (/api/v1/events, /api/playback-events,
 * /api/analytics/events). Estas rutas atribuyen datos a un userId en
 * events.db/logs de producto, así que la identidad debe salir de la sesión
 * firmada — el header x-user-id autoafirmado NO es autoridad de atribución
 * aquí, aunque el modo compat lo acepte en otras rutas: sin este guard, un
 * cliente podría escribir eventos a nombre de otro usuario incluso bajo
 * ENFORCE (las rutas no corrían ningún middleware de sesión y `reqUserId`
 * cae al header crudo).
 *
 * Contrato por modo:
 *  - off      → next() sin efectos: el contrato legacy de cada handler queda
 *               byte-idéntico (mundo pre-M1-A, la sesión no existe).
 *  - compat   → SOLO sesión firmada (authMethod 'session'). El header sin
 *               cookie se rechaza con `session_required_event_write` — más
 *               estricto que compat general, deliberado para escrituras.
 *  - enforce  → ídem; también rechaza el caso enforce+SESSION_LEGACY_ALLOW
 *               (una allowlist legacy futura no debe reabrir la atribución).
 *
 * Mismatch cookie válida + x-user-id divergente lo resuelve `authenticate`
 * (401 subject_mismatch, con métrica). Fail-closed: error interno ⇒ 503.
 */
export function createEventsWriteAuth({ sessionEnabled, authenticate, onFailure = () => {} }) {
    if (typeof sessionEnabled !== 'function' || typeof authenticate !== 'function') {
        throw new Error('createEventsWriteAuth: sessionEnabled y authenticate son obligatorios');
    }
    return async function requireEventsWriteAuth(req, res, next) {
        if (!sessionEnabled()) return next();
        let d;
        try {
            d = await authenticate(req);
        } catch {
            d = { ok: false, status: 503, reason: 'auth_unavailable' };
        }
        if (d?.ok && d.authMethod !== 'session') {
            d = { ok: false, status: 401, reason: 'session_required_event_write' };
        }
        if (!d?.ok) {
            try { onFailure(d?.reason || 'unknown'); } catch { /* noop */ }
            return res.status(d?.status || 401).json({ error: 'No autorizado: se requiere sesión activa' });
        }
        req.auth = d.req_auth;
        return next();
    };
}
