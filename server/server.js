

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { fileTypeFromFile } from 'file-type';

import { processLeoRequest } from './leoEngine.js';
import { ingestPedagogicalFile } from './leoIngester.js';

// Configure dotenv to load from parent directory .env
// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });


const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV?.trim() === 'production';

// Configurar trust proxy para express-rate-limit detrás de Nginx Docker -> Host
app.set('trust proxy', 1);

import { generateAudioForContent } from './ttsService.js';
import * as ttsQueue from './ttsQueue.js';

// --- LOGGING HELPER ---
const log = (msg, type = 'INFO') => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${msg}`);
};

log(`Starting server in ${IS_PROD ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

// --- SECURITY MIDDLEWARE ---
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000
});
app.use('/api/', limiter);

// --- AUTH MIDDLEWARE ---
const requireAuth = (req, res, next) => {
    if (req.method === 'GET') return next();
    const authHeader = req.headers['x-admin-secret'];
    const SECRET = process.env.ADMIN_SECRET || 'chibalete-secure-upload-2025';

    if (authHeader === SECRET) {
        next();
    } else {
        log(`Unauthorized access attempt from ${req.ip}. Received Secret length: ${authHeader?.length || 0}. Expected: ${SECRET.length}`, 'WARN');
        res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret' });
    }
};

/**
 * Surgical Auth Fix Phase 5: 
 * Middleware to validate a regular reader session via userId.
 * Used for pedagogical AI endpoints (Leo).
 */
const requireUserAuth = (req, res, next) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'Auth requerida: x-user-id missing' });
    }

    // Use established readJSON helper
    const users = readJSON(USERS_DB);
    const user = users.find(u => u.id === userId);

    if (!user) {
        log(`Unauthorized User ID attempt: ${userId}`, 'WARN');
        return res.status(403).json({ error: 'Acceso denegado: Usuario no encontrado' });
    }

    req.user = user; // Pass user details if engine needs it
    next();
};

app.use('/api/upload', requireAuth);
app.use('/api/content', requireAuth);

// --- CONFIGURATION ---
// Ensure we use absolute paths relative to execution or this file
const UPLOAD_DIR = path.resolve(__dirname, '../public/uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// --- DATABASE FILES ---
const USERS_DB = path.resolve(__dirname, '../data/users_db.json');
const GROUPS_DB = path.resolve(__dirname, '../data/groups_db.json');
const PROGRESS_DB = path.resolve(__dirname, '../data/progress_db.json');
const DB_FILE = path.resolve(__dirname, '../data/content.json');
const SECTIONS_DB = path.resolve(__dirname, '../data/sections.json'); // Added likely missing definition based on context
const SCHOOL_CONFIGS_DB = path.resolve(__dirname, '../data/school_configs.json');
const SCHOOLS_DB = path.resolve(__dirname, '../data/schools_db.json');
const ACCESS_DB = path.resolve(__dirname, '../data/access_db.json'); // FASE E6: Motor de Accesos por Scopes
const LEO_MEMORY_DB = path.resolve(__dirname, '../data/leo_memory_db.json'); // LEO SESSION PERSISTENCE

log(`Users DB: ${USERS_DB}`);
log(`Groups DB: ${GROUPS_DB}`);
log(`Progress DB: ${PROGRESS_DB}`);

// Ensure DB files exist
[USERS_DB, GROUPS_DB, DB_FILE, SCHOOLS_DB, ACCESS_DB].forEach(file => {
    if (!fs.existsSync(path.dirname(file))) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }
});

// Initialize Progress DB with Object Map Structure (Phase 3)
if (!fs.existsSync(path.dirname(PROGRESS_DB))) {
    fs.mkdirSync(path.dirname(PROGRESS_DB), { recursive: true });
}
if (!fs.existsSync(PROGRESS_DB)) {
    fs.writeFileSync(PROGRESS_DB, JSON.stringify({ progressMap: {} }, null, 2));
}

// Initialize Leo Memory DB
if (!fs.existsSync(LEO_MEMORY_DB)) {
    fs.writeFileSync(LEO_MEMORY_DB, JSON.stringify({ memoryMap: {} }, null, 2));
}

// --- HELPER WRAPPERS ---
const readJSON = (file) => {
    try {
        if (!fs.existsSync(file)) {
            return file === PROGRESS_DB ? { progressMap: {} } : [];
        }
        const data = fs.readFileSync(file, 'utf8');
        if (!data.trim()) {
            return file === PROGRESS_DB ? { progressMap: {} } : [];
        }
        return JSON.parse(data);
    } catch (e) {
        log(`Error reading ${file}: ${e.message}`, 'ERROR');
        // Backup corrupted file
        if (fs.existsSync(file)) {
            const backupPath = `${file}.corrupt.${Date.now()}`;
            fs.copyFileSync(file, backupPath);
            log(`Corrupted DB backed up to ${backupPath}`, 'WARN');
        }
        return file === PROGRESS_DB ? { progressMap: {} } : [];
    }
};

