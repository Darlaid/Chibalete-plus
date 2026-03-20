
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
  roles: ('lector' | 'profesor' | 'administrador')[];
  mediatorKind?: 'teacher' | 'librarian' | 'coordinator' | 'parent'; // NUEVO: Especialización
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

// New Structures for Album Books (Guided View)
export interface AlbumRegion {
  id: string;
  text: string; // Narrative text for this specific region
  x: number; // Percentage (0-100)
  y: number; // Percentage (0-100)
  width: number; // Percentage (0-100)
  height: number; // Percentage (0-100)
  isInteractive?: boolean; // If true, this region is a hidden object game (e.g. "Find the flower")
  interactiveHint?: string; // Prompt from Leo: "Can you find the...?"
}

export interface AlbumPage {
  id: string;
  imageUrl: string;
  regions: AlbumRegion[]; // The sequence of "camera moves" for this page
  text?: string;           // Optional page-level narrative text shown in full view
  doubleSpread?: boolean;  // If true, render as wide landscape double-page layout
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
    lastInteractedMode: 'pdf' | 'text' | 'accessible' | 'immersive';
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

// Context specifically for Visual Album mode
export interface VisualContext {
  imageUrl: string;
  pageIndex: number;
  regionText: string; // The text currently displayed in the guided view
  bookTitle: string;
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
  // --- Campos extendidos ---
  mediatorIds: string[];       // Múltiples mediadores. Normalizado desde teacherId si es necesario.
  memberIds: string[];         // Membresía flexible (alumnos + otros miembros)
  organizationId?: string;     // Referencia a organización (complementa 'school')
  availableContentIds?: string[] | 'all'; // Fase 5: Control de Accesibilidad
  collectionIds?: string[];               // Fase 6A: Acceso por paquete
  accessStartsAt?: string;                // Fase 6A: Ventana temporal inicio (ISO)
  accessEndsAt?: string;                  // Fase 6A: Ventana temporal fin (ISO)
  accessRules?: {                         // Reglas de acceso estructuradas (opcional)
    type: 'full' | 'restricted';
    titleIds?: string[];        // IDs de títulos específicos autorizados
    collectionIds?: string[];   // IDs de colecciones autorizadas
    expiresAt?: number;         // Timestamp Unix de expiración
  };
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

export interface AssignmentSubmission {
  studentId: string;
  studentName?: string; // Helper for UI
  content: string; // Text or URL
  date: string;
  grade?: number; // 1-5 or 1-10
  teacherFeedback?: string;
  status: 'submitted' | 'graded';
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
  // Most frequent interaction type — computed on update
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
