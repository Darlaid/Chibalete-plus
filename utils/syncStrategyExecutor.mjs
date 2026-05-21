/**
 * syncStrategyExecutor.mjs — Execution layer del contrato SentenceAudioMode.
 *
 * El detector (sentenceAudioMode.mjs) responde "qué modo es". Este módulo
 * responde "cómo avanzar visualmente dado ese modo". Reemplaza la asunción
 * implícita "1 audio = 1 frase" por estrategias explícitas y aisladas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DISEÑO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   - PURO respecto a estrategia: la lógica de scheduling vive acá,
 *     desacoplada del visor y del hook.
 *   - REUSABLE: V1 y V2 pueden invocar la misma API.
 *   - CANCELABLE: cada ejecución devuelve handle con cancel() + isAlive().
 *   - DETERMINISTIC CLEANUP: cancel() remueve TODOS los listeners y timers.
 *   - OWNERSHIP: sessionId opaco — los callbacks de la estrategia validan
 *     isAlive() antes de mutar estado externo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTRATEGIA POR MODO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   perSentence / ttsDynamic / unknown
 *     NO-OP. El runtime usa su path normal audio.onEnded → setIdx(idx+1).
 *     El handle responde isAlive()=true hasta cancel() o audio ended.
 *
 *   perChunkWithAnchors
 *     Usa anchors[chunkKey] = [{ sentenceIdx, startMs }, ...].
 *     Estrategia: listener `audio.timeupdate` lee `audio.currentTime`,
 *     activa cada sentence cuyo startMs <= currentTime + tolerance.
 *     Sin setInterval, sin polling agresivo. Pause/resume/seek manejados
 *     implícitamente porque audio.currentTime refleja la realidad del audio.
 *
 *   perChunkNoAnchors
 *     Heurística: pesos por longitud de texto, distribución proporcional
 *     sobre audio.duration. Mismo mecanismo timeupdate que perChunkWithAnchors.
 *     Si duration no está disponible, espera 'loadedmetadata' o degrada
 *     loggeando HEURISTIC_DURATION_UNAVAILABLE — NO aparenta precisión falsa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const handle = executeSyncStrategy({
 *     mode:               'perChunkWithAnchors',
 *     audioElement:       activeAudioRef.current,
 *     sentenceGroup:      [{ sentenceIdx: 0, weight: 50 }, { sentenceIdx: 1, weight: 80 }, ...],
 *     anchors:            [{ sentenceIdx: 0, startMs: 0 }, { sentenceIdx: 1, startMs: 3200 }, ...],
 *     playbackSpeed:      1.0,
 *     sessionId:          contentSessionRef.current,
 *     onSentenceActivate: (idx) => pb.advanceWithinChunk(idx),
 *     onChunkComplete:    () => { ... },
 *     onError:            (err) => console.error(err),
 *   });
 *
 *   // Más tarde:
 *   handle.cancel();
 *   if (!handle.isAlive()) { ... }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * M-5.4.6 (Phase 1.b.B Task 1) — SEMANTIC STABILIZATION.
 *
 * El executor opera explícitamente con `absoluteSentenceIndex` (índice global
 * de la frase en el contenido) + `localIndexInChunk` (posición dentro del
 * chunk de audio). Ya NO se usa el nombre ambiguo `sentenceIdx`.
 *
 * Invariante DURO (no solo en advanceWithinChunk):
 *   - tickActivate rechaza cualquier entry cuyo absoluteSentenceIndex < spawnFromIndex.
 *   - buildHeuristic/Fallback Timeline filtran entradas inválidas en origen.
 *   - perChunkWithAnchors filtra anchors fuera de [spawnFromIndex, chunkEndIndex].
 *
 * @typedef {'perSentence'|'perChunkWithAnchors'|'perChunkNoAnchors'|'ttsDynamic'|'unknown'} SentenceAudioMode
 *
 * @typedef {object} SentenceGroupEntry
 * @property {number} absoluteSentenceIndex   Índice global del contenido (0..N-1).
 * @property {number} localIndexInChunk       Posición dentro del chunk activo (0..M-1).
 * @property {number} weight                  Caracteres del texto, drive heuristic timing.
 *
 * @typedef {object} AnchorEntry
 * @property {number} absoluteSentenceIndex   Índice global, NO local.
 * @property {number} startMs                 Tiempo absoluto en el audio del chunk.
 *
 * @typedef {object} TimelineEntry
 * @property {number} absoluteSentenceIndex
 * @property {number} localIndexInChunk
 * @property {number} startMs
 *
 * @typedef {object} SyncStrategyHandle
 * @property {() => void}    cancel    Cancela todos los listeners/timers; idempotente.
 * @property {() => boolean} isAlive   True si NO cancelado y NO completado.
 * @property {string|number} sessionId Echo del sessionId pasado.
 * @property {SentenceAudioMode} mode  Echo del mode usado.
 * @property {() => TimelineEntry[]} getTimeline  Inspeccionable.
 *
 * @typedef {object} SyncStrategyOpts
 * @property {SentenceAudioMode} mode
 * @property {HTMLAudioElement|null} audioElement
 * @property {SentenceGroupEntry[]} sentenceGroup     Frases del chunk activo (post-filter por >= spawnFromIndex).
 * @property {AnchorEntry[]} [anchors]                Solo perChunkWithAnchors (post-filter).
 * @property {number} [playbackSpeed]
 * @property {string|number} sessionId
 * @property {number} [spawnFromIndex]                Índice absoluto donde nació el spawn. Defensa contra activaciones < spawnFromIndex.
 * @property {number|string} [chunkKey]               ChunkKey del audio activo (para logs).
 * @property {number} [chunkStartIndex]               Primer absoluteSentenceIndex del chunk.
 * @property {number} [chunkEndIndex]                 Último absoluteSentenceIndex del chunk.
 * @property {(absoluteSentenceIndex: number) => void} onSentenceActivate
 * @property {() => void} [onChunkComplete]
 * @property {(error: Error) => void} [onError]
 * @property {(event: string, data: object) => void} [logger]
 * @property {number} [activationTolerance=50]
 * @property {number} [metadataTimeoutMs=2000]
 */

