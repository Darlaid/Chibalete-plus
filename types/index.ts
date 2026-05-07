
export interface User {
  id: string;
  nombre_usuario: string; // Acts as display name or fallback
  nombre_completo: string;
  email: string;
  password?: string; // Added for authentication simulation
  fecha_nacimiento?: string; // Added for age validation (ISO 8601 format YYYY-MM-DD)
  colegio?: string;  // Added for bulk upload
  curso?: string;    // Added for bulk upload
  avatar_url: string;
  bio_corta: string;
  libros_leidos: number;
  seguidores: number;
  seguidos: number;
  nivel_lectura: "Novato" | "Intermedio" | "Feroz";
  roles: ('lector' | 'mediador' | 'administrador')[]; // DT-05: 'profesor' eliminado del modelo
  mediatorKind?: 'teacher' | 'librarian' | 'coordinator' | 'parent'; // NUEVO: Especialización
  // --- Auth Pro ---
  accountStatus?: 'active' | 'invited' | 'disabled'; // Ausente = 'active' (legacy)
  inviteToken?: string;      // Solo servidor. Stripped en sanitizeUserForClient.
  inviteExpiresAt?: number;  // Unix timestamp. Eliminado tras activación.
  resetToken?: string;       // Solo servidor. Stripped en sanitizeUserForClient.
  resetExpiresAt?: number;   // Unix timestamp (+1h). Eliminado tras reset exitoso.
  // --- Extensión modelo (compatible con legacy) ---
  capabilities?: string[];     // Permisos granulares opcionales por usuario
  organizationId?: string;     // Referencia directa a organización (complementa 'colegio')
  groupIds?: string[];         // IDs de grupos a los que pertenece el usuario
  // --- Campos existentes ---
  libros_terminados?: string[];
  unlocked_bookmarks?: string[];
  saved_posts?: string[]; // IDs of community posts favorited by the user
  social_connections?: {
    facebook: boolean;
    instagram: boolean;
    linkedin: boolean;
  };
  puntos?: number; // Gamification points for Trivia
  immersive_level?: 1 | 2 | 3 | 4 | 5; // Level for Immersive Reading
  recent_history?: string[]; // IDs of content recently visited
  diagnostico_completado?: boolean; // If user has taken the initial level test
  ultimo_libro_abierto_id?: string; // For "Because you read..." recommendations
  racha_dias?: number;
  daily_shared_words?: number; // Track daily quota for quote sharing
  last_share_date?: string; // ISO Date to reset quota
  rewardsHistory?: {
    id: string;
    date: string;
    code: string;
    productName: string;
    cost: number;
  }[];
}

// ── Album Book Structures ─────────────────────────────────────────────────────
//
// All 2.0-A fields are optional so existing album_data persisted before the
// extension continues to deserialize without any migration.

// ── 2.0-C: Unified Action Model ─────────────────────────────────────────────
//
// RegionAction separates WHAT HAPPENS (action) from HOW IT LOOKS (type/mode).
// This replaces the overloaded type='audio' and type='nav' shortcuts — those
// were encoding action semantics inside an experience-mode field.
//
// Canonical form (new content, 2.0-C+):
//   region.type   = experience mode: 'focus' | 'contemplative' | 'challenge'
//   region.action = action payload
//
// Legacy forms (still supported via normalizeAlbumData):
//   type='audio' → synthesized as type='focus', action={type:'audio', audioUrl}
//   type='nav'   → synthesized as type='focus', action={type:'jump', targetPageId}
//
// Consumers (viewer, editor) MUST read region.action (or resolveRegionAction())
// for action dispatch. Do NOT add new behaviors to type='audio' / type='nav'.

export type RegionActionType = 'none' | 'read' | 'audio' | 'jump' | 'return' | 'text' | 'leo';

/**
 * Action executed when the reader taps/activates a region.
 *
 * Semantics:
 *   'none'   — camera zooms; reader pauses. No TTS, no navigation, no chat.
 *   'read'   — camera zooms, TTS reads region.text. Default for 'focus' mode.
 *   'audio'  — camera zooms, plays action.audioUrl instead of TTS.
 *   'jump'   — camera zooms briefly, then jumps to action.targetPageId (non-linear).
 *              Pushes current page to navStack for 'return' to work.
 *   'return' — pops navStack — navigates back to page before the last jump.
 *   'text'   — camera zooms, shows action.text as a secondary overlay panel.
 *   'leo'    — camera zooms, then opens Leo chat. action.leoPrompt seeds the chat.
 *
 * Note: for 'challenge' mode regions, the challenge game IS the interaction.
 * action is implicitly 'none' and is not consulted by the viewer.
 */
export interface RegionAction {
  type: RegionActionType;
  /** 'jump' — page ID to navigate to. Required when type='jump'. */
  targetPageId?: string;
  /**
   * 'audio' — pre-recorded audio URL used by the playback engine.
   * Always present when type='audio'. Written by editor on every save (whether the
   * source was an upload, a picked asset, or an external URL). Engine reads this directly.
   */
  audioUrl?: string;
  /**
   * 'audio' — reference to an AlbumMediaAsset in content.mediaAssets.
   * Present when the audio came from the media library (upload or pick).
   * Always accompanied by audioUrl — no runtime resolution needed.
   * Absent for external URLs pasted directly.
   */
  mediaAssetId?: string;
  /** 'text' — overlay text shown as a secondary panel (distinct from region.text). Required when type='text'. */
  text?: string;
  /** 'leo' — optional seed prompt injected into Leo chat when action fires. */
  leoPrompt?: string;
}

/**
 * A media asset associated with an album book.
 * Lives in content.mediaAssets[] — scoped to one content item.
 *
 * Allows multiple regions to reference the same audio without re-uploading.
 * Only 'audio' type is currently supported; 'video'/'image' reserved for future.
 *
 * ── Resolution contract ──────────────────────────────────────────────────
 * When a region's action.mediaAssetId is set, its action.audioUrl is ALWAYS
 * also set (written by the editor at save time). The runtime never needs to
 * look up assets — it reads audioUrl directly from the action.
 * mediaAssetId is only used by the editor (picker, display, replace/remove).
 */
export interface AlbumMediaAsset {
  id: string;
  type: 'audio';   // 'video' | 'image' reserved for future phases
  /** Display name shown in editor. Defaults to originalFileName if absent. */
  title?: string;
  /** Resolved URL served by the backend. The runtime reads this directly. */
  url: string;
  /** 'upload' = stored on our server; 'external' = third-party URL pasted by editor. */
  source: 'upload' | 'external';
  mimeType?: string;
  originalFileName?: string;
}

