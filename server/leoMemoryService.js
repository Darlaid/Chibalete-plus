/**
 * leoMemoryService.js — Leo Backend Memory Service (D2)
 *
 * Single authority for reading and writing Leo's two memory layers:
 *
 *   LeoSessionMemory  → leo_memory_db.json  (per userId+contentId, short-lived)
 *   LeoLearnerProfile → leo_profile_db.json (per userId, accumulative)
 *
 * PUBLIC API:
 *   getLeoSessionMemory(userId, contentId)           → sessionMemory object
 *   updateLeoSessionMemory(userId, contentId, patch) → void
 *   getLeoLearnerProfile(userId)                     → profile object
 *   updateLeoLearnerProfile(userId, patch)           → void
 *   resolveLeoState({ userId, contentId,             → { sessionMemory, readerProfile }
 *                     incomingSessionMemory,
 *                     incomingReaderProfile })
 *   recordInteraction({ userId, contentId,           → void
 *                       surface, interactionType,
 *                       chunkIndex })
 *
 * MERGE RULES (backend wins):
 *   - Backend session fields win over frontend hints when they have a real value.
 *   - Frontend hints accepted only for fields absent/null in backend (first visit).
 *   - recentAnchors: backend is always authoritative (frontend writes via /api/leo/memory).
 *   - preferredSupportType: always computed from profile counters, never from frontend.
 *   - oralityAttemptsCount / averageOralityScore: frontend hint accepted until D3.
 *
 * CONSTRAINTS:
 *   - ESM pure, no new dependencies
 *   - No circular dep with server.js
 *   - All file I/O is synchronous (consistent with rest of backend)
 *   - Writes are atomic (temp + rename)
 *   - Never throws: write errors are logged and swallowed so Leo response never breaks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const _MEMORY_DB  = path.resolve(__dirname, '../data/leo_memory_db.json');
const _PROFILE_DB = path.resolve(__dirname, '../data/leo_profile_db.json');

// ── Profile hint policy ───────────────────────────────────────────────────────
// Only these profile fields may be contributed by the frontend as hints.
// All other profile fields are under exclusive backend authority.
// Absence from this list = the frontend value is silently discarded.

const ALLOWED_PROFILE_HINT_FIELDS = [
    'oralityAttemptsCount',
    'averageOralityScore',
];

// Type + range validators per hint field.
// A hint is accepted only when it passes its validator AND the backend value is empty.
const _hintValidators = {
    oralityAttemptsCount: v => typeof v === 'number' && Number.isFinite(v) && v >= 0,
    averageOralityScore:  v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100,
};

// ── Private helpers ───────────────────────────────────────────────────────────

const _ts = () => new Date().toISOString();

function _log(msg, level = 'INFO') {
    console.log(`[${_ts()}] [leoMemoryService] [${level}] ${msg}`);
}

/** userId + contentId → composite DB key */
function _makeKey(userId, contentId) {
    return `${userId}__${contentId}`;
}

function _readJsonSync(file) {
    try {
        if (!fs.existsSync(file)) return null;
        const data = fs.readFileSync(file, 'utf8');
        if (!data.trim()) return null;
        return JSON.parse(data);
    } catch (e) {
        _log(`Error reading ${file}: ${e.message}`, 'ERROR');
        return null;
    }
}

/** Atomic write: write to .tmp then rename. Same pattern as server.js writeJSON. */
function _writeJsonSync(file, data) {
    try {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
    } catch (e) {
        _log(`Error writing ${file}: ${e.message}`, 'ERROR');
        // Intentionally not re-throwing — write failure must not break Leo response
    }
}

// ── Default shapes ────────────────────────────────────────────────────────────

function _defaultSessionMemory() {
    return {
        schemaVersion:           1,     // bump when shape changes incompatibly
        recentAnchors:           [],
        lastQuestionType:        null,
        sessionReadingProgress:  0,
        difficultyLevel:         'medio',
        pedagogicalStage:        'comprehension',
        lastChunkIndex:          null,
        lastInterventionAt:      null,
        interactionCount:        0,
        updatedAt:               null,
        // D5: sequence engine state (null/0 = no active sequence)
        activeSequenceId:               null,
        activeSequenceStep:             0,
        activeSequenceObjective:        null,
        lastSequenceObjective:          null,
        lastSequenceAt:                 null,
        lastSequenceInteractionCount:   0,
    };
}

