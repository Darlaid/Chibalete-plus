/**
 * experienceBackboneEmitter.mjs — CHP-MOOK-01.
 *
 * Emisión SERVER-SIDE de los eventos canónicos de Experiencias/MOOK hacia
 * events.db, espejo exacto del patrón `leoBackboneEmitter.mjs`:
 *
 *   1. NUNCA throw — telemetría rota ≠ producto roto.
 *   2. Fire-and-forget seguro.
 *   3. Flag-gated: `EXPERIENCE_EVENTS_BACKBONE_ENABLED` OFF (default) = NO-OP.
 *   4. Sin PII: jamás viaja el texto de producciones/respuestas (eso vive en
 *      ExperienceEvidence); los payloads conforman los schemas zod del
 *      eventRegistry (categoría 'experience').
 *   5. Mode='experience' en el envelope.
 *
 * NO es un pipeline nuevo: reutiliza `recordCanonicalEvent` (mismo sink
 * canónico events.db que el resto del backbone).
 */
import { ulid } from './ulid.js';
import { recordCanonicalEvent } from './services/analyticsShadow.mjs';

function _enabled() {
    try { return String(process.env.EXPERIENCE_EVENTS_BACKBONE_ENABLED || '').trim() === '1'; }
    catch { return false; }
}

function _envelope(event, userId, payload) {
    return {
        eventId: ulid(),
        event,
        mode: 'experience',
        userId: String(userId || 'anon'),
        contentId: null,
        sessionId: String(payload.runId || ulid()),
        clientTs: Date.now(),
        version: 1,
        payload,
    };
}

function _safeEmit(envelope, log) {
    try {
        const res = recordCanonicalEvent(envelope, log ?? (() => {}));
        return { ok: true, res };
    } catch (e) {
        try { (log ?? (() => {}))(`[EXP-EMIT] fallo inocuo: ${e.message}`, 'WARN'); } catch { /* noop */ }
        return { ok: false, reason: 'emit_failed' };
    }
}

const mk = (event) => ({ userId, ...payload }, log) => {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    return _safeEmit(_envelope(event, userId, payload), log);
};

export const emitExperienceStarted   = mk('experience_started');
export const emitNodeStarted         = mk('node_started');
export const emitNodeCompleted       = mk('node_completed');
export const emitEvidenceSubmitted   = mk('evidence_submitted');
export const emitEvidenceReviewed    = mk('evidence_reviewed');
export const emitExperienceCompleted = mk('experience_completed');
