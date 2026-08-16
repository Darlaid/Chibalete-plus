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
// CHP-STATS-INSTRUMENTATION-01B: transporte durable compartido (01A) +
// elapsed incremental. Reemplaza el fetch fail-silent y el elapsedMs acumulado.
import { createEventTransport } from '../utils/eventTransport.mjs';
import { createElapsedTracker, buildReaderEvent } from '../utils/readerEventCore.mjs';

// ── Tipos ────────────────────────────────────────────────────────────────────

type ReaderMode = 'pdf' | 'text' | 'immersive' | 'album' | 'a11y' | 'lu';

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
const FLUSH_INTERVAL_MS = 5_000;
const ACTION_NAME_RX    = /^[a-z][a-z0-9_]*$/;
// Cola durable compartida por los lectores backbone (Texto/PDF/Álbum/Inmersivo).
// El server deduplica por eventId (UNIQUE), así que compartir la clave entre
// instancias/pestañas es seguro. Cap de lote = 50 (el endpoint procesa ≤50).
const QUEUE_STORAGE_KEY = 'chp_reader_event_queue';
const FLUSH_MAX_BATCH   = 50;

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
    // Checkpoint incremental de tiempo (01B): elapsedMs = delta desde el último
    // evento con tiempo, NO acumulado desde el inicio. Se reinicia por apertura.
    const elapsedTrackerRef    = useRef(createElapsedTracker(Date.now()));

    // ── Transporte durable compartido (01B, sobre 01A) ───────────────────────
    // Reemplaza el fetch fail-silent: cola persistente en localStorage, retry
    // seguro (mismo eventId/occurredAt), clasificación 5xx/429/network vs 4xx,
    // cero silent drop. Cookie-only (sin x-user-id): la identidad la resuelve la
    // sesión. Ahora SÍ se puede usar sendBeacon en cierre (la cookie viaja sola).
    const transportRef = useRef<ReturnType<typeof createEventTransport> | null>(null);
    if (transportRef.current === null && typeof window !== 'undefined') {
        transportRef.current = createEventTransport({
            endpoint: ENDPOINT,
            storageKey: QUEUE_STORAGE_KEY,
            generateId: ulid,
            sendBeacon: (url: string, body: string): boolean => {
                if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
                try { return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })); }
                catch { return false; }
            },
        });
    }

    // ── flush ────────────────────────────────────────────────────────────────
    // Delega en el transporte durable. `useBeacon` en cierre de pestaña usa
    // sendBeacon (habilitado por cookie-only). Fire-and-forget: nunca propaga.
    const flush = useCallback((useBeacon: boolean): void => {
        const tr = transportRef.current;
        if (!tr) return;
        try { void tr.flush({ useBeacon, maxBatch: FLUSH_MAX_BATCH }); }
        catch { /* la telemetría nunca rompe el render */ }
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
    // Recibe la `action` SIN prefijo (p.ej. 'progress', 'session_start'); el
    // core la prefija a `${mode}.${action}`. Construye el evento con identidad
    // estable (eventId ULID + occurredAt en el hecho) y lo persiste en el
    // transporte durable. NO envía en cada enqueue: el flush periódico + los de
    // cierre agrupan por lote (durable + batched).
    const enqueue = useCallback((
        action: string,
        opts: {
            elapsedMs?: number;
            progressFraction?: number;
            payload?: Record<string, unknown>;
        } = {},
    ): void => {
        const tr = transportRef.current;
        if (!tr) return;
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') return;
        if (!sessionIdRef.current) return;

        const evt = buildReaderEvent({
            eventId:              ulid(),
            now:                  Date.now(),
            mode:                 modeRef.current,
            action,
            userId:               uid,
            contentId:            contentIdRef.current ?? null,
            interactionSessionId: sessionIdRef.current,
            elapsedMs:            opts.elapsedMs,
            progressFraction:     opts.progressFraction,
            payload:              opts.payload,
        });
        if (evt) tr.enqueue(evt);
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
        enqueueRef.current(action, {
            elapsedMs:        elapsedTrackerRef.current.delta(Date.now()),
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
        enqueueRef.current('session_end', {
            elapsedMs:        elapsedTrackerRef.current.delta(Date.now()),
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

        // Inicialización limpia. Nueva interactionSessionId por APERTURA.
        const startTs = Date.now();
        sessionIdRef.current      = ulid();
        sessionStartTsRef.current = startTs;
        sessionStartedRef.current = false;
        sessionEndedRef.current   = false;
        elapsedTrackerRef.current.reset(startTs); // checkpoint incremental desde la apertura
        lastActivityTsRef.current = startTs;

        // session_start (después de marcar started=true para que enqueue acepte).
        sessionStartedRef.current = true;
        enqueueRef.current('session_start', {
            elapsedMs:        0,
            progressFraction: computeFraction(),
            payload:          computeInitialPayload(),
        });

        // Drenar la cola durable de sesiones previas al abrir el lector.
        flushRef.current(false);

        return () => {
            // Cleanup: emit session_end de la sesión que termina.
            if (sessionStartedRef.current && !sessionEndedRef.current) {
                sessionEndedRef.current = true;
                enqueueRef.current('session_end', {
                    elapsedMs:        elapsedTrackerRef.current.delta(Date.now()),
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
            enqueueRef.current('session_heartbeat', {
                elapsedMs:        elapsedTrackerRef.current.delta(Date.now()),
                progressFraction: computeFraction(),
            });
        }, heartbeatMs);
        return () => window.clearInterval(id);
    }, [heartbeatMs, activityWindowMs]);

    // ── Effect: flush periódico + retry al recuperar red ─────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const id = window.setInterval(() => flushRef.current(false), FLUSH_INTERVAL_MS);
        const onOnline = () => flushRef.current(false);
        window.addEventListener('online', onOnline);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('online', onOnline);
        };
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
