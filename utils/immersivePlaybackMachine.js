/**
 * immersivePlaybackMachine.js — Coordinador puro de transición de índices Y de
 * frase activa (activeSentenceBuffer integrado).
 *
 * Materializa las INVARIANTES 13/14/15/16/17/18/19 y los criterios 1-12 del
 * sprint de hardening + 15 criterios del sprint Drift Hardening (F2).
 * Función PURA: dado (state, action), devuelve { state, effects[] }. Sin React,
 * sin DOM, sin side effects internos.
 *
 * El hook `useImmersivePlayback` mantiene una instancia del state vía useRef,
 * llama `reduce(state, action)` y EJECUTA los effects (play audio, log, save).
 * Los tests importan `reduce` directamente y verifican transiciones sin
 * necesidad de DOM.
 *
 * Diseño:
 *   - Single Source of Truth: este módulo posee TODOS los índices, el status
 *     y la frase activa (state.buffer).
 *   - INV-13: visualIndex/committedIndex se actualizan ATÓMICAMENTE en
 *     COMMIT_ADVANCE — antes están ambos en el último committed.
 *   - INV-14: SAVE_PROGRESS_REQUEST devuelve { allowed: false } si toIndex
 *     supera committedIndex.
 *   - INV-15: PAUSE / BLOCK_COMPLETE / SKIP / CONTENT_CHANGE / UNMOUNT
 *     limpian pendingTransition y emiten effect 'cancel_pending'.
 *   - INV-16: SKIP es hard resync atómico.
 *   - INV-17: COMMIT_ADVANCE emite effects en orden:
 *     log index_commit → log sentence_advanced → play_audio → save_progress.
 *   - INV-19 (regla madre): la frase debe estar destacada antes de sonar y
 *     completada antes de guardar progreso. Materializado por activeSentenceBuffer:
 *       - REQUEST_AUDIO_START → PLAY_AUDIO (si visible) o BLOCK_AUDIO_START.
 *       - REQUEST_PROGRESS_SAVE → SAVE_PROGRESS (si completed+sin pending next)
 *         o BLOCK_PROGRESS_SAVE.
 *
 * Compatibilidad backwards:
 *   - Las acciones legacy (VISUAL_ACK, SAVE_PROGRESS_REQUEST, SCHEDULE_ADVANCE)
 *     mantienen su semántica original. Las nuevas (VISUAL_HIGHLIGHT_ACK,
 *     REQUEST_PROGRESS_SAVE, SCHEDULE_NEXT, REQUEST_AUDIO_START, etc.) añaden
 *     gating duro vía buffer. START_PLAY mantiene su shortcut (prepara+ack+started
 *     internamente) para que los tests/flows legacy funcionen sin cambios.
 *
 * Tests:
 *   - utils/__tests__/immersivePlaybackMachine.test.js  (12 criterios INV-13..17)
 *   - utils/__tests__/playbackMachineF2.test.js         (15 criterios INV-19)
 */

import {
    createBuffer,
    prepare as bufferPrepare,
    prepareNext as bufferPrepareNext,
    // M-5.4.6 — bufferConfirmHighlight ya no se importa; visual ACK removido.
    markAudioStarted as bufferMarkAudioStarted,
    markAudioEnded as bufferMarkAudioEnded,
    markCompleted as bufferMarkCompleted,
    cancel as bufferCancel,
    lock as bufferLock,
    assertCanStartAudio,
    assertCanSaveProgress,
} from './activeSentenceBuffer.js';

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
        // INV-19: buffer transaccional de frase activa. Empieza vacío;
        // se puebla con PREPARE_SENTENCE / START_PLAY.
        buffer:            createBuffer(),
    };
}

// ───────────────────────────────────────────────────────────────────────────
// ACTIONS — discriminated union
// ───────────────────────────────────────────────────────────────────────────