export interface AlbumRegion {
  id: string;
  text: string;    // Narrative text shown in 'focus' state; read by TTS for action='read'
  x: number;       // Left edge   — percentage of image width  (0–100)
  y: number;       // Top edge    — percentage of image height (0–100)
  width: number;   // Region width  — percentage of image width  (0–100)
  height: number;  // Region height — percentage of image height (0–100)

  // ── 2.0-C: Experience mode ────────────────────────────────────────
  // Controls the viewer's STATE MACHINE (zoom level, UI affordances).
  // 'audio' and 'nav' are @deprecated as of 2.0-C — use 'focus' + action instead.
  // normalizeAlbumData() synthesizes region.action from legacy types on load.
  //
  //   'focus'         — camera zooms to region. Default state.
  //   'challenge'     — camera zooms + interactive tap-to-find game.
  //   'contemplative' — camera zooms silently. No text, no audio by default.
  //   'audio'         — @deprecated. Normalizer migrates to focus+action.audio.
  //   'nav'           — @deprecated. Normalizer migrates to focus+action.jump.
  type?: 'focus' | 'challenge' | 'audio' | 'nav' | 'contemplative';

  // ── 2.0-C: Unified action — CANONICAL ACTION FIELD (new content) ──
  // What happens when the reader activates this region.
  // normalizeAlbumData synthesizes this from legacy type/audioUrl/navTargetPageId.
  // New editor writes this field. Old code that only wrote type/audioUrl/navTargetPageId
  // remains readable via normalizer; see COMPATIBILITY LEGACY section in analyticsSeam.ts.
  action?: RegionAction;

  // ── Legacy interactive challenge fields ──────────────────────────
  // @deprecated Use type='challenge' instead. Kept for backward compat with
  // content saved before 2.0-A. normalizeAlbumData() synthesizes type from
  // isInteractive on load; new code must not write isInteractive directly.
  isInteractive?: boolean;
  interactiveHint?: string;

  // ── Legacy audio / nav fields — @deprecated as of 2.0-C ─────────
  // Still read by normalizer to synthesize action. Do NOT write in new content.
  // Use region.action.audioUrl and region.action.targetPageId instead.
  audioUrl?: string;
  navTargetPageId?: string;
  returnTargetPageId?: string;

  // ── 2.0-A: Pedagogical integration ───────────────────────────────
  leoHint?: string;
  pedagogicalObjective?: 'literal' | 'inferential' | 'reflective' | 'writing';

  // ── 2.0-B: Narrative routes ───────────────────────────────────────
  routeIds?: string[];
}

/**
 * A narrative reading path through a page's regions.
 *
 * Routes define an ordered sequence of regions to visit — an editorial choice
 * about how to guide the reader's attention through an illustration.
 *
 * Multiple routes allow the same page to be read differently on each visit:
 *   "Ruta del personaje" → follows faces and figures
 *   "Ruta del paisaje"   → follows environment and background details
 *   "Ruta emocional"     → follows expressions and body language
 *
 * When a page has no narrativeRoutes (or an empty array), the viewer behaves
 * exactly as before — linear march through regions in array order.
 * Full backward compatibility: existing albums need no changes.
 */
export interface NarrativeRoute {
  id: string;
  /** Short label shown in the route selector. Example: "Ruta del personaje". */
  label: string;
  /** Ordered list of region IDs to visit in sequence for this route. */
  regionIds: string[];
  /** Optional emoji or short symbol shown next to the label in the selector UI. */
  icon?: string;
  /**
   * Leo intervention type bias for this route.
   * When set, overrides the region's pedagogicalObjective in type selection.
   *   'observe' → detail-focused path (visual details, background elements)
   *   'wonder'  → narrative/inference path (what's happening, what might happen)
   *   'connect' → personal connection path (emotions, familiar situations)
   *   'reflect' → perspective path (choices, values, reactions)
   * Absent → Leo uses region's pedagogicalObjective as usual.
   */
  leoMode?: 'observe' | 'wonder' | 'connect' | 'reflect';

  // ── Future: per-route audio differentiation ─────────────────────────────
  // NOT ACTIVE — reserved for future route-specific atmosphere.
  // See NarrativeAudioEngine "Future: per-route ambient differentiation" for
  // full implementation spec and calibration notes.
  //
  // ambientOverride: route-specific ambient loop URL. On route entry:
  //   audio.playAmbient(route.ambientOverride ?? currentPage.ambientAudioUrl)
  //   Hook point: route-entry interaction.trigger callback in VisorAlbum.
  //
  // audioMode: abstract ambient shaping hint ('calm' / 'tense' / 'wonder' / 'sparse').
  //   Drives per-route gain adjustments for the duration of the route.
  //   Do NOT implement without calibrated listening tests on actual album audio.
  ambientOverride?: string;
  audioMode?: 'calm' | 'tense' | 'wonder' | 'sparse';
}

/**
 * Album-level reading route — an editorial sequence of pages that guides the
 * reader through a curated path within the album.
 *
 * When readingRoutes is present and non-empty, the viewer shows a full-screen
 * route selector before the first page. Absent or empty → linear navigation
 * (existing behavior, fully backward-compatible).
 */
export interface AlbumReadingRoute {
  id: string;
  /** Short editorial name shown in the route selector. Example: "Ruta del protagonista". */
  name: string;
  description?: string;
  /** Ordered list of AlbumPage.id values defining the reading sequence for this route. */
  sequence: string[];
  /** Optional emoji or short symbol shown next to the name in the selector UI. */
  icon?: string;
}

