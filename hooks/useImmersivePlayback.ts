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

import type * as React from 'react';
import { useRef, useState, useCallback, useEffect } from 'react';
import { usePlaybackAnalytics } from './usePlaybackAnalytics';
// INVARIANTE 7/8/9 — helpers puros compartidos (testeados unitariamente en
// utils/__tests__/immersiveTiming.test.js). Cualquier cambio aquí debe ir
// acompañado de cambios en los tests; pre-build gate `npm run test:immersive`.
import { estimateMinSentenceMs, validateAudioDuration } from '../utils/immersiveTiming.js';
// M-5.3.4: execution layer — strategies de sincronización por SentenceAudioMode.
import { executeSyncStrategy } from '../utils/syncStrategyExecutor.mjs';
// BLOCKER FINAL V2 / TASK 2 — decisión pura del invariante de transición de
// chunk. El hook USA esta misma función que los tests ejercen (no simulación).
import { decideChunkTransition } from '../utils/gaplessChunkGuard.mjs';
// HF4A — clasificación pura recuperable/persistente + regla clear-on-valid-url.
// El hook USA estas funciones; los tests (utils/__tests__/immersiveAudioRecovery
// .test.mjs) ejercen el mismo código de decisión, no una simulación.
import {
    classifyAudioFailure,
    shouldClearFailure,
    // HF4A-R2 — regla rectora de triple coherencia (token/índice/completion).
    evaluateRecoveryCoherence,
} from '../utils/immersiveAudioRecovery.mjs';
import { uploadsUrl } from '../utils/mediaBaseUrl';
// F3 — state machine como gobierno observacional del runtime. La machine
// recibe acciones reales (PREPARE_SENTENCE, AUDIO_STARTED, AUDIO_ENDED,
// SENTENCE_COMPLETED, PAUSE, SKIP, CONTENT_CHANGE) y mantiene el
// activeSentenceBuffer. En F3 NO controla el audio — solo observa y emite
// logs estructurados. El gating duro (REQUEST_AUDIO_START / BLOCK_AUDIO_START)
// es F4.
import {
    initialState as machineInit,
    reduce as machineReduce,
    Actions as MA,
} from '../utils/immersivePlaybackMachine.js';

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
    /**
     * M-5.3.4: anchorsMap por chunkIndex — para sincronización dentro de
     * chunks multifrase (perChunkWithAnchors). Estructura:
     *   { [chunkIdx: number]: ContextualAnchor[] }
     * Opcional: si no se pasa, el executor degrada a perChunkNoAnchors.
     */
    anchorsMapRef?:    React.MutableRefObject<Record<number, any[]> | null>;
    /**
     * M-5.3.4: modo de audio detectado para el contenido actual. El visor lo
     * setea via `detectSentenceAudioMode` en el bootstrap del libro.
     * Si null o ausente, el hook degrada a perSentence (path legacy).
     */
    audioModeRef?:     React.MutableRefObject<
        'perSentence' | 'perChunkWithAnchors' | 'perChunkNoAnchors' | 'ttsDynamic' | 'unknown' | null
    >;
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

export interface PlaybackLoadOptions {
    /**
     * HF2: cuando el primer play viene de una posicion restaurada, el primer
     * audio audible debe anclarse a la frase visual activa. En audio chunked,
     * esto fuerza TTS por frase para no reproducir el chunk desde 0.
     */
    anchorFirstAudio?: boolean;
    /** Fuerza TTS por frase, saltando manifest/cache de chunk. */
    forceSentenceTts?: boolean;
    /** Motivo corto para logs operativos. */
    reason?: string;
}

// Tag para PlaybackEvent — añadimos audio_cache_invalidated cuando INV-9 detecta
// un blob cacheado con duración sospechosa para wordCount visible.
type _ExtraEvents = 'audio_cache_invalidated';

/**
 * F7 — snapshot read-only del estado runtime de la machine. Lo expone el hook
 * para que el visor pueda validar el contrato de frase activa sin importar
 * la machine ni mantener refs mutables.
 */
export interface MachineSnapshot {
    status:           string;
    committedIndex:   number;
    visualIndex:      number;
    audioIndex:       number;
    progressIndex:    number;
    pendingTransition: {
        id:                number;
        fromIndex:         number;
        toIndex:           number;
        reason:            string;
        visualAckReceived: boolean;
        requireVisualAck:  boolean;
    } | null;
    buffer: {
        current: {
            index:                    number;
            // M-5.4.6 — 'preparing' y 'visible' colapsados en 'reading'.
            status:                   'preparing' | 'reading' | 'completed' | 'cancelled';
            audioStarted:             boolean;
            audioEnded:               boolean;
            progressEligible:         boolean;
            transitionId:             number;
        } | null;
        next: {
            index:        number;
            status:       'preparing' | 'visible' | 'reading' | 'completed' | 'cancelled';
            transitionId: number;
        } | null;
        locked: boolean;
    };
    // M-5.4.6 (DEMOLITION Phase 1.a) — Campos lastAdvanceWithinChunkAt /
    // ChunkKey / lastManualNavAt eliminados junto con el drift detector que
    // los consumía. La machine snapshot vuelve a ser un read del estado real
    // de la máquina, sin metadatos para suprimir hard_resync.
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
    load:        (index: number, autoPlay?: boolean, options?: PlaybackLoadOptions) => Promise<void>;
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
    /**
     * INV-14: ¿hay un timer/listener de advance pendiente?
     * El visor lo usa para BLOQUEAR PROGRESS_SAVE de índices "futuros" que
     * todavía no fueron commiteados. No-side-effect; sólo lee refs internos.
     */
    isPendingAdvance: () => boolean;
    /**
     * F3: notifica a la state machine que el DOM confirmó el highlight visual
     * de `index`. El visor llama esto desde su useLayoutEffect tras validar
     * el active sentence contract. En F3 es observacional; F4 lo usará para
     * gating duro de REQUEST_AUDIO_START.
     */
    acknowledgeVisualHighlight: (index: number) => void;
    /**
     * F3: notifica que BlockEngine completó el bloque. El visor lo llama
     * desde el subscribe('complete'). La machine cancela buffer y entra en
     * status='block_completed'. F7 conectará esto desde el visor.
     */
    notifyBlockComplete: () => void;
    /**
     * F5: ¿se puede guardar progreso para `index` AHORA?
     * Read-only — no muta state, no emite logs. El visor lo llama desde su
     * effect de PROGRESS_SAVE; si retorna { ok: false }, NO guardar y loguear
     * `PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION` con el reason.
     *
     * Reglas duras (regla madre — INV-19):
     *   - buffer.current existe e index coincide
     *   - status === 'completed'
     *   - visualHighlightConfirmed && audioStarted && audioEnded
     *   - progressEligible === true
     *   - buffer.next === null  (sin gapless prefetch pendiente)
     *   - sin pendingAdvance (timer pendiente del autoadvance)
     *
     * No hace hardResync — bloquear progreso NO debe afectar playback.
     */
    canSaveProgress: (index: number) => { ok: boolean; reason?: string };
    /**
     * F6: hardResync formal — recuperación dura ante estado inseguro.
     *
     * Cancela todos los timers/listeners pendientes, pausa ambos audios,
     * cancela el buffer de la machine, deja el playback en 'paused' y NO
     * reproduce audio automáticamente. El siguiente play() del usuario pasará
     * por load() → ack → REQUEST_AUDIO_START gate.
     *
     * Usar este método (no pb.skip) ante:
     *   - drift detection (2 strikes)
     *   - active_sentence_missing / duplicate / mismatch
     *   - audio_start_without_highlight
     *   - resume_without_active_sentence
     *   - cualquier estado inseguro detectado por validators externos
     *
     * skip() del usuario sigue siendo distinto: es una navegación intencional.
     */
    hardResync: (targetIndex: number, reason: string) => void;
    /**
     * F7: snapshot read-only del estado runtime de la machine. El visor lo
     * llama desde el drift detector para validar el contrato completo de
     * frase activa sin importar la machine ni mantener refs mutables.
     *
     * No expone referencias internas — todo es copia plana de primitivos.
     */
    getMachineSnapshot: () => MachineSnapshot;
    /**
     * F11: bootstrap explícito de la frase activa. Dispatcha PREPARE_SENTENCE
     * sin tocar audio. Usado por el visor cuando detecta que el buffer no
     * tiene current para el currentIndex (caso típico: primer render al
     * abrir un libro nuevo o al restaurar progreso).
     *
     * Idempotente: si ya hay buffer.current.index === index, no muta.
     * Reason: 'initial_bootstrap' / 'resume_bootstrap' / 'restore_bootstrap'.
     */
    prepareSentence: (index: number, reason: string) => void;
    /**
     * F11: ¿el buffer está preparado para `index`? Read-only.
     * True si buffer.current.index === index y buffer no está locked.
     * El visor lo llama antes de emitir visual_highlight_ack para evitar
     * el ack temprano sobre un buffer vacío.
     */
    isPreparedForIndex: (index: number) => boolean;
    /**
     * M-5.3 (rev M-5.3.3): ¿el buffer del index ya recibió ack visual?
     *
     * Pregunta semántica: "¿este index ya fue confirmado?" (visualHighlightConfirmed
     * es monotónico — verdadero durante 'visible' / 'reading' / 'completed').
     * NO confundir con canStartAudio (interno, exige status='visible').
     *
     * True SOLO si buffer.current existe Y .index === index Y
     * .visualHighlightConfirmed === true. Read-only, no muta, no emite eventos.
     */
    isVisuallyAckedForIndex: (index: number) => boolean;
    /**
     * F12: ¿el audio para `index` está marcado como fallido? Read-only.
     * Un index queda marcado tras tts_fail o NotSupportedError post-retry.
     * No re-intentar play() automáticamente sobre estos índices.
     */
    isAudioFailed: (index: number) => boolean;
    /**
     * F12: chequeo previo de audio readiness. Emite PB_AUDIO_READY_CHECK +
     * PB_AUDIO_READY / PB_AUDIO_READY_FAILED. Devuelve estado actual.
     * Útil para que el visor o tests puedan consultar sin disparar play.
     */
    ensurePlayableAudio: (index: number) => Promise<{ ok: boolean; reason?: string; source?: 'cache' | 'tts' }>;
    /**
     * HF4A: reintento manual de audio para la frase ACTIVA. Limpia sólo el
     * fallo RECUPERABLE del índice actual (no estados globales, no fallos
     * persistentes) y re-invoca load() con autoPlay. Pensado para el botón
     * "Reintentar" del visor cuando el status quedó en 'error'. Emite
     * PB_AUDIO_RETRY_MANUAL. Sin auto-retry: sólo corre por gesto del usuario.
     */
    retryAudio: () => void;
    /**
     * F16: snapshot de diagnóstico universal cuando un play no inicia audio.
     * El visor lo dispara en setTimeout(1500ms) tras togglePlay si no llegó
     * AUDIO_STARTED. Devuelve un objeto plano con el estado completo del
     * sistema para identificar exactamente cuál contrato falla.
     */
    getStartDiagnostic: (index: number) => Record<string, any>;
    /**
     * F13: navegación local pura del usuario (botones anterior/siguiente).
     * NO inicia audio. NO guarda progreso. NO dispara blockComplete. NO
     * cambia contentId. NO usa hardResync. Solo:
     *   - pause audio actual + cancelPendingAdvance
     *   - prepareSentence(targetIndex) en la machine
     *   - setIdx(targetIndex) — el visor revela y emite ack
     *   - status='paused' — el user reanudará con play
     * Si el user toca play después, el flujo normal load(idx,true) + ack +
     * REQUEST_AUDIO_START + audio readiness se ejecuta.
     *
     * El index se clampa a [0, sentences.length - 1]. Si target === current,
     * es no-op + log PB_MANUAL_JUMP_BLOCKED reason=same_index.
     */
    manualSentenceJump: (targetIndex: number, reason: string) => void;
    /**
     * M-5.4 — snapshot estructural READ-ONLY del runtime vivo.
     *
     * Pensado para: console debugging, smoke tests, watchdog, telemetría
     * futura. NO muta nada. NO emite eventos por sí mismo. Devuelve copia
     * plana serializable (sin refs ni funciones).
     *
     * Campos: sessionId, contentId, currentSentence/Chunk, audioMode,
     * syncStrategy, playbackState, audio src activo/standby, executor activo,
     * timers pendientes, hardResync count, cache entries, ownership tokens,
     * visualAck state, machine buffer state, timestamps de últimos eventos.
     */
    getRuntimeDiagnostics: () => Record<string, any>;
    /**
     * M-5.3.4 — avance visual liviano dentro del MISMO chunk de audio.
     *
     * El audio NO se recarga, NO se reinicia. Solo:
     *   - dispatchMachine PREPARE_SENTENCE(toIndex) → buffer 'preparing'
     *   - setIdx(toIndex) → React state se actualiza
     *   - Visor reveal + acknowledgeVisualHighlight → buffer 'visible'
     *   - dispatchMachine AUDIO_STARTED(toIndex) → buffer 'reading'
     *
     * Pre-condiciones (caller debe garantizar):
     *   - toChunkKey(toIndex) === toChunkKey(currentIdxRef.current)
     *   - audio del chunk YA está reproduciendo (status === 'playing')
     *
     * Logs: CHUNK_AUDIO_REUSE / CHUNK_AUDIO_SKIP_RELOAD.
     */
    advanceWithinChunk: (toIndex: number) => void;
}

// ── Constantes ───────────────────────────────────────────────────────────────

const PREFETCH_WINDOW = 5;
const SENTENCE_TTS_CACHE_KEY_OFFSET = 1_000_000_000;

function toSentenceTtsCacheKey(index: number): number {
    return -(SENTENCE_TTS_CACHE_KEY_OFFSET + index);
}

function isSentenceTtsCacheKey(key: number): boolean {
    return key <= -SENTENCE_TTS_CACHE_KEY_OFFSET;
}

function fromSentenceTtsCacheKey(key: number): number {
    return -key - SENTENCE_TTS_CACHE_KEY_OFFSET;
}

// ── HF3 — recuperación de audio en el primer TTS lento/grande ─────────────────
// Timeout real para fallos genuinos, pero sin castigar textos largos sin reintento.
const TTS_PRIMARY_TIMEOUT_MS = 20000;   // intento 1: frase completa
const TTS_FALLBACK_TIMEOUT_MS = 15000;  // intento 2: unidad corta
const TTS_FALLBACK_MAX_CHARS = 220;     // umbral de la unidad hablable de fallback

// Devuelve la primera unidad hablable de `text`, acotada a `maxChars`, partiendo
// por puntuación de frase/cláusula y, en último caso, por límite de palabra. Nunca
// devuelve vacío si la entrada no lo está. Sin lookbehind (compat. Safari antiguo).
function firstSpeakableUnit(text: string, maxChars: number): string {
    const trimmed = (text ?? '').trim();
    if (trimmed.length <= maxChars) return trimmed;
    const tokens = trimmed.match(/[^.!?…;:\n]+[.!?…;:\n]*\s*/g) || [trimmed];
    let unit = '';
    for (const tk of tokens) {
        if (unit && (unit + tk).length > maxChars) break;
        unit += tk;
        if (unit.length >= maxChars) break;
    }
    unit = unit.trim();
    if (!unit || unit.length > maxChars) {
        // Ninguna frontera de cláusula dentro del presupuesto → corte por palabra.
        const head = trimmed.slice(0, maxChars);
        const lastSpace = head.lastIndexOf(' ');
        unit = (lastSpace > 0 ? head.slice(0, lastSpace) : head).trim();
    }
    return unit;
}

// F10 — tiempo máximo que el hook espera por el ack visual del visor antes de
// considerar fallido el primer play o el autoadvance. Debe ser >=
// M-5.4.6 — VISUAL_READY_TIMEOUT_MS conservada por compatibilidad con
// canStartAudio/waitForVisualAck (que pronto removeremos en Phase 1.b.5).
// Cuando esas funciones se borren, esta constante también.
const VISUAL_READY_TIMEOUT_MS = 800;

// F19/Cambio C — cap defensivo de hardResync por sesión. hardResync es
// recuperación EXCEPCIONAL, no mecanismo normal. Después de N intentos
// dentro de la misma session (contentSessionRef), no más auto-retry —
// status='error' y el user decide.
const MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION = 2;

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

// F17 — dedupe Set de tags de error ya logueados al backend para no spammear
// /api/events 400 si el server rechaza un event type particular. Single-shot
// por (event tag) durante el lifetime de la pestaña — el debugger humano ve
// el primer error y los siguientes solo van a console.warn.
const _telemetryFailedTags = new Set<string>();

// F17 — sanitización defensiva del payload antes de enviar al backend.
// Reglas:
//   1. Si payload.userId falta o vacío → no enviar.
//   2. Si payload contiene campos circulares/no-serializables → no enviar.
//   3. JSON.stringify dentro de try/catch — never throw.
function _sanitizeAndStringify(payload: Record<string, unknown>): string | null {
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.userId || payload.userId === '' || payload.userId === 'guest') return null;
    try {
        return JSON.stringify(payload);
    } catch {
        return null;
    }
}