const DEFAULT_TOLERANCE_MS         = 50;
const DEFAULT_METADATA_TIMEOUT_MS  = 2000;

// ── Fallback heurístico cuando audio.duration es NaN/Infinity/0 ─────────────
// Lectura en español ~13.5 chars/sec a 1.0x ≈ 150 palabras/min. El peso del
// sentenceGroup es `length` del audioSentence (caracteres), no palabras —
// usamos chars/sec directamente para evitar una división con error.
const FALLBACK_CHARS_PER_SEC_1X    = 13.5;
const FALLBACK_MIN_MS_PER_SENTENCE = 1200;

/**
 * Default logger — escribe a console con prefijo [SYNC]. Caller puede reemplazar.
 */
function defaultLogger(event, data) {
    // eslint-disable-next-line no-console
    console.log(`[SYNC] ${event}`, data);
}

/**
 * Ejecuta la estrategia de sincronización para el modo dado.
 *
 * @param {SyncStrategyOpts} opts
 * @returns {SyncStrategyHandle}
 */
export function executeSyncStrategy(opts) {
    const {
        mode,
        audioElement,
        sentenceGroup,
        anchors,
        playbackSpeed = 1,
        sessionId,
        spawnFromIndex   = Number.NEGATIVE_INFINITY,  // M-5.4.6 Task 1
        chunkKey         = null,                       // M-5.4.6 Task 1
        chunkStartIndex  = Number.NEGATIVE_INFINITY,   // M-5.4.6 Task 1
        chunkEndIndex    = Number.POSITIVE_INFINITY,   // M-5.4.6 Task 1
        onSentenceActivate,
        onChunkComplete,
        onError,
        logger = defaultLogger,
        activationTolerance = DEFAULT_TOLERANCE_MS,
        metadataTimeoutMs   = DEFAULT_METADATA_TIMEOUT_MS,
    } = opts;

    /** @type {Set<number>} */
    const activatedSet = new Set();
    /** @type {TimelineEntry[]} */
    let timeline = [];
    let alive = true;
    // BLOCKER FINAL V2 / TASK 3 — SYNC_STRATEGY_COMPLETE debe emitirse
    // EXACTAMENTE 1 vez por executor. Antes, tickActivate lo logueaba en CADA
    // timeupdate una vez agotada la timeline (spam), y endedHandler emitía OTRO
    // SYNC_STRATEGY_COMPLETE más. Este flag garantiza una sola emisión y, al
    // completar, desengancha el listener `timeupdate` (deja de escuchar).
    let completeEmitted = false;
    /** @type {Function | null} */
    let timeUpdateHandler = null;
    /** @type {Function | null} */
    let endedHandler = null;
    /** @type {Function | null} */
    let metadataHandler = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let metadataTimeoutHandle = null;

    const log = (event, data) => {
        try {
            logger(event, { sessionId, mode, ...data });
        } catch { /* logger should never throw */ }
    };

    const cancel = () => {
        if (!alive) return;
        alive = false;
        if (audioElement) {
            if (timeUpdateHandler) audioElement.removeEventListener('timeupdate', timeUpdateHandler);
            if (endedHandler)      audioElement.removeEventListener('ended', endedHandler);
            if (metadataHandler)   audioElement.removeEventListener('loadedmetadata', metadataHandler);
        }
        if (metadataTimeoutHandle !== null) {
            clearTimeout(metadataTimeoutHandle);
            metadataTimeoutHandle = null;
        }
        log('SYNC_STRATEGY_CANCEL', {
            activated: activatedSet.size,
            total:     timeline.length,
        });
    };

    const isAlive = () => alive;
    const getTimeline = () => timeline.slice();

    // BLOCKER FINAL V2 / TASK 3 — desenganchar SOLO el listener `timeupdate`.
    // Tras completar la timeline el executor sigue VIVO (isAlive=true) pero ya
    // NO procesa timeupdate: el único listener relevante restante es `ended`
    // (para onChunkComplete). Esto elimina el loop de complete y evita que el
    // executor del chunk anterior siga reaccionando a timeupdate.
    const detachTimeupdate = () => {
        if (timeUpdateHandler && audioElement) {
            audioElement.removeEventListener('timeupdate', timeUpdateHandler);
        }
        timeUpdateHandler = null;
    };

    // BLOCKER FINAL V2 / TASK 3 — emisión idempotente de SYNC_STRATEGY_COMPLETE.
    // Garantiza máximo 1 emisión por executor sin importar cuántos timeupdate
    // o el ended posterior lo intenten. Al completar por timeline-agotada,
    // además desengancha timeupdate.
    const emitCompleteOnce = (viaLabel, alsoDetachTimeupdate) => {
        if (completeEmitted) return;
        completeEmitted = true;
        log('SYNC_STRATEGY_COMPLETE', {
            activated: activatedSet.size,
            chunkKey,
            via:       viaLabel,
        });
        if (alsoDetachTimeupdate) detachTimeupdate();
    };

    const handle = /** @type {SyncStrategyHandle} */ ({
        cancel, isAlive, sessionId, mode, getTimeline,
    });

    // ── Validaciones tempranas ────────────────────────────────────────────
    if (typeof onSentenceActivate !== 'function') {
        log('SYNC_STRATEGY_INVALID_OPTS', { reason: 'onSentenceActivate_not_function' });
        cancel();
        return handle;
    }

    // ── Modos NO-OP ───────────────────────────────────────────────────────
    if (mode === 'perSentence' || mode === 'ttsDynamic' || mode === 'unknown') {
        log('SYNC_STRATEGY_EXEC_START', {
            strategy: 'noop',
            reason:   mode === 'unknown' ? 'unknown_mode_fallback_to_runtime_default' : 'one_audio_per_sentence',
        });
        // Inert handle — runtime usa su path normal audio.onEnded.
        return handle;
    }

    // ── Validar audioElement para modos que lo necesitan ──────────────────
    if (!audioElement || typeof audioElement.addEventListener !== 'function') {
        log('SYNC_STRATEGY_INVALID_OPTS', { reason: 'no_audio_element' });
        cancel();
        return handle;
    }

    // ── Activador común ───────────────────────────────────────────────────
    // M-5.4.6 (Task 1) — Guard DURO en origen: rechaza activaciones cuyo
    // absoluteSentenceIndex esté fuera de [spawnFromIndex, chunkEndIndex] o
    // que sean < chunkStartIndex. Esto evita que un bug downstream (timeline
    // construida mal) genere SYNC_SENTENCE_ACTIVATE con índice ambiguo o
    // local. El advanceWithinChunk del hook tiene su propio guard como
    // defensa-en-profundidad, pero acá es DONDE NACE la activación.
    const tickActivate = (currentTimeMs, viaLabel) => {
        if (!alive) return;
        for (const entry of timeline) {
            if (entry.startMs > currentTimeMs + activationTolerance) break;
            const abs = entry.absoluteSentenceIndex;
            if (activatedSet.has(abs)) continue;

            // Invariante: la activación debe estar dentro del rango spawn-aware.
            if (abs < spawnFromIndex || abs < chunkStartIndex || abs > chunkEndIndex) {
                log('EXECUTOR_INVALID_ACTIVATION', {
                    attempted:               abs,
                    localIndexInChunk:       entry.localIndexInChunk,
                    spawnFromIndex,
                    chunkStartIndex,
                    chunkEndIndex,
                    chunkKey,
                    via:                     viaLabel,
                    reason:                  abs < spawnFromIndex ? 'below_spawn'
                                           : abs < chunkStartIndex ? 'below_chunk_start'
                                           : 'above_chunk_end',
                });
                activatedSet.add(abs);  // mark as "seen" so we don't re-evaluate
                continue;
            }

            activatedSet.add(abs);
            log('SYNC_SENTENCE_ACTIVATE', {
                absoluteSentenceIndex: abs,
                localIndexInChunk:     entry.localIndexInChunk,
                spawnFromIndex,
                chunkKey,
                expectedMs:            entry.startMs,
                actualMs:              currentTimeMs,
                drift:                 currentTimeMs - entry.startMs,
                via:                   viaLabel,
            });
            try {
                onSentenceActivate(abs);
            } catch (err) {
                log('SYNC_ACTIVATE_ERROR', {
                    absoluteSentenceIndex: abs,
                    localIndexInChunk:     entry.localIndexInChunk,
                    error:                 err && err.message,
                });
                if (typeof onError === 'function') {
                    try { onError(err); } catch { /* swallow */ }
                }
            }
        }
        if (activatedSet.size >= timeline.length && timeline.length > 0) {
            // BLOCKER FINAL V2 / TASK 3 — emitir UNA sola vez y dejar de
            // escuchar timeupdate. No cancel acá — seguimos vivos para 'ended'
            // (onChunkComplete). Sin esto, cada timeupdate posterior re-logueaba
            // SYNC_STRATEGY_COMPLETE (loop observado en el smoke S-2).
            emitCompleteOnce(viaLabel, true /* detach timeupdate */);
        }
    };

    const installListeners = () => {
        timeUpdateHandler = () => {
            if (!alive || !audioElement) return;
            const now = (audioElement.currentTime || 0) * 1000;
            tickActivate(now, 'timeupdate');
        };
        endedHandler = () => {
            if (!alive) return;
            // Catchup: activar cualquier remanente que no haya sido activado.
            const finalMs = audioElement
                ? (Number.isFinite(audioElement.duration) ? audioElement.duration * 1000 : Infinity)
                : Infinity;
            tickActivate(finalMs, 'ended_catchup');
            // BLOCKER FINAL V2 / TASK 3 — si la timeline ya se había agotado
            // (tickActivate emitió complete vía timeupdate/ended_catchup), ESTO
            // es no-op. Garantiza ≤1 SYNC_STRATEGY_COMPLETE por executor.
            emitCompleteOnce('audio_ended', false);
            if (typeof onChunkComplete === 'function') {
                try { onChunkComplete(); }
                catch (err) {
                    log('SYNC_CHUNK_COMPLETE_ERROR', { error: err && err.message });
                    if (typeof onError === 'function') { try { onError(err); } catch { /* swallow */ } }
                }
            }
            cancel();
        };
        audioElement.addEventListener('timeupdate', timeUpdateHandler);
        audioElement.addEventListener('ended', endedHandler);
    };

    // ── perChunkWithAnchors ───────────────────────────────────────────────
    if (mode === 'perChunkWithAnchors') {
        if (!Array.isArray(anchors) || anchors.length === 0) {
            log('SYNC_STRATEGY_FALLBACK', { reason: 'no_anchors_passed' });
            cancel();
            return handle;
        }
        // M-5.4.6 (Task 1) — anchors deben usar absoluteSentenceIndex. Si el
        // input legacy usaba 'sentenceIdx', se rechaza (back-compat removida).
        // Filtros: validez estructural + rango chunk-aware.
        timeline = anchors
            .filter(a => a && Number.isFinite(a.startMs) && Number.isInteger(a.absoluteSentenceIndex))
            .filter(a => a.absoluteSentenceIndex >= spawnFromIndex
                      && a.absoluteSentenceIndex >= chunkStartIndex
                      && a.absoluteSentenceIndex <= chunkEndIndex)
            .map(a => ({
                absoluteSentenceIndex: a.absoluteSentenceIndex,
                localIndexInChunk:     a.localIndexInChunk ?? (a.absoluteSentenceIndex - chunkStartIndex),
                startMs:               a.startMs,
            }))
            .sort((a, b) => a.startMs - b.startMs);
        log('SYNC_STRATEGY_EXEC_START', {
            strategy:     'perChunkWithAnchors',
            timelineLen:  timeline.length,
            timeline,
            playbackSpeed,
            tolerance:    activationTolerance,
        });
        if (timeline.length === 0) {
            log('SYNC_STRATEGY_EMPTY_TIMELINE', { reason: 'no_valid_anchors' });
            cancel();
            return handle;
        }
        installListeners();
        // Tick inmediato — activar el primero (startMs típicamente 0).
        const initialMs = (audioElement.currentTime || 0) * 1000;
        tickActivate(initialMs, 'initial_tick');
        return handle;
    }

    // ── perChunkNoAnchors ─────────────────────────────────────────────────
    if (mode === 'perChunkNoAnchors') {
        // BLOCKER M-5.4.3 — diagnostic entry log. Mostrar el estado inicial del
        // audio al momento del spawn para identificar duration races (V2 chunked
        // MP3 que reporta Infinity hasta que termina de bufferear).
        log('HEURISTIC_EXEC_ENTER', {
            sentenceCount:   Array.isArray(sentenceGroup) ? sentenceGroup.length : 0,
            audioDuration:   audioElement.duration,
            audioCurrentTime: audioElement.currentTime,
            audioReadyState: audioElement.readyState,
            audioPaused:     audioElement.paused,
            playbackSpeed,
        });
        log('CHUNK_NO_ANCHORS_HEURISTIC', {
            sentenceCount: Array.isArray(sentenceGroup) ? sentenceGroup.length : 0,
        });
        const startStrategyWithDuration = (durationSec, viaLabel) => {
            if (!alive) return;
            timeline = buildHeuristicTimeline(sentenceGroup, durationSec * 1000);
            log('HEURISTIC_TIMELINE_BUILT', {
                durationMs: durationSec * 1000,
                timelineLen: timeline.length,
                timeline,
                via: viaLabel,
            });
            log('SYNC_STRATEGY_EXEC_START', {
                strategy:    'perChunkNoAnchors_heuristic',
                timelineLen: timeline.length,
                playbackSpeed,
                via:         viaLabel,
            });
            if (timeline.length === 0) {
                log('SYNC_STRATEGY_EMPTY_TIMELINE', { reason: 'empty_sentence_group' });
                cancel();
                return;
            }
            installListeners();
            // Tick inmediato — crítico cuando el spawn ocurre tras play() ya
            // resuelto. Si audio.currentTime ya pasó startMs de la primera frase,
            // se activan todas las que correspondan sin esperar al próximo
            // timeupdate (que podría tardar 250-300ms).
            const initialMs = (audioElement.currentTime || 0) * 1000;
            tickActivate(initialMs, viaLabel === 'fallback_word_count'
                ? 'spawn_immediate_fallback'
                : 'spawn_immediate');
        };

        // BLOCKER M-5.4.3 — Fallback timeline cuando la duración del audio no
        // está disponible. Antes degradábamos a "no advance" tras 2s; ahora
        // construimos una timeline heurística basada en chars/sec ≈ 13.5 a 1.0x
        // (≈150 wpm en español, peso = audioSentence.length). Cada frase tiene
        // piso de 1200ms para evitar burst en frases muy cortas.
        const startStrategyWithFallback = (via) => {
            if (!alive) return;
            timeline = buildFallbackTimeline(sentenceGroup, playbackSpeed);
            log('HEURISTIC_DURATION_FALLBACK_USED', {
                reason:        via,
                timelineLen:   timeline.length,
                timeline,
                charsPerSec1x: FALLBACK_CHARS_PER_SEC_1X,
                minMsPerSent:  FALLBACK_MIN_MS_PER_SENTENCE,
                playbackSpeed,
            });
            log('SYNC_STRATEGY_EXEC_START', {
                strategy:    'perChunkNoAnchors_word_count_fallback',
                timelineLen: timeline.length,
                playbackSpeed,
                via:         'fallback_word_count',
            });
            if (timeline.length === 0) {
                log('SYNC_STRATEGY_EMPTY_TIMELINE', { reason: 'empty_sentence_group_in_fallback' });
                cancel();
                return;
            }
            installListeners();
            const initialMs = (audioElement.currentTime || 0) * 1000;
            tickActivate(initialMs, 'spawn_immediate_fallback');
        };

        const dur = audioElement.duration;
        if (Number.isFinite(dur) && dur > 0) {
            startStrategyWithDuration(dur, 'duration_ready_at_spawn');
            return handle;
        }
        // Esperar metadata
        log('HEURISTIC_WAIT_METADATA', {
            duration:        dur,
            waitingMsMax:    metadataTimeoutMs,
            audioReadyState: audioElement.readyState,
        });
        log('HEURISTIC_DURATION_UNAVAILABLE', {
            duration: dur,
            waitingMsMax: metadataTimeoutMs,
        });
        metadataHandler = () => {
            if (!alive || !audioElement) return;
            audioElement.removeEventListener('loadedmetadata', metadataHandler);
            metadataHandler = null;
            if (metadataTimeoutHandle !== null) {
                clearTimeout(metadataTimeoutHandle);
                metadataTimeoutHandle = null;
            }
            const d = audioElement.duration;
            log('HEURISTIC_METADATA_READY', {
                duration:        d,
                audioReadyState: audioElement.readyState,
                via:             'loadedmetadata_event',
            });
            if (Number.isFinite(d) && d > 0) {
                startStrategyWithDuration(d, 'metadata_event');
            } else {
                log('HEURISTIC_DURATION_UNAVAILABLE', {
                    duration: d,
                    via: 'loadedmetadata_event',
                    decision: 'engage_fallback_word_count',
                });
                startStrategyWithFallback('metadata_event_bad_duration');
            }
        };
        audioElement.addEventListener('loadedmetadata', metadataHandler);
        metadataTimeoutHandle = setTimeout(() => {
            if (!alive) return;
            if (metadataHandler) {
                audioElement.removeEventListener('loadedmetadata', metadataHandler);
                metadataHandler = null;
            }
            log('HEURISTIC_DURATION_UNAVAILABLE', {
                duration: audioElement.duration,
                via: 'timeout',
                decision: 'engage_fallback_word_count',
            });
            startStrategyWithFallback('metadata_timeout');
        }, metadataTimeoutMs);
        return handle;
    }

    // ── Modo desconocido (string fuera de los 5) ──────────────────────────
    log('SYNC_STRATEGY_UNRECOGNIZED_MODE', { mode });
    cancel();
    return handle;
}

