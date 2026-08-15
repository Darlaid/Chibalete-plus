/**
 * usePlaybackAnalytics — buffer + batch de eventos de ritmo narrativo.
 *
 * Responsabilidades:
 *   - Acumula eventos en memoria (buffer)
 *   - Flush automático por tamaño (BATCH_SIZE) o tiempo (FLUSH_MS)
 *   - Flush en unmount (keepalive fetch — sobrevive a la navegación)
 *   - Solo persiste eventos del conjunto PERSIST_EVENTS (filtra el resto)
 *   - Silencia fallos de red — nunca bloquea el playback
 *
 * NO tocar:
 *   - Lógica de playback
 *   - Motor de ritmo
 *   - Ningún ref de audio
 */

import { useRef, useEffect, useCallback } from 'react';

// ── Configuración ─────────────────────────────────────────────────────────────

const ENDPOINT   = '/api/playback-events';
const BATCH_SIZE = 20;
const FLUSH_MS   = 5_000; // flush cada 5s — balance entre frescura y requests

/**
 * Eventos que se persisten al servidor para análisis de ritmo.
 * Los demás (play_start, sentence_advanced, errores) se quedan en consola.
 */
const PERSIST_EVENTS = new Set([
    'sentence_time',
    'sentence_rhythm',
    'sentence_skipped',
    'playback_paused',
    'session_completed', // necesario para calcular curva de abandono real
]);

// ── API ───────────────────────────────────────────────────────────────────────

export interface PlaybackAnalyticsHandle {
    /** Encola un evento si está en el conjunto de persistencia. */
    emit:  (payload: Record<string, unknown>) => void;
    /** Fuerza el envío inmediato del buffer. Llamar en unmount externo si hace falta. */
    flush: () => void;
}

/**
 * @param userIdRef   — ref estable que siempre tiene el userId actual
 * @param contentIdRef — ref estable que siempre tiene el contentId actual
 */
export function usePlaybackAnalytics(
    userIdRef:    React.MutableRefObject<string>,
    contentIdRef: React.MutableRefObject<string>,
): PlaybackAnalyticsHandle {

    const bufferRef = useRef<Record<string, unknown>[]>([]);

    // sessionId: estable por mount del hook — identifica la sesión de lectura
    const sessionId = useRef(`ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);

    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const flush = useCallback((): void => {
        if (bufferRef.current.length === 0) return;
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') {
            bufferRef.current = []; // descartar — guests no se persisten
            return;
        }
        const batch = bufferRef.current.splice(0); // drain atómico
        fetch(ENDPOINT, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ events: batch }),
            keepalive: true, // sobrevive a navegación / cierre de tab
        }).catch(() => {}); // fire-and-forget — nunca propagar errores de red
    // userIdRef es estable por diseño (ref object), no cambia entre renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const emit = useCallback((payload: Record<string, unknown>): void => {
        if (!PERSIST_EVENTS.has(payload.event as string)) return;
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') return;
        bufferRef.current.push({
            ...payload,
            sessionId:  sessionId.current,
            contentId:  contentIdRef.current,
        });
        if (bufferRef.current.length >= BATCH_SIZE) flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flush]);

    useEffect(() => {
        timerRef.current = setInterval(flush, FLUSH_MS);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            flush(); // flush final en unmount — keepalive lo entrega aunque el tab cierre
        };
    }, [flush]);

    return { emit, flush };
}
