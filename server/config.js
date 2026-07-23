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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/** Directorio raíz de todos los uploads (PDFs, portadas, audios, activos de contenido). */
export const UPLOADS_ROOT = process.env.UPLOADS_ROOT
    || path.resolve(__dirname, '../public/uploads');

/** Archivo JSON que es la única fuente de verdad de usuarios del sistema. */
export const USERS_DB = process.env.USERS_DB
    || path.resolve(__dirname, '../data/users_db.json');

/**
 * Archivo JSON que es la única fuente de verdad de grupos (course/club).
 * Mismo default que server.js usa desde siempre; en producción el env puede
 * sobreescribirlo igual que USERS_DB. Los readers de identidad/scope (CIS)
 * deben resolver SIEMPRE vía esta constante, nunca por path hardcodeado
 * (CHP-ADR-01 §G.4/§I-1).
 */
export const GROUPS_DB = process.env.GROUPS_DB
    || path.resolve(__dirname, '../data/groups_db.json');
