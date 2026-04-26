/**
 * config.js — Rutas canónicas centralizadas del sistema Chibalete+
 *
 * PRODUCCIÓN (VPS):
 *   UPLOADS_ROOT  = /var/www/chibalete/public/uploads
 *   USERS_DB      = /var/www/chibalete/data-critical/usuarios_colegios_oro.json
 *
 * DESARROLLO LOCAL:
 *   Las variables de entorno pueden omitirse; se usarán las rutas relativas.
 *   Establecer en .env o en ecosystem.config.cjs:
 *     UPLOADS_ROOT=/var/www/chibalete/public/uploads
 *     USERS_DB=/var/www/chibalete/data-critical/usuarios_colegios_oro.json
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
