/**
 * immersiveRuntimeTypes.d.ts — Sprint Inmersivo V2 / Fase M-1.
 *
 * Tipos compartidos del runtime V2. Vive como .d.ts puro para que los .mjs
 * sean ejecutables por node directo (sin compilation step) mientras el
 * frontend TypeScript siga obteniendo tipos exhaustivos.
 *
 * Patrón idéntico a `utils/groupMembership.mjs` + `utils/groupMembership.d.ts`,
 * la única manera honesta de tener "tests reales con código TypeScript-tipado"
 * en este repo (no hay vitest, tsx, ni ts-node instalados).
 *
 * NO incluye runtime — solo tipos. Si necesitas helpers en runtime, viven
 * en sus archivos .mjs respectivos.
 */

// ────────────────────────────────────────────────────────────────────────────
// IDs primitivos
// ────────────────────────────────────────────────────────────────────────────

export type SessionId      = string;
export type ContentId      = string;
export type UserId         = string;
export type SessionIndex   = number;

/**
 * Monotonic counter usado para invalidar callbacks async asociados a una
 * sesión que ya cerró. Cada nueva sesión recibe un token mayor al anterior.
 * Cualquier callback que capture un token y luego no coincida con el actual
 * debe abortar (assertLive lanza stale_session_callback).
 */
export type LifecycleToken = number;

// ────────────────────────────────────────────────────────────────────────────
// Estado y transiciones
// ────────────────────────────────────────────────────────────────────────────

/**
 * Los 8 estados legales del runtime V2. Cualquier valor fuera de esta unión
 * es invariant_violated.
 */
export type SessionStatus =
  | 'idle'
  | 'opening'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'closing'
  | 'closed'
  | 'error';

/** Origen semántico de un goTo. Driver de telemetría y políticas downstream. */
export type GoToSource = 'manual' | 'auto' | 'recovery';

/** Acciones públicas del runtime — única superficie de mutación intencional. */
export type RuntimeAction =
  | { kind: 'play'   }
  | { kind: 'pause'  }
  | { kind: 'resume' }
  | { kind: 'goTo'; index: SessionIndex; source: GoToSource }
  // Sprint M-3.2 — eventos productivos del audio. El audio NO muta estado
  // directamente; reporta eventos via dispatch, y el runtime decide qué
  // hacer (autoavance, transición a error, etc.) dentro del state machine.
  | { kind: 'audioEnded';  index: SessionIndex }
  | { kind: 'audioFailed'; index: SessionIndex; reason: string };

// ────────────────────────────────────────────────────────────────────────────
// Errores formales — taxonomy explícita, prohibidos los strings sueltos
// ────────────────────────────────────────────────────────────────────────────

export type SessionErrorKind =
  | 'aborted'
  | 'content_not_found'
  | 'content_invalid'
  | 'hydration_timeout'
  | 'audio_unavailable'
  | 'audio_contract_failed'
  | 'visibility_contract_failed'
  | 'visibility_timeout'
  | 'stale_session_callback'
  | 'invalid_transition'
  | 'invariant_violated'
  | 'destroyed_session_mutation'
  // Sprint M-3.2 — granularidad para audio productivo:
  | 'audio_autoplay_blocked'   // browser bloqueó play() por policy (NotAllowedError)
  | 'audio_failed'             // evento 'error' del HTMLMediaElement post-load
  | 'audio_decode_failed';     // src cargado pero no decodificable

export interface SessionError {
  kind:        SessionErrorKind;
  message?:    string;
  sessionId?:  SessionId;
  contentId?:  ContentId;
  index?:      SessionIndex;
  /** Operación contextual (ej: 'play', 'goTo', 'startPlayback'). */
  op?:         string;
  /** Token capturado al momento de la violación, si aplica. */
  capturedToken?: LifecycleToken;
  /** Token actualmente vigente, si aplica. */
  currentToken?:  LifecycleToken;
  /** Metadata extra arbitraria — no garantizada cross-version. */
  meta?:       Readonly<Record<string, unknown>>;
}

// ────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ────────────────────────────────────────────────────────────────────────────

/**
 * Familia de eventos emitidos por el runtime. Mantener acotada — cada nueva
 * familia debe tener semántica clara y estable cross-version.
 */