/**
 * M-5.4.6 (Task 1) — Resuelve absoluteSentenceIndex desde una entrada de
 * sentenceGroup. Acepta el nombre canónico actual + un fallback defensivo
 * sobre el legacy `sentenceIdx` (solo lectura, NO se emite hacia callbacks).
 *
 * @param {SentenceGroupEntry|object} s
 * @returns {number|null}
 */
function _absIdx(s) {
    if (!s || typeof s !== 'object') return null;
    if (Number.isInteger(s.absoluteSentenceIndex)) return s.absoluteSentenceIndex;
    // Fallback defensivo para tests/legacy que aún pasen 'sentenceIdx'.
    if (Number.isInteger(s.sentenceIdx))           return s.sentenceIdx;
    return null;
}

function _localIdx(s, idxInGroup) {
    if (!s || typeof s !== 'object') return idxInGroup;
    if (Number.isInteger(s.localIndexInChunk)) return s.localIndexInChunk;
    return idxInGroup;  // por posición en el array
}

/**
 * BLOCKER M-5.4.3 — Construye timeline fallback cuando audio.duration NO
 * está disponible. M-5.4.6 (Task 1): emite TimelineEntry con tres campos.
 *
 * @param {SentenceGroupEntry[]} sentenceGroup
 * @param {number} playbackSpeed   default 1.0
 * @returns {TimelineEntry[]}
 */
