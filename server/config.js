/**
 * config.js — Rutas canónicas centralizadas del sistema Chibalete+
 *
 * PRODUCCIÓN (VPS) — Docker Compose:
 *   Las rutas reales en host (/var/www/chibalete/...) se exponen como
 *   bind mounts dentro de los containers `chibalete_api_1` y
 *   `chibalete_api_2` como /app/data, /app/data-critical,
 *   /app/public/uploads y /app/server. Los valores efectivos los inyecta
 *   el container desde su working directory + variables de entorno
 *   definidas en docker-compose.yml.
 *
 * DESARROLLO LOCAL:
 *   UPLOADS_ROOT sigue siendo libre. USERS_DB **no**: desde CHP-ID-CANON-01B la
 *   fuente de usuarios es absoluta y solo admite overrides bajo NODE_ENV=test
 *   hacia un fixture temporal. Ver `resolveUsersDb` más abajo.
 *
 *   NOTA: PM2 NO gobierna producción. Si usas `pm2 start
 *   ecosystem.config.cjs` en local, el config respeta las mismas vars
 *   de entorno. Ver banner del archivo ecosystem.config.cjs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// CHP-ID-CANON-01A — este módulo es el ÚNICO resolver de la fuente de usuarios
// y se evalúa en import-time, antes de que server.js llame a dotenv.config().
// Sin esta carga, un `USERS_DB=` puesto en .env quedaba ignorado (solo
// funcionaban las env vars reales del container). `override` queda en false:
// la env var real (Docker Compose en producción) siempre gana sobre .env.
const _dotenv = dotenv.config({ path: path.resolve(__dirname, '../.env') });

// CHP-ID-CANON-01B — bajo NODE_ENV=test la fuente de usuarios se inyecta
// EXPLÍCITAMENTE por el test. Un `USERS_DB=` heredado del .env de la máquina no
// puede decidir contra qué padrón corre la suite, así que se neutraliza (solo
// si vino del .env; un override puesto por el propio test se respeta).
if (process.env.NODE_ENV === 'test'
    && _dotenv?.parsed?.USERS_DB
    && process.env.USERS_DB === _dotenv.parsed.USERS_DB) {
    delete process.env.USERS_DB;
}

/** Directorio raíz de todos los uploads (PDFs, portadas, audios, activos de contenido). */
export const UPLOADS_ROOT = process.env.UPLOADS_ROOT
    || path.resolve(__dirname, '../public/uploads');

/**
 * Padrón canónico de usuarios (CHP-ID-CANON-01A).
 *
 * `data-critical/usuarios_colegios_oro.json` es la ÚNICA fuente de verdad de
 * usuarios para autenticación, administración, roles, permisos, scopes,
 * Aula Viva, instituciones, memberships y asignaciones. En producción el
 * container inyecta USERS_DB apuntando a este mismo archivo; el default local
 * lo replica para que ningún entorno resuelva otro padrón por omisión.
 */
export const USERS_DB_CANONICAL_DEFAULT =
    path.resolve(__dirname, '../data-critical/usuarios_colegios_oro.json');

/**
 * LEGACY_NON_CANONICAL — DO NOT DELETE — DO NOT WRITE — DO NOT READ AT RUNTIME.
 *
 * `data/users_db.json` fue durante un tiempo la autoridad de facto de scope
 * institucional (STAT-03 / SEC-03). En producción comparte 1 de 646 ids con el
 * canónico: es un padrón casi disjunto y sin señales de uso (0 registros con
 * lastLoginAt; el campo ni siquiera existe en su schema). Se conserva intacto
 * por trazabilidad, pero NINGUNA ruta de runtime puede leerlo ni escribirlo.
 *
 * Esta constante existe SOLO para que los tests de canonicalidad y la
 * documentación de deprecación puedan nombrar el archivo sin re-hardcodear la
 * ruta. No la uses como fuente ni como fallback.
 */
export const USERS_DB_LEGACY_NON_CANONICAL =
    path.resolve(__dirname, '../data/users_db.json');

