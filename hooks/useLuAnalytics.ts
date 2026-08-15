/**
 * useLuAnalytics — telemetría de la sección Chibalete LU.
 *
 * Sprint Data Backbone — Fase 5B.
 *
 * LU no es lectura de contenido (no tiene contentId, no tiene scroll de
 * progreso, no tiene heartbeat útil), por lo que no encaja en
 * `useBackboneReadingSession`. Este hook reusa el mismo contrato del
 * Backbone v1 (POST /api/v1/events, ULID cliente, fetch keepalive,
 * sendBeacon en cierre) pero lo adapta a la naturaleza de una pantalla
 * de distribución:
 *
 *   - sessionId ULID por montaje de la pantalla.
 *   - session_start automático al montar; session_end automático al
 *     desmontar / beforeunload.
 *   - Sin heartbeat — la pantalla es estática, un heartbeat sería ruido.
 *   - Helpers explícitos para los hitos de UX: page_view, version_check,
 *     download_start, download_success, download_error, install_instructions_view,
 *     offline_help_view.
 *   - Cada evento emite con `payload._source = 'native'`. La capa de
 *     ingestión inyecta esa marca también, pero la dejamos explícita en
 *     el cliente para auditabilidad y para que un payload custom no
 *     "destape" la marca por accidente.
 *   - Fail silencioso: cualquier error de red, de auth, o de validación
 *     se descarta sin propagar.
 */

import { useCallback, useEffect, useRef } from 'react';
import { ulid } from '../utils/clientUlid';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface BackboneEvent {
    eventId:       string;
    schemaVersion: 1;
    event:         string;
    mode:          'lu';
    userId:        string;
    contentId:     null;
    sessionId:     string;
    clientTs:      number;
    elapsedMs?:    number;
    payload?:      Record<string, unknown>;
}

export interface UseLuAnalyticsConfig {
    /** ID del usuario autenticado. Sin user válido el hook no emite. */
    userId: string | undefined;
    /** Cuando false → no-op total (no emite, no abre listeners). */
    enabled: boolean;
}

