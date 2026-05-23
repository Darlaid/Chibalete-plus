import type {
    User,
    Content,
    ProgresoLectura,
    ReadingStatus,
    LeoReaderProfile,
    Resena,
    Plan,
    OrdenSuscripcion,
    Bookmark,
    CommunityPost,
    Product,
    StoreOrder,
    Assignment,
    AssignmentSubmission,
    PedagogicalStats,
    StudentLearningSignals,
    StudentPedagogicalRecommendation,
    StudentRecommendationBundle,
    LeoTeacherAdvisorSummary,
    StudentLongitudinalContext,
    PedagogicalSignals,
    PedagogicalObjective,
    LeoAdvisorContext,
    PedagogicalRecommendation,
    LeoSuggestion,
    SignalLevel,
    Group,
    JournalEntry,
    Section,
    SchoolConfig,
    OralityAttempt,
    ImportRowError,
    School,
    Bundle
} from '../types';
import { persistenceService } from './persistenceService';
import { isMediator, isAdmin, hasMediatorRole, hasAdminRole } from '../utils/permissions';
// Sprint 021 Fase 2 — fuente única de verdad de membresía. Las mismas
// helpers que importan server/groupMembershipService.js y
// server/metricsService.js. Si la regla de membresía cambia, se cambia en
// utils/groupMembership.mjs y las tres capas quedan consistentes
// automáticamente. No re-implementar acá.
//
// Sprint 022 Fase B — addUserIdToGroup/removeUserIdFromGroup +
// addGroupIdToUser/removeGroupIdFromUser se usan SOLAMENTE para refrescar
// el cache local tras la respuesta del endpoint atómico backend. NO
// reemplazan la transacción del backend — son aplicaciones in-memory de
// las mismas primitivas que el backend ya persistió.
import {
    getGroupMembers,
    addUserIdToGroup,
    removeUserIdFromGroup,
    addGroupIdToUser,
    removeGroupIdFromUser,
    unionGroupMemberIds,
    diffIds,
} from '../utils/groupMembership.mjs';
// Sprint visibilidad — capa narrativa: shape de la respuesta del endpoint
// GET /api/groups/:id/diagnosis. Lo importamos solo para que el método del
// dataService devuelva un tipo público al consumidor (UI).
import type { GroupDiagnosis } from '../utils/groupDiagnosis';
// Sprint Panel del estudiante — shape de GET /api/students/:id/status.
import type { StudentStatus } from '../utils/studentStatus';

// Fase F: Entry in the persistent failed-sync queue.
interface FailedSyncEntry {
    userId: string;
    contentId: string;
    payload: string;  // JSON body — exactly what would be sent to /api/progress/:u/:c/sync
    addedAt: string;  // ISO timestamp — used for 24h TTL pruning
}

class DataService {
    private users: User[] = [];
    private content: Content[] = [];
    private progress: ProgresoLectura[] = [];
    private reviews: Resena[] = [];
    private bookmarks: Bookmark[] = [];
    private communityPosts: CommunityPost[] = [];
    private products: Product[] = [];
    private storeOrders: StoreOrder[] = [];
    private groups: Group[] = [];
    private assignments: Assignment[] = [];
    private pedagogicalStats: PedagogicalStats[] = [];
    private journalEntries: JournalEntry[] = [];
    private schools: School[] = [];
    // Phase 8: Oral Reading History
    private oralityAttempts: OralityAttempt[] = [];
    // Leo Pedagogical Layer: Cumulative Reader Profiles
    private leoReaderProfiles: LeoReaderProfile[] = [];
    // Fase 7: Bundles comerciales
    private bundles: Bundle[] = [];

    // Phase 3.4 Sync Engine
    private pendingSyncs: Map<string, ProgresoLectura> = new Map();
    private lastSyncedPayloads: Map<string, string> = new Map();
    private syncInterval: NodeJS.Timeout | null = null;
    private currentSessionId: string = crypto.randomUUID();
    private sessionStartTimeMs: number = Date.now();

    // Fase F — Sync eventual: entries that failed to sync and need retry.
    // Persisted to localStorage so they survive page reload.
    // Key: `${userId}__${contentId}` — same as pendingSyncs.
    // Max 50 entries; entries older than 24h are pruned (stale progress unlikely to help).
    private failedSyncs: Map<string, FailedSyncEntry> = new Map();
    private static readonly FAILED_SYNCS_KEY = 'chibalete_failed_syncs';
    private static readonly FAILED_SYNCS_MAX = 50;
    private static readonly FAILED_SYNCS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

    /**
     * Fase E3 — Árbitro temporal del servidor.
     * Offset en ms entre el reloj del servidor y el reloj local del cliente.
     * Valor 0 = sin sincronizar (fallback a Date.now() del cliente).
     * Positivo = servidor adelantado; negativo = servidor atrasado.
     */
    private serverTimeOffset: number = 0;
    private serverTimeSynced: boolean = false;

    // v4.0.7: promovido a public para que módulos hermanos (geminiService)
    // reutilicen el mismo base path en lugar de hardcodear '/api/...'.
    public apiUrl = '/api';

    private initializationPromise: Promise<void>;

    /**
     * getSessionUserId — Lee el userId de la sesion activa.
     * AuthContext guarda en localStorage (remember=true) o sessionStorage (remember=false).
     * Devuelve string vacio si no hay sesion activa.
     */
    // v4.0.7: promovido a public para que módulos hermanos (geminiService)
    // resuelvan el x-user-id sin leer localStorage directamente.
    public getSessionUserId(): string {
        return localStorage.getItem('chibalete_user_id')
            ?? sessionStorage.getItem('chibalete_user_id')
            ?? '';
    }

    /**
     * hasActiveSession — true si hay un userId valido en storage. Sin network call.
     * Usado por flujos admin (SubirContenido) para fail-fast antes de subir archivos.
     */
    public hasActiveSession(): boolean {
        const id = this.getSessionUserId();
        return !!(id && id.trim());
    }

    /**
     * Headers para operaciones de escritura que requieren rol administrador.
     * Usa x-user-id del usuario logueado — el backend valida el rol.
     * No embebe secretos en el bundle.
     */
    private get adminWriteHeaders(): Record<string, string> {
        const userId = this.getSessionUserId();
        // Resiliencia: sin sesión activa, devolver objeto vacío en lugar de
        // un header `x-user-id: ''` ruidoso. El backend rechaza ambos por
        // igual (401) — esto evita logs falsos durante el bootstrap pre-login.
        return userId ? { 'x-user-id': userId } : {};
    }

    constructor() {
        // --- USERS LOADING ---
        // HOTFIX: Storage ignorado a propósito. La API es la única fuente de verdad para evitar usuarios fantasma.
        this.users = [];

        // --- CONTENT LOADING ---
        const rawContent = persistenceService.load('content', []);
        this.content = Array.isArray(rawContent) ? rawContent.filter((c: any) => c && c.id) : [];

        // Initialize API calls and store the promise
        this.initializationPromise = Promise.all([
            this.initializeFromApi(),
            this.initializeUsersAndGroupsFromApi(),
            this.syncServerTime()             // Fase E3: precalentar árbitro temporal
        ]).then(() => {
            console.log("DataService initialization complete");
        }).catch(err => {
            console.error("DataService initialization failed", err);
        });

        this.progress = persistenceService.load('progress', []);
        this.reviews = persistenceService.load('reviews', []);
        this.bookmarks = persistenceService.load('bookmarks', []);
        this.communityPosts = persistenceService.load('communityPosts', []);
        this.products = persistenceService.load('products', []);
        this.storeOrders = persistenceService.load('storeOrders', []);
        // HOTFIX: Storage ignorado a propósito.
        this.groups = [];
        this.schools = [];
        this.assignments = persistenceService.load('assignments', []);
        this.pedagogicalStats = persistenceService.load('pedagogicalStats', []);
        this.journalEntries = persistenceService.load('journalEntries', []);
        // Phase 8
        const rawAttempts = persistenceService.load('oralityAttempts', []);
        this.oralityAttempts = Array.isArray(rawAttempts) ? rawAttempts : [];
        // Leo Pedagogical Layer
        const rawProfiles = persistenceService.load('leoReaderProfiles', []);
        this.leoReaderProfiles = Array.isArray(rawProfiles) ? rawProfiles : [];

        this.checkServerConnection();

        // Fase F: Restore failed-sync queue from localStorage (survives page reload).
        try {
            const rawFailed = localStorage.getItem(DataService.FAILED_SYNCS_KEY);
            if (rawFailed) {
                const obj = JSON.parse(rawFailed) as Record<string, FailedSyncEntry>;
                Object.entries(obj).forEach(([k, v]) => {
                    if (v?.userId && v?.contentId && v?.payload) {
                        this.failedSyncs.set(k, v);
                    }
                });
            }
        } catch { /* localStorage unavailable or corrupt — silent */ }

        // Fallback admin local-dev removido en 2026-04-26 official build.
        // Produccion usa unicamente usuarios reales sincronizados desde /api/users.
        
        this.startSyncEngine();
    }


    public waitForInitialization(): Promise<void> {
        return this.initializationPromise;
    }

    /**
     * v4.0.6 hotfix — race de inicialización auth → dataService.
     *
     * El singleton dataService construye en module-load (export const dataService = new DataService()),
     * antes de que AuthProvider monte. Si en ese momento no hay sesión en localStorage
     * (login fresh, post-logout, incógnito), initializeFromApi() + initializeUsersAndGroupsFromApi()
     * corren con adminWriteHeaders={} → backend v4.0.3+ responde 401 → caches quedan vacíos
     * (content, users, groups, schools). Sin manifest, VisorAlbum no encuentra el contenido
     * y el audio nunca se solicita.
     *
     * AuthContext debe llamar a este método después de setUser():
     *   - login() fresh
     *   - initAuth() restore path (defensive — si el constructor init falló por cualquier razón)
     *
     * No-op si no hay sesión activa (defensive: no spamea fetches sin headers).
     * Best-effort: errores se loggean pero no lanzan — los callers son flujos UI que no deben romperse.
     */
    public async refreshAuthenticatedState(): Promise<void> {
        if (!this.getSessionUserId()) return;
        try {
            await Promise.all([
                this.initializeFromApi(),
                this.initializeUsersAndGroupsFromApi(),
            ]);
            console.log('[refreshAuthenticatedState] post-auth rehidratation complete');
        } catch (e) {
            console.warn('[refreshAuthenticatedState] failed', (e as Error)?.message);
        }
    }


    // Default admin creation removed for production cleanup


    // --- SYNC ENGINE (Phase 3.4 / Fase F) ---
    private startSyncEngine() {
        if (typeof window !== 'undefined' && !this.syncInterval) {
            // Buffer flush every 15s
            this.syncInterval = setInterval(() => this.flushSync(), 15000);

            // Terminal flush on close or hide
            window.addEventListener('beforeunload', () => this.flushSync(true));
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this.flushSync(true);
                // Fase F: retry failed syncs when tab becomes visible again
                if (document.visibilityState === 'visible') this.retryFailedSyncs();
            });

