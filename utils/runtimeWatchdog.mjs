/**
 * runtimeWatchdog.mjs — Observador pasivo del runtime (M-5.4 Resilience Pass).
 *
 * NO auto-corrige. NO interviene. SOLO observa periódicamente la salida de
 * `getRuntimeDiagnostics()` y emite logs estructurados cuando detecta
 * patrones de degradación. La decisión de actuar (retry, hardResync, full
 * reset) la toma el operador humano leyendo los logs, NO el watchdog.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BLOCKER FINAL V2 / TASK 1 — INVARIANTE: WATCHDOG READ-ONLY ABSOLUTO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Este módulo tiene PROHIBIDO, sin excepción:
 *   - pausar audio          (no llama pause())
 *   - detener playback      (no llama stop()/cleanup() del runtime)
 *   - disparar recovery     (no hardResync, no retry, no reload)
 *   - mutar el índice       (no setIdx / no advance)
 *   - despachar acciones    (no dispatch, no HARD_RESYNC, no PAUSE, no SKIP)
 *   - cancelar el executor  (no cancelSyncStrategy)
 *   - cerrar la sesión      (no onSessionEnd)
 *   - bloquear la lectura
 *
 * Su API de entrada es EXCLUSIVAMENTE:
 *   - getDiagnostics(): snapshot READ-ONLY (el watchdog nunca lo muta)
 *   - logger(event,data): emisión de logs
 * No recibe NINGUNA referencia mutable del runtime (ni pause, ni dispatch, ni
 * el hook). Físicamente no puede intervenir: solo lee y loguea.
 *
 * Su API de salida (handle) expone SOLO lecturas + ciclo de vida propio:
 *   stop() (su propio interval), isAlive(), lastSnapshot(), sessionId, tickNow()
 *
 * Un desync detectado se emite como WATCHDOG_DESYNC_OBSERVED_READONLY: log
 * DIAGNÓSTICO, severidad informativa, SIN escalada y SIN acción. El fix real
 * del desync de chunk vive en el guard de transición gapless del hook
 * (utils/gaplessChunkGuard.mjs), NO acá.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DETECCIONES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   WATCHDOG_STALLED_AUDIO
 *     status='playing' Y audioPaused=false Y currentTime no avanza por >Nms.
 *     Causa típica: tab background throttled, audio stuck, browser issue.
 *
 *   WATCHDOG_STALLED_VISUAL
 *     status='playing' Y currentSentence no cambia por >Nms.
 *     Causa típica: executor zombie sin activations en chunked mode.
 *
 *   WATCHDOG_DUPLICATE_OWNERSHIP
 *     ownershipViolationCount aumentó desde último snapshot.
 *     Causa típica: spawn de executor sin cancel previo (bug de lifecycle).
 *
 *   WATCHDOG_TIMER_LEAK
 *     pendingAdvances > 1 OR pendingAdvance/Fallback ambos true durante >Nms.
 *     Causa típica: cleanup de timers no cubre todos los paths.
 *
 *   WATCHDOG_DESYNC_OBSERVED_READONLY
 *     activeAudioSrc inconsistente con currentChunk esperado.
 *     DIAGNÓSTICO READ-ONLY — no acciona. El fix vive en el guard de
 *     transición gapless del hook. (Antes: WATCHDOG_DESYNC_WARNING crítico.)
 *
 *   WATCHDOG_CACHE_RUNAWAY
 *     audioCache > threshold por más de 1 ciclo (la GC no está alcanzando).
 *
 *   WATCHDOG_HARD_RESYNC_CASCADE
 *     hardResyncCount aumenta >2 en una ventana corta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   const watchdog = startRuntimeWatchdog({
 *     getDiagnostics: () => pb.getRuntimeDiagnostics(),
 *     intervalMs: 5000,
 *     thresholds: { audioStallMs: 4000, visualStallMs: 8000, cacheMax: 80 },
 *     logger: (event, data) => console.warn(event, data),
 *     sessionId: contentSessionRef.current,
 *   });
 *
 *   // Más tarde:
 *   watchdog.stop();
 *   if (watchdog.isAlive()) { ... }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_THRESHOLDS = {
    /** Ms sin avance de audio.currentTime mientras playing → stall */
    audioStallMs:        4000,
    /** Ms sin cambio de currentSentence mientras playing → visual stall */
    visualStallMs:       8000,
    /** Cantidad de entries en audioCache para considerar runaway */
    cacheMax:            80,
    /** hardResync extras dentro de window que dispara cascade warning */
    hardResyncCascade:   2,
    /** Ms de window para hardResync cascade detection */
    hardResyncCascadeWindowMs: 30000,
};

