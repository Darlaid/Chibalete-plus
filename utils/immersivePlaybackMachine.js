/**
 * immersivePlaybackMachine.js — Coordinador puro de transición de índices.
 *
 * Materializa las INVARIANTES 13/14/15/16/17 y los criterios 1-12 del sprint
 * de hardening de sincronización. Función PURA: dado (state, action), devuelve
 * { state, effects[] }. Sin React, sin DOM, sin side effects internos.
 *
 * El hook `useImmersivePlayback` mantiene una instancia del state vía useRef,
 * llama `reduce(state, action)` y EJECUTA los effects (play audio, log, save).
 * Los tests importan `reduce` directamente y verifican transiciones sin
 * necesidad de DOM.
 *
 * Diseño:
 *   - Single Source of Truth: este módulo posee TODOS los índices y el status.
 *   - INV-13: visualIndex/committedIndex se actualizan ATÓMICAMENTE en
 *     COMMIT_ADVANCE — antes están ambos en el último committed.
 *   - INV-14: SAVE_PROGRESS_REQUEST devuelve { allowed: false } si toIndex
 *     supera committedIndex.
 *   - INV-15: PAUSE / BLOCK_COMPLETE / SKIP / CONTENT_CHANGE / UNMOUNT
 *     limpian pendingTransition y emiten effect 'cancel_pending'.
 *   - INV-16: SKIP es hard resync atómico.
 *   - INV-17: COMMIT_ADVANCE emite effects en orden:
 *     log index_commit → log sentence_advanced → play_audio → save_progress.
 *
 * Tests: utils/__tests__/immersivePlaybackMachine.test.js
 */

// ───────────────────────────────────────────────────────────────────────────
// ESTADO INICIAL
// ───────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'idle'|'loading'|'playing'|'pending_advance'|'committing'|'paused'|'block_completed'|'error'} PlaybackMachineStatus
 *
 * @typedef {object} PendingTransition
 * @property {number} id                  Monotonic transitionId (anti-stale).
 * @property {number} fromIndex
 * @property {number} toIndex
 * @property {string} reason              'audio_ended' | 'skip' | 'load'
 * @property {number} scheduledAt
 * @property {number} minCommitAt         Earliest timestamp commit allowed.
 * @property {boolean} visualAckReceived  Set true por VISUAL_ACK.
 * @property {boolean} requireVisualAck   Si true, COMMIT_ADVANCE espera ack.
 *
 * @typedef {object} MachineState
 * @property {PlaybackMachineStatus} status
 * @property {string} sessionKey
 * @property {string} contentId
 * @property {number} audioIndex          Audio sonando o listo.
 * @property {number} visualIndex         Frase centrada en pantalla.
 * @property {number} committedIndex      Último confirmado (audio+visual).
 * @property {number} progressIndex       Último persistible.
 * @property {PendingTransition|null} pendingTransition
 * @property {number} _nextTransitionId   Contador interno monotónico.
 * @property {string|null} error
 */

/**
 * Crea estado inicial.
 * @param {{ sessionKey: string, contentId: string, startIndex?: number }} init
 * @returns {MachineState}
 */
export function initialState({ sessionKey, contentId, startIndex = 0 }) {
    return {
        status:            'idle',
        sessionKey,
        contentId,
        audioIndex:        startIndex,
        visualIndex:       startIndex,
        committedIndex:    startIndex,
        progressIndex:     startIndex,
        pendingTransition: null,
        _nextTransitionId: 1,
        error:             null,
    };
}

// ───────────────────────────────────────────────────────────────────────────
// ACTIONS — discriminated union
// ───────────────────────────────────────────────────────────────────────────

/**
 * Acciones disponibles. La sintaxis `type: 'X', ...payload`.
 */
export const Actions = Object.freeze({
    START_PLAY:            'START_PLAY',
    AUDIO_ENDED:           'AUDIO_ENDED',
    SCHEDULE_ADVANCE:      'SCHEDULE_ADVANCE',
    COMMIT_ADVANCE:        'COMMIT_ADVANCE',
    VISUAL_ACK:            'VISUAL_ACK',
    SAVE_PROGRESS_REQUEST: 'SAVE_PROGRESS_REQUEST',
    PAUSE:                 'PAUSE',
    SKIP:                  'SKIP',
    BLOCK_COMPLETE:        'BLOCK_COMPLETE',
    CONTENT_CHANGE:        'CONTENT_CHANGE',
    DRIFT_DETECTED:        'DRIFT_DETECTED',
    HARD_RESYNC:           'HARD_RESYNC',
    UNMOUNT:               'UNMOUNT',
});