/**
 * Rereading context for a single (userId, contentId) pair.
 *
 * Persisted in localStorage via utils/rereadStorage.ts.
 * Used to vary Leo's intervention type bias and to mark visited routes
 * in the route selector across multiple reads of the same album.
 *
 * ── Current fields ──────────────────────────────────────────────────────────
 *
 *   readCount       — number of COMPLETED reads (incremented at 'complete' state,
 *                     not on page advance — interrupted sessions don't inflate).
 *   visitedRouteIds — union of all route IDs taken across ALL reads of this album.
 *                     Accumulates; never resets — enables "routes not yet taken."
 *   lastRouteId     — most recent route taken. Reserved; not yet used in UI.
 *                     Future: "continue with this route" affordance on reopen.
 *
 * ── Future fields (DO NOT ADD until needed — document only) ─────────────────
 *
 * The current shape is intentionally minimal. When richer signals are needed,
 * extend this interface and update rereadStorage.getRereadContext() to parse
 * new fields with safe defaults (so existing stored objects remain valid).
 * No migration script needed — missing fields always fall back to defaults.
 *
 *   partialReadCount?: number
 *     Sessions where the reader progressed > 20% but did not reach 'complete'.
 *     Increment on: session end (beforeunload / visibility change) when
 *     progress > 20% and readCount did not increment in that session.
 *     Useful for: distinguishing "read twice" from "started twice."
 *
 *   totalReadingTimeMs?: number
 *     Cumulative reading time across all sessions, in milliseconds.
 *     Each session contributes: Date.now() - sessionStartRef.current on unmount.
 *     Useful for: depth-of-engagement score, "spent 8 minutes with this book."
 *
 *   lastCompletedAt?: string
 *     ISO timestamp of last completion (set alongside incrementReadCount).
 *     Useful for: "you read this 5 days ago" recall prompts, time-decay scoring.
 *
 *   rereadDepthScore?: number
 *     Composite 0–1 float derived from:
 *       routeCoverage  = visitedRouteIds.length / album.narrativeRoutes.length
 *       recentReturn   = readCount > 1 && daysSinceLastCompleted < 7 → 0.30 bonus
 *       breadth        = min(readCount / 5, 1.0) × 0.40
 *       score          = routeCoverage × 0.30 + recentReturn + breadth
 *     Useful for: "deep reader" badge, personalizing Leo on 5th+ read,
 *     surfacing unvisited routes with higher priority.
 *     Computed lazily on read; not stored (derived from other fields).
 *
 * ── Storage contract ────────────────────────────────────────────────────────
 *
 * Key format: `reread_${userId}_${contentId}` in localStorage.
 * All reads use safe defaults — missing fields from old stored objects
 * never cause errors or behavioral changes. The format is append-only.
 */
export interface RereadContext {
  readCount:         number;
  visitedRouteIds:   string[];
  lastRouteId?:      string;
  /** Album-level reading route chosen most recently. Used to suggest resumption in the selector. */
  lastAlbumRouteId?: string;
  /** 1-based step index the reader last reached within lastAlbumRouteId. Data only — no auto-resume. */
  lastAlbumRouteStep?: number;
  /** Page ID the reader last reached within lastAlbumRouteId. Data only — no auto-resume. */
  lastAlbumRoutePageId?: string;
}

export interface AlbumPage {
  id: string;
  imageUrl: string;
  regions: AlbumRegion[]; // Ordered sequence of "camera moves" through this page

  // ── Existing optional fields (unchanged) ─────────────────────────
  text?: string;          // Page-level narrative text shown in overview state
  /** @deprecated Use pageType instead. Read by normalizer for backward compat; never written by new code. */
  doubleSpread?: boolean;

  // ── 2.0-A: Audio ─────────────────────────────────────────────────
  // Ambient audio looped for the duration of this page.
  ambientAudioUrl?: string;
  ambientAudioLoop?: boolean; // Defaults to true when ambientAudioUrl is set

  // ── 2.0-A: Page layout ───────────────────────────────────────────
  // Explicit layout hint; 'double' implies doubleSpread behaviour.
  // 'single' is the default and requires no special rendering.
  // Layout hint for the viewer.
  //   'single'  — standard single-page rendering (default).
  //   'double'  — editorial double-page spread. The imageUrl MUST be a single
  //               pre-composed panoramic image that represents both facing pages.
  //               The viewer renders it with a center-seam overlay to mark the fold.
  //               Two-image spreads (separate left + right images) are NOT supported
  //               in this model. Compose them before upload.
  pageType?: 'single' | 'double';
  // How this double-page spread groups with an adjacent page.
  //   'with_next'     — this page + the following page form a single spread (default).
  //   'with_previous' — this page + the preceding page form a single spread.
  // Ignored when pageType === 'single'. Never written for single pages.
  // Legacy 'double-prev' value is normalized to pageType:'double' + doublePageMode:'with_previous' on load.
  doublePageMode?: 'with_next' | 'with_previous';

  // ── 2.0-B: Narrative routes ───────────────────────────────────────
  // Optional set of editorial reading paths through this page's regions.
  // When present, the viewer shows a route selector in overview state.
  // Absent or empty → linear navigation (existing behavior, fully compatible).
  narrativeRoutes?: NarrativeRoute[];
}

export interface School {
  id: string;
  name: string;
  createdAt: string;
}

// Structure for Pedagogical/Critical Analysis Points in Books
export interface PlotPoint {
  pageOrChapter: number; // Trigger point
  title: string; // e.g. "The Mock Turtle's Story"
  insight: string; // e.g. "Lewis Carroll critiquing Victorian education..."
  type: 'historical' | 'stylistic' | 'biographical' | 'critical';
}

export interface Section {
  id: string;
  titulo: string;
  descripcion: string;
  icono: string; // lucide icon name
  unlockCost: number; // Default 1000
  isPublic: boolean; // Override to make it free/visible
  minLevel?: number;
  isHidden: boolean; // Admin hide
  order: number;
}

export interface SchoolConfig {
  schoolName: string;
  hiddenContentIds: string[]; // List of content IDs to hide ("No catalogados")
  availableContentIds?: string[] | 'all'; // Fase 6A: Acceso por Organización
  collectionIds?: string[];               // Fase 6A: Colecciones
  accessStartsAt?: string;                // Fase 6A: Vigencia inicial (ISO)
  accessEndsAt?: string;                  // Fase 6A: Vigencia final (ISO)
}

export interface Content {
  id: string;
  tipo: "libro" | "podcast" | "video" | "guia" | "actividad" | "libro_album" | "memoria_club" | "articulo_pedagogico" | "contexto_pedagogico";
  titulo: string;
  autor: string;
  biografia_autor?: string; // New field for Author Biography
  editorial: "Chibalete" | "Aliada X" | "Comunidad" | string; // Changed to string to allow custom values
  descripcion_corta: string;
  portada_url: string;
  etiquetas: string[];
  url_recurso: string; // For Album, this might be empty or a fallback PDF
  nivel_sugerido?: string;
  metricas: {
    veces_leido: number;
    calificacion_promedio: number;
  };
  publico_objetivo: 'todos' | 'profesores' | 'estudiantes' | 'administrador' | 'niños'; // Added 'niños'

  // Hierarchy Fields
  parentId?: string; // ID of the parent content (e.g., the Book ID for a Guide)
  isCollection?: boolean; // If true, this content is a container (e.g., "Video Series")

  // New: Sections
  sectionIds?: string[];

  // Reading/Progress
  numero_paginas?: number;

