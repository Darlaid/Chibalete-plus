/**
 * useA11yAnalytics — telemetría del Modo accesible (mode='a11y').
 *
 * Sprint Data Backbone — Fase 1.
 *
 * Conecta VisorAccesible al endpoint POST /api/v1/events. Nace 100% sobre
 * el backbone, sin pasar por los endpoints legacy.
 *
 * Eventos emitidos (todos con shape BackboneEvent v1):
 *   1. a11y.session_start      — al recibir onBookReady (libro cargado y parseado)
 *   2. a11y.session_heartbeat  — cada 15s si pestaña visible y usuario activo
 *   3. a11y.progress           — al ver un párrafo nuevo ≥60% (throttle 500ms)
 *   4. a11y.session_end        — unmount, cambio de contenido o beforeunload
 *   5. a11y.error              — error crítico (parse_failed, doc_empty, etc.)
 *
 * Diseño:
 *   - sessionId ULID por (userId × contentId) — se reinicia al cambiar deps.
 *   - Buffer en memoria, max 10 eventos, flush cada 5s o al alcanzar el cap.
 *   - session_end usa navigator.sendBeacon para sobrevivir al cierre de pestaña.
 *   - IntersectionObserver con threshold 0.6 — un solo observer compartido.
 *   - Map<paragraphId, Element> para observe/unobserve precisos al unmount.
 *   - Listeners de actividad pasivos (scroll, keydown, pointerdown).
 *
 * Performance:
 *   - Cero await en render. Cero allocations en el callback del observer.
 *   - Refs para handlers internos → useEffect con deps [] no se re-ejecutan.
 *   - flush descarta eventos "huérfanos" (sin userId) en lugar de buferarlos.
 *
 * Accesibilidad:
 *   - Cero cambios de DOM, focus, aria — solo lectura.
 *   - Listeners en window con `passive: true`. No interceptan ningún evento.
 *
 * UX-3B — Offline queue (resilencia frente a red inestable):
 *   - localStorage `a11y_events_queue` persiste eventos cuyo POST falló.
 *   - Drain automático al montar el hook + al evento `online` del browser.
 *   - Sólo se vacía la queue cuando el servidor responde HTTP 2xx.
 *   - Cap a MAX_QUEUE eventos (drop oldest si se excede) — protege quota.
 *   - Multi-usuario por dispositivo: la queue puede contener eventos de
 *     varios userIds; el flush envía sólo los del usuario actual y deja
 *     intactos los del resto. Cada user limpia los suyos al confirmar.
 *
 * Lo que NO hace todavía:
 *   - No participa en el flujo legacy de progress.db (solo events.db vía v1).
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { ulid } from '../utils/clientUlid';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface BackboneEvent {
    eventId: string;
    schemaVersion: 1;
    event: string;
    mode: 'a11y';
    userId: string;
    contentId: string | null;
    sessionId: string;
    clientTs: number;
    elapsedMs?: number;
    progressFraction?: number;
    payload?: Record<string, unknown>;
}

export interface UseA11yAnalyticsConfig {
    /** ID del usuario autenticado. Si es undefined/'guest', el hook no emite nada. */
    userId: string | undefined;
    /** ID del libro abierto. Cambiarlo reinicia la sesión. */
    contentId: string | undefined;
}

