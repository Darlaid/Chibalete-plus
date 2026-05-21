/**
 * aulaVivaAuditEmitter.mjs — Fase 3B Aula Viva Institucional.
 *
 * Mismo patrón que `server/leoBackboneEmitter.mjs` (Fase 2A). Conecta
 * operationalRouter al events.db canónico para que cada acción significativa
 * de un mediador deje traza institucional.
 *
 * Los 6 eventos teacher_/mediator_ ESTÁN definidos en
 * server/analytics/eventRegistry.js desde antes, pero NINGÚN código los
 * emitía. Este módulo cierra ese gap.
 *
 * REGLAS DURAS:
 *
 *   1. NUNCA throw. Fire-and-forget defensivo. Una falla del audit JAMÁS
 *      degrada la experiencia del mediador.
 *
 *   2. Flag-gated (`AULA_VIVA_AUDIT_EVENTS_ENABLED`, default OFF). Cuando
 *      OFF: costo cero, sin construcción de envelopes, sin llamada a
 *      recordCanonicalEvent.
 *
 *   3. Sin PII. Los payloads SOLO contienen: actor (callerId), action,
 *      target (studentId/groupId/recommendationId), timestamp, scope.
 *      JAMÁS notas libres, texto del estudiante, mensajes de chat.
 *
 *   4. Schema-conforming. Cada función valida implícitamente contra el Zod
 *      schema del registry (test §[3] confirma).
 *
 *   5. Trazabilidad institucional, NO vigilancia de mediadores. Estos
 *      eventos son para reconstrucción longitudinal del proceso pedagógico,
 *      no para rankear o castigar mediadores.
 *
 *   6. Mode='aula_viva'. Igual que el resto de eventos institucionales del
 *      registry. `recordCanonicalEvent` bypasa la validación HTTP-mode-strict
 *      del endpoint `/api/v1/events`, así que aceptamos mode='aula_viva'
 *      sin estar en VALID_MODES de la ingesta HTTP.
 *
 * Eventos emitidos en Fase 3B:
 *   - teacher_viewed_student            — GET /students/:userId/timeline
 *   - teacher_reviewed_recommendation   — POST /recommendations/:id/ack | /dismiss
 *   - teacher_created_intervention      — POST /interventions
 *   - mediator_reviewed_cohort          — GET /cohorts/:scope_type/:scope_id
 *
 * NOTA sobre `teacher_viewed_student`: el schema exige `{groupId, studentId, at}`.
 * Como el endpoint `/students/:userId/timeline` no recibe groupId, hacemos
 * lookup defensivo en groups_db.json. Si no encontramos grupo, emitimos con
 * groupId='_unscoped' para no perder el evento — un mediador puede ver
 * estudiantes de varios grupos donde media; sin lookup persistente costoso,
 * '_unscoped' es honesto. El test §[5] cubre el caso.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from '../ulid.js';
import { recordCanonicalEvent } from './analyticsShadow.mjs';
import { flags } from '../lib/flags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const GROUPS_DB  = path.resolve(__dirname, '..', '..', 'data', 'groups_db.json');

function _log(msg, level = 'INFO') {
    // eslint-disable-next-line no-console
    console.log(`[${new Date().toISOString()}] [aulaVivaAuditEmitter] [${level}] ${msg}`);
}

/**
 * Lee el flag per-call (permite cambio sin restart).
 * @returns {boolean}
 */
function _enabled() {
    try { return flags.aulaVivaAuditEventsEnabled(); }
    catch { return false; }
}

/**
 * Construye envelope. NO se exporta — uso interno.
 */
function _buildEnvelope({ event, callerId, payload, scope_id }) {
    return {
        eventId:   ulid(),
        event,
        mode:      'aula_viva',
        userId:    String(callerId || 'anon'),
        contentId: null,
        sessionId: `audit_${event}_${scope_id ?? 'global'}`,
        clientTs:  Date.now(),
        version:   1,
        payload,
    };
}

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

