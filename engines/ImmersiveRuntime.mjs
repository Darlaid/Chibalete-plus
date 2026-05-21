/**
 * ImmersiveRuntime.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Orquestador top-level del runtime V2. Es la ÚNICA API pública que el
 * viewer (React M-2) consume. Responsabilidades:
 *
 *   - openSession(args)   — abre una sesión nueva, cierra atómicamente la
 *                           anterior si la hubiera. Resuelve a {ok, session}
 *                           o {ok:false, error}.
 *   - closeSession(reason) — cierra la sesión activa y libera recursos.
 *   - dispatch(action)    — encola play/pause/resume/goTo en la sesión activa.
 *                           Si no hay sesión, devuelve error explícito.
 *   - reportVisibility(sessionId, index, result) — el viewer reporta
 *                           visibilidad. sessionId-aware: reportes de
 *                           sesiones viejas se descartan.
 *   - subscribe(listener) — listener de snapshots.
 *   - getSnapshot()       — snapshot inmutable actual.
 *   - diagnostics.exportTrace(sessionId) — exporta el timeline de la sesión.
 *
 * Reglas absolutas:
 *   - Una sola sesión activa a la vez. openSession cierra la anterior antes
 *     de abrir la nueva.
 *   - NO mantiene hardResync público. NO polling. NO React.
 *   - El lifecycleToken se monotonic-incrementea por cada openSession.
 *   - El runtime tiene su propio sessionIdCounter atómico.
 */

import { createDiagnostics }          from './Diagnostics.mjs';
import { createRuntimeStore }         from './RuntimeStore.mjs';
import { createAudioRuntime }         from './AudioRuntime.mjs';
import { createVisibilityCoordinator } from './VisibilityCoordinator.mjs';
import { createProgressRuntime }      from './ProgressRuntime.mjs';
import { createImmersiveSession }     from './ImmersiveSession.mjs';