const writeJSON = (file, data) => {
    try {
        const tempFile = `${file}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, file); // Atomic move
    } catch (e) {
        log(`Error writing ${file}: ${e.message}`, 'ERROR');
        throw e; // Relanza error para permitir rollback transaccional
    }
};

/**
 * Resuelve los IDs de contenido (libros) que pertenecen a un conjunto de colecciones.
 */
function resolveCollectionContentIds(collectionIds) {
    if (!Array.isArray(collectionIds) || collectionIds.length === 0) return [];
    const contentList = readJSON(DB_FILE);
    const colSet = new Set(collectionIds);
    return contentList
        .filter(c => c.parentId && colSet.has(c.parentId))
        .map(c => c.id);
}

// --- E6: ACCESS ENGINE (SHADOW MODE) ---

/**
 * Resuelve el acceso consolidado de un usuario basado en reglas de Scope.
 * Consolida reglas para user.id, grupos a los que pertenece, y su colegio.
 */
function resolveUserContentAccess(userId) {
    const users = readJSON(USERS_DB);
    const rawUser = users.find(u => u.id === userId);
    if (!rawUser) {
        return { titleIds: [], collectionIds: [], appliedRules: [], hasBroadAccess: false };
    }
    const user = normalizeUser(rawUser);

    // Identificar a qué grupos pertenece realmente para buscar reglas de scope=group
    const groups = readJSON(GROUPS_DB).map(normalizeGroup);
    
    // Grupos donde es mediador o miembro (Fase 2 + Extendido)
    const userGroups = groups.filter(g => 
        (g.mediatorIds && g.mediatorIds.includes(userId)) || 
        (g.memberIds && g.memberIds.includes(userId)) ||
        (user.groupIds && user.groupIds.includes(g.id))
    );
    const resolvedGroupIds = [...new Set(userGroups.map(g => g.id))];

    // Colegios u organizaciones
    const organizationId = user.organizationId || user.colegio;

    // Leer reglas
    const accessRules = readJSON(ACCESS_DB);
    const now = Date.now();

    const appliedRules = [];
    const effectiveTitleIds = new Set();
    const effectiveCollectionIds = new Set();
    let hasBroadAccess = false; 

    accessRules.forEach(rule => {
        // Ignorar expiradas
        if (typeof rule.expiresAt === 'number' && Number.isFinite(rule.expiresAt) && now > rule.expiresAt) {
            log(`Rule expired and ignored: ${rule.id} (scope=${rule.scope})`, 'ACCESS_ENGINE');
            return;
        }

        let applies = false;
        if (rule.scope === 'user' && rule.scopeId === userId) applies = true;
        if (rule.scope === 'group' && resolvedGroupIds.includes(rule.scopeId)) applies = true;
        if (rule.scope === 'organization' && rule.scopeId === organizationId) applies = true;

        if (applies) {
            appliedRules.push(rule.id);
            if (rule.titleIds) rule.titleIds.forEach(id => effectiveTitleIds.add(id));
            if (rule.collectionIds) rule.collectionIds.forEach(id => effectiveCollectionIds.add(id));
        }
    });

    log(`Access Engine resolved for ${userId}: ${appliedRules.length} rules, ${effectiveTitleIds.size} titles, ${effectiveCollectionIds.size} collections`, 'ACCESS_ENGINE');

    return {
        titleIds: Array.from(effectiveTitleIds),
        collectionIds: Array.from(effectiveCollectionIds),
        appliedRules,
        hasBroadAccess: false
    };
}

/**
 * Valida si un usuario tiene acceso a un contenido estrictamente a través del Motor de Scopes (Fase E7).
 * Retorna decision con bandera legacyFallback si no existen reglas aplicables.
 */
function canUserAccessContent(userId, contentId, content) {
    const scopeData = resolveUserContentAccess(userId);

    // 1. Si no hay reglas activas aplicables, activamos fallback legacy
    if (scopeData.appliedRules.length === 0) {
        return { 
            allowed: true, 
             legacyFallback: true, 
            reason: 'Sin reglas estrictas aplicables. Evaluando fallback legacy...' 
        };
    }

    // 2. Si sí hay reglas, validamos arrays efectivos
    // Por Title ID directo
    if (scopeData.titleIds.includes(contentId)) {
        return { 
            allowed: true, 
            legacyFallback: false,
            reason: 'Aprobado por Título explícito (Scope Engine)' 
        };
    }

    // Por Collection ID (se vincula mediante content.parentId)
    if (content.parentId && scopeData.collectionIds.includes(content.parentId)) {
        return { 
            allowed: true, 
            legacyFallback: false,
            reason: 'Aprobado por Colección autorizada (Scope Engine)' 
        };
    }

    // 3. Fallo de cumplimiento estricto
    return { 
        allowed: false, 
        legacyFallback: false,
        reason: 'Acceso denegado. Posee política restrictiva que no autoriza este contenido.' 
    };
}

app.post('/api/access', requireAuth, (req, res) => {
    const payload = req.body;
    
    // --- ESTRICTA VALIDACIÓN DE PAYLOAD ---
    if (!['user', 'group', 'organization'].includes(payload.scope)) {
        return res.status(400).json({ error: "scope must be 'user', 'group', or 'organization'" });
    }
    if (typeof payload.scopeId !== 'string' || payload.scopeId.trim() === '') {
        return res.status(400).json({ error: "scopeId must be a non-empty string" });
    }

    let parsedExpiresAt = null;
    if (payload.expiresAt !== undefined && payload.expiresAt !== null) {
        parsedExpiresAt = Number(payload.expiresAt);
        if (!Number.isFinite(parsedExpiresAt)) {
            return res.status(400).json({ error: "expiresAt must be a valid number or null/undefined" });
        }
    }

    const rules = readJSON(ACCESS_DB);
    const newRule = {
        id: payload.id || `access-${Date.now()}`,
        scope: payload.scope,
        scopeId: payload.scopeId,
        titleIds: Array.isArray(payload.titleIds) ? payload.titleIds.filter(id => typeof id === 'string') : [],
        collectionIds: Array.isArray(payload.collectionIds) ? payload.collectionIds.filter(id => typeof id === 'string') : [],
        expiresAt: parsedExpiresAt
    };

    const index = rules.findIndex(r => r.id === newRule.id);
    if (index > -1) rules[index] = newRule;
    else rules.push(newRule);

    writeJSON(ACCESS_DB, rules);
    log(`Access Rule created/updated: ${newRule.id} (scope=${newRule.scope}, scopeId=${newRule.scopeId})`, 'ACCESS_ENGINE');
    
    res.json(newRule);
});

app.get('/api/access/by-user/:userId', requireAuth, (req, res) => {
    const { userId } = req.params;
    const result = resolveUserContentAccess(userId);
    res.json(result);
});

// --- ROBUST UPLOAD HELPERS ---
const isTextFileSafe = (filePath) => {
    try {
        const buffer = Buffer.alloc(4096);
        const fd = fs.openSync(filePath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
        fs.closeSync(fd);
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0x00) return false;
        }
        return true;
    } catch (e) {
        log(`Error leyendo validación TXT: ${e.message}`, 'ERROR');
        return false;
    }
};

const safeUnlink = (filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (e) { log(`Error unlink: ${e.message}`, 'WARN'); }
    }
};

const getExpectedCategoryFromExtension = (ext) => {
    const e = ext.toLowerCase();
    if (e === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e)) return 'image';
    if (['mp3', 'wav'].includes(e)) return 'audio';
    if (['mp4', 'webm'].includes(e)) return 'video';
    if (e === 'txt') return 'text';
    return 'unknown';
};

const matchesExpectedCategory = (category, fileTypeInfo) => {
    if (!fileTypeInfo) return false;
    const { mime } = fileTypeInfo;
    
    switch (category) {
        case 'pdf': return mime === 'application/pdf';
        case 'image': return mime.startsWith('image/');
        case 'audio': return mime.startsWith('audio/');
        case 'video': return mime.startsWith('video/');
        default: return false; // Text expects fileTypeInfo to be undefined typically
    }
};

const rollbackMetadataFiles = (newContent) => {
    const urlFields = [
        'portada_url', 
        'url_recurso', 
        'texto_plano_url', 
        'texto_ingles_url', 
        'ilustraciones_url'
    ];
    
    // Base absolutizada y segura del entorno físico
    const baseDir = path.resolve(UPLOAD_DIR);

    const tryUnlink = (url) => {
        if (typeof url === 'string' && url.startsWith('/uploads/')) {
            const rawName = url.replace(/^\/uploads\//, '');
            const resolvedPath = path.resolve(baseDir, rawName);
            const relativePath = path.relative(baseDir, resolvedPath);
            
            // Verificación canónica para evitar directorios hermanos o absolutos
            if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
                safeUnlink(resolvedPath);
            }
        }
    };

    urlFields.forEach(field => {
        const value = newContent[field];
        if (!value) return;

        if (Array.isArray(value)) {
            value.forEach(tryUnlink);
        } else {
            tryUnlink(value);
        }
    });
};

// --- FASE E3: Árbitro Temporal Mínimo ---
// Endpoint intencionalmente sin autenticación: devuelve únicamente el timestamp del servidor.
// No expone datos sensibles. Es el árbitro real de tiempo para evaluar vigencias temporales
// sin depender del reloj local del cliente.
app.get('/api/server-time', (_req, res) => {
    res.json({ now: Date.now() });
});

// --- ROUTES ---

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// --- CONTENT ROUTES ---
app.get('/api/content', (req, res) => {
    try {
        res.json(readJSON(DB_FILE));
    } catch (error) {
        res.status(500).json({ error: 'Failed to read database' });
    }
});

// --- FASE HARDENING E2: Preflight de Acceso a Contenido por ID ---
// GET /api/content/:id/access?userId=...
// Árbitro server-side mínimo. Responde { allowed: true } o { allowed: false, reason: '...' }
// No depende del reloj del cliente. Utiliza Date.now() del servidor.
app.get('/api/content/:id/access', (req, res) => {
    const { id: contentId } = req.params;
    const { userId } = req.query;

    // --- Micro-Parche E2: Anti-Spoofing de userId ---
    // El frontend envía x-user-id como header desde la sesión activa.
    // Si el header no existe o no coincide con el query param, alguien está
    // intentando consultar permisos con el ID de otro usuario.
    const sessionUserId = req.headers['x-user-id'];
    if (!sessionUserId || sessionUserId !== userId) {
        return res.status(401).json({ allowed: false, reason: 'Sesión no válida.' });
    }

    // 1. Input guard
    if (!contentId || !userId) {
        return res.status(400).json({ allowed: false, reason: 'Parámetros incompletos.' });
    }

    try {
        // 2. Verificar que el usuario existe
        const users = readJSON(USERS_DB);
        const user = users.find(u => u.id === userId);
        if (!user) {
            return res.status(403).json({ allowed: false, reason: 'Usuario no encontrado.' });
        }

        // 3. Admin y Profesor: acceso operativo completo irrestricto
        const roles = user.roles || (user.role ? [user.role] : (user.rol ? [user.rol] : ['lector']));
        if (roles.includes('administrador') || roles.includes('profesor')) {
            return res.json({ allowed: true, reason: 'Acceso operativo completo.' });
        }

        // 4. Verificar que el contenido existe
        const contentList = readJSON(DB_FILE);
        const content = contentList.find(c => c.id === contentId);
        if (!content) {
            return res.status(404).json({ allowed: false, reason: 'Contenido no encontrado.' });
        }

        // 5. Helper de vigencia temporal server-side (árbitro real de tiempo)
        const now = Date.now();
        const isEntityActive = (startStr, endStr) => {
            if (!startStr && !endStr) return true; // sin restricción temporal
            if (startStr && now < new Date(startStr).getTime()) return false; // aún no comienza
            if (endStr && now > new Date(endStr).getTime()) return false;     // ya expiró
            return true;
        };

        // 6. Verificar excepción por asignación pedagógica (Aula Viva)
        // Los datos de assignments viven en progress_db.json como progreso,
        // y en groups_db.json embebidos. Buscamos si el usuario tiene una asignación activa
        // que incluya este contentId en cualquier grupo del que es miembro.
        const groups = readJSON(GROUPS_DB);
        const userGroups = groups.filter(g => {
            const members = g.studentIds || g.memberIds || [];
            const mediators = g.mediatorIds || (g.teacherId ? [g.teacherId] : []);
            return members.includes(userId) || mediators.includes(userId);
        });

        // Buscar si hay assignments en progress_db que asignen este contenido al usuario
        const progressData = readJSON(PROGRESS_DB);
        const assignmentsArr = Array.isArray(progressData.assignments)
            ? progressData.assignments
            : (progressData.assignmentsMap
                ? Object.values(progressData.assignmentsMap).flat()
                : []);

        const hasAssignment = assignmentsArr.some(a =>
            a.contentId === contentId &&
            (a.studentId === userId || (a.groupId && userGroups.some(g => g.id === a.groupId)))
        );

        if (hasAssignment) {
            return res.json({ allowed: true, reason: 'Acceso por asignación pedagógica.' });
        }

        // --- FASE E7: MOTOR DE ACCESO ESTRICTO POR SCOPES ---
        const scopeDecision = canUserAccessContent(userId, contentId, content);
        log(`[ACCESS_DECISION] User: ${userId} | Content: ${contentId} | Allowed: ${scopeDecision.allowed} | Reason: ${scopeDecision.reason}`, 'ACCESS_ENGINE');
        
        if (!scopeDecision.legacyFallback) {
            // El Scope Engine dictaminó en modo estricto.
            if (scopeDecision.allowed) {
                return res.json({ allowed: true, reason: scopeDecision.reason });
            } else {
                return res.status(403).json({ allowed: false, reason: scopeDecision.reason });
            }
        }
        // Si hay legacyFallback, continuamos con las políticas heredadas (Fase 5/6)

        // 7. Evaluar reglas de acceso por grupo
        let unionAccess = null;
        let hasAnyActiveGroupRule = false;

        for (const g of userGroups) {
            if (!isEntityActive(g.accessStartsAt, g.accessEndsAt)) continue;

            const available = g.availableContentIds;
            const collections = g.collectionIds;

            // Sin regla explícita: este grupo no aporta ni restringe (continúa con legacy)
            if (available === undefined && (!collections || collections.length === 0)) continue;

            hasAnyActiveGroupRule = true;

            if (available === 'all') {
                // Shortcut: acceso total explícito desde cualquier grupo activo
                return res.json({ allowed: true, reason: 'Acceso total por grupo activo.' });
            }

            let effectiveIds = [];
            if (Array.isArray(available)) effectiveIds = [...available];
            if (Array.isArray(collections) && collections.length > 0) {
                const extra = resolveCollectionContentIds(collections);
                effectiveIds = [...new Set([...effectiveIds, ...extra])];
            }

            if (effectiveIds.length > 0) {
                if (unionAccess === null) {
                    unionAccess = [...effectiveIds];
                } else {
                    // Unión de IDs de múltiples grupos
                    for (const cId of effectiveIds) {
                        if (!unionAccess.includes(cId)) unionAccess.push(cId);
                    }
                }
            }
            // Si available/collections están vacíos pero el grupo es activo, 
            // no aporta nada al unionAccess pero cuenta como "activo" (bloqueante si no hay más grupos)
        }

        // 8. Evaluar acceso por organización (SchoolConfig)
        const schoolName = user.colegio || user.school || '';
        if (schoolName) {
            try {
                const schoolConfigs = readJSON(SCHOOL_CONFIGS_DB);
                const schoolConfig = Array.isArray(schoolConfigs)
                    ? schoolConfigs.find(s => s.schoolName === schoolName)
                    : schoolConfigs[schoolName];

                if (schoolConfig) {
                    const orgAccess = schoolConfig.availableContentIds;
                    if (isEntityActive(schoolConfig.accessStartsAt, schoolConfig.accessEndsAt)) {
                        if (orgAccess === 'all') {
                            return res.json({ allowed: true, reason: 'Acceso total por organización.' });
                        }
                        if (Array.isArray(orgAccess) && orgAccess.length > 0) {
                            if (unionAccess === null) {
                                unionAccess = [...orgAccess];
                            } else if (Array.isArray(unionAccess)) {
                                for (const cId of orgAccess) {
                                    if (!unionAccess.includes(cId)) unionAccess.push(cId);
                                }
                            }
                            hasAnyActiveGroupRule = true;
                        }
                    }
                }
            } catch (e) {
                log(`[access-check] Error reading school_configs: ${e.message}`, 'WARN');
                // Si no podemos leer la config del colegio, no bloqueamos — comportamiento seguro/legacy
            }
        }

        // 9. Veredicto final
        if (!hasAnyActiveGroupRule) {
            // No hay reglas comerciales activas en ningún grupo → fallback legacy abierto
            return res.json({ allowed: true, reason: 'Sin restricciones comerciales activas (modo legacy).' });
        }

        if (unionAccess !== null && Array.isArray(unionAccess)) {
            if (unionAccess.includes(contentId)) {
                return res.json({ allowed: true, reason: 'Contenido en catálogo autorizado del grupo.' });
            } else {
                return res.status(403).json({ allowed: false, reason: 'Contenido fuera de tu catálogo autorizado.' });
            }
        }

        // Todos los grupos activos tenían bloqueo total ([]) → acceso denegado
        return res.status(403).json({ allowed: false, reason: 'Acceso bloqueado por reglas del grupo.' });

    } catch (err) {
        log(`[access-check] Error inesperado: ${err.message}`, 'ERROR');
        // Ante un error interno del servidor, falla de forma segura (denegado)
        return res.status(500).json({ allowed: false, reason: 'Error de servidor al verificar acceso.' });
    }
});


// DELETE CONTENT — M1: with full physical file cleanup
app.delete('/api/content/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    log(`Request to delete content: ${id}`, 'INFO');

    // Guard: reject path traversal
    if (!id || /[\\/.]{2,}|[^a-zA-Z0-9_-]/.test(id)) {
        return res.status(400).json({ error: 'Invalid content ID' });
    }

    try {
        const contentList = readJSON(DB_FILE);
        const itemIndex = contentList.findIndex(c => c.id === id);

        if (itemIndex === -1) {
            log(`Content not found in DB: ${id}`, 'WARN');
            return res.status(404).json({ error: 'Content not found' });
        }

        const item = contentList[itemIndex];

        // Helper: safely resolve a /uploads/... URL to an absolute path and unlink
        // UPLOAD_DIR = .../public/uploads; stored URLs are /uploads/filename
        // So: resolve one level up from UPLOAD_DIR (.../public) + rel (uploads/filename)
        const safeUnlinkUrl = (relUrl) => {
            if (!relUrl || typeof relUrl !== 'string') return;
            const rel = relUrl.replace(/^\/+/, ''); // strip leading slash
            const base = path.resolve(UPLOAD_DIR, '..'); // .../public
            const abs = path.resolve(base, rel);
            // Guard against path traversal
            if (!abs.startsWith(base + path.sep) && abs !== base) return;
            safeUnlink(abs);
        };

        // 1. Clean individual URL-referenced files
        const urlFields = ['portada_url', 'texto_plano_url', 'texto_ingles_url', 'texto_portugues_url', 'url_recurso'];
        urlFields.forEach(f => safeUnlinkUrl(item[f]));

        // 2. Clean illustrations array
        if (Array.isArray(item.ilustraciones_url)) {
            item.ilustraciones_url.forEach(u => safeUnlinkUrl(u));
        }

        // 3. Clean main content folder: /uploads/<id>/
        const contentDir = path.join(UPLOAD_DIR, id);
        if (fs.existsSync(contentDir)) {
            try {
                fs.rmSync(contentDir, { recursive: true, force: true });
                log(`Deleted content dir: ${contentDir}`, 'DEBUG');
            } catch (e) {
                log(`Failed to delete dir ${contentDir}: ${e.message}`, 'ERROR');
            }
        }

        // 4. Clean TTS audio folder: /uploads/audio/<id>/
        const audioDir = path.join(UPLOAD_DIR, 'audio', id);
        if (fs.existsSync(audioDir)) {
            try {
                fs.rmSync(audioDir, { recursive: true, force: true });
                log(`Deleted audio dir: ${audioDir}`, 'DEBUG');
            } catch (e) {
                log(`Failed to delete audio dir ${audioDir}: ${e.message}`, 'ERROR');
            }
        }

        // 5. Clean Leo context folder: /uploads/leo_context/<id>/
        const leoDir = path.join(UPLOAD_DIR, 'leo_context', id);
        if (fs.existsSync(leoDir)) {
            try {
                fs.rmSync(leoDir, { recursive: true, force: true });
                log(`Deleted leo_context dir: ${leoDir}`, 'DEBUG');
            } catch (e) {
                log(`Failed to delete leo_context dir ${leoDir}: ${e.message}`, 'ERROR');
            }
        }

        // 6. Remove DB record — done last, after cleanup
        contentList.splice(itemIndex, 1);
        writeJSON(DB_FILE, contentList);
        log(`Content removed from DB: ${id}`, 'SUCCESS');

        res.json({ success: true, message: 'Content deleted successfully' });

    } catch (error) {
        log(`CRITICAL DELETE ERROR: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});