// ───────────────────────────────────────────────────────────────────────────
// REDUCER
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reduce una acción contra el estado. PURE: no muta `state`, devuelve uno
 * nuevo. Devuelve también una lista de effects para que el caller los ejecute.
 *
 * @param {MachineState} state
 * @param {object} action
 * @returns {{ state: MachineState, effects: Array<object> }}
 */
export function reduce(state, action) {
    switch (action.type) {

    // ── START_PLAY: arranca reproducción desde index ─────────────────────
    case Actions.START_PLAY: {
        const { index } = action;
        return {
            state: {
                ...state,
                status:         'playing',
                audioIndex:     index,
                visualIndex:    index,
                committedIndex: index,
                progressIndex:  Math.max(state.progressIndex, index),
                pendingTransition: null,
                error: null,
            },
            effects: [
                { type: 'log', tag: 'index_commit',     data: { from: state.committedIndex, to: index, source: 'START_PLAY' } },
                { type: 'log', tag: 'sentence_advanced', data: { from: state.committedIndex, to: index, source: 'START_PLAY' } },
                { type: 'play_audio', index },
            ],
        };
    }

    // ── AUDIO_ENDED: el audio de fromIndex terminó ───────────────────────
    // No avanza nada por sí solo — SCHEDULE_ADVANCE viene después con el
    // floor y rhythm calculados por el caller.
    case Actions.AUDIO_ENDED: {
        const { index, durationMs } = action;
        return {
            state, // estado intacto
            effects: [
                { type: 'log', tag: 'sentence_time', data: { index, durationMs } },
            ],
        };
    }

    // ── SCHEDULE_ADVANCE: crear pendingTransition ────────────────────────
    case Actions.SCHEDULE_ADVANCE: {
        const { fromIndex, toIndex, reason, floorRemaining = 0, rhythmMs = 0, finalDelay = 0, requireVisualAck = false } = action;
        // Guard: solo aceptamos scheduling en estado playing.
        if (state.status !== 'playing') {
            return {
                state,
                effects: [
                    { type: 'log', tag: 'schedule_rejected', data: { reason: `status_${state.status}`, from: fromIndex, to: toIndex } },
                ],
            };
        }
        // Guard: fromIndex debe coincidir con committedIndex
        if (fromIndex !== state.committedIndex) {
            return {
                state,
                effects: [
                    { type: 'log', tag: 'schedule_rejected', data: { reason: 'from_mismatch', expected: state.committedIndex, got: fromIndex } },
                ],
            };
        }
        const transitionId = state._nextTransitionId;
        const now = action.now ?? 0;
        return {
            state: {
                ...state,
                status: 'pending_advance',
                _nextTransitionId: transitionId + 1,
                pendingTransition: {
                    id:                 transitionId,
                    fromIndex,
                    toIndex,
                    reason,
                    scheduledAt:        now,
                    minCommitAt:        now + Math.max(floorRemaining, rhythmMs),
                    visualAckReceived:  false,
                    requireVisualAck,
                },
            },
            effects: [
                { type: 'log', tag: 'index_scheduled', data: { from: fromIndex, to: toIndex, reason, finalDelay, floorRemaining, rhythmMs, transitionId } },
            ],
        };
    }

    // ── COMMIT_ADVANCE: el caller cumplió el delay y solicita commit ────
    case Actions.COMMIT_ADVANCE: {
        const { transitionId } = action;
        const pending = state.pendingTransition;
        if (!pending) {
            return {
                state,
                effects: [{ type: 'log', tag: 'commit_rejected', data: { reason: 'no_pending', transitionId } }],
            };
        }
        if (pending.id !== transitionId) {
            return {
                state,
                effects: [{ type: 'log', tag: 'commit_rejected', data: { reason: 'stale_transitionId', expected: pending.id, got: transitionId } }],
            };
        }
        if (state.status !== 'pending_advance') {
            return {
                state,
                effects: [{ type: 'log', tag: 'commit_rejected', data: { reason: `status_${state.status}`, transitionId } }],
            };
        }
        if (pending.requireVisualAck && !pending.visualAckReceived) {
            return {
                state,
                effects: [{ type: 'log', tag: 'commit_rejected', data: { reason: 'awaiting_visual_ack', transitionId } }],
            };
        }
        // Commit atómico: visual + committed + audio se actualizan juntos.
        // progressIndex se permite explícitamente vía SAVE_PROGRESS_REQUEST,
        // que ahora podrá guardar hasta committedIndex.
        return {
            state: {
                ...state,
                status:           'playing',
                visualIndex:      pending.toIndex,
                audioIndex:       pending.toIndex,
                committedIndex:   pending.toIndex,
                pendingTransition: null,
            },
            effects: [
                { type: 'log', tag: 'index_commit', data: { from: pending.fromIndex, to: pending.toIndex, transitionId } },
                { type: 'log', tag: 'sentence_advanced', data: { from: pending.fromIndex, to: pending.toIndex, transitionId } },
                { type: 'play_audio', index: pending.toIndex },
            ],
        };
    }

    // ── VISUAL_ACK: layout effect confirmó render del visual ─────────────
    case Actions.VISUAL_ACK: {
        const { index } = action;
        // Sin pending: simplemente loguear
        if (!state.pendingTransition) {
            return {
                state,
                effects: [{ type: 'log', tag: 'visual_commit_ack', data: { index, hadPending: false } }],
            };
        }
        // Marcar ack solo si el index coincide con pendingTransition.toIndex
        if (index === state.pendingTransition.toIndex) {
            return {
                state: {
                    ...state,
                    pendingTransition: { ...state.pendingTransition, visualAckReceived: true },
                },
                effects: [{ type: 'log', tag: 'visual_commit_ack', data: { index, hadPending: true } }],
            };
        }
        return {
            state,
            effects: [{ type: 'log', tag: 'visual_commit_ack', data: { index, hadPending: true, mismatch: state.pendingTransition.toIndex } }],
        };
    }

    // ── SAVE_PROGRESS_REQUEST: validar si toIndex es persistible ─────────
    // INV-14: progressIndex nunca puede ser > committedIndex.
    case Actions.SAVE_PROGRESS_REQUEST: {
        const { index } = action;
        if (index > state.committedIndex) {
            return {
                state,
                effects: [{
                    type: 'log',
                    tag: 'progress_save_blocked_pending',
                    data: { requested: index, committedIndex: state.committedIndex, pendingTo: state.pendingTransition?.toIndex ?? null },
                }],
            };
        }
        return {
            state: { ...state, progressIndex: Math.max(state.progressIndex, index) },
            effects: [
                { type: 'log', tag: 'progress_save_allowed', data: { index, committedIndex: state.committedIndex } },
                { type: 'save_progress', index },
            ],
        };
    }

    // ── PAUSE: cancela pending, status → paused ──────────────────────────
    case Actions.PAUSE: {
        const hadPending = state.pendingTransition !== null;
        return {
            state: {
                ...state,
                status: 'paused',
                pendingTransition: null,
            },
            effects: [
                ...(hadPending ? [{ type: 'log', tag: 'pending_advance_cancelled', data: { reason: 'pause', transitionId: state.pendingTransition.id } }] : []),
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'pause' }] : []),
                { type: 'log', tag: 'playback_paused', data: { index: state.committedIndex } },
            ],
        };
    }

    // ── SKIP: hard resync atómico ────────────────────────────────────────
    case Actions.SKIP: {
        const { targetIndex } = action;
        const hadPending = state.pendingTransition !== null;
        return {
            state: {
                ...state,
                status:           'loading',
                audioIndex:       targetIndex,
                visualIndex:      targetIndex,
                committedIndex:   targetIndex,
                pendingTransition: null,
            },
            effects: [
                ...(hadPending ? [{ type: 'log', tag: 'pending_advance_cancelled', data: { reason: 'skip', transitionId: state.pendingTransition.id } }] : []),
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'skip' }] : []),
                { type: 'log', tag: 'hard_resync', data: { from: state.committedIndex, to: targetIndex, reason: 'skip' } },
                { type: 'load_audio', index: targetIndex, autoPlay: true },
            ],
        };
    }

    // ── BLOCK_COMPLETE: cancela pending, congela committedIndex ──────────
    case Actions.BLOCK_COMPLETE: {
        const hadPending = state.pendingTransition !== null;
        return {
            state: {
                ...state,
                status: 'block_completed',
                pendingTransition: null,
            },
            effects: [
                ...(hadPending ? [{ type: 'log', tag: 'pending_advance_cancelled', data: { reason: 'block_complete', transitionId: state.pendingTransition.id } }] : []),
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'block_complete' }] : []),
                { type: 'log', tag: 'block_complete_end_session', data: { committedIndex: state.committedIndex } },
            ],
        };
    }

    // ── CONTENT_CHANGE: reset completo a nuevo contentId ─────────────────
    case Actions.CONTENT_CHANGE: {
        const { contentId, sessionKey, startIndex = 0 } = action;
        return {
            state: initialState({ contentId, sessionKey, startIndex }),
            effects: [
                { type: 'log', tag: 'cleanup', data: { previousContentId: state.contentId } },
                { type: 'cancel_pending', reason: 'content_change' },
            ],
        };
    }

    // ── DRIFT_DETECTED: el caller observó visualIndex != committedIndex
    //    sin pending. Loguea y recomienda hardResync(committedIndex). ────
    case Actions.DRIFT_DETECTED: {
        const { observed } = action;
        return {
            state,
            effects: [
                { type: 'log', tag: 'index_drift_detected', data: { observed, expected: state.committedIndex, status: state.status } },
                { type: 'recommend_hard_resync', index: state.committedIndex },
            ],
        };
    }

    // ── HARD_RESYNC: forzar todo a un índice ─────────────────────────────
    case Actions.HARD_RESYNC: {
        const { targetIndex, reason } = action;
        const hadPending = state.pendingTransition !== null;
        return {
            state: {
                ...state,
                status:           'loading',
                audioIndex:       targetIndex,
                visualIndex:      targetIndex,
                committedIndex:   targetIndex,
                progressIndex:    Math.max(state.progressIndex, targetIndex),
                pendingTransition: null,
            },
            effects: [
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'hard_resync' }] : []),
                { type: 'log', tag: 'hard_resync', data: { from: state.committedIndex, to: targetIndex, reason: reason ?? 'unspecified' } },
                { type: 'load_audio', index: targetIndex, autoPlay: true },
            ],
        };
    }

    // ── UNMOUNT: cleanup total ───────────────────────────────────────────
    case Actions.UNMOUNT: {
        const hadPending = state.pendingTransition !== null;
        return {
            state: { ...state, status: 'idle', pendingTransition: null },
            effects: [
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'unmount' }] : []),
                { type: 'log', tag: 'cleanup', data: { reason: 'unmount' } },
            ],
        };
    }

    default:
        return { state, effects: [{ type: 'log', tag: 'unknown_action', data: { type: action.type } }] };
    }
}

// ───────────────────────────────────────────────────────────────────────────
// SELECTORS — derivadas del estado, también puras
// ───────────────────────────────────────────────────────────────────────────

/**
 * @param {MachineState} state
 * @returns {boolean} true si el visor está esperando un commit.
 */
export function hasPendingAdvance(state) {
    return state.pendingTransition !== null && state.status === 'pending_advance';
}

/**
 * @param {MachineState} state
 * @returns {boolean} true si hay drift entre visual y committed (sin pending).
 */
export function isDrifting(state) {
    if (state.pendingTransition !== null) return false;
    return state.visualIndex !== state.committedIndex;
}

/**
 * @param {MachineState} state
 * @returns {boolean} true si COMMIT_ADVANCE puede ejecutarse ahora.
 */
export function canCommit(state) {
    const p = state.pendingTransition;
    if (!p) return false;
    if (state.status !== 'pending_advance') return false;
    if (p.requireVisualAck && !p.visualAckReceived) return false;
    return true;
}