function _defaultProfile(userId) {
    return {
        schemaVersion:                1,     // bump when shape changes incompatibly
        userId,
        vocabularyInteractionsCount:  0,
        inferentialInteractionsCount: 0,
        reflectionInteractionsCount:  0,
        writingInteractionsCount:     0,  // D4: populated when AI response tokens are parsed
        totalChatInteractions:        0,
        oralityAttemptsCount:         0,  // until D3: accepts frontend hint
        averageOralityScore:          null, // until D3: accepts frontend hint
        preferredSupportType:         null, // always computed, never from frontend
        updatedAt:                    null,
    };
}

// ── Derived fields ────────────────────────────────────────────────────────────

/**
 * Computes preferredSupportType from accumulated interaction counts.
 * Returns null until at least one count is non-zero.
 */
function _derivePreferredSupportType(profile) {
    const v = profile.vocabularyInteractionsCount  ?? 0;
    const i = profile.inferentialInteractionsCount ?? 0;
    const r = profile.reflectionInteractionsCount  ?? 0;
    const max = Math.max(v, i, r);
    if (max === 0) return null;
    if (v === max) return 'vocabulary';
    if (i === max) return 'inferential';
    return 'reflection';
}

/**
 * Maps an interactionType to the profile counter it increments.
 * Returns null for types that don't map to a counter in D2.
 */
function _interactionTypeToCounter(interactionType) {
    switch (interactionType) {
        case 'vocab':       return 'vocabularyInteractionsCount';
        case 'inferential': return 'inferentialInteractionsCount';
        case 'reflection':  return 'reflectionInteractionsCount';
        case 'chat':        return 'totalChatInteractions';
        // 'question', 'recap', 'writing': no counter in D2
        default:            return null;
    }
}

// ── Memory DB operations ──────────────────────────────────────────────────────

function _loadMemoryDb() {
    const raw = _readJsonSync(_MEMORY_DB);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { memoryMap: {} };
    if (!raw.memoryMap || typeof raw.memoryMap !== 'object') raw.memoryMap = {};
    return raw;
}

function _loadProfileDb() {
    const raw = _readJsonSync(_PROFILE_DB);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { profileMap: {} };
    if (!raw.profileMap || typeof raw.profileMap !== 'object') raw.profileMap = {};
    return raw;
}

// ── Merge logic ───────────────────────────────────────────────────────────────

/**
 * Merges backend session memory with incoming frontend hints.
 *
 * Backend wins on all fields that have a real (non-null/non-zero) value.
 * Frontend hints are accepted only when the backend field is absent or at default.
 * recentAnchors: backend is always authoritative.
 */
function _mergeSessionMemory(backend, incoming) {
    if (!incoming || typeof incoming !== 'object') return backend;

    return {
        // backend is always authoritative for anchors
        recentAnchors: Array.isArray(backend.recentAnchors) ? backend.recentAnchors : [],

        // numeric progress: backend wins if > 0, else accept frontend hint
        sessionReadingProgress: backend.sessionReadingProgress > 0
            ? backend.sessionReadingProgress
            : (typeof incoming.sessionReadingProgress === 'number' ? incoming.sessionReadingProgress : 0),

        // stage: backend wins if set (not default 'comprehension' from a fresh record)
        // Exception: if backend is default but frontend has a more advanced stage, accept hint
        pedagogicalStage: _mergeStage(backend.pedagogicalStage, incoming.pedagogicalStage, backend.sessionReadingProgress),

        // difficulty: backend wins if not default 'medio'
        difficultyLevel: (backend.difficultyLevel && backend.difficultyLevel !== 'medio')
            ? backend.difficultyLevel
            : (incoming.difficultyLevel ?? backend.difficultyLevel ?? 'medio'),

        // backend metadata
        lastQuestionType:   backend.lastQuestionType   ?? incoming.lastQuestionType   ?? null,
        lastChunkIndex:     backend.lastChunkIndex     ?? incoming.lastChunkIndex     ?? null,
        lastInterventionAt: backend.lastInterventionAt ?? null,
        interactionCount:   backend.interactionCount   ?? 0,
        updatedAt:          backend.updatedAt          ?? null,
    };
}