  // Optional extra files for Rich Reading Experience
  texto_plano_url?: string;        // Spanish (Default)
  texto_ingles_url?: string;       // English translation
  texto_portugues_url?: string;    // Portuguese translation
  audios_url?: string[];           // Pre-generated TTS audio files
  ilustraciones_url?: string[];    // Array of image URLs for gallery

  // Specific Data for Album Books
  album_data?: AlbumPage[];
  /** Album-level editorial reading routes. When present the viewer shows a route selector at start. */
  readingRoutes?: AlbumReadingRoute[];
  /**
   * Media assets scoped to this album book (4.3 Media System).
   * Indexed by AlbumMediaAsset.id. Regions reference assets via action.mediaAssetId.
   * action.audioUrl is always written alongside mediaAssetId — no resolution chain needed.
   * Absent in pre-4.3 content; treated as [] by default.
   */
  mediaAssets?: AlbumMediaAsset[];

  // Contextual Data for Leo
  plotPoints?: PlotPoint[];

  // Content Availability Status
  status?: 'procesando' | 'disponible' | 'error';

  // Progress Tracking for Background Jobs (TTS)
  processingStatus?: {
    percentage: number;
    currentSentence: number;
    totalSentences: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    lastUpdated: string; // ISO Date
  };
}

// Reading status derived from progress percentage
export type ReadingStatus = 'pending' | 'in_progress' | 'completed';

export interface ProgresoLectura {
  id: string;
  usuario_id: string;
  contenido_id: string;
  
  // Legacy / Transitional properties
  porcentaje: number;
  ultima_posicion: string;
  canonical_index?: number;
  porcentaje_estimado?: number;
  last_device_mode?: 'pdf' | 'text' | 'immersive'; 
  ultimo_modo?: 'pdf' | 'texto' | 'inmersivo' | 'album';

  // Backend System fields
  fecha_actualizacion?: string; // or updatedAt mapped from db
  updatedAt?: string;

  // Canonical Progress Sync payload (Phase 3.3+)
  canonicalProgress?: {
    sentenceIndex: number;
    totalSentences: number;
    globalPercentage: number;
    contentAnchor: string | null;
    contentFingerprint: string | null;
    /**
     * Modo activo en el último playback. Tipo inline por compatibilidad con
     * datos persistidos en progress_db.json y validación backend.
     *
     * 'accessible' es LEGACY = "Modo Guiado" (= 'text'). NO reutilizar este
     * literal para el nuevo Modo Accesible — se reservó 'a11y' para eso.
     * Para código nuevo usar el tipo ReaderMode de `utils/readerMode.ts`.
     */
    lastInteractedMode: 'pdf' | 'text' | 'accessible' | 'immersive';
    // Fase E: per-visor precise anchor — improves same-mode rehidration accuracy.
    // When present and type matches the current visor, use value directly.
    // Falls back to globalPercentage when type differs or field is absent.
    anchor?: {
      type: 'text' | 'sentence' | 'page';
      value: number; // scroll% for text, sentenceIndex for sentence, pageNum for page
    };
    viewportHint?: number; // reserved — scroll offset within an anchor block
  };
  
  // Phase 3.4 Session Tracking (Root level for backend compatibility)
  session?: {
    sessionId: string;
    startedAt: string;
    durationSec: number;
  };

  // Advanced Reading — Unified Continuity (Reading Completion Pass)
  lastMode?: 'texto' | 'inmersivo' | 'pdf' | 'album'; // Reader mode of last open
  lastOpenedAt?: string;   // ISO timestamp — updated on every reader open
  totalTimeMs?: number;    // Accumulated reading time across all sessions (ms)
  sessionsCount?: number;  // Total number of reader opens for this content
}

export interface Resena {
  id: string;
  usuario_id: string;
  contenido_id: string;
  calificacion: 1 | 2 | 3 | 4 | 5;
  texto?: string; // Made optional for rating-only reviews
  fecha: string; // ISO 8601 date string
}

// New Interface for Community features
export interface CommunityPost {
  id: string;
  tipo: 'resena' | 'club';
  autor_id: string;
  autor_nombre: string;
  autor_avatar: string;
  contenido: string;
  fecha: string;
  estado: 'pendiente' | 'aprobado';

  // If it's a book review
  libro_id?: string;
  libro_titulo?: string;

  // If it's a club memory
  club_nombre?: string;

  // Community Interaction
  calificacion_comunidad: number; // Average rating 1-5
  votos: number;
}

export interface Plan {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: string;
  precio_mensual: number;
  beneficios: string[];
}

export interface OrdenSuscripcion {
  id: string;
  usuario_id: string;
  plan_id: string;
  estado: "pendiente" | "pagado" | "fallido";
  metodo_pago_simulado: "PSE" | "Efecty" | "Visa" | "MasterCard" | "Daviplata" | "Nequi";
  fecha_creacion: string; // ISO 8601 date string
}

export interface Bookmark {
  id: string;
  nombre: string;
  imagen_url: string;
}

export interface Product {
  id: string;
  nombre: string;
  autor?: string; // Added for books/memorabilia
  isbn?: string;  // Added for books
  descripcion: string;
  precio: number;
  precio_descuento_puntos?: number; // Price in trivia points
  categoria: 'libro_impreso' | 'ropa' | 'accesorios' | 'papeleria' | 'memorabilia';
  imagen_url: string;
  url_compra: string; // URL to external e-commerce or internal checkout
}

// Store Order Interface for Admin
export interface StoreOrder {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  items: { productId: string; productName: string; quantity: number; price: number }[];
  total: number;
  status: 'pendiente' | 'enviado' | 'entregado' | 'cancelado';
  date: string;
  shippingAddress: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
}

export interface TriviaQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  sourceTitle: string; // Context (e.g., "About: El Viaje de Arion")
}

export interface Reward {
  id: string;
  name: string;
  type: 'wallpaper_mobile' | 'wallpaper_desktop' | 'bookmark';
  cost: number;
  imageUrl: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

/**
 * VisualContext — canonical payload sent from the album viewer to Leo.
 *
 * Flow: VisorAlbum (state) → Chatbot (prop) → geminiService → /api/leo/chat
 *
 * Semantic contract for optional/nullable fields:
 *   - Optional with `?` means "not applicable at this level of the type hierarchy"
 *     (e.g. pageType is optional because it may be absent in legacy data)
 *   - `| null` means "applicable but explicitly absent in this view state"
 *     (e.g. regionId is null in overview mode — no region is focused)
 * Downstream code (Leo prompt builder, analytics) should test `!= null` for
 * presence rather than checking for `undefined` vs `null` separately.
 *
 * Backward compat: original four required fields (imageUrl, pageIndex,
 * regionText, bookTitle) remain required. All 2.0-A fields remain optional
 * so any stale out-of-band caller that sets only the original four still
 * satisfies the type.
 */
export interface VisualContext {
  // ── Required — present in every album view state ─────────────────
  imageUrl:   string; // URL of the current page image
  pageIndex:  number; // 0-based position (legacy; prefer pageId for identity)
  pageId:     string; // AlbumPage.id — stable identity across reorders
  regionText: string; // Text of the focused region, or overview fallback
  bookTitle:  string; // Album title forwarded to Leo for context

