/**
 * suppression.mjs — CHP-V8.1-CLOSE-07B (G-05).
 *
 * Supresión de una cuenta a petición de su titular o representante (001 §13,
 * 006 P06/P09), separada de una baja comercial o de una desactivación temporal.
 * Solo la ejecuta Administración técnica (AT) con la referencia del trámite. No
 * hay ruta HTTP: el operador la invoca por stdin y después elimina la cuenta con
 * la operación administrativa existente (`DELETE /api/users/:id`).
 *
 * Reutiliza lo existente:
 *  - gamificación: `excludeUser` (desvincula y deja un tombstone sin id en el
 *    registro de exclusiones, que no se restaura con los respaldos); sin base de
 *    gamificación, solo el tombstone;
 *  - registro de decisiones: A1, A2 y C005 `revoked`, con la fecha del trámite.
 *    Nada se borra: la historia queda append-only.
 *
 * Tras restaurar el padrón desde un respaldo, `accountsToRestrictAfterRestore`
 * lista las cuentas que no pueden volver a servicio (tombstone o A1 revocada),
 * para que AT las desactive antes de reabrir (001 §11.11).
 */
import crypto from 'node:crypto';
import { appendDecisions, decisionGate, dayOf } from './a2Registry.mjs';
import { appendRegistry, readRegistry, tombstoneOf } from '../gamification/exclusions.mjs';
import { excludeUser } from '../gamification/erasure.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { withFileLock } from '../usersLock.js';
import { normalizeMookStore, participantIds, suppressParticipant } from '../lib/experienceStore.js';
import { ACCEPTANCE_DOCUMENTS } from '../../utils/acceptanceDocuments.mjs';

const REF_RX = /^[A-Za-z0-9._:-]{1,128}$/;
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const bad = (code) => Object.assign(new Error(code), { code });

/**
 * @param {import('better-sqlite3').Database|null} db  base de gamificación, o null si no existe
 * @param {{ userId: string, requestRef: string, requestDay: string, capacity: 'titular'|'legal_representative', mediator?: boolean }} req
 * @returns acuse sin datos personales
 */
export function suppressAccount(db, { userId, requestRef, requestDay, capacity, mediator = false } = {}, { env = process.env, now = Date.now() } = {}) {
    if (typeof userId !== 'string' || !userId) throw bad('INVALID_USER');
    if (typeof requestRef !== 'string' || !REF_RX.test(requestRef)) throw bad('INVALID_REQUEST_REF');
    if (typeof requestDay !== 'string' || !DAY_RX.test(requestDay) || requestDay > dayOf(now)) throw bad('INVALID_ACT_DATE');
    if (!['titular', 'legal_representative'].includes(capacity)) throw bad('INVALID_CAPACITY');
    // 1. Gamificación: desvincular (o, sin base, dejar solo la constancia contra reactivaciones).
    let gamification;
    if (db) {
        const ack = excludeUser(db, { userId, requestRef, env, now });
        gamification = { tombstoned: true, unlinked: ack.unlinked };
    } else {
        const tombstone = tombstoneOf(userId);
        const present = readRegistry(env).has(tombstone);
        if (!present) appendRegistry({ id: crypto.randomUUID(), tombstone, day: dayOf(now) }, env);
        gamification = { tombstoned: true, unlinked: false };
    }
    // 2. Decisiones: retiradas desde la fecha del trámite.
    // V8.1-CLOSE-09A: también T (002): termina la relación con la plataforma. T revocada junto
    // con el tombstone es la marca de SUPRESIÓN; un tombstone solo (retiro de XP, PRIV-C7) no
    // lo es y nunca dispara borrados tras una restauración. Solo este operador revoca T.
    const kinds = mediator ? ['T', 'A1', 'A2', 'C005'] : ['T', 'A1', 'A2'];
    const versionOf = { T: ACCEPTANCE_DOCUMENTS.terms.version, C005: '005@1.0' };
    appendDecisions(kinds.map((kind) => ({
        subjectId: userId, kind, status: 'revoked', actDay: requestDay,
        version: versionOf[kind] ?? '004@1.0', medium: 'admin_record',
        capacity: kind === 'C005' ? 'mediator' : capacity, verification: 'verified', requestRef,
    })), { env, now });
    return { ...gamification, decisionsRevoked: kinds };
}

