/**
 * ImmersiveSession.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Una sesión = un (contentId, userId, lifecycleToken) con su propia state
 * machine, su OperationQueue serializada y sus invariantes async-safety.
 *
 * Estados (8): idle, opening, ready, playing, paused, closing, closed, error.
 * Transiciones legales se enumeran abajo en TRANSITIONS.
 *
 * Async safety:
 *   - assertLive(capturedToken, op) — invocar antes de mutar tras un await.
 *     Si el token capturado no coincide con el actual de la sesión, lanza
 *     SessionError({kind: 'stale_session_callback'}). El callback debe
 *     abandonar silenciosamente, NO mutar.
 *
 * OperationQueue:
 *   - enqueueOperation(action) → Promise<{ok, error?}>
 *     Las operaciones se procesan FIFO, una a la vez. Triple play() resulta
 *     en una sola arrancada de audio: la 2da y 3ra se encolan, ven que el
 *     estado ya es playing, y se vuelven no-op (devuelven {ok: true,
 *     reason: 'already_playing'}).
 *
 * Recursos externos:
 *   - audio (AudioRuntime), visibility (VisibilityCoordinator), progress
 *     (ProgressRuntime), store (RuntimeStore), diagnostics (Diagnostics).
 *     Todos inyectados — la sesión NO crea ninguno.
 */

/**
 * TRANSITIONS — la spec M-1 lista las transiciones felices explícitas:
 *   idle → opening
 *   opening → ready | error
 *   ready → playing
 *   playing → paused
 *   paused → playing
 *   ready/playing/paused → closing
 *   error → closing
 *   closing → closed
 *
 * Adicionalmente permitimos `ready/playing/paused → error` para fallos
 * en runtime (audio_unavailable, audio_contract_failed) — no degrada
 * el estado a un valor ilegal sino al estado terminal definido para
 * fallos. Es la única forma de cumplir el escenario "audio_unavailable
 * deja sesión en estado controlado" del test 13.
 */
const TRANSITIONS = Object.freeze({
    idle:    new Set(['opening']),
    opening: new Set(['ready', 'error', 'closing']),
    ready:   new Set(['playing', 'error', 'closing']),
    playing: new Set(['paused', 'ready', 'error', 'closing']),
    paused:  new Set(['playing', 'error', 'closing']),
    error:   new Set(['closing']),
    closing: new Set(['closed']),
    closed:  new Set([]),
});

