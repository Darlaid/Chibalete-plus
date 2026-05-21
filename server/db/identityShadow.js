/**
 * identityShadow.js — P1-A dual-write SHADOW (JSON sigue siendo source-of-truth).
 *
 * Tras cada write JSON de users/groups/access, se llama mirror*() que
 * RE-SINCRONIZA por completo la tabla SQLite contra el array JSON, dentro de
 * UNA transacción. Para 10/6/2 registros un full re-sync es trivial y
 * BULLETPROOF (cero drift posible: SQLite == JSON exacto tras cada write).
 *
 * raw_json guarda el registro JSON ÍNTEGRO → reconstrucción lossless: aunque
 * una columna normalizada quede mal mapeada, el dato original NUNCA se pierde.
 *
 * INVARIANTE DURO: estas funciones NUNCA lanzan ni bloquean. Un fallo de
 * espejo se loguea y se audita, pero el write JSON (verdad) ya ocurrió y no
 * se ve afectado. Quitar la llamada = volver a 100% JSON sin residuo.
 */

function normEmail(e) { return String(e ?? '').trim().toLowerCase(); }
function groupKey(g) {
    return `${g?.school ?? ''}::${g?.grade ?? ''}::${g?.name ?? ''}`;
}
function jstr(v) { try { return JSON.stringify(v ?? null); } catch { return 'null'; } }