export type DiagnosticEventKind =
  | 'session.opened'
  | 'session.ready'
  | 'session.error'
  | 'session.closed'
  | 'state.transition'
  | 'audio.preflight.ok'
  | 'audio.preflight.fail'
  | 'audio.start'
  | 'audio.pause'
  | 'audio.released'
  // ── Sprint M-4.3 — audio.acquire.* diagnostic family ──────────────────────
  // Granularidad operacional del pipeline acquire (preflight → factory →
  // setSrc → load → canplay → play). Cada paso emite un evento dedicado.
  // Permite identificar el ROOT CAUSE exacto cuando 'audio_contract_failed'
  // ocurre — sin esto el reason ('play_rejected', 'factory_throw',
  // 'factory_invalid') queda enterrado en errorMeta.
  | 'audio.acquire.request'        // preflight invocado para (session, index)
  | 'audio.acquire.provider'       // resolveSrc invocado
  | 'audio.acquire.url'            // resolveSrc devolvió URL válida
  | 'audio.acquire.null_url'       // resolveSrc devolvió null/undefined
  | 'audio.acquire.invalid_url'    // resolveSrc devolvió string no usable (vacío, non-string)
  | 'audio.acquire.load_start'     // audio element creado, src asignado, antes de play()
  | 'audio.acquire.canplay'        // event 'canplay' del HTMLAudioElement (readyState >= 3)
  | 'audio.acquire.play_resolved'  // audio.play() Promise resolved
  | 'audio.acquire.play_rejected'  // audio.play() Promise rejected (con classification)
  | 'audio.acquire.exception'      // throw inesperado en cualquier fase
  | 'audio.acquire.cancelled'      // closeSession durante acquire — cancelado limpio
  // M-4.3.2 — eventos best-effort del HTMLAudioElement (NO bloquean gating):
  | 'audio.acquire.loadedmetadata' // event 'loadedmetadata' — duration/bitrate disponible
  | 'audio.acquire.decode_ready'   // event 'canplaythrough' o readyState >= 4 (HAVE_ENOUGH_DATA)
  | 'audio.acquire.decode_failed'  // event 'error' del media element post-load (decode fail)
  // M-4.3.3 — frontend trust-the-bytes fix:
  | 'audio.acquire.mime_rewrapped' // blob.type ignorado, re-wrap con mime derivado de magic bytes
  // M-4.3.4 — premature-play race fix (canplay gating local):
  | 'audio.acquire.wait_ready_start'    // wait for canplay starts (readyState < 2)
  | 'audio.acquire.wait_ready_resolved' // canplay fired (or readyState reached 2+)
  | 'audio.acquire.wait_ready_timeout'  // timeout antes de canplay — proceed defensive
  | 'visibility.await'
  | 'visibility.report'
  | 'visibility.timeout'
  | 'visibility.cancelled'
  | 'progress.scheduled'
  | 'progress.skipped'
  | 'progress.flushed'
  | 'queue.enqueue'
  | 'queue.start'
  | 'queue.done'
  | 'callback.stale'
  // Sprint M-3.3 — preload + autoplay + decode events.
  | 'preload.start'
  | 'preload.hit'
  | 'preload.abort'
  | 'preload.release'
  | 'autoplay.next'
  | 'autoplay.abort'
  | 'decode.fail'
  // Sprint M-3.4 — binder + recovery events.
  | 'binder.attach'
  | 'binder.dispose'
  | 'binder.preload.request'
  | 'binder.preload.skip'
  | 'binder.release.session'
  | 'recover.start'
  | 'recover.done'
  | 'recover.skip'
  | 'recover.fail'
  // Sprint M-4 — viewer-emitted events para diagnosticar hangs en hydrate/open.
  | 'viewer.stack.created'
  | 'viewer.hydrate.start'
  | 'viewer.hydrate.done'
  | 'viewer.hydrate.fail'
  | 'viewer.openSession.start'
  | 'viewer.openSession.done'
  | 'viewer.openSession.fail'
  // Sprint M-4 fix #3 — snapshot tracer para correlacionar logs externos
  // con los cambios de estado del runtime V2.
  | 'viewer.runtime.snapshot';

export interface DiagnosticEvent {
  /** Wall-clock ms (Date.now). */
  ts:         number;
  sessionId:  SessionId | null;
  contentId:  ContentId | null;
  kind:       DiagnosticEventKind;
  data?:      Readonly<Record<string, unknown>>;
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot público — inmutable, expuesto a viewers
// ────────────────────────────────────────────────────────────────────────────

export interface RuntimeSnapshot {
  readonly sessionId:       SessionId | null;
  readonly contentId:       ContentId | null;
  readonly userId:          UserId | null;
  readonly status:          SessionStatus;
  readonly currentIndex:    SessionIndex;
  readonly totalIndices:    SessionIndex;
  readonly lifecycleToken:  LifecycleToken | null;
  readonly lastError:       SessionError | null;
  /** True cuando el viewer confirmó visibilidad del currentIndex. */
  readonly visualReady:     boolean;

  // ──────────────────────────────────────────────────────────────────────────
  // Sprint M-4.2 — diagnostic enrichments
  //
  // Read-only. Derivados puros del estado interno. Pensados para observability
  // (smoke local, dev tools, debug dashboards). NO usar para lógica crítica:
  // los campos canonicos siguen siendo status/currentIndex/totalIndices.
  // ──────────────────────────────────────────────────────────────────────────

  /** Shorthand booleano para `status === 'playing'`. */
  readonly isPlaying:          boolean;
  /** Estado del AudioRuntime: 'idle' (sin audio activo) | 'playing'. */
  readonly audioState:         'idle' | 'playing';
  /** True si el audio activo tiene un src cargado (URL set). */
  readonly audioUrlLoaded:     boolean;
  /** Alias semántico de `currentIndex` para callers que piensan en frases. */
  readonly activeSentenceId:   SessionIndex;
  /** True si hay ops encoladas o procesándose en la sesión. */
  readonly pendingTransition:  boolean;
  /** Alias semántico de `lifecycleToken` para monitoring de cambios de sesión. */
  readonly playbackGeneration: LifecycleToken | null;
}

export type Listener = (snapshot: RuntimeSnapshot) => void;
export type Unsubscribe = () => void;

// ────────────────────────────────────────────────────────────────────────────
// Reportes externos
// ────────────────────────────────────────────────────────────────────────────

export interface VisibilityReport {
  /** True si el viewer renderizó el índice y está visible al usuario. */
  visible:    boolean;
  /** Razón opcional cuando visible=false (timeouts, hidden, ...) */
  reason?:    string;
}

// ────────────────────────────────────────────────────────────────────────────
// Args de open
// ────────────────────────────────────────────────────────────────────────────

export interface OpenSessionArgs {
  contentId:    ContentId;
  userId:       UserId;
  startIndex?:  SessionIndex;
  /** Provee el total si lo conoce el caller; si no, lo determina la hidratación. */
  totalIndices?: SessionIndex;
}
