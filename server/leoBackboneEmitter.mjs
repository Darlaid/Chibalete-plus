/**
 * leoBackboneEmitter.mjs — Fase 2A LEC (Leo Longitudinal Events).
 *
 * Helper centralizado que conecta el orquestador Leo con el events.db canónico
 * (`/data-critical/events.db` vía `recordCanonicalEvent`). Permite que Leo
 * deje de ser una entidad aislada y empiece a alimentar trayectorias
 * longitudinales reales para PASO 3 (intervención) y PASO 6 (outcomes).
 *
 * Reglas duras:
 *
 *   1. **NUNCA throw**. Toda función está envuelta en try/catch y devuelve
 *      siempre un resultado serializable. Si el emisor falla, Leo sigue
 *      respondiendo al estudiante. Telemetría rota ≠ producto roto.
 *
 *   2. **Fire-and-forget seguro**. Los callers pueden hacer `void emit(...)`
 *      sin riesgo de unhandled rejection.
 *
 *   3. **Flag-gated**. Si `LEO_EVENTS_BACKBONE_ENABLED` está OFF (default), el
 *      emisor es NO-OP — no construye ULIDs, no llama recordCanonicalEvent,
 *      no toca métricas. Costo cero cuando está apagado.
 *
 *   4. **Sin PII**. Los payloads conforman al schema Zod del registry
 *      (`server/analytics/eventRegistry.js`); ni texto libre del estudiante,
 *      ni respuestas Leo, ni prompts internos se persisten en events.db. El
 *      contenido pedagógico vive en `leo_evidence_db.json` (sink existente).
 *
 *   5. **Schema-conforming**. Cada función mapea sus argumentos al shape
 *      exacto que el registry valida — si el registry cambia, las funciones
 *      acá tienen que actualizarse. Tests del emisor validan ambos lados.
 *
 *   6. **Mode='leo'**. Los eventos se emiten con `mode: 'leo'`. El validador
 *      HTTP-only (`validateBackboneEvent`) restringe modes a visores, pero
 *      `recordCanonicalEvent` bypassa ese validador y persiste directo via
 *      `eventsService.insertEvent` — el campo `mode` queda en SQLite como
 *      string libre, consultable por los engines de PASO 3/6.
 *
 * Eventos emitidos en Fase 2A (4 de 6):
 *   - leo_interaction_started      → al inicio de dispatchInteraction
 *   - leo_interaction_completed    → al resolver el handler
 *   - leo_evidence_recorded        → después de persistLeoEvidence
 *   - leo_memory_updated           → después de recordInteraction
 *
 * Pendientes para fase siguiente (schemas ya definidos en registry):
 *   - leo_profile_updated          → cuando el profile.json cambia con delta
 *   - leo_recommendation_generated → cuando leoActivationService emite reco
 */

import { ulid } from './ulid.js';
import { recordCanonicalEvent } from './services/analyticsShadow.mjs';
import { flags } from './lib/flags.js';

function _log(msg, level = 'INFO') {
    // eslint-disable-next-line no-console
    console.log(`[${new Date().toISOString()}] [leoBackboneEmitter] [${level}] ${msg}`);
}

/**
 * @returns {boolean} true si el flag global está ON. Lectura per-call para
 *          permitir cambio de env sin restart (aunque restart es lo recomendado).
 */
function _enabled() {
    try { return flags.leoEventsBackboneEnabled(); }
    catch { return false; }
}

/**
 * Construye un envelope base con campos comunes. NO se exporta — uso interno.
 */
function _buildEnvelope({ event, userId, contentId, sessionId, payload }) {
    return {
        eventId:   ulid(),
        event,
        mode:      'leo',
        userId:    String(userId || 'anon'),
        contentId: contentId ?? null,
        sessionId: String(sessionId || ulid()),
        clientTs:  Date.now(),
        version:   1,
        payload,
    };
}

/**
 * Wrapper defensivo. Llama recordCanonicalEvent dentro de try/catch y nunca
 * propaga errores al caller. Devuelve { ok, inserted? } para tests.
 */
