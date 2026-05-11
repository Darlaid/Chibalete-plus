/**
 * useBackboneReadingSession — hook base de telemetría de sesión para todos los modos.
 *
 * Sprint Data Backbone — Fase 2.
 *
 * Generaliza el patrón que estrenó useA11yAnalytics:
 *   - sessionId ULID por (userId × contentId × mode).
 *   - Emisión automática de session_start / session_heartbeat / session_end.
 *   - Buffer + flush periódico al endpoint backbone (POST /api/v1/events).
 *   - sendBeacon en cierre de pestaña / unmount.
 *   - Listeners pasivos de actividad (scroll/keydown/pointerdown/touchstart).
 *   - Heartbeat condicionado a pestaña visible y actividad reciente.
 *
 * Lo que NO hace:
 *   - No reemplaza useA11yAnalytics (a11y queda intacto en este sprint).
 *   - No toca endpoints legacy ni dataService.
 *   - No persiste eventos offline. Si /api/v1/events falla, fail silencioso.
 *
 * Diferencias frente a useA11yAnalytics:
 *   - mode parametrizado (no hardcodeado a 'a11y').
 *   - Sin IntersectionObserver — el cálculo de progreso lo aporta el caller
 *     vía getProgressFraction (cada modo ya tiene su lógica propia y madura).
 *   - emitEvent expuesto y prefijado automáticamente: `${mode}.${action}`.
 *
 * Uso típico:
 *
 *   const { emitEvent, markActivity } = useBackboneReadingSession({
 *       enabled: !loading && !!user?.id && !!text,
 *       userId: user?.id,
 *       contentId: content.id,
 *       mode: 'text',
 *       getProgressFraction: () => scrollPctRef.current / 100,
 *       getPayload: () => ({ source: 'VisorTexto', sentenceCount }),
 *   });
 */

import { useEffect, useRef, useCallback } from 'react';
import { ulid } from '../utils/clientUlid';

// ── Tipos ────────────────────────────────────────────────────────────────────

type ReaderMode = 'pdf' | 'text' | 'immersive' | 'album' | 'a11y' | 'lu';

interface BackboneEvent {
    eventId: string;
    schemaVersion: 1;
    event: string;
    mode: ReaderMode;
    userId: string;
    contentId: string | null;
    sessionId: string;
    clientTs: number;
    elapsedMs?: number;
    progressFraction?: number;
    payload?: Record<string, unknown>;
}

export interface UseBackboneReadingSessionConfig {
    /**
     * Cuando true, el hook gestiona la sesión activa. Cuando false → no-op
     * total (no emite, no abre listeners). Cambiar de true → false dispara
     * session_end de la sesión que estaba activa.
     */
    enabled: boolean;
    /** ID del usuario autenticado. Si es undefined o 'guest', el hook no emite. */
    userId: string | undefined;
    /** ID del contenido abierto. Cambiarlo reinicia la sesión. */
    contentId: string | undefined;
    /** Modo del visor que monta el hook. Define el prefijo de los eventos. */
    mode: ReaderMode;
    /** Getter de progreso en [0..1]. Llamado en cada heartbeat / end / emit. */
    getProgressFraction?: () => number;
    /** Getter de payload contextual. Llamado en session_start y session_end. */
    getPayload?: () => Record<string, unknown> | undefined;
    /** Default 15_000 ms. */
    heartbeatMs?: number;
    /** Default 20_000 ms. Si no hay actividad en este lapso, no emite heartbeat. */
    activityWindowMs?: number;
}