export function buildFallbackTimeline(sentenceGroup, playbackSpeed = 1) {
    if (!Array.isArray(sentenceGroup) || sentenceGroup.length === 0) return [];
    const speed = (Number.isFinite(playbackSpeed) && playbackSpeed > 0) ? playbackSpeed : 1;
    const charsPerSec     = FALLBACK_CHARS_PER_SEC_1X * speed;
    const minMsPerSentence = FALLBACK_MIN_MS_PER_SENTENCE / speed;
    let cumulativeMs = 0;
    const out = [];
    sentenceGroup.forEach((s, i) => {
        const abs = _absIdx(s);
        if (abs == null) return;  // skip entries inválidas en origen
        const startMs = cumulativeMs;
        const w = (Number.isFinite(s.weight) && s.weight > 0) ? s.weight : 1;
        const estimatedMs = Math.max((w / charsPerSec) * 1000, minMsPerSentence);
        cumulativeMs += estimatedMs;
        out.push({
            absoluteSentenceIndex: abs,
            localIndexInChunk:     _localIdx(s, i),
            startMs,
        });
    });
    return out;
}

/**
 * Construye timeline heurística distribuyendo durationMs proporcional al
 * peso. M-5.4.6 (Task 1): emite TimelineEntry con tres campos.
 *
 * @param {SentenceGroupEntry[]} sentenceGroup
 * @param {number} totalDurationMs
 * @returns {TimelineEntry[]}
 */
export function buildHeuristicTimeline(sentenceGroup, totalDurationMs) {
    if (!Array.isArray(sentenceGroup) || sentenceGroup.length === 0) return [];
    if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) return [];
    const totalWeight = sentenceGroup.reduce((sum, s) => sum + (Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 1), 0);
    if (totalWeight <= 0) return [];
    let cumulativeMs = 0;
    const out = [];
    sentenceGroup.forEach((s, i) => {
        const abs = _absIdx(s);
        if (abs == null) return;  // skip entries inválidas
        const startMs = cumulativeMs;
        const w = Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 1;
        cumulativeMs += (w / totalWeight) * totalDurationMs;
        out.push({
            absoluteSentenceIndex: abs,
            localIndexInChunk:     _localIdx(s, i),
            startMs,
        });
    });
    return out;
}
