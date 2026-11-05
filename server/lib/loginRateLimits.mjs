/**
 * loginRateLimits.mjs — G4-PILOT-LOGIN-01.
 *
 * Política de límites de `POST /api/auth/login`. Antes había UNA barrera: 10
 * peticiones por IP cada 15 min y por réplica, contando también los logins
 * correctos. Un aula detrás de una sola IP (NAT del colegio) la agotaba con
 * sus inicios de sesión LEGÍTIMOS y bloqueaba a todo el grupo.
 *
 * Ahora son tres barreras, con `express-rate-limit` (ya en uso) y memoria por
 * réplica, como el resto de limitadores del servidor. Sin infraestructura nueva:
 *
 *  1. `ip` — VOLUMEN por IP: cuenta todo, éxitos incluidos. Techo holgado para
 *     un aula, que sigue frenando ráfagas masivas desde una IP.
 *  2. `ipFailures` — FALLOS por IP: varias cuentas atacadas desde una IP
 *     (password spraying). Los logins correctos no consumen este cupo.
 *  3. `account` — FALLOS por cuenta, desde cualquier IP: ataque distribuido
 *     contra una persona. La clave es un hash del email normalizado, EXISTA O
 *     NO la cuenta, así que el bloqueo no revela qué cuentas existen.
 *
 * La IP es `req.ip` (vía `ipKeyGenerator`, que agrupa IPv6 por /56). Con
 * `trust proxy 1` es la que añade el edge al final de `X-Forwarded-For`: lo
 * que el cliente escriba en esa cabecera queda a la izquierda y no cuenta.
 * Ninguna clave usa cabeceras del cliente.
 *
 * Éxito = respuesta < 400 (criterio por defecto de express-rate-limit): el
 * login correcto responde 200; las credenciales inválidas, 401; un cuerpo
 * inválido, 400. Las tres respuestas de límite son 429 con el mismo mensaje.
 */
import crypto from 'node:crypto';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LIMIT_MESSAGE = Object.freeze({ error: 'Demasiados intentos. Intenta nuevamente en 15 minutos.' });

/**
 * Cupos por ventana y por réplica. Producción: un aula de 40 sin fallos usa
 * 40 de 100 en volumen; con errores de tecleo, 30 fallos por IP y réplica dan
 * margen. Por cuenta, 5 fallos (mismo umbral que el cambio de contraseña).
 * Fuera de producción los cupos son altos para no frenar pruebas locales.
 */
export function loginLimits(isProd) {
    return isProd
        ? { ip: 100, ipFailures: 30, account: 5 }
        : { ip: 500, ipFailures: 300, account: 50 };
}

/** Clave de cuenta: hash del email normalizado. Nunca guarda el email en claro. */
export function loginAccountKey(email, normalizeEmail = (e) => (e ? String(e).trim().toLowerCase() : '')) {
    const norm = normalizeEmail(email);
    return `login-acct:${crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32)}`;
}

/**
 * Crea los tres limitadores. Orden de montaje en la ruta:
 *   ip, ipFailures, validate(body), account, handler
 * (`account` va después de validar: necesita el email ya comprobado).
 * @param {{ rateLimit: Function, ipKeyGenerator: Function, isProd: boolean, normalizeEmail?: Function, store?: Function }} deps
 */
export function createLoginLimiters({ rateLimit, ipKeyGenerator, isProd, normalizeEmail, store }) {
    const limits = loginLimits(isProd);
    const base = { windowMs: LOGIN_WINDOW_MS, standardHeaders: true, legacyHeaders: false, message: LOGIN_LIMIT_MESSAGE };
    const withStore = (o) => (store ? { ...o, store: store() } : o);
    return {
        limits,
        ip: rateLimit(withStore({ ...base, max: limits.ip, keyGenerator: (req) => `login-ip:${ipKeyGenerator(req.ip)}` })),
        ipFailures: rateLimit(withStore({ ...base, max: limits.ipFailures, skipSuccessfulRequests: true,
            keyGenerator: (req) => `login-ipfail:${ipKeyGenerator(req.ip)}` })),
        account: rateLimit(withStore({ ...base, max: limits.account, skipSuccessfulRequests: true,
            keyGenerator: (req) => loginAccountKey(req.body?.email, normalizeEmail) })),
    };
}