function pbLog(event: PlaybackEvent, data?: Record<string, unknown>): void {
    // F17: cast para que el spread de `data` (Record<string, unknown>) sea
    // accesible vía payload['userId'] etc. dentro del sanitizador y los headers.
    const payload: Record<string, unknown> = { event, ts: Date.now(), ...data };
    // eventos frecuentes — nivel 'debug', nunca van al backend
    if (event === 'play_start' || event === 'sentence_advanced' || event === 'sentence_time' || event === 'sentence_rhythm' || event === 'sentence_skipped' || event === 'playback_paused' || event === 'sentence_floor_applied' || event === 'audio_metadata' || event === 'audio_cache_invalidated' || event === 'index_scheduled' || event === 'index_commit' || event === 'pending_advance_cancelled') {
        console.debug('[PB]', payload);
    } else if (event === 'session_completed') {
        console.info('[PB]', payload);
    } else {
        // Errores, bloqueos, fallos — nivel 'warn' para que sean visibles en VPS logs
        console.warn('[PB]', payload);
        // F17: persistir eventos no-rutinarios al backend, con guards:
        //   - payload sanitizado (sin userId vacío, no-throws)
        //   - dedupe por tag — no spammeo si server rechaza un type
        //   - try/catch global — playback NUNCA depende de telemetry
        try {
            if (_telemetryFailedTags.has(event)) return;
            const body = _sanitizeAndStringify(payload);
            if (!body) return;
            const userIdHeader = String(payload.userId ?? '');
            fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body,
                keepalive: true,
            }).then(res => {
                if (!res.ok) {
                    // Single-shot log de fallo. Marca el tag como failed para
                    // dedupe — no se reintentará en este lifetime de pestaña.
                    if (!_telemetryFailedTags.has(event)) {
                        _telemetryFailedTags.add(event);
                        console.warn('[PB-TELEMETRY-FAIL]', { event, status: res.status, dedupe: true });
                    }
                }
            }).catch(() => { /* swallow — playback never depends on telemetry */ });
        } catch { /* defense-in-depth: never throw from logger */ }
    }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useImmersivePlayback(ctx: PlaybackContext): ImmersivePlayback {

    // BLOCKER M-5.4.3 — Build marker. Si este log NO aparece en consola del
    // browser, el bundle está cacheado y el operador necesita hard-reload
    // (Ctrl+Shift+R) o `npm run dev` no recompiló. NO sigas debuggeando
    // path de spawn sin ver este log primero.
    const _m543MarkerEmittedRef = useRef(false);
    if (!_m543MarkerEmittedRef.current) {
        _m543MarkerEmittedRef.current = true;
        // eslint-disable-next-line no-console
        console.warn('[M543_BUILD_MARKER] perChunkNoAnchors-spawn-debug active', {
            contentId: ctx.contentIdRef?.current,
            userId:    ctx.userIdRef?.current,
            timestamp: Date.now(),
            buildPhase: 'M-5.4.3-helper-unified-spawn',
        });
    }

    // ── Audio elements (A/B buffer) ──────────────────────────────────────────
    const audioRefA      = useRef<HTMLAudioElement | null>(null);
    const audioRefB      = useRef<HTMLAudioElement | null>(null);
    const activePlayer   = useRef<'A' | 'B'>('A');

    // ── URL cache & tracking ─────────────────────────────────────────────────
    const audioCache     = useRef(new Map<number, string>());
    const inFlight       = useRef(new Map<number, Promise<string | null>>());
    const abortCtrls     = useRef(new Map<number, AbortController>());
    const sentenceTtsOverrideChunkKeyRef = useRef<number | null>(null);
    const activeAudioFirstSpokenIndexRef = useRef<number | null>(null);
    const activeAudioCacheKeyRef         = useRef<number | null>(null);

    // ── Cancellation token — previene ejecución de loads obsoletos ───────────
    const loadToken      = useRef(0);

    // HF4A-R2 — sesión completada (overlay "Lectura Completada"). Tercer eje de
    // la triple coherencia: ningún resultado tardío de getAudioUrl ni reintento
    // puede spawnear audio, limpiar fallo, avanzar o cambiar status si la sesión
    // ya terminó. Se pone true en handleEnded (fin de contenido) y se resetea a
    // false cuando hay intención REAL de leer: arranque de load() y navegación
    // manual (re-engagement). reset() también lo limpia (cross-content).
    const sessionCompletedRef = useRef(false);

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

    // F12: tracking de audio readiness para evitar hardResync por blob corrupto.
    // audioFailedKeysRef: indices cuya url no se pudo obtener (tts_fail) o
    //   cuyo blob falló decodificación (NotSupportedError) tras retry.
    //   load()/doAdvance() chequean antes de play() y, si está marcado,
    //   bloquean el audio sin recovery dura — la frase sigue visible y
    //   el status queda en 'error' a la espera de acción del usuario.
    // audioRetriedKeysRef: indices que ya tuvieron UN retry tras NotSupportedError.
    //   Evita loop de retries infinitos si el TTS server devuelve siempre
    //   el mismo blob roto.
    const audioFailedKeysRef  = useRef(new Set<number>());
    const audioRetriedKeysRef = useRef(new Set<number>());
    // HF4A: motivo del fallo registrado por cacheKey. Permite que
    // clear-on-valid-url distinga recuperable ('no_url'/timeout) de persistente
    // ('NotSupportedError') sin limpiar ciegamente blobs corruptos. Single
    // source para shouldClearFailure(reason, hasValidUrl). Se limpia en reset().
    const audioFailureReasonsRef = useRef(new Map<number, string>());
    // HF3: keys cuyo audio se obtuvo vía fallback de unidad corta (primer TTS
    //   lento/grande). Marca trazable; el url queda cacheado bajo `key` para que
    //   re-llamadas hagan cache-hit en lugar de repetir el timeout primario.
    const fallbackTtsKeysRef  = useRef(new Set<number>());

    // M-5.3.4: handle del executor de sincronización activo. Se spawnea cuando
    // pb.load arranca audio en chunked modes (perChunkWithAnchors / NoAnchors).
    // Cancelado en: reset, skip, load (próximo chunk distinto), unmount.
    const syncStrategyHandleRef = useRef<{ cancel: () => void; isAlive: () => boolean; sessionId: string | number; mode: string } | null>(null);

    // ────────────────────────────────────────────────────────────────────
    // M-5.4.6 (Phase 1.b.C Task 2) — Manual Nav Generation Lock.
    //
    // Cada gesto manual del usuario (next / previous / skip) incrementa
    // navGenerationRef. Cuando se spawna un executor, captura el valor
    // actual como spawnGeneration. TODOS los callbacks async del executor
    // (onSentenceActivate, onChunkComplete) validan que su generation
    // coincida con la actual antes de mutar índice.
    //
    // Esto cierra la ventana race que producía "previous → 0": un callback
    // del executor del chunk anterior llegaba después del manualSentenceJump
    // y escribía un índice stale.
    // ────────────────────────────────────────────────────────────────────
    const navGenerationRef = useRef<number>(0);

    // M-5.4.7 Task 4 — counters de runtime hygiene para nav spam + long session.
    const staleCallbackRejectCountRef = useRef(0);
    const executorCancelCountRef      = useRef(0);
    const runtimeStartedAtRef         = useRef<number>(Date.now());

    // ── M-5.4.6 (DEMOLITION Phase 1.a) — refs del drift detector ELIMINADOS.
    // lastAdvanceWithinChunkAtRef / ChunkKeyRef / lastManualNavAtRef vivían acá
    // y eran leídos por el drift detector + grace windows. Sin drift detector
    // ya no se leen. Mantener los stamps sin lectores sería puro overhead.

    // ── M-5.4 — Resilience Pass: tracking refs ───────────────────────────────
    // Counter monotonic de executors creados — invariant ONLY_ONE_ACTIVE_AUDIO_OWNER
    // exige que en cualquier momento haya exactamente 0 o 1 con isAlive()=true.
    const executorSpawnCountRef    = useRef(0);
    const ownershipViolationCountRef = useRef(0);
    // Métricas de cache para detectar growth runaway en sesiones largas.
    const cacheMetricsRef = useRef({
        created: 0,   // CACHE_ENTRY_CREATED
        reused:  0,   // CACHE_ENTRY_REUSED
        evicted: 0,   // CACHE_ENTRY_EVICTED
        revoked: 0,   // BLOB_URL_REVOKED
    });
    // Timestamps de últimos eventos clave — el watchdog los usa para detectar stalls.
    const lastAudioEventAtRef       = useRef<number | null>(null);
    const lastVisualAckAtRef        = useRef<number | null>(null);
    const lastChunkTransitionAtRef  = useRef<number | null>(null);
    const cancelSyncStrategy = (reason: string) => {
        const h = syncStrategyHandleRef.current;
        if (h && h.isAlive()) {
            executorCancelCountRef.current += 1;  // M-5.4.7 Task 4
            // eslint-disable-next-line no-console
            console.log('[SYNC] cancel_via_runtime', {
                reason,
                sessionId: h.sessionId,
                mode: h.mode,
                totalCancels: executorCancelCountRef.current,
            });
            h.cancel();
        }
        syncStrategyHandleRef.current = null;
    };

    // M-5.3.4: spawn helper extraído para mantener pb.load compacto (preserva
    // ventanas regex de tests estructurales). Si el modo NO es chunked, no-op
    // — el path normal audio.onEnded → setIdx(idx+1) se mantiene.
    // BLOCKER M-5.4.3 — Derivación lazy del audioMode cuando ctx.audioModeRef
    // está null al momento del spawn (race posible entre StartupEngine y play()
    // sobre todo en book switch). Lee toChunkRef + anchorsMapRef y aplica la
    // misma heurística del detector central, sin tocar el detector mismo.
    //
    // Reglas (orden importa):
    //   1. Si sentenceToChunk vacío → null (sin datos, no podemos decidir).
    //   2. Si chunkKey === sentenceIdx para TODO → 'perSentence'.
    //   3. Si hay anchors con startMs → 'perChunkWithAnchors'.
    //   4. Resto → 'perChunkNoAnchors'.
    const deriveAudioModeLazily = (): 'perSentence'|'perChunkWithAnchors'|'perChunkNoAnchors'|null => {
        const s2c = ctx.toChunkRef?.current;
        if (!Array.isArray(s2c) || s2c.length === 0) return null;
        let oneToOne = true;
        for (let i = 0; i < s2c.length; i++) {
            if (s2c[i] !== i) { oneToOne = false; break; }
        }
        if (oneToOne) return 'perSentence';
        const am = ctx.anchorsMapRef?.current;
        let hasAnchors = false;
        if (am && typeof am === 'object') {
            for (const k of Object.keys(am)) {
                const arr = (am as Record<string, unknown>)[k];
                if (Array.isArray(arr) && arr.some((a: any) => a && Number.isFinite(a.startMs))) {
                    hasAnchors = true; break;
                }
            }
        }
        return hasAnchors ? 'perChunkWithAnchors' : 'perChunkNoAnchors';
    };

    const spawnSyncExecutorIfChunked = (
        audioEl: HTMLAudioElement | null,
        index: number,
        callsite: string = 'unknown',
    ): void => {
        // BLOCKER M-5.4.3 — Diagnostic spawn-attempt log. Cada intento de
        // spawn debe loguear ESTO antes que cualquier otra cosa, así el
        // operador puede confirmar en browser real si el spawn corrió.
        const _spawnContentId = ctx.contentIdRef.current;
        let   _spawnMode      = ctx.audioModeRef?.current ?? null;
        const _modeWasReady   = _spawnMode !== null;
        // Lazy derivation cuando ref no fue seteado todavía (race book-switch).
        if (!_modeWasReady) {
            _spawnMode = deriveAudioModeLazily();
            if (_spawnMode !== null) {
                // eslint-disable-next-line no-console
                console.warn('[SYNC_MODE_NOT_READY_AT_PLAY]', {
                    callsite,
                    index,
                    contentId:    _spawnContentId,
                    derivedMode:  _spawnMode,
                    s2cLen:       ctx.toChunkRef?.current?.length ?? 0,
                    anchorsKeys:  ctx.anchorsMapRef?.current ? Object.keys(ctx.anchorsMapRef.current).length : 0,
                    sessionId:    contentSessionRef.current,
                });
                // Persistir para próximos spawns del mismo mount.
                if (ctx.audioModeRef) ctx.audioModeRef.current = _spawnMode;
            }
        }
        const _spawnChunkKey  = toChunkKey(index);
        const _spawnAttemptPayload = {
            callsite,
            index,
            contentId:       _spawnContentId,
            mode:            _spawnMode ?? 'unknown',
            modeWasReady:    _modeWasReady,
            chunkKey:        _spawnChunkKey,
            audioDuration:   audioEl ? audioEl.duration : null,
            audioReadyState: audioEl ? audioEl.readyState : null,
            audioPaused:     audioEl ? audioEl.paused : null,
            audioSrc:        audioEl ? (audioEl.src || '').slice(-60) : null,
            audioCurrentTime:audioEl ? audioEl.currentTime : null,
            sessionId:       contentSessionRef.current,
        };
        // eslint-disable-next-line no-console
        console.log('[SYNC_SPAWN_ATTEMPT]', _spawnAttemptPayload);

        if (!audioEl) {
            // eslint-disable-next-line no-console
            console.log('[SYNC_SPAWN_SKIPPED]', { ..._spawnAttemptPayload, reason: 'no_audio_element' });
            return;
        }
        if (_spawnMode !== 'perChunkWithAnchors' && _spawnMode !== 'perChunkNoAnchors') {
            // eslint-disable-next-line no-console
            console.log('[SYNC_SPAWN_SKIPPED]', { ..._spawnAttemptPayload, reason: 'mode_not_chunked' });
            return;
        }
        // BLOCKER M-5.4.3 — Dedup: si ya hay un executor vivo para el mismo
        // sessionId Y mismo chunk, no re-spawneamos. Evita el caso "resume()
        // tras pause()" que vuelve a crear executor para una frase ya en curso.
        const _alive = syncStrategyHandleRef.current;
        if (_alive && _alive.isAlive()
            && _alive.sessionId === contentSessionRef.current
            && (_alive as any)._chunkKey === _spawnChunkKey) {
            // eslint-disable-next-line no-console
            console.log('[SYNC_SPAWN_SKIPPED]', {
                ..._spawnAttemptPayload,
                reason:             'already_alive_same_chunk',
                existingSessionId:  _alive.sessionId,
                existingMode:       _alive.mode,
                existingChunkKey:   (_alive as any)._chunkKey,
            });
            return;
        }
        // ── M-5.4 — invariant ONLY_ONE_ACTIVE_AUDIO_OWNER ────────────────
        // Si ya hay un executor vivo en el momento del spawn, hubo violación
        // de ownership (cancelSyncStrategy debió correr antes). Loggeamos +
        // cancelamos defensivamente para cumplir el invariant.
        const _prev = syncStrategyHandleRef.current;
        if (_prev && _prev.isAlive()) {
            ownershipViolationCountRef.current++;
            // eslint-disable-next-line no-console
            console.warn('[OWNERSHIP_VIOLATION] AUDIO_SPLIT_BRAIN', {
                reason: 'spawn_while_existing_alive',
                existingSessionId: _prev.sessionId,
                existingMode:      _prev.mode,
                violationCount:    ownershipViolationCountRef.current,
                sentenceIndex:     index,
                contentSession:    contentSessionRef.current,
            });
            try { _prev.cancel(); } catch { /* ignore */ }
        }
        executorSpawnCountRef.current++;
        const chunkKey = _spawnChunkKey;
        const s2c = ctx.toChunkRef.current;
        // M-5.4.6 (Case 2) — el sentenceGroup arranca DESDE el spawn index, NO
        // desde la primera frase del chunk. Antes: si el chunk tenía sentences
        // 0..11 y el usuario navegaba a 10, el executor activaba 0 primero
        // (porque startMs=0 en la timeline). Ahora filtramos para que la
        // timeline empiece en el index donde el usuario está parado.
        //
        // _chunkStartIndex también se calcula para el guard defensivo de
        // STALE_OR_LOCAL_INDEX_REJECTED en advanceWithinChunk.
        const _chunkStartIndex = s2c.length > 0
            ? s2c.findIndex(ck => ck === chunkKey)
            : index;
        const _chunkEndIndex = s2c.length > 0
            ? (() => {
                let last = -1;
                for (let i = 0; i < s2c.length; i++) if (s2c[i] === chunkKey) last = i;
                return last;
            })()
            : index;
        // M-5.4.6 (Task 1) — sentenceGroup ahora usa absoluteSentenceIndex +
        // localIndexInChunk (canónico). El executor rechaza activaciones
        // fuera de [spawnFromIndex, chunkEndIndex] internamente (guard duro
        // en tickActivate + en buildHeuristic/Fallback).
        const sentenceGroup = s2c.length > 0
            ? s2c.map((ck, sIdx) => ({ chunkKey: ck, absoluteSentenceIndex: sIdx }))
                .filter(x => x.chunkKey === chunkKey)
                .filter(x => x.absoluteSentenceIndex >= index)
                .map(x => ({
                    absoluteSentenceIndex: x.absoluteSentenceIndex,
                    localIndexInChunk:     x.absoluteSentenceIndex - _chunkStartIndex,
                    weight: ctx.audioSentencesRef.current[x.absoluteSentenceIndex]?.length ?? 1,
                }))
            : [{
                absoluteSentenceIndex: index,
                localIndexInChunk:     0,
                weight: ctx.audioSentencesRef.current[index]?.length ?? 1,
            }];
        const anchorsRaw = ctx.anchorsMapRef?.current?.[chunkKey];
        // Los anchors en disco usan 'sentenceIdx' (formato V2 manifest histórico).
        // Acá los re-tipiamos al contrato canónico absoluteSentenceIndex y
        // calculamos localIndexInChunk a partir de _chunkStartIndex.
        const anchors = Array.isArray(anchorsRaw)
            ? anchorsRaw
                .filter((a: any) => a && Number.isFinite(a.startMs) && Number.isInteger(a.sentenceIdx))
                .filter((a: any) => a.sentenceIdx >= index)
                .map((a: any) => ({
                    absoluteSentenceIndex: a.sentenceIdx,
                    localIndexInChunk:     a.sentenceIdx - _chunkStartIndex,
                    startMs:               a.startMs,
                }))
            : [];
        // M-5.4.6 (Phase 1.b.C Task 2) — Capturar la generación de manual nav
        // al momento del spawn. Los callbacks del executor validarán esto antes
        // de mutar índice. Cualquier callback de un executor cuya generación
        // ya quedó atrás → rechazado con [STALE_NAV_CALLBACK_REJECTED].
        const _spawnNavGeneration = navGenerationRef.current;
        const _spawnSuccessPayload = {
            ..._spawnAttemptPayload,
            sentenceGroupLen:    sentenceGroup.length,
            anchorsLen:          anchors.length,
            chunkStartIndex:     _chunkStartIndex,
            chunkEndIndex:       _chunkEndIndex,
            spawnFromIndex:      index,
            spawnNavGeneration:  _spawnNavGeneration,
            firstAbsIndex:       sentenceGroup[0]?.absoluteSentenceIndex ?? null,
            firstLocalIndex:     sentenceGroup[0]?.localIndexInChunk ?? null,
        };
        try {
            const _newHandle = executeSyncStrategy({
                mode: _spawnMode,
                audioElement:       audioEl,
                sentenceGroup,
                anchors,
                playbackSpeed:      ctx.speedRef.current,
                sessionId:          contentSessionRef.current,
                // M-5.4.6 (Task 1) — Guard params pasados al executor:
                spawnFromIndex:     index,
                chunkKey:           _spawnChunkKey,
                chunkStartIndex:    _chunkStartIndex,
                chunkEndIndex:      _chunkEndIndex,
                // M-5.4.6 (Phase 1.b.C Task 2) — Wrap callbacks con generation
                // check. Si la generation cambió entre spawn y callback, NO se
                // muta índice: el manual nav nuevo ya tomó ownership.
                onSentenceActivate: (absIdx: number) => {
                    if (_spawnNavGeneration !== navGenerationRef.current) {
                        staleCallbackRejectCountRef.current += 1;
                        // eslint-disable-next-line no-console
                        console.warn('[STALE_NAV_CALLBACK_REJECTED]', {
                            callbackGeneration: _spawnNavGeneration,
                            currentGeneration:  navGenerationRef.current,
                            callbackType:       'onSentenceActivate',
                            attemptedIndex:     absIdx,
                            spawnFromIndex:     index,
                            chunkKey:           _spawnChunkKey,
                            totalRejects:       staleCallbackRejectCountRef.current,
                        });
                        return;
                    }
                    advanceWithinChunk(absIdx);
                },
                onChunkComplete: () => {
                    if (_spawnNavGeneration !== navGenerationRef.current) {
                        staleCallbackRejectCountRef.current += 1;
                        // eslint-disable-next-line no-console
                        console.warn('[STALE_NAV_CALLBACK_REJECTED]', {
                            callbackGeneration: _spawnNavGeneration,
                            currentGeneration:  navGenerationRef.current,
                            callbackType:       'onChunkComplete',
                            attemptedIndex:     null,
                            spawnFromIndex:     index,
                            chunkKey:           _spawnChunkKey,
                            totalRejects:       staleCallbackRejectCountRef.current,
                        });
                        return;
                    }
                    /* handleEnded maneja avance al próximo chunk */
                },
                onError:            (err: any) => {
                    // eslint-disable-next-line no-console
                    console.error('[SYNC] executor_error', { index, error: err?.message });
                },
            });
            // Etiquetamos el handle con su chunkKey + rangos absolutos para
            // que advanceWithinChunk pueda rechazar activations fuera de
            // [spawnFromIndex, chunkEndIndex] (defensa STALE_OR_LOCAL_INDEX).
            (_newHandle as any)._chunkKey            = _spawnChunkKey;
            (_newHandle as any)._chunkStartIndex     = _chunkStartIndex;
            (_newHandle as any)._chunkEndIndex       = _chunkEndIndex;
            (_newHandle as any)._spawnFromIndex      = index;
            (_newHandle as any)._spawnNavGeneration  = _spawnNavGeneration; // M-5.4.6 Task 2
            syncStrategyHandleRef.current = _newHandle;
            // eslint-disable-next-line no-console
            console.log('[SYNC_SPAWN_SUCCESS]', _spawnSuccessPayload);
        } catch (err: any) {
            // eslint-disable-next-line no-console
            console.error('[SYNC_SPAWN_FAILED]', { ..._spawnSuccessPayload, error: err?.message });
            // eslint-disable-next-line no-console
            console.error('[SYNC] executor_spawn_failed', { index, error: err?.message });
        }
    };

    // BLOCKER M-5.4.3 — Single helper invoked from EVERY .play().then() in
    // the hook. Antes, solo load() autoplay spawneaba executor; resume() y
    // handleEnded gapless NO lo hacían — por eso Guerra reproducía audio pero
    // no avanzaba. Cualquier camino futuro de play() DEBE pasar por acá.
    //
    // Responsabilidades:
    //   1. Log PB_SPAWN_CALLSITE (audit trail).
    //   2. Despachar AUDIO_STARTED a la machine (idempotente — rejected si
    //      buffer no está 'visible').
    //   3. Actualizar timestamps M-5.4 que el watchdog usa para stall detection.
    //   4. Llamar spawnSyncExecutorIfChunked — el spawn decide internamente si
    //      crea executor según el modo, dedup, y lazy mode derivation.
    //
    // El callsite es informativo: distingue 'load_autoplay' / 'resume' /
    // 'gapless_advance' en logs para auditoría sin código adicional.
    const onAudioPlaybackStarted = (
        audioEl: HTMLAudioElement | null,
        index: number,
        callsite: 'load_autoplay' | 'resume' | 'gapless_advance' | string,
    ): void => {
        // eslint-disable-next-line no-console
        console.log('[PB_SPAWN_CALLSITE]', {
            callsite,
            index,
            contentId:        ctx.contentIdRef.current,
            mode:             ctx.audioModeRef?.current ?? null,
            audioPaused:      audioEl ? audioEl.paused : null,
            audioReadyState:  audioEl ? audioEl.readyState : null,
            audioDuration:    audioEl ? audioEl.duration : null,
            audioCurrentTime: audioEl ? audioEl.currentTime : null,
            srcTail:          audioEl ? (audioEl.src || '').slice(-60) : null,
            statusBefore:     statusRef.current,
            sessionId:        contentSessionRef.current,
        });
        // Update watchdog timestamps (M-5.4 — stall detection baseline).
        lastAudioEventAtRef.current      = Date.now();
        lastChunkTransitionAtRef.current = Date.now();
        // Dispatch AUDIO_STARTED — idempotente por la machine. Algunos
        // callsites (load) ya lo hacían antes; al consolidarlo acá nos
        // aseguramos que SIEMPRE se despache tras play() resuelto.
        dispatchMachine({ type: MA.AUDIO_STARTED, index });
        // BLOCKER FINAL V2 / TASK 2 — Marca de ORDEN verificable: este helper
        // SOLO se invoca desde el .then() de play() (audio confirmado/ready).
        // El spawn ocurre DESPUÉS de PB_PLAY_RESOLVED, que a su vez ocurre
        // DESPUÉS de GAPLESS_CHUNK_AUDIO_READY (gapless). Orden garantizado:
        //   GAPLESS_CHUNK_AUDIO_READY → PB_PLAY_RESOLVED → SYNC_SPAWN_AFTER_AUDIO_READY
        // eslint-disable-next-line no-console
        console.log('[SYNC_SPAWN_AFTER_AUDIO_READY]', {
            callsite,
            index,
            audioPaused:      audioEl ? audioEl.paused : null,
            audioReadyState:  audioEl ? audioEl.readyState : null,
            audioDuration:    audioEl ? audioEl.duration : null,
            audioCurrentTime: audioEl ? audioEl.currentTime : null,
            srcTail:          audioEl ? (audioEl.src || '').slice(-60) : null,
            sessionId:        contentSessionRef.current,
        });
        // ── M-5.4.14 / TASK 1 — FINAL_AUDIO_STATE (observabilidad pura) ──────
        // Estado de audio EXACTO en el momento del handoff de playback. Sin
        // cambio de control-flow. Permite al smoke confirmar single-owner:
        // un solo audioEl no-pausado por callsite, sin restart involuntario.
        // eslint-disable-next-line no-console
        console.log('[FINAL_AUDIO_STATE]', {
            callsite, index,
            activePlayer:     activePlayer.current,
            audioPaused:      audioEl ? audioEl.paused : null,
            audioReadyState:  audioEl ? audioEl.readyState : null,
            audioCurrentTime: audioEl ? audioEl.currentTime : null,
            audioDuration:    audioEl ? audioEl.duration : null,
            srcTail:          audioEl ? (audioEl.src || '').slice(-50) : null,
            executorAlive:    !!(syncStrategyHandleRef.current && syncStrategyHandleRef.current.isAlive()),
            status:           statusRef.current,
            sessionId:        contentSessionRef.current,
        });
        // Spawn (siempre — el helper decide skip vs success vs failed).
        spawnSyncExecutorIfChunked(audioEl, index, callsite);
    };

    // F19/Cambio C — contador de hardResync por sesión (contentSession).
    // Se incrementa en cada hardResync. Se resetea a 0 en reset() (cambio de
    // libro). Si supera MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION, hardResync NO
    // ejecuta — log PB_HARD_RESYNC_CAPPED + status='error'.
    const hardResyncAttemptsRef = useRef(0);

    const setStatus = (s: PlaybackStatus) => {
        statusRef.current = s;
        setStatusState(s);
    };

    // ── F15: contentSession monotónico — invalida callbacks cross-content ───
    // Cada content change incrementa este contador. Helpers como
    // acknowledgeVisualHighlight, dispatchMachine y resume verifican que el
    // session capturado al inicio coincida con el actual antes de aplicar
    // cambios. Cualquier callback (visual ack tardío, audio_started que llega
    // post-skip, tts_fail de blob viejo) se descarta si el session ya cambió.
    const contentSessionRef     = useRef<number>(0);
    const contentSessionTokenForRef = (cid: string): number => {
        // Cada vez que contentIdRef cambia (visor lo muta render-time), el
        // próximo dispatch via load/reset/manualSentenceJump invalida la session.
        // Esta función solo lee el contador actual; el incremento se hace en reset().
        void cid;
        return contentSessionRef.current;
    };

    // ── F3: machine runtime — observer mode ──────────────────────────────────
    // La machine se inicializa lazy con el primer dispatch, y se reinicializa
    // cuando cambia contentId. En F3 los effects son no-ops (la lógica legacy
    // del hook ya ejecuta play/save/cancel). Solo emitimos logs estructurados
    // para que el suite y los smoke browser puedan auditar la regla madre.
    const machineRef = useRef<ReturnType<typeof machineInit> | null>(null);
    const machineContentIdRef = useRef<string>('');

    const ensureMachineForContent = (): void => {
        const cid = ctx.contentIdRef.current;
        const uid = ctx.userIdRef.current;
        if (machineRef.current === null || machineContentIdRef.current !== cid) {
            machineRef.current = machineInit({
                sessionKey: `${uid}__${cid}`,
                contentId:  cid,
                startIndex: currentIdxRef.current,
            });
            machineContentIdRef.current = cid;
        }
    };

    const executeMachineEffects = (effects: Array<any>): void => {
        for (const effect of effects) {
            if (effect.type === 'log') {
                // Re-emitir vía analytics + console.debug. Estos logs son
                // adicionales a los que la lógica legacy ya emite — sirven para
                // auditar la regla madre (PB_SENTENCE_PREPARE, PB_AUDIO_STARTED,
                // PB_VISUAL_HIGHLIGHT_ACK, PB_SENTENCE_COMPLETED, etc.).
                const payload = {
                    event: effect.tag,
                    ts: Date.now(),
                    userId: ctx.userIdRef.current,
                    via: 'machine',
                    ...(effect.data ?? {}),
                };
                console.debug('[PB-MACHINE]', payload);
                analytics.emit(payload as any);
            } else if (
                effect.type === 'BLOCK_AUDIO_START' ||
                effect.type === 'BLOCK_PROGRESS_SAVE' ||
                effect.type === 'HARD_RESYNC' ||
                effect.type === 'SET_INDEX'
            ) {
                // F3: estos effects son observados pero NO ejecutados (la
                // lógica legacy ya hace setIdx/load/etc.). F4+ los convertirá
                // en gating real.
                const payload = {
                    event: `machine_effect_${effect.type}`,
                    ts: Date.now(),
                    userId: ctx.userIdRef.current,
                    via: 'machine',
                    ...effect,
                };
                console.debug('[PB-MACHINE-EFFECT]', payload);
                analytics.emit(payload as any);
            }
            // play_audio, pause_audio, save_progress, load_audio, cancel_pending,
            // recommend_hard_resync: NO se ejecutan en F3 — la lógica legacy del
            // hook ya hace esos side-effects al call site original (load.play(),
            // pause(), etc.). Re-ejecutarlos duplicaría el side effect.
        }
    };

    // ── [M532_BUFFER] TEMP DEBUG helper — borrar tras causa raíz identificada
    // Helpers extraídos para mantener dispatchMachine corto (preserva regex
    // estructurales de playbackRuntimeIntegration test).
    const _m532TraceBeforeDispatch = (action: any) => {
        if (action?.type === MA.PREPARE_SENTENCE) {
            const c = machineRef.current?.buffer?.current;
            // eslint-disable-next-line no-console
            console.log('[M532_BUFFER] prepare_sentence', {
                index: action.index,
                previousIndex:     c?.index ?? null,
                previousStatus:    c?.status ?? null,
                sameIndexReset:    c != null && c.index === action.index,
                contentId:         ctx.contentIdRef.current,
            });
        }
        // M-5.4.6 — ack_apply / ack_apply_after eliminados (VISUAL_HIGHLIGHT_ACK deprecated).
    };
    const _m532TraceAfterDispatch = (_action: any) => {
        // M-5.4.6 — ack_apply_after eliminado.
    };

    const dispatchMachine = (action: object): { effects: Array<any> } => {
        ensureMachineForContent();
        _m532TraceBeforeDispatch(action);
        const result = machineReduce(machineRef.current!, action);
        machineRef.current = result.state;
        executeMachineEffects(result.effects);
        _m532TraceAfterDispatch(action);
        return { effects: result.effects };
    };

    // ────────────────────────────────────────────────────────────────────
    // M-5.4.6 (DEMOLITION Phase 1.b.5) — ELIMINADOS:
    //   - canStartAudio(index)         (leía buffer.current.visualHighlightConfirmed)
    //   - waitForVisualAck(index, ms)  (poll bloqueante de visual ACK)
    //   - requestAudioStart(index)     (dispatch REQUEST_AUDIO_START al machine)
    //
    // El nuevo INV "playback must never wait for render confirmation"
    // significa que no hay gates de ACK. El audio arranca cuando hay src
    // y se llamó .play().
    // ────────────────────────────────────────────────────────────────────

    // F6 — hardResync: operación única y formal de resincronización dura.
    //
    // Recovery path canónico ante: drift, missing/duplicate/mismatch DOM,
    // audio_start_without_highlight, resume_without_active_sentence, etc.
    //
    // Hace TODO el cleanup necesario:
    //   1. cancelPendingAdvance (timer doAdvance, fallback, canplaythrough)
    //   2. pause ambos audios (A y B)
    //   3. dispatch MA.HARD_RESYNC (cancela buffer + emite log/effect)
    //   4. setStatus('paused') + onPlayChange(false)
    //   5. log PB_HARD_RESYNC con reason
    //
    // IMPORTANTE: NO reproduce audio automáticamente. El usuario reanuda con
    // un click (que pasa por load() → ack → REQUEST_AUDIO_START gate).
    // Esto evita loops infinitos cuando el ack jamás llega.
    const hardResync = (targetIndex: number, reason: string): void => {
        // F19/Cambio C — cap defensivo. Si superamos los intentos por sesión,
        // NO ejecutar — esto rompe loops de hardResync→drift→hardResync.
        if (hardResyncAttemptsRef.current >= MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION) {
            log('autoplay_blocked' as any, {
                event: 'PB_HARD_RESYNC_CAPPED',
                targetIndex, reason,
                attempts: hardResyncAttemptsRef.current,
                max: MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION,
            });
            setStatus('error');
            ctx.onPlayChange.current(false);
            // NO cancelPendingAdvance, NO pause de audios — si el user todavía
            // quiere reanudar, lo intentará manualmente con click.
            return;
        }
        hardResyncAttemptsRef.current++;

        // BLOCKER M-5.4.5 — cancelar EXECUTOR antes que cualquier otra cosa.
        // Sin esto, el executor seguía vivo tras hardResync emitiendo
        // SYNC_SENTENCE_ACTIVATE → advanceWithinChunk sobre una machine
        // recién reseteada, generando PB_SENTENCE_COMPLETED_REJECTED en loop.
        cancelSyncStrategy('hard_resync');
        // eslint-disable-next-line no-console
        console.log('[HARD_RESYNC_CANCEL_EXECUTOR]', {
            targetIndex, reason,
            sessionId: contentSessionRef.current,
        });

        // 1. cancelar timers pendientes (incluye doAdvance + fallback + canplaythrough listener)
        cancelPendingAdvance('skip_or_load');
        // 2. pausar ambos audios
        audioRefA.current?.pause();
        audioRefB.current?.pause();
        // 3. cancelar buffer + state vía machine (emite log hard_resync legacy + PB_BUFFER_CANCELLED)
        dispatchMachine({ type: MA.HARD_RESYNC, targetIndex, reason });
        // 4. estado seguro
        setStatus('paused');
        ctx.onPlayChange.current(false);
        // 5. log F6 explícito (el dispatch ya logueó hard_resync legacy; este es el tag F6 canónico)
        log('autoplay_blocked' as any, {
            event: 'PB_HARD_RESYNC',
            index: targetIndex, reason,
            attempt: hardResyncAttemptsRef.current,
            cap: MAX_HARD_RESYNC_ATTEMPTS_PER_SESSION,
        });
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
            cancelSyncStrategy('unmount');  // M-5.3.4: matar executor pendiente
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

    // ── HF4A — recovery de fallos de audio ───────────────────────────────────
    // markAudioFailed: registra fallo + su motivo (recuperable vs persistente).
    //   Único punto que escribe audioFailedKeysRef para que el motivo SIEMPRE
    //   quede registrado y clear-on-valid-url pueda clasificar.
    const markAudioFailed = (index: number, reason: string): void => {
        const key = toChunkKey(index);
        audioFailedKeysRef.current.add(key);
        audioFailureReasonsRef.current.set(key, reason);
    };

    // clearRecoverableFailure: limpia la marca de fallo de un índice SOLO si el
    //   fallo previo era recuperable (no_url/timeout/abort) — i.e. ahora hay una
    //   URL válida y el blob no era de decode. NO limpia fallos persistentes
    //   (NotSupportedError) para no loopear sobre blob corrupto: ahí manda la
    //   protección de audioRetriedKeysRef. Devuelve true si limpió.
    const clearRecoverableFailure = (index: number, via: string = 'valid_url'): boolean => {
        const key = toChunkKey(index);
        if (!audioFailedKeysRef.current.has(key)) return false;
        const reason = audioFailureReasonsRef.current.get(key) ?? 'no_url';
        if (!shouldClearFailure(reason, true)) return false;  // persistente → conservar
        audioFailedKeysRef.current.delete(key);
        audioFailureReasonsRef.current.delete(key);
        log('autoplay_blocked' as any, { event: 'PB_AUDIO_FAILED_CLEARED', index, via, reason });
        return true;
    };

    const firstSentenceIndexForChunkKey = (chunkKey: number): number => {
        const map = ctx.toChunkRef.current;
        if (map.length === 0) return chunkKey;
        const first = map.findIndex(k => k === chunkKey);
        return first >= 0 ? first : chunkKey;
    };

    const resolveAudioUrlMode = (
        index: number,
        options: PlaybackLoadOptions = {},
    ): { chunkKey: number; cacheKey: number; forceSentenceTts: boolean } => {
        const chunkKey = toChunkKey(index);
        const overrideChunkKey = sentenceTtsOverrideChunkKeyRef.current;
        const forceSentenceTts = options.forceSentenceTts === true
            || (options.anchorFirstAudio === true && chunkKey !== index)
            || (overrideChunkKey !== null && overrideChunkKey === chunkKey);
        return {
            chunkKey,
            cacheKey: forceSentenceTts ? toSentenceTtsCacheKey(index) : chunkKey,
            forceSentenceTts,
        };
    };

    const invalidateChunkAudioForResume = (index: number): boolean => {
        const chunkKey = toChunkKey(index);
        let invalidated = false;
        const cachedUrl = audioCache.current.get(chunkKey);
        if (cachedUrl) {
            URL.revokeObjectURL(cachedUrl);
            audioCache.current.delete(chunkKey);
            cacheMetricsRef.current.evicted += 1;
            cacheMetricsRef.current.revoked += 1;
            invalidated = true;
        }
        const ctrl = abortCtrls.current.get(chunkKey);
        if (ctrl) {
            ctrl.abort('resume_audio_anchor');
            abortCtrls.current.delete(chunkKey);
            invalidated = true;
        }
        if (inFlight.current.delete(chunkKey)) {
            invalidated = true;
        }
        if (invalidated) {
            // eslint-disable-next-line no-console
            console.log('[CACHE_ENTRY_EVICTED]', {
                evicted: 1,
                via: 'immersive_tts_resume_anchor',
                key: chunkKey,
                index,
                totalEvicted: cacheMetricsRef.current.evicted,
            });
        }
        return invalidated;
    };

    // ── Cancelar fetches fuera de la ventana de reproducción ─────────────────
    const cancelStaleFetches = (index: number) => {
        const total = ctx.sentencesRef.current.length;
        const lowerSentence = Math.max(0, index - 5);
        const upperSentence = Math.min(total - 1, index + getAdaptivePrefetchWindow() + 2);
        const lower = toChunkKey(Math.max(0, index - 5));
        const upper = toChunkKey(Math.min(total - 1, index + getAdaptivePrefetchWindow() + 2));
        abortCtrls.current.forEach((ctrl, key) => {
            if (isSentenceTtsCacheKey(key)) {
                const sentenceIndex = fromSentenceTtsCacheKey(key);
                if (sentenceIndex < lowerSentence || sentenceIndex > upperSentence) ctrl.abort('Jumped away');
                return;
            }
            if (key < lower || key > upper) ctrl.abort('Jumped away');
        });
    };

    // ── URL resolution: manifest → /api/tts → null ───────────────────────────
    const getAudioUrl = useCallback(async (
        index: number,
        options: PlaybackLoadOptions = {},
    ): Promise<string | null> => {
        // ── [AUDIO_TRACE] TEMPORAL — M-2.6/2.7 audit. REMOVE AFTER FIX ──────
        const _trCid  = ctx.contentIdRef.current;
        const _trSess = contentSessionRef.current;
        const _trUid  = ctx.userIdRef.current;
        const audioSentences = ctx.audioSentencesRef.current;
        // eslint-disable-next-line no-console
        console.log('[AUDIO_TRACE] provider_enter', {
            contentId:        _trCid,
            sentenceIndex:    index,
            sessionId:        _trSess,
            userId:           _trUid,
            audioSentencesLen: audioSentences.length,
            sentenceTextHead: (audioSentences[index] ?? '').slice(0, 60),
        });
        if (index < 0 || index >= audioSentences.length) {
            // eslint-disable-next-line no-console
            console.error('[AUDIO_TRACE] provider_fail', {
                provider:      'bounds',
                contentId:     _trCid,
                sentenceIndex: index,
                reason:        'oob_index',
                audioSentencesLen: audioSentences.length,
            });
            return null;
        }

        const { chunkKey, cacheKey: key, forceSentenceTts } = resolveAudioUrlMode(index, options);
        const _trMap = ctx.toChunkRef.current;
        // eslint-disable-next-line no-console
        console.log('[AUDIO_TRACE] sentence_to_chunk', {
            sentenceIndex: index,
            chunkKey,
            cacheKey:      key,
            mapLen:        _trMap.length,
            mapHasIndex:   _trMap.length > index,
            keyEqualsIndex: chunkKey === index,
            forceSentenceTts,
            reason:        options.reason ?? null,
        });

        const cached = audioCache.current.get(key);
        if (cached) {
            cacheMetricsRef.current.reused++;  // M-5.4 metric
            // eslint-disable-next-line no-console
            console.log('[AUDIO_TRACE] cache_hit', { sentenceIndex: index, chunkKey, cacheKey: key, forceSentenceTts });
            // eslint-disable-next-line no-console
            console.log('[CACHE_ENTRY_REUSED] reused=' + cacheMetricsRef.current.reused, { key });
            return cached;
        }

        const existing = inFlight.current.get(key);
        if (existing) {
            // eslint-disable-next-line no-console
            console.log('[AUDIO_TRACE] inflight_dedupe', { sentenceIndex: index, chunkKey, cacheKey: key, forceSentenceTts });
            return existing;
        }

        const abortCtrl = new AbortController();
        abortCtrls.current.set(key, abortCtrl);

        const task = async (): Promise<string | null> => {
            try {
                // Nivel 1: audio pre-generado en el servidor (manifest)
                const mf       = ctx.manifestRef.current;
                const mfKeys   = mf ? Object.keys(mf).length : 0;
                const mfEntry  = forceSentenceTts ? null : mf?.[chunkKey];
                // eslint-disable-next-line no-console
                console.log('[AUDIO_TRACE] manifest_lookup', {
                    sentenceIndex:  index,
                    chunkKey,
                    cacheKey:       key,
                    forceSentenceTts,
                    manifestNull:   mf === null || mf === undefined,
                    manifestKeys:   mfKeys,
                    manifestSample: mf ? Object.keys(mf).slice(0, 3) : null,
                    hasEntry:       !!mfEntry,
                    entryFile:      mfEntry?.file ?? null,
                    entryShape:     mfEntry ? Object.keys(mfEntry) : null,
                });
                if (!forceSentenceTts && mf?.[chunkKey]) {
                    // M3.1: uploadsUrl prefija con CDN si MEDIA_BASE_URL set, sino mantiene /uploads/.
                    const _trUrl = uploadsUrl(mf[chunkKey].file);
                    // eslint-disable-next-line no-console
                    console.log('[AUDIO_TRACE] manifest_fetch', {
                        sentenceIndex: index, chunkKey, cacheKey: key, fetchUrl: _trUrl,
                    });
                    const res = await fetch(_trUrl, { signal: abortCtrl.signal });
                    if (res.ok) {
                        const blob = await res.blob();
                        if (abortCtrl.signal.aborted) return null;
                        // Validar que el blob es un audio real y no está vacío
                        if (blob.size === 0) {
                            // eslint-disable-next-line no-console
                            console.error('[AUDIO_TRACE] provider_fail', {
                                provider: 'manifest', contentId: _trCid,
                                sentenceIndex: index, chunkKey,
                                reason: 'empty_blob', file: mf[chunkKey].file,
                            });
                            log('manifest_fail', { index, key: chunkKey, reason: 'empty_blob' });
                            // No retornar null todavía — caer al nivel 2 (TTS on-demand)
                        } else {
                            const url = URL.createObjectURL(blob);
                            audioCache.current.set(key, url);
                            cacheMetricsRef.current.created++;  // M-5.4 metric
                            // eslint-disable-next-line no-console
                            console.log('[AUDIO_TRACE] provider_result', {
                                provider: 'manifest', contentId: _trCid,
                                sentenceIndex: index, chunkKey, cacheKey: key,
                                hasUrl: true, urlType: typeof url, blobSize: blob.size,
                            });
                            // eslint-disable-next-line no-console
                            console.log('[CACHE_ENTRY_CREATED] created=' + cacheMetricsRef.current.created, { key, blobSize: blob.size, via: 'manifest' });
                            return url;
                        }
                    } else {
                        // eslint-disable-next-line no-console
                        console.error('[AUDIO_TRACE] provider_fail', {
                            provider: 'manifest', contentId: _trCid,
                            sentenceIndex: index, chunkKey,
                            reason: 'http_' + res.status, file: mf[chunkKey].file,
                        });
                        log('manifest_fail', { index, key: chunkKey, status: res.status });
                        // Caer al nivel 2
                    }
                }

                // Nivel 2: TTS on-demand en backend (clave nunca sale del servidor)
                const txt    = audioSentences[index];
                const userId = ctx.userIdRef.current;
                // eslint-disable-next-line no-console
                console.log('[AUDIO_TRACE] tts_pre', {
                    sentenceIndex: index,
                    chunkKey,
                    cacheKey:      key,
                    forceSentenceTts,
                    hasText:       !!txt,
                    textLen:       typeof txt === 'string' ? txt.length : 0,
                    userId,
                    isGuest:       userId === 'guest',
                });
                if (!txt || !userId || userId === 'guest') {
                    // eslint-disable-next-line no-console
                    console.error('[AUDIO_TRACE] provider_fail', {
                        provider: 'tts', contentId: _trCid,
                        sentenceIndex: index,
                        reason: !txt ? 'no_text' : !userId ? 'no_userId' : 'guest_user',
                    });
                    return null;
                }

                // ── HF3 — recuperación de audio cuando el primer TTS es lento/grande ──
                // Antes: un único intento con abort duro a 20s. Si la primera frase de
                // un libro sin manifest excedía el timeout (texto largo o backend frío
                // — OpenAI quota → fallback Gemini lento), getAudioUrl devolvía null y
                // load() marcaba "Sin audio" (PB_AUDIO_UNRECOVERABLE) SIN reintentar.
                // Ahora: intento primario con la frase completa; si NO produce audio y
                // la carga no fue cancelada externamente, reintentamos con una unidad
                // hablable más corta (split por puntuación) bajo timeout propio. El
                // timeout real se conserva: sólo si TAMBIÉN falla el fallback → null.

                // Un intento de /api/tts con AbortController propio (timeout aislado)
                // enlazado al abortCtrl del task: honra cancelaciones externas
                // (jump/resume/unmount) sin envenenar el controller para el reintento.
                const attemptTts = async (text: string, timeoutMs: number, attemptLabel: string): Promise<Response> => {
                    const attemptCtrl = new AbortController();
                    const onParentAbort = () => attemptCtrl.abort(abortCtrl.signal.reason);
                    if (abortCtrl.signal.aborted) {
                        attemptCtrl.abort(abortCtrl.signal.reason);
                    } else {
                        abortCtrl.signal.addEventListener('abort', onParentAbort, { once: true });
                    }
                    const timer = setTimeout(
                        () => attemptCtrl.abort(new DOMException(`TTS request exceeded ${timeoutMs / 1000}s timeout`, 'TimeoutError')),
                        timeoutMs,
                    );
                    try {
                        // eslint-disable-next-line no-console
                        console.log('[AUDIO_TRACE] tts_fetch_start', {
                            sentenceIndex: index, chars: text.length, forceSentenceTts, attempt: attemptLabel,
                        });
                        return await fetch('/api/tts', {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ text }),
                            signal:  attemptCtrl.signal,
                        });
                    } finally {
                        clearTimeout(timer);
                        abortCtrl.signal.removeEventListener('abort', onParentAbort);
                    }
                };

                // Valida una Response de /api/tts y devuelve un object URL (o null si no
                // es audio real). No cachea ni lanza: el caller decide cache/fallback.
                const materializeTts = async (res: Response, attemptLabel: string): Promise<string | null> => {
                    const ct   = res.headers.get('content-type') ?? '';
                    const prov = res.headers.get('x-audio-provider') ?? null;
                    // eslint-disable-next-line no-console
                    console.log('[AUDIO_TRACE] tts_fetch_response', {
                        sentenceIndex: index, forceSentenceTts, attempt: attemptLabel,
                        httpStatus: res.status, ok: res.ok, contentType: ct, providerHdr: prov,
                    });
                    if (!res.ok) {
                        // eslint-disable-next-line no-console
                        console.error('[AUDIO_TRACE] provider_fail', {
                            provider: 'tts', contentId: _trCid, sentenceIndex: index,
                            reason: 'http_' + res.status, contentType: ct, attempt: attemptLabel,
                        });
                        log('tts_fail', { index, httpStatus: res.status, attempt: attemptLabel });
                        return null;
                    }
                    if (abortCtrl.signal.aborted || ctx.unmountedRef.current) return null;
                    // Validar Content-Type — el backend puede devolver JSON de error con status 200
                    if (!ct.startsWith('audio/')) {
                        // eslint-disable-next-line no-console
                        console.error('[AUDIO_TRACE] provider_fail', {
                            provider: 'tts', contentId: _trCid, sentenceIndex: index,
                            reason: 'wrong_content_type', contentType: ct, attempt: attemptLabel,
                        });
                        log('tts_fail', { index, reason: 'wrong_content_type', contentType: ct, attempt: attemptLabel });
                        return null;
                    }
                    const blob = await res.blob();
                    if (abortCtrl.signal.aborted || ctx.unmountedRef.current) return null;
                    if (blob.size === 0) {
                        // eslint-disable-next-line no-console
                        console.error('[AUDIO_TRACE] provider_fail', {
                            provider: 'tts', contentId: _trCid, sentenceIndex: index,
                            reason: 'empty_tts_blob', contentType: ct, attempt: attemptLabel,
                        });
                        log('blob_invalid', { index, reason: 'empty_tts_blob', attempt: attemptLabel });
                        return null;
                    }
                    return URL.createObjectURL(blob);
                };

                let url: string | null = null;
                let recoveredViaFallback = false;
                let fallbackChars = 0;

                // Intento primario — frase completa, timeout real.
                try {
                    const resPrimary = await attemptTts(txt, TTS_PRIMARY_TIMEOUT_MS, 'primary');
                    url = await materializeTts(resPrimary, 'primary');
                } catch (ePrimary: any) {
                    if (abortCtrl.signal.aborted) {
                        // Cancelación externa (jump/resume/unmount): no reintentar.
                        // eslint-disable-next-line no-console
                        console.log('[AUDIO_TRACE] aborted', {
                            sentenceIndex: index,
                            reason: abortCtrl.signal.reason?.message ?? abortCtrl.signal.reason ?? 'aborted',
                            attempt: 'primary',
                        });
                        return null;
                    }
                    // Timeout (u otro fallo recuperable) del intento primario → fallback.
                    // eslint-disable-next-line no-console
                    console.warn('[AUDIO_TRACE] tts_timeout_retry', {
                        sentenceIndex: index, chunkKey, cacheKey: key,
                        reason: ePrimary?.name, message: ePrimary?.message,
                    });
                    // HF4A — UX honesta: el primer TTS está demorando. Señal
                    // observacional para que el visor pueda comunicar "Audio
                    // demorando…" en lugar de un silencio o falso "Sin audio".
                    log('autoplay_blocked' as any, { event: 'PB_AUDIO_DELAYED', index, reason: ePrimary?.name ?? 'timeout' });
                }

                // Fallback — sólo si el primario no produjo audio y la carga sigue viva.
                // Recorta a una unidad hablable corta para que el TTS responda dentro del
                // timeout y el usuario escuche desde la frase inicial real.
                if (!url && !abortCtrl.signal.aborted && !ctx.unmountedRef.current) {
                    const shortText = firstSpeakableUnit(txt, TTS_FALLBACK_MAX_CHARS);
                    fallbackChars = shortText.length;
                    // eslint-disable-next-line no-console
                    console.log('[AUDIO_TRACE] fallback_sentence_tts', {
                        sentenceIndex: index, chunkKey, cacheKey: key, forceSentenceTts: true,
                        reason: 'first_play_after_resume',
                    });
                    // eslint-disable-next-line no-console
                    console.log('[AUDIO_TRACE] fallback_text_length', {
                        sentenceIndex: index, originalLen: txt.length, fallbackLen: fallbackChars,
                        maxChars: TTS_FALLBACK_MAX_CHARS, truncated: fallbackChars < txt.length,
                    });
                    if (shortText) {
                        try {
                            const resFallback = await attemptTts(shortText, TTS_FALLBACK_TIMEOUT_MS, 'fallback');
                            url = await materializeTts(resFallback, 'fallback');
                            if (url) recoveredViaFallback = true;
                        } catch (eFallback: any) {
                            if (!abortCtrl.signal.aborted) {
                                // eslint-disable-next-line no-console
                                console.error('[AUDIO_TRACE] provider_fail', {
                                    provider: 'tts', contentId: _trCid, sentenceIndex: index,
                                    reason: eFallback?.name, message: eFallback?.message, attempt: 'fallback',
                                });
                                log('tts_fail', { index, error: eFallback?.name, message: eFallback?.message, attempt: 'fallback' });
                            }
                        }
                    }
                }

                // eslint-disable-next-line no-console
                console.log('[AUDIO_TRACE] getAudioUrl_result', {
                    sentenceIndex: index, chunkKey, cacheKey: key,
                    urlPresent: !!url, recoveredViaFallback,
                });

                if (!url) return null;
                if (abortCtrl.signal.aborted || ctx.unmountedRef.current) {
                    URL.revokeObjectURL(url);
                    return null;
                }

                // Cachear bajo `key` (la clave que getAudioUrl consulta a la entrada) para
                // que re-llamadas hagan cache-hit y NO repitan el timeout primario.
                audioCache.current.set(key, url);
                cacheMetricsRef.current.created++;  // M-5.4 metric
                if (recoveredViaFallback) {
                    fallbackTtsKeysRef.current.add(key);
                    // eslint-disable-next-line no-console
                    console.log('[PB_AUDIO_RECOVERED]', {
                        sentenceIndex: index, chunkKey, cacheKey: key,
                        via: 'fallback_sentence_tts', chars: fallbackChars,
                    });
                }
                // eslint-disable-next-line no-console
                console.log('[AUDIO_TRACE] provider_result', {
                    provider: 'tts', contentId: _trCid,
                    sentenceIndex: index, chunkKey, cacheKey: key, forceSentenceTts,
                    hasUrl: true, urlType: typeof url, recoveredViaFallback,
                });
                // eslint-disable-next-line no-console
                console.log('[CACHE_ENTRY_CREATED] created=' + cacheMetricsRef.current.created, { key, via: recoveredViaFallback ? 'tts_fallback' : 'tts' });
                return url;

            } catch (e: any) {
                if (e.name !== 'AbortError') {
                    // eslint-disable-next-line no-console
                    console.error('[AUDIO_TRACE] provider_fail', {
                        provider: 'task_catch', contentId: _trCid,
                        sentenceIndex: index,
                        reason: e.name, message: e.message,
                    });
                    log('tts_fail', { index, error: e.name, message: e.message });
                } else {
                    // eslint-disable-next-line no-console
                    console.log('[AUDIO_TRACE] aborted', {
                        sentenceIndex: index, reason: e.message ?? 'AbortError',
                    });
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

    // ── BLOCKER FINAL V2 / TASK 2 — invariante de transición de chunk segura ──
    //
    // Ejecutado ANTES de play() y ANTES de spawn del executor (path gapless).
    //   1. expectedChunkKey = toChunkKey(targetIndex)
    //   2. expectedAudioSrc = getAudioUrl(targetIndex)  (cache-hit normal)
    //   3. actualSrc        = audioEl.src
    //   4. si difieren (decideChunkTransition === 'reload'):
    //        - NO play / NO spawn sobre audio stale,
    //        - cancelar executor del chunk anterior (TASK 3),
    //        - cargar el audio correcto,
    //        - esperar canplay/loadedmetadata suficiente,
    //        - currentTime = 0, confirmar,
    //        - recién entonces el caller hace play() + spawn.
    //   5. si no se resuelve el src esperado ('fail') → caller hace fallback
    //      determinista (load limpio). NUNCA play sobre audio equivocado.
    //
    // perSentence: el standby YA trae el audio correcto → 'reuse' → no-op.
    const AUDIO_READY_TIMEOUT_MS = 4000;
    const ensureAudioMatchesExpectedChunk = async (
        audioEl: HTMLAudioElement | null,
        targetIndex: number,
        callsite: string,
    ): Promise<'reuse' | 'reloaded' | 'fail'> => {
        if (!audioEl) return 'fail';
        const expectedChunkKey = toChunkKey(targetIndex);
        const actualSrc        = audioEl.src || '';
        // eslint-disable-next-line no-console
        console.log('[GAPLESS_CHUNK_TRANSITION_START]', {
            callsite,
            targetIndex,
            expectedChunkKey,
            actualSrcTail:    actualSrc.slice(-60),
            audioPaused:      audioEl.paused,
            audioReadyState:  audioEl.readyState,
            audioDuration:    audioEl.duration,
            audioCurrentTime: audioEl.currentTime,
            sessionId:        contentSessionRef.current,
        });
        const expectedAudioSrc = await getAudioUrl(targetIndex);
        const decision = decideChunkTransition({
            expectedChunkKey,
            expectedAudioSrc,
            actualAudioSrc: actualSrc,
        });

        if (decision.action === 'reuse') {
            // eslint-disable-next-line no-console
            console.log('[GAPLESS_CHUNK_AUDIO_READY]', {
                callsite,
                targetIndex,
                expectedChunkKey,
                via:              'already_correct_src',
                audioReadyState:  audioEl.readyState,
                audioDuration:    audioEl.duration,
                sessionId:        contentSessionRef.current,
            });
            return 'reuse';
        }

        if (decision.action === 'fail') {
            // eslint-disable-next-line no-console
            console.warn('[CHUNK_AUDIO_SOURCE_MISMATCH]', {
                callsite,
                targetIndex,
                expectedChunkKey,
                reason:        decision.reason,
                actualSrcTail: actualSrc.slice(-60),
                sessionId:     contentSessionRef.current,
            });
            return 'fail';
        }

        // ── decision.action === 'reload' — MISMATCH: audio stale ─────────────
        // eslint-disable-next-line no-console
        console.warn('[CHUNK_AUDIO_SOURCE_MISMATCH]', {
            callsite,
            targetIndex,
            expectedChunkKey,
            reason:          decision.reason,
            actualSrcTail:   actualSrc.slice(-60),
            expectedSrcTail: String(expectedAudioSrc).slice(-60),
            sessionId:       contentSessionRef.current,
        });
        // eslint-disable-next-line no-console
        console.log('[GAPLESS_CHUNK_AUDIO_LOAD_REQUIRED]', {
            callsite,
            targetIndex,
            expectedChunkKey,
            sessionId: contentSessionRef.current,
        });
        // TASK 3 — cancelar el executor del chunk anterior ANTES de cargar /
        // spawnear. Garantiza un único executor por chunk (activeExecutor ≤ 1).
        cancelSyncStrategy('gapless_chunk_transition');
        audioEl.src          = expectedAudioSrc as string;
        audioEl.playbackRate = ctx.speedRef.current;
        audioEl.load();
        const ready = await new Promise<boolean>((resolve) => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | null = null;
            const finish = (okFlag: boolean) => {
                if (settled) return;
                settled = true;
                audioEl.removeEventListener('canplay', onCanPlay);
                audioEl.removeEventListener('loadedmetadata', onMeta);
                if (timer !== null) clearTimeout(timer);
                resolve(okFlag);
            };
            const onCanPlay = () => finish(true);
            const onMeta    = () => { if (audioEl.readyState >= 2) finish(true); };
            // readyState >= 2 (HAVE_CURRENT_DATA) ya basta para play()+currentTime.
            if (audioEl.readyState >= 2) { finish(true); return; }
            audioEl.addEventListener('canplay', onCanPlay, { once: true });
            audioEl.addEventListener('loadedmetadata', onMeta);
            timer = setTimeout(() => finish(audioEl.readyState >= 2), AUDIO_READY_TIMEOUT_MS);
        });
        if (!ready) {
            // eslint-disable-next-line no-console
            console.warn('[CHUNK_AUDIO_SOURCE_MISMATCH]', {
                callsite,
                targetIndex,
                expectedChunkKey,
                reason:          'audio_never_became_ready_after_reload',
                audioReadyState: audioEl.readyState,
                sessionId:       contentSessionRef.current,
            });
            return 'fail';
        }
        try { audioEl.currentTime = 0; } catch { /* ignore — algunos browsers lanzan si no seekable aún */ }
        // eslint-disable-next-line no-console
        console.log('[GAPLESS_CHUNK_AUDIO_READY]', {
            callsite,
            targetIndex,
            expectedChunkKey,
            via:              'reloaded_correct_src',
            audioReadyState:  audioEl.readyState,
            audioDuration:    audioEl.duration,
            audioCurrentTime: audioEl.currentTime,
            sessionId:        contentSessionRef.current,
        });
        return 'reloaded';
    };

    // ── GC de blobs — usa currentIdxRef interno, no necesita parámetro externo ─
    const runGC = useCallback(() => {
        if (audioCache.current.size === 0) return;
        const currentIdx = currentIdxRef.current;
        const total  = ctx.sentencesRef.current.length;
        const lowerSentence = Math.max(0, currentIdx - 20);
        const upperSentence = Math.min(total - 1, currentIdx + 20);
        const lower  = toChunkKey(Math.max(0, currentIdx - 20));
        const upper  = toChunkKey(Math.min(total - 1, currentIdx + 20));
        const toDelete: number[] = [];
        audioCache.current.forEach((blobUrl, k) => {
            if (isSentenceTtsCacheKey(k)) {
                const sentenceIndex = fromSentenceTtsCacheKey(k);
                if (sentenceIndex < lowerSentence || sentenceIndex > upperSentence) {
                    URL.revokeObjectURL(blobUrl);
                    toDelete.push(k);
                }
                return;
            }
            if (k < lower || k > upper) { URL.revokeObjectURL(blobUrl); toDelete.push(k); }
        });
        toDelete.forEach(k => audioCache.current.delete(k));
        if (toDelete.length > 0) {
            cacheMetricsRef.current.evicted += toDelete.length;
            cacheMetricsRef.current.revoked += toDelete.length;
            console.debug(`[PB GC] Freed ${toDelete.length} blobs. Active: ${audioCache.current.size}`);
            // eslint-disable-next-line no-console
            console.log('[CACHE_ENTRY_EVICTED]', {
                evicted: toDelete.length,
                via:     'runGC',
                totalEvicted: cacheMetricsRef.current.evicted,
                activeNow:    audioCache.current.size,
            });
        }
        // M-5.4 — growth warning. Si el cache crece >100 entries activas, algo
        // está mal con la GC (ventana ±20 sentences debería mantenerlo ~40).
        if (audioCache.current.size > 100) {
            // eslint-disable-next-line no-console
            console.warn('[CACHE_GROWTH_WARNING]', {
                size: audioCache.current.size,
                inFlight: inFlight.current.size,
                created:  cacheMetricsRef.current.created,
                evicted:  cacheMetricsRef.current.evicted,
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // M-5.3.4: avance visual liviano dentro del MISMO chunk de audio.
    //
    // Caso: el lector reproduce audio del chunk K (cubre frases a..b). El
    // SyncStrategyExecutor detecta que llegó el momento de activar la frase
    // i+1 (también dentro del chunk K). Llamar a pb.skip(i+1) o pb.load(i+1)
    // reiniciaría el audio — incorrecto. Esta función hace SOLO el avance
    // visual + de buffer, sin tocar audio.
    //
    // El caller (executor) garantiza que ambas frases viven en el mismo
    // chunk. NO valida — confianza de contrato.
    //
    // Definido ANTES de pb.load porque el callback del executor en pb.load
    // referencia esta función al momento del .play().then().
    const advanceWithinChunk = (toIndex: number): void => {
        const total = ctx.sentencesRef.current.length;
        const fromIdx = currentIdxRef.current;
        // BLOCKER M-5.4.3 — Diagnostic log. Si el executor está disparando
        // onSentenceActivate pero el visor sigue pegado en idx=0, este log
        // confirma si advanceWithinChunk se invocó o no. Si NUNCA aparece
        // tras varios timeupdates con audio corriendo, el executor murió.
        // eslint-disable-next-line no-console
        console.log('[ADVANCE_WITHIN_CHUNK_CALLED]', {
            fromIdx,
            toIndex,
            fromChunk:        toChunkKey(fromIdx),
            toChunk:          toChunkKey(toIndex),
            sameChunk:        toChunkKey(fromIdx) === toChunkKey(toIndex),
            statusBefore:     statusRef.current,
            bufferIndexBefore: machineRef.current?.buffer?.current?.index ?? null,
            audioMode:        ctx.audioModeRef?.current ?? null,
            sessionId:        contentSessionRef.current,
        });
        if (toIndex < 0 || toIndex >= total) return;
        if (toIndex === fromIdx) return;  // no-op silencioso

        // BLOCKER M-5.4.5 — Defensa contra callbacks de executor stale post
        // manual nav / hard_resync. advanceWithinChunk se llama desde:
        //   (a) onSentenceActivate del executor activo, O
        //   (b) load() en chunk-reuse fast path (mismo chunkKey).
        // Si syncStrategyHandleRef existe PERO isAlive=false, es el caso (a)
        // de un executor cancelado cuya callback estaba in-flight cuando se
        // hizo cancel(). Logueamos + return.
        const _execHandle = syncStrategyHandleRef.current;
        if (_execHandle && !_execHandle.isAlive()) {
            // eslint-disable-next-line no-console
            console.warn('[STALE_EXECUTOR_AFTER_MANUAL_NAV]', {
                fromIdx, toIndex,
                staleExecutorSessionId: _execHandle.sessionId,
                staleExecutorMode:      _execHandle.mode,
                currentSessionId:       contentSessionRef.current,
            });
            return;
        }

        // M-5.4.6 (Case 2) — Guard defensivo: si el executor está activo y
        // su rango registrado [_spawnFromIndex, _chunkEndIndex] no contiene
        // toIndex, rechazamos. Cubre el caso "executor para chunk 0 con
        // spawnFrom=10 intenta activar sentenceIdx:0".
        if (_execHandle && _execHandle.isAlive()) {
            const _spawnFrom = (_execHandle as any)._spawnFromIndex;
            const _chunkEnd  = (_execHandle as any)._chunkEndIndex;
            if (Number.isFinite(_spawnFrom) && Number.isFinite(_chunkEnd)
                && (toIndex < _spawnFrom || toIndex > _chunkEnd)) {
                // eslint-disable-next-line no-console
                console.warn('[STALE_OR_LOCAL_INDEX_REJECTED]', {
                    fromIdx, toIndex,
                    executorSpawnFrom: _spawnFrom,
                    executorChunkEnd:  _chunkEnd,
                    executorChunkKey:  (_execHandle as any)._chunkKey,
                    audioMode:         ctx.audioModeRef?.current ?? null,
                    sessionId:         contentSessionRef.current,
                    note:              'executor activation outside spawn range',
                });
                return;
            }
        }

        // M-5.4.6 (DEMOLITION Phase 1.a) — stamps de timestamp eliminados.
        // El drift detector que los leía fue removido del visor; mantener los
        // refs sería overhead sin lectores.

        // M-5.4.6 — En chunked mode, los dispatchMachine que siguen son
        // best-effort: PB_SENTENCE_COMPLETED_REJECTED y PB_AUDIO_STARTED_REJECTED
        // son normales acá porque la machine sigue exigiendo el contrato visual
        // que Phase 1.b va a eliminar. Una vez completado Phase 1.b, esos
        // rejections desaparecen.

        log('autoplay_blocked' as any, {
            event: 'CHUNK_AUDIO_REUSE',
            from: fromIdx, to: toIndex,
            chunkKey: toChunkKey(toIndex),
            note: 'sentence_advance_without_audio_reload',
        });
        log('autoplay_blocked' as any, {
            event: 'CHUNK_AUDIO_SKIP_RELOAD',
            from: fromIdx, to: toIndex,
            chunkKey: toChunkKey(toIndex),
        });

        // 1. Buffer: cerrar la frase anterior + preparar la nueva.
        //    SENTENCE_COMPLETED es best-effort.
        dispatchMachine({ type: MA.SENTENCE_COMPLETED, index: fromIdx });
        dispatchMachine({
            type: MA.PREPARE_SENTENCE,
            index:       toIndex,
            displayText: ctx.sentencesRef.current[toIndex] ?? '',
            spokenText:  ctx.audioSentencesRef.current[toIndex] ?? '',
            userId:      ctx.userIdRef.current,
            now:         Date.now(),
        });

        // 2. Mover índice canónico — el visor renderea, useLayoutEffect valida
        //    y emite ack via emitAckIfNew (M-5.3.3 predicate).
        setIdx(toIndex);

        // 3. AUDIO_STARTED para el nuevo idx — defer 1 microtask para que React
        //    aplique setIdx y el ack del visor llegue primero (status='visible'
        //    requerido por markAudioStarted en activeSentenceBuffer).
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(() => {
                if (ctx.unmountedRef.current) return;
                if (currentIdxRef.current !== toIndex) return;
                dispatchMachine({ type: MA.AUDIO_STARTED, index: toIndex });
            });
        }
    };

    // ── LOAD — entry point principal para cualquier cambio de índice ──────────
    const load = useCallback(async (
        index: number,
        autoPlay = false,
        options: PlaybackLoadOptions = {},
    ): Promise<void> => {
        const { chunkKey: requestedChunkKey, cacheKey: requestedCacheKey, forceSentenceTts } =
            resolveAudioUrlMode(index, options);
        const isResumeAnchoredPlay = options.anchorFirstAudio === true || options.forceSentenceTts === true;
        let resumeCacheInvalidated = false;
        // ── [M532_LOAD] TEMP DEBUG — borrar tras causa raíz identificada ────
        // Stack trace identifica EXACTAMENTE qué caller del visor o del hook
        // disparó este load — clave para detectar si pb.load se invoca múltiples
        // veces sobre el mismo índice (sospecha principal del ACK loop M-5.3.2).
        // eslint-disable-next-line no-console
        console.log('[M532_LOAD] load_called', {
            index,
            autoPlay,
            loadReason:    options.reason ?? null,
            anchorFirstAudio: options.anchorFirstAudio === true,
            forceSentenceTts,
            statusBefore: statusRef.current,
            contentId:    ctx.contentIdRef.current,
            currentIdx:   currentIdxRef.current,
            caller:       new Error().stack?.split('\n').slice(2, 7).map(l => l.trim()).join(' | ') ?? '',
        });

        // [RS-DEBUG]
        if (ctx.unmountedRef.current) {
            return;
        }
        if (index < 0 || index >= ctx.sentencesRef.current.length) {
            return;
        }
        if (forceSentenceTts) {
            sentenceTtsOverrideChunkKeyRef.current = requestedChunkKey;
            resumeCacheInvalidated = invalidateChunkAudioForResume(index);
        } else if (
            sentenceTtsOverrideChunkKeyRef.current !== null
            && sentenceTtsOverrideChunkKeyRef.current !== requestedChunkKey
        ) {
            sentenceTtsOverrideChunkKeyRef.current = null;
        }

        // INV-15/16: load() es invocado por skip() y por load directo del visor.
        // Cualquier avance pendiente del ciclo anterior debe cancelarse ANTES
        // de cambiar tokens — si no, el setTimeout del ciclo viejo dispararía
        // doAdvance que early-returnea por token, pero ya emitió el log.
        cancelPendingAdvance('skip_or_load');

        // ── M-5.3.4 — chunk reuse fast path ─────────────────────────────────
        // Si el target index vive en el MISMO chunk que el index actual Y el
        // audio del chunk YA está reproduciendo (pActive.src + !paused), NO
        // recargamos audio. Solo avanzamos visualmente vía advanceWithinChunk.
        // Esto distingue "sentence advance" de "audio source transition" —
        // crítico para contenidos con N frases por chunk.
        const _curIdx        = currentIdxRef.current;
        const _curChunkKey   = toChunkKey(_curIdx);
        const _newChunkKey   = toChunkKey(index);
        const _pActiveCheck  = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        const _audioPlaying  = !!(_pActiveCheck?.src && !_pActiveCheck.paused);
        if (autoPlay
            && _curChunkKey === _newChunkKey
            && _curIdx !== index
            && _audioPlaying) {
            // eslint-disable-next-line no-console
            console.log('[SYNC] CHUNK_AUDIO_REUSE_VIA_LOAD', {
                from: _curIdx, to: index, chunkKey: _curChunkKey,
                bypass: 'load_skipped_advanceWithinChunk_used',
            });
            advanceWithinChunk(index);
            return;
        }

        // Cualquier ejecución previa del SyncStrategyExecutor debe cancelarse
        // antes de arrancar un nuevo audio (cambio de chunk o nuevo libro).
        cancelSyncStrategy('load_new_audio');

        const token = ++loadToken.current;
        setStatus('loading');

        // HF4A-R2 — intención REAL de leer: una nueva invocación de load() sale
        // del estado "completado". Esto SOLO afecta a invocaciones nuevas: un
        // load() stale ya ejecutó su prólogo en el pasado y NO vuelve a correr
        // esta línea; si la sesión se completa durante su await, el guard
        // post-getAudioUrl lo descartará igual. Permite que el "leer de nuevo"
        // del overlay (pb.load) reactive la lectura, sin reabrir resultados
        // tardíos.
        sessionCompletedRef.current = false;

        // M-5.4.6 (Case 1) — VISUAL_INDEX_COMMITTED inmediato. El render NO
        // puede esperar a getAudioUrl. Antes: setIdx(index) corría DESPUÉS del
        // fetch TTS, lo que generaba black screen en restore (currentIndex
        // quedaba en 0 mientras targetIndex era 72). Ahora el visual avanza
        // antes que el audio. Dispatch PREPARE_SENTENCE también acá para que
        // el buffer tenga current.index correcto.
        const _fromVisualIdx = currentIdxRef.current;
        setIdx(index);
        dispatchMachine({
            type: MA.PREPARE_SENTENCE,
            index,
            displayText: ctx.sentencesRef.current[index] ?? '',
            spokenText:  ctx.audioSentencesRef.current[index] ?? '',
            userId:      ctx.userIdRef.current,
            now:         Date.now(),
        });
        // eslint-disable-next-line no-console
        console.log('[VISUAL_INDEX_COMMITTED]', {
            from:             _fromVisualIdx,
            to:               index,
            reason:           'load',
            autoPlay,
            beforeAudioFetch: true,
            contentId:        ctx.contentIdRef.current,
            sessionId:        contentSessionRef.current,
        });

        // Detener ambos players inmediatamente — sin overlap
        audioRefA.current?.pause();
        audioRefB.current?.pause();
        cancelStaleFetches(index);

        // ── [AUDIO_TRACE] TEMPORAL — M-2.6/2.7. REMOVE AFTER FIX ────────────
        // eslint-disable-next-line no-console
        console.log('[AUDIO_TRACE] request', {
            contentId:     ctx.contentIdRef.current,
            sentenceIndex: index,
            sessionId:     contentSessionRef.current,
            via:           'load',
            autoPlay,
            forceSentenceTts,
            reason:        options.reason ?? null,
        });
        // HF4A — UX honesta: si el audio NO está cacheado, vamos a generarlo
        // ahora. Señalamos "preparando" para que el visor muestre estado de
        // trabajo en curso en lugar de silencio o un "Sin audio" prematuro.
        if (!audioCache.current.has(requestedCacheKey)) {
            log('autoplay_blocked' as any, { event: 'PB_AUDIO_PREPARING', index, autoPlay, reason: options.reason ?? null });
        }
        const url = await getAudioUrl(index, {
            forceSentenceTts,
            reason: options.reason,
        });

        // Si llegó una carga más reciente o el componente se desmontó, abortar silenciosamente
        if (token !== loadToken.current || ctx.unmountedRef.current) {
            log('load_cancelled', { index, reason: token !== loadToken.current ? 'stale_token' : 'unmounted' });
            return;
        }

        // ── HF4A-R2 — TRIPLE COHERENCIA (post-getAudioUrl) ───────────────────
        // El await de getAudioUrl pudo tardar (primer TTS lento). Antes de
        // limpiar fallo, marcar, cambiar status, set src o reproducir, exigimos
        // que el resultado tardío SIGA correspondiendo a la frase visual activa,
        // a la generación vigente y a una sesión NO completada. Esto cierra el
        // hueco same-chunk de manualSentenceJump: ese path mueve currentIdxRef
        // (setIdx) SIN incrementar loadToken, por lo que el chequeo de token no
        // basta — pero `index !== currentIdxRef.current` SÍ lo detecta. Si la
        // sesión se completó durante el await, también descartamos. Se chequea
        // ANTES del manejo de `!url` para no contaminar estado de una frase que
        // el usuario ya abandonó.
        const _coh = evaluateRecoveryCoherence({
            requestedIndex:   index,
            currentIndex:     currentIdxRef.current,
            token,
            currentToken:     loadToken.current,
            sessionCompleted: sessionCompletedRef.current,
        });
        if (!_coh.ok) {
            log('autoplay_blocked' as any, {
                event:           'PB_AUDIO_STALE_RESULT_DROPPED',
                index,
                currentIndex:    currentIdxRef.current,
                visualIndex:     currentIdxRef.current,
                token,
                loadToken:       loadToken.current,
                sessionCompleted: sessionCompletedRef.current,
                reason:          _coh.reason,
                where:           'post_getAudioUrl',
            });
            return;
        }

        const pActive  = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        const pStandby = activePlayer.current === 'A' ? audioRefB.current : audioRefA.current;
        if (!pActive || !pStandby) return;

        if (!url) {
            // F12 — Sin audio recuperable. Marcar el index como audio_failed
            // para que subsiguientes intentos (autoadvance, resume) bloqueen
            // antes de play() sin disparar hardResync. La frase sigue visible
            // en modo texto puro.
            audioFailedKeysRef.current.add(toChunkKey(index));
            audioFailureReasonsRef.current.set(toChunkKey(index), 'no_url'); // HF4A: recuperable
            log('autoplay_blocked' as any, { event: 'PB_AUDIO_UNRECOVERABLE', index, via: 'no_url_after_getAudioUrl' });
            setStatus('error');
            // M-5.4.6 (Case 1) — setIdx ya se ejecutó al inicio de load().
            return;
        }

        // ── HF4A-R2 — REVALIDACIÓN PRE-SPAWN (defensa en profundidad) ────────
        // Aunque ya validamos tras getAudioUrl y no hay await intermedio, se
        // revalida inmediatamente antes de limpiar/asignar src/reproducir. Barato
        // y a prueba de futuros refactors que introduzcan asincronía aquí.
        const _coh2 = evaluateRecoveryCoherence({
            requestedIndex:   index,
            currentIndex:     currentIdxRef.current,
            token,
            currentToken:     loadToken.current,
            sessionCompleted: sessionCompletedRef.current,
        });
        if (!_coh2.ok) {
            log('autoplay_blocked' as any, {
                event:            'PB_AUDIO_STALE_RESULT_DROPPED',
                index,
                currentIndex:     currentIdxRef.current,
                visualIndex:      currentIdxRef.current,
                token,
                loadToken:        loadToken.current,
                sessionCompleted: sessionCompletedRef.current,
                reason:           _coh2.reason,
                where:            'pre_spawn',
            });
            return;
        }

        // HF4A — CLEAR-ON-VALID-URL (fix central). Obtuvimos una URL válida
        // para `index`. Si ese índice había quedado marcado como fallido por un
        // motivo RECUPERABLE (no_url/timeout/abort — típicamente el primer TTS
        // lento que el backend cacheó después), limpiamos la marca ANTES del
        // pre_play_check para que NO se emita PB_AUDIO_UNRECOVERABLE sobre una
        // frase que ya tiene audio reproducible. Fallos persistentes
        // (NotSupportedError) NO se limpian acá — los protege audioRetriedKeysRef.
        // HF4A-R2: la triple coherencia (arriba) garantiza que `index` es la
        // frase visual vigente, así que el clear nunca afecta a otra frase.
        clearRecoverableFailure(index, 'valid_url');

        pActive.src          = url;
        pActive.playbackRate = ctx.speedRef.current;
        activeAudioCacheKeyRef.current = requestedCacheKey;
        activeAudioFirstSpokenIndexRef.current = forceSentenceTts
            ? index
            : firstSentenceIndexForChunkKey(requestedChunkKey);
        if (isResumeAnchoredPlay) {
            // eslint-disable-next-line no-console
            console.log(
                `[immersive-tts-resume] visualIndex=${index} ` +
                `audioStartIndex=${index} ` +
                `firstSpokenIndex=${activeAudioFirstSpokenIndexRef.current} ` +
                `cacheInvalidated=${resumeCacheInvalidated}`,
                {
                    contentId: ctx.contentIdRef.current,
                    visualIndex: index,
                    audioStartIndex: index,
                    firstSpokenIndex: activeAudioFirstSpokenIndexRef.current,
                    chunkKey: requestedChunkKey,
                    cacheKey: requestedCacheKey,
                    forceSentenceTts,
                    cacheInvalidated: resumeCacheInvalidated,
                    reason: options.reason ?? null,
                    sessionId: contentSessionRef.current,
                },
            );
        }
        // M-5.4.6 (Case 1) — setIdx + PREPARE_SENTENCE ya se hicieron arriba
        // antes del fetch TTS. Acá sólo enlazamos audio src al index ya visible.

        if (autoPlay) {
            // M-5.4.6 (DEMOLITION Phase 1.b.1) — Gates de visual ACK eliminados.
            // Antes: waitForVisualAck + requestAudioStart eran HARD GATES que
            // exigían que el visor confirmara render antes de tocar audio.
            // Eso violaba el nuevo INV: "Playback must never wait for render
            // confirmation". El runtime ahora arranca audio sin esperar al DOM.

            // F12 — AUDIO CONTRACT: si el blob fue marcado audio_failed antes,
            // todavía bloqueamos. (Phase 1.b.B simplificará este path.)
            if (isAudioFailed(index)) {
                log('autoplay_blocked' as any, { event: 'PB_AUDIO_UNRECOVERABLE', index, via: 'pre_play_check' });
                setStatus('error');
                ctx.onPlayChange.current(false);
                return;
            }

            setStatus('playing');
            ctx.onPlayChange.current(true);
            sentenceStartTimeRef.current = Date.now();

            // BLOCKER M-5.4.3 — Instrumentación pre-play. Useful para distinguir
            // "play() nunca fue llamado" de "play() fue llamado pero falló".
            // eslint-disable-next-line no-console
            console.log('[PB_PLAY_ATTEMPT]', {
                callsite:        'load_autoplay',
                index,
                contentId:       ctx.contentIdRef.current,
                mode:            ctx.audioModeRef?.current ?? null,
                statusBefore:    statusRef.current,
                audioPaused:     pActive.paused,
                audioReadyState: pActive.readyState,
                audioDuration:   pActive.duration,
                currentTime:     pActive.currentTime,
                srcTail:         (pActive.src || '').slice(-60),
                autoPlay:        true,
                sessionId:       contentSessionRef.current,
            });
            pActive.play()
                .then(() => {
                    // Confirmacion. Status ya es 'playing'; solo loggeamos.
                    const wasCached = audioCache.current.has(toChunkKey(index));
                    log('play_start', { index, cached: wasCached });
                    // eslint-disable-next-line no-console
                    console.log('[PB_PLAY_RESOLVED]', {
                        callsite:        'load_autoplay',
                        index,
                        contentId:       ctx.contentIdRef.current,
                        cached:          wasCached,
                        audioDuration:   pActive.duration,
                        audioReadyState: pActive.readyState,
                        currentTime:     pActive.currentTime,
                        sessionId:       contentSessionRef.current,
                    });
                    // eslint-disable-next-line no-console
                    console.log('[PB_LOAD_PLAY_THEN]', {
                        index,
                        sessionId: contentSessionRef.current,
                    });
                    // BLOCKER M-5.4.3 — Helper unificado. Reemplaza dispatch +
                    // timestamps + spawn que antes vivían inline acá. Si Guerra
                    // no llega a este punto, ningún SYNC_SPAWN_ATTEMPT aparecerá.
                    onAudioPlaybackStarted(pActive, index, 'load_autoplay');
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
                    } else if (e.name === 'NotSupportedError') {
                        // F12: blob corrupto/incompatible. Invalidar cache,
                        // marcar audioFailed si ya retrieó una vez. NO hardResync.
                        const key = activeAudioCacheKeyRef.current ?? requestedCacheKey;
                        const cachedUrl = audioCache.current.get(key);
                        if (cachedUrl) { URL.revokeObjectURL(cachedUrl); audioCache.current.delete(key); }
                        log('autoplay_blocked' as any, { event: 'PB_AUDIO_PLAY_UNSUPPORTED', index, error: e.name });
                        log('autoplay_blocked' as any, { event: 'PB_AUDIO_CACHE_INVALIDATED', index, via: 'play_unsupported' });
                        if (!audioRetriedKeysRef.current.has(key)) {
                            audioRetriedKeysRef.current.add(key);
                            log('autoplay_blocked' as any, { event: 'PB_AUDIO_RETRY_ATTEMPT', index });
                            ctx.onPlayChange.current(false);
                            // Reload limpio: cache invalidado fuerza re-fetch TTS fresh.
                            load(index, true, {
                                forceSentenceTts,
                                anchorFirstAudio: options.anchorFirstAudio,
                                reason: forceSentenceTts
                                    ? 'resume_anchor_retry_after_unsupported'
                                    : 'audio_retry_after_unsupported',
                            });
                        } else {
                            // Segundo fallo → unrecoverable. Pausa controlada, no hardResync.
                            // HF4A — motivo PERSISTENTE: el blob no decodifica.
                            // clear-on-valid-url NO lo limpiará aunque haya URL.
                            audioFailedKeysRef.current.add(key);
                            audioFailureReasonsRef.current.set(key, 'NotSupportedError');
                            setStatus('error');
                            ctx.onPlayChange.current(false);
                            log('autoplay_blocked' as any, { event: 'PB_AUDIO_UNRECOVERABLE', index, error: e.name });
                        }
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
        const nextUrl = await getAudioUrl(index + 1, {
            reason: forceSentenceTts ? 'resume_sentence_tts_prefetch' : undefined,
        });
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
        // F3: notificar a la machine. PAUSE cancela el buffer (current+next).
        dispatchMachine({ type: MA.PAUSE });
    }, []);

    // ── RESUME ────────────────────────────────────────────────────────────────
    // Maneja los estados 'paused' y 'blocked'.
    // En 'blocked': el audio está cargado, solo faltó interacción del usuario.
    //              La interacción que dispara resume() es suficiente para desbloquear.
    //
    // M-5.4.6 (DEMOLITION Phase 1.b.1) — Bootstrap visual ACK eliminado.
    // Antes: si canStartAudio(idx)===false, esperábamos waitForVisualAck +
    // requestAudioStart antes de play(). Eso violaba el nuevo INV "playback
    // must never wait for render confirmation". Ahora resume() simplemente
    // llama a play() — si el audio src está cargado, suena.
    const resume = useCallback(async (): Promise<void> => {
        const p = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        if (!p?.src) return;

        setStatus('loading'); // visualmente claro que algo está pasando
        p.playbackRate = ctx.speedRef.current;
        // BLOCKER M-5.4.3 — Instrumentación pre-play. Resume es el path donde
        // antes el spawn NO se hacía (bug confirmado por auditoría). Ahora pasa
        // por onAudioPlaybackStarted como cualquier otro play.
        // eslint-disable-next-line no-console
        console.log('[PB_RESUME_ATTEMPT]', {
            callsite:        'resume',
            index:           currentIdxRef.current,
            contentId:       ctx.contentIdRef.current,
            mode:            ctx.audioModeRef?.current ?? null,
            statusBefore:    statusRef.current,
            audioPaused:     p.paused,
            audioReadyState: p.readyState,
            audioDuration:   p.duration,
            currentTime:     p.currentTime,
            srcTail:         (p.src || '').slice(-60),
            sessionId:       contentSessionRef.current,
        });
        p.play()
            .then(() => {
                setStatus('playing');
                ctx.onPlayChange.current(true);
                sentenceStartTimeRef.current = Date.now(); // B4: resume confirmado → reiniciar medición
                log('play_start', { index: currentIdxRef.current, via: 'resume' });
                // eslint-disable-next-line no-console
                console.log('[PB_RESUME_RESOLVED]', {
                    callsite:        'resume',
                    index:           currentIdxRef.current,
                    contentId:       ctx.contentIdRef.current,
                    audioDuration:   p.duration,
                    audioReadyState: p.readyState,
                    currentTime:     p.currentTime,
                    sessionId:       contentSessionRef.current,
                });
                // BLOCKER M-5.4.3 — helper unificado. Despacha AUDIO_STARTED y
                // SPAWNEA EL EXECUTOR en chunked. Antes este path saltaba spawn.
                onAudioPlaybackStarted(p, currentIdxRef.current, 'resume');
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
        // M-5.4.6 (Phase 1.b.C Task 2) — skip programático también es manual nav
        // (UI o API consumer). Bump generation para invalidar callbacks viejos.
        if (delta !== 0) {
            const _fromGeneration = navGenerationRef.current;
            navGenerationRef.current = _fromGeneration + 1;
            // eslint-disable-next-line no-console
            console.log('[MANUAL_NAV_GENERATION_BUMP]', {
                fromGeneration: _fromGeneration,
                toGeneration:   navGenerationRef.current,
                reason:         'skip',
                targetIndex:    index,
            });
        }
        // F3: notificar a la machine ANTES del load (que dispara PREPARE_SENTENCE).
        // SKIP cancela el buffer (current+next) y emite HARD_RESYNC effect.
        // load() inmediatamente después dispatchea PREPARE_SENTENCE para targetIndex.
        dispatchMachine({ type: MA.SKIP, targetIndex: index });
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

        // F3: notificar a la machine que el audio terminó. Si el buffer está
        // en 'reading' (audioStarted=true), markAudioEnded toggle audioEnded=true.
        // Si el ack del visor nunca llegó (F3 todavía no lo conecta), la
        // machine emitirá PB_AUDIO_ENDED rejected — ok, observacional.
        dispatchMachine({ type: MA.AUDIO_ENDED, index: currentIdxRef.current, durationMs });

        // B3: Capturar token AHORA, antes de cualquier operación async o callback.
        // Si skip() o load() se ejecutan durante la transición (incluyendo el await abajo),
        // loadToken.current habrá cambiado y doPlay() abortará sin reproducir audio obsoleto.
        const capturedToken = loadToken.current;

        if (nextIdx >= sentences.length) {
            // F3: cerrar la frase actual en la machine antes del fin de sesión.
            dispatchMachine({ type: MA.SENTENCE_COMPLETED, index: currentIdx });
            // HF4A-R2 — marcar sesión completada ANTES de notificar fin: a partir
            // de aquí, cualquier resultado tardío de getAudioUrl, autoadvance o
            // retry queda descartado por la triple coherencia (eje completion).
            // Se resetea solo con intención real de leer (load()/manualSentenceJump).
            sessionCompletedRef.current = true;
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
            // F4.2: async para permitir await waitForVisualAck antes de play().
            const doAdvance = async (): Promise<void> => {
                // Consumir el timer ref que disparó este callback (no quedar nulo
                // si pause/skip llegaron primero — cancelPendingAdvance ya lo limpió).
                pendingAdvanceTimerRef.current = null;
                if (capturedToken !== loadToken.current) return;
                if (ctx.unmountedRef.current) return;
                if (statusRef.current !== 'playing') return;

                // F3: el floor cumplió y vamos a commitear. Notificar a la machine:
                //   - SENTENCE_COMPLETED para currentIdx (cierra la frase anterior)
                //   - PREPARE_SENTENCE para nextIdx (abre la nueva, status='preparing')
                dispatchMachine({ type: MA.SENTENCE_COMPLETED, index: currentIdx });
                dispatchMachine({
                    type: MA.PREPARE_SENTENCE,
                    index: nextIdx,
                    displayText: ctx.sentencesRef.current[nextIdx] ?? '',
                    spokenText:  ctx.audioSentencesRef.current[nextIdx] ?? '',
                    userId:      ctx.userIdRef.current,
                    now:         Date.now(),
                });

                // ── COMMIT visual + log (INV-17: index_commit ANTES de sentence_advanced) ──
                setIdx(nextIdx);
                log('index_commit', { from: currentIdx, to: nextIdx, committedAt: 'doAdvance' });
                log('sentence_advanced', { from: currentIdx, to: nextIdx });
                // ── [M532_VISUAL_ADVANCE] TEMP DEBUG — POST commit log (no rompe regex) ──
                // eslint-disable-next-line no-console
                console.log('[M532_VISUAL_ADVANCE]', {
                    from: currentIdx, to: nextIdx,
                    currentIdxRef: currentIdxRef.current,
                    bufferIndex:   machineRef.current?.buffer?.current?.index ?? null,
                    bufferStatus:  machineRef.current?.buffer?.current?.status ?? null,
                });

                // M-5.4.6 (DEMOLITION Phase 1.b.1) — Hard gating de visual ACK
                // en autoadvance ELIMINADO. Antes: tras setIdx(nextIdx),
                // waitForVisualAck + requestAudioStart hacían pausa-y-rezar
                // con hardResync si el visor no ack-eaba en 800ms. Ahora el
                // runtime sigue al siguiente play() directo. El visor renderea
                // cuando renderea — playback no espera.
                if (capturedToken !== loadToken.current || ctx.unmountedRef.current) return;

                // F12 — AUDIO CONTRACT pre-play: si nextIdx ya está marcado
                // como audio_failed (tts_fail anterior detectado durante
                // prefetch o blob corrupto), NO hacer nextEl.play().
                // Pausar en la frase visible — el user reanudará manualmente.
                if (isAudioFailed(nextIdx)) {
                    log('autoplay_blocked' as any, { event: 'PB_AUDIO_UNRECOVERABLE', index: nextIdx, via: 'autoadvance_pre_play' });
                    setStatus('error');
                    ctx.onPlayChange.current(false);
                    return;
                }

                // B4: timestamp de inicio real — después de delay+gate y justo antes de play().
                sentenceStartTimeRef.current = Date.now();

                // ── BLOCKER FINAL V2 / TASK 2 — invariante de chunk seguro ───
                // ANTES de play() y ANTES de spawn: confirmar que nextEl trae
                // el audio del chunk esperado para nextIdx. El bug del smoke
                // S-2 era exactamente esto: nextEl tenía el audio STALE del
                // chunk anterior (modelo A/B asume 1 audio = 1 frase, falso en
                // chunked) → play() reiniciaba ese audio y el executor de N+1
                // arrancaba contra el audio de N.
                const _chunkGuard = await ensureAudioMatchesExpectedChunk(
                    nextEl, nextIdx, 'gapless_advance',
                );
                if (capturedToken !== loadToken.current || ctx.unmountedRef.current) return;
                if (statusRef.current !== 'playing') return;
                if (_chunkGuard === 'fail') {
                    // NO reproducir audio stale ni spawnear sobre audio
                    // equivocado. Fallback determinista: load() limpio del
                    // índice (re-fetch + re-bind del src correcto).
                    // eslint-disable-next-line no-console
                    console.warn('[GAPLESS_CHUNK_TRANSITION_FALLBACK_LOAD]', {
                        index:     nextIdx,
                        reason:    'chunk_guard_failed',
                        sessionId: contentSessionRef.current,
                    });
                    load(nextIdx, true);
                    return;
                }
                const _nextAudioMode = resolveAudioUrlMode(nextIdx);
                if (
                    sentenceTtsOverrideChunkKeyRef.current !== null
                    && _nextAudioMode.chunkKey !== sentenceTtsOverrideChunkKeyRef.current
                ) {
                    sentenceTtsOverrideChunkKeyRef.current = null;
                }
                activeAudioCacheKeyRef.current = _nextAudioMode.cacheKey;
                activeAudioFirstSpokenIndexRef.current = _nextAudioMode.forceSentenceTts
                    ? nextIdx
                    : firstSentenceIndexForChunkKey(_nextAudioMode.chunkKey);

                // BLOCKER M-5.4.3 — Instrumentación pre-play. Gapless es el
                // tercer path (junto con load y resume) que reproduce audio.
                // Antes también saltaba spawn, lo que rompía chunked mode tras
                // el primer chunk (la sentencia avanzaba dentro del chunk_0
                // sólo si load() autoplay arrancó allí, pero al pasar a chunk_1
                // vía handleEnded el executor no se re-creaba).
                // eslint-disable-next-line no-console
                console.log('[PB_PLAY_ATTEMPT]', {
                    callsite:        'gapless_advance',
                    index:           nextIdx,
                    contentId:       ctx.contentIdRef.current,
                    mode:            ctx.audioModeRef?.current ?? null,
                    statusBefore:    statusRef.current,
                    chunkGuard:      _chunkGuard,
                    audioPaused:     nextEl.paused,
                    audioReadyState: nextEl.readyState,
                    audioDuration:   nextEl.duration,
                    currentTime:     nextEl.currentTime,
                    srcTail:         (nextEl.src || '').slice(-60),
                    autoPlay:        true,
                    sessionId:       contentSessionRef.current,
                });
                nextEl.play()
                    .then(() => {
                        if (capturedToken !== loadToken.current) return;
                        // BLOCKER FINAL V2 / TASK 2 — confirmación de play sobre
                        // el chunk correcto. Orden verificable:
                        //   GAPLESS_CHUNK_AUDIO_READY → GAPLESS_CHUNK_PLAY_CONFIRMED
                        //   → PB_PLAY_RESOLVED → SYNC_SPAWN_AFTER_AUDIO_READY
                        // eslint-disable-next-line no-console
                        console.log('[GAPLESS_CHUNK_PLAY_CONFIRMED]', {
                            callsite:         'gapless_advance',
                            index:            nextIdx,
                            expectedChunkKey: toChunkKey(nextIdx),
                            chunkGuard:       _chunkGuard,
                            audioCurrentTime: nextEl.currentTime,
                            audioDuration:    nextEl.duration,
                            audioReadyState:  nextEl.readyState,
                            srcTail:          (nextEl.src || '').slice(-60),
                            sessionId:        contentSessionRef.current,
                        });
                        // eslint-disable-next-line no-console
                        console.log('[PB_PLAY_RESOLVED]', {
                            callsite:        'gapless_advance',
                            index:           nextIdx,
                            contentId:       ctx.contentIdRef.current,
                            audioDuration:   nextEl.duration,
                            audioReadyState: nextEl.readyState,
                            currentTime:     nextEl.currentTime,
                            sessionId:       contentSessionRef.current,
                        });
                        // BLOCKER M-5.4.3 — helper unificado. Antes solo
                        // despachaba AUDIO_STARTED; ahora también spawnea
                        // executor para chunked. Sin esto, chunked content
                        // pierde avance visual al cruzar a un nuevo chunk.
                        onAudioPlaybackStarted(nextEl, nextIdx, 'gapless_advance');
                    })
                    .catch((e: DOMException) => {
                        if (capturedToken !== loadToken.current) return;
                        if (e.name === 'AbortError') return;
                        if (e.name === 'NotAllowedError') {
                            setStatus('blocked');
                            log('autoplay_blocked', { index: nextIdx, via: 'gapless' });
                            ctx.onPlayChange.current(false);
                        } else if (e.name === 'NotSupportedError') {
                            // F12: gapless con blob corrupto. Invalidar + retry una vez.
                            // NO hardResync. NO avanzar. NO guardar progreso.
                            const key = toChunkKey(nextIdx);
                            const cachedUrl = audioCache.current.get(key);
                            if (cachedUrl) { URL.revokeObjectURL(cachedUrl); audioCache.current.delete(key); }
                            log('autoplay_blocked' as any, { event: 'PB_AUDIO_PLAY_UNSUPPORTED', index: nextIdx, via: 'gapless', error: e.name });
                            log('autoplay_blocked' as any, { event: 'PB_AUDIO_CACHE_INVALIDATED', index: nextIdx, via: 'gapless_unsupported' });
                            if (!audioRetriedKeysRef.current.has(key)) {
                                audioRetriedKeysRef.current.add(key);
                                log('autoplay_blocked' as any, { event: 'PB_AUDIO_RETRY_ATTEMPT', index: nextIdx, via: 'gapless' });
                                ctx.onPlayChange.current(false);
                                load(nextIdx, true);  // reload limpio fuerza re-fetch fresh
                            } else {
                                // HF4A — motivo PERSISTENTE (decode). No se cura
                                // por valid_url; lo protege audioRetriedKeysRef.
                                audioFailedKeysRef.current.add(key);
                                audioFailureReasonsRef.current.set(key, 'NotSupportedError');
                                setStatus('error');
                                ctx.onPlayChange.current(false);
                                log('autoplay_blocked' as any, { event: 'PB_AUDIO_UNRECOVERABLE', index: nextIdx, via: 'gapless', error: e.name });
                            }
                        } else {
                            // Otros errores: comportamiento legacy (load fallback).
                            log('gapless_fail', { index: nextIdx, error: e.name });
                            load(nextIdx, true);
                            ctx.onPlayChange.current(false);
                        }
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
                // F3: notificar a la machine que la frase actual se completa.
                // load() interno emite PREPARE_SENTENCE para nextIdx.
                dispatchMachine({ type: MA.SENTENCE_COMPLETED, index: currentIdx });
                // load(nextIdx, true) abajo llama internamente a setIdx(nextIdx) —
                // visual + progress se commitean ahí (INV-17 regression guard).
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
        const key = activeAudioCacheKeyRef.current ?? toChunkKey(idx);
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
        cancelSyncStrategy('content_reset');  // M-5.3.4: matar executor del libro anterior
        cacheInvalidatedKeysRef.current.clear();
        audioFailedKeysRef.current.clear();   // F12: reset cross-content
        audioRetriedKeysRef.current.clear();  // F12: reset cross-content
        fallbackTtsKeysRef.current.clear();   // HF3: reset cross-content
        hardResyncAttemptsRef.current = 0;    // F19/Cambio C: reset cap por sesión
        loadToken.current++;
        contentSessionRef.current++;          // F15: invalida callbacks tardíos del libro anterior
        // F3: notificar a la machine. CONTENT_CHANGE limpia buffer + state.
        // El próximo PREPARE_SENTENCE (desde load) re-inicializa la sesión.
        dispatchMachine({
            type: MA.CONTENT_CHANGE,
            contentId:  ctx.contentIdRef.current,
            sessionKey: `${ctx.userIdRef.current}__${ctx.contentIdRef.current}`,
            startIndex: 0,
        });

        const _resetSize = audioCache.current.size;
        audioCache.current.forEach(url => URL.revokeObjectURL(url));
        audioCache.current.clear();
        if (_resetSize > 0) {
            cacheMetricsRef.current.evicted += _resetSize;
            cacheMetricsRef.current.revoked += _resetSize;
            // eslint-disable-next-line no-console
            console.log('[CACHE_ENTRY_EVICTED]', {
                evicted: _resetSize, via: 'reset_content_change',
                totalEvicted: cacheMetricsRef.current.evicted,
            });
        }
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
        sentenceTtsOverrideChunkKeyRef.current = null;
        activeAudioFirstSpokenIndexRef.current = null;
        activeAudioCacheKeyRef.current = null;
        standbyReadyRef.current = false;
        standbyGenRef.current++;          // invalida cualquier listener canplaythrough del ciclo anterior
        sentenceStartTimeRef.current = 0; // sin sesión activa — durationMs será null en el primer log
        setCurrentIndex(0);
        setStatus('idle');
        // HF4A: reset cross-content del registro de motivos. Post-idle a
        // propósito (no altera la ventana textual que validan tests de reset).
        audioFailureReasonsRef.current.clear();
        // HF4A-R2: nuevo contenido nunca arranca "completado".
        sessionCompletedRef.current = false;
    }, []);

    // INV-14: getter para que el visor pueda bloquear PROGRESS_SAVE cuando hay
    // un avance pendiente. No agrega hooks al árbol — solo lee refs existentes.
    const isPendingAdvance = (): boolean => (
        pendingAdvanceTimerRef.current !== null ||
        pendingFallbackTimerRef.current !== null ||
        pendingCanplaythroughCleanupRef.current !== null
    );

    // F3: notificaciones del visor a la machine. NO ejecutan side effects;
    // solo actualizan el buffer interno de la machine. Pensadas para que F7
    // las llame desde VisorInmersivo (DOM contract validator + BlockEngine
    // subscribe). Wrapper inline porque no necesitan estabilidad de identidad
    // (los call sites futuros las invocan dentro de useLayoutEffect / subscribe
    // M-5.4.6 (DEMOLITION Phase 1.b.5) — acknowledgeVisualHighlight ELIMINADO.
    // El visor pasó a READ-ONLY en Phase 1.b.2. Mantenemos un stub no-op
    // para no romper callers legacy mientras se completan los tests.
    const acknowledgeVisualHighlight = (_index: number): void => {
        // no-op: visor ya no acknowledgea al runtime
    };

    const notifyBlockComplete = (): void => {
        dispatchMachine({ type: MA.BLOCK_COMPLETE });
    };

    // F7: snapshot read-only del estado runtime de la machine.
    // Devuelve copia plana de primitivos — sin referencias mutables del state
    // interno. Usado por el drift detector del visor para validar el contrato
    // de frase activa sin importar el módulo de la machine.
    const getMachineSnapshot = (): MachineSnapshot => {
        const m = machineRef.current;
        if (!m) {
            return {
                status: 'idle',
                committedIndex: 0,
                visualIndex: 0,
                audioIndex: 0,
                progressIndex: 0,
                pendingTransition: null,
                buffer: { current: null, next: null, locked: false },
            };
        }
        const c = m.buffer?.current;
        const n = m.buffer?.next;
        const p = m.pendingTransition;
        return {
            status:         m.status,
            committedIndex: m.committedIndex,
            visualIndex:    m.visualIndex,
            audioIndex:     m.audioIndex,
            progressIndex:  m.progressIndex,
            pendingTransition: p ? {
                id:                p.id,
                fromIndex:         p.fromIndex,
                toIndex:           p.toIndex,
                reason:            p.reason,
                visualAckReceived: p.visualAckReceived,
                requireVisualAck:  p.requireVisualAck,
            } : null,
            buffer: {
                current: c ? {
                    index:                    c.index,
                    status:                   c.status,
                    audioStarted:             c.audioStarted,
                    audioEnded:               c.audioEnded,
                    progressEligible:         c.progressEligible,
                    transitionId:             c.transitionId,
                } : null,
                next: n ? {
                    index:        n.index,
                    status:       n.status,
                    transitionId: n.transitionId,
                } : null,
                locked: m.buffer?.locked ?? false,
            },
        };
    };

    // M-5.4 — Resilience snapshot READ-ONLY del runtime vivo.
    // Sin side effects. Sin emisión de eventos. Sin mutación. Devuelve copia
    // plana serializable lista para console.dir(), JSON.stringify(), o telemetría.
    const getRuntimeDiagnostics = (): Record<string, any> => {
        const m   = machineRef.current;
        const c   = m?.buffer?.current;
        const n   = m?.buffer?.next;
        const pA  = audioRefA.current;
        const pB  = audioRefB.current;
        const pAct  = activePlayer.current === 'A' ? pA : pB;
        const pStb  = activePlayer.current === 'A' ? pB : pA;
        const exec  = syncStrategyHandleRef.current;
        const cidx  = currentIdxRef.current;
        const ckey  = ctx.toChunkRef.current[cidx] ?? cidx;
        return {
            sessionId:             contentSessionRef.current,
            contentId:             ctx.contentIdRef.current,
            currentSentence:       cidx,
            currentChunk:          ckey,
            audioMode:             ctx.audioModeRef?.current ?? null,
            syncStrategy: exec ? {
                active:    !!exec.isAlive(),
                sessionId: exec.sessionId,
                mode:      exec.mode,
            } : null,
            playbackState: {
                status:    statusRef.current,
                isPlaying: statusRef.current === 'playing',
                loadToken: loadToken.current,
            },
            activeAudioSrc:        pAct?.src ?? null,
            standbyAudioSrc:       pStb?.src ?? null,
            activeExecutor:        exec
                ? { isAlive: exec.isAlive(), sessionId: exec.sessionId, mode: exec.mode }
                : null,
            activeTimers: {
                pendingAdvance:        pendingAdvanceTimerRef.current !== null,
                pendingFallback:       pendingFallbackTimerRef.current !== null,
                pendingCanplaythrough: pendingCanplaythroughCleanupRef.current !== null,
            },
            pendingAdvances:       isPendingAdvance() ? 1 : 0,
            hardResyncCount:       hardResyncAttemptsRef.current,
            // M-5.4.7 Task 4 + Task 5 — runtime hygiene counters.
            navGeneration:         navGenerationRef.current,
            staleCallbackRejects:  staleCallbackRejectCountRef.current,
            executorCancels:       executorCancelCountRef.current,
            uptimeMs:              Date.now() - runtimeStartedAtRef.current,
            cacheEntries: {
                audioCache:      audioCache.current.size,
                inFlight:        inFlight.current.size,
                abortCtrls:      abortCtrls.current.size,
                audioFailedKeys: audioFailedKeysRef.current.size,
                audioRetriedKeys:audioRetriedKeysRef.current.size,
                cacheInvalidatedKeys: cacheInvalidatedKeysRef.current.size,
            },
            cacheMetrics: {
                created: cacheMetricsRef.current.created,
                reused:  cacheMetricsRef.current.reused,
                evicted: cacheMetricsRef.current.evicted,
                revoked: cacheMetricsRef.current.revoked,
            },
            ownershipTokens: {
                contentSession:  contentSessionRef.current,
                loadToken:       loadToken.current,
                standbyGen:      standbyGenRef.current,
                executorSpawnCount: executorSpawnCountRef.current,
                ownershipViolationCount: ownershipViolationCountRef.current,
            },
            // M-5.4.6 — visualAckState eliminado (visual ACK removido del runtime).
            visualAckState: {
                bufferStatus:      c?.status ?? null,
                bufferIndex:       c?.index ?? null,
            },
            machineBufferState: {
                machineStatus:     m?.status ?? null,
                currentIndex:      c?.index ?? null,
                currentStatus:     c?.status ?? null,
                currentAudioStarted: c?.audioStarted ?? false,
                currentAudioEnded: c?.audioEnded ?? false,
                nextIndex:         n?.index ?? null,
                locked:            m?.buffer?.locked ?? false,
            },
            playerState: {
                activePlayer:        activePlayer.current,
                activePaused:        pAct?.paused ?? null,
                activeReadyState:    pAct?.readyState ?? null,
                activeCurrentTime:   pAct?.currentTime ?? null,
                activeDuration:      pAct?.duration ?? null,
                standbyReady:        standbyReadyRef.current,
            },
            lastAudioEventAt:       lastAudioEventAtRef.current,
            lastVisualAckAt:        lastVisualAckAtRef.current,
            lastChunkTransitionAt:  lastChunkTransitionAtRef.current,
            now:                    Date.now(),
        };
    };

    // F11: ¿el buffer está preparado para `index`? Read-only.
    // True si buffer.current.index coincide y el buffer no está locked.
    const isPreparedForIndex = (index: number): boolean => {
        const m = machineRef.current;
        const c = m?.buffer?.current;
        if (!c) return false;
        if (m!.buffer.locked) return false;
        return c.index === index;
    };

    // M-5.3 (rev M-5.3.3): ¿el buffer del index ya recibió ack visual? Read-only.
    //
    // Pregunta semántica: "¿este index ya fue confirmado visualmente?" — NO
    // "¿está habilitado para arrancar audio?". Para esa pregunta estricta usar
    // canStartAudio() (que sí exige status='visible').
    //
    // El flag visualHighlightConfirmed es MONOTÓNICO: confirmHighlight() lo
    // setea true y nunca vuelve a false; solo prepare() (que crea una sentence
    // nueva) resetea el flag al crear current desde cero. Por tanto chequear
    // SOLO el flag es la pregunta correcta. Antes pedíamos status='visible'
    // adicionalmente, pero el status legítimamente progresa a 'reading' apenas
    // arranca el audio (markAudioStarted) y luego a 'completed', causando
    // loop infinito de re-ack durante playback (síntoma M-5.3.2).
    // M-5.4.6 (DEMOLITION Phase 1.b.5) — isVisuallyAckedForIndex ELIMINADO.
    // Devuelve siempre true para mantener firma del export (Phase 2 lo removerá
    // del interface). El nuevo INV es "playback never waits for render".
    const isVisuallyAckedForIndex = (_index: number): boolean => true;

    // F11: bootstrap explícito de la frase activa. Idempotente: solo dispatcha
    // PREPARE_SENTENCE si NO está ya preparada (evita resetear flags
    // visualHighlightConfirmed/audioStarted/etc. de un buffer válido).
    const prepareSentence = useCallback((index: number, reason: string): void => {
        if (isPreparedForIndex(index)) return;
        dispatchMachine({
            type: MA.PREPARE_SENTENCE,
            index,
            displayText: ctx.sentencesRef.current[index] ?? '',
            spokenText:  ctx.audioSentencesRef.current[index] ?? '',
            userId:      ctx.userIdRef.current,
            now:         Date.now(),
        });
        // Log F11 explícito (la machine emite PB_SENTENCE_PREPARE genérico;
        // este complementa con el `reason` para diferenciar bootstraps).
        log('autoplay_blocked' as any, { event: 'PB_INITIAL_BOOTSTRAP_PREPARE', index, reason });
    }, []);

    // F16: diagnóstico universal de arranque. Snapshot plano del estado
    // runtime cuando playback no inicia. El visor lo loguea como
    // PB_START_DIAGNOSTIC tras 1500ms de un togglePlay sin AUDIO_STARTED.
    const getStartDiagnostic = (index: number): Record<string, any> => {
        const m = machineRef.current;
        const c = m?.buffer?.current;
        const pActive = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        return {
            contentId:               ctx.contentIdRef.current,
            sessionKey:              `${ctx.userIdRef.current}__${ctx.contentIdRef.current}`,
            userId:                  ctx.userIdRef.current,
            index,
            currentIndex:            currentIdxRef.current,
            sentencesLength:         ctx.sentencesRef.current.length,
            hasActiveSentence:       c !== null,
            activeSentenceIndex:     c?.index ?? null,
            activeSentenceStatus:    c?.status ?? null,
            // M-5.4.6 — visualConfirmed eliminado del diagnostic.
            audioStarted:            c?.audioStarted ?? false,
            audioEnded:              c?.audioEnded ?? false,
            progressEligible:        c?.progressEligible ?? false,
            audioFailed:             isAudioFailed(index),
            audioRetried:            audioRetriedKeysRef.current.has(toChunkKey(index)),
            hasAudioUrl:             audioCache.current.has(toChunkKey(index)),
            isPreparedForIndex:      isPreparedForIndex(index),
            machineStatus:           m?.status ?? null,
            committedIndex:          m?.committedIndex ?? null,
            visualIndex:             m?.visualIndex ?? null,
            audioIndex:              m?.audioIndex ?? null,
            progressIndex:           m?.progressIndex ?? null,
            pendingTransition:       m?.pendingTransition ?? null,
            playerStatus:            statusRef.current,
            currentSrc:              pActive?.src ?? null,
            currentPlayerReadyState: pActive?.readyState ?? null,
            currentPlayerDuration:   pActive?.duration ?? null,
            currentPlayerPaused:     pActive?.paused ?? null,
            loadToken:               loadToken.current,
            contentSession:          contentSessionRef.current,
            isPendingAdvance:        isPendingAdvance(),
            standbyReady:            standbyReadyRef.current,
        };
    };

    // F13: navegación local pura del usuario (botones anterior/siguiente).
    // No inicia audio, no guarda progreso, no dispara blockComplete, no usa
    // hardResync. Pausa audio + prepara buffer + setIdx — el visor releva
    // y emite ack en su useLayoutEffect normal. Status queda en 'paused'.
    // BLOCKER M-5.4.5 — Manual navigation determinista. El gesto del usuario
    // (next/prev/skip) DEBE:
    //   1. Bump navGenerationRef (Phase 1.b.C Task 2) — invalida callbacks
    //      pending de executors anteriores.
    //   2. Cancelar executor activo (chunked mode estaba dejándolo vivo →
    //      callbacks stale SYNC_SENTENCE_ACTIVATE sobre machine reseteada).
    //   3. Cancelar pending advances + invalidar loadToken.
    //   4. Pausar audios (el load posterior arranca limpio).
    //   5. Despachar SKIP a la machine (limpia buffer current + next).
    //   6. Delegar a load(clamped, wasPlaying) — load() actualiza audio src,
    //      hace su propia cancelSyncStrategy('load_new_audio') idempotente,
    //      y autoplay solo si el usuario estaba en 'playing'. Antes el jump
    //      dejaba el src stale → resume reproducía la frase ANTERIOR (bug TTS).
    //
    // Logs ordenados para auditoría:
    //   MANUAL_NAV_START → MANUAL_NAV_CANCEL_EXECUTOR → MANUAL_NAV_CLEAR_PENDING
    //   → MANUAL_NAV_LOAD_TARGET → MANUAL_NAV_READY → MANUAL_NAV_PLAY_IF_REQUESTED
    const manualSentenceJump = useCallback((targetIndex: number, reason: string): void => {
        const total  = ctx.sentencesRef.current.length;
        const clamped = Math.max(0, Math.min(total - 1, targetIndex));
        const fromIdx = currentIdxRef.current;
        const wasPlaying = statusRef.current === 'playing';

        // eslint-disable-next-line no-console
        console.log('[MANUAL_NAV_START]', {
            from: fromIdx, to: clamped, requestedTarget: targetIndex,
            reason, wasPlaying,
            audioMode:    ctx.audioModeRef?.current ?? null,
            statusBefore: statusRef.current,
            sessionId:    contentSessionRef.current,
        });

        if (clamped === fromIdx) {
            log('autoplay_blocked' as any, {
                event: 'PB_MANUAL_JUMP_BLOCKED',
                reason: 'same_index',
                from: fromIdx, to: clamped, requestedTarget: targetIndex, jumpReason: reason,
            });
            return;
        }

        // HF4A-R2 — navegar manualmente es re-engagement: la sesión deja de estar
        // "completada". Se hace ANTES de bifurcar same-chunk vs cross-chunk para
        // cubrir AMBOS paths (el same-chunk no llama load(), así que necesita su
        // propio reset). Cualquier load() pendiente de un índice anterior será
        // descartado por la triple coherencia (index_moved) tras setIdx(clamped).
        sessionCompletedRef.current = false;

        // ── M-5.4.10 / TASK 3 — MANUAL NAV STRICT MODE ──────────────────────
        // El target ya es estricto: el visor pasa currentIndex ± 1; el clamp
        // solo limita los bordes [0, total-1]. Sin heurísticas, sin
        // nearest-chunk-rewind, sin reset parcial, sin fallback a inicio de
        // chunk. delta SIEMPRE ∈ {-1, +1} para botones (salvo clamp en borde).
        const _navMode   = ctx.audioModeRef?.current ?? null;
        const _fromChunk = toChunkKey(fromIdx);
        const _toChunk   = toChunkKey(clamped);
        const _chunked   = _navMode === 'perChunkNoAnchors' || _navMode === 'perChunkWithAnchors';
        // eslint-disable-next-line no-console
        console.log('[MANUAL_NAV_TARGET_RESOLVED]', {
            from: fromIdx, to: clamped, requestedTarget: targetIndex,
            delta: clamped - fromIdx, reason,
            audioMode: _navMode, fromChunk: _fromChunk, toChunk: _toChunk,
            strict: true, sessionId: contentSessionRef.current,
        });
        // ── M-5.4.14 / TASK 1+3 — FINAL_NAV_TRACE + FINAL_NAV_ASSERTION ──────
        // Observabilidad pura (cero cambio de control-flow). La aserción NO
        // lanza: si para un gesto de botón el delta no es exactamente ±1 (o el
        // clamp de borde 0), marca violation:true para que el smoke la capture.
        const _isButtonNav = reason === 'button_previous' || reason === 'button_next';
        const _navDelta    = clamped - fromIdx;
        const _navOk       = !_isButtonNav
            || _navDelta === -1 || _navDelta === 1
            || (clamped === 0 && fromIdx > 0)                       // clamp en inicio
            || (clamped === total - 1 && fromIdx < total - 1);      // clamp en fin
        // eslint-disable-next-line no-console
        console.log('[FINAL_NAV_TRACE]', {
            from: fromIdx, to: clamped, delta: _navDelta, reason,
            isButtonNav: _isButtonNav, audioMode: _navMode,
            fromChunk: _fromChunk, toChunk: _toChunk,
            sessionId: contentSessionRef.current,
        });
        if (!_navOk) {
            // eslint-disable-next-line no-console
            console.error('[FINAL_NAV_ASSERTION]', {
                violation: true,
                rule: 'button_nav_delta_must_be_exactly_±1_or_edge_clamp',
                from: fromIdx, to: clamped, delta: _navDelta, reason,
                requestedTarget: targetIndex, total,
                sessionId: contentSessionRef.current,
            });
        } else if (_isButtonNav) {
            // eslint-disable-next-line no-console
            console.log('[FINAL_NAV_ASSERTION]', {
                violation: false, delta: _navDelta, reason,
            });
        }

        // Same-chunk en chunked → mover SOLO el visual. NO reload audio, NO
        // cancelar executor, NO pausar, NO restart de chunk. Esta es la causa
        // raíz del "previous salta excesivo": antes SIEMPRE se hacía teardown
        // + load() → el audio del chunk reiniciaba desde 0. Acá el audio y el
        // executor ÚNICO siguen intactos; solo se mueve currentIndex ±1.
        // (perSentence: toChunkKey(i)===i ⇒ i≠i±1 ⇒ jamás entra acá ⇒ cero
        //  regresión TTS — siempre toma el path cross-chunk de abajo.)
        if (_chunked && _fromChunk === _toChunk) {
            // eslint-disable-next-line no-console
            console.log('[MANUAL_NAV_SAME_CHUNK_REUSE]', {
                from: fromIdx, to: clamped, chunkKey: _fromChunk,
                reason, audioMode: _navMode,
                bypass: 'visual_only_no_audio_reload_no_executor_cancel',
                sessionId: contentSessionRef.current,
            });
            log('autoplay_blocked' as any, {
                event: 'PB_MANUAL_SENTENCE_JUMP',
                from: fromIdx, to: clamped, requestedTarget: targetIndex,
                jumpReason: reason, sameChunkReuse: true,
            });
            // Visual-commit directo (mismo patrón que advanceWithinChunk pero
            // SIN sus guards de rechazo de callback-de-executor, que son para
            // callbacks stale del executor, NO para navegación del usuario —
            // rechazarían el `previous` por ir hacia atrás del spawnFromIndex).
            // NO cancelamos el executor: single executor, audio sigue. Si el
            // lector está reproduciendo, el executor re-sincroniza el realce
            // hacia adelante con el audio (fuente de verdad). Si está pausado,
            // el visual queda en el target. NUNCA reinicia el audio del chunk.
            dispatchMachine({ type: MA.SENTENCE_COMPLETED, index: fromIdx });
            dispatchMachine({
                type: MA.PREPARE_SENTENCE,
                index:       clamped,
                displayText: ctx.sentencesRef.current[clamped] ?? '',
                spokenText:  ctx.audioSentencesRef.current[clamped] ?? '',
                userId:      ctx.userIdRef.current,
                now:         Date.now(),
            });
            setIdx(clamped);
            log('autoplay_blocked' as any, {
                event: 'PB_MANUAL_JUMP_NO_PROGRESS_SAVE',
                index: clamped,
            });
            return;
        }

        // Cross-chunk (o perSentence) → reload limpio del chunk correcto.
        // eslint-disable-next-line no-console
        console.log('[MANUAL_NAV_CROSS_CHUNK_RELOAD]', {
            from: fromIdx, to: clamped, fromChunk: _fromChunk, toChunk: _toChunk,
            reason, audioMode: _navMode,
            sessionId: contentSessionRef.current,
        });

        // M-5.4.6 (Phase 1.b.C Task 2) — Bump nav generation ANTES de cualquier
        // cancel/dispatch. Esto invalida inmediatamente todos los callbacks
        // pending de executors anteriores: cualquiera que llegue ahora verá
        // que su _spawnNavGeneration ya no coincide con navGenerationRef.current
        // y será rechazado con [STALE_NAV_CALLBACK_REJECTED].
        const _fromGeneration = navGenerationRef.current;
        navGenerationRef.current = _fromGeneration + 1;
        // eslint-disable-next-line no-console
        console.log('[MANUAL_NAV_GENERATION_BUMP]', {
            fromGeneration: _fromGeneration,
            toGeneration:   navGenerationRef.current,
            reason,
            targetIndex:    clamped,
        });

        log('autoplay_blocked' as any, {
            event: 'PB_MANUAL_SENTENCE_JUMP',
            from: fromIdx, to: clamped, requestedTarget: targetIndex, jumpReason: reason,
        });

        // 1. Cancelar executor (chunked mode). Sin esto, post-jump el executor
        //    sigue activando frases del chunk anterior → cascada de callbacks
        //    stale contra una machine recién dispatcheada con SKIP.
        cancelSyncStrategy('manual_nav');
        // eslint-disable-next-line no-console
        console.log('[MANUAL_NAV_CANCEL_EXECUTOR]', {
            from: fromIdx, to: clamped, reason,
            sessionId: contentSessionRef.current,
        });

        // 2. Cancelar pending advances + invalidar loadToken.
        cancelPendingAdvance('skip_or_load');
        loadToken.current++;
        // eslint-disable-next-line no-console
        console.log('[MANUAL_NAV_CLEAR_PENDING]', {
            from: fromIdx, to: clamped,
            loadTokenAfter: loadToken.current,
        });

        // 3. Pausar audios. load() los va a poner src nuevo y autoplay si
        //    aplica; este pause cubre el gap.
        audioRefA.current?.pause();
        audioRefB.current?.pause();

        // M-5.4.6 — Reset de refs intra-chunk eliminado (Phase 1.a).

        // 5. Despachar SKIP a la machine (cancela buffer.current y .next).
        dispatchMachine({ type: MA.SKIP, targetIndex: clamped });

        // 6. Notificar status + engines. load() levantará a 'playing' si
        //    wasPlaying=true, o se quedará en 'paused' si el user no estaba
        //    reproduciendo.
        setStatus(wasPlaying ? 'loading' : 'paused');
        ctx.onPlayChange.current(false);

        // eslint-disable-next-line no-console
        console.log('[MANUAL_NAV_LOAD_TARGET]', {
            from: fromIdx, to: clamped, wasPlaying,
            audioMode: ctx.audioModeRef?.current ?? null,
        });

        // 7. Delegar a load() que actualiza audio src + prepara buffer +
        //    autoplay condicional. Async pero el visor no espera la promesa
        //    (la UI ya muestra status='loading' o 'paused' y el index nuevo
        //    se setea dentro de load).
        load(clamped, wasPlaying).then(() => {
            // eslint-disable-next-line no-console
            console.log('[MANUAL_NAV_READY]', {
                from: fromIdx, to: clamped, wasPlaying,
                statusAfter: statusRef.current,
            });
            if (wasPlaying) {
                // eslint-disable-next-line no-console
                console.log('[MANUAL_NAV_PLAY_IF_REQUESTED]', {
                    index: clamped,
                    statusAfter: statusRef.current,
                });
            }
        }).catch((e: Error) => {
            // eslint-disable-next-line no-console
            console.error('[MANUAL_NAV_LOAD_FAILED]', {
                from: fromIdx, to: clamped, error: e?.message,
            });
        });

        log('autoplay_blocked' as any, {
            event: 'PB_MANUAL_JUMP_NO_PROGRESS_SAVE',
            index: clamped,
        });
    }, [load]);

    // F12: ¿el audio para `index` está marcado como fallido? Read-only.
    // Un index queda marcado tras:
    //   - tts_fail en getAudioUrl (sin URL recuperable)
    //   - NotSupportedError tras retry agotado
    const isAudioFailed = (index: number): boolean => {
        return audioFailedKeysRef.current.has(toChunkKey(index));
    };

    // F12: chequeo previo de audio readiness antes de play().
    // Emite logs PB_AUDIO_READY_CHECK + PB_AUDIO_READY / PB_AUDIO_READY_FAILED.
    // NO ejecuta retries — devuelve estado actual. El caller decide qué hacer.
    const ensurePlayableAudio = useCallback(async (index: number): Promise<{ ok: boolean; reason?: string; source?: 'cache' | 'tts' }> => {
        log('autoplay_blocked' as any, { event: 'PB_AUDIO_READY_CHECK', index });
        if (isAudioFailed(index)) {
            // HF4A — sólo bloqueamos de entrada si el fallo previo es
            // PERSISTENTE (decode/NotSupportedError): tener una URL no cura un
            // blob corrupto. Si el fallo era RECUPERABLE (no_url/timeout),
            // NO cortamos acá — intentamos re-obtener la URL abajo; si llega
            // válida, clear-on-valid-url limpia la marca y reportamos ok.
            const failKey  = toChunkKey(index);
            const failReason = audioFailureReasonsRef.current.get(failKey) ?? 'no_url';
            if (classifyAudioFailure(failReason) === 'persistent') {
                log('autoplay_blocked' as any, { event: 'PB_AUDIO_READY_FAILED', index, reason: 'audio_failed_marked' });
                return { ok: false, reason: 'audio_failed_marked' };
            }
        }
        const wasCached = audioCache.current.has(toChunkKey(index));
        // ── [AUDIO_TRACE] TEMPORAL — M-2.6/2.7. REMOVE AFTER FIX ────────────
        // eslint-disable-next-line no-console
        console.log('[AUDIO_TRACE] request', {
            contentId:     ctx.contentIdRef.current,
            sentenceIndex: index,
            sessionId:     contentSessionRef.current,
            via:           'ensurePlayableAudio',
            wasCached,
        });
        const url = await getAudioUrl(index);
        if (!url) {
            // getAudioUrl ya logueó tts_fail/manifest_fail. Marcar (recuperable)
            // y reportar. El motivo 'no_url' permite que un intento posterior
            // con URL válida limpie la marca vía clear-on-valid-url.
            markAudioFailed(index, 'no_url');
            log('autoplay_blocked' as any, { event: 'PB_AUDIO_READY_FAILED', index, reason: 'no_url' });
            return { ok: false, reason: 'no_url' };
        }
        // HF4A — URL válida: limpiar cualquier marca de fallo recuperable
        // previa de este índice antes de reportar ready.
        // HF4A-R2 — pero SOLO si seguimos en la frase visual vigente y la sesión
        // no se completó durante el await. Si el visual cambió (el usuario navegó
        // mientras getAudioUrl estaba pendiente), NO mutamos estado de una frase
        // abandonada: la query sigue reportando ok (el audio existe) sin limpiar.
        if (index === currentIdxRef.current && !sessionCompletedRef.current) {
            clearRecoverableFailure(index, 'valid_url');
        } else {
            log('autoplay_blocked' as any, {
                event:            'PB_AUDIO_STALE_RESULT_DROPPED',
                index,
                currentIndex:     currentIdxRef.current,
                sessionCompleted: sessionCompletedRef.current,
                reason:           index !== currentIdxRef.current ? 'index_moved' : 'session_completed',
                where:            'ensurePlayableAudio_clear',
            });
        }
        log('autoplay_blocked' as any, { event: 'PB_AUDIO_READY', index, source: wasCached ? 'cache' : 'tts' });
        return { ok: true, source: wasCached ? 'cache' : 'tts' };
    }, [getAudioUrl]);

    // ── HF4A — reintento manual controlado ───────────────────────────────────
    // Ruta de recuperación explícita del usuario para la frase ACTUAL. NO borra
    // estados globales: limpia sólo el fallo RECUPERABLE del índice actual y
    // vuelve a invocar load() con autoPlay. Si el fallo era persistente
    // (NotSupportedError agotado) NO lo limpia — load() volverá a bloquear y la
    // frase sigue honestamente en 'error' (no se oculta el fallo real). No hay
    // auto-retry: este método sólo corre por gesto del usuario, sin loop.
    const retryAudio = useCallback((): void => {
        const index = currentIdxRef.current;
        // ── HF4A-R2 — GUARD ESTRICTO DE CONTEXTO ─────────────────────────────
        // El botón "Reintentar" sólo puede actuar sobre la frase visual vigente
        // y en un estado recuperable. NO reintentar si:
        //   - status no es 'error' (manual nav lo deja en 'paused'/'loading', y
        //     un drop stale nunca lo deja en 'error' para un índice movido →
        //     status==='error' garantiza que el error pertenece a `index`);
        //   - la sesión está completada (overlay "Lectura Completada" activo).
        // Como `index` se lee de currentIdxRef.current, idx===current es trivial;
        // el chequeo real es status + completion. Esto evita spawnear audio de un
        // índice obsoleto y que el retry reactive una sesión ya terminada.
        if (statusRef.current !== 'error' || sessionCompletedRef.current) {
            log('autoplay_blocked' as any, {
                event:            'PB_AUDIO_RETRY_SKIPPED_STALE_CONTEXT',
                index,
                currentIndex:     currentIdxRef.current,
                status:           statusRef.current,
                sessionCompleted: sessionCompletedRef.current,
            });
            return;
        }
        const key   = toChunkKey(index);
        const reason = audioFailureReasonsRef.current.get(key) ?? 'no_url';
        // Limpia el fallo recuperable del índice actual (no global).
        if (classifyAudioFailure(reason) === 'recoverable') {
            audioFailedKeysRef.current.delete(key);
            audioFailureReasonsRef.current.delete(key);
        }
        log('autoplay_blocked' as any, { event: 'PB_AUDIO_RETRY_MANUAL', index, reason });
        // Vuelve al flujo normal de carga con reproducción. load() revalida la
        // triple coherencia tras getAudioUrl y antes del spawn, así que aunque el
        // contexto cambie durante su await, no reproducirá un índice obsoleto.
        void load(index, true, { reason: 'manual_retry' });
    }, [load]);

    // F5: helper read-only. Idéntica lógica a assertCanSaveProgress(buffer, index)
    // pero inline para no importar el módulo (la machine ya lo importó). Suma
    // el guard de pendingAdvance del hook (timers pendientes, no buffer).
    const canSaveProgress = (index: number): { ok: boolean; reason?: string } => {
        if (isPendingAdvance()) {
            return { ok: false, reason: 'pending_advance' };
        }
        const m = machineRef.current;
        const c = m?.buffer?.current;
        if (!c)                                return { ok: false, reason: 'no_active_sentence' };
        if (c.index !== index)                 return { ok: false, reason: 'index_mismatch' };
        if (m!.buffer.locked)                  return { ok: false, reason: 'buffer_locked' };
        if (c.status !== 'completed')          return { ok: false, reason: `status_${c.status}` };
        // M-5.4.6 — visualHighlightConfirmed eliminado del gate de progreso.
        if (!c.audioStarted)                   return { ok: false, reason: 'audio_not_started' };
        if (!c.audioEnded)                     return { ok: false, reason: 'audio_not_ended' };
        if (!c.progressEligible)               return { ok: false, reason: 'progress_not_eligible' };
        if (m!.buffer.next !== null)           return { ok: false, reason: 'pending_next' };
        return { ok: true };
    };

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
        isPendingAdvance,
        acknowledgeVisualHighlight,
        notifyBlockComplete,
        canSaveProgress,
        hardResync,
        getMachineSnapshot,
        prepareSentence,
        isPreparedForIndex,
        isVisuallyAckedForIndex,
        advanceWithinChunk,
        getRuntimeDiagnostics,
        isAudioFailed,
        ensurePlayableAudio,
        retryAudio,
        manualSentenceJump,
        getStartDiagnostic,
    };
}
