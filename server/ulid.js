/**
 * ulid.js — Generador y validador ULID, sin dependencias externas.
 *
 * ULID spec: https://github.com/ulid/spec
 *   - 26 caracteres totales en Crockford Base32.
 *   - Primeros 10 chars: timestamp en milisegundos (48 bits) — ordenable lexicográficamente por tiempo.
 *   - Últimos 16 chars: aleatorio (80 bits) — colisiones prácticamente imposibles.
 *
 * Crockford Base32 alfabeto:
 *   0123456789 ABCDEFGH J K M N PQRSTV WXYZ
 *   (excluye I, L, O, U para evitar confusión visual)
 *
 * Uso típico:
 *   import { ulid, isValidUlid } from './ulid.js';
 *   const id = ulid();                 // → "01HR8K..."
 *   isValidUlid(id);                   // → true
 *
 * Por qué propio en lugar de la lib `ulid` de npm:
 *   - 0 deps. La lib oficial es 1 paquete pero el spec es trivial.
 *   - Compatibilidad ESM total con el proyecto.
 *   - Auditoría más simple para un componente que firma cada evento del backbone.
 */

import crypto from 'crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ALPHABET_LEN = 32;

const TIME_LEN = 10;
const RAND_LEN = 16;
const ULID_LEN = TIME_LEN + RAND_LEN; // 26

// Aceptamos mayúsculas o minúsculas; el spec canónico es uppercase.
const ULID_RX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** Codifica un timestamp ms en 10 chars Crockford Base32 (big-endian). */
function encodeTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
        throw new Error('ulid: timestamp must be a non-negative finite number');
    }
    let n = BigInt(Math.floor(ms));
    const out = new Array(TIME_LEN);
    for (let i = TIME_LEN - 1; i >= 0; i--) {
        const idx = Number(n & 31n);
        out[i] = ALPHABET[idx];
        n >>= 5n;
    }
    return out.join('');
}

/** Codifica 80 bits aleatorios en 16 chars Crockford Base32. */
function encodeRandom() {
    // 10 bytes = 80 bits. Acumulamos en BigInt para extraer grupos de 5 bits.
    const bytes = crypto.randomBytes(10);
    let acc = 0n;
    for (let i = 0; i < bytes.length; i++) {
        acc = (acc << 8n) | BigInt(bytes[i]);
    }
    const out = new Array(RAND_LEN);
    for (let i = RAND_LEN - 1; i >= 0; i--) {
        const idx = Number(acc & 31n);
        out[i] = ALPHABET[idx];
        acc >>= 5n;
    }
    return out.join('');
}

/**
 * Genera un ULID nuevo.
 * @param {number} [ms=Date.now()] - timestamp en ms; útil para tests deterministas.
 * @returns {string} ULID de 26 chars uppercase Crockford Base32.
 */
export function ulid(ms = Date.now()) {
    return encodeTime(ms) + encodeRandom();
}

/**
 * Valida si una cadena es un ULID estructuralmente correcto.
 * Acepta mayúsculas y minúsculas (el spec canónico es uppercase pero
 * algunas implementaciones generan lowercase — toleramos ambos al validar).
 *
 * @param {unknown} s
 * @returns {boolean}
 */
export function isValidUlid(s) {
    return typeof s === 'string' && s.length === ULID_LEN && ULID_RX.test(s);
}