export function createImmersiveRuntime(opts = {}) {
    const diagnostics = opts.diagnostics ?? createDiagnostics();
    const store       = opts.store       ?? createRuntimeStore();
    const audio       = opts.audio       ?? createAudioRuntime({ diagnostics });
    const visibility  = opts.visibility  ?? createVisibilityCoordinator({ diagnostics, timeoutMs: opts.visibilityTimeoutMs });
    const progress    = opts.progress    ?? createProgressRuntime({ diagnostics, audioRuntime: audio });
    const hydrateContent = opts.hydrateContent;
    const idPrefix     = opts.idPrefix     ?? 's';

    /** Estado del orquestador. */
    let activeSession = null;
    /** Counter monotonic para tokens cross-session. */
    let nextToken     = 1;
    /** Counter para sessionIds — combinado con prefix + timestamp da unicidad. */
    let sessionCounter = 0;
    /**
     * openLock — promise-chain serializado para openSession y closeSession.
     *
     * Sprint M-2 audit / fix F1: la versión anterior usaba
     * `while (opening) await microtask()` como busy-loop. Eso causaba
     * STARVATION del event loop: dos `openSession` concurrentes generaban
     * microtasks infinitas que NUNCA cedían el control a las macrotasks
     * (setTimeout de hydratación, timers de visibility), produciendo un
     * deadlock observable cuando hydrateContent contiene un timer.
     *
     * El reemplazo es una cadena de promesas: cada operación que serializa
     * `await openLock` (esperando a la anterior), luego setea `openLock`
     * a su propia promesa para la siguiente operación. Cero busy-loop,
     * sin starvation. La cadena puede crecer indefinidamente, pero como
     * cada slot resuelve, GC libera los anteriores.
     *
     * Razón de incluir closeSession en la misma cadena: si cleanup llama
     * closeSession mientras openSession sigue en flight (caso real del
     * viewer en StrictMode o navegación rápida), closeSession debe esperar
     * a que openSession asigne `activeSession` para poder cerrarla — sin
     * eso, closeSession ve `null`, retorna no-op, y la sesión recién abierta
     * queda viva sin owner.
     */
    let openLock = Promise.resolve();

    /** Toma el lock; devuelve un release() que hay que llamar para liberarlo. */
    function acquireLock() {
        const previous = openLock;
        let release;
        openLock = new Promise((r) => { release = r; });
        return previous.then(() => release);
    }

    /**
     * Sprint M-2 audit / fix F11: añadimos un random suffix por runtime
     * instance. Sin esto, dos runtimes coexistentes (StrictMode dev,
     * múltiples viewers paralelos hipotéticos) podían generar el mismo
     * sessionId si openSession ocurría en el mismo ms con sessionCounter=1.
     * El random hace virtualmente imposible colisión cross-runtime.
     */
    const runtimeNonce = Math.random().toString(36).slice(2, 8);
    function generateSessionId() {
        sessionCounter++;
        return `${idPrefix}_${Date.now().toString(36)}_${runtimeNonce}_${sessionCounter}`;
    }

    function getSnapshot() {
        return store.getSnapshot();
    }

    function subscribe(listener) {
        return store.subscribe(listener);
    }

    /**
     * openSession — cierra la anterior si existe, crea nueva con token++.
     * Async. Resuelve a {ok, session?} o {ok:false, error}.
     *
     * Si openSession se llama mientras otro openSession está en curso, el
     * segundo espera al primero (serialización implícita vía `opening` flag).
     */
    async function openSession(args) {
        if (!args || typeof args.contentId !== 'string' || typeof args.userId !== 'string') {
            return { ok: false, error: makeErr('invariant_violated', {
                op: 'openSession', meta: { reason: 'invalid_args' },
            }) };
        }
        // Serialización via promise-chain (fix F1): SIN busy-loop, SIN
        // starvation. La promesa anterior debe resolver antes que esta
        // continúe, pero entre operaciones el event loop procesa macrotasks
        // (timers, I/O) normalmente.
        const release = await acquireLock();
        try {
            if (destroyed) {
                return { ok: false, error: makeErr('aborted', {
                    op: 'openSession', meta: { reason: 'runtime_destroyed' },
                }) };
            }
            // Cerrar sesión anterior si existe.
            if (activeSession) {
                try {
                    await activeSession.close('superseded_by_open');
                } catch { /* ignore */ }
                activeSession = null;
            }
            const sessionId = generateSessionId();
            const token = nextToken++;
            const session = createImmersiveSession({
                id: sessionId,
                contentId: args.contentId,
                userId:    args.userId,
                lifecycleToken: token,
                startIndex:     args.startIndex,
                totalIndices:   args.totalIndices,
                audio, visibility, progress, store, diagnostics,
                hydrateContent,
                visibilityTimeoutMs: opts.visibilityTimeoutMs,
            });
            activeSession = session;
            // Registrar metadata en progress.
            progress.registerSession({
                id: sessionId,
                contentId: args.contentId,
                userId:    args.userId,
            });
            diagnostics.log({
                sessionId, contentId: args.contentId,
                kind: 'session.opened',
                data: { startIndex: args.startIndex ?? 0, totalIndices: args.totalIndices ?? 0 },
            });
            const result = await session.open();
            if (!result.ok) {
                // open falló — la sesión está en 'error'. La dejamos
                // accesible para que el caller la cierre explícitamente.
                return { ok: false, error: result.error, session };
            }
            return { ok: true, session };
        } finally {
            release();
        }
    }

    async function closeSession(reason) {
        // Serializar también via openLock (fix F1/F2): si hay un openSession
        // en flight, esperar a que asigne activeSession y luego cerrar la
        // sesión recién creada. Sin esto, closeSession podría ver activeSession
        // === null y retornar early, dejando la sesión recién abierta huérfana.
        const release = await acquireLock();
        try {
            if (!activeSession) {
                return { ok: true, reason: 'no_active_session' };
            }
            const s = activeSession;
            const result = await s.close(reason ?? 'requested');
            // Si activeSession sigue siendo la misma referencia, la nulificamos.
            if (activeSession === s) activeSession = null;
            return result;
        } finally {
            release();
        }
    }

    /**
     * forceClose — Sprint M-3.2. Cierra la sesión activa SIN esperar al
     * openLock ni a operaciones colgadas en la queue. Útil cuando audio
     * está bloqueado (autoplay policy, red lenta) y el viewer necesita
     * cerrar la sesión inmediatamente para unmount o navegar.
     *
     * Diferencias con closeSession:
     *   - NO acquireLock(): no espera al openSession en flight (toma el
     *     hit de race conditions documentado abajo).
     *   - Llama session.forceClose() (síncrono) en vez de session.close()
     *     (que enqueue).
     *
     * Race con openSession en flight: si openSession está hidratando,
     * activeSession ya está asignada. forceClose la cierra. Cuando
     * openSession completa el await session.open(), session.isLive()
     * retorna false (token bumpeado por forceClose), open() retorna
     * aborted. activeSession queda como la sesión cerrada — el caller
     * de openSession ve {ok:false, error:aborted}. Subsiguientes
     * openSessions cierran la actual (closed-no-op) y abren nueva.
     */
    function forceClose(reason) {
        if (!activeSession) {
            return { ok: true, reason: 'no_active_session' };
        }
        const s = activeSession;
        const result = s.forceClose(reason ?? 'force_requested');
        if (activeSession === s) activeSession = null;
        return result;
    }

    /**
     * recoverFromError — Sprint M-3.4. Sale del estado terminal `error` sin
     * que el viewer tenga que orquestar `forceClose + openSession` manualmente.
     *
     * Contrato:
     *   - Si runtime destroyed → {ok:false, error: aborted}.
     *   - Si NO hay activeSession → {ok:false, error: invariant_violated}.
     *   - Si activeSession.status !== 'error' → {ok:true, reason:'no_error_to_recover'} (no-op).
     *   - Caso happy:
     *       a) Captura ref (contentId, userId), idx (preserveIndex ? current : 0)
     *          y total (totalIndices) ANTES de cerrar.
     *       b) forceClose() la sesión errada → bumpea token, cancela visibility,
     *          libera audio. Cualquier callback async stale aborta limpio.
     *       c) openSession() con mismo contentId/userId. Si total > 0, lo
     *          pasamos como `totalIndices` para que la nueva sesión arranque
     *          con ese valor; hydrateContent puede sobreescribirlo si difiere.
     *
     * NOTA hydration: openSession siempre invoca hydrateContent. Si el caller
     * quiere skip rehydration (optimización), se puede agregar opción en M-3.5+.
     */
    async function recoverFromError(opts = {}) {
        if (destroyed) {
            return { ok: false, error: makeErr('aborted', {
                op: 'recoverFromError', meta: { reason: 'runtime_destroyed' },
            }) };
        }
        if (!activeSession) {
            diagnostics.log({ kind: 'recover.skip', data: { reason: 'no_active_session' } });
            return { ok: false, error: makeErr('invariant_violated', {
                op: 'recoverFromError', meta: { reason: 'no_active_session' },
            }) };
        }
        if (activeSession.getStatus() !== 'error') {
            diagnostics.log({
                kind: 'recover.skip',
                sessionId: activeSession.id,
                data: { reason: 'not_in_error', status: activeSession.getStatus() },
            });
            return { ok: true, reason: 'no_error_to_recover' };
        }

        const session = activeSession;
        const ref = session.getRef();
        const total = session.getTotal();
        const idx = (opts.preserveIndex !== false)
            ? session.getCurrentIndex()
            : 0;

        diagnostics.log({
            kind: 'recover.start',
            sessionId: session.id, contentId: ref.contentId,
            data: { preserveIndex: opts.preserveIndex !== false, idx, total },
        });

        // Cierre forzoso de la sesión errada — sin esperar queue ni operations.
        try {
            session.forceClose('recover_from_error');
        } catch { /* ignore */ }
        if (activeSession === session) activeSession = null;

        // Abrir nueva sesión con el mismo contenido.
        const result = await openSession({
            contentId:    ref.contentId,
            userId:       ref.userId,
            startIndex:   idx,
            totalIndices: total > 0 ? total : undefined,
        });

        if (!result.ok) {
            diagnostics.log({
                kind: 'recover.fail',
                contentId: ref.contentId,
                data: { error: result.error },
            });
            return result;
        }
        diagnostics.log({
            kind: 'recover.done',
            sessionId: result.session.id, contentId: ref.contentId,
            data: { startIndex: idx },
        });
        return result;
    }

    /**
     * destroy — libera TODOS los recursos del runtime de forma idempotente.
     * Sprint M-2 audit / fix F2: necesario para casos donde el runtime
     * queda huérfano (StrictMode dev, navegación rápida) — sin destroy
     * los timers de visibility, los listeners del store, los blobs de audio
     * y el ring buffer de diagnostics quedaban vivos hasta GC.
     *
     * Idempotente: llamadas subsecuentes son no-op.
     * Tras destroy, openSession devuelve {ok:false, error:aborted}.
     */
    async function destroy(reason) {
        if (destroyed) return { ok: true, reason: 'already_destroyed' };
        destroyed = true;
        // Sprint M-3.2 — destroy usa forceClose para garantizar liberación
        // inmediata aunque haya operaciones colgadas. Antes usaba closeSession
        // (que via queue podía esperar a audio.startPlayback colgada).
        try {
            forceClose(reason ?? 'runtime_destroyed');
        } catch { /* ignore */ }
        // Limpiar subsistemas — orden: visibility (timers) → audio → store → diagnostics.
        try { visibility.cancelAll?.('runtime_destroyed'); } catch { /* ignore */ }
        try { audio.unmount(); } catch { /* ignore */ }
        // Sprint M-3.4 — notify=true: emite snapshot final (INITIAL_SNAPSHOT)
        // a los listeners ANTES de clear, para que binder/integrator vean
        // el cierre del runtime y liberen recursos.
        try { store.reset({ notify: true }); } catch { /* ignore */ }
        try { diagnostics.clear(); } catch { /* ignore */ }
        return { ok: true };
    }

    /** Flag de destroyed — bloquea openSession post-destroy. */
    let destroyed = false;

    /**
     * dispatch — delega la acción a la sesión activa. Sin sesión activa →
     * error explícito.
     */
    async function dispatch(action) {
        if (!activeSession) {
            return { ok: false, error: makeErr('invariant_violated', {
                op: 'dispatch', meta: { reason: 'no_active_session', action: action?.kind },
            }) };
        }
        return activeSession.enqueueOperation(action);
    }

    /**
     * reportVisibility — el viewer reporta. Si sessionId no coincide con
     * la sesión activa, se descarta (no error). El viewer puede reportar
     * para sesiones viejas si el unmount llegó tarde — eso es esperado.
     */
    function reportVisibility(sessionId, index, result) {
        // Pase el report al coordinator independientemente — el coordinator
        // mismo descarta reports sin pending. Esto permite que pending
        // creadas para sesiones ya cerradas (raro) se limpien.
        visibility.reportFromViewer(sessionId, index, result);

        // Adicionalmente: si la sesión activa coincide y el report es
        // visible:true, marcamos visualReady en la sesión.
        if (activeSession && activeSession.id === sessionId && result?.visible === true) {
            // Solo si el index reportado coincide con currentIndex.
            if (activeSession.getCurrentIndex() === index) {
                activeSession.setVisualReady(true);
                progress.markVisualConfirmed(activeSession.getRef(), index);
            }
        }
    }

    function getActiveSession() {
        return activeSession;
    }

    return Object.freeze({
        openSession,
        closeSession,
        forceClose,
        recoverFromError,
        destroy,
        dispatch,
        reportVisibility,
        subscribe,
        getSnapshot,
        getActiveSession,
        diagnostics: Object.freeze({
            exportTrace: (sessionId) => diagnostics.exportTrace(sessionId),
            getRecentEvents: (limit) => diagnostics.getRecentEvents(limit),
            log: (event) => diagnostics.log(event),
        }),
        // Hooks de subsistemas para tests (NO usar en producción del viewer):
        _internal: Object.freeze({ audio, visibility, progress, store, diagnostics }),
    });
}

function makeErr(kind, fields = {}) {
    return Object.freeze({ kind, ...fields });
}