  // ── Optional page-level metadata ─────────────────────────────────
  pageType?:      'single' | 'double';              // AlbumPage.pageType; absent in legacy data
  doublePageMode?: 'with_next' | 'with_previous';  // AlbumPage.doublePageMode; only when pageType==='double'

  // ── Region state — null when in overview (no region focused) ─────
  regionId?:   string | null; // AlbumRegion.id; null = overview mode
  regionType?: 'focus' | 'challenge' | 'audio' | 'nav' | 'contemplative' | null; // AlbumRegion.type

  // ── Pedagogical context forwarded to Leo ─────────────────────────
  pedagogicalObjective?: 'literal' | 'inferential' | 'reflective' | 'writing' | null;
  leoHint?:              string | null; // AlbumRegion.leoHint; null = not set

  // ── 2.0-B: Narrative route context forwarded to Leo ──────────────
  // null = no route active (linear navigation or page has no routes).
  //
  // activeRouteName: the route label as shown to the reader.
  //   Future use in /api/leo/chat prompt builder:
  //     "Vamos por el personaje... ¿qué ves en su expresión?"
  //     "Sigamos mirando el paisaje... ¿hay algo al fondo?"
  //   Not yet consumed server-side — included as forward-compat context.
  //
  // activeRouteLeoMode: mirrors NarrativeRoute.leoMode.
  //   Already drives useLeoMediator's hint type selection (client-side).
  //   Included here so the server-side Leo prompt builder can use it
  //   without a separate API parameter when route-aware responses land.
  activeRouteName?:    string | null;
  activeRouteLeoMode?: 'observe' | 'wonder' | 'connect' | 'reflect' | null;
}

// --- Aula Viva / Pedagogical Interfaces ---

export interface Group {
  id: string;
  name: string;
  type: 'course' | 'club';    // Tipo de grupo — default 'course' si ausente (normalizeGroup)
  // --- Campos legacy (conservados para compatibilidad) ---
  teacherId?: string;          // Legacy: mediador único. Usar mediatorIds en código nuevo.
  studentIds?: string[];       // Legacy: lista de alumnos. Alias de memberIds.
  school?: string;             // Nombre del colegio (string legacy)
  grade?: string;              // Grado/nivel (string legacy)
  gradeLevel?: number;         // Nivel escolar estructurado (derivado de grade en normalizeGroup)
  section?: string;            // Sección letra (ej. 'A', 'B') — derivado de grade o explícito
  // --- Campos extendidos ---
  mediatorIds: string[];       // Múltiples mediadores. Normalizado desde teacherId si es necesario.
  memberIds: string[];         // Membresía flexible (alumnos + otros miembros)
  organizationId?: string;     // Referencia a organización (complementa 'school')
  availableContentIds?: string[] | 'all'; // Fase 5: Control de Accesibilidad
  collectionIds?: string[];               // Fase 6A: Acceso por paquete
  accessStartsAt?: string;                // Fase 6A: Ventana temporal inicio (ISO)
  accessEndsAt?: string;                  // Fase 6A: Ventana temporal fin (ISO)
  activeExperienceId?: string | null;     // Fase 8: Bundle/experiencia activo en este grupo (null = sin experiencia)
  accessRules?: {                         // Reglas de acceso estructuradas (opcional)
    type: 'full' | 'restricted';
    titleIds?: string[];        // IDs de títulos específicos autorizados
    collectionIds?: string[];   // IDs de colecciones autorizadas
    expiresAt?: number;         // Timestamp Unix de expiración
  };
  // --- Clubes Externos ---
  kind?: 'school' | 'open';              // 'school' = grupo escolar (default), 'open' = club externo abierto
  mediationMessage?: string;             // Mensaje del mediador visible para miembros del club
  mediationQuestions?: string[];         // 2–3 preguntas de reflexión del mediador
  readingNow?: string;                   // Lectura activa del momento
  weeklyFocus?: string;                  // Foco de la semana
  nextMilestone?: string;                // Próximo momento del club
}

// --- FASE E6: MOTOR DE ACCESO POR SCOPES ---
export interface ContentAccess {
  id: string;
  scope: 'organization' | 'group' | 'user';
  scopeId: string;
  titleIds?: string[];
  collectionIds?: string[];
  expiresAt?: number;
}

export interface ResolvedAccessState {
  titleIds: string[];
  collectionIds: string[];
  appliedRules: string[];
  hasBroadAccess: boolean;
}

/**
 * Bundle — Infraestructura interna de "Experiencias" (Fase 7).
 *
 * Nombre visible al usuario: "Experiencia" (nunca "bundle" en UI).
 * Estos registros viven en bundles_db.json y se servirán vía GET /api/bundles.
 *
 * Preparado para futura edición desde panel Admin:
 *   - POST   /api/bundles        → crear experiencia
 *   - PUT    /api/bundles/:id    → editar experiencia
 *   - DELETE /api/bundles/:id    → eliminar experiencia
 * (No implementado aún — solo GET por ahora)
 */
export interface Bundle {
  id: string;
  name: string;                   // Nombre visible de la experiencia
  description?: string;           // Descripción legacy (compat)
  shortDescription?: string;      // Tagline corta para tarjetas UI
  summary?: string;               // Descripción extendida (futuro detalle admin)
  includes?: string[];            // Lista legible de qué incluye ("3 libros", "2 guías")
  contentIds: string[];           // IDs de contenido habilitados al activar
  tags?: string[];                // Etiquetas para filtrado (grado, tema, etc.)
}

export interface AssignmentSubmission {
  studentId: string;
  studentName?: string; // Helper for UI
  content: string; // Text or URL
  date: string;
  grade?: number; // 1-5 or 1-10
  teacherFeedback?: string;
  status: 'submitted' | 'graded';
}

// Entrega de tarea con persistencia server-side (sistema de exportación académica)
export interface TaskSubmission {
  id: string;
  taskId: string;
  studentId: string;
  groupId: string;
  responseText: string;
  status: 'pending' | 'submitted';
  submittedAt?: string;
  contentId?: string;
  source?: 'task' | 'bitacora';
  wordCount?: number;
  taskTitle?: string;        // Título de la tarea, para etiquetado del ZIP
}

/**
 * Señales pedagógicas básicas derivadas de las entregas reales del estudiante.
 * Diseñadas para ser explicables, auditables y consumibles por Leo en futuras fases.
 * Calculadas a partir de Assignment.studentSubmissions (localStorage) — sin llamada a servidor.
 */
export interface StudentLearningSignals {
  studentId: string;

