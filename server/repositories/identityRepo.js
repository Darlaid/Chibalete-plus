/**
 * identityRepo.js — capa de LECTURA SQLite de identidad.
 *
 * P1-A la creó para el esquema v1 (users por id JSON, groups con clave
 * sintética, group_members student/teacher). CHP-IDDB-02A añade la superficie
 * del esquema v2 (institución → grupo → membresía con rol, aliases,
 * tombstones) SIN romper el contrato existente:
 *
 *   - `users.all()`, `groups.all()`, `access.all()` siguen devolviendo los
 *     registros reconstruidos desde raw_json → el resto del backend no nota
 *     el origen (es lo que consume identityReadFacade).
 *   - `users.byId()` resuelve por la clave primaria de identidad, se llame
 *     `id` (v1) o `canonical_id` (v2).
 *   - `groups.membershipsOfUser()` devuelve el rol en cada grupo en ambas
 *     versiones; en v2 añade `group_id` e `institution_id`.
 *
 * NO se cablea a las rutas: el cutover de lectura sigue gated por
 * IDENTITY_READ='sqlite' + dominio permitido + shadow_audit ok.
 */

function parseRaw(row) {
    if (!row || !row.raw_json) return null;
    try { return JSON.parse(row.raw_json); } catch { return null; }
}

function detectSchemaVersion(db) {
    try {
        const v = db.pragma('user_version', { simple: true });
        if (Number(v) >= 2) return 2;
    } catch { /* pragma no disponible → se deduce por forma */ }
    try {
        const t = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='memberships'`).get();
        return t ? 2 : 1;
    } catch { return 1; }
}

export function makeIdentityRepo(db) {
    const version = detectSchemaVersion(db);
    const isV2 = version >= 2;
    const idCol = isV2 ? 'canonical_id' : 'id';

    const base = {
        /** Versión de esquema detectada (1 = legacy P1-A, 2 = modelo canónico). */
        schemaVersion() { return version; },

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
                    `SELECT raw_json FROM users WHERE ${idCol} = ? AND deleted_at IS NULL`).get(String(id)));
            },
        },
        groups: {
            all() {
                return db.prepare(`SELECT raw_json FROM groups WHERE deleted_at IS NULL`)
                    .all().map(parseRaw).filter(Boolean);
            },
            membershipsOfUser(userId) {
                if (!isV2) {
                    return db.prepare(
                        `SELECT group_key, role FROM group_members WHERE user_id = ?`).all(String(userId));
                }
                return db.prepare(
                    `SELECT group_id, institution_id, role, status
                     FROM memberships WHERE user_id = ? ORDER BY group_id, role`).all(String(userId));
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

    if (!isV2) return base;

    // ── Superficie v2 ─────────────────────────────────────────────────────
    return {
        ...base,
        users: {
            ...base.users,
            /** Fila canónica (sin raw_json) para consumidores del modelo v2. */
            record(id) {
                return db.prepare(
                    `SELECT canonical_id, email_norm, global_role, status, provenance, source_version
                     FROM users WHERE canonical_id = ? AND deleted_at IS NULL`).get(String(id)) ?? null;
            },
            count() {
                return db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c;
            },
        },
        institutions: {
            all() {
                return db.prepare(
                    `SELECT institution_id, official_name, addressable, status, provenance
                     FROM institutions ORDER BY official_name`).all();
            },
            byId(id) {
                return db.prepare(
                    `SELECT institution_id, official_name, addressable, status, provenance
                     FROM institutions WHERE institution_id = ?`).get(String(id)) ?? null;
            },
            /** Grupos de una institución. Puede ser [] — una institución válida
             *  puede existir con cero grupos (01C-R1). */
            groupsOf(id) {
                return db.prepare(
                    `SELECT group_id, name, type, status FROM groups
                     WHERE institution_id = ? AND deleted_at IS NULL ORDER BY group_id`).all(String(id));
            },
        },
        groupsV2: {
            byId(id) {
                return db.prepare(
                    `SELECT group_id, institution_id, name, type, status, legacy_school
                     FROM groups WHERE group_id = ? AND deleted_at IS NULL`).get(String(id)) ?? null;
            },
            membersOf(groupId, role = null) {
                return role
                    ? db.prepare(`SELECT user_id, role FROM memberships
                                  WHERE group_id = ? AND role = ? ORDER BY user_id`).all(String(groupId), role)
                    : db.prepare(`SELECT user_id, role FROM memberships
                                  WHERE group_id = ? ORDER BY user_id, role`).all(String(groupId));
            },
        },
        aliases: {
            /** Resuelve un alias legacy a una identidad o a un tombstone, nunca a ambos. */
            resolve(legacyAlias) {
                const row = db.prepare(
                    `SELECT legacy_alias, user_id, tombstone_id, status
                     FROM identity_aliases WHERE legacy_alias = ? AND status = 'active'`)
                    .get(String(legacyAlias));
                if (!row) return null;
                return {
                    target: row.user_id ? 'user' : 'tombstone',
                    userId: row.user_id ?? null,
                    tombstoneId: row.tombstone_id ?? null,
                };
            },
            institution(aliasNormalized) {
                return db.prepare(
                    `SELECT institution_id FROM institution_aliases
                     WHERE alias_normalized = ? AND status = 'active'`).get(String(aliasNormalized)) ?? null;
            },
        },
        tombstones: {
            byHash(hash) {
                return db.prepare(
                    `SELECT tombstone_id, legacy_identity_hash, classification, reference_count,
                            authentication_allowed, first_seen_at, last_seen_at, policy_version
                     FROM identity_tombstones WHERE legacy_identity_hash = ?`).get(String(hash)) ?? null;
            },
            all() {
                return db.prepare(
                    `SELECT tombstone_id, classification, reference_count, authentication_allowed
                     FROM identity_tombstones ORDER BY tombstone_id`).all();
            },
            /** Invariante: jamás autenticable. Se comprueba leyendo, no asumiendo. */
            anyAuthenticable() {
                return db.prepare(
                    `SELECT COUNT(*) c FROM identity_tombstones WHERE authentication_allowed <> 0`).get().c > 0;
            },
        },
        memberships: {
            count() { return db.prepare(`SELECT COUNT(*) c FROM memberships`).get().c; },
            ofUser(userId) { return base.groups.membershipsOfUser(userId); },
        },
        migration: {
            runs() {
                return db.prepare(
                    `SELECT run_id, schema_version, plan_hash, status, counts_json,
                            error_classification, started_at, completed_at
                     FROM migration_runs ORDER BY started_at, run_id`).all();
            },
            exclusions() {
                return db.prepare(
                    `SELECT entity, disposition, COUNT(*) n FROM migration_exclusions
                     GROUP BY entity, disposition ORDER BY entity, disposition`).all();
            },
        },
    };
}