/**
 * Ruta canónica DENTRO del contenedor de producción. `/app/data-critical` es el
 * bind mount de `/var/www/chibalete/data-critical` en el host. En producción la
 * ruta efectiva debe ser exactamente ésta: cualquier otra aborta el arranque.
 */
export const CONTAINER_CANONICAL_USERS_DB = '/app/data-critical/usuarios_colegios_oro.json';

/** Violación de la regla canónica. Aborta el arranque; nunca se degrada. */
export class CanonicalSourceError extends Error {
    constructor(message, detail) {
        super(message);
        this.name = 'CanonicalSourceError';
        this.code = 'CANONICAL_SOURCE_VIOLATION';
        this.detail = detail ?? null;
    }
}

const samePath = (a, b) => {
    if (!a || !b) return false;
    const A = path.resolve(a), B = path.resolve(b);
    return process.platform === 'win32' ? A.toLowerCase() === B.toLowerCase() : A === B;
};

const isInside = (child, parent) => {
    if (!child || !parent) return false;
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    return true;
};

/** Directorios de datos reales del repositorio — jamás admisibles como fixture. */
const REPO_DATA_DIRS = [
    path.resolve(__dirname, '../data'),
    path.resolve(__dirname, '../data-critical'),
    path.resolve(__dirname, '../public/uploads'),
];

/**
 * Directorios temporales admisibles para fixtures de test. Se incluyen las
 * variantes `realpath` porque en Windows os.tmpdir() puede devolver una ruta
 * corta 8.3 distinta de la que produce mkdtemp.
 */
function tempRoots() {
    const roots = new Set();
    for (const raw of [os.tmpdir(), process.env.RUNNER_TEMP, process.env.TMPDIR, process.env.TEMP]) {
        if (!raw) continue;
        const abs = path.resolve(raw);
        roots.add(abs);
        try { roots.add(fs.realpathSync(abs)); } catch { /* la variante realpath es opcional */ }
    }
    return [...roots];
}

/** production | development | test — el modo gobierna qué overrides se admiten. */
export function resolveRuntimeMode(env = process.env) {
    if (env.NODE_ENV === 'test') return 'test';
    if (env.NODE_ENV === 'production') return 'production';
    return 'development';
}

/**
 * Resolver de la fuente de usuarios. PURO: no lanza, no toca el filesystem
 * salvo para normalizar rutas temporales. Devuelve la decisión completa para
 * que el guard de arranque y los tests compartan exactamente la misma regla.
 *
 * Reglas (CHP-ID-CANON-01B) — no existe fallback en ningún modo:
 *
 *   production  → la ruta efectiva debe ser EXACTAMENTE
 *                 /app/data-critical/usuarios_colegios_oro.json.
 *   development → exclusivamente el canónico del repositorio. El padrón legacy
 *                 NO es un seed admisible, y no se acepta una tercera fuente.
 *   test        → override admitido SOLO dentro de un directorio temporal de
 *                 fixtures. Nunca data/, data-critical/, uploads/ ni el legacy.
 *
 * @returns {{ok:boolean, path:string, mode:string, reason:string}}
 */
export function resolveUsersDb(env = process.env) {
    const mode      = resolveRuntimeMode(env);
    const override  = typeof env.USERS_DB === 'string' && env.USERS_DB.trim() ? env.USERS_DB.trim() : null;
    const effective = path.resolve(override || USERS_DB_CANONICAL_DEFAULT);
    const deny = (reason) => ({ ok: false, path: effective, mode, reason });

    if (mode === 'production') {
        return samePath(effective, CONTAINER_CANONICAL_USERS_DB)
            ? { ok: true, path: effective, mode, reason: 'container_canonical' }
            : deny(samePath(effective, USERS_DB_LEGACY_NON_CANONICAL)
                ? 'production_legacy_forbidden'
                : 'production_path_not_container_canonical');
    }

    if (mode === 'test') {
        if (!override) {
            // Un test que nunca toca identidad no necesita fixture; se queda en
            // el canónico, que no se crea ni se escribe.
            return { ok: true, path: effective, mode, reason: 'test_no_override' };
        }
        if (samePath(effective, USERS_DB_LEGACY_NON_CANONICAL)) return deny('test_legacy_forbidden');
        if (REPO_DATA_DIRS.some(d => isInside(effective, d)))   return deny('test_real_store_forbidden');
        if (!tempRoots().some(r => isInside(effective, r)))      return deny('test_fixture_must_be_temporary');
        return { ok: true, path: effective, mode, reason: 'test_temp_fixture' };
    }

    // development
    if (samePath(effective, USERS_DB_CANONICAL_DEFAULT)) {
        return { ok: true, path: effective, mode, reason: 'repo_canonical' };
    }
    return deny(samePath(effective, USERS_DB_LEGACY_NON_CANONICAL)
        ? 'development_legacy_forbidden'
        : 'development_third_source_forbidden');
}