/**
 * Acciones disponibles. La sintaxis `type: 'X', ...payload`.
 *
 * Legacy (sprint INV-13..17):
 *   START_PLAY, AUDIO_ENDED, SCHEDULE_ADVANCE, COMMIT_ADVANCE, VISUAL_ACK,
 *   SAVE_PROGRESS_REQUEST, PAUSE, SKIP, BLOCK_COMPLETE, CONTENT_CHANGE,
 *   DRIFT_DETECTED, HARD_RESYNC, UNMOUNT.
 *
 * F2 (sprint Drift Hardening — INV-19, gating duro vía buffer):
 *   PREPARE_SENTENCE, PREPARE_NEXT_SENTENCE, VISUAL_HIGHLIGHT_ACK,
 *   REQUEST_AUDIO_START, AUDIO_STARTED, SENTENCE_COMPLETED,
 *   REQUEST_PROGRESS_SAVE, SCHEDULE_NEXT, CANCEL_PENDING.
 *
 * Notas de compat:
 *   - VISUAL_HIGHLIGHT_ACK y VISUAL_ACK comparten case en el reduce: ambos
 *     marcan pendingTransition.visualAckReceived (legacy) Y llaman
 *     bufferConfirmHighlight (nuevo). Tests legacy verifican lo primero;
 *     tests nuevos verifican lo segundo. Coexisten sin conflicto.
 *   - SAVE_PROGRESS_REQUEST mantiene gating legacy (committedIndex).
 *     REQUEST_PROGRESS_SAVE aplica gating duro vía assertCanSaveProgress.
 *   - SCHEDULE_NEXT es alias funcional de SCHEDULE_ADVANCE más prepareNext del
 *     buffer; el caller nuevo debe usar SCHEDULE_NEXT.
 */
