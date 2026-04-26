/**
 * leoEvidenceService.js — Leo Evidence Log Service (D4)
 *
 * Builds and persists structured pedagogical evidence for every Leo interaction.
 * Each entry captures what kind of cognitive operation occurred, what surface
 * triggered it, and a short heuristic interpretation useful for ICDLI and
 * future mediator dashboards.
 *
 * PUBLIC API:
 *   buildLeoEvidenceEntry(enrichedReq, result)  → LeoEvidenceLogEntry
 *   persistLeoEvidence(entry)                   → void (fire-and-forget)
 *   classifyPedagogicalObjective(params)        → string
 *   deriveInterpretationHint(params)            → string
 *
 * LeoEvidenceLogEntry shape:
 *   { id, userId, contentId, surface, interactionType, chunkIndex,
 *     pedagogicalObjective, promptType, pedagogicalStage, difficultyLevel,
 *     userInputPreview, answerPreview, evidenceType, interpretationHint,
 *     icdliHasData, preferredSupportType, interactionCountAtEvent,
 *     sequenceId, sequenceStep, timestamp }
 *
 * PERSISTENCE:
 *   data/leo_evidence_db.json — { schemaVersion: 1, entries: [] }
 *   Append-only. Global cap: 2000 entries → trim to 1800 when exceeded.
 *   Atomic writes (tmp + rename), same pattern as leoMemoryService.js.
 *
 * CONSTRAINTS:
 *   - ESM pure, no new dependencies
 *   - No circular dep with server.js
 *   - All file I/O is synchronous (consistent with rest of backend)
 *   - Never throws — write errors are logged and swallowed
 *   - Classification is deterministic/heuristic — no AI, no NLP
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const _EVIDENCE_DB = path.resolve(__dirname, '../data/leo_evidence_db.json');

const _MAX_ENTRIES        = 2000;
const _TRIM_TO            = 1800;
const _INPUT_PREVIEW_LEN  = 80;   // intentionally short — diagnostic context only, not full text
const _ANSWER_PREVIEW_LEN = 150;

// Matches chatbot action tokens embedded in AI answers
const _TOKEN_REGEX = /\[INTERACTION_TYPE:\w+\]|\[AWARD_POINTS:\d+\]|\[SAVE_VOCAB:[^\]]+\]/g;

// ── Private helpers ───────────────────────────────────────────────────────────

const _ts = () => new Date().toISOString();

function _log(msg, level = 'INFO') {
    console.log(`[${_ts()}] [leoEvidenceService] [${level}] ${msg}`);
}

// Simple monotonic ID: prefix + userId fragment + timestamp base36 + seq
let _seq = 0;
function _generateId(userId) {
    _seq = (_seq + 1) % 100000;
    const stamp = Date.now().toString(36);
    const seq   = _seq.toString(36).padStart(4, '0');
    const uid   = String(userId ?? 'anon').replace(/[^a-z0-9]/gi, '').substring(0, 6);
    return `ev_${uid}_${stamp}_${seq}`;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

function _loadEvidenceDb() {
    try {
        if (!fs.existsSync(_EVIDENCE_DB)) return { schemaVersion: 1, entries: [] };
        const raw = fs.readFileSync(_EVIDENCE_DB, 'utf8');
        if (!raw.trim()) return { schemaVersion: 1, entries: [] };
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.entries)) parsed.entries = [];
        return parsed;
    } catch (e) {
        _log(`Error reading evidence DB: ${e.message}`, 'ERROR');
        return { schemaVersion: 1, entries: [] };
    }
}

function _writeEvidenceDb(db) {
    try {
        const tmp = `${_EVIDENCE_DB}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, _EVIDENCE_DB);
    } catch (e) {
        _log(`Error writing evidence DB: ${e.message}`, 'ERROR');
        // Intentionally not re-throwing — write failure must not break Leo response
    }
}

// ── promptType derivation ─────────────────────────────────────────────────────

/**
 * Maps interactionType to a promptType label.
 * Describes what kind of communicative move Leo made.
 */
function _derivePromptType(surface, interactionType) {
    if (surface === 'recap')               return 'greeting';
    switch (interactionType) {
        case 'vocab':                      return 'explanation';
        case 'writing':                    return 'invitation';
        case 'question':
        case 'inferential':
        case 'reflection':
        case 'chat':                       return 'question';
        default:                           return 'unknown';
    }
}

// ── pedagogicalObjective classification ──────────────────────────────────────

/**
 * Classifies a Leo interaction into a pedagogical objective.
 *
 * Priority order:
 *   1. Chatbot action tokens in answer (most explicit signal, set by the AI)
 *   2. interactionType from companion request (typed per-interaction)
 *   3. Surface defaults (chatbot: preferredSupportType fallback; recap: always emotional)
 *
 * Deterministic — no AI, no NLP, fully auditable.
 *
 * @param {object} params
 * @param {string}      params.surface
 * @param {string|null} params.interactionType
 * @param {string|null} params.preferredSupportType
 * @param {string}      params.answerRaw  — raw answer before token stripping
 * @returns {string}
 */
