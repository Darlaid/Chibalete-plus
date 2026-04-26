/**
 * leoMediatorViewService.js — Leo Mediator View Service (D6)
 *
 * Read-only aggregation layer. Combines memory + profile + ICDLI + evidence
 * + sequence state into concise, human-readable summaries for teachers and
 * library mediators.
 *
 * PUBLIC API:
 *   getMediatorStudentSummary(userId)            → LeoMediatorStudentSummary
 *   getMediatorContentHistory(userId, contentId) → LeoMediatorContentHistory
 *
 * LeoMediatorStudentSummary:
 *   { dataAvailable, userId, generatedAt,
 *     icdliHasData, icdliLevel, icdliComposite,
 *     icdliDominantAlerts, icdliDominantStrengths,
 *     dominantPedagogicalObjective, preferredSupportType,
 *     totalInteractions, lastInteractionAt,
 *     recentEvidenceSignals[{ timestamp, surface, contentId,
 *                             pedagogicalObjective, evidenceType, interpretationHint }],
 *     activeSequence: { objective, step } | null,
 *     lastSequenceObjective,
 *     alerts[], suggestedMediatorAction }
 *
 * LeoMediatorContentHistory:
 *   { dataAvailable, userId, contentId, generatedAt,
 *     sessionReadingProgress, pedagogicalStage, difficultyLevel,
 *     interactionCount, lastInterventionAt,
 *     objectiveDistribution: { literal, inferential, critical,
 *                              vocabulary, writing, emotional, metacognitive },
 *     sequencesSeen[], recentEvidence[], difficultyTrend, engagementSignals[] }
 *
 * ALERT RULES (heuristic, deterministic, auditable):
 *   - 'Sin datos ICDLI suficientes aún'
 *   - 'Predomina apoyo léxico en las interacciones'
 *   - 'Baja actividad reciente con Leo'
 *   - 'Persisten interacciones con andamiaje continuo'
 *   - 'Reenganche frecuente; observar continuidad de lectura'
 *   - 'Etapa de comprensión sin avance aparente'
 *
 * CONSTRAINTS:
 *   - ESM pure, no new dependencies
 *   - No circular dep with server.js
 *   - Read-only: never writes to any DB
 *   - Never throws — errors produce { dataAvailable: false } responses
 *   - Heuristic, not clinical — no psychological or diagnostic claims
 */

import { getLeoLearnerProfile, getLeoSessionMemory, getAllSessionMemoriesForUser } from './leoMemoryService.js';
import { getLeoICDLISnapshot } from './leoICDLIBridge.js';
import { getEvidenceEntriesForUser, getEvidenceEntriesForContent } from './leoEvidenceService.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUMMARY_EVIDENCE_LIMIT  = 20;   // entries scanned for student summary
const CONTENT_EVIDENCE_LIMIT  = 10;   // entries scanned for content history
const SIGNAL_DISPLAY_LIMIT    = 5;    // entries shown in recentEvidenceSignals
const RECENT_DAYS_THRESHOLD   = 7;    // days window for "recent activity" check
const LOW_EVIDENCE_THRESHOLD  = 3;    // fewer recent entries than this → low activity alert
const SCAFFOLDED_STREAK_LIMIT = 4;    // N consecutive scaffolded entries → alert

// ── Private helpers ───────────────────────────────────────────────────────────

const _ts = () => new Date().toISOString();

function _log(msg, level = 'INFO') {
    console.log(`[${_ts()}] [leoMediatorViewService] [${level}] ${msg}`);
}

/**
 * Derives the dominant pedagogical objective from profile interaction counters.
 * Returns null if no interactions have been recorded.
 */
function _dominantObjectiveFromProfile(profile) {
    const counts = {
        vocabulary:  profile.vocabularyInteractionsCount  ?? 0,
        inferential: profile.inferentialInteractionsCount ?? 0,
        critical:    profile.reflectionInteractionsCount  ?? 0,
        writing:     profile.writingInteractionsCount     ?? 0,
    };
    const max = Math.max(...Object.values(counts));
    if (max === 0) return null;
    return Object.entries(counts).find(([, v]) => v === max)?.[0] ?? null;
}

/**
 * Counts evidence entries by pedagogicalObjective.
 */