function defaultLogger(event, data) {
    // eslint-disable-next-line no-console
    console.warn(`[${event}]`, data);
}

/**
 * @typedef {object} WatchdogThresholds
 * @property {number} [audioStallMs]
 * @property {number} [visualStallMs]
 * @property {number} [cacheMax]
 * @property {number} [hardResyncCascade]
 * @property {number} [hardResyncCascadeWindowMs]
 *
 * @typedef {object} WatchdogOpts
 * @property {() => Record<string,any>} getDiagnostics
 * @property {number} [intervalMs]
 * @property {WatchdogThresholds} [thresholds]
 * @property {(event: string, data: object) => void} [logger]
 * @property {string|number} sessionId
 * @property {boolean} [autoStart=true]
 *
 * @typedef {object} WatchdogHandle
 * @property {() => void} stop
 * @property {() => boolean} isAlive
 * @property {() => Record<string,any>|null} lastSnapshot
 * @property {string|number} sessionId
 * @property {() => void} tickNow   For tests — fuerza un tick inmediato.
 */

/**
 * Inicia el watchdog. Devuelve handle con stop()/isAlive()/sessionId/tickNow().
 *
 * @param {WatchdogOpts} opts
 * @returns {WatchdogHandle}
 */
export function startRuntimeWatchdog(opts) {
    const {
        getDiagnostics,
        intervalMs = DEFAULT_INTERVAL_MS,
        thresholds = {},
        logger = defaultLogger,
        sessionId,
        autoStart = true,
    } = opts;

    const T = { ...DEFAULT_THRESHOLDS, ...thresholds };

    let alive = true;
    /** @type {ReturnType<typeof setInterval> | null} */
    let interval = null;
    /** @type {Record<string, any> | null} */
    let prevSnapshot = null;
    /** @type {number} */
    let prevAudioCurrentTimeAt = Date.now();
    /** @type {number} */
    let prevSentenceChangeAt = Date.now();
    /** @type {number[]} */
    let recentHardResyncBumps = [];

    const log = (event, extra) => {
        try {
            logger(event, { sessionId, ...extra });
        } catch { /* swallow */ }
    };

    const isAlive = () => alive;
    const lastSnapshot = () => prevSnapshot;

    const stop = () => {
        if (!alive) return;
        alive = false;
        if (interval !== null) {
            clearInterval(interval);
            interval = null;
        }
        log('WATCHDOG_STOPPED', {});
    };

    const tickNow = () => {
        if (!alive) return;
        let snap;
        try {
            snap = getDiagnostics();
        } catch (err) {
            log('WATCHDOG_DIAGNOSTICS_THREW', { error: (err && err.message) || String(err) });
            return;
        }
        if (!snap || typeof snap !== 'object') return;

        const now = (snap.now != null) ? snap.now : Date.now();

        // ── stalled audio ───────────────────────────────────────────────
        if (snap.playbackState && snap.playbackState.isPlaying === true
            && snap.playerState && snap.playerState.activePaused === false) {
            const ct = snap.playerState.activeCurrentTime;
            const prevCt = prevSnapshot?.playerState?.activeCurrentTime;
            if (typeof ct === 'number' && typeof prevCt === 'number') {
                if (Math.abs(ct - prevCt) < 0.01) {
                    if (now - prevAudioCurrentTimeAt > T.audioStallMs) {
                        log('WATCHDOG_STALLED_AUDIO', {
                            currentTime: ct,
                            stalledForMs: now - prevAudioCurrentTimeAt,
                            currentSentence: snap.currentSentence,
                            currentChunk: snap.currentChunk,
                        });
                    }
                } else {
                    prevAudioCurrentTimeAt = now;
                }
            } else {
                prevAudioCurrentTimeAt = now;
            }
        } else {
            prevAudioCurrentTimeAt = now;
        }

        // ── M-5.4.6 (Case 5) — WATCHDOG_STALLED_VISUAL ELIMINADO. ─────────
        // Tras eliminar visual ACK ownership en Phase 1.b.A, "stalled visual"
        // dejó de ser un síntoma accionable: el executor en chunked mode
        // puede tomar segundos entre activaciones (heurística) sin que sea bug,
        // y la "frase activa" es ahora pura responsabilidad del render, no del
        // runtime. El warning generaba ruido sin recovery posible — se borra.
        // El render tracking se mantiene sólo como diagnóstico mínimo.
        if (snap.playbackState && snap.playbackState.isPlaying === true
            && (!prevSnapshot || prevSnapshot.currentSentence !== snap.currentSentence)) {
            prevSentenceChangeAt = now;
        }

        // ── duplicate ownership ─────────────────────────────────────────
        const violations    = snap.ownershipTokens?.ownershipViolationCount ?? 0;
        const prevViolations = prevSnapshot?.ownershipTokens?.ownershipViolationCount ?? 0;
        if (violations > prevViolations) {
            log('WATCHDOG_DUPLICATE_OWNERSHIP', {
                newViolations: violations - prevViolations,
                totalViolations: violations,
                executorSpawnCount: snap.ownershipTokens?.executorSpawnCount,
            });
        }

        // ── timer leak ──────────────────────────────────────────────────
        const t = snap.activeTimers;
        if (t && (t.pendingAdvance && t.pendingFallback)) {
            log('WATCHDOG_TIMER_LEAK', {
                pendingAdvance: t.pendingAdvance,
                pendingFallback: t.pendingFallback,
                pendingCanplaythrough: t.pendingCanplaythrough,
            });
        }

        // ── desync warning: activeAudioSrc no coincide con expected chunk ─
        // Heurística suave: si executor está activo Y audioMode chunked Y
        // status playing Y currentSentence cambió pero activeAudioSrc no
        // cambió (correcto en chunk reuse) pero también el chunk anterior
        // tiene src distinta (split-brain).
        if (snap.audioMode === 'perChunkWithAnchors' || snap.audioMode === 'perChunkNoAnchors') {
            if (prevSnapshot
                && prevSnapshot.currentChunk !== snap.currentChunk
                && prevSnapshot.activeAudioSrc === snap.activeAudioSrc
                && snap.activeAudioSrc) {
                // BLOCKER FINAL V2 / TASK 1 — DIAGNÓSTICO READ-ONLY. Solo log.
                // El watchdog NO pausa, NO recupera, NO despacha. El fix real
                // del desync vive en el guard de transición de chunk del hook.
                log('WATCHDOG_DESYNC_OBSERVED_READONLY', {
                    reason: 'chunk_changed_but_audio_src_did_not',
                    readOnly: true,
                    prevChunk: prevSnapshot.currentChunk,
                    nowChunk:  snap.currentChunk,
                    audioSrcSnippet: String(snap.activeAudioSrc).slice(-50),
                });
            }
        }

        // ── cache runaway ───────────────────────────────────────────────
        const cacheSize = snap.cacheEntries?.audioCache ?? 0;
        if (cacheSize > T.cacheMax) {
            log('WATCHDOG_CACHE_RUNAWAY', {
                size: cacheSize,
                threshold: T.cacheMax,
                created: snap.cacheMetrics?.created,
                evicted: snap.cacheMetrics?.evicted,
            });
        }

        // ── hardResync cascade ──────────────────────────────────────────
        const hr = snap.hardResyncCount ?? 0;
        const prevHr = prevSnapshot?.hardResyncCount ?? 0;
        if (hr > prevHr) {
            const bumpsNow = hr - prevHr;
            for (let i = 0; i < bumpsNow; i++) recentHardResyncBumps.push(now);
            // expire viejos
            recentHardResyncBumps = recentHardResyncBumps.filter(
                ts => now - ts < T.hardResyncCascadeWindowMs,
            );
            if (recentHardResyncBumps.length > T.hardResyncCascade) {
                log('WATCHDOG_HARD_RESYNC_CASCADE', {
                    countInWindow: recentHardResyncBumps.length,
                    windowMs:      T.hardResyncCascadeWindowMs,
                    totalCount:    hr,
                });
            }
        }

        prevSnapshot = snap;
    };

    if (autoStart && typeof setInterval === 'function') {
        interval = setInterval(tickNow, intervalMs);
    }

    return /** @type {WatchdogHandle} */ ({
        stop, isAlive, lastSnapshot, sessionId, tickNow,
    });
}