export interface UseBackboneReadingSessionApi {
    /**
     * ID de la sesión activa (ULID) o null si la sesión aún no inició.
     * Útil para correlacionar logs locales. Lectura sin reactividad.
     */
    sessionId: string | null;
    /**
     * Emite un evento adicional de la sesión activa. El nombre se prefija con
     * `${mode}.` automáticamente. Ej: emitEvent('progress', ...) →
     * `text.progress` cuando mode='text'.
     *
     * No-op si no hay sesión activa o si action no matchea /^[a-z][a-z0-9_]*$/.
     */
    emitEvent: (
        action: string,
        opts?: { progressFraction?: number; payload?: Record<string, unknown> },
    ) => void;
    /**
     * Renueva la marca de actividad. Sirve para mantener vivo el heartbeat
     * cuando hay interacciones que el listener pasivo no captura
     * (p.ej. play/pause de audio, click programático).
     */
    markActivity: () => void;
    /** Cierra la sesión actual con session_end + flush. Idempotente. */
    endSession: () => void;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const ENDPOINT          = '/api/v1/events';
const BUFFER_MAX        = 10;
const FLUSH_INTERVAL_MS = 5_000;
const ACTION_NAME_RX    = /^[a-z][a-z0-9_]*$/;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBackboneReadingSession(
    config: UseBackboneReadingSessionConfig,
): UseBackboneReadingSessionApi {
    const {
        enabled,
        userId,
        contentId,
        mode,
        getProgressFraction,
        getPayload,
        heartbeatMs     = 15_000,
        activityWindowMs = 20_000,
    } = config;

    // ── Refs estables (no disparan re-renders ni invalidan effects) ──────────
    const userIdRef    = useRef(userId);
    const contentIdRef = useRef(contentId);
    const modeRef      = useRef(mode);
    userIdRef.current    = userId;
    contentIdRef.current = contentId;
    modeRef.current      = mode;

    const getProgressFractionRef = useRef(getProgressFraction);
    const getPayloadRef          = useRef(getPayload);
    getProgressFractionRef.current = getProgressFraction;
    getPayloadRef.current          = getPayload;

    const sessionIdRef         = useRef<string>('');
    const sessionStartTsRef    = useRef<number>(0);
    const sessionStartedRef    = useRef<boolean>(false);
    const sessionEndedRef      = useRef<boolean>(false);

    const lastActivityTsRef    = useRef<number>(Date.now());
    const bufferRef            = useRef<BackboneEvent[]>([]);

    // ── flush ────────────────────────────────────────────────────────────────
    // NOTA: sendBeacon eliminado intencionalmente. /api/v1/events exige header
    // x-user-id y sendBeacon NO permite headers personalizados, causando 401
    // sostenidos en cada session_end / visibilitychange. fetch + keepalive es el
    // único path válido, soportado en todos los UAs modernos (hasta 64KB en
    // beforeunload). Trade-off: en Safari iOS background el keepalive puede no
    // completar; mitigado por heartbeats cada 15s que cubren analíticamente la
    // pérdida del session_end final. El parámetro `_useBeacon` queda como dead
    // arg para minimizar diff en los call sites.
    const flush = useCallback((_useBeacon: boolean): void => {
        const buf = bufferRef.current;
        if (buf.length === 0) return;
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') {
            buf.length = 0; // sin user válido → descartar (el endpoint v1 lo rechazaría)
            return;
        }
        const batch = buf.splice(0);
        const body  = JSON.stringify({ events: batch });

        try {
            fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
                body,
                keepalive: true,
            }).catch(() => { /* fail silencioso */ });
        } catch {
            // Nunca propagar errores de telemetría.
        }
    }, []);

    const flushRef = useRef(flush);
    flushRef.current = flush;

    // ── Helpers ──────────────────────────────────────────────────────────────
    const clampFraction = (n: number | undefined): number | undefined => {
        if (n === undefined || !Number.isFinite(n)) return undefined;
        return Math.max(0, Math.min(1, n));
    };

    const computeFraction = (override?: number): number | undefined => {
        if (override !== undefined) return clampFraction(override);
        const getter = getProgressFractionRef.current;
        if (!getter) return undefined;
        try {
            return clampFraction(getter());
        } catch {
            return undefined;
        }
    };

    const computeInitialPayload = (): Record<string, unknown> | undefined => {
        const getter = getPayloadRef.current;
        if (!getter) return undefined;
        try {
            return getter();
        } catch {
            return undefined;
        }
    };

    // ── Enqueue interno ──────────────────────────────────────────────────────
    const enqueue = useCallback((
        fullEventName: string,
        opts: {
            elapsedMs?: number;
            progressFraction?: number;
            payload?: Record<string, unknown>;
        } = {},
    ): void => {
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') return;
        if (!sessionIdRef.current) return;

        const evt: BackboneEvent = {
            eventId:       ulid(),
            schemaVersion: 1,
            event:         fullEventName,
            mode:          modeRef.current,
            userId:        uid,
            contentId:     contentIdRef.current ?? null,
            sessionId:     sessionIdRef.current,
            clientTs:      Date.now(),
        };
        if (opts.elapsedMs !== undefined)        evt.elapsedMs        = opts.elapsedMs;
        if (opts.progressFraction !== undefined) evt.progressFraction = opts.progressFraction;
        if (opts.payload && Object.keys(opts.payload).length > 0) evt.payload = opts.payload;

        bufferRef.current.push(evt);
        if (bufferRef.current.length >= BUFFER_MAX) flushRef.current(false);
    }, []);

    const enqueueRef = useRef(enqueue);
    enqueueRef.current = enqueue;

    // ── API: emitEvent ───────────────────────────────────────────────────────
    const emitEvent = useCallback((
        action: string,
        opts: { progressFraction?: number; payload?: Record<string, unknown> } = {},
    ): void => {
        if (!sessionStartedRef.current || sessionEndedRef.current) return;
        if (typeof action !== 'string' || !ACTION_NAME_RX.test(action)) return;
        const fullName = `${modeRef.current}.${action}`;
        const elapsed  = Date.now() - sessionStartTsRef.current;
        enqueueRef.current(fullName, {
            elapsedMs:        elapsed,
            progressFraction: computeFraction(opts.progressFraction),
            payload:          opts.payload,
        });
    }, []);

    // ── API: markActivity ────────────────────────────────────────────────────
    const markActivity = useCallback((): void => {
        lastActivityTsRef.current = Date.now();
    }, []);

    // ── API: endSession ──────────────────────────────────────────────────────
    const endSession = useCallback((): void => {
        if (!sessionStartedRef.current || sessionEndedRef.current) return;
        sessionEndedRef.current = true;
        const elapsed = Date.now() - sessionStartTsRef.current;
        enqueueRef.current(`${modeRef.current}.session_end`, {
            elapsedMs:        elapsed,
            progressFraction: computeFraction(),
            payload:          computeInitialPayload(),
        });
        flushRef.current(true);
    }, []);

    const endSessionRef = useRef(endSession);
    endSessionRef.current = endSession;

    // ── Effect: ciclo de sesión ──────────────────────────────────────────────
    // Reinicia cuando enabled / userId / contentId / mode cambian.
    // Cleanup emite session_end con beacon.
    useEffect(() => {
        if (!enabled || !userId || userId === 'guest' || !contentId) return;

        // Inicialización limpia.
        sessionIdRef.current      = ulid();
        sessionStartTsRef.current = Date.now();
        sessionStartedRef.current = false;
        sessionEndedRef.current   = false;
        bufferRef.current         = [];
        lastActivityTsRef.current = Date.now();

        // session_start (después de marcar started=true para que enqueue acepte).
        sessionStartedRef.current = true;
        enqueueRef.current(`${mode}.session_start`, {
            elapsedMs:        0,
            progressFraction: computeFraction(),
            payload:          computeInitialPayload(),
        });

        return () => {
            // Cleanup: emit session_end de la sesión que termina.
            if (sessionStartedRef.current && !sessionEndedRef.current) {
                sessionEndedRef.current = true;
                const elapsed = Date.now() - sessionStartTsRef.current;
                enqueueRef.current(`${mode}.session_end`, {
                    elapsedMs:        elapsed,
                    progressFraction: computeFraction(),
                    payload:          computeInitialPayload(),
                });
                flushRef.current(true);
            }
        };
    }, [enabled, userId, contentId, mode]);

    // ── Effect: heartbeat ────────────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const id = window.setInterval(() => {
            if (!sessionStartedRef.current || sessionEndedRef.current) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            if (Date.now() - lastActivityTsRef.current > activityWindowMs) return;
            const elapsed = Date.now() - sessionStartTsRef.current;
            enqueueRef.current(`${modeRef.current}.session_heartbeat`, {
                elapsedMs:        elapsed,
                progressFraction: computeFraction(),
            });
        }, heartbeatMs);
        return () => window.clearInterval(id);
    }, [heartbeatMs, activityWindowMs]);

    // ── Effect: flush periódico ──────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const id = window.setInterval(() => flushRef.current(false), FLUSH_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, []);

    // ── Effect: actividad pasiva ─────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onActivity = () => { lastActivityTsRef.current = Date.now(); };
        window.addEventListener('scroll',      onActivity, { passive: true, capture: true });
        window.addEventListener('keydown',     onActivity, { passive: true });
        window.addEventListener('pointerdown', onActivity, { passive: true });
        window.addEventListener('touchstart',  onActivity, { passive: true });
        return () => {
            window.removeEventListener('scroll',      onActivity, { capture: true } as EventListenerOptions);
            window.removeEventListener('keydown',     onActivity);
            window.removeEventListener('pointerdown', onActivity);
            window.removeEventListener('touchstart',  onActivity);
        };
    }, []);

    // ── Effect: beforeunload + visibilitychange ──────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onBeforeUnload = () => {
            if (sessionStartedRef.current && !sessionEndedRef.current) {
                endSessionRef.current();
            }
        };
        const onVisibilityChange = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                // Pestaña oculta: flush para no perder eventos si el usuario nunca vuelve.
                // NO emitimos session_end (la pestaña puede volverse visible).
                flushRef.current(true);
            }
        };
        window.addEventListener('beforeunload',         onBeforeUnload);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.removeEventListener('beforeunload',         onBeforeUnload);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    return {
        sessionId: sessionIdRef.current || null,
        emitEvent,
        markActivity,
        endSession,
    };
}