export function createImmersiveSession(args) {
    const {
        id, contentId, userId,
        lifecycleToken,
        startIndex = 0,
        totalIndices = 0,
        audio, visibility, progress, store, diagnostics,
        hydrateContent,        // async ({contentId}) => { totalIndices: number }
        visibilityTimeoutMs,
    } = args;

    if (typeof id !== 'string' || id.length === 0) {
        throw makeErr('invariant_violated', { op: 'createImmersiveSession', reason: 'missing_id' });
    }
    if (typeof contentId !== 'string' || contentId.length === 0) {
        throw makeErr('invariant_violated', { op: 'createImmersiveSession', reason: 'missing_contentId' });
    }

    // ── State interna ───────────────────────────────────────────────────────
    let status        = 'idle';
    let currentIndex  = startIndex;
    let total         = totalIndices;
    let lastError     = null;
    let visualReady   = false;
    /** lifecycleToken: monotonic. Cualquier callback async captura el valor
     *  vigente al momento de scheduling y debe verificarlo antes de mutar. */
    let token         = lifecycleToken;

    /** OperationQueue — array secuencial. Solo una operación corre a la vez. */
    const queue = [];
    let processing = false;

    // ── Public refs (frozen accessors) ─────────────────────────────────────
    const sessionRef = { id, contentId, userId };
    Object.freeze(sessionRef);

    function getStatus() { return status; }
    function getToken()  { return token; }
    function getRef()    { return sessionRef; }
    function getCurrentIndex() { return currentIndex; }
    function getTotal()        { return total; }

    // ── Transition + snapshot publish ──────────────────────────────────────
    function transition(next, op) {
        const allowed = TRANSITIONS[status];
        if (!allowed || !allowed.has(next)) {
            const err = makeErr('invalid_transition', {
                sessionId: id, contentId,
                op, meta: { from: status, to: next },
            });
            // Si la sesión no está cerrada, preservamos lastError.
            // (closed → cualquier transición posterior es no-op silencioso.)
            if (status !== 'closed') lastError = err;
            diag('state.transition', { from: status, to: next, allowed: false, op });
            return err;
        }
        const prev = status;
        status = next;
        diag('state.transition', { from: prev, to: next, allowed: true, op });
        publishSnapshot();
        return null;
    }

    function publishSnapshot() {
        // Sprint M-4.2 — campos diagnósticos enriquecidos. Derivados puros
        // del estado actual; sin side effects, sin nuevas allocations.
        //   isPlaying:          shorthand para consumidores que sólo necesitan
        //                       saber si está en reproducción activa.
        //   audioState:         'idle' | 'playing' — del AudioRuntime.
        //   audioUrlLoaded:     bool — el src está cargado en el audio activo.
        //   activeSentenceId:   alias de currentIndex (vocabulario semántico).
        //   pendingTransition:  bool — hay ops en cola esperando ejecutarse.
        //   playbackGeneration: alias de lifecycleToken (vocabulario semántico
        //                       para callers que monitoreen contínuamente).
        let audioState      = 'idle';
        let audioUrlLoaded  = false;
        if (audio && typeof audio.getDebugState === 'function') {
            try {
                const audioDbg = audio.getDebugState();
                if (audioDbg) {
                    audioState     = audioDbg.state === 'playing' ? 'playing' : 'idle';
                    audioUrlLoaded = audioDbg.urlLoaded === true;
                }
            } catch { /* defensive: no romper publish por debug getter */ }
        }
        const snap = Object.freeze({
            sessionId:          id,
            contentId,
            userId,
            status,
            currentIndex,
            totalIndices:       total,
            lifecycleToken:     token,
            lastError,
            visualReady,
            // ── M-4.2 diagnostics ──
            isPlaying:          status === 'playing',
            audioState,
            audioUrlLoaded,
            activeSentenceId:   currentIndex,
            pendingTransition:  queue.length > 0 || processing,
            playbackGeneration: token,
        });
        store?.replace(snap);
    }

    function diag(kind, data) {
        if (!diagnostics) return;
        diagnostics.log({ sessionId: id, contentId, kind, data });
    }

    // ── Async safety ───────────────────────────────────────────────────────

    /**
     * assertLive — verifica que el token capturado sigue vigente. Si no,
     * lanza stale_session_callback (el caller debe try/catch o usar
     * isLive() pasivo).
     */
    function assertLive(capturedToken, op) {
        if (capturedToken !== token) {
            const err = makeErr('stale_session_callback', {
                sessionId: id, contentId,
                op,
                capturedToken, currentToken: token,
            });
            diag('callback.stale', { op, capturedToken, currentToken: token });
            throw err;
        }
        if (status === 'closed' || status === 'closing') {
            const err = makeErr('destroyed_session_mutation', {
                sessionId: id, contentId,
                op,
                meta: { status },
            });
            throw err;
        }
    }

    /** Pasivo — devuelve bool sin throw. Útil para early-return en callbacks. */
    function isLive(capturedToken) {
        return capturedToken === token && status !== 'closed' && status !== 'closing';
    }

    // ── Hydration (open) ───────────────────────────────────────────────────

    async function hydrate() {
        // status debe estar en 'opening' antes de entrar. Caller responsable.
        if (typeof hydrateContent !== 'function') {
            // Sin hydrator inyectado, asumimos contenido pre-known.
            return { ok: true };
        }
        const captured = token;
        try {
            const result = await hydrateContent({ contentId });
            // tras await: validar que seguimos vivos.
            if (!isLive(captured)) {
                // Closed/cancelled mientras hidratábamos — abortar silencioso.
                return { ok: false, error: makeErr('aborted', { sessionId: id, contentId, op: 'hydrate' }) };
            }
            if (!result || typeof result !== 'object') {
                return { ok: false, error: makeErr('content_invalid', { sessionId: id, contentId, op: 'hydrate' }) };
            }
            if (Number.isFinite(result.totalIndices) && result.totalIndices > 0) {
                total = result.totalIndices;
            }
            return { ok: true };
        } catch (err) {
            if (!isLive(captured)) {
                return { ok: false, error: makeErr('aborted', { sessionId: id, contentId, op: 'hydrate' }) };
            }
            const kind = err?.kind || 'content_not_found';
            return { ok: false, error: makeErr(kind, { sessionId: id, contentId, op: 'hydrate' }) };
        }
    }

    /**
     * open() — moves idle → opening → ready (o → error). Idempotente:
     * si ya está ready/playing/paused devuelve {ok:true} sin re-hidratar.
     */
    async function open() {
        if (status === 'ready' || status === 'playing' || status === 'paused') {
            return { ok: true };
        }
        if (status !== 'idle') {
            return { ok: false, error: makeErr('invalid_transition', {
                sessionId: id, contentId, op: 'open', meta: { from: status, to: 'opening' },
            }) };
        }
        const tErr = transition('opening', 'open');
        if (tErr) return { ok: false, error: tErr };
        diag('session.opened', null);

        const captured = token;
        const hyd = await hydrate();
        if (!isLive(captured)) {
            // Ya nos cerraron mientras hidratábamos.
            return { ok: false, error: makeErr('aborted', { sessionId: id, contentId, op: 'open' }) };
        }
        if (!hyd.ok) {
            lastError = hyd.error;
            transition('error', 'open');
            diag('session.error', { error: hyd.error });
            return { ok: false, error: hyd.error };
        }
        const tReady = transition('ready', 'open');
        if (tReady) return { ok: false, error: tReady };
        diag('session.ready', null);
        return { ok: true };
    }

    // ── Operation queue ────────────────────────────────────────────────────

    function enqueueOperation(action) {
        return new Promise((resolve) => {
            queue.push({ action, resolve });
            diag('queue.enqueue', { kind: action?.kind ?? 'unknown', queueDepth: queue.length });
            if (!processing) processQueue();
        });
    }

    async function processQueue() {
        if (processing) return;
        processing = true;
        try {
            while (queue.length > 0) {
                const { action, resolve } = queue.shift();
                diag('queue.start', { kind: action?.kind ?? 'unknown' });
                let result;
                try {
                    result = await runAction(action);
                } catch (err) {
                    result = { ok: false, error: err?.kind
                        ? err
                        : makeErr('invariant_violated', { op: action?.kind, sessionId: id, contentId, meta: { error: String(err) } }),
                    };
                }
                diag('queue.done', { kind: action?.kind ?? 'unknown', ok: result?.ok === true });
                resolve(result);
                // Si nos cerraron durante esta operación, drenamos el resto
                // como aborted — no procesamos.
                if (status === 'closed') {
                    drainAsAborted();
                }
            }
        } finally {
            processing = false;
        }
    }

    function drainAsAborted() {
        while (queue.length > 0) {
            const { action, resolve } = queue.shift();
            resolve({ ok: false, error: makeErr('aborted', {
                sessionId: id, contentId, op: action?.kind ?? 'unknown',
                reason: 'session_closed',
            }) });
        }
    }

    async function runAction(action) {
        const kind = action?.kind;
        switch (kind) {
            case 'play':        return _play();
            case 'pause':       return _pause();
            case 'resume':      return _resume();
            case 'goTo':        return _goTo(action.index, action.source);
            case 'close':       return _close(action.reason);
            // Sprint M-3.2 — eventos productivos del audio.
            case 'audioEnded':  return _audioEnded(action.index);
            case 'audioFailed': return _audioFailed(action.index, action.reason);
            default:
                return { ok: false, error: makeErr('invariant_violated', {
                    sessionId: id, contentId, op: 'unknown', meta: { kind },
                }) };
        }
    }

    // ── Action implementations ─────────────────────────────────────────────

    async function _play() {
        if (status === 'playing') return { ok: true, reason: 'already_playing' };
        if (status !== 'ready' && status !== 'paused') {
            return { ok: false, error: makeErr('invalid_transition', {
                sessionId: id, contentId, op: 'play', meta: { from: status, to: 'playing' },
            }) };
        }

        const captured = token;

        // Audio preflight + start.
        if (audio) {
            const pre = await audio.preflight(sessionRef, currentIndex);
            try { assertLive(captured, 'play.preflight'); }
            catch (e) {
                // Sprint M-4.3 — close-during-preflight: no se creó audio,
                // pero emitimos audio.acquire.cancelled para visibilidad.
                diag('audio.acquire.cancelled', {
                    index: currentIndex, phase: 'preflight', reason: 'session_stale',
                });
                return { ok: false, error: e };
            }
            if (!pre.ok) {
                const err = makeErr('audio_unavailable', {
                    sessionId: id, contentId, index: currentIndex, op: 'play',
                    meta: { reason: pre.reason },
                });
                lastError = err;
                transition('error', 'play');
                return { ok: false, error: err };
            }
            const start = await audio.startPlayback(sessionRef, currentIndex, pre.src);
            try { assertLive(captured, 'play.startPlayback'); }
            catch (e) {
                // Sprint M-4.3 — close-during-startPlayback: el audio puede
                // haberse acquired exitosamente y estar en AudioRuntime.
                // activeAudio. Si no liberamos explícitamente, queda zombie.
                // releaseFor(sessionRef) pausa + clear si activeKey.sessionId
                // coincide. Si start.ok===false, ya hubo cleanup en AudioRuntime.
                if (start.ok) {
                    try { audio.releaseFor(sessionRef); } catch { /* ignore */ }
                }
                diag('audio.acquire.cancelled', {
                    index: currentIndex, phase: 'startPlayback',
                    reason: 'session_stale',
                    audioWasAcquired: start.ok,
                });
                return { ok: false, error: e };
            }
            if (!start.ok) {
                // Sprint M-3.2 — distinguir autoplay policy del runtime para
                // que el viewer pueda pedir click del usuario en lugar de
                // tratarlo como error genérico.
                const kind = start.reason === 'autoplay_blocked'
                    ? 'audio_autoplay_blocked'
                    : 'audio_contract_failed';
                // Sprint M-4.3 — propagar el meta enriquecido desde AudioRuntime
                // para que el viewer pueda emitir errorMeta completo en consola.
                const err = makeErr(kind, {
                    sessionId: id, contentId, index: currentIndex, op: 'play',
                    meta: {
                        reason: start.reason,
                        ...(start.meta || {}),
                    },
                });
                lastError = err;
                transition('error', 'play');
                return { ok: false, error: err };
            }
        }
        const tErr = transition('playing', 'play');
        if (tErr) return { ok: false, error: tErr };
        return { ok: true };
    }

    async function _pause() {
        if (status === 'paused') return { ok: true, reason: 'already_paused' };
        if (status !== 'playing') {
            return { ok: false, error: makeErr('invalid_transition', {
                sessionId: id, contentId, op: 'pause', meta: { from: status, to: 'paused' },
            }) };
        }
        if (audio) {
            try { audio.pause(); } catch { /* ignore */ }
        }
        const tErr = transition('paused', 'pause');
        if (tErr) return { ok: false, error: tErr };
        return { ok: true };
    }

    async function _resume() {
        if (status === 'playing') return { ok: true, reason: 'already_playing' };
        if (status !== 'paused') {
            return { ok: false, error: makeErr('invalid_transition', {
                sessionId: id, contentId, op: 'resume', meta: { from: status, to: 'playing' },
            }) };
        }
        const captured = token;
        if (audio) {
            const start = await audio.startPlayback(sessionRef, currentIndex);
            try { assertLive(captured, 'resume.startPlayback'); }
            catch (e) {
                // Sprint M-4.3 — close-during-resume: símil a play. Liberar
                // audio acquired si el startPlayback resolvió ok antes del stale.
                if (start.ok) {
                    try { audio.releaseFor(sessionRef); } catch { /* ignore */ }
                }
                diag('audio.acquire.cancelled', {
                    index: currentIndex, phase: 'resume.startPlayback',
                    reason: 'session_stale',
                    audioWasAcquired: start.ok,
                });
                return { ok: false, error: e };
            }
            if (!start.ok) {
                const kind = start.reason === 'autoplay_blocked'
                    ? 'audio_autoplay_blocked'
                    : 'audio_contract_failed';
                // Sprint M-4.3 — propagar meta enriquecido.
                const err = makeErr(kind, {
                    sessionId: id, contentId, index: currentIndex, op: 'resume',
                    meta: {
                        reason: start.reason,
                        ...(start.meta || {}),
                    },
                });
                lastError = err;
                transition('error', 'resume');
                return { ok: false, error: err };
            }
        }
        const tErr = transition('playing', 'resume');
        if (tErr) return { ok: false, error: tErr };
        return { ok: true };
    }

    async function _goTo(targetIndex, source) {
        if (!Number.isInteger(targetIndex) || targetIndex < 0) {
            const err = makeErr('invariant_violated', {
                sessionId: id, contentId, op: 'goTo',
                meta: { reason: 'index_not_integer', index: targetIndex },
            });
            return { ok: false, error: err };
        }
        if (total > 0 && targetIndex >= total) {
            const err = makeErr('invariant_violated', {
                sessionId: id, contentId, op: 'goTo',
                meta: { reason: 'index_out_of_range', index: targetIndex, total },
            });
            return { ok: false, error: err };
        }
        if (status !== 'ready' && status !== 'playing' && status !== 'paused') {
            return { ok: false, error: makeErr('invalid_transition', {
                sessionId: id, contentId, op: 'goTo',
                meta: { from: status, reason: 'goto_in_invalid_state' },
            }) };
        }
        // Si estábamos playing, pausamos audio antes de mover el índice
        // (la sesión se queda en ready post-goTo; el caller decide si play()).
        if (status === 'playing' && audio) {
            try { audio.pause(); } catch { /* ignore */ }
            const tErr = transition('paused', 'goTo');
            if (tErr) return { ok: false, error: tErr };
        }
        currentIndex = targetIndex;
        visualReady  = false;   // requiere nuevo report del viewer
        // Si quedamos en paused tras goTo desde playing, dejamos así. Si
        // venimos desde ready o paused, mantenemos. La transición a ready
        // tras goTo no es necesaria si ya estamos en ready/paused.
        publishSnapshot();
        diag('queue.done', { kind: 'goTo', source, index: targetIndex });
        return { ok: true, index: targetIndex, source };
    }

    /**
     * _audioEnded — el audio del index reportado terminó.
     *
     * Comportamiento M-3.3 (autoavance real, event-driven):
     *   - Si el index reportado NO coincide con currentIndex (stale event): no-op.
     *   - Si la sesión NO está playing: no-op.
     *   - Si index+1 === total: transición a 'paused' (session_completed).
     *   - Si index+1 < total: avanza currentIndex y arranca el clip siguiente
     *     INLINE (preflight + startPlayback). Mantiene status='playing' si OK.
     *     Si preflight/startPlayback falla, transition a 'error' con kind
     *     diferenciado (audio_unavailable / audio_autoplay_blocked / audio_contract_failed).
     *
     * Cero setTimeout. Cero recovery loops. Cero re-entry a la queue.
     * El siguiente audio.ended dispara otro audioEnded → ciclo continuo.
     */
    async function _audioEnded(eventIndex) {
        if (status === 'closed' || status === 'closing') {
            return { ok: true, reason: 'session_closed' };
        }
        if (eventIndex !== currentIndex) {
            return { ok: true, reason: 'stale_index', meta: { eventIndex, currentIndex } };
        }
        if (status !== 'playing') {
            return { ok: true, reason: 'not_playing' };
        }
        if (total > 0 && currentIndex + 1 >= total) {
            const tErr = transition('paused', 'audioEnded');
            if (tErr) return { ok: false, error: tErr };
            diag('autoplay.next', { advancedTo: currentIndex, reason: 'session_completed' });
            return { ok: true, reason: 'session_completed' };
        }

        // Avance + auto-play del siguiente clip.
        currentIndex = currentIndex + 1;
        visualReady  = false;
        publishSnapshot();
        diag('autoplay.next', { advancedTo: currentIndex });

        const captured = token;

        if (audio) {
            // Preflight del nuevo clip.
            const pre = await audio.preflight(sessionRef, currentIndex);
            // Tras await: validar que seguimos vivos en la misma sesión.
            if (!isLive(captured)) {
                diag('autoplay.abort', { index: currentIndex, reason: 'stale_after_preflight' });
                return { ok: false, error: makeErr('aborted', {
                    sessionId: id, contentId, op: 'audioEnded.preflight',
                }) };
            }
            if (!pre.ok) {
                const err = makeErr('audio_unavailable', {
                    sessionId: id, contentId, index: currentIndex, op: 'audioEnded',
                    meta: { reason: pre.reason },
                });
                lastError = err;
                transition('error', 'audioEnded');
                diag('autoplay.abort', { index: currentIndex, reason: 'preflight_failed' });
                return { ok: false, error: err };
            }
            // startPlayback del nuevo clip.
            const start = await audio.startPlayback(sessionRef, currentIndex, pre.src);
            if (!isLive(captured)) {
                diag('autoplay.abort', { index: currentIndex, reason: 'stale_after_startPlayback' });
                return { ok: false, error: makeErr('aborted', {
                    sessionId: id, contentId, op: 'audioEnded.startPlayback',
                }) };
            }
            if (!start.ok) {
                const kind = start.reason === 'autoplay_blocked'
                    ? 'audio_autoplay_blocked'
                    : 'audio_contract_failed';
                // Sprint M-4.3 — propagar meta enriquecido.
                const err = makeErr(kind, {
                    sessionId: id, contentId, index: currentIndex, op: 'audioEnded',
                    meta: {
                        reason: start.reason,
                        ...(start.meta || {}),
                    },
                });
                lastError = err;
                transition('error', 'audioEnded');
                diag('autoplay.abort', { index: currentIndex, reason: start.reason });
                return { ok: false, error: err };
            }
        }
        // status sigue 'playing' — no transition needed.
        return { ok: true, reason: 'advanced_and_played', index: currentIndex };
    }

    /**
     * _audioFailed — el HTMLMediaElement reportó error durante decodificación
     * o reproducción. Diferente de play() reject (eso es audio_contract_failed
     * o audio_autoplay_blocked). Aquí el audio empezó pero falló mid-flight
     * o post-canplay.
     *
     * Sprint M-3.3 — mapeo de reason a kind diferenciado:
     *   - 'decode_failed'      → kind='audio_decode_failed'
     *   - cualquier otro       → kind='audio_failed'
     *
     * El integrator pasa reason traducido por mediaErrorToReason() del
     * audioAdapter (audio.error.code → reason).
     *
     * Comportamiento: dejar lastError + transition('error'). El viewer puede
     * decidir si reanudar manualmente o cerrar.
     */
    async function _audioFailed(eventIndex, reason) {
        if (status === 'closed' || status === 'closing') {
            return { ok: true, reason: 'session_closed' };
        }
        if (eventIndex !== currentIndex) {
            return { ok: true, reason: 'stale_index' };
        }
        const kind = reason === 'decode_failed'
            ? 'audio_decode_failed'
            : 'audio_failed';
        const err = makeErr(kind, {
            sessionId: id, contentId, index: currentIndex, op: 'audioFailed',
            meta: { reason: reason ?? 'unknown' },
        });
        lastError = err;
        if (status === 'playing' || status === 'paused' || status === 'ready') {
            transition('error', 'audioFailed');
        } else {
            publishSnapshot();
        }
        diag('decode.fail', { index: currentIndex, reason: reason ?? 'unknown', kind });
        return { ok: false, error: err };
    }

    async function _close(reason) {
        if (status === 'closed') return { ok: true, reason: 'already_closed' };
        if (status === 'closing') return { ok: true, reason: 'already_closing' };
        // Bumpeamos token PRIMERO para invalidar cualquier callback async
        // que esté en flight. Luego transitamos.
        token = token + 1;

        // Transición → closing. Allowed desde cualquier estado activo.
        const allowed = TRANSITIONS[status];
        if (!allowed || !allowed.has('closing')) {
            // Force closing igual — closing es estado terminal y debe poder
            // alcanzarse desde error (TRANSITIONS lo permite).
            // Solo loggeamos.
            diag('state.transition', { from: status, to: 'closing', allowed: false, op: 'close', forced: true });
        }
        status = 'closing';
        publishSnapshot();
        diag('state.transition', { from: 'closing-marker', to: 'closing', allowed: true, op: 'close', reason });

        // Liberar recursos.
        if (visibility) {
            try { visibility.cancelForSession(id); } catch { /* ignore */ }
        }
        if (audio) {
            try { audio.releaseFor(sessionRef); } catch { /* ignore */ }
        }
        if (progress) {
            try { progress.flushPending(sessionRef); } catch { /* ignore */ }
            try { progress.releaseFor(sessionRef); } catch { /* ignore */ }
        }
        status = 'closed';
        publishSnapshot();
        diag('session.closed', { reason });

        // Drenar queue restante.
        drainAsAborted();
        return { ok: true };
    }

    // ── Public API ─────────────────────────────────────────────────────────

    function play()   { return enqueueOperation({ kind: 'play'   }); }
    function pause()  { return enqueueOperation({ kind: 'pause'  }); }
    function resume() { return enqueueOperation({ kind: 'resume' }); }
    function goTo(index, source) {
        return enqueueOperation({ kind: 'goTo', index, source });
    }
    function close(reason) {
        return enqueueOperation({ kind: 'close', reason });
    }

    /**
     * forceClose — Sprint M-3.2. Cierra la sesión INMEDIATAMENTE sin pasar
     * por la OperationQueue. Necesario cuando una operación en flight (típico:
     * `await audio.startPlayback`) queda colgada por autoplay policy o red
     * lenta y el viewer necesita unmount sin esperar.
     *
     * Diferencias con close() vía queue:
     *   - NO espera a que la operación actual termine.
     *   - Bumpea token PRIMERO → cualquier callback async pendiente que
     *     verifique `assertLive` o `isLive` aborta limpio.
     *   - Drena la queue inmediatamente como aborted.
     *   - Sincrónico hasta status='closed' (los releaseFor de subsystems
     *     son sincrónicos en el contrato actual; si futuro alguno fuera
     *     async, este método NO los espera).
     *
     * Idempotente. Devuelve OpResult-like.
     */
    function forceClose(reason) {
        if (status === 'closed') return { ok: true, reason: 'already_closed' };
        // Bump token FIRST.
        token = token + 1;
        const previousStatus = status;
        status = 'closing';
        publishSnapshot();
        diag('state.transition', { from: previousStatus, to: 'closing', allowed: true, op: 'forceClose', reason });

        if (visibility) {
            try { visibility.cancelForSession(id); } catch { /* ignore */ }
        }
        if (audio) {
            try { audio.releaseFor(sessionRef); } catch { /* ignore */ }
        }
        if (progress) {
            try { progress.flushPending(sessionRef); } catch { /* ignore */ }
            try { progress.releaseFor(sessionRef); } catch { /* ignore */ }
        }
        status = 'closed';
        publishSnapshot();
        diag('session.closed', { reason: reason ?? 'forceClose', forced: true });

        // Drenar queue restante como aborted. Cualquier op en flight que
        // estaba awaiting será resuelta/rejeada por el processQueue cuando
        // termine su await; assertLive/isLive devolverán stale para token
        // viejo y harán que la op no mute estado.
        drainAsAborted();
        return { ok: true, reason: 'forced' };
    }

    function setVisualReady(value) {
        visualReady = !!value;
        publishSnapshot();
    }

    return Object.freeze({
        // identity
        id, contentId, userId,
        // state queries
        getStatus, getToken, getRef, getCurrentIndex, getTotal,
        // lifecycle
        open,
        play, pause, resume, goTo, close,
        forceClose,
        // queue
        enqueueOperation,
        // async safety
        assertLive, isLive,
        // viewer hooks
        setVisualReady,
    });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function makeErr(kind, fields = {}) {
    return Object.freeze({ kind, ...fields });
}

export { TRANSITIONS };
