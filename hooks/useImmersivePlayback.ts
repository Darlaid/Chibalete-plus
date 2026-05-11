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
// INVARIANTE 7/8/9 — helpers puros compartidos (testeados unitariamente en
// utils/__tests__/immersiveTiming.test.js). Cualquier cambio aquí debe ir
// acompañado de cambios en los tests; pre-build gate `npm run test:immersive`.
import { estimateMinSentenceMs, validateAudioDuration } from '../utils/immersiveTiming.js';

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
    | 'sentence_floor_applied'  // PB_TIMING audit: el piso mínimo retrasó el avance
    | 'audio_metadata'           // PB_TIMING audit: audio.duration / readyState al arrancar play
    | 'audio_cache_invalidated'  // INV-9: blob cacheado descartado por duración inválida
    | 'index_scheduled'          // INV-13/17: avance fue agendado (NO confundir con commit)
    | 'index_commit'             // INV-13/17: setIdx(nextIdx) acaba de ejecutarse
    | 'pending_advance_cancelled' // INV-15: timer pendiente cancelado por pause/skip/block/etc.
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

// Tag para PlaybackEvent — añadimos audio_cache_invalidated cuando INV-9 detecta
// un blob cacheado con duración sospechosa para wordCount visible.
type _ExtraEvents = 'audio_cache_invalidated';

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
    /**
     * Avanza una oración desde el índice actual (lectura ágil del ref interno,
     * no del state — evita la race con React batching cuando se hace click
     * justo al terminar una oración auto-advanced).
     */
    skipNext:    () => void;
    /** Retrocede una oración desde el índice actual. Clamp en 0. */
    skipPrev:    () => void;
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

