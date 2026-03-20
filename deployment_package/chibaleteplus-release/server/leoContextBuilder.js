/**
 * leoContextBuilder.js — Structured Leo Context Assembly
 *
 * Single entry point for building the Leo context packet.
 * Each slot is independently retrievable and can later be replaced
 * by a retrieval-backed (RAG) source without changing callers.
 */

import { retrieveStructuredContext } from './leoRetriever.js';

const DEFAULT_DIFFICULTY = 'medio';
const DEFAULT_STAGE = 'comprehension';
const VALID_STAGES = ['comprehension', 'interpretation', 'reflection', 'creation'];

/**
 * Derive a safe, bounded memoryContext from the raw sessionMemory sent by the frontend.
 */
function buildMemoryContext(sessionMemory) {
    if (!sessionMemory || typeof sessionMemory !== 'object') {
        return { sessionProgress: 0, lastQuestionType: null, anchorCount: 0 };
    }
    return {
        sessionProgress: typeof sessionMemory.sessionReadingProgress === 'number'
            ? Math.max(0, Math.min(100, sessionMemory.sessionReadingProgress))
            : 0,
        lastQuestionType: typeof sessionMemory.lastQuestionType === 'string'
            ? sessionMemory.lastQuestionType
            : null,
        anchorCount: Array.isArray(sessionMemory.recentAnchors)
            ? sessionMemory.recentAnchors.length
            : 0,
    };
}

/**
 * Sanitize the readerProfile received from the frontend.
 * Only the fields Leo actually uses are forwarded; rest are discarded.
 */
function sanitizeReaderProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    return {
        preferredSupportType:  profile.preferredSupportType  ?? null,
        vocabularySupportCount: typeof profile.vocabularySupportCount === 'number' ? profile.vocabularySupportCount : 0,
        oralityAttemptsCount:   typeof profile.oralityAttemptsCount  === 'number' ? profile.oralityAttemptsCount  : 0,
        averageOralityScore:    typeof profile.averageOralityScore   === 'number' ? profile.averageOralityScore   : null,
    };
}

/**
 * buildLeoContextPacket — assemble all context sources for a Leo interaction.
 *
 * @param {string}      contentId
 * @param {number}      chunkIndex
 * @param {object|null} sessionMemory     — LeoSessionMemory from frontend
 * @param {string|null} difficultyLevel   — 'inicial'|'medio'|'avanzado'
 * @param {string|null} pedagogicalStage  — 'comprehension'|...|'creation'
 * @param {object|null} readerProfile     — subset of LeoReaderProfile
 * @returns {object} structured context packet
 */
export function buildLeoContextPacket(
    contentId,
    chunkIndex,
    sessionMemory,
    difficultyLevel,
    pedagogicalStage,
    readerProfile
) {
    // 1. Retrieve all available structured context from disk
    const raw = retrieveStructuredContext(contentId, chunkIndex);

    // 2. Anchor + vocabulary slot
    const anchorsContext = {
        anchors:         raw.anchors         ?? [],
        vocabulary:      raw.vocabulary      ?? [],
        vocabularyNotes: raw.vocabularyNotes ?? null,
    };

    // 3. Pedagogical context slot (admin-only materials, never exposed to frontend)
    const pedagogicalContext = {
        guide:      raw.pedagogicalGuide ?? null,
        authorBio:  raw.authorBio        ?? null,
        historical: raw.historicalContext ?? null,
        literary:   raw.literaryNotes    ?? null,
    };

    // 4. Session memory slot (derived — never a raw dump)
    const memoryContext = buildMemoryContext(sessionMemory);

    // 5. Difficulty level with safe default
    const validLevels = ['inicial', 'medio', 'avanzado'];
    const resolvedDifficulty = validLevels.includes(difficultyLevel)
        ? difficultyLevel
        : DEFAULT_DIFFICULTY;

    // 6. Pedagogical stage (Phase 5.5 — NEW)
    const resolvedStage = VALID_STAGES.includes(pedagogicalStage)
        ? pedagogicalStage
        : DEFAULT_STAGE;

    // 7. Reader profile slot (Phase 5.5 — NEW)
    const resolvedProfile = sanitizeReaderProfile(readerProfile);

    return {
        anchorsContext,
        pedagogicalContext,
        memoryContext,
        difficultyLevel: resolvedDifficulty,
        pedagogicalStage: resolvedStage,
        readerProfile: resolvedProfile,
    };
}
