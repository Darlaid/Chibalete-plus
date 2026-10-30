/**
 * subjects.mjs — CHP-GAMIFICACION-PRIV-01B.
 *
 * Único módulo que relaciona la identidad canónica con el ledger. `subject_ref`
 * es aleatorio, no derivado de `user_id`: una vez borrada la fila de
 * `gm_subjects` no se puede recalcular. Esto es seudonimización, no anonimización.
 *
 * Claves derivadas: secreto del sujeto = HMAC(clave de servidor, sal del sujeto).
 * Sin la clave de servidor no se calcula ninguna, ni con una copia de la base.
 *
 * Funciones llamadas dentro de la transacción `IMMEDIATE` del ledger.
 */
import crypto from 'node:crypto';
import { GamificationError } from './db.mjs';
import { tombstoneOf } from './exclusions.mjs';
import { getSubjectKey } from './subjectKey.mjs';

const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
const subjectSecret = (salt) => hmac(getSubjectKey(), Buffer.concat([Buffer.from('gm-subject-v1\0'), salt]));
const derive = (subject, label, ...parts) => hmac(subjectSecret(subject.subject_salt), [label, ...parts].join('\0')).toString('hex');

/** Sujeto existente o null. No crea nada. */
export function findSubject(db, userId) {
    return db.prepare('SELECT subject_ref, subject_salt FROM gm_subjects WHERE user_id = ?').get(userId) ?? null;
}

/** ¿Esta persona está excluida? Dentro de la transacción: serializa con su exclusión. */
export const isExcluded = (db, userId) => !!db.prepare('SELECT 1 FROM gm_erasures WHERE tombstone = ?').get(tombstoneOf(userId));

/**
 * Sujeto de `userId`, creándolo si no existe. Punto único de alta: una persona
 * excluida no puede recrearse por ningún camino. El llamador garantiza que la
 * cuenta es elegible. `UNIQUE(user_id)` y `BEGIN IMMEDIATE` evitan duplicados
 * entre réplicas.
 * @param {string} day  `YYYY-MM-DD`: el alta no guarda más precisión
 */
export function ensureSubject(db, userId, { roleClass, day }) {
    getSubjectKey(); // sin clave no se crean sujetos cuyas claves no se podrían derivar
    if (isExcluded(db, userId)) throw new GamificationError('SUBJECT_EXCLUDED');
    db.prepare(`INSERT INTO gm_subjects (subject_ref, user_id, subject_salt, role_class, created_on)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`)
        .run(crypto.randomBytes(16).toString('hex'), userId, crypto.randomBytes(32), roleClass, day);
    return findSubject(db, userId);
}

/** Borra el vínculo con la identidad y la sal. Las filas del ledger permanecen. */
export function deleteSubject(db, subjectRef) {
    db.prepare('DELETE FROM gm_subjects WHERE subject_ref = ?').run(subjectRef);
}

/** Sujetos con su tombstone, sin exponer la identidad al llamador. */
export function listSubjectsByTombstone(db, tombstone) {
    return db.prepare('SELECT subject_ref, user_id FROM gm_subjects').all().map((s) => ({ subject_ref: s.subject_ref, tombstone: tombstone(s.user_id) }));
}

/** Clave de idempotencia de un hecho: determinista por sujeto, distinta entre sujetos. */
export const deriveSourceKey = (subject, source, factType, sourceId) => derive(subject, 'source', source, factType, sourceId);

/** Referencia a una obra por sujeto. Sin consumidores hasta G4-05. */
export const deriveWorkKey = (subject, contentId) => derive(subject, 'work', contentId);
