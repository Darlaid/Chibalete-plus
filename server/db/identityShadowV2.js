/**
 * identityShadowV2.js — CHP-IDDB-02B-A. Espejo NO autoritativo del padrón JSON
 * sobre el esquema v2 de identity.db.
 *
 * Reglas que no se negocian:
 *   - El JSON es la autoridad. SQLite es un espejo; la lectura sigue en JSON.
 *   - El espejo se intenta SOLO después de que la escritura canónica JSON esté
 *     confirmada. Un fallo del espejo jamás revierte ni corrompe ese write.
 *   - Ningún fallo queda silencioso: cada operación se registra con su estado,
 *     y un fallo deja `FAILED_RECONCILABLE` para reparación determinística.
 *   - No se fabrican membresías, no se recrean identidades con tombstone y no
 *     entran cohortes sintéticas ni grupos legacy: la propia base lleva sus
 *     exclusiones (migration_exclusions) y el espejo las respeta.
 *
 * Es un espejo CONVERGENTE: recibe la instantánea canónica ya escrita y deriva
 * las operaciones necesarias para que SQLite acabe igual. Eso lo hace
 * idempotente por construcción —la misma instantánea produce las mismas
 * operation_id— sin necesidad de un log de eventos en el emisor.
 */
import crypto from 'node:crypto';
import { CREDENTIAL_FIELDS } from './identityUserDomains.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const h16 = (s) => sha(s).slice(0, 16);
const jstr = (v) => { try { return JSON.stringify(v ?? null); } catch { return 'null'; } };

export const SHADOW_TABLES = ['shadow_operations', 'shadow_state', 'reconciliation_runs'];
export const OP_STATUS = ['PENDING', 'APPLIED', 'NOOP_ALREADY_APPLIED', 'FAILED_RECONCILABLE'];

export class ShadowRejection extends Error {
    constructor(classification, message) {
        super(`${classification}: ${message}`);
        this.classification = classification;
    }
}

/** El espejo v2 exige el esquema v2 y su contabilidad de operaciones. */
export function assertShadowCapable(db) {
    const version = Number(db.pragma('user_version', { simple: true }));
    if (version < 2) return 'SCHEMA_NOT_V2';
    for (const t of SHADOW_TABLES) {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
        if (!row) return 'SHADOW_TABLES_MISSING';
    }
    return null;
}

function excludedHashes(db, entity) {
    return new Set(db.prepare(
        `SELECT reference_hash FROM migration_exclusions WHERE entity = ?`).all(entity)
        .map(r => r.reference_hash));
}

function tombstoneHashes(db) {
    return new Set(db.prepare(`SELECT legacy_identity_hash FROM identity_tombstones`).all()
        .map(r => r.legacy_identity_hash));
}

/** Identificador determinístico de una operación: misma intención, mismo id. */
export function operationId({ entityType, operationType, canonicalKey, sourceVersion }) {
    return 'op_' + sha([entityType, operationType, canonicalKey, sourceVersion].join('|')).slice(0, 24);
}

const ROLE_PRECEDENCE = [
    [/^admin(istrador)?$/i, 'administrador'],
    [/^(mediador|profesor|teacher|librarian|coordinator)$/i, 'mediador'],
    [/^lector$/i, 'lector'],
];

function globalRole(roles) {
    const list = Array.isArray(roles) ? roles.map(String) : [];
    for (const [re, role] of ROLE_PRECEDENCE) if (list.some(r => re.test(r.trim()))) return role;
    return null;
}

const STATUS_MAP = { active: 'active', activo: 'active', inactive: 'inactive',
    inactivo: 'inactive', disabled: 'inactive', suspended: 'suspended' };

function userStatus(v) {
    if (v === null || v === undefined || v === '') return 'active';
    return STATUS_MAP[String(v).trim().toLowerCase()] ?? null;
}

function sanitizeUser(u) {
    // CHP-IDDB-GAP2-01: la lista de material de credencial es COMPARTIDA
    // (identityUserDomains.CREDENTIAL_FIELDS) e incluye también los tokens de
    // reset/invitación: NINGÚN secreto puede persistir en raw_json aunque
    // aparezca en el registro físico. JSON sigue siendo credential authority.
    const out = {};
    for (const k of Object.keys(u).sort()) {
        if (CREDENTIAL_FIELDS.includes(k)) continue;
        out[k] = u[k];
    }
    return out;
}

