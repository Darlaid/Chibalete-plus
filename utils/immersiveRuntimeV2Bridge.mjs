/**
 * immersiveRuntimeV2Bridge.mjs — Sprint Inmersivo V2 / Fase M-2.
 *
 * Bridge entre el viewer React (pages/VisorInmersivoV2.tsx) y el Runtime V2
 * (engines/ImmersiveRuntime.mjs). TODA la lógica de orchestration vive
 * aquí — el componente React queda como render layer puro, sin gobernar
 * audio, sesión, progreso, ni recovery.
 *
 * Razón arquitectónica:
 *   - Permite tests REALES con node directo (no requiere DOM/jsdom/vitest).
 *   - Permite que el viewer React sea testeado por inspección estructural
 *     (no-imports prohibidos) — el "qué hace el viewer" se valida por la
 *     suite del bridge, que es 1:1 con el wire-up del componente.
 *   - Sostiene la regla M-1: React no gobierna nada; aquí tampoco hay React.
 *
 * Lo que el bridge HACE:
 *   - createViewerRuntime() — wrap de createImmersiveRuntime con factories
 *     inyectables (audio, src resolver, hydrate, commit progreso).
 *   - Helpers de dispatch wrap (play/pause/resume/prev/next) que validan
 *     argumentos y delegan a runtime.dispatch.
 *   - reportVisible / reportInvisible: wraps sessionId-aware sobre
 *     runtime.reportVisibility, con guards anti-stale antes de delegar.
 *
 * Lo que el bridge NO HACE:
 *   - NO crea audio. Solo le pasa al runtime el factory.
 *   - NO carga contenido. Solo le pasa al runtime el hydrateContent.
 *   - NO mantiene estado propio. El estado vive en el RuntimeStore.
 *   - NO conoce React. Cero imports de react/react-dom.
 */

import { createImmersiveRuntime } from '../engines/ImmersiveRuntime.mjs';

// ════════════════════════════════════════════════════════════════════════════
// Factory principal
// ════════════════════════════════════════════════════════════════════════════

/**
 * createViewerRuntime — devuelve un ImmersiveRuntime configurado para el
 * viewer V2. Todos los hooks externos (audio, contenido, src, commit) son
 * inyectables — en producción los provee el viewer leyendo dataService;
 * en tests, fakes controlados.
 *
 * opts:
 *   - hydrateContent({contentId}) → Promise<{ totalIndices }>
 *   - audioFactory({container, sessionId, index, src}) → AudioLike
 *   - resolveSrc({session, index}) → Promise<string|null>|string|null
 *   - commitProgress({sessionId, contentId, userId, index}) → void
 *   - visibilityTimeoutMs?: number (default 5000)
 *   - idPrefix?: string  (default 'v2')
 */
export function createViewerRuntime(opts = {}) {
    const runtime = createImmersiveRuntime({
        hydrateContent:      opts.hydrateContent,
        visibilityTimeoutMs: opts.visibilityTimeoutMs,
        idPrefix:            opts.idPrefix ?? 'v2',
        // Subsistemas: el runtime crea defaults internamente, pero le
        // pasamos los configs que el viewer necesita.
        audio:               opts.audio,
        visibility:          opts.visibility,
        progress:            opts.progress,
        store:               opts.store,
        diagnostics:         opts.diagnostics,
    });
    return runtime;
}

// ════════════════════════════════════════════════════════════════════════════
// Dispatch helpers
// ════════════════════════════════════════════════════════════════════════════
//
// Wrapper minimalista sobre runtime.dispatch. Cada helper:
//   - valida argumentos antes de dispatch (catching errores de programación).
//   - devuelve la misma Promise que dispatch — el viewer puede await si quiere
//     reaccionar al outcome (típicamente lo ignora).
//   - NO mantiene estado propio.
// ────────────────────────────────────────────────────────────────────────────

export function dispatchPlay(runtime) {
    return runtime.dispatch({ kind: 'play' });
}

export function dispatchPause(runtime) {
    return runtime.dispatch({ kind: 'pause' });
}

export function dispatchResume(runtime) {
    return runtime.dispatch({ kind: 'resume' });
}

/**
 * dispatchGoTo — delega a runtime.dispatch goTo. `source` debe ser uno de
 * 'manual' | 'auto' | 'recovery'. El viewer típicamente usa 'manual' para
 * clicks de UI; 'auto' lo usaría un autoplay que NO existe en V2 hoy;
 * 'recovery' está reservado para el runtime mismo (no debería venir del
 * viewer).
 */
