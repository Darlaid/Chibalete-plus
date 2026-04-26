/**
 * leoActivationService.js — Leo Activation Layer (D7)
 *
 * Detects pedagogical moments and generates actionable outputs for
 * family engagement, reading continuity, content recommendation,
 * and student production prompts.
 *
 * PUBLIC API:
 *   getActivationOutputsForUser(userId) → LeoActivationOutput[]
 *
 * LeoActivationOutput:
 *   { type, userId, contentId?, message, context: {...},
 *     suppressUntil, createdAt }
 *
 * Output types:
 *   'family'         → summary for parents/guardians (what + support + home action)
 *   'continuity'     → re-engagement nudge (incomplete reading / open sequence)
 *   'recommendation' → content type suggestion (based on profile + ICDLI)
 *   'production'     → creative writing prompt (when last sequence was writing/reflective)
 *
 * RULES:
 *   - At most 1 output per type per call
 *   - Read-only: never writes to any DB (D8 will add delivery state persistence)
 *   - suppressUntil: advisory TTL for callers — D7 does not enforce it
 *   - Never throws: errors are logged and return []
 *   - All messages in Spanish
 *
 * CONSTRAINTS:
 *   - ESM pure, no new dependencies
 *   - Uses existing services only: leoMemoryService, leoEvidenceService, leoICDLIBridge
 *   - Direct fs read for progress_db.json (no exported progress service exists)
 */

import { fileURLToPath } from 'url';

import { getLeoLearnerProfile, getAllSessionMemoriesForUser } from './leoMemoryService.js';
import { getEvidenceEntriesForUser } from './leoEvidenceService.js';
import { getLeoICDLISnapshot } from './leoICDLIBridge.js';
import { getProgressByUser } from './progressService.js';

const __filename = fileURLToPath(import.meta.url);

// ── Thresholds ────────────────────────────────────────────────────────────────

// CONTINUITY: gap between 4 hours (nudge) and 7 days (too stale to be useful)
const CONTINUITY_GAP_MS       = 4 * 60 * 60 * 1000;
const CONTINUITY_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

// FAMILY: evidence window — "today's session" radius
const RECENT_EVIDENCE_WINDOW_H = 48;

// Minimum interactions before a family message is worth generating
const MIN_INTERACTIONS_FAMILY = 2;

// Advisory suppress TTLs — D8 respects these; D7 only computes them
const SUPPRESS_FAMILY_H         = 8;
const SUPPRESS_CONTINUITY_H     = 2;
const SUPPRESS_RECOMMENDATION_H = 24;
const SUPPRESS_PRODUCTION_H     = 4;

// ── Private helpers ───────────────────────────────────────────────────────────

const _ts = () => new Date().toISOString();

function _log(msg, level = 'INFO') {
    console.log(`[${_ts()}] [leoActivationService] [${level}] ${msg}`);
}