function _computeObjectiveDistribution(entries) {
    const dist = {
        literal: 0, inferential: 0, critical: 0,
        vocabulary: 0, writing: 0, emotional: 0, metacognitive: 0,
    };
    for (const e of entries) {
        const obj = e.pedagogicalObjective;
        if (obj && obj in dist) dist[obj]++;
    }
    return dist;
}

/**
 * Determines difficulty trajectory from the difficultyLevel field in evidence entries.
 *   escalating — only 'avanzado' values present
 *   supported  — only 'inicial' values present
 *   stable     — mixed or only 'medio'
 */
function _computeDifficultyTrend(entries) {
    const levels = entries.map(e => e.difficultyLevel).filter(Boolean);
    if (levels.length === 0) return null;
    const hasAvanzado = levels.includes('avanzado');
    const hasInicial  = levels.includes('inicial');
    if (hasAvanzado && !hasInicial) return 'escalating';
    if (hasInicial  && !hasAvanzado) return 'supported';
    return 'stable';
}

/**
 * Returns unique pedagogical objectives of sequences that were activated
 * (step 0) in the given evidence entries. More readable than raw sequenceIds.
 */
function _getSequencesSeen(entries) {
    const seen = new Set();
    for (const e of entries) {
        if (e.sequenceId && e.sequenceStep === 0 && e.pedagogicalObjective) {
            seen.add(e.pedagogicalObjective);
        }
    }
    return [...seen];
}

/**
 * Projects an evidence entry to the minimal shape needed by the mediator UI.
 */
function _toEvidenceSignal(entry) {
    return {
        timestamp:            entry.timestamp,
        surface:              entry.surface,
        contentId:            entry.contentId,
        pedagogicalObjective: entry.pedagogicalObjective,
        evidenceType:         entry.evidenceType,
        interpretationHint:   entry.interpretationHint,
    };
}

/**
 * Finds the most recent lastInterventionAt or updatedAt across all sessions.
 */
function _computeLastInteractionAt(sessions) {
    const stamps = sessions
        .map(s => s.lastInterventionAt ?? s.updatedAt)
        .filter(Boolean)
        .sort();
    return stamps[stamps.length - 1] ?? null;
}

/**
 * Sums interactionCount across all sessions for a user.
 */
function _computeTotalInteractions(sessions) {
    return sessions.reduce((sum, s) => sum + (s.interactionCount ?? 0), 0);
}

// ── Alert rules ───────────────────────────────────────────────────────────────

/**
 * Derives a list of short, heuristic alerts for the mediator.
 *
 * Rules are deterministic and auditable. Not clinical — no psychological claims.
 * Empty array when no alerts apply.
 *
 * @param {{ profile, evidence, icdliSnapshot, sessions }} params
 * @returns {string[]}
 */
function _computeAlerts({ profile, evidence, icdliSnapshot, sessions }) {
    const alerts = [];

    // 1. No ICDLI behavioral data yet — adaptive parameters unavailable
    if (!icdliSnapshot?.hasData) {
        alerts.push('Sin datos ICDLI suficientes aún');
    }

    // 2. Dominant vocabulary demand (vocabulary > inferential + reflection combined)
    const v = profile.vocabularyInteractionsCount  ?? 0;
    const i = profile.inferentialInteractionsCount ?? 0;
    const r = profile.reflectionInteractionsCount  ?? 0;
    if (v > 0 && v > i + r) {
        alerts.push('Predomina apoyo léxico en las interacciones');
    }

    // 3. Low recent evidence — reader has been inactive with Leo
    const cutoff      = new Date(Date.now() - RECENT_DAYS_THRESHOLD * 86_400_000).toISOString();
    const recentCount = evidence.filter(e => e.timestamp > cutoff).length;
    if (evidence.length > 0 && recentCount < LOW_EVIDENCE_THRESHOLD) {
        alerts.push('Baja actividad reciente con Leo');
    }

    // 4. Persistent scaffolded streak — reader keeps needing guided support
    const last4 = evidence.slice(-SCAFFOLDED_STREAK_LIMIT);
    if (last4.length >= SCAFFOLDED_STREAK_LIMIT && last4.every(e => e.evidenceType === 'scaffolded')) {
        alerts.push('Persisten interacciones con andamiaje continuo');
    }

    // 5. Frequent re-engagement without apparent continuity
    const last5           = evidence.slice(-5);
    const engagementCount = last5.filter(e => e.evidenceType === 'engagement' || e.surface === 'recap').length;
    if (last5.length >= 3 && engagementCount >= 3) {
        alerts.push('Reenganche frecuente; observar continuidad de lectura');
    }

    // 6. Stuck in comprehension stage across all content with many interactions
    const totalInteractions = _computeTotalInteractions(sessions);
    const stages = sessions.map(s => s.pedagogicalStage).filter(Boolean);
    if (stages.length > 0 && stages.every(s => s === 'comprehension') && totalInteractions > 10) {
        alerts.push('Etapa de comprensión sin avance aparente');
    }

    return alerts;
}