export function dispatchGoTo(runtime, index, source = 'manual') {
    if (!Number.isInteger(index)) {
        return Promise.resolve({
            ok: false,
            error: { kind: 'invariant_violated', op: 'dispatchGoTo', meta: { reason: 'index_not_integer', index } },
        });
    }
    return runtime.dispatch({ kind: 'goTo', index, source });
}

/**
 * dispatchPrev / dispatchNext — wrappers semánticos para los botones de
 * navegación del viewer. Calculan el target a partir del snapshot actual.
 * Saturan en bordes (no van a -1 ni a >= total).
 */
export function dispatchPrev(runtime) {
    const snap = runtime.getSnapshot();
    const target = Math.max(0, snap.currentIndex - 1);
    if (target === snap.currentIndex) {
        return Promise.resolve({ ok: true, reason: 'at_start' });
    }
    return dispatchGoTo(runtime, target, 'manual');
}

export function dispatchNext(runtime) {
    const snap = runtime.getSnapshot();
    const total = snap.totalIndices;
    const target = total > 0
        ? Math.min(total - 1, snap.currentIndex + 1)
        : snap.currentIndex + 1;
    if (target === snap.currentIndex && total > 0) {
        return Promise.resolve({ ok: true, reason: 'at_end' });
    }
    return dispatchGoTo(runtime, target, 'manual');
}

// ════════════════════════════════════════════════════════════════════════════
// Visibility report wrappers
// ════════════════════════════════════════════════════════════════════════════
//
// Anti-stale guards: ANTES de delegar a runtime.reportVisibility, validamos
// que (sessionId, index) sigan siendo coherentes con el snapshot actual.
// Esto es defensa-en-profundidad — el runtime también descarta reportes
// huérfanos, pero filtrar aquí ahorra una entrada de diagnostics y
// documenta semánticamente qué espera el viewer.
//
// El viewer DEBE pasar el sessionId que VIO al renderizar (capturado al
// momento del useLayoutEffect), no el snapshot actual — si difieren, el
// reporte se descarta porque la sesión rotó entre render y commit.
// ────────────────────────────────────────────────────────────────────────────

/**
 * reportVisible — el viewer reporta que renderizó (visible al usuario)
 * el `index` de la sesión `sessionId`.
 *
 * Reglas:
 *   - sessionId debe coincidir con runtime.getSnapshot().sessionId.
 *     Si no coincide → descarta (la sesión cambió desde el render).
 *   - index debe estar en rango [0, totalIndices). Si totalIndices=0,
 *     se permite cualquier index ≥ 0 (totalIndices todavía no hidratado).
 *   - NO hay re-intento. NO hay timer. NO hay polling.
 */
export function reportVisible(runtime, sessionId, index) {
    const snap = runtime.getSnapshot();
    if (snap.sessionId !== sessionId) {
        // Stale: la sesión rotó. Descartar silenciosamente.
        return { dispatched: false, reason: 'stale_session' };
    }
    if (!Number.isInteger(index) || index < 0) {
        return { dispatched: false, reason: 'invalid_index' };
    }
    if (snap.totalIndices > 0 && index >= snap.totalIndices) {
        return { dispatched: false, reason: 'out_of_range' };
    }
    runtime.reportVisibility(sessionId, index, { visible: true });
    return { dispatched: true };
}

/**
 * reportInvisible — el viewer no pudo renderizar el índice (e.g., el DOM
 * no contenía el span esperado). El runtime lo trata como
 * visibility_contract_failed para esa pending si la hubiera.
 */
export function reportInvisible(runtime, sessionId, index, reason) {
    const snap = runtime.getSnapshot();
    if (snap.sessionId !== sessionId) {
        return { dispatched: false, reason: 'stale_session' };
    }
    if (!Number.isInteger(index) || index < 0) {
        return { dispatched: false, reason: 'invalid_index' };
    }
    runtime.reportVisibility(sessionId, index, {
        visible: false,
        reason: typeof reason === 'string' && reason.length > 0 ? reason : 'viewer_reported_invisible',
    });
    return { dispatched: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Lifecycle helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * openContent — wrapper sobre runtime.openSession con shape simplificado
 * para el viewer. Devuelve { ok, sessionId?, error? }. Si ok=true, el
 * viewer guarda sessionId en una ref y lo usa para futuros reportVisible.
 */
export async function openContent(runtime, { contentId, userId, startIndex, totalIndices }) {
    const result = await runtime.openSession({
        contentId, userId, startIndex, totalIndices,
    });
    if (!result.ok) {
        return { ok: false, error: result.error };
    }
    return { ok: true, sessionId: result.session.id };
}

/**
 * closeActive — cierra la sesión activa, si la hay. Idempotente.
 * El viewer la llama en cleanup del useEffect.
 */
export async function closeActive(runtime, reason) {
    return runtime.closeSession(reason);
}
