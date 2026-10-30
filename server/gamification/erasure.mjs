/**
 * erasure.mjs — CHP-GAMIFICACION-PRIV-01D.
 *
 * Desvinculación de un sujeto y reaplicación tras una restauración. Sin
 * llamadores de producto: nada ejecuta una supresión real todavía.
 *
 * Orden: primero el registro (durable y fuera de la base), después una
 * transacción `IMMEDIATE` que anota el tombstone, extingue el saldo y borra el
 * vínculo. Si el proceso cae entre ambos, la puerta bloquea la ingesta hasta
 * reaplicar. El ledger conserva sus filas: sin sal ni vínculo, sus claves no se
 * pueden recalcular.
 */
import crypto from 'node:crypto';
import { GamificationError } from './db.mjs';
import { appendRegistry, readRegistry, tombstoneOf } from './exclusions.mjs';
import { extinguishSubject, periodsFor } from './ledger.mjs';
import { deleteSubject, findSubject, listSubjectsByTombstone } from './subjects.mjs';

const REF_RX = /^[A-Za-z0-9._:-]{1,128}$/;

function detachSubject(db, subjectRef, now) {
    const extinguished = extinguishSubject(db, subjectRef, { now });
    deleteSubject(db, subjectRef);
    return extinguished;
}

const recordErasure = (db, { id, tombstone, day, requestRef }) => db.prepare(
    'INSERT INTO gm_erasures (erasure_id, tombstone, erased_on, request_ref) VALUES (?, ?, ?, ?) ON CONFLICT(tombstone) DO NOTHING')
    .run(id, tombstone, day, requestRef);

/** `TRUNCATE` necesita que nadie lea: si no se completa, el acuse lo dice. */
function checkpoint(db) {
    const [r] = db.pragma('wal_checkpoint(TRUNCATE)');
    return r.busy === 0;
}

/**
 * Excluye a una persona. Idempotente.
 * @returns acuse sin datos personales
 */
export function excludeUser(db, { userId, requestRef = null, env = process.env, now = Date.now() }) {
    if (typeof userId !== 'string' || !userId) throw new GamificationError('INVALID_FACT');
    if (requestRef !== null && !REF_RX.test(requestRef)) throw new GamificationError('INVALID_REQUEST_REF');
    const tombstone = tombstoneOf(userId);
    const day = periodsFor(now).day;
    const id = crypto.randomUUID();
    if (!readRegistry(env).has(tombstone)) appendRegistry({ id, tombstone, day }, env);
    const result = db.transaction(() => {
        const inserted = recordErasure(db, { id, tombstone, day, requestRef }).changes === 1;
        const subject = findSubject(db, userId);
        return { inserted, unlinked: !!subject, extinguished: subject ? detachSubject(db, subject.subject_ref, now) : 0 };
    }).immediate();
    return { erasureId: id, day, ...result, checkpointed: checkpoint(db) };
}

/**
 * Reaplica el registro sobre la base: exclusiones que faltan tras restaurar, o
 * que quedaron a medias. Debe ejecutarse antes de reabrir la ingesta. Idempotente.
 */
export function replayExclusions(db, { env = process.env, now = Date.now() } = {}) {
    const registry = readRegistry(env);
    const day = periodsFor(now).day;
    const result = db.transaction(() => {
        let applied = 0;
        for (const tombstone of registry) applied += recordErasure(db, { id: crypto.randomUUID(), tombstone, day, requestRef: null }).changes;
        const subjects = listSubjectsByTombstone(db, tombstoneOf).filter((s) => registry.has(s.tombstone));
        for (const s of subjects) detachSubject(db, s.subject_ref, now);
        return { applied, unlinked: subjects.length };
    }).immediate();
    return { ...result, checkpointed: result.applied + result.unlinked === 0 ? true : checkpoint(db) };
}
