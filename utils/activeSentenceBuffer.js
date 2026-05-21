/**
 * activeSentenceBuffer.js — Coordinador transaccional de la frase activa.
 *
 * M-5.4.6 (DEMOLITION Phase 1.b.3) — Visual ACK ELIMINADO. La "regla madre"
 * original exigía que el visor confirmara render antes de permitir audio.
 * Eso violaba el nuevo INV "Playback must never wait for render confirmation".
 *
 * El contrato ahora es minimal:
 *
 *   perSentence:   audioStarted && audioEnded  →  completed
 *   perChunk:      executor avanzó más allá    →  prev sentence completed
 *
 * Este módulo es PURO. Sin React, sin DOM, sin side effects.
 *
 * Reglas de transición (status):
 *
 *   prepare()              → 'reading'    (lista para sonar, sin gate de DOM)
 *   markAudioStarted()     → 'reading'    (idempotente)
 *   markAudioEnded()       → 'reading'    (mantiene hasta complete)
 *   markCompleted()        → 'completed'  (requiere audioStarted+audioEnded)
 *   cancel()               → 'cancelled'
 *
 * NOTA: la transición 'preparing → visible' fue ELIMINADA. La frase nace
 * directamente en 'reading' (lista). El visor renderea y aplica transform
 * por su cuenta — no acknowledgea al runtime.
 *
 * Tests: utils/__tests__/activeSentenceBuffer.test.js
 */

// ───────────────────────────────────────────────────────────────────────────
// TIPOS (JSDoc — el repo es ESM puro, sin TS para módulos puros)
// ───────────────────────────────────────────────────────────────────────────

/**
 * M-5.4.6 — 'preparing' y 'visible' colapsados en 'reading'. Sólo conservamos
 * 'reading' / 'completed' / 'cancelled'. Mantengo 'preparing' como alias para
 * back-compat de logs/tests legacy en lo que duren — no se usa para gatear.
 *
 * @typedef {'preparing'|'reading'|'completed'|'cancelled'} SentenceStatus
 *
 * @typedef {object} ActiveSentence
 * @property {string} contentId
 * @property {string} userId
 * @property {string} sessionKey
 * @property {number} index
 * @property {string} displayText
 * @property {string} spokenText
 * @property {SentenceStatus} status
 * @property {boolean} audioStarted
 * @property {boolean} audioEnded
 * @property {boolean} progressEligible
 * @property {number} transitionId
 * @property {number} preparedAt
 *
 * @typedef {object} ActiveSentenceBuffer
 * @property {ActiveSentence|null} current
 * @property {ActiveSentence|null} next
 * @property {number} transitionId          Último transitionId emitido.
 * @property {boolean} locked               Buffer en limpieza — rechazar ops.
 * @property {string|null} lockReason       Por qué fue locked (debug).
 *
 * @typedef {object} AssertResult
 * @property {boolean} ok
 * @property {string=} reason
 * @property {string=} tag                  Log tag a emitir cuando !ok.
 */

// ───────────────────────────────────────────────────────────────────────────
// CONSTRUCTORS
// ───────────────────────────────────────────────────────────────────────────

/** @returns {ActiveSentenceBuffer} */
export function createBuffer() {
    return {
        current:      null,
        next:         null,
        transitionId: 0,
        locked:       false,
        lockReason:   null,
    };
}

/**
 * Crea una ActiveSentence en estado 'preparing'. No la deposita en el buffer:
 * eso lo hace `prepare()`.
 *
 * @param {object} args
 * @returns {ActiveSentence}
 */
export function makeActiveSentence({
    contentId,
    userId,
    sessionKey,
    index,
    displayText,
    spokenText,
    transitionId,
    now = 0,
}) {
    return {
        contentId,
        userId,
        sessionKey,
        index,
        displayText,
        spokenText,
        // M-5.4.6 — nace directamente en 'reading'. No hay gate de visual ACK.
        status:                  'reading',
        audioStarted:            false,
        audioEnded:              false,
        progressEligible:        false,
        transitionId,
        preparedAt:              now,
    };
}

