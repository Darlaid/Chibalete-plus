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

/**
 * CHP-M1A-LU-ANALYTICS-401-LOOP-MITIGATION-01 — MITIGACIÓN TEMPORAL.
 *
 * SOLO para POST /api/analytics/events, delante de requireEventsWriteAuth.
 * La app Android legacy (Chibalete LU, sin CookieJar) postea analytics con
 * x-user-id sin cookie; el 401 del guard estricto dispara en el cliente un
 * logout destructivo (purga sesión + libro offline + progreso local) y, como
 * su cola de analytics persiste tras logout, un loop de re-login cada ~30s.
 *
 * Contrato: en modo compat, un request header-only (x-user-id presente, SIN
 * cookie de sesión) recibe 202 accept-and-drop — NO se escribe nada, NO se
 * atribuye identidad, NO se llama al handler. Cualquier otro caso pasa al
 * guard estricto intacto: off → legacy byte-idéntico; enforce → 401 estricto;
 * cookie presente (válida, expirada o mismatch) → authenticate decide;
 * sin auth alguna → 401 del guard (navegador pre-login, sin cliente destructivo).
 *
 * TEMPORAL: se retira cuando LU migre a sesión por cookie
 * (CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01). No es un legacy-allow:
 * jamás produce escritura ni identidad.
 */
export function createLegacyAnalyticsDropGuard({ sessionMode, hasSessionCookie, onDrop = () => {} }) {
    if (typeof sessionMode !== 'function' || typeof hasSessionCookie !== 'function') {
        throw new Error('createLegacyAnalyticsDropGuard: sessionMode y hasSessionCookie son obligatorios');
    }
    return function legacyAnalyticsAcceptAndDrop(req, res, next) {
        try {
            if (sessionMode() !== 'compat') return next();
            const headerUserId = req.headers?.['x-user-id'];
            if (!headerUserId) return next();
            if (hasSessionCookie(req)) return next();
        } catch {
            // Ante cualquier duda, el guard estricto decide (fail-closed aguas abajo).
            return next();
        }
        try { onDrop(); } catch { /* noop */ }
        return res.status(202).json({
            ok: true,
            accepted: false,
            dropped: true,
            reason: 'legacy_android_analytics_requires_session',
        });
    };
}