/** ¿La ruta resuelta es el padrón legacy no canónico? */
export function isLegacyNonCanonicalUsersDb(p) {
    return samePath(p, USERS_DB_LEGACY_NON_CANONICAL);
}

const EXPLAIN = Object.freeze({
    production_legacy_forbidden:
        'USERS_DB apunta al padrón LEGACY_NON_CANONICAL. En producción está prohibido.',
    production_path_not_container_canonical:
        `En producción USERS_DB debe ser exactamente ${CONTAINER_CANONICAL_USERS_DB}.`,
    development_legacy_forbidden:
        'El padrón legacy dejó de ser un seed de desarrollo admisible (CHP-ID-CANON-01B). '
        + 'Coloca el padrón canónico en data-critical/usuarios_colegios_oro.json.',
    development_third_source_forbidden:
        'En desarrollo solo se admite data-critical/usuarios_colegios_oro.json. '
        + 'No se permite una tercera fuente persistente.',
    test_legacy_forbidden:
        'Un test no puede resolver al padrón legacy real.',
    test_real_store_forbidden:
        'Un test no puede resolver a data/, data-critical/ ni uploads/ reales. Usa fs.mkdtemp.',
    test_fixture_must_be_temporary:
        'Con NODE_ENV=test, USERS_DB debe apuntar a un fixture dentro de un directorio temporal.',
});

/**
 * Guard de arranque: aplica la regla canónica y aborta si se viola. Se llama en
 * import-time para que ninguna ruta del runtime pueda saltárselo por olvido.
 */
export function assertCanonicalUsersDb(env = process.env) {
    const decision = resolveUsersDb(env);
    if (decision.ok) return decision;
    throw new CanonicalSourceError(
        `Fuente de usuarios no canónica (${decision.reason}). ${EXPLAIN[decision.reason] || ''}`,
        { mode: decision.mode, reason: decision.reason },
    );
}

/** Archivo JSON que es la única fuente de verdad de usuarios del sistema. */
export const USERS_DB = assertCanonicalUsersDb().path;

/**
 * Archivo JSON que es la única fuente de verdad de grupos (course/club).
 * Mismo default que server.js usa desde siempre; en producción el env puede
 * sobreescribirlo igual que USERS_DB. Los readers de identidad/scope (CIS)
 * deben resolver SIEMPRE vía esta constante, nunca por path hardcodeado
 * (CHP-ADR-01 §G.4/§I-1).
 */
export const GROUPS_DB = process.env.GROUPS_DB
    || path.resolve(__dirname, '../data/groups_db.json');

/**
 * Registro institucional (CHP-ID-GROUPS-RECON-01B).
 *
 * `schools_db.json` es la lista de organizaciones REGISTRADAS. Es la que
 * convierte un `organizationId` en autoridad: un grupo solo tiene scope
 * institucional si su `organizationId` aparece aquí. Sin registro no hay scope,
 * y jamás se deriva la organización del nombre del colegio en tiempo de
 * autorización.
 */
export const SCHOOLS_DB = process.env.SCHOOLS_DB
    || path.resolve(__dirname, '../data/schools_db.json');
