/**
 * leoSequenceService.js — Leo Sequence Engine (D5)
 *
 * Decides whether a Leo interaction should be part of a micro-sequence,
 * which sequence to activate, which step to execute, and how to persist
 * the sequence state.
 *
 * A micro-sequence is a 2-step pedagogical arc:
 *   step 0 — Leo initiates (asks / invites)
 *   step 1 — Leo follows up and closes
 *
 * The sequence instruction is injected into the existing prompt pipeline
 * as an internal directive — invisible to students, usable by the AI.
 *
 * PUBLIC API:
 *   resolveSequenceContext(params)      → LeoSequenceContext | null
 *   commitSequenceState(params)         → void  (fire-and-forget)
 *   buildSequencePromptSection(ctx)     → string
 *
 * LeoSequenceContext:
 *   { sequenceId, objective, step, promptInstruction,
 *     isLastStep, isActive, isClosing }
 *
 * SEQUENCES (D5 MVP — 4 objectives × 2 steps):
 *   literal      — comprehension  stage: one focused literal question
 *   inferential  — interpretation stage: one inference question
 *   reflective   — reflection     stage: one critical-thinking invite
 *   writing      — creation       stage: one creative production invite
 *
 * ACTIVATION RULES:
 *   - Cooldown: MIN_SEQUENCE_COOLDOWN (3) interactions between activations
 *   - No consecutive repetition of same objective
 *   - recap surface: never sequences
 *   - Stage-based priority; support-type as tie-breaker
 *
 * CONSTRAINTS:
 *   - ESM pure, no new dependencies
 *   - No circular dep with server.js
 *   - Uses updateLeoSessionMemory (already exported) from leoMemoryService
 *   - Never throws — errors logged and swallowed, Leo continues without sequence
 *   - All logic is deterministic/heuristic — no AI, no NLP
 */

import { updateLeoSessionMemory } from './leoMemoryService.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Minimum interactions between sequence activations (after the first one).
// Prevents Leo from becoming repetitive or feeling mechanical.
const MIN_SEQUENCE_COOLDOWN = 3;

// Threshold for the very first sequence activation (no sequence has ever run).
// Allows the first sequence from the 2nd interaction onward (currentCount >= 1).
const FIRST_SEQUENCE_COOLDOWN = 1;

// ── Sequence definitions ──────────────────────────────────────────────────────
//
// Each entry: { objective, allowedSurfaces, preferredStage, steps[] }
// steps[]: { promptInstruction, isLastStep }
//
// promptInstruction is appended to the system context as an internal
// directive — never exposed to the student verbatim.
// Label prefix "SECUENCIA ACTIVA" makes it easy to grep logs.

