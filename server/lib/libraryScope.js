/**
 * libraryScope.js — CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-2.
 *
 * Resolución de CONTEXTO y guard de ACTOR para las capas INSTITUTIONAL y
 * PERSONAL de Biblioteca. Dos responsabilidades, ambas de servidor:
 *
 *  1. `institutionalContextIdOf` / `personalContextIdOf` — el `contextId` de una
 *     operación de Biblioteca sale EXCLUSIVAMENTE de la identidad ya resuelta
 *     (`req.user`). Jamás de query, body, header ni parámetro de ruta. No hay
 *     derivación textual: `organizationId` es la única autoridad institucional
 *     (CHP-ID-GROUPS-RECON-01B); un nombre de colegio nunca resuelve tenant.
 *
 *  2. `createLibraryActorAuth` — mismo patrón y mismo contrato por modo que
 *     `createEventsWriteAuth` (CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01), aplicado a
 *     Biblioteca porque estas rutas LEEN y ESCRIBEN datos atribuidos a una
 *     persona concreta (su biblioteca privada, la curaduría de su institución):
 *
 *      - off      → next() sin efectos. La sesión no existe en ese mundo y el
 *                   contrato legacy de cada handler queda intacto.
 *      - compat   → SOLO sesión firmada (authMethod 'session'). El header
 *                   x-user-id autoafirmado NO es autoridad aquí, aunque compat
 *                   lo acepte en otras rutas: sin esto, un cliente podría leer
 *                   o escribir la biblioteca personal de otra cuenta.
 *      - enforce  → ídem; también rechaza enforce + SESSION_LEGACY_ALLOW.
 *
 *     Fail-closed: cualquier error interno ⇒ 503, nunca degradación a header.
 *
 * Este módulo NO decide acceso a contenido. El entitlement lo resuelve el
 * access engine canónico; la autorización institucional, el CIS
 * (`evaluateScopeAccess`). Aquí solo se responde "quién eres" y "en qué
 * contexto operas".
 */

/** `organizationId` de la sesión, o null. Sin fallback por nombre de colegio. */
export function institutionalContextIdOf(user) {
    const org = user?.organizationId;
    return typeof org === 'string' && org.trim() ? org.trim() : null;
}

/** `id` de la sesión, o null. El contexto personal es siempre el propio sujeto. */
export function personalContextIdOf(user) {
    const id = user?.id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * Guard de actor para las rutas INSTITUTIONAL/PERSONAL de Biblioteca.
 * Se monta ANTES de `requireUserAuth`: decide si la identidad es admisible
 * para estas superficies; `requireUserAuth` la materializa en `req.user`.
 */
export function createLibraryActorAuth({ sessionEnabled, authenticate, onFailure = () => {} }) {
    if (typeof sessionEnabled !== 'function' || typeof authenticate !== 'function') {
        throw new Error('createLibraryActorAuth: sessionEnabled y authenticate son obligatorios');
    }
    return async function requireLibraryActor(req, res, next) {
        if (!sessionEnabled()) return next();
        let d;
        try {
            d = await authenticate(req);
        } catch {
            d = { ok: false, status: 503, reason: 'auth_unavailable' };
        }
        if (d?.ok && d.authMethod !== 'session') {
            d = { ok: false, status: 401, reason: 'session_required_library' };
        }
        if (!d?.ok) {
            try { onFailure(d?.reason || 'unknown'); } catch { /* noop */ }
            return res.status(d?.status || 401).json({ error: 'No autorizado: se requiere sesión activa' });
        }
        req.auth = d.req_auth;
        return next();
    };
}