// ───────────────────────────────────────────────────────────────────────────
// MUTATIONS — devuelven { buffer, log? } (nunca mutan el input)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Promueve un ActiveSentence a `current`. Si ya hay current con otro index,
 * se cancela y se reemplaza (caso skip / hard resync).
 *
 * Si el index coincide con `next.index`, se promueve next→current sin
 * recrear (caso autoadvance gapless).
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {object} sentenceArgs - args para makeActiveSentence (sin transitionId)
 * @returns {{ buffer: ActiveSentenceBuffer, log: object }}
 */
export function prepare(buffer, sentenceArgs) {
    if (buffer.locked) {
        return {
            buffer,
            log: { tag: 'PB_BUFFER_LOCKED', data: { op: 'prepare', reason: buffer.lockReason } },
        };
    }
    const transitionId = buffer.transitionId + 1;

    // Promote next → current if matches (autoadvance gapless path).
    if (buffer.next && buffer.next.index === sentenceArgs.index) {
        return {
            buffer: {
                ...buffer,
                current:      { ...buffer.next, transitionId },
                next:         null,
                transitionId,
            },
            log: { tag: 'PB_SENTENCE_PREPARE', data: { index: sentenceArgs.index, source: 'promote_next', transitionId } },
        };
    }

    const sentence = makeActiveSentence({ ...sentenceArgs, transitionId });
    return {
        buffer: {
            ...buffer,
            current:      sentence,
            next:         null,        // cualquier next previo queda invalidado
            transitionId,
        },
        log: { tag: 'PB_SENTENCE_PREPARE', data: { index: sentence.index, source: 'fresh', transitionId } },
    };
}

/**
 * Marca buffer.next con la próxima frase (para gapless prefetch). NO promueve.
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {object} sentenceArgs
 * @returns {{ buffer: ActiveSentenceBuffer, log: object }}
 */
export function prepareNext(buffer, sentenceArgs) {
    if (buffer.locked) {
        return { buffer, log: { tag: 'PB_BUFFER_LOCKED', data: { op: 'prepareNext' } } };
    }
    const transitionId = buffer.transitionId + 1;
    const sentence = makeActiveSentence({ ...sentenceArgs, transitionId });
    return {
        buffer: { ...buffer, next: sentence, transitionId },
        log: { tag: 'PB_NEXT_SENTENCE_SCHEDULED', data: { from: buffer.current?.index ?? null, to: sentence.index, transitionId } },
    };
}

/**
 * M-5.4.6 (DEMOLITION Phase 1.b.3) — confirmHighlight() ELIMINADA.
 *
 * El visor ya NO confirma render hacia la machine. La frase nace directamente
 * en 'reading' tras prepare(). Si llaman a confirmHighlight desde código
 * legacy (no debería), exportamos un stub que loguea pero no muta.
 */
export function confirmHighlight(buffer, index, _expectedTransitionId) {
    return {
        buffer,
        log: { tag: 'PB_VISUAL_HIGHLIGHT_ACK_DEPRECATED', data: { index, note: 'visual_ack_removed_in_M546_phase_1b3' } },
    };
}

/**
 * Marca que el audio empezó. Ya NO exige status='visible' — visual ack fue
 * eliminado. Sólo valida que el index coincida con buffer.current.
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {number} index
 * @returns {{ buffer: ActiveSentenceBuffer, log: object }}
 */
export function markAudioStarted(buffer, index) {
    const c = buffer.current;
    if (!c || c.index !== index) {
        return { buffer, log: { tag: 'PB_AUDIO_STARTED_REJECTED', data: { reason: 'no_current_or_mismatch', index, currentIndex: c?.index ?? null } } };
    }
    if (c.status === 'cancelled') {
        return { buffer, log: { tag: 'PB_AUDIO_STARTED_REJECTED', data: { reason: 'cancelled', index } } };
    }
    // Idempotente: si ya fue marcado started, no re-emitir.
    if (c.audioStarted) {
        return { buffer, log: { tag: 'PB_AUDIO_STARTED', data: { index, idempotent: true } } };
    }
    return {
        buffer: {
            ...buffer,
            current: { ...c, status: 'reading', audioStarted: true },
        },
        log: { tag: 'PB_AUDIO_STARTED', data: { index, transitionId: c.transitionId } },
    };
}

