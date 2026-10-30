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
 *
 * CHP-GAMIFICACION-SAFE-01: además carga el guard de stores reales en este
 * proceso y lo hereda a todo subproceso (`NODE_OPTIONS`), apaga los flags que
 * podrían escribir en segundo plano y falla al salir si se bloqueó alguna
 * escritura, aunque el código bajo prueba la haya capturado. Las rutas fijas sin
 * variable (memoria de Leo, analytics, LU) quedan cubiertas por el guard.
 */
import '../../../scripts/test-real-store-guard.mjs';
import crypto from 'node:crypto';
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
    ['OFFLINE_ASSIGNMENT_DB_PATH', 'offline_assignments.db'],
    ['ROYALTIES_DB',         'royalties.db'],
    ['GAMIFICATION_DB',      'gamification.db'],
    ['GROUPS_DB',            'groups_db.json'],
    ['SCHOOLS_DB',           'schools_db.json'],
    ['LEO_EVIDENCE_DB',      'leo_evidence_db.json'],
]) {
    if (!process.env[key]) process.env[key] = tmpFor(file);
}

for (const flag of ['EXPERIENCE_EVENTS_BACKBONE_ENABLED', 'LEO_EVENTS_BACKBONE_ENABLED', 'ARCHIVE_ROTATION_ENABLED',
    'SNAPSHOT_HISTORY_ENABLED', 'AULA_VIVA_SCHEDULER_ENABLED']) delete process.env[flag];

const guardUrl = new URL('../../../scripts/test-real-store-guard.mjs', import.meta.url).href;
if (!(process.env.NODE_OPTIONS ?? '').includes('test-real-store-guard')) {
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${guardUrl}`.trim();
}

// PRIV-01B: clave de sujeto aleatoria, compartida con los subprocesos de esta prueba.
if (!process.env.CHP_TEST_SUBJECT_KEY) process.env.CHP_TEST_SUBJECT_KEY = crypto.randomBytes(32).toString('hex');
const subjectKeyUrl = new URL('./testSubjectKey.mjs', import.meta.url).href;
if (!process.env.NODE_OPTIONS.includes('testSubjectKey')) process.env.NODE_OPTIONS += ` --import ${subjectKeyUrl}`;
await import(subjectKeyUrl);

if (!process.env.REAL_STORE_GUARD_LOG) {
    const violations = tmpFor('real_store_violations.log');
    process.env.REAL_STORE_GUARD_LOG = violations;
    process.on('exit', () => {
        let found = '';
        try { found = fs.readFileSync(violations, 'utf8'); } catch { return; }
        if (!found) return;
        console.error(`\n[REAL_STORE_GUARD] escrituras bloqueadas en stores reales:\n${found}`);
        process.exitCode = 1;
    });
}