/**
 * Compara el estado por dominio para rechazar una instantánea obsoleta.
 * @returns {'FRESH'|'SAME'|'STALE'}
 */
export function compareSourceVersion(db, domain, sourceVersion) {
    const row = db.prepare(`SELECT last_source_version, last_source_seq FROM shadow_state
                            WHERE domain = ?`).get(domain);
    if (!row) return 'FRESH';
    if (row.last_source_version === sourceVersion.hash) return 'SAME';
    if (Number(sourceVersion.seq) < Number(row.last_source_seq)) return 'STALE';
    return 'FRESH';
}

/**
 * @param {{countersOnly?:boolean}} [opts] `countersOnly` contabiliza el intento
 *        SIN mover la versión del dominio: una instantánea obsoleta o fallida
 *        no puede pasar por la última vista buena, o la siguiente instantánea
 *        legítima se leería como distinta.
 */
function bumpState(db, domain, sourceVersion, at, delta, opts = {}) {
    const cur = db.prepare(`SELECT * FROM shadow_state WHERE domain = ?`).get(domain);
    if (cur && opts.countersOnly) {
        db.prepare(`UPDATE shadow_state SET attempted_count=attempted_count+?, applied_count=applied_count+?,
                    noop_count=noop_count+?, failed_count=failed_count+?,
                    last_failure_class=COALESCE(?, last_failure_class) WHERE domain=?`)
            .run(delta.attempted, delta.applied, delta.noop, delta.failed,
                delta.lastFailure ?? null, domain);
        return;
    }
    if (!cur) {
        // Primer registro del dominio. Si el intento NO debe mover la versión
        // (instantánea obsoleta o fallida), se inserta con versión vacía: una
        // instantánea fallida jamás puede quedar como la última vista buena,
        // tampoco cuando es la primera que ve el dominio.
        const seed = opts.countersOnly
            ? { version: '', seq: 0 } : { version: sourceVersion.hash, seq: Number(sourceVersion.seq) };
        db.prepare(`INSERT INTO shadow_state(domain,last_source_version,last_source_seq,last_applied_at,
                    attempted_count,applied_count,noop_count,failed_count,last_failure_class)
                    VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(domain, seed.version, seed.seq, at,
                delta.attempted, delta.applied, delta.noop, delta.failed, delta.lastFailure ?? null);
        return;
    }
    db.prepare(`UPDATE shadow_state SET last_source_version=?, last_source_seq=?, last_applied_at=?,
                attempted_count=attempted_count+?, applied_count=applied_count+?,
                noop_count=noop_count+?, failed_count=failed_count+?,
                last_failure_class=COALESCE(?, last_failure_class) WHERE domain=?`)
        .run(sourceVersion.hash, Math.max(Number(sourceVersion.seq), Number(cur.last_source_seq)), at,
            delta.attempted, delta.applied, delta.noop, delta.failed, delta.lastFailure ?? null, domain);
}

function recordOp(db, op, at) {
    const existing = db.prepare(`SELECT status, attempt_count FROM shadow_operations
                                 WHERE operation_id = ?`).get(op.operation_id);
    if (existing) {
        // Solo se cuenta el intento (CHP-IDDB-02B-D-A). Antes se reescribía la
        // fila a PENDING con applied_at=NULL antes de saber qué se iba a hacer
        // con ella: las ramas de usuarios/grupos volvían a fijar el estado
        // después, pero las de MEMBRESÍAS y DESACTIVACIÓN se limitan a
        // `continue`, así que la operación quedaba colgada en PENDING para
        // siempre. Detectado en el canary sobre datos reales: 227 membresías
        // ya aplicadas figuraban como en vuelo tras volver a espejar.
        db.prepare(`UPDATE shadow_operations SET attempt_count=attempt_count+1
                    WHERE operation_id=?`).run(op.operation_id);
        return existing.status;
    }
    db.prepare(`INSERT INTO shadow_operations(operation_id,entity_type,operation_type,canonical_key_hash,
                canonical_source_version,status,attempt_count,applied_at,error_classification,writer_id,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(op.operation_id, op.entity_type, op.operation_type, op.canonical_key_hash,
            op.canonical_source_version, op.status, 1, op.applied_at,
            op.error_classification ?? null, op.writer_id, at);
    return null;
}

// ── Proyecciones canónicas ───────────────────────────────────────────────
/** Deriva de la instantánea JSON las filas que v2 debería contener. */
export function projectUsers(records, at, sourceVersion) {
    const rows = [], rejected = [];
    for (const u of (Array.isArray(records) ? records : [])) {
        const id = String(u?.id ?? '');
        if (!id) { rejected.push({ key: '(sin id)', reason: 'USER_WITHOUT_ID' }); continue; }
        if (u._loadtest_marker) { rejected.push({ key: id, reason: 'SYNTHETIC_COHORT' }); continue; }
        const email = String(u.email ?? '').trim();
        const role = globalRole(u.roles);
        const st = userStatus(u.accountStatus);
        if (!email || !role || !st) {
            rejected.push({ key: id, reason: !email ? 'USER_WITHOUT_EMAIL'
                : !role ? 'ROLE_UNMAPPABLE' : 'STATUS_UNMAPPABLE' });
            continue;
        }
        rows.push({
            canonical_id: id, legacy_identity_hash: h16(id), email_norm: email.toLowerCase(),
            email_raw: email, nombre_completo: u.nombre_completo ?? null,
            nombre_usuario: u.nombre_usuario ?? null, roles_json: jstr(u.roles ?? []),
            global_role: role, status: st, credential_excluded: 1,
            provenance: 'shadow_v2', source_version: sourceVersion.hash,
            raw_json: jstr(sanitizeUser(u)), created_at: at, updated_at: at, deleted_at: null,
        });
    }
    return { rows, rejected };
}

export function projectGroups(records, at) {
    const rows = [], rejected = [];
    for (const g of (Array.isArray(records) ? records : [])) {
        const id = String(g?.id ?? '');
        if (!id) { rejected.push({ key: '(sin id)', reason: 'GROUP_WITHOUT_ID' }); continue; }
        const oid = String(g.organizationId ?? '');
        if (!oid) { rejected.push({ key: id, reason: 'INSTITUTION_NOT_RESOLVED' }); continue; }
        const type = String(g.type ?? '');
        if (type !== 'course' && type !== 'club') {
            rejected.push({ key: id, reason: 'GROUP_TYPE_INVALID' }); continue;
        }
        rows.push({
            group_id: id, institution_id: oid, name: String(g.name ?? ''), type,
            status: 'active', grade_level: g.gradeLevel ?? g.grade ?? null,
            section: g.section ?? null, legacy_school: g.school ?? null,
            provenance: 'shadow_v2', raw_json: jstr(g),
            created_at: at, updated_at: at, deleted_at: null,
        });
    }
    return { rows, rejected };
}

const FIELD_ROLES = [['studentIds', 'member'], ['memberIds', 'member'],
                     ['mediatorIds', 'mediator'], ['teacherId', 'mediator']];

/** Membresías derivadas: (grupo, usuario, rol). Nunca se inventa ninguna. */
export function projectMemberships(groupRows, groupRecords, knownUserIds, at) {
    const byId = new Map(groupRows.map(g => [g.group_id, g]));
    const rows = [], rejected = [];
    const seen = new Set();
    for (const g of (Array.isArray(groupRecords) ? groupRecords : [])) {
        const gid = String(g?.id ?? '');
        const gr = byId.get(gid);
        if (!gr) continue;                       // grupo no espejado → sus membresías tampoco
        for (const [field, role] of FIELD_ROLES) {
            const raw = g[field];
            const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
            for (const x of list) {
                const uid = String(x);
                const key = `${gid}|${uid}|${role}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (!knownUserIds.has(uid)) { rejected.push({ key, reason: 'IDENTITY_NOT_IN_PADRON' }); continue; }
                rows.push({
                    membership_id: 'mem_' + h16(key), user_id: uid, group_id: gid,
                    institution_id: gr.institution_id, role, status: 'active',
                    provenance: 'shadow_v2', created_at: at, updated_at: at,
                });
            }
        }
    }
    return { rows, rejected };
}

export function projectInstitutions(records, at) {
    const rows = [], rejected = [];
    for (const s of (Array.isArray(records) ? records : [])) {
        const id = String(s?.id ?? '');
        if (!id) { rejected.push({ key: '(sin id)', reason: 'INSTITUTION_WITHOUT_ID' }); continue; }
        const name = String(s.name ?? '').trim();
        if (!name) { rejected.push({ key: id, reason: 'INSTITUTION_WITHOUT_NAME' }); continue; }
        rows.push({
            institution_id: id, official_name: name,
            name_norm: name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(),
            addressable: 0, status: 'active', provenance: 'shadow_v2',
            created_at: at, updated_at: at,
        });
    }
    return { rows, rejected };
}

// ── Espejo ───────────────────────────────────────────────────────────────
/**
 * Espeja una instantánea canónica ya confirmada en JSON.
 *
 * NUNCA lanza: devuelve un informe. El llamador (el hook) lo registra y sigue.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{domain:string, records:any[], sourceVersion:{hash:string,seq:number},
 *          writerId:string, at:string, groupsSnapshot?:any[]}} input
 */
export function mirrorSnapshotV2(db, input) {
    const { domain, records, sourceVersion, writerId, at } = input;
    const report = { domain, writerId, attempted: 0, applied: 0, noop: 0, failed: 0,
        rejected: [], status: 'APPLIED', classification: null, detail: null, operations: [] };

    const incapable = assertShadowCapable(db);
    if (incapable) {
        report.status = 'FAILED_RECONCILABLE';
        report.classification = incapable;
        report.failed = 1;
        return report;
    }
    const freshness = compareSourceVersion(db, domain, sourceVersion);
    if (freshness === 'STALE') {
        report.status = 'NOOP_ALREADY_APPLIED';
        report.classification = 'STALE_SNAPSHOT_IGNORED';
        report.noop = 1;
        bumpState(db, domain, sourceVersion, at,
            { attempted: 1, applied: 0, noop: 1, failed: 0 }, { countersOnly: true });
        return report;
    }

    try {
        const tx = db.transaction(() => {
            const excludedUsers = excludedHashes(db, 'user');
            const excludedGroups = excludedHashes(db, 'group');
            const tombs = tombstoneHashes(db);
            let projected, entityType, keyOf, upsert, activeKeys;

            if (domain === 'users') {
                entityType = 'user';
                projected = projectUsers(records, at, sourceVersion);
                projected.rows = projected.rows.filter(r => {
                    if (tombs.has(r.legacy_identity_hash)) {
                        report.rejected.push({ key: r.legacy_identity_hash, reason: 'TOMBSTONED_IDENTITY' });
                        return false;
                    }
                    if (excludedUsers.has(r.legacy_identity_hash)) {
                        report.rejected.push({ key: r.legacy_identity_hash, reason: 'EXCLUDED_BY_DISPOSITION' });
                        return false;
                    }
                    return true;
                });
                keyOf = (r) => r.canonical_id;
                activeKeys = new Set(projected.rows.map(keyOf));
                upsert = (r) => db.prepare(`
                    INSERT INTO users(canonical_id,legacy_identity_hash,email_norm,email_raw,nombre_completo,
                      nombre_usuario,roles_json,global_role,status,credential_excluded,provenance,
                      source_version,raw_json,created_at,updated_at,deleted_at)
                    VALUES (@canonical_id,@legacy_identity_hash,@email_norm,@email_raw,@nombre_completo,
                      @nombre_usuario,@roles_json,@global_role,@status,@credential_excluded,@provenance,
                      @source_version,@raw_json,@created_at,@updated_at,NULL)
                    ON CONFLICT(canonical_id) DO UPDATE SET
                      email_norm=excluded.email_norm, email_raw=excluded.email_raw,
                      nombre_completo=excluded.nombre_completo, nombre_usuario=excluded.nombre_usuario,
                      roles_json=excluded.roles_json, global_role=excluded.global_role,
                      status=excluded.status, provenance=excluded.provenance,
                      source_version=excluded.source_version, raw_json=excluded.raw_json,
                      updated_at=excluded.updated_at, deleted_at=NULL`).run(r);
            } else if (domain === 'institutions') {
                entityType = 'institution';
                projected = projectInstitutions(records, at);
                keyOf = (r) => r.institution_id;
                activeKeys = new Set(projected.rows.map(keyOf));
                upsert = (r) => {
                    const withGroups = db.prepare(
                        `SELECT COUNT(*) c FROM groups WHERE institution_id=? AND deleted_at IS NULL`)
                        .get(r.institution_id).c;
                    return db.prepare(`
                        INSERT INTO institutions(institution_id,official_name,name_norm,addressable,status,
                          provenance,created_at,updated_at)
                        VALUES (@institution_id,@official_name,@name_norm,@addressable,@status,@provenance,
                          @created_at,@updated_at)
                        ON CONFLICT(institution_id) DO UPDATE SET
                          official_name=excluded.official_name, name_norm=excluded.name_norm,
                          addressable=excluded.addressable, status=excluded.status,
                          provenance=excluded.provenance, updated_at=excluded.updated_at`)
                        .run({ ...r, addressable: withGroups > 0 ? 1 : 0 });
                };
            } else if (domain === 'groups') {
                entityType = 'group';
                projected = projectGroups(records, at);
                projected.rows = projected.rows.filter(r => {
                    if (excludedGroups.has(h16(r.group_id))) {
                        report.rejected.push({ key: h16(r.group_id), reason: 'EXCLUDED_BY_DISPOSITION' });
                        return false;
                    }
                    const inst = db.prepare(`SELECT 1 FROM institutions WHERE institution_id=?`)
                        .get(r.institution_id);
                    if (!inst) {
                        report.rejected.push({ key: h16(r.group_id), reason: 'INSTITUTION_NOT_REGISTERED' });
                        return false;
                    }
                    return true;
                });
                keyOf = (r) => r.group_id;
                activeKeys = new Set(projected.rows.map(keyOf));
                upsert = (r) => db.prepare(`
                    INSERT INTO groups(group_id,institution_id,name,type,status,grade_level,section,
                      legacy_school,provenance,raw_json,created_at,updated_at,deleted_at)
                    VALUES (@group_id,@institution_id,@name,@type,@status,@grade_level,@section,
                      @legacy_school,@provenance,@raw_json,@created_at,@updated_at,NULL)
                    ON CONFLICT(group_id) DO UPDATE SET
                      institution_id=excluded.institution_id, name=excluded.name, type=excluded.type,
                      status=excluded.status, grade_level=excluded.grade_level, section=excluded.section,
                      legacy_school=excluded.legacy_school, provenance=excluded.provenance,
                      raw_json=excluded.raw_json, updated_at=excluded.updated_at, deleted_at=NULL`).run(r);
            } else {
                report.status = 'NOOP_ALREADY_APPLIED';
                report.classification = 'DOMAIN_NOT_MIRRORED_IN_V2';
                report.noop = 1;
                bumpState(db, domain, sourceVersion, at,
                    { attempted: 0, applied: 0, noop: 1, failed: 0 });
                return;
            }

            // upserts
            for (const r of projected.rows) {
                const key = keyOf(r);
                const opId = operationId({ entityType, operationType: 'upsert',
                    canonicalKey: key, sourceVersion: sourceVersion.hash });
                const prev = recordOp(db, { operation_id: opId, entity_type: entityType,
                    operation_type: 'upsert', canonical_key_hash: h16(key),
                    canonical_source_version: sourceVersion.hash, status: 'PENDING',
                    applied_at: null, writer_id: writerId }, at);
                report.attempted++;
                if (prev === 'APPLIED' || prev === 'NOOP_ALREADY_APPLIED') {
                    db.prepare(`UPDATE shadow_operations SET status='NOOP_ALREADY_APPLIED', applied_at=?
                                WHERE operation_id=?`).run(at, opId);
                    report.noop++;
                    report.operations.push({ operation_id: opId, status: 'NOOP_ALREADY_APPLIED' });
                    continue;
                }
                upsert(r);
                db.prepare(`UPDATE shadow_operations SET status='APPLIED', applied_at=?
                            WHERE operation_id=?`).run(at, opId);
                report.applied++;
                report.operations.push({ operation_id: opId, status: 'APPLIED' });
            }
            for (const rj of projected.rejected) report.rejected.push(rj);

            // desactivación lógica de lo que ya no está en la instantánea
            if (domain === 'users' || domain === 'groups') {
                const table = domain === 'users' ? 'users' : 'groups';
                const col = domain === 'users' ? 'canonical_id' : 'group_id';
                const live = db.prepare(`SELECT ${col} k FROM ${table} WHERE deleted_at IS NULL`).all();
                for (const { k } of live) {
                    if (activeKeys.has(k)) continue;
                    const opId = operationId({ entityType, operationType: 'deactivate',
                        canonicalKey: k, sourceVersion: sourceVersion.hash });
                    const prev = recordOp(db, { operation_id: opId, entity_type: entityType,
                        operation_type: 'deactivate', canonical_key_hash: h16(k),
                        canonical_source_version: sourceVersion.hash, status: 'PENDING',
                        applied_at: null, writer_id: writerId }, at);
                    report.attempted++;
                    if (prev === 'APPLIED' || prev === 'NOOP_ALREADY_APPLIED') {
                        report.noop++; continue;
                    }
                    db.prepare(`UPDATE ${table} SET deleted_at=?, updated_at=? WHERE ${col}=?`).run(at, at, k);
                    db.prepare(`UPDATE shadow_operations SET status='APPLIED', applied_at=?
                                WHERE operation_id=?`).run(at, opId);
                    report.applied++;
                }
            }

            // membresías: derivadas de la instantánea de grupos, nunca inventadas
            if (domain === 'groups') {
                const knownUsers = new Set(db.prepare(
                    `SELECT canonical_id FROM users WHERE deleted_at IS NULL`).all().map(r => r.canonical_id));
                const mem = projectMemberships(projected.rows, records, knownUsers, at);
                const wanted = new Map(mem.rows.map(m => [m.membership_id, m]));
                const existing = db.prepare(`SELECT membership_id FROM memberships`).all()
                    .map(r => r.membership_id);
                for (const m of mem.rows) {
                    const opId = operationId({ entityType: 'membership', operationType: 'upsert',
                        canonicalKey: m.membership_id, sourceVersion: sourceVersion.hash });
                    const prev = recordOp(db, { operation_id: opId, entity_type: 'membership',
                        operation_type: 'upsert', canonical_key_hash: h16(m.membership_id),
                        canonical_source_version: sourceVersion.hash, status: 'PENDING',
                        applied_at: null, writer_id: writerId }, at);
                    report.attempted++;
                    if (prev === 'APPLIED' || prev === 'NOOP_ALREADY_APPLIED') { report.noop++; continue; }
                    db.prepare(`INSERT INTO memberships(membership_id,user_id,group_id,institution_id,role,
                                status,provenance,created_at,updated_at)
                                VALUES (@membership_id,@user_id,@group_id,@institution_id,@role,@status,
                                @provenance,@created_at,@updated_at)
                                ON CONFLICT(membership_id) DO UPDATE SET
                                  institution_id=excluded.institution_id, status=excluded.status,
                                  provenance=excluded.provenance, updated_at=excluded.updated_at`).run(m);
                    db.prepare(`UPDATE shadow_operations SET status='APPLIED', applied_at=?
                                WHERE operation_id=?`).run(at, opId);
                    report.applied++;
                }
                for (const id of existing) {
                    if (wanted.has(id)) continue;
                    db.prepare(`DELETE FROM memberships WHERE membership_id=?`).run(id);
                    report.applied++;
                    report.attempted++;
                }
                for (const rj of mem.rejected) report.rejected.push(rj);
            }

            // La contabilidad del dominio entra en la MISMA transacción que las
            // filas que describe (CHP-IDDB-02B-D-A). Antes se hacía después del
            // COMMIT y dentro del mismo try: con dos escritores, una contención
            // en ese UPDATE marcaba como FAILED_RECONCILABLE un espejo que YA
            // estaba confirmado, e insertaba una operación de fallo espuria.
            bumpState(db, domain, sourceVersion, at, { attempted: report.attempted,
                applied: report.applied, noop: report.noop, failed: 0 });
        });
        // BEGIN IMMEDIATE, no diferido (CHP-IDDB-02B-D-A). El cuerpo LEE antes
        // de ESCRIBIR (exclusiones, tombstones, padrón vivo), así que con una
        // transacción diferida SQLite tiene que ascender el lock de lectura a
        // escritura, y ese ascenso NO respeta `busy_timeout`: medido, falla en
        // 1 ms con SQLITE_BUSY en cuanto hay un segundo escritor. Tomando el
        // lock de escritura desde el principio, la contención se convierte en
        // una espera ACOTADA por `busy_timeout` (5 s, frente a los ~600 ms que
        // tarda la proyección completa de 247 identidades).
        tx.immediate();
    } catch (e) {
        report.status = 'FAILED_RECONCILABLE';
        report.classification = e instanceof ShadowRejection ? e.classification : 'MIRROR_WRITE_FAILED';
        // La clasificación sola no basta para diagnosticar un fallo con dos
        // escritores vivos. El mensaje de SQLite nombra tablas y restricciones,
        // nunca valores de fila, así que es seguro exponerlo al log operacional.
        // No se persiste: es diagnóstico en memoria para quien llama.
        report.detail = e.message;
        report.failed = 1;
        try {
            db.prepare(`INSERT INTO shadow_operations(operation_id,entity_type,operation_type,
                        canonical_key_hash,canonical_source_version,status,attempt_count,applied_at,
                        error_classification,writer_id,created_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(operation_id) DO UPDATE SET
                          status='FAILED_RECONCILABLE', attempt_count=attempt_count+1,
                          error_classification=excluded.error_classification`)
                .run('op_fail_' + h16(domain + sourceVersion.hash),
                    domain === 'institutions' ? 'institution' : domain === 'users' ? 'user' : 'group',
                    'upsert', h16(domain), sourceVersion.hash, 'FAILED_RECONCILABLE', 1, null,
                    report.classification, writerId, at);
            bumpState(db, domain, sourceVersion, at,
                { attempted: 1, applied: 0, noop: 0, failed: 1, lastFailure: report.classification },
                { countersOnly: true });
        } catch { /* la contabilidad del fallo jamás propaga */ }
    }

    try {
        db.prepare(`INSERT INTO shadow_audit(domain,json_count,sqlite_count,ok,detail)
                    VALUES (?,?,?,?,?)`)
            .run(domain, Array.isArray(records) ? records.length : 0, report.applied + report.noop,
                report.status === 'FAILED_RECONCILABLE' ? 0 : 1,
                report.classification ?? null);
    } catch { /* la auditoría jamás rompe el flujo */ }
    return report;
}

/** Telemetría agregada, sin identificadores ni marcas por usuario. */
export function shadowTelemetry(db) {
    const incapable = assertShadowCapable(db);
    if (incapable) return { available: false, classification: incapable };
    const rows = db.prepare(`SELECT domain, attempted_count, applied_count, noop_count, failed_count,
                             last_failure_class FROM shadow_state ORDER BY domain`).all();
    const pending = db.prepare(`SELECT COUNT(*) c FROM shadow_operations
                                WHERE status='FAILED_RECONCILABLE'`).get().c;
    const lastRecon = db.prepare(`SELECT completed_at, status FROM reconciliation_runs
                                  WHERE status='completed' ORDER BY completed_at DESC LIMIT 1`).get();
    return {
        available: true,
        domains: rows.map(r => ({ domain: r.domain, attempted: r.attempted_count,
            applied: r.applied_count, noops: r.noop_count, failures: r.failed_count,
            lastFailureClassification: r.last_failure_class ?? null })),
        pendingReconciliation: pending,
        lastSuccessfulReconciliation: lastRecon?.completed_at ?? null,
    };
}