const SEQUENCE_DEFS = {

    literal: {
        objective:       'literal',
        allowedSurfaces: ['companion', 'chatbot'],
        preferredStage:  'comprehension',
        steps: [
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 1/2 — comprensión literal): ' +
                    'Haz UNA pregunta de comprensión literal sobre el texto. ' +
                    'Ejemplo: "¿Quién hizo qué en este fragmento?" o "¿Qué pasó primero?". ' +
                    'Una sola pregunta, formula natural. No añadas más preguntas. Espera respuesta.',
                isLastStep: false,
            },
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 2/2 — cierre literal): ' +
                    'El estudiante acaba de responder una pregunta de comprensión literal. ' +
                    'Confirma brevemente lo correcto, añade UN detalle literal que complete la respuesta ' +
                    'y cierra con una frase motivadora corta.',
                isLastStep: true,
            },
        ],
    },

    inferential: {
        objective:       'inferential',
        allowedSurfaces: ['companion', 'chatbot'],
        preferredStage:  'interpretation',
        steps: [
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 1/2 — inferencia): ' +
                    'Haz UNA pregunta de inferencia sobre el texto. ' +
                    'Ejemplo: "¿Por qué crees que el personaje hizo eso, si el texto no lo explica?" ' +
                    'o "¿Qué crees que pasará después y por qué?". ' +
                    'Una sola pregunta, formula natural. Espera respuesta.',
                isLastStep: false,
            },
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 2/2 — cierre inferencial): ' +
                    'El estudiante acaba de responder una pregunta de inferencia. ' +
                    'Valida su razonamiento con una frase específica ' +
                    '(ej: "Es una buena interpretación porque..."), ' +
                    'añade UNA pista que profundice y cierra con aliento.',
                isLastStep: true,
            },
        ],
    },

    reflective: {
        objective:       'critical',
        allowedSurfaces: ['companion', 'chatbot'],
        preferredStage:  'reflection',
        steps: [
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 1/2 — reflexión crítica): ' +
                    'Invita al estudiante a reflexionar críticamente sobre el texto. ' +
                    'Ejemplo: "¿Estás de acuerdo con lo que hizo el personaje?" ' +
                    'o "¿Qué harías tú en su lugar?". ' +
                    'Una sola invitación directa. Espera respuesta.',
                isLastStep: false,
            },
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 2/2 — cierre reflexivo): ' +
                    'El estudiante acaba de compartir una reflexión crítica. ' +
                    'Valida su perspectiva, conéctala con su experiencia personal ' +
                    'o con otro libro del catálogo si aplica, y cierra con entusiasmo genuino.',
                isLastStep: true,
            },
        ],
    },

    writing: {
        objective:       'writing',
        allowedSurfaces: ['companion', 'chatbot'],
        preferredStage:  'creation',
        steps: [
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 1/2 — producción escrita): ' +
                    'Invita al estudiante a producir brevemente. ' +
                    'Ejemplo: "Escribe en 2 oraciones cómo terminarías esta historia" ' +
                    'o "¿Qué le dirías al autor si pudieras?". ' +
                    'Una sola invitación concreta. Espera respuesta.',
                isLastStep: false,
            },
            {
                promptInstruction:
                    'SECUENCIA ACTIVA (paso 2/2 — cierre creativo): ' +
                    'El estudiante acaba de escribir algo creativo. ' +
                    'Celébralo genuinamente, menciona algo específico de su respuesta ' +
                    'y cierra invitándolo a seguir leyendo.',
                isLastStep: true,
            },
        ],
    },

};

// Stage → preferred sequence order. First non-repeated match wins.
const STAGE_PRIORITY = {
    comprehension:  ['literal',     'inferential'],
    interpretation: ['inferential', 'literal'],
    reflection:     ['reflective',  'inferential'],
    creation:       ['writing',     'reflective'],
};

// Maps a pedagogical objective (from evidence/profile) back to a sequence key.
const OBJ_TO_SEQ_KEY = {
    literal:     'literal',
    inferential: 'inferential',
    critical:    'reflective',
    writing:     'writing',
};

// ── Private helpers ───────────────────────────────────────────────────────────

const _ts = () => new Date().toISOString();

function _log(msg, level = 'INFO') {
    console.log(`[${_ts()}] [leoSequenceService] [${level}] ${msg}`);
}

let _seqCounter = 0;
function _generateSequenceId(key) {
    _seqCounter = (_seqCounter + 1) % 10000;
    const stamp = Date.now().toString(36);
    const seq   = _seqCounter.toString(36).padStart(3, '0');
    return `seq_${key}_${stamp}_${seq}`;
}

function _objectiveToSequenceKey(objective) {
    return OBJ_TO_SEQ_KEY[objective] ?? null;
}

/**
 * Selects the best sequence key to activate given current state.
 * Returns null if no sequence is appropriate.
 *
 * Priority:
 *   1. ICDLI override: levelLabel==='Inicial' → literal first
 *   2. Sequence preferred for current pedagogical stage
 *   3. Sequence matching readerProfile.preferredSupportType (tie-breaker)
 *   4. Filter: surface must be in allowedSurfaces
 *   5. Filter: must not repeat lastSequenceObjective consecutively
 */
