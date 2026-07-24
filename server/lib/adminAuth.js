/**
 * adminAuth.js — factoría de los consumidores de autenticación administrativa.
 *
 * Extrae, sin cambiar su comportamiento, los cuatro consumidores que antes vivían
 * inline en server.js, para que puedan ejercerse mediante HTTP real en pruebas
 * (FILE-01B-R1) importando EXACTAMENTE los mismos símbolos que usa server.js.
 *
 * La validación del secreto administrativo se delega SIEMPRE en el gateway real
 * `headerMatchesAdminSecret` (file-only, /app/secrets/admin_secret). Ese camino
 * NO es inyectable: la factoría no recibe lector, ruta ni valor del secreto.
 *
 * Sólo las dependencias de sesión / autenticación ordinaria se inyectan, para no
 * arrastrar todo server.js a una prueba:
 *   - readUsers():   thunk perezoso → lista de usuarios (server.js: readJSON(USERS_DB)).
 *   - isUserActive(user): predicado de cuenta activa.
 *   - log(msg, type): logger (nunca registra el header ni el secreto).
 *
 * Los thunks son perezosos a propósito: en server.js `readJSON` e `isUserActive`
 * son const definidos DESPUÉS de este punto; capturarlos por closure (invocados en
 * tiempo de request) evita la TDZ y preserva el orden de inicialización.
 */
import { headerMatchesAdminSecret } from './adminSecretRequest.js';

export function createAdminAuth({ readUsers, isUserActive, log }) {
    /**
     * True si la request presenta un x-admin-secret válido (file-only).
     * Promise<boolean> — todo call site debe await.
     */
    const isAdminRequest = async (req) => headerMatchesAdminSecret(req);

    const getRequestHasValidPrincipal = async (req) => {
        if (await headerMatchesAdminSecret(req)) return true;
        const userId = req.headers['x-user-id'];
        if (!userId) return false;
        try {
            const users = readUsers();
            const user = users.find(u => u.id === userId);
            return !!(user && isUserActive(user));
        } catch (_) { return false; }
    };

    const allowAuthenticatedGetOrReject = async (req, res, next) => {
        if (await getRequestHasValidPrincipal(req)) return next();
        log(`[GET_AUTH_REJECT] path=${req.path} ip=${req.ip} userId=${req.headers['x-user-id'] || 'none'}`, 'WARN');
        return res.status(401).json({ error: 'No autorizado: se requiere sesión activa' });
    };

    const requireAdminAccess = async (req, res, next) => {
        if (req.method === 'GET') return allowAuthenticatedGetOrReject(req, res, next);

        // Opción A: admin secret (scripts, PM2, server-to-server) — file-only
        if (await headerMatchesAdminSecret(req)) return next();

        // Opción B: usuario autenticado con rol administrador
        const userId = req.headers['x-user-id'];
        if (userId) {
            const users = readUsers();
            const user = users.find(u => u.id === userId);
            if (user && isUserActive(user)) {
                const roles = Array.isArray(user.roles) ? user.roles : (user.rol ? [user.rol] : []);
                if (roles.includes('administrador')) return next();
            }
        }

        log(`requireAdminAccess denied: ip=${req.ip} userId=${req.headers['x-user-id'] || 'none'}`, 'WARN');
        res.status(401).json({ error: 'Unauthorized: se requiere admin secret o sesión de administrador' });
    };

    const requireAuth = async (req, res, next) => {
        if (req.method === 'GET') return allowAuthenticatedGetOrReject(req, res, next);

        if (await headerMatchesAdminSecret(req)) return next();

        const authHeader = req.headers['x-admin-secret'];
        log(`Unauthorized access attempt from ${req.ip}. Received Secret length: ${authHeader?.length || 0}.`, 'WARN');
        res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret' });
    };

    return {
        isAdminRequest,
        getRequestHasValidPrincipal,
        allowAuthenticatedGetOrReject,
        requireAdminAccess,
        requireAuth,
    };
}
