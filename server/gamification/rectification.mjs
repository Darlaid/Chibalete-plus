/**
 * rectification.mjs — CHP-V8.1-CLOSE-01 (G-03).
 *
 * Anulación de un reconocimiento XP erróneo (002 §8.5, rectificación). Reutiliza
 * el esquema existente sin migración:
 *  - un asiento `void` en `gm_xp_entries` (xp = 0, `voids_entry_id` = el `award`);
 *    `ux_gm_xp_void` admite uno solo por asiento ⇒ idempotente también entre réplicas;
 *  - una fila en `gm_admin_audit` con el motivo (`action = xp_void:<motivo>`), la
 *    referencia opaca del trámite (`ref`) y sujetos pseudónimos, nunca ids.
 * Nada se borra ni se modifica: hecho, `award` y actos por obra siguen en el
 * historial. Todas las lecturas de XP, nivel, obras y logros ya descuentan los
 * asientos anulados.
 *
 * El hecho conserva su clave: ni el barrido ni el gancho de revisión vuelven a
 * emitir esa evidencia. La anulación tampoco libera el techo por obra y ciclo:
 * los actos anulados siguen ocupando su ciclo, así que la misma obra no puede
 * volver a pagar en ese ciclo por la vía de una corrección.
 *
 * Sin ruta HTTP: solo operador, por stdin dentro de una réplica (como
 * `excludeUser`, PRIV-C7 §5). No depende de `XP_EARNING_ENABLED`: corregir no emite.
 */
import crypto from 'node:crypto';
import { GamificationError } from './db.mjs';
import { exclusionGate } from './exclusions.mjs';
import { periodsFor, REVIEW_FACT, REVIEW_SOURCE } from './ledger.mjs';
import { deriveSourceKey, ensureSubject, findSubject, isExcluded } from './subjects.mjs';
import { getSubjectKey } from './subjectKey.mjs';

export const VOID_REASONS = Object.freeze(['recognition_error', 'rectification_request']);

const ID_RX = /^[A-Za-z0-9._:@-]{1,128}$/;
const REF_RX = /^[A-Za-z0-9._:-]{1,128}$/;
const BOGOTA_OFFSET_MS = 5 * 3_600_000;
const dayStart = (ms) => Math.floor((ms - BOGOTA_OFFSET_MS) / 86_400_000) * 86_400_000 + BOGOTA_OFFSET_MS;
const bad = (code) => new GamificationError(code);

/**
 * Anula el reconocimiento de una evidencia MOOK de una persona.
 * @param {{ userId: string, evidenceId: string, reason: string, requestRef: string, actorId: string }} req
 * @returns acuse sin datos personales: `{ voided, alreadyVoided, xp, day }`
 * @throws INVALID_FACT | INVALID_ACTOR | INVALID_VOID_REASON | INVALID_REQUEST_REF |
 *         SELF_RECTIFICATION | SUBJECT_EXCLUDED | RECOGNITION_NOT_FOUND | EXCLUSION_* | SUBJECT_KEY_UNAVAILABLE
 */
export function voidRecognition(db, { userId, evidenceId, reason, requestRef, actorId } = {}, { env = process.env, now = Date.now() } = {}) {
    if (!ID_RX.test(String(userId ?? '')) || !ID_RX.test(String(evidenceId ?? ''))) throw bad('INVALID_FACT');
    if (!ID_RX.test(String(actorId ?? ''))) throw bad('INVALID_ACTOR');
    if (!VOID_REASONS.includes(reason)) throw bad('INVALID_VOID_REASON');
    if (!REF_RX.test(String(requestRef ?? ''))) throw bad('INVALID_REQUEST_REF');
    if (actorId === userId) throw bad('SELF_RECTIFICATION');
    getSubjectKey();
    const gate = exclusionGate(db, env);
    if (gate.excludes(userId) || gate.excludes(actorId)) throw bad('SUBJECT_EXCLUDED');
    const day = periodsFor(now).day;
    const stamp = dayStart(now);
    return db.transaction(() => {
        if (isExcluded(db, userId) || isExcluded(db, actorId)) throw bad('SUBJECT_EXCLUDED');
        const subject = findSubject(db, userId);
        const fact = subject && db.prepare('SELECT fact_id FROM gm_source_facts WHERE source = ? AND source_event_id = ? AND fact_type = ?')
            .get(REVIEW_SOURCE, deriveSourceKey(subject, REVIEW_SOURCE, REVIEW_FACT, evidenceId), REVIEW_FACT);
        const award = fact && db.prepare("SELECT entry_id, xp, rule_version FROM gm_xp_entries WHERE fact_id = ? AND kind = 'award'").get(fact.fact_id);
        if (!award) throw bad('RECOGNITION_NOT_FOUND');
        const prior = db.prepare("SELECT 1 FROM gm_xp_entries WHERE kind = 'void' AND voids_entry_id = ?").get(award.entry_id);
        if (prior) return { voided: false, alreadyVoided: true, xp: award.xp, day };
        db.prepare("INSERT INTO gm_xp_entries VALUES (?, ?, 'void', 0, NULL, ?, ?, ?)")
            .run(crypto.randomUUID(), subject.subject_ref, award.entry_id, award.rule_version, stamp);
        const actorRef = ensureSubject(db, actorId, { roleClass: 'actor', day }).subject_ref;
        db.prepare('INSERT INTO gm_admin_audit (row_id, actor_ref, action, target_ref, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(crypto.randomUUID(), actorRef, `xp_void:${reason}`, subject.subject_ref, requestRef, stamp);
        return { voided: true, alreadyVoided: false, xp: award.xp, day };
    }).immediate();
}