  // Cumplimiento
  totalAssigned: number;
  totalSubmitted: number;
  completionRate: number;              // 0–100 (porcentaje)

  // Volumen de escritura
  totalWordCount: number;
  averageWordCount: number;

  // Niveles derivados (heurística transparente)
  writingVolumeLevel: 'low' | 'medium' | 'high';
  consistencyLevel:   'low' | 'medium' | 'high';
  writingDevelopmentLevel: 'initial' | 'developing' | 'solid';
  trend: 'improving' | 'stable' | 'irregular' | 'needs_attention';

  // Resumen docente (template, sin LLM)
  summary: string;

  // Evidencia auditable
  evidence: {
    basedOnAssignments: number;
    basedOnSubmissions: number;
    lastSubmissionAt?: string;         // ISO string de la última entrega
  };
}

/**
 * Una recomendación pedagógica derivada de señales reales (sin LLM).
 * category: 'strength' | 'alert' | 'action'
 */
export interface StudentPedagogicalRecommendation {
  category: 'strength' | 'alert' | 'action';
  priority: 'low' | 'medium' | 'high';
  pedagogicalGoal: 'literal' | 'inferential' | 'critical' | 'metacognitive' | 'vocabulary' | 'fluency' | 'writing' | 'emotional' | 'reading_habit';
  title: string;
  description: string;
  rationale: string;
}

/**
 * Conjunto de recomendaciones pedagógicas para un estudiante.
 * Generado a partir de StudentLearningSignals (plantilla, sin IA).
 */
export interface StudentRecommendationBundle {
  studentId: string;
  strengths: StudentPedagogicalRecommendation[];
  alerts: StudentPedagogicalRecommendation[];
  actions: StudentPedagogicalRecommendation[];
  headline: string;
}

/**
 * Síntesis pedagógica de Leo para el docente.
 *
 * Generada a partir de StudentLearningSignals + StudentRecommendationBundle.
 * Completamente determinista: sin LLM, sin llamadas externas.
 * Toda salida es trazable a señales concretas del estudiante.
 */
export interface LeoTeacherAdvisorSummary {
  studentId: string;

  /** Objetivo pedagógico prioritario según la situación del estudiante. */
  dominantGoal:
    | 'literal'
    | 'inferential'
    | 'critical'
    | 'metacognitive'
    | 'vocabulary'
    | 'fluency'
    | 'writing'
    | 'emotional'
    | 'reading_habit';

  /** Frase breve de Leo al docente — pedagógica, no clínica, no moralizante. */
  headline: string;

  /** Orientación pedagógica de 2–4 frases: une señales + recomendaciones. */
  teacherGuidance: string;

  /** Una sola acción concreta y ejecutable para el corto plazo. */
  shortTermAction: string;

  /** Justificación explícita basada en números reales del estudiante. */
  rationale: string;

  /** Confianza en la síntesis: low (<2 entregas) | medium (2–3) | high (≥4 + consistencia ≥ media). */
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Vista longitudinal consolidada de un estudiante a través de todas las fuentes de datos.
 *
 * Construida por: dataService.buildStudentLongitudinalContext(studentId)
 * Propósito:      entrada única para Leo Advisor y análisis pedagógico enriquecido.
 * Contrato:       todos los campos numéricos son seguros (nunca undefined/NaN).
 *                 los campos de fecha son ISO string o undefined (nunca null).
 *                 nunca lanza excepción — devuelve defaults en caso de error.
 */
export interface StudentLongitudinalContext {
  studentId: string;

  /** ISO timestamp de generación de este snapshot. */
  generatedAt: string;

  /**
   * Ventana temporal que abarca este snapshot.
   * Por ahora siempre 'lifetime' (sin filtrado). Preparado para ventanas acotadas.
   */
  timeWindow: {
    type: 'lifetime' | 'last_7d' | 'last_30d';
    /** ISO date de inicio de ventana (undefined cuando type === 'lifetime'). */
    from?: string;
    /** ISO date de fin de ventana (undefined cuando type === 'lifetime'). */
    to?: string;
  };

  /**
   * Señales de cumplimiento y escritura.
   * Fuente: this.assignments + assignment.studentSubmissions[] (localStorage)
   *
   * UNIDAD DE TIEMPO: no aplica (sin campos de tiempo en este bloque).
   */
  tasks: {
    /** Total de tareas activas o completadas en los grupos del estudiante. */
    total: number;
    /** Tareas con al menos una entrega de este estudiante. */
    submitted: number;
    /** Tareas sin entrega (total − submitted). */
    pending: number;
    /**
     * Promedio de palabras en entregas de texto.
     * Excluye blob: URLs (audio/video/foto). 0 si no hay entregas de texto.
     */
    avgWordCount: number;
    /**
     * Número de entregas de texto reales contadas para avgWordCount.
     * Excluye blob: URLs. Permite estimar la fiabilidad del promedio.
     */
    textSubmissions: number;
    /** ISO date de la entrega más reciente. */
    lastActivityAt?: string;
  };

  /**
   * Señales de comportamiento lector.
   * Fuente: this.progress (ProgresoLectura[], sincronizado desde progress_db.json)
   * Nota: history[] vive solo en el servidor; los campos disponibles son los del
   *       frontend (sessionsCount, totalTimeMs, lastOpenedAt, porcentaje).
   *
   * UNIDAD DE TIEMPO: todos los campos de tiempo (totalTimeSec, avgSessionTimeSec)
   * están en SEGUNDOS. La fuente (totalTimeMs) está en milisegundos y se convierte
   * en el agregador antes de entrar al contexto.
   */
  reading: {
    /** Libros con al menos un registro de progreso para este estudiante. */
    booksStarted: number;
    /** Libros con porcentaje ≥ 100 o presentes en user.libros_terminados[]. */
    booksCompleted: number;
    /** Suma de sessionsCount en todos los registros de progreso del estudiante. */
    totalSessions: number;
    /** Tiempo total de lectura en segundos (de totalTimeMs acumulado localmente). */
    totalTimeSec: number;
    /** Tiempo promedio por sesión en segundos. 0 si totalSessions === 0. */
    avgSessionTimeSec: number;
    /** ISO timestamp de la última apertura registrada (lastOpenedAt más reciente). */
    lastSessionAt?: string;
  };