/**
 * Cuentas de un padrón restaurado que no pueden volver a servicio: excluidas
 * (tombstone) o con A1 revocada. Solo lectura. Devuelve ids para que AT las
 * desactive; nunca se escriben en ningún archivo.
 * @throws EXCLUSION_REGISTRY_UNAVAILABLE | A2_REGISTRY_UNAVAILABLE
 */
export function accountsToRestrictAfterRestore(users, { env = process.env, now = Date.now() } = {}) {
    const { toDelete, toDisable } = restoreActions(users, { env, now });
    return [...toDelete, ...toDisable];
}

/**
 * V8.1-CLOSE-09A — supresión ≠ retiro de XP. Suprimida = tombstone (registro de exclusiones)
 * Y T revocada (registro de decisiones); los dos registros quedan fuera de los respaldos.
 * Un tombstone sin T revocada es un retiro de XP: la cuenta y sus datos siguen.
 * @throws EXCLUSION_REGISTRY_UNAVAILABLE | A2_REGISTRY_UNAVAILABLE
 */
export function suppressionGate({ env = process.env, now = Date.now() } = {}) {
    const excluded = readRegistry(env);
    const gate = decisionGate(env, now);
    return { isSuppressed: (id) => typeof id === 'string' && !!id && excluded.has(tombstoneOf(id)) && gate.status('T', id) === 'revoked', gate };
}

/**
 * Padrón restaurado: `toDelete` = personas suprimidas presentes (aunque estén desactivadas: se
 * vuelven a eliminar con `DELETE /api/users/:id`); `toDisable` = A1 revocada sin supresión.
 * Solo lectura; los ids nunca se escriben en ningún archivo.
 */
export function restoreActions(users, { env = process.env, now = Date.now() } = {}) {
    const { isSuppressed, gate } = suppressionGate({ env, now });
    const list = (Array.isArray(users) ? users : []).filter((u) => u?.id);
    const toDelete = list.filter((u) => isSuppressed(u.id)).map((u) => u.id);
    const toDisable = list.filter((u) => !isSuppressed(u.id) && (u.accountStatus ?? 'active') !== 'disabled' && gate.status('A1', u.id) === 'revoked').map((u) => u.id);
    return { toDelete, toDisable };
}

// ─── V8.1-CLOSE-08A (G-08) — fuentes MOOK ────────────────────────────────────