/**
 * Marca que el audio terminó. NO completa la frase — `markCompleted()` es
 * el commit final (puede haber floor que postergue el complete).
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {number} index
 * @param {number} durationMs
 * @returns {{ buffer: ActiveSentenceBuffer, log: object }}
 */
export function markAudioEnded(buffer, index, durationMs) {
    const c = buffer.current;
    if (!c || c.index !== index) {
        return { buffer, log: { tag: 'PB_AUDIO_ENDED_REJECTED', data: { reason: 'no_current_or_mismatch', index, currentIndex: c?.index ?? null } } };
    }
    if (!c.audioStarted) {
        return { buffer, log: { tag: 'PB_AUDIO_ENDED_REJECTED', data: { reason: 'audio_not_started', index } } };
    }
    return {
        buffer: { ...buffer, current: { ...c, audioEnded: true } },
        log: { tag: 'PB_AUDIO_ENDED', data: { index, durationMs, transitionId: c.transitionId } },
    };
}

/**
 * Marca la frase como 'completed'.
 *
 * M-5.4.6 (DEMOLITION Phase 1.b.3) — visualHighlightConfirmed eliminado del
 * gate. Nuevo contrato:
 *
 *   perSentence: audioStarted && audioEnded → completed
 *   perChunk:    advanceWithinChunk llama markCompleted del index anterior
 *                como "implicit complete" (audioStarted=true ya porque el
 *                chunk audio estaba sonando, audioEnded=true se setea
 *                explícitamente desde el call site del executor).
 *
 * Solo entonces progressEligible=true.
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {number} index
 * @returns {{ buffer: ActiveSentenceBuffer, log: object }}
 */
export function markCompleted(buffer, index) {
    const c = buffer.current;
    if (!c || c.index !== index) {
        return { buffer, log: { tag: 'PB_SENTENCE_COMPLETED_REJECTED', data: { reason: 'no_current_or_mismatch', index, currentIndex: c?.index ?? null } } };
    }
    if (!c.audioStarted || !c.audioEnded) {
        return {
            buffer,
            log: {
                tag: 'PB_SENTENCE_COMPLETED_REJECTED',
                data: {
                    reason: 'incomplete',
                    index,
                    audioStarted: c.audioStarted,
                    audioEnded: c.audioEnded,
                },
            },
        };
    }
    return {
        buffer: {
            ...buffer,
            current: { ...c, status: 'completed', progressEligible: true },
        },
        log: { tag: 'PB_SENTENCE_COMPLETED', data: { index, transitionId: c.transitionId } },
    };
}

/**
 * Cancela el buffer entero (skip, block_complete, content_change, hard_resync).
 * Marca current/next como 'cancelled' y los limpia. Levanta lock momentáneo
 * para que no entren acks/marks tardíos.
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {string} reason
 * @returns {{ buffer: ActiveSentenceBuffer, log: object }}
 */
export function cancel(buffer, reason) {
    const cancelledIdx = buffer.current?.index ?? null;
    const cancelledNextIdx = buffer.next?.index ?? null;
    return {
        buffer: {
            current:      null,
            next:         null,
            transitionId: buffer.transitionId,  // preservamos contador monotónico
            locked:       false,                // unlocked tras la cancelación
            lockReason:   null,
        },
        log: {
            tag: 'PB_BUFFER_CANCELLED',
            data: { reason, cancelledIndex: cancelledIdx, cancelledNextIndex: cancelledNextIdx },
        },
    };
}

/**
 * Lock explícito (durante limpieza async — content change, unmount).
 * Operaciones subsecuentes loguean PB_BUFFER_LOCKED y no mutan.
 */
export function lock(buffer, reason) {
    return {
        buffer: { ...buffer, locked: true, lockReason: reason },
        log: { tag: 'PB_BUFFER_LOCKED', data: { reason } },
    };
}

// ───────────────────────────────────────────────────────────────────────────
// ASSERTS — no mutan; devuelven { ok, reason, tag }
// ───────────────────────────────────────────────────────────────────────────

