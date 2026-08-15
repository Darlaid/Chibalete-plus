/**
 * sessionAuth.js — CHP-IDDB-M1-A-SESSION-IDENTITY-01.
 *
 * Resolución central de identidad HUMANA para requests. Une token firmado +
 * claves file-only + store de revocación + autoridad FÍSICA de usuario (JSON):
 *
 *   cookie → HMAC verify → sid store state → physical user lookup → active →
 *   credentialVersion match → req.auth = { userId, sessionId, authenticatedAt,
 *   authMethod }.
 *
 * REVOCACIÓN lee autoridad FÍSICA (readUsersPhysical), no el projection mirror:
 * un disable/reset/logout-all debe invalidar al instante sin depender del lag
 * del espejo SQLite.
 *
 * Modos (SESSION_AUTH_MODE, default 'off' = comportamiento actual intacto):
 *   off     — sin emisión ni verificación de sesión; identidad = x-user-id
 *             (exactamente hoy). Deploy A dormant.
 *   compat  — login emite cookie; sesión firmada es autoritativa si está
 *             presente; x-user-id legacy aún aceptado; mismatch ⇒ deny.
 *   enforce — sesión requerida; x-user-id externo rechazado (allowlist explícita
 *             para internos/test vía SESSION_LEGACY_ALLOW=1, NUNCA heurística IP).
 *
 * FAIL-CLOSED: si el store de sesiones no está disponible, una request con
 * cookie de sesión se rechaza (503) — jamás cae a x-user-id.
 */
import crypto from 'node:crypto';
import { generateSid, signSessionToken, verifySessionToken } from './sessionToken.js';
import { readCurrentSigningKey, readVerificationKeys } from './sessionSigningKey.js';
import {
    persistSession, getSessionState, revokeSession, revokeAllUserSessions,
} from '../db/sessionStore.js';

export const SESSION_COOKIE = 'chp_session';
export const DEFAULT_TTL_SEC = 12 * 60 * 60; // 12 h absolutas, sin idle.

export function sessionAuthMode() {
    const v = String(process.env.SESSION_AUTH_MODE || 'off').toLowerCase().trim();
    return ['off', 'compat', 'enforce'].includes(v) ? v : 'off';
}
export function sessionIssuanceEnabled() { return sessionAuthMode() !== 'off'; }

/** credentialVersion seguro: ausente ⇒ 0. Nunca lanza. */
export function credentialVersionOf(user) {
    const cv = user?.credentialVersion;
    return Number.isInteger(cv) && cv >= 0 ? cv : 0;
}

/** Incremento puro sobre un objeto user (el caller persiste bajo lock). */
export function bumpCredentialVersion(user) {
    user.credentialVersion = credentialVersionOf(user) + 1;
    return user.credentialVersion;
}

