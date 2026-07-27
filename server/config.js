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
 *   Las variables de entorno pueden omitirse; se usan rutas relativas
 *   al CWD del proceso. Setear en .env si necesitas apuntar a paths
 *   distintos durante debugging:
 *     UPLOADS_ROOT=/ruta/local/uploads
 *     USERS_DB=/ruta/local/usuarios.json
 *
 *   NOTA: PM2 NO gobierna producción. Si usas `pm2 start
 *   ecosystem.config.cjs` en local, el config respeta las mismas vars
 *   de entorno. Ver banner del archivo ecosystem.config.cjs.
 */

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
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
 * Resolver puro de la fuente de usuarios: env USERS_DB → canónico.
 *
 * NO hay fallback al legacy. Si el canónico no existe, server.js falla de
 * forma ruidosa (nunca degrada a otro padrón ni crea el archivo en otra ruta).
 * Se exporta como función para poder verificar la regla en tests sin depender
 * del entorno ambiente.
 */
export function resolveUsersDb(env = process.env) {
    return env.USERS_DB || USERS_DB_CANONICAL_DEFAULT;
}

/** ¿La ruta resuelta es el padrón legacy no canónico? */
export function isLegacyNonCanonicalUsersDb(p) {
    return path.resolve(p) === USERS_DB_LEGACY_NON_CANONICAL;
}

/** Archivo JSON que es la única fuente de verdad de usuarios del sistema. */
export const USERS_DB = resolveUsersDb();

/**
 * Archivo JSON que es la única fuente de verdad de grupos (course/club).
 * Mismo default que server.js usa desde siempre; en producción el env puede
 * sobreescribirlo igual que USERS_DB. Los readers de identidad/scope (CIS)
 * deben resolver SIEMPRE vía esta constante, nunca por path hardcodeado
 * (CHP-ADR-01 §G.4/§I-1).
 */
export const GROUPS_DB = process.env.GROUPS_DB
    || path.resolve(__dirname, '../data/groups_db.json');
