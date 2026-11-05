/**
 * apiRateLimit.mjs — SEC-API-RATELIMIT-01.
 *
 * Clave del limitador general de `/api/`. Antes era
 * `req.headers['x-user-id'] || ipKeyGenerator(req)`, con dos defectos:
 *
 *  1. `ipKeyGenerator` espera un string de IP. Con el objeto `req` devuelve el
 *     propio objeto, y el almacén en memoria lo trataba como una clave nueva en
 *     cada petición: todo el tráfico SIN `x-user-id` (anónimo y el navegador
 *     con cookie, que ya no manda `x-user-id`) quedaba sin límite.
 *  2. `x-user-id` es una cabecera del cliente: rotarla salta el límite, y
 *     escribir el id de otra persona agota SU cupo.
 *
 * Política nueva (memoria por réplica, como el resto de limitadores):
 *
 *  - `session` — la cookie `chp_session` trae una firma válida (claves current
 *    o previous), no ha expirado y su sid está vivo en el store de sesiones
 *    (no revocado, no expirado, misma credentialVersion). Clave = `sub` del
 *    token: un cupo por cuenta, la tenga abierta en uno o varios dispositivos.
 *    Nadie puede producir esa clave para otra persona sin un token que el
 *    servidor emitió para ella tras validar su contraseña.
 *  - `anonymous` — todo lo demás (sin cookie, cookie inválida, revocada o
 *    expirada, store o clave no disponibles): clave = IP real (`req.ip`, que
 *    con `trust proxy 1` es la que el edge añade al final de X-Forwarded-For),
 *    agrupada por /56 en IPv6.
 *
 * `x-user-id` y cualquier otra cabecera del cliente NO intervienen en la clave.
 *
 * El limitador se monta ANTES de la autenticación de cada ruta, así que no se
 * apoya en `req.auth` / `req.user`: verifica la sesión por su cuenta. Esta
 * verificación SOLO elige el cubo; no autentica ni autoriza nada. Si falla,
 * la petición cuenta como anónima y la ruta aplica su propia autenticación.
 * No lee el padrón de usuarios: un sid revocado (logout, reset, cambio de
 * contraseña) ya basta para sacar al token del cubo de la cuenta.
 */
import crypto from 'node:crypto';

export const API_WINDOW_MS = 15 * 60 * 1000;
export const API_LIMIT_MESSAGE = Object.freeze({ error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' });

/**
 * Cupos por ventana de 15 min y por réplica.
 *  - session 1500: el mismo número que ya tenía el cubo por `x-user-id`
 *    (≈100/min sostenidas por cuenta).
 *  - anonymous 1500 por IP: un aula de 40 antes de iniciar sesión hace unas
 *    pocas llamadas por estudiante; los logins además tienen su propio límite
 *    (100 por IP). Una vez con sesión, cada estudiante usa su propio cubo.
 * Fuera de producción los cupos son altos: las suites lanzan miles de
 * peticiones desde 127.0.0.1.
 */
export function apiLimits(isProd) {
    return isProd
        ? { session: 1500, anonymous: 1500 }
        : { session: 20000, anonymous: 20000 };
}

const SUBJECT = Symbol('chpApiRateSubject');

/**
 * @param {{
 *   enabled: () => boolean,              // sessionIssuanceEnabled
 *   parseCookies: (h:string) => object,
 *   cookieName: string,
 *   readVerificationKeys: () => Promise<string[]>,
 *   verifySessionToken: (t:string, keys:string[]) => {ok:boolean, payload?:object},
 *   getSessionState: (sid:string) => ({revoked:boolean, expired:boolean, credentialVersion:number}|null),
 * }} deps
 * @returns {(req) => Promise<{kind:'session', userId:string}|{kind:'anonymous'}>}
 */
export function createApiSubjectResolver({ enabled, parseCookies, cookieName, readVerificationKeys, verifySessionToken, getSessionState }) {
    const ANON = Object.freeze({ kind: 'anonymous' });
    return async function resolveApiSubject(req) {
        try {
            if (!enabled()) return ANON;
            const token = parseCookies(req.headers?.cookie)[cookieName];
            if (!token) return ANON;
            const keys = await readVerificationKeys();
            const v = verifySessionToken(token, keys);
            if (!v?.ok) return ANON;
            const state = getSessionState(v.payload.sid);
            if (!state || state.revoked || state.expired) return ANON;
            if (state.credentialVersion !== (v.payload.cv | 0)) return ANON;
            return { kind: 'session', userId: String(v.payload.sub) };
        } catch {
            return ANON;
        }
    };
}

/** Clave del cubo. Exportada para los tests. */
export function apiRateKey(subject, ip, ipKeyGenerator) {
    if (subject.kind === 'session') {
        // Hash corto: el userId no queda en claro en las claves del almacén.
        return `api-user:${crypto.createHash('sha256').update(subject.userId).digest('hex').slice(0, 32)}`;
    }
    return `api-ip:${ipKeyGenerator(String(ip || ''))}`;
}

/**
 * Crea el limitador general. `skipPaths` usa la ruta completa (`originalUrl`
 * sin query): bajo `app.use('/api/', …)` `req.path` ya no lleva el prefijo.
 * @param {{ rateLimit: Function, ipKeyGenerator: Function, isProd: boolean,
 *           resolveSubject: Function, skipPaths?: string[], limits?: {session:number, anonymous:number},
 *           store?: Function }} deps
 */
export function createApiLimiter({ rateLimit, ipKeyGenerator, isProd, resolveSubject, skipPaths = [], limits, store }) {
    const l = limits || apiLimits(isProd);
    const skip = new Set(skipPaths);
    const pathOf = (req) => String(req.originalUrl || req.url || '').split('?')[0];
    return rateLimit({
        windowMs: API_WINDOW_MS,
        ...(store ? { store: store() } : {}),
        skip: (req) => skip.has(pathOf(req)),
        keyGenerator: async (req) => {
            const subject = await resolveSubject(req);
            req[SUBJECT] = subject;
            return apiRateKey(subject, req.ip, ipKeyGenerator);
        },
        limit: (req) => (req[SUBJECT]?.kind === 'session' ? l.session : l.anonymous),
        standardHeaders: true,
        legacyHeaders: false,
        message: API_LIMIT_MESSAGE,
    });
}
