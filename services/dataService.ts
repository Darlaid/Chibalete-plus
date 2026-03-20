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
    Group,
    JournalEntry,
    Section,
    SchoolConfig,
    OralityAttempt,
    ImportRowError,
    School
} from '../types';
import { persistenceService } from './persistenceService';

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

    // Phase 3.4 Sync Engine
    private pendingSyncs: Map<string, ProgresoLectura> = new Map();
    private lastSyncedPayloads: Map<string, string> = new Map();
    private syncInterval: NodeJS.Timeout | null = null;
    private currentSessionId: string = crypto.randomUUID();
    private sessionStartTimeMs: number = Date.now();

    /**
     * Fase E3 — Árbitro temporal del servidor.
     * Offset en ms entre el reloj del servidor y el reloj local del cliente.
     * Valor 0 = sin sincronizar (fallback a Date.now() del cliente).
     * Positivo = servidor adelantado; negativo = servidor atrasado.
     */
    private serverTimeOffset: number = 0;
    private serverTimeSynced: boolean = false;

    private apiUrl = '/api';

    private initializationPromise: Promise<void>;

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

        // FALLBACK ADMIN FOR LOCAL DEV
        if (!this.users.find(u => u.email === 'admin@chibalete.com')) {
            console.log("Injecting fallback admin user");
            this.users.push({
                id: 'admin-1',
                nombre_usuario: 'admin',
                nombre_completo: 'Administrador Local',
                email: 'admin@chibalete.com',
                password: 'chibalete123',
                roles: ['administrador'],
                colegio: 'Chibalete',
                curso: 'Staff',
                fecha_nacimiento: '1990-01-01',
                avatar_url: '',
                bio_corta: 'Admin de sistema',
                libros_leidos: 0,
                seguidores: 0,
                seguidos: 0,
                nivel_lectura: 'Feroz',
                fecha_registro: new Date().toISOString(),
                progreso: {},
                puntos: 0,
                nivel_inmersivo: 1,
                daily_shared_words: 0
            } as any);
        }
        
        this.startSyncEngine();
    }


    public waitForInitialization(): Promise<void> {
        return this.initializationPromise;
    }


    // Default admin creation removed for production cleanup


    // --- SYNC ENGINE (Phase 3.4) ---
    private startSyncEngine() {
        if (typeof window !== 'undefined' && !this.syncInterval) {
            // Buffer flush every 15s
            this.syncInterval = setInterval(() => this.flushSync(), 15000);

            // Terminal flush on close or hide
            window.addEventListener('beforeunload', () => this.flushSync(true));
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this.flushSync(true);
            });
        }
    }

    public forceFlush() {
        this.flushSync(true);
    }

    private flushSync(isTerminal = false) {
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

            if ('sendBeacon' in navigator) {
                const url = `${this.apiUrl}/progress/${usuario_id}/${contenido_id}/sync`;
                const blob = new Blob([hash], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
            } else if (!isTerminal) { // fetch is cancelled on terminal exit, fallback only if active
                fetch(`${this.apiUrl}/progress/${usuario_id}/${contenido_id}/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: hash
                }).catch(err => console.warn('[Sync] Flush failed:', err));
            }

            this.lastSyncedPayloads.set(key, hash);
        });

        this.pendingSyncs.clear();
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
            const response = await fetch(`${this.apiUrl}/content`);
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
            const usersRes = await fetch(`${this.apiUrl}/users`, { headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' } });
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
            const groupsRes = await fetch(`${this.apiUrl}/groups`, { headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' } });
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
            const schoolsRes = await fetch(`${this.apiUrl}/schools`, { headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' } });
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

    // --- SYNC METHODS ---
    async syncUserProgress(userId: string) {
        try {
            const res = await fetch(`${this.apiUrl}/progress/user/${userId}`);
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
    async uploadFile(file: File, parentId?: string): Promise<string> {
        const formData = new FormData();
        // Still append to body just in case, but Query is primary for Multer
        if (parentId) {
            formData.append('parentId', parentId);
        }
        formData.append('file', file);

        const url = parentId ? `${this.apiUrl}/upload?parentId=${encodeURIComponent(parentId)}` : `${this.apiUrl}/upload`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'x-admin-secret': 'chibalete-secure-upload-2025'
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Upload failed');
        }

        const data = await response.json();
        return data.url; // Returns /uploads/filename.ext
    }

    // W1: Best-effort orphan cleanup. Called from SubirContenido when metadata save fails
    // after files were already uploaded. Fire-and-forget — failures are silently ignored.
    async purgeOrphanFile(url: string): Promise<void> {
        try {
            await fetch(`${this.apiUrl}/upload/purge`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-secret': 'chibalete-secure-upload-2025'
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
        const response = await fetch(`${this.apiUrl}/content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-secret': 'chibalete-secure-upload-2025'
            },
            body: JSON.stringify(contentItem)
        });

        if (!response.ok) {
            throw new Error('Failed to save content metadata');
        }

        // Update local state immediately
        this.agregarContenido(contentItem);
    }

    async deleteContent(id: string): Promise<void> {
        const response = await fetch(`${this.apiUrl}/content/${id}`, {
            method: 'DELETE',
            headers: {
                'x-admin-secret': 'chibalete-secure-upload-2025'
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
        const response = await fetch(`${this.apiUrl}/content/${id}/retry`, {
            method: 'POST',
            headers: {
                'x-admin-secret': 'chibalete-secure-upload-2025'
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
        // God Mode for Local Dev
        if (email === 'admin@chibalete.com' && password === 'chibalete123') {
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
                return undefined; // Invalid credentials confirmed by server
            }
        } catch (e) {
            console.warn('Server auth failed, falling back to local:', e);
        }

        // 2. Fallback to Local (Offline)
        return this.users.find(u => u.email === email && (password ? u.password === password : true));
    }

    async crearUsuariosMasivos(newUsers: any[]): Promise<{ created: number; duplicates: number; errors: ImportRowError[] }> {
        const errors: ImportRowError[] = [];
        let created = 0;
        let duplicates = 0;

        // Procesar de a uno con await para evitar escrituras concurrentes en users_db.json
        for (const u of newUsers) {
            try {
                // Mapear rol 'mediador' → 'profesor' (único valor aceptado por el backend)
                let roles: ('lector' | 'profesor' | 'administrador')[] = ['lector'];
                if (u.roles && Array.isArray(u.roles)) {
                    roles = u.roles;
                } else if (typeof u.role === 'string') {
                    const r = u.role.toLowerCase().trim();
                    roles = r === 'mediador' || r === 'profesor' ? ['profesor'] : ['lector'];
                }

                const newUserObj = await this.createUser({
                    nombre_completo: u.nombre_completo || u.nombre || '',
                    email: u.email || '',
                    password: u.password || 'chibalete123', // Usa la password del CSV
                    colegio: u.colegio || '',
                    curso: u.curso || '',
                    roles,
                });

                // HOTFIX: Relación automática con Clases/Grupos para Aula Viva
                if (newUserObj.colegio && newUserObj.curso) {
                    const gradeName = newUserObj.curso.trim();
                    const schoolName = newUserObj.colegio.trim();
                    
                    // 1. Buscar grupo existente
                    let targetGroup = this.groups.find(g => 
                        g.school && g.grade && 
                        g.school.toLowerCase() === schoolName.toLowerCase() && 
                        g.grade.toLowerCase() === gradeName.toLowerCase()
                    );

                    // 2. Si no existe, crearlo
                    if (!targetGroup) {
                        try {
                            targetGroup = await this.createGroup({
                                name: `${gradeName} - ${schoolName}`,
                                school: schoolName,
                                grade: gradeName,
                            });
                        } catch (err) {
                            console.warn('Error al auto-crear grupo', err);
                        }
                    }

                    // 3. Emparejamiento bidireccional
                    if (targetGroup) {
                        const isTeacher = newUserObj.roles.includes('profesor') || newUserObj.roles.includes('administrador');
                        let groupNeedsUpdate = false;

                        if (isTeacher) {
                            // Asignar al mediador — mediatorIds es el campo canónico
                            if (!targetGroup.mediatorIds?.includes(newUserObj.id)) {
                                targetGroup.mediatorIds = [newUserObj.id];
                                groupNeedsUpdate = true;
                            }
                        } else {
                            // Asignar al estudiante matriculado
                            if (!targetGroup.studentIds) targetGroup.studentIds = [];
                            if (!targetGroup.studentIds.includes(newUserObj.id)) {
                                targetGroup.studentIds.push(newUserObj.id);
                                targetGroup.memberIds = [...targetGroup.studentIds];
                                groupNeedsUpdate = true;
                            }
                        }

                        if (groupNeedsUpdate) {
                            await this.updateGroup(targetGroup.id, targetGroup);
                        }

                        // Vincular GroupID dentro del perfil del Usuario
                        if (!newUserObj.groupIds) newUserObj.groupIds = [];
                        if (!newUserObj.groupIds.includes(targetGroup.id)) {
                            newUserObj.groupIds.push(targetGroup.id);
                            await this.updateUser(newUserObj.id, { groupIds: newUserObj.groupIds });
                        }
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
            social_connections: { facebook: false, instagram: false, linkedin: false }
        };

        // SYNC TO BACKEND FIRST
        const response = await fetch(`${this.apiUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
            body: JSON.stringify(newUser)
        });

        if (!response.ok) {
            if (response.status === 409) {
                throw new Error('El usuario ya existe (Email o ID duplicado).');
            }
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to create user on server');
        }

        // Only update local state if successful
        this.users.push(newUser);
        this.saveState('users', this.users);

        return newUser;
    }

    async updateUser(id: string, updates: Partial<User>) {
        const response = await fetch(`${this.apiUrl}/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
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
            headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' }
        });

        if (!response.ok) {
            throw new Error('Failed to delete user on server');
        }

        const idx = this.users.findIndex(u => u.id === id);
        if (idx > -1) {
            this.users.splice(idx, 1);
            this.saveState('users', this.users);
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
                        headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
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
                        headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
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
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
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

    getGroupsByColegio(colegio: string): Group[] {
        return this.groups.filter(g => g.school === colegio);
    }

    // --- LEO COMPATIBILITY LAYER (Phase 2) ---
    getGroupMediatorIds(group: Group): string[] {
        // Backend es fuente de verdad; solo garantizar que devolvemos un array
        return Array.isArray(group.mediatorIds) ? group.mediatorIds : [];
    }

    getGroupMemberIds(group: Group): string[] {
        // Backend es fuente de verdad; solo garantizar que devolvemos un array
        return Array.isArray(group.memberIds) ? group.memberIds : [];
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
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
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

    async updateGroup(id: string, updates: Partial<Group>) {
        const group = this.groups.find(g => g.id === id);

        // mediatorIds es el campo canónico. Derivar teacherId para compat backend.
        if (updates.mediatorIds !== undefined) {
            updates.teacherId = updates.mediatorIds[0] ?? null;
        }

        // Mantener studentIds sincronizado con memberIds (compat backend)
        if (updates.studentIds !== undefined && !updates.memberIds) {
            updates.memberIds = updates.studentIds;
        } else if (updates.memberIds !== undefined && updates.studentIds === undefined) {
            updates.studentIds = updates.memberIds;
        }

        // --- PREPARAR DIFF PHASE 3A PARA CASCADA ---
        let addedUsers: string[] = [];
        let removedUsers: string[] = [];
        
        if (group) {
            const prevMediators = this.getGroupMediatorIds(group);
            const prevMembers = this.getGroupMemberIds(group);
            
            const nextGroupMerged = { ...group, ...updates };
            const nextMediators = this.getGroupMediatorIds(nextGroupMerged);
            const nextMembers = this.getGroupMemberIds(nextGroupMerged);

            const addedMed = nextMediators.filter(userId => !prevMediators.includes(userId));
            const addedMem = nextMembers.filter(userId => !prevMembers.includes(userId));
            
            const removedMed = prevMediators.filter(userId => !nextMediators.includes(userId));
            const removedMem = prevMembers.filter(userId => !nextMembers.includes(userId));

            addedUsers = [...new Set([...addedMed, ...addedMem])];
            removedUsers = [...new Set([...removedMed, ...removedMem])];
        }
        
        const response = await fetch(`${this.apiUrl}/groups/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            throw new Error('Failed to update group on server');
        }

        // Fase Modelo Extendido: usar la respuesta ya merges y normalizada por el backend
        const savedGroup = await response.json();
        const finalGroup = this.normalizeGroupFrontend(savedGroup);

        const idx = this.groups.findIndex(g => g.id === id);
        if (idx > -1) {
            // Apply updates locally using the server truth
            this.groups[idx] = finalGroup;
            this.saveState('groups', this.groups);

            // --- EJECUTAR CASCADA (Evitar accesos fantasma y orfandad) ---
            const finalGroupState = this.groups[idx];
            const finalMed = this.getGroupMediatorIds(finalGroupState);
            const finalMem = this.getGroupMemberIds(finalGroupState);

            addedUsers.forEach(userId => {
                const u = this.getUsuarioById(userId);
                if (u) {
                    if (!u.groupIds) u.groupIds = [];
                    if (!u.groupIds.includes(id)) {
                        u.groupIds.push(id);
                        this.updateUser(u.id, { groupIds: u.groupIds });
                    }
                }
            });

            removedUsers.forEach(userId => {
                // Remoción segura extrema: solo si ya no existe ni como mediador ni como miembro
                if (!finalMed.includes(userId) && !finalMem.includes(userId)) {
                    const u = this.getUsuarioById(userId);
                    if (u && u.groupIds) {
                        u.groupIds = u.groupIds.filter(gid => gid !== id);
                        this.updateUser(u.id, { groupIds: u.groupIds });
                    }
                }
            });
            // -------------------------------------------------------------
        }
    }

    async deleteGroup(id: string) {
        const response = await fetch(`${this.apiUrl}/groups/${id}`, {
            method: 'DELETE',
            headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' }
        });

        if (!response.ok) {
            throw new Error('Failed to delete group on server');
        }

        const idx = this.groups.findIndex(g => g.id === id);
        if (idx > -1) {
            this.groups.splice(idx, 1);
            this.saveState('groups', this.groups);
        }
    }

    assignTeacherToGroup(groupId: string, teacherId: string) {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            // mediatorIds-first: recalcular array canónico
            const currentMediators = Array.isArray(group.mediatorIds) ? group.mediatorIds : [];
            const oldPrimaryId = currentMediators[0] ?? null;
            const rest = currentMediators.filter(mId => mId !== oldPrimaryId && mId !== teacherId);
            group.mediatorIds = [teacherId, ...rest];
            group.teacherId = group.mediatorIds[0]; // derivado, no input primario

            this.saveState('groups', this.groups);

            // 1. Vincular al profesor entrante
            const newUser = this.getUsuarioById(teacherId);
            if (newUser) {
                if (!newUser.groupIds) newUser.groupIds = [];
                if (!newUser.groupIds.includes(groupId)) {
                    newUser.groupIds.push(groupId);
                    this.updateUser(newUser.id, { groupIds: newUser.groupIds });
                }
            }

            // 2. Desvincular al mediador saliente de manera segura
            if (oldPrimaryId && oldPrimaryId !== teacherId) {
                const isStillMediating = group.mediatorIds.includes(oldPrimaryId);
                const isStudent = group.studentIds && group.studentIds.includes(oldPrimaryId);

                if (!isStillMediating && !isStudent) {
                    const oldUser = this.getUsuarioById(oldPrimaryId);
                    if (oldUser && oldUser.groupIds) {
                        oldUser.groupIds = oldUser.groupIds.filter(id => id !== groupId);
                        this.updateUser(oldUser.id, { groupIds: oldUser.groupIds });
                    }
                }
            }

            // SYNC — solo mediatorIds como campo canónico (teacherId se deriva en updateGroup)
            this.updateGroup(groupId, { mediatorIds: group.mediatorIds });
        }
    }

    addStudentsToGroup(groupId: string, studentIds: string[]) {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            // Add only unique IDs not already in the group
            const newIds = studentIds.filter(id => !group.studentIds.includes(id));
            group.studentIds.push(...newIds);
            group.memberIds = [...group.studentIds]; // SYNC FASE 2
            this.saveState('groups', this.groups);

            // Also update the User objects to reflect this
            studentIds.forEach(sid => {
                const u = this.getUsuarioById(sid);
                if (u) {
                    if (!u.groupIds) u.groupIds = [];
                    if (!u.groupIds.includes(groupId)) {
                        u.groupIds.push(groupId);
                        this.updateUser(u.id, { groupIds: u.groupIds }); // Will sync user
                    }
                }
            });

            // Trigger sync for group
            this.updateGroup(groupId, { studentIds: group.studentIds, memberIds: group.memberIds });
        }
    }

    removeStudentFromGroup(groupId: string, studentId: string) {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.studentIds = group.studentIds.filter(id => id !== studentId);
            group.memberIds = [...group.studentIds]; // SYNC FASE 2
            this.saveState('groups', this.groups);

            const u = this.getUsuarioById(studentId);
            if (u && u.groupIds) {
                u.groupIds = u.groupIds.filter(gid => gid !== groupId);
                this.updateUser(u.id, { groupIds: u.groupIds }); // Will sync user
            }

            // Trigger sync for group
            this.updateGroup(groupId, { studentIds: group.studentIds, memberIds: group.memberIds });
        }
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
        // Filter out admin-only content like contexto_pedagogico if not an admin
        const isAdmin = roles.includes('administrador');
        let baseContent = isAdmin ? this.content : this.content.filter(c => c.tipo !== 'contexto_pedagogico');

        // FASE 5: Filtro de catálogo por usuario
        if (checkAccessForUserId && !isAdmin && !roles.includes('profesor')) {
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
        if (!user || user.roles.includes('administrador') || user.roles.includes('profesor')) {
            return 'all'; // Profesores y admins ven todo por defecto
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
            const res = await fetch(`${this.apiUrl}/access/by-user/${userId}`, {
                headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' }
            });
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
        // --- ADMIN BYPASS ---
        const user = this.getUsuarioById(userId);
        if (user && (user.roles?.includes('administrador') || user.roles?.includes('profesor'))) {
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
        // si un profesor Asignó explícitamente contenido a un usuario, no se bloquea en Aula Viva.
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
                'x-admin-secret': 'chibalete-secure-upload-2025'
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

    getContenidosHijos(parentId: string, roles: string[] = []): Content[] {
        const isAdmin = roles.includes('administrador');
        return this.content.filter(c => c.parentId === parentId && (isAdmin || c.tipo !== 'contexto_pedagogico'));
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
            if (roles.includes('administrador') || roles.includes('profesor') || this.isContentAccessibleForUser(userId, content.id)) {
                 return { content, progress: p };
            }
            return null;
        }).filter(item => item !== null) as { content: Content, progress: ProgresoLectura }[];
    }

    getProgresoUsuarioLibro(userId: string, contentId: string): ProgresoLectura | undefined {
        return this.progress.find(p => p.usuario_id === userId && p.contenido_id === contentId);
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
        metricsPatch?: { lastMode?: ProgresoLectura['lastMode']; elapsedMs?: number }
    ) {
        let prog = this.progress.find(p => p.usuario_id === userId && p.contenido_id === contentId);
        // Fallback for visual mapping (0-100)
        const porcentaje = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0;
        
        // Phase 3.3 Canonical Formatting
        const canonicalPayload = {
            sentenceIndex: canonicalIndex || 0,
            totalSentences: deviceMode === 'immersive' ? totalPages : 0, 
            globalPercentage: porcentaje,
            contentAnchor: null,
            contentFingerprint: null,
            lastInteractedMode: deviceMode || 'text'
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

        // Derive preferred support type (highest counter wins)
        const counts: Record<'vocabulary' | 'inferential' | 'reflection', number> = {
            vocabulary:  profile.vocabularySupportCount,
            inferential: profile.inferentialPromptCount,
            reflection:  profile.reflectionPromptCount,
        };
        const [best] = (Object.entries(counts) as [LeoReaderProfile['preferredSupportType'], number][])
            .sort(([, a], [, b]) => b - a);
        profile.preferredSupportType = (best[1] > 0) ? best[0] : null;
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
        if ('sendBeacon' in navigator) {
            const url = `${this.apiUrl}/progress/${userId}/${contentId}/complete`;
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
        } else {
            fetch(`${this.apiUrl}/progress/${userId}/${contentId}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(e => console.warn('Sync Complete failed', e));
        }
        
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
        }
    }



    getGroupStudents(groupId: string): User[] {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return [];
        const memberIds = this.getGroupMemberIds(group); // FASE 2 COMPATIBILITY
        return this.users.filter(u => memberIds.includes(u.id));
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

        return { success: true, message: 'Canje solicitado. Tu profesor revisará la solicitud.', remainingPoints: user.puntos };
    }

    // --- UTILS FOR TEACHER VIEW ---
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
            const res = await fetch(`${this.apiUrl}/sections`);
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
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
            body: JSON.stringify(section)
        });
        if (!res.ok) throw new Error('Failed to save section');
        return res.json();
    }

    async deleteSection(id: string): Promise<void> {
        await fetch(`${this.apiUrl
            } / sections / ${id} `, {
            method: 'DELETE',
            headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' }
        });
    }

    async getSchoolConfig(schoolName: string): Promise<SchoolConfig> {
        try {
            const res = await fetch(`${this.apiUrl}/schools/${encodeURIComponent(schoolName)}/config`, {
                headers: { 'x-admin-secret': 'chibalete-secure-upload-2025' }
            });
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
            headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'chibalete-secure-upload-2025' },
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