export function classifyPedagogicalObjective({ surface, interactionType, preferredSupportType, answerRaw }) {
    // 1. Chatbot action tokens — AI explicitly signals what it did
    if (surface === 'chatbot' && answerRaw) {
        const m = answerRaw.match(/\[INTERACTION_TYPE:(\w+)\]/);
        if (m) {
            if (m[1] === 'vocab')       return 'vocabulary';
            if (m[1] === 'inferential') return 'inferential';
            if (m[1] === 'reflection')  return 'critical';
        }
    }

    // 2. Companion interactionType — set per-interaction by the frontend/guard
    if (surface === 'companion') {
        switch (interactionType) {
            case 'vocab':         return 'vocabulary';
            case 'inferential':   return 'inferential';
            case 'reflection':    return 'critical';
            case 'question':      return 'literal';
            case 'writing':       return 'writing';
            case 'metacognitive': return 'metacognitive';
            default:              return 'literal';
        }
    }

    // 3. Recap — always motivational/emotional re-engagement
    if (surface === 'recap') return 'emotional';

    // 4. Chatbot fallback — use preferredSupportType as proxy for current mediation style
    if (preferredSupportType === 'vocabulary')  return 'vocabulary';
    if (preferredSupportType === 'inferential') return 'inferential';
    if (preferredSupportType === 'reflection')  return 'critical';

    return 'inferential'; // chatbot default: always mediates toward inference
}

// ── evidenceType classification ───────────────────────────────────────────────

/**
 * Classifies what kind of trace this interaction leaves.
 *
 *   engagement  → motivational re-engagement (recap)
 *   diagnostic  → early session, profile still forming
 *   scaffolded  → learner needed support (vocab under non-advanced difficulty)
 *   autonomous  → learner shows independence (advanced + non-vocabulary)
 *   continuity  → routine interaction, not specifically diagnostic
 */
function _classifyEvidenceType({ surface, interactionCount, difficultyLevel, pedagogicalObjective, icdliHasData }) {
    if (surface === 'recap')                                                         return 'engagement';
    if ((interactionCount ?? 0) <= 2 && !icdliHasData)                              return 'diagnostic';
    if ((interactionCount ?? 0) <= 5 && icdliHasData)                               return 'diagnostic';
    if (pedagogicalObjective === 'vocabulary' && difficultyLevel !== 'avanzado')    return 'scaffolded';
    if (difficultyLevel === 'avanzado' && pedagogicalObjective !== 'vocabulary')    return 'autonomous';
    return 'continuity';
}

// ── interpretationHint derivation ─────────────────────────────────────────────

/**
 * Derives a short heuristic interpretation hint.
 *
 * Plain-language strings — useful for future mediator dashboards and ICDLI D5+.
 * Not clinical, not grandiose. Consistent and auditable.
 *
 * @param {object} params
 * @returns {string}
 */
export function deriveInterpretationHint({ surface, pedagogicalObjective, evidenceType, difficultyLevel, preferredSupportType }) {
    if (surface === 'recap') return 'Interacción de reenganche, no diagnóstica';

    // objective + evidenceType matrix (most specific first)
    if (pedagogicalObjective === 'vocabulary'  && evidenceType === 'scaffolded')  return 'Solicita apoyo léxico en contexto';
    if (pedagogicalObjective === 'vocabulary'  && evidenceType === 'autonomous')  return 'Maneja vocabulario con autonomía';
    if (pedagogicalObjective === 'inferential' && evidenceType === 'autonomous')  return 'Responde bien a mediación inferencial';
    if (pedagogicalObjective === 'inferential' && evidenceType === 'scaffolded')  return 'Necesita andamiaje en inferencia';
    if (pedagogicalObjective === 'critical')                                      return 'Activa pensamiento evaluativo';
    if (pedagogicalObjective === 'metacognitive')                                 return 'Activa reflexión sobre su propio proceso';
    if (pedagogicalObjective === 'writing')                                       return 'Muestra iniciativa creativa';
    if (pedagogicalObjective === 'emotional')                                     return 'Interacción de continuidad, no diagnóstica';

    // evidenceType fallbacks
    if (evidenceType === 'diagnostic')  return 'Interacción inicial, perfil en construcción';
    if (evidenceType === 'scaffolded')  return 'Necesita andamiaje guiado';
    if (evidenceType === 'autonomous')  return 'Muestra autonomía lectora alta';
    if (evidenceType === 'engagement')  return 'Interacción de reenganche';

    return 'Interacción de continuidad';
}

// ── Entry builder ─────────────────────────────────────────────────────────────

/**
 * Builds a LeoEvidenceLogEntry from an enriched request and handler result.
 *
 * Does not throw. Malformed inputs produce safe defaults rather than errors.
 *
 * @param {LeoInteractionRequest} enrichedReq — the full enriched req from dispatchInteraction
 * @param {{ answer: string }}    result       — handler result
 * @returns {LeoEvidenceLogEntry}
 */
