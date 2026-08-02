/**
 * identityDbPath.mjs — CHP-IDDB-02B-PATH-01.
 *
 * Resolutor ÚNICO de la ruta de identity.db. Todo el runtime pasa por aquí:
 * `getIdentityDb()` es el único punto que abre la base, y health, el espejo y
 * la facade de lectura entran por él. `config.js` lo reexporta para que la
 * ruta se descubra junto a las demás, pero la implementación no se duplica.
 *
 * Sin dependencias a propósito: el módulo de identidad está dormido y debe
 * poder importarse sin arrastrar las aserciones de arranque de `config.js`.
 *
 * El default histórico (`data-critical/identity.db`) se conserva SOLO para
 * desarrollo y tests. En producción es una ruta insegura: comparte directorio
 * con events.db, insights.db y el padrón, y además `better-sqlite3` CREA el
 * fichero si no existe —de modo que un default silencioso no fallaría, sino
 * que fabricaría una base vacía y la daría por buena—. Por eso, en cuanto se
 * activa cualquier capacidad SQLite en producción, la ruta debe ser explícita.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ────────────────────────────────────────────────────────────────────────────
// identity.db — CHP-IDDB-02B-PATH-01
//
// Resolutor ÚNICO de la ruta de identity.db. Todo el runtime pasa por aquí:
// `getIdentityDb()` es el único punto que abre la base, y health, el espejo y
// la facade de lectura entran por él.
//
// El default histórico (`data-critical/identity.db`) se conserva SOLO para
// desarrollo y tests. En producción es una ruta insegura: comparte directorio
// con events.db, insights.db y el padrón, y además `better-sqlite3` CREA el
// fichero si no existe —de modo que un default silencioso no fallaría, sino
// que fabricaría una base vacía y la daría por buena—. Por eso, en cuanto se
// activa cualquier capacidad SQLite en producción, la ruta debe ser explícita.
// ────────────────────────────────────────────────────────────────────────────

/** Default histórico. Válido en desarrollo; rechazado en producción. */
export const IDENTITY_DB_LEGACY_DEFAULT =
    path.resolve(__dirname, '..', '..', 'data-critical', 'identity.db');

/** Clasificaciones de fallo. Estables: se documentan y se testean por nombre. */
export const IDENTITY_DB_ERRORS = Object.freeze({
    REQUIRED: 'IDENTITY_DB_PATH_REQUIRED',
    UNSAFE: 'IDENTITY_DB_UNSAFE_PRODUCTION_PATH',
    INVALID: 'IDENTITY_DB_PATH_INVALID',
});

export class IdentityDbPathError extends Error {
    constructor(classification, detail) {
        super(`${classification}: ${detail}`);
        this.name = 'IdentityDbPathError';
        this.classification = classification;
    }
}

const _on = (v) => v === '1' || String(v).toLowerCase() === 'true';

/**
 * ¿Hay alguna capacidad SQLite de identidad activa?
 *
 * Réplica deliberada de la semántica de `flags.js` con el entorno inyectable,
 * para poder validar la ruta sin depender del `process.env` global. Un test
 * comprueba que ambas lecturas coinciden, de modo que no puedan divergir.
 */
export function identitySqliteCapabilityActive(env = process.env) {
    return _on(env.IDENTITY_SQLITE_ENABLED)
        || _on(env.IDENTITY_DUAL_WRITE)
        || String(env.IDENTITY_READ ?? 'json').toLowerCase().trim() === 'sqlite';
}

/** Forma segura de nombrar la ruta en logs: nunca la ruta completa. */
export function redactIdentityDbPath(p) {
    if (!p) return '(sin ruta)';
    const base = path.basename(String(p));
    const dir = path.basename(path.dirname(String(p)));
    return `…/${dir}/${base}`;
}

const _isProduction = (env) => String(env.NODE_ENV ?? '').toLowerCase() === 'production';

/**
 * Resuelve la ruta de identity.db. NO crea directorios ni ficheros, NO abre
 * SQLite y NO lee `.env`: solo decide y valida.
 *
 * @param {{env?:NodeJS.ProcessEnv, explicitPath?:string|null, forOpen?:boolean}} [opts]
 *   `explicitPath` es el argumento que los tests pasan a `getIdentityDb()`; en
 *   producción queda sujeto a las mismas validaciones, para que no sirva de
 *   puerta trasera. `forOpen` añade las comprobaciones de filesystem que solo
 *   tienen sentido justo antes de abrir o crear.
 * @returns {string} ruta absoluta
 */
export function resolveIdentityDbPath(opts = {}) {
    const { env = process.env, explicitPath = null, forOpen = false } = opts;
    const production = _isProduction(env);
    const capabilityActive = identitySqliteCapabilityActive(env);
    const configured = explicitPath ?? (env.IDENTITY_DB ? String(env.IDENTITY_DB) : null);

    if (!configured) {
        // Sin ruta explícita: en producción con SQLite activo se falla cerrado
        // en vez de caer al default histórico.
        if (production && capabilityActive) {
            throw new IdentityDbPathError(IDENTITY_DB_ERRORS.REQUIRED,
                'IDENTITY_DB es obligatoria cuando hay una capacidad SQLite de identidad activa');
        }
        return IDENTITY_DB_LEGACY_DEFAULT;
    }

    const trimmed = configured.trim();
    if (!trimmed) {
        throw new IdentityDbPathError(IDENTITY_DB_ERRORS.INVALID, 'IDENTITY_DB está vacía');
    }
    if (!path.isAbsolute(trimmed)) {
        throw new IdentityDbPathError(IDENTITY_DB_ERRORS.INVALID,
            `IDENTITY_DB debe ser absoluta (${redactIdentityDbPath(trimmed)})`);
    }
    const resolved = path.resolve(trimmed);

    if (production && capabilityActive && resolved === IDENTITY_DB_LEGACY_DEFAULT) {
        throw new IdentityDbPathError(IDENTITY_DB_ERRORS.UNSAFE,
            'el default histórico bajo data-critical no es una ruta productiva válida');
    }

    if (forOpen) {
        let st = null;
        try { st = fs.lstatSync(resolved); } catch { st = null; }
        if (st?.isDirectory()) {
            throw new IdentityDbPathError(IDENTITY_DB_ERRORS.INVALID,
                `IDENTITY_DB apunta a un directorio (${redactIdentityDbPath(resolved)})`);
        }
        if (st?.isSymbolicLink()) {
            throw new IdentityDbPathError(IDENTITY_DB_ERRORS.INVALID,
                `IDENTITY_DB es un symlink (${redactIdentityDbPath(resolved)})`);
        }
    }
    return resolved;
}