// ── Lookup defensivo del primer grupo donde un estudiante es miembro ──────
// Lectura ad-hoc del JSON. Costo aceptable (event emission frequency baja).
// Si la lectura falla → devuelve null sin throw.
function _findStudentPrimaryGroup(studentId) {
    if (!studentId) return null;
    try {
        if (!fs.existsSync(GROUPS_DB)) return null;
        const raw = fs.readFileSync(GROUPS_DB, 'utf8');
        if (!raw.trim()) return null;
        const groups = JSON.parse(raw);
        if (!Array.isArray(groups)) return null;
        for (const g of groups) {
            const members = Array.isArray(g?.memberIds) ? g.memberIds : [];
            if (members.includes(studentId)) {
                return String(g?.id ?? g?.groupId ?? '_unknown');
            }
        }
        return null;
    } catch {
        return null;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// API pública
// ──────────────────────────────────────────────────────────────────────────

/**
 * Emite `teacher_viewed_student` cuando un mediador consulta el timeline
 * longitudinal de un estudiante.
 *
 * Schema (registry): { groupId, studentId, at }
 *
 * @param {object} args
 * @param {string} args.callerId  user_id del mediador (header x-user-id)
 * @param {string} args.studentId user_id del estudiante consultado
 * @param {string} [args.groupId] opcional; si no se pasa hacemos lookup en groups_db.json
 */
export function emitTeacherViewedStudent({ callerId, studentId, groupId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    if (!studentId) return { ok: false, reason: 'missing_studentId' };

    const resolvedGroupId = groupId
        ?? _findStudentPrimaryGroup(studentId)
        ?? '_unscoped';

    const envelope = _buildEnvelope({
        event:    'teacher_viewed_student',
        callerId,
        scope_id: studentId,
        payload:  {
            groupId:   String(resolvedGroupId).slice(0, 80),
            studentId: String(studentId).slice(0, 80),
            at:        Date.now(),
        },
    });
    return _safeEmit(envelope);
}

/**
 * Emite `teacher_reviewed_recommendation` tras ack/dismiss.
 *
 * Schema: { recommendationId, accepted }
 *
 * @param {object} args
 * @param {string} args.callerId
 * @param {string} args.recommendationId
 * @param {boolean} args.accepted  true = ack/apply, false = dismiss
 */
export function emitTeacherReviewedRecommendation({ callerId, recommendationId, accepted } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    if (!recommendationId) return { ok: false, reason: 'missing_recommendationId' };

    const envelope = _buildEnvelope({
        event:    'teacher_reviewed_recommendation',
        callerId,
        scope_id: recommendationId,
        payload:  {
            recommendationId: String(recommendationId).slice(0, 100),
            accepted:         !!accepted,
        },
    });
    return _safeEmit(envelope);
}

/**
 * Emite `teacher_created_intervention` cuando el mediador registra una
 * intervención formal. **NO incluimos la nota libre del mediador** (el schema
 * lo permitiría pero por privacidad pedagógica preferimos solo metadata).
 *
 * Schema: { scopeLevel, scopeId, kind, note? }
 *
 * @param {object} args
 * @param {string} args.callerId
 * @param {string} args.studentId         scope.id (el estudiante intervenido)
 * @param {string} args.interventionType  scope.kind (ej. 'lectura_guiada')
 */
export function emitTeacherCreatedIntervention({ callerId, studentId, interventionType } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    if (!studentId || !interventionType) {
        return { ok: false, reason: 'missing_required' };
    }

    const envelope = _buildEnvelope({
        event:    'teacher_created_intervention',
        callerId,
        scope_id: studentId,
        payload:  {
            scopeLevel: 'user',
            scopeId:    String(studentId).slice(0, 80),
            kind:       String(interventionType).slice(0, 60),
            // note: deliberadamente omitido — el texto libre tiene PII potencial.
        },
    });
    return _safeEmit(envelope);
}

/**
 * Emite `mediator_reviewed_cohort` cuando el mediador consulta la
 * comparativa cohort.
 *
 * Schema: { scopeLevel, scopeId, cohortKey? }
 *
 * scopeType del endpoint mapea a scopeLevel del schema:
 *   - 'user'      → 'user'
 *   - 'group'     → 'group'
 *   - 'school'    → 'school'
 *   - 'org'/'all' → 'org'
 *   - resto       → 'org' (fallback seguro)
 *
 * @param {object} args
 * @param {string} args.callerId
 * @param {string} args.scopeType  scope_type del path (user/group/school/all/...)
 * @param {string} args.scopeId
 */
export function emitMediatorReviewedCohort({ callerId, scopeType, scopeId } = {}) {
    if (!_enabled()) return { ok: false, reason: 'disabled' };
    if (!scopeType || !scopeId) return { ok: false, reason: 'missing_required' };

    // Map del scope_type del endpoint al SCOPE_LEVEL enum del schema
    // ['user', 'group', 'school', 'org']
    let scopeLevel;
    switch (String(scopeType).toLowerCase()) {
        case 'user':   scopeLevel = 'user';   break;
        case 'group':
        case 'club':   scopeLevel = 'group';  break;
        case 'school': scopeLevel = 'school'; break;
        default:       scopeLevel = 'org';
    }

    const envelope = _buildEnvelope({
        event:    'mediator_reviewed_cohort',
        callerId,
        scope_id: scopeId,
        payload:  {
            scopeLevel,
            scopeId:   String(scopeId).slice(0, 80),
            cohortKey: `${scopeType}:${scopeId}`.slice(0, 80),
        },
    });
    return _safeEmit(envelope);
}
