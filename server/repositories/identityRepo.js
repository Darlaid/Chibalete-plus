/**
 * identityRepo.js — P1-A repository pattern (capa de LECTURA SQLite).
 *
 * NO se cablea a las rutas todavía (fase 3 = cutover de lectura, gated por
 * IDENTITY_READ='sqlite'). Devuelve los registros reconstruidos desde
 * raw_json → byte-equivalentes al JSON original (cero cambio de forma para
 * el resto del backend cuando se haga el cutover). Esto desacopla el storage
 * del consumidor sin reescribir server.js.
 */

function parseRaw(row) {
    if (!row || !row.raw_json) return null;
    try { return JSON.parse(row.raw_json); } catch { return null; }
}

export function makeIdentityRepo(db) {
    return {
        users: {
            all() {
                return db.prepare(`SELECT raw_json FROM users WHERE deleted_at IS NULL`)
                    .all().map(parseRaw).filter(Boolean);
            },
            byEmail(email) {
                const norm = String(email ?? '').trim().toLowerCase();
                return parseRaw(db.prepare(
                    `SELECT raw_json FROM users WHERE email_norm = ? AND deleted_at IS NULL`).get(norm));
            },
            byId(id) {
                return parseRaw(db.prepare(
                    `SELECT raw_json FROM users WHERE id = ? AND deleted_at IS NULL`).get(String(id)));
            },
        },
        groups: {
            all() {
                return db.prepare(`SELECT raw_json FROM groups WHERE deleted_at IS NULL`)
                    .all().map(parseRaw).filter(Boolean);
            },
            membershipsOfUser(userId) {
                return db.prepare(
                    `SELECT group_key, role FROM group_members WHERE user_id = ?`).all(String(userId));
            },
        },
        access: {
            all() {
                return db.prepare(`SELECT raw_json FROM access_rules WHERE deleted_at IS NULL`)
                    .all().map(parseRaw).filter(Boolean);
            },
            byScope(scope, scopeId) {
                return db.prepare(
                    `SELECT raw_json FROM access_rules
                     WHERE scope = ? AND scope_id = ? AND deleted_at IS NULL`)
                    .all(scope, scopeId).map(parseRaw).filter(Boolean);
            },
        },
        /** Verificación de consistencia JSON↔SQLite (gate del cutover). */
        consistencyReport() {
            return db.prepare(
                `SELECT domain, ok, json_count, sqlite_count, detail, ts
                 FROM shadow_audit ORDER BY id DESC LIMIT 20`).all();
        },
    };
}