  /**
   * Señales de escritura reflexiva.
   * Fuente: this.journalEntries (localStorage, ordenadas desc por fecha)
   */
  journal: {
    /** Total de entradas de bitácora de este estudiante. */
    entries: number;
    /** Longitud media del contenido en caracteres. 0 si no hay entradas. */
    avgLength: number;
    /** ISO date de la entrada más reciente. */
    lastEntryAt?: string;
    /** Conteo por tipo de entrada. */
    typeCounts: {
      personal: number;
      task_draft: number;
      other: number;
    };
  };

  /**
   * Señales de uso de Leo.
   * Fuente: this.leoReaderProfiles (localStorage, contadores acumulados)
   * Limitación conocida: no hay log individual de interacciones; solo contadores.
   */
  leoInteraction: {
    /** Activaciones de anclaje de vocabulario. */
    vocabularyEvents: number;
    /** Activaciones de pregunta inferencial. */
    inferentialEvents: number;
    /** Activaciones de reflexión. */
    reflectionEvents: number;
    /** Intentos de lectura oral. */
    oralityAttempts: number;
    /** Suma de todos los tipos de eventos Leo. */
    totalEvents: number;
    /** ISO date de updatedAt del perfil, solo cuando totalEvents > 0. */
    lastInteractionAt?: string;
  };

  /** Metadatos de trazabilidad. */
  meta: {
    /**
     * Fuentes que contribuyeron datos reales a este snapshot.
     * Posibles valores: 'tasks' | 'reading' | 'journal' | 'leo'
     * Un array vacío indica que no se encontró ningún dato para este estudiante.
     */
    sources: string[];
    /**
     * Calidad estimada del contexto:
     *   'full'    → ≥3 fuentes con datos reales
     *   'partial' → 1–2 fuentes con datos reales
     *   'minimal' → sin fuentes con datos (estudiante sin actividad registrada)
     */
    dataQuality: 'full' | 'partial' | 'minimal';
    /**
     * TODO: Confianza cuantitativa del snapshot (0–1).
     * Reservado para refinamiento futuro. Por ahora no se calcula.
     * Posible derivación: función de (nSources, nSubmissions, recency).
     */
    signalStrength?: number;
  };
}

/** Three-level classification used across all pedagogical signals. */
export type SignalLevel = 'low' | 'medium' | 'high';

/**
 * Pedagogical signals derived from a StudentLongitudinalContext.
 *
 * Produced by: dataService.derivePedagogicalSignals(ctx)
 * Nature:      deterministic — no AI, no NLP, no ML scoring
 * Contract:    all fields are safe; defaults conservatively to 'medium' when uncertain
 *              never infers cognitive conditions or diagnoses
 *              never throws — synchronous and pure
 */
export interface PedagogicalSignals {
  /**
   * Frequency and depth of independent reading behavior.
   * Derived from: ctx.reading.totalSessions, totalTimeSec, booksStarted
   */
  readingHabit: SignalLevel;

  /**
   * Evidence of written expression across tasks and journal.
   * Derived from: ctx.tasks.textSubmissions, avgWordCount + ctx.journal.entries
   */
  writingEngagement: SignalLevel;

  /**
   * Degree of independent engagement versus Leo-assisted reading.
   * Leo usage is NOT penalized unless it replaces all independent reading entirely.
   * Derived from: ctx.leoInteraction.totalEvents, ctx.reading.totalSessions
   */
  autonomy: SignalLevel;

  /**
   * Recency and regularity of activity across all data sources.
   * Derived from: lastSessionAt, lastEntryAt, lastActivityAt
   */
  consistency: SignalLevel;

  meta: {
    /** Data sources consulted when deriving these signals. */
    basedOn: string[];
    /** Short traceable notes explaining each signal derivation. */
    notes?: string[];
  };
}

/**
 * Controlled set of pedagogical objectives.
 * Maps 1:1 to PedagogicalSignals fields.
 * DO NOT expand without explicit instruction.
 */
export type PedagogicalObjective =
  | 'reading_habit'
  | 'writing_expression'
  | 'autonomy'
  | 'consistency';

/**
 * Structured pedagogical context for Leo Advisor.
 *
 * Produced by: dataService.buildLeoAdvisorContext(ctx, signals)
 * Nature:      deterministic — no AI, no text generation
 * Purpose:     bridges signal interpretation → recommendations and teacher summaries
 * Contract:    never throws; arrays may be empty; strings are factual, not clinical
 */
export interface LeoAdvisorContext {
  studentId: string;

  /** The interpreted behavioral signals this context was built from. */
  signals: PedagogicalSignals;

  /**
   * Pedagogical objectives classified by signal level.
   * strengths → signals that are 'high'
   * focus     → signals that are 'low'
   * 'medium' signals are neutral and appear in neither array.
   */
  objectives: {
    strengths: PedagogicalObjective[];
    focus: PedagogicalObjective[];
  };

  /**
   * Short factual evidence lines derived directly from ctx values.
   * NOT natural language interpretation — purely numerical/structural.
   * Max 5 lines; only non-zero sources included.
   */
  evidence: {
    summary: string[];
  };

  meta: {
    /**
     * Confidence in this context, derived from ctx.meta.dataQuality:
     *   full → high | partial → medium | minimal → low
     */
    confidence: 'low' | 'medium' | 'high';
    /** Inherited from signals.meta.basedOn (not re-derived from ctx). */
    basedOn: string[];
  };
}

/**
 * A single actionable pedagogical recommendation for a teacher.
 *
 * Produced by: dataService.buildPedagogicalRecommendations(advisor)
 * Nature:      deterministic — no AI, no text generation
 * Contract:    action is concrete and observable; justification is factual, not speculative
 *              type and priority are derived from signal classification, not inference
 */
export interface PedagogicalRecommendation {
  /** The pedagogical objective this recommendation addresses. */
  objective: PedagogicalObjective;

  /**
   * Classification of the recommendation:
   *   reinforce → objective is a strength; keep sustaining it
   *   develop   → objective is a focus area; needs targeted attention
   *   monitor   → signal is neutral but worth tracking (reserved for future use)
   */
  type: 'reinforce' | 'develop' | 'monitor';

