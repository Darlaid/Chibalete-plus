/**
 * VisibilityCoordinator.mjs — Sprint Inmersivo V2 / Fase M-1.
 *
 * Coordina la confirmación visual del viewer. NO hace polling sobre el DOM.
 * El viewer es responsable de llamar reportFromViewer(sessionId, index, result)
 * cuando renderizó (o falló renderizar) un índice. Este coordinador mantiene
 * promesas pending y las resuelve/rechaza ante reportes coincidentes.
 *
 * Contrato anti-V1:
 *   - V1 hacía requestAnimationFrame loops + querySelector y rezaba que el
 *     DOM apareciera. Eso era frágil y no testeable. V2 invierte el flujo:
 *     el VIEWER reporta. El runtime espera. Si nadie reporta dentro del
 *     timeout → visibility_timeout (error explícito).
 *
 * sessionId-aware:
 *   - awaitConfirmation captura sessionId en la promesa.
 *   - reportFromViewer DESCARTA reportes de sesiones que ya cerraron
 *     (cancelForSession invalida pendings).
 *   - Si llega un report con sessionId mismatch a una pending, el report
 *     se ignora silenciosamente (lo registra diagnostics).
 *
 * Multi-pending por sesión:
 *   - Una sesión puede esperar visibility para varios índices simultáneos
 *     (raro pero posible). Cada awaitConfirmation tiene su propio key.
 */

const DEFAULT_TIMEOUT_MS = 5000;

export function createVisibilityCoordinator(opts = {}) {
    const defaultTimeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const diagnostics    = opts.diagnostics || null;
    /** sessionId → Map<index, { resolve, reject, timer, contentId }>. */
    const pending = new Map();

    function diag(kind, sessionId, contentId, data) {
        if (!diagnostics) return;
        diagnostics.log({ kind, sessionId, contentId, data });
    }

    /**
     * awaitConfirmation — devuelve una Promise que resuelve cuando llega
     * reportFromViewer(sessionId, index, {visible: true}), rechaza cuando
     * llega {visible: false} o cuando se cumple timeout.
     *
     * options:
     *   - timeoutMs: número (default: opts.timeoutMs o 5000)
     */
    function awaitConfirmation(session, index, options = {}) {
        const sessionId = session?.id ?? null;
        const contentId = session?.contentId ?? null;
        if (sessionId === null) {
            return Promise.reject(makeErr('visibility_contract_failed', { reason: 'no_session_id', index }));
        }
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : defaultTimeout;

        // Si ya existe un pending para (sessionId, index), lo cancelamos
        // (semántica "la última espera gana" — útil cuando el runtime
        // re-pide visibility tras un goTo).
        if (pending.has(sessionId) && pending.get(sessionId).has(index)) {
            cancelOne(sessionId, index, 'superseded');
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                // Cleanup INLINE — no usar cancelOne(), que rejectaría con
                // 'aborted' y dejaría a este reject como no-op silencioso.
                // El timeout debe rejectar con visibility_timeout específicamente.
                const map = pending.get(sessionId);
                if (map) {
                    map.delete(index);
                    if (map.size === 0) pending.delete(sessionId);
                }
                diag('visibility.timeout', sessionId, contentId, { index });
                reject(makeErr('visibility_timeout', { sessionId, contentId, index }));
            }, timeoutMs);

            if (!pending.has(sessionId)) pending.set(sessionId, new Map());
            pending.get(sessionId).set(index, {
                resolve, reject, timer, contentId,
            });
            diag('visibility.await', sessionId, contentId, { index, timeoutMs });
        });
    }

    /**
     * reportFromViewer — punto de entrada del viewer. Si hay una promesa
     * pending para (sessionId, index), se resuelve/rechaza según result.
     * Si no hay pending, el reporte se descarta (no es error — la sesión
     * puede ya haber avanzado).
     */
    function reportFromViewer(sessionId, index, result) {
        const map = pending.get(sessionId);
        if (!map) {
            diag('visibility.report', sessionId, null, { index, dropped: 'no_pending', result });
            return;
        }
        const slot = map.get(index);
        if (!slot) {
            diag('visibility.report', sessionId, null, { index, dropped: 'no_index_pending', result });
            return;
        }
        clearTimeout(slot.timer);
        map.delete(index);
        if (map.size === 0) pending.delete(sessionId);

        diag('visibility.report', sessionId, slot.contentId, { index, result });

        if (result && result.visible === true) {
            slot.resolve({ visible: true });
        } else {
            slot.reject(makeErr('visibility_contract_failed', {
                sessionId, contentId: slot.contentId, index,
                reason: result?.reason ?? 'reported_invisible',
            }));
        }
    }

    /**
     * cancelForSession — invalida TODAS las pending visibilidades de la
     * sesión. Cada una rechaza con visibility_contract_failed/aborted.
     * Usado por closeSession.
     */
    function cancelForSession(sessionId) {
        const map = pending.get(sessionId);
        if (!map) return;
        for (const [index, slot] of map.entries()) {
            clearTimeout(slot.timer);
            slot.reject(makeErr('aborted', {
                sessionId, contentId: slot.contentId, index,
                reason: 'session_cancelled',
            }));
            diag('visibility.cancelled', sessionId, slot.contentId, { index });
        }
        pending.delete(sessionId);
    }

    /**
     * cancelAll — invalida TODAS las pending de TODAS las sesiones.
     * Sprint M-2 audit / fix F4: usado por runtime.destroy() para garantizar
     * que ningún timer queda vivo después de destruir el runtime, incluso
     * si alguna pending quedó huérfana de una sesión que nunca se cerró.
     */
    function cancelAll(reason) {
        const sessionIds = [...pending.keys()];
        for (const sid of sessionIds) {
            cancelForSession(sid);
        }
    }

    function cancelOne(sessionId, index, reason) {
        const map = pending.get(sessionId);
        if (!map) return;
        const slot = map.get(index);
        if (!slot) return;
        clearTimeout(slot.timer);
        map.delete(index);
        if (map.size === 0) pending.delete(sessionId);
        slot.reject(makeErr('aborted', {
            sessionId, contentId: slot.contentId, index, reason,
        }));
    }

    /** Para tests: cuántos pendientes hay (debug). */
    function _pendingCount() {
        let total = 0;
        for (const map of pending.values()) total += map.size;
        return total;
    }

    return Object.freeze({
        awaitConfirmation,
        reportFromViewer,
        cancelForSession,
        cancelAll,
        _pendingCount,
    });
}

function makeErr(kind, fields) {
    return Object.freeze({ kind, ...fields });
}