export const Actions = Object.freeze({
    // ── Legacy ──
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
    // ── F2 (Drift Hardening) ──
    PREPARE_SENTENCE:       'PREPARE_SENTENCE',
    PREPARE_NEXT_SENTENCE:  'PREPARE_NEXT_SENTENCE',
    VISUAL_HIGHLIGHT_ACK:   'VISUAL_HIGHLIGHT_ACK',
    REQUEST_AUDIO_START:    'REQUEST_AUDIO_START',
    AUDIO_STARTED:          'AUDIO_STARTED',
    SENTENCE_COMPLETED:     'SENTENCE_COMPLETED',
    REQUEST_PROGRESS_SAVE:  'REQUEST_PROGRESS_SAVE',
    SCHEDULE_NEXT:          'SCHEDULE_NEXT',
    CANCEL_PENDING:         'CANCEL_PENDING',
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
    // F2: si el buffer tiene current.index === action.index, también
    // markAudioEnded para que el flujo SENTENCE_COMPLETED esté habilitado.
    case Actions.AUDIO_ENDED: {
        const { index, durationMs } = action;
        const effects = [
            { type: 'log', tag: 'sentence_time', data: { index, durationMs } },
        ];
        let nextBuffer = state.buffer;
        if (state.buffer.current?.index === index && state.buffer.current?.audioStarted) {
            const r = bufferMarkAudioEnded(state.buffer, index, durationMs);
            nextBuffer = r.buffer;
            effects.push({ type: 'log', tag: r.log.tag, data: r.log.data });
        }
        return {
            state: { ...state, buffer: nextBuffer },
            effects,
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

    // ── VISUAL_ACK / VISUAL_HIGHLIGHT_ACK ────────────────────────────────
    // M-5.4.6 (DEMOLITION Phase 1.b.4) — Actions ELIMINADAS de facto. Si
    // alguien las dispatchea desde código legacy, devolvemos state sin mutar
    // y un log deprecated. El visor ya no las emite tras Phase 1.b.2.
    case Actions.VISUAL_ACK:
    case Actions.VISUAL_HIGHLIGHT_ACK: {
        return {
            state,
            effects: [
                { type: 'log', tag: 'PB_VISUAL_HIGHLIGHT_ACK_DEPRECATED', data: { index: action.index, note: 'visual_ack_removed_in_M546_phase_1b4' } },
            ],
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
    // F2/F4: cancela pendingTransition + buffer.next (gapless prefetch sin
    // sentido tras pause) PERO preserva buffer.current. La frase actual sigue
    // destacada visualmente durante la pausa — su status='visible'/'reading'
    // se mantiene válido para que resume() pueda reusarlo sin re-prepare.
    case Actions.PAUSE: {
        const hadPending = state.pendingTransition !== null;
        const hadNext    = state.buffer.next !== null;
        // Si current estaba 'reading' (audio sonando), regresarlo a 'visible'
        // para que resume() pueda volver a pasar el gate assertCanStartAudio.
        // El highlight visual sigue válido durante la pausa.
        const cur = state.buffer.current;
        const adjustedCurrent = (cur && cur.status === 'reading')
            ? { ...cur, status: /** @type {const} */ ('visible') }
            : cur;
        const nextBuffer = (hadNext || adjustedCurrent !== cur)
            ? { ...state.buffer, next: null, current: adjustedCurrent }
            : state.buffer;
        // F20/P2 — el index del log debe reflejar la frase REAL en pausa.
        // Si hay buffer.current, ese es el index canónico del usuario; sino
        // caemos a committedIndex (legacy). Esto fixea la divergencia
        // observada: hook reporta index=83, machine reporta index=0.
        const pauseLogIndex = state.buffer.current?.index ?? state.committedIndex;
        return {
            state: {
                ...state,
                status: 'paused',
                pendingTransition: null,
                buffer: nextBuffer,
            },
            effects: [
                ...(hadPending ? [{ type: 'log', tag: 'pending_advance_cancelled', data: { reason: 'pause', transitionId: state.pendingTransition.id } }] : []),
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'pause' }] : []),
                ...(hadNext    ? [{ type: 'log', tag: 'PB_NEXT_SENTENCE_CANCELLED', data: { reason: 'pause', cancelledNextIndex: state.buffer.next.index } }] : []),
                { type: 'pause_audio' },
                { type: 'log', tag: 'playback_paused', data: { index: pauseLogIndex, bufferIndex: state.buffer.current?.index ?? null, committedIndex: state.committedIndex } },
            ],
        };
    }

    // ── SKIP: manual nav atómico (M-5.4.6 Case 4 — ya NO emite HARD_RESYNC) ──
    // Antes: SKIP emitía 'hard_resync' log + HARD_RESYNC effect, lo que hacía
    // que cada next/prev del usuario disparara un recovery "duro". Eso
    // mezclaba manual nav (gesto legítimo) con recovery (excepcional).
    //
    // Ahora SKIP solo cancela buffer + ajusta indices + load_audio. El caller
    // (manualSentenceJump) ya canceló executor y pending advances explícitamente.
    case Actions.SKIP: {
        const { targetIndex } = action;
        const hadPending = state.pendingTransition !== null;
        const hadBuffer  = state.buffer.current !== null || state.buffer.next !== null;
        const cancelRes  = hadBuffer ? bufferCancel(state.buffer, 'manual_nav') : { buffer: state.buffer, log: null };
        return {
            state: {
                ...state,
                status:           'loading',
                audioIndex:       targetIndex,
                visualIndex:      targetIndex,
                committedIndex:   targetIndex,
                pendingTransition: null,
                buffer:           cancelRes.buffer,
            },
            effects: [
                ...(hadPending ? [{ type: 'log', tag: 'pending_advance_cancelled', data: { reason: 'manual_nav', transitionId: state.pendingTransition.id } }] : []),
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'manual_nav' }] : []),
                ...(hadBuffer  ? [{ type: 'log', tag: cancelRes.log.tag, data: cancelRes.log.data }] : []),
                { type: 'log', tag: 'manual_nav_commit', data: { from: state.committedIndex, to: targetIndex } },
                { type: 'load_audio', index: targetIndex, autoPlay: true },
            ],
        };
    }

    // ── BLOCK_COMPLETE: cancela pending, congela committedIndex ──────────
    case Actions.BLOCK_COMPLETE: {
        const hadPending = state.pendingTransition !== null;
        const hadBuffer  = state.buffer.current !== null || state.buffer.next !== null;
        const cancelRes  = hadBuffer ? bufferCancel(state.buffer, 'block_complete') : { buffer: state.buffer, log: null };
        return {
            state: {
                ...state,
                status: 'block_completed',
                pendingTransition: null,
                buffer: cancelRes.buffer,
            },
            effects: [
                ...(hadPending ? [{ type: 'log', tag: 'pending_advance_cancelled', data: { reason: 'block_complete', transitionId: state.pendingTransition.id } }] : []),
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'block_complete' }] : []),
                ...(hadBuffer  ? [{ type: 'log', tag: cancelRes.log.tag, data: cancelRes.log.data }] : []),
                { type: 'log', tag: 'block_complete_end_session', data: { committedIndex: state.committedIndex, bufferIndex: state.buffer.current?.index ?? null, index: state.buffer.current?.index ?? state.committedIndex } },
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
    // F2: cancel buffer + emit HARD_RESYNC effect. El caller debe re-prepare
    // el buffer en 'preparing' y esperar visual_highlight_ack antes de play.
    case Actions.HARD_RESYNC: {
        const { targetIndex, reason } = action;
        const hadPending = state.pendingTransition !== null;
        const hadBuffer  = state.buffer.current !== null || state.buffer.next !== null;
        const cancelRes  = hadBuffer ? bufferCancel(state.buffer, 'hard_resync') : { buffer: state.buffer, log: null };
        return {
            state: {
                ...state,
                status:           'loading',
                audioIndex:       targetIndex,
                visualIndex:      targetIndex,
                committedIndex:   targetIndex,
                progressIndex:    Math.max(state.progressIndex, targetIndex),
                pendingTransition: null,
                buffer:           cancelRes.buffer,
            },
            effects: [
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'hard_resync' }] : []),
                ...(hadBuffer  ? [{ type: 'log', tag: cancelRes.log.tag, data: cancelRes.log.data }] : []),
                { type: 'log', tag: 'hard_resync', data: { from: state.committedIndex, to: targetIndex, reason: reason ?? 'unspecified' } },
                { type: 'HARD_RESYNC', index: targetIndex, reason: reason ?? 'unspecified' },
                { type: 'load_audio', index: targetIndex, autoPlay: true },
            ],
        };
    }

    // ── UNMOUNT: cleanup total ───────────────────────────────────────────
    // F2: lock + cancel buffer (lock primero para rechazar acks late).
    case Actions.UNMOUNT: {
        const hadPending = state.pendingTransition !== null;
        const hadBuffer  = state.buffer.current !== null || state.buffer.next !== null;
        const cancelRes  = hadBuffer ? bufferCancel(state.buffer, 'unmount') : { buffer: state.buffer, log: null };
        return {
            state: { ...state, status: 'idle', pendingTransition: null, buffer: cancelRes.buffer },
            effects: [
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'unmount' }] : []),
                ...(hadBuffer  ? [{ type: 'log', tag: cancelRes.log.tag, data: cancelRes.log.data }] : []),
                { type: 'log', tag: 'cleanup', data: { reason: 'unmount' } },
            ],
        };
    }

    // ── F2: PREPARE_SENTENCE — crea/promueve current en 'preparing' ──────
    case Actions.PREPARE_SENTENCE: {
        const { index, displayText, spokenText, now } = action;
        const r = bufferPrepare(state.buffer, {
            contentId:   state.contentId,
            userId:      action.userId ?? '',
            sessionKey:  state.sessionKey,
            index,
            displayText: displayText ?? '',
            spokenText:  spokenText ?? '',
            now:         now ?? 0,
        });
        return {
            state: { ...state, buffer: r.buffer },
            effects: [
                { type: 'log', tag: r.log.tag, data: r.log.data },
                { type: 'SET_INDEX', index },
            ],
        };
    }

    // ── F2: PREPARE_NEXT_SENTENCE — popula buffer.next sin tocar current ─
    case Actions.PREPARE_NEXT_SENTENCE: {
        const { index, displayText, spokenText, now } = action;
        const r = bufferPrepareNext(state.buffer, {
            contentId:   state.contentId,
            userId:      action.userId ?? '',
            sessionKey:  state.sessionKey,
            index,
            displayText: displayText ?? '',
            spokenText:  spokenText ?? '',
            now:         now ?? 0,
        });
        return {
            state: { ...state, buffer: r.buffer },
            effects: [{ type: 'log', tag: r.log.tag, data: r.log.data }],
        };
    }

    // ── F2: REQUEST_AUDIO_START — gating duro vía assertCanStartAudio ────
    case Actions.REQUEST_AUDIO_START: {
        const { index } = action;
        const check = assertCanStartAudio(state.buffer, index);
        if (!check.ok) {
            return {
                state,
                effects: [
                    { type: 'log', tag: check.tag, data: { index, reason: check.reason, currentIndex: state.buffer.current?.index ?? null, currentStatus: state.buffer.current?.status ?? null } },
                    { type: 'BLOCK_AUDIO_START', index, reason: check.reason },
                ],
            };
        }
        return {
            state,
            effects: [
                { type: 'log', tag: 'PB_AUDIO_START_ALLOWED', data: { index, transitionId: state.buffer.current.transitionId } },
                { type: 'play_audio', index },
            ],
        };
    }

    // ── F2: AUDIO_STARTED — el caller confirmó que .play() resolvió ──────
    case Actions.AUDIO_STARTED: {
        const { index } = action;
        const r = bufferMarkAudioStarted(state.buffer, index);
        return {
            state: { ...state, buffer: r.buffer },
            effects: [{ type: 'log', tag: r.log.tag, data: r.log.data }],
        };
    }

    // ── F2: SENTENCE_COMPLETED — commit final tras audio+visual completos ─
    case Actions.SENTENCE_COMPLETED: {
        const { index } = action;
        const r = bufferMarkCompleted(state.buffer, index);
        return {
            state: { ...state, buffer: r.buffer },
            effects: [{ type: 'log', tag: r.log.tag, data: r.log.data }],
        };
    }

    // ── F2: REQUEST_PROGRESS_SAVE — gating duro vía assertCanSaveProgress ─
    case Actions.REQUEST_PROGRESS_SAVE: {
        const { index } = action;
        const check = assertCanSaveProgress(state.buffer, index);
        if (!check.ok) {
            return {
                state,
                effects: [
                    { type: 'log', tag: check.tag, data: { index, reason: check.reason, currentStatus: state.buffer.current?.status ?? null, hasNext: state.buffer.next !== null } },
                    { type: 'BLOCK_PROGRESS_SAVE', index, reason: check.reason },
                ],
            };
        }
        return {
            state: { ...state, progressIndex: Math.max(state.progressIndex, index) },
            effects: [
                { type: 'log', tag: 'PB_PROGRESS_SAVE_ALLOWED', data: { index, transitionId: state.buffer.current.transitionId } },
                { type: 'save_progress', index },
            ],
        };
    }

    // ── F2: SCHEDULE_NEXT — SCHEDULE_ADVANCE + buffer.prepareNext ────────
    // Convenience action: el caller llama una sola vez y la machine se
    // encarga de crear pendingTransition Y preparar buffer.next.
    case Actions.SCHEDULE_NEXT: {
        const { fromIndex, toIndex, reason, floorRemaining = 0, rhythmMs = 0, finalDelay = 0, requireVisualAck = false, displayText, spokenText, now: actNow } = action;
        // Reuse SCHEDULE_ADVANCE logic via recursive reduce
        const sched = reduce(state, {
            type: Actions.SCHEDULE_ADVANCE,
            fromIndex, toIndex, reason, floorRemaining, rhythmMs, finalDelay, requireVisualAck, now: actNow,
        });
        if (sched.state.status !== 'pending_advance') {
            // schedule rechazado — devolver tal cual
            return sched;
        }
        // Adicionalmente preparamos el buffer.next
        const prepRes = bufferPrepareNext(sched.state.buffer, {
            contentId:   state.contentId,
            userId:      action.userId ?? '',
            sessionKey:  state.sessionKey,
            index:       toIndex,
            displayText: displayText ?? '',
            spokenText:  spokenText ?? '',
            now:         actNow ?? 0,
        });
        return {
            state: { ...sched.state, buffer: prepRes.buffer },
            effects: [
                ...sched.effects,
                { type: 'log', tag: prepRes.log.tag, data: prepRes.log.data },
            ],
        };
    }

    // ── F2: CANCEL_PENDING — solo cancela pending sin tocar current ──────
    // Útil cuando el caller necesita abortar el avance pero seguir leyendo
    // la frase actual (ej: usuario interactúa con UI mid-sentence).
    case Actions.CANCEL_PENDING: {
        const hadPending = state.pendingTransition !== null;
        const hadNext    = state.buffer.next !== null;
        let nextBuffer = state.buffer;
        if (hadNext) {
            // cancelar solo next, preservar current
            nextBuffer = { ...state.buffer, next: null };
        }
        return {
            state: { ...state, pendingTransition: null, buffer: nextBuffer },
            effects: [
                ...(hadPending ? [{ type: 'log', tag: 'pending_advance_cancelled', data: { reason: 'cancel_pending', transitionId: state.pendingTransition.id } }] : []),
                ...(hadPending ? [{ type: 'cancel_pending', reason: 'cancel_pending' }] : []),
                ...(hadNext    ? [{ type: 'log', tag: 'PB_NEXT_SENTENCE_CANCELLED', data: { cancelledNextIndex: state.buffer.next.index } }] : []),
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
