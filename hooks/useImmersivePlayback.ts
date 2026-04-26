/**
 * useImmersivePlayback — fuente única de verdad para el audio del Modo Inmersivo.
 *
 * Sprint 2: extrae toda la lógica de audio de VisorInmersivo.
 * Sprint 3: hardening de producción — errores, autoplay, logging.
 *
 * Responsabilidades:
 *   - Buffer A/B para reproducción gapless
 *   - Resolución de URL (manifest → /api/tts → null)
 *   - Máquina de estados explícita (idle/loading/playing/paused/error/blocked)
 *   - Cancelación de cargas obsoletas via token
 *   - Prefetch y GC de blobs
 *   - Logging estructurado de eventos de playback
 *
 * Contrato con el exterior:
 *   - El hook MANDA sobre el audio.
 *   - El visor REACCIONA a través de callbacks (onIndexChange, onSessionEnd, onPlayChange).
 *   - Los engines (Block, Trance) reaccionan a onPlayChange, nunca al DOM directamente.
 *
 * Diseño interno:
 *   - Todos los datos "vivos" se pasan como refs para que los callbacks nunca
 *     capturen valores stale. El hook lee .current en el momento de la llamada.
 *   - statusRef duplica el React state 'status' para lecturas síncronas dentro
 *     de closures async (handleEnded, load) donde el state puede estar desactualizado.
 *   - setIdx() es el único punto de escritura del índice activo (ref + state + callback).
 *   - play() nunca se llama optimistamente: el estado 'playing' y onPlayChange(true)
 *     solo se emiten cuando play() resuelve sin error.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { usePlaybackAnalytics } from './usePlaybackAnalytics';

// ── Tipos exportados ────────────────────────────────────────────────────────

/**
 * idle     — sin contenido cargado.
 * loading  — fetch o play() en curso (muestra spinner en play button).
 * playing  — audio reproduciéndose.
 * paused   — audio cargado, pausado.
 * error    — sin audio disponible (TTS falló + no hay manifest); visor continúa en modo texto.
 * blocked  — el browser rechazó autoplay (NotAllowedError); usuario debe tocar para activar.
 */
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'blocked';

/**
 * Eventos de observabilidad del playback.
 * En producción estos pueden ser enviados a un endpoint de analytics.
 * Hoy: console.log estructurado para debugging en VPS.
 */
export type PlaybackEvent =
    | 'play_start'
    | 'play_fail'
    | 'autoplay_blocked'
    | 'tts_fail'
    | 'manifest_fail'
    | 'blob_invalid'
    | 'sentence_advanced'
    | 'sentence_time'
    | 'sentence_rhythm'
    | 'sentence_skipped'
    | 'playback_paused'
    | 'session_completed'
    | 'load_cancelled'
    | 'gapless_fail';

/**
 * Contexto que el visor pasa al hook.
 * Todos los campos son refs para evitar que el hook tenga que re-suscribirse
 * cuando cambian los valores (ej. sentences actualiza post-hydration).
 */
export interface PlaybackContext {
    /** Oraciones de display (para bounds checking y onSessionEnd) */
    sentencesRef:      React.MutableRefObject<string[]>;
    /** Oraciones de audio (texto que se envía a TTS) */
    audioSentencesRef: React.MutableRefObject<string[]>;
    /** Manifest de audio pre-generado. null si no existe. */
    manifestRef:       React.MutableRefObject<Record<string, any> | null>;
    /** Mapping sentenceIndex → chunkIndex. Array vacío en v1. */
    toChunkRef:        React.MutableRefObject<number[]>;
    /** Velocidad de reproducción actual */
    speedRef:          React.MutableRefObject<number>;
    /** userId para x-user-id header en /api/tts */
    userIdRef:         React.MutableRefObject<string>;
    /** true cuando el componente se desmontó */
    unmountedRef:      React.MutableRefObject<boolean>;
    /** Llamado cuando el índice activo cambia (para Leo, analytics, UI) */
    onIndexChange:     React.MutableRefObject<(idx: number) => void>;
    /** Llamado cuando termina el último fragmento o el BlockEngine completa */
    onSessionEnd:      React.MutableRefObject<() => void>;
    /** Llamado con true al arrancar y false al pausar (para Block + TranceEngine) */
    onPlayChange:      React.MutableRefObject<(playing: boolean) => void>;
    /** contentId del libro activo — para correlación en analytics de ritmo */
    contentIdRef:      React.MutableRefObject<string>;
}