export interface UseA11yAnalyticsApi {
    /**
     * Llamar UNA VEZ cuando el libro está listo y parseado.
     * Emite a11y.session_start con totalChapters/totalParagraphs.
     */
    onBookReady: (stats: { totalChapters: number; totalParagraphs: number }) => void;
    /** Reportar un error crítico. Emite a11y.error. */
    onError: (errorType: string, payload?: Record<string, unknown>) => void;
    /**
     * Pasar a A11yDocument vía prop para registrar cada <p> con el observer.
     * Llamar con (el, paragraphId) en mount y (null, paragraphId) en unmount.
     */
    observeParagraph: (el: Element | null, paragraphId: string) => void;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const ENDPOINT             = '/api/v1/events';
const BUFFER_MAX           = 10;
const FLUSH_INTERVAL_MS    = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const ACTIVITY_WINDOW_MS   = 20_000;
const PROGRESS_THROTTLE_MS = 500;
const PARAGRAPH_THRESHOLD  = 0.6;

// Offline queue (UX-3B). Cap en eventos totales (no por user). Drop oldest
// al exceder — la red volverá tarde o temprano, los eventos viejos pierden
// prioridad sobre los recientes. 200 entries × ~300 bytes ≈ 60KB, muy por
// debajo de la quota típica de localStorage (5MB).
const STORAGE_KEY = 'a11y_events_queue';
const MAX_QUEUE   = 200;

// ── Persistencia local de eventos pendientes ─────────────────────────────────

function loadQueue(): BackboneEvent[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Validación shape mínima para sobrevivir a versiones viejas en
        // localStorage. El campo eventId actúa como guard.
        return parsed.filter((e): e is BackboneEvent =>
            !!e && typeof e === 'object'
            && typeof (e as BackboneEvent).eventId === 'string'
            && typeof (e as BackboneEvent).userId  === 'string'
            && typeof (e as BackboneEvent).event   === 'string'
        );
    } catch {
        return [];
    }
}