function _selectSequenceKey({ sessionMemory, readerProfile, icdliSnapshot, surface }) {
    const stage       = sessionMemory.pedagogicalStage      ?? 'comprehension';
    const supportType = readerProfile?.preferredSupportType ?? null;
    const lastObj     = sessionMemory.lastSequenceObjective ?? null;
    const lastKey     = lastObj ? _objectiveToSequenceKey(lastObj) : null;

    // ICDLI override: Inicial level → push literal to front of candidate list
    const icdliPriority = icdliSnapshot?.levelLabel === 'Inicial' ? ['literal'] : [];

    // Stage-based candidates (ordered by priority)
    const stageCandidates = STAGE_PRIORITY[stage] ?? ['literal'];

    // Support-type extras (added after stage candidates, as tie-breakers)
    const supportExtras = [];
    if (supportType === 'vocabulary')   supportExtras.push('literal');
    if (supportType === 'inferential')  supportExtras.push('inferential');
    if (supportType === 'reflection')   supportExtras.push('reflective');

    // Merge: ICDLI first, then stage, then support — preserve order, remove duplicates
    const allCandidates = [...new Set([...icdliPriority, ...stageCandidates, ...supportExtras])];

    // Filter: surface allowed + not consecutive repetition
    const valid = allCandidates.filter(k => {
        const def = SEQUENCE_DEFS[k];
        return def
            && def.allowedSurfaces.includes(surface)
            && k !== lastKey;
    });

    return valid[0] ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolves the sequence context for the current interaction.
 *
 * Returns null          → no sequence active or applicable; Leo behaves as usual.
 * Returns ctx (isActive) → a step is ready; inject ctx.promptInstruction into prompt.
 * Returns ctx (isClosing)→ sequence just completed; no instruction, just update state.
 *
 * Logic:
 *   1. If session has an active sequence → advance to next step (or close if at end).
 *   2. If no active sequence → check cooldown → select → activate step 0.
 *   3. recap surface → always null (no sequencing).
 *
 * Never throws — exceptions are caught and null is returned so Leo always responds.
 *
 * @param {object}      params.sessionMemory   — merged state from D2 resolveLeoState
 * @param {object|null} params.readerProfile   — merged profile from D2
 * @param {object|null} params.icdliSnapshot   — from D3 (read-only context, not used for selection)
 * @param {string}      params.surface         — 'companion' | 'chatbot' | 'recap'
 * @returns {LeoSequenceContext|null}
 */
export function resolveSequenceContext({ sessionMemory, readerProfile, icdliSnapshot, surface }) {
    if (surface === 'recap') return null;

    try {
        const activeId  = sessionMemory.activeSequenceId       ?? null;
        const activeObj = sessionMemory.activeSequenceObjective ?? null;

        // ── 1. Advance an already-active sequence ─────────────────────────────
        if (activeId && activeObj) {
            const seqKey  = _objectiveToSequenceKey(activeObj);
            const def     = SEQUENCE_DEFS[seqKey];
            const nextStep = (sessionMemory.activeSequenceStep ?? 0) + 1;

            if (!def || nextStep >= def.steps.length) {
                // Beyond last step or definition missing → close cleanly
                _log(`closing seqId=${activeId} obj=${activeObj}`);
                return {
                    sequenceId:        activeId,
                    objective:         activeObj,
                    step:              nextStep,
                    promptInstruction: null,
                    isLastStep:        true,
                    isActive:          false,
                    isClosing:         true,
                };
            }

            const stepDef = def.steps[nextStep];
            _log(`advancing seqId=${activeId} obj=${activeObj} step=${nextStep}`);
            return {
                sequenceId:        activeId,
                objective:         activeObj,
                step:              nextStep,
                promptInstruction: stepDef.promptInstruction,
                isLastStep:        stepDef.isLastStep,
                isActive:          true,
                isClosing:         false,
            };
        }

        // ── 2. Cooldown check ─────────────────────────────────────────────────
        // First-ever activation uses a shorter threshold so the first sequence
        // can fire from the 2nd interaction onward (currentCount >= 1).
        // Subsequent activations use the standard MIN_SEQUENCE_COOLDOWN.
        const lastCount    = sessionMemory.lastSequenceInteractionCount ?? 0;
        const currentCount = sessionMemory.interactionCount             ?? 0;
        const isFirstEver  = !sessionMemory.lastSequenceObjective;
        const threshold    = isFirstEver ? FIRST_SEQUENCE_COOLDOWN : MIN_SEQUENCE_COOLDOWN;
        if (currentCount - lastCount < threshold) return null;

        // ── 3. Select and activate ────────────────────────────────────────────
        const seqKey = _selectSequenceKey({ sessionMemory, readerProfile, icdliSnapshot, surface });
        if (!seqKey) return null;

        const def   = SEQUENCE_DEFS[seqKey];
        const seqId = _generateSequenceId(seqKey);
        const step0 = def.steps[0];

        _log(`activating seqId=${seqId} key=${seqKey} obj=${def.objective} surface=${surface}`);
        return {
            sequenceId:        seqId,
            objective:         def.objective,
            step:              0,
            promptInstruction: step0.promptInstruction,
            isLastStep:        step0.isLastStep,
            isActive:          true,
            isClosing:         false,
        };

    } catch (e) {
        _log(`resolveSequenceContext failed: ${e.message}`, 'WARN');
        return null;
    }
}

/**
 * Persists sequence state to session memory after an interaction resolves.
 *
 * Call order: commitSequenceState → recordInteraction (D2) → evidence (D4).
 * Uses updateLeoSessionMemory — atomic write, fire-and-forget.
 * Never throws.
 *
 * State transitions:
 *   step=0, isActive    → open sequence (write activeSequenceId, cooldown counter)
 *   step>0, isActive, isLastStep → close sequence (clear active, record lastObjective)
 *   isClosing           → close sequence (same as above)
 *   step>0, !isLastStep → advance step counter (future: sequences > 2 steps)
 *
 * @param {string}                  params.userId
 * @param {string}                  params.contentId
 * @param {LeoSequenceContext|null} params.sequenceCtx
 * @param {number}                  params.currentInteractionCount
 *   The interactionCount from enrichedReq.sessionMemory (pre-recordInteraction value).
 *   Used to set lastSequenceInteractionCount for cooldown checks.
 */
export function commitSequenceState({ userId, contentId, sequenceCtx, currentInteractionCount }) {
    if (!userId || !contentId || !sequenceCtx) return;

    try {
        // Close: sequence completed or forcibly closed
        if (sequenceCtx.isClosing || (sequenceCtx.isActive && sequenceCtx.isLastStep)) {
            updateLeoSessionMemory(userId, contentId, {
                activeSequenceId:               null,
                activeSequenceStep:             0,
                activeSequenceObjective:        null,
                lastSequenceObjective:          sequenceCtx.objective ?? null,
                lastSequenceAt:                 _ts(),
            });
            _log(`committed close obj=${sequenceCtx.objective} userId=${userId}`);
            return;
        }

        // Open: new sequence at step 0
        if (sequenceCtx.isActive && sequenceCtx.step === 0) {
            updateLeoSessionMemory(userId, contentId, {
                activeSequenceId:               sequenceCtx.sequenceId,
                activeSequenceStep:             0,
                activeSequenceObjective:        sequenceCtx.objective,
                lastSequenceInteractionCount:   currentInteractionCount ?? 0,
            });
            _log(`committed open seqId=${sequenceCtx.sequenceId} userId=${userId}`);
            return;
        }

        // Advance mid-sequence (guard for future >2-step sequences)
        if (sequenceCtx.isActive && sequenceCtx.step > 0) {
            updateLeoSessionMemory(userId, contentId, {
                activeSequenceStep: sequenceCtx.step,
            });
        }

    } catch (e) {
        _log(`commitSequenceState failed: ${e.message}`, 'WARN');
    }
}

/**
 * Builds the sequence instruction block for injection into a chatbot system prompt.
 * Returns empty string when no active sequence or no instruction.
 *
 * @param {LeoSequenceContext|null} ctx
 * @returns {string}
 */
export function buildSequencePromptSection(ctx) {
    if (!ctx?.isActive || !ctx?.promptInstruction) return '';
    // Step 1 defensive fallback: if the student didn't respond to the step 0 question,
    // the AI should close gracefully rather than forcing a follow-up that has no basis.
    // The sequence closes at state level regardless (isLastStep:true in all step[1] defs).
    const fallback = ctx.step === 1
        ? ' Si el estudiante no respondió directamente a la pregunta anterior, cierra la secuencia con naturalidad y continúa la conversación sin forzar el tema.'
        : '';
    return `\n\nINSTRUCCIÓN INTERNA DE SECUENCIA (no compartir con el estudiante):\n${ctx.promptInstruction}${fallback}`;
}
