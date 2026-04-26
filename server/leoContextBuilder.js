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
 *
 * Existing fields are unchanged.
 * New optional fields (lastSentenceIndex, lastReadAt, behavior,
 * interactionHistory, vocabularyAsked) are included only when present and valid.
 * Output is kept compact — empty arrays and absent values are omitted.
 */
function buildMemoryContext(sessionMemory) {
    if (!sessionMemory || typeof sessionMemory !== 'object') {
        return { sessionProgress: 0, lastQuestionType: null, anchorCount: 0 };
    }

    // ── Existing fields (unchanged) ──────────────────────────────────────────
    const sessionProgress = typeof sessionMemory.sessionReadingProgress === 'number'
        ? Math.max(0, Math.min(100, sessionMemory.sessionReadingProgress))
        : 0;

    const lastQuestionType = typeof sessionMemory.lastQuestionType === 'string'
        ? sessionMemory.lastQuestionType
        : null;

    const anchorCount = Array.isArray(sessionMemory.recentAnchors)
        ? sessionMemory.recentAnchors.length
        : 0;

    // ── New optional fields ──────────────────────────────────────────────────

    // lastSentenceIndex: finite non-negative integer only
    const rawIdx = sessionMemory.lastSentenceIndex;
    const lastSentenceIndex =
        typeof rawIdx === 'number' && Number.isFinite(rawIdx) && rawIdx >= 0
            ? Math.floor(rawIdx)
            : undefined;

    // lastReadAt: parseable date string only — do not fabricate a timestamp
    const rawDate = sessionMemory.lastReadAt;
    const lastReadAt =
        typeof rawDate === 'string' && !isNaN(new Date(rawDate).getTime())
            ? rawDate
            : undefined;

    // behavior: always present in output; fall back to zeroes when absent or corrupt
    const rawBeh = sessionMemory.behavior;
    const behavior =
        rawBeh && typeof rawBeh === 'object' && !Array.isArray(rawBeh)
            ? {
                pauses:  typeof rawBeh.pauses  === 'number' ? rawBeh.pauses  : 0,
                replays: typeof rawBeh.replays === 'number' ? rawBeh.replays : 0,
              }
            : { pauses: 0, replays: 0 };

    // interactionHistory: last 5 entries, each trimmed to { type, anchor, timestamp }
    const rawHistory = sessionMemory.interactionHistory;
    const interactionHistory = Array.isArray(rawHistory)
        ? rawHistory
            .filter(e => e && typeof e === 'object' && !Array.isArray(e))
            .slice(-5)
            .map(e => {
                const out = {};
                if (typeof e.type === 'string' && e.type.trim())
                    out.type = e.type.trim();
                if (typeof e.anchor === 'number' && Number.isFinite(e.anchor) && e.anchor >= 0)
                    out.anchor = Math.floor(e.anchor);
                if (typeof e.timestamp === 'string' && !isNaN(new Date(e.timestamp).getTime()))
                    out.timestamp = e.timestamp;
                return out;
            })
            .filter(e => Object.keys(e).length > 0)
        : [];

    // vocabularyAsked: last 5 non-empty trimmed strings
    const rawVocab = sessionMemory.vocabularyAsked;
    const vocabularyAsked = Array.isArray(rawVocab)
        ? rawVocab
            .filter(w => typeof w === 'string')
            .map(w => w.trim())
            .filter(w => w.length > 0)
            .slice(-5)
        : [];

    // ── Assemble — omit absent or empty optional fields ──────────────────────
    const ctx = { sessionProgress, lastQuestionType, anchorCount, behavior };

    if (lastSentenceIndex !== undefined)    ctx.lastSentenceIndex = lastSentenceIndex;
    if (lastReadAt        !== undefined)    ctx.lastReadAt        = lastReadAt;
    if (interactionHistory.length > 0)     ctx.interactionHistory = interactionHistory;
    if (vocabularyAsked.length    > 0)     ctx.vocabularyAsked    = vocabularyAsked;

    return ctx;
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
 * @param {object|null} leoContext        — Phase 4 transitional context
 * @returns {object} structured context packet
 */
export function buildLeoContextPacket(
    contentId,
    chunkIndex,
    sessionMemory,
    difficultyLevel,
    pedagogicalStage,
    readerProfile,
    leoContext
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

    // 8. Transitional context slot (Phase 4 — NEW)
    const resolvedTransitionalContext = (leoContext && typeof leoContext === 'object') ? leoContext : null;

    return {
        anchorsContext,
        pedagogicalContext,
        memoryContext,
        difficultyLevel: resolvedDifficulty,
        pedagogicalStage: resolvedStage,
        readerProfile: resolvedProfile,
        transitionalContext: resolvedTransitionalContext,
    };
}
