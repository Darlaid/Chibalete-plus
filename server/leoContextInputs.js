/**
 * leoContextInputs.js — CHP V9 F7-C2R-U3. Entradas CONTEXTUALES de Leo para quien media a un lector.
 *
 * El perfil del lector (`leo_profile_db`) y la memoria por obra (`leo_memory_db`) son acumuladores: suman todas las
 * conversaciones del lector y no guardan cuándo ocurrió cada una, así que no pueden atribuirse a un curso. Las
 * EVIDENCIAS de Leo sí llevan obra y fecha. Aquí se reconstruye, solo con las evidencias que pertenecen al contexto
 * pedagógico (obra del curso, asignación y membresía vigentes en ese instante), lo mismo que Leo usa para el mediador:
 *
 *   - perfil: los mismos contadores y la misma regla de `preferredSupportType`, contados sobre esas evidencias;
 *   - sesiones por obra: número de interacciones, última intervención, etapa y dificultad más recientes;
 *   - ICDLI: la fórmula vigente sobre las sesiones de lectura y esas sesiones de Leo del contexto.
 *
 * Los acumuladores globales no se leen. Lo que no puede atribuirse no entra, y si hay actividad del curso que no es
 * atribuible el resultado es `insufficient`: no se arma un diagnóstico con el resto. Solo lectura; no escribe nada.
 */
import { getEvidenceEntriesForUser } from './leoEvidenceService.js';
import { derivePreferredSupportType, interactionTypeToCounter } from './leoMemoryService.js';
import { getContextualICDLISnapshot } from './leoICDLIBridge.js';

/** El almacén de evidencias conserva como máximo 2000 entradas en total: se recorren todas las del lector. */
const EVIDENCE_SCAN = 2000;

const msOf = (ts) => (typeof ts === 'number' ? ts : (typeof ts === 'string' ? Date.parse(ts) : NaN));

/**
 * @param {string} userId
 * @param {{hasWorks:boolean, classify:Function, includeContent:Function, describe:Function}} context  `buildPedagogicalContext`
 * @param {{readingState?:{data_state:string, reason:string|null}, provenanceRecorded?:boolean}} [opts]
 *        `readingState`: estado del cálculo de lectura del mismo contexto (si la lectura del curso no es atribuible,
 *        tampoco se diagnostica con Leo).
 */
export function buildLeoContextInputs(userId, context, opts = {}) {
    // Predicado para fuentes con obra y fecha. `strict`: una fila sin obra no se atribuye a ningún curso.
    const includeContent = Object.assign((contentId, ts) => context.includeContent(contentId, msOf(ts)), { strict: true });
    const base = { includeContent, context: context.describe() };
    const empty = { evidence: [], profile: null, sessions: [], icdli: null, provenance: null };
    if (!context.hasWorks) return { ...base, ...empty, data_state: 'no_course_works', reason: 'no_course_works' };

    const evidence = [];
    let unverifiable = 0;
    for (const e of getEvidenceEntriesForUser(userId, EVIDENCE_SCAN)) {
        const cls = context.classify(e.contentId, msOf(e.timestamp));
        if (cls === 'in') evidence.push(e);
        else if (cls === 'unverifiable') unverifiable++;
    }
    const readingBlocked = opts.readingState?.data_state === 'insufficient'
        && ['unverifiable_history', 'provenance_not_recorded'].includes(opts.readingState.reason);
    if (unverifiable > 0 || readingBlocked) {
        return { ...base, ...empty, data_state: 'insufficient',
            reason: opts.provenanceRecorded === false ? 'provenance_not_recorded' : (opts.readingState?.reason && readingBlocked ? opts.readingState.reason : 'unverifiable_history') };
    }

    // Perfil: mismos contadores que `recordInteraction`, sobre las evidencias del contexto.
    const profile = { userId, vocabularyInteractionsCount: 0, inferentialInteractionsCount: 0, reflectionInteractionsCount: 0,
        writingInteractionsCount: 0, totalChatInteractions: 0, preferredSupportType: null };
    const byContent = new Map();
    for (const e of evidence) {
        const counter = interactionTypeToCounter(e.interactionType);
        if (counter) profile[counter] += 1;
        if (e.pedagogicalObjective === 'writing') profile.writingInteractionsCount += 1;
        const s = byContent.get(e.contentId) ?? { contentId: e.contentId, interactionCount: 0, lastInterventionAt: null, updatedAt: null,
            pedagogicalStage: null, difficultyLevel: null, recentAnchors: [], activeSequenceId: null, activeSequenceStep: 0,
            activeSequenceObjective: null, lastSequenceObjective: null, lastSequenceAt: null, sessionReadingProgress: null };
        s.interactionCount += 1;
        s.lastInterventionAt = e.timestamp; s.updatedAt = e.timestamp;         // el almacén está en orden cronológico
        if (e.pedagogicalStage) s.pedagogicalStage = e.pedagogicalStage;
        if (e.difficultyLevel) s.difficultyLevel = e.difficultyLevel;
        if (e.sequenceId && e.pedagogicalObjective) { s.lastSequenceObjective = e.pedagogicalObjective; s.lastSequenceAt = e.timestamp; }
        byContent.set(e.contentId, s);
    }
    profile.preferredSupportType = derivePreferredSupportType(profile);
    const sessions = [...byContent.values()];

    const icdli = getContextualICDLISnapshot(userId, { includeContent, leoEntries: sessions });
    const stamps = evidence.map((e) => e.timestamp).sort();
    const provenance = { evidence: evidence.length, first_ts: stamps[0] ?? null, last_ts: stamps[stamps.length - 1] ?? null,
        reading_sessions: icdli?.readingSessions ?? 0 };
    const nothing = evidence.length === 0 && !(icdli?.hasData);
    return { ...base, evidence, profile, sessions, icdli, provenance,
        data_state: nothing ? 'no_activity' : 'ok', reason: nothing ? 'no_activity_in_context' : null };
}