function _hoursAgo(h) {
    return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function _suppressUntil(hours) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function _readProgressDb(userId) {
    try {
        const records = getProgressByUser(userId);
        const map = {};
        for (const r of records) map[r.id] = r;
        return map;
    } catch {
        return {};
    }
}

/**
 * Returns the most recent session memory across all contents for a user.
 * Only considers sessions that have a real lastInterventionAt timestamp.
 */
function _getMostRecentSession(sessions) {
    const withTimestamp = sessions.filter(s => s.lastInterventionAt);
    if (withTimestamp.length === 0) return null;
    return withTimestamp.sort(
        (a, b) => new Date(b.lastInterventionAt) - new Date(a.lastInterventionAt)
    )[0];
}

/**
 * Returns progress records for a user that are incomplete and meaningfully started.
 * Threshold: globalPercentage > 5 (avoids surfacing abandoned 1-page opens).
 */
function _getActiveProgressRecords(userId, progressMap) {
    return Object.values(progressMap).filter(p =>
        p.userId === userId &&
        !p.isCompleted &&
        (p.canonicalProgress?.globalPercentage ?? 0) > 5
    );
}

// ── Detection: FAMILY ─────────────────────────────────────────────────────────

/**
 * Generates a family-facing summary of the student's recent reading activity.
 *
 * Conditions:
 *   - Evidence entries within RECENT_EVIDENCE_WINDOW_H hours
 *   - At least MIN_INTERACTIONS_FAMILY total
 *
 * Message: what they did + what family can do at home.
 */
function detectFamilyMessage(userId, profile, recentEvidence) {
    if (recentEvidence.length < MIN_INTERACTIONS_FAMILY) return null;

    const cutoff      = _hoursAgo(RECENT_EVIDENCE_WINDOW_H);
    const freshEntries = recentEvidence.filter(e => e.timestamp >= cutoff);
    if (freshEntries.length === 0) return null;

    // Dominant pedagogical objective from fresh entries (skip emotional/unknown)
    const objCounts = {};
    for (const e of freshEntries) {
        const obj = e.pedagogicalObjective ?? 'unknown';
        if (obj === 'unknown' || obj === 'emotional') continue;
        objCounts[obj] = (objCounts[obj] ?? 0) + 1;
    }
    const dominantObj = Object.entries(objCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

    const contentId = freshEntries[freshEntries.length - 1]?.contentId ?? null;
    const support   = profile?.preferredSupportType ?? null;

    const { what, homeAction } = _familyMessageParts(dominantObj, support);

    return {
        type:    'family',
        userId,
        contentId,
        message: `${what} ${homeAction}`,
        context: {
            dominantObjective:    dominantObj,
            preferredSupportType: support,
            freshInteractionCount: freshEntries.length,
            windowHours:           RECENT_EVIDENCE_WINDOW_H,
        },
        suppressUntil: _suppressUntil(SUPPRESS_FAMILY_H),
        createdAt:     _ts(),
    };
}

function _familyMessageParts(dominantObj, support) {
    const whatMap = {
        vocabulary:    'Hoy trabajó el significado de palabras nuevas.',
        inferential:   'Hoy trabajó inferencias: conectar ideas que el texto no dice directamente.',
        critical:      'Hoy reflexionó sobre los personajes y las decisiones de la historia.',
        writing:       'Hoy exploró la escritura creativa a partir de su lectura.',
        metacognitive: 'Hoy reflexionó sobre su propio proceso de lectura.',
        literal:       'Hoy trabajó comprensión literal: qué pasa en la historia.',
    };

    const homeMap = {
        vocabulary:    'En casa, cuando lea, puedes preguntarle: "¿qué crees que significa esa palabra?" antes de buscarla.',
        inferential:   'En casa, pregúntale: "¿qué crees que va a pasar después y por qué?"',
        critical:      'En casa, pregúntale: "¿estás de acuerdo con lo que hizo el personaje? ¿qué harías tú?"',
        writing:       'En casa, invítale a contarte con sus palabras cómo siguió la historia.',
        metacognitive: 'En casa, pregúntale: "¿qué fue lo más difícil de entender hoy?"',
        literal:       'En casa, pregúntale qué fue lo más interesante que leyó hoy.',
    };

    // Key resolution: dominant objective wins; fall back to support type; then generic
    const key = (dominantObj && whatMap[dominantObj])
        ? dominantObj
        : (support && whatMap[support] ? support : null);

    return {
        what:       key ? whatMap[key]   : 'Hoy tuvo una sesión de lectura activa.',
        homeAction: key ? homeMap[key]   : 'Pregúntale qué fue lo que más le gustó de su lectura de hoy.',
    };
}

// ── Detection: CONTINUITY ─────────────────────────────────────────────────────

/**
 * Generates a continuity nudge when the student should return to reading.
 *
 * Conditions (any one is sufficient):
 *   a) lastInterventionAt is between CONTINUITY_GAP_MS and CONTINUITY_MAX_STALE_MS old
 *   b) An activeSequenceId is open (unclosed pedagogical sequence)
 *   c) Incomplete progress records with meaningful advancement (> 5%)
 */
function detectContinuity(userId, sessions, activeProgressRecords) {
    const mostRecent = _getMostRecentSession(sessions);

    // a) Time gap check
    let gapSignal = null;
    if (mostRecent?.lastInterventionAt) {
        const age = Date.now() - new Date(mostRecent.lastInterventionAt).getTime();
        if (age > CONTINUITY_GAP_MS && age < CONTINUITY_MAX_STALE_MS) {
            gapSignal = {
                contentId: mostRecent.contentId ?? null,
                hoursAgo:  Math.round(age / (60 * 60 * 1000)),
            };
        }
    }

    // b) Open pedagogical sequence
    const openSeq = sessions.find(s => s.activeSequenceId != null) ?? null;

    // c) Best incomplete progress record
    const bestProgress = activeProgressRecords
        .sort((a, b) =>
            (b.canonicalProgress?.globalPercentage ?? 0) -
            (a.canonicalProgress?.globalPercentage ?? 0)
        )[0] ?? null;

    if (!gapSignal && !openSeq && !bestProgress) return null;

    let message;
    let contentId = null;

    // Priority: open sequence > incomplete progress > time gap
    if (openSeq) {
        contentId = openSeq.contentId ?? null;
        message   = 'Quedó una actividad de lectura sin terminar. Cuando quieras, podemos continuar.';
    } else if (bestProgress) {
        const pct  = Math.round(bestProgress.canonicalProgress?.globalPercentage ?? 0);
        contentId  = bestProgress.contentId ?? null;
        message    = `Tu lectura está al ${pct}%. ¿Seguimos para ver qué pasa?`;
    } else {
        contentId = gapSignal.contentId;
        message   = gapSignal.hoursAgo >= 24
            ? 'Hace más de un día que no lees. ¿Retomamos donde quedaste?'
            : `Han pasado ${gapSignal.hoursAgo} horas desde tu última sesión. ¿Seguimos?`;
    }

    return {
        type:    'continuity',
        userId,
        contentId,
        message,
        context: {
            hasOpenSequence:           !!openSeq,
            incompleteProgressPct:     bestProgress?.canonicalProgress?.globalPercentage ?? null,
            hoursSinceLastInteraction: gapSignal?.hoursAgo ?? null,
        },
        suppressUntil: _suppressUntil(SUPPRESS_CONTINUITY_H),
        createdAt:     _ts(),
    };
}

// ── Detection: RECOMMENDATION ─────────────────────────────────────────────────

/**
 * Generates a content type suggestion based on the student's profile and ICDLI.
 * Returns null only when no profile data exists at all.
 */
function detectRecommendation(userId, profile, icdliSnapshot) {
    const support  = profile?.preferredSupportType ?? null;
    const hasIcdli = icdliSnapshot?.hasData === true;
    const level    = icdliSnapshot?.levelLabel ?? null;
    const alerts   = icdliSnapshot?.dominantAlerts ?? [];

    if (!support && !hasIcdli) return null;

    const { label, description } = _recommendationParts(support, level, alerts);

    return {
        type:      'recommendation',
        userId,
        contentId: null,
        message:   `Tipo de lectura sugerida: ${label}. ${description}`,
        context: {
            basedOnSupportType: support,
            icdliLevel:         level,
            icdliAlerts:        alerts,
        },
        suppressUntil: _suppressUntil(SUPPRESS_RECOMMENDATION_H),
        createdAt:     _ts(),
    };
}

function _recommendationParts(support, level, alerts) {
    // ICDLI level extremes override support type
    if (level === 'Inicial') {
        return {
            label:       'textos cortos con apoyo visual',
            description: 'Textos breves con ilustraciones que refuercen la comprensión.',
        };
    }
    if (level === 'Avanzado') {
        return {
            label:       'narrativas complejas con múltiples perspectivas',
            description: 'Historias con estructuras no lineales o narradores múltiples.',
        };
    }

    const supportMap = {
        vocabulary: {
            label:       'textos con vocabulario accesible',
            description: 'Lecturas con contexto rico que apoye el significado de palabras nuevas.',
        },
        inferential: {
            label:       'historias con giros narrativos',
            description: 'Relatos que inviten a predecir y conectar ideas entre partes del texto.',
        },
        reflection: {
            label:       'lecturas con dilemas éticos o personajes complejos',
            description: 'Textos que generen debate y reflexión sobre las decisiones de los personajes.',
        },
    };

    return supportMap[support] ?? {
        label:       'lecturas variadas de nivel adecuado',
        description: 'Explora diferentes géneros para encontrar el que más te enganche.',
    };
}

// ── Detection: PRODUCTION ─────────────────────────────────────────────────────

/**
 * Generates a student production prompt (writing / reflection).
 *
 * Conditions (any one is sufficient):
 *   - Last sequence objective was 'writing' or 'critical' in any session
 *   - OR writingInteractionsCount > 0 in profile
 *   - OR reflectionInteractionsCount > 0 in profile
 */
function detectProductionPrompt(userId, sessions, profile) {
    const writingSession = sessions.find(s =>
        s.lastSequenceObjective === 'writing' || s.lastSequenceObjective === 'critical'
    ) ?? null;

    const hasWritingHistory    = (profile?.writingInteractionsCount    ?? 0) > 0;
    const hasReflectionHistory = (profile?.reflectionInteractionsCount ?? 0) > 0;

    if (!writingSession && !hasWritingHistory && !hasReflectionHistory) return null;

    const contentId = writingSession?.contentId ?? null;
    const lastObj   = writingSession?.lastSequenceObjective ?? null;

    const message = _productionPrompt(lastObj, hasWritingHistory);

    return {
        type:    'production',
        userId,
        contentId,
        message,
        context: {
            basedOnSequenceObjective:   lastObj,
            writingInteractionsCount:    profile?.writingInteractionsCount    ?? 0,
            reflectionInteractionsCount: profile?.reflectionInteractionsCount ?? 0,
        },
        suppressUntil: _suppressUntil(SUPPRESS_PRODUCTION_H),
        createdAt:     _ts(),
    };
}

function _productionPrompt(lastObj, hasWritingHistory) {
    if (lastObj === 'writing') {
        return '¿Cómo terminarías esta historia? Escríbelo en 2 oraciones con tus propias palabras.';
    }
    if (lastObj === 'critical') {
        return 'Describe al personaje principal: ¿qué lo hace interesante? ¿qué cambiarías de él?';
    }
    if (hasWritingHistory) {
        return 'Escoge una parte de tu lectura que te haya llamado la atención y cuéntala con tus palabras.';
    }
    return 'Comparte algo que te sorprendió o te gustó de lo que leíste hoy.';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates all relevant activation outputs for a user.
 *
 * Reads from: leoMemoryService, leoEvidenceService, leoICDLIBridge, progress_db.json
 * Returns:    LeoActivationOutput[] — 0 to 4 items, at most one per type
 * Never throws.
 *
 * @param {string} userId
 * @returns {LeoActivationOutput[]}
 */
export function getActivationOutputsForUser(userId) {
    if (!userId) return [];

    try {
        const profile        = getLeoLearnerProfile(userId);
        const sessions       = getAllSessionMemoriesForUser(userId);
        const evidence       = getEvidenceEntriesForUser(userId, 30);
        const icdli          = getLeoICDLISnapshot(userId);
        const progressMap    = _readProgressDb(userId);
        const activeProgress = _getActiveProgressRecords(userId, progressMap);

        const outputs = [];

        const family = detectFamilyMessage(userId, profile, evidence);
        if (family) outputs.push(family);

        const continuity = detectContinuity(userId, sessions, activeProgress);
        if (continuity) outputs.push(continuity);

        const recommendation = detectRecommendation(userId, profile, icdli);
        if (recommendation) outputs.push(recommendation);

        const production = detectProductionPrompt(userId, sessions, profile);
        if (production) outputs.push(production);

        _log(`userId=${userId} outputs=[${outputs.map(o => o.type).join(', ')}]`);
        return outputs;

    } catch (e) {
        _log(`getActivationOutputsForUser failed userId=${userId}: ${e.message}`, 'ERROR');
        return [];
    }
}
