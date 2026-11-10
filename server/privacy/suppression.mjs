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
import path from 'node:path';
import { withFileLock } from '../usersLock.js';
import { normalizeMookStore, participantIds, suppressParticipant } from '../lib/experienceStore.js';

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
    const kinds = mediator ? ['A1', 'A2', 'C005'] : ['A1', 'A2'];
    appendDecisions(kinds.map((kind) => ({
        subjectId: userId, kind, status: 'revoked', actDay: requestDay,
        version: kind === 'C005' ? '005@1.0' : '004@1.0', medium: 'admin_record',
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
    const excluded = readRegistry(env);
    const gate = decisionGate(env, now);
    return (Array.isArray(users) ? users : [])
        .filter((u) => u?.id && (u.accountStatus ?? 'active') !== 'disabled')
        .filter((u) => excluded.has(tombstoneOf(u.id)) || gate.status('A1', u.id) === 'revoked')
        .map((u) => u.id);
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
export async function reapplyMookSuppressionsAfterRestore({ mookPath, holds = {} }, { env = process.env } = {}) {
    const excluded = readRegistry(env); // antes de tocar nada
    return mutateMookFile(mookPath, (doc) => {
        const targets = participantIds(doc).filter((id) => excluded.has(tombstoneOf(id)));
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
export async function reapplySubmissionSuppressionsAfterRestore({ submissionsPath }, { env = process.env } = {}) {
    const excluded = readRegistry(env);
    return mutateSubmissionsFile(submissionsPath, (rows) => {
        const kept = rows.filter((s) => !(s?.studentId && excluded.has(tombstoneOf(s.studentId))));
        return { changed: kept.length !== rows.length, rows: kept, ack: { submissionsRemoved: rows.length - kept.length } };
    });
}