function saveQueue(events: BackboneEvent[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
        // Cap: si excede MAX_QUEUE, descartamos los más antiguos.
        const capped = events.length > MAX_QUEUE
            ? events.slice(events.length - MAX_QUEUE)
            : events;
        if (capped.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
        }
    } catch {
        // QuotaExceededError u otro fallo de storage: silencioso.
        // La cola en memoria sigue intentando.
    }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useA11yAnalytics(config: UseA11yAnalyticsConfig): UseA11yAnalyticsApi {
    const { userId, contentId } = config;

    // Refs estables (no disparan re-renders ni invalidan callbacks).
    const userIdRef            = useRef<string | undefined>(userId);
    const contentIdRef         = useRef<string | undefined>(contentId);
    userIdRef.current          = userId;
    contentIdRef.current       = contentId;

    const sessionIdRef         = useRef<string>('');
    const sessionStartTsRef    = useRef<number>(0);
    const sessionStartedRef    = useRef<boolean>(false);
    const sessionEndedRef      = useRef<boolean>(false);

    const totalChaptersRef     = useRef<number>(0);
    const totalParagraphsRef   = useRef<number>(0);
    const seenParagraphsRef    = useRef<Set<string>>(new Set());
    const lastProgressEmitRef  = useRef<number>(0);

    const lastActivityTsRef    = useRef<number>(Date.now());

    const bufferRef            = useRef<BackboneEvent[]>([]);
    const observerRef          = useRef<IntersectionObserver | null>(null);
    const observedElementsRef  = useRef<Map<string, Element>>(new Map());

    // ── flush ────────────────────────────────────────────────────────────────
    //
    // UX-3B: el flush combina los eventos pendientes en localStorage (queue)
    // con los del buffer en memoria. Sólo limpia la queue cuando el servidor
    // responde 2xx. Si la red falla o el server devuelve error, los eventos
    // se persisten para reintentar más tarde (drainQueue → online listener
    // o próximo flush periódico).
    //
    // Multi-usuario: la queue puede contener eventos de varios userIds (un
    // mismo dispositivo compartido en colegio). Filtramos al userId actual,
    // dejando intactos los de otros — cada user limpia los suyos al confirmar.
    const flushImpl = useCallback((useBeacon: boolean): void => {
        const buf = bufferRef.current;
        const uid = userIdRef.current;

        if (!uid || uid === 'guest') {
            // Sin userId válido: el endpoint v1 lo rechazaría. Descartamos el
            // buffer en memoria; la queue persistida queda como está hasta
            // que un user válido intente flush.
            buf.length = 0;
            return;
        }

        const queued       = loadQueue();
        const myQueued     = queued.filter(e => e.userId === uid);
        const otherQueued  = queued.filter(e => e.userId !== uid);
        const eventsToSend = [...myQueued, ...buf];
        if (eventsToSend.length === 0) return;

        // Vaciamos el buffer en memoria optimistamente. Los eventos viven
        // ahora en `eventsToSend`. Si el POST falla, los reescribimos a la
        // queue persistida.
        buf.length = 0;

        const body = JSON.stringify({ events: eventsToSend });

        // Persistir en queue ANTES de fetch/beacon — atomicidad: si la
        // pestaña se cierra mid-flush, los eventos sobreviven en la queue.
        // En éxito limpiamos abajo.
        saveQueue([...otherQueued, ...eventsToSend]);

        const onTransportFailure = (reason: unknown): void => {
            // Los eventos ya están en la queue (persistidos arriba). Sólo
            // log dev para ayudar a debug en colegio con red mala.
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.warn('[a11y events] flush failed; queued',
                    eventsToSend.length, 'events for retry —', reason);
            }
        };

        try {
            if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                // sendBeacon NO permite headers personalizados ni response
                // status. Lo usamos en cierre de pestaña; los eventos ya
                // están persistidos, así que si beacon falla los recuperamos
                // en la próxima sesión. El server debe ser idempotente sobre
                // eventId (ULID) — duplicates posibles si beacon llegó pero
                // el cliente no se enteró.
                const blob = new Blob([body], { type: 'application/json' });
                const sent = navigator.sendBeacon(ENDPOINT, blob);
                if (!sent) {
                    // Fallback: fetch keepalive con headers correctos.
                    fetch(ENDPOINT, {
                        method:    'POST',
                        headers:   { 'Content-Type': 'application/json', 'x-user-id': uid },
                        body,
                        keepalive: true,
                    })
                        .then(res => {
                            if (res.ok) saveQueue(otherQueued);
                            else onTransportFailure(`HTTP ${res.status}`);
                        })
                        .catch(onTransportFailure);
                }
                // Beacon enviado: no podemos confirmar éxito → dejamos los
                // eventos en queue por seguridad. El próximo drain al
                // reabrir el visor los reenviará y el server deduplica.
                return;
            }

            fetch(ENDPOINT, {
                method:    'POST',
                headers:   { 'Content-Type': 'application/json', 'x-user-id': uid },
                body,
                keepalive: true,
            })
                .then(res => {
                    if (res.ok) {
                        // Confirmación de recepción → ahora sí limpiamos
                        // la queue (sólo nuestros eventos).
                        saveQueue(otherQueued);
                    } else {
                        onTransportFailure(`HTTP ${res.status}`);
                    }
                })
                .catch(onTransportFailure);
        } catch (err) {
            // Nunca propagar errores de telemetría. La queue ya tiene los
            // eventos, así que no se pierden por una excepción sincrónica.
            onTransportFailure(err);
        }
    }, []);

    // Mantenemos handlers en refs para evitar invalidar effects.
    const flushRef = useRef(flushImpl);
    flushRef.current = flushImpl;

    // ── enqueue ──────────────────────────────────────────────────────────────
    const enqueue = useCallback((
        event: string,
        opts: {
            elapsedMs?: number;
            progressFraction?: number;
            payload?: Record<string, unknown>;
        } = {},
    ): void => {
        const uid = userIdRef.current;
        if (!uid || uid === 'guest') return;
        const evt: BackboneEvent = {
            eventId:       ulid(),
            schemaVersion: 1,
            event,
            mode:          'a11y',
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

    // ── session_start ────────────────────────────────────────────────────────
    const onBookReady = useCallback((stats: { totalChapters: number; totalParagraphs: number }) => {
        if (sessionStartedRef.current || sessionEndedRef.current) return;
        if (!sessionIdRef.current) return; // ciclo no inicializado
        sessionStartedRef.current = true;
        sessionStartTsRef.current = Date.now();
        totalChaptersRef.current   = stats.totalChapters;
        totalParagraphsRef.current = stats.totalParagraphs;
        enqueueRef.current('a11y.session_start', {
            payload: {
                totalChapters:   stats.totalChapters,
                totalParagraphs: stats.totalParagraphs,
            },
        });
    }, []);

    // ── error ────────────────────────────────────────────────────────────────
    const onError = useCallback((errorType: string, payload?: Record<string, unknown>) => {
        if (sessionEndedRef.current) return;
        enqueueRef.current('a11y.error', {
            payload: { errorType, ...(payload ?? {}) },
        });
        // Flush inmediato — un error puede preceder a session_end por crash.
        flushRef.current(false);
    }, []);

    // ── progress ─────────────────────────────────────────────────────────────
    const handleParagraphSeen = useCallback((paragraphId: string): void => {
        if (sessionEndedRef.current || !sessionStartedRef.current) return;
        if (seenParagraphsRef.current.has(paragraphId)) return;
        // Marcamos como visto SIEMPRE (independiente del throttle); así
        // progressFraction siempre refleja el estado real aunque no haya emit.
        seenParagraphsRef.current.add(paragraphId);
        lastActivityTsRef.current = Date.now();

        const now = Date.now();
        if (now - lastProgressEmitRef.current < PROGRESS_THROTTLE_MS) return;
        lastProgressEmitRef.current = now;

        const total    = totalParagraphsRef.current;
        const fraction = total > 0 ? seenParagraphsRef.current.size / total : 0;
        // Inferir chapterIndex del id "p-{chap}-{sec}-{para}".
        const m = /^p-(\d+)-/.exec(paragraphId);
        const chapterIndex = m ? Number(m[1]) : null;

        enqueueRef.current('a11y.progress', {
            elapsedMs:        now - sessionStartTsRef.current,
            progressFraction: Math.max(0, Math.min(1, fraction)),
            payload: {
                paragraphId,
                paragraphsRead: seenParagraphsRef.current.size,
                ...(chapterIndex !== null ? { chapterIndex } : {}),
            },
        });
    }, []);

    const handleParagraphSeenRef = useRef(handleParagraphSeen);
    handleParagraphSeenRef.current = handleParagraphSeen;

    // ── session_end ──────────────────────────────────────────────────────────
    const emitSessionEnd = useCallback((useBeacon: boolean): void => {
        if (!sessionStartedRef.current || sessionEndedRef.current) return;
        sessionEndedRef.current = true;
        const elapsedMs = Date.now() - sessionStartTsRef.current;
        const total     = totalParagraphsRef.current;
        const fraction  = total > 0 ? seenParagraphsRef.current.size / total : 0;
        enqueueRef.current('a11y.session_end', {
            elapsedMs,
            progressFraction: Math.max(0, Math.min(1, fraction)),
            payload: {
                paragraphsRead:  seenParagraphsRef.current.size,
                totalParagraphs: total,
            },
        });
        flushRef.current(useBeacon);
    }, []);

    const emitSessionEndRef = useRef(emitSessionEnd);
    emitSessionEndRef.current = emitSessionEnd;

    // ── observeParagraph (API hacia el componente) ──────────────────────────
    const observeParagraph = useCallback((el: Element | null, paragraphId: string): void => {
        const observer = observerRef.current;
        const map = observedElementsRef.current;
        // Si había uno previo con el mismo id, lo desregistramos.
        const prev = map.get(paragraphId);
        if (prev && observer) observer.unobserve(prev);
        if (prev) map.delete(paragraphId);
        if (el && observer) {
            map.set(paragraphId, el);
            observer.observe(el);
        }
    }, []);

    // ── Effect: ciclo de sesión por (contentId, userId) ──────────────────────
    // Resetea el estado cuando alguno cambia. Cleanup emite session_end.
    useEffect(() => {
        if (!userId || userId === 'guest' || !contentId) {
            // Sin contexto válido, no inicializamos.
            return;
        }
        sessionIdRef.current        = ulid();
        sessionStartTsRef.current   = Date.now();
        sessionStartedRef.current   = false;
        sessionEndedRef.current     = false;
        seenParagraphsRef.current   = new Set();
        lastProgressEmitRef.current = 0;
        bufferRef.current           = [];
        return () => {
            // Cleanup: emit session_end de la sesión que está terminando + flush con beacon.
            emitSessionEndRef.current(true);
        };
    }, [userId, contentId]);

    // ── Effect: IntersectionObserver (un solo observer reutilizable) ─────────
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const obs = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting && entry.intersectionRatio >= PARAGRAPH_THRESHOLD) {
                        const id = (entry.target as HTMLElement).id;
                        if (id) handleParagraphSeenRef.current(id);
                    }
                }
            },
            { threshold: [PARAGRAPH_THRESHOLD] },
        );
        observerRef.current = obs;
        return () => {
            obs.disconnect();
            observerRef.current = null;
            observedElementsRef.current.clear();
        };
    }, []);

    // ── Effect: heartbeat ────────────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const id = window.setInterval(() => {
            if (sessionEndedRef.current || !sessionStartedRef.current) return;
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            const idleMs = Date.now() - lastActivityTsRef.current;
            if (idleMs > ACTIVITY_WINDOW_MS) return; // usuario inactivo
            const total    = totalParagraphsRef.current;
            const fraction = total > 0 ? seenParagraphsRef.current.size / total : 0;
            enqueueRef.current('a11y.session_heartbeat', {
                elapsedMs:        Date.now() - sessionStartTsRef.current,
                progressFraction: Math.max(0, Math.min(1, fraction)),
                payload: { paragraphsRead: seenParagraphsRef.current.size },
            });
        }, HEARTBEAT_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, []);

    // ── Effect: drain de la queue offline (UX-3B) ────────────────────────────
    //
    // Al montar el visor, intentamos enviar los eventos pendientes de
    // sesiones previas que no llegaron al server (red caída, tab cerrada
    // antes del flush, etc). También escuchamos `online` para reintentar
    // automáticamente en cuanto vuelva la red.
    //
    // Nota: el flush también corre periódico cada FLUSH_INTERVAL_MS — este
    // effect cubre los dos casos donde 5s de espera es demasiado: (a)
    // arranque del visor, (b) recuperación de red.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        // Intento inicial — si hay queue de sesiones previas, drainar ya.
        // Pequeño delay para que el session ciclo haya seteado userId/sessionId
        // (effects corren en orden de declaración pero refs cambian al render).
        const initialId = window.setTimeout(() => flushRef.current(false), 250);
        const onOnline  = () => flushRef.current(false);
        window.addEventListener('online', onOnline);
        return () => {
            window.clearTimeout(initialId);
            window.removeEventListener('online', onOnline);
        };
    }, []);

    // ── Effect: flush periódico ──────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const id = window.setInterval(() => flushRef.current(false), FLUSH_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, []);

    // ── Effect: tracking de actividad (passive listeners) ────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onActivity = () => { lastActivityTsRef.current = Date.now(); };
        window.addEventListener('scroll',      onActivity, { passive: true, capture: true });
        window.addEventListener('keydown',     onActivity, { passive: true });
        window.addEventListener('pointerdown', onActivity, { passive: true });
        return () => {
            window.removeEventListener('scroll',      onActivity, { capture: true } as EventListenerOptions);
            window.removeEventListener('keydown',     onActivity);
            window.removeEventListener('pointerdown', onActivity);
        };
    }, []);

    // ── Effect: beforeunload + visibilitychange ──────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onBeforeUnload = () => emitSessionEndRef.current(true);
        const onVisibilityChange = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                // Pestaña oculta: flush lo que tengamos para no perder eventos si
                // el usuario nunca vuelve. NO emitimos session_end (puede volver).
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

    // useMemo garantiza que el objeto retornado sea ref-estable mientras los
    // callbacks subyacentes lo sean. Los tres callbacks usan useCallback con
    // deps [], así que el deps array de este useMemo nunca cambia y el objeto
    // se reusa entre renders. Esto evita loops de cancel/refetch en consumers
    // que pongan `analytics` en deps de useEffect (ver VisorAccesible.tsx).
    return useMemo(() => ({
        onBookReady,
        onError,
        observeParagraph,
    }), [onBookReady, onError, observeParagraph]);
}
