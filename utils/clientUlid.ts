/**
 * clientUlid.ts — Generador ULID para el navegador, sin dependencias.
 *
 * Espejo cliente del módulo `server/ulid.js`. Comparten el mismo formato
 * (26 chars Crockford Base32: 10 timestamp + 16 random). Eso es importante
 * porque el backend valida con el mismo regex y los IDs cliente/servidor
 * son indistinguibles estructuralmente.
 *
 * Diferencias técnicas con la versión Node:
 *   - Usa `crypto.getRandomValues` (Web Crypto) en lugar de `crypto.randomBytes`.
 *   - El resto (BigInt + Crockford encoding) es idéntico.
 *
 * Soporte:
 *   - Chrome/Edge ≥ 67, Firefox ≥ 68, Safari ≥ 14: Web Crypto + BigInt nativos.
 *   - El proyecto ya usa BigInt en otros sitios (no es regresión).
 *   - Si `crypto.getRandomValues` no existe (entornos exóticos / test runners),
 *     hay un fallback no-criptográfico que NO se debería usar en producción
 *     pero evita crash en SSR/test.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;

function encodeTime(ms: number): string {
    const safeMs = Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : 0;
    let n = BigInt(safeMs);
    const out = new Array<string>(TIME_LEN);
    for (let i = TIME_LEN - 1; i >= 0; i--) {
        out[i] = ALPHABET[Number(n & 31n)];
        n >>= 5n;
    }
    return out.join('');
}

function getRandomBytes10(): Uint8Array {
    const bytes = new Uint8Array(10);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
        return bytes;
    }
    // Fallback NO criptográfico — solo para entornos sin Web Crypto. Cliente moderno nunca cae aquí.
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}

function encodeRandom(): string {
    const bytes = getRandomBytes10();
    let acc = 0n;
    for (let i = 0; i < bytes.length; i++) {
        acc = (acc << 8n) | BigInt(bytes[i]);
    }
    const out = new Array<string>(RAND_LEN);
    for (let i = RAND_LEN - 1; i >= 0; i--) {
        out[i] = ALPHABET[Number(acc & 31n)];
        acc >>= 5n;
    }
    return out.join('');
}

/** Genera un ULID. Compatible con la regex del backend `/^[0-9A-HJKMNP-TV-Z]{26}$/i`. */
export function ulid(ms: number = Date.now()): string {
    return encodeTime(ms) + encodeRandom();
}