function _safeEmit(envelope) {
    try {
        const res = recordCanonicalEvent(envelope, _log);
        return res ?? { ok: false, reason: 'no_result' };
    } catch (err) {
        try { _log(`emit_failed event=${envelope?.event} msg=${err?.message}`, 'WARN'); }
        catch { /* ignore */ }
        return { ok: false, reason: 'exception', error: err?.message };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// API pública — 4 emisores activos en Fase 2A
// ──────────────────────────────────────────────────────────────────────────

/**
 * Emit `leo_interaction_started` — primer punto del lifecycle Leo.
 *
 * Schema (registry): { sessionId, kind }
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.sessionId            ULID que identifica esta interacción puntual.
 *                                            Reusarlo en interactionCompleted permite correlación.
 * @param {string} args.surface              'companion' | 'chatbot' | 'recap'
 * @param {string} [args.contentId]
 * @returns {{ ok: boolean, inserted?: boolean, reason?: string }}
 */
export function emitInteractionStarted({ userId, sessionId, surface, contentId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    const envelope = _buildEnvelope({
        event:     'leo_interaction_started',
        userId, contentId, sessionId,
        payload:   { sessionId: String(sessionId || ''), kind: String(surface || 'unknown') },
    });
    return _safeEmit(envelope);
}

/**
 * Emit `leo_interaction_completed` — cierre del lifecycle.
 *
 * Schema (registry): { sessionId, kind, durationMs? }
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.sessionId
 * @param {string} args.surface
 * @param {number} args.durationMs
 * @param {string} [args.contentId]
 */
export function emitInteractionCompleted({ userId, sessionId, surface, durationMs, contentId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    const payload = { sessionId: String(sessionId || ''), kind: String(surface || 'unknown') };
    if (Number.isFinite(durationMs) && durationMs >= 0) {
        payload.durationMs = Math.round(durationMs);
    }
    const envelope = _buildEnvelope({
        event:     'leo_interaction_completed',
        userId, contentId, sessionId,
        payload,
    });
    return _safeEmit(envelope);
}

/**
 * Emit `leo_evidence_recorded` — la evidencia pedagógica completa quedó
 * persistida en leo_evidence_db.json. Sin replicar el contenido — solo
 * marker para que PASO 3/6 sepan que existe evidencia nueva.
 *
 * Schema (registry): { userId, kind, sourceEvent?, pedagogicalObjective? }
 *
 * `pedagogicalObjective` se agregó en Fase 2B: cuando el orquestador conoce
 * la clasificación (devuelta por `classifyPedagogicalObjective` dentro de
 * `buildLeoEvidenceEntry`), la pasa al events.db. Sin él, los signal
 * extractors caen al fallback de `kind` (interactionType), que tiene menos
 * granularidad pero sigue siendo útil. Backward-compat: opcional.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.interactionType        'explanation' | 'hint' | 'inferential' | 'reflection' | 'vocab' | 'writing' | 'chat' | ...
 * @param {string} [args.pedagogicalObjective] 'vocabulary' | 'inferential' | 'critical' | 'literal' | 'writing' | 'metacognitive' | 'emotional'
 * @param {string} [args.sessionId]            Para correlacionar con la interacción.
 * @param {string} [args.contentId]
 */
export function emitEvidenceRecorded({ userId, interactionType, pedagogicalObjective, sessionId, contentId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    const payload = { userId: String(userId || 'anon'), kind: String(interactionType || 'unknown') };
    if (sessionId) payload.sourceEvent = String(sessionId).slice(0, 60);
    if (typeof pedagogicalObjective === 'string' && pedagogicalObjective.length > 0) {
        payload.pedagogicalObjective = pedagogicalObjective.slice(0, 40);
    }
    const envelope = _buildEnvelope({
        event:     'leo_evidence_recorded',
        userId, contentId, sessionId,
        payload,
    });
    return _safeEmit(envelope);
}

/**
 * Emit `leo_memory_updated` — la session memory de Leo cambió (interactionCount,
 * lastInteractionTs, etc.). No replicamos los valores en el payload, solo
 * cuales keys cambiaron — el snapshot real vive en leo_memory_db.json.
 *
 * Schema (registry): { userId, keys: string[] (max 50) }
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string[]} args.keys           Lista de keys mutadas en la session memory.
 * @param {string} [args.sessionId]
 * @param {string} [args.contentId]
 */
export function emitMemoryUpdated({ userId, keys, sessionId, contentId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    const cleanKeys = Array.isArray(keys)
        ? keys.filter(k => typeof k === 'string' && k.length > 0).slice(0, 50).map(k => k.slice(0, 40))
        : [];
    const envelope = _buildEnvelope({
        event:     'leo_memory_updated',
        userId, contentId, sessionId,
        payload:   { userId: String(userId || 'anon'), keys: cleanKeys },
    });
    return _safeEmit(envelope);
}

// ──────────────────────────────────────────────────────────────────────────
// API pendiente — schemas existen en registry, wiring queda para próxima fase
// ──────────────────────────────────────────────────────────────────────────

/**
 * Emit `leo_profile_updated` — el profile.json cambió (LeoReaderProfile).
 * Schema: { userId, fields: string[] (max 50) }.
 *
 * Pendiente: identificar el punto exacto en leoMemoryService / activation
 * donde se persiste profile delta y no solo session memory. Mientras no se
 * cablee, NO emite.
 */
export function emitProfileUpdated({ userId, fields, contentId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    const cleanFields = Array.isArray(fields)
        ? fields.filter(f => typeof f === 'string' && f.length > 0).slice(0, 50).map(f => f.slice(0, 40))
        : [];
    const envelope = _buildEnvelope({
        event:     'leo_profile_updated',
        userId, contentId,
        sessionId: 'leo_profile',
        payload:   { userId: String(userId || 'anon'), fields: cleanFields },
    });
    return _safeEmit(envelope);
}

/**
 * Emit `leo_recommendation_generated` — leoActivationService o equivalente
 * emitió una recomendación pedagógica. Schema: { userId, recommendationId, kind }.
 *
 * Pendiente: integrar con leoActivationService.
 */
export function emitRecommendationGenerated({ userId, recommendationId, kind, contentId, sessionId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    const envelope = _buildEnvelope({
        event:     'leo_recommendation_generated',
        userId, contentId, sessionId,
        payload:   {
            userId: String(userId || 'anon'),
            recommendationId: String(recommendationId || 'unknown'),
            kind: String(kind || 'unknown'),
        },
    });
    return _safeEmit(envelope);
}
