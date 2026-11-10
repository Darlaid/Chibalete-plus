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