/**
 * Stage merge: backend wins if it has advanced beyond the default.
 * If backend is 'comprehension' (default/fresh) but frontend signals progress,
 * accept frontend's stage as hint. Backend always wins once it advances past default.
 */
function _mergeStage(backendStage, incomingStage, backendProgress) {
    const STAGES = ['comprehension', 'interpretation', 'reflection', 'creation'];
    const backendIdx  = STAGES.indexOf(backendStage  ?? 'comprehension');
    const incomingIdx = STAGES.indexOf(incomingStage ?? 'comprehension');

    // If backend is past comprehension, it has real history — trust it
    if (backendIdx > 0) return STAGES[backendIdx];

    // Backend at comprehension, no real progress recorded yet
    // If frontend signals a more advanced stage AND progress supports it, accept hint
    if (incomingIdx > backendIdx && (backendProgress ?? 0) > 10) {
        return STAGES[incomingIdx];
    }

    return STAGES[backendIdx];
}

/**
 * Merges backend learner profile with incoming frontend hints.
 *
 * STRICT POLICY:
 *   - Backend is the base — incoming is never spread wholesale.
 *   - Only fields listed in ALLOWED_PROFILE_HINT_FIELDS may be hinted.
 *   - A hint is accepted only when:
 *       (a) the backend field is empty (null or 0), AND
 *       (b) the incoming value passes its type/range validator.
 *   - preferredSupportType: always recomputed from backend counters, never from frontend.
 *   - All other profile fields (counters, userId, schemaVersion): backend is sole authority.
 */
function _mergeProfile(backend, incoming) {
    if (!incoming || typeof incoming !== 'object') return backend;

    // Start from backend — incoming is NEVER spread into the result
    const merged = { ...backend };

    for (const field of ALLOWED_PROFILE_HINT_FIELDS) {
        const backendVal  = backend[field];
        const incomingVal = incoming[field];
        const backendEmpty = backendVal === null || backendVal === undefined || backendVal === 0;
        const validator    = _hintValidators[field];

        if (backendEmpty && incomingVal != null && validator?.(incomingVal)) {
            merged[field] = incomingVal;
        }
    }

    // preferredSupportType is always computed from backend counters — never from frontend
    merged.preferredSupportType = _derivePreferredSupportType(backend);

    return merged;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads the session memory for a specific userId+contentId.
 * Returns defaults if no record exists.
 */
export function getLeoSessionMemory(userId, contentId) {
    const db  = _loadMemoryDb();
    const key = _makeKey(userId, contentId);
    return db.memoryMap[key] ?? _defaultSessionMemory();
}

/**
 * Returns all session memory records for a userId across all contents.
 * Each entry includes a `contentId` field derived from the DB key.
 * Used by D6 mediator view to aggregate cross-content signals.
 *
 * @param {string} userId
 * @returns {Array<object>}  — array of session memory objects with contentId injected
 */
export function getAllSessionMemoriesForUser(userId) {
    if (!userId) return [];
    const db     = _loadMemoryDb();
    const prefix = `${userId}__`;
    return Object.entries(db.memoryMap)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, mem]) => ({ contentId: key.slice(prefix.length), ...mem }));
}

/**
 * Applies a shallow patch to the session memory for a userId+contentId.
 * Merges with existing record; always updates `updatedAt`.
 */
export function updateLeoSessionMemory(userId, contentId, patch) {
    if (!userId || !contentId) return;
    const db  = _loadMemoryDb();
    const key = _makeKey(userId, contentId);
    const existing = db.memoryMap[key] ?? _defaultSessionMemory();
    db.memoryMap[key] = {
        schemaVersion: 1,   // safe default — preserved if existing has higher version
        ...existing,
        ...patch,
        updatedAt: _ts(),
    };
    _writeJsonSync(_MEMORY_DB, db);
}

/**
 * Reads the learner profile for a userId.
 * Returns defaults if no profile exists.
 */
export function getLeoLearnerProfile(userId) {
    const db = _loadProfileDb();
    return db.profileMap[userId] ?? _defaultProfile(userId);
}

/**
 * Applies a shallow patch to the learner profile.
 * Always recomputes preferredSupportType from counts.
 */
