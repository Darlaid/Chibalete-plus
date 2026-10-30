/**
 * test-real-store-guard-sqlite.mjs — CHP-GAMIFICACION-SAFE-01.
 *
 * Puente ESM hacia el constructor de `better-sqlite3` ya envuelto por
 * `test-real-store-guard.mjs`. Solo lo usa el hook de ese guard.
 */
import { createRequire } from 'node:module';

const Database = createRequire(import.meta.url)('better-sqlite3');
export default Database;
export const SqliteError = Database.SqliteError;