function audit(db, domain, jsonCount, sqliteCount, ok, detail) {
    try {
        db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok,detail)
                    VALUES (?,?,?,?,?)`).run(domain, jsonCount, sqliteCount, ok ? 1 : 0, detail ?? null);
    } catch { /* la auditoría jamás rompe el flujo */ }
}

/** Full re-sync users JSON → SQLite. Idempotente, transaccional, no-throw. */
export function mirrorUsers(db, users, log = () => {}) {
    try {
        const arr = Array.isArray(users) ? users : [];
        const tx = db.transaction(() => {
            db.prepare(`UPDATE users SET deleted_at = datetime('now') WHERE deleted_at IS NULL`).run();
            const up = db.prepare(`
              INSERT INTO users(id,email_norm,email_raw,password,nombre_completo,nombre_usuario,
                roles_json,colegio,nivel_lectura,account_status,last_login_at,raw_json,updated_at,deleted_at)
              VALUES (@id,@email_norm,@email_raw,@password,@nombre_completo,@nombre_usuario,
                @roles_json,@colegio,@nivel_lectura,@account_status,@last_login_at,@raw_json,datetime('now'),NULL)
              ON CONFLICT(id) DO UPDATE SET
                email_norm=excluded.email_norm, email_raw=excluded.email_raw, password=excluded.password,
                nombre_completo=excluded.nombre_completo, nombre_usuario=excluded.nombre_usuario,
                roles_json=excluded.roles_json, colegio=excluded.colegio, nivel_lectura=excluded.nivel_lectura,
                account_status=excluded.account_status, last_login_at=excluded.last_login_at,
                raw_json=excluded.raw_json, updated_at=datetime('now'), deleted_at=NULL`);
            for (const u of arr) {
                if (!u || u.id == null) continue;
                up.run({
                    id: String(u.id), email_norm: normEmail(u.email), email_raw: u.email ?? null,
                    password: u.password ?? null, nombre_completo: u.nombre_completo ?? null,
                    nombre_usuario: u.nombre_usuario ?? null, roles_json: jstr(u.roles),
                    colegio: u.colegio ?? null, nivel_lectura: u.nivel_lectura ?? null,
                    account_status: u.accountStatus ?? null, last_login_at: u.lastLoginAt ?? null,
                    raw_json: jstr(u),
                });
            }
        });
        tx();
        const cnt = db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c;
        const ok = cnt === arr.filter(u => u && u.id != null).length;
        audit(db, 'users', arr.length, cnt, ok, ok ? null : 'count_mismatch');
        return ok;
    } catch (e) { log(`[identityShadow] users mirror failed: ${e.message}`); return false; }
}

/** Full re-sync groups + group_members JSON → SQLite. */
export function mirrorGroups(db, groups, log = () => {}) {
    try {
        const arr = Array.isArray(groups) ? groups : [];
        const tx = db.transaction(() => {
            db.prepare(`UPDATE groups SET deleted_at = datetime('now') WHERE deleted_at IS NULL`).run();
            db.prepare(`DELETE FROM group_members`).run();
            const ug = db.prepare(`
              INSERT INTO groups(group_key,name,school,grade,teacher_id,raw_json,updated_at,deleted_at)
              VALUES (@gk,@name,@school,@grade,@teacher_id,@raw_json,datetime('now'),NULL)
              ON CONFLICT(group_key) DO UPDATE SET
                name=excluded.name, school=excluded.school, grade=excluded.grade,
                teacher_id=excluded.teacher_id, raw_json=excluded.raw_json,
                updated_at=datetime('now'), deleted_at=NULL`);
            const um = db.prepare(`INSERT OR IGNORE INTO group_members(group_key,user_id,role)
                                   VALUES (?,?,?)`);
            for (const g of arr) {
                if (!g) continue;
                const gk = groupKey(g);
                ug.run({ gk, name: g.name ?? null, school: g.school ?? null,
                    grade: g.grade ?? null, teacher_id: g.teacherId ?? null, raw_json: jstr(g) });
                if (g.teacherId) um.run(gk, String(g.teacherId), 'teacher');
                for (const sid of (Array.isArray(g.studentIds) ? g.studentIds : [])) {
                    if (sid != null) um.run(gk, String(sid), 'student');
                }
            }
        });
        tx();
        const cnt = db.prepare(`SELECT COUNT(*) c FROM groups WHERE deleted_at IS NULL`).get().c;
        const ok = cnt === arr.filter(Boolean).length;
        audit(db, 'groups', arr.length, cnt, ok, ok ? null : 'count_mismatch');
        return ok;
    } catch (e) { log(`[identityShadow] groups mirror failed: ${e.message}`); return false; }
}

/** Full re-sync access_rules JSON → SQLite. */
export function mirrorAccess(db, rules, log = () => {}) {
    try {
        const arr = Array.isArray(rules) ? rules : [];
        const tx = db.transaction(() => {
            db.prepare(`UPDATE access_rules SET deleted_at = datetime('now') WHERE deleted_at IS NULL`).run();
            const up = db.prepare(`
              INSERT INTO access_rules(id,scope,scope_id,title_ids_json,collection_ids_json,
                expires_at,raw_json,updated_at,deleted_at)
              VALUES (@id,@scope,@scope_id,@title_ids,@collection_ids,@expires_at,@raw_json,datetime('now'),NULL)
              ON CONFLICT(id) DO UPDATE SET
                scope=excluded.scope, scope_id=excluded.scope_id, title_ids_json=excluded.title_ids_json,
                collection_ids_json=excluded.collection_ids_json, expires_at=excluded.expires_at,
                raw_json=excluded.raw_json, updated_at=datetime('now'), deleted_at=NULL`);
            arr.forEach((r, i) => {
                if (!r) return;
                up.run({
                    id: String(r.id ?? `idx_${i}`), scope: r.scope ?? null, scope_id: r.scopeId ?? null,
                    title_ids: jstr(r.titleIds), collection_ids: jstr(r.collectionIds),
                    expires_at: r.expiresAt ?? null, raw_json: jstr(r),
                });
            });
        });
        tx();
        const cnt = db.prepare(`SELECT COUNT(*) c FROM access_rules WHERE deleted_at IS NULL`).get().c;
        const ok = cnt === arr.filter(Boolean).length;
        audit(db, 'access', arr.length, cnt, ok, ok ? null : 'count_mismatch');
        return ok;
    } catch (e) { log(`[identityShadow] access mirror failed: ${e.message}`); return false; }
}