/**
 * ¿Se puede arrancar audio para `index` AHORA?
 *
 * M-5.4.6 (DEMOLITION Phase 1.b.3) — Gate de visual ACK ELIMINADO. El nuevo
 * INV "playback must never wait for render confirmation" significa que esta
 * función ya no exige status='visible' ni visualHighlightConfirmed. Quedan
 * sólo los gates estructurales: buffer no locked + buffer.current existe +
 * coincide el index + no está cancelled.
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {number} index
 * @returns {AssertResult}
 */
export function assertCanStartAudio(buffer, index) {
    if (buffer.locked) {
        return { ok: false, reason: 'buffer_locked', tag: 'PB_AUDIO_START_BLOCKED_NO_BUFFER' };
    }
    const c = buffer.current;
    if (!c) {
        return { ok: false, reason: 'no_active_sentence', tag: 'PB_AUDIO_START_BLOCKED_NO_BUFFER' };
    }
    if (c.index !== index) {
        return { ok: false, reason: 'index_mismatch', tag: 'PB_AUDIO_START_BLOCKED_NO_BUFFER' };
    }
    if (c.status === 'cancelled') {
        return { ok: false, reason: 'cancelled', tag: 'PB_AUDIO_START_BLOCKED_NO_BUFFER' };
    }
    return { ok: true };
}

/**
 * ¿Se puede guardar progreso para `index` AHORA?
 *
 * M-5.4.6 (DEMOLITION Phase 1.b.3 + decisión E.2) — visualHighlightConfirmed
 * eliminado del gate. NO se reemplazó por DOM visibility ni intersection
 * observer ni otro tipo de visual ACK. El criterio nuevo refleja "playback
 * consumido", no "confirmación del DOM":
 *
 *   - buffer.current existe + index match
 *   - status === 'completed'
 *   - audioStarted && audioEnded (markCompleted ya lo enforces, pero
 *     mantenemos la verificación defensive)
 *   - progressEligible (lo setea markCompleted)
 *   - buffer.next === null (no pending advance)
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {number} index
 * @returns {AssertResult}
 */
export function assertCanSaveProgress(buffer, index) {
    if (buffer.locked) {
        return { ok: false, reason: 'buffer_locked', tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION' };
    }
    const c = buffer.current;
    if (!c) {
        return { ok: false, reason: 'no_active_sentence', tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION' };
    }
    if (c.index !== index) {
        return { ok: false, reason: 'index_mismatch', tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION' };
    }
    if (c.status !== 'completed') {
        return { ok: false, reason: `status_${c.status}`, tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION' };
    }
    if (!c.audioStarted || !c.audioEnded || !c.progressEligible) {
        return {
            ok: false,
            reason: 'flags_incomplete',
            tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION',
        };
    }
    if (buffer.next !== null) {
        return { ok: false, reason: 'pending_next', tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION' };
    }
    return { ok: true };
}

/**
 * ¿Se puede avanzar de fromIndex → toIndex AHORA?
 * Requiere que current.index === fromIndex y current.status === 'completed'.
 *
 * @param {ActiveSentenceBuffer} buffer
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {AssertResult}
 */
export function assertCanAdvance(buffer, fromIndex, toIndex) {
    if (buffer.locked) {
        return { ok: false, reason: 'buffer_locked' };
    }
    const c = buffer.current;
    if (!c) return { ok: false, reason: 'no_current' };
    if (c.index !== fromIndex) return { ok: false, reason: 'from_mismatch' };
    if (c.status !== 'completed') return { ok: false, reason: `from_status_${c.status}` };
    if (toIndex !== fromIndex + 1) return { ok: false, reason: 'non_consecutive' };
    return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────
// SELECTORS — derivadas puras
// ───────────────────────────────────────────────────────────────────────────

/** @returns {number|null} */
export function getCurrentIndex(buffer) {
    return buffer.current?.index ?? null;
}

/** @returns {SentenceStatus|null} */
export function getCurrentStatus(buffer) {
    return buffer.current?.status ?? null;
}

/** @returns {boolean} true si el current está reading (audio sonando). */
export function isReading(buffer) {
    return buffer.current?.status === 'reading';
}

/** @returns {boolean} true si hay next prepared (gapless). */
export function hasNext(buffer) {
    return buffer.next !== null;
}