/** Parse mínimo de la cabecera Cookie (sin dependencia cookie-parser). */
export function parseCookies(header) {
    const out = {};
    if (typeof header !== 'string' || !header) return out;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

export function createSessionAuth({ readUsersPhysical, isUserActive, log = () => {}, keyProvider } = {}) {
    const nowSec = () => Math.floor(Date.now() / 1000);
    // Producción NUNCA pasa keyProvider → claves file-only. Los tests inyectan
    // una clave hermética para poder correr sin el bind mount 0400 (y en Windows,
    // donde el lector POSIX fail-closed no aplica).
    const readCurrent = keyProvider?.readCurrent ?? readCurrentSigningKey;
    const readVerification = keyProvider?.readVerification ?? readVerificationKeys;

    /**
     * Emite una sesión para un usuario ya autenticado por credenciales.
     * Firma + persiste la fila. @returns {Promise<{token,sid,expiresAtSec}>}
     */
    async function issueSession(user, { ttlSec = DEFAULT_TTL_SEC } = {}) {
        const key = await readCurrent();
        const sid = generateSid();
        const iat = nowSec();
        const exp = iat + ttlSec;
        const cv = credentialVersionOf(user);
        const token = signSessionToken({ sub: user.id, sid, iat, exp, cv }, key);
        persistSession({ sid, userId: user.id, issuedAtSec: iat, expiresAtSec: exp, credentialVersion: cv });
        return { token, sid, expiresAtSec: exp };
    }

    /**
     * Verifica la sesión firmada de una request. NO consulta x-user-id.
     * @returns {Promise<{ok:true,userId,sessionId}|{ok:false,status,reason}>}
     */
    async function verifyRequestSession(req) {
        const cookies = parseCookies(req.headers?.cookie);
        const token = cookies[SESSION_COOKIE];
        if (!token) return { ok: false, status: 401, reason: 'no_session' };

        let keys;
        try { keys = await readVerification(); }
        catch { return { ok: false, status: 503, reason: 'signing_key_unavailable' }; }

        const v = verifySessionToken(token, keys, nowSec());
        if (!v.ok) return { ok: false, status: 401, reason: v.reason };

        // Store de revocación (autoridad de sid). FAIL-CLOSED si no disponible.
        let state;
        try { state = getSessionState(v.payload.sid); }
        catch { return { ok: false, status: 503, reason: 'session_store_unavailable' }; }
        if (!state) return { ok: false, status: 401, reason: 'session_unknown' };
        if (state.revoked) return { ok: false, status: 401, reason: 'revoked' };
        if (state.expired) return { ok: false, status: 401, reason: 'expired' };

        // Autoridad FÍSICA del usuario.
        let user;
        try {
            const users = readUsersPhysical();
            user = Array.isArray(users) ? users.find(u => u?.id === v.payload.sub) : null;
        } catch { return { ok: false, status: 503, reason: 'user_authority_unavailable' }; }
        if (!user) return { ok: false, status: 401, reason: 'unknown_subject' };
        if (!isUserActive(user)) return { ok: false, status: 401, reason: 'disabled' };
        if (credentialVersionOf(user) !== (v.payload.cv | 0)) {
            return { ok: false, status: 401, reason: 'credential_version_mismatch' };
        }
        if (state.credentialVersion !== (v.payload.cv | 0)) {
            return { ok: false, status: 401, reason: 'credential_version_mismatch' };
        }
        return { ok: true, userId: user.id, sessionId: v.payload.sid };
    }

    /**
     * Resolución unificada de identidad humana según el modo. Devuelve la
     * decisión; NO responde. El caller aplica status/role.
     *
     * @returns {Promise<{ok:true, userId, authMethod, req_auth}
     *   | {ok:false, status, reason}>}
     */
    async function authenticate(req) {
        const mode = sessionAuthMode();
        const xuid = req.headers?.['x-user-id'];

        if (mode === 'off') {
            // Comportamiento actual: solo x-user-id, con active check.
            return legacyDecision(xuid);
        }

        const hasCookie = !!parseCookies(req.headers?.cookie)[SESSION_COOKIE];
        if (hasCookie) {
            const s = await verifyRequestSession(req);
            if (!s.ok) return s;
            // Sesión válida es autoritativa. x-user-id divergente ⇒ deny.
            if (xuid && String(xuid) !== String(s.userId)) {
                try { metricsBump('subject_mismatch'); } catch { /* noop */ }
                return { ok: false, status: 401, reason: 'subject_mismatch' };
            }
            return {
                ok: true, userId: s.userId, authMethod: 'session',
                req_auth: { userId: s.userId, sessionId: s.sessionId,
                    authenticatedAt: new Date().toISOString(), authMethod: 'session' },
            };
        }

        // Sin cookie de sesión.
        if (mode === 'enforce') {
            const allowLegacy = process.env.SESSION_LEGACY_ALLOW === '1';
            if (!allowLegacy) return { ok: false, status: 401, reason: 'session_required' };
        }
        // compat (o enforce+allowlist): x-user-id legacy aún válido.
        const legacy = legacyDecision(xuid);
        if (legacy.ok) { try { metricsBump('legacy'); } catch { /* noop */ } }
        return legacy;
    }

    function legacyDecision(xuid) {
        if (!xuid) return { ok: false, status: 401, reason: 'no_identity' };
        let user;
        try {
            const users = readUsersPhysical();
            user = Array.isArray(users) ? users.find(u => u?.id === xuid) : null;
        } catch { return { ok: false, status: 503, reason: 'user_authority_unavailable' }; }
        if (!user) return { ok: false, status: 401, reason: 'unknown_subject' };
        if (!isUserActive(user)) return { ok: false, status: 401, reason: 'disabled' };
        return {
            ok: true, userId: user.id, authMethod: 'legacy_x_user_id',
            req_auth: { userId: user.id, sessionId: null,
                authenticatedAt: new Date().toISOString(), authMethod: 'legacy_x_user_id' },
        };
    }

    let _metrics = null;
    function metricsBump(kind) {
        if (!_metrics) return;
        try {
            if (kind === 'legacy') _metrics.legacy?.labels('browser').inc();
            else if (kind === 'subject_mismatch') _metrics.mismatch?.inc();
        } catch { /* noop */ }
    }
    function attachMetrics(m) { _metrics = m; }

    return {
        issueSession, verifyRequestSession, authenticate,
        revokeSession, revokeAllUserSessions,
        SESSION_COOKIE, attachMetrics,
    };
}

/**
 * Guard CSRF para métodos mutantes autenticados por cookie. Máquinas con
 * x-admin-secret quedan exentas (no usan cookie). Defensa: Origin allowlist +
 * Sec-Fetch-Site. GET/HEAD/OPTIONS no aplican.
 *
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function csrfCheck(req, { allowedOrigins = [], isMachine = false } = {}) {
    const method = String(req.method || 'GET').toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return { ok: true };
    if (isMachine) return { ok: true };
    // Solo aplica si la autenticación viene por cookie de sesión.
    const hasSessionCookie = !!parseCookies(req.headers?.cookie)[SESSION_COOKIE];
    if (!hasSessionCookie) return { ok: true };

    const site = req.headers?.['sec-fetch-site'];
    if (site && ['same-origin', 'same-site', 'none'].includes(String(site))) return { ok: true };

    const origin = req.headers?.origin;
    if (origin && allowedOrigins.includes(String(origin))) return { ok: true };

    return { ok: false, reason: origin ? 'foreign_origin' : 'missing_origin' };
}

export function allowedOriginsFromEnv() {
    // Reutiliza la misma allowlist que CORS (ALLOWED_ORIGINS) si no se define una
    // específica para sesión — una sola fuente de orígenes de confianza.
    const raw = process.env.SESSION_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '';
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

/** Opciones de cookie de sesión (Secure solo en prod; HttpOnly/SameSite siempre). */
export function sessionCookieOptions({ isProd = process.env.NODE_ENV === 'production', maxAgeSec = DEFAULT_TTL_SEC } = {}) {
    return {
        httpOnly: true,
        secure: !!isProd,
        sameSite: 'strict',
        path: '/',
        maxAge: maxAgeSec * 1000,
    };
}

export { crypto as _crypto };