  /**
   * Urgency of the recommendation:
   *   high   → critical gap or foundational behavior absent
   *   medium → relevant area; not immediately urgent
   *   low    → reinforcement; sustain existing behavior
   */
  priority: 'low' | 'medium' | 'high';

  /** One concrete, observable action for the teacher. Short and specific. */
  action: string;

  /** Factual justification grounded in signal evidence. No speculation. */
  justification: string;
}

/**
 * Final teacher-facing narrative output produced by Leo.
 *
 * Produced by: dataService.buildLeoSuggestion(advisor, recommendations)
 * Nature:      controlled narrative synthesis — not free text generation
 * Contract:    all fields derived only from advisor + recommendations inputs
 *              no inference beyond what structured data already states
 *              summary is 1–2 sentences; recommendations max 3 lines; evidence max 5 lines
 */
export interface LeoSuggestion {
  /**
   * 1–2 sentence overview of the student's situation.
   * Neutral, factual, teacher-oriented. No diagnosis or speculation.
   */
  summary: string;

  /**
   * Actionable recommendation lines in natural language.
   * Each line = action + brief justification. Max 3 items.
   */
  recommendations: string[];

  /**
   * Evidence lines reused or lightly adapted from advisor.evidence.summary.
   * No new data introduced. Max 5 items.
   */
  evidence: string[];
}

export interface Assignment {
  id: string;
  groupId: string;
  contentId: string;
  contentTitle: string;
  assignedDate: string;
  dueDate: string;
  description?: string;
  status: 'active' | 'completed' | 'archived';
  submissionType?: 'text' | 'photo' | 'video' | 'audio'; // Added audio
  studentSubmissions?: AssignmentSubmission[];
}

export interface PedagogicalStats {
  userId: string;
  totalReadingTimeMinutes: number;
  booksCompleted: number;

  // PISA / Saber Competencies (Scale 0-100)
  comprension_literal: number;     // Recuperación de información
  comprension_inferencial: number; // Interpretación y conexión
  reflexion_critica: number;       // Evaluación y reflexión

  // Detailed Reading Metrics
  readingSpeedWPM: number; // Words Per Minute
  avgSessionDurationMinutes: number;
  rereadCount: number; // Number of times fragments were reread
  genrePreferences: { genre: string, count: number }[];

  // Engagement & Behavior
  chatbotInteractions: number; // Count of questions asked to Leo/AI
  weeklyReadingTimeMinutes: number; // Avg time per week
  dailyReadingTimeMinutes: number;  // Avg time per day
  taskCompletionRate: number; // 0-100 percentage of assigned tasks completed

  // Historical Trend (Last 5 months averages)
  evolutionHistory: { month: string, avgScore: number }[];

  topicInterestCloud: { topic: string, weight: number }[]; // For word cloud
  lastAssessmentDate: string;

  // New Metrics for Holistic View
  writingProgress: number; // 0-100 scale based on assignment grades
  /**
   * Uso porcentual por modo de lectura. La clave 'accessible' es LEGACY y
   * corresponde al actual "Modo Guiado" (= 'text'). Se mantiene para no
   * romper reportes históricos. El nuevo Modo Accesible (cuando se construya)
   * usará la clave 'a11y'. Ver `utils/readerMode.ts`.
   */
  modeUsage: { pdf: number, immersive: number, accessible: number, album: number }; // Percentage usage
  socioEmotionalScore: number; // 0-100 based on reflective questions
  vocationalAlignment: string[]; // e.g. ['Ciencias', 'Artes']

  // 8 Pedagogical Objectives (0-100)
  pedagogicalObjectives: {
    comprender_global: number;
    inferir_significados: number;
    evaluar_criticamente: number;
    integrar_fuentes: number;
    conectar_contexto: number;
    expandir_vocabulario: number;
    expresar_ideas: number;
    disfrutar_lectura: number;
  };
}

// Bitácora / Journal
export interface JournalEntry {
  id: string;
  userId: string;
  title: string;
  content: string;
  date: string;
  tags?: string[];
  // Smart Linking
  type: 'personal' | 'task_draft' | 'review_draft' | 'story_draft' | 'reward_request';
  sourceId?: string; // ID of the Assignment or Book
  sourceTitle?: string; // Title of the Assignment or Book
  status: 'draft' | 'submitted' | 'published' | 'approved' | 'rejected';
}

// --- Phase 8: Oral Reading Attempt ---
export interface OralityAttempt {
  id: string;
  userId: string;
  contentId: string;
  createdAt: string;   // ISO 8601
  score: number;       // 0–100 (Levenshtein match %)
  status: 'completed';
  metrics: {
    wordsRead: number;   // word count of recognized transcript
    durationMs: number;  // wall-clock recording time in ms
  };
}

// --- Leo Pedagogical Layer ---

/**
 * PedagogicalStage — represents where a reader is in the pedagogical journey of a book.
 * Derived deterministically from reading progress % and anchor usage.
 */
export type PedagogicalStage =
  | 'comprehension'   // < 25%: literal understanding, vocabulary focus
  | 'interpretation'  // 25–60% or 2+ anchors: inference and connection
  | 'reflection'      // 60–85% or 5+ anchors: critical evaluation
  | 'creation';       // ≥ 85%: expression, synthesis, creation

/**
 * LeoReaderProfile — lightweight cumulative tendencies across all books/sessions.
 * Persisted via dataService under the 'leoReaderProfiles' localStorage key.
 * All counters start at 0; fail gracefully if absent.
 */
export interface LeoReaderProfile {
  userId: string;
  vocabularySupportCount: number;   // times vocab anchors / word explanations were opened
  inferentialPromptCount: number;   // times 'question' interaction type was used
  reflectionPromptCount: number;    // times reflection-type anchors were opened
  oralityAttemptsCount: number;     // total oral reading attempts recorded
  averageOralityScore: number | null; // 0–100, null = no attempts yet
  booksCompletedCount: number;      // derived from libros_terminados length
  // Rolling window of last 10 interaction types — source for preferredSupportType
  recentInteractionTypes?: string[];
  // Most frequent type in recent window — computed on update
  preferredSupportType: 'vocabulary' | 'inferential' | 'reflection' | null;
  updatedAt: string;                // ISO timestamp
}

// --- CSV Bulk Upload Result ---
export interface ImportRowError {
  row: number;
  email: string;
  reason: string;
}

export interface ImportResult {
  totalRows: number;
  validRows: number;
  created: number;
  duplicates: number;
  invalid: number;
  warnings: number;
  errors: ImportRowError[];
}