// UPLOAD CONFIG - Guardado Inicial a TEMP
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        cb(null, name + '-' + uniqueSuffix + ext);
    }
});

// Filtro Nominal (Capa 1)
const fileFilter = (req, file, cb) => {
    const allowedExtensions = /pdf|txt|jpeg|jpg|png|webp|gif|mp3|wav|mp4|webm/;
    const allowedMimeTypes = /application\/pdf|text\/plain|image\/.*|audio\/.*|video\/.*/;

    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error(`Tipo nominal no permitido: ${file.originalname}`));
    }
};

const upload = multer({ 
    storage, 
    fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB límite para tolerar audios narrados largos y PDFs de cuentos.
});


// UPLOAD CON VALIDACIÓN BINARIA (Capa 2)
app.post('/api/upload', (req, res) => {
    log('Upload started...', 'INFO');
    upload.single('file')(req, res, async (err) => {
        if (err) {
            log(`Upload Middleware Error: ${err.message}`, 'ERROR');
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const tempPath = req.file.path;
        
        try {
            // Verificar Magic Numbers reales
            const fileTypeInfo = await fileTypeFromFile(tempPath);
            const rawExt = path.extname(req.file.originalname).toLowerCase().replace('.', '');
            const expectedCategory = getExpectedCategoryFromExtension(rawExt);
            
            let isValid = false;

            if (expectedCategory === 'text') {
                // TXT validation: Usually file-type returns undefined for pure txt
                // But we must check for null bytes to prevent binary spoofing
                isValid = isTextFileSafe(tempPath);
            } else if (expectedCategory !== 'unknown') {
                // For PDF, Video, Audio, Image we MUST match strictly the mime category
                isValid = matchesExpectedCategory(expectedCategory, fileTypeInfo);
            }
            
            if (!isValid) {
                safeUnlink(tempPath);
                log(`Spoofing o binario malicioso detectado y purgado: ${req.file.originalname} (Expected: ${expectedCategory}, Real Mime: ${fileTypeInfo ? fileTypeInfo.mime : 'none'})`, 'SECURITY');
                return res.status(415).json({ error: 'El contenido real del archivo no coincide con su extensión o contiene código binario no seguro.' });
            }

            // Mover a destino definitivo si pasó las mallas
            let finalDestDir = UPLOAD_DIR;
            if (req.query.parentId) {
                finalDestDir = path.join(UPLOAD_DIR, req.query.parentId);
                if (!fs.existsSync(finalDestDir)) fs.mkdirSync(finalDestDir, { recursive: true });
            }

            const finalPath = path.join(finalDestDir, req.file.filename);
            fs.renameSync(tempPath, finalPath);

            const relativePath = path.relative(UPLOAD_DIR, finalPath);
            const fileUrl = `/uploads/${relativePath.split(path.sep).join('/')}`;

            log(`File validated and stored: ${req.file.filename}`, 'SUCCESS');
            res.status(200).json({
                success: true,
                url: fileUrl,
                filename: req.file.filename,
                mimetype: fileTypeInfo ? fileTypeInfo.mime : (expectedCategory === 'text' ? 'text/plain' : req.file.mimetype),
                size: req.file.size
            });

        } catch (validationErr) {
            log(`Validation crash: ${validationErr.message}`, 'ERROR');
            safeUnlink(tempPath);
            // W3: Distinguish unreadable/corrupt file (415) from real server errors (500)
            res.status(415).json({ error: 'El archivo no pudo ser leído. Puede estar corrupto o truncado.' });
        }
    });
});

// W1: ORPHAN PURGE ROUTE
// Protected by app.use('/api/upload', requireAuth) already registered above.
// Frontend calls this best-effort when a metadata save fails after files were uploaded.
app.post('/api/upload/purge', (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) {
        return res.status(400).json({ error: 'Invalid url — must start with /uploads/' });
    }
    const rawName = url.replace(/^\/uploads\//, '');
    const resolved = path.resolve(UPLOAD_DIR, rawName);
    const rel = path.relative(path.resolve(UPLOAD_DIR), resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        log(`Path traversal rejected in purge: ${url}`, 'SECURITY');
        return res.status(400).json({ error: 'Path traversal rejected' });
    }
    safeUnlink(resolved);
    log(`Orphan purged: ${resolved}`, 'CLEANUP');
    res.json({ success: true });
});

// SAVE CONTENT METADATA
app.post('/api/content', (req, res) => {
    try {
        const newContent = req.body;
        
        // 1. Validar metadata base para evitar registros basura
        if (!newContent.id || !newContent.titulo) {
             return res.status(400).json({ error: 'Faltan campos obligatorios de Metadata (id, titulo)' });
        }

        log(`Saving content metadata: ${newContent.id}`, 'INFO');

        const contentList = readJSON(DB_FILE);

        // Check for text changes to trigger TTS
        const index = contentList.findIndex((c) => c.id === newContent.id);
        let shouldGenerateTTS = false;

        const oldContent = index >= 0 ? contentList[index] : null;

        if (oldContent) {
            // Update existing
            if (newContent.texto_plano_url && newContent.texto_plano_url !== oldContent.texto_plano_url) {
                shouldGenerateTTS = true;
            } else if (newContent.texto_plano_url && (!fs.existsSync(path.join(UPLOAD_DIR, 'audio', newContent.id, 'manifest.json')))) {
                // Trigger if text exists but manifest is missing (Reprocess/Retry)
                shouldGenerateTTS = true;
            }
        } else {
            // New content
            if (newContent.texto_plano_url) {
                shouldGenerateTTS = true;
            }
        }

        // Apply Status
        if (shouldGenerateTTS) {
            newContent.status = 'disponible';
            newContent.ttsStatus = 'generando';
        } else if (!newContent.status && oldContent && oldContent.status) {
            // Keep existing status if not generating
            newContent.status = oldContent.status;
            newContent.ttsStatus = oldContent.ttsStatus || 'no_iniciado';
        } else if (!newContent.status) {
            // Default
            newContent.status = 'disponible';
            newContent.ttsStatus = 'no_iniciado';
        }

        // Save to List
        if (index >= 0) {
            contentList[index] = newContent;
        } else {
            contentList.push(newContent);
        }

        // 2. Transaccionalidad / Rollback Crítico
        try {
            writeJSON(DB_FILE, contentList);
        } catch (dbWriteErr) {
            // W4: Rollback physical files on DB write failure for BOTH create and update.
            if (index === -1) {
                // New record: rollback all uploaded files
                rollbackMetadataFiles(newContent);
                log('Rollback orfandad aplicado (nuevo registro).', 'WARN');
            } else {
                // Update: only rollback URLs that differ from the previous saved state
                const urlFields = ['portada_url', 'texto_plano_url', 'texto_ingles_url', 'texto_portugues_url', 'url_recurso'];
                const changedUrls = {};
                urlFields.forEach(f => {
                    if (newContent[f] && newContent[f] !== (oldContent?.[f])) {
                        changedUrls[f] = newContent[f];
                    }
                });
                // Also handle ilustraciones_url arrays — rollback any new entries added this request
                if (Array.isArray(newContent.ilustraciones_url) && Array.isArray(oldContent?.ilustraciones_url)) {
                    const oldSet = new Set(oldContent.ilustraciones_url);
                    changedUrls.ilustraciones_url = newContent.ilustraciones_url.filter(u => !oldSet.has(u));
                }
                rollbackMetadataFiles(changedUrls);
                log('Rollback orfandad aplicado (actualización fallida).', 'WARN');
            }
            throw new Error('Fallo al escribir en la base JSON de Content');
        }

        res.json({ success: true, content: newContent });

        // --- ASYNC TTS TRIGGER ---
        if (shouldGenerateTTS) {
            log(`Triggering TTS background generation for ${newContent.id}...`, 'TTS');
            const relativePath = newContent.texto_plano_url.replace(/^\/uploads\//, '');
            const textFullPath = path.join(UPLOAD_DIR, relativePath);

            // Progress Handler
            const onProgress = (status) => {
                try {
                    const currentList = readJSON(DB_FILE);
                    const idx = currentList.findIndex(c => c.id === newContent.id);
                    if (idx !== -1) {
                        // Only update if changed significantly or status changed to avoid thrashing? 
                        // For now, always update to show smooth progress bar.
                        currentList[idx].processingStatus = status;
                        // Determine main TTS status (DO NOT touch content.status, it stays disponible)
                        if (status.status === 'processing') currentList[idx].ttsStatus = 'generando';
                        if (status.status === 'error_proveedor') currentList[idx].ttsStatus = 'error_proveedor';
                        if (status.status === 'failed') currentList[idx].ttsStatus = 'error_proveedor';
                        if (status.status === 'completed') currentList[idx].ttsStatus = 'listo';

                        writeJSON(DB_FILE, currentList);
                    }
                } catch (e) { /* ignore DB locks/rates */ }
            };

            ttsQueue.enqueue(newContent.id, () => generateAudioForContent(newContent.id, textFullPath, UPLOAD_DIR, onProgress))
                .then(result => {
                    if (result.success && !result.abortedByProvider) {
                        log(`TTS finished for ${newContent.id}`, 'SUCCESS');
                        const finalStatus = {
                            percentage: 100,
                            currentSentence: 0, // irrelevant
                            totalSentences: 0,
                            status: 'completed',
                            lastUpdated: new Date().toISOString()
                        };
                        onProgress(finalStatus);
                        log(`TTS for ${newContent.id} marked as LISTO`, 'INFO');

                    } else if (result.abortedByProvider) {
                        log(`TTS for ${newContent.id} was aborted by provider. Preserving error state.`, 'WARN');
                    } else {
                        log(`TTS failed for ${newContent.id}: ${result.error}`, 'ERROR');
                        // Callback already called with 'failed' inside ttsService if catastrophic
                    }
                })
                .catch(err => {
                    log(`TTS Crash: ${err?.message || String(err)}`, 'ERROR');
                    onProgress({
                        percentage: 0, currentSentence: 0, totalSentences: 0, status: 'error_proveedor', error: err.message, lastUpdated: new Date().toISOString()
                    });
                });
        }
    } catch (error) {
        log(`Save Error: ${error.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to save content' });
    }
});

// --- USER HELPERS ---
const sanitizeUserForClient = (user) => {
    const { password, ...safeUser } = user;
    return safeUser;
};

const sanitizeUsersForClient = (users) => {
    return users.map(sanitizeUserForClient);
};

const normalizeEmail = (email) => {
    return email ? String(email).trim().toLowerCase() : '';
};

const normalizeRoles = (roles) => {
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
        return ['lector'];
    }
    const mappedRoles = roles.map(r => r === 'admin' ? 'administrador' : r);
    const validRoles = ['administrador', 'profesor', 'lector'];
    const filteredRoles = mappedRoles.filter(r => validRoles.includes(r));
    return filteredRoles.length > 0 ? filteredRoles : ['lector'];
};

const hashPasswordIfNeeded = (password) => {
    if (!password) return undefined;
    if (password.startsWith('$2')) return password; // Already hashed by bcrypt
    const salt = bcrypt.genSaltSync(10);
    return bcrypt.hashSync(password, salt);
};

// --- PROGRESS SYNC HELPERS (Fase 3.2) ---
const makeProgressKey = (userId, contentId) => `${userId}__${contentId}`;

const normalizeCanonicalProgress = (payload) => {
    return {
        sentenceIndex: Math.max(0, parseInt(payload?.sentenceIndex || 0, 10)),
        totalSentences: Math.max(0, parseInt(payload?.totalSentences || 0, 10)),
        globalPercentage: Math.max(0, Math.min(100, parseFloat(payload?.globalPercentage || 0.0))),
        contentAnchor: payload?.contentAnchor ? String(payload.contentAnchor).substring(0, 100) : null,
        contentFingerprint: payload?.contentFingerprint ? String(payload.contentFingerprint).substring(0, 50) : null,
        lastInteractedMode: ['pdf', 'text', 'accessible', 'immersive'].includes(payload?.lastInteractedMode) 
            ? payload.lastInteractedMode : 'text'
    };
};

const shouldAcceptIncomingProgress = (incomingDateStr, existingDateStr) => {
    if (!existingDateStr) return true; // No history, always accept
    const incoming = new Date(incomingDateStr).getTime();
    const existing = new Date(existingDateStr).getTime();
    return incoming > existing; // Last write wins strictly
};

const mergeHistoryWithLimit = (existingHistory, newSession) => {
    let history = Array.isArray(existingHistory) ? [...existingHistory] : [];
    if (newSession && newSession.sessionId) {
        history.push({
            sessionId: String(newSession.sessionId),
            startedAt: newSession.startedAt || new Date().toISOString(),
            mode: newSession.mode || 'text',
            durationSec: Math.max(0, parseInt(newSession.durationSec || 0, 10))
        });
    }
    // FIFO limit exact 20
    if (history.length > 20) {
        history = history.slice(history.length - 20);
    }
    return history;
};

const ensureProgressDbShape = (db) => {
    if (!db || typeof db !== 'object' || Array.isArray(db)) return { progressMap: {} };
    if (!db.progressMap) db.progressMap = {};
    return db;
};

const ensureLeoMemoryDbShape = (db) => {
    if (!db || typeof db !== 'object' || Array.isArray(db)) return { memoryMap: {} };
    if (!db.memoryMap) db.memoryMap = {};
    return db;
};

// --- SAFE LEGACY MIGRATION ---
const migrateProgressDBIfNeeded = () => {
    try {
        const rawData = fs.readFileSync(PROGRESS_DB, 'utf8');
        if (!rawData.trim()) return;
        const parsed = JSON.parse(rawData);
        
        // Si la raíz es un array (Legacy)
        if (Array.isArray(parsed)) {
            log('Migrando Progress DB heredado (Array -> Map)...', 'WARN');
            fs.copyFileSync(PROGRESS_DB, `${PROGRESS_DB}.bak.pre_v3`);
            
            const newDb = { progressMap: {} };
            parsed.forEach(p => {
                if (!p.userId || !p.contentId) return; // Skip basura
                const key = makeProgressKey(p.userId, p.contentId);
                newDb.progressMap[key] = {
                    id: key,
                    userId: p.userId,
                    contentId: p.contentId,
                    isCompleted: p.status === 'completado' || p.isCompleted || false,
                    canonicalProgress: normalizeCanonicalProgress({
                        globalPercentage: typeof p.progress === 'number' ? p.progress : 0,
                        lastInteractedMode: 'text' // Fallback ciego
                    }),
                    updatedAt: p.updatedAt || new Date().toISOString(),
                    history: []
                };
            });
            writeJSON(PROGRESS_DB, newDb);
            log('Migración completa.', 'SUCCESS');
        }
    } catch (e) {
         log(`Error evaluando migración ProgressDB: ${e.message}`, 'ERROR');
    }
};

// Ejecutar migración síncrona en el arranque
if (fs.existsSync(PROGRESS_DB)) migrateProgressDBIfNeeded();

// --- PROGRESS SYNC ROUTES (Fase 3.2) ---
// * Auth temporal: Se omite requireAuth en desarrollo frontend, pero debe blindarse en producción Fase 4

// 1. GET ALL PROGRESS POR USUARIO (Útil para Admin/Dashboard)
app.get('/api/progress/user/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const db = ensureProgressDbShape(readJSON(PROGRESS_DB));
        const userProgressList = Object.values(db.progressMap).filter(p => p.userId === userId);
        res.json({ success: true, progressList: userProgressList });
    } catch (e) {
        log(`GET User Progress Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed' });
    }
});

// 2. GET SINGLE PROGRESS (Resolviendo colisión de rutas previa)
app.get('/api/progress/item/:userId/:contentId', (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const key = makeProgressKey(userId, contentId);
        const db = ensureProgressDbShape(readJSON(PROGRESS_DB));
        const progress = db.progressMap[key];
        
        if (!progress) return res.json({ success: true, progress: null });
        res.json({ success: true, progress });
    } catch (e) {
        log(`GET Progress Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to fetch progress' });
    }
});

// 3. POST SYNC HEARTBEAT
app.post('/api/progress/:userId/:contentId/sync', (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const payload = req.body;
        const key = makeProgressKey(userId, contentId);

        if (!payload.canonicalProgress) {
             return res.status(400).json({ error: 'Falta objeto canonicalProgress' });
        }

        const db = ensureProgressDbShape(readJSON(PROGRESS_DB));
        const existing = db.progressMap[key];
        const incomingDate = payload.updatedAt || new Date().toISOString();

        if (existing && !shouldAcceptIncomingProgress(incomingDate, existing.updatedAt)) {
             log(`Concurrencia: Progreso ignorado por ser más viejo (${key})`, 'DEBUG');
             return res.json({ success: true, ignored: true, progress: existing });
        }

        const newProgress = {
            id: key,
            userId,
            contentId,
            isCompleted: payload.isCompleted || (existing?.isCompleted || false),
            canonicalProgress: normalizeCanonicalProgress(payload.canonicalProgress),
            updatedAt: incomingDate,
            history: mergeHistoryWithLimit(existing?.history || [], payload.session)
        };

        db.progressMap[key] = newProgress;
        writeJSON(PROGRESS_DB, db);

        res.json({ success: true, progress: newProgress });
    } catch (e) {
        log(`POST Progress Sync Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to sync progress' });
    }
});

// 4. POST COMPLETE CONTENT
app.post('/api/progress/:userId/:contentId/complete', (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const payload = req.body;
        const key = makeProgressKey(userId, contentId);
        
        const db = ensureProgressDbShape(readJSON(PROGRESS_DB));
        const existing = db.progressMap[key] || {
            id: key, userId, contentId, history: [],
            canonicalProgress: normalizeCanonicalProgress({})
        };

        existing.isCompleted = true;
        existing.canonicalProgress.globalPercentage = 100.0;
        
        // Conservar/Sobrescribir sentenceIndex si viene nuevo
        if (payload.canonicalProgress?.sentenceIndex !== undefined) {
             existing.canonicalProgress.sentenceIndex = normalizeCanonicalProgress(payload.canonicalProgress).sentenceIndex;
        }

        existing.updatedAt = payload.updatedAt || new Date().toISOString();
        existing.history = mergeHistoryWithLimit(existing.history, payload.session);

        db.progressMap[key] = existing;
        writeJSON(PROGRESS_DB, db);

        log(`Contenido completado: ${key}`, 'SUCCESS');
        res.json({ success: true, progress: existing });
    } catch (e) {
        log(`POST Complete Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to complete content' });
    }
});
// ------------------------------------
/**
 * normalizeUser — Compatibilidad legacy + modelo extendido
 * Asegura que los campos array sean verdaderamente arrays para evitar crashes en el frontend
 */
const normalizeUser = (user) => {
    if (!user) return user;
    const normalized = { ...user };
    
    if (normalized.capabilities !== undefined && !Array.isArray(normalized.capabilities)) {
        normalized.capabilities = [];
    }
    if (normalized.groupIds !== undefined && !Array.isArray(normalized.groupIds)) {
        normalized.groupIds = [];
    }
    
    return normalized;
};

// --- USER MANAGEMENT ROUTES ---

// GET USERS
app.get('/api/users', requireAuth, (req, res) => {
    try {
        const users = readJSON(USERS_DB);
        // Aplicamos normalizeUser en lectura para limpiar posibles estados corruptos pasados
        const normalizedUsers = users.map(normalizeUser);
        res.json(sanitizeUsersForClient(normalizedUsers));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// LOGIN
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    
    const users = readJSON(USERS_DB);
    const userIndex = users.findIndex(u => normalizeEmail(u.email) === normalizedEmail);

    if (userIndex !== -1) {
        const user = normalizeUser(users[userIndex]);
        let isValid = false;

        if (user.password && user.password.startsWith('$2')) {
            isValid = bcrypt.compareSync(password, user.password);
        } else {
            // Legacy plain text comparison
            if (user.password === password) {
                isValid = true;
                // Auto-upgrade security: Hash it and save immediately
                user.password = hashPasswordIfNeeded(password);
                users[userIndex] = user;
                writeJSON(USERS_DB, users);
                log(`Auto-upgraded password hash for legacy user: ${normalizedEmail}`, 'ACCESS');
            }
        }

        if (isValid) {
            return res.json({ success: true, user: sanitizeUserForClient(user) });
        }
    }
    
    res.status(401).json({ error: 'Credenciales inválidas' });
});

// CREATE USER
app.post('/api/users', requireAuth, (req, res) => {
    const newUser = req.body;
    if (!newUser.email || !newUser.nombre_completo || !newUser.password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const normalizedEmail = normalizeEmail(newUser.email);
    const users = readJSON(USERS_DB);

    if (users.some(u => normalizeEmail(u.email) === normalizedEmail)) {
        return res.status(409).json({ error: 'El email ya está registrado' });
    }

    if (newUser.id && users.some(u => u.id === newUser.id)) {
        return res.status(409).json({ error: 'El ID de usuario ya existe' });
    }

    if (!newUser.id) {
        newUser.id = `user-${Date.now()}`;
    }

    newUser.password = hashPasswordIfNeeded(newUser.password);
    newUser.roles = normalizeRoles(newUser.roles);
    newUser.email = normalizedEmail;

    // Normalizamos capacidades y groupIds antes de guardar
    const userToSave = normalizeUser(newUser);

    users.push(userToSave);
    writeJSON(USERS_DB, users);
    log(`User created: ${userToSave.email} (${userToSave.id})`, 'ACCESS');
    
    res.json(sanitizeUserForClient(userToSave));
});

// UPDATE USER
app.put('/api/users/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const users = readJSON(USERS_DB);
    const index = users.findIndex(u => u.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (updates.id && updates.id !== id) {
        return res.status(400).json({ error: 'No se puede cambiar el ID del usuario' });
    }

    if (updates.email) {
        const newEmail = normalizeEmail(updates.email);
        // Validar duplicado si intenta cambiar su propio correo a otro existente
        if (newEmail !== normalizeEmail(users[index].email)) {
            if (users.some(u => normalizeEmail(u.email) === newEmail)) {
                return res.status(409).json({ error: 'El nuevo email ya está en uso' });
            }
        }
        updates.email = newEmail;
    }
    
    if (updates.roles) updates.roles = normalizeRoles(updates.roles);
    if (updates.password) updates.password = hashPasswordIfNeeded(updates.password);

    // Merge y renormalizar
    const mergedUser = normalizeUser({ ...users[index], ...updates });
    users[index] = mergedUser;
    writeJSON(USERS_DB, users);
    log(`User updated: ${id}`, 'ACCESS');
    
    res.json(sanitizeUserForClient(mergedUser));
});

// DELETE USER
app.delete('/api/users/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const users = readJSON(USERS_DB);
    const index = users.findIndex(u => u.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    users.splice(index, 1);
    writeJSON(USERS_DB, users);
    log(`User deleted: ${id}`, 'ACCESS');
    res.json({ success: true });
});

// --- SCHOOL MANAGEMENT ROUTES ---

app.get('/api/schools', requireAuth, (req, res) => {
    try {
        res.json(readJSON(SCHOOLS_DB));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/schools', requireAuth, (req, res) => {
    const newSchool = req.body;
    if (!newSchool.name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    const schools = readJSON(SCHOOLS_DB);
    if (schools.some(s => s.name.toLowerCase() === newSchool.name.toLowerCase())) {
        return res.status(409).json({ error: 'El Colegio ya existe' });
    }

    if (!newSchool.id) {
        newSchool.id = `school-${Date.now()}`;
    }
    
    if (!newSchool.createdAt) {
        newSchool.createdAt = new Date().toISOString();
    }

    schools.push(newSchool);
    writeJSON(SCHOOLS_DB, schools);
    log(`School created: ${newSchool.name}`, 'ACCESS');
    
    res.status(201).json(newSchool);
});

// --- GROUP MANAGEMENT ROUTES ---

/**
 * normalizeGroup — Compatibilidad legacy + modelo extendido
 *
 * Garantiza que un objeto de grupo tenga siempre los campos mínimos
 * necesarios para el modelo extendido, sin perder datos legacy:
 * - type     : 'course' por defecto si ausente
 * - mediatorIds: construido desde teacherId si mediatorIds vacío/ausente
 * - memberIds  : fusión de studentIds y memberIds existentes
 *
 * @param {object} group - Objeto de grupo raw (del DB o del payload)
 * @returns {object} - Grupo normalizado, compatible con frontend y backend
 */
function normalizeGroup(group) {
    if (!group) return group;

    const normalized = { ...group };

    // type: consolidación de course y club
    if (!['course', 'club'].includes(normalized.type)) {
        normalized.type = 'course';
    }

    // mediatorIds & teacherId: sincronización bidireccional
    if (!Array.isArray(normalized.mediatorIds) || normalized.mediatorIds.length === 0) {
        normalized.mediatorIds = normalized.teacherId ? [normalized.teacherId] : [];
    } else {
        // Compatibilidad legacy: forzar output de teacherId consistente con array
        normalized.teacherId = normalized.mediatorIds[0];
    }

    // memberIds & studentIds: fusión y sincronización bidireccional
    const legacyStudents = Array.isArray(normalized.studentIds) ? normalized.studentIds : [];
    const existingMembers = Array.isArray(normalized.memberIds) ? normalized.memberIds : [];
    normalized.memberIds = [...new Set([...legacyStudents, ...existingMembers])];
    
    // Output legacy: reflejar fielmente en studentIds para clientes viejos
    normalized.studentIds = [...normalized.memberIds];

    return normalized;
}

app.get('/api/groups', requireAuth, (req, res) => {
    try {
        const groups = readJSON(GROUPS_DB);
        // Normalizar la salida para que el frontend siempre reciba datos consistentes
        res.json(groups.map(normalizeGroup));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/groups', requireAuth, (req, res) => {
    const payload = req.body;
    if (!payload.name) {
        return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });
    }
    if (!payload.id) {
        payload.id = `group-${Date.now()}`;
    }

    const groups = readJSON(GROUPS_DB);

    if (groups.some(g => g.id === payload.id)) {
        return res.status(409).json({ error: 'El ID del grupo ya existe' });
    }

    // Aceptar nuevos campos + normalizar legacy antes de persistir
    const newGroup = normalizeGroup({
        ...payload,
        // Campos seguros con defaults si el payload no los trae
        type:        payload.type        || 'course',
        mediatorIds: payload.mediatorIds || (payload.teacherId ? [payload.teacherId] : []),
        memberIds:   payload.memberIds   || payload.studentIds || [],
        // Campos extendidos E2: aceptar si vienen, ignorar si no
        organizationId:       payload.organizationId       || undefined,
        availableContentIds:  payload.availableContentIds  || undefined,
        collectionIds:        payload.collectionIds        || undefined,
        accessStartsAt:       payload.accessStartsAt       || undefined,
        accessEndsAt:         payload.accessEndsAt         || undefined,
        accessRules:          payload.accessRules          || undefined,
    });

    groups.push(newGroup);
    writeJSON(GROUPS_DB, groups);
    log(`Group created: ${newGroup.id} (type=${newGroup.type})`, 'ACCESS');
    res.json(newGroup);
});

app.put('/api/groups/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const groups = readJSON(GROUPS_DB);
    const index = groups.findIndex(g => g.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    // Merge y renormalizar: preservar campos legacy del grupo existente,
    // sobreescribir con updates y volver a normalizar para consistencia
    const merged = normalizeGroup({ ...groups[index], ...updates });
    groups[index] = merged;
    writeJSON(GROUPS_DB, groups);
    log(`Group updated: ${id} (type=${merged.type})`, 'ACCESS');
    res.json(merged);
});

app.delete('/api/groups/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const groups = readJSON(GROUPS_DB);
    const index = groups.findIndex(g => g.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    groups.splice(index, 1);
    writeJSON(GROUPS_DB, groups);
    log(`Group deleted: ${id}`, 'ACCESS');
    res.json({ success: true });
});

// --- SECTIONS ROUTES ---


// Ensure DBs exist
[SECTIONS_DB, SCHOOL_CONFIGS_DB].forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }
});

app.get('/api/sections', (req, res) => {
    try {
        res.json(readJSON(SECTIONS_DB));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/sections', requireAuth, (req, res) => {
    const newSection = req.body;
    if (!newSection.id) newSection.id = `section-${Date.now()}`;

    const sections = readJSON(SECTIONS_DB);
    sections.push(newSection);
    writeJSON(SECTIONS_DB, sections);
    res.json(newSection);
});

app.put('/api/sections/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const sections = readJSON(SECTIONS_DB);
    const index = sections.findIndex(s => s.id === id);

    if (index === -1) return res.status(404).json({ error: 'Section not found' });

    sections[index] = { ...sections[index], ...updates };
    writeJSON(SECTIONS_DB, sections);
    res.json(sections[index]);
});

app.delete('/api/sections/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const sections = readJSON(SECTIONS_DB);
    const index = sections.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ error: 'Section not found' });

    sections.splice(index, 1);
    writeJSON(SECTIONS_DB, sections);
    res.json({ success: true });
});

// --- SCHOOL CONFIG ROUTES (Filtering) ---
app.get('/api/schools/:name/config', requireAuth, (req, res) => {
    const { name } = req.params;
    try {
        const configs = readJSON(SCHOOL_CONFIGS_DB);
        const config = configs.find(c => c.schoolName === name) || { schoolName: name, hiddenContentIds: [] };
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/schools/:name/config', requireAuth, (req, res) => {
    const { name } = req.params;
    const newConfig = req.body; // Expect { hiddenContentIds: [...] }

    const configs = readJSON(SCHOOL_CONFIGS_DB);
    const index = configs.findIndex(c => c.schoolName === name);

    const updatedConfig = {
        schoolName: name,
        hiddenContentIds: newConfig.hiddenContentIds || []
    };

    if (index >= 0) {
        configs[index] = updatedConfig;
    } else {
        configs.push(updatedConfig);
    }

    writeJSON(SCHOOL_CONFIGS_DB, configs);
    res.json(updatedConfig);
});

// RETRY/REPAIR ROUTE (Must be before static catch-all)
app.post('/api/content/:id/retry', requireAuth, (req, res) => {
    const { id } = req.params;
    log(`Manual Retry requested for ${id}`, 'INFO');

    try {
        const contentList = readJSON(DB_FILE);
        const index = contentList.findIndex(c => c.id === id);

        if (index === -1) return res.status(404).json({ error: 'Content not found' });

        const content = contentList[index];
        if (!content.texto_plano_url) return res.status(400).json({ error: 'No text file linked' });

        // Reset Status
        content.status = 'disponible'; // Always disponible to read
        content.ttsStatus = 'generando';
        content.processingStatus = {
            percentage: 0,
            currentSentence: 0,
            totalSentences: 0,
            status: 'processing',
            lastUpdated: new Date().toISOString()
        };
        writeJSON(DB_FILE, contentList);

        // Async Trigger
        const relativePath = content.texto_plano_url.replace(/^\/uploads\//, '');
        const textFullPath = path.join(UPLOAD_DIR, relativePath);

        ttsQueue.enqueue(content.id, () => generateAudioForContent(content.id, textFullPath, UPLOAD_DIR, (progress) => {
            // Re-read fresh to update
            const currentList = readJSON(DB_FILE);
            const idx = currentList.findIndex(c => c.id === id);
            if (idx !== -1) {
                // Merge status
                currentList[idx].processingStatus = progress;
                // If complete/failed
                if (progress.status === 'completed') currentList[idx].ttsStatus = 'listo';
                if (progress.status === 'failed' || progress.status === 'error_proveedor') currentList[idx].ttsStatus = 'error_proveedor';
                if (progress.status === 'processing') currentList[idx].ttsStatus = 'generando';
                writeJSON(DB_FILE, currentList);
            }
        }))
            .then(r => {
                if (r.abortedByProvider) log(`Retry aborted by provider for ${id}`, 'WARN');
                else log(`Retry result for ${id}: ${r.success}`, 'INFO');
            })
            .catch(e => log(`Retry crash for ${id}: ${e?.message || String(e)}`, 'ERROR'));

        res.json(content);

    } catch (e) {
        log(`Retry error: ${e}`, 'ERROR');
        res.status(500).json({ error: e.message });
    }
});

// --- LEO PEDAGOGICAL ENGINE (Fase 5) ---
app.post('/api/leo/ask', requireUserAuth, async (req, res) => {
    try {
        const {
            contentId, chunkIndex, interactionType, payload, exactSentence,
            // Advanced context fields (optional — graceful defaults applied in engine)
            sessionMemory, difficultyLevel,
            // Phase 5.5: pedagogical layer
            pedagogicalStage, readerProfile,
            // Phase 4: transitional context
            leoContext
        } = req.body;
        log(`Leo request: ${contentId} chunk: ${chunkIndex} type: ${interactionType} difficulty: ${difficultyLevel ?? 'default'} stage: ${pedagogicalStage ?? 'default'}`, 'INFO');
        
        const result = await processLeoRequest(
            contentId, chunkIndex, interactionType, payload, exactSentence,
            sessionMemory ?? null, difficultyLevel ?? null,
            pedagogicalStage ?? null, readerProfile ?? null,
            leoContext ?? null
        );
        
        res.status(200).json({ success: true, answer: result.answer });
    } catch (error) {
        log(`LeoEngine Guard/Policy Error: ${error.message}`, 'WARN');
        const errStr = error.message.toLowerCase();
        
        let statusCode = 500;
        if (errStr.includes("faltan parámetros") || errStr.includes("longitud permitida")) {
            statusCode = 400;
        } else if (errStr.includes("dominio autorizado") || errStr.includes("tipo de interacción")) {
            statusCode = 403;
        }

        res.status(statusCode).json({ 
            success: false, 
            answer: errStr.includes('dominio autorizado') 
                ? "¡Buena pregunta! Pero como estamos de exploración lectora, hablemos mejor sobre nuestra historia actual."
                : "¡Ups! Leo se distrajo. ¿Puedes intentarlo de nuevo?" 
        });
    }
});

// --- LEO MEMORY (Fase 5.6) ---
app.get('/api/leo/memory/:userId/:contentId', requireUserAuth, (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const key = makeProgressKey(userId, contentId);
        const db = ensureLeoMemoryDbShape(readJSON(LEO_MEMORY_DB));
        const memory = db.memoryMap[key];
        
        if (!memory) {
            return res.json({ 
                success: true, 
                memory: {
                    recentAnchors: [],
                    lastQuestionType: null,
                    sessionReadingProgress: 0,
                    difficultyLevel: "medio",
                    pedagogicalStage: 'comprehension'
                }
            });
        }
        res.json({ success: true, memory });
    } catch (e) {
        log(`GET Leo Memory Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to fetch Leo memory' });
    }
});

app.post('/api/leo/memory/:userId/:contentId', requireUserAuth, (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const payload = req.body;
        const key = makeProgressKey(userId, contentId);

        const db = ensureLeoMemoryDbShape(readJSON(LEO_MEMORY_DB));
        const existing = db.memoryMap[key] || {
            recentAnchors: [],
            lastQuestionType: null,
            sessionReadingProgress: 0,
            difficultyLevel: "medio",
            pedagogicalStage: 'comprehension'
        };

        const newMemory = {
            ...existing,
            ...payload,
            updatedAt: new Date().toISOString()
        };

        db.memoryMap[key] = newMemory;
        writeJSON(LEO_MEMORY_DB, db);

        res.json({ success: true, memory: newMemory });
    } catch (e) {
        log(`POST Leo Memory Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to save Leo memory' });
    }
});

// --- LEO PEDAGOGICAL INGESTION (Fase 5.x) ---
app.post('/api/leo/ingest', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // W2: Layer-2 magic-byte validation (same guard as /api/upload)
        const ingestFileTypeInfo = await fileTypeFromFile(req.file.path);
        const ingestRawExt = path.extname(req.file.originalname).toLowerCase().replace('.', '');
        const ingestCategory = getExpectedCategoryFromExtension(ingestRawExt);
        const ingestIsText = ingestCategory === 'text';
        const ingestIsValid = ingestIsText
            ? isTextFileSafe(req.file.path)
            : (ingestCategory !== 'unknown' && matchesExpectedCategory(ingestCategory, ingestFileTypeInfo));
        if (!ingestIsValid) {
            safeUnlink(req.file.path);
            log(`Leo ingest: magic-byte spoofing rejected — ${req.file.originalname} (category: ${ingestCategory}, real mime: ${ingestFileTypeInfo?.mime ?? 'none'})`, 'SECURITY');
            return res.status(415).json({ error: 'El contenido real del archivo no coincide con su extensión. Ingesta rechazada.' });
        }

        const { contentId, documentType } = req.body;
        if (!contentId || !documentType) {
            safeUnlink(req.file.path);
            return res.status(400).json({ error: 'Faltan contentId o documentType en el formulario.' });
        }

        const result = await ingestPedagogicalFile(req.file.path, req.file.originalname, contentId, documentType);

        safeUnlink(req.file.path);
        res.status(200).json(result);
    } catch (error) {
        log(`Leo Ingestion Error: ${error.message}`, 'ERROR');
        if (req.file && req.file.path) {
            safeUnlink(req.file.path);
        }
        
        let statusCode = 500;
        const errStr = error.message.toLowerCase();
        if (errStr.includes("no autorizado") || errStr.includes("no soportado") || errStr.includes("faltan")) {
            statusCode = 400;
        }

        res.status(statusCode).json({ error: error.message });
    }
});

// --- STATIC FILES ---
app.use('/uploads', express.static(UPLOAD_DIR));

if (IS_PROD) {
    const DIST_DIR = path.join(__dirname, '../dist');
    app.use(express.static(DIST_DIR));
    app.use((req, res) => {
        if (req.accepts('html')) {
            res.sendFile(path.join(DIST_DIR, 'index.html'));
        } else {
            res.status(404).json({ error: 'Not Found' });
        }
    });
}


// --- BACKGROUND JOBS (Passive Audio Audit Only) ---
const checkMissingTTS = async () => {
    log('Running startup passive audit for missing TTS audio...', 'TTS');
    try {
        const contentList = readJSON(DB_FILE);
        let itemsPending = 0;
        let dbModified = false;

        for (const content of contentList) {
            if (!content.texto_plano_url) continue;

            const relativePath = content.texto_plano_url.replace(/^\/uploads\//, '');
            const textFullPath = path.join(UPLOAD_DIR, relativePath);
            const manifestPath = path.join(UPLOAD_DIR, 'audio', content.id, 'manifest.json');

            // Purge stuck explicit main statuses if they exist and move failure state to TTS status implicitly
            if (content.status === 'procesando' || content.status === 'error') {
                content.status = 'disponible';
                if (content.ttsStatus === 'generando') {
                     content.ttsStatus = 'error_proveedor';
                     content.processingStatus = { ...content.processingStatus, status: 'error_proveedor', error: 'Server Restarted - Job Interrupted' };
                }
                dbModified = true;
            }

            if (fs.existsSync(textFullPath)) {
                let needsGen = false;
                if (!fs.existsSync(manifestPath)) {
                    needsGen = true;
                } else {
                    try {
                        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                        if (Object.keys(m).length === 0) needsGen = true;
                    } catch (e) {
                        needsGen = true;
                    }
                }

                if (needsGen) {
                    itemsPending++;
                    log(`[Startup Audit] Missing or incomplete audio for ${content.id}. Marking as pendiente.`, 'TTS');

                    if (content.ttsStatus !== 'pendiente' && content.ttsStatus !== 'error_proveedor') {
                        content.ttsStatus = 'pendiente';
                        dbModified = true;
                    }

                    // W5: Catch false 'listo' — ttsStatus says ready but manifest is absent/empty.
                    // This can happen if the server crashed between the final onProgress callback and
                    // the manifest file being fully written.
                    if (content.ttsStatus === 'listo') {
                        log(`[Startup Audit] ttsStatus='listo' but manifest missing/incomplete for ${content.id}. Resetting to pendiente.`, 'WARN');
                        content.ttsStatus = 'pendiente';
                        dbModified = true;
                    }

                    // No longer launching generateAudioForContent to avoid Thundering Herd APIs rate limits.
                }
            } else {
                log(`[Startup Audit] Text file physically missing for ${content.id}: ${textFullPath}`, 'WARN');
            }
        }

        if (dbModified) {
            writeJSON(DB_FILE, contentList);
            log('[Startup Audit] DB updated with pending TTS states and restored reader availability.', 'INFO');
        }

        if (itemsPending === 0) {
            log('Startup TTS check complete. All content has full audio manifest.', 'SUCCESS');
        } else {
            log(`Startup TTS check identified ${itemsPending} content items needing manual retry.`, 'INFO');
        }

    } catch (e) {
        log(`Error in startup TTS check: ${e.message}`, 'ERROR');
    }
};






app.listen(PORT, '0.0.0.0', () => {
    log(`Server running on port ${PORT}`);
    // Run background check after distinct delay to allow server to settle
    setTimeout(checkMissingTTS, 2000);
});
