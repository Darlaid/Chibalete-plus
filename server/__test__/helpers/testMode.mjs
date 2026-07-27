/**
 * testMode.mjs — CHP-ID-CANON-01B.
 *
 * Import de side-effect que declara el modo test ANTES de que cualquier módulo
 * resuelva su configuración. `server/config.js` aplica la regla canónica en
 * import-time: fuera de NODE_ENV=test no admite ningún override de USERS_DB, y
 * dentro de test ignora el `USERS_DB` heredado del .env de la máquina para que
 * la suite no dependa del entorno de quien la ejecuta.
 *
 * Colócalo como PRIMER import del test:
 *
 *   import './helpers/testMode.mjs';
 *
 * Un test que además necesite un padrón propio debe inyectarlo explícitamente
 * hacia un directorio temporal (fs.mkdtemp), nunca hacia data/ o data-critical/.
 *
 * Además redirige los stores SQLite a un temporal por proceso SI el test no fijó
 * ya su propia ruta. Sin esto, un test que importa estáticamente los servicios
 * de analítica abre `data-critical/events.db` e `insights.db` reales: no cambia
 * su contenido, pero SÍ toca los `-shm` (better-sqlite3 lo hace de forma nativa,
 * fuera del alcance del guard de `fs`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

let sqliteTmp = null;
const tmpFor = (name) => {
    if (!sqliteTmp) sqliteTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_test_stores_'));
    return path.join(sqliteTmp, name);
};

for (const [key, file] of [
    ['EVENTS_SQLITE_PATH',   'events.db'],
    ['INSIGHTS_SQLITE_PATH', 'insights.db'],
    ['PROGRESS_SQLITE_PATH', 'progress.db'],
    ['ARCHIVE_SQLITE_PATH',  'events.archive.db'],
]) {
    if (!process.env[key]) process.env[key] = tmpFor(file);
}
