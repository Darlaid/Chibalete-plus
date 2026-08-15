/**
 * sessionToken.js — CHP-IDDB-M1-A-SESSION-IDENTITY-01.
 *
 * Token de sesión firmado con crypto NATIVO (sin dependencia JWT). Formato:
 *
 *     base64url(JSON(payload)) + "." + base64url(HMAC-SHA256(body, key))
 *
 * Payload MÍNIMO — nada mutable ni credencial:
 *     { sub, sid, iat, exp, cv }
 *   sub = userId ; sid = id de sesión aleatorio ; iat/exp = epoch segundos ;
 *   cv  = credentialVersion al emitir.
 *
 * Roles / institution / memberships / permisos / password / email: JAMÁS en el
 * token; se resuelven server-side. Comparación de firma en tiempo constante.
 * La verificación acepta múltiples claves (rotación current+previous).
 */
import crypto from 'node:crypto';

const b64uEncode = (buf) => Buffer.from(buf).toString('base64url');
const b64uDecode = (str) => Buffer.from(String(str), 'base64url');

/** sid criptográfico (256 bits, base64url ~43 chars). */
export function generateSid() {
    return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256(sid) en hex — lo que se persiste (nunca el sid en claro). */
export function hashSid(sid) {
    return crypto.createHash('sha256').update(String(sid)).digest('hex');
}

function hmac(body, key) {
    return crypto.createHmac('sha256', key).update(body).digest();
}

/**
 * Firma un token. Payload obligatorio: {sub, sid, iat, exp, cv}.
 * @param {{sub:string,sid:string,iat:number,exp:number,cv:number}} payload
 * @param {string} key  clave current
 * @returns {string}
 */
export function signSessionToken(payload, key) {
    if (!key) throw new Error('SESSION_TOKEN_KEY_REQUIRED');
    for (const f of ['sub', 'sid', 'iat', 'exp', 'cv']) {
        if (payload[f] === undefined || payload[f] === null) {
            throw new Error(`SESSION_TOKEN_FIELD_REQUIRED:${f}`);
        }
    }
    const body = b64uEncode(JSON.stringify({
        sub: String(payload.sub), sid: String(payload.sid),
        iat: payload.iat | 0, exp: payload.exp | 0, cv: payload.cv | 0,
    }));
    const sig = b64uEncode(hmac(body, key));
    return `${body}.${sig}`;
}

/**
 * Verifica firma (contra cualquiera de `keys`) y expiración. NO consulta el
 * store ni el usuario — eso lo hace el middleware. Nunca lanza; devuelve un
 * resultado tipado.
 *
 * @param {string} token
 * @param {string[]} keys  claves de verificación (current + opcional previous)
 * @param {number} [nowSec]  epoch segundos (inyectable para tests)
 * @returns {{ok:true, payload:object} | {ok:false, reason:string}}
 */
export function verifySessionToken(token, keys, nowSec = Math.floor(Date.now() / 1000)) {
    if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
    const dot = token.indexOf('.');
    const body = token.slice(0, dot);
    const sigStr = token.slice(dot + 1);
    if (!body || !sigStr || sigStr.includes('.')) return { ok: false, reason: 'malformed' };

    let presented;
    try { presented = b64uDecode(sigStr); } catch { return { ok: false, reason: 'malformed' }; }

    const list = Array.isArray(keys) ? keys : [keys];
    let matched = false;
    for (const k of list) {
        if (!k) continue;
        const expected = hmac(body, k);
        if (presented.length === expected.length && crypto.timingSafeEqual(presented, expected)) {
            matched = true;
            break;
        }
    }
    if (!matched) return { ok: false, reason: 'bad_signature' };

    let payload;
    try {
        payload = JSON.parse(b64uDecode(body).toString('utf8'));
    } catch { return { ok: false, reason: 'malformed' }; }

    for (const f of ['sub', 'sid', 'iat', 'exp', 'cv']) {
        if (payload[f] === undefined || payload[f] === null) return { ok: false, reason: 'malformed' };
    }
    if (typeof payload.exp !== 'number' || nowSec >= payload.exp) return { ok: false, reason: 'expired' };
    return { ok: true, payload };
}