export function updateLeoLearnerProfile(userId, patch) {
    if (!userId) return;
    const db = _loadProfileDb();
    const existing = db.profileMap[userId] ?? _defaultProfile(userId);
    const updated = {
        schemaVersion: 1,   // safe default — preserved if existing has higher version
        ...existing,
        ...patch,
        updatedAt: _ts(),
    };
    // Recompute every time we touch the profile
    updated.preferredSupportType = _derivePreferredSupportType(updated);
    db.profileMap[userId] = updated;
    _writeJsonSync(_PROFILE_DB, db);
}

/**
 * Resolves the effective Leo state for an interaction.
 *
 * Returns { sessionMemory, readerProfile } shaped for consumption by the
 * orchestrator handlers (leoContextBuilder, _handleChat, etc.).
 * Frontend values in incomingSessionMemory / incomingReaderProfile are
 * treated as hints; backend values win according to merge rules above.
 *
 * @param {object} params
 * @param {string|null} params.userId
 * @param {string|null} params.contentId
 * @param {object|null} params.incomingSessionMemory   — from req.sessionMemory (frontend)
 * @param {object|null} params.incomingReaderProfile   — from req.readerProfile (frontend)
 * @returns {{ sessionMemory: object, readerProfile: object }}
 */
export function resolveLeoState({ userId, contentId, incomingSessionMemory, incomingReaderProfile }) {
    // Read backend state
    const backendSession = (userId && contentId)
        ? getLeoSessionMemory(userId, contentId)
        : _defaultSessionMemory();

    const backendProfile = userId
        ? getLeoLearnerProfile(userId)
        : _defaultProfile(null);

    // Resolve with merge rules
    const sessionMemory = _mergeSessionMemory(backendSession, incomingSessionMemory);
    const readerProfile = _mergeProfile(backendProfile, incomingReaderProfile);

    return { sessionMemory, readerProfile };
}

/**
 * Records a completed Leo interaction into session memory and learner profile.
 * Must be called AFTER the handler resolves — does not affect the response.
 *
 * Write errors are caught and logged; they never propagate to the caller.
 *
 * @param {object} params
 * @param {string|null} params.userId
 * @param {string|null} params.contentId
 * @param {string}      params.surface          — 'companion'|'chatbot'|'recap'
 * @param {string}      params.interactionType  — from LeoInteractionRequest
 * @param {number|null} [params.chunkIndex]
 */
export function recordInteraction({ userId, contentId, surface, interactionType, chunkIndex }) {
    if (!userId) return;  // anonymous session — nothing to persist

    const now = _ts();

    // ── 1. Session memory update ──────────────────────────────────────────────
    if (contentId) {
        try {
            const db  = _loadMemoryDb();
            const key = _makeKey(userId, contentId);
            const existing = db.memoryMap[key] ?? _defaultSessionMemory();
            db.memoryMap[key] = {
                schemaVersion: 1,   // safe default — preserved if existing has higher version
                ...existing,
                lastInterventionAt: now,
                interactionCount:   (existing.interactionCount ?? 0) + 1,
                ...(chunkIndex != null ? { lastChunkIndex: chunkIndex } : {}),
                updatedAt: now,
            };
            _writeJsonSync(_MEMORY_DB, db);
        } catch (e) {
            _log(`recordInteraction: session write failed userId=${userId} contentId=${contentId}: ${e.message}`, 'WARN');
        }
    }

    // ── 2. Learner profile counter update ─────────────────────────────────────
    const counterField = _interactionTypeToCounter(interactionType);
    if (!counterField) return;

    try {
        const db       = _loadProfileDb();
        const existing = db.profileMap[userId] ?? _defaultProfile(userId);
        const updated  = {
            schemaVersion: 1,   // safe default — preserved if existing has higher version
            ...existing,
            [counterField]: (existing[counterField] ?? 0) + 1,
            updatedAt: now,
        };
        updated.preferredSupportType = _derivePreferredSupportType(updated);
        db.profileMap[userId] = updated;
        _writeJsonSync(_PROFILE_DB, db);
    } catch (e) {
        _log(`recordInteraction: profile write failed userId=${userId}: ${e.message}`, 'WARN');
    }
}