            // Fase F: retry on network reconnect and tab focus
            window.addEventListener('online', () => this.retryFailedSyncs());
            window.addEventListener('focus', () => this.retryFailedSyncs());
        }
    }

    public forceFlush() {
        this.flushSync(true);
    }

    private flushSync(isTerminal = false) {
        // Fase F: drain failed-sync queue first (opportunistic — same send path).
        // Only on non-terminal flushes; terminal (unload) keepalive budget is scarce.
        if (!isTerminal) this.retryFailedSyncs();

        if (this.pendingSyncs.size === 0) return;

        this.pendingSyncs.forEach((prog, key) => {
            const { usuario_id, contenido_id, canonicalProgress, fecha_actualizacion, session } = prog;

            // Shape required by backend: { canonicalProgress: {...}, session: {...}, updatedAt: "..." }
            const syncPayload = {
                canonicalProgress,
                session,
                updatedAt: fecha_actualizacion
            };

            const hash = JSON.stringify(syncPayload);
            if (this.lastSyncedPayloads.get(key) === hash) return; // Deduplicate

            // keepalive: true survives page-unload; supports custom headers (unlike sendBeacon)
            fetch(`${this.apiUrl}/progress/${usuario_id}/${contenido_id}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-id': usuario_id },
                body: hash,
                keepalive: true
            }).then(res => {
                if (res.ok) {
                    // Success: mark as synced and remove from failed queue if present.
                    this.lastSyncedPayloads.set(key, hash);
                    if (this.failedSyncs.has(key)) {
                        this.failedSyncs.delete(key);
                        this.saveFailedSyncs();
                    }
                } else {
                    // Server returned error (4xx/5xx) — add to retry queue.
                    this.addToFailedSyncs(key, usuario_id, contenido_id, hash);
                }
            }).catch(() => {
                // Network failure — add to retry queue.
                this.addToFailedSyncs(key, usuario_id, contenido_id, hash);
            });

            // Optimistic mark — prevents the same payload being re-queued on the next interval
            // before the response arrives. If the fetch fails, addToFailedSyncs handles retry.
            this.lastSyncedPayloads.set(key, hash);
        });

        this.pendingSyncs.clear();
    }

    // Fase F helpers ────────────────────────────────────────────────────────────

    private addToFailedSyncs(key: string, userId: string, contentId: string, payload: string): void {
        // Overwrite any previous entry for this key — the new payload is always more recent.
        this.failedSyncs.set(key, { userId, contentId, payload, addedAt: new Date().toISOString() });
        // Cap at FAILED_SYNCS_MAX — evict the oldest entry when over limit.
        if (this.failedSyncs.size > DataService.FAILED_SYNCS_MAX) {
            const oldest = this.failedSyncs.keys().next().value;
            if (oldest) this.failedSyncs.delete(oldest);
        }
        this.saveFailedSyncs();
    }

    private retryFailedSyncs(): void {
        if (this.failedSyncs.size === 0) return;
        const cutoff = Date.now() - DataService.FAILED_SYNCS_TTL_MS;
        let pruned = false;

        this.failedSyncs.forEach((entry, key) => {
            const age = new Date(entry.addedAt).getTime();
            if (age < cutoff) {
                // Prune stale entries — progress this old is unlikely to be useful.
                this.failedSyncs.delete(key);
                pruned = true;
                return;
            }

            // Attempt retry — fire-and-forget with success/failure callbacks.
            fetch(`${this.apiUrl}/progress/${entry.userId}/${entry.contentId}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-id': entry.userId },
                body: entry.payload,
                keepalive: true
            }).then(res => {
                if (res.ok) {
                    this.failedSyncs.delete(key);
                    this.lastSyncedPayloads.set(key, entry.payload);
                    this.saveFailedSyncs();
                }
                // Non-ok response: stays in failedSyncs for next retry opportunity.
            }).catch(() => {
                // Network still down: stays in failedSyncs.
            });
        });

        if (pruned) this.saveFailedSyncs();
    }

    private saveFailedSyncs(): void {
        try {
            const obj: Record<string, FailedSyncEntry> = {};
            this.failedSyncs.forEach((v, k) => { obj[k] = v; });
            localStorage.setItem(DataService.FAILED_SYNCS_KEY, JSON.stringify(obj));
        } catch { /* QuotaExceededError — silent; retry on next opportunity */ }
    }


    private async checkServerConnection() {
        try {
            const res = await fetch(`${this.apiUrl}/health`).catch(() => null);
            if (!res || !res.ok) {
                console.warn('Backend server might be unreachable.');
            }
        } catch (e) {
            // silent ignore
        }
    }

    private async initializeFromApi() {
        try {
            // v4.0.5 hotfix: mismo motivo que initializeUsersAndGroupsFromApi —
            // sin headers, el GET-bypass cerrado en v4.0.3 retorna 401 y
            // this.content queda vacío → VisorAlbum no encuentra el manifest
            // del libro álbum → audio nunca se solicita.
            const response = await fetch(`${this.apiUrl}/content`, { headers: this.adminWriteHeaders });
            if (response.ok) {
                const apiContent = await response.json();
                if (Array.isArray(apiContent) && apiContent.length > 0) {
                    console.log('Loaded content from API:', apiContent.length, 'items');
                    // FILTER NULLS: Ensure every item is an object with an ID
                    this.content = apiContent.filter((c: any) => c && typeof c === 'object' && c.id);
                    // Optionally update localStorage to keep it in sync for offline
                    this.saveState('content', this.content);
                }
            }
        } catch (error) {
            console.warn('Could not load content from API (using local/mock):', error);
        }

        // Fase 7: Cargar bundles comerciales
        try {
            // v4.0.5 hotfix: defensivo — mismo patrón que /content.
            const res = await fetch(`${this.apiUrl}/bundles`, { headers: this.adminWriteHeaders });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) this.bundles = data;
            }
        } catch (e) {
            console.warn('Could not load bundles from API:', e);
        }
    }

    /**
     * normalizeGroupFrontend — Verificador ligero
     * El backend ya normaliza. Aquí solo garantizamos type y arrays mínimos
     * para proteger renders contra null/undefined.
     */
    public normalizeGroupFrontend = (group: any): Group => {
        if (!group) return group;
        const normalized = { ...group };

        // Garantizar type 'course' si es legacy
        if (!normalized.type) {
            normalized.type = 'course';
        }

        // Garantizar arrays mínimos — el backend es la fuente de verdad del contenido
        // Lectura defensiva legacy: si mediatorIds está vacío o ausente, intentar recuperar teacherId
        if (!Array.isArray(normalized.mediatorIds) || normalized.mediatorIds.length === 0) {
            normalized.mediatorIds = [normalized.teacherId].filter(Boolean);
        }
        if (!Array.isArray(normalized.memberIds)) normalized.memberIds = [];
        if (!Array.isArray(normalized.studentIds)) normalized.studentIds = [];

        return normalized as Group;
    }

    private async initializeUsersAndGroupsFromApi() {
        try {
            // USERS
            // v4.0.4 hotfix: el GET-bypass del backend fue cerrado en v4.0.3 →
            // este fetch sin headers devuelve 401 → this.users queda vacío.
            // adminWriteHeaders provee x-user-id del usuario logueado (resiliente
            // a no-sesión); el backend valida principal activo, no rol admin.
            const usersRes = await fetch(`${this.apiUrl}/users`, { headers: this.adminWriteHeaders });
            if (usersRes.ok) {
                const rawUsers: any[] = await usersRes.json();
                if (Array.isArray(rawUsers)) {
                    // HOTFIX: Disable naive merge. API is absolute Source of Truth for Users.
                    this.users = rawUsers.filter(u => u && u.id) as User[];
                    
                    // Cleanup legacy bulky cache to solve QuotaExceededError
                    persistenceService.clear('users');
                    
                    console.log('Loaded clean users from API:', this.users.length);
                }
            }

            // GROUPS
            const groupsRes = await fetch(`${this.apiUrl}/groups`, { headers: this.adminWriteHeaders });
            if (groupsRes.ok) {
                const apiGroups: Group[] = await groupsRes.json();
                if (Array.isArray(apiGroups)) {
                    // HOTFIX: API is absolute Source of Truth for Groups.
                    // Fase Modelo Extendido: Normalizar al ingresar al frontend
                    this.groups = apiGroups.map(this.normalizeGroupFrontend);
                    
                    // Cleanup legacy bulky cache
                    persistenceService.clear('groups');
                    
                    console.log('Loaded clean groups from API:', this.groups.length);
                }
            }

            // SCHOOLS
            const schoolsRes = await fetch(`${this.apiUrl}/schools`, { headers: this.adminWriteHeaders });
            if (schoolsRes.ok) {
                const apiSchools: School[] = await schoolsRes.json();
                if (Array.isArray(apiSchools)) {
                    // HOTFIX: API is absolute Source of Truth for Schools.
                    this.schools = apiSchools;
                    
                    // Cleanup legacy bulky cache
                    persistenceService.clear('schools');
                }
            }

            // --- PRECALENTAMIENTO DE CACHÉ ORGANIZACIONAL (Fase 6B) ---
            // Extraemos todos los nombres de colegios únicos de schools y users para tener el mapa completo
            const uniqueSchools = new Set<string>();
            this.schools.forEach(s => { if (s.name) uniqueSchools.add(s.name); });
            this.users.forEach(u => { if (u.colegio) uniqueSchools.add(u.colegio); });
            
            // Hidratamos en paralelo todas las configuraciones aprovechando que getSchoolConfig actualiza el caché interno
            await Promise.allSettled(
                Array.from(uniqueSchools).map(schoolName => this.getSchoolConfig(schoolName))
            );
            
        } catch (error) {
            console.warn('Could not load users/groups/schools from API (Offline mode?):', error);
        }
    }

    /**
     * Sprint 022 Fase 2A.2 — refetch puntual y minimalista de USERS.
     *
     * Diseñado para resolver el residual operacional de stale UI (ver
     * USERS_CACHE_RISK documentado en sprints previos). NO se llama
     * automáticamente en cada mutación — es escotilla disponible para
     * componentes que necesiten freshness garantizado en momentos
     * concretos:
     *   - AulaViva.tsx al mount del panel (Caso CRÍTICO 1).
     *   - AdminUsuarios.tsx al abrir form de edición (Caso CRÍTICO 2).
     *
     * Reglas:
     *   - Solo refetcha USERS. No toca groups/schools — ya están frescos
     *     vía savedGroup (updateGroup) y vía hidratación inicial.
     *   - Reemplaza this.users completo desde el endpoint (server truth).
     *   - Log `[USERS_CACHE_REFRESH]` solo si efectivamente reemplazó —
     *     en error se loggea como warn aparte sin reemplazar.
     *   - try/catch defensivo: si la red falla, devuelve el cache actual
     *     y deja un warn. NO lanza — los callers son flujos UI que no
     *     deben romperse por un refetch.
     */
    async reloadUsers(): Promise<User[]> {
        try {
            // v4.0.4 hotfix: mismo motivo que initializeUsersAndGroupsFromApi —
            // sin headers, el GET-bypass cerrado en v4.0.3 retorna 401.
            const res = await fetch(`${this.apiUrl}/users`, { headers: this.adminWriteHeaders });
            if (!res.ok) {
                console.warn(`[USERS_CACHE_REFRESH] failed status=${res.status}`);
                return this.users;
            }
            const raw: any[] = await res.json();
            if (!Array.isArray(raw)) {
                console.warn('[USERS_CACHE_REFRESH] failed reason=non_array_payload');
                return this.users;
            }
            const fresh = raw.filter(u => u && u.id) as User[];
            const prevCount = this.users.length;
            this.users = fresh;
            this.saveState('users', this.users);
            console.log(`[USERS_CACHE_REFRESH] op=reloadUsers prev=${prevCount} now=${fresh.length}`);
            return this.users;
        } catch (e) {
            console.warn('[USERS_CACHE_REFRESH] failed reason=network', (e as Error).message);
            return this.users;
        }
    }

    // --- SYNC METHODS ---
    async syncUserProgress(userId: string) {
        try {
            const res = await fetch(`${this.apiUrl}/progress/user/${userId}`, { headers: { 'x-user-id': userId } });
            if (res.ok) {
                const data = await res.json();
                const apiProgress = data.progressList || [];
                
                if (Array.isArray(apiProgress)) {
                    const merged = [...this.progress];

                    apiProgress.forEach((remote: any) => {
                        const idx = merged.findIndex(local => local.contenido_id === remote.contentId && local.usuario_id === userId);
                        
                        // Map new robust canonical structure back to local ProgresoLectura
                        const mappedProgress: ProgresoLectura = {
                            id: remote.id,
                            usuario_id: remote.userId,
                            contenido_id: remote.contentId,
                            porcentaje: remote.canonicalProgress?.globalPercentage || 0,
                            ultima_posicion: remote.canonicalProgress?.sentenceIndex?.toString() || "0",
                            fecha_actualizacion: remote.updatedAt,
                            last_device_mode: remote.canonicalProgress?.lastInteractedMode,
                            canonicalProgress: remote.canonicalProgress
                        };

                        if (idx >= 0) {
                            // Enforce Last-Write-Wins based on updatedAt
                            const localDate = new Date(merged[idx].fecha_actualizacion || 0).getTime();
                            const remoteDate = new Date(remote.updatedAt || 0).getTime();
                            if (remoteDate > localDate) {
                                merged[idx] = mappedProgress;
                            }
                        } else {
                            merged.push(mappedProgress);
                        }
                    });

                    this.progress = merged;
                    this.saveState('progress', this.progress);
                    console.log(`[Sync] Synced ${apiProgress.length} progress entries from canonical server.`);
                }
            }
        } catch (e) {
            console.warn('[Sync] Failed to sync progress:', e);
        }
    }

    // --- API UPLOAD METHODS ---
    /**
     * Sube un archivo al backend y devuelve la URL pública resultante.
     *
     * Implementación con XMLHttpRequest (no fetch) por una razón concreta:
     * fetch NO expone progreso real de upload. El stream de subida
     * desaparece para el cliente hasta que el servidor responde — para
     * un asset editorial de varios cientos de MB eso significa ver el
     * formulario "congelado" sin feedback durante minutos. XHR sí emite
     * `progress` events sobre `xhr.upload`, lo que permite renderizar
     * porcentaje real mientras los bytes salen.
     *
     * `onProgress` es opcional para no romper consumidores existentes.
     * Si se provee, se invoca con un número entre 0 y 1 cada vez que el
     * navegador emite un progress event (típicamente cada ~50-100 ms en
     * conexiones reales). Cuando todos los bytes han salido pero el
     * servidor aún está validando/hashing, el callback queda en 1 — el
     * caller debe mostrar un estado de "Procesando" hasta que la promesa
     * resuelva.
     */
    async uploadFile(
        file: File,
        parentId?: string,
        onProgress?: (fraction: number) => void,
    ): Promise<string> {
        const formData = new FormData();
        if (parentId) {
            formData.append('parentId', parentId);
        }
        formData.append('file', file);

        const url = parentId
            ? `${this.apiUrl}/upload?parentId=${encodeURIComponent(parentId)}`
            : `${this.apiUrl}/upload`;
        const uploadUserId = this.getSessionUserId();

        return new Promise<string>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.setRequestHeader('x-user-id', uploadUserId);

            if (onProgress && xhr.upload) {
                xhr.upload.addEventListener('progress', (ev) => {
                    if (ev.lengthComputable && ev.total > 0) {
                        const frac = Math.min(1, ev.loaded / ev.total);
                        onProgress(frac);
                    }
                });
                // Cuando el último byte ya salió pero el servidor sigue
                // procesando (validación binaria, hash, dedup, mover a
                // destino final), avisamos 1.0 para que el UI cambie a
                // "Procesando" en lugar de quedarse a 99 %.
                xhr.upload.addEventListener('load', () => onProgress(1));
            }

            xhr.addEventListener('load', () => {
                // xhr.status === 0 ocurre típicamente cuando el navegador
                // aborta por bloqueo CORS, pérdida de red o tab cerrada
                // mid-flight. Lo tratamos como error de red explícito.
                if (xhr.status === 0) {
                    reject(new Error('Network error: la subida fue interrumpida.'));
                    return;
                }
                let data: { url?: string; error?: string } = {};
                try {
                    data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
                } catch {
                    // Servidor devolvió HTML de error (ej. 502 de nginx)
                    // o JSON inválido. Conservamos el cuerpo para que el
                    // mensaje al usuario sea informativo.
                    data = { error: xhr.responseText || `HTTP ${xhr.status}` };
                }
                if (xhr.status >= 200 && xhr.status < 300 && data.url) {
                    resolve(data.url);
                } else {
                    reject(new Error(data.error || `Upload failed (HTTP ${xhr.status})`));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error durante la subida.'));
            });
            xhr.addEventListener('abort', () => {
                reject(new Error('Subida cancelada.'));
            });
            xhr.addEventListener('timeout', () => {
                reject(new Error('La subida superó el tiempo máximo de espera.'));
            });

            xhr.send(formData);
        });
    }

    // W1: Best-effort orphan cleanup. Called from SubirContenido when metadata save fails
    // after files were already uploaded. Fire-and-forget — failures are silently ignored.
    async purgeOrphanFile(url: string): Promise<void> {
        try {
            const purgeUserId = this.getSessionUserId();
            await fetch(`${this.apiUrl}/upload/purge`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': purgeUserId,
                },
                body: JSON.stringify({ url })
            });
        } catch (_e) {
            // Best-effort only — never throw from cleanup paths
        }
    }

    // --- Phase 8: Oral Reading Persistence ---

    saveOralityAttempt(attempt: OralityAttempt): void {
        this.oralityAttempts.push(attempt);
        persistenceService.save('oralityAttempts', this.oralityAttempts);
    }

    getOralityHistory(userId: string, contentId?: string): OralityAttempt[] {
        return this.oralityAttempts
            .filter(a => a.userId === userId && (!contentId || a.contentId === contentId))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    async saveContentToApi(contentItem: Content): Promise<void> {
        const saveUserId = this.getSessionUserId();
        const response = await fetch(`${this.apiUrl}/content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-id': saveUserId,
            },
            body: JSON.stringify(contentItem)
        });

        if (!response.ok) {
            // Expose the server's error body so callers can surface it to the UI.
            // Previously swallowed a 400 "Faltan campos obligatorios" as a generic message.
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || `Error ${response.status} al guardar metadata`);
        }

        // Update local state immediately
        this.agregarContenido(contentItem);
    }

    async deleteContent(id: string): Promise<void> {
        const deleteUserId = this.getSessionUserId();
        const response = await fetch(`${this.apiUrl}/content/${id}`, {
            method: 'DELETE',
            headers: {
                'x-user-id': deleteUserId,
            }
        });

        if (!response.ok) {
            throw new Error('Failed to delete content');
        }

        // Update local state
        this.content = this.content.filter(c => c.id !== id);
        this.saveState('content', this.content);
    }

    async retryContent(id: string): Promise<Content> {
        const retryUserId = this.getSessionUserId();
        const response = await fetch(`${this.apiUrl}/content/${id}/retry`, {
            method: 'POST',
            headers: {
                'x-user-id': retryUserId,
            }
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to retry content');
        }

        const data = await response.json();
        // Update local state
        const idx = this.content.findIndex(c => c.id === id);
        if (idx > -1) {
            this.content[idx] = data.content;
            this.saveState('content', this.content);
        }
        return data.content;
    }

    private saveState(key: string, data: any) {
        // HOTFIX: Disable local caching for bulky arrays that are synced with API to prevent QuotaExceededError
        if (key === 'users' || key === 'groups' || key === 'schools') {
            return;
        }
        persistenceService.save(key, data);
    }

    // User
    getUsuarioById(id: string): User | undefined {
        return this.users.find(u => u.id === id);
    }

    getUsuarioByEmail(email: string): User | undefined {
        return this.users.find(u => u.email === email);
    }

    async validarCredenciales(email: string, password?: string): Promise<User | undefined> {
        // God Mode: solo activo en desarrollo local, nunca en producción
        if (import.meta.env.DEV && email === 'admin@chibalete.com' && password === 'chibalete123') {
            return this.users.find(u => u.email === 'admin@chibalete.com');
        }

        // 1. Try SERVER Auth first
        try {
            const res = await fetch(`${this.apiUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    return data.user;
                }
            } else if (res.status === 401) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Credenciales inválidas');
            } else if (res.status === 429) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Demasiados intentos. Intenta nuevamente en 15 minutos.');
            } else {
                throw new Error(`Error del servidor (${res.status})`);
            }
        } catch (e: any) {
            // Re-throw errors with known meaning (401, 429, server errors)
            if (e.message && !e.message.startsWith('Failed to fetch') && !e.message.includes('NetworkError')) {
                throw e;
            }
            // Network failure: throw descriptive error
            throw new Error('Sin conexión con el servidor. Verifica tu red.');
        }

        // Fallback unreachable when server responds, kept only as type guard
        return undefined;
    }

    async crearUsuariosMasivos(newUsers: any[]): Promise<{ created: number; duplicates: number; errors: ImportRowError[] }> {
        const errors: ImportRowError[] = [];
        let created = 0;
        let duplicates = 0;

        // Procesar de a uno con await para evitar escrituras concurrentes en users_db.json
        for (const u of newUsers) {
            try {
                // DT-05: 'profesor' eliminado del modelo. Safety net: mapear → 'mediador' si llega de CSV legacy.
                let roles: ('lector' | 'mediador' | 'administrador')[] = ['lector'];
                if (u.roles && Array.isArray(u.roles)) {
                    roles = u.roles;
                } else if (typeof u.role === 'string') {
                    const r = u.role.toLowerCase().trim();
                    roles = (r === 'mediador' || r === 'profesor') ? ['mediador'] : ['lector'];
                }

                // SUBFASE 3.2: Pasar mediatorKind si viene del CSV y es válido
                const VALID_MK = ['teacher', 'librarian', 'coordinator', 'parent'] as const;
                const mkRaw = typeof u.mediatorKind === 'string' ? u.mediatorKind.trim() : undefined;
                const mediatorKind = mkRaw && (VALID_MK as readonly string[]).includes(mkRaw)
                    ? mkRaw as 'teacher' | 'librarian' | 'coordinator' | 'parent'
                    : undefined;

                // Normaliza colegio del CSV contra schools_db (case-insensitive + trim).
                // Si una escuela existe con la misma cadena en otra capitalizacion, usar su nombre canonico
                // y evitar que se cree un grupo con casing distinto al de la escuela.
                const csvColegio = (u.colegio || '').trim();
                const matchedSchool = this.schools.find(s =>
                    (s.name || '').trim().toLowerCase() === csvColegio.toLowerCase()
                );
                const canonicalColegio = matchedSchool ? matchedSchool.name : csvColegio;

                // Sprint 022 Fase B — flujo saneado del bulk import.
                //
                // ORDEN ANTERIOR:
                //   1. createUser (sin groupIds) → backend depende del
                //      fallback colegio→single-group; falla en escuelas
                //      multi-grupo con AMBIGUOUS_GROUP antes del paso 2.
                //   2. Buscar/crear targetGroup.
                //   3. Mutar targetGroup.studentIds.push + memberIds = ...
                //   4. await updateGroup(targetGroup, ...)
                //   5. Mutar newUserObj.groupIds.push
                //   6. await updateUser({ groupIds: ... })
                //   → 5 operaciones de escritura por estudiante,
                //     mutaciones locales pre-PUT, regla cliente
                //     destructive-replace para mediatorIds, ventana
                //     de inconsistencia entre PUTs.
                //
                // ORDEN ACTUAL:
                //   1. Resolver/crear targetGroup (si CSV trae colegio+curso).
                //   2. createUser con groupIds explícito (lectores) →
                //      el backend hace addUserIdToGroup atómico bidireccional
                //      en el mismo POST. Cero cascada cliente.
                //   3. Solo para mediadores: updateGroup({mediatorIds: [...]})
                //      → única vía sin endpoint /mediators dedicado;
                //      es UN PUT atómico, sin cascada local.
                //   → 1 escritura para lectores, 2 para mediadores.

                const isTeacher = roles.includes('mediador') || roles.includes('administrador');

                // 1. Resolver/crear targetGroup ANTES de createUser.
                let targetGroup: Group | undefined;
                const gradeName  = (u.curso || '').trim();
                const schoolName = canonicalColegio.trim();
                if (schoolName && gradeName) {
                    targetGroup = this.groups.find(g =>
                        g.school && g.grade &&
                        g.school.toLowerCase() === schoolName.toLowerCase() &&
                        g.grade.toLowerCase() === gradeName.toLowerCase()
                    );
                    if (!targetGroup) {
                        try {
                            targetGroup = await this.createGroup({
                                name: `${gradeName} - ${schoolName}`,
                                school: schoolName,
                                grade: gradeName,
                            });
                        } catch (err) {
                            console.warn('[BULK_IMPORT] Error al auto-crear grupo', err);
                        }
                    }
                }

                // 2. createUser con groupIds upfront para lectores.
                //    Para mediadores NO se pasa groupIds: el backend
                //    addUserIdToGroup pondría al mediador en
                //    studentIds/memberIds — incorrecto. Los mediadores
                //    se vinculan vía mediatorIds en el paso 3.
                const newUserObj = await this.createUser({
                    nombre_completo: (u.nombre_completo || u.nombre || '').trim(),
                    email: (u.email || '').trim().toLowerCase(),
                    password: u.password || 'chibalete123',
                    colegio: canonicalColegio,
                    curso: (u.curso || '').trim(),
                    roles,
                    ...(mediatorKind ? { mediatorKind } : {}),
                    ...(targetGroup && !isTeacher ? { groupIds: [targetGroup.id] } : {}),
                });

                // 3. Para mediadores con grupo: una sola llamada atómica
                //    a updateGroup({mediatorIds}). El backend
                //    applyGroupMembersChange escribe la bidireccional.
                //    Preserva la semántica destructive-replace del bulk
                //    import histórico (mediatorIds = [newUserObj.id]) —
                //    cambiarla queda fuera del scope de este sprint.
                if (isTeacher && targetGroup) {
                    const currentMediators = Array.isArray(targetGroup.mediatorIds)
                        ? targetGroup.mediatorIds
                        : [];
                    if (!currentMediators.includes(newUserObj.id)) {
                        await this.updateGroup(targetGroup.id, { mediatorIds: [newUserObj.id] });
                    }
                }

                created++;
            } catch (e: any) {
                const isDuplicate = e.message && e.message.includes('El usuario ya existe');
                if (isDuplicate) {
                    duplicates++;
                } else {
                    errors.push({
                        row: u._rowNum || 0,
                        email: u.email || 'N/A',
                        reason: e.message || 'Error desconocido'
                    });
                }
            }
        }

        return { created, duplicates, errors };
    }

    // --- SINGLE USER MANAGEMENT ---
    async createUser(userData: Partial<User>): Promise<User> {
        // Sprint 022 Fase B — propagar groupIds y mediatorKind al body POST.
        // El backend POST /api/users ya hace bidireccional atómico cuando
        // groupIds viene poblado: addUserIdToGroup para cada gid dentro del
        // lock anidado (groupsLock outer, usersLock inner). Pasar groupIds
        // explícito evita depender del fallback `colegio→single-group school`,
        // que falla en escuelas multi-grupo con AMBIGUOUS_GROUP.
        const newUser: User = {
            id: userData.id || `user-${Date.now()}`,
            nombre_usuario: userData.nombre_usuario || userData.email?.split('@')[0] || 'usuario',
            nombre_completo: userData.nombre_completo || 'Nuevo Usuario',
            email: userData.email || '',
            password: userData.password || 'chibalete123',
            colegio: userData.colegio,
            curso: userData.curso,
            avatar_url: userData.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.nombre_completo || 'U')}&background=random`,
            bio_corta: userData.bio_corta || 'Usuario nuevo',
            libros_leidos: 0,
            seguidores: 0,
            seguidos: 0,
            nivel_lectura: userData.nivel_lectura || 'Novato',
            roles: userData.roles || ['lector'],
            social_connections: { facebook: false, instagram: false, linkedin: false },
            // groupIds/mediatorKind: solo se incluyen si el caller los aportó.
            // Para back-compat con callers que no los pasan, NO se inventan
            // arrays vacíos por default — eso podría disparar el guard
            // GROUP_REQUIRED del backend para lectores sin colegio resoluble.
            ...(userData.groupIds  !== undefined ? { groupIds:  userData.groupIds }  : {}),
            ...(userData.mediatorKind         ? { mediatorKind: userData.mediatorKind } : {}),
        };

        // SYNC TO BACKEND FIRST
        const response = await fetch(`${this.apiUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(newUser)
        });

        if (!response.ok) {
            if (response.status === 409) {
                throw new Error('El usuario ya existe (Email o ID duplicado).');
            }
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to create user on server');
        }

        // Server truth: el backend devuelve el user normalizado vía
        // sanitizeUserForClient (sin password) + groupIds resueltos por el
        // POST handler (incluye fallback colegio → single-group school si
        // no se pasó groupIds explícito). Hidratar `this.users` desde la
        // respuesta evita guardar una versión cliente con groupIds vacío
        // cuando el backend efectivamente sí lo resolvió.
        const savedUser: User = await response.json();
        this.users.push(savedUser);
        this.saveState('users', this.users);

        return savedUser;
    }

    async updateUser(id: string, updates: Partial<User>) {
        const response = await fetch(`${this.apiUrl}/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            console.error('Failed to update user on server');
            throw new Error('Failed to update user on server');
        }

        const idx = this.users.findIndex(u => u.id === id);
        if (idx > -1) {
            // Fetch updated user from response to match server state
            const updatedUser = await response.json();
            this.users[idx] = updatedUser;
            this.saveState('users', this.users);
        }
    }

    async deleteUser(id: string) {
        const response = await fetch(`${this.apiUrl}/users/${id}`, {
            method: 'DELETE',
            headers: { ...this.adminWriteHeaders }
        });

        if (!response.ok) {
            throw new Error('Failed to delete user on server');
        }

        const idx = this.users.findIndex(u => u.id === id);
        if (idx > -1) {
            this.users.splice(idx, 1);
            this.saveState('users', this.users);
        }

        // Sprint 022 Fase 2A.1 — coherencia local en this.groups.
        // El backend ejecuta `detachUserFromAllGroups(groups, id)` dentro de
        // su lock anidado. Replicamos lo mismo en cliente con la primitiva
        // pura `removeUserIdFromGroup` para que `this.groups[*].memberIds`
        // y `this.groups[*].studentIds` no queden con IDs huérfanos
        // apuntando al user borrado. Es el espejo exacto del backend, sin
        // reglas nuevas.
        let touched = 0;
        for (const g of this.groups) {
            if (removeUserIdFromGroup(g as any, id)) touched++;
        }
        if (touched > 0) {
            this.saveState('groups', this.groups);
            console.log(`[GROUPS_CACHE_REFRESH] op=deleteUser userId=${id} affectedGroups=${touched}`);
        }
    }

    // --- SCHOOL MANAGEMENT ---
    renameSchool(oldName: string, newName: string) {
        // This is complex because it updates many records. 
        // Ideally backend should handle this, but our backend is simple.
        // We will just iterate and update individually for now (inefficient but works for small scale).

        let batchUpdatePromises: Promise<any>[] = [];

        // Update all users in this school
        this.users.forEach(u => {
            if (u.colegio === oldName) {
                u.colegio = newName;
                batchUpdatePromises.push(
                    fetch(`${this.apiUrl}/users/${u.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
                        body: JSON.stringify(u)
                    })
                );
            }
        });
        this.saveState('users', this.users);

        // Update all groups in this school
        this.groups.forEach(g => {
            if (g.school === oldName) {
                g.school = newName;
                batchUpdatePromises.push(
                    fetch(`${this.apiUrl}/groups/${g.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
                        body: JSON.stringify(g)
                    })
                );
            }
        });
        this.saveState('groups', this.groups);

        Promise.all(batchUpdatePromises).catch(e => console.error('Failed to sync renameSchool', e));
    }


    // --- SCHOOL & GROUP MANAGEMENT ---
    getColegios(): string[] {
        // 1. Escanear usuarios buscando colegios heredados, filtrando valores basura (bugs de CSV viejo)
        const legacyNames = this.users
            .map(u => u.colegio)
            .filter(name => {
                if (!name) return false;
                if (name.length < 4) return false; // Muy corto para ser colegio real
                // Patrón heurístico: descartar strings que parezcan contraseñas obvias (ej: numeros + simbolos)
                if (name.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/) && !name.toLowerCase().includes('colegio') && !name.toLowerCase().includes('escuela')) return false;
                if (name.match(/[0-9]{3,}/) && !name.toLowerCase().includes('colegio')) return false; 
                return true;
            }) as string[];
            
        // 2. Colegios oficiales persistidos (nuevo flujo)
        const officialNames = this.schools.map(s => s.name);
        
        return Array.from(new Set([...officialNames, ...legacyNames]));
    }

    async createSchool(name: string): Promise<School> {
        const response = await fetch(`${this.apiUrl}/schools`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify({ name })
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'No se pudo crear el colegio en el servidor');
        }
        
        const newSchool = await response.json();
        this.schools.push(newSchool);
        this.saveState('schools', this.schools);
        return newSchool;
    }

    getUsuariosByColegio(colegio: string): User[] {
        return this.users.filter(u => u.colegio === colegio);
    }

    getAllUsuarios(): User[] {
        return this.users;
    }

    getGroupsByColegio(colegio: string): Group[] {
        return this.groups.filter(g => g.school === colegio);
    }

    // --- LEO COMPATIBILITY LAYER (Phase 2) ---
    getGroupMediatorIds(group: Group): string[] {
        // Backend es fuente de verdad; solo garantizar que devolvemos un array
        return Array.isArray(group.mediatorIds) ? group.mediatorIds : [];
    }

    getGroupMemberIds(group: Group): string[] {
        // Devuelve el array CRUDO de memberIds del grupo. Intencionalmente
        // narrow: usado por updateGroup() para calcular el diff exacto de
        // cambios persistidos. Aplicar acá getGroupMembers (con fallback)
        // inflaría el delta con miembros resueltos vía colegio que nunca
        // estuvieron en el snapshot persistido.
        // Para resolver "quién es miembro" de cara al usuario, usar
        // getGroupStudents (que sí pasa por la fuente única de verdad).
        return Array.isArray(group.memberIds) ? group.memberIds : [];
    }

    getUserGroups(userId: string): Group[] {
        // Devuelve los grupos donde el user aparece en memberIds explícitos
        // O donde user.groupIds apunta al grupo. NO aplica fallback colegio
        // por la misma razón que getGroupMemberIds: este resultado se usa
        // para flujos UI donde mostrar memberships fantasma sería confuso.
        // Para calcular conteos pedagógicos canónicos usar getGroupStudents.
        const fromMembers = this.groups.filter(g =>
            Array.isArray(g.memberIds) && g.memberIds.includes(userId)
        );
        const canonicalIds = new Set(fromMembers.map(g => g.id));
        const user = this.getUsuarioById(userId);
        const extra = (user?.groupIds ?? [])
            .map(gid => this.groups.find(g => g.id === gid))
            .filter((g): g is Group => !!g && !canonicalIds.has(g.id));
        return [...fromMembers, ...extra];
    }

    getAllGroups(): Group[] {
        return this.groups;
    }

    async createGroup(groupData: Omit<Group, 'id' | 'studentIds'>) {
        const newGroup: Group = {
            ...groupData,
            id: `group-${Date.now()}`,
            type: groupData.type || 'course',
            studentIds: groupData.memberIds || [],
            memberIds: groupData.memberIds || [],
            mediatorIds: groupData.mediatorIds || []   // mediatorIds es el campo canónico
        };

        // SYNC TO BACKEND
        const response = await fetch(`${this.apiUrl}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(newGroup)
        });

        if (!response.ok) {
            if (response.status === 409) {
                throw new Error('El Grupo ya existe.');
            }
            throw new Error('Failed to create group on server');
        }

        // Usar la respuesta normalizada del servidor
        const savedGroup = await response.json();
        const finalGroup = this.normalizeGroupFrontend(savedGroup);

        this.groups.push(finalGroup);
        this.saveState('groups', this.groups);

        return finalGroup;
    }

    async joinOpenClub(groupId: string, userId: string): Promise<Group> {
        const response = await fetch(`${this.apiUrl}/groups/${groupId}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-id': userId
            }
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error((err as any).error || 'No se pudo unir al club');
        }

        const updatedGroup = await response.json();
        const normalized = this.normalizeGroupFrontend(updatedGroup);
        const idx = this.groups.findIndex(g => g.id === groupId);
        if (idx !== -1) {
            this.groups[idx] = normalized;
        } else {
            this.groups.push(normalized);
        }
        this.saveState('groups', this.groups);
        // Invalidate access cache so next content check reflects new membership immediately.
        delete this.userContentAccessCache[userId];
        return normalized;
    }

    async updateGroup(id: string, updates: Partial<Group>) {
        // mediatorIds es el campo canónico. Derivar teacherId para compat backend.
        if (updates.mediatorIds !== undefined) {
            updates.teacherId = updates.mediatorIds[0] ?? null;
        }

        // Mantener studentIds sincronizado con memberIds (compat backend) —
        // afecta SOLO al payload del PUT, no al cache local.
        if (updates.studentIds !== undefined && !updates.memberIds) {
            updates.memberIds = updates.studentIds;
        } else if (updates.memberIds !== undefined && updates.studentIds === undefined) {
            updates.studentIds = updates.memberIds;
        }

        // Sprint 022 Fase 2A.1 — capturar el estado PREVIO del grupo en cache
        // ANTES del PUT. Solo guardamos los campos que necesitamos para el
        // diff (studentIds + memberIds) — no tocamos referencias.
        const prevSnapshot = this.groups.find(g => g.id === id);
        const prevMembers = prevSnapshot ? unionGroupMemberIds(prevSnapshot as any) : [];

        // Sprint 022 Fase B — eliminada la cascada manual de membresías.
        //
        // Antes (Sprint 021 y previo): este método calculaba un diff
        // addedUsers/removedUsers, hacía el PUT al grupo, y luego recorría
        // ambos arrays disparando `updateUser({groupIds})` por cada user
        // afectado. Esa cascada duplicaba exactamente lo que el backend
        // ya hacía en `PUT /api/groups/:id` con `applyGroupMembersChange`
        // dentro de su lock anidado atómico (groupsLock outer, usersLock
        // inner). Resultado: N round trips redundantes + ventana entre el
        // PUT del grupo (atómico) y los PUTs de users (no-atómicos entre
        // sí) donde this.groups y this.users podían quedar inconsistentes
        // con el backend si la red fallaba a mitad. Adicionalmente la
        // cascada aplicaba una regla EXTRA en cliente (la condicional
        // "solo remover si ya no es mediador ni miembro") que el backend
        // NO conoce, abriendo una divergencia silenciosa de la fuente de
        // verdad.
        //
        // Ahora: el PUT al backend es la única operación de escritura.
        // El cache local de groups se refresca con `savedGroup` (server
        // truth). El backend escribe atómicamente las dos capas — ya no
        // hace falta hacerlo desde acá.
        const response = await fetch(`${this.apiUrl}/groups/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            throw new Error('Failed to update group on server');
        }

        // Server truth: backend ya aplicó el diff bidireccional vía
        // `applyGroupMembersChange` y devuelve el grupo normalizado.
        const savedGroup = await response.json();
        const finalGroup = this.normalizeGroupFrontend(savedGroup);

        const idx = this.groups.findIndex(g => g.id === id);
        if (idx > -1) {
            this.groups[idx] = finalGroup;
        } else {
            this.groups.push(finalGroup);
        }
        this.saveState('groups', this.groups);

        // Sprint 022 Fase 2A.1 — coherencia local mínima de this.users.
        //
        // El backend `PUT /api/groups/:id` aplica internamente
        // `applyGroupMembersChange(users, id, added, removed)` con added/removed
        // calculados desde `unionGroupMemberIds(prev)` vs
        // `unionGroupMemberIds(merged)`. Eso significa:
        //   - El backend escribe `user.groupIds` SOLO para users en el diff
        //     de studentIds+memberIds.
        //   - El backend NO escribe `user.groupIds` cuando cambia mediatorIds
        //     (unionGroupMemberIds NO incluye mediatorIds).
        //
        // Replicamos ese MISMO subconjunto en cliente, calculando el diff
        // entre `prevSnapshot` (lo que teníamos) y `finalGroup` (lo que el
        // backend efectivamente persistió, NO lo que enviamos en `updates`).
        // Esto garantiza:
        //   - Cero divergencia: aplicamos las MISMAS primitivas que el
        //     backend aplicó, sobre los MISMOS IDs que el backend tocó.
        //   - Cero invención de reglas: no decidimos membresías; reflejamos
        //     server truth.
        //   - Cero round trips extra.
        //
        // Si un uid del diff no existe en this.users (cache desactualizado
        // por race con otra ventana), se omite silenciosamente — el next
        // refresh global lo hidratará.
        const newMembers = unionGroupMemberIds(finalGroup as any);
        const { added, removed } = diffIds(prevMembers, newMembers);

        let touchedAdded = 0;
        let touchedRemoved = 0;
        for (const uid of added) {
            const u = this.users.find(x => x.id === uid);
            if (u && addGroupIdToUser(u as any, id)) touchedAdded++;
        }
        for (const uid of removed) {
            const u = this.users.find(x => x.id === uid);
            if (u && removeGroupIdFromUser(u as any, id)) touchedRemoved++;
        }
        const touched = touchedAdded + touchedRemoved;
        if (touched > 0) {
            this.saveState('users', this.users);
            console.log(`[USERS_CACHE_REFRESH] op=updateGroup groupId=${id} added=${touchedAdded} removed=${touchedRemoved}`);
        }
    }

    async deleteGroup(id: string) {
        const response = await fetch(`${this.apiUrl}/groups/${id}`, {
            method: 'DELETE',
            headers: { ...this.adminWriteHeaders }
        });

        if (!response.ok) {
            throw new Error('Failed to delete group on server');
        }

        const idx = this.groups.findIndex(g => g.id === id);
        if (idx > -1) {
            this.groups.splice(idx, 1);
            this.saveState('groups', this.groups);
        }

        // Sprint 022 Fase 2A.1 — coherencia local en this.users.
        // El backend ejecuta `detachGroupFromAllUsers(users, id)` dentro de
        // su lock anidado. Replicamos lo mismo en cliente con la primitiva
        // pura `removeGroupIdFromUser` para que `this.users[*].groupIds`
        // no quede con groupIds huérfanos apuntando al grupo borrado.
        let touched = 0;
        for (const u of this.users) {
            if (removeGroupIdFromUser(u as any, id)) touched++;
        }
        if (touched > 0) {
            this.saveState('users', this.users);
            console.log(`[USERS_CACHE_REFRESH] op=deleteGroup groupId=${id} affectedUsers=${touched}`);
        }
    }

    /**
     * Sprint 022 Fase B — wrapper delgado sobre `updateGroup({mediatorIds})`.
     *
     * Antes (Sprint 021 y previo):
     *   1. mutaba `group.mediatorIds` y `group.teacherId` en cache local
     *      antes del PUT,
     *   2. llamaba `saveState('groups')` premature (persistía el cache
     *      antes de que el backend confirmara),
     *   3. disparaba un `updateUser({groupIds})` para vincular al nuevo
     *      mediador (cascada redundante con backend),
     *   4. evaluaba una condicional cliente-only `!isStillMediating &&
     *      !isStudent` y disparaba otro `updateUser({groupIds})` para
     *      desvincular al saliente (regla que el backend NO aplicaba —
     *      divergencia silenciosa de la fuente de verdad),
     *   5. y solo entonces llamaba al `updateGroup(groupId, {mediatorIds})`
     *      que en realidad hacía toda la escritura atómica.
     *
     *   Pasos 1-4 duplicaban lo que `applyGroupMembersChange` ya hace en
     *   el PUT con su diff bidireccional dentro del lock anidado.
     *
     * Ahora:
     *   El único "trabajo" del método es construir el array canónico de
     *   `mediatorIds` con `teacherId` como primary y delegar al
     *   `updateGroup` ya saneado (Sprint 022 Fase B). El backend hace todo
     *   lo demás atómicamente:
     *     - aplica diff de mediatorIds,
     *     - sincroniza `user.groupIds` para added/removed,
     *     - normaliza `teacherId = mediatorIds[0]`,
     *     - persiste ambos JSON en lock anidado.
     *
     * Compatibilidad: la firma pública es la misma (groupId, teacherId).
     * El retorno cambia de `void` a `Promise<void>` — ningún caller
     * existente await la promesa; JS no rompe.
     *
     * Riesgo residual MEDIATORS_CROSS_ACTOR_RISK:
     *   Construimos `[teacherId, ...rest]` desde `this.groups` (cache
     *   local). Si otro admin agregó/quitó mediadores adicionales en
     *   paralelo, el cache puede estar stale y el bulk-replace pisaría
     *   esos cambios. Es el mismo trade-off que cualquier `updateGroup`
     *   con `mediatorIds`. mediatorIds suele tener cardinalidad baja
     *   (1-3 mediadores típicos) y baja frecuencia de edición concurrente
     *   — el riesgo se considera aceptable. Si surge problema real, el
     *   siguiente sprint puede agregar endpoints
     *   `POST/DELETE /api/groups/:id/mediators` análogos a `/members`.
     */
    async assignTeacherToGroup(groupId: string, teacherId: string): Promise<void> {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;

        // Construcción del payload — única lógica legítima del método:
        // promover `teacherId` a primary preservando el resto de mediadores.
        const currentMediators = Array.isArray(group.mediatorIds) ? group.mediatorIds : [];
        const rest = currentMediators.filter(mId => mId !== teacherId);
        const nextMediatorIds = [teacherId, ...rest];

        // Idempotente: si el primary ya es teacherId Y no hay nada que
        // recolocar, evitamos un PUT inútil.
        if (
            currentMediators.length === nextMediatorIds.length &&
            currentMediators.every((m, i) => m === nextMediatorIds[i])
        ) {
            return;
        }

        // Única operación de escritura. updateGroup hace PUT atómico al
        // backend, refresca `this.groups[idx]` con savedGroup, y delega la
        // bidireccionalidad de membresía al backend (sin cascadas
        // cliente-side).
        await this.updateGroup(groupId, { mediatorIds: nextMediatorIds });
    }

    // --- Club Admin: especialización de mediador ---
    // Llamar tras crear/editar un club desde admin para marcar al coordinador.
    // No toca membresía de grupos ni flujos de Aula Viva.
    async setMediatorKind(userId: string, kind: 'teacher' | 'librarian' | 'coordinator' | 'parent'): Promise<void> {
        await this.updateUser(userId, { mediatorKind: kind });
    }

    /**
     * Sprint 022 Fase B — consumidor puro del endpoint atómico
     * `POST /api/groups/:groupId/members`.
     *
     * Antes (Sprint 021 y previo): este método mutaba `group.studentIds.push`
     * en cliente, disparaba N `updateUser` por estudiante y cerraba con un
     * `updateGroup({studentIds, memberIds})` que enviaba el array completo.
     * Eso producía drift cross-actor: si dos admins editaban el mismo grupo
     * en paralelo, el array completo del segundo pisaba los cambios del
     * primero (last-write-wins por bulk-replace).
     *
     * Ahora: una sola llamada al endpoint atómico que aplica
     * `addUserIdToGroup` + `addGroupIdToUser` solo para los IDs solicitados
     * dentro del lock anidado (groupsLock outer, usersLock inner) — cero
     * pisado cross-actor, idempotente, con failed[] explícito por user.
     *
     * Cache local: tras la respuesta exitosa, aplicamos las mismas
     * primitivas que escribió el backend (las mismas funciones puras de
     * utils/groupMembership.mjs) sobre `this.groups[idx]` y los users
     * cacheados — frontend y backend convergen al mismo estado sin
     * reimplementar lógica.
     */
    async addStudentsToGroup(groupId: string, studentIds: string[]): Promise<void> {
        if (!Array.isArray(studentIds) || studentIds.length === 0) return;

        const response = await fetch(`${this.apiUrl}/groups/${groupId}/members`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body:    JSON.stringify({ userIds: studentIds }),
        });

        if (!response.ok) {
            // No mutamos cache local en error — el backend no escribió.
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || errBody.message || `Failed to add students (HTTP ${response.status})`);
        }

        // Backend devuelve { groupId, assigned: [{userId, alreadyMember}], failed: [...] }.
        // `assigned` cubre todo lo que efectivamente quedó en el grupo (incluso
        // los idempotentes), `failed` reporta los userIds que el backend no
        // pudo aplicar (típico: USER_NOT_FOUND).
        const result: {
            groupId: string;
            assigned: Array<{ userId: string; alreadyMember: boolean }>;
            failed:   Array<{ userId: string; reason: string }>;
        } = await response.json();

        // Refrescar cache local con las mismas primitivas que el backend usó.
        // Sólo se aplican las membresías ASIGNADAS — los `failed` no fueron
        // escritos por el backend y no deben aparecer en cache.
        const idx = this.groups.findIndex(g => g.id === groupId);
        if (idx > -1) {
            for (const a of result.assigned) {
                addUserIdToGroup(this.groups[idx] as any, a.userId);
                const u = this.getUsuarioById(a.userId);
                if (u) addGroupIdToUser(u as any, groupId);
            }
            this.saveState('groups', this.groups);
            this.saveState('users',  this.users);
        }

        if (result.failed.length > 0) {
            console.warn('[ADD_STUDENTS] failed', result.failed);
        }
    }

    /**
     * Sprint 022 Fase B — consumidor puro del endpoint atómico
     * `DELETE /api/groups/:groupId/members/:userId`.
     *
     * Antes: mutaba `group.studentIds.filter` localmente, disparaba
     * `updateUser({groupIds})` y luego `updateGroup({studentIds, memberIds})`.
     * Mismo problema cross-actor que addStudentsToGroup + 3 round trips.
     *
     * Ahora: una sola llamada DELETE atómica idempotente. El backend
     * responde { removed: bool }; el cache local se refresca solo si el
     * backend confirmó la remoción.
     */
    async removeStudentFromGroup(groupId: string, studentId: string): Promise<void> {
        if (!studentId) return;

        const response = await fetch(
            `${this.apiUrl}/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(studentId)}`,
            {
                method:  'DELETE',
                headers: { ...this.adminWriteHeaders },
            },
        );

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || errBody.message || `Failed to remove student (HTTP ${response.status})`);
        }

        const result: { groupId: string; userId: string; removed: boolean } = await response.json();

        // Refrescar cache local SOLO si el backend confirmó la remoción.
        // Si removed=false, el user ya no era miembro — el cache podría
        // estar stale pero no hay que mutar.
        if (result.removed) {
            const idx = this.groups.findIndex(g => g.id === groupId);
            if (idx > -1) {
                removeUserIdFromGroup(this.groups[idx] as any, studentId);
                this.saveState('groups', this.groups);
            }
            const u = this.getUsuarioById(studentId);
            if (u) {
                removeGroupIdFromUser(u as any, groupId);
                this.saveState('users', this.users);
            }
        }
    }

    async addContentToClub(groupId: string, contentId: string) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;
        const current = Array.isArray(group.availableContentIds) ? group.availableContentIds as string[] : [];
        if (current.includes(contentId)) return;
        console.log(`[CLUB_CONTENT] group ${groupId} → content ${contentId} → added`);
        await this.updateGroup(groupId, { availableContentIds: [...current, contentId] });
    }

    async removeContentFromClub(groupId: string, contentId: string) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;
        const current = Array.isArray(group.availableContentIds) ? group.availableContentIds as string[] : [];
        const updated = current.filter(id => id !== contentId);
        console.log(`[CLUB_CONTENT] group ${groupId} → content ${contentId} → removed`);
        await this.updateGroup(groupId, { availableContentIds: updated });
    }

    // --- Fase 7: Bundles comerciales ---

    getBundles(): Bundle[] {
        return this.bundles;
    }

    async applyBundleToGroup(groupId: string, bundleId: string) {
        const bundle = this.bundles.find(b => b.id === bundleId);
        if (!bundle) throw new Error(`Bundle ${bundleId} not found`);
        const group = this.groups.find(g => g.id === groupId);
        if (!group) throw new Error(`Group ${groupId} not found`);
        // Fase 8: reemplaza contenido anterior (no suma) — mantiene coherencia con activeExperienceId
        console.log(`[BUNDLE] group ${groupId} ← bundle ${bundleId} (replace, ${bundle.contentIds.length} items)`);
        await this.updateGroup(groupId, { availableContentIds: [...bundle.contentIds], activeExperienceId: bundleId });
    }

    async clearGroupExperience(groupId: string) {
        console.log(`[BUNDLE] group ${groupId} → experience cleared`);
        await this.updateGroup(groupId, { activeExperienceId: null });
    }

    async createBundle(data: Omit<Bundle, 'id'>): Promise<Bundle> {
        const response = await fetch(`${this.apiUrl}/bundles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to create bundle');
        const saved: Bundle = await response.json();
        this.bundles.push(saved);
        return saved;
    }

    async updateBundle(id: string, updates: Partial<Bundle>): Promise<void> {
        const response = await fetch(`${this.apiUrl}/bundles/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(updates)
        });
        if (!response.ok) throw new Error('Failed to update bundle');
        const saved: Bundle = await response.json();
        const idx = this.bundles.findIndex(b => b.id === id);
        if (idx > -1) this.bundles[idx] = saved;
    }

    async deleteBundle(id: string): Promise<void> {
        const response = await fetch(`${this.apiUrl}/bundles/${id}`, {
            method: 'DELETE',
            headers: { ...this.adminWriteHeaders }
        });
        if (!response.ok) throw new Error('Failed to delete bundle');
        this.bundles = this.bundles.filter(b => b.id !== id);
    }

    updateSocialConnection(userId: string, platform: 'facebook' | 'instagram' | 'linkedin', isConnected: boolean) {
        const user = this.getUsuarioById(userId);
        if (user) {
            if (!user.social_connections) user.social_connections = { facebook: false, instagram: false, linkedin: false };
            user.social_connections[platform] = isConnected;
            this.saveState('users', this.users);
        }
    }

    addPuntos(userId: string, puntos: number) {
        const user = this.getUsuarioById(userId);
        if (user) {
            user.puntos = (user.puntos || 0) + puntos;
            this.saveState('users', this.users);
        }
    }

    canjearRecompensa(userId: string, cost: number): boolean {
        const user = this.getUsuarioById(userId);
        if (user && (user.puntos || 0) >= cost) {
            user.puntos = (user.puntos || 0) - cost;
            this.saveState('users', this.users);
            return true;
        }
        return false;
    }

    updateImmersiveLevel(userId: string, level: 1 | 2 | 3 | 4 | 5) {
        const user = this.getUsuarioById(userId);
        if (user) {
            user.immersive_level = level;
            this.saveState('users', this.users);
        }
    }

    // Content
    getContenidoById(id: string): Content | undefined {
        const content = this.content.find(c => c.id === id);
        if (content && !content.album_data) {
            content.album_data = [];
        }
        return content;
    }

    getContenidos(roles: string[], checkAccessForUserId?: string): Content[] {
        // BYPASS ADMINISTRADOR: el admin ve TODO el catálogo incluyendo
        // contenido tipo 'contexto_pedagogico' (guías pedagógicas internas).
        // Lectores y mediadores no tienen acceso a ese tipo.
        const rolesHasAdmin = hasAdminRole(roles);
        let baseContent = rolesHasAdmin ? this.content : this.content.filter(c => c.tipo !== 'contexto_pedagogico');

        // BYPASS ADMIN + MEDIADOR (FASE 5): admin y mediadores ven el catálogo
        // completo sin restricción por usuario. Solo los lectores pasan por el
        // motor de acceso por scope (group → organization → legacy).
        if (checkAccessForUserId && !rolesHasAdmin && !hasMediatorRole(roles)) {
            const allowed = this.getEffectiveAccessibleContentIdsForUser(checkAccessForUserId);
            if (allowed !== 'all') {
                baseContent = baseContent.filter(c => this.isContentAccessibleForUser(checkAccessForUserId, c.id, allowed));
            }
        }

        return baseContent;
    }

    // --- FASE 5: CATÁLOGO RESTRINGIDO ---
    // --- FASE 6B: HELPERS DE MOTOR HÍBRIDO ---
    
    public getCollections(): Content[] {
        return this.content.filter(c => c.isCollection && c.status === 'disponible');
    }

    public getBooks(): Content[] {
        return this.content.filter(c => !c.isCollection && (c.tipo === 'libro' || c.tipo === 'libro_album') && c.status === 'disponible');
    }

    // --- FASE E3: Árbitro temporal del servidor ---

    /**
     * syncServerTime — Fase E3
     * Fetchea GET /api/server-time para calcular el offset entre el reloj del
     * servidor y el reloj local del cliente. Solo se llama una vez durante el init.
     * Si falla (offline, error de red), deja serverTimeOffset = 0 y usa Date.now().
     */
    async syncServerTime(): Promise<void> {
        try {
            const localBefore = Date.now();
            const res = await fetch(`${this.apiUrl}/server-time`);
            if (!res.ok) return; // Fallo silencioso → fallback a reloj cliente
            const data = await res.json();
            if (typeof data.now !== 'number') return;
            // Usar el punto medio del viaje de red para reducir el error de latencia
            const localAfter = Date.now();
            const localMid = Math.round((localBefore + localAfter) / 2);
            this.serverTimeOffset = data.now - localMid;
            this.serverTimeSynced = true;
            console.log(`[E3] Server time synced. Offset: ${this.serverTimeOffset}ms`);
        } catch {
            // Offline o error: fallback sin ruido
            console.warn('[E3] Server time sync failed. Falling back to client clock.');
        }
    }

    /**
     * getReliableNow — Fase E3
     * Retorna el timestamp actual corregido por el offset del servidor.
     * Si no se sincronizó aún, retorna Date.now() del cliente como fallback.
     */
    private getReliableNow(): number {
        return Date.now() + this.serverTimeOffset;
    }

    private isEntityActive(start?: string, end?: string): boolean {
        // Usa getReliableNow() en lugar de Date.now() directo.
        // Si serverTimeOffset = 0 (no sincronizado), comportamiento idéntico al anterior.
        const now = this.getReliableNow();
        if (start) {
            const startDate = new Date(start).getTime();
            if (!isNaN(startDate) && now < startDate) return false;
        }
        if (end) {
            const endDate = new Date(end).getTime();
            if (!isNaN(endDate) && now > endDate) return false;
        }
        return true;
    }

    private resolveCollectionContentIds(collectionIds: string[] | undefined): string[] {
        if (!collectionIds || collectionIds.length === 0) return [];
        const expandedIds: string[] = [...collectionIds];
        for (const colId of collectionIds) {
            // Relación fiable existente: los contenidos de una colección tienen parentId === id de la colección
            const hijos = this.content.filter(c => c.parentId === colId).map(c => c.id);
            expandedIds.push(...hijos);
        }
        return expandedIds;
    }

    private getGroupAccess(group: Group): { active: boolean, allowedIds: string[] | 'all' } {
        if (!this.isEntityActive(group.accessStartsAt, group.accessEndsAt)) {
            return { active: false, allowedIds: [] };
        }
        
        let allowed = group.availableContentIds || 'all';
        if (allowed !== 'all' && group.collectionIds && group.collectionIds.length > 0) {
            const extra = this.resolveCollectionContentIds(group.collectionIds);
            allowed = [...new Set([...allowed, ...extra])];
        }
        return { active: true, allowedIds: allowed };
    }

    // --- FASE E4: TTL de schoolConfigsCache ---
    // Entrada del caché: guarda la config y el timestamp de inserción para calcular expiración.
    private schoolConfigsCache: Map<string, { config: SchoolConfig; cachedAt: number }> = new Map();
    // FASE E7 — TTL reactivo para acceso por usuario
    private readonly ACCESS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
    private userContentAccessCache: Record<string, { state: ResolvedAccessState | null; fetchedAt: number; retryAfter?: number }> = {};
    private accessFetchInFlight: Record<string, Promise<void>> = {}; // in-flight guard: evita requests duplicados

    // TTL de 5 minutos en ms. Ajustar según frecuencia de cambios en producción.
    private readonly SCHOOL_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

    /**
     * isCacheEntryFresh — Fase E4
     * Retorna true si la entrada del caché fue creada dentro del TTL.
     * Usa getReliableNow() para coherencia con el árbitro temporal de E3.
     */
    private isCacheEntryFresh(cachedAt: number): boolean {
        return (this.getReliableNow() - cachedAt) < this.SCHOOL_CONFIG_CACHE_TTL_MS;
    }

    private getOrganizationAccess(schoolName: string): { active: boolean, allowedIds: string[] | 'all' } {
        const entry = this.schoolConfigsCache.get(schoolName);

        if (!entry) {
            // Sin entrada en absoluto: lanzar rehidratación silenciosa y degradar.
            // Esto cubre el caso de primer arranque donde el precalentamiento no alcanzó.
            this.getSchoolConfig(schoolName).catch(() => {}); // fire-and-forget
            return { active: true, allowedIds: 'all' };
        }

        if (!this.isCacheEntryFresh(entry.cachedAt)) {
            // --- Fase E5: Stale-While-Revalidate ---
            // La entrada expiró pero existe. En lugar de degradar a 'all' inmediatamente,
            // servimos la stale config y lanzamos rehidratación en background.
            // La próxima evaluación usará la entrada fresca que el fetch depositará en caché.
            this.getSchoolConfig(schoolName).catch(() => {}); // fire-and-forget, actualiza caché
            // Continúa abajo con entry.config (dato stale pero semanticamente válido)
        }

        const config = entry.config;

        if (!this.isEntityActive(config.accessStartsAt, config.accessEndsAt)) {
            return { active: false, allowedIds: [] }; // Org expirada = bloquea si no hay overriding de club
        }

        let orgAllowed = config.availableContentIds || 'all';
        if (orgAllowed !== 'all' && config.collectionIds && config.collectionIds.length > 0) {
            const extra = this.resolveCollectionContentIds(config.collectionIds);
            orgAllowed = [...new Set([...orgAllowed, ...extra])];
        }
        return { active: true, allowedIds: orgAllowed };
    }

    getEffectiveAccessibleContentIdsForUser(userId: string): string[] | 'all' {
        const user = this.getUsuarioById(userId);
        // BYPASS ADMIN + MEDIADOR: administradores y mediadores tienen acceso irrestricto
        // al catálogo — no están sujetos a reglas de scope.
        // Regla de negocio intencional: el mediador necesita ver todo el contenido
        // para poder asignarlo a sus grupos.
        if (!user || isAdmin(user) || isMediator(user)) {
            return 'all';
        }

        // 1. Resolver acceso por Organización (Colegio) de manera síncrona
        const orgAccess = user.colegio ? this.getOrganizationAccess(user.colegio) : { active: true, allowedIds: 'all' as 'all' };

        // 2. Extraer membresía efectiva transicional a los grupos
        const userGroups = this.groups.filter(g => this.getGroupMemberIds(g).includes(userId));

        // Fallback Legacy puro: niño sin colegio (o con config por defecto) y sin grupos, tiene catálogo pleno
        if (!user.colegio && userGroups.length === 0) return 'all';

        let hasAllAccess = false;
        let hasActiveRules = false;
        const allowedIds = new Set<string>();

        // 3. Absorber la capa Organizacional
        if (orgAccess.active) {
            hasActiveRules = true;
            if (orgAccess.allowedIds === 'all') {
                hasAllAccess = true;
            } else {
                orgAccess.allowedIds.forEach(id => allowedIds.add(id));
            }
        }

        // 4. Absorber la capa Grupos / Clubes
        for (const group of userGroups) {
            const gAccess = this.getGroupAccess(group);
            if (gAccess.active) {
                hasActiveRules = true;
                if (gAccess.allowedIds === 'all') {
                    hasAllAccess = true;
                    break;
                } else {
                    gAccess.allowedIds.forEach(id => allowedIds.add(id));
                }
            }
        }

        // Resultados finales de la heurística
        if (!hasActiveRules) return []; // Toda asignación expiró = catálogo vacío
        if (hasAllAccess) return 'all'; // Suma optimista: un contrato vivo dice 'all'

        return Array.from(allowedIds);
    }

    // --- FASE E6/E7: MOTOR DE ACCESO POR SCOPES (Shadow Mode) ---

    /**
     * ensureFreshUserAccess — TTL reactivo (Fase E7+)
     * Comprueba si la entrada de caché es vigente (< ACCESS_CACHE_TTL_MS).
     * Si está stale o no existe, lanza un fetch. El in-flight guard impide
     * requests duplicados si varios consumers llaman en simultáneo.
     * Falla silenciosamente: si el backend no responde, la caché stale sigue sirviendo.
     */
    async ensureFreshUserAccess(userId: string): Promise<void> {
        const entry = this.userContentAccessCache[userId];
        const now = this.getReliableNow();
        
        // Si hay un cooldown activo, esperamos a que venza
        if (entry && entry.retryAfter && now < entry.retryAfter) {
            return;
        }

        const isStale = !entry || (now - entry.fetchedAt) > this.ACCESS_CACHE_TTL_MS;

        if (!isStale) return; // caché vigente — sin request

        // In-flight guard: reusar la misma Promise si ya hay un fetch en vuelo
        if (this.accessFetchInFlight[userId]) {
            return this.accessFetchInFlight[userId];
        }

        const fetchPromise = (async () => {
            const state = await this.fetchUserContentAccess(userId);
            if (state) {
                // Éxito: actualizar fetchedAt y limpiar retryAfter
                this.userContentAccessCache[userId] = { 
                    state, 
                    fetchedAt: this.getReliableNow() 
                };
            } else {
                // FALLO MANTENIENDO SEMÁNTICA: fetchedAt es ahora y retryAfter va al futuro
                const failTime = this.getReliableNow();
                this.userContentAccessCache[userId] = { 
                    state: entry?.state || null, // Mantener state previo si existía
                    fetchedAt: failTime,
                    retryAfter: failTime + 60000 
                };
            }
        })();

        this.accessFetchInFlight[userId] = fetchPromise;
        fetchPromise.finally(() => { delete this.accessFetchInFlight[userId]; });
        return fetchPromise;
    }

    async preloadUserAccess(userId: string): Promise<void> {
        try {
            await this.ensureFreshUserAccess(userId);
        } catch (err) {
            console.warn('Error en preloadUserAccess:', err);
        }
    }

    async fetchUserContentAccess(userId: string): Promise<ResolvedAccessState | null> {
        try {
            // v4.0.5 hotfix: sin headers, el GET-bypass cerrado retorna 401
            // y la evaluación de acceso del usuario degrada al fallback.
            const res = await fetch(`${this.apiUrl}/access/by-user/${userId}`, { headers: this.adminWriteHeaders });
            if (res.ok) {
                return await res.json();
            }
            return null;
        } catch (err) {
            console.warn('Error fetching E6 ContentAccess:', err);
            return null;
        }
    }

    isContentAccessibleForUser(userId: string, contentId: string, precalculatedAllowed?: string[] | 'all'): boolean {
        // BYPASS ADMIN + MEDIADOR: administradores y mediadores tienen acceso garantizado
        // a cualquier contenido sin pasar por el motor E7.
        // Regla de negocio intencional: estos roles deben poder abrir cualquier
        // contenido para revisarlo, aunque no sea parte del catálogo de su institución.
        const user = this.getUsuarioById(userId);
        if (user && (isAdmin(user) || isMediator(user))) {
            return true;
        }

        // --- E7: SCOPE ENGINE (Restricción Absoluta si hay reglas aplicadas) ---
        const scopeState = this.userContentAccessCache[userId]?.state;
        if (scopeState && scopeState.appliedRules.length > 0) {
            if (scopeState.titleIds.includes(contentId)) return true;
            const content = this.getContenidoById(contentId);
            if (content && content.parentId && scopeState.collectionIds.includes(content.parentId)) {
                return true;
            }
            return false; // Denegado estrictamente por E7
        }

        // --- LEGACY FALLBACK (Fase 5/6) ---
        const allowed = precalculatedAllowed || this.getEffectiveAccessibleContentIdsForUser(userId);
        if (allowed === 'all') return true;
        
        // Excepción puente FASE 5: Independiente del catálogo bloqueado público,
        // si un mediador asignó explícitamente contenido a un usuario, no se bloquea en Aula Viva.
        const isAssigned = this.assignments.some(a => 
            a.contentId === contentId && 
            this.groups.some(g => g.id === a.groupId && this.getGroupMemberIds(g).includes(userId))
        );
        if (isAssigned) return true;

        return allowed.includes(contentId);
    }
    // -------------------------------------

    getContenidosPrincipales(): Content[] {
        return this.content.filter(c => c.tipo === 'libro' || c.tipo === 'libro_album' || c.isCollection);
    }

    /**
     * getClubContent — Activación de Club (Club Activation UX)
     *
     * Devuelve los libros (tipo 'libro' o 'libro_album') a los que tiene acceso
     * el club/grupo especificado, respetando ventanas de tiempo y reglas.
     * Si el grupo no está activo o no tiene contenido definido, devuelve [].
     */
    /**
     * createAccessRule — Fase E6/C1
     * Registra una regla de acceso en el Motor de Scopes del servidor.
     */
    async createAccessRule(rule: Partial<ContentAccess>): Promise<ContentAccess> {
        const response = await fetch(`${this.apiUrl}/access`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...this.adminWriteHeaders
            },
            body: JSON.stringify(rule)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create access rule');
        }

        return await response.json();
    }

    /**
     * getClubContent
     *
     * Devuelve los libros (tipo 'libro' o 'libro_album') a los que tiene acceso
     * el club/grupo especificado, respetando ventanas de tiempo y reglas.
     * Si el grupo no está activo o no tiene contenido definido, devuelve [].
     */
    getClubContent(group: Group): Content[] {
        const LEGIBLE_TYPES = new Set(['libro', 'libro_album']);
        
        // --- Mejorado C1: Usar resolución de grupo pero garantizando consistencia ---
        // Obtenemos los IDs permitidos por este grupo específico (legacy fallback integrado)
        const gAccess = this.getGroupAccess(group);

        if (!gAccess.active) return [];

        if (gAccess.allowedIds === 'all') {
            return this.content.filter(c => LEGIBLE_TYPES.has(c.tipo));
        }

        const allowedSet = new Set(gAccess.allowedIds);
        return this.content.filter(c => LEGIBLE_TYPES.has(c.tipo) && allowedSet.has(c.id));
    }

    // --- LEO MEMORY (Fase 5.6) ---
    async getLeoMemory(userId: string, contentId: string): Promise<any> {
        try {
            if (!userId || !contentId) return null;
            const res = await fetch(`/api/leo/memory/${userId}/${contentId}`, {
                method: 'GET',
                headers: { 'x-user-id': userId }
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.success ? data.memory : null;
        } catch (e) {
            return null;
        }
    }

    async updateLeoMemory(userId: string, contentId: string, memory: any): Promise<void> {
        try {
            if (!userId || !contentId) return;
            await fetch(`/api/leo/memory/${userId}/${contentId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                },
                body: JSON.stringify(memory)
            });
        } catch (e) {
            // Falla en silencio para no obstruir el lector
        }
    }

    /**
     * getLastPassageText — returns the actual sentence text at the reader's last known position.
     *
     * Strategy:
     * 1. Read sentenceIndex from local progress (sync, no fetch).
     * 2. If sentenceIndex === 0, return null — no useful anchor (PDF, VisorTexto, or unread).
     * 3. Fetch TTS manifest (/uploads/audio/{contentId}/manifest.json).
     *    The manifest contains pre-segmented sentences matching exactly what VisorInmersivo uses.
     * 4. Flatten chunk.sentences arrays → index by sentenceIndex.
     * 5. Any failure → return null silently (caller falls back to descripcion_corta).
     *
     * Only returns non-null for content read in VisorInmersivo with TTS generated.
     */
    async getLastPassageText(userId: string, contentId: string): Promise<string | null> {
        try {
            const prog = this.getProgresoUsuarioLibro(userId, contentId);
            const sentenceIndex = prog?.canonicalProgress?.sentenceIndex ?? 0;
            if (sentenceIndex === 0) return null;

            const res = await fetch(`/uploads/audio/${contentId}/manifest.json`);
            if (!res.ok) return null;
            const manifest = await res.json();

            if (!Array.isArray(manifest.chunks)) return null;

            const allSentences: string[] = [];
            for (const chunk of manifest.chunks) {
                if (Array.isArray(chunk.sentences) && chunk.sentences.length > 0) {
                    allSentences.push(...chunk.sentences);
                } else if (typeof chunk.text === 'string' && chunk.text.trim()) {
                    allSentences.push(chunk.text.trim());
                }
            }

            if (allSentences.length === 0) return null;
            const idx = Math.min(sentenceIndex, allSentences.length - 1);
            return allSentences[idx] || null;
        } catch (_) {
            return null;
        }
    }

    getContenidosHijos(parentId: string, roles: string[] = []): Content[] {
        const rolesHasAdmin = hasAdminRole(roles);
        return this.content.filter(c => c.parentId === parentId && (rolesHasAdmin || c.tipo !== 'contexto_pedagogico'));
    }

    getNuevosTitulos(roles: string[]): Content[] {
        return this.content.filter(c => c.etiquetas.includes('Nuevo'));
    }

    getRecomendadosComunidad(roles: string[], checkAccessForUserId?: string): Content[] {
        return this.getContenidos(roles, checkAccessForUserId).sort((a, b) => b.metricas.calificacion_promedio - a.metricas.calificacion_promedio).slice(0, 5);
    }

    getLibrosAlbum(roles: string[], checkAccessForUserId?: string): Content[] {
        return this.getContenidos(roles, checkAccessForUserId).filter(c => c.tipo === 'libro_album');
    }

    getArticulosPedagogicos(): Content[] {
        return this.content.filter(c => c.tipo === 'articulo_pedagogico');
    }

    buscarContenido(query: string, roles: string[]): Content[] {
        const lowerQuery = query.toLowerCase();
        return this.content.filter(c =>
            c.titulo.toLowerCase().includes(lowerQuery) ||
            c.autor.toLowerCase().includes(lowerQuery) ||
            c.etiquetas.some(t => t.toLowerCase().includes(lowerQuery))
        );
    }

    agregarContenido(newContent: Content) {
        this.content.push(newContent);
        this.saveState('content', this.content);
    }

    // Progress / History
    getContenidosEnProgreso(userId: string, roles: string[]): { content: Content, progress: ProgresoLectura }[] {
        const userProgress = this.progress.filter(p => p.usuario_id === userId && p.porcentaje < 100);
        return userProgress.map(p => {
            const content = this.content.find(c => c.id === p.contenido_id);
            if (!content) return null;
            // BYPASS ADMIN + MEDIADOR: no se filtra el historial por acceso si el
            // usuario tiene rol elevado. Los lectores sí pasan por isContentAccessibleForUser.
            if (hasAdminRole(roles) || hasMediatorRole(roles) || this.isContentAccessibleForUser(userId, content.id)) {
                 return { content, progress: p };
            }
            return null;
        }).filter(item => item !== null) as { content: Content, progress: ProgresoLectura }[];
    }

    getProgresoUsuarioLibro(userId: string, contentId: string): ProgresoLectura | undefined {
        return this.progress.find(p => p.usuario_id === userId && p.contenido_id === contentId);
    }

    /**
     * Fase E — Cross-device sync (read path).
     *
     * Fetches progress for (userId, contentId) from the backend and merges it into
     * the local record when the remote copy is newer (latest updatedAt wins).
     *
     * Design constraints:
     *   - 3-second hard timeout — never blocks the visor UI.
     *   - Always resolves; errors are silently swallowed.
     *   - Returns true when remote progress was adopted (caller can show UX hint).
     *   - Returns false on network error, timeout, or when local is up to date.
     *   - Does NOT overwrite a newer local record — safe to call during offline sessions.
     */
    async fetchAndMergeRemoteProgress(userId: string, contentId: string): Promise<boolean> {
        if (!userId || !contentId) return false;
        // Fase F: If we're about to talk to the server, drain the failed-sync queue first.
        // This ensures the server has our latest writes before we read back its state.
        this.retryFailedSyncs();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(
                `${this.apiUrl}/progress/item/${userId}/${contentId}`,
                { headers: { 'x-user-id': userId }, signal: controller.signal }
            );
            clearTimeout(timeoutId);

            if (!res.ok) return false;
            const body = await res.json();
            if (!body.success || !body.progress) return false;

            const remote = body.progress;
            const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
            if (!remoteTs) return false;

            const local = this.progress.find(p => p.usuario_id === userId && p.contenido_id === contentId);
            const localTs = local?.fecha_actualizacion
                ? new Date(local.fecha_actualizacion).getTime()
                : local?.updatedAt ? new Date(local.updatedAt).getTime() : 0;

            // Local is up to date — nothing to do.
            if (remoteTs <= localTs) return false;

            // Remote is newer — merge canonical fields into local record.
            const rcp = remote.canonicalProgress;
            if (!rcp) return false;

            if (local) {
                local.porcentaje = Math.round(rcp.globalPercentage ?? local.porcentaje);
                local.canonicalProgress = { ...local.canonicalProgress, ...rcp } as ProgresoLectura['canonicalProgress'];
                local.fecha_actualizacion = remote.updatedAt;
                local.updatedAt = remote.updatedAt;
                local.last_device_mode = rcp.lastInteractedMode === 'pdf' ? 'pdf'
                    : rcp.lastInteractedMode === 'immersive' ? 'immersive' : 'text';
            } else {
                // No local record at all — create a skeleton from remote data.
                const skeleton: ProgresoLectura = {
                    id: `prog-${Date.now()}`,
                    usuario_id: userId,
                    contenido_id: contentId,
                    ultima_posicion: String(Math.round(rcp.globalPercentage ?? 0)),
                    porcentaje: Math.round(rcp.globalPercentage ?? 0),
                    fecha_actualizacion: remote.updatedAt,
                    updatedAt: remote.updatedAt,
                    canonicalProgress: rcp,
                    last_device_mode: rcp.lastInteractedMode === 'pdf' ? 'pdf'
                        : rcp.lastInteractedMode === 'immersive' ? 'immersive' : 'text',
                    totalTimeMs: 0,
                    sessionsCount: 0,
                };
                this.progress.push(skeleton);
            }
            this.saveState('progress', this.progress);
            return true; // remote was adopted
        } catch {
            return false;
        }
    }

    // Maps the legacy deviceMode string to the unified lastMode string
    private mapDeviceModeToLastMode(mode?: 'pdf' | 'text' | 'immersive'): ProgresoLectura['lastMode'] {
        if (mode === 'pdf') return 'pdf';
        if (mode === 'immersive') return 'inmersivo';
        return 'texto'; // default (text, undefined)
    }

    updateProgreso(
        userId: string,
        contentId: string,
        page: number,
        totalPages: number,
        canonicalIndex?: number,
        deviceMode?: 'pdf' | 'text' | 'immersive',
        metricsPatch?: { lastMode?: ProgresoLectura['lastMode']; elapsedMs?: number },
        // Fase E: per-visor precision anchor — stored alongside globalPercentage.
        anchor?: { type: 'text' | 'sentence' | 'page'; value: number },
        // Fase F: sub-anchor precision — full-precision float for same-mode rehidration.
        // Only VisorTexto uses this (scroll precision). Other visors already have exact units.
        viewportHint?: number
    ) {
        let prog = this.progress.find(p => p.usuario_id === userId && p.contenido_id === contentId);
        // Fallback for visual mapping (0-100)
        const porcentaje = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;

        // Phase 3.3 Canonical Formatting
        const canonicalPayload: ProgresoLectura['canonicalProgress'] = {
            sentenceIndex: canonicalIndex || 0,
            totalSentences: deviceMode === 'immersive' ? totalPages : 0,
            globalPercentage: porcentaje,
            contentAnchor: null,
            contentFingerprint: null,
            lastInteractedMode: deviceMode || 'text',
            // Fase E/F: attach precision anchor and viewportHint when provided
            ...(anchor ? { anchor } : {}),
            ...(viewportHint !== undefined && isFinite(viewportHint) ? { viewportHint } : {}),
        };

        const sessionPayload = {
            sessionId: this.currentSessionId,
            startedAt: new Date(this.sessionStartTimeMs).toISOString(),
            durationSec: Math.floor((Date.now() - this.sessionStartTimeMs) / 1000)
        };

        const timestampStr = new Date().toISOString();
        const resolvedLastMode = metricsPatch?.lastMode ?? this.mapDeviceModeToLastMode(deviceMode);

        if (prog) {
            prog.ultima_posicion = page.toString();
            prog.porcentaje = porcentaje;
            prog.fecha_actualizacion = timestampStr;
            prog.canonicalProgress = canonicalPayload;
            prog.last_device_mode = deviceMode;
            prog.session = sessionPayload;
            // Advanced Reading metrics accumulation
            prog.lastMode = resolvedLastMode;
            if (metricsPatch?.elapsedMs && metricsPatch.elapsedMs > 0) {
                prog.totalTimeMs = (prog.totalTimeMs ?? 0) + metricsPatch.elapsedMs;
            }
        } else {
            prog = {
                id: `prog-${Date.now()}`,
                usuario_id: userId,
                contenido_id: contentId,
                ultima_posicion: page.toString(),
                porcentaje: porcentaje,
                fecha_actualizacion: timestampStr,
                canonicalProgress: canonicalPayload,
                last_device_mode: deviceMode,
                session: sessionPayload,
                // Advanced Reading metrics — initial values
                lastMode: resolvedLastMode,
                totalTimeMs: metricsPatch?.elapsedMs && metricsPatch.elapsedMs > 0 ? metricsPatch.elapsedMs : 0,
                sessionsCount: 0
            };
            this.progress.push(prog);
        }
        this.saveState('progress', this.progress);

        // Phase 3.4 Buffer Push (No immediate API Call)
        this.pendingSyncs.set(`${userId}__${contentId}`, prog);

        // Update User Books read stats if finished
        if (porcentaje === 100) {
            const user = this.getUsuarioById(userId);
            if (user) {
                if (!user.libros_terminados?.includes(contentId)) {
                    if (!user.libros_terminados) user.libros_terminados = [];
                    user.libros_terminados.push(contentId);
                    user.libros_leidos += 1;
                    this.saveState('users', this.users);
                }
            }
        }
    }

    /**
     * recordReaderOpen — call once when a reader mounts.
     * Increments sessionsCount, sets lastOpenedAt, and updates lastMode.
     * Safe to call with old (pre-patch) progress objects.
     */
    recordReaderOpen(userId: string, contentId: string, lastMode: ProgresoLectura['lastMode']): void {
        if (!userId) return;
        const timestampStr = new Date().toISOString();
        let prog = this.progress.find(p => p.usuario_id === userId && p.contenido_id === contentId);
        if (prog) {
            prog.lastOpenedAt = timestampStr;
            prog.lastMode = lastMode;
            prog.sessionsCount = (prog.sessionsCount ?? 0) + 1;
        } else {
            // Create a skeleton record so we have a baseline to update later
            prog = {
                id: `prog-${Date.now()}`,
                usuario_id: userId,
                contenido_id: contentId,
                ultima_posicion: '0',
                porcentaje: 0,
                fecha_actualizacion: timestampStr,
                lastOpenedAt: timestampStr,
                lastMode,
                totalTimeMs: 0,
                sessionsCount: 1
            };
            this.progress.push(prog);
        }
        this.saveState('progress', this.progress);
    }

    /**
     * getReadingStatus — derives a human-readable status from a progress record.
     */
    getReadingStatus(progress: ProgresoLectura): ReadingStatus {
        const pct = progress?.porcentaje ?? 0;
        if (pct <= 0) return 'pending';
        if (pct >= 95) return 'completed';
        return 'in_progress';
    }

    // --- LEO PEDAGOGICAL PROFILE ---

    private makeDefaultProfile(userId: string): LeoReaderProfile {
        return {
            userId,
            vocabularySupportCount: 0,
            inferentialPromptCount: 0,
            reflectionPromptCount: 0,
            oralityAttemptsCount: 0,
            averageOralityScore: null,
            booksCompletedCount: 0,
            recentInteractionTypes: [],
            preferredSupportType: null,
            updatedAt: new Date().toISOString(),
        };
    }

    /** Returns the cumulative Leo reader profile for a user, or a safe default. */
    getLeoReaderProfile(userId: string): LeoReaderProfile {
        return this.leoReaderProfiles.find(p => p.userId === userId)
            ?? this.makeDefaultProfile(userId);
    }

    /**
     * updateLeoReaderProfile — merges a patch and recomputes preferredSupportType.
     * @param userId
     * @param patch  — partial increments; numeric fields are ADDED, not replaced.
     */
    updateLeoReaderProfile(
        userId: string,
        patch: {
            vocabularyDelta?: number;
            inferentialDelta?: number;
            reflectionDelta?: number;
        }
    ): void {
        if (!userId) return;
        let profile = this.leoReaderProfiles.find(p => p.userId === userId);
        if (!profile) {
            profile = this.makeDefaultProfile(userId);
            this.leoReaderProfiles.push(profile);
        }

        // Accumulate deltas
        profile.vocabularySupportCount  += patch.vocabularyDelta  ?? 0;
        profile.inferentialPromptCount  += patch.inferentialDelta ?? 0;
        profile.reflectionPromptCount   += patch.reflectionDelta  ?? 0;

        // Sync orality stats from existing attempts
        const oralityStats = this.getOralityStatsForUser(userId);
        profile.oralityAttemptsCount = oralityStats.count;
        profile.averageOralityScore  = oralityStats.avgScore;

        // Sync books completed from user record
        const user = this.getUsuarioById(userId);
        if (user) profile.booksCompletedCount = user.libros_terminados?.length ?? 0;

        // Maintain rolling window (last 10 interactions)
        if (!Array.isArray(profile.recentInteractionTypes)) profile.recentInteractionTypes = [];
        if ((patch.vocabularyDelta  ?? 0) > 0) profile.recentInteractionTypes.push('vocabulary');
        else if ((patch.inferentialDelta ?? 0) > 0) profile.recentInteractionTypes.push('inferential');
        else if ((patch.reflectionDelta  ?? 0) > 0) profile.recentInteractionTypes.push('reflection');
        profile.recentInteractionTypes = profile.recentInteractionTypes.slice(-10);

        // Derive preferred support type from recent window; fall back to lifetime totals
        const recent = profile.recentInteractionTypes;
        if (recent.length > 0) {
            const windowCounts: Record<string, number> = {};
            for (const t of recent) windowCounts[t] = (windowCounts[t] ?? 0) + 1;
            const [bestType] = Object.entries(windowCounts).sort(([, a], [, b]) => b - a);
            profile.preferredSupportType = bestType[0] as LeoReaderProfile['preferredSupportType'];
        } else {
            const counts: Record<'vocabulary' | 'inferential' | 'reflection', number> = {
                vocabulary:  profile.vocabularySupportCount,
                inferential: profile.inferentialPromptCount,
                reflection:  profile.reflectionPromptCount,
            };
            const [best] = (Object.entries(counts) as [LeoReaderProfile['preferredSupportType'], number][])
                .sort(([, a], [, b]) => b - a);
            profile.preferredSupportType = (best[1] > 0) ? best[0] : null;
        }
        profile.updatedAt = new Date().toISOString();

        this.saveState('leoReaderProfiles', this.leoReaderProfiles);
    }

    /**
     * getOralityStatsForUser — derives count and average score from stored orality attempts.
     * Safe to call even if oralityAttempts is empty or malformed.
     */
    getOralityStatsForUser(userId: string): { count: number; avgScore: number | null } {
        const attempts = this.oralityAttempts.filter(
            a => a && a.userId === userId && typeof a.score === 'number'
        );
        if (attempts.length === 0) return { count: 0, avgScore: null };
        const avg = attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length;
        return { count: attempts.length, avgScore: Math.round(avg) };
    }

    marcarComoTerminado(userId: string, contentId: string) {
        const payload = { updatedAt: new Date().toISOString() };
        fetch(`${this.apiUrl}/progress/${userId}/${contentId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(e => console.warn('Sync Complete failed', e));
        
        // Local state reflection
        const content = this.getContenidoById(contentId);
        if (content) {
            this.updateProgreso(userId, contentId, content.numero_paginas || 100, content.numero_paginas || 100, undefined, 'text');
        }
    }

    getRecentHistory(userId: string): Content[] {
        const user = this.getUsuarioById(userId);
        if (!user || !user.recent_history) return [];
        return user.recent_history.map(id => this.getContenidoById(id)).filter(c => c !== undefined) as Content[];
    }

    addToHistory(userId: string, contentId: string) {
        const user = this.getUsuarioById(userId);
        if (user) {
            if (!user.recent_history) user.recent_history = [];
            user.recent_history = [contentId, ...user.recent_history.filter(id => id !== contentId)].slice(0, 5);
            this.saveState('users', this.users);
        }
    }

    // Reviews & Community
    getResenasByUsuario(userId: string): { review: Resena, content: Content }[] {
        const userReviews = this.reviews.filter(r => r.usuario_id === userId);
        return userReviews.map(r => {
            const content = this.content.find(c => c.id === r.contenido_id);
            return content ? { review: r, content } : null;
        }).filter(item => item !== null) as { review: Resena, content: Content }[];
    }

    getResenaByUsuarioYContenido(userId: string, contentId: string): Resena | undefined {
        return this.reviews.find(r => r.usuario_id === userId && r.contenido_id === contentId);
    }

    guardarResena(resena: Partial<Resena> & { usuario_id: string, contenido_id: string }) {
        const existing = this.reviews.findIndex(r => r.usuario_id === resena.usuario_id && r.contenido_id === resena.contenido_id);
        if (existing > -1) {
            this.reviews[existing] = { ...this.reviews[existing], ...resena, fecha: new Date().toISOString() };
        } else {
            this.reviews.push({
                id: `rev-${Date.now()}`,
                usuario_id: resena.usuario_id,
                contenido_id: resena.contenido_id,
                calificacion: resena.calificacion || 5,
                texto: resena.texto,
                fecha: new Date().toISOString()
            });
        }
        this.saveState('reviews', this.reviews);
    }

    getCommunityPosts(status: 'pendiente' | 'aprobado' = 'aprobado'): CommunityPost[] {
        return this.communityPosts.filter(p => p.estado === status);
    }

    getMisPublicaciones(userId: string): CommunityPost[] {
        return this.communityPosts.filter(p => p.autor_id === userId);
    }

    getSavedPosts(userId: string): CommunityPost[] {
        const user = this.getUsuarioById(userId);
        if (!user || !user.saved_posts) return [];
        return this.communityPosts.filter(p => user.saved_posts?.includes(p.id));
    }

    addCommunityPost(post: Omit<CommunityPost, 'id' | 'fecha'>) {
        this.communityPosts.unshift({
            ...post,
            id: `post-${Date.now()}`,
            fecha: new Date().toISOString()
        });
        this.saveState('communityPosts', this.communityPosts);
    }

    rateCommunityPost(postId: string, rating: number) {
        const post = this.communityPosts.find(p => p.id === postId);
        if (post) {
            // Weighted average update
            const totalScore = post.calificacion_comunidad * post.votos;
            post.votos += 1;
            post.calificacion_comunidad = (totalScore + rating) / post.votos;
            this.saveState('communityPosts', this.communityPosts);
        }
    }

    toggleSavedPost(userId: string, postId: string): boolean {
        const user = this.getUsuarioById(userId);
        if (user) {
            if (!user.saved_posts) user.saved_posts = [];
            if (user.saved_posts.includes(postId)) {
                user.saved_posts = user.saved_posts.filter(id => id !== postId);
                this.saveState('users', this.users);
                return false;
            } else {
                user.saved_posts.push(postId);
                this.saveState('users', this.users);
                return true;
            }
        }
        return false;
    }

    // Plans & Subscriptions removed as per request usage

    // Bookmarks
    getBookmarks(): Bookmark[] {
        return this.bookmarks;
    }

    addBookmark(bookmark: Omit<Bookmark, 'id'>): Bookmark {
        const newBm = { ...bookmark, id: `bm-${Date.now()}` };
        this.bookmarks.push(newBm);
        this.saveState('bookmarks', this.bookmarks);
        return newBm;
    }

    // Shop
    getProductos(): Product[] {
        return this.products;
    }

    getStoreOrders(): StoreOrder[] {
        return this.storeOrders;
    }

    updateOrderStatus(orderId: string, status: StoreOrder['status']) {
        const order = this.storeOrders.find(o => o.id === orderId);
        if (order) {
            order.status = status;
            this.saveState('storeOrders', this.storeOrders);
        }
    }

    addProduct(productData: Omit<Product, 'id'>) {
        const newProduct: Product = {
            ...productData,
            id: `prod-${Date.now()}`
        };
        this.products.push(newProduct);
        this.saveState('products', this.products);
    }

    // Rewards Management
    getRewardRequests(filter: 'submitted' | 'approved' | 'rejected'): JournalEntry[] {
        return this.journalEntries.filter(e => e.type === 'reward_request' && e.status === filter);
    }

    processRewardRequest(id: string, action: 'approve' | 'reject') {
        const req = this.journalEntries.find(e => e.id === id);
        if (req && req.type === 'reward_request') {
            req.status = action === 'approve' ? 'approved' : 'rejected';
            this.saveState('journalEntries', this.journalEntries);

            // Refund points if rejected
            if (action === 'reject') {
                const costMatch = req.content.match(/Costo: (\d+)/);
                if (costMatch) {
                    const points = parseInt(costMatch[1]);
                    this.addPuntos(req.userId, points);
                }
            }
        }
    }

    getGlobalStats() {
        // Mock stats calculation
        const totalBooksRead = this.users.reduce((acc, u) => acc + u.libros_leidos, 0);
        const topBooks = this.content
            .sort((a, b) => b.metricas.veces_leido - a.metricas.veces_leido)
            .slice(0, 5);

        return {
            totalUsers: this.users.length,
            totalBooksRead,
            schoolCount: new Set(this.users.map(u => u.colegio).filter(Boolean)).size,
            topBooks,
            schools: Array.from(new Set(this.users.map(u => u.colegio).filter(Boolean))) as string[]
        };
    }

    // --- ANALYTICS & INTELLIGENCE ---
    getSchoolPerformance(schoolName: string) {
        const schoolUsers = this.getUsuariosByColegio(schoolName);
        const totalStudents = schoolUsers.length;
        const activeStudents = schoolUsers.filter(u => u.libros_leidos > 0).length;
        const adoptionRate = totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 0;

        // Mocking average hours based on books read (approx 2h per book)
        const totalBooks = schoolUsers.reduce((acc, u) => acc + u.libros_leidos, 0);
        const avgHours = totalStudents > 0 ? Math.round((totalBooks * 2.5) / totalStudents) : 0;

        // Mock Learning Objectives (PISA/Saber Pro aligned)
        // These would normally be calculated from specific quiz results or reading types
        const learningObjectives = {
            criticalThinking: 75 + Math.floor(Math.random() * 15), // Prensamiento Crítico
            autonomy: 60 + Math.floor(Math.random() * 20),         // Autonomía
            writing: 70 + Math.floor(Math.random() * 10),          // Escritura
            inference: 65 + Math.floor(Math.random() * 15),        // Inferencia
            knowledge: 80 + Math.floor(Math.random() * 10),        // Gestión del Conocimiento
            engagement: adoptionRate
        };

        return {
            schoolName,
            totalStudents,
            activeStudents,
            adoptionRate,
            avgHoursPerStudent: avgHours,
            learningObjectives,
            totalGroups: this.getGroupsByColegio(schoolName).length
        };
    }

    getContentInsights() {
        // Aggregate tag/genre popularity
        const tagCounts: Record<string, number> = {};
        const authorCounts: Record<string, number> = {};

        this.content.forEach(c => {
            const reads = c.metricas.veces_leido;
            c.etiquetas.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + reads;
            });
            authorCounts[c.autor] = (authorCounts[c.autor] || 0) + reads;
        });

        const topGenres = Object.entries(tagCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        const topAuthors = Object.entries(authorCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        // Mock retention/drop-off
        const retentionByGenre = topGenres.map(g => ({
            genre: g.name,
            retention: 85 + Math.floor(Math.random() * 10) // Mock high retention
        }));

        return {
            topGenres,
            topAuthors,
            retentionByGenre
        };
    }


    // Aula Viva / Assignments
    getAssignmentsForStudent(studentId: string): Assignment[] {
        // Find groups student belongs to using central transitional helper
        const studentGroups = this.groups.filter(g => this.getGroupMemberIds(g).includes(studentId)).map(g => g.id);
        return this.assignments.filter(a => studentGroups.includes(a.groupId) && a.status === 'active');
    }

    submitAssignment(assignmentId: string, studentId: string, content: string): void {
        const assignment = this.assignments.find(a => a.id === assignmentId);
        const student = this.getUsuarioById(studentId);

        if (assignment) {
            if (!assignment.studentSubmissions) {
                assignment.studentSubmissions = [];
            }
            // Remove existing submission from this student if any
            const existingIdx = assignment.studentSubmissions.findIndex(s => s.studentId === studentId);
            if (existingIdx > -1) {
                assignment.studentSubmissions.splice(existingIdx, 1);
            }

            const submission: AssignmentSubmission = {
                studentId,
                studentName: student?.nombre_completo || 'Estudiante',
                content, // This can be text, or a blob URL for audio/video/photo
                date: new Date().toISOString(),
                status: 'submitted'
            };
            assignment.studentSubmissions.push(submission);
            this.saveState('assignments', this.assignments);

            // Persistencia server-side para exportación académica (fire-and-forget, no bloquea el flujo)
            // Solo aplica a entregas de texto; blob URLs (audio/video/foto) se omiten.
            if (typeof content === 'string' && !content.startsWith('blob:')) {
                this.persistSubmissionToServer(assignmentId, studentId, content, assignment).catch(err => {
                    console.warn('[dataService] Server submission persistence failed (non-blocking):', err);
                });
            }
        }
    }

    private async persistSubmissionToServer(
        taskId: string,
        studentId: string,
        responseText: string,
        assignment: Assignment
    ): Promise<void> {
        await fetch(`${this.apiUrl}/submissions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-id': studentId,
            },
            body: JSON.stringify({
                taskId,
                studentId,
                groupId:       assignment.groupId,
                responseText,
                contentId:     assignment.contentId || undefined,
                source:        'task',
                taskTitle:     assignment.contentTitle || undefined,
            }),
        });
    }

    /**
     * Sprint visibilidad — fetch al endpoint narrativo
     * GET /api/groups/:id/diagnosis. La respuesta es interpretable y se
     * muestra tal cual en Aula Viva — no la transformes ni la re-interpretes
     * acá. Si el grupo no existe, el endpoint responde 404 con un payload
     * que ya incluye healthStatus y summary; lo propagamos como excepción
     * para que el caller decida.
     */
    async getGroupDiagnosis(groupId: string): Promise<GroupDiagnosis> {
        const userId = this.getSessionUserId();
        const r = await fetch(`${this.apiUrl}/groups/${encodeURIComponent(groupId)}/diagnosis`, {
            headers: userId ? { 'x-user-id': userId } : {},
        });
        if (!r.ok) {
            // Mantener el cuerpo del backend (ya viene con healthStatus + summary)
            // para que el caller pueda mostrarlo si lo necesita.
            const body = await r.json().catch(() => ({}));
            const err  = new Error(body?.summary?.headline || body?.error || `diagnosis fetch failed: ${r.status}`);
            (err as any).status = r.status;
            (err as any).body   = body;
            throw err;
        }
        return r.json();
    }

    /**
     * Sprint Panel del estudiante — fetch al endpoint narrativo
     * GET /api/students/:id/status. Igual que getGroupDiagnosis: la respuesta
     * es interpretable y se renderiza tal cual; no transformes los textos.
     * El backend siempre devuelve un payload con shape StudentStatus, incluso
     * en errores 404/500 (el frontend nunca queda sin algo que mostrar).
     */
    async getStudentStatus(userId: string): Promise<StudentStatus> {
        const requesterId = this.getSessionUserId();
        const r = await fetch(`${this.apiUrl}/students/${encodeURIComponent(userId)}/status`, {
            headers: requesterId ? { 'x-user-id': requesterId } : {},
        });
        // 404 y 500 traen un body con shape StudentStatus (state TECH_ISSUE) — lo retornamos.
        // Solo lanzamos cuando el body no es JSON parseable (network/timeout reales).
        const body = await r.json().catch(() => null);
        if (!body) {
            const err = new Error(`student status fetch failed: ${r.status}`);
            (err as any).status = r.status;
            throw err;
        }
        return body as StudentStatus;
    }

    getGroupStudents(groupId: string): User[] {
        // Sprint 021 Fase 2 — única fuente de verdad: getGroupMembers.
        // Validación implícita de consistencia: estudiantes en studentIds que
        // no aparezcan en users (huérfanos) se descartan al hacer el filter
        // por id. Estudiantes en memberIds y user.groupIds se unen
        // automáticamente en la helper compartida.
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return [];
        const memberIds = getGroupMembers(group, this.users, { allGroups: this.groups });
        const userById = new Map(this.users.map(u => [u.id, u]));
        return memberIds.map(id => userById.get(id)).filter((u): u is User => !!u);
    }

    getAssignmentsByGroup(groupId: string): Assignment[] {
        return this.assignments.filter(a => a.groupId === groupId);
    }

    createAssignment(newAssign: Omit<Assignment, 'id' | 'status' | 'studentSubmissions'>) {
        this.assignments.push({
            ...newAssign,
            id: `assign-${Date.now()}`,
            status: 'active',
            studentSubmissions: [],
            submissionType: 'text' // Default
        });
        this.saveState('assignments', this.assignments);
    }

    deleteAssignment(id: string) {
        const idx = this.assignments.findIndex(a => a.id === id);
        if (idx > -1) {
            this.assignments.splice(idx, 1);
            this.saveState('assignments', this.assignments);
        }
    }

    getPedagogicalStats(userId: string): PedagogicalStats | undefined {
        return this.pedagogicalStats.find(s => s.userId === userId);
    }

    gradeSubmission(assignmentId: string, studentId: string, grade: number, feedback: string) {
        const assignment = this.assignments.find(a => a.id === assignmentId);
        if (assignment && assignment.studentSubmissions) {
            const sub = assignment.studentSubmissions.find(s => s.studentId === studentId);
            if (sub) {
                sub.grade = grade;
                sub.teacherFeedback = feedback;
                sub.status = 'graded';
                this.saveState('assignments', this.assignments);
            }
        }
    }

    getGroupDistribution(groupId: string) {
        // Mock calculation based on pedagogicalStats of students in group
        const studentIds = this.getGroupStudents(groupId).map(s => s.id);
        const stats = this.pedagogicalStats.filter(s => studentIds.includes(s.userId));

        let low = 0, mid = 0, high = 0;
        stats.forEach(s => {
            const avg = (s.comprension_literal + s.comprension_inferencial + s.reflexion_critica) / 3;
            if (avg < 60) low++;
            else if (avg < 80) mid++;
            else high++;
        });

        return { low, mid, high };
    }

    getGroupEvolution(groupId: string) {
        // Mock: Aggregate evolutionHistory of students
        // For simplicity, just return the history of the first student found or mock data
        const studentIds = this.getGroupStudents(groupId).map(s => s.id);
        const firstStat = this.pedagogicalStats.find(s => studentIds.includes(s.userId));
        return firstStat?.evolutionHistory || [];
    }

    // --- JOURNAL (BITACORA) ---
    getJournalEntries(userId: string): JournalEntry[] {
        return this.journalEntries.filter(e => e.userId === userId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    addJournalEntry(entry: Omit<JournalEntry, 'id'>) {
        this.journalEntries.push({
            type: 'personal', // Default
            status: 'draft',  // Default
            ...entry,
            id: `entry-${Date.now()}`
        });
        this.saveState('journalEntries', this.journalEntries);
    }

    createDraftFromAssignment(userId: string, assignmentId: string) {
        const assignment = this.assignments.find(a => a.id === assignmentId);
        if (!assignment) return;

        const existing = this.journalEntries.find(e => e.userId === userId && e.sourceId === assignmentId && e.type === 'task_draft');
        if (existing) return existing; // Return existing draft if present

        const newEntry: JournalEntry = {
            id: `entry-${Date.now()}`,
            userId,
            title: `Borrador: ${assignment.contentTitle}`,
            content: '', // Start empty
            date: new Date().toISOString().split('T')[0],
            tags: ['Tarea', assignment.contentTitle],
            type: 'task_draft',
            sourceId: assignmentId,
            sourceTitle: assignment.contentTitle,
            status: 'draft'
        };
        this.journalEntries.unshift(newEntry);
        this.saveState('journalEntries', this.journalEntries);
        return newEntry;
    }

    submitJournalEntry(entryId: string) {
        const entry = this.journalEntries.find(e => e.id === entryId);
        if (!entry || entry.type !== 'task_draft' || !entry.sourceId) return false;

        // Create submission
        const assignment = this.assignments.find(a => a.id === entry.sourceId);
        if (assignment) {
            if (!assignment.studentSubmissions) assignment.studentSubmissions = [];

            // Remove previous if exists for this student
            assignment.studentSubmissions = assignment.studentSubmissions.filter(s => s.studentId !== entry.userId);

            const user = this.getUsuarioById(entry.userId);
            assignment.studentSubmissions.push({
                studentId: entry.userId,
                studentName: user?.nombre_completo || 'Estudiante',
                content: entry.content, // Submit the journal content
                date: new Date().toISOString(),
                status: 'submitted'
            });
            this.saveState('assignments', this.assignments);

            // Update Entry Status
            entry.status = 'submitted';
            this.saveState('journalEntries', this.journalEntries);
            return true;
        }
        return false;
    }

    publishJournalEntryAsReview(entryId: string, rating: number) {
        const entry = this.journalEntries.find(e => e.id === entryId);
        if (!entry) return false;

        let contentId: string | undefined;

        // If it's linked to a book (either directly or via assignment that is about a book)
        if (entry.type === 'review_draft' && entry.sourceId) {
            contentId = entry.sourceId;
        } else if (entry.type === 'task_draft' && entry.sourceId) {
            const assignment = this.assignments.find(a => a.id === entry.sourceId);
            if (assignment) contentId = assignment.contentId;
        }

        if (contentId) {
            this.guardarResena({
                usuario_id: entry.userId,
                contenido_id: contentId,
                calificacion: rating as 1 | 2 | 3 | 4 | 5,
                texto: entry.content
            });
            entry.status = 'published';
            if (entry.type === 'personal') entry.type = 'review_draft'; // Upgrade type if needed
            this.saveState('journalEntries', this.journalEntries);
            return true;
        }
        return false;
    }

    updateJournalEntry(id: string, updates: Partial<JournalEntry>) {
        const idx = this.journalEntries.findIndex(e => e.id === id);
        if (idx > -1) {
            this.journalEntries[idx] = { ...this.journalEntries[idx], ...updates };
            this.saveState('journalEntries', this.journalEntries);
        }
    }

    deleteJournalEntry(id: string) {
        const idx = this.journalEntries.findIndex(e => e.id === id);
        if (idx > -1) {
            this.journalEntries.splice(idx, 1);
            this.saveState('journalEntries', this.journalEntries);
        }
    }

    // --- GAMIFICATION & POINTS ---
    addPoints(userId: string, amount: number, reason: string): number {
        const user = this.getUsuarioById(userId);
        if (!user) return 0;

        user.puntos = (user.puntos || 0) + amount;
        this.saveState('users', this.users);

        // Log entry (simulated)
        console.log(`[Points] User ${user.nombre_usuario} +${amount} (${reason}). Total: ${user.puntos}`);
        return user.puntos;
    }

    redeemCoupon(userId: string, cost: number, description: string): { success: boolean; message: string; remainingPoints?: number } {
        const user = this.getUsuarioById(userId);
        if (!user) return { success: false, message: 'Usuario no encontrado' };

        if ((user.puntos || 0) < cost) {
            return { success: false, message: `Insuficientes puntos. Tienes ${user.puntos || 0}, necesitas ${cost}.` };
        }

        // Deduct points
        user.puntos = (user.puntos || 0) - cost;
        this.saveState('users', this.users);

        // Create Admin Task (Journal Entry)
        const newRequest: JournalEntry = {
            id: `req-${Date.now()}`,
            userId: user.id,
            title: `Solicitud de Canje: ${description}`,
            content: `El estudiante solicita canjear ${cost} puntos por: ${description}. Pendiente de código.`,
            date: new Date().toISOString(),
            type: 'reward_request',
            status: 'submitted',
            tags: ['CANJE', 'PENDIENTE']
        };

        this.journalEntries.push(newRequest);
        this.saveState('journalEntries', this.journalEntries);

        return { success: true, message: 'Canje solicitado. Tu mediador revisará la solicitud.', remainingPoints: user.puntos };
    }

    // --- UTILS FOR TEACHER VIEW ---
    // --- SEÑALES PEDAGÓGICAS BÁSICAS (base para Leo) ---
    /**
     * Deriva señales pedagógicas estructuradas a partir de las entregas reales del estudiante
     * dentro de las tareas de un grupo. Sin LLM, sin llamadas al servidor.
     * Diseñada para ser consumida por el panel docente y, en fases futuras, por Leo.
     *
     * @param studentId  ID del estudiante a analizar
     * @param groupAssignments  Tareas activas del grupo (ya cargadas en AulaViva)
     */
    analyzeStudentLearningSignals(
        studentId: string,
        groupAssignments: Assignment[]
    ): StudentLearningSignals {
        // ── 1. Recopilar entregas de texto del estudiante ─────────────────────
        // Excluye blob URLs (audio/video/foto) que no tienen contenido textual medible.
        const enriched = groupAssignments
            .map(a => {
                const sub = a.studentSubmissions?.find(s => s.studentId === studentId);
                return sub && typeof sub.content === 'string' && !sub.content.startsWith('blob:')
                    ? { assignment: a, sub }
                    : null;
            })
            .filter(Boolean) as { assignment: Assignment; sub: AssignmentSubmission }[];

        const totalAssigned  = groupAssignments.length;
        const totalSubmitted = enriched.length;
        const completionRate = totalAssigned > 0
            ? Math.round((totalSubmitted / totalAssigned) * 100)
            : 0;

        // ── 2. Volumen de escritura ────────────────────────────────────────────
        const wordCounts = enriched.map(({ sub }) =>
            sub.content.trim().split(/\s+/).filter(Boolean).length
        );
        const totalWordCount   = wordCounts.reduce((acc, n) => acc + n, 0);
        const averageWordCount = totalSubmitted > 0
            ? Math.round(totalWordCount / totalSubmitted)
            : 0;

        // writingVolumeLevel: low < 50 palabras promedio | medium 50–149 | high ≥ 150
        const writingVolumeLevel: StudentLearningSignals['writingVolumeLevel'] =
            averageWordCount < 50  ? 'low' :
            averageWordCount < 150 ? 'medium' : 'high';

        // ── 3. Consistencia / cumplimiento ────────────────────────────────────
        // low < 40% | medium 40–74% | high ≥ 75%
        const consistencyLevel: StudentLearningSignals['consistencyLevel'] =
            completionRate < 40 ? 'low' :
            completionRate < 75 ? 'medium' : 'high';

        // ── 4. Nivel de elaboración escrita ───────────────────────────────────
        // Heurística: % de respuestas "sustanciales" (≥ 80 palabras) + promedio global.
        // initial: avg < 50 o < 30% sustanciales
        // developing: avg 50–119 o < 60% sustanciales
        // solid: avg ≥ 120 y ≥ 60% sustanciales
        const substantialCount = wordCounts.filter(w => w >= 80).length;
        const substantialRate  = totalSubmitted > 0 ? substantialCount / totalSubmitted : 0;

        const writingDevelopmentLevel: StudentLearningSignals['writingDevelopmentLevel'] =
            (averageWordCount < 50  || substantialRate < 0.3) ? 'initial' :
            (averageWordCount < 120 || substantialRate < 0.6) ? 'developing' : 'solid';

        // ── 5. Tendencia reciente ─────────────────────────────────────────────
        // Compara primera mitad vs segunda mitad de entregas (ordenadas cronológicamente).
        // Umbral: ±20% de variación en wordCount promedio.
        let trend: StudentLearningSignals['trend'] = 'stable';

        if (totalSubmitted === 0 || completionRate < 30) {
            trend = 'needs_attention';
        } else if (totalSubmitted >= 2) {
            const sorted = [...enriched].sort(
                (a, b) => new Date(a.sub.date).getTime() - new Date(b.sub.date).getTime()
            );
            const sortedWC = sorted.map(({ sub }) =>
                sub.content.trim().split(/\s+/).filter(Boolean).length
            );
            const half         = Math.ceil(sortedWC.length / 2);
            const firstAvg     = sortedWC.slice(0, half).reduce((a, b) => a + b, 0) / half;
            const secondSlice  = sortedWC.slice(half);
            const secondAvg    = secondSlice.length > 0
                ? secondSlice.reduce((a, b) => a + b, 0) / secondSlice.length
                : firstAvg;
            const relativeDiff = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;

            trend = relativeDiff >  0.20 ? 'improving' :
                    relativeDiff < -0.20 ? 'irregular' : 'stable';
        }

        // ── 6. Resumen docente (plantilla, sin IA) ────────────────────────────
        let summary: string;

        if (totalSubmitted === 0) {
            summary = 'No hay entregas registradas. No es posible derivar señales pedagógicas aún.';
        } else {
            const parts: string[] = [];

            // Consistencia
            parts.push(
                consistencyLevel === 'high'   ? 'muestra buena constancia en la entrega de tareas' :
                consistencyLevel === 'medium' ? 'ha entregado parte de las tareas asignadas' :
                                               'presenta bajo nivel de cumplimiento en las tareas'
            );

            // Volumen
            parts.push(
                writingVolumeLevel === 'high'   ? 'con un volumen de escritura alto' :
                writingVolumeLevel === 'medium' ? 'con un volumen de escritura medio' :
                                                 'con un volumen de escritura reducido'
            );

            // Desarrollo
            if (writingDevelopmentLevel !== 'initial') {
                parts.push(
                    writingDevelopmentLevel === 'solid'
                        ? 'y un desarrollo escrito sólido'
                        : 'y un desarrollo escrito en crecimiento'
                );
            }

            let sentence = `El estudiante ${parts.join(', ')}.`;

            // Tendencia
            if      (trend === 'improving')       sentence += ' Se observa mejora en sus respuestas recientes.';
            else if (trend === 'irregular')        sentence += ' Sus entregas muestran variabilidad en extensión.';
            else if (trend === 'needs_attention')  sentence += ' Se recomienda acompañamiento y seguimiento cercano.';

            summary = sentence;
        }

        // ── 7. Evidencia auditable ────────────────────────────────────────────
        const lastEntry = enriched.length > 0
            ? [...enriched].sort(
                (a, b) => new Date(b.sub.date).getTime() - new Date(a.sub.date).getTime()
              )[0]
            : null;

        return {
            studentId,
            totalAssigned,
            totalSubmitted,
            completionRate,
            totalWordCount,
            averageWordCount,
            writingVolumeLevel,
            consistencyLevel,
            writingDevelopmentLevel,
            trend,
            summary,
            evidence: {
                basedOnAssignments: totalAssigned,
                basedOnSubmissions: totalSubmitted,
                lastSubmissionAt:   lastEntry?.sub.date,
            },
        };
    }

    /**
     * Genera un conjunto de recomendaciones pedagógicas a partir de señales reales.
     * Lógica basada en plantillas — sin LLM, determinista y auditable.
     */
    buildStudentPedagogicalRecommendations(signals: StudentLearningSignals): StudentRecommendationBundle {
        const strengths: StudentPedagogicalRecommendation[] = [];
        const alerts: StudentPedagogicalRecommendation[] = [];
        const actions: StudentPedagogicalRecommendation[] = [];

        // ── Fortalezas ────────────────────────────────────────────────────────
        if (signals.consistencyLevel === 'high') {
            strengths.push({
                category: 'strength',
                priority: 'low',
                pedagogicalGoal: 'reading_habit',
                title: 'Hábito lector sólido',
                description: 'El estudiante entrega de forma consistente. Demuestra responsabilidad y compromiso con la lectura.',
                rationale: `Tasa de cumplimiento: ${signals.completionRate}%.`,
            });
        }

        if (signals.writingVolumeLevel === 'high') {
            strengths.push({
                category: 'strength',
                priority: 'low',
                pedagogicalGoal: 'writing',
                title: 'Alto volumen de escritura',
                description: 'Sus respuestas escritas son extensas, lo que indica disposición a elaborar ideas.',
                rationale: `Promedio de palabras por entrega: ${signals.averageWordCount}.`,
            });
        } else if (signals.writingVolumeLevel === 'medium' && signals.writingDevelopmentLevel !== 'initial') {
            strengths.push({
                category: 'strength',
                priority: 'low',
                pedagogicalGoal: 'writing',
                title: 'Escritura en crecimiento',
                description: 'El estudiante produce textos de extensión moderada y muestra desarrollo en su expresión escrita.',
                rationale: `Promedio de palabras: ${signals.averageWordCount}. Nivel de elaboración: ${signals.writingDevelopmentLevel}.`,
            });
        }

        if (signals.writingDevelopmentLevel === 'solid') {
            strengths.push({
                category: 'strength',
                priority: 'low',
                pedagogicalGoal: 'writing',
                title: 'Elaboración escrita sólida',
                description: 'La mayoría de sus respuestas supera las 80 palabras con buena densidad de contenido.',
                rationale: `Nivel de elaboración: sólido. Promedio: ${signals.averageWordCount} palabras.`,
            });
        }

        if (signals.trend === 'improving') {
            strengths.push({
                category: 'strength',
                priority: 'low',
                pedagogicalGoal: 'reading_habit',
                title: 'Tendencia positiva',
                description: 'Sus entregas recientes son más elaboradas que las primeras. El estudiante está progresando.',
                rationale: 'Tendencia: mejorando (segunda mitad con mayor volumen que la primera).',
            });
        }

        // ── Alertas ───────────────────────────────────────────────────────────
        if (signals.totalSubmitted === 0) {
            alerts.push({
                category: 'alert',
                priority: 'high',
                pedagogicalGoal: 'emotional',
                title: 'Sin entregas registradas',
                description: 'El estudiante no ha enviado ninguna respuesta escrita. Puede haber una barrera motivacional o técnica.',
                rationale: `0 de ${signals.totalAssigned} tareas entregadas.`,
            });
        } else if (signals.consistencyLevel === 'low') {
            alerts.push({
                category: 'alert',
                priority: 'high',
                pedagogicalGoal: 'reading_habit',
                title: 'Baja consistencia',
                description: 'El estudiante entrega menos del 40% de las tareas asignadas. Se recomienda seguimiento cercano.',
                rationale: `Tasa de cumplimiento: ${signals.completionRate}%.`,
            });
        } else if (signals.consistencyLevel === 'medium') {
            alerts.push({
                category: 'alert',
                priority: 'medium',
                pedagogicalGoal: 'reading_habit',
                title: 'Consistencia irregular',
                description: 'El estudiante entrega algo más de la mitad de las tareas. Hay margen de mejora en la regularidad.',
                rationale: `Tasa de cumplimiento: ${signals.completionRate}%.`,
            });
        }

        if (signals.writingDevelopmentLevel === 'initial' && signals.totalSubmitted > 0) {
            alerts.push({
                category: 'alert',
                priority: 'medium',
                pedagogicalGoal: 'writing',
                title: 'Elaboración escrita inicial',
                description: 'Las respuestas son breves o poco desarrolladas. El estudiante puede necesitar andamiaje para expresarse por escrito.',
                rationale: `Promedio de palabras: ${signals.averageWordCount}. Nivel: inicial.`,
            });
        }

        if (signals.trend === 'needs_attention') {
            alerts.push({
                category: 'alert',
                priority: 'high',
                pedagogicalGoal: 'metacognitive',
                title: 'Requiere atención inmediata',
                description: 'El patrón de entregas y volumen sugieren que el estudiante no está conectado con las actividades.',
                rationale: `Tendencia: needs_attention. Cumplimiento: ${signals.completionRate}%.`,
            });
        }

        if (signals.trend === 'irregular' && signals.totalSubmitted >= 3) {
            alerts.push({
                category: 'alert',
                priority: 'low',
                pedagogicalGoal: 'metacognitive',
                title: 'Variabilidad en las respuestas',
                description: 'El volumen escrito varía mucho entre entregas. Puede indicar falta de rutina o dificultad para sostener el esfuerzo.',
                rationale: 'Tendencia: irregular (variación >20% entre primera y segunda mitad).',
            });
        }

        // ── Acciones para el mediador ─────────────────────────────────────────
        // Máximo 3 acciones, priorizadas según la situación del estudiante.
        if (signals.totalSubmitted === 0 || signals.consistencyLevel === 'low' || signals.trend === 'needs_attention') {
            actions.push({
                category: 'action',
                priority: 'high',
                pedagogicalGoal: 'emotional',
                title: 'Conversación individual',
                description: 'Hablar con el estudiante para identificar qué barreras le impiden participar. Explorar factores motivacionales y técnicos.',
                rationale: 'Bajo cumplimiento o ausencia total de entregas requiere contacto directo antes de escalarlo.',
            });
        }

        if (signals.writingDevelopmentLevel === 'initial' && signals.totalSubmitted > 0) {
            actions.push({
                category: 'action',
                priority: 'medium',
                pedagogicalGoal: 'writing',
                title: 'Andamiaje para la escritura',
                description: 'Ofrecer preguntas guía más concretas o frases iniciadoras. Reducir la extensión mínima esperada y aumentarla gradualmente.',
                rationale: 'Las respuestas breves sugieren que la tarea de escritura puede resultar intimidante sin apoyo.',
            });
        }

        if (signals.writingVolumeLevel === 'high' && signals.writingDevelopmentLevel === 'solid') {
            actions.push({
                category: 'action',
                priority: 'low',
                pedagogicalGoal: 'critical',
                title: 'Profundizar la reflexión crítica',
                description: 'Proponer preguntas que exijan comparar, argumentar o cuestionar el texto. Este estudiante está listo para el nivel inferencial-crítico.',
                rationale: 'Alto volumen y elaboración sólida indican capacidad para trabajar habilidades lectoras superiores.',
            });
        } else if (signals.writingVolumeLevel === 'medium' || signals.writingDevelopmentLevel === 'developing') {
            actions.push({
                category: 'action',
                priority: 'medium',
                pedagogicalGoal: 'writing',
                title: 'Enriquecer las consignas',
                description: 'Incluir preguntas que inviten a describir con más detalle o conectar con experiencias propias para aumentar el volumen natural de respuesta.',
                rationale: 'Escritura en nivel medio puede crecer con consignas que activen el pensamiento personal.',
            });
        }

        if (signals.trend === 'improving' && actions.length < 3) {
            actions.push({
                category: 'action',
                priority: 'low',
                pedagogicalGoal: 'reading_habit',
                title: 'Reconocer el progreso',
                description: 'Señalar explícitamente la mejora observada en sus últimas entregas. El reconocimiento positivo refuerza el hábito.',
                rationale: 'Tendencia positiva: el estudiante mejora. El refuerzo consolida el comportamiento.',
            });
        }

        if (signals.trend === 'irregular' && actions.length < 3) {
            actions.push({
                category: 'action',
                priority: 'medium',
                pedagogicalGoal: 'metacognitive',
                title: 'Establecer rutina de lectura',
                description: 'Sugerir días y horarios fijos para completar las actividades. La variabilidad suele responder a falta de estructura temporal.',
                rationale: 'Tendencia irregular: las entregas varían mucho, lo que sugiere ausencia de rutina.',
            });
        }

        // Limitar a 3 acciones
        const topActions = actions.slice(0, 3);

        // ── Titular resumen ───────────────────────────────────────────────────
        let headline: string;
        if (signals.totalSubmitted === 0) {
            headline = 'Sin datos suficientes para recomendar — se necesita al menos una entrega.';
        } else if (signals.consistencyLevel === 'high' && signals.writingDevelopmentLevel === 'solid') {
            headline = 'Estudiante con buen nivel de participación y escritura desarrollada.';
        } else if (signals.consistencyLevel === 'high' && signals.writingDevelopmentLevel !== 'solid') {
            headline = 'Buena participación — foco en la profundidad de las respuestas.';
        } else if (signals.consistencyLevel === 'low' || signals.trend === 'needs_attention') {
            headline = 'Requiere atención: baja participación y/o patrón de inactividad.';
        } else if (signals.writingDevelopmentLevel === 'initial') {
            headline = 'Participa de forma irregular — apoyar el desarrollo de la escritura.';
        } else {
            headline = 'Participación y escritura en desarrollo — mantener seguimiento.';
        }

        return {
            studentId: signals.studentId,
            strengths,
            alerts,
            actions: topActions,
            headline,
        };
    }

    /**
     * Produce una síntesis pedagógica de Leo para el docente.
     *
     * CONTRATO:
     *  - Sin LLM. Sin Gemini. Sin llamadas externas.
     *  - Toda salida trazable a señales y recomendaciones reales.
     *  - Voz breve, pedagógica, no diagnóstica, no moralizante.
     *  - Si no hay entregas suficientes, Leo habla con prudencia — no inventa.
     */
    buildLeoTeacherAdvisorSummary(
        signals: StudentLearningSignals,
        recommendations: StudentRecommendationBundle
    ): LeoTeacherAdvisorSummary {
        const {
            studentId,
            totalAssigned,
            totalSubmitted,
            completionRate,
            averageWordCount,
            writingVolumeLevel,
            consistencyLevel,
            writingDevelopmentLevel,
            trend,
        } = signals;

        // ── A. Confianza ─────────────────────────────────────────────────────
        // Heurística explícita:
        //   low    → 0–1 entregas (evidencia insuficiente)
        //   medium → 2–3 entregas, o ≥4 pero con consistencia baja
        //   high   → ≥4 entregas Y consistencia media o alta
        const confidence: LeoTeacherAdvisorSummary['confidence'] =
            totalSubmitted <= 1                                                ? 'low' :
            totalSubmitted >= 4 && consistencyLevel !== 'low'                  ? 'high' :
                                                                                 'medium';

        // ── B. Objetivo pedagógico dominante ─────────────────────────────────
        // Regla de prioridad estricta (primera coincidencia):
        //  1. Sin entregas → emotional (barrera motivacional/relacional)
        //  2. needs_attention → reading_habit (desenganche sistémico)
        //  3. consistencia baja → reading_habit (hábito es el cuello de botella)
        //  4. escritura inicial → writing (expresión es el cuello de botella)
        //  5. tendencia irregular → metacognitive (auto-regulación del ritmo)
        //  6. consistencia media + escritura en desarrollo → writing
        //  7. consistencia alta + escritura sólida + mejorando → critical (listo para profundizar)
        //  8. consistencia alta + escritura sólida → writing (mayor calidad expresiva)
        //  9. volumen alto → critical (hay masa, empujar profundidad)
        // 10. default → reading_habit
        let dominantGoal: LeoTeacherAdvisorSummary['dominantGoal'];

        if (totalSubmitted === 0) {
            dominantGoal = 'emotional';
        } else if (trend === 'needs_attention') {
            dominantGoal = 'reading_habit';
        } else if (consistencyLevel === 'low') {
            dominantGoal = 'reading_habit';
        } else if (writingDevelopmentLevel === 'initial') {
            dominantGoal = 'writing';
        } else if (trend === 'irregular') {
            dominantGoal = 'metacognitive';
        } else if (consistencyLevel === 'medium' && writingDevelopmentLevel === 'developing') {
            dominantGoal = 'writing';
        } else if (consistencyLevel === 'high' && writingDevelopmentLevel === 'solid' && trend === 'improving') {
            dominantGoal = 'critical';
        } else if (consistencyLevel === 'high' && writingDevelopmentLevel === 'solid') {
            dominantGoal = 'writing';
        } else if (writingVolumeLevel === 'high') {
            dominantGoal = 'critical';
        } else {
            dominantGoal = 'reading_habit';
        }

        // ── C. Headline ───────────────────────────────────────────────────────
        // Frase breve de Leo al docente. Tono: pedagógico, no diagnóstico.
        // Usa "conviene", "sería útil", "se observa", "puede beneficiarse".
        const HEADLINES: Record<LeoTeacherAdvisorSummary['dominantGoal'], string> = {
            emotional:      'Conviene acercarse antes de plantear nuevas exigencias.',
            reading_habit:  totalSubmitted === 0
                                ? 'Sin entregas registradas — sería útil explorar qué está pasando.'
                                : 'Conviene reforzar la constancia antes de aumentar la exigencia escrita.',
            writing:        writingDevelopmentLevel === 'initial'
                                ? 'Se observa escritura inicial; puede beneficiarse de consignas más guiadas.'
                                : 'El estudiante escribe con regularidad; conviene profundizar la expresión.',
            metacognitive:  'Se observa variabilidad en las respuestas; sería útil consolidar una rutina de participación.',
            critical:       trend === 'improving'
                                ? 'El estudiante está progresando y puede estar listo para tareas de mayor profundidad.'
                                : 'El nivel de participación y escritura permite avanzar hacia preguntas más interpretativas.',
            inferential:    'Conviene introducir preguntas que conecten ideas dentro y entre textos.',
            literal:        'Se recomienda fortalecer la comprensión de los elementos básicos del texto.',
            vocabulary:     'Puede beneficiarse de actividades que amplíen el vocabulario desde el texto.',
            fluency:        'Sería útil incluir actividades que favorezcan la fluidez lectora.',
        };
        const headline = HEADLINES[dominantGoal];

        // ── D. Teacher guidance ───────────────────────────────────────────────
        // 2–4 frases que unen señales + recomendaciones.
        // Construidas de forma modular: frase de situación + frase de orientación
        // (+ frase de tendencia si aplica).
        let situationSentence: string;
        if (totalSubmitted === 0) {
            situationSentence = `Aún no hay entregas registradas para este estudiante (${totalAssigned} tarea${totalAssigned !== 1 ? 's' : ''} asignada${totalAssigned !== 1 ? 's' : ''}).`;
        } else if (consistencyLevel === 'high') {
            situationSentence = `El estudiante participa de forma consistente: entregó ${totalSubmitted} de ${totalAssigned} tareas (${completionRate}%).`;
        } else if (consistencyLevel === 'medium') {
            situationSentence = `El estudiante ha entregado parte de las tareas (${totalSubmitted} de ${totalAssigned}, ${completionRate}%), aunque todavía hay margen de mejora en la regularidad.`;
        } else {
            situationSentence = `La participación ha sido baja: ${totalSubmitted} de ${totalAssigned} tareas entregadas (${completionRate}%).`;
        }

        let writingSentence: string;
        if (totalSubmitted === 0) {
            writingSentence = 'No es posible analizar la escritura sin entregas previas.';
        } else if (writingDevelopmentLevel === 'solid' && writingVolumeLevel === 'high') {
            writingSentence = `Cuando responde, produce textos elaborados (promedio ${averageWordCount} palabras), lo que indica capacidad para trabajar ideas con profundidad.`;
        } else if (writingDevelopmentLevel === 'solid') {
            writingSentence = `Sus respuestas muestran buena elaboración (promedio ${averageWordCount} palabras), con ideas desarrolladas de forma coherente.`;
        } else if (writingDevelopmentLevel === 'developing') {
            writingSentence = `Su escritura está en desarrollo: promedio de ${averageWordCount} palabras por entrega, con crecimiento visible pero aún sin consolidarse.`;
        } else {
            writingSentence = `Las respuestas tienden a ser breves (promedio ${averageWordCount} palabras); puede beneficiarse de mayor andamiaje para expresarse por escrito.`;
        }

        let trendSentence = '';
        if (trend === 'improving') {
            trendSentence = 'Sus entregas más recientes son más elaboradas que las primeras, lo que sugiere un progreso real que conviene reconocer y sostener.';
        } else if (trend === 'irregular') {
            trendSentence = 'La extensión de sus respuestas varía bastante entre entregas, lo que puede indicar falta de rutina o de condiciones estables para responder.';
        } else if (trend === 'needs_attention') {
            trendSentence = 'El patrón general de participación y escritura sugiere que el estudiante puede necesitar acompañamiento cercano.';
        }

        // Añadir orientación final desde las recomendaciones (primera acción, si existe)
        const firstAction = recommendations.actions[0];
        const orientationSentence = firstAction
            ? `Desde la mediación, ${firstAction.description.toLowerCase()}`
            : '';

        const guidanceParts = [situationSentence, writingSentence, trendSentence, orientationSentence]
            .filter(Boolean)
            .slice(0, 4); // máximo 4 frases
        const teacherGuidance = guidanceParts.join(' ');

        // ── E. Acción a corto plazo ───────────────────────────────────────────
        // Una sola acción concreta y ejecutable, según dominantGoal.
        const SHORT_TERM_ACTIONS: Record<LeoTeacherAdvisorSummary['dominantGoal'], string> = {
            emotional:      'Iniciar una conversación individual breve para explorar cómo se siente con las actividades de lectura.',
            reading_habit:  totalSubmitted === 0
                                ? 'Proponer una primera tarea muy breve y de bajo umbral para generar una primera entrega.'
                                : 'Establecer una meta semanal de entrega con recordatorio explícito y seguimiento.',
            writing:        writingDevelopmentLevel === 'initial'
                                ? 'Plantear una tarea breve con pregunta guiada y frase iniciadora para facilitar la expresión escrita.'
                                : 'Proponer una consigna que invite a comparar o relacionar ideas del texto con experiencias propias.',
            metacognitive:  'Establecer días y horarios fijos para las respuestas y comunicarlos de forma explícita al estudiante.',
            critical:       trend === 'improving'
                                ? 'Proponer una pregunta inferencial o de valoración sobre el texto más reciente y reconocer el progreso observado.'
                                : 'Introducir una tarea con pregunta de opinión o debate que exija argumentar con evidencia del texto.',
            inferential:    'Incluir una pregunta que pida al estudiante conectar dos ideas del texto o explicar una causa implícita.',
            literal:        'Proponer una actividad de recuperación de información con preguntas directas sobre el texto.',
            vocabulary:     'Invitar al estudiante a identificar y explicar tres palabras nuevas del texto en su próxima entrega.',
            fluency:        'Proponer una relectura en voz alta de un fragmento breve para trabajar ritmo y comprensión simultánea.',
        };
        const shortTermAction = SHORT_TERM_ACTIONS[dominantGoal];

        // ── F. Justificación (rationale) ──────────────────────────────────────
        // Siempre referencia números concretos para mantener trazabilidad.
        const consistencyLabel   = { low: 'baja', medium: 'media', high: 'alta' }[consistencyLevel];
        const developLabel       = { initial: 'inicial', developing: 'en desarrollo', solid: 'sólida' }[writingDevelopmentLevel];
        const trendLabel         = {
            improving:       'mejorando',
            stable:          'estable',
            irregular:       'irregular',
            needs_attention: 'requiere atención',
        }[trend];
        const goalLabel: Record<LeoTeacherAdvisorSummary['dominantGoal'], string> = {
            emotional:     'motivación y vínculo',
            reading_habit: 'hábito lector',
            writing:       'expresión escrita',
            metacognitive: 'auto-regulación',
            critical:      'pensamiento crítico',
            inferential:   'comprensión inferencial',
            literal:       'comprensión literal',
            vocabulary:    'vocabulario',
            fluency:       'fluidez lectora',
        };

        const rationale =
            totalSubmitted === 0
                ? `Sin entregas registradas. ${totalAssigned} tarea${totalAssigned !== 1 ? 's' : ''} asignada${totalAssigned !== 1 ? 's' : ''}. Confianza: ${confidence}. Leo prioriza ${goalLabel[dominantGoal]}.`
                : `Basado en: cumplimiento ${completionRate}% (consistencia ${consistencyLabel}), promedio ${averageWordCount} palabras (elaboración ${developLabel}), tendencia ${trendLabel}. Confianza: ${confidence}. Leo prioriza ${goalLabel[dominantGoal]}.`;

        return {
            studentId,
            dominantGoal,
            headline,
            teacherGuidance,
            shortTermAction,
            rationale,
            confidence,
        };
    }

    /**
     * buildStudentLongitudinalContext
     * ─────────────────────────────────────────────────────────────────────────
     * Construye una vista consolidada y segura del estudiante a partir de todas
     * las fuentes de datos disponibles en el frontend.
     *
     * FUENTES:
     *   tasks          ← this.assignments + studentSubmissions[]  (localStorage)
     *   reading        ← this.progress (ProgresoLectura[])        (localStorage + API sync)
     *   journal        ← this.journalEntries                      (localStorage)
     *   leoInteraction ← this.leoReaderProfiles                   (localStorage)
     *
     * CONTRATO:
     *   - Nunca lanza. Devuelve defaults seguros si falla cualquier bloque.
     *   - Todos los numéricos son 0 por defecto (jamás undefined/NaN).
     *   - Los campos de fecha son undefined cuando no hay dato (jamás null).
     *   - Completamente síncrono — todos los datos están en memoria.
     *   - No realiza inferencia, clasificación ni llamadas IA.
     *
     * LIMITACIONES CONOCIDAS (documentadas para futuras fases):
     *   - history[] de sesiones vive solo en el servidor (progress_db.json);
     *     el frontend solo tiene sessionsCount/totalTimeMs/lastOpenedAt.
     *   - Leo no persiste logs individuales de interacción: solo contadores acumulados.
     *   - journal no tiene sincronización server-side; solo está en localStorage.
     *   - assignments dependen de que this.groups esté cargado desde la API.
     */
    buildStudentLongitudinalContext(studentId: string): StudentLongitudinalContext {
        const activeSources: string[] = [];

        // ── BLOQUE 1: TASKS ──────────────────────────────────────────────────
        // Fuente: this.assignments, this.groups, assignment.studentSubmissions[]
        // Ventana: tareas activas o completadas (excluye archivadas)
        let tasks: StudentLongitudinalContext['tasks'] = {
            total: 0, submitted: 0, pending: 0, avgWordCount: 0, textSubmissions: 0,
        };

        try {
            // Canonical: find groups where student is a declared member
            const studentGroupIds = new Set(
                this.groups
                    .filter(g => this.getGroupMemberIds(g).includes(studentId))
                    .map(g => g.id)
            );

            // All non-archived assignments in those groups
            const relevantAssignments = this.assignments.filter(
                a => studentGroupIds.has(a.groupId) && a.status !== 'archived'
            );

            const total = relevantAssignments.length;
            const textContents: string[] = [];
            let lastActivityAt: string | undefined;

            for (const assignment of relevantAssignments) {
                const sub = (assignment.studentSubmissions ?? [])
                    .find(s => s.studentId === studentId);
                if (sub) {
                    // Only count text submissions for word-count analysis
                    // (blob: URLs are audio/video/photo — no word count)
                    if (sub.content && !sub.content.startsWith('blob:')) {
                        textContents.push(sub.content);
                    }
                    if (!lastActivityAt || sub.date > lastActivityAt) {
                        lastActivityAt = sub.date;
                    }
                }
            }

            const submitted = relevantAssignments.filter(
                a => (a.studentSubmissions ?? []).some(s => s.studentId === studentId)
            ).length;

            let avgWordCount = 0;
            if (textContents.length > 0) {
                const totalWords = textContents.reduce(
                    (sum, text) => sum + text.trim().split(/\s+/).filter(Boolean).length,
                    0
                );
                avgWordCount = Math.round(totalWords / textContents.length);
            }

            tasks = {
                total,
                submitted,
                pending: total - submitted,
                avgWordCount,
                textSubmissions: textContents.length,
                ...(lastActivityAt !== undefined && { lastActivityAt }),
            };

            if (total > 0) activeSources.push('tasks');
        } catch (_) {
            // Block degrades to defaults — never propagates
        }

        // ── BLOQUE 2: READING ────────────────────────────────────────────────
        // Fuente: this.progress (ProgresoLectura[]), filtrado por usuario_id
        // Ventana: todos los registros de progreso del estudiante
        // Nota: history[] no disponible en frontend — se usa sessionsCount/totalTimeMs/lastOpenedAt
        let reading: StudentLongitudinalContext['reading'] = {
            booksStarted: 0, booksCompleted: 0,
            totalSessions: 0, totalTimeSec: 0, avgSessionTimeSec: 0,
        };

        try {
            const studentProgress = this.progress.filter(
                p => p.usuario_id === studentId
            );

            if (studentProgress.length > 0) {
                const booksStarted = studentProgress.length;

                // Completed: porcentaje ≥ 100 OR in user.libros_terminados[]
                const user = this.getUsuarioById(studentId);
                const terminados = new Set(user?.libros_terminados ?? []);
                const booksCompleted = studentProgress.filter(
                    p => (p.porcentaje ?? 0) >= 100 || terminados.has(p.contenido_id)
                ).length;

                // Sessions and time: accumulated in frontend by recordReaderOpen / updateProgreso
                // TIME UNIT: totalTimeSec is always SECONDS.
                // Source field (prog.totalTimeMs) is in milliseconds → divided by 1000 here.
                let totalSessions = 0;
                let totalTimeSec  = 0;
                let lastSessionAt: string | undefined;

                for (const prog of studentProgress) {
                    totalSessions += prog.sessionsCount ?? 0;
                    totalTimeSec  += Math.round((prog.totalTimeMs ?? 0) / 1000);
                    if (prog.lastOpenedAt) {
                        if (!lastSessionAt || prog.lastOpenedAt > lastSessionAt) {
                            lastSessionAt = prog.lastOpenedAt;
                        }
                    }
                }

                reading = {
                    booksStarted,
                    booksCompleted,
                    totalSessions,
                    totalTimeSec,
                    avgSessionTimeSec: totalSessions > 0
                        ? Math.round(totalTimeSec / totalSessions)
                        : 0,
                    ...(lastSessionAt !== undefined && { lastSessionAt }),
                };

                activeSources.push('reading');
            }
        } catch (_) {
            // Block degrades to defaults
        }

        // ── BLOQUE 3: JOURNAL ────────────────────────────────────────────────
        // Fuente: this.journalEntries (localStorage), método getJournalEntries()
        // Ventana: todas las entradas del estudiante, sin restricción temporal
        let journal: StudentLongitudinalContext['journal'] = {
            entries: 0, avgLength: 0,
            typeCounts: { personal: 0, task_draft: 0, other: 0 },
        };

        try {
            // getJournalEntries devuelve sorted desc por fecha
            const entries = this.getJournalEntries(studentId);

            if (entries.length > 0) {
                const avgLength = Math.round(
                    entries.reduce((sum, e) => sum + (e.content?.length ?? 0), 0)
                    / entries.length
                );

                // First entry is the most recent (sorted desc)
                const lastEntryAt = entries[0]?.date;

                const typeCounts = { personal: 0, task_draft: 0, other: 0 };
                for (const entry of entries) {
                    if      (entry.type === 'personal')   typeCounts.personal++;
                    else if (entry.type === 'task_draft') typeCounts.task_draft++;
                    else                                  typeCounts.other++;
                }

                journal = {
                    entries: entries.length,
                    avgLength,
                    typeCounts,
                    ...(lastEntryAt !== undefined && { lastEntryAt }),
                };

                activeSources.push('journal');
            }
        } catch (_) {
            // Block degrades to defaults
        }

        // ── BLOQUE 4: LEO INTERACTION ────────────────────────────────────────
        // Fuente: this.leoReaderProfiles (localStorage), método getLeoReaderProfile()
        // Ventana: contadores acumulados de toda la vida del perfil
        // Limitación: no hay log individual — solo contadores por tipo de evento.
        let leoInteraction: StudentLongitudinalContext['leoInteraction'] = {
            vocabularyEvents: 0, inferentialEvents: 0,
            reflectionEvents: 0, oralityAttempts: 0, totalEvents: 0,
        };

        try {
            const profile = this.getLeoReaderProfile(studentId);

            const vocabEvents   = profile.vocabularySupportCount  ?? 0;
            const inferEvents   = profile.inferentialPromptCount  ?? 0;
            const reflectEvents = profile.reflectionPromptCount   ?? 0;
            const oralAttempts  = profile.oralityAttemptsCount    ?? 0;
            const totalEvents   = vocabEvents + inferEvents + reflectEvents + oralAttempts;

            leoInteraction = {
                vocabularyEvents:  vocabEvents,
                inferentialEvents: inferEvents,
                reflectionEvents:  reflectEvents,
                oralityAttempts:   oralAttempts,
                totalEvents,
                // lastInteractionAt only meaningful when there are real events
                ...(totalEvents > 0 && profile.updatedAt
                    ? { lastInteractionAt: profile.updatedAt }
                    : {}),
            };

            if (totalEvents > 0) activeSources.push('leo');
        } catch (_) {
            // Block degrades to defaults
        }

        // ── METADATOS DE TRAZABILIDAD ────────────────────────────────────────
        const dataQuality: StudentLongitudinalContext['meta']['dataQuality'] =
            activeSources.length >= 3 ? 'full'    :
            activeSources.length >= 1 ? 'partial' : 'minimal';

        return {
            studentId,
            generatedAt: new Date().toISOString(),
            // Always 'lifetime' for now — field reserved for future time-scoped windows
            timeWindow: { type: 'lifetime' },
            tasks,
            reading,
            journal,
            leoInteraction,
            meta: {
                sources:     activeSources,
                dataQuality,
            },
        };
    }

    /**
     * derivePedagogicalSignals
     * ─────────────────────────────────────────────────────────────────────────
     * Transforms a StudentLongitudinalContext into four simple, explainable
     * pedagogical signals: readingHabit, writingEngagement, autonomy, consistency.
     *
     * NATURE: fully deterministic — no AI, no NLP, no external calls.
     * CONTRACT:
     *   - Reads ONLY from ctx (no side effects, no this.* access).
     *   - Defaults conservatively: 'medium' when evidence is ambiguous.
     *   - Never diagnoses, infers cognitive conditions, or overinterprets.
     *   - Synchronous and pure — never throws.
     *
     * EDGE CASES:
     *   - ctx.meta.dataQuality === 'minimal' → all signals 'low'.
     *   - Partial data → missing sources are ignored, not extrapolated.
     *   - High Leo usage with high reading → NOT classified as low autonomy.
     */
    derivePedagogicalSignals(ctx: StudentLongitudinalContext): PedagogicalSignals {
        const notes: string[] = [];

        // ── EARLY EXIT: no data ────────────────────────────────────────────────
        if (ctx.meta.dataQuality === 'minimal') {
            return {
                readingHabit:      'low',
                writingEngagement: 'low',
                autonomy:          'low',
                consistency:       'low',
                meta: {
                    basedOn: [],
                    notes:   ['dataQuality is minimal — no activity data; all signals defaulted to low'],
                },
            };
        }

        // ── READING HABIT ─────────────────────────────────────────────────────
        // Combines session count + total time. Both must be meaningful for 'high'.
        // booksStarted ≥ 1 is added as a guardrail on 'high': prevents a false positive
        // where all activity comes from a single repeated session with no real book opened.
        //
        //   high   → ≥ 6 sessions AND ≥ 900 s (≈ 15 min) AND ≥ 1 book started
        //   medium → ≥ 2 sessions OR  ≥ 300 s (≈  5 min) — some activity
        //   low    → otherwise
        const { totalSessions, totalTimeSec, booksStarted } = ctx.reading;
        let readingHabit: SignalLevel;

        if (totalSessions >= 6 && totalTimeSec >= 900 && booksStarted >= 1) {
            readingHabit = 'high';
            notes.push(`readingHabit=high: ${totalSessions} sessions, ${totalTimeSec}s total, ${booksStarted} book(s) started`);
        } else if (totalSessions >= 2 || totalTimeSec >= 300) {
            readingHabit = 'medium';
            notes.push(`readingHabit=medium: ${totalSessions} sessions, ${totalTimeSec}s total`);
        } else {
            readingHabit = 'low';
            notes.push(`readingHabit=low: ${totalSessions} sessions, ${totalTimeSec}s total`);
        }

        // ── WRITING ENGAGEMENT ────────────────────────────────────────────────
        // Intentionally combines tasks + journal — a student may write more in one
        // than the other depending on their style; neither source alone is definitive.
        //
        //   high   → (textSubmissions ≥ 3 AND avgWordCount ≥ 30)   — rich task writing
        //            OR (textSubmissions ≥ 2 AND journalEntries ≥ 2) — cross-source evidence
        //   medium → textSubmissions ≥ 1 OR journalEntries ≥ 1       — some writing present
        //   low    → no text evidence in either source
        //
        // avgWordCount ≥ 30: deliberately low bar — a sentence or two is enough to signal
        // genuine text engagement (excludes near-empty submissions like single words).
        const { textSubmissions, avgWordCount } = ctx.tasks;
        const journalEntries = ctx.journal.entries;
        let writingEngagement: SignalLevel;

        const richTaskWriting    = textSubmissions >= 3 && avgWordCount >= 30;
        const crossSourceWriting = textSubmissions >= 2 && journalEntries >= 2;

        if (richTaskWriting || crossSourceWriting) {
            writingEngagement = 'high';
            notes.push(
                `writingEngagement=high: ${textSubmissions} text submissions (avg ${avgWordCount} words), ${journalEntries} journal entries`
            );
        } else if (textSubmissions >= 1 || journalEntries >= 1) {
            writingEngagement = 'medium';
            notes.push(
                `writingEngagement=medium: ${textSubmissions} text submissions, ${journalEntries} journal entries`
            );
        } else {
            writingEngagement = 'low';
            notes.push(`writingEngagement=low: no text submissions and no journal entries`);
        }

        // ── AUTONOMY ──────────────────────────────────────────────────────────
        // Interprets independent reading vs Leo-assisted reading.
        //
        // KEY RULE: Leo usage is NOT penalized on its own. Normal and moderate use
        // is healthy and expected. Only extreme imbalance (very high Leo relative to
        // almost no reading sessions) signals reduced autonomy.
        //
        // leoRatio = Leo events per reading session (proxy for reliance per session).
        //
        // Priority order (first match wins):
        //   1. low    → zero sessions AND zero Leo events — no engagement at all
        //   2. low    → leoRatio > 5 with at least 1 session — extreme dependence
        //               (> 5 Leo events per session indicates heavy scaffolding)
        //   3. high   → ≥ 5 sessions AND leoRatio ≤ 2 — reads often, modest Leo use
        //   4. medium → everything else (balanced, occasional, or ambiguous)
        const leoEvents = ctx.leoInteraction.totalEvents;
        const leoRatio  = totalSessions > 0 ? leoEvents / totalSessions : 0;
        let autonomy: SignalLevel;

        if (totalSessions === 0 && leoEvents === 0) {
            autonomy = 'low';
            notes.push(`autonomy=low: no reading sessions and no Leo interaction`);
        } else if (totalSessions > 0 && leoRatio > 5) {
            autonomy = 'low';
            notes.push(
                `autonomy=low: extreme Leo dependence — leoRatio=${leoRatio.toFixed(1)} events/session (threshold: >5)`
            );
        } else if (totalSessions >= 5 && leoRatio <= 2) {
            autonomy = 'high';
            notes.push(
                `autonomy=high: ${totalSessions} sessions, leoRatio=${leoRatio.toFixed(1)} events/session`
            );
        } else {
            autonomy = 'medium';
            notes.push(
                `autonomy=medium: ${totalSessions} sessions, ${leoEvents} Leo events (leoRatio=${leoRatio.toFixed(1)})`
            );
        }

        // ── CONSISTENCY ───────────────────────────────────────────────────────
        // Uses recency of most recent activity across reading, journal, tasks.
        //
        // NOTE: consistency is evaluated relative to current system time (Date.now()).
        // ctx.timeWindow is currently always 'lifetime' and does not filter the data.
        // Future versions may align recency thresholds with ctx.timeWindow boundaries
        // when time-scoped contexts (last_7d, last_30d) are introduced.
        //
        //   high   → ≥ 2 sources with activity in last 14 days — recent and multi-modal
        //   medium → ≥ 1 source with activity in last 30 days  — some recent engagement
        //   low    → no timestamps, or all activity older than 30 days
        const nowMs = Date.now();
        const daysSince = (iso?: string): number | null => {
            if (!iso) return null;
            const t = new Date(iso).getTime();
            return isNaN(t) ? null : Math.floor((nowMs - t) / 86_400_000);
        };

        const recencies = [
            daysSince(ctx.reading.lastSessionAt),
            daysSince(ctx.journal.lastEntryAt),
            daysSince(ctx.tasks.lastActivityAt),
        ].filter((d): d is number => d !== null);

        const recent14 = recencies.filter(d => d <= 14).length;
        const recent30 = recencies.filter(d => d <= 30).length;
        let consistency: SignalLevel;

        if (recent14 >= 2) {
            consistency = 'high';
            notes.push(`consistency=high: ${recent14} source(s) with activity in last 14 days`);
        } else if (recent30 >= 1) {
            consistency = 'medium';
            notes.push(`consistency=medium: ${recent30} source(s) with activity in last 30 days`);
        } else {
            consistency = 'low';
            notes.push(
                recencies.length === 0
                    ? `consistency=low: no activity timestamps available`
                    : `consistency=low: most recent activity older than 30 days`
            );
        }

        // ── meta.basedOn ──────────────────────────────────────────────────────
        // Constructed intentionally from the sources that actually contributed signal
        // data — not a copy of ctx.meta.sources (which reflects data presence, not
        // signal derivation). Deduplicated via Set.
        //
        // readingHabit     → 'reading'         (always, even if low)
        // writingEngagement→ 'tasks', 'journal' (only if evidence was non-zero)
        // autonomy         → 'reading', 'leo'  (leo only if events > 0)
        // consistency      → sources that had a parseable timestamp
        const basedOnSet = new Set<string>();

        // reading always consulted for readingHabit and autonomy
        basedOnSet.add('reading');

        // tasks consulted if text submissions were present
        if (textSubmissions > 0) basedOnSet.add('tasks');

        // journal consulted if entries were present
        if (journalEntries > 0) basedOnSet.add('journal');

        // leo consulted for autonomy if any events recorded
        if (leoEvents > 0) basedOnSet.add('leo');

        // consistency: add sources that had a parseable timestamp
        if (daysSince(ctx.reading.lastSessionAt)  !== null) basedOnSet.add('reading');
        if (daysSince(ctx.journal.lastEntryAt)    !== null) basedOnSet.add('journal');
        if (daysSince(ctx.tasks.lastActivityAt)   !== null) basedOnSet.add('tasks');

        return {
            readingHabit,
            writingEngagement,
            autonomy,
            consistency,
            meta: {
                basedOn: [...basedOnSet],
                notes,
            },
        };
    }

    /**
     * buildLeoAdvisorContext
     * ─────────────────────────────────────────────────────────────────────────
     * Bridges interpreted signals → structured pedagogical context.
     *
     * Takes:  StudentLongitudinalContext (raw data) + PedagogicalSignals (interpretation)
     * Builds: objectives (strengths/focus), factual evidence, confidence
     *
     * NATURE: deterministic — no AI, no text generation, no external calls.
     * CONTRACT:
     *   - Pure function: reads only from ctx and signals, no side effects.
     *   - Strengths/focus arrays may be empty (medium signals are neutral, not classified).
     *   - Evidence is numerical/structural — never interpretive language.
     *   - Confidence comes from ctx.meta.dataQuality (not re-derived).
     *   - meta.basedOn is inherited from signals.meta.basedOn (not re-derived from ctx).
     *   - Never throws.
     */
    buildLeoAdvisorContext(
        ctx:     StudentLongitudinalContext,
        signals: PedagogicalSignals
    ): LeoAdvisorContext {

        // ── EARLY EXIT: minimal data ───────────────────────────────────────────
        // No signal is reliable enough to classify — return empty objectives.
        if (ctx.meta.dataQuality === 'minimal') {
            return {
                studentId:  ctx.studentId,
                signals,
                objectives: { strengths: [], focus: [] },
                evidence:   { summary: ['No sufficient activity data'] },
                meta: {
                    confidence: 'low',
                    basedOn:    [],
                },
            };
        }

        // ── OBJECTIVES: signal → objective mapping ─────────────────────────────
        // high   → strength (observable positive behavior worth recognizing)
        // low    → focus    (area that would benefit from targeted attention)
        // medium → neutral  (insufficient signal to classify; deliberately excluded)
        //
        // The 4 signals map 1:1 to the 4 PedagogicalObjectives.
        // Canonical objective order (stable across all consumers):
        //   1. reading_habit  2. writing_expression  3. autonomy  4. consistency
        // classify() calls below must preserve this order — do not reorder them.
        const strengths: PedagogicalObjective[] = [];
        const focus:     PedagogicalObjective[] = [];

        const classify = (signal: SignalLevel, objective: PedagogicalObjective): void => {
            if      (signal === 'high') strengths.push(objective);
            else if (signal === 'low')  focus.push(objective);
            // medium: intentionally not classified
        };

        classify(signals.readingHabit,      'reading_habit');      // 1
        classify(signals.writingEngagement, 'writing_expression'); // 2
        classify(signals.autonomy,          'autonomy');           // 3
        classify(signals.consistency,       'consistency');        // 4

        // ── EVIDENCE SUMMARY ──────────────────────────────────────────────────
        // Short, factual lines from real ctx values. No interpretation.
        // Only non-zero sources are included. Capped to 5 items (contract).
        //
        // Evidence order is intentional:
        //   1. reading sessions + time + books started   — primary learning activity
        //   2. text submissions (or blob-only note)      — writing output from tasks
        //   3. journal entries + avg length              — reflective writing
        //   4. Leo interactions                          — support/scaffolding usage
        //   5. task completion rate                      — overall completion indicator
        // This order prioritizes primary activity before support and completion signals.
        const summary: string[] = [];

        if (ctx.reading.totalSessions > 0) {
            summary.push(
                `${ctx.reading.totalSessions} reading session(s), ` +
                `${ctx.reading.totalTimeSec}s total, ` +
                `${ctx.reading.booksStarted} book(s) started`
            );
        }

        if (ctx.tasks.textSubmissions > 0) {
            summary.push(
                `${ctx.tasks.textSubmissions} text submission(s), avg ${ctx.tasks.avgWordCount} words`
            );
        } else if (ctx.tasks.submitted > 0) {
            // Submitted but no text content (audio / video / photo only)
            summary.push(`${ctx.tasks.submitted} submission(s) — no text content`);
        }

        if (ctx.journal.entries > 0) {
            summary.push(
                `${ctx.journal.entries} journal entry/entries, avg ${ctx.journal.avgLength} chars`
            );
        }

        if (ctx.leoInteraction.totalEvents > 0) {
            summary.push(`${ctx.leoInteraction.totalEvents} Leo interaction(s)`);
        }

        if (ctx.tasks.total > 0 || ctx.tasks.submitted > 0) {
            // Show submitted/total when total is known; show submitted-only when total
            // appears inconsistent (submitted > total or total unexpectedly zero).
            const completionLine = ctx.tasks.total > 0
                ? `${ctx.tasks.submitted}/${ctx.tasks.total} assigned task(s) submitted`
                : `${ctx.tasks.submitted} submitted task(s) — total count unavailable`;
            summary.push(completionLine);
        }

        // Fallback: partial dataQuality but all values happened to be zero
        if (summary.length === 0) {
            summary.push('No activity data available for this student');
        }

        // Enforce contract: evidence.summary max 5 items.
        // Order is already intentional (see comment above); slice preserves priority.
        const finalSummary = summary.slice(0, 5);

        // ── CONFIDENCE ────────────────────────────────────────────────────────
        // Direct mapping from ctx.meta.dataQuality — no re-derivation.
        // NOTE: confidence currently reflects data source availability (how many
        // sources contributed data), NOT evidence richness, recency quality, or
        // pedagogical depth. Future versions may incorporate those dimensions.
        const confidenceMap = {
            full:    'high'    as const,
            partial: 'medium'  as const,
            minimal: 'low'     as const,
        };

        return {
            studentId:  ctx.studentId,
            signals,
            objectives: { strengths, focus },
            evidence:   { summary: finalSummary },
            meta: {
                confidence: confidenceMap[ctx.meta.dataQuality],
                basedOn:    [...signals.meta.basedOn],
            },
        };
    }

    /**
     * buildPedagogicalRecommendations
     * ─────────────────────────────────────────────────────────────────────────
     * Produces max 3 actionable recommendations from a LeoAdvisorContext.
     *
     * RULES:
     *   focus objectives     → type = 'develop', priority = high or medium
     *   strength objectives  → type = 'reinforce', priority = low
     *   medium objectives    → ignored (no recommendation generated)
     *
     * PRIORITY ASSIGNMENT:
     *   reading_habit  develop → high   (foundational behavior)
     *   consistency    develop → high   (recency gap affects all other signals)
     *   writing_expr   develop → medium (important but secondary)
     *   autonomy       develop → medium (nuanced; not always urgent)
     *   all reinforce          → low    (sustain, not urgency)
     *
     * CONFIDENCE GUARD:
     *   If advisor.meta.confidence === 'low', all 'high' priorities are downgraded
     *   to 'medium' — we do not make strong claims on unreliable data.
     *
     * NATURE: deterministic — no AI, no text generation, no external calls.
     * CONTRACT:
     *   - Returns 0–3 items (empty array is valid when all signals are medium).
     *   - Ordered by priority: high → medium → low.
     *   - Actions are Spanish, concrete, and observable.
     *   - Justifications are Spanish and factual — no speculation.
     *   - Never throws.
     */
    buildPedagogicalRecommendations(advisor: LeoAdvisorContext): PedagogicalRecommendation[] {

        // ── LOOKUP TABLES ─────────────────────────────────────────────────────
        // All text is Spanish (app language). Actions are specific and observable.
        // Justifications are factual statements grounded in the signal level.

        const DEVELOP_PRIORITY: Record<PedagogicalObjective, PedagogicalRecommendation['priority']> = {
            reading_habit:      'high',    // foundational; absence affects everything else
            writing_expression: 'medium',  // important but not as immediately blocking
            autonomy:           'medium',  // nuanced signal; avoid overstating urgency
            consistency:        'high',    // recency gap is the most actionable signal
        };

        const DEVELOP_ACTION: Record<PedagogicalObjective, string> = {
            reading_habit:
                'proponer al menos una sesión de lectura semanal con registro del tiempo invertido',
            writing_expression:
                'asignar una tarea breve de escritura reflexiva con pregunta guiada y frase iniciadora',
            // Leo is a tool, not a problem. Action emphasizes observation, not removal.
            autonomy:
                'proponer una sesión de lectura con uso limitado de Leo para observar el nivel de autonomía',
            consistency:
                'acordar días fijos de actividad con el estudiante y hacer seguimiento explícito la primera semana',
        };

        // Static fallback justifications (Spanish, factual, signal-level grounded).
        // Used when real values cannot be extracted from signal notes.
        const DEVELOP_JUSTIFICATION: Record<PedagogicalObjective, string> = {
            reading_habit:
                'frecuencia de sesiones de lectura y tiempo acumulado por debajo del nivel esperado',
            writing_expression:
                '0 entregas de texto y 0 entradas de bitácora registradas',
            autonomy:
                'actividad de lectura autónoma ausente o dependencia elevada del soporte Leo',
            consistency:
                'sin actividad reciente registrada en ninguna fuente de datos del estudiante',
        };

        const REINFORCE_ACTION: Record<PedagogicalObjective, string> = {
            reading_habit:
                'reconocer el hábito lector y proponer títulos de mayor complejidad o extensión',
            writing_expression:
                'proponer una consigna de escritura más abierta para expandir la expresión personal',
            autonomy:
                'mantener el nivel de autonomía actual e incorporar textos con mayor desafío cognitivo',
            consistency:
                'mantener la regularidad e incorporar variedad en los tipos de actividad propuestos',
        };

        // Static fallback justifications for reinforce recommendations.
        const REINFORCE_JUSTIFICATION: Record<PedagogicalObjective, string> = {
            reading_habit:
                'frecuencia de sesiones y tiempo de lectura en nivel sostenido',
            writing_expression:
                'entregas de texto regulares con extensión media adecuada o bitácora activa',
            autonomy:
                'sesiones de lectura frecuentes con uso moderado de Leo',
            consistency:
                'actividad reciente registrada en múltiples fuentes en los últimos 14 días',
        };

        const PRIORITY_ORDER: Record<PedagogicalRecommendation['priority'], number> = {
            high: 0, medium: 1, low: 2,
        };

        // ── CONFIDENCE GUARD ──────────────────────────────────────────────────
        // When data coverage is minimal, 'high' priority claims are unreliable.
        // Downgrade to 'medium' to avoid overstatement on thin evidence.
        const safePriority = (
            p: PedagogicalRecommendation['priority']
        ): PedagogicalRecommendation['priority'] => {
            return (advisor.meta.confidence === 'low' && p === 'high') ? 'medium' : p;
        };

        // ── GROUNDED JUSTIFICATION HELPER ─────────────────────────────────────
        // NOTE: signals.meta.notes is currently human-readable traceability.
        // Future versions may expose structured evidence objects to avoid string parsing.
        //
        // groundedJustification() tries three paths in order:
        //   1. advisor.evidence.summary — intentional presentation lines; preferred
        //      because they are produced for display and are less likely to change format
        //   2. advisor.signals.meta.notes — internal tracing strings; kept as fallback
        //      only; parsing is isolated here so it does not spread to other places
        //   3. static fallback text — always safe; used when both paths above fail

        // Helper: find the first evidence summary line containing a keyword
        const evLine = (keyword: string): string | undefined =>
            advisor.evidence.summary.find(l => l.includes(keyword));

        // Helper: strip "signalKey=level: " from a note and return the factual fragment.
        // Returns null if the note for this objective is absent.
        const noteData = (noteKey: string): string | null => {
            const note = advisor.signals.meta.notes?.find(n => n.startsWith(noteKey + '='));
            return note ? note.replace(/^[^:]+:\s*/, '').trim() : null;
        };

        const groundedJustification = (
            objective: PedagogicalObjective,
            fallback:  string
        ): string => {

            switch (objective) {

                case 'reading_habit': {
                    // PATH 1 — evidence: "N reading session(s), Ts total[, B book(s) started]"
                    const line = evLine('reading session');
                    if (line) {
                        const m = line.match(/^(\d+) reading session.*?(\d+)s total/);
                        if (m) return `${m[1]} sesiones de lectura con ${m[2]}s acumulados`;
                    }
                    // PATH 2 — note fallback: "N sessions, Ts total"
                    const data = noteData('readingHabit');
                    if (data) {
                        const m = data.match(/^(\d+) sessions, (\d+)s total/);
                        if (m) return `${m[1]} sesiones de lectura con ${m[2]}s acumulados`;
                    }
                    break;
                }

                case 'writing_expression': {
                    // PATH 1 — evidence: "N text submission(s), avg W words"
                    //                 + "N journal entry/entries, avg L chars"
                    // Both lines are optional; missing lines default to 0.
                    const textLine    = evLine('text submission');
                    const journalLine = evLine('journal entry');
                    const noTextLine  = evLine('no text content'); // blob-only submissions

                    const textCount    = textLine?.match(/^(\d+)/)?.[1];
                    const journalCount = journalLine?.match(/^(\d+)/)?.[1];

                    if (textCount !== undefined || journalCount !== undefined) {
                        return `${textCount ?? '0'} entrega(s) de texto y ${journalCount ?? '0'} entrada(s) de bitácora registradas`;
                    }

                    // No text submissions at all — check for blob-only case
                    if (noTextLine) {
                        const m = noTextLine.match(/^(\d+)/);
                        if (m) return `${m[1]} entrega(s) sin texto escrito y 0 entrada(s) de bitácora`;
                    }

                    // PATH 2 — note fallback: "N text submissions…J journal entries"
                    const data = noteData('writingEngagement');
                    if (data) {
                        if (data.includes('no text submissions'))
                            return '0 entregas de texto y 0 entradas de bitácora registradas';
                        const m = data.match(/(\d+) text submissions.*?(\d+) journal entries/);
                        if (m) return `${m[1]} entrega(s) de texto y ${m[2]} entrada(s) de bitácora registradas`;
                    }
                    break;
                }

                case 'autonomy': {
                    // PATH 1 — evidence: compute from reading sessions + Leo interaction counts.
                    // Avoids note parsing entirely by doing arithmetic on structured numbers.
                    const readingLine = evLine('reading session');
                    const leoLine     = evLine('Leo interaction');

                    const nSessions = readingLine ? parseInt(readingLine.match(/^(\d+)/)?.[1] ?? '0', 10) : 0;
                    const nLeo      = leoLine     ? parseInt(leoLine.match(/^(\d+)/)?.[1]     ?? '0', 10) : 0;

                    if (nSessions === 0 && nLeo === 0)
                        return 'sin sesiones de lectura ni interacción con Leo registradas';

                    if (nSessions > 0) {
                        const ratio = (nLeo / nSessions).toFixed(1);
                        return `${nSessions} sesiones con ratio Leo de ${ratio} eventos/sesión`;
                    }

                    if (nLeo > 0)
                        return `${nLeo} interacciones Leo sin sesiones de lectura registradas`;

                    // PATH 2 — note fallback (only reached if evidence lines were missing)
                    const data = noteData('autonomy');
                    if (data) {
                        if (data.includes('no reading sessions'))
                            return 'sin sesiones de lectura ni interacción con Leo registradas';
                        const mRatio = data.match(/leoRatio=([\d.]+)/);
                        if (mRatio) return `dependencia elevada de Leo (${mRatio[1]} eventos/sesión)`;
                    }
                    break;
                }

                case 'consistency': {
                    // PATH 1 — no evidence line exists for consistency (timestamps are not
                    // included in evidence.summary). Note parsing is primary for this objective.
                    // PATH 2 — note parsing (primary here, not fallback)
                    const data = noteData('consistency');
                    if (data) {
                        if (data.includes('no activity timestamps'))
                            return 'sin fechas de actividad registradas';
                        if (data.includes('older than 30 days'))
                            return 'actividad más reciente con más de 30 días de antigüedad';
                        const m = data.match(/^(\d+) source/);
                        if (m) return `${m[1]} fuente(s) con actividad reciente registrada`;
                    }
                    break;
                }
            }

            // PATH 3 — static fallback (always safe)
            return fallback;
        };

        // ── BUILD RECOMMENDATIONS ─────────────────────────────────────────────
        // Each recommendation is tied to a PedagogicalObjective.
        // This enables grouping and narrative synthesis in Leo (future layer).
        //
        // Objectives arrive in canonical order (reading_habit → writing_expression
        // → autonomy → consistency) because buildLeoAdvisorContext preserves it.
        const recs: PedagogicalRecommendation[] = [];

        for (const obj of advisor.objectives.focus) {
            recs.push({
                objective:     obj,
                type:          'develop',
                priority:      safePriority(DEVELOP_PRIORITY[obj]),
                action:        DEVELOP_ACTION[obj],
                justification: groundedJustification(obj, DEVELOP_JUSTIFICATION[obj]),
            });
        }

        for (const obj of advisor.objectives.strengths) {
            recs.push({
                objective:     obj,
                type:          'reinforce',
                priority:      'low',    // reinforce is never urgent
                action:        REINFORCE_ACTION[obj],
                justification: groundedJustification(obj, REINFORCE_JUSTIFICATION[obj]),
            });
        }

        // ── SORT + CAP ────────────────────────────────────────────────────────
        // Sort by priority (high → medium → low); secondary sort preserves canonical
        // objective order within the same priority tier (stable because focus always
        // precedes strengths, and both iterate in canonical order).
        recs.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

        return recs.slice(0, 3);
    }

    /**
     * buildLeoSuggestion
     * ─────────────────────────────────────────────────────────────────────────
     * Final layer: converts structured pedagogical data into a short, teacher-
     * facing narrative. The output is a synthesis, not a generation — Leo only
     * reorganizes what the structured layers already established.
     *
     * INPUTS:
     *   advisor         — LeoAdvisorContext (objectives, evidence, confidence)
     *   recommendations — PedagogicalRecommendation[] (actions + justifications)
     *
     * NATURE: deterministic — no AI, no free text generation.
     * CONTRACT:
     *   - summary: 1–2 sentences; neutral, factual, no diagnosis.
     *   - recommendations: max 3 action lines with brief parenthetical justification.
     *   - evidence: reused / lightly translated from advisor.evidence.summary.
     *   - Introduces NO new insights or data not already present in inputs.
     *   - Never throws.
     *
     * TONE RULES:
     *   - Neutral and professional — no judgment, no motivational language.
     *   - Teacher-oriented — addresses the mediator, not the student.
     *   - Spanish throughout.
     */
    buildLeoSuggestion(
        advisor:         LeoAdvisorContext,
        recommendations: PedagogicalRecommendation[]
    ): LeoSuggestion {

        // ── OBJECTIVE LABELS (Spanish) ────────────────────────────────────────
        const LABEL: Record<PedagogicalObjective, string> = {
            reading_habit:      'hábito lector',
            writing_expression: 'expresión escrita',
            autonomy:           'autonomía lectora',
            consistency:        'regularidad de actividad',
        };

        // ── EVIDENCE TRANSLATION ──────────────────────────────────────────────
        // Lightly translates advisor.evidence.summary lines to Spanish.
        // Uses exact-format matching (lines are produced by buildLeoAdvisorContext).
        // Unknown lines are passed through unchanged — no data is invented.

        // Proper Spanish pluralization helper.
        // Returns "N singular" or "N plural" based on n.
        const pl = (n: number, singular: string, plural: string): string =>
            `${n} ${n === 1 ? singular : plural}`;

        const translateLine = (line: string): string => {
            let m: RegExpMatchArray | null;

            // "N reading session(s), Ts total, B book(s) started"
            m = line.match(/^(\d+) reading session\(s\), (\d+)s total, (\d+) book\(s\) started$/);
            if (m) {
                const sessions = pl(+m[1], 'sesión', 'sesiones');
                const books    = pl(+m[3], 'libro iniciado', 'libros iniciados');
                return `${sessions} de lectura (${m[2]} s) — ${books}`;
            }

            // "N text submission(s), avg W words"
            m = line.match(/^(\d+) text submission\(s\), avg (\d+) words$/);
            if (m) return `${pl(+m[1], 'entrega', 'entregas')} de texto (prom. ${m[2]} palabras)`;

            // "N submission(s) — no text content"
            m = line.match(/^(\d+) submission\(s\) — no text content$/);
            if (m) return `${pl(+m[1], 'entrega', 'entregas')} sin texto escrito`;

            // "N journal entry/entries, avg L chars"
            m = line.match(/^(\d+) journal entry\/entries, avg (\d+) chars$/);
            if (m) return `${pl(+m[1], 'entrada', 'entradas')} de bitácora (prom. ${m[2]} caracteres)`;

            // "N Leo interaction(s)"
            m = line.match(/^(\d+) Leo interaction\(s\)$/);
            if (m) return `${pl(+m[1], 'interacción', 'interacciones')} con Leo`;

            // "N/M assigned task(s) submitted"
            m = line.match(/^(\d+)\/(\d+) assigned task\(s\) submitted$/);
            if (m) {
                const taskWord = +m[1] === 1 ? 'tarea asignada completada' : 'tareas asignadas completadas';
                return `${m[1]}/${m[2]} ${taskWord}`;
            }

            // "N submitted task(s) — total count unavailable"
            m = line.match(/^(\d+) submitted task\(s\) — total count unavailable$/);
            if (m) return `${pl(+m[1], 'tarea entregada', 'tareas entregadas')} (total no disponible)`;

            // Pass through unknown lines unchanged
            return line;
        };

        const translatedEvidence = advisor.evidence.summary.map(translateLine).slice(0, 5);

        // ── EDGE CASE: minimal confidence ─────────────────────────────────────
        // Insufficient data to make any reliable claim — say so honestly.
        if (advisor.meta.confidence === 'low') {
            return {
                summary:         'No hay suficiente información para generar una recomendación sólida.',
                recommendations: [],
                evidence:        translatedEvidence.length > 0
                                     ? translatedEvidence
                                     : ['Sin datos de actividad suficientes'],
            };
        }

        // ── EDGE CASE: no recommendations ─────────────────────────────────────
        // All signals were medium — no clear gap or strength to act on.
        if (recommendations.length === 0) {
            return {
                summary:         'El estudiante presenta un comportamiento equilibrado sin áreas prioritarias de intervención.',
                recommendations: [],
                evidence:        translatedEvidence,
            };
        }

        // ── SUMMARY CONSTRUCTION ──────────────────────────────────────────────
        // Two-sentence structure:
        //   Sentence 1 — describes the observed situation (what the data shows)
        //   Sentence 2 — frames the action direction (what the teacher should consider)
        //
        // Driven by advisor.objectives (not by recommendations list) so the summary
        // reflects the full pedagogical picture, not just the first recommendation.
        //
        // VARIANT SELECTION: deterministic, based on studentId character sum mod 2.
        // Same studentId always produces the same variant — no randomness.
        // Variants share identical meaning; only phrasing differs.
        const { strengths, focus } = advisor.objectives;

        const focusStr    = focus.map(o => LABEL[o]).join(' y ');
        const strengthStr = strengths.map(o => LABEL[o]).join(' y ');

        const idVariant = advisor.studentId
            .split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 2;

        let summary: string;

        if (strengths.length === 0 && focus.length > 0) {
            // Only gaps — development needed
            summary = idVariant === 0
                ? `Se observa baja actividad en ${focusStr}. Conviene establecer acciones específicas en estas dimensiones.`
                : `El estudiante muestra poca actividad en ${focusStr}. Se recomienda atención focalizada en estas áreas.`;

        } else if (focus.length === 0 && strengths.length > 0) {
            // Only strengths — doing well
            summary = idVariant === 0
                ? `El estudiante muestra actividad sostenida en ${strengthStr}. Se sugiere aumentar gradualmente el nivel de desafío.`
                : `Se observa un comportamiento positivo en ${strengthStr}. Puede ser el momento de ampliar el nivel de exigencia.`;

        } else {
            // Mixed: some strengths, some gaps
            summary = idVariant === 0
                ? `Se observa actividad positiva en ${strengthStr}, con oportunidad de desarrollo en ${focusStr}. Se recomienda aprovechar las fortalezas como punto de partida.`
                : `El estudiante muestra avances en ${strengthStr}, con áreas por fortalecer en ${focusStr}. Conviene partir de lo que ya funciona bien.`;
        }

        // ── RECOMMENDATION LINES ──────────────────────────────────────────────
        // Each line: capitalize(action) + (justification) in parentheses.
        // Justification is already grounded in real evidence (from buildPedagogicalRecommendations).
        //
        // FUTURE: recommendation.justification is directly traceable to evidence lines.
        // UI layer may highlight matching evidence fragments.
        const capitalize = (s: string): string =>
            s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;

        const recLines = recommendations.slice(0, 3).map(r =>
            `${capitalize(r.action)} (${r.justification})`
        );

        return {
            summary,
            recommendations: recLines,
            evidence:        translatedEvidence,
        };
    }

    getTeacherGroups(userId: string): Group[] {
        const user = this.getUsuarioById(userId);
        return this.groups.filter(g =>
            this.getGroupMediatorIds(g).includes(userId) || // FASE 2 COMPATIBILITY
            (user?.groupIds && user.groupIds.includes(g.id))
        );
    }

    // --- SECTIONS & FILTERING ---
    async getSections(): Promise<Section[]> {
        try {
            // v4.0.5 hotfix: defensivo — mismo patrón.
            const res = await fetch(`${this.apiUrl}/sections`, { headers: this.adminWriteHeaders });
            return res.ok ? res.json() : [];
        } catch (e) {
            console.error('Error fetching sections:', e);
            return [];
        }
    }

    async saveSection(section: Section): Promise<Section> {
        const isNew = !section.id || section.id.startsWith('temp');
        const url = isNew ? `${this.apiUrl}/sections` : `${this.apiUrl}/sections/${section.id}`;
        const method = isNew ? 'POST' : 'PUT';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(section)
        });
        if (!res.ok) throw new Error('Failed to save section');
        return res.json();
    }

    async deleteSection(id: string): Promise<void> {
        await fetch(`${this.apiUrl
            } / sections / ${id} `, {
            method: 'DELETE',
            headers: { ...this.adminWriteHeaders }
        });
    }

    async getSchoolConfig(schoolName: string): Promise<SchoolConfig> {
        try {
            // v4.0.4 hotfix (5º fix): mismo patrón que initializeUsersAndGroupsFromApi —
            // este GET sin headers devuelve 401 post-v4.0.3 (GET-bypass cerrado),
            // dejando schoolConfigsCache vacío y degradando el access engine por org
            // (getOrganizationAccess cae al fallback 'all' cuando el cache está frío).
            const res = await fetch(`${this.apiUrl}/schools/${encodeURIComponent(schoolName)}/config`, { headers: this.adminWriteHeaders });
            if (res.ok) {
                const config = await res.json();
                // Fase E4: guardar con timestamp de inserción para TTL
                this.schoolConfigsCache.set(schoolName, { config, cachedAt: this.getReliableNow() });
                return config;
            }
        } catch (e) {
            console.error('Error fetching school config', e);
        }
        const defaultConfig = { schoolName, hiddenContentIds: [] };
        // Fase E4: el defaultConfig también se cachea con timestamp (TTL normal)
        this.schoolConfigsCache.set(schoolName, { config: defaultConfig, cachedAt: this.getReliableNow() });
        return defaultConfig;
    }

    async saveSchoolConfig(config: SchoolConfig): Promise<SchoolConfig> {
        const res = await fetch(`${this.apiUrl}/schools/${encodeURIComponent(config.schoolName)}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.adminWriteHeaders },
            body: JSON.stringify(config)
        });
        if (!res.ok) throw new Error('Failed to save school config');
        const savedConfig = await res.json();
        // Fase E4: guardar con timestamp fresco — un save siempre refresca el TTL
        this.schoolConfigsCache.set(config.schoolName, { config: savedConfig, cachedAt: this.getReliableNow() });
        return savedConfig;
    }

}

export const dataService = new DataService();