/** Lectura-modificación-escritura de `mook_db.json` con el MISMO lock y escritura atómica que `mutateMook`. */
async function mutateMookFile(mookPath, fn) {
    return withFileLock(mookPath, () => {
        const doc = normalizeMookStore(JSON.parse(fs.readFileSync(mookPath, 'utf8')));
        const out = fn(doc);
        const tmp = path.join(path.dirname(mookPath), `.${path.basename(mookPath)}.${process.pid}.${Date.now()}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
        fs.renameSync(tmp, mookPath);
        return out;
    }, 'mookLock');
}

/**
 * Paso MOOK de una supresión verificada (después de `suppressAccount`): elimina los
 * recorridos y producciones de la persona, conserva solo lo que una orden escrita
 * de Dirección retiene (`hold`) y seudonimiza su id de revisor en lo ajeno.
 * @returns acuse sin ids
 */
export async function suppressMookParticipant({ mookPath, userId, requestRef, hold = null }) {
    if (typeof requestRef !== 'string' || !REF_RX.test(requestRef)) throw bad('INVALID_REQUEST_REF');
    if (hold && hold.ref !== undefined && !REF_RX.test(hold.ref)) throw bad('INVALID_HOLD');
    return mutateMookFile(mookPath, (doc) => suppressParticipant(doc, userId, { hold }));
}

/**
 * Tras restaurar `mook_db.json` desde un respaldo: vuelve a aplicar la supresión a
 * toda persona con constancia en el registro de exclusiones. `holds` (de G.1) mantiene
 * las conservaciones vigentes: `{ [userId]: { evidenceIds, ref, until } }`.
 * Registro no verificable ⇒ error y nada se escribe.
 * @returns acuse: personas tratadas y recuentos agregados, sin ids
 */
export async function reapplyMookSuppressionsAfterRestore({ mookPath, holds = {} }, { env = process.env, now = Date.now() } = {}) {
    const { isSuppressed } = suppressionGate({ env, now }); // antes de tocar nada; solo supresiones, nunca retiros de XP
    return mutateMookFile(mookPath, (doc) => {
        const targets = participantIds(doc).filter(isSuppressed);
        const total = { participants: targets.length, evidenceRemoved: 0, runsRemoved: 0, evidenceHeld: 0, reviewerRefsPseudonymized: 0 };
        for (const id of targets) {
            const r = suppressParticipant(doc, id, { hold: holds[id] ?? null });
            for (const k of Object.keys(r)) total[k] += r[k];
        }
        return total;
    });
}

// ─── V8.1-CLOSE-08A (G-08) — entregas de tareas (`submissions_db.json`, D4) ───
async function mutateSubmissionsFile(submissionsPath, fn) {
    return withFileLock(submissionsPath, () => {
        let rows = [];
        try { rows = JSON.parse(fs.readFileSync(submissionsPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const out = fn(Array.isArray(rows) ? rows : []);
        if (out.changed) {
            const tmp = path.join(path.dirname(submissionsPath), `.${path.basename(submissionsPath)}.${process.pid}.${Date.now()}.tmp`);
            fs.writeFileSync(tmp, JSON.stringify(out.rows, null, 2));
            fs.renameSync(tmp, submissionsPath);
        }
        return out.ack;
    }, 'submissionsLock');
}

/** Elimina las entregas de tareas de la persona (mismo lock que `mutateSubmissions`). Acuse sin ids. */
export async function suppressSubmissions({ submissionsPath, userId, requestRef }) {
    if (typeof requestRef !== 'string' || !REF_RX.test(requestRef)) throw bad('INVALID_REQUEST_REF');
    if (typeof userId !== 'string' || !userId) throw bad('INVALID_USER');
    return mutateSubmissionsFile(submissionsPath, (rows) => {
        const kept = rows.filter((s) => s?.studentId !== userId);
        return { changed: kept.length !== rows.length, rows: kept, ack: { submissionsRemoved: rows.length - kept.length } };
    });
}

/** Tras restaurar `submissions_db.json`: vuelve a eliminar las de toda persona con constancia de exclusión. */
export async function reapplySubmissionSuppressionsAfterRestore({ submissionsPath }, { env = process.env, now = Date.now() } = {}) {
    const { isSuppressed } = suppressionGate({ env, now });
    return mutateSubmissionsFile(submissionsPath, (rows) => {
        const kept = rows.filter((s) => !(s?.studentId && isSuppressed(s.studentId)));
        return { changed: kept.length !== rows.length, rows: kept, ack: { submissionsRemoved: rows.length - kept.length } };
    });
}

// ─── V8.1-CLOSE-09A (G-08) — fuentes residuales ──────────────────────────────
//
// events.db / events.archive.db, progress.db / progress_db.json, leo_*, user_audit_log.json,
// access_db.json e identity.db. Mismos archivos, locks y escritura atómica que el servidor;
// nada nuevo que desplegar. Criterio por fuente (detalle en el documento de CLOSE-09A):
//  - lo que solo sirve al servicio de la persona ⇒ se ELIMINA (eventos propios, progreso, Leo);
//  - registros de responsabilidad de terceros ⇒ se CONSERVAN sin identificar a la persona:
//    su id pasa a SUPPRESSED_SUBJECT, un marcador constante y no enlazable (auditoría,
//    eventos de un mediador que la mencionan);
//  - regla B2C de su pedido ⇒ se CONSERVA sin titular y vencida: borrarla reabriría la cuenta
//    ante un reenvío firmado del mismo pedido (idempotencia por id de regla);
//  - identity.db ⇒ fila dada de baja sin correo, nombre ni raw_json; sin membresías.
// Ninguna de esas conservaciones se declara anonimización: quedan pendientes de validación
// jurídica (C03/C07/C10) y sujetas a su plazo.

export const SUPPRESSED_SUBJECT = 'suppressed-subject';
const PERSONAL_DETAIL_KEYS = ['email', 'nombre_completo', 'nombre_usuario', 'colegio', 'telefono', 'phone', 'fullName'];

const readJsonIfExists = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
};
const atomicWrite = (file, data) => {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
};
/** RMW bajo el lock del archivo (mismo `withFileLock` que el servidor). Sin archivo ⇒ null. */
async function rewriteJson(file, fn) {
    if (!file || !fs.existsSync(file)) return null;
    return withFileLock(file, () => {
        const doc = readJsonIfExists(file);
        if (doc === undefined) return null;
        const r = fn(doc);
        if (r.changed) atomicWrite(file, r.doc ?? doc);
        return r.ack;
    });
}
const openSqlite = (file) => {
    if (!file || !fs.existsSync(file)) return null;
    const db = new Database(file, { fileMustExist: true });
    db.pragma('busy_timeout = 10000');
    // Lo que borra o reescribe ESTA conexión se sobrescribe con ceros (no queda en páginas libres).
    db.pragma('secure_delete = ON');
    return db;
};
// V8.1-CLOSE-09B: la supresión lógica NUNCA bloquea a las réplicas: checkpoint PASSIVE al cerrar.
// Las copias antiguas que dejaron las conexiones del servidor (sin secure_delete) en páginas
// libres se eliminan con `compactAfterSuppression`, una operación aparte y controlada.
const closeScrub = (db) => { try { db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* sin efecto */ } db.close(); };
const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const columnsOf = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
const swapId = (v, userId) => (v === userId ? SUPPRESSED_SUBJECT : Array.isArray(v) ? v.map((x) => (x === userId ? SUPPRESSED_SUBJECT : x)) : v);

/** Rutas reales, con los mismos valores por defecto que el servidor. */
export function residualPaths(env = process.env, appRoot = '/app') {
    const data = env.CHP_DATA_DIR || path.join(appRoot, 'data');
    return {
        eventsDb: env.EVENTS_SQLITE_PATH || path.join(appRoot, 'data-critical', 'events.db'),
        archiveDb: env.ARCHIVE_SQLITE_PATH || path.join(appRoot, 'data-critical', 'events.archive.db'),
        progressDb: env.PROGRESS_SQLITE_PATH || path.join(appRoot, 'data', 'progress.db'),
        progressJson: path.join(data, 'progress_db.json'),
        leoMemory: path.join(data, 'leo_memory_db.json'),
        leoProfile: path.join(data, 'leo_profile_db.json'),
        leoInteractions: path.join(data, 'leo_interactions_db.json'),
        leoEvidence: env.LEO_EVIDENCE_DB || path.join(data, 'leo_evidence_db.json'),
        audit: env.USER_AUDIT_DB || path.join(data, 'user_audit_log.json'),
        access: env.ACCESS_DB || path.join(data, 'access_db.json'),
        identityDb: env.IDENTITY_DB || null,
        insightsDb: env.INSIGHTS_SQLITE_PATH || path.join(appRoot, 'data-critical', 'insights.db'),
    };
}

function treatEvents(file, userId) {
    const db = openSqlite(file);
    if (!db) return null;
    try {
        if (!hasTable(db, 'events')) return null;
        return db.transaction(() => {
            const own = db.prepare('DELETE FROM events WHERE user_id = ?').run(userId).changes;
            const needle = JSON.stringify(userId);
            const mentions = db.prepare('UPDATE events SET payload_json = replace(payload_json, ?, ?) WHERE instr(payload_json, ?) > 0')
                .run(needle, JSON.stringify(SUPPRESSED_SUBJECT), needle).changes;
            return { ownRemoved: own, mentionsPseudonymized: mentions };
        }).immediate();
    } finally { closeScrub(db); }
}

function treatProgressDb(file, userId) {
    const db = openSqlite(file);
    if (!db) return null;
    try {
        if (!hasTable(db, 'progress')) return null;
        const removed = db.prepare('DELETE FROM progress WHERE user_id = ?').run(userId).changes;
        return removed ? { removed, compactionPending: true } : { removed };
    }
    finally { closeScrub(db); }
}

/** Mapa `{ "<userId>__<contentId>": … }` (progreso legado y memoria de sesión de Leo). */
const dropKeyed = (map, userId) => {
    let n = 0;
    for (const k of Object.keys(map ?? {})) if (k.startsWith(`${userId}__`) || map[k]?.userId === userId) { delete map[k]; n++; }
    return n;
};

/**
 * V8.1-CLOSE-09B — insights.db (materializaciones de Aula Viva y pedagogía). Por columna, sin lista
 * fija de tablas: filas PERSONALES de la persona (`user_id`, `student_id`, ámbito `user`) se
 * eliminan; su id como mediador (`teacher_id`) o dentro de un JSON/nota de otra fila pasa a
 * SUPPRESSED_SUBJECT. Los agregados de grupo, colegio u organización no se tocan.
 */
const INSIGHT_TEXT_COL = /(_json|^notes$|^payload)/;
function treatInsights(file, userId) {
    const db = openSqlite(file);
    if (!db) return null;
    try {
        return db.transaction(() => {
            const out = { rowsRemoved: 0, refsPseudonymized: 0 };
            const needle = JSON.stringify(userId), marker = JSON.stringify(SUPPRESSED_SUBJECT);
            for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
                const cols = columnsOf(db, name);
                const own = [];
                if (cols.has('user_id')) own.push('user_id = @id');
                if (cols.has('student_id')) own.push('student_id = @id');
                for (const lvl of ['scope_type', 'scope_level']) if (cols.has(lvl) && cols.has('scope_id')) own.push(`(${lvl} = 'user' AND scope_id = @id)`);
                if (own.length) out.rowsRemoved += db.prepare(`DELETE FROM ${name} WHERE ${own.join(' OR ')}`).run({ id: userId }).changes;
                if (cols.has('teacher_id')) out.refsPseudonymized += db.prepare(`UPDATE ${name} SET teacher_id = ? WHERE teacher_id = ?`).run(SUPPRESSED_SUBJECT, userId).changes;
                for (const c of cols) if (INSIGHT_TEXT_COL.test(c)) out.refsPseudonymized += db.prepare(`UPDATE ${name} SET ${c} = replace(${c}, ?, ?) WHERE instr(${c}, ?) > 0`).run(needle, marker, needle).changes;
            }
            if (out.rowsRemoved + out.refsPseudonymized > 0) out.compactionPending = true;
            return out;
        }).immediate();
    } finally { closeScrub(db); }
}

function treatIdentity(file, userId, b2cRules) {
    const db = openSqlite(file);
    if (!db) return null;
    try {
        db.pragma('foreign_keys = ON');
        const at = new Date().toISOString();
        const r = db.transaction(() => {
            const out = { users: 0, memberships: 0, accessRules: 0 };
            if (hasTable(db, 'users')) {
                const cols = columnsOf(db, 'users');
                const key = cols.has('canonical_id') ? 'canonical_id' : 'id';
                const set = [];
                if (cols.has('email_norm')) set.push(`email_norm = '${SUPPRESSED_SUBJECT}:' || ${cols.has('legacy_identity_hash') ? 'legacy_identity_hash' : key}`);
                for (const c of ['email_raw', 'password', 'nombre_completo', 'nombre_usuario', 'colegio', 'nivel_lectura', 'last_login_at']) if (cols.has(c)) set.push(`${c} = NULL`);
                if (cols.has('raw_json')) set.push(`raw_json = '{}'`);
                if (cols.has('status')) set.push(`status = 'inactive'`);
                if (cols.has('account_status')) set.push(`account_status = 'disabled'`);
                if (cols.has('deleted_at')) set.push('deleted_at = COALESCE(deleted_at, @at)');
                if (cols.has('updated_at')) set.push('updated_at = @at');
                const pending = cols.has('email_norm') ? ` AND email_norm NOT LIKE '${SUPPRESSED_SUBJECT}:%'` : '';
                out.users = db.prepare(`UPDATE users SET ${set.join(', ')} WHERE ${key} = @id${pending}`).run({ id: userId, at }).changes;
            }
            if (hasTable(db, 'memberships')) out.memberships = db.prepare('DELETE FROM memberships WHERE user_id = ?').run(userId).changes;
            if (hasTable(db, 'group_members')) out.memberships += db.prepare('DELETE FROM group_members WHERE user_id = ?').run(userId).changes;
            if (hasTable(db, 'access_rules')) {
                for (const r of db.prepare('SELECT id FROM access_rules WHERE scope_id = ?').all(userId)) {
                    const kept = b2cRules.get(r.id);
                    if (kept) db.prepare('UPDATE access_rules SET scope_id = ?, raw_json = ?, expires_at = ? WHERE id = ?').run(SUPPRESSED_SUBJECT, JSON.stringify(kept), kept.expiresAt ?? null, r.id);
                    else db.prepare(`UPDATE access_rules SET scope_id = ?, raw_json = '{}', deleted_at = COALESCE(deleted_at, datetime('now')) WHERE id = ?`).run(SUPPRESSED_SUBJECT, r.id);
                    out.accessRules++;
                }
            }
            return out;
        }).immediate();
        if (r.users + r.memberships + r.accessRules > 0) r.compactionPending = true;
        return r;
    } finally { closeScrub(db); }
}

/**
 * Supresión en las fuentes residuales de UNA persona ya eliminada del padrón. Idempotente.
 * @returns acuse con recuentos por fuente, sin ids
 */
export async function suppressResidualSources(paths, userId, { now = Date.now() } = {}) {
    if (typeof userId !== 'string' || !userId || userId === SUPPRESSED_SUBJECT) throw bad('INVALID_USER');
    const ack = {};
    ack.events = treatEvents(paths.eventsDb, userId);
    ack.eventsArchive = treatEvents(paths.archiveDb, userId);
    ack.progress = treatProgressDb(paths.progressDb, userId);
    ack.progressLegacy = await rewriteJson(paths.progressJson, (d) => { const n = dropKeyed(d?.progressMap, userId); return { changed: n > 0, ack: { removed: n } }; });
    ack.leoMemory = await rewriteJson(paths.leoMemory, (d) => { const n = dropKeyed(d?.memoryMap, userId); return { changed: n > 0, ack: { removed: n } }; });
    ack.leoProfile = await rewriteJson(paths.leoProfile, (d) => {
        const had = !!d?.profileMap && Object.prototype.hasOwnProperty.call(d.profileMap, userId);
        if (had) delete d.profileMap[userId];
        return { changed: had, ack: { removed: had ? 1 : 0 } };
    });
    ack.leoInteractions = await rewriteJson(paths.leoInteractions, (d) => {
        const rows = Array.isArray(d) ? d : [];
        const kept = rows.filter((e) => e?.userId !== userId);
        return { changed: kept.length !== rows.length, doc: kept, ack: { removed: rows.length - kept.length } };
    });
    ack.leoEvidence = await rewriteJson(paths.leoEvidence, (d) => {
        const rows = Array.isArray(d?.entries) ? d.entries : [];
        const kept = rows.filter((e) => e?.userId !== userId);
        if (kept.length !== rows.length) d.entries = kept;
        return { changed: kept.length !== rows.length, ack: { removed: rows.length - kept.length } };
    });
    ack.audit = await rewriteJson(paths.audit, (d) => {
        const rows = Array.isArray(d) ? d : [];
        let n = 0;
        for (const e of rows) {
            if (!e || typeof e !== 'object') continue;
            const before = JSON.stringify(e);
            if (e.targetUserId === userId) {
                e.targetUserId = SUPPRESSED_SUBJECT;
                if (e.details && typeof e.details === 'object') for (const k of PERSONAL_DETAIL_KEYS) delete e.details[k];
            }
            if (e.actor === userId) e.actor = SUPPRESSED_SUBJECT;
            if (e.details && typeof e.details === 'object') for (const k of Object.keys(e.details)) e.details[k] = swapId(e.details[k], userId);
            if (JSON.stringify(e) !== before) n++;
        }
        return { changed: n > 0, ack: { entriesPseudonymized: n } };
    });
    const b2cRules = new Map();
    ack.access = await rewriteJson(paths.access, (d) => {
        if (!Array.isArray(d)) throw bad('ACCESS_STORE_INVALID');
        let removed = 0, kept = 0;
        const out = [];
        for (const r of d) {
            if (!(r?.scope === 'user' && r.scopeId === userId)) { out.push(r); continue; }
            if (r.b2c) {
                const exp = typeof r.expiresAt === 'number' ? Math.min(r.expiresAt, now) : now;
                const k = { ...r, scopeId: SUPPRESSED_SUBJECT, expiresAt: exp, b2c: { ...r.b2c, suppressedAt: now } };
                b2cRules.set(k.id, k); out.push(k); kept++;
            } else removed++;
        }
        return { changed: removed + kept > 0, doc: out, ack: { removed, b2cKeptWithoutSubject: kept } };
    });
    for (const r of (readJsonIfExists(paths.access) ?? [])) if (r?.b2c?.suppressedAt && r.scopeId === SUPPRESSED_SUBJECT) b2cRules.set(r.id, r);
    ack.identity = treatIdentity(paths.identityDb, userId, b2cRules);
    ack.insights = treatInsights(paths.insightsDb, userId);
    return ack;
}

/** Ids presentes en las fuentes residuales (para conciliar tras restaurar). Solo lectura. */
export function residualSubjectIds(paths) {
    const ids = new Set();
    const add = (v) => { if (typeof v === 'string' && v && v !== SUPPRESSED_SUBJECT) ids.add(v); };
    for (const [file, table] of [[paths.eventsDb, 'events'], [paths.archiveDb, 'events'], [paths.progressDb, 'progress']]) {
        const db = openSqlite(file);
        if (!db) continue;
        try { if (hasTable(db, table)) for (const r of db.prepare(`SELECT DISTINCT user_id u FROM ${table}`).all()) add(r.u); } finally { db.close(); }
    }
    const idb = openSqlite(paths.identityDb);
    if (idb) {
        try {
            if (hasTable(idb, 'users')) {
                const cols = columnsOf(idb, 'users');
                const key = cols.has('canonical_id') ? 'canonical_id' : 'id';
                const where = cols.has('email_norm') ? ` WHERE email_norm NOT LIKE '${SUPPRESSED_SUBJECT}:%'` : '';
                for (const r of idb.prepare(`SELECT ${key} u FROM users${where}`).all()) add(r.u);
            }
            if (hasTable(idb, 'access_rules')) for (const r of idb.prepare("SELECT DISTINCT scope_id u FROM access_rules WHERE scope = 'user'").all()) add(r.u);
        } finally { idb.close(); }
    }
    const idb2 = openSqlite(paths.insightsDb);
    if (idb2) {
        try {
            for (const { name } of idb2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
                const cols = columnsOf(idb2, name);
                for (const c of ['user_id', 'student_id', 'teacher_id']) if (cols.has(c)) for (const r of idb2.prepare(`SELECT DISTINCT ${c} u FROM ${name}`).all()) add(r.u);
                for (const lvl of ['scope_type', 'scope_level']) if (cols.has(lvl) && cols.has('scope_id')) for (const r of idb2.prepare(`SELECT DISTINCT scope_id u FROM ${name} WHERE ${lvl} = 'user'`).all()) add(r.u);
            }
        } finally { idb2.close(); }
    }
    const keyed = (m) => { for (const k of Object.keys(m ?? {})) add(k.split('__')[0]); };
    keyed(readJsonIfExists(paths.progressJson)?.progressMap);
    keyed(readJsonIfExists(paths.leoMemory)?.memoryMap);
    for (const k of Object.keys(readJsonIfExists(paths.leoProfile)?.profileMap ?? {})) add(k);
    for (const e of readJsonIfExists(paths.leoInteractions) ?? []) add(e?.userId);
    for (const e of readJsonIfExists(paths.leoEvidence)?.entries ?? []) add(e?.userId);
    for (const e of readJsonIfExists(paths.audit) ?? []) { add(e?.targetUserId); add(e?.actor); }
    for (const r of readJsonIfExists(paths.access) ?? []) if (r?.scope === 'user') add(r.scopeId);
    return ids;
}

/**
 * Tras restaurar: vuelve a aplicar la supresión residual a toda persona SUPRIMIDA (tombstone + T
 * revocada) que aparezca en alguna fuente o en `extraIds` (p. ej., el padrón restaurado). Nunca a
 * un retiro de XP. Registros no verificables ⇒ error y nada se escribe. Idempotente.
 * @returns { subjects, changes } recuentos sin ids; `changes` = 0 ⇒ nada pendiente
 */
export async function reapplyResidualAfterRestore(paths, { extraIds = [], env = process.env, now = Date.now() } = {}) {
    const { isSuppressed } = suppressionGate({ env, now }); // antes de tocar nada
    const candidates = new Set([...residualSubjectIds(paths), ...extraIds.filter((x) => typeof x === 'string')]);
    const targets = [...candidates].filter(isSuppressed);
    let changes = 0;
    const count = (o) => { for (const v of Object.values(o ?? {})) if (typeof v === 'number') changes += v; else if (v && typeof v === 'object') count(v); };
    for (const id of targets) count(await suppressResidualSources(paths, id, { now }));
    return { subjects: targets.length, changes };
}

// ─── V8.1-CLOSE-09B — compactación posterior y controlada ─────────────────────
//
// Separada de la supresión lógica, NUNCA por defecto. VACUUM toma el lock de escritura de la base
// durante toda la reconstrucción (las réplicas esperan su busy_timeout y pueden fallar), necesita
// espacio para una copia temporal y el WAL, y el checkpoint TRUNCATE bloquea escritores mientras
// espera a los lectores. Por eso:
//  - preflight de espacio (≥ minFreeFactor × base+WAL en su directorio; ≥ base en el temporal);
//  - quick_check y recuento de filas por tabla antes y después (integridad de lo NO suprimido);
//  - busy_timeout corto: si una réplica la ocupa ⇒ `busy`, sin cambios (VACUUM es transaccional:
//    una interrupción deja la base anterior intacta);
//  - `events*`: solo checkpoint TRUNCATE (sus filas no se reescriben; lo borrado por el operador ya
//    se sobrescribió con ceros), para vaciar del WAL las páginas antiguas.
// Se ejecuta en la cuarentena antes de promover, o en una ventana controlada en producción.
const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
const freeBytes = (dir, statfs) => { const st = statfs(dir); return Number(st.bavail) * Number(st.bsize); };
const userTables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);

export function compactAfterSuppression(paths, {
    vacuum = ['progressDb', 'identityDb', 'insightsDb'], checkpointOnly = ['eventsDb', 'archiveDb'],
    minFreeFactor = 2.5, busyTimeoutMs = 2000, statfs = fs.statfsSync, tmpDir = os.tmpdir(),
} = {}) {
    const out = {};
    for (const k of [...vacuum, ...checkpointOnly]) {
        const file = paths[k];
        if (!file || !fs.existsSync(file)) { out[k] = null; continue; }
        const bytesBefore = fileSize(file) + fileSize(`${file}-wal`);
        const full = vacuum.includes(k);
        if (full && (freeBytes(path.dirname(file), statfs) < Math.ceil(bytesBefore * minFreeFactor) || freeBytes(tmpDir, statfs) < bytesBefore)) {
            out[k] = { status: 'insufficient_space', bytesBefore };
            continue;
        }
        const db = new Database(file, { fileMustExist: true });
        try {
            db.pragma(`busy_timeout = ${busyTimeoutMs}`);
            if (full) {
                if (db.pragma('quick_check', { simple: true }) !== 'ok') { out[k] = { status: 'integrity_failed_before' }; continue; }
                const counts = () => JSON.stringify(userTables(db).map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n]));
                const before = counts();
                try { db.exec('VACUUM'); } catch (e) { out[k] = { status: e.code === 'SQLITE_BUSY' ? 'busy' : 'error', code: e.code ?? 'ERROR' }; continue; }
                const ck = db.pragma('wal_checkpoint(TRUNCATE)')[0] ?? {};
                const ok = db.pragma('quick_check', { simple: true }) === 'ok' && counts() === before;
                out[k] = { status: ok ? 'compacted' : 'integrity_failed_after', walTruncated: ck.busy === 0, bytesBefore, bytesAfter: fileSize(file) + fileSize(`${file}-wal`) };
            } else {
                const ck = db.pragma('wal_checkpoint(TRUNCATE)')[0] ?? {};
                out[k] = { status: ck.busy === 0 ? 'checkpointed' : 'busy', walTruncated: ck.busy === 0 };
            }
        } catch (e) {
            out[k] = { status: e.code === 'SQLITE_BUSY' ? 'busy' : 'error', code: e.code ?? 'ERROR' };
        } finally { db.close(); }
    }
    return out;
}