export interface ImmersivePlayback {
    audioRefA:    React.RefObject<HTMLAudioElement | null>;
    audioRefB:    React.RefObject<HTMLAudioElement | null>;
    status:       PlaybackStatus;
    isPlaying:    boolean;
    /**
     * Índice activo según el controller. Fuente canónica para el visor.
     * Sincronizado vía setIdx() — ref + state + callback en una sola operación.
     */
    currentIndex: number;
    /** Carga un índice. autoPlay=true inicia reproducción inmediatamente. */
    load:        (index: number, autoPlay?: boolean) => Promise<void>;
    pause:       () => void;
    resume:      () => void;
    /** Salto explícito del usuario — siempre fuerza reproducción. */
    skip:        (index: number) => void;
    /** Llamar desde onEnded del elemento <audio>. */
    handleEnded: (player: 'A' | 'B') => void;
    /** Llamar desde onError del elemento <audio> — blob inválido o formato no soportado. */
    handleAudioError: (player: 'A' | 'B') => void;
    prefetch:    (start: number) => void;
    /** GC de blobs. Llama desde el useEffect([pb.currentIndex]) del visor. */
    runGC:       () => void;
    /** Limpia todo el estado de audio. Llamar en transiciones de contenido. */
    reset:       () => void;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const PREFETCH_WINDOW = 5;

// ── Ritmo narrativo — clasificación determinista (O(n) en longitud del texto) ─
// Sin NLP, sin regex complejas, sin IA en runtime. Métricas de texto simples.
// classifySentence: determina tipo (por longitud) y tono (por puntuación especial).
// computeNarrativeDelay: convierte clasificación en ms de pausa entre oraciones.

type SentenceType = 'short' | 'medium' | 'long';
type SentenceTone = 'neutral' | 'emphasis' | 'question';
interface SentenceMeta { type: SentenceType; tone: SentenceTone; }

function classifySentence(text: string): SentenceMeta {
    const len  = text.length;
    const type: SentenceType = len < 40 ? 'short' : len <= 120 ? 'medium' : 'long';
    // question tiene precedencia sobre emphasis (¿...! es pregunta retórica)
    const tone: SentenceTone = /[?¿]/.test(text) ? 'question'
                             : /[!¡]/.test(text) ? 'emphasis'
                             : 'neutral';
    return { type, tone };
}

function computeNarrativeDelay(meta: SentenceMeta): number {
    // FT-4: afinación ultra-fina — rango 20–120ms (bases 20/50/90, mods +30/+15, cap 120).
    // Preserva respiración narrativa pero reduce aún más el gap percibido entre oraciones.
    const base = meta.type === 'short' ? 20 : meta.type === 'medium' ? 50 : 90;
    const mod  = meta.tone === 'question' ? 30 : meta.tone === 'emphasis' ? 15 : 0;
    return Math.min(base + mod, 120);
}

/**
 * Ventana de prefetch adaptada a la velocidad de red.
 * Usa la Network Information API (Chrome/Android) cuando está disponible.
 * Safari e iOS no implementan navigator.connection — el cast `as any` silencia
 * el error de TypeScript y el fallback `default` cubre ese caso con la ventana máxima.
 */
function getAdaptivePrefetchWindow(): number {
    const conn = (navigator as any).connection;
    if (conn?.saveData) return 1;
    switch (conn?.effectiveType) {
        case '2g':  return 1;
        case '3g':  return 2;
        default:    return PREFETCH_WINDOW; // 4g, wifi, Safari, undefined → ventana completa
    }
}

// ── Logger estructurado ──────────────────────────────────────────────────────
// Emite a consola con prefijo y contexto. En producción puede redirigirse
// a un endpoint de analytics sin cambiar los call sites.

function pbLog(event: PlaybackEvent, data?: Record<string, unknown>): void {
    const payload = { event, ts: Date.now(), ...data };
    // eventos frecuentes — nivel 'debug', nunca van al backend
    if (event === 'play_start' || event === 'sentence_advanced' || event === 'sentence_time' || event === 'sentence_rhythm' || event === 'sentence_skipped' || event === 'playback_paused') {
        console.debug('[PB]', payload);
    } else if (event === 'session_completed') {
        console.info('[PB]', payload);
    } else {
        // Errores, bloqueos, fallos — nivel 'warn' para que sean visibles en VPS logs
        console.warn('[PB]', payload);
        // Solo persistir eventos no-rutinarios en el backend (fire-and-forget)
        fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            // keepalive: true permite que el request complete incluso si el tab se cierra
            keepalive: true,
        }).catch(() => { /* ignorar errores de red — nunca bloquear playback */ });
    }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useImmersivePlayback(ctx: PlaybackContext): ImmersivePlayback {

    // ── Audio elements (A/B buffer) ──────────────────────────────────────────
    const audioRefA      = useRef<HTMLAudioElement | null>(null);
    const audioRefB      = useRef<HTMLAudioElement | null>(null);
    const activePlayer   = useRef<'A' | 'B'>('A');

    // ── URL cache & tracking ─────────────────────────────────────────────────
    const audioCache     = useRef(new Map<number, string>());
    const inFlight       = useRef(new Map<number, Promise<string | null>>());
    const abortCtrls     = useRef(new Map<number, AbortController>());

    // ── Cancellation token — previene ejecución de loads obsoletos ───────────
    const loadToken      = useRef(0);

    // ── Índice activo — ref para closures async, state para el visor ────────
    // setIdx() es el único punto de escritura — actualiza ref + state + callback.
    const currentIdxRef  = useRef(0);
    const [currentIndex, setCurrentIndex] = useState(0);

    // ── Estado de reproducción ───────────────────────────────────────────────
    // statusRef: lectura síncrona dentro de closures async.
    // status (state): dispara re-renders en el visor.
    const statusRef = useRef<PlaybackStatus>('idle');
    const [status, setStatusState] = useState<PlaybackStatus>('idle');

    // ── B2: Standby readiness — true cuando el player en espera alcanzó canplaythrough ─
    // Permite que handleEnded haga play() inmediato si el buffer está listo,
    // o espere hasta 80ms antes de rendirse. Resuelve micro-gaps en Safari y redes lentas.
    const standbyReadyRef = useRef(false);
    // Generación del standby activo. Cada vez que se configura un nuevo standby (load o
    // handleEnded post-await), se incrementa. Los listeners canplaythrough solo actualizan
    // standbyReadyRef si su generación coincide con la actual — evita que un listener de un
    // ciclo anterior (src viejo) marque ready incorrectamente.
    const standbyGenRef = useRef(0);

    // ── B4: Marca de inicio de la oración activa — para medir duración real ──
    // Se setea cuando play() confirma arranque (no optimistamente).
    // durationMs en handleEnded = tiempo real que el usuario escuchó esa oración.
    const sentenceStartTimeRef = useRef(0);

    const setStatus = (s: PlaybackStatus) => {
        statusRef.current = s;
        setStatusState(s);
    };

    // Único punto de escritura del índice. Actualiza ref (sync) + state (React) + callback.
    const setIdx = (idx: number) => {
        currentIdxRef.current = idx;
        setCurrentIndex(idx);
        ctx.onIndexChange.current(idx);
    };

    // ── Cleanup al desmontar ─────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            loadToken.current++;
            standbyGenRef.current++;  // invalida cualquier listener canplaythrough pendiente
            audioCache.current.forEach(url => URL.revokeObjectURL(url));
            audioCache.current.clear();
            abortCtrls.current.forEach(ctrl => ctrl.abort('Unmount'));
            abortCtrls.current.clear();
            inFlight.current.clear();
        };
    }, []);

    // ── Analytics de ritmo — buffer + batch hacia /api/playback-events ──────
    // Solo persiste los eventos del conjunto PERSIST_EVENTS (sentence_time,
    // sentence_rhythm, sentence_skipped, playback_paused). El resto solo va a consola.
    const analytics = usePlaybackAnalytics(ctx.userIdRef, ctx.contentIdRef);

    // ── Logger ligado al contexto — inyecta userId automáticamente ──────────
    // Wrapper sobre pbLog (module-level) que añade el userId del reader a cada
    // evento antes de emitirlo. También encola en analytics para persistencia.
    const log = (event: PlaybackEvent, data?: Record<string, unknown>) => {
        const payload = { event, ts: Date.now(), userId: ctx.userIdRef.current, ...data };
        pbLog(event, payload);        // consola (comportamiento existente)
        analytics.emit(payload);      // buffer → /api/playback-events
    };

    // ── Chunk key: sentenceIndex → cacheKey ──────────────────────────────────
    const toChunkKey = (si: number): number => {
        const map = ctx.toChunkRef.current;
        return map.length > 0 ? (map[si] ?? si) : si;
    };

    // ── Cancelar fetches fuera de la ventana de reproducción ─────────────────
    const cancelStaleFetches = (index: number) => {
        const total = ctx.sentencesRef.current.length;
        const lower = toChunkKey(Math.max(0, index - 5));
        const upper = toChunkKey(Math.min(total - 1, index + getAdaptivePrefetchWindow() + 2));
        abortCtrls.current.forEach((ctrl, key) => {
            if (key < lower || key > upper) ctrl.abort('Jumped away');
        });
    };

    // ── URL resolution: manifest → /api/tts → null ───────────────────────────
    const getAudioUrl = useCallback(async (index: number): Promise<string | null> => {
        const audioSentences = ctx.audioSentencesRef.current;
        if (index < 0 || index >= audioSentences.length) return null;

        const key = toChunkKey(index);

        const cached = audioCache.current.get(key);
        if (cached) return cached;

        const existing = inFlight.current.get(key);
        if (existing) return existing;

        const abortCtrl = new AbortController();
        abortCtrls.current.set(key, abortCtrl);

        const task = async (): Promise<string | null> => {
            try {
                // Nivel 1: audio pre-generado en el servidor (manifest)
                const mf = ctx.manifestRef.current;
                if (mf?.[key]) {
                    const res = await fetch(`/uploads/${mf[key].file}`, { signal: abortCtrl.signal });
                    if (res.ok) {
                        const blob = await res.blob();
                        if (abortCtrl.signal.aborted) return null;
                        // Validar que el blob es un audio real y no está vacío
                        if (blob.size === 0) {
                            log('manifest_fail', { index, key, reason: 'empty_blob' });
                            // No retornar null todavía — caer al nivel 2 (TTS on-demand)
                        } else {
                            const url = URL.createObjectURL(blob);
                            audioCache.current.set(key, url);
                            return url;
                        }
                    } else {
                        log('manifest_fail', { index, key, status: res.status });
                        // Caer al nivel 2
                    }
                }

                // Nivel 2: TTS on-demand en backend (clave nunca sale del servidor)
                const txt    = audioSentences[index];
                const userId = ctx.userIdRef.current;
                if (!txt || !userId || userId === 'guest') return null;

                // Timeout de 8 s — evita que la UI se congele en redes lentas.
                // try/finally garantiza clearTimeout incluso si fetch lanza antes de resolver.
                const ttsTimeout = setTimeout(() => abortCtrl.abort('tts_timeout'), 8000);
                let res: Response;
                try {
                    res = await fetch('/api/tts', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
                        body:    JSON.stringify({ text: txt }),
                        signal:  abortCtrl.signal,
                    });
                } finally {
                    clearTimeout(ttsTimeout);
                }

                if (!res.ok) {
                    log('tts_fail', { index, httpStatus: res.status });
                    return null;
                }
                if (abortCtrl.signal.aborted || ctx.unmountedRef.current) return null;

                // Validar Content-Type — el backend puede devolver JSON de error con status 200
                const contentType = res.headers.get('content-type') ?? '';
                if (!contentType.startsWith('audio/')) {
                    log('tts_fail', { index, reason: 'wrong_content_type', contentType });
                    return null;
                }

                const blob = await res.blob();
                if (abortCtrl.signal.aborted || ctx.unmountedRef.current) return null;

                // Validar que el blob tiene contenido real
                if (blob.size === 0) {
                    log('blob_invalid', { index, reason: 'empty_tts_blob' });
                    return null;
                }

                const url = URL.createObjectURL(blob);
                audioCache.current.set(key, url);
                return url;

            } catch (e: any) {
                if (e.name !== 'AbortError') {
                    log('tts_fail', { index, error: e.name, message: e.message });
                }
                return null;
            } finally {
                inFlight.current.delete(key);
                abortCtrls.current.delete(key);
            }
        };

        const promise = task();
        inFlight.current.set(key, promise);
        return promise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // stable — todas las dependencias son refs, se leen en call time

    // ── Prefetch anticipado ───────────────────────────────────────────────────
    const prefetch = useCallback((start: number) => {
        const total  = ctx.sentencesRef.current.length;
        const window = getAdaptivePrefetchWindow();
        for (let i = 0; i < window && (start + i) < total; i++) {
            getAudioUrl(start + i);
        }
    }, [getAudioUrl]);

    // ── GC de blobs — usa currentIdxRef interno, no necesita parámetro externo ─
    const runGC = useCallback(() => {
        if (audioCache.current.size === 0) return;
        const currentIdx = currentIdxRef.current;
        const total  = ctx.sentencesRef.current.length;
        const lower  = toChunkKey(Math.max(0, currentIdx - 20));
        const upper  = toChunkKey(Math.min(total - 1, currentIdx + 20));
        const toDelete: number[] = [];
        audioCache.current.forEach((blobUrl, k) => {
            if (k < lower || k > upper) { URL.revokeObjectURL(blobUrl); toDelete.push(k); }
        });
        toDelete.forEach(k => audioCache.current.delete(k));
        if (toDelete.length > 0) {
            console.debug(`[PB GC] Freed ${toDelete.length} blobs. Active: ${audioCache.current.size}`);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── LOAD — entry point principal para cualquier cambio de índice ──────────
    const load = useCallback(async (index: number, autoPlay = false): Promise<void> => {
        if (ctx.unmountedRef.current) return;
        if (index < 0 || index >= ctx.sentencesRef.current.length) return;

        const token = ++loadToken.current;
        setStatus('loading');

        // Detener ambos players inmediatamente — sin overlap
        audioRefA.current?.pause();
        audioRefB.current?.pause();
        cancelStaleFetches(index);

        const url = await getAudioUrl(index);

        // Si llegó una carga más reciente o el componente se desmontó, abortar silenciosamente
        if (token !== loadToken.current || ctx.unmountedRef.current) {
            log('load_cancelled', { index, reason: token !== loadToken.current ? 'stale_token' : 'unmounted' });
            return;
        }

        const pActive  = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        const pStandby = activePlayer.current === 'A' ? audioRefB.current : audioRefA.current;
        if (!pActive || !pStandby) return;

        if (!url) {
            // Sin audio — modo texto puro. Avanzar índice para que el visor siga funcionando.
            setStatus('error');
            setIdx(index);
            return;
        }

        pActive.src          = url;
        pActive.playbackRate = ctx.speedRef.current;

        // Avanzar índice ANTES de intentar play() — el texto ya está en el índice correcto.
        setIdx(index);

        if (autoPlay) {
            // NO emitir 'playing' ni onPlayChange(true) de forma optimista.
            // Esperar resolución de play() para tener estado correcto.
            // La UI permanece en 'loading' hasta confirmar (delay < 1 frame en blob URLs).
            pActive.play()
                .then(() => {
                    // Re-verificar token: si el usuario saltó mientras play() asentaba, ignorar.
                    if (token !== loadToken.current || ctx.unmountedRef.current) return;
                    setStatus('playing');
                    ctx.onPlayChange.current(true);
                    sentenceStartTimeRef.current = Date.now(); // B4: play confirmado → inicio de medición
                    log('play_start', { index, cached: audioCache.current.has(toChunkKey(index)) });
                })
                .catch((e: DOMException) => {
                    if (token !== loadToken.current || ctx.unmountedRef.current) return;
                    // AbortError: pause() interrumpió play() antes de que resolviera.
                    // No es un error — el usuario pidió pausa, que ya fue aplicada. Salir limpio.
                    if (e.name === 'AbortError') return;
                    // NotAllowedError = browser autoplay policy
                    // NotSupportedError = formato de audio no soportado
                    if (e.name === 'NotAllowedError') {
                        setStatus('blocked');
                        log('autoplay_blocked', { index, error: e.name });
                    } else {
                        setStatus('error');
                        log('play_fail', { index, error: e.name, message: e.message });
                    }
                    ctx.onPlayChange.current(false);
                });
        } else {
            setStatus('paused');
        }

        // Precargar el siguiente en el player en espera (no bloquea el path principal)
        if (token !== loadToken.current) return;
        const nextUrl = await getAudioUrl(index + 1);
        if (token !== loadToken.current || ctx.unmountedRef.current) return;
        if (nextUrl && pStandby) {
            pStandby.src          = nextUrl;
            pStandby.playbackRate = ctx.speedRef.current;
            standbyReadyRef.current = false;
            const standbyGen = ++standbyGenRef.current;               // nueva generación para este src
            pStandby.load();
            pStandby.addEventListener('canplaythrough', () => {
                // Solo marcar ready si este listener pertenece al ciclo activo.
                // Un listener de un ciclo anterior (src cambiado por skip) no debe contaminar.
                if (standbyGenRef.current === standbyGen) standbyReadyRef.current = true;
            }, { once: true });
        }
        prefetch(index + 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getAudioUrl, prefetch]);

    // ── PAUSE ─────────────────────────────────────────────────────────────────
    const pause = useCallback((): void => {
        const p = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        p?.pause();
        setStatus('paused');
        ctx.onPlayChange.current(false);
        log('playback_paused', { index: currentIdxRef.current });
    }, []);

    // ── RESUME ────────────────────────────────────────────────────────────────
    // Maneja los estados 'paused' y 'blocked'.
    // En 'blocked': el audio está cargado, solo faltó interacción del usuario.
    //              La interacción que dispara resume() es suficiente para desbloquear.
    const resume = useCallback((): void => {
        const p = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        if (!p?.src) return;

        setStatus('loading'); // visualmente claro que algo está pasando
        p.playbackRate = ctx.speedRef.current;
        p.play()
            .then(() => {
                setStatus('playing');
                ctx.onPlayChange.current(true);
                sentenceStartTimeRef.current = Date.now(); // B4: resume confirmado → reiniciar medición
                log('play_start', { index: currentIdxRef.current, via: 'resume' });
            })
            .catch((e: DOMException) => {
                // Si sigue bloqueado (no debería ocurrir tras interacción real del usuario)
                if (e.name === 'NotAllowedError') {
                    setStatus('blocked');
                    log('autoplay_blocked', { index: currentIdxRef.current, via: 'resume_retry' });
                } else {
                    setStatus('paused'); // fallo de otro tipo → rollback a paused (reiniciable)
                    log('play_fail', { index: currentIdxRef.current, via: 'resume', error: e.name });
                }
            });
    }, []);

    // ── SKIP — salto explícito del usuario, siempre fuerza reproducción ───────
    const skip = useCallback((index: number): void => {
        const fromIdx = currentIdxRef.current;
        const delta   = index - fromIdx;
        // delta === 0: re-carga de la oración actual (no es un skip de navegación)
        if (delta !== 0) {
            log('sentence_skipped', {
                from:      fromIdx,
                to:        index,
                delta,
                direction: delta > 0 ? 'forward' : 'backward',
                status:    statusRef.current,
                textLen:   ctx.sentencesRef.current[fromIdx]?.length ?? 0, // verifica clasificación real
                speed:     ctx.speedRef.current,
            });
        }
        load(index, true);
    }, [load]);

    // ── HANDLE ENDED — transición gapless entre fragmentos ───────────────────
    const handleEnded = useCallback(async (endedPlayer: 'A' | 'B'): Promise<void> => {
        if (ctx.unmountedRef.current) return;
        if (statusRef.current !== 'playing') return;

        const sentences  = ctx.sentencesRef.current;
        const currentIdx = currentIdxRef.current;
        const nextIdx    = currentIdx + 1;

        // B4: Duración real de la oración que acaba de terminar.
        const durationMs = Date.now() - sentenceStartTimeRef.current;

        // B3: Capturar token AHORA, antes de cualquier operación async o callback.
        // Si skip() o load() se ejecutan durante la transición (incluyendo el await abajo),
        // loadToken.current habrá cambiado y doPlay() abortará sin reproducir audio obsoleto.
        const capturedToken = loadToken.current;

        if (nextIdx >= sentences.length) {
            setStatus('paused');
            ctx.onPlayChange.current(false);
            ctx.onSessionEnd.current();
            log('session_completed', { totalSentences: sentences.length });
            return;
        }

        const nextSlot = endedPlayer === 'A' ? 'B' : 'A';
        activePlayer.current  = nextSlot;
        const nextEl   = nextSlot   === 'A' ? audioRefA.current : audioRefB.current;
        const freedEl  = endedPlayer === 'A' ? audioRefA.current : audioRefB.current;

        if (nextEl?.src) {
            // B4: durationMs solo es válido si sentenceStartTimeRef fue seteado por play().
            // Si es 0 (inicio de sesión sin play confirmado previo), omitir el campo para
            // evitar registrar un número gigante (~timestamp actual) como duración real.
            const durationMsLogged = sentenceStartTimeRef.current > 0 ? durationMs : null;
            log('sentence_time', { index: currentIdx, durationMs: durationMsLogged, gapless: standbyReadyRef.current, speed: ctx.speedRef.current });
            log('sentence_advanced', { from: currentIdx, to: nextIdx });

            setIdx(nextIdx);
            nextEl.playbackRate = ctx.speedRef.current;

            // B2+B3: doPlay encapsula la llamada a play() con tres guardas:
            //   - capturedToken: aborta si llegó un skip() mientras esperábamos el buffer.
            //   - unmountedRef: aborta si el componente se desmontó.
            //   - statusRef: aborta si el usuario pausó durante la espera del buffer (R1).
            const doPlay = () => {
                if (capturedToken !== loadToken.current) return;
                if (ctx.unmountedRef.current) return;
                // R1: El usuario puede llamar pause() durante los 80ms de espera del fallback.
                // Sin este check, doPlay reproduciría audio que el usuario quiso pausar.
                if (statusRef.current !== 'playing') return;

                // B4: timestamp de inicio real — después del delay narrativo y justo antes de play().
                // Mover aquí (en lugar de junto a setIdx) evita que el delay infle durationMs.
                sentenceStartTimeRef.current = Date.now();
                nextEl.play()
                    .then(() => {
                        if (capturedToken !== loadToken.current) return;
                        // status sigue siendo 'playing' — sin transición visible para el usuario.
                    })
                    .catch((e: DOMException) => {
                        if (capturedToken !== loadToken.current) return;
                        // R2: AbortError ocurre cuando pause() interrumpe play() antes de que resuelva.
                        // Chrome emite esto cuando se llama pause() mientras play() está pendiente.
                        // No es un error de playback — el usuario pausó intencionalmente. Salir limpio.
                        if (e.name === 'AbortError') return;
                        if (e.name === 'NotAllowedError') {
                            setStatus('blocked');
                            log('autoplay_blocked', { index: nextIdx, via: 'gapless' });
                        } else {
                            log('gapless_fail', { index: nextIdx, error: e.name });
                            load(nextIdx, true);
                        }
                        ctx.onPlayChange.current(false);
                    });

                standbyReadyRef.current = false; // B2: consumido — resetear para el siguiente ciclo
            };

            // B2: Si el standby ya alcanzó canplaythrough → delay narrativo controlado → play.
            // Si no → esperar hasta 80ms sin delay adicional (sistema bajo carga → no acumular).
            // El delay es cancelable por token (skip/load), statusRef (pause) y unmountedRef.
            if (standbyReadyRef.current) {
                const meta     = classifySentence(ctx.sentencesRef.current[currentIdx] ?? '');
                const rawDelay = computeNarrativeDelay(meta);
                // FT-4: bajar el umbral de anulación de 1.5 → 1.25 (el salto a "ágil" llega antes).
                // En (1, 1.25): escalar inversamente con piso de 15ms (alineado al nuevo rango 20–120).
                // En <= 1: delay crudo sin acelerar silencio.
                const speed    = ctx.speedRef.current;
                const delayMs  = speed >= 1.25 ? 0
                               : speed > 1    ? Math.max(15, Math.round(rawDelay / speed))
                               : rawDelay;
                log('sentence_rhythm', { from: currentIdx, to: nextIdx, rawDelay, delayApplied: delayMs, type: meta.type, tone: meta.tone, speed });
                setTimeout(() => {
                    if (capturedToken !== loadToken.current) return;
                    if (ctx.unmountedRef.current) return;
                    if (statusRef.current !== 'playing') return;
                    doPlay();
                }, delayMs);
            } else {
                let played = false;
                const fallback = setTimeout(() => {
                    if (!played) { played = true; doPlay(); }
                }, 80);
                nextEl.addEventListener('canplaythrough', () => {
                    if (!played) { played = true; clearTimeout(fallback); doPlay(); }
                }, { once: true });
            }

            // Recargar el player liberado con el siguiente-siguiente (async, no bloquea play)
            const nextNextIdx = nextIdx + 1;
            const url = await getAudioUrl(nextNextIdx);
            // B3: Token check post-await — puede haber llegado un skip() durante el fetch.
            if (ctx.unmountedRef.current || capturedToken !== loadToken.current) return;
            if (freedEl && url) {
                freedEl.src          = url;
                freedEl.playbackRate = ctx.speedRef.current;
                standbyReadyRef.current = false;
                const standbyGen = ++standbyGenRef.current;             // nueva generación para este src
                freedEl.load();
                freedEl.addEventListener('canplaythrough', () => {
                    if (standbyGenRef.current === standbyGen) standbyReadyRef.current = true;
                }, { once: true });
            }
            prefetch(nextNextIdx + 1);
        } else {
            // Player en espera no tenía audio — fallback a load completo.
            const durationMsLogged = sentenceStartTimeRef.current > 0 ? durationMs : null;
            log('sentence_time', { index: currentIdx, durationMs: durationMsLogged, gapless: false, speed: ctx.speedRef.current });
            log('sentence_advanced', { from: currentIdx, to: nextIdx });
            load(nextIdx, true);
        }
    }, [getAudioUrl, load, prefetch]);

    // ── HANDLE AUDIO ERROR — blob inválido o formato no soportado ───────────
    // Disparado por onError del elemento <audio>. El browser intentó decodificar
    // el blob y falló (corrupción, codec no soportado, URL revocada prematuramente).
    // Elimina el blob inválido del cache y transiciona a 'error'.
    const handleAudioError = useCallback((errorPlayer: 'A' | 'B'): void => {
        if (ctx.unmountedRef.current) return;
        if (statusRef.current === 'idle') return; // no hubo intento de play — ignorar

        const el = errorPlayer === 'A' ? audioRefA.current : audioRefB.current;
        const idx = currentIdxRef.current;

        // Limpiar blob inválido del cache para que el siguiente intento haga fetch real
        const key = toChunkKey(idx);
        const blobUrl = audioCache.current.get(key);
        if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
            audioCache.current.delete(key);
        }
        if (el) el.src = '';

        setStatus('error');
        log('blob_invalid', {
            index: idx,
            player: errorPlayer,
            error: el?.error?.message ?? 'MediaError',
            code: el?.error?.code,
        });
    }, []);

    // ── RESET — borra todo el estado de audio (para transiciones de contenido) ─
    const reset = useCallback((): void => {
        loadToken.current++;

        audioCache.current.forEach(url => URL.revokeObjectURL(url));
        audioCache.current.clear();
        abortCtrls.current.forEach(ctrl => ctrl.abort('Content reset'));
        abortCtrls.current.clear();
        inFlight.current.clear();

        const pA = audioRefA.current;
        const pB = audioRefB.current;
        pA?.pause();
        pB?.pause();
        if (pA) pA.src = '';
        if (pB) pB.src = '';

        activePlayer.current    = 'A';
        currentIdxRef.current   = 0;
        standbyReadyRef.current = false;
        standbyGenRef.current++;          // invalida cualquier listener canplaythrough del ciclo anterior
        sentenceStartTimeRef.current = 0; // sin sesión activa — durationMs será null en el primer log
        setCurrentIndex(0);
        setStatus('idle');
    }, []);

    return {
        audioRefA,
        audioRefB,
        status,
        isPlaying: status === 'playing',
        currentIndex,
        load,
        pause,
        resume,
        skip,
        handleEnded,
        handleAudioError,
        prefetch,
        runGC,
        reset,
    };
}
