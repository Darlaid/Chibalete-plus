/**
 * ProgressRuntime.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Política de persistencia de progreso. Recibe schedule(session, index)
 * desde la sesión cada vez que un índice termina su lifecycle (visual
 * confirmado + audio completado). Decide si guardar y agenda el flush
 * a través del `commit` callback inyectado.
 *
 * Política M-1 (mínima):
 *   - canSave(session, index) devuelve true SOLO si:
 *       a) el visual del índice ha sido confirmado por el viewer, Y
 *       b) el audio del índice no falló (audioRuntime.isFailedFor=false)
 *   - schedule(session, index) verifica canSave() y, si pasa, lo encola
 *     y eventualmente llama commit({sessionId, contentId, userId, index}).
 *   - flushPending(session) fuerza commit inmediato de todo lo encolado
 *     para esa sesión (usado por close).
 *
 * Las decisiones de "completed" semántico (¿visual confirmado? ¿audio
 * terminado?) se delegan al caller — la sesión sabe el ciclo completo.
 * ProgressRuntime es un sink con cola, NO un classifier.
 */

export function createProgressRuntime(opts = {}) {
    const commit       = typeof opts.commit === 'function' ? opts.commit : null;
    const policy       = opts.policy || {};
    const audioRuntime = opts.audioRuntime || null;
    const diagnostics  = opts.diagnostics  || null;

    /** sessionId → Set<index>. Encolado pendiente de commit. */
    const queued = new Map();
    /** sessionId → Set<index>. Conjunto de visuales confirmados. */
    const visualConfirmed = new Map();
    /** sessionId → metadata { contentId, userId } para reconstruir el commit payload. */
    const sessionMeta = new Map();

    function diag(kind, sessionId, contentId, data) {
        if (!diagnostics) return;
        diagnostics.log({ kind, sessionId, contentId, data });
    }

    /**
     * Registra metadata de la sesión — debe llamarse una vez al openSession.
     * Sin esto, schedule no puede saber qué userId pasar al commit.
     */
    function registerSession(session) {
        const sessionId = session?.id ?? null;
        if (sessionId === null) return;
        sessionMeta.set(sessionId, {
            contentId: session.contentId,
            userId:    session.userId,
        });
    }

    /** El viewer (o la sesión) marca visual_commit_ack para un índice. */
    function markVisualConfirmed(session, index) {
        const sessionId = session?.id ?? null;
        if (sessionId === null) return;
        if (!visualConfirmed.has(sessionId)) visualConfirmed.set(sessionId, new Set());
        visualConfirmed.get(sessionId).add(index);
    }

    /**
     * canSave — evalúa los gates de persistencia. Hooks externos:
     *   - policy.minIndex (default 0)
     *   - policy.requireVisualConfirmed (default true)
     *   - audioRuntime.isFailedFor → bloquea si falló
     */
    function canSave(session, index) {
        const sessionId = session?.id ?? null;
        if (sessionId === null) return false;
        const minIndex = Number.isFinite(policy.minIndex) ? policy.minIndex : 0;
        if (index < minIndex) return false;

        const requireVis = policy.requireVisualConfirmed !== false;
        if (requireVis) {
            const set = visualConfirmed.get(sessionId);
            if (!set || !set.has(index)) return false;
        }

        if (audioRuntime && typeof audioRuntime.isFailedFor === 'function') {
            if (audioRuntime.isFailedFor({ id: sessionId, contentId: session.contentId }, index)) {
                return false;
            }
        }
        return true;
    }

    /**
     * schedule — si pasa canSave, encola y commitea. M-1: commit síncrono;
     * fases futuras pueden bufferear y debounce.
     */
    function schedule(session, index) {
        const sessionId = session?.id ?? null;
        const contentId = session?.contentId ?? null;
        if (sessionId === null) return { scheduled: false, reason: 'no_session' };
        if (!canSave(session, index)) {
            diag('progress.skipped', sessionId, contentId, { index, reason: 'gate_failed' });
            return { scheduled: false, reason: 'gate_failed' };
        }
        if (!queued.has(sessionId)) queued.set(sessionId, new Set());
        queued.get(sessionId).add(index);
        diag('progress.scheduled', sessionId, contentId, { index });

        if (commit) {
            try {
                const meta = sessionMeta.get(sessionId) || {};
                commit({
                    sessionId,
                    contentId: meta.contentId ?? contentId,
                    userId:    meta.userId,
                    index,
                });
                queued.get(sessionId).delete(index);
                if (queued.get(sessionId).size === 0) queued.delete(sessionId);
                diag('progress.flushed', sessionId, contentId, { index });
            } catch (err) {
                // Commit falló → lo dejamos encolado para flushPending.
                diag('progress.skipped', sessionId, contentId, { index, reason: 'commit_throw' });
            }
        }
        return { scheduled: true };
    }

    /**
     * flushPending — vacía la cola para la sesión. Idempotente. Usado en
     * close. NO valida canSave — asume que ya pasó (o que el caller quiere
     * commit best-effort de lo que quede).
     */
    function flushPending(session) {
        const sessionId = session?.id ?? null;
        if (sessionId === null) return { flushed: 0 };
        const set = queued.get(sessionId);
        if (!set || set.size === 0) return { flushed: 0 };
        let flushed = 0;
        if (commit) {
            const meta = sessionMeta.get(sessionId) || {};
            for (const index of [...set]) {
                try {
                    commit({
                        sessionId,
                        contentId: meta.contentId,
                        userId:    meta.userId,
                        index,
                    });
                    set.delete(index);
                    flushed++;
                    diag('progress.flushed', sessionId, meta.contentId ?? null, { index, flushAll: true });
                } catch {
                    // Si commit falla en flush, lo dejamos en la cola — el
                    // caller decide qué hacer (close suele aceptar pérdida).
                }
            }
        }
        if (set.size === 0) queued.delete(sessionId);
        return { flushed };
    }

    function releaseFor(session) {
        const sessionId = session?.id ?? null;
        if (sessionId === null) return;
        queued.delete(sessionId);
        visualConfirmed.delete(sessionId);
        sessionMeta.delete(sessionId);
    }

    function _state() {
        return {
            queuedCount: [...queued.values()].reduce((acc, s) => acc + s.size, 0),
            visualCount: [...visualConfirmed.values()].reduce((acc, s) => acc + s.size, 0),
        };
    }

    return Object.freeze({
        registerSession,
        markVisualConfirmed,
        canSave,
        schedule,
        flushPending,
        releaseFor,
        _state,
    });
}