export function buildLeoEvidenceEntry(enrichedReq, result) {
    const {
        userId,
        contentId,
        surface,
        interactionType,
        chunkIndex,
        difficultyLevel,
        pedagogicalStage,
        readerProfile,
        sessionMemory,
        icdliSnapshot,
        payload,
        tituloLibro,
    } = enrichedReq;

    const answerRaw   = String(result?.answer ?? '');
    const answerClean = answerRaw.replace(_TOKEN_REGEX, '').trim();

    const preferredSupportType = readerProfile?.preferredSupportType ?? null;

    const pedagogicalObjective = classifyPedagogicalObjective({
        surface,
        interactionType,
        preferredSupportType,
        answerRaw,
    });

    // +1: recordInteraction() has already incremented the DB counter by the time
    // buildLeoEvidenceEntry is called. enrichedReq.sessionMemory was resolved
    // before that increment, so the snapshot is stale by exactly 1.
    const interactionCount = (sessionMemory?.interactionCount ?? 0) + 1;
    const icdliHasData     = icdliSnapshot?.hasData === true;

    const evidenceType = _classifyEvidenceType({
        surface,
        interactionCount,
        difficultyLevel,
        pedagogicalObjective,
        icdliHasData,
    });

    const interpretationHint = deriveInterpretationHint({
        surface,
        pedagogicalObjective,
        evidenceType,
        difficultyLevel,
        preferredSupportType,
    });

    // userInputPreview: intentionally short (80 chars) to reduce exposure of sensitive content.
    // For recap, store tituloLibro — the payload is a book snippet, not user input.
    const rawInput         = surface === 'recap' ? (tituloLibro ?? '') : (payload ?? '');
    const userInputPreview = String(rawInput).substring(0, _INPUT_PREVIEW_LEN);

    return {
        id:                      _generateId(userId),
        userId:                  userId            ?? 'anon',
        contentId:               contentId         ?? null,
        surface:                 surface           ?? 'unknown',
        interactionType:         interactionType   ?? 'unknown',
        chunkIndex:              chunkIndex        ?? null,
        pedagogicalObjective,
        promptType:              _derivePromptType(surface, interactionType),
        pedagogicalStage:        pedagogicalStage  ?? sessionMemory?.pedagogicalStage ?? null,
        difficultyLevel:         difficultyLevel   ?? 'medio',
        userInputPreview,
        answerPreview:           answerClean.substring(0, _ANSWER_PREVIEW_LEN),
        evidenceType,
        interpretationHint,
        icdliHasData,
        preferredSupportType,
        interactionCountAtEvent: interactionCount,
        // D5: sequence audit trail — null when no sequence was active
        sequenceId:   enrichedReq.sequenceContext?.sequenceId ?? null,
        sequenceStep: enrichedReq.sequenceContext?.step       ?? null,
        timestamp:    _ts(),
    };
}

// ── Read API (D6) ─────────────────────────────────────────────────────────────

/**
 * Returns the last `limit` evidence entries for a userId, chronological order.
 * Used by leoMediatorViewService — read-only, never throws.
 *
 * @param {string} userId
 * @param {number} [limit=20]
 * @returns {LeoEvidenceLogEntry[]}
 */
export function getEvidenceEntriesForUser(userId, limit = 20) {
    try {
        const db = _loadEvidenceDb();
        return db.entries
            .filter(e => e.userId === userId)
            .slice(-limit);
    } catch (e) {
        _log(`getEvidenceEntriesForUser failed userId=${userId}: ${e.message}`, 'ERROR');
        return [];
    }
}

/**
 * Returns the last `limit` evidence entries for a userId+contentId pair.
 * Used by leoMediatorViewService — read-only, never throws.
 *
 * @param {string} userId
 * @param {string} contentId
 * @param {number} [limit=10]
 * @returns {LeoEvidenceLogEntry[]}
 */
export function getEvidenceEntriesForContent(userId, contentId, limit = 10) {
    try {
        const db = _loadEvidenceDb();
        return db.entries
            .filter(e => e.userId === userId && e.contentId === contentId)
            .slice(-limit);
    } catch (e) {
        _log(`getEvidenceEntriesForContent failed userId=${userId} contentId=${contentId}: ${e.message}`, 'ERROR');
        return [];
    }
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Persists a LeoEvidenceLogEntry to the evidence DB.
 *
 * Append-only. Trims to _TRIM_TO entries when the global cap is exceeded.
 * Never throws — errors are logged and swallowed so the Leo response is unaffected.
 *
 * @param {LeoEvidenceLogEntry} entry
 */
export function persistLeoEvidence(entry) {
    try {
        const db = _loadEvidenceDb();
        db.entries.push(entry);

        if (db.entries.length > _MAX_ENTRIES) {
            db.entries = db.entries.slice(db.entries.length - _TRIM_TO);
            _log(`Evidence DB trimmed to ${_TRIM_TO} entries`);
        }

        _writeEvidenceDb(db);
    } catch (e) {
        _log(`persistLeoEvidence failed: ${e.message}`, 'ERROR');
    }
}