// ── Suggested action rules ────────────────────────────────────────────────────

/**
 * Derives a single, concrete mediator action suggestion.
 *
 * Priority: ICDLI level → preferredSupportType → pedagogical stage → evidence pattern.
 * Outputs are brief, direct, and actionable — not grandiose.
 *
 * @param {{ profile, icdliSnapshot, evidence, sessions }} params
 * @returns {string}
 */
function _computeSuggestedAction({ profile, icdliSnapshot, evidence, sessions }) {

    // 1. ICDLI level — highest confidence signal when data exists
    if (icdliSnapshot?.hasData) {
        if (icdliSnapshot.levelLabel === 'Inicial') {
            return 'Refuerza comprensión literal con preguntas breves y vocabulario en contexto';
        }
        if (icdliSnapshot.levelLabel === 'Avanzado') {
            return 'Puede avanzar a producción o evaluación crítica independiente';
        }
    }

    // 2. preferredSupportType from profile counters
    const supportType = profile.preferredSupportType;
    if (supportType === 'vocabulary') {
        return 'Observa si el vocabulario está frenando la lectura; apoya con definiciones en contexto';
    }
    if (supportType === 'inferential') {
        return 'Conviene apoyar la inferencia; formula preguntas del tipo "¿por qué crees que...?"';
    }
    if (supportType === 'reflection') {
        return 'El lector reflexiona bien; introduce conexiones personales o evaluación crítica';
    }

    // 3. Pedagogical stage across sessions
    const stages = sessions.map(s => s.pedagogicalStage).filter(Boolean);
    if (stages.includes('creation')) {
        return 'Puede pasar a tareas de producción breve; invita a escribir o reinterpretar';
    }
    if (stages.includes('reflection')) {
        return 'Introduce evaluación crítica y conexiones con experiencia personal';
    }

    // 4. Persistent scaffolded pattern
    const last4 = evidence.slice(-SCAFFOLDED_STREAK_LIMIT);
    if (last4.length >= SCAFFOLDED_STREAK_LIMIT && last4.every(e => e.evidenceType === 'scaffolded')) {
        return 'Necesita continuidad antes de complejizar; celebra avances concretos';
    }

    return 'Mantén el ritmo actual y observa las próximas interacciones antes de ajustar';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a LeoMediatorStudentSummary for a given userId.
 *
 * Aggregates: learner profile + ICDLI snapshot + recent evidence + all sessions.
 * Returns { dataAvailable: false } if userId is missing.
 * Never throws.
 *
 * @param {string} userId
 * @returns {LeoMediatorStudentSummary}
 */
export function getMediatorStudentSummary(userId) {
    if (!userId) return { dataAvailable: false, userId: null };

    try {
        const profile       = getLeoLearnerProfile(userId);
        const icdliSnapshot = getLeoICDLISnapshot(userId);
        const sessions      = getAllSessionMemoriesForUser(userId);
        const evidence      = getEvidenceEntriesForUser(userId, SUMMARY_EVIDENCE_LIMIT);

        const totalInteractions = _computeTotalInteractions(sessions);
        const lastInteractionAt = _computeLastInteractionAt(sessions);

        // Signal display: last N entries, most recent first for UI
        const recentEvidenceSignals = evidence
            .slice(-SIGNAL_DISPLAY_LIMIT)
            .reverse()
            .map(_toEvidenceSignal);

        // Active sequence: find any open session sequence
        const sessionWithActiveSeq = sessions.find(s => s.activeSequenceId) ?? null;
        const activeSequence = sessionWithActiveSeq
            ? {
                objective: sessionWithActiveSeq.activeSequenceObjective,
                step:      sessionWithActiveSeq.activeSequenceStep,
              }
            : null;

        // Last completed sequence objective: most recent across all sessions
        const lastSequenceObjective = [...sessions]
            .sort((a, b) => ((b.lastSequenceAt ?? '') > (a.lastSequenceAt ?? '') ? 1 : -1))
            .find(s => s.lastSequenceObjective)
            ?.lastSequenceObjective ?? null;

        const alerts = _computeAlerts({ profile, evidence, icdliSnapshot, sessions });
        const suggestedMediatorAction = _computeSuggestedAction({
            profile, icdliSnapshot, evidence, sessions,
        });

        _log(`summary built userId=${userId} interactions=${totalInteractions} alerts=${alerts.length}`);

        return {
            dataAvailable:                true,
            userId,
            generatedAt:                  _ts(),

            // ICDLI
            icdliHasData:                 icdliSnapshot?.hasData            ?? false,
            icdliLevel:                   icdliSnapshot?.levelLabel          ?? null,
            icdliComposite:               icdliSnapshot?.composite           ?? null,
            icdliDominantAlerts:          icdliSnapshot?.dominantAlerts      ?? [],
            icdliDominantStrengths:       icdliSnapshot?.dominantStrengths   ?? [],

            // Profile-derived
            dominantPedagogicalObjective: _dominantObjectiveFromProfile(profile),
            preferredSupportType:         profile.preferredSupportType       ?? null,
            totalInteractions,
            lastInteractionAt,

            // Recent evidence signals (last 5, newest first)
            recentEvidenceSignals,

            // Sequence state
            activeSequence,
            lastSequenceObjective,

            // Derived
            alerts,
            suggestedMediatorAction,
        };

    } catch (e) {
        _log(`getMediatorStudentSummary failed userId=${userId}: ${e.message}`, 'ERROR');
        return { dataAvailable: false, userId, error: e.message };
    }
}

/**
 * Builds a LeoMediatorContentHistory for a userId + contentId pair.
 *
 * Aggregates: session memory for that content + evidence filtered by contentId.
 * Returns { dataAvailable: false } if required params are missing.
 * Never throws.
 *
 * @param {string} userId
 * @param {string} contentId
 * @returns {LeoMediatorContentHistory}
 */
export function getMediatorContentHistory(userId, contentId) {
    if (!userId || !contentId) return { dataAvailable: false, userId, contentId };

    try {
        const session  = getLeoSessionMemory(userId, contentId);
        const evidence = getEvidenceEntriesForContent(userId, contentId, CONTENT_EVIDENCE_LIMIT);

        const objectiveDistribution = _computeObjectiveDistribution(evidence);
        const sequencesSeen         = _getSequencesSeen(evidence);
        const difficultyTrend       = _computeDifficultyTrend(evidence);

        // Unique interpretation hints as engagement signals for the mediator
        const engagementSignals = [...new Set(
            evidence.map(e => e.interpretationHint).filter(Boolean)
        )];

        // Most recent first for UI
        const recentEvidence = [...evidence].reverse().map(_toEvidenceSignal);

        _log(`content history built userId=${userId} contentId=${contentId} entries=${evidence.length}`);

        return {
            dataAvailable:          true,
            userId,
            contentId,
            generatedAt:            _ts(),

            // Session state
            sessionReadingProgress: session.sessionReadingProgress ?? 0,
            pedagogicalStage:       session.pedagogicalStage       ?? 'comprehension',
            difficultyLevel:        session.difficultyLevel        ?? 'medio',
            interactionCount:       session.interactionCount       ?? 0,
            lastInterventionAt:     session.lastInterventionAt     ?? null,

            // Evidence-derived
            objectiveDistribution,
            sequencesSeen,
            recentEvidence,
            difficultyTrend,
            engagementSignals,
        };

    } catch (e) {
        _log(`getMediatorContentHistory failed userId=${userId} contentId=${contentId}: ${e.message}`, 'ERROR');
        return { dataAvailable: false, userId, contentId, error: e.message };
    }
}