export interface UseLuAnalyticsApi {
    sessionId: string | null;
    trackPageView:                 (payload?: Record<string, unknown>) => void;
    trackVersionCheck:             (payload: Record<string, unknown>)  => void;
    trackDownloadStart:            (payload: Record<string, unknown>)  => void;
    trackDownloadSuccess:          (payload: Record<string, unknown>)  => void;
    trackDownloadError:            (payload: Record<string, unknown>)  => void;
    trackInstallInstructionsView:  (payload?: Record<string, unknown>) => void;
    trackOfflineHelpView:          (payload?: Record<string, unknown>) => void;
    trackSessionEnd:               () => void;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const ENDPOINT          = '/api/v1/events';
const BUFFER_MAX        = 10;
const FLUSH_INTERVAL_MS = 5_000;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLuAnalytics(config: UseLuAnalyticsConfig): UseLuAnalyticsApi {
    const { userId, enabled } = config;

    const userIdRef = useRef(userId);
    userIdRef.current = userId;

    const sessionIdRef      = useRef<string>('');
    const sessionStartTsRef = useRef<number>(0);
    const sessionStartedRef = useRef<boolean>(false);
    const sessionEndedRef   = useRef<boolean>(false);
    const bufferRef         = useRef<BackboneEvent[]>([]);

    // ── flush ────────────────────────────────────────────────────────────────
    const flush = useCallback((useBeacon: boolean): void => {
        const buf = bufferRef.current;
        if (buf.length === 0) return;
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') {
            buf.length = 0;
            return;
        }
        const batch = buf.splice(0);
        const body  = JSON.stringify({ events: batch });

        try {
            if (useBeacon
                && typeof navigator !== 'undefined'
                && typeof navigator.sendBeacon === 'function'
            ) {
                const blob = new Blob([body], { type: 'application/json' });
                const sent = navigator.sendBeacon(ENDPOINT, blob);
                if (!sent) {
                    fetch(ENDPOINT, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body, keepalive: true,
                    }).catch(() => { /* fail silencioso */ });
                }
                return;
            }
            fetch(ENDPOINT, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body, keepalive: true,
            }).catch(() => { /* fail silencioso */ });
        } catch {
            // Nunca propagar errores de telemetría.
        }
    }, []);

    const flushRef = useRef(flush);
    flushRef.current = flush;

    // ── Enqueue interno ──────────────────────────────────────────────────────
    const enqueue = useCallback((
        action: string,
        payload?: Record<string, unknown>,
    ): void => {
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') return;
        if (!sessionIdRef.current) return;
        if (sessionEndedRef.current && action !== 'session_end') return;

        const now = Date.now();
        const evt: BackboneEvent = {
            eventId:       ulid(),
            schemaVersion: 1,
            event:         `lu.${action}`,
            mode:          'lu',
            userId:        uid,
            contentId:     null,
            sessionId:     sessionIdRef.current,
            clientTs:      now,
            elapsedMs:     sessionStartTsRef.current ? now - sessionStartTsRef.current : 0,
            payload:       { _source: 'native', ...(payload ?? {}) },
        };

        bufferRef.current.push(evt);
        if (bufferRef.current.length >= BUFFER_MAX) flushRef.current(false);
    }, []);

    const enqueueRef = useRef(enqueue);
    enqueueRef.current = enqueue;

    // ── Helpers expuestos ────────────────────────────────────────────────────
    const trackPageView = useCallback((payload?: Record<string, unknown>) => {
        enqueueRef.current('page_view', { source: 'ChibaleteLU', ...(payload ?? {}) });
    }, []);

    const trackVersionCheck = useCallback((payload: Record<string, unknown>) => {
        enqueueRef.current('version_check', payload);
    }, []);

    const trackDownloadStart = useCallback((payload: Record<string, unknown>) => {
        enqueueRef.current('download_start', payload);
    }, []);

    const trackDownloadSuccess = useCallback((payload: Record<string, unknown>) => {
        enqueueRef.current('download_success', payload);
    }, []);

    const trackDownloadError = useCallback((payload: Record<string, unknown>) => {
        enqueueRef.current('download_error', payload);
    }, []);

    const trackInstallInstructionsView = useCallback((payload?: Record<string, unknown>) => {
        enqueueRef.current('install_instructions_view', { section: 'android_install', ...(payload ?? {}) });
    }, []);

    const trackOfflineHelpView = useCallback((payload?: Record<string, unknown>) => {
        enqueueRef.current('offline_help_view', { section: 'offline_help', ...(payload ?? {}) });
    }, []);

    const endSession = useCallback((): void => {
        if (!sessionStartedRef.current || sessionEndedRef.current) return;
        sessionEndedRef.current = true;
        enqueueRef.current('session_end', { source: 'ChibaleteLU' });
        flushRef.current(true);
    }, []);

    const endSessionRef = useRef(endSession);
    endSessionRef.current = endSession;

    // ── Effect: ciclo de sesión ──────────────────────────────────────────────
    useEffect(() => {
        if (!enabled || !userId || userId === 'guest') return;

        sessionIdRef.current      = ulid();
        sessionStartTsRef.current = Date.now();
        sessionStartedRef.current = false;
        sessionEndedRef.current   = false;
        bufferRef.current         = [];

        sessionStartedRef.current = true;
        enqueueRef.current('session_start', { source: 'ChibaleteLU' });

        return () => {
            if (sessionStartedRef.current && !sessionEndedRef.current) {
                sessionEndedRef.current = true;
                enqueueRef.current('session_end', { source: 'ChibaleteLU' });
                flushRef.current(true);
            }
        };
    }, [enabled, userId]);

    // ── Effect: flush periódico ──────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const id = window.setInterval(() => flushRef.current(false), FLUSH_INTERVAL_MS);
        return () => window.clearInterval(id);
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
                flushRef.current(true);
            }
        };
        window.addEventListener('beforeunload',         onBeforeUnload);
        document.addEventListener('visibilitychange',   onVisibilityChange);
        return () => {
            window.removeEventListener('beforeunload',         onBeforeUnload);
            document.removeEventListener('visibilitychange',   onVisibilityChange);
        };
    }, []);

    return {
        sessionId: sessionIdRef.current || null,
        trackPageView,
        trackVersionCheck,
        trackDownloadStart,
        trackDownloadSuccess,
        trackDownloadError,
        trackInstallInstructionsView,
        trackOfflineHelpView,
        trackSessionEnd: endSession,
    };
}
