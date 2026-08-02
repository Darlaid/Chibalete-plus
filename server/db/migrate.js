/**
 * migrate.js — P1-A runner de migraciones versionadas, idempotente y
 * reversible. Cero dependencias (no Kysely todavía: overengineering para
 * 4 tablas; se introduce en fase de cutover de lectura si crece la query
 * surface). Mismo principio que el resto del repo: simple > clever.
 *
 * Formato: server/db/migrations/NNNN_name.sql con secciones `-- UP` y
 * `-- DOWN`. Se aplican en orden por nombre, dentro de UNA transacción por
 * migración, registradas en _migrations. Reaplicar = no-op (idempotente).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureMetaTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      version   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
}

function parseSql(raw) {
    const upIdx = raw.indexOf('-- UP');
    const downIdx = raw.indexOf('-- DOWN');
    if (upIdx === -1) return { up: raw, down: '' };
    const up = raw.slice(upIdx + 5, downIdx === -1 ? undefined : downIdx);
    const down = downIdx === -1 ? '' : raw.slice(downIdx + 7);
    return { up: up.trim(), down: down.trim() };
}

function listMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => /^\d{4}_.*\.sql$/.test(f))
        .sort();
}

/**
 * Aplica todas las migraciones pendientes. Idempotente.
 * @param {import('better-sqlite3').Database} db
 * @param {(msg:string)=>void} [log]
 * @param {{ until?: string }} [opts]  `until` detiene la aplicación DESPUÉS de
 *        esa versión (inclusive). Permite fijar una base en una versión
 *        concreta —los tests del contrato v1 lo usan para seguir ejercitando
 *        v1 después de que exista v2—. Sin `until` se aplica todo.
 * @returns {{ applied: string[], already: string[] }}
 */
export function runMigrations(db, log = () => {}, opts = {}) {
    ensureMetaTable(db);
    const done = new Set(db.prepare('SELECT version FROM _migrations').all().map(r => r.version));
    const applied = [], already = [];
    let stop = false;
    for (const file of listMigrations()) {
        const version = file.replace(/\.sql$/, '');
        if (stop) break;
        if (opts.until && version === opts.until) stop = true;
        if (done.has(version)) { already.push(version); continue; }
        const { up } = parseSql(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
        const tx = db.transaction(() => {
            db.exec(up);
            db.prepare('INSERT INTO _migrations(version) VALUES (?)').run(version);
        });
        tx();
        applied.push(version);
        log(`[identity-migrate] applied ${version}`);
    }
    return { applied, already };
}

/**
 * Rollback de la última migración aplicada (reversible).
 * @param {import('better-sqlite3').Database} db
 */
export function rollbackLast(db, log = () => {}) {
    ensureMetaTable(db);
    const row = db.prepare('SELECT version FROM _migrations ORDER BY version DESC LIMIT 1').get();
    if (!row) return null;
    const file = `${row.version}.sql`;
    const { down } = parseSql(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    const tx = db.transaction(() => {
        if (down) db.exec(down);
        db.prepare('DELETE FROM _migrations WHERE version = ?').run(row.version);
    });
    tx();
    log(`[identity-migrate] rolled back ${row.version}`);
    return row.version;
}
