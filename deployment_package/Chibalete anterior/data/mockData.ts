
import type { User, Content, ProgresoLectura, Resena, Plan, OrdenSuscripcion, Bookmark, CommunityPost, Product, Group, Assignment, PedagogicalStats, StoreOrder, JournalEntry } from '../types';

// Helper to generate dynamic dates relative to "Today"
const getRelativeDate = (daysOffset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split('T')[0];
};

export const users: User[] = [
  {
    id: 'user-admin',
    nombre_usuario: 'Administrador',
    nombre_completo: 'Administrador Chibalete',
    email: 'admin@chibaleteeditores.com',
    password: '(Derpheluno2)',
    fecha_nacimiento: '1990-01-01',
    avatar_url: 'https://ui-avatars.com/api/?name=Admin+Chibalete&background=333&color=fff',
    bio_corta: 'Gestor de la plataforma Chibalete.',
    libros_leidos: 0,
    seguidores: 0,
    seguidos: 0,
    nivel_lectura: 'Feroz',
    roles: ['administrador', 'profesor', 'lector'],
    libros_terminados: [],
    unlocked_bookmarks: [],
    saved_posts: [],
    social_connections: { facebook: true, instagram: true, linkedin: true },
    puntos: 0,
    immersive_level: 5,
    recent_history: []
  }
];

export const content: Content[] = [
  {
    id: 'rescue-book-1',
    titulo: 'Libro de Prueba (Rescate)',
    descripcion_corta: 'Un libro de prueba para verificar el visor.',
    tipo: 'libro',
    editorial: 'Chibalete',
    publico_objetivo: 'todos',
    autor: 'Sistema Chibalete',
    portada_url: 'https://placehold.co/400x600/indigo/white?text=Libro+Prueba',
    url_recurso: 'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf',
    texto_plano_url: 'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf', // Fallback for text viewer test
    texto_ingles_url: null,
    texto_portugues_url: null,
    ilustraciones_url: [],
    etiquetas: ['prueba', 'sistema'],
    metricas: {
      veces_leido: 0,
      calificacion_promedio: 5
    }
  }
];

export const progresoLectura: ProgresoLectura[] = [];
export const resenas: Resena[] = [];

// Planes removed as per request
// export const planes: Plan[] = [];

// Subscriptions removed
// export const ordenesSuscripcion: OrdenSuscripcion[] = [];
export const bookmarks: Bookmark[] = [];
export const communityPosts: CommunityPost[] = [];
export const storeProducts: Product[] = [];
export const storeOrders: StoreOrder[] = [];
export const groups: Group[] = [];
export const assignments: Assignment[] = [];
// Stats can be null or empty object if handled securely, but let's provide safe defaults matching interface
export const pedagogicalStats: PedagogicalStats[] = [{
  userId: 'user-admin',
  totalReadingTimeMinutes: 0,
  booksCompleted: 0,
  comprension_literal: 0,
  comprension_inferencial: 0,
  reflexion_critica: 0,
  readingSpeedWPM: 0, // Corrected from averageReadingSpeedWPM
  avgSessionDurationMinutes: 0,
  rereadCount: 0,
  genrePreferences: [],
  chatbotInteractions: 0,
  weeklyReadingTimeMinutes: 0,
  dailyReadingTimeMinutes: 0,
  taskCompletionRate: 0,
  evolutionHistory: [],
  topicInterestCloud: [],
  lastAssessmentDate: new Date().toISOString(),
  writingProgress: 0,
  modeUsage: { pdf: 0, immersive: 0, accessible: 0, album: 0 },
  socioEmotionalScore: 0,
  vocationalAlignment: [],
  pedagogicalObjectives: {
    comprender_global: 0,
    inferir_significados: 0,
    evaluar_criticamente: 0,
    integrar_fuentes: 0,
    conectar_contexto: 0,
    expandir_vocabulario: 0,
    expresar_ideas: 0,
    disfrutar_lectura: 0
  }
}];
export const journalEntries: JournalEntry[] = [];