// estimateMinSentenceMs vive en utils/immersiveTiming.js (importado arriba).
// Esta función está testeada unitariamente — ver utils/__tests__/immersiveTiming.test.js

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
    if (event === 'play_start' || event === 'sentence_advanced' || event === 'sentence_time' || event === 'sentence_rhythm' || event === 'sentence_skipped' || event === 'playback_paused' || event === 'sentence_floor_applied' || event === 'audio_metadata' || event === 'audio_cache_invalidated' || event === 'index_scheduled' || event === 'index_commit' || event === 'pending_advance_cancelled') {
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

    // ── INV-13/15: timers pendientes del avance de frase ─────────────────────
    // Antes vivían dentro de setTimeout/listener anónimos. Ahora se trackean
    // explícitamente para que pause/skip/block_complete/cleanup puedan
    // cancelarlos. Sin esta cancelación, un setTimeout(doAdvance, 1339ms)
    // pendiente seguía corriendo después de un pause y disparaba el callback
    // que early-returneaba silenciosamente — pero el LOG sentence_advanced
    // ya se había emitido, descuadrando observabilidad y dejando el visor
    // en estado "dudando" entre el índice viejo y el nuevo.
    const pendingAdvanceTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingFallbackTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingCanplaythroughCleanupRef = useRef<(() => void) | null>(null);

    // Track de keys ya re-invalidadas en handleEnded para evitar invalidaciones
    // repetidas (cada handleEnded inspecciona la misma key — si el cache ya
    // fue invalidado, no hay que loguear de nuevo).
    const cacheInvalidatedKeysRef = useRef(new Set<number>());

    const setStatus = (s: PlaybackStatus) => {
        statusRef.current = s;
        setStatusState(s);
    };

    // Único punto de escritura del índice. Actualiza ref (sync) + state (React) + callback.
    const setIdx = (idx: number) => {
        // [RS-DEBUG] traza para diagnostico de reading-sync — remover en cleanup
        currentIdxRef.current = idx;
        setCurrentIndex(idx);
        ctx.onIndexChange.current(idx);
    };

    // ── INV-15: cancelación centralizada de avance pendiente ─────────────────
    // Cancela el setTimeout de doAdvance, el fallback de 80ms y el listener
    // canplaythrough — los tres caminos por los que un avance pendiente puede
    // dispararse. Idempotente: si no hay nada pendiente, no loguea ni rompe.
    //
    // DEBE invocarse en:
    //   - pause()                        (usuario pausa explícitamente)
    //   - load()/skip()                  (resync duro a otro índice)
    //   - reset()                        (cambio de contenido)
    //   - cleanup useEffect              (unmount)
    //   - BlockEngine.complete (vía pb.pause en VisorInmersivo)
    //   - inicio de handleEnded          (defensa: nuevo onEnded → cancelar pendiente previo)
    const cancelPendingAdvance = (reason: 'pause' | 'skip_or_load' | 'content_reset' | 'unmount' | 'new_handleEnded'): void => {
        let cancelled = false;
        if (pendingAdvanceTimerRef.current !== null) {
            clearTimeout(pendingAdvanceTimerRef.current);
            pendingAdvanceTimerRef.current = null;
            cancelled = true;
        }
        if (pendingFallbackTimerRef.current !== null) {
            clearTimeout(pendingFallbackTimerRef.current);
            pendingFallbackTimerRef.current = null;
            cancelled = true;
        }
        if (pendingCanplaythroughCleanupRef.current !== null) {
            pendingCanplaythroughCleanupRef.current();
            pendingCanplaythroughCleanupRef.current = null;
            cancelled = true;
        }
        if (cancelled) {
            // pbLog directo (no `log`) porque `log` aún no está definido aquí.
            // El payload incluye userIdRef capturado al call time.
            pbLog('pending_advance_cancelled', {
                reason,
                userId: ctx.userIdRef.current,
                index: currentIdxRef.current,
            });
        }
    };

    // ── Cleanup al desmontar ─────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            cancelPendingAdvance('unmount');
            loadToken.current++;
            standbyGenRef.current++;  // invalida cualquier listener canplaythrough pendiente
            audioCache.current.forEach(url => URL.revokeObjectURL(url));
            audioCache.current.clear();
            abortCtrls.current.forEach(ctrl => ctrl.abort('Unmount'));
            abortCtrls.current.clear();
            inFlight.current.clear();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // [RS-DEBUG]
        if (ctx.unmountedRef.current) {
            return;
        }
        if (index < 0 || index >= ctx.sentencesRef.current.length) {
            return;
        }

        // INV-15/16: load() es invocado por skip() y por load directo del visor.
        // Cualquier avance pendiente del ciclo anterior debe cancelarse ANTES
        // de cambiar tokens — si no, el setTimeout del ciclo viejo dispararía
        // doAdvance que early-returnea por token, pero ya emitió el log.
        cancelPendingAdvance('skip_or_load');

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
            // OPTIMISTIC status (2026-04-26 hotfix): emitir 'playing' INMEDIATAMENTE.
            // El UI ya refleja la intencion del usuario; si play() falla, retrocedemos.
            // Esto evita que la UI quede atascada en 'loading' cuando un click rapido
            // produce AbortError silencioso en el .catch (token-stale chains).
            setStatus('playing');
            ctx.onPlayChange.current(true);
            sentenceStartTimeRef.current = Date.now();

            pActive.play()
                .then(() => {
                    // Confirmacion. Status ya es 'playing'; solo loggeamos.
                    const wasCached = audioCache.current.has(toChunkKey(index));
                    log('play_start', { index, cached: wasCached });
                    const liveDuration = Number.isFinite(pActive.duration) ? pActive.duration : null;
                    log('audio_metadata', {
                        index,
                        cached: wasCached,
                        duration: liveDuration,
                        readyState: pActive.readyState,
                        textLen: ctx.sentencesRef.current[index]?.length ?? 0,
                    });
                    // INVARIANTE 9 — validar duración del audio contra texto visible.
                    // Si la cache trae un blob con duración imposible (incidente Dinah:
                    // 0.18s para frase de 4 palabras), evictamos para que el siguiente
                    // intento haga re-fetch del TTS. NO interrumpe esta reproducción;
                    // el piso de handleEnded protege la duración visual del usuario.
                    if (wasCached) {
                        const audit = validateAudioDuration({
                            displayText: ctx.sentencesRef.current[index] ?? '',
                            spokenText:  ctx.audioSentencesRef.current[index] ?? '',
                            duration:    liveDuration,
                            cached:      true,
                            speed:       ctx.speedRef.current,
                        });
                        if (audit.status === 'invalid') {
                            const key = toChunkKey(index);
                            const blobUrl = audioCache.current.get(key);
                            if (blobUrl) {
                                URL.revokeObjectURL(blobUrl);
                                audioCache.current.delete(key);
                                log('audio_cache_invalidated', {
                                    index, key, duration: liveDuration,
                                    minExpectedMs: audit.minExpectedMs,
                                    wordCount: audit.wordCount,
                                    reason: audit.reason,
                                });
                            }
                        }
                    }
                })
                .catch((e: DOMException) => {
                    if (token !== loadToken.current || ctx.unmountedRef.current) return;
                    // AbortError: otro skip mas nuevo abortó este play. El nuevo ciclo
                    // setea su propio status — no tocamos status aqui para no pisar al ciclo
                    // mas reciente. Solo log.
                    if (e.name === 'AbortError') {
                        log('load_cancelled', { index, reason: 'play_aborted_by_newer_skip' });
                        return;
                    }
                    if (e.name === 'NotAllowedError') {
                        setStatus('blocked');
                        ctx.onPlayChange.current(false);
                        log('autoplay_blocked', { index, error: e.name });
                    } else {
                        setStatus('error');
                        ctx.onPlayChange.current(false);
                        log('play_fail', { index, error: e.name, message: e.message });
                    }
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
        // INV-15: cancelar cualquier setTimeout(doAdvance) pendiente del último
        // handleEnded. Sin esto, un avance agendado por floor seguiría corriendo
        // 1.4s después del pause y dispararía el callback que early-returnea
        // por statusRef !== 'playing' — pero ya emitió sentence_advanced log,
        // creando observabilidad confusa. Además fuente del drift visual cuando
        // BlockEngine.complete invocaba pb.pause con un advance ya agendado.
        cancelPendingAdvance('pause');
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
        // [RS-DEBUG]
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

    // ── SKIP NEXT/PREV — leen del REF, no del state, para evitar race con React batching ────
    // Resuelve el bug donde click en "avanzar" justo al terminar una oración
    // (durante handleEnded auto-advance) producia delta=0 y reiniciaba la misma oracion.
    const skipNext = useCallback((): void => {
        const ref = currentIdxRef.current;
        skip(ref + 1);
    }, [skip]);

    const skipPrev = useCallback((): void => {
        const ref = currentIdxRef.current;
        skip(Math.max(0, ref - 1));
    }, [skip]);

    // ── HANDLE ENDED — transición gapless entre fragmentos ───────────────────
    //
    // ⚠️ INVARIANTES 2, 7, 9, 13, 14, 15, 17 — protecciones críticas:
    //   - INV-2: este callback NUNCA debe navegar a otro contentId.
    //   - INV-7: el avance al next sentence se posterga por `floorRemaining`.
    //   - INV-9: blob cacheado con duración imposible se invalida (cache+gapless).
    //   - INV-13/14: setIdx(nextIdx) y log sentence_advanced viven DENTRO de
    //     doAdvance — visual/progress no se commitean hasta que se cumple el
    //     piso y los guards (token, status, unmount). Antes el log se emitía
    //     prematuramente, dando observabilidad confusa.
    //   - INV-15: el setTimeout y listener canplaythrough se trackean en refs
    //     (pendingAdvanceTimerRef, etc.) para que pause/skip/block_complete
    //     puedan cancelarlos.
    //   - INV-17: dos eventos distintos: 'index_scheduled' (se agendó avance)
    //     vs 'index_commit' (setIdx ejecutado).
    //
    // Ver docs/immersive-mode-invariants.md y los tests:
    //   utils/__tests__/immersiveTiming.test.js     (INV-7, 9)
    //   utils/__tests__/immersiveNavigation.test.js (INV-2)
    //   hooks/__tests__/playbackStateMachine.test.js (INV-13/14/15/17 estructural)
    const handleEnded = useCallback(async (endedPlayer: 'A' | 'B'): Promise<void> => {
        // [RS-DEBUG]
        if (ctx.unmountedRef.current) return;
        if (statusRef.current !== 'playing') return;

        // INV-15: si llegó un nuevo onEnded mientras había un advance previo
        // pendiente (caso raro pero posible si el audio se hace 0ms o hay
        // double-fire del element), descartar lo viejo.
        cancelPendingAdvance('new_handleEnded');

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

        // ── PB_TIMING: piso mínimo de duración visible ──────────────────────
        // Defensa contra avance prematuro cuando audio.onended fire <300ms para una
        // oración con muchas palabras. Si rawDuration < min, postergamos TODO el
        // avance (visual + audio) hasta cumplir el piso. Sin esto, el visor saltaba
        // de "Dinah era su gata" en 182ms (síntoma reportado por usuario).
        const currentText  = ctx.sentencesRef.current[currentIdx] ?? '';
        const minMs        = estimateMinSentenceMs(currentText, ctx.speedRef.current);
        const floorRemaining = Math.max(0, minMs - durationMs);
        const wordCount    = currentText.trim().split(/\s+/).filter(Boolean).length;
        const wasCached    = audioCache.current.has(toChunkKey(currentIdx));

        // ── INV-9 en path gapless: si el blob cacheado actual dio durationMs
        // sospechosamente corto para wordCount, evictarlo para que el próximo
        // acceso (skip back, reload, nueva sesión) haga re-fetch fresco. La
        // validación en `load.then(audio_metadata)` solo cubría el primer play;
        // en transiciones gapless el blob defectuoso quedaba cacheado forever.
        if (wasCached && wordCount >= 3 && durationMs < 300) {
            const key = toChunkKey(currentIdx);
            if (!cacheInvalidatedKeysRef.current.has(key)) {
                cacheInvalidatedKeysRef.current.add(key);
                const url = audioCache.current.get(key);
                if (url) {
                    URL.revokeObjectURL(url);
                    audioCache.current.delete(key);
                }
                log('audio_cache_invalidated', {
                    index: currentIdx,
                    key,
                    durationMs,
                    wordCount,
                    text: currentText,
                    reason: 'short_duration_on_gapless_end',
                });
            }
        }

        if (nextEl?.src) {
            // B4: durationMs solo es válido si sentenceStartTimeRef fue seteado por play().
            const durationMsLogged = sentenceStartTimeRef.current > 0 ? durationMs : null;
            log('sentence_time', { index: currentIdx, durationMs: durationMsLogged, gapless: standbyReadyRef.current, speed: ctx.speedRef.current });
            // INV-17: NO emitir 'sentence_advanced' aquí — esto es scheduling.
            // El evento de commit se emite dentro de doAdvance (post setIdx).

            nextEl.playbackRate = ctx.speedRef.current;

            // doAdvance — único punto de commit del avance. Hace setIdx, log
            // sentence_advanced/index_commit, reset de sentenceStartTime y play.
            // Guards: capturedToken, unmounted, statusRef. Si cualquiera falla,
            // NO commitea nada — visual, progreso y log quedan en currentIdx.
            const doAdvance = () => {
                // Consumir el timer ref que disparó este callback (no quedar nulo
                // si pause/skip llegaron primero — cancelPendingAdvance ya lo limpió).
                pendingAdvanceTimerRef.current = null;
                if (capturedToken !== loadToken.current) return;
                if (ctx.unmountedRef.current) return;
                if (statusRef.current !== 'playing') return;

                // ── COMMIT visual + log (INV-17: index_commit ANTES de sentence_advanced) ──
                setIdx(nextIdx);
                log('index_commit', { from: currentIdx, to: nextIdx, committedAt: 'doAdvance' });
                log('sentence_advanced', { from: currentIdx, to: nextIdx });

                // B4: timestamp de inicio real — después de delay y justo antes de play().
                sentenceStartTimeRef.current = Date.now();
                nextEl.play()
                    .then(() => {
                        if (capturedToken !== loadToken.current) return;
                    })
                    .catch((e: DOMException) => {
                        if (capturedToken !== loadToken.current) return;
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

                standbyReadyRef.current = false;
            };

            // ── Combinar rhythm + floor — el delay efectivo es el max de ambos ──
            const meta     = classifySentence(currentText);
            const rawDelay = computeNarrativeDelay(meta);
            const speed    = ctx.speedRef.current;
            const rhythmMs = speed >= 1.25 ? 0
                           : speed > 1    ? Math.max(15, Math.round(rawDelay / speed))
                           : rawDelay;
            const finalDelay = Math.max(rhythmMs, floorRemaining);

            if (floorRemaining > 0) {
                log('sentence_floor_applied', {
                    index:           currentIdx,
                    text:            currentText,
                    wordCount,
                    charCount:       currentText.length,
                    rawDurationMs:   durationMs,
                    minMs,
                    floorRemaining,
                    finalDelay,
                    cached:          wasCached,
                    via:             'gapless',
                });
            }
            log('sentence_rhythm', { from: currentIdx, to: nextIdx, rawDelay, delayApplied: finalDelay, type: meta.type, tone: meta.tone, speed, floorMs: floorRemaining });

            // INV-17: log de "scheduled" — NO confundir con commit. El commit
            // sucede dentro de doAdvance si pasa los guards.
            log('index_scheduled', {
                from:           currentIdx,
                to:             nextIdx,
                reason:         floorRemaining > 0 ? 'floor' : (standbyReadyRef.current ? 'rhythm' : 'canplaythrough'),
                floorRemaining,
                rhythmMs,
                finalDelay,
            });

            // ── INV-15: agendar avance con refs cancelables ───────────────
            if (standbyReadyRef.current || finalDelay > 80) {
                pendingAdvanceTimerRef.current = setTimeout(doAdvance, finalDelay);
            } else {
                let triggered = false;
                pendingFallbackTimerRef.current = setTimeout(() => {
                    if (!triggered) {
                        triggered = true;
                        pendingFallbackTimerRef.current = null;
                        if (pendingCanplaythroughCleanupRef.current) {
                            pendingCanplaythroughCleanupRef.current();
                            pendingCanplaythroughCleanupRef.current = null;
                        }
                        doAdvance();
                    }
                }, Math.max(80, finalDelay));
                const cpListener = () => {
                    if (!triggered) {
                        triggered = true;
                        if (pendingFallbackTimerRef.current !== null) {
                            clearTimeout(pendingFallbackTimerRef.current);
                            pendingFallbackTimerRef.current = null;
                        }
                        pendingCanplaythroughCleanupRef.current = null;
                        doAdvance();
                    }
                };
                nextEl.addEventListener('canplaythrough', cpListener, { once: true });
                pendingCanplaythroughCleanupRef.current = () => {
                    nextEl.removeEventListener('canplaythrough', cpListener);
                };
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
            // Player en espera no tenía audio — fallback a load completo. Aplicar piso aquí también.
            const durationMsLogged = sentenceStartTimeRef.current > 0 ? durationMs : null;
            log('sentence_time', { index: currentIdx, durationMs: durationMsLogged, gapless: false, speed: ctx.speedRef.current });
            // INV-17: NO logueamos sentence_advanced aquí. load(nextIdx) eventualmente
            // llamará setIdx(nextIdx) y el commit log saldrá desde ahí.

            const goLoad = () => {
                pendingAdvanceTimerRef.current = null;
                if (capturedToken !== loadToken.current) return;
                if (ctx.unmountedRef.current) return;
                if (statusRef.current !== 'playing') return;
                // load() llama internamente a setIdx — visual + progress se commitean ahí.
                // INV-17: index_commit ANTES de sentence_advanced.
                log('index_commit', { from: currentIdx, to: nextIdx, committedAt: 'fallback_load' });
                log('sentence_advanced', { from: currentIdx, to: nextIdx });
                load(nextIdx, true);
            };

            if (floorRemaining > 0) {
                log('sentence_floor_applied', {
                    index:           currentIdx,
                    text:            currentText,
                    wordCount,
                    charCount:       currentText.length,
                    rawDurationMs:   durationMs,
                    minMs,
                    floorRemaining,
                    finalDelay:      floorRemaining,
                    cached:          wasCached,
                    via:             'fallback_load',
                });
                log('index_scheduled', {
                    from:           currentIdx,
                    to:             nextIdx,
                    reason:         'floor_fallback_load',
                    floorRemaining,
                    rhythmMs:       0,
                    finalDelay:     floorRemaining,
                });
                pendingAdvanceTimerRef.current = setTimeout(goLoad, floorRemaining);
            } else {
                goLoad();
            }
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
        cancelPendingAdvance('content_reset');
        cacheInvalidatedKeysRef.current.clear();
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
        skipNext,
        skipPrev,
        handleEnded,
        handleAudioError,
        prefetch,
        runGC,
        reset,
    };
}
