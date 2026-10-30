/**
 * reconcile.mjs — CHP-GAMIFICACION-G3-02.
 *
 * Recuperación de hechos desde las FUENTES CANÓNICAS, sin colas ni outbox.
 *
 * Por qué no hay marca de agua: un `MAX(occurred_at)` de lo ya procesado no
 * descubre un hecho anterior que se perdió (si el de las 10:00 se perdió y el
 * de las 10:05 entró, la marca queda en 10:05 y el de las 10:00 no vuelve).
 * Por eso la reconciliación es un BARRIDO COMPLETO por diferencia de conjuntos:
 * cada candidato de la fuente se busca por su clave única y solo los ausentes
 * van a `recordFact`, cuya idempotencia hace inocuo que dos procesos barran a
 * la vez. Coste O(n) de la fuente: aceptable para MOOK (store JSON acotado).
 *
 * Los adaptadores son PUROS: reciben el documento de la fuente que les pasa el
 * llamador (no leen disco). Ninguno está conectado al producto en G3-02.
 *
 * PRIV-01C: `userId` viaja solo en memoria, para resolver al sujeto. Los ids de
 * fuente no lo contienen y los candidatos no llevan `features`. Una cuenta
 * inexistente, sintética o inactiva no llega a `recordFact`.
 *
 * Fuentes y recuperabilidad:
 *  - mook_review      RECUPERABLE: la evidencia conserva su estado final
 *                     (REVIEWED, reviewerId, decision, reviewedAt) y nunca se borra.
 *  - mook_experience  RECUPERABLE: el run conserva status 'completed' y completedAt.
 *  - reading_completion NO RECUPERABLE: progress.db sobrescribe updated_at en cada
 *                     sync y no guarda el instante de finalización; no se puede
 *                     derivar la ventana de relectura ⇒ deshabilitada.
 *  - offline_validation, mission: sin fuente canónica todavía ⇒ deshabilitadas.
 */
import { GamificationError } from './db.mjs';
import { hasFact, recordFact } from './ledger.mjs';

export const RECOVERABLE_SOURCES = Object.freeze({
    mook_review: { recoverable: true },
    mook_experience: { recoverable: true },
    reading_completion: { recoverable: false, reason: 'progress.db no conserva el instante de finalización (updated_at se sobrescribe)' },
    offline_validation: { recoverable: false, reason: 'sin fuente canónica (G7)' },
    mission: { recoverable: false, reason: 'sin fuente canónica (G7)' },
});

const bad = (code, message) => new GamificationError(code, message);
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t > 0 ? t : null; };

/**
 * Elegibilidad del sujeto con el padrón que provee el llamador.
 * `resolveUser(userId)` → `{ exists, active, synthetic }`. Obligatorio: sin él
 * no se puede excluir a cuentas sintéticas o inactivas, así que no se reconcilia.
 */
function subjectEligibility(resolveUser, userId) {
    const u = resolveUser(userId);
    if (!u || !u.exists) return 'rejected_not_eligible';
    if (u.synthetic) return 'rejected_excluded_user';
    if (!u.active) return 'rejected_inactive_account';
    return 'eligible';
}

/** Elegibilidad de un candidato: el sujeto y, si lo hay, su actor humano. */
export function candidateEligibility(resolveUser, { userId, actorId }) {
    const subject = subjectEligibility(resolveUser, userId);
    if (subject !== 'eligible' || !actorId) return subject;
    return subjectEligibility(resolveUser, actorId) === 'eligible' ? 'eligible' : 'rejected_not_eligible';
}

/** Candidatos `mook_review`: solo evidencia `aprobado`, desde un documento MOOK normalizado. */
export function mookReviewCandidates(mookDoc) {
    const out = [];
    for (const ev of mookDoc?.evidence ?? []) {
        if (ev?.review?.status !== 'REVIEWED' || ev.review.decision !== 'aprobado') continue;
        const at = ms(ev.review.reviewedAt);
        if (!ev.id || !ev.userId || !at) continue;
        out.push({
            source: 'mook_review', sourceEventId: ev.id, factType: 'evidence_reviewed',
            userId: ev.userId, actorId: ev.review.reviewerId ?? null, occurredAt: at,
        });
    }
    return out;
}

/** Candidatos `mook_experience`: una vez por (usuario, versión), aunque repita la ruta. */
export function mookExperienceCandidates(mookDoc) {
    const out = new Map();
    for (const run of mookDoc?.runs ?? []) {
        if (run?.status !== 'completed') continue;
        const at = ms(run.completedAt);
        if (!run.userId || !run.experienceVersionId || !at) continue;
        const key = `${run.userId}:${run.experienceVersionId}`;
        const prev = out.get(key);
        if (!prev || at < prev.occurredAt) {
            out.set(key, { source: 'mook_experience', sourceEventId: run.experienceVersionId, factType: 'experience_completed',
                userId: run.userId, actorId: null, occurredAt: at });
        }
    }
    return [...out.values()];
}

/**
 * Barrido completo: registra los candidatos que aún no existen.
 * @param {import('better-sqlite3').Database} db
 * @param {object[]} candidates  de los adaptadores de arriba
 * @param {{ resolveUser: Function, env?: object, now?: () => number, onFact?: Function }} opts
 * @returns {{ scanned, alreadyRecorded, recorded, raced, byDecision }}
 */
export function reconcile(db, candidates, { resolveUser, env = process.env, now = Date.now, onFact } = {}) {
    if (typeof resolveUser !== 'function') throw bad('RESOLVE_USER_REQUIRED', 'sin padrón no se reconcilia');
    for (const c of candidates) {
        if (!RECOVERABLE_SOURCES[c?.source]?.recoverable) throw bad('SOURCE_NOT_RECOVERABLE', String(c?.source));
    }
    const res = { scanned: candidates.length, alreadyRecorded: 0, recorded: 0, raced: 0, byDecision: {} };
    for (const c of candidates) {
        const eligibility = candidateEligibility(resolveUser, c);
        if (eligibility === 'eligible' && hasFact(db, c)) { res.alreadyRecorded++; continue; }
        const r = recordFact(db, { ...c, eligibility, now: now() }, { env });
        if (r.inserted || !r.persisted) res.byDecision[r.decision] = (res.byDecision[r.decision] || 0) + 1;
        if (r.inserted) {
            res.recorded++;
        } else if (r.persisted) {
            res.raced++; // otra réplica lo registró entre la búsqueda y la transacción
        }
        onFact?.(c, r);
    }
    return res;
}
