

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
// P0.4 — validación estructural centralizada (zod). Aditivo.
import { validate } from './middleware/validate.js';
import { loginSchema, resetRequestSchema, resetConfirmSchema } from './schemas/auth.schema.js';
// P0.6 — access-log estructurado con request-id + redaction (capa incremental).
import { httpLogger } from './lib/logger.js';
import { createAdminAuth } from './lib/adminAuth.js';
// P2 — observabilidad (env-gated, default OFF → comportamiento idéntico).
import { metricsMiddleware, metricsHandler } from './observability/metrics.js';
import { readinessHandler } from './observability/health.js';
import { analyticsHealthHandler } from './observability/analyticsHealth.js';
import { registerRumRoute } from './observability/rum.js';
import { initErrorTracking } from './observability/errorTracking.js';
// P3-E — dual-write shadow real (gated IDENTITY_DUAL_WRITE; default OFF).
import { makeIdentityWriteHook, bootstrapIdentityDb } from './db/identityWriteHook.js';
// P4-A — cutover de LECTURA gated + fallback-safe (default IDENTITY_READ=json).
import { tryIdentitySqliteRead, markJsonRead, warmupReadFacade } from './db/identityReadFacade.js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { fileTypeFromFile } from 'file-type';
import archiver from 'archiver';

import { buildHealthPayload, getHealthDefaults } from './healthHandler.js';
import { ingestPedagogicalFile } from './leoIngester.js';
import { normalizeRequest, dispatchInteraction } from './leoOrchestrator.js';
import { getMediatorStudentSummary, getMediatorContentHistory } from './leoMediatorViewService.js';
import { getActivationOutputsForUser } from './leoActivationService.js';
import { createAccessService } from './accessService.js';
import {
    init as initMetrics,
    computeStudentMetrics,
    computeCourseMetrics,
    computeSchoolMetrics,
} from './metricsService.js';
import { UPLOADS_ROOT, USERS_DB, GROUPS_DB } from './config.js';
import { withUsersLock, withFileLock } from './usersLock.js';
import {
    findGroupsForSchool,
    groupChoice,
    validateExplicitGroupIds,
    addUserIdToGroup,
    addGroupIdToUser,
    removeUserIdFromGroup,
    removeGroupIdFromUser,
    diffIds,
    applyUserGroupsChange,
    applyGroupMembersChange,
    detachUserFromAllGroups,
    detachGroupFromAllUsers,
    unionGroupMemberIds,
    getGroupMembers,
    getExplicitGroupMembers,
    applyLegacyColegioFallback,
    userIsLectorLike,
    validateMembershipIntegrity,
    ERR as GROUP_MEMBERSHIP_ERR,
} from './groupMembershipService.js';
import { buildGroupDiagnosis } from '../utils/groupDiagnosis.mjs';
// Sprint MGL Fase 1 / M1 — state machine pura extraída de server.js a un
// módulo ESM compartido. server.js sigue exponiendo los nombres con `_` para
// no tocar los handlers de mutación existentes. Cambio cero-funcional.
import {
    sameSchool                       as _sameSchool,
    validateSameInstitution          as _validateSameInstitution,
    countFallbackVisibleLectors      as _countFallbackVisibleLectors,
    resolveMaterializableUsers       as _resolveMaterializableUsers,
    detectGroupMaterializationState  as _detectGroupMaterializationState,
} from '../utils/membershipGovernance.mjs';

// MGL-M2 — el endpoint de governance snapshot usa nombres modernos sin `_`
// (ajuste 5 del user: governance ya es dominio explícito, no helpers
// internos). Imports separados para hacer la distinción legible.
import {
    normalizeSchoolKey,
    detectGroupMaterializationState,
    buildGovernanceIndexes,
    countFallbackVisibleLectors,
    deriveOperationalRisk,
    deriveGovernanceStatus,
    deriveTransitionCapabilities,
    deriveMaterializationReadiness,
    deriveFallbackExtinguished,
    computeExplicitCoverage,
    comparePriority,
    SNAPSHOT_VERSION,
} from '../utils/membershipGovernance.mjs';
// NOTE: applyLegacyColegioFallback ya importado arriba desde groupMembershipService.js
// (que lo re-exporta literal desde utils/groupMembership.mjs). No duplicar aquí.
import { buildStudentStatus } from '../utils/studentStatus.mjs';
import {
    getProgressItem,
    getProgressByUser,
    getAllProgressAsMap,
    upsertProgress,
    getProgressCount,
    closeDb as closeProgressDb,
} from './progressService.js';
// Fase 2 — Offline Book Assignment (LU): SQLite-backed, 1 usuario = 1 libro.
import {
    getAssignment as getOfflineAssignment,
    upsertAssignment as upsertOfflineAssignment,
    deleteAssignment as deleteOfflineAssignment,
} from './offlineAssignmentService.js';
import { assignBookSchema } from './schemas/offline.schema.js';
// Data Backbone v1 — capa de eventos unificada (Sprint Fase 0).
// Convive en paralelo con analytics_db.json / playback_events.log / log() — dual-write,
// no reemplaza a nadie en Fase 0.
import {
    validateBackboneEvent,
    insertEvent as insertBackboneEvent,
    getBackboneEventsForMetrics,
    getBackboneEventStats,
} from './eventsService.js';
import { ulid, isValidUlid } from './ulid.js';
import {
    aggregateBackboneMetrics,
    emptyBackboneMetrics,
} from './backboneMetrics.js';
import {
    computeBackboneFunnels,
    emptyBackboneFunnels,
} from './backboneFunnels.js';
import {
    computeBackboneInsights,
    emptyBackboneInsights,
} from './backboneInsights.js';
import { processInsightsSnapshot } from './insightsStateEngine.js';
import {
    listStates             as listInsightStates,
    listNotifications      as listInsightNotifications,
    acknowledgeState       as ackInsightState,
    dismissState           as dismissInsightState,
    getScopeSummary        as getInsightsScopeSummary,
    ensureDbOpen           as ensureInsightsDbOpen,
} from './insightsStore.js';
import {
    buildStudentReadingTimeMap,
    buildStudentSessionTimelines,
    buildStudentLeoInteractionsMap,
    computeTemporalImpact,
    computePedagogicalProfile,
    aggregateCoursePedagogicalProfile,
    computeEffectivenessByType,
    computeSuccessPatterns,
    getRecommendedInterventionType,
    buildStudentInterventionHistory,
} from './interventionAnalyticsService.js';

// Configure dotenv to load from parent directory .env
// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });


const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV?.trim() === 'production';
const ACCESS_FALLBACK_MODE = process.env.ACCESS_FALLBACK_MODE || 'restricted'; // 'open' | 'restricted'
if (!process.env.ACCESS_FALLBACK_MODE) {
    // Warn loudly so this is visible in PM2 logs on every startup
    console.warn('[WARN] ACCESS_FALLBACK_MODE not set in .env — defaulting to "restricted". Set ACCESS_FALLBACK_MODE=open explicitly if open access is intended.');
}

// Configurar trust proxy para express-rate-limit detrás de Nginx Docker -> Host
app.set('trust proxy', 1);

import { generateAudioForContent } from './ttsService.js';
import * as ttsQueue from './ttsQueue.js';
import { runHybridTask, getGemini, GEMINI_TEXT_MODEL } from './aiEngine.js';
import { getOrGenerateAlbumRegionAudio, cleanupAlbumCache, purgeAlbumCacheForContent } from './albumTtsService.js';
import { getOrGenerateImmersiveAudio } from './immersiveTtsService.js';
// CHP-STATS-SHADOW-01A — frontera única de las rutas legacy de métricas.
// Import estático (no dinámico) porque `createShadowExecutor` se invoca en
// scope de módulo al registrar las rutas.
import { metricsEngineMode } from './metrics/metricsRouterV2.mjs';
import { executeMetricsRoute } from './metrics/metricsRouteBoundary.mjs';
import { createShadowExecutor } from './metrics/shadowExecutor.mjs';

// --- LOGGING HELPER ---
const log = (msg, type = 'INFO') => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${msg}`);
};

log(`Starting server in ${IS_PROD ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

// P2-D — init error tracking (noop sin DSN; jamás rompe el arranque).
try { initErrorTracking(); } catch (e) { log(`[error-tracking] ${e.message}`, 'WARN'); }
// P3-E — bootstrap identity.db (inerte si IDENTITY_SQLITE_ENABLED!=1; jamás
// rompe el arranque del API).
bootstrapIdentityDb(log)
  .then(() => warmupReadFacade())   // P4-A: precarga ESM si cutover habilitado
  .then(w => { if (w) log('[identity-read] facade warmed (cutover armable)'); })
  .catch(e => log(`[identity-db] ${e.message}`, 'WARN'));

// --- SECURITY MIDDLEWARE ---
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:4173'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser requests (e.g. server-to-server, curl) and whitelisted origins
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        log(`CORS rejected origin: ${origin}`, 'WARN');
        callback(new Error('CORS no permitido'));
    },
    credentials: true
}));
app.use(express.json());

// P0.6 — access-log estructurado (request-id + redaction). DESPUÉS de
// json() para no interferir el parseo; ANTES de las rutas para cubrir todo.
// Incremental: el log() legacy sigue intacto. Rollback = borrar esta línea.
app.use(httpLogger);
// P2-B — latencia/errores por ruta (overhead ~0 si METRICS_ENABLED off).
app.use(metricsMiddleware);

// Key by userId for authenticated requests — prevents shared school NAT IPs from
// exhausting a single bucket for all students. Falls back to IP for anonymous traffic.
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500,
    keyGenerator: (req) => req.headers['x-user-id'] || ipKeyGenerator(req),
    skip: (req) => req.path === '/api/health',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// --- AUTH HARDENING: Rate limiters específicos por endpoint sensible ---
// En dev los límites son relajados para no bloquear pruebas manuales.
// En prod se aplican límites estrictos contra fuerza bruta.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: IS_PROD ? 10 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intenta nuevamente en 15 minutos.' },
});

const acceptInviteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: IS_PROD ? 10 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intenta nuevamente en 15 minutos.' },
});

const resetRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: IS_PROD ? 5 : 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de restablecimiento. Intenta nuevamente en 1 hora.' },
});

const resetConfirmLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: IS_PROD ? 10 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intenta nuevamente en 15 minutos.' },
});

// --- TTS RATE LIMITER (per userId) ---
// In-memory sliding window: Map<userId, number[]> of request timestamps.
// Prevents a single user from spamming TTS, exhausting OpenAI quota or disk.
// Limits: 40 req/min for /api/tts, 60 req/min for /api/album/tts (disk-cached, cheaper).
// Window: 60 seconds. Resets per user independently.
const _ttsWindows    = new Map(); // userId → timestamp[]
const _albumWindows  = new Map(); // userId → timestamp[]

function makeTtsRateLimiter(windowMap, maxPerMinute) {
    return (req, res, next) => {
        const userId = req.headers['x-user-id'];
        if (!userId) return next(); // requireUserAuth will reject it
        const now  = Date.now();
        const hits = (windowMap.get(userId) ?? []).filter(t => now - t < 60_000);
        if (hits.length >= maxPerMinute) {
            recordTtsAbuse(userId);
            log(`[TTS_RATE] userId=${userId} hit limit ${maxPerMinute}/min abuses=${(_ttsUsage.get(userId)?.abuses ?? 1)}`, 'WARN');
            return res.status(429).json({ error: 'Límite de TTS alcanzado. Intenta en 1 minuto.' });
        }
        hits.push(now);
        windowMap.set(userId, hits);
        next();
    };
}

const ttsUserLimiter      = makeTtsRateLimiter(_ttsWindows,   IS_PROD ? 40  : 200);
const albumTtsUserLimiter = makeTtsRateLimiter(_albumWindows, IS_PROD ? 60  : 200);

// --- TTS USAGE TRACKING (in-memory, resets on restart) ---
// Estructura: Map<userId, { reqs: number, chars: number, lastAt: ISO, abuses: number }>
// Propósito: visibilidad operativa de quién consume TTS y en qué volumen.
// Separado del rate limiter — este persiste más allá de la ventana de 1 minuto.
const _ttsUsage = new Map();

function recordTtsUsage(userId, chars, endpoint = 'tts') {
    const now  = new Date().toISOString();
    const prev = _ttsUsage.get(userId) ?? { reqs: 0, chars: 0, lastAt: now, abuses: 0 };
    _ttsUsage.set(userId, {
        reqs:   prev.reqs + 1,
        chars:  prev.chars + chars,
        lastAt: now,
        abuses: prev.abuses,
        endpoint,
    });
}

function recordTtsAbuse(userId) {
    const prev = _ttsUsage.get(userId) ?? { reqs: 0, chars: 0, lastAt: new Date().toISOString(), abuses: 0 };
    _ttsUsage.set(userId, { ...prev, abuses: prev.abuses + 1 });
}

// --- ALBUM CACHE STARTUP GC ---
// Limpiar archivos viejos al arrancar (no bloquea — solo I/O de listado de directorios).
setImmediate(async () => {
    try {
        const result = await cleanupAlbumCache(30);
        if (result.removed > 0) {
            log(`[STARTUP] Album cache GC: removed=${result.removed} files bytes=${result.bytes}`);
        }
    } catch (e) {
        log(`[STARTUP] Album cache GC failed: ${e.message}`, 'WARN');
    }
});

// GC periódico: cada 24 horas mientras el proceso está vivo.
setInterval(async () => {
    try {
        const result = await cleanupAlbumCache(30);
        if (result.removed > 0) {
            log(`[GC] Album cache: removed=${result.removed} files bytes=${result.bytes}`);
        }
    } catch (e) {
        log(`[GC] Album cache failed: ${e.message}`, 'WARN');
    }
}, 24 * 60 * 60 * 1000).unref(); // .unref() — no bloquea cierre del proceso

// --- AUTH MIDDLEWARE ---

/**
 * requireAdminAccess — Acepta DOS formas de autenticación para operaciones de escritura:
 * A) x-admin-secret (backward compat, para scripts o llamadas server-to-server)
 * B) x-user-id con rol 'administrador' (frontend autenticado — forma recomendada)
 */

/**
 * P0 SECURITY FIX (auditoría 2026-05, hallazgo S1 CRÍTICO):
 * Cierra el GET-bypass ANÓNIMO. Antes, `if (req.method === 'GET') return next()`
 * dejaba pasar TODO GET sin credencial alguna → exfiltración no autenticada de
 * PII (usuarios, miembros de grupo, status de estudiante, historial Leo).
 *
 * Política nueva (mínima y localizada):
 *  - Los GET ya NO son anónimos: exigen admin-secret O una sesión x-user-id activa.
 *  - Los GET siguen SIN exigir ROL admin: se conserva el modelo de acceso sano
 *    y el frontend autenticado (incl. el preflight GET /api/content/:id/access
 *    que todo visor usa) sigue funcionando sin cambios.
 *
 * RESIDUAL CONOCIDO (fuera de este fix quirúrgico, ver
 * docs/AUDITORIA-ESTRUCTURAL-2026-05.md FASE 6): el IDOR de lectura entre
 * usuarios autenticados (un lector leyendo datos de otro vía estos GET) sigue
 * abierto y requiere un endurecimiento de rol posterior (P-follow-up).
 */
// FILE-01B: el secreto administrativo se lee EXCLUSIVAMENTE desde
// /app/secrets/admin_secret vía `headerMatchesAdminSecret` (helper file-only).
// Ningún consumidor lee ya el secreto desde el entorno. La lectura es asíncrona,
// sólo ocurre cuando hay un candidato x-admin-secret y falla cerrada.
//
// NOTA DE SEMÁNTICA (FILE-01B): el antiguo branch 503 de "secreto no configurado"
// se retira necesariamente. No se lee el archivo sin candidato header, y no se
// filtra la causa interna — un 503 por archivo ausente frente a un 401 por
// secreto erróneo revelaría el estado del archivo. Por tanto, archivo
// ausente/inválido se comporta como credencial inválida (mismo camino que un
// secreto erróneo). El camino de sesión ordinaria (x-user-id) es idéntico al
// anterior y NO se ve bloqueado por un fallo del helper.
// FILE-01B-R1: los cuatro consumidores se construyen desde la factoría real en
// server/lib/adminAuth.js (mismos símbolos que ejercen las pruebas HTTP). Los
// thunks de sesión son perezosos: `readJSON` e `isUserActive` son const definidos
// más abajo — capturarlos por closure (invocados en tiempo de request) evita la
// TDZ y no altera el orden de inicialización productivo.
const {
    isAdminRequest,
    getRequestHasValidPrincipal,
    allowAuthenticatedGetOrReject,
    requireAdminAccess,
    requireAuth,
} = createAdminAuth({
    readUsers: () => readJSON(USERS_DB),
    isUserActive: (user) => isUserActive(user),
    log: (msg, type) => log(msg, type),
});

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

    const users = readJSON(USERS_DB);
    const user = users.find(u => u.id === userId);

    if (!user) {
        log(`Unauthorized User ID attempt: ${userId}`, 'WARN');
        return res.status(403).json({ error: 'Acceso denegado: Usuario no encontrado' });
    }

    // Auth Pro: sesión activa no es suficiente si la cuenta fue deshabilitada.
    if (!isUserActive(user)) {
        log(`Session rejected: userId=${userId} accountStatus=${user.accountStatus}`, 'ACCESS');
        return res.status(403).json({ error: 'Acceso denegado: cuenta inactiva' });
    }

    req.user = user;
    next();
};

/**
 * Validates that the authenticated user (x-user-id header) matches the :userId URL param.
 * Applied to progress write endpoints that are NOT sendBeacon-based.
 */
const requireProgressOwner = (req, res, next) => {
    const userIdFromHeader = req.headers['x-user-id'];
    const userIdFromParam = req.params.userId;
    if (!userIdFromHeader || userIdFromHeader !== userIdFromParam) {
        log(`Progress auth rejected: header=${userIdFromHeader} param=${userIdFromParam}`, 'WARN');
        return res.status(401).json({ error: 'No autorizado: x-user-id requerido y debe coincidir con el usuario' });
    }
    const users = readJSON(USERS_DB);
    if (!users.find(u => u.id === userIdFromHeader)) {
        return res.status(401).json({ error: 'No autorizado: usuario no válido' });
    }
    next();
};

/**
 * RBAC middleware for upload/content write endpoints.
 * Requires x-user-id header and verifies the user has role 'administrador'.
 * GET requests pass through (read-only ops don't require upload rights).
 */
const requireAdminRole = (req, res, next) => {
    if (req.method === 'GET') return allowAuthenticatedGetOrReject(req, res, next);

    const userId = req.headers['x-user-id'];
    if (!userId) {
        log(`[AUTH_MISSING] method=${req.method} path=${req.path} ip=${req.ip}`, 'WARN');
        return res.status(401).json({ error: 'Auth requerida: x-user-id missing' });
    }

    const users = readJSON(USERS_DB);
    const user = users.find(u => u.id === userId);

    if (!user) {
        log(`[AUTH_FORBIDDEN] userId=${userId} reason=user_not_found method=${req.method} path=${req.path}`, 'WARN');
        return res.status(403).json({ error: 'Acceso denegado: usuario no encontrado' });
    }

    if (!isUserActive(user)) {
        log(`[AUTH_FORBIDDEN] userId=${userId} reason=account_inactive method=${req.method} path=${req.path}`, 'ACCESS');
        return res.status(403).json({ error: 'Acceso denegado: cuenta inactiva' });
    }

    const roles = Array.isArray(user.roles) ? user.roles : (user.rol ? [user.rol] : []);
    if (!roles.includes('administrador')) {
        log(`[AUTH_FORBIDDEN] userId=${userId} roles=${roles.join(',')} reason=not_admin method=${req.method} path=${req.path}`, 'ACCESS');
        return res.status(403).json({ error: 'Acceso denegado: se requiere rol administrador' });
    }

    req.user = user;
    next();
};

app.use('/api/upload', requireAdminRole);
app.use('/api/content', requireAdminRole);

// --- CONFIGURATION ---
// Canonical paths come from ./config.js (env-overridable).
// UPLOAD_DIR is an alias for UPLOADS_ROOT — preserves all existing usages in this file.
const UPLOAD_DIR = UPLOADS_ROOT;
const TEMP_DIR = path.join(UPLOAD_DIR, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// --- DATABASE FILES ---
// USERS_DB and GROUPS_DB imported from ./config.js — do not redefine here
// (CHP-ID-01-FIX-01 H1: única resolución en config.js).
const PROGRESS_DB = path.resolve(__dirname, '../data/progress_db.json');
const DB_FILE = path.resolve(__dirname, '../data/content.json');
const SECTIONS_DB = path.resolve(__dirname, '../data/sections.json'); // Added likely missing definition based on context
const SCHOOL_CONFIGS_DB = path.resolve(__dirname, '../data/school_configs.json');
const SCHOOLS_DB = path.resolve(__dirname, '../data/schools_db.json');
const ACCESS_DB = path.resolve(__dirname, '../data/access_db.json'); // FASE E6: Motor de Accesos por Scopes
const LEO_MEMORY_DB = path.resolve(__dirname, '../data/leo_memory_db.json'); // LEO SESSION PERSISTENCE
const BUNDLES_DB = path.resolve(__dirname, '../data/bundles_db.json');       // Fase 7: Bundles comerciales
const SUBMISSIONS_DB = path.resolve(__dirname, '../data/submissions_db.json'); // Exportación académica
const ANALYTICS_DB = path.resolve(__dirname, '../data/analytics_db.json');    // Reading event analytics
const PLAYBACK_EVENTS_LOG = path.resolve(__dirname, '../data/playback_events.log'); // Ritmo narrativo — append-only JSONL
const LEO_INTERACTIONS_DB = path.resolve(__dirname, '../data/leo_interactions_db.json'); // Leo interaction log (metadata only)
const INTERVENTIONS_DB = path.resolve(__dirname, '../data/interventions_db.json'); // Mediator interventions
const USER_AUDIT_DB = path.resolve(__dirname, '../data/user_audit_log.json'); // Auditoría de mutaciones de usuarios

// In-memory idempotency locks for content save operations.
// Key: `${actorId}:${contentId}`, TTL: 2 s. Prevents duplicate saves from network retries.
// Scope: single-process. On multi-instance deployments replace with Redis SETNX.
// TTL is intentionally short: covers browser double-submit and slow-network retry bursts.
// A slow backend (>2 s) could let a second request through — acceptable for this single-VPS setup.
const saveContentLocks = new Map();

// ── Hash index — deduplicación O(1) en uploads ───────────────────────────────
// Alternativa a escanear el directorio en cada upload (que sería O(n) y CPU-intensivo
// con archivos grandes). El índice se construye al arrancar leyendo uploads existentes
// con streams (nunca carga el archivo completo en RAM), y se mantiene actualizado con
// cada upload/purge/delete durante la sesión.
//
// Límites conocidos:
//   - In-process: si hay múltiples instancias, el índice no se sincroniza entre ellas.
//     Para el setup de VPS única actual esto es correcto.
//   - El índice no persiste entre reinicios del proceso, pero se reconstruye en <1 s
//     para catálogos típicos (<500 archivos).

/** Calcula el MD5 de un archivo leyéndolo como stream — nunca bloquea el event loop. */
const computeFileHashStream = (filePath) => new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(filePath)
        .on('data', chunk => hash.update(chunk))
        .on('end',  () => resolve(hash.digest('hex')))
        .on('error', reject);
});

/** hash → URL relativa (/uploads/...) */
const uploadHashIndex = new Map();

/** Escanea recursivamente UPLOAD_DIR y construye el índice. Fire-and-forget en startup. */
async function buildHashIndex(dir, baseDir) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await buildHashIndex(fullPath, baseDir);
        } else if (entry.isFile()) {
            try {
                const hash = await computeFileHashStream(fullPath);
                const rel  = path.relative(baseDir, fullPath);
                uploadHashIndex.set(hash, `/uploads/${rel.split(path.sep).join('/')}`);
            } catch (_e) { /* skip unreadable files */ }
        }
    }
}

log(`[CONFIG] UPLOADS_ROOT : ${UPLOADS_ROOT}`);
log(`[CONFIG] USERS_DB     : ${USERS_DB}`);
log(`Groups DB: ${GROUPS_DB}`);
log(`Progress DB: ${PROGRESS_DB}`);

// HARDENING — USERS_DB must exist. Never create it silently in another path.
// If the file is missing, the server cannot operate safely. Fail fast with a clear message.
//
// CHP-ID-CANON-01A: el canónico es data-critical/usuarios_colegios_oro.json.
// NO existe fallback al padrón LEGACY_NON_CANONICAL (ver server/config.js): si
// el canónico falta, se aborta en vez de resolver identidad sobre otro padrón.
if (!fs.existsSync(USERS_DB)) {
    log(`FATAL: Users DB no encontrado en: ${USERS_DB}`, 'ERROR');
    log(`FATAL: El padrón canónico es data-critical/usuarios_colegios_oro.json.`, 'ERROR');
    log(`FATAL: En dev local, define USERS_DB (env o .env) apuntando a tu padrón de desarrollo.`, 'ERROR');
    log(`FATAL: El padrón legacy NO se usa como fallback automático.`, 'ERROR');
    process.exit(1);
}

// CHP-ID-CANON-01B — la regla canónica ya se aplicó en server/config.js, en
// import-time (assertCanonicalUsersDb): si USERS_DB no es la ruta canónica del
// modo vigente, el proceso aborta antes de llegar hasta aquí. El padrón legacy
// no es admisible en ningún modo, tampoco como seed de desarrollo.

// HARDENING — UPLOADS_ROOT must exist.
if (!fs.existsSync(UPLOADS_ROOT)) {
    log(`FATAL: Directorio de uploads no encontrado: ${UPLOADS_ROOT}`, 'ERROR');
    log(`FATAL: Verifique que UPLOADS_ROOT env var apunta al directorio correcto o créelo.`, 'ERROR');
    process.exit(1);
}

// Ensure secondary DB files exist (auto-create is safe for these — not user-critical data)
[GROUPS_DB, DB_FILE, SCHOOLS_DB, ACCESS_DB].forEach(file => {
    if (!fs.existsSync(path.dirname(file))) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }
});

// Progress DB — now SQLite via progressService.js.
// SQLite file initializes lazily on first access (getDb() inside progressService).
// Ensure the data directory exists so SQLite can create its file there.
if (!fs.existsSync(path.dirname(PROGRESS_DB))) {
    fs.mkdirSync(path.dirname(PROGRESS_DB), { recursive: true });
}

// Initialize Leo Memory DB
if (!fs.existsSync(LEO_MEMORY_DB)) {
    fs.writeFileSync(LEO_MEMORY_DB, JSON.stringify({ memoryMap: {} }, null, 2));
}

// Initialize Submissions DB (exportación académica)
if (!fs.existsSync(SUBMISSIONS_DB)) {
    fs.writeFileSync(SUBMISSIONS_DB, JSON.stringify([], null, 2));
}

// Initialize Analytics DB
if (!fs.existsSync(ANALYTICS_DB)) {
    fs.writeFileSync(ANALYTICS_DB, JSON.stringify([], null, 2));
}

// Initialize Playback Events Log (JSONL — append-only, una línea por evento)
if (!fs.existsSync(PLAYBACK_EVENTS_LOG)) {
    fs.writeFileSync(PLAYBACK_EVENTS_LOG, '');
}

// Initialize Leo Interactions DB
if (!fs.existsSync(LEO_INTERACTIONS_DB)) {
    fs.writeFileSync(LEO_INTERACTIONS_DB, JSON.stringify([], null, 2));
}

// Initialize User Audit Log
if (!fs.existsSync(USER_AUDIT_DB)) {
    fs.writeFileSync(USER_AUDIT_DB, JSON.stringify([], null, 2));
}

// --- HELPER WRAPPERS ---
// ── In-memory TTL cache for hot read-only JSON files ─────────────────────────
// DB_FILE and other JSON sources are read on every request but rarely change.
// Caching them eliminates the dominant disk I/O bottleneck under load.
// writeJSON always invalidates so writes are immediately consistent within the
// same process.
//
// MULTI-INSTANCE COHERENCE — UNCACHED_JSON_FILES
// ----------------------------------------------
// In multi-instance deployments (api_1 + api_2 behind nginx) each process
// keeps its own _jsonCache. writeJSON only invalidates the cache of the
// process that wrote — so a registration that hits api_1 leaves api_2
// serving a stale list until its TTL expires. For files where read-after-
// write coherence MUST hold across instances, list them here.
//
// USERS_DB belongs here because the admin invites/creates a user and expects
// GET /api/users to reflect the change immediately on any instance. A 60s
// TTL was tolerable on a single process but breaks the gestor de usuarios
// in production (api_1 + api_2). This Set is the single source of truth for
// "do not cache this file in-process"; both _getCachedJSON and _setCachedJSON
// consult it (defense in depth).
const UNCACHED_JSON_FILES = new Set([USERS_DB]);

const _jsonCache = new Map(); // file → { data, expiresAt }
const _JSON_TTL = {
    // Per-file TTL overrides. Empty by default — UNCACHED_JSON_FILES takes
    // precedence over any TTL set here, so files in that Set are never cached
    // regardless of this map.
};
const _JSON_TTL_DEFAULT = 30_000; // content.json and others — 30s

const _getCachedJSON = (file) => {
    if (UNCACHED_JSON_FILES.has(file)) return null;
    const entry = _jsonCache.get(file);
    if (entry && Date.now() < entry.expiresAt) return entry.data;
    return null;
};

const _setCachedJSON = (file, data) => {
    if (UNCACHED_JSON_FILES.has(file)) return;
    const ttl = _JSON_TTL[file] ?? _JSON_TTL_DEFAULT;
    _jsonCache.set(file, { data, expiresAt: Date.now() + ttl });
};
// ─────────────────────────────────────────────────────────────────────────────

const readJSON = (file) => {
    const cached = _getCachedJSON(file);
    if (cached !== null) return cached;
    // P4-A — cutover de lectura: SOLO si IDENTITY_READ=sqlite + dominio
    // habilitado + shadow ok. Cualquier duda → null → cae a JSON (abajo).
    // NUNCA lanza. Default (json) ⇒ overhead ~0 (un check de env).
    {
        const _sql = tryIdentitySqliteRead(file,
            { usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: ACCESS_DB }, log);
        if (_sql) { _setCachedJSON(file, _sql); return _sql; }
        markJsonRead(file, { usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: ACCESS_DB });
    }
    try {
        if (!fs.existsSync(file)) {
            return file === PROGRESS_DB ? { progressMap: {} } : [];
        }
        const data = fs.readFileSync(file, 'utf8');
        if (!data.trim()) {
            return file === PROGRESS_DB ? { progressMap: {} } : [];
        }
        const parsed = JSON.parse(data);
        _setCachedJSON(file, parsed);
        return parsed;
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
        _jsonCache.delete(file); // invalidate cache immediately after write
        // P3-E — shadow dual-write (gated; no-bloqueante; jamás lanza).
        try { makeIdentityWriteHook({ usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: ACCESS_DB, log })(file, data); } catch { /* shadow nunca rompe el write */ }
    } catch (e) {
        log(`Error writing ${file}: ${e.message}`, 'ERROR');
        throw e; // Relanza error para permitir rollback transaccional
    }
};

const writeJSONAsync = async (file, data) => {
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.promises.rename(tmp, file);
    _jsonCache.delete(file);
    // P3-E — shadow dual-write (gated; no-bloqueante; jamás lanza).
    try { makeIdentityWriteHook({ usersDb: USERS_DB, groupsDb: GROUPS_DB, accessDb: ACCESS_DB, log })(file, data); } catch { /* shadow nunca rompe el write */ }
};

async function mutateUsers(fn) {
    return withUsersLock(USERS_DB, () => {
        _jsonCache.delete(USERS_DB);
        const users = readJSON(USERS_DB);
        return fn(users);
    });
}

// ─── ROUND 4 TIER B: per-domain mutate helpers (cross-container atomic RMW) ─
async function mutateGroups(fn) {
    return withFileLock(GROUPS_DB, () => {
        _jsonCache.delete(GROUPS_DB);
        const data = readJSON(GROUPS_DB);
        return fn(Array.isArray(data) ? data : []);
    }, 'groupsLock');
}
async function mutateSections(fn) {
    return withFileLock(SECTIONS_DB, () => {
        _jsonCache.delete(SECTIONS_DB);
        const data = readJSON(SECTIONS_DB);
        return fn(Array.isArray(data) ? data : []);
    }, 'sectionsLock');
}
async function mutateSchools(fn) {
    return withFileLock(SCHOOLS_DB, () => {
        _jsonCache.delete(SCHOOLS_DB);
        const data = readJSON(SCHOOLS_DB);
        return fn(Array.isArray(data) ? data : []);
    }, 'schoolsLock');
}
async function mutateSchoolConfigs(fn) {
    return withFileLock(SCHOOL_CONFIGS_DB, () => {
        _jsonCache.delete(SCHOOL_CONFIGS_DB);
        const data = readJSON(SCHOOL_CONFIGS_DB);
        return fn(Array.isArray(data) ? data : []);
    }, 'schoolConfigsLock');
}
async function mutateAccessRules(fn) {
    return withFileLock(ACCESS_DB, () => {
        _jsonCache.delete(ACCESS_DB);
        const data = readJSON(ACCESS_DB);
        return fn(Array.isArray(data) ? data : []);
    }, 'accessLock');
}
async function mutateLeoMemory(fn) {
    return withFileLock(LEO_MEMORY_DB, () => {
        _jsonCache.delete(LEO_MEMORY_DB);
        const raw = readJSON(LEO_MEMORY_DB);
        return fn(raw);
    }, 'leoMemoryLock');
}
async function mutateInterventions(fn) {
    return withFileLock(INTERVENTIONS_DB, () => {
        _jsonCache.delete(INTERVENTIONS_DB);
        const raw = readJSON(INTERVENTIONS_DB);
        const db = Array.isArray(raw?.interventions) ? raw : { interventions: [] };
        return fn(db);
    }, 'interventionsLock');
}
async function mutateUserAudit(fn) {
    return withFileLock(USER_AUDIT_DB, () => {
        _jsonCache.delete(USER_AUDIT_DB);
        const raw = readJSON(USER_AUDIT_DB);
        return fn(Array.isArray(raw) ? raw : []);
    }, 'userAuditLock');
}
async function mutateSubmissions(fn) {
    return withFileLock(SUBMISSIONS_DB, () => {
        _jsonCache.delete(SUBMISSIONS_DB);
        const raw = readJSON(SUBMISSIONS_DB);
        return fn(Array.isArray(raw) ? raw : []);
    }, 'submissionsLock');
}
async function mutateBundles(fn) {
    return withFileLock(BUNDLES_DB, () => {
        _jsonCache.delete(BUNDLES_DB);
        const raw = readJSON(BUNDLES_DB);
        return fn(Array.isArray(raw) ? raw : []);
    }, 'bundlesLock');
}
// ─── END ROUND 4 TIER B helpers ─────────────────────────────────────────

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

// --- E6/E7: ACCESS ENGINE ---
// resolveUserContentAccess, canUserAccessContent, getAccessibleContentIds
// se inicializan en accessService (ver más abajo, tras normalizeUser/normalizeGroup).
// Solo se llaman en tiempo de petición, por lo que la inicialización diferida es segura.

app.post('/api/access', requireAuth, async (req, res) => {
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

    const newRule = {
        id: payload.id || `access-${Date.now()}`,
        scope: payload.scope,
        scopeId: payload.scopeId,
        titleIds: Array.isArray(payload.titleIds) ? payload.titleIds.filter(id => typeof id === 'string') : [],
        collectionIds: Array.isArray(payload.collectionIds) ? payload.collectionIds.filter(id => typeof id === 'string') : [],
        expiresAt: parsedExpiresAt
    };

    await mutateAccessRules((rules) => {
        const index = rules.findIndex(r => r.id === newRule.id);
        if (index > -1) rules[index] = newRule;
        else rules.push(newRule);
        writeJSON(ACCESS_DB, rules);
    });
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
        'texto_portugues_url',
        'ilustraciones_url',
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

// Endpoint público de configuración runtime para el frontend.
// Solo expone valores no sensibles y mantiene fallback seguro si no hay env.
app.get('/api/runtime-config', (_req, res) => {
    const mediaBaseUrl = (process.env.MEDIA_BASE_URL || '').trim().replace(/\/+$/, '');
    res.json({ mediaBaseUrl });
});

// --- ROUTES ---

// Sprint 022 Fase 2B.4 — health endpoint enriquecido.
// Defaults (service/instance/version/commit) se resuelven UNA VEZ al
// startup; uptime y timestamp se computan por request. Sin auth, sin
// locks, sin tocar data — seguro para polling externo y healthcheck del
// edge. Backwards-compatible: `body.status === 'ok'` sigue siendo el
// contrato de cualquier monitor previo.
const _healthDefaults = getHealthDefaults();
app.get('/api/health', (_req, res) => res.json(buildHealthPayload(_healthDefaults)));

// ── P2 observabilidad — rutas ADITIVAS (liveness /api/health intacto) ──────
// /api/health/ready : readiness multi-capa (503 degraded ≠ liveness).
// /metrics          : Prometheus (404 si METRICS_ENABLED off; NO exponer
//                     vía nginx edge — Prometheus scrapea el api en la red
//                     interna docker). Sin auth para permitir scrape interno.
// /api/rum          : ingest acotado del runtime inmersivo (204 si off).
app.get('/api/health/ready', readinessHandler);
// P5 — health analítico (events.db + shadow consistency + throughput).
app.get('/api/health/analytics', analyticsHealthHandler);
app.get('/metrics', metricsHandler);
registerRumRoute(app);

// ── PASO 5 Aula Viva — operational router + scheduler ─────────────────────
// Aditivo, sin tocar handlers existentes. El router lleva su propia auth
// (inyectada). El scheduler queda OFF salvo AULA_VIVA_SCHEDULER_ENABLED=1.
try {
    const { createOperationalRouter } = await import('./aulaViva/operationalRouter.mjs');
    app.use('/api/aula-viva', createOperationalRouter({ requireUserAuth }));
    log('[PASO5] /api/aula-viva router mounted', 'INFO');
} catch (e) {
    log(`[PASO5] aula-viva router mount failed: ${e.message}`, 'WARN');
}
// PASO 7 — institutional router (paralelo a operational; paths bajo
// /institutional/* no solapan con PASO 5).
try {
    const { createInstitutionalRouter } = await import('./aulaViva/institutionalRouter.mjs');
    app.use('/api/aula-viva', createInstitutionalRouter({ requireUserAuth }));
    log('[PASO7] /api/aula-viva/institutional/* router mounted', 'INFO');
} catch (e) {
    log(`[PASO7] institutional router mount failed: ${e.message}`, 'WARN');
}
// CHP-API-METRICS-01A — API v2 de métricas sobre el motor canónico.
// Rutas NUEVAS bajo /api/v2/metrics/*: no tocan ninguna ruta legacy. El
// feature flag METRICS_ENGINE (default 'legacy') gobierna si el motor nuevo
// llega a responder por las rutas antiguas; estas v2 son siempre aditivas.
try {
    const { createMetricsRouterV2 } = await import('./metrics/metricsRouterV2.mjs');
    const { createMetricsProvider }  = await import('./metrics/metricsProvider.mjs');
    app.use('/api', createMetricsRouterV2({
        requireUserAuth,
        provider: createMetricsProvider(),
        now: () => Date.now(),
        log,
        express,
    }));
    log('[METRICS-V2] /api/v2/metrics/* router mounted', 'INFO');
} catch (e) {
    log(`[METRICS-V2] router mount failed: ${e.message}`, 'WARN');
}

// Scheduler init diferido al ready event para no bloquear boot.
if (process.env.AULA_VIVA_SCHEDULER_ENABLED === '1') {
    setImmediate(async () => {
        try {
            const sched = await import('./aulaViva/scheduler.mjs');
            const r = await sched.start({ log: (m) => log(m, 'INFO') });
            log(`[PASO5] scheduler.start → ${JSON.stringify(r)}`, 'INFO');
        } catch (e) {
            log(`[PASO5] scheduler.start failed: ${e.message}`, 'ERROR');
        }
    });
}

// --- SYSTEM METRICS (Phase 1 observability) ---
app.get('/api/system/metrics', requireAdminAccess, (req, res) => {
    const mem = process.memoryUsage();
    const elu = performance.eventLoopUtilization();
    res.json({
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        memory: {
            rss_mb: (mem.rss / 1048576).toFixed(1),
            heap_used_mb: (mem.heapUsed / 1048576).toFixed(1),
            heap_total_mb: (mem.heapTotal / 1048576).toFixed(1),
        },
        eventLoop: {
            utilization: elu.utilization.toFixed(4),
        },
        tts: {
            active: _ttsSemaphore.activeCount,
            queued: _ttsSemaphore.queueDepth,
        },
        jsonCache: {
            entries: _jsonCache.size,
        },
    });
});

// --- CHIBALETE LU — DISTRIBUCIÓN CONTROLADA ---
// Endpoint público: la app LU lo consulta para saber si debe actualizar.
// La configuración vive en data/lu_config.json — editar ahí para nuevas versiones.
const LU_CONFIG_DB = path.resolve(__dirname, '../data/lu_config.json');
const LU_CONFIG_DEFAULTS = {
    version: '0.1.0',
    apkUrl: 'https://chibaleteplus.chibaleteeditores.com/downloads/chibalete-lu.apk',
    forceUpdate: false,
    notes: 'Chibalete LU',
    minSupportedVersion: '0.1.0'
};
app.get('/api/lu/version', (req, res) => {
    try {
        let config = {};
        if (fs.existsSync(LU_CONFIG_DB)) {
            const raw = fs.readFileSync(LU_CONFIG_DB, 'utf8');
            config = JSON.parse(raw);
        }
        // Merge defensivo por campo: valida tipo antes de usar el valor del JSON.
        // Evita que null, "yes", u otros tipos incorrectos lleguen a la app LU.
        const payload = {
            version:              typeof config.version === 'string'              ? config.version              : LU_CONFIG_DEFAULTS.version,
            apkUrl:               typeof config.apkUrl === 'string'               ? config.apkUrl               : LU_CONFIG_DEFAULTS.apkUrl,
            forceUpdate:          typeof config.forceUpdate === 'boolean'         ? config.forceUpdate          : LU_CONFIG_DEFAULTS.forceUpdate,
            notes:                typeof config.notes === 'string'                ? config.notes                : LU_CONFIG_DEFAULTS.notes,
            minSupportedVersion:  typeof config.minSupportedVersion === 'string'  ? config.minSupportedVersion  : LU_CONFIG_DEFAULTS.minSupportedVersion,
        };
        res.json(payload);
    } catch (e) {
        log(`[LU] Error leyendo lu_config.json: ${e.message}. Respondiendo con defaults.`, 'WARN');
        res.json(LU_CONFIG_DEFAULTS);
    }
});

// --- BUNDLE ROUTES (Fase 7) ---
// Nombre interno: "bundles". Nombre visible en UI: "Experiencias".
app.get('/api/bundles', (req, res) => {
    try {
        res.json(readJSON(BUNDLES_DB));
    } catch (error) {
        res.status(500).json({ error: 'Failed to read bundles' });
    }
});

app.post('/api/bundles', requireAuth, async (req, res) => {
    const payload = req.body;
    if (!payload.name || !payload.name.trim()) {
        return res.status(400).json({ error: 'El nombre de la experiencia es obligatorio' });
    }
    const newBundle = {
        id: `bundle-${Date.now()}`,
        name: payload.name.trim(),
        shortDescription: payload.shortDescription || '',
        description: payload.shortDescription || payload.description || '',
        summary: payload.summary || '',
        includes: Array.isArray(payload.includes) ? payload.includes : [],
        contentIds: Array.isArray(payload.contentIds) ? payload.contentIds : [],
        tags: Array.isArray(payload.tags) ? payload.tags : []
    };
    await mutateBundles((bundles) => {
        bundles.push(newBundle);
        writeJSON(BUNDLES_DB, bundles);
    });
    log(`[BUNDLE] Created: ${newBundle.id} "${newBundle.name}"`);
    res.status(201).json(newBundle);
});

app.put('/api/bundles/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const payload = req.body;
    let updated = null;
    const conflict = await mutateBundles((bundles) => {
        const idx = bundles.findIndex(b => b.id === id);
        if (idx === -1) return { conflict: 'not_found' };
        bundles[idx] = { ...bundles[idx], ...payload, id }; // id inmutable
        updated = bundles[idx];
        writeJSON(BUNDLES_DB, bundles);
        return null;
    });
    if (conflict) return res.status(404).json({ error: 'Experiencia no encontrada' });
    log(`[BUNDLE] Updated: ${id}`);
    res.json(updated);
});

app.delete('/api/bundles/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const conflict = await mutateBundles((bundles) => {
        const filtered = bundles.filter(b => b.id !== id);
        if (filtered.length === bundles.length) return { conflict: 'not_found' };
        writeJSON(BUNDLES_DB, filtered);
        return null;
    });
    if (conflict) return res.status(404).json({ error: 'Experiencia no encontrada' });
    log(`[BUNDLE] Deleted: ${id}`);
    res.json({ ok: true });
});

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

        // Jerarquía de acceso (orden de evaluación):
        // 1. ADMIN_ROLE          → total, sin restricciones
        // 2. MEDIATOR_ORG        → catálogo activo de la organización del mediador
        // 3. GROUP_ASSIGNMENT    → asignación pedagógica activa en cualquier grupo
        // 4. SCOPE_ENGINE        → reglas en access_db.json (scope: user > group > org)
        // 5. LEGACY_GROUP        → group.availableContentIds + vigencia
        // 6. LEGACY_ORG          → schoolConfig.availableContentIds + vigencia
        // 7. FALLBACK            → según ACCESS_FALLBACK_MODE (open | restricted)

        // 3. Admin: acceso total irrestricto
        const roles = user.roles || (user.role ? [user.role] : (user.rol ? [user.rol] : ['lector']));
        if (roles.includes('administrador')) {
            log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via ADMIN_ROLE`, 'ACCESS');
            return res.json({ allowed: true, reason: 'Acceso administrativo total.' });
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
            if (!startStr && !endStr) return true;
            if (startStr && now < new Date(startStr).getTime()) return false;
            if (endStr   && now > new Date(endStr).getTime())   return false;
            return true;
        };

        // 6. Mediador: acceso ampliado dentro de su organización
        // DT-05: 'profesor' eliminado del modelo — solo 'mediador' es válido.
        if (roles.includes('mediador')) {
            const mediatorSchool = user.colegio || user.school || '';
            if (mediatorSchool) {
                try {
                    const schoolConfigs = readJSON(SCHOOL_CONFIGS_DB);
                    const schoolConfig = Array.isArray(schoolConfigs)
                        ? schoolConfigs.find(s => s.schoolName === mediatorSchool)
                        : schoolConfigs[mediatorSchool];
                    if (schoolConfig && isEntityActive(schoolConfig.accessStartsAt, schoolConfig.accessEndsAt)) {
                        const hasExplicitRestriction =
                            Array.isArray(schoolConfig.availableContentIds) ||
                            (Array.isArray(schoolConfig.collectionIds) && schoolConfig.collectionIds.length > 0);
                        if (hasExplicitRestriction) {
                            const orgTitles  = Array.isArray(schoolConfig.availableContentIds) ? schoolConfig.availableContentIds : [];
                            const orgExtra   = resolveCollectionContentIds(schoolConfig.collectionIds || []);
                            const orgCatalog = [...new Set([...orgTitles, ...orgExtra])];
                            if (orgCatalog.includes(contentId)) {
                                log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via MEDIATOR_ORG (${mediatorSchool})`, 'ACCESS');
                                return res.json({ allowed: true, reason: 'Acceso de mediador por catálogo institucional.' });
                            }
                            log(`[ACCESS] user ${userId} → content ${contentId} → DENIED via MEDIATOR_ORG_RESTRICTION (${mediatorSchool})`, 'ACCESS');
                            return res.status(403).json({ allowed: false, reason: 'Contenido fuera del catálogo de tu institución.' });
                        }
                    }
                } catch (e) {
                    log(`[access-check] Error reading school_configs for mediator: ${e.message}`, 'WARN');
                }
            }
            // Sin restricción institucional activa → acceso total (legado para mediadores sin configuración)
            log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via MEDIATOR_ROLE (sin restricción institucional)`, 'ACCESS');
            return res.json({ allowed: true, reason: 'Acceso de mediador (sin restricciones institucionales activas).' });
        }

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
        // SQLite solo almacena progressMap — assignments/assignmentsMap no existen en el schema actual.
        const assignmentsArr = [];

        const hasAssignment = assignmentsArr.some(a =>
            a.contentId === contentId &&
            (a.studentId === userId || (a.groupId && userGroups.some(g => g.id === a.groupId)))
        );

        if (hasAssignment) {
            log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via GROUP_ASSIGNMENT`, 'ACCESS');
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
                log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via GROUP_ALL (${g.id})`, 'ACCESS');
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
                            log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via ORG_ALL (${schoolName})`, 'ACCESS');
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
            if (ACCESS_FALLBACK_MODE === 'restricted') {
                log(`[ACCESS] user ${userId} → content ${contentId} → DENIED via LEGACY_NO_RULES (restricted mode)`, 'ACCESS');
                return res.status(403).json({ allowed: false, reason: 'Acceso restringido: sin catálogo activo para este usuario.' });
            }
            log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via LEGACY_OPEN (no active rules)`, 'ACCESS');
            return res.json({ allowed: true, reason: 'Sin restricciones comerciales activas (modo legacy).' });
        }

        if (unionAccess !== null && Array.isArray(unionAccess)) {
            if (unionAccess.includes(contentId)) {
                log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via GROUP_CATALOG`, 'ACCESS');
                return res.json({ allowed: true, reason: 'Contenido en catálogo autorizado del grupo.' });
            } else {
                log(`[ACCESS] user ${userId} → content ${contentId} → DENIED via CATALOG_RESTRICTION`, 'ACCESS');
                return res.status(403).json({ allowed: false, reason: 'Contenido fuera de tu catálogo autorizado.' });
            }
        }

        // Todos los grupos activos tenían bloqueo total ([]) → acceso denegado
        log(`[ACCESS] user ${userId} → content ${contentId} → DENIED via GROUP_BLOCK`, 'ACCESS');
        return res.status(403).json({ allowed: false, reason: 'Acceso bloqueado por reglas del grupo.' });

    } catch (err) {
        log(`[access-check] Error inesperado: ${err.message}`, 'ERROR');
        // UX-3B: distinguir error técnico (500 + errorCode ACCESS_CHECK_FAILED)
        // de denegación legítima (403 + errorCode ACCESS_DENIED). El frontend
        // los muestra distinto: error técnico ofrece reintentar, denegación
        // dice "no tienes acceso". Mantenemos `allowed: false` por compat.
        return res.status(500).json({
            allowed:   false,
            errorCode: 'ACCESS_CHECK_FAILED',
            reason:    'Error de servidor al verificar acceso.',
        });
    }
});


// DELETE CONTENT — M1: with full physical file cleanup
// requireAdminRole ya está aplicado via app.use('/api/content', requireAdminRole) arriba.
app.delete('/api/content/:id', async (req, res) => {
    const { id } = req.params;
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    log(`[DELETE_START] contentId=${id} actor=${actorId}`, 'INFO');

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

        // 6. Evict deleted URLs from uploadHashIndex to prevent stale dedup hits
        const deletedUrls = new Set([
            ...urlFields.map(f => item[f]).filter(u => u && typeof u === 'string'),
            ...(Array.isArray(item.ilustraciones_url) ? item.ilustraciones_url.filter(Boolean) : [])
        ]);
        if (Array.isArray(item.pages)) {
            item.pages.forEach(p => { if (p?.url) deletedUrls.add(p.url); if (p?.thumb) deletedUrls.add(p.thumb); });
        }
        if (Array.isArray(item.materials)) {
            item.materials.forEach(m => { if (m?.url) deletedUrls.add(m.url); });
        }
        for (const [hash, indexedUrl] of uploadHashIndex) {
            if (deletedUrls.has(indexedUrl)) uploadHashIndex.delete(hash);
        }

        // 7. Remove DB record — done last, after cleanup (atomic cross-container)
        await withFileLock(DB_FILE, () => {
            const freshList = readJSON(DB_FILE);
            const freshIdx = freshList.findIndex(c => c.id === id);
            if (freshIdx !== -1) freshList.splice(freshIdx, 1);
            writeJSON(DB_FILE, freshList);
        }, 'contentLock');
        log(`[DELETE_SUCCESS] contentId=${id} actor=${actorId}`, 'SUCCESS');

        res.json({ success: true, message: 'Content deleted successfully' });

    } catch (error) {
        log(`[DELETE_FAIL] contentId=${id} actor=${actorId} error=${error.message}`, 'ERROR');
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

// Límite duro defensivo de uploads. NO es un límite editorial artificial —
// es la frontera contra abuso (DoS por upload masivo / disco lleno). 2 GiB
// cubre con holgura ecosistemas editoriales reales: EPUB ilustrados,
// audiolibros completos, PDFs grandes, ZIPs de galerías. Si en el futuro
// se necesita más, subir aquí y en `client_max_body_size` de nginx
// simultáneamente — son los dos extremos de la misma cadena.
//
// Stack de defensa que se mantiene sobre el archivo aun bajo este límite:
//   - diskStorage: el archivo NUNCA se carga entero en RAM.
//   - fileFilter (capa 1): rechaza extensiones/MIMEs no permitidos antes
//     de que multer comience a escribir.
//   - magic numbers (capa 2): valida el contenido binario tras escribir.
//   - hash con stream: dedup sin cargar en RAM.
//   - safeUnlink en cualquier rama de error: no quedan huérfanos en TEMP.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_UPLOAD_BYTES },
});


// UPLOAD CON VALIDACIÓN BINARIA (Capa 2)
app.post('/api/upload', (req, res) => {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    const parentId = req.query.parentId ?? 'none';
    const startedAt = Date.now();
    log(`[UPLOAD_START] actor=${actorId} parentId=${parentId}`, 'INFO');

    // Observabilidad de aborto: si el cliente cierra la conexión a mitad
    // del stream (red caída, usuario cancela tab) queda log explícito.
    // multer detiene la escritura automáticamente; este handler solo
    // registra el evento.
    let abortedByClient = false;
    req.on('aborted', () => {
        abortedByClient = true;
        const elapsed = Date.now() - startedAt;
        log(`[UPLOAD_ABORTED] actor=${actorId} parentId=${parentId} durationMs=${elapsed}`, 'WARN');
    });

    upload.single('file')(req, res, async (err) => {
        if (err) {
            const elapsed = Date.now() - startedAt;
            // LIMIT_FILE_SIZE es el código estable de multer para superar
            // `limits.fileSize`. Lo distinguimos del resto porque el mensaje
            // técnico ("File too large") no le sirve al admin — necesita
            // saber el tope real configurado para decidir si insistir.
            if (err.code === 'LIMIT_FILE_SIZE') {
                const limitMB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
                log(`[UPLOAD_FAIL] actor=${actorId} reason=size_limit limitMB=${limitMB} durationMs=${elapsed}`, 'WARN');
                return res.status(413).json({
                    error: `El archivo supera el tope técnico de seguridad (${limitMB} MB). Si es un asset editorial legítimo, contacta al equipo para revisar el tope.`,
                    code: 'LIMIT_FILE_SIZE',
                    limitMB,
                });
            }
            log(`[UPLOAD_FAIL] actor=${actorId} reason=middleware error=${err.message} durationMs=${elapsed}`, 'ERROR');
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            const elapsed = Date.now() - startedAt;
            log(`[UPLOAD_FAIL] actor=${actorId} reason=no_file durationMs=${elapsed}`, 'WARN');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const tempPath = req.file.path;
        const sizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

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
                log(`[UPLOAD_FAIL] actor=${actorId} reason=spoofing file=${req.file.originalname} expected=${expectedCategory} actual=${fileTypeInfo?.mime ?? 'none'}`, 'SECURITY');
                return res.status(415).json({ error: 'El contenido real del archivo no coincide con su extensión o contiene código binario no seguro.' });
            }

            // Deduplicación O(1): hash del archivo actual con stream (no carga en RAM),
            // consulta el índice en memoria construido al arrancar.
            const fileHash = await computeFileHashStream(tempPath);
            const dedupUrl = uploadHashIndex.get(fileHash);
            if (dedupUrl) {
                safeUnlink(tempPath);
                const elapsed = Date.now() - startedAt;
                log(`[UPLOAD_DEDUP] actor=${actorId} url=${dedupUrl} sizeMB=${sizeMB} durationMs=${elapsed} mime=${fileTypeInfo?.mime ?? 'unknown'}`, 'INFO');
                return res.status(200).json({
                    success: true,
                    url: dedupUrl,
                    filename: path.basename(dedupUrl),
                    mimetype: fileTypeInfo ? fileTypeInfo.mime : (expectedCategory === 'text' ? 'text/plain' : req.file.mimetype),
                    size: req.file.size,
                    deduplicated: true,
                });
            }

            // Mover a destino definitivo si pasó las mallas y no es duplicado
            let finalDestDir = UPLOAD_DIR;
            if (req.query.parentId) {
                finalDestDir = path.join(UPLOAD_DIR, req.query.parentId);
                if (!fs.existsSync(finalDestDir)) fs.mkdirSync(finalDestDir, { recursive: true });
            }

            const finalPath = path.join(finalDestDir, req.file.filename);
            fs.renameSync(tempPath, finalPath);

            const relativePath = path.relative(UPLOAD_DIR, finalPath);
            const fileUrl = `/uploads/${relativePath.split(path.sep).join('/')}`;

            // Actualizar índice con el nuevo archivo
            uploadHashIndex.set(fileHash, fileUrl);

            const elapsed = Date.now() - startedAt;
            log(`[UPLOAD_SUCCESS] actor=${actorId} file=${req.file.filename} sizeMB=${sizeMB} durationMs=${elapsed} mime=${fileTypeInfo?.mime ?? 'text'} parentId=${parentId}`, 'SUCCESS');
            res.status(200).json({
                success: true,
                url: fileUrl,
                filename: req.file.filename,
                mimetype: fileTypeInfo ? fileTypeInfo.mime : (expectedCategory === 'text' ? 'text/plain' : req.file.mimetype),
                size: req.file.size
            });

        } catch (validationErr) {
            const elapsed = Date.now() - startedAt;
            log(`[UPLOAD_FAIL] actor=${actorId} reason=validation_crash error=${validationErr.message} sizeMB=${sizeMB} durationMs=${elapsed} aborted=${abortedByClient}`, 'ERROR');
            safeUnlink(tempPath);
            res.status(415).json({ error: 'El archivo no pudo ser leído. Puede estar corrupto o truncado.' });
        }
    });
});

// W1: ORPHAN PURGE ROUTE
// Protected by app.use('/api/upload', requireAdminRole) already registered above.
// Frontend calls this best-effort when a metadata save fails after files were uploaded.
app.post('/api/upload/purge', (req, res) => {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    const { url } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) {
        return res.status(400).json({ error: 'Invalid url — must start with /uploads/' });
    }
    const rawName = url.replace(/^\/uploads\//, '');
    const resolved = path.resolve(UPLOAD_DIR, rawName);
    const rel = path.relative(path.resolve(UPLOAD_DIR), resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        log(`[PURGE_FAIL] actor=${actorId} reason=path_traversal url=${url}`, 'SECURITY');
        return res.status(400).json({ error: 'Path traversal rejected' });
    }
    log(`[PURGE_START] actor=${actorId} url=${url}`, 'INFO');
    safeUnlink(resolved);
    // Remove from hash index so the URL is not returned as a dedup hit for future uploads
    for (const [hash, indexedUrl] of uploadHashIndex) {
        if (indexedUrl === url) { uploadHashIndex.delete(hash); break; }
    }
    // Remove parent dir if it's now empty (leaves no ghost folders from parentId uploads)
    try {
        const parentDir = path.dirname(resolved);
        const parentRel = path.relative(path.resolve(UPLOAD_DIR), parentDir);
        const isSubdir = parentRel && !parentRel.startsWith('..') && !path.isAbsolute(parentRel) && parentRel !== '.';
        if (isSubdir && fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
            fs.rmdirSync(parentDir);
            log(`[PURGE_SUCCESS] actor=${actorId} url=${url} empty_dir_removed=${parentDir}`, 'CLEANUP');
        } else {
            log(`[PURGE_SUCCESS] actor=${actorId} url=${url}`, 'CLEANUP');
        }
    } catch (e) {
        log(`[PURGE_SUCCESS] actor=${actorId} url=${url} dir_cleanup_warn=${e.message}`, 'CLEANUP');
    }
    res.json({ success: true });
});

/**
 * syncNewContentToOrgAccessRules
 *
 * Propaga un nuevo contentId a los titleIds de todas las reglas de acceso de
 * scope 'organization' que estén vigentes en access_db.json.
 *
 * Política:
 *   - Solo scope 'organization': representa catálogo institucional.
 *   - No toca scope 'group' ni 'user': son asignaciones específicas del mediador/admin.
 *   - No crea reglas nuevas. Solo actualiza las existentes.
 *   - Salta reglas expiradas (expiresAt < Date.now()).
 *   - Deduplica titleIds antes de escribir.
 *   - Si no existen reglas org activas, emite warning y retorna sin cambios.
 *
 * @param {string} contentId - ID del contenido recién creado
 */
function syncNewContentToOrgAccessRules(contentId) {
    // Sync signature preservada para callers sincronos en content handlers.
    // El trabajo real corre en async+lock (fire-and-forget, never blocks response).
    (async () => {
        try {
            const now = Date.now();
            await mutateAccessRules((rules) => {
                if (!Array.isArray(rules) || rules.length === 0) {
                    log(`[ACCESS_SYNC] WARN: access_db.json está vacío. El contenido ${contentId} no fue asignado a ninguna regla de acceso. Revisión administrativa requerida.`, 'WARN');
                    return;
                }
                const activeOrgRules = rules.filter(r =>
                    r.scope === 'organization' &&
                    !(typeof r.expiresAt === 'number' && Number.isFinite(r.expiresAt) && now > r.expiresAt)
                );
                if (activeOrgRules.length === 0) {
                    log(`[ACCESS_SYNC] WARN: No existen reglas activas de scope 'organization' en access_db.json. El contenido ${contentId} no fue asignado automáticamente. Revisión administrativa requerida.`, 'WARN');
                    return;
                }
                let syncedCount = 0;
                const updatedRules = rules.map(rule => {
                    if (rule.scope !== 'organization') return rule;
                    if (typeof rule.expiresAt === 'number' && Number.isFinite(rule.expiresAt) && now > rule.expiresAt) return rule;
                    const current = Array.isArray(rule.titleIds) ? rule.titleIds : [];
                    if (current.includes(contentId)) return rule;
                    syncedCount++;
                    return { ...rule, titleIds: [...current, contentId] };
                });
                if (syncedCount === 0) return;
                writeJSON(ACCESS_DB, updatedRules);
                log(`[ACCESS_SYNC] Contenido ${contentId} agregado a ${syncedCount} regla(s) de organización en access_db.json.`, 'INFO');
            });
        } catch (e) {
            log(`[ACCESS_SYNC] ERROR sync ${contentId}: ${e.message}`, 'ERROR');
        }
    })();
}

// ── Album data validation ─────────────────────────────────────────────────────

/**
 * validateAlbumData(albumData)
 *
 * Validates the album_data array before it is persisted to content.json.
 * Returns null when the data is valid; returns an error string when invalid.
 *
 * Rules:
 *   - Must be an array (may be empty — editor allows metadata-only updates)
 *   - Each page must have a non-empty string imageUrl
 *   - Each page's regions must be an array
 *   - Each region's coordinates (x, y, width, height) must be numbers in [0, 100]
 *   - type='audio'  → audioUrl required
 *   - type='nav'    → navTargetPageId required
 *
 * Does NOT reject unknown fields (forward compat with future 2.0-B extensions).
 */
function validateAlbumData(albumData) {
    if (!Array.isArray(albumData)) {
        return 'album_data debe ser un array';
    }

    for (let pi = 0; pi < albumData.length; pi++) {
        const page = albumData[pi];
        const pageLabel = `Página ${pi + 1}`;

        if (!page || typeof page !== 'object') {
            return `${pageLabel}: entrada inválida (no es un objeto)`;
        }
        if (!page.imageUrl || typeof page.imageUrl !== 'string') {
            return `${pageLabel}: falta imageUrl`;
        }
        if (!Array.isArray(page.regions)) {
            return `${pageLabel}: regions debe ser un array`;
        }

        for (let ri = 0; ri < page.regions.length; ri++) {
            const region = page.regions[ri];
            const regionLabel = `${pageLabel} zona ${ri + 1}`;

            if (!region || typeof region !== 'object') {
                return `${regionLabel}: entrada inválida`;
            }

            // Coordinate bounds — all four are required and must be 0–100
            for (const coord of ['x', 'y', 'width', 'height']) {
                const val = region[coord];
                if (typeof val !== 'number' || val < 0 || val > 100) {
                    return `${regionLabel}: '${coord}' debe ser un número entre 0 y 100 (recibido: ${val})`;
                }
            }

            // Dimensions must be positive (not just non-negative)
            if (region.width <= 0 || region.height <= 0) {
                return `${regionLabel}: width y height deben ser mayores a cero`;
            }

            // Region text is required only when the experience mode / action does NOT
            // exempt it. Mirrors the frontend V4 rule in SubirContenido.tsx exactly.
            //
            // Exempt cases (text intentionally absent or carried by a different field):
            //   • type='contemplative'        — silent observation zone; text cleared by editor
            //   • action.type='audio'         — payload is audioUrl, not narrative text
            //   • action.type='jump'/'return' — payload is targetPageId; no TTS needed
            //   • action.type='text'          — overlay text lives in action.text, not region.text
            //   • action.type='leo'           — Leo seed in action.leoPrompt; text optional
            //   • action.type='none'          — pure zoom, no interaction
            // Legacy compat: type='audio' and type='nav' (pre-2.0-C) are also exempt
            // because their payloads live in region.audioUrl / region.navTargetPageId.
            const ACTION_EXEMPTS_TEXT = ['audio', 'jump', 'text', 'leo', 'none', 'return'];
            const actionExemptsText =
                ACTION_EXEMPTS_TEXT.includes(region.action?.type) ||
                region.type === 'audio' ||   // legacy 2.0-B
                region.type === 'nav';       // legacy 2.0-B
            const needsText = region.type !== 'contemplative' && !actionExemptsText;
            if (needsText && (typeof region.text !== 'string' || !region.text.trim())) {
                return `${regionLabel}: falta o está vacío el campo 'text'`;
            }

            // type-conditional requirements (legacy 2.0-B fields — still validated for
            // content saved before the 2.0-C unified action model)
            if (region.type === 'challenge' && (!region.interactiveHint || !region.interactiveHint.trim())) {
                return `${regionLabel}: type='challenge' requiere 'interactiveHint' con texto (es el texto del desafío visible al estudiante)`;
            }
            if (region.type === 'audio' && !region.audioUrl) {
                return `${regionLabel}: type='audio' requiere audioUrl`;
            }
            if (region.type === 'nav' && !region.navTargetPageId) {
                return `${regionLabel}: type='nav' requiere navTargetPageId`;
            }
        }
    }

    return null; // valid
}

// SAVE CONTENT METADATA
app.post('/api/content', async (req, res) => {
    try {
        const newContent = req.body;

        // 1. Validar metadata base para evitar registros basura
        if (!newContent.id || !newContent.titulo) {
             return res.status(400).json({ error: 'Faltan campos obligatorios de Metadata (id, titulo)' });
        }

        // 2. Validar album_data si está presente
        if (newContent.tipo === 'libro_album' && Array.isArray(newContent.album_data) && newContent.album_data.length > 0) {
            const albumError = validateAlbumData(newContent.album_data);
            if (albumError) {
                return res.status(400).json({ error: `album_data inválido: ${albumError}` });
            }
        }

        const saveActorId = req.headers['x-user-id'] ?? 'unknown';

        // Idempotency guard: si llegan dos requests idénticos en ráfaga (retry de red),
        // el segundo sobreescribe al primero con los mismos datos — benigno en create/update.
        // El verdadero riesgo es títulos/IDs duplicados por race condition. Guard mínimo:
        // rechazar si el body no tiene ID válido (ya cubierto arriba) o si el ID existe
        // y el request parece un create accidental (título exactamente igual + mismo actor + <2s).
        // Implementamos un lock simple en memoria para la ventana de 2s.
        const lockKey = `${saveActorId}:${newContent.id}`;
        if (saveContentLocks.has(lockKey)) {
            log(`[CONTENT_SAVE_SKIP] contentId=${newContent.id} actor=${saveActorId} reason=idempotency_lock`, 'WARN');
            // Devolvemos 200 con el contenido actual — el cliente no nota la diferencia
            const currentList = readJSON(DB_FILE);
            const existing = currentList.find(c => c.id === newContent.id);
            return res.json({ success: true, content: existing || newContent, deduplicated: true });
        }
        saveContentLocks.set(lockKey, true);
        setTimeout(() => saveContentLocks.delete(lockKey), 2000);

        const contentList = readJSON(DB_FILE);

        // Check for text changes to trigger TTS
        const index = contentList.findIndex((c) => c.id === newContent.id);
        log(`[CONTENT_SAVE_START] contentId=${newContent.id} actor=${saveActorId} isUpdate=${index >= 0}`, 'INFO');
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

        // 2. Transaccionalidad / Rollback Crítico (atomic cross-container lock)
        try {
            await withFileLock(DB_FILE, () => {
                const freshList = readJSON(DB_FILE);
                const freshIdx = freshList.findIndex(c => c.id === newContent.id);
                if (freshIdx >= 0) {
                    freshList[freshIdx] = newContent;
                } else {
                    freshList.push(newContent);
                }
                writeJSON(DB_FILE, freshList);
            }, 'contentLock');
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

        // 3. Sync de acceso: propagar nuevo contenido a reglas org activas
        if (index === -1) {
            syncNewContentToOrgAccessRules(newContent.id);
        }

        log(`[CONTENT_SAVE_SUCCESS] contentId=${newContent.id} actor=${saveActorId}`, 'SUCCESS');
        res.json({ success: true, content: newContent });

        // --- ASYNC TTS TRIGGER ---
        if (shouldGenerateTTS) {
            log(`Triggering TTS background generation for ${newContent.id}...`, 'TTS');
            const relativePath = newContent.texto_plano_url.replace(/^\/uploads\//, '');
            const textFullPath = path.join(UPLOAD_DIR, relativePath);

            // Progress Handler (fire-and-forget async to avoid blocking TTS engine)
            const onProgress = (status) => {
                (async () => {
                    try {
                        await withFileLock(DB_FILE, () => {
                            const currentList = readJSON(DB_FILE);
                            const idx = currentList.findIndex(c => c.id === newContent.id);
                            if (idx !== -1) {
                                currentList[idx].processingStatus = status;
                                if (status.status === 'processing') currentList[idx].ttsStatus = 'generando';
                                if (status.status === 'error_proveedor') currentList[idx].ttsStatus = 'error_proveedor';
                                if (status.status === 'failed') currentList[idx].ttsStatus = 'error_proveedor';
                                if (status.status === 'completed') currentList[idx].ttsStatus = 'listo';
                                writeJSON(DB_FILE, currentList);
                            }
                        }, 'contentLock');
                    } catch (e) { /* ignore DB locks/rates */ }
                })();
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

// --- AUDIT HELPERS ---

/**
 * writeAuditLog — Registra un evento de mutación de usuario en user_audit_log.json.
 * Nunca lanza: un fallo de auditoría jamás debe bloquear la operación principal.
 *
 * Campos estándar:
 *   action       — string: create_user | update_user | delete_user |
 *                          reset_password_request | reset_password_confirm | role_change
 *   targetUserId — string: ID del usuario afectado
 *   actor        — string | null: ID del admin que ejecuta la acción (null si es auto-servicio)
 *   details      — object: contexto mínimo relevante por evento
 */
const writeAuditLog = (entry) => {
    // Sync signature preservada. Write corre async+lock (fire-and-forget).
    //
    // Commit 5.5: auditReferenceId (ULID) — identidad operacional primaria
    // para cross-correlación forensic futura.
    //
    // Commit 5.5a (override-proof): spread del entry PRIMERO, luego asigna
    // auditReferenceId y timestamp. Este orden garantiza que el server es
    // dueño absoluto de ambos campos — si un caller pasa
    // `auditReferenceId: 'fake'` en su entry, queda overrideado por el ulid()
    // generado server-side. Mismo principio para timestamp.
    const enriched = {
        ...entry,
        auditReferenceId: ulid(),
        timestamp:        new Date().toISOString(),
    };
    (async () => {
        try {
            await mutateUserAudit((entries) => {
                entries.push(enriched);
                writeJSON(USER_AUDIT_DB, entries);
            });
        } catch (e) {
            log(`[AUDIT] Error escribiendo entrada de auditoría: ${e.message}`, 'WARN');
        }
    })();
};

// --- USER HELPERS ---

/**
 * isUserActive — Auth Pro
 * Retorna true si el usuario puede autenticarse.
 * Usuarios sin accountStatus (legacy) se tratan como 'active'.
 */
const isUserActive = (user) => {
    const status = user?.accountStatus;
    return !status || status === 'active';
};

const sanitizeUserForClient = (user) => {
    const { password, inviteToken, inviteExpiresAt, resetToken, resetExpiresAt, ...safeUser } = user;
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
    // DT-05: 'profesor' eliminado del modelo. Safety net: mapear → 'mediador' si llega de datos legacy.
    const mappedRoles = roles.map(r => r === 'admin' ? 'administrador' : r === 'profesor' ? 'mediador' : r);
    const validRoles = ['administrador', 'mediador', 'lector'];
    const filteredRoles = mappedRoles.filter(r => validRoles.includes(r));
    return filteredRoles.length > 0 ? filteredRoles : ['lector'];
};

const hashPasswordIfNeeded = async (password) => {
    if (!password) return undefined;
    if (password.startsWith('$2')) return password; // Already hashed by bcrypt
    return await bcrypt.hash(password, 10);
};

// --- PROGRESS SYNC HELPERS (Fase 3.2) ---
const makeProgressKey = (userId, contentId) => `${userId}__${contentId}`;

const normalizeCanonicalProgress = (payload) => {
    const base = {
        sentenceIndex: Math.max(0, parseInt(payload?.sentenceIndex || 0, 10)),
        totalSentences: Math.max(0, parseInt(payload?.totalSentences || 0, 10)),
        globalPercentage: Math.max(0, Math.min(100, parseFloat(payload?.globalPercentage || 0.0))),
        contentAnchor: payload?.contentAnchor ? String(payload.contentAnchor).substring(0, 100) : null,
        contentFingerprint: payload?.contentFingerprint ? String(payload.contentFingerprint).substring(0, 50) : null,
        lastInteractedMode: ['pdf', 'text', 'accessible', 'immersive'].includes(payload?.lastInteractedMode)
            ? payload.lastInteractedMode : 'text'
    };
    // Fase E: pass through precision anchor if structurally valid.
    const a = payload?.anchor;
    if (a && ['text', 'sentence', 'page'].includes(a.type) && typeof a.value === 'number' && isFinite(a.value)) {
        base.anchor = { type: a.type, value: a.value };
    }
    // Fase F: pass through viewportHint (float 0–100) if valid.
    if (typeof payload?.viewportHint === 'number' && isFinite(payload.viewportHint) &&
        payload.viewportHint >= 0 && payload.viewportHint <= 100) {
        base.viewportHint = payload.viewportHint;
    }
    return base;
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
        const sid = String(newSession.sessionId);
        const existingIdx = history.findIndex(h => h.sessionId === sid);
        const entry = {
            sessionId: sid,
            startedAt: newSession.startedAt || new Date().toISOString(),
            mode: newSession.mode || 'text',
            durationSec: Math.max(0, parseInt(newSession.durationSec || 0, 10))
        };
        if (existingIdx >= 0) {
            // Update in-place — heartbeat keeps updating durationSec for the same session
            history[existingIdx] = entry;
        } else {
            history.push(entry);
        }
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

// ---------------------------------------------------------------------------
// READING PROGRESS — canonical computed model
// ---------------------------------------------------------------------------

const ABANDONED_THRESHOLD_DAYS = 30;

/**
 * Derive a canonical ReadingProgress record from a raw progress_db entry.
 * No fields are written back to the DB — this is a pure computation.
 *
 * Status rules:
 *   completed  — pct >= 90 OR isCompleted flag (legacy safety net)
 *   abandoned  — no activity for ABANDONED_THRESHOLD_DAYS AND pct < 50
 *   in_progress — has history and pct between 1 and 89
 *   not_started — no record (caller must handle) or no history and pct === 0
 */
function computeReadingProgress(raw) {
    const pct     = raw.canonicalProgress?.globalPercentage ?? 0;
    const history = Array.isArray(raw.history) ? raw.history : [];

    const totalReadingTimeMs = history.reduce((sum, h) => sum + Math.max(0, (h.durationSec ?? 0)) * 1000, 0);
    const totalSessions      = history.length;

    const firstReadAt = history.length > 0
        ? history.reduce((min, h) => (h.startedAt && h.startedAt < min ? h.startedAt : min), history[0].startedAt ?? raw.updatedAt)
        : (raw.updatedAt ?? null);

    const lastReadAt  = raw.updatedAt ?? null;
    const lastPosition = raw.canonicalProgress?.sentenceIndex ?? null;

    let status;
    if (pct >= 90 || raw.isCompleted === true) {
        status = 'completed';
    } else if (pct <= 0 && totalSessions === 0) {
        status = 'not_started';
    } else {
        const daysSince = lastReadAt
            ? (Date.now() - new Date(lastReadAt).getTime()) / (1000 * 60 * 60 * 24)
            : Infinity;
        status = (daysSince > ABANDONED_THRESHOLD_DAYS && pct < 50) ? 'abandoned' : 'in_progress';
    }

    return {
        userId:             raw.userId,
        contentId:          raw.contentId,
        progressPercentage: Math.round(pct),
        totalReadingTimeMs,
        totalSessions,
        firstReadAt,
        lastReadAt,
        lastPosition,
        status,
    };
}

/** Returns a not_started shell for a userId/contentId pair with no progress record. */
function notStartedProgress(userId, contentId) {
    return {
        userId, contentId,
        progressPercentage: 0,
        totalReadingTimeMs: 0,
        totalSessions: 0,
        firstReadAt: null,
        lastReadAt: null,
        lastPosition: null,
        status: 'not_started',
    };
}

const ensureLeoMemoryDbShape = (db) => {
    // Guard the DB container shape
    if (!db || typeof db !== 'object' || Array.isArray(db)) return { memoryMap: {} };
    if (!db.memoryMap || typeof db.memoryMap !== 'object') db.memoryMap = {};

    // Normalize existing records for type safety and array caps.
    // New optional fields are NOT injected into old records — they remain
    // absent until the frontend writes them for the first time.
    for (const key of Object.keys(db.memoryMap)) {
        const r = db.memoryMap[key];
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
            db.memoryMap[key] = {};
            continue;
        }

        // lastSentenceIndex — coerce if recoverable, remove if corrupt
        if ('lastSentenceIndex' in r && typeof r.lastSentenceIndex !== 'number') {
            const n = Math.floor(Number(r.lastSentenceIndex));
            if (Number.isFinite(n) && n >= 0) r.lastSentenceIndex = n;
            else delete r.lastSentenceIndex;
        }

        // lastReadAt — must be a string; remove corrupt values
        if ('lastReadAt' in r && typeof r.lastReadAt !== 'string') {
            delete r.lastReadAt;
        }

        // behavior — must be an object with numeric pauses/replays
        if ('behavior' in r) {
            if (!r.behavior || typeof r.behavior !== 'object' || Array.isArray(r.behavior)) {
                r.behavior = { pauses: 0, replays: 0 };
            } else {
                if (typeof r.behavior.pauses  !== 'number') r.behavior.pauses  = 0;
                if (typeof r.behavior.replays !== 'number') r.behavior.replays = 0;
            }
        }

        // interactionHistory — must be array, keep last 10
        if ('interactionHistory' in r) {
            if (!Array.isArray(r.interactionHistory)) r.interactionHistory = [];
            else if (r.interactionHistory.length > 10) r.interactionHistory = r.interactionHistory.slice(-10);
        }

        // vocabularyAsked — must be array, keep last 10
        if ('vocabularyAsked' in r) {
            if (!Array.isArray(r.vocabularyAsked)) r.vocabularyAsked = [];
            else if (r.vocabularyAsked.length > 10) r.vocabularyAsked = r.vocabularyAsked.slice(-10);
        }
    }

    return db;
};

// Legacy JSON migration skipped — progress now uses SQLite (progressService.js).
// progress_db.json remains as read-only backup after migration script ran.

// --- PROGRESS SYNC ROUTES (Fase 3.2) ---
// * Auth temporal: Se omite requireAuth en desarrollo frontend, pero debe blindarse en producción Fase 4

// 1. GET ALL PROGRESS POR USUARIO (Útil para Admin/Dashboard)
// Auth: owner (mismo userId) OR admin secret OR rol administrador/mediador
app.get('/api/progress/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const users = readJSON(USERS_DB);

        const requester = resolveRequester(req, users);
        const isOwner = requester && requester.id === userId;
        const isAdmin = (await isAdminRequest(req)) || (requester && (requester.roles ?? []).includes('administrador'));
        const isMediator = requester && isMediatorRole(requester);
        if (!isOwner && !isAdmin && !isMediator) {
            log(`GET progress/user denied: param=${userId} requester=${requester?.id ?? 'none'}`, 'WARN');
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        if (!users.find(u => u.id === userId)) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const userProgressList = getProgressByUser(userId);
        res.json({ success: true, progressList: userProgressList });
    } catch (e) {
        log(`GET User Progress Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed' });
    }
});

// 2. GET SINGLE PROGRESS (Resolviendo colisión de rutas previa)
// Auth: owner OR admin secret OR rol administrador/mediador
app.get('/api/progress/item/:userId/:contentId', async (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const users = readJSON(USERS_DB);

        const requester = resolveRequester(req, users);
        const isOwner = requester && requester.id === userId;
        const isAdmin = (await isAdminRequest(req)) || (requester && (requester.roles ?? []).includes('administrador'));
        const isMediator = requester && isMediatorRole(requester);
        if (!isOwner && !isAdmin && !isMediator) {
            log(`GET progress/item denied: param=${userId} requester=${requester?.id ?? 'none'}`, 'WARN');
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const progress = getProgressItem(userId, contentId);

        if (!progress) return res.json({ success: true, progress: null });
        res.json({ success: true, progress });
    } catch (e) {
        log(`GET Progress Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to fetch progress' });
    }
});

// 3. POST SYNC HEARTBEAT
app.post('/api/progress/:userId/:contentId/sync', requireProgressOwner, async (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const payload = req.body;
        const key = makeProgressKey(userId, contentId);

        if (!payload.canonicalProgress) {
             return res.status(400).json({ error: 'Falta objeto canonicalProgress' });
        }

        const existing = getProgressItem(userId, contentId);
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

        upsertProgress(newProgress);

        res.json({ success: true, progress: newProgress });
    } catch (e) {
        log(`POST Progress Sync Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to sync progress' });
    }
});

// 4. POST COMPLETE CONTENT
app.post('/api/progress/:userId/:contentId/complete', requireProgressOwner, async (req, res) => {
    try {
        const { userId, contentId } = req.params;

        const payload = req.body;
        const key = makeProgressKey(userId, contentId);

        const existing = getProgressItem(userId, contentId) || {
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

        upsertProgress(existing);

        log(`Contenido completado: ${key}`, 'SUCCESS');
        res.json({ success: true, progress: existing });
    } catch (e) {
        log(`POST Complete Error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to complete content' });
    }
});
// ------------------------------------

// =====================================================================
// FASE 2 — OFFLINE BOOK ASSIGNMENT
// =====================================================================
// Fuente única de verdad para "el libro offline asignado a un usuario".
// Regla central: 1 usuario = máximo 1 libro offline. Enforcement a nivel
// schema (PRIMARY KEY user_id en SQLite WAL). LU consume vía GET, asigna
// vía POST cuando el usuario toca "Disponible sin conexión" en Chibalete+.
//
// Auth: requireUserAuth → x-user-id presente + usuario existe + cuenta activa.
// Aislamiento: cada endpoint opera SOLO sobre el userId de la sesión.
// No es posible consultar/asignar/borrar assignments de otro usuario.
// =====================================================================

/**
 * Decide si el usuario puede acceder al libro para fines offline.
 * Reutiliza canUserAccessContent (scope engine) + admin role check.
 * Se evalúa en cada POST; no se cachea.
 *
 * Nota: canUserAccessContent se inicializa más adelante en este archivo
 * (línea ~3300, `const { canUserAccessContent } = createAccessService(...)`).
 * Funciona porque esta función se INVOCA en runtime cuando ya bootstrapeó.
 *
 * @returns {{ allowed: boolean, reason: string }}
 */
function evaluateOfflineAccess(user, content) {
    const roles = user.roles || (user.role ? [user.role] : (user.rol ? [user.rol] : []));
    if (roles.includes('administrador')) {
        return { allowed: true, reason: 'admin_role' };
    }
    const scopeDecision = canUserAccessContent(user.id, content.id, content);
    if (scopeDecision.allowed) {
        return { allowed: true, reason: scopeDecision.reason || 'scope_engine' };
    }
    // legacyFallback === true en modo 'open' significa "sin reglas restrictivas".
    if (scopeDecision.legacyFallback) {
        return { allowed: true, reason: 'legacy_fallback_open' };
    }
    return { allowed: false, reason: scopeDecision.reason || 'no_access' };
}

/**
 * Construye la respuesta enriquecida del assignment.
 * Incluye metadata del libro (titulo, autor, portada, texto_plano_url) y
 * el progreso actual del usuario sobre ese libro (si existe).
 *
 * Si assignment es null → devuelve { assignment: null } (formato estable).
 *
 * @param {object|null} assignment - record de offlineAssignmentService.getAssignment
 * @returns {object}
 */
function buildOfflineAssignmentResponse(assignment) {
    if (!assignment) return { assignment: null };

    const contentList = readJSON(DB_FILE);
    const content = contentList.find(c => c.id === assignment.contentId) || null;
    const progress = getProgressItem(assignment.userId, assignment.contentId) || null;

    return {
        contentId:  assignment.contentId,
        version:    assignment.version,
        assignedAt: assignment.assignedAt,
        updatedAt:  assignment.updatedAt,
        book: content ? {
            id:            content.id,
            title:         content.titulo || content.title || null,
            author:        content.autor || content.author || null,
            coverUrl:      content.portada_url || null,
            summary:       content.descripcion_corta || content.descripcion || null,
            authorBio:     content.biografia_autor || null,
            textoPlanoUrl: content.texto_plano_url || null,
        } : null,
        progress: progress ? {
            percentage:        progress.canonicalProgress?.globalPercentage ?? null,
            updatedAt:         progress.updatedAt,
            isCompleted:       progress.isCompleted,
            canonicalProgress: progress.canonicalProgress,
        } : null,
    };
}

// --- GET: consultar libro offline asignado al usuario autenticado ---
app.get('/api/offline/assignment', requireUserAuth, (req, res) => {
    try {
        const userId = req.user.id;
        const assignment = getOfflineAssignment(userId);
        log(`[OFFLINE] assignment_get userId=${userId} present=${!!assignment}`, 'ACCESS');
        res.json(buildOfflineAssignmentResponse(assignment));
    } catch (e) {
        log(`[OFFLINE] GET error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'No se pudo obtener el assignment offline.' });
    }
});

// --- POST: asignar libro offline (reemplaza el anterior si lo hay) ---
app.post('/api/offline/assignment',
    requireUserAuth,
    validate({ body: assignBookSchema }),
    (req, res) => {
        try {
            const userId = req.user.id;
            const { contentId } = req.body;

            // 1. Verificar que el contentId existe en el catálogo.
            const contentList = readJSON(DB_FILE);
            const content = contentList.find(c => c.id === contentId);
            if (!content) {
                log(`[OFFLINE] assignment_invalid_content userId=${userId} contentId=${contentId}`, 'ACCESS');
                return res.status(404).json({ error: 'Contenido no encontrado.', reason: 'content_not_found' });
            }

            // 2. Verificar que el usuario tiene acceso al libro.
            const access = evaluateOfflineAccess(req.user, content);
            if (!access.allowed) {
                log(`[OFFLINE] assignment_denied_access userId=${userId} contentId=${contentId} reason=${access.reason}`, 'ACCESS');
                return res.status(403).json({ error: 'Sin acceso al contenido.', reason: access.reason });
            }

            // 3. Upsert atómico (reemplaza si difiere; idempotente si es el mismo).
            const result = upsertOfflineAssignment(userId, contentId);

            const auditType = result.sameAsBefore
                ? 'assignment_get'
                : result.replacedPrevious
                    ? 'assignment_replaced'
                    : 'assignment_created';
            log(`[OFFLINE] ${auditType} userId=${userId} contentId=${contentId} version=${result.version} prev=${result.previousContentId ?? 'none'}`, 'ACCESS');

            res.json(buildOfflineAssignmentResponse(result));
        } catch (e) {
            log(`[OFFLINE] POST error: ${e.message}`, 'ERROR');
            res.status(500).json({ error: 'No se pudo asignar el libro offline.' });
        }
    }
);

// --- DELETE: eliminar el assignment del usuario (idempotente) ---
app.delete('/api/offline/assignment', requireUserAuth, (req, res) => {
    try {
        const userId = req.user.id;
        const removed = deleteOfflineAssignment(userId);
        log(`[OFFLINE] assignment_deleted userId=${userId} removed=${removed}`, 'ACCESS');
        res.json({ assignment: null, removed });
    } catch (e) {
        log(`[OFFLINE] DELETE error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'No se pudo eliminar el assignment offline.' });
    }
});
// =====================================================================
// END FASE 2 — OFFLINE BOOK ASSIGNMENT
// =====================================================================

// ------------------------------------
// --- SUBFASE 2.1: Cache de escuelas para resolución de organizationId ---
// Se carga bajo demanda y se invalida al crear una escuela nueva.
// Permite que normalizeUser y normalizeGroup pueblen organizationId
// sin cambiar call sites ni endpoints existentes.
let _schoolsCache = null;

const getSchoolsForNormalization = () => {
    if (_schoolsCache === null) {
        try {
            _schoolsCache = readJSON(SCHOOLS_DB);
            if (!Array.isArray(_schoolsCache)) _schoolsCache = [];
        } catch (e) {
            _schoolsCache = [];
        }
    }
    return _schoolsCache;
};

const invalidateSchoolsCache = () => { _schoolsCache = null; };

/**
 * normalizeUser — Compatibilidad legacy + modelo extendido
 * Asegura que los campos array sean verdaderamente arrays para evitar crashes en el frontend.
 * SUBFASE 2.1: Puebla organizationId desde user.colegio si aún no está definido.
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

    // SUBFASE 2.1: Resolver organizationId desde user.colegio (string legacy)
    // Solo actúa si organizationId está ausente y colegio tiene valor.
    // No elimina ni reemplaza user.colegio.
    if (!normalized.organizationId && normalized.colegio) {
        const schools = getSchoolsForNormalization();
        const match = schools.find(s => s.name === normalized.colegio);
        if (match) normalized.organizationId = match.id;
    }

    // SUBFASE 3.2: Normalizar mediatorKind para usuarios con rol mediador.
    // Si tienen rol mediador pero sin mediatorKind válido, se asigna 'teacher' por defecto.
    // No sobreescribe valores válidos ya almacenados.
    // DT-05: 'profesor' eliminado del modelo — solo 'mediador' es rol canónico.
    const VALID_MEDIATOR_KINDS = ['teacher', 'librarian', 'coordinator', 'parent'];
    const isMediatorRole = Array.isArray(normalized.roles) && normalized.roles.includes('mediador');
    if (isMediatorRole && !VALID_MEDIATOR_KINDS.includes(normalized.mediatorKind)) {
        normalized.mediatorKind = 'teacher';
    }

    // Auth Pro: default 'active' para usuarios legacy sin accountStatus.
    // Garantía de migración lazy — no requiere script ni write previo.
    if (!normalized.accountStatus) {
        normalized.accountStatus = 'active';
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
app.post('/api/auth/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    const users = readJSON(USERS_DB);
    const userIndex = users.findIndex(u => normalizeEmail(u.email) === normalizedEmail);

    if (userIndex !== -1) {
        const user = normalizeUser(users[userIndex]);
        let isValid = false;

        if (user.password && user.password.startsWith('$2')) {
            isValid = await bcrypt.compare(password, user.password);
        } else {
            // Legacy plain text comparison
            if (user.password === password) {
                isValid = true;
                // Auto-upgrade security: Hash it and save immediately
                user.password = await hashPasswordIfNeeded(password);
                users[userIndex] = user;
                writeJSONAsync(USERS_DB, users).catch(e => log(`Auto-upgrade write error: ${e.message}`, 'ERROR'));
                log(`Auto-upgraded password hash for legacy user: ${normalizedEmail}`, 'ACCESS');
            }
        }

        if (isValid) {
            // Auth Pro: bloquear cuentas no activas DESPUÉS de validar credenciales.
            // SIEMPRE responder con el mismo mensaje genérico para no revelar:
            //   (a) que el email existe, (b) que la contraseña era correcta.
            // El detalle real queda solo en logs internos.
            if (!isUserActive(user)) {
                log(`Login bloqueado para ${normalizedEmail}: accountStatus=${user.accountStatus}`, 'ACCESS');
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }
            // Sprint Modo Accesible — persistir lastLoginAt en el momento exacto
            // del login exitoso. GET /api/students/:id/status lee este campo;
            // sin esto, todos los estudiantes aparecen como REGISTERED_NO_LOGIN
            // aunque hayan ingresado. Best-effort async: mismo patrón que el
            // auto-upgrade del password — no bloqueamos la respuesta del login.
            user.lastLoginAt = new Date().toISOString();
            users[userIndex] = user;
            writeJSONAsync(USERS_DB, users).catch(e => log(`lastLoginAt write error: ${e.message}`, 'ERROR'));
            log(`Login exitoso: ${normalizedEmail} ip=${req.ip}`, 'ACCESS');
            return res.json({ success: true, user: sanitizeUserForClient(user) });
        }
    }

    const safeEmail = normalizedEmail || 'unknown';
    log(`Login fallido: ${safeEmail} ip=${req.ip}`, 'ACCESS');
    res.status(401).json({ error: 'Credenciales inválidas' });
});

// ---------------------------------------------------------------------------
// AUTH PRO — INVITACIONES
// ---------------------------------------------------------------------------

// INVITE USER
// POST /api/invite-user
// Solo admin. Crea usuario en estado 'invited' con token de 48h.
// No requiere contraseña inicial — el usuario la elige al aceptar.
app.post('/api/invite-user', requireAuth, async (req, res) => {
    const { email, nombre_completo, roles, colegio, groupIds, mediatorKind } = req.body;

    if (!email || !nombre_completo) {
        return res.status(400).json({ error: 'email y nombre_completo son obligatorios' });
    }

    // GROUP_REQUIRED guard — Sprint membresías. Un lector no puede quedar
    // huérfano: tiene que llegar a Aula Viva con groupIds poblado. Si el
    // caller no envía groupIds, intentamos resolver vía single-group school
    // a partir del nombre de `colegio`. Si tampoco resuelve, rechazamos.
    const normalizedRoles = normalizeRoles(roles);
    const isLectorInvite  = normalizedRoles.includes('lector');
    let resolvedGroupIds  = Array.isArray(groupIds) ? groupIds.filter(g => typeof g === 'string' && g) : [];
    if (isLectorInvite && resolvedGroupIds.length === 0) {
        if (colegio) {
            // CHP-ID-CANON-01A — mismo contrato que POST /api/users: con varias
            // coincidencias se devuelve 409 + opciones, nunca la primera.
            const groupsAll = readJSON(GROUPS_DB) || [];
            const matches = findGroupsForSchool(colegio, groupsAll);
            if (matches.length > 1) {
                return res.status(409).json({
                    error:   GROUP_MEMBERSHIP_ERR.AMBIGUOUS_GROUP,
                    message: `La institución "${colegio}" tiene ${matches.length} grupos. Selecciona el grupo y envía groupIds.`,
                    choices: matches.map(groupChoice),
                });
            }
            if (matches.length === 1) resolvedGroupIds = [matches[0].id];
        }
    }
    if (isLectorInvite && resolvedGroupIds.length === 0) {
        return res.status(400).json({
            error:   GROUP_MEMBERSHIP_ERR.GROUP_REQUIRED,
            message: 'Todo lector debe estar asignado a un grupo para aparecer en Aula Viva. Envía groupIds o crea primero un grupo para esta institución.',
        });
    }

    const normalizedEmail = normalizeEmail(email);
    // Pre-generate outside lock (pure sync computation)
    const inviteToken     = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = Date.now() + 48 * 60 * 60 * 1000;
    const newUser = normalizeUser({
        id:               `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        email:            normalizedEmail,
        nombre_completo,
        nombre_usuario:   normalizedEmail.split('@')[0],
        roles:            normalizedRoles,
        mediatorKind:     mediatorKind || undefined,
        colegio:          colegio || '',
        groupIds:         resolvedGroupIds,
        avatar_url:       '',
        bio_corta:        '',
        libros_leidos:    0,
        seguidores:       0,
        seguidos:         0,
        nivel_lectura:    'Novato',
        accountStatus:    'invited',
        inviteToken,
        inviteExpiresAt,
        // Sin password intencionalmente
    });

    // Lock anidado: groupsLock exterior, usersLock interior. Misma orden que
    // migrate-memberships.mjs (sin riesgo de deadlock con flujos sequential que
    // toman uno solo). La escritura bidireccional es ATÓMICA: si falla la
    // mitad-grupo, la mitad-usuario no se persiste. El antiguo try/catch que
    // creaba el user igual y solo emitía WARN era el bug histórico (lector
    // huérfano invisible en Aula Viva).
    let result = null;
    let outcome = null;
    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const users  = readJSON(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];

            const existingIndex = users.findIndex(u => normalizeEmail(u.email) === normalizedEmail);
            if (existingIndex !== -1) {
                const existing = users[existingIndex];
                if (existing.accountStatus !== 'invited') { outcome = { conflict: 'active' }; return; }
                // Re-invite: update token, preserve rest of profile (no membership write).
                users[existingIndex] = { ...existing, inviteToken, inviteExpiresAt };
                writeJSON(USERS_DB, users);
                result = { regenerated: true, userId: existing.id, email: existing.email };
                return;
            }

            // Mutación in-memory: primero grupos, luego user push.
            let groupsTouched = false;
            for (const gid of resolvedGroupIds) {
                const g = groups.find(x => x?.id === gid);
                if (g && addUserIdToGroup(g, newUser.id)) groupsTouched = true;
            }

            // Escribir GROUPS primero. Si falla, throw → lock libera, user no se crea.
            if (groupsTouched) writeJSON(GROUPS_DB, groups);
            users.push(newUser);
            writeJSON(USERS_DB, users);
            result = { regenerated: false, userId: newUser.id, email: newUser.email };
        });
    }, 'groupsLock');

    if (outcome?.conflict === 'active') {
        return res.status(409).json({ error: 'El email ya está registrado con una cuenta activa' });
    }

    if (result.regenerated) {
        log(`Invite regenerated: ${result.email} (${result.userId}) expires=${new Date(inviteExpiresAt).toISOString()}`, 'ACCESS');
        return res.status(200).json({
            success:       true,
            userId:        result.userId,
            email:         result.email,
            inviteToken,
            inviteExpiresAt,
            activationUrl: `/#/activar?token=${inviteToken}`,
            regenerated:   true,
        });
    }

    log(`Invite created: ${newUser.email} (${newUser.id}) expires=${new Date(inviteExpiresAt).toISOString()}`, 'ACCESS');
    res.status(201).json({
        success:       true,
        userId:        newUser.id,
        email:         newUser.email,
        inviteToken,
        inviteExpiresAt,
        activationUrl: `/#/activar?token=${inviteToken}`,
        regenerated:   false,
    });
});

// ACCEPT INVITE
// POST /api/accept-invite
// Público (sin requireAuth). Valida token, fija contraseña, activa cuenta.
app.post('/api/accept-invite', acceptInviteLimiter, async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ error: 'token y password son obligatorios' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    // Hash BEFORE lock — async work must not run while holding the cross-process lock
    const hashedPassword = await hashPasswordIfNeeded(password);

    // Lock: re-read -> validate token -> activate -> write (atomic across containers)
    let activated = null;
    const conflict = await mutateUsers((users) => {
        const index = users.findIndex(u => u.inviteToken === token);
        if (index === -1) return { conflict: 'not_found' };
        const user = users[index];
        if (user.accountStatus !== 'invited') return { conflict: 'already_active' };
        if (!user.inviteExpiresAt || Date.now() > user.inviteExpiresAt) {
            log(`Accept-invite rechazado — token expirado: ${user.email}`, 'ACCESS');
            return { conflict: 'expired' };
        }
        const { inviteToken: _tok, inviteExpiresAt: _exp, ...rest } = user;
        activated = { ...rest, password: hashedPassword, accountStatus: 'active' };
        users[index] = activated;
        writeJSON(USERS_DB, users);
        return null;
    });

    if (conflict?.conflict === 'not_found') return res.status(404).json({ error: 'Token inválido o ya utilizado' });
    if (conflict?.conflict === 'already_active') return res.status(409).json({ error: 'Esta cuenta ya fue activada' });
    if (conflict?.conflict === 'expired') return res.status(410).json({ error: 'El enlace de invitación expiró. Solicita uno nuevo a tu administrador.', code: 'TOKEN_EXPIRED' });

    log(`Account activated: ${activated.email} (${activated.id})`, 'ACCESS');
    return res.status(200).json({
        success: true,
        user:    sanitizeUserForClient(activated),
    });
});

// RESEND INVITE
// POST /api/resend-invite
// Admin regenera token para usuario en estado 'invited'.
// Acepta { email } o { userId } — al menos uno requerido.
app.post('/api/resend-invite', requireAuth, async (req, res) => {
    const { email, userId } = req.body;

    if (!email && !userId) {
        return res.status(400).json({ error: 'Se requiere email o userId' });
    }

    // Pre-generate outside lock (pure sync computation)
    const inviteToken     = crypto.randomBytes(32).toString('hex');
    const inviteExpiresAt = Date.now() + 48 * 60 * 60 * 1000;

    // Lock: re-read -> validate -> update -> write (atomic across containers)
    let sentUser = null;
    const conflict = await mutateUsers((users) => {
        const index = email
            ? users.findIndex(u => normalizeEmail(u.email) === normalizeEmail(email))
            : users.findIndex(u => u.id === userId);
        if (index === -1) return { conflict: 'not_found' };
        const user = users[index];
        if (user.accountStatus !== 'invited') return { conflict: 'wrong_status', status: user.accountStatus };
        sentUser = user;
        users[index] = { ...user, inviteToken, inviteExpiresAt };
        writeJSON(USERS_DB, users);
        return null;
    });

    if (conflict?.conflict === 'not_found') return res.status(404).json({ error: 'Usuario no encontrado' });
    if (conflict?.conflict === 'wrong_status') return res.status(409).json({ error: `No se puede reenviar: la cuenta está en estado '${conflict.status}'` });

    log(`Invite resent: ${sentUser.email} (${sentUser.id}) expires=${new Date(inviteExpiresAt).toISOString()}`, 'ACCESS');
    return res.status(200).json({
        success:       true,
        userId:        sentUser.id,
        email:         sentUser.email,
        inviteToken,
        inviteExpiresAt,
        activationUrl: `/#/activar?token=${inviteToken}`,
    });
});

// ---------------------------------------------------------------------------
// AUTH PRO — RESET PASSWORD
// ---------------------------------------------------------------------------

// REQUEST PASSWORD RESET
// POST /api/request-password-reset  (legacy path)
// POST /api/auth/reset-request      (path canónico — usar en clientes nuevos como LU)
// Público. Genera token temporal de 1h para usuarios activos.
// Respuesta siempre 200 independientemente de si el email existe (anti-oracle).
const handleResetRequest = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'email es obligatorio' });
    }

    const normalizedEmail = normalizeEmail(email);
    // Pre-generate outside lock (pure sync computation)
    const resetToken     = crypto.randomBytes(32).toString('hex');
    const resetExpiresAt = Date.now() + 3600000; // +1 hora

    // Lock: re-read -> find active user -> update token -> write (atomic across containers)
    let targetUserId = null;
    const conflict = await mutateUsers((users) => {
        const index = users.findIndex(u => normalizeEmail(u.email) === normalizedEmail);
        if (index === -1 || !isUserActive(users[index])) return { conflict: 'no_active_user' };
        targetUserId = users[index].id;
        users[index] = { ...users[index], resetToken, resetExpiresAt };
        writeJSON(USERS_DB, users);
        return null;
    });

    if (!conflict) {
        log(`Password reset requested: ${normalizedEmail} expires=${new Date(resetExpiresAt).toISOString()}`, 'ACCESS');
        writeAuditLog({
            action:       'reset_password_request',
            targetUserId,
            actor:        null, // auto-servicio
            details:      { email: normalizedEmail, expiresAt: new Date(resetExpiresAt).toISOString() },
        });
        // En producción este token se enviaría por email, nunca en la respuesta.
        // Para entorno actual sin servicio de email, se devuelve para pruebas.
        return res.status(200).json({
            success:  true,
            message:  'Si el email está registrado, recibirás instrucciones.',
            resetToken,
            resetExpiresAt,
            resetUrl: `/#/reset-password?token=${resetToken}`,
        });
    }

    // Email no existe, invited o disabled — respuesta idéntica (anti-oracle).
    return res.status(200).json({
        success: true,
        message: 'Si el email está registrado, recibirás instrucciones.',
    });
};
app.post('/api/request-password-reset', resetRequestLimiter, validate({ body: resetRequestSchema }), handleResetRequest);
app.post('/api/auth/reset-request',     resetRequestLimiter, validate({ body: resetRequestSchema }), handleResetRequest);

// CONFIRM PASSWORD RESET
// POST /api/confirm-password-reset  (legacy path)
// POST /api/auth/reset-confirm      (path canónico — usar en clientes nuevos como LU)
// Público. Valida token, fija nueva contraseña, invalida token.
const handleResetConfirm = async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ error: 'token y password son obligatorios' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    // Hash BEFORE lock — async work must not run while holding the cross-process lock
    const hashedPassword = await hashPasswordIfNeeded(password);

    // Lock: re-read -> validate token -> apply new password -> write (atomic across containers)
    let updated = null;
    const conflict = await mutateUsers((users) => {
        const index = users.findIndex(u => u.resetToken === token);
        if (index === -1) return { conflict: 'not_found' };
        const user = users[index];
        if (!isUserActive(user)) {
            log(`Reset rechazado — cuenta no activa: ${user.email} status=${user.accountStatus}`, 'ACCESS');
            return { conflict: 'not_active' };
        }
        if (!user.resetExpiresAt || Date.now() > user.resetExpiresAt) {
            log(`Reset rechazado — token expirado: ${user.email}`, 'ACCESS');
            return { conflict: 'expired' };
        }
        const { resetToken: _rt, resetExpiresAt: _re, ...rest } = user;
        updated = { ...rest, password: hashedPassword };
        users[index] = updated;
        writeJSON(USERS_DB, users);
        return null;
    });

    if (conflict?.conflict === 'not_found') return res.status(404).json({ error: 'Token inválido o ya utilizado' });
    if (conflict?.conflict === 'not_active') return res.status(409).json({ error: 'No se puede restablecer esta cuenta' });
    if (conflict?.conflict === 'expired') return res.status(410).json({ error: 'El enlace de restablecimiento expiró. Solicita uno nuevo.', code: 'TOKEN_EXPIRED' });

    log(`Password reset completed: ${updated.email} (${updated.id})`, 'ACCESS');
    writeAuditLog({
        action:       'reset_password_confirm',
        targetUserId: updated.id,
        actor:        null, // auto-servicio via token
        details:      { email: updated.email },
    });
    return res.status(200).json({
        success: true,
        user:    sanitizeUserForClient(updated),
    });
};
app.post('/api/confirm-password-reset', resetConfirmLimiter, validate({ body: resetConfirmSchema }), handleResetConfirm);
app.post('/api/auth/reset-confirm',     resetConfirmLimiter, validate({ body: resetConfirmSchema }), handleResetConfirm);

// CREATE USER
app.post('/api/users', requireAdminAccess, async (req, res) => {
    const newUser = req.body;
    if (!newUser.email || !newUser.nombre_completo || !newUser.password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const normalizedEmail = normalizeEmail(newUser.email);

    // Async work outside lock (hashing is slow, never hold lock during await)
    if (!newUser.id) newUser.id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    newUser.password = await hashPasswordIfNeeded(newUser.password);
    newUser.roles = normalizeRoles(newUser.roles);
    newUser.email = normalizedEmail;
    const VALID_ACCOUNT_STATUSES = ['active', 'invited', 'disabled'];
    if (!VALID_ACCOUNT_STATUSES.includes(newUser.accountStatus)) newUser.accountStatus = 'active';

    // CONTRATO DE GRUPOS (CHP-ID-CANON-01A).
    //
    // La autoridad es el `groupId` estable, nunca el texto libre de `curso` ni
    // el nombre visible de la institución. Compatibilidad legacy acotada: si el
    // caller no envía groupIds y la institución tiene EXACTAMENTE un grupo, se
    // resuelve; con varios se responde 409 AMBIGUOUS_GROUP con las opciones para
    // que el cliente elija. Nunca se toma el primer resultado.
    //
    // La validación de los groupIds explícitos (existencia + pertenencia a la
    // institución) ocurre DENTRO del lock, antes de cualquier escritura.
    const isLectorCreate = newUser.roles.includes('lector');
    let resolvedGroupIds = Array.isArray(newUser.groupIds)
        ? newUser.groupIds.filter(g => typeof g === 'string' && g)
        : [];
    if (isLectorCreate && resolvedGroupIds.length === 0) {
        if (newUser.colegio) {
            const groupsAll = readJSON(GROUPS_DB) || [];
            const matches = findGroupsForSchool(newUser.colegio, groupsAll);
            if (matches.length > 1) {
                return res.status(409).json({
                    error:   GROUP_MEMBERSHIP_ERR.AMBIGUOUS_GROUP,
                    message: `La institución "${newUser.colegio}" tiene ${matches.length} grupos. Selecciona el grupo y envía groupIds.`,
                    choices: matches.map(groupChoice),
                });
            }
            if (matches.length === 1) resolvedGroupIds = [matches[0].id];
        }
    }
    if (isLectorCreate && resolvedGroupIds.length === 0) {
        return res.status(400).json({
            error:   GROUP_MEMBERSHIP_ERR.GROUP_REQUIRED,
            message: 'Todo lector debe estar asignado a un grupo para aparecer en Aula Viva. Envía groupIds o crea primero un grupo para esta institución.',
        });
    }
    newUser.groupIds = resolvedGroupIds;

    const userToSave = normalizeUser(newUser);

    // Lock anidado (groupsLock outer, usersLock inner) — escritura atómica
    // bidireccional. El try/catch silencioso anterior dejaba lectores huérfanos
    // si la escritura al grupo fallaba. Ahora cualquier fallo aborta la creación.
    let conflict = null;
    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const users  = readJSON(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];

            if (users.some(u => normalizeEmail(u.email) === normalizedEmail)) { conflict = { conflict: 'dup_email' }; return; }
            if (users.some(u => u.id === userToSave.id))                      { conflict = { conflict: 'dup_id' };    return; }

            // CHP-ID-CANON-01A — validar groupIds ANTES de mutar nada: un
            // groupId inexistente o de otra institución aborta la creación
            // completa. Se hace dentro del lock para que el store de grupos
            // leído sea el mismo que se escribirá (sin ventana de carrera).
            const gv = validateExplicitGroupIds(resolvedGroupIds, groups, userToSave.colegio);
            if (!gv.ok) { conflict = { conflict: 'group', ...gv }; return; }

            // Mutación in-memory primero, escritura después: groups → user.
            let groupsTouched = false;
            for (const gid of resolvedGroupIds) {
                const g = groups.find(x => x?.id === gid);
                if (g && addUserIdToGroup(g, userToSave.id)) groupsTouched = true;
            }
            if (groupsTouched) writeJSON(GROUPS_DB, groups);
            users.push(userToSave);
            writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');
    if (conflict?.conflict === 'dup_email') return res.status(409).json({ error: 'El email ya está registrado' });
    if (conflict?.conflict === 'dup_id')    return res.status(409).json({ error: 'El ID de usuario ya existe' });
    if (conflict?.conflict === 'group') {
        if (conflict.error === GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND) {
            return res.status(400).json({
                error:   GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND,
                message: `groupIds inexistentes: ${conflict.missing.join(', ')}`,
            });
        }
        return res.status(400).json({
            error:   GROUP_MEMBERSHIP_ERR.GROUP_SCHOOL_MISMATCH,
            message: `Los grupos ${conflict.foreign.join(', ')} no pertenecen a la institución "${userToSave.colegio}".`,
        });
    }

    log(`User created: ${userToSave.email} (${userToSave.id})`, 'ACCESS');
    writeAuditLog({
        action:       'create_user',
        targetUserId: userToSave.id,
        actor:        req.headers['x-user-id'] || null,
        details:      { email: userToSave.email, roles: userToSave.roles, colegio: userToSave.colegio || null },
    });

    res.json(sanitizeUserForClient(userToSave));
});

// UPDATE USER
app.put('/api/users/:id', requireAdminAccess, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    if (updates.id && updates.id !== id) return res.status(400).json({ error: 'No se puede cambiar el ID del usuario' });

    // Async work outside lock (never await while holding the cross-process lock)
    if (updates.roles)    updates.roles    = normalizeRoles(updates.roles);
    if (updates.password) updates.password = await hashPasswordIfNeeded(updates.password);
    if (updates.email)    updates.email    = normalizeEmail(updates.email);

    // Sprint 021 — drift bidireccional cerrado.
    // Si updates.groupIds llega, calculamos diff oldGroupIds vs newGroupIds y
    // sincronizamos los grupos en el mismo lock anidado (groups outer, users inner).
    let mergedUser = null;
    let oldRoles   = [];
    let conflict   = null;
    let groupDelta = { added: [], removed: [], missingGroupIds: [] };
    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const users  = readJSON(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const index  = users.findIndex(u => u.id === id);
            if (index === -1) { conflict = { conflict: 'not_found' }; return; }
            if (updates.email && updates.email !== normalizeEmail(users[index].email)) {
                if (users.some(u => normalizeEmail(u.email) === updates.email)) { conflict = { conflict: 'dup_email' }; return; }
            }
            oldRoles   = [...(users[index].roles || [])];
            const oldGroupIds = Array.isArray(users[index].groupIds) ? [...users[index].groupIds] : [];
            mergedUser = normalizeUser({ ...users[index], ...updates });
            const newGroupIds = Array.isArray(mergedUser.groupIds) ? [...mergedUser.groupIds] : [];

            const { added, removed } = diffIds(oldGroupIds, newGroupIds);

            // CHP-ID-DEPLOY-PREFLIGHT-01A — contrato de grupos también en la
            // edición, con la misma fuerza que en la creación. Se valida ANTES
            // de mutar nada (ni en memoria) y dentro del lock, así que un
            // payload inválido no deja el store a medias.
            //
            // 1) Existencia: solo sobre los ids AÑADIDOS. Un id colgante
            //    preexistente no debe bloquear una edición ajena (p. ej.
            //    corregir el nombre); eso es reparación de datos, no de este
            //    endpoint. Preserva el contrato previo.
            const addedExist = validateExplicitGroupIds(added, groups, null);
            if (!addedExist.ok) { conflict = { conflict: 'group', ...addedExist }; return; }

            // 2) Institución: sobre TODO el conjunto resultante que exista. Así
            //    se cubre el caso en que cambia `colegio` y el grupo anterior
            //    deja de pertenecer a la institución del usuario.
            const groupIdSet   = new Set(groups.filter(g => g?.id).map(g => g.id));
            const resolvedNew  = newGroupIds.filter(g => groupIdSet.has(g));
            const schoolCheck  = validateExplicitGroupIds(resolvedNew, groups, mergedUser.colegio);
            if (!schoolCheck.ok) { conflict = { conflict: 'group', ...schoolCheck }; return; }

            const applied = applyUserGroupsChange(groups, id, added, removed);
            groupDelta = { added, removed, missingGroupIds: applied.missingGroupIds };

            // Escribir GROUPS primero, USERS después. Mismo principio que en create:
            // si la escritura del grupo falla, el user no queda con groupIds que
            // ningún grupo reconoce.
            if (applied.touched) writeJSON(GROUPS_DB, groups);
            users[index] = mergedUser;
            writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');
    if (conflict?.conflict === 'not_found')    return res.status(404).json({ error: 'Usuario no encontrado' });
    if (conflict?.conflict === 'dup_email')    return res.status(409).json({ error: 'El nuevo email ya está en uso' });
    if (conflict?.conflict === 'group') {
        if (conflict.error === GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND) {
            return res.status(400).json({
                error:   GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND,
                message: `groupIds inexistentes: ${conflict.missing.join(', ')}`,
            });
        }
        return res.status(400).json({
            error:   GROUP_MEMBERSHIP_ERR.GROUP_SCHOOL_MISMATCH,
            message: `Los grupos ${conflict.foreign.join(', ')} no pertenecen a la institución del usuario.`,
        });
    }

    if (groupDelta.added.length || groupDelta.removed.length) {
        log(`User ${id} groupIds delta — added=${JSON.stringify(groupDelta.added)} removed=${JSON.stringify(groupDelta.removed)}`, 'ACCESS');
    }

    log(`User updated: ${id}`, 'ACCESS');

    const actor = req.headers['x-user-id'] || null;
    writeAuditLog({
        action:       'update_user',
        targetUserId: id,
        actor,
        details:      { fieldsUpdated: Object.keys(updates).filter(k => k !== 'password') },
    });

    // Evento adicional si los roles cambiaron
    const newRoles = mergedUser.roles || [];
    const rolesChanged = JSON.stringify([...oldRoles].sort()) !== JSON.stringify([...newRoles].sort());
    if (rolesChanged) {
        writeAuditLog({
            action:       'role_change',
            targetUserId: id,
            actor,
            details:      { oldRoles, newRoles },
        });
    }

    res.json(sanitizeUserForClient(mergedUser));
});

// DELETE USER
app.delete('/api/users/:id', requireAdminAccess, async (req, res) => {
    const { id } = req.params;
    // Sprint 021 — borrado atómico bidireccional. Antes de quitar el user,
    // limpiamos todas las referencias en groups.studentIds/memberIds para
    // que ningún grupo quede con un IDs huérfano apuntando al user borrado.
    let deletedUser = null;
    let conflict    = null;
    let detachedFromGroupIds = [];
    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const users  = readJSON(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const index  = users.findIndex(u => u.id === id);
            if (index === -1) { conflict = { conflict: 'not_found' }; return; }
            deletedUser = users[index];

            detachedFromGroupIds = detachUserFromAllGroups(groups, id);
            if (detachedFromGroupIds.length > 0) writeJSON(GROUPS_DB, groups);

            users.splice(index, 1);
            writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');
    if (conflict?.conflict === 'not_found') return res.status(404).json({ error: 'Usuario no encontrado' });

    log(`User deleted: ${id} (detached from ${detachedFromGroupIds.length} groups)`, 'ACCESS');
    writeAuditLog({
        action:       'delete_user',
        targetUserId: id,
        actor:        req.headers['x-user-id'] || null,
        details:      { email: deletedUser.email, roles: deletedUser.roles, detachedFromGroupIds },
    });
    res.json({ success: true, detachedFromGroupIds });
});

// --- SCHOOL MANAGEMENT ROUTES ---

app.get('/api/schools', requireAuth, (req, res) => {
    try {
        res.json(readJSON(SCHOOLS_DB));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/schools', requireAdminAccess, async (req, res) => {
    const newSchool = req.body;
    if (!newSchool.name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    if (!newSchool.id) {
        newSchool.id = `school-${Date.now()}`;
    }

    if (!newSchool.createdAt) {
        newSchool.createdAt = new Date().toISOString();
    }

    const conflict = await mutateSchools((schools) => {
        if (schools.some(s => s.name.toLowerCase() === newSchool.name.toLowerCase())) {
            return { conflict: 'exists' };
        }
        schools.push(newSchool);
        writeJSON(SCHOOLS_DB, schools);
        return null;
    });
    if (conflict) return res.status(409).json({ error: 'El Colegio ya existe' });
    invalidateSchoolsCache(); // SUBFASE 2.1: forzar recarga del cache tras nueva escuela
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

    // SUBFASE 2.1: Resolver organizationId desde group.school (string legacy)
    // Solo actúa si organizationId está ausente y school tiene valor.
    // No elimina ni reemplaza group.school.
    if (!normalized.organizationId && normalized.school) {
        const schools = getSchoolsForNormalization();
        const match = schools.find(s => s.name === normalized.school);
        if (match) normalized.organizationId = match.id;
    }

    // SUBFASE 4.1: Derivar gradeLevel y section desde grade (string legacy)
    // Solo actúa en cursos (type !== 'club'), solo si los campos no están ya definidos.
    // Patrones soportados: "6" → gradeLevel:6 | "6A" o "6 A" → gradeLevel:6, section:"A"
    // Strings no numéricos ("Club", "Primero", etc.) son ignorados sin error.
    if (normalized.type !== 'club' && normalized.grade) {
        const gradeStr = String(normalized.grade).trim();
        const withSection = gradeStr.match(/^(\d+)\s*([A-Za-z])$/);
        if (withSection) {
            if (!normalized.gradeLevel) normalized.gradeLevel = parseInt(withSection[1], 10);
            if (!normalized.section)    normalized.section    = withSection[2].toUpperCase();
        } else {
            const pureNumeric = gradeStr.match(/^(\d+)$/);
            if (pureNumeric && !normalized.gradeLevel) {
                normalized.gradeLevel = parseInt(pureNumeric[1], 10);
            }
        }
    }

    return normalized;
}

// --- E6/E7: INICIALIZAR ACCESS SERVICE ---
// Debe ir después de normalizeUser y normalizeGroup (dependencias del servicio).
// Las variables son const en scope de módulo; las rutas las leen en tiempo de petición.
const { resolveUserContentAccess, canUserAccessContent, getAccessibleContentIds } = createAccessService({
    readJSON,
    log,
    normalizeUser,
    normalizeGroup,
    USERS_DB,
    GROUPS_DB,
    ACCESS_DB,
    fallbackMode: ACCESS_FALLBACK_MODE,
});

app.get('/api/groups', requireAuth, (req, res) => {
    try {
        const groups = readJSON(GROUPS_DB);
        // Normalizar la salida para que el frontend siempre reciba datos consistentes
        res.json(groups.map(normalizeGroup));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/groups', requireAdminAccess, async (req, res) => {
    const payload = req.body;
    if (!payload.name) {
        return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });
    }
    if (!payload.id) {
        payload.id = `group-${Date.now()}`;
    }

    // Aceptar nuevos campos + normalizar legacy antes de persistir
    const newGroup = normalizeGroup({
        ...payload,
        type:        payload.type        || 'course',
        mediatorIds: payload.mediatorIds || (payload.teacherId ? [payload.teacherId] : []),
        memberIds:   payload.memberIds   || payload.studentIds || [],
        organizationId:       payload.organizationId       || undefined,
        availableContentIds:  payload.availableContentIds  || undefined,
        collectionIds:        payload.collectionIds        || undefined,
        accessStartsAt:       payload.accessStartsAt       || undefined,
        accessEndsAt:         payload.accessEndsAt         || undefined,
        accessRules:          payload.accessRules          || undefined,
        kind:                 payload.kind                 || undefined,
        mediationMessage:     payload.mediationMessage     || undefined,
        mediationQuestions:   Array.isArray(payload.mediationQuestions) ? payload.mediationQuestions : undefined,
        readingNow:           payload.readingNow           || undefined,
        weeklyFocus:          payload.weeklyFocus          || undefined,
        nextMilestone:        payload.nextMilestone        || undefined,
    });

    const conflict = await mutateGroups((groups) => {
        if (groups.some(g => g.id === payload.id)) {
            return { conflict: 'dup_id' };
        }
        groups.push(newGroup);
        writeJSON(GROUPS_DB, groups);
        return null;
    });
    if (conflict) return res.status(409).json({ error: 'El ID del grupo ya existe' });
    log(`Group created: ${newGroup.id} (type=${newGroup.type})`, 'ACCESS');
    res.json(newGroup);
});

app.put('/api/groups/:id', requireAdminAccess, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const overrideFallbackExtinction = _readFallbackOverride(req);
    // Sprint 021 — drift bidireccional cerrado.
    // normalizeGroup ya sincroniza studentIds = memberIds; comparamos union vs union
    // y sincronizamos user.groupIds para los deltas (added/removed).
    let merged       = null;
    let conflict     = null;
    let memberDelta  = { added: [], removed: [], missingUserIds: [] };
    let fallbackRisk = null;     // sobre el grupo PRE-mutation (Commit 5)
    let mergedMeta   = null;     // capturado para audit log
    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const users  = readJSON(USERS_DB);
            const index  = groups.findIndex(g => g.id === id);
            if (index === -1) { conflict = { conflict: 'not_found' }; return; }

            const oldMembers = unionGroupMemberIds(groups[index]);
            merged = normalizeGroup({ ...groups[index], ...updates });
            mergedMeta = _extractGroupMeta(merged);
            const newMembers = unionGroupMemberIds(merged);

            const { added, removed } = diffIds(oldMembers, newMembers);
            memberDelta = { added, removed, missingUserIds: [] };

            // ── Fallback extinction guard (Commit 5) ──────────────────────────
            // PUT bulk-replace puede setear studentIds/memberIds desde 0 → N.
            // Si el grupo PRE-mutation era fallback-dependent y la nueva config
            // añade users, la mutación extingue fallback. Bloquear sin override.
            fallbackRisk = _assessFallbackExtinctionRisk(groups[index], groups, users, {
                addingCount: added.length,
            });
            if (fallbackRisk.atRisk && !overrideFallbackExtinction) {
                conflict = { conflict: 'fallback_extinction_blocked', risk: fallbackRisk };
                return;
            }

            const applied = applyGroupMembersChange(users, id, added, removed);
            memberDelta.missingUserIds = applied.missingUserIds;

            // Si el caller intentó añadir userIds inexistentes al grupo, rechazamos
            // antes de persistir — evita orphan_studentId/memberId.
            if (applied.missingUserIds.length > 0 && added.some(u => applied.missingUserIds.includes(u))) {
                conflict = { conflict: 'orphan_user', userIds: applied.missingUserIds };
                return;
            }

            groups[index] = merged;
            writeJSON(GROUPS_DB, groups);
            if (applied.touched) writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');
    if (conflict?.conflict === 'not_found')   return res.status(404).json({ error: 'Grupo no encontrado' });
    if (conflict?.conflict === 'orphan_user') return res.status(400).json({ error: GROUP_MEMBERSHIP_ERR.USER_NOT_FOUND, message: `userIds inexistentes: ${conflict.userIds.join(', ')}` });
    if (conflict?.conflict === 'fallback_extinction_blocked') {
        log(`PUT /api/groups/${id} BLOCKED fallback_extinction visible=${fallbackRisk?.fallbackVisibleBefore} adding=${memberDelta.added.length}`, 'WARN');
        writeAuditLog({
            action:       'membership.fallback_guard_blocked',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId: id, adding: memberDelta.added.length, reason: fallbackRisk?.reason || 'fallback_extinction', method: 'PUT' },
            metadata: {
                ..._truncateUserIdsForAudit(memberDelta.added),
                fromGroupId:                   null,
                toGroupId:                     id,
                fromSchool:                    null,
                toSchool:                      mergedMeta?.school || null,
                groupType:                     mergedMeta?.type || null,
                organizationId:                mergedMeta?.organizationId || null,
                result:                        'blocked',
                assignedCount:                 0,
                failedCount:                   memberDelta.added.length,
                failedReasons:                 { fallback_extinction_blocked: memberDelta.added.length },
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
                fallbackOverrideUsed:          false,
                // (sin fallbackStateTransition — blocked, no hubo transición real)
            },
        });
        return res.status(422).json({
            error:                  'fallback_extinction_guard',
            message:                'PUT bulk-replace extinguiría el fallback colegio del grupo. Materializar todos los lectores juntos o usar override explícito.',
            visibleFallbackUsers:   fallbackRisk?.fallbackVisibleBefore ?? null,
            explicitMembers:        0,
            requestedExplicitAdds:  memberDelta.added.length,
            recommendation:         'materialize_fallback_first',
            overrideHeader:         'X-Allow-Fallback-Extinction: true',
        });
    }

    log(`Group updated: ${id} (type=${merged.type}) members delta added=${memberDelta.added.length} removed=${memberDelta.removed.length}`, 'ACCESS');
    res.json(merged);

    const fallbackOverrideApplied = !!(fallbackRisk?.atRisk && overrideFallbackExtinction && memberDelta.added.length > 0);
    if (fallbackOverrideApplied) {
        writeAuditLog({
            action:       'membership.fallback_extinction_allowed',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId: id, reason: fallbackRisk.reason, visibleBefore: fallbackRisk.fallbackVisibleBefore, method: 'PUT' },
            metadata: {
                ..._truncateUserIdsForAudit(memberDelta.added),
                fromGroupId:                   null,
                toGroupId:                     id,
                fromSchool:                    null,
                toSchool:                      mergedMeta?.school || null,
                groupType:                     mergedMeta?.type || null,
                organizationId:                mergedMeta?.organizationId || null,
                result:                        'success',
                assignedCount:                 memberDelta.added.length,
                failedCount:                   0,
                failedReasons:                 {},
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk.fallbackVisibleBefore,
                fallbackOverrideUsed:          true,
                fallbackStateTransition:       _createFallbackTransition('implicit', 'explicit'),
            },
        });
    }

    // Audit log — sólo si la mutación cambió memberships (PUT bulk-replace
    // puede usarse sólo para metadata del grupo, ej. renombrar; en ese caso
    // no genera audit). Cuando hay delta, registramos la lista combinada de
    // affectedUserIds (added ∪ removed) en metadata.targetUserIds.
    if (memberDelta.added.length > 0 || memberDelta.removed.length > 0) {
        const affectedUserIds = [...new Set([...memberDelta.added, ...memberDelta.removed])];
        writeAuditLog({
            action:       'group.update',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details: {
                groupId:        id,
                added:          memberDelta.added.length,
                removed:        memberDelta.removed.length,
                bulkReplace:    true,
            },
            metadata: {
                ..._truncateUserIdsForAudit(affectedUserIds),
                fromGroupId:                   null,
                toGroupId:                     id,
                fromSchool:                    null,
                toSchool:                      mergedMeta?.school || null,
                groupType:                     mergedMeta?.type || null,
                organizationId:                mergedMeta?.organizationId || null,
                result:                        'success',
                assignedCount:                 memberDelta.added.length,
                failedCount:                   memberDelta.removed.length,
                failedReasons:                 {},
                fallbackAffected:              !!fallbackRisk?.fallbackDependent,
                fallbackExtinguishedAttempted: fallbackOverrideApplied,
                fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
                fallbackOverrideUsed:          fallbackOverrideApplied,
                ...(fallbackOverrideApplied
                    ? { fallbackStateTransition: _createFallbackTransition('implicit', 'explicit') }
                    : {}),
            },
        });
    }
});

app.delete('/api/groups/:id', requireAdminAccess, async (req, res) => {
    const { id } = req.params;
    const overrideFallbackExtinction = _readFallbackOverride(req);
    // Sprint 021 — borrado atómico bidireccional. Antes de quitar el grupo,
    // limpiamos su id de user.groupIds en todos los users para que ninguno
    // quede con una referencia huérfana.
    let conflict     = null;
    let detachedFromUserIds = [];
    let groupMeta    = null;     // capturado dentro del lock (antes de splice) para audit
    let fallbackRisk = null;     // sobre el grupo a eliminar (Commit 5)
    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const users  = readJSON(USERS_DB);
            const index  = groups.findIndex(g => g.id === id);
            if (index === -1) { conflict = { conflict: 'not_found' }; return; }
            groupMeta = _extractGroupMeta(groups[index]);

            // ── Fallback extinction guard (Commit 5) ──────────────────────────
            // Eliminar un grupo fallback-dependent con lectores visibles los
            // deja sin el contenedor que les daba visibilidad en Aula Viva.
            // Bloquear sin override.
            fallbackRisk = _assessFallbackExtinctionRisk(groups[index], groups, users, {
                deletingGroup: true,
            });
            if (fallbackRisk.atRisk && !overrideFallbackExtinction) {
                conflict = { conflict: 'fallback_extinction_blocked', risk: fallbackRisk };
                return;
            }

            detachedFromUserIds = detachGroupFromAllUsers(users, id);
            if (detachedFromUserIds.length > 0) writeJSON(USERS_DB, users);

            groups.splice(index, 1);
            writeJSON(GROUPS_DB, groups);
        });
    }, 'groupsLock');
    if (conflict?.conflict === 'not_found') return res.status(404).json({ error: 'Grupo no encontrado' });
    if (conflict?.conflict === 'fallback_extinction_blocked') {
        log(`DELETE /api/groups/${id} BLOCKED fallback_extinction visible=${fallbackRisk?.fallbackVisibleBefore}`, 'WARN');
        writeAuditLog({
            action:       'membership.fallback_guard_blocked',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId: id, reason: fallbackRisk?.reason || 'group_deletion_extinguishes_fallback', method: 'DELETE_group' },
            metadata: {
                ..._truncateUserIdsForAudit([]),
                fromGroupId:                   id,
                toGroupId:                     null,
                fromSchool:                    groupMeta?.school || null,
                toSchool:                      null,
                groupType:                     groupMeta?.type || null,
                organizationId:                groupMeta?.organizationId || null,
                result:                        'blocked',
                assignedCount:                 0,
                failedCount:                   fallbackRisk?.fallbackVisibleBefore ?? 0,
                failedReasons:                 { fallback_extinction_blocked: 1 },
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
                fallbackOverrideUsed:          false,
                // (sin fallbackStateTransition — blocked, no hubo transición real)
            },
        });
        return res.status(422).json({
            error:                  'fallback_extinction_guard',
            message:                'Eliminar este grupo dejaría a sus lectores fallback sin visibilidad en Aula Viva. Materializar primero o usar override explícito.',
            visibleFallbackUsers:   fallbackRisk?.fallbackVisibleBefore ?? null,
            recommendation:         'materialize_fallback_first',
            overrideHeader:         'X-Allow-Fallback-Extinction: true',
        });
    }

    log(`Group deleted: ${id} (detached from ${detachedFromUserIds.length} users)`, 'ACCESS');
    res.json({ success: true, detachedFromUserIds });

    const fallbackOverrideApplied = !!(fallbackRisk?.atRisk && overrideFallbackExtinction);
    if (fallbackOverrideApplied) {
        writeAuditLog({
            action:       'membership.fallback_extinction_allowed',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId: id, reason: fallbackRisk.reason, visibleBefore: fallbackRisk.fallbackVisibleBefore, method: 'DELETE_group' },
            metadata: {
                ..._truncateUserIdsForAudit(detachedFromUserIds),
                fromGroupId:                   id,
                toGroupId:                     null,
                fromSchool:                    groupMeta?.school || null,
                toSchool:                      null,
                groupType:                     groupMeta?.type || null,
                organizationId:                groupMeta?.organizationId || null,
                result:                        'success',
                assignedCount:                 0,
                failedCount:                   fallbackRisk.fallbackVisibleBefore,
                failedReasons:                 {},
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk.fallbackVisibleBefore,
                fallbackOverrideUsed:          true,
                fallbackStateTransition:       _createFallbackTransition('implicit', 'extinct'),
            },
        });
    }

    // Audit log — DELETE /group cascade es membership mutation crítica:
    // borrar un grupo desconecta a TODOS sus members. Registramos affected
    // userIds completos para reconstrucción forense (quién perdió membresía
    // en este grupo) — incluso si el grupo ya no existe en groups_db.json.
    writeAuditLog({
        action:       'group.delete',
        targetUserId: null,
        actor:        req.headers['x-user-id'] || null,
        details: {
            groupId:       id,
            detachedCount: detachedFromUserIds.length,
        },
        metadata: {
            ..._truncateUserIdsForAudit(detachedFromUserIds),
            fromGroupId:                   id,
            toGroupId:                     null,
            fromSchool:                    groupMeta?.school || null,
            toSchool:                      null,
            groupType:                     groupMeta?.type || null,
            organizationId:                groupMeta?.organizationId || null,
            result:                        'success',
            assignedCount:                 0,
            failedCount:                   detachedFromUserIds.length,
            failedReasons:                 {},
            fallbackAffected:              !!fallbackRisk?.fallbackDependent,
            fallbackExtinguishedAttempted: fallbackOverrideApplied,
            fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
            fallbackOverrideUsed:          fallbackOverrideApplied,
            ...(fallbackOverrideApplied
                ? { fallbackStateTransition: _createFallbackTransition('implicit', 'extinct') }
                : {}),
        },
    });
});

// --- CLUBES EXTERNOS: JOIN ---
app.post('/api/groups/:id/join', requireUserAuth, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Sprint 021 — drift bidireccional cerrado.
    // Antes solo se actualizaba group.memberIds/studentIds. Ahora también
    // user.groupIds en el mismo lock anidado (groups outer, users inner) para
    // que el lector quede correctamente conectado al club al unirse.
    let resultGroup = null;
    let outcome     = null;
    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const users  = readJSON(USERS_DB);
            const index  = groups.findIndex(g => g.id === id);
            if (index === -1) { outcome = { conflict: 'not_found' }; return; }
            const group = groups[index];
            if (group.type !== 'club' || group.kind !== 'open') { outcome = { conflict: 'not_open_club' }; return; }

            const u = users.find(x => x?.id === userId);
            // Si el usuario autenticado no existe en USERS_DB, abortamos —
            // sería el mismo bug histórico (membresía sin user real).
            if (!u) { outcome = { conflict: 'user_missing' }; return; }

            const groupChanged = addUserIdToGroup(group, userId);
            const userChanged  = addGroupIdToUser(u, id);
            if (!groupChanged && !userChanged) {
                resultGroup = normalizeGroup(group); // ya estaba unido en ambos lados
                outcome = { idempotent: true };
                return;
            }

            groups[index] = normalizeGroup(group);
            resultGroup   = groups[index];
            writeJSON(GROUPS_DB, groups);
            if (userChanged) writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');
    if (outcome?.conflict === 'not_found')    return res.status(404).json({ error: 'Grupo no encontrado' });
    if (outcome?.conflict === 'not_open_club') return res.status(403).json({ error: 'Este grupo no admite uniones directas' });
    if (outcome?.conflict === 'user_missing')  return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.USER_NOT_FOUND, message: 'Usuario autenticado no existe en USERS_DB' });
    if (outcome?.idempotent) return res.json(resultGroup);
    log(`User ${userId} joined open club ${id}`, 'ACCESS');
    res.json(resultGroup);
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint A — Asignación multi-grupo en colegios con varios grupos.
//
// Razón: hasta ahora el único camino para asignar miembros a un grupo era
// PUT /api/groups/:id con el array memberIds completo (bulk-replace). Eso
// no escala en colegios multi-grupo donde varios admins editan en paralelo
// (last-write-wins) y no permite reportar fallos por usuario.
//
// Estos 5 endpoints exponen el flujo operativo correcto:
//   GET    /api/groups/:groupId/candidates              → quiénes pueden entrar
//   GET    /api/groups/:groupId/members                 → quiénes ya son miembros
//   POST   /api/groups/:groupId/members                 → asignar N usuarios (atómico)
//   POST   /api/groups/:toGroupId/members/move          → mover N usuarios entre grupos (atómico whole-batch)
//   DELETE /api/groups/:groupId/members/:userId         → quitar 1 usuario
//
// Toda la lógica de membresía pasa por groupMembershipService → utils
// (fuente única de verdad establecida en Sprint 021 Fases 1 y 2).
// ─────────────────────────────────────────────────────────────────────────────

// Helper local para comparación normalizada de "misma institución".
// Usa la misma convención (lowercase + trim) del fallback colegio del service.
//
// MGL-M1: `_sameSchool` y `_validateSameInstitution` extraídos a
// utils/membershipGovernance.mjs (importados arriba con alias `_`).
// Hardening empty-string, semántica orgId-then-colegio y comentarios
// históricos se preservan en el módulo. Cero cambio funcional aquí.

// _extractGroupMeta — snapshot inmutable del grupo al momento de la mutación,
// para incluir en audit log. Capturamos school/type/organizationId DENTRO del
// lock body (antes de mutar) para que el log preserve la institución incluso
// si el grupo se renombra/elimina después. Defensive: tolera null/undefined.
const _extractGroupMeta = (group) => {
    if (!group || typeof group !== 'object') return null;
    return {
        school:         typeof group.school === 'string' ? group.school : null,
        type:           group.type === 'club' ? 'club' : 'course',
        organizationId: typeof group.organizationId === 'string' && group.organizationId.length > 0
            ? group.organizationId
            : null,
    };
};

// _tallyFailedReasons — cuenta failed[] por reason. Reduce write amplification
// y PII (no expone userIds en el log, sólo distribución de causas).
const _tallyFailedReasons = (failed) => {
    if (!Array.isArray(failed)) return {};
    const tally = {};
    for (const f of failed) {
        const reason = (f && typeof f.reason === 'string') ? f.reason : 'unknown';
        tally[reason] = (tally[reason] || 0) + 1;
    }
    return tally;
};

// ─────────────────────────────────────────────────────────────────────────────
// BOUNDED AUDIT CARDINALITY — Commit 5.5
//
// Invariant del sistema (Commit 5.5):
//   "Ningún audit event puede persistir payloads de cardinalidad no acotada."
//
// Razón: user_audit_log.json es JSON append-only que se rewrite completo en
// cada write (mutateUserAudit). Persistir arrays de cientos de userIds
// produce write amplification cuadrática y degrada el archivo a velocidades
// inviables (~6.5 KB por entry de 235 IDs).
//
// Strategy: cada entry guarda un sample bounded + total count + flag de
// truncation. Para forensic completo, el ULID auditReferenceId del entry
// permitirá correlación con un futuro snapshot store si se construye.
//
// FUTURE INVARIANT ASYMMETRY: extinction (implicit → explicit) hoy es
// observable vía fallbackStateTransition. Resurrection (explicit → implicit,
// cuando un DELETE deja al grupo con canales vacíos y reactiva fallback)
// NO se detecta en este commit. Es deuda explícitamente documentada como
// asimetría del modelo observacional. Commit dedicado futuro debe cerrar
// el ciclo cuando la operación se vuelva analíticamente relevante.
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_USER_IDS_SAMPLE_LIMIT = 10;

// _truncateUserIdsForAudit — Commit 5.5a: deterministic spread sampling.
//
// Anti-pattern previo: slice(0, LIMIT) producía sesgo estructural — siempre
// capturaba el principio del batch (users importados primero, IDs antiguos),
// dejando la cola jamás visible en sample. Forensic ciega para anomalías
// al final del batch.
//
// Strategy 3+4+3 deterministic:
//   total ≤ LIMIT (10) → todos los IDs (no truncation)
//   total > LIMIT:
//     - primeros 3:  índices 0, 1, 2
//     - 4 middle equidistantes: 3 + round(i × (total-6) / 5) para i ∈ {1,2,3,4}
//     - últimos 3:   índices total-3, total-2, total-1
//
// Propiedades:
//   - Determinístico: mismo input → mismo output (sólo Math.round, Set, sort)
//   - Bounded: output siempre ≤ LIMIT
//   - Reproducibilidad forensic: misma audit query produce mismo result
//   - Cobertura del batch: principio + middle + cola, no sólo principio
const _truncateUserIdsForAudit = (userIds) => {
    if (!Array.isArray(userIds)) {
        return {
            targetUserIdsSample:    [],
            targetUserIdsTotal:     0,
            targetUserIdsTruncated: false,
        };
    }
    const total = userIds.length;
    if (total <= AUDIT_USER_IDS_SAMPLE_LIMIT) {
        return {
            targetUserIdsSample:    [...userIds],
            targetUserIdsTotal:     total,
            targetUserIdsTruncated: false,
        };
    }
    // total > LIMIT: spread sampling 3+4+3 = 10
    const indices = new Set();
    // Primeros 3
    indices.add(0); indices.add(1); indices.add(2);
    // 4 equidistantes en middle range [3, total-4]
    for (let i = 1; i <= 4; i++) {
        const idx = 3 + Math.round(i * (total - 6) / 5);
        indices.add(idx);
    }
    // Últimos 3
    indices.add(total - 3); indices.add(total - 2); indices.add(total - 1);
    // Sort ascending y proyectar a userIds
    const sorted = [...indices].sort((a, b) => a - b);
    return {
        targetUserIdsSample:    sorted.map(i => userIds[i]),
        targetUserIdsTotal:     total,
        targetUserIdsTruncated: true,
    };
};

// ─── FALLBACK TRANSITION MODEL — Commit 5.5a ─────────────────────────────────
//
// Centralización del modelo de transición fallback. Anti-pattern previo:
// literales `{ from: 'implicit', to: 'explicit' }` regados en 8 callsites
// inline → drift potential alto cuando se introduzcan:
//   - resurrection (explicit → implicit) — deuda diferida documentada
//   - hybrid states (partial materialization)
//   - organization migration transitions
//   - club-specific transitions
//
// El helper centraliza:
//   - whitelist de estados válidos (FALLBACK_TRANSITION_STATES)
//   - validación defensiva (no-op transitions retornan null, callers spread
//     condicionalmente para omitir el field si hay error)
//   - punto único para evolucionar el modelo cuando los estados crezcan

const FALLBACK_TRANSITION_STATES = Object.freeze(['implicit', 'explicit', 'extinct']);

const _createFallbackTransition = (from, to) => {
    if (!FALLBACK_TRANSITION_STATES.includes(from) || !FALLBACK_TRANSITION_STATES.includes(to)) {
        log(`[AUDIT] Invalid fallbackTransition: from=${from} to=${to} — emitiendo null`, 'WARN');
        return null;
    }
    if (from === to) {
        log(`[AUDIT] Trivial fallbackTransition (from===to: ${from}) — emitiendo null`, 'WARN');
        return null;
    }
    return Object.freeze({ from, to });
};

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK EXTINCTION GUARD — Commit 5
//
// Defensa estructural contra extinción accidental del fallback colegio legacy.
// Los 467 lectores de Nuevo Bosque + Villas de Aranjuez aparecen en Aula Viva
// vía single-school fallback. La primera asignación explícita a esos grupos
// extingue el fallback como side effect → los demás lectores vanish.
//
// Estos helpers detectan el riesgo. La acción defensiva (bloqueo o pase con
// override) se aplica inline en cada endpoint, siguiendo el patrón establecido
// por _validateSameInstitution (precedente Commit 3).
//
// Helpers podrían moverse a utils/groupMembership.mjs si otros consumers los
// necesitan. Por ahora viven aquí para minimizar blast radius del Commit 5.
// ─────────────────────────────────────────────────────────────────────────────

// _isFallbackDependent — true si el grupo está en estado fallback-dependent
// EN ESTE MOMENTO. Tres condiciones (ver doc Commit 5):
//   1. studentIds y memberIds vacíos
//   2. school string no-vacía (post normalización)
//   3. school única en allGroups (single-school fallback condition)
const _isFallbackDependent = (group, allGroups) => {
    if (!group || typeof group !== 'object') return false;
    const studentIds = Array.isArray(group.studentIds) ? group.studentIds : [];
    const memberIds  = Array.isArray(group.memberIds)  ? group.memberIds  : [];
    if (studentIds.length > 0 || memberIds.length > 0) return false;
    if (typeof group.school !== 'string') return false;
    const targetSchool = group.school.trim().toLowerCase();
    if (targetSchool.length === 0) return false;
    let count = 0;
    for (const g of (allGroups || [])) {
        if (typeof g?.school !== 'string') continue;
        if (g.school.trim().toLowerCase() === targetSchool) count++;
        if (count > 1) return false; // early exit: school no es única
    }
    return count === 1;
};

// MGL-M1: `_countFallbackVisibleLectors` extraído a
// utils/membershipGovernance.mjs (importado arriba con alias `_`).
// Cero cambio funcional aquí.

// _assessFallbackExtinctionRisk — evaluación atómica del riesgo. Devuelve un
// objeto con la información completa para tomar decisión de bloquear/permitir
// y para llenar audit metadata.
//
// mutation: { addingCount: number, deletingGroup: bool }
//   addingCount > 0  → operación que añade users a studentIds/memberIds
//   deletingGroup    → operación que elimina el grupo entero
//
// Resultado:
//   atRisk:                bool — true si la mutación extinguiría fallback
//                                 con users observables (≥1 lector visible)
//   fallbackDependent:     bool — true si el grupo es fallback-dependent ahora
//   fallbackVisibleBefore: number — lectores visibles vía fallback pre-mutation
//   reason:                string|null — clave humana de la causa de bloqueo
const _assessFallbackExtinctionRisk = (group, allGroups, allUsers, mutation) => {
    const dependent = _isFallbackDependent(group, allGroups);
    if (!dependent) {
        return {
            atRisk:                false,
            fallbackDependent:     false,
            fallbackVisibleBefore: 0,
            reason:                null,
        };
    }
    const visible = _countFallbackVisibleLectors(group, allUsers);
    if (mutation?.deletingGroup) {
        return {
            atRisk:                visible > 0,
            fallbackDependent:     true,
            fallbackVisibleBefore: visible,
            reason:                visible > 0 ? 'group_deletion_extinguishes_fallback' : null,
        };
    }
    if (mutation?.addingCount > 0) {
        // El guard protege contra DESAPARICIÓN de usuarios visibles, no contra
        // pureza conceptual del estado fallback-dependent. Si visible === 0,
        // no hay blast radius real (nadie aparecía vía fallback que pueda
        // perderse) — la operación es inocua y debe permitirse.
        return {
            atRisk:                visible > 0,
            fallbackDependent:     true,
            fallbackVisibleBefore: visible,
            reason:                visible > 0 ? 'partial_explicitification' : null,
        };
    }
    return {
        atRisk:                false,
        fallbackDependent:     true,
        fallbackVisibleBefore: visible,
        reason:                null,
    };
};

// _readFallbackOverride — lee el header X-Allow-Fallback-Extinction de forma
// estricta. Sólo el literal 'true' habilita el override. Cualquier otro valor
// (incluido 'TRUE', '1', 'yes') NO override. Reduce risk de override accidental
// por sloppy-typing.
const _readFallbackOverride = (req) => {
    const h = req?.headers?.['x-allow-fallback-extinction'];
    return h === 'true';
};

// MGL-M1: `_resolveMaterializableUsers` extraído a
// utils/membershipGovernance.mjs (importado arriba con alias `_`).
// Sigue siendo la single source of truth del conjunto materializable —
// classifier, dryRun, execute path y audit metadata lo reusan vía import.
// Cero cambio funcional aquí.

// MGL-M1: `_detectGroupMaterializationState` extraído a
// utils/membershipGovernance.mjs (importado arriba con alias `_`).
// La taxonomía oficial, las 4 ramas de estado, mixedSeverity y la matriz
// completa se preservan literalmente en el módulo. Cero cambio funcional aquí.
//
// La definición eliminada de este lugar se conserva como bloque diff-only —
// el comportamiento del endpoint POST /materialize-fallback es idéntico.
// (Cuerpo legacy del classifier removido — vive ahora en
//  utils/membershipGovernance.mjs como detectGroupMaterializationState.
//  Cualquier referencia futura debe importarlo, no reimplementarlo.)

// GET /api/groups/:groupId/candidates
// Lista usuarios que pueden ser asignados al grupo. Disponible para mediadores
// y admins (requireAuth). Filtra por misma institución y excluye a los que
// ya son miembros (vía la fuente única getGroupMembers).
app.get('/api/groups/:groupId/candidates', requireAuth, (req, res) => {
    try {
        const { groupId } = req.params;
        const groups = readJSON(GROUPS_DB) || [];
        const users  = readJSON(USERS_DB)  || [];

        const group = groups.find(g => g?.id === groupId);
        if (!group) return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND, message: 'Grupo no encontrado' });

        // Miembros actuales por la fuente única — incluye fallback colegio
        // si los canales explícitos están vacíos. Lo necesitamos para EXCLUIR
        // correctamente a quienes ya cuentan como miembros (no solo memberIds raw).
        const currentMemberIds = new Set(getGroupMembers(group, users, { allGroups: groups, warnFn: () => {} }));

        // Index para responder con `currentGroups` por candidato sin re-resolver
        // por cada user.
        const groupsByUser = new Map(); // userId → [groupId, ...]
        for (const g of groups) {
            const ids = getGroupMembers(g, users, { allGroups: groups, warnFn: () => {} });
            for (const uid of ids) {
                if (!groupsByUser.has(uid)) groupsByUser.set(uid, []);
                groupsByUser.get(uid).push(g.id);
            }
        }

        const candidates = [];
        for (const u of users) {
            if (!u?.id) continue;
            // Solo lectores son candidatos pedagógicos para memberIds.
            // (mediadores se gestionan en mediatorIds — fuera de scope acá.)
            if (!Array.isArray(u.roles) || !u.roles.includes('lector')) continue;
            if (currentMemberIds.has(u.id)) continue; // ya es miembro
            // Misma institución: usar organizationId si ambos lo tienen,
            // sino caer a comparación normalizada de colegio ↔ school.
            const sameOrg = u.organizationId && group.organizationId && u.organizationId === group.organizationId;
            const sameStr = _sameSchool(u.colegio, group.school);
            if (!sameOrg && !sameStr) continue;

            candidates.push({
                userId:        u.id,
                name:          u.nombre_completo || u.nombre_usuario || u.email || u.id,
                email:         u.email || null,
                colegio:       u.colegio || null,
                currentGroups: groupsByUser.get(u.id) || [],
            });
        }

        res.json({
            groupId,
            school:             group.school || null,
            currentMemberCount: currentMemberIds.size,
            candidates,
        });
    } catch (e) {
        log(`GET /api/groups/${req.params.groupId}/candidates error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /api/groups/:groupId/members
// Espejo lectura de POST/DELETE members. Hidrata datos para la UI del
// Gestor de Membresías. Reutiliza getGroupMembers (incluye fallback colegio
// cuando los canales explícitos están vacíos), asegurando coherencia con
// /candidates y /diagnosis.
//
// healthState refleja la salud bidireccional de la membresía de cada user:
//   'ok'           → studentIds + memberIds + user.groupIds en sincronía
//   'incomplete'   → bidireccional roto en uno de los 3 canales (legacy parcial)
//   'inconsistent' → sólo aparece vía fallback colegio (legacy puro a reparar)
//
// groupType: 'course' | 'club' — type === undefined → 'course' legacy
// (modelo unificado: clubs y cursos son la misma entidad group).
app.get('/api/groups/:groupId/members', requireAuth, (req, res) => {
    try {
        const { groupId } = req.params;
        const groups = readJSON(GROUPS_DB) || [];
        const users  = readJSON(USERS_DB)  || [];

        const group = groups.find(g => g?.id === groupId);
        if (!group) return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND, message: 'Grupo no encontrado' });

        // Fuente única — incluye fallback colegio cuando los canales explícitos
        // están vacíos. Mismo helper que candidates/diagnosis.
        const currentMemberIds = new Set(getGroupMembers(group, users, { allGroups: groups, warnFn: () => {} }));

        // Index para `currentGroups` y `currentGroupsByType` por user, evitando
        // re-resolver getGroupMembers por cada miembro.
        const groupsByUser = new Map(); // userId → Array<{ id, type }>
        for (const g of groups) {
            const ids = getGroupMembers(g, users, { allGroups: groups, warnFn: () => {} });
            const groupType = g?.type === 'club' ? 'club' : 'course';
            for (const uid of ids) {
                if (!groupsByUser.has(uid)) groupsByUser.set(uid, []);
                groupsByUser.get(uid).push({ id: g.id, type: groupType });
            }
        }

        // Canales explícitos del grupo objetivo — para healthState por miembro
        // sin volver a tocar disco.
        const studentSet = new Set(Array.isArray(group.studentIds) ? group.studentIds : []);
        const memberSet  = new Set(Array.isArray(group.memberIds)  ? group.memberIds  : []);

        const members = [];
        for (const u of users) {
            if (!u?.id || !currentMemberIds.has(u.id)) continue;

            const inStudent      = studentSet.has(u.id);
            const inMember       = memberSet.has(u.id);
            const inUserGroupIds = Array.isArray(u.groupIds) && u.groupIds.includes(groupId);

            let healthState;
            if (inStudent && inMember && inUserGroupIds)      healthState = 'ok';
            else if (inStudent || inMember || inUserGroupIds) healthState = 'incomplete';
            else                                              healthState = 'inconsistent';

            const userGroupsAll = groupsByUser.get(u.id) || [];

            members.push({
                userId:        u.id,
                name:          u.nombre_completo || u.nombre_usuario || u.email || u.id,
                email:         u.email || null,
                colegio:       u.colegio || null,
                currentGroups: userGroupsAll.map(x => x.id),
                currentGroupsByType: {
                    course: userGroupsAll.filter(x => x.type === 'course').map(x => x.id),
                    club:   userGroupsAll.filter(x => x.type === 'club').map(x => x.id),
                },
                healthState,
            });
        }

        res.json({
            groupId,
            groupType: group.type === 'club' ? 'club' : 'course',
            school:    group.school || null,
            members,
            count:     members.length,
        });
    } catch (e) {
        log(`GET /api/groups/${req.params.groupId}/members error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/groups/:groupId/members
// Asignación múltiple atómica. Body: { userIds: string[] }.
// Para cada userId: valida existencia y aplica add bidireccional.
// La transacción (groups + users) escribe AMBOS archivos en el mismo
// lock anidado o ninguno — ningún estado parcial inconsistente.
// Reporta por user: assigned (con alreadyMember si era idempotente) y failed.
app.post('/api/groups/:groupId/members', requireAdminAccess, async (req, res) => {
    const { groupId } = req.params;
    const body = req.body || {};
    if (!Array.isArray(body.userIds)) {
        return res.status(400).json({ error: 'userIds debe ser un array de strings' });
    }
    // Dedup + sanitización de entrada
    const userIds = [...new Set(body.userIds.filter(x => typeof x === 'string' && x.length > 0))];
    if (userIds.length === 0) {
        return res.status(400).json({ error: 'userIds vacío' });
    }
    // Cap defensivo — no esperamos batches gigantes desde la UI
    if (userIds.length > 500) {
        return res.status(400).json({ error: 'max 500 userIds por request' });
    }

    const overrideFallbackExtinction = _readFallbackOverride(req);
    let outcome     = null;
    let groupMeta   = null;     // capturado dentro del lock para audit log
    let fallbackRisk = null;    // capturado dentro del lock para audit metadata
    const assigned  = [];
    const failed    = [];

    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const users  = readJSON(USERS_DB);

            const group = groups.find(g => g?.id === groupId);
            if (!group) { outcome = { conflict: 'group_not_found' }; return; }
            groupMeta = _extractGroupMeta(group);

            const userById = new Map(users.map(u => [u?.id, u]).filter(([id]) => id));

            // ── PHASE 1: per-user pre-validation (sin mutar) ──────────────────
            // Acumula failed[] por user inexistente y cross-school.
            const validUsers = [];
            for (const uid of userIds) {
                const u = userById.get(uid);
                if (!u) {
                    failed.push({ userId: uid, reason: GROUP_MEMBERSHIP_ERR.USER_NOT_FOUND });
                    continue;
                }
                if (!_validateSameInstitution(u, group)) {
                    failed.push({ userId: uid, reason: 'cross_school_assignment' });
                    continue;
                }
                validUsers.push(u);
            }

            // ── PHASE 2: fallback extinction guard ────────────────────────────
            // Evalúa SI el grupo destino es fallback-dependent y el batch
            // efectivamente extinguiría el fallback. Si sí + sin override,
            // bloquea TODOS los validUsers (los pasa a failed con reason
            // 'fallback_extinction_blocked'). El audit log refleja el bloqueo.
            fallbackRisk = _assessFallbackExtinctionRisk(group, groups, users, {
                addingCount: validUsers.length,
            });
            if (fallbackRisk.atRisk && !overrideFallbackExtinction && validUsers.length > 0) {
                for (const u of validUsers) {
                    failed.push({ userId: u.id, reason: 'fallback_extinction_blocked' });
                }
                outcome = { conflict: 'fallback_extinction_blocked', risk: fallbackRisk };
                return; // sin mutación, sin writeJSON
            }

            // ── PHASE 3: mutación in-memory (validados + guard pasado/override) ─
            let groupsTouched = false;
            let usersTouched  = false;
            for (const u of validUsers) {
                const groupChanged = addUserIdToGroup(group, u.id);
                const userChanged  = addGroupIdToUser(u, groupId);
                if (groupChanged) groupsTouched = true;
                if (userChanged)  usersTouched  = true;
                assigned.push({
                    userId:        u.id,
                    alreadyMember: !groupChanged && !userChanged,
                });
            }

            // normalizeGroup re-sincroniza studentIds = memberIds explícitamente.
            const idx = groups.findIndex(g => g?.id === groupId);
            groups[idx] = normalizeGroup(group);

            // Orden de escritura GROUPS_DB → USERS_DB (mismo principio que Fase 1).
            if (groupsTouched) writeJSON(GROUPS_DB, groups);
            if (usersTouched)  writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');

    if (outcome?.conflict === 'group_not_found') {
        return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND, message: 'Grupo no encontrado' });
    }

    if (outcome?.conflict === 'fallback_extinction_blocked') {
        log(`POST /api/groups/${groupId}/members BLOCKED fallback_extinction visible=${fallbackRisk?.fallbackVisibleBefore} requested=${userIds.length}`, 'WARN');
        // Audit del bloqueo — mismo shape que las otras ops, action específica
        writeAuditLog({
            action:       'membership.fallback_guard_blocked',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId, requested: userIds.length, reason: fallbackRisk?.reason || 'fallback_extinction' },
            metadata: {
                ..._truncateUserIdsForAudit(userIds),
                fromGroupId:                   null,
                toGroupId:                     groupId,
                fromSchool:                    null,
                toSchool:                      groupMeta?.school || null,
                groupType:                     groupMeta?.type || null,
                organizationId:                groupMeta?.organizationId || null,
                result:                        'blocked',
                assignedCount:                 0,
                failedCount:                   userIds.length,
                failedReasons:                 _tallyFailedReasons(failed),
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
                fallbackOverrideUsed:          false,
                // (sin fallbackStateTransition — blocked, no hubo transición real)
            },
        });
        return res.status(422).json({
            error:                  'fallback_extinction_guard',
            message:                'Esta asignación extinguiría el fallback colegio del grupo, dejando estudiantes sin visibilidad. Materializar todos los lectores del colegio juntos o usar override explícito.',
            visibleFallbackUsers:   fallbackRisk?.fallbackVisibleBefore ?? null,
            explicitMembers:        0,
            requestedExplicitAdds:  userIds.length,
            recommendation:         'materialize_fallback_first',
            overrideHeader:         'X-Allow-Fallback-Extinction: true',
            failed,
        });
    }

    log(`POST /api/groups/${groupId}/members assigned=${assigned.length} failed=${failed.length}`, 'ACCESS');
    res.json({ groupId, assigned, failed });

    // Audit log — fire-and-forget, post-response. result discrimina el outcome:
    //   success — todos los users válidos asignados (incluye alreadyMember idempotentes)
    //   partial — algunos OK + algunos failed (cross_school_assignment / USER_NOT_FOUND)
    //   failed  — todos en failed (típicamente 100% cross-school)
    const auditResult = failed.length === 0
        ? 'success'
        : (assigned.length === 0 ? 'failed' : 'partial');
    const fallbackOverrideApplied = !!(fallbackRisk?.atRisk && overrideFallbackExtinction && assigned.length > 0);

    // Si el override fue usado para PASAR un guard que habría bloqueado,
    // emitir audit dedicado ANTES del evento principal (señal de seguridad).
    if (fallbackOverrideApplied) {
        writeAuditLog({
            action:       'membership.fallback_extinction_allowed',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId, reason: fallbackRisk.reason, visibleBefore: fallbackRisk.fallbackVisibleBefore },
            metadata: {
                ..._truncateUserIdsForAudit(userIds),
                fromGroupId:                   null,
                toGroupId:                     groupId,
                fromSchool:                    null,
                toSchool:                      groupMeta?.school || null,
                groupType:                     groupMeta?.type || null,
                organizationId:                groupMeta?.organizationId || null,
                result:                        'success',
                assignedCount:                 assigned.length,
                failedCount:                   failed.length,
                failedReasons:                 _tallyFailedReasons(failed),
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk.fallbackVisibleBefore,
                fallbackOverrideUsed:          true,
                fallbackStateTransition:       _createFallbackTransition('implicit', 'explicit'),
            },
        });
    }

    writeAuditLog({
        action:       'membership.assign',
        targetUserId: assigned.length === 1 && failed.length === 0 ? assigned[0].userId : null,
        actor:        req.headers['x-user-id'] || null,
        details:      { groupId, requested: userIds.length, assigned: assigned.length, failed: failed.length },
        metadata: {
            ..._truncateUserIdsForAudit(userIds),
            fromGroupId:                   null,
            toGroupId:                     groupId,
            fromSchool:                    null,
            toSchool:                      groupMeta?.school || null,
            groupType:                     groupMeta?.type || null,
            organizationId:                groupMeta?.organizationId || null,
            result:                        auditResult,
            assignedCount:                 assigned.length,
            failedCount:                   failed.length,
            failedReasons:                 _tallyFailedReasons(failed),
            fallbackAffected:              !!fallbackRisk?.fallbackDependent,
            fallbackExtinguishedAttempted: fallbackOverrideApplied,
            fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
            fallbackOverrideUsed:          fallbackOverrideApplied,
            ...(fallbackOverrideApplied
                ? { fallbackStateTransition: _createFallbackTransition('implicit', 'explicit') }
                : {}),
        },
    });
});

// DELETE /api/groups/:groupId/members/:userId
// Remoción individual con bidireccional cerrado. 404 si grupo o user no
// existen; idempotente (responde 200 con removed:false si ya no era miembro).
app.delete('/api/groups/:groupId/members/:userId', requireAdminAccess, async (req, res) => {
    const { groupId, userId } = req.params;

    let outcome      = null;
    let groupChanged = false;
    let userChanged  = false;
    let groupMeta    = null;     // capturado dentro del lock para audit log

    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const users  = readJSON(USERS_DB);

            const idx = groups.findIndex(g => g?.id === groupId);
            if (idx === -1) { outcome = { conflict: 'group_not_found' }; return; }
            groupMeta = _extractGroupMeta(groups[idx]);
            const u = users.find(x => x?.id === userId);
            if (!u) { outcome = { conflict: 'user_not_found' }; return; }
            // Cross-school gate defensivo: prevenir DELETE accidental sobre
            // grupo de otra institución (admin tipea wrong groupId). Si el
            // user no pertenece a la misma institución del grupo, rechazar
            // con 422 — admin debe verificar groupId/userId antes de retry.
            // Nota: si la situación es data drift legítima (user en grupo
            // equivocado por error histórico), la limpieza pasa por
            // syncGroupMembership, NO por DELETE bypass.
            if (!_validateSameInstitution(u, groups[idx])) {
                outcome = { conflict: 'cross_school_assignment' };
                return;
            }

            groupChanged = removeUserIdFromGroup(groups[idx], userId);
            userChanged  = removeGroupIdFromUser(u, groupId);

            if (groupChanged) groups[idx] = normalizeGroup(groups[idx]);
            if (groupChanged) writeJSON(GROUPS_DB, groups);
            if (userChanged)  writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');

    if (outcome?.conflict === 'group_not_found') return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND, message: 'Grupo no encontrado' });
    if (outcome?.conflict === 'user_not_found')  return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.USER_NOT_FOUND,  message: 'Usuario no encontrado' });
    if (outcome?.conflict === 'cross_school_assignment') {
        log(`DELETE /api/groups/${groupId}/members/${userId} BLOCKED cross-school`, 'WARN');
        // Audit: cross-school blocked es señal de seguridad/intent — se loggea
        // antes del response 422 para preservar trazabilidad de attempts.
        writeAuditLog({
            action:       'membership.cross_school_blocked',
            targetUserId: userId,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId, reason: 'cross_school_assignment', method: 'DELETE' },
            metadata: {
                ..._truncateUserIdsForAudit([userId]),
                fromGroupId:    groupId,
                toGroupId:      null,
                fromSchool:     groupMeta?.school || null,
                toSchool:       null,
                groupType:      groupMeta?.type || null,
                organizationId: groupMeta?.organizationId || null,
                result:         'blocked',
                assignedCount:  0,
                failedCount:    1,
                failedReasons:  { cross_school_assignment: 1 },
                // DELETE no extingue fallback. Campos uniformes para shape consistency.
                fallbackAffected:              false,
                fallbackExtinguishedAttempted: false,
                fallbackVisibleBefore:         null,
                fallbackOverrideUsed:          false,
            },
        });
        return res.status(422).json({
            error:   'cross_school_assignment',
            message: `Usuario ${userId} no pertenece a la misma institución del grupo ${groupId}. Verificá groupId/userId antes de retry.`,
        });
    }

    log(`DELETE /api/groups/${groupId}/members/${userId} removed=${groupChanged || userChanged}`, 'ACCESS');
    res.json({ groupId, userId, removed: groupChanged || userChanged });

    // Audit log — sólo si la operación produjo cambio (idempotent no-op no
    // genera entry, igual que log() ACCESS no agrega ruido en idempotentes).
    if (groupChanged || userChanged) {
        writeAuditLog({
            action:       'membership.remove',
            targetUserId: userId,
            actor:        req.headers['x-user-id'] || null,
            details:      { groupId, removed: true },
            metadata: {
                ..._truncateUserIdsForAudit([userId]),
                fromGroupId:                   groupId,
                toGroupId:                     null,
                fromSchool:                    groupMeta?.school || null,
                toSchool:                      null,
                groupType:                     groupMeta?.type || null,
                organizationId:                groupMeta?.organizationId || null,
                result:                        'success',
                assignedCount:                 0,
                failedCount:                   0,
                failedReasons:                 {},
                // DELETE no extingue fallback (sólo puede activarlo — resurrection).
                // Resurrection no se detecta en este commit (asimetría documentada
                // como future invariant en el comment del helper).
                fallbackAffected:              false,
                fallbackExtinguishedAttempted: false,
                fallbackVisibleBefore:         null,
                fallbackOverrideUsed:          false,
            },
        });
    }
});

// POST /api/groups/:toGroupId/members/move
// Mueve N usuarios desde fromGroupId a toGroupId en una sola transacción.
// Body: { userIds: string[], fromGroupId: string }.
//
// ── Por qué este endpoint en lugar de DELETE+POST cliente ───────────────────
// Hacer move como dos requests independientes (DELETE de fromGroup + POST a
// toGroup) introduce una ventana donde el user puede quedar huérfano si la
// segunda llamada falla, o duplicado si la primera no completa pero el cliente
// reintenta el batch entero. El move atómico cierra esa ventana operacional.
//
// ── Atomicidad whole-batch (rollback completo si CUALQUIER user falla) ──────
// A diferencia de POST /members (que comitea las asignaciones válidas y
// reporta failed[] aparte), move adopta semántica all-or-nothing:
//   PHASE 1: pre-validación de TODOS los users sin mutar in-memory.
//   PHASE 2: si failed.length > 0 → return 422 con moved=[], nada se escribe.
//   PHASE 3: si todas pasaron → mutar in-memory + writeJSON ambos archivos.
// Razón: un move parcialmente comiteado deja al admin con un panorama
// confuso ("estos 3 se movieron pero estos 2 no"). Mejor fallar entero,
// devolver razones, y dejar que el admin corrija el batch.
//
// ── Reúsa los helpers atómicos de utils/groupMembership.mjs ────────────────
//   - removeUserIdFromGroup / removeGroupIdFromUser   → quitar de fromGroup
//   - addUserIdToGroup       / addGroupIdToUser       → añadir a toGroup
//   - normalizeGroup                                   → re-sincroniza studentIds === memberIds
// Lock anidado idéntico a POST /members (groups outer, users inner) — orden
// consistente cross-endpoint elimina el riesgo de deadlock entre handlers.
//
// ── Idempotencia ────────────────────────────────────────────────────────────
// La SEGUNDA llamada con los mismos userIds devuelve 422 con todos en failed=
// 'not_in_source_group' (ya no son miembros explícitos de fromGroup tras la
// primera). Sin corrupción de datos, sin duplicados, sin huérfanos. Es la
// definición operacional de idempotencia para esta operación.
//
// ── Fallback colegio (legacy) ───────────────────────────────────────────────
// Un user que sólo es miembro de fromGroup vía fallback colegio (no aparece
// en studentIds/memberIds ni en su user.groupIds) NO es un "miembro
// explícito" — el endpoint lo rechaza con reason='not_in_source_group'. El
// admin debe primero asignarlo explícitamente con POST /members, y luego
// moverlo. Esto preserva la semántica del fallback (es lectura, no mutación).
app.post('/api/groups/:toGroupId/members/move', requireAdminAccess, async (req, res) => {
    const { toGroupId } = req.params;
    const body = req.body || {};

    // ── Input validation (sin lock — falla rápido) ──────────────────────────
    if (typeof body.fromGroupId !== 'string' || body.fromGroupId.length === 0) {
        return res.status(400).json({ error: 'fromGroupId debe ser string no vacío' });
    }
    if (!Array.isArray(body.userIds)) {
        return res.status(400).json({ error: 'userIds debe ser un array de strings' });
    }
    const { fromGroupId } = body;
    if (fromGroupId === toGroupId) {
        return res.status(400).json({ error: 'fromGroupId y toGroupId no pueden ser iguales' });
    }
    // Dedup + sanitización
    const userIds = [...new Set(body.userIds.filter(x => typeof x === 'string' && x.length > 0))];
    if (userIds.length === 0) {
        return res.status(400).json({ error: 'userIds vacío' });
    }
    if (userIds.length > 500) {
        return res.status(400).json({ error: 'max 500 userIds por request' });
    }

    const overrideFallbackExtinction = _readFallbackOverride(req);
    let outcome           = null;
    let fromGroupMeta     = null;   // capturado dentro del lock para audit log
    let toGroupMeta       = null;
    let fallbackRisk      = null;   // sobre toGroup (destino del move)
    const moved           = [];
    const failed          = [];

    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const users  = readJSON(USERS_DB);

            // Lookup ambos grupos en el MISMO lock — sin race con admin paralelo.
            const fromIdx = groups.findIndex(g => g?.id === fromGroupId);
            const toIdx   = groups.findIndex(g => g?.id === toGroupId);
            if (fromIdx === -1) { outcome = { conflict: 'from_group_not_found' }; return; }
            if (toIdx === -1)   { outcome = { conflict: 'to_group_not_found' };   return; }

            const fromGroup = groups[fromIdx];
            const toGroup   = groups[toIdx];
            fromGroupMeta = _extractGroupMeta(fromGroup);
            toGroupMeta   = _extractGroupMeta(toGroup);

            const userById    = new Map(users.map(u => [u?.id, u]).filter(([id]) => id));
            const fromStudent = new Set(Array.isArray(fromGroup.studentIds) ? fromGroup.studentIds : []);
            const fromMember  = new Set(Array.isArray(fromGroup.memberIds)  ? fromGroup.memberIds  : []);

            // ── PHASE 1: pre-validación, sin mutar in-memory ─────────────────
            // Acumula TODOS los failures antes de decidir commit/rollback.
            const validUsers = [];
            for (const uid of userIds) {
                const u = userById.get(uid);
                if (!u) {
                    failed.push({ userId: uid, reason: GROUP_MEMBERSHIP_ERR.USER_NOT_FOUND });
                    continue;
                }
                // "Miembro explícito" = en al menos uno de los 3 canales del
                // grupo origen. Fallback colegio NO cuenta (ver doc arriba).
                const isExplicitMember = fromStudent.has(uid)
                    || fromMember.has(uid)
                    || (Array.isArray(u.groupIds) && u.groupIds.includes(fromGroupId));
                if (!isExplicitMember) {
                    failed.push({ userId: uid, reason: 'not_in_source_group' });
                    continue;
                }
                // Cross-school gate: el user debe pertenecer a la misma
                // institución que el grupo DESTINO. Bloquea move accidental
                // entre instituciones distintas. Whole-batch rollback se
                // dispara más abajo si CUALQUIER user falla esta validación.
                if (!_validateSameInstitution(u, toGroup)) {
                    failed.push({ userId: uid, reason: 'cross_school_assignment' });
                    continue;
                }
                validUsers.push(u);
            }

            if (failed.length > 0) {
                // Whole-batch rollback: no se mutó nada, sólo se llenó failed[].
                outcome = { conflict: 'whole_batch_rollback' };
                return;
            }

            // ── PHASE 1.5: fallback extinction guard sobre toGroup ────────────
            // Move a un grupo destino fallback-dependent extingue su fallback
            // exactamente como POST /members. Whole-batch rollback se mantiene:
            // si el guard bloquea, todos los validUsers se reportan como
            // failed con reason 'fallback_extinction_blocked' y nada se muta.
            fallbackRisk = _assessFallbackExtinctionRisk(toGroup, groups, users, {
                addingCount: validUsers.length,
            });
            if (fallbackRisk.atRisk && !overrideFallbackExtinction) {
                for (const u of validUsers) {
                    failed.push({ userId: u.id, reason: 'fallback_extinction_blocked' });
                }
                outcome = { conflict: 'fallback_extinction_blocked', risk: fallbackRisk };
                return;
            }

            // ── PHASE 2: mutación in-memory (todas las validaciones pasaron) ──
            let groupsTouched = false;
            let usersTouched  = false;

            for (const u of validUsers) {
                const uid = u.id;
                // Remove explícito de fromGroup en los 3 canales bidireccionales.
                const fromGroupChanged = removeUserIdFromGroup(fromGroup, uid);
                const userRemoveChange = removeGroupIdFromUser(u, fromGroupId);
                // Add explícito a toGroup en los 3 canales (idempotente).
                const toGroupChanged   = addUserIdToGroup(toGroup, uid);
                const userAddChange    = addGroupIdToUser(u, toGroupId);

                if (fromGroupChanged || toGroupChanged) groupsTouched = true;
                if (userRemoveChange || userAddChange)  usersTouched  = true;

                moved.push({
                    userId: uid,
                    // True si el user ya estaba en toGroup en ambos canales
                    // (group + user.groupIds) — informativo, no afecta éxito.
                    alreadyInDestination: !toGroupChanged && !userAddChange,
                });
            }

            // ── PHASE 3: re-normalize + commit ────────────────────────────────
            // normalizeGroup re-sincroniza studentIds === memberIds en ambos.
            groups[fromIdx] = normalizeGroup(fromGroup);
            groups[toIdx]   = normalizeGroup(toGroup);
            // Orden de escritura GROUPS_DB → USERS_DB (consistente con
            // POST /members + DELETE /members/:userId).
            if (groupsTouched) writeJSON(GROUPS_DB, groups);
            if (usersTouched)  writeJSON(USERS_DB, users);
        });
    }, 'groupsLock');

    if (outcome?.conflict === 'from_group_not_found') {
        return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND, message: `fromGroupId no encontrado: ${fromGroupId}` });
    }
    if (outcome?.conflict === 'to_group_not_found') {
        return res.status(404).json({ error: GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND, message: `toGroupId no encontrado: ${toGroupId}` });
    }
    if (outcome?.conflict === 'fallback_extinction_blocked') {
        log(`POST /api/groups/${toGroupId}/members/move BLOCKED fallback_extinction visible=${fallbackRisk?.fallbackVisibleBefore} requested=${userIds.length}`, 'WARN');
        writeAuditLog({
            action:       'membership.fallback_guard_blocked',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { fromGroupId, toGroupId, requested: userIds.length, reason: fallbackRisk?.reason || 'fallback_extinction', method: 'move' },
            metadata: {
                ..._truncateUserIdsForAudit(userIds),
                fromGroupId,
                toGroupId,
                fromSchool:                    fromGroupMeta?.school || null,
                toSchool:                      toGroupMeta?.school || null,
                groupType:                     toGroupMeta?.type || null,
                organizationId:                toGroupMeta?.organizationId || null,
                result:                        'blocked',
                assignedCount:                 0,
                failedCount:                   userIds.length,
                failedReasons:                 _tallyFailedReasons(failed),
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
                fallbackOverrideUsed:          false,
                // (sin fallbackStateTransition — blocked, no hubo transición real)
            },
        });
        return res.status(422).json({
            error:                  'fallback_extinction_guard',
            message:                'El move extinguiría el fallback colegio del grupo destino. Materializar todos los lectores juntos o usar override explícito.',
            visibleFallbackUsers:   fallbackRisk?.fallbackVisibleBefore ?? null,
            explicitMembers:        0,
            requestedExplicitAdds:  userIds.length,
            recommendation:         'materialize_fallback_first',
            overrideHeader:         'X-Allow-Fallback-Extinction: true',
            moved:                  [],
            failed,
            rolledBack:             true,
        });
    }

    if (outcome?.conflict === 'whole_batch_rollback') {
        // 422 Unprocessable Entity — request sintácticamente válida pero
        // semánticamente no atomicable. moved=[] siempre cuando hay rollback.
        log(`POST /api/groups/${toGroupId}/members/move ROLLBACK from=${fromGroupId} failed=${failed.length}`, 'WARN');
        // Audit: rollback es señal operacional crítica (whole-batch). El
        // metadata incluye el tally de razones para detectar patterns
        // (cross-school recurrente, intentos sobre fallback-only, etc.).
        writeAuditLog({
            action:       'membership.move.rollback',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { fromGroupId, toGroupId, requested: userIds.length, failed: failed.length },
            metadata: {
                ..._truncateUserIdsForAudit(userIds),
                fromGroupId,
                toGroupId,
                fromSchool:                    fromGroupMeta?.school || null,
                toSchool:                      toGroupMeta?.school || null,
                groupType:                     toGroupMeta?.type || null,
                organizationId:                toGroupMeta?.organizationId || null,
                result:                        'rollback',
                assignedCount:                 0,
                failedCount:                   failed.length,
                failedReasons:                 _tallyFailedReasons(failed),
                fallbackAffected:              !!fallbackRisk?.fallbackDependent,
                fallbackExtinguishedAttempted: false,
                fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
                fallbackOverrideUsed:          false,
                // (sin fallbackStateTransition — rollback, no hubo transición real)
            },
        });
        return res.status(422).json({ moved: [], failed, rolledBack: true });
    }

    log(`POST /api/groups/${toGroupId}/members/move from=${fromGroupId} moved=${moved.length} failed=${failed.length}`, 'ACCESS');
    res.json({ moved, failed });

    const fallbackOverrideApplied = !!(fallbackRisk?.atRisk && overrideFallbackExtinction && moved.length > 0);
    if (fallbackOverrideApplied) {
        writeAuditLog({
            action:       'membership.fallback_extinction_allowed',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details:      { fromGroupId, toGroupId, reason: fallbackRisk.reason, visibleBefore: fallbackRisk.fallbackVisibleBefore, method: 'move' },
            metadata: {
                ..._truncateUserIdsForAudit(userIds),
                fromGroupId,
                toGroupId,
                fromSchool:                    fromGroupMeta?.school || null,
                toSchool:                      toGroupMeta?.school || null,
                groupType:                     toGroupMeta?.type || null,
                organizationId:                toGroupMeta?.organizationId || null,
                result:                        'success',
                assignedCount:                 moved.length,
                failedCount:                   0,
                failedReasons:                 {},
                fallbackAffected:              true,
                fallbackExtinguishedAttempted: true,
                fallbackVisibleBefore:         fallbackRisk.fallbackVisibleBefore,
                fallbackOverrideUsed:          true,
                fallbackStateTransition:       _createFallbackTransition('implicit', 'explicit'),
            },
        });
    }

    // Audit log — sólo si efectivamente se movió ≥1 user (idempotent no-op
    // donde todos eran alreadyInDestination genera entry porque sigue siendo
    // un acto admin con intent registrable).
    writeAuditLog({
        action:       'membership.move',
        targetUserId: null,
        actor:        req.headers['x-user-id'] || null,
        details:      { fromGroupId, toGroupId, moved: moved.length },
        metadata: {
            ..._truncateUserIdsForAudit(userIds),
            fromGroupId,
            toGroupId,
            fromSchool:                    fromGroupMeta?.school || null,
            toSchool:                      toGroupMeta?.school || null,
            groupType:                     toGroupMeta?.type || null,
            organizationId:                toGroupMeta?.organizationId || null,
            result:                        'success',
            assignedCount:                 moved.length,
            failedCount:                   0,
            failedReasons:                 {},
            fallbackAffected:              !!fallbackRisk?.fallbackDependent,
            fallbackExtinguishedAttempted: fallbackOverrideApplied,
            fallbackVisibleBefore:         fallbackRisk?.fallbackVisibleBefore ?? null,
            fallbackOverrideUsed:          fallbackOverrideApplied,
            ...(fallbackOverrideApplied
                ? { fallbackStateTransition: _createFallbackTransition('implicit', 'explicit') }
                : {}),
        },
    });
});

// POST /api/groups/:groupId/members/materialize-fallback
// ============================================================================
// Vía oficial, explícita, auditable y atómica para convertir el fallback colegio
// legacy implícito → memberships explícitas persistentes. Primera transición
// formal del modo legacy implícito → modelo explícito gobernado.
//
// NO es bulk-add. Es transition system: opera SÓLO sobre grupos fallback-
// dependent (studentIds + memberIds vacíos, school única, ≥1 lector con colegio
// matching). El conjunto materializable se computa por set difference formal:
//   materializable = applyLegacyColegioFallback(g).matched ∖ getExplicitGroupMembers(g)
//
// Aula Viva visibility queda PRESERVADA: los N lectores que aparecían vía
// fallback siguen siendo los MISMOS N visibles vía explicit channels. Conjunto
// idéntico, source diferente. Cero blast radius observable para el usuario.
//
// ── State machine (clasificador _detectGroupMaterializationState) ──────────
//   S1 fallback_dependent   → ejecuta materialization
//   S2 fully_explicit       → 200 noOp (sin audit)
//   S3 empty_inert          → 200 noOp (sin audit)
//   S4 mixed_legacy_state   → 422 (sin audit, requiere resolución manual)
//   404 si grupo no existe
//
// ── Optimistic concurrency ─────────────────────────────────────────────────
// expectedCount opcional. Si provisto y difiere del materializable real,
// 409 expected_count_mismatch — preview stale, no muta.
//
// ── DryRun ──────────────────────────────────────────────────────────────────
// Mismo lock path + mismo snapshot + misma resolución. Devuelve auditPreview
// con auditReferenceId:null + auditReferenceGeneratedOnExecute:true (contract
// explícito — no fake ULIDs).
//
// ── Hard runtime invariant ─────────────────────────────────────────────────
// PHASE 7.5 verifica: explicitMembersAfter === explicitMembersBefore + attempted.
// Si rompe → 409 materialization_invariant_breach (NO 500) + audit dedicado
// membership.fallback_materialization_invariant_breach. State NO se persiste.
//
// ── Lock & persistencia ────────────────────────────────────────────────────
// Lock ordering groups → users (idéntico cross-endpoint). Persistencia
// INVERTIDA vs assign/move: USERS_DB primero, GROUPS_DB después. Si GROUPS
// falla, group sigue fallback-dependent → Aula Viva mantiene visibility vía
// fallback (graceful degradation). Razón completa en comment in-body.
//
// ── Bypass legítimo del extinction guard ───────────────────────────────────
// _assessFallbackExtinctionRisk NO se invoca como gate. fallbackVisibleBefore
// se captura sólo informacionalmente (audit metadata). El guard existe para
// PARCIAL explicitification; materialization es FULL explicitification (mismo
// conjunto, source diferente) — blast radius zero, bypass documentado.
//
// ── Idempotencia conceptual ────────────────────────────────────────────────
// Primera ejecución: materializa N, transition implicit → explicit.
// Segunda ejecución inmediata: classifier devuelve fully_explicit → noOp.
// Cero duplicados, cero drift, cero double memberships.
//
// ── Audit ───────────────────────────────────────────────────────────────────
// Action: membership.fallback_materialized (success)
//         membership.fallback_materialization_invariant_breach (breach)
// Metadata: shape uniforme Commit 5.5 + campos Commit 6:
//   preMutationState, preMutationReasonCode,
//   explicitMembersBefore, explicitMembersAfter,
//   materializationAttempted (intent), materializationObservedDelta (observed),
//   materializationDelta (=== attempted, semantic intent),
//   invariantSatisfied.
//
// Auth: requireAdminAccess (operación con alcance institucional irreversible).
// ============================================================================
app.post('/api/groups/:groupId/members/materialize-fallback', requireAdminAccess, async (req, res) => {
    const { groupId } = req.params;
    const body = req.body || {};

    // ── PHASE 0 — Input validation (sin lock) ──────────────────────────────
    const dryRun = body.dryRun === true;
    let expectedCount = null;
    if (body.expectedCount !== undefined) {
        if (typeof body.expectedCount !== 'number'
            || !Number.isInteger(body.expectedCount)
            || body.expectedCount < 0) {
            return res.status(400).json({ error: 'expectedCount debe ser un entero ≥ 0' });
        }
        expectedCount = body.expectedCount;
    }

    let outcome                = null;
    let groupMeta              = null;
    let classification         = null;
    let materializableUserIds  = [];
    let explicitMembersBefore  = 0;
    let explicitMembersAfter   = 0;
    let fallbackVisibleBefore  = 0;

    await withFileLock(GROUPS_DB, async () => {
        _jsonCache.delete(GROUPS_DB);
        await withUsersLock(USERS_DB, () => {
            _jsonCache.delete(USERS_DB);
            const groups = readJSON(GROUPS_DB) || [];
            const users  = readJSON(USERS_DB);
            const userById = new Map(users.map(u => [u?.id, u]).filter(([id]) => id));

            // ── PHASE 2 — Group resolution ─────────────────────────────────
            const idx = groups.findIndex(g => g?.id === groupId);
            if (idx === -1) { outcome = { conflict: 'group_not_found' }; return; }
            const group = groups[idx];
            groupMeta = _extractGroupMeta(group);

            // fallbackEligibleCount — total de lectores con colegio matching
            // (independiente de si fallback es la visibility path actual).
            // _countFallbackVisibleLectors está mal nombrado por Commit 5: cuenta
            // eligibles, NO sólo visibles. Lo dejamos sin renombrar por backward
            // compat con audit fields existentes. El endpoint distingue:
            //   - fallbackEligibleCount: total histórico de matching colegio
            //   - fallbackVisibleNow:    cuenta SÓLO si fallback es active path
            //
            // Materialization bypassa el extinction guard por construcción (full
            // explicitification, no parcial) — fallbackEligibleCount se captura
            // informacionalmente para audit + response shapes.
            fallbackVisibleBefore = _countFallbackVisibleLectors(group, users);

            // ── PHASE 3 — State classification ─────────────────────────────
            classification = _detectGroupMaterializationState(group, users, groups, userById);

            if (classification.state === 'mixed_legacy_state') {
                outcome = { conflict: 'mixed_legacy_state' };
                return;
            }
            if (classification.state === 'fully_explicit') {
                outcome = { noOp: true, sub: 'fully_explicit' };
                return;
            }
            if (classification.state === 'empty_inert') {
                outcome = { noOp: true, sub: 'empty_inert' };
                return;
            }
            // classification.state === 'fallback_dependent' → proceed

            // ── PHASE 4 — Materializable resolution (single source of truth) ─
            // _resolveMaterializableUsers es el ÚNICO authority. El classifier
            // ya lo invocó internamente — esta segunda invocación es defensive
            // (mismo snapshot por el lock, garantizamos consistencia).
            materializableUserIds = _resolveMaterializableUsers(group, users, groups);

            if (materializableUserIds.length === 0) {
                // CLASSIFIER EXECUTION DIVERGENCE — invariant violation conceptual.
                // El classifier indicó 'fallback_dependent' (que implica eligibles>0
                // por construcción), pero el resolver devuelve 0. Esto NO es un noOp
                // legítimo: significa que helpers (applyLegacyColegioFallback,
                // getExplicitGroupMembers, userIsLectorLike) divergieron entre la
                // ruta del classifier y la ruta del resolver.
                //
                // Bajo el SoT del resolver post-Commit 6 esto es literalmente
                // unreachable (mismo helper, mismo snapshot). Defendemos por:
                //   - refactor futuro que rompa el contract
                //   - corruption de datos in-memory
                //   - bug en applyLegacyColegioFallback bajo conditions edge
                outcome = {
                    conflict: 'classifier_execution_divergence',
                    classifierState: classification.state,
                    classifierEligibles: classification.fallbackEligibleNotExplicit,
                    resolverCount: 0,
                };
                return;
            }

            // ── PHASE 5 — expectedCount gate ───────────────────────────────
            if (expectedCount !== null && expectedCount !== materializableUserIds.length) {
                outcome = {
                    conflict:    'expected_count_mismatch',
                    expectedCount,
                    actualCount: materializableUserIds.length,
                };
                return;
            }

            // ── PHASE 6 — DryRun branch ────────────────────────────────────
            if (dryRun) {
                outcome = { dryRun: true };
                return;
            }

            // ── PHASE 7 — Execute mutation ─────────────────────────────────
            // Pre-mutation explicit count: por construcción del state machine,
            // en 'fallback_dependent' === 0 (classifier no llega aquí de otra
            // forma). Lectura defensive para evitar dependencia implícita
            // del scope previo del resolver.
            explicitMembersBefore = getExplicitGroupMembers(group, users).size;
            for (const uid of materializableUserIds) {
                addUserIdToGroup(group, uid);
                const u = userById.get(uid);
                if (u) addGroupIdToUser(u, groupId);
            }
            groups[idx] = normalizeGroup(group);
            // normalizeGroup — contract estrecho para materialization:
            //
            // DEPENDENCIA ÚNICA Y EXCLUSIVA:
            //   re-confirma studentIds === memberIds (invariante crítica que
            //   alimenta el invariant gate de PHASE 7.5).
            //
            // LEGACY TOLERATED SIDE EFFECTS (NO requeridos por materialization,
            // tolerados por convención con assign/move pre-existentes):
            //   - type default ('course' si missing/invalid)
            //   - mediatorIds ↔ teacherId sync bidireccional
            //   - organizationId lookup desde SCHOOLS_DB (sin lock — read-only)
            //   - gradeLevel/section derivation desde grade string legacy
            //
            // Estos son helper-legacy parcialmente peligrosos pero tolerados.
            // NO interpretar como "normalización segura universal". Cualquier
            // cambio futuro a normalizeGroup DEBE verificarse específicamente
            // contra materialization (no asumir blast radius cero).
            //
            // Migration target: extraer la garantía pura studentIds === memberIds
            // a un helper dedicado (_reconcileGroupMemberInvariant) e invocarlo
            // aquí en lugar de normalizeGroup. Deuda explícita para sprint
            // posterior — no se aborda en Commit 6 para minimizar blast radius.

            // ── PHASE 7.5 — HARD INVARIANT GATE ────────────────────────────
            explicitMembersAfter = getExplicitGroupMembers(groups[idx], users).size;
            const expected = explicitMembersBefore + materializableUserIds.length;
            if (explicitMembersAfter !== expected) {
                outcome = {
                    conflict:              'invariant_breach',
                    explicitMembersBefore,
                    explicitMembersAfter,
                    expected,
                    attempted:             materializableUserIds.length,
                };
                return;  // exit sin writeJSON — in-memory NO se persiste
            }

            // ── PHASE 7.7 — Persist (USERS first, GROUPS last) ─────────────
            //
            // ⚠️ ATOMICITY DISCLOSURE — Commit 6 NO provee atomicidad cross-file.
            // ─────────────────────────────────────────────────────────────────
            // Existe ventana lógica observable entre los dos writeJSON:
            //   USERS_DB persisted ✓
            //   GROUPS_DB write fails (disk full / process kill / I/O error)
            // → estado bidireccional inconsistente.
            //
            // writeJSON usa tmp+rename (atómico OS-level POR ARCHIVO), pero la
            // operación cross-archivo es secuencial. No hay 2PC, no hay WAL
            // cross-file, no hay rollback automático.
            //
            // Mitigaciones aplicadas (NO reemplazan atomicidad real):
            //   - Orden USERS → GROUPS minimiza blast radius observable
            //     (graceful degradation — ver explicación abajo)
            //   - lock anidado garantiza serialización vs otros endpoints
            //   - syncGroupMembership puede reconstruir desde la dirección
            //     que sobreviva al fallo
            //
            // Migration target FUTURO: persistence layer transaccional
            // (SQLite WAL, PostgreSQL, o equivalente). Deuda explícita
            // documentada — no se resuelve en Commit 6.
            //
            // ── ORDEN INVERTIDO vs assign/move (decisión Commit 6) ──────────
            //
            // Si USERS write OK + GROUPS write fails:
            //   - user.groupIds tiene ref → reconciliable trivialmente
            //   - group sigue fallback-dependent → Aula Viva mantiene
            //     visibility VIA FALLBACK durante ventana inconsistente
            //   - syncGroupMembership reconstruye desde user.groupIds
            //
            // Si invirtiéramos (GROUPS first), group "miente" sobre membresía
            // persistida — Aula Viva visibility cambia a explicit channel sin
            // espejo bidireccional. Degradación hard, no graceful.
            //
            // Esta es la PRIMERA mutación bulk del sistema (potencialmente
            // 235+ user records). Para mutaciones 1-N (assign/move) la
            // convención local sigue siendo GROUPS → USERS — no se propaga.
            writeJSON(USERS_DB, users);
            writeJSON(GROUPS_DB, groups);

            outcome = { success: true };
        });
    }, 'groupsLock');

    // ── PHASE 8 — Response dispatch ────────────────────────────────────────

    if (outcome?.conflict === 'group_not_found') {
        return res.status(404).json({
            error:   GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND,
            message: 'Grupo no encontrado',
        });
    }

    if (outcome?.conflict === 'mixed_legacy_state') {
        log(`POST /api/groups/${groupId}/members/materialize-fallback BLOCKED mixed_legacy_state severity=${classification.mixedSeverity} reason=${classification.reasonCode}`, 'WARN');
        // En mixed_legacy_state, fallback NO es active path (explicit > 0 lo
        // disqualifica), así que fallbackVisibleUsers === 0. Pero los eligibles
        // existen históricamente — fallbackEligibleUsers === fallbackVisibleBefore.
        return res.status(422).json({
            error:                       'mixed_legacy_state',
            mixedSeverity:               classification.mixedSeverity,
            reasonCode:                  classification.reasonCode,
            message:                     classification.mixedSeverity === 'corrupted'
                ? 'El grupo contiene miembros explícitos de instituciones distintas + fallback eligible lectores. Estado corrupto — requiere intervención manual antes de materializar.'
                : 'El grupo coexiste con fallback eligible lectores. Los miembros explícitos son del mismo colegio — el estado es reconciliable, pero requiere decisión operacional explícita.',
            groupId,
            state:                       'mixed_legacy_state',
            explicitMembers:             classification.explicitCount,
            fallbackEligibleNotExplicit: classification.fallbackEligibleNotExplicit,
            fallbackVisibleUsers:        0,
            fallbackEligibleUsers:       fallbackVisibleBefore,
            crossSchoolExplicitCount:    classification.crossSchoolExplicitCount,
            recommendation:              'manual_resolution_required',
        });
    }

    if (outcome?.conflict === 'classifier_execution_divergence') {
        log(`POST /api/groups/${groupId}/members/materialize-fallback CLASSIFIER_DIVERGENCE classifierState=${outcome.classifierState} classifierEligibles=${outcome.classifierEligibles} resolverCount=${outcome.resolverCount}`, 'ERROR');
        // Audit dedicado del divergence — forensic P0. Indica drift entre
        // helpers usados por classifier vs resolver. State NO se persistió.
        writeAuditLog({
            action:       'membership.fallback_materialization_classifier_divergence',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details: {
                groupId,
                classifierState:     outcome.classifierState,
                classifierEligibles: outcome.classifierEligibles,
                resolverCount:       outcome.resolverCount,
            },
            metadata: {
                ..._truncateUserIdsForAudit([]),
                preMutationState:               outcome.classifierState,
                preMutationReasonCode:          'classifier_execution_divergence',
                fromGroupId:                    null,
                toGroupId:                      groupId,
                fromSchool:                     null,
                toSchool:                       groupMeta?.school || null,
                groupType:                      groupMeta?.type || null,
                organizationId:                 groupMeta?.organizationId || null,
                result:                         'classifier_execution_divergence',
                assignedCount:                  0,
                failedCount:                    0,
                failedReasons:                  { classifier_execution_divergence: 1 },
                fallbackAffected:               true,
                fallbackExtinguishedAttempted:  false,
                fallbackExtinguished:           false,
                fallbackVisibleBefore,
                fallbackEligibleBefore:         fallbackVisibleBefore,
                fallbackOverrideUsed:           false,
                explicitMembersBefore:          classification?.explicitCount ?? 0,
                explicitMembersAfter:           classification?.explicitCount ?? 0,
                materializationAttempted:       0,
                materializationObservedDelta:   0,
                materializationDelta:           0,
                invariantSatisfied:             false,
                classifierExecutionDivergence:  true,
            },
        });
        return res.status(409).json({
            error:               'classifier_execution_divergence',
            message:             'Inconsistencia interna: el classifier indicó que el grupo era materializable, pero el resolver no encontró users. Esto NO es estado válido — reportar a plataforma. State NO persistido.',
            classifierState:     outcome.classifierState,
            classifierEligibles: outcome.classifierEligibles,
            resolverCount:       outcome.resolverCount,
        });
    }

    if (outcome?.conflict === 'expected_count_mismatch') {
        log(`POST /api/groups/${groupId}/members/materialize-fallback 409 expected=${outcome.expectedCount} actual=${outcome.actualCount}`, 'WARN');
        return res.status(409).json({
            error:             'expected_count_mismatch',
            message:           'El conteo materializable real difiere del expectedCount provisto. Preview stale — re-ejecutar dryRun.',
            expectedCount:     outcome.expectedCount,
            actualCount:       outcome.actualCount,
            currentState:      classification.state,
            currentReasonCode: classification.reasonCode,
            recommendation:    'rerun_dryrun_and_confirm_preview',
        });
    }

    if (outcome?.conflict === 'invariant_breach') {
        log(`POST /api/groups/${groupId}/members/materialize-fallback INVARIANT_BREACH expected=${outcome.expected} actual=${outcome.explicitMembersAfter} attempted=${outcome.attempted}`, 'ERROR');
        // Audit dedicado del breach — forensic P0. NO emite fallbackStateTransition
        // (la transición fue abortada, no persistió). Captura attempted vs observed
        // para diagnosis posterior.
        writeAuditLog({
            action:       'membership.fallback_materialization_invariant_breach',
            targetUserId: null,
            actor:        req.headers['x-user-id'] || null,
            details: {
                groupId,
                explicitMembersBefore: outcome.explicitMembersBefore,
                explicitMembersAfter:  outcome.explicitMembersAfter,
                expected:              outcome.expected,
                attempted:             outcome.attempted,
                delta:                 outcome.explicitMembersAfter - outcome.explicitMembersBefore,
            },
            metadata: {
                ..._truncateUserIdsForAudit(materializableUserIds),
                preMutationState:               'fallback_dependent',
                preMutationReasonCode:          'single_school_implicit',
                fromGroupId:                    null,
                toGroupId:                      groupId,
                fromSchool:                     null,
                toSchool:                       groupMeta?.school || null,
                groupType:                      groupMeta?.type || null,
                organizationId:                 groupMeta?.organizationId || null,
                result:                         'invariant_breach',
                assignedCount:                  0,
                failedCount:                    outcome.attempted,
                failedReasons:                  { invariant_breach: outcome.attempted },
                fallbackAffected:               true,
                fallbackExtinguishedAttempted:  true,
                fallbackExtinguished:           false,                              // REAL outcome
                fallbackVisibleBefore,
                fallbackEligibleBefore:         fallbackVisibleBefore,              // semantic clarity
                fallbackOverrideUsed:           false,
                // sin fallbackStateTransition — abortada, no persistió
                explicitMembersBefore:          outcome.explicitMembersBefore,
                explicitMembersAfter:           outcome.explicitMembersAfter,
                materializationAttempted:       outcome.attempted,
                materializationObservedDelta:   outcome.explicitMembersAfter - outcome.explicitMembersBefore,
                materializationDelta:           outcome.attempted,                  // semantic intent
                invariantSatisfied:             false,
                invariantBreach:                true,
            },
        });
        return res.status(409).json({
            error:     'materialization_invariant_breach',
            invariant: 'explicit_after_equals_before_plus_attempted',
            message:   'La transición de membresía fue abortada antes de persistir: el estado post-mutation no satisface la invariante de integridad. Sin corrupción de datos. Re-ejecutar implica diagnosticar drift en helpers (addUserIdToGroup / addGroupIdToUser / normalizeGroup) o mutación concurrente.',
            expected:  outcome.expected,
            actual:    outcome.explicitMembersAfter,
            attempted: outcome.attempted,
        });
    }

    if (outcome?.noOp === true) {
        log(`POST /api/groups/${groupId}/members/materialize-fallback NOOP sub=${outcome.sub} state=${classification.state} reason=${classification.reasonCode}`, 'ACCESS');
        // Semantic distinction Commit 6 obs.1:
        //   fallbackVisibleUsers  = currently visible VIA fallback path
        //                           (0 cuando state !== 'fallback_dependent')
        //   fallbackEligibleUsers = total lectores con colegio matching
        //                           (histórico, independiente del path activo)
        const fallbackVisibleUsersNow = classification.state === 'fallback_dependent'
            ? fallbackVisibleBefore
            : 0;
        return res.json({
            groupId,
            noOp:                   true,
            state:                  classification.state,
            reasonCode:             classification.reasonCode,
            explicitMembersBefore:  classification.explicitCount,
            fallbackVisibleUsers:   fallbackVisibleUsersNow,
            fallbackEligibleUsers:  fallbackVisibleBefore,
            materialized:           { count: 0, sampleUserIds: [], truncated: false },
        });
    }

    if (outcome?.dryRun === true) {
        const sample = _truncateUserIdsForAudit(materializableUserIds);
        log(`POST /api/groups/${groupId}/members/materialize-fallback DRYRUN count=${materializableUserIds.length}`, 'ACCESS');
        // dryRun siempre opera sobre state='fallback_dependent' por construcción
        // (las demás ramas no llegan a este branch). fallbackVisibleUsers ===
        // fallbackEligibleUsers en este path porque fallback ES el active path
        // pre-mutation.
        return res.json({
            groupId,
            dryRun:                          true,
            noOp:                            false,
            state:                           classification.state,
            reasonCode:                      classification.reasonCode,
            fallbackVisibleUsers:            fallbackVisibleBefore,
            fallbackEligibleUsers:           fallbackVisibleBefore,
            explicitMembersBefore:           classification.explicitCount,
            explicitMembersAfterIfExecuted:  classification.explicitCount + materializableUserIds.length,
            materializable: {
                count:         materializableUserIds.length,
                sampleUserIds: sample.targetUserIdsSample,
                truncated:     sample.targetUserIdsTruncated,
            },
            groupMeta: {
                school:         groupMeta?.school || null,
                type:           groupMeta?.type || null,
                organizationId: groupMeta?.organizationId || null,
            },
            auditPreview: {
                action:                            'membership.fallback_materialized',
                fallbackStateTransition:           _createFallbackTransition('implicit', 'explicit'),
                materializationAttempted:          materializableUserIds.length,
                materializationDelta:              materializableUserIds.length,  // === attempted
                explicitMembersBefore:             classification.explicitCount,
                explicitMembersAfter:              classification.explicitCount + materializableUserIds.length,
                auditReferenceId:                  null,
                auditReferenceGeneratedOnExecute:  true,
            },
        });
    }

    // outcome.success === true
    const sample = _truncateUserIdsForAudit(materializableUserIds);
    log(`POST /api/groups/${groupId}/members/materialize-fallback SUCCESS materialized=${materializableUserIds.length} before=${explicitMembersBefore} after=${explicitMembersAfter}`, 'ACCESS');
    // Pre-mutation state era 'fallback_dependent', donde fallback ERA active path.
    // Post-mutation, fallback ya no es active path (group ahora explicit).
    // fallbackVisibleUsers refleja el pre-mutation visibility (cuántos eran
    // visibles VIA fallback antes del cambio).
    res.json({
        groupId,
        dryRun:                false,
        noOp:                  false,
        state:                 'fallback_dependent',
        reasonCode:            'single_school_implicit',
        fallbackVisibleUsers:  fallbackVisibleBefore,
        fallbackEligibleUsers: fallbackVisibleBefore,
        explicitMembersBefore,
        explicitMembersAfter,
        materialized: {
            count:         materializableUserIds.length,
            sampleUserIds: sample.targetUserIdsSample,
            truncated:     sample.targetUserIdsTruncated,
        },
        fallbackStateTransition: _createFallbackTransition('implicit', 'explicit'),
    });

    // ── PHASE 9 — Audit (post-response, fire-and-forget) ───────────────────
    //
    // fallbackExtinguished (Commit 6 obs.6):
    //   - true: state realmente transitó implicit → explicit (success path)
    //   - false: intento fallado (invariant_breach, classifier_divergence)
    // Distinto de fallbackExtinguishedAttempted (intent), captura REAL outcome.
    writeAuditLog({
        action:       'membership.fallback_materialized',
        targetUserId: materializableUserIds.length === 1 ? materializableUserIds[0] : null,
        actor:        req.headers['x-user-id'] || null,
        details: {
            groupId,
            materializedCount:     materializableUserIds.length,
            explicitMembersBefore,
            explicitMembersAfter,
        },
        metadata: {
            ..._truncateUserIdsForAudit(materializableUserIds),
            preMutationState:               'fallback_dependent',
            preMutationReasonCode:          'single_school_implicit',
            fromGroupId:                    null,
            toGroupId:                      groupId,
            fromSchool:                     null,
            toSchool:                       groupMeta?.school || null,
            groupType:                      groupMeta?.type || null,
            organizationId:                 groupMeta?.organizationId || null,
            result:                         'success',
            assignedCount:                  materializableUserIds.length,
            failedCount:                    0,
            failedReasons:                  {},
            fallbackAffected:               true,
            fallbackExtinguishedAttempted:  true,
            fallbackExtinguished:           true,                              // REAL outcome
            fallbackVisibleBefore,
            fallbackEligibleBefore:         fallbackVisibleBefore,             // semantic clarity
            fallbackOverrideUsed:           false,
            fallbackStateTransition:        _createFallbackTransition('implicit', 'explicit'),
            explicitMembersBefore,
            explicitMembersAfter,
            materializationAttempted:       materializableUserIds.length,
            materializationObservedDelta:   explicitMembersAfter - explicitMembersBefore,
            materializationDelta:           materializableUserIds.length,      // semantic intent
            invariantSatisfied:             true,
        },
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 022 Fase A — endpoint de integridad de membresías.
//
// GET /api/admin/membership/validate
//
// Termómetro READ-ONLY del estado bidireccional user.groupIds ↔
// group.studentIds/memberIds. Invoca el validador puro
// `validateMembershipIntegrity` ya disponible en utils/groupMembership.mjs y
// devuelve la lista de issues + counts agregados.
//
// Diseñado para tres usos:
//   1. Pre-deploy: ejecutar contra el data/ del VPS antes de pm2 restart.
//      Si issues.length > 0, NO desplegar — limpiar primero.
//   2. Post-deploy: confirmar que el restart no introdujo regresión.
//   3. Auditoría continua: panel admin puede polletear este endpoint para
//      detectar drift cross-actor en producción.
//
// NO MUTA NADA. Es lectura pura. El response incluye `ok: true` cuando no
// hay issues — facilita parsear con jq / scripts de CI.
//
// Auth: requireAdminAccess — coherente con los demás endpoints administrativos
// del sprint. Lectores normales NO necesitan ver este detalle interno.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/admin/membership/validate', requireAdminAccess, (req, res) => {
    const actor = req.headers['x-user-id'] || 'unknown';
    log(`[MEMBERSHIP_VALIDATE_START] actor=${actor}`, 'INFO');
    try {
        const users  = readJSON(USERS_DB)  || [];
        const groups = readJSON(GROUPS_DB) || [];
        const result = validateMembershipIntegrity(users, groups);
        const ok = result.issues.length === 0;
        log(`[MEMBERSHIP_VALIDATE_RESULT] actor=${actor} ok=${ok} totalIssues=${result.issues.length} counts=${JSON.stringify(result.counts)}`, ok ? 'ACCESS' : 'WARN');
        res.json({
            ok,
            issues: result.issues,
            counts: result.counts,
        });
    } catch (e) {
        log(`[MEMBERSHIP_VALIDATE_ERROR] actor=${actor} error=${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Internal Server Error', message: 'No se pudo ejecutar la validación de integridad.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// parseTsRobust — defensive timestamp parser para audit ordering.
//
// Sprint MGL M2.1a — antes el endpoint MGL comparaba timestamps via
// string compare (`a > b`). Eso funciona para ISO 8601 canónico, pero
// rompe ante formatos legacy / milisegundos inconsistentes / malformed.
// Devolvemos -Infinity para malformed → se descartan en max selection.
// ─────────────────────────────────────────────────────────────────────────────
function parseTsRobust(value) {
    if (typeof value !== 'string' || value.length === 0) return -Infinity;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : -Infinity;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint MGL Fase 1 / M2 — Membership Governance Snapshot
//
// GET /api/membership-governance/groups
//
// Snapshot operacional read-only del estado de memberships de Chibalete+.
// NO muta nada. NO repara nada. NO materializa nada. Solo observa y clasifica.
//
// Auth: requireAdminAccess (operación con alcance institucional).
//
// Query params:
//   ?school=<name>           — filtra al subset de esa escuela (normalizado)
//   ?state=<csv>             — filtra por state(s); CSV con valores oficiales
//   ?includeAudit=true       — hidrata lastAuditEvent por grupo (LAZY: si no
//                              es 'true' literal, NO se lee USER_AUDIT_DB)
//
// Response shape (M2):
//   {
//     snapshotVersion: 1,
//     generatedAt: ISO 8601,
//     totalGroups: number,                       — pre-filter (universo total)
//     counts: { fully_explicit, fallback_dependent, mixed_legacy_state, empty_inert },
//     groups: [{
//       id, name, type, school, organizationId,
//       state, reasonCode, mixedSeverity, isSingleSchool,
//       operationalRisk, governanceStatus,
//       explicitMembers, fallbackVisibleUsers, fallbackEligibleUsers,
//       fallbackEligibleNotExplicit, crossSchoolExplicitCount, totalVisibleUsers,
//       explicitCoverage,                        — float preciso, NO redondeado
//       fallbackExtinguished,
//       materializationReadiness: { ready, blocked, blockedReason },
//       transitionCapabilities: { canMaterialize, canRepairAutomatically, requiresManualResolution },
//       diagnosisSummary: { healthStatus, inconsistenciesCount, warningsCount },
//       lastAuditEvent: null | { ts, action, actor, auditReferenceId },
//     }]
//   }
//
// Sort: corrupted → recoverable → fallback_dependent → fully_explicit → empty_inert,
// alfabético dentro de cada bucket.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/membership-governance/groups', requireAdminAccess, (req, res) => {
    const actor = req.headers['x-user-id'] || 'unknown';
    log(`[MGL_SNAPSHOT_REQUEST] actor=${actor} school=${req.query.school || ''} state=${req.query.state || ''} includeAudit=${req.query.includeAudit || ''}`, 'INFO');

    try {
        const users  = readJSON(USERS_DB)  || [];
        const groups = readJSON(GROUPS_DB) || [];

        // Indexes precomputados — userById se reusa por TODOS los classifier calls.
        const indexes = buildGovernanceIndexes(users, groups);

        // ── PARSE FILTERS ──────────────────────────────────────────────────────
        const schoolFilter = typeof req.query.school === 'string'
            ? normalizeSchoolKey(req.query.school)
            : null;
        const stateFilterRaw = typeof req.query.state === 'string' ? req.query.state.trim() : '';
        const stateFilter = stateFilterRaw.length > 0
            ? new Set(stateFilterRaw.split(',').map(s => s.trim()).filter(Boolean))
            : null;
        const includeAudit = req.query.includeAudit === 'true';   // LAZY: estricto

        // ── LAZY AUDIT HYDRATION ───────────────────────────────────────────────
        // Solo leer USER_AUDIT_DB si includeAudit === true literal.
        // Index audit por groupId con timestamp más reciente.
        //
        // Sprint MGL M2.1a — comparación de timestamps via Date.parse(),
        // NO string compare. Razones:
        //   - ISO 8601 lexicográfico funciona en el camino feliz, pero rompe
        //     ante: milisegundos faltantes ('Z' vs '.000Z'), timezones legacy
        //     ('+00:00' vs 'Z'), formatos pre-ISO en logs antiguos, o
        //     malformed timestamps (string vacío, garbage).
        //   - Date.parse devuelve NaN para malformed → tratamos como -Infinity
        //     y se descartan en el max selection; nunca corruptan ordering.
        //   - El parsed timestamp se cachea junto con el entry para evitar
        //     re-parsear M veces durante el max-selection loop.
        let auditByGroupId = null;
        if (includeAudit) {
            try {
                const auditEntries = readJSON(USER_AUDIT_DB) || [];
                auditByGroupId = new Map();   // gid → { entry, tsNum }
                for (const e of auditEntries) {
                    const gid = e?.details?.groupId;
                    if (typeof gid !== 'string' || gid.length === 0) continue;
                    const tsNum = parseTsRobust(e?.timestamp);
                    if (tsNum === -Infinity) continue;   // malformed: skip
                    const prev = auditByGroupId.get(gid);
                    if (!prev || tsNum > prev.tsNum) {
                        auditByGroupId.set(gid, { entry: e, tsNum });
                    }
                }
            } catch (e) {
                // Audit ilegible NO debe romper el snapshot. Loguear y continuar.
                log(`[MGL_AUDIT_READ_FAIL] error=${e.message}`, 'WARN');
                auditByGroupId = new Map();
            }
        }

        // ── PRE-FILTER por school ──────────────────────────────────────────────
        const groupsToClassify = schoolFilter
            ? groups.filter(g => normalizeSchoolKey(g?.school) === schoolFilter)
            : groups;

        // ── BUILD ROWS ─────────────────────────────────────────────────────────
        // Counts globales: sobre TODOS los groups (no afectados por filter).
        const counts = {
            fully_explicit:     0,
            fallback_dependent: 0,
            mixed_legacy_state: 0,
            empty_inert:        0,
        };

        // Primero clasificamos TODOS los grupos (para counts globales correctos).
        // Luego filtramos por state si aplica.
        const classifiedAll = groups.map(g => {
            const c = detectGroupMaterializationState(g, users, groups, indexes.userById);
            counts[c.state] = (counts[c.state] || 0) + 1;
            return { group: g, classification: c };
        });

        // Subset que entra al response (post school filter + state filter).
        const groupSet = schoolFilter
            ? new Set(groupsToClassify.map(g => g.id))
            : null;

        const rows = [];
        for (const { group, classification } of classifiedAll) {
            if (groupSet && !groupSet.has(group.id)) continue;
            if (stateFilter && !stateFilter.has(classification.state)) continue;

            const {
                state, reasonCode, mixedSeverity, isSingleSchool,
                explicitCount, fallbackEligibleNotExplicit, crossSchoolExplicitCount,
            } = classification;

            // fallbackEligibleUsers — universo total fallback-matched (no excluye explicit).
            // Ya lo computa applyLegacyColegioFallback en su `matched`.
            const fbAll = applyLegacyColegioFallback(group, users, groups);
            const fallbackEligibleUsers = fbAll.matched.size;

            // fallbackVisibleUsers — active path: sólo si state habilita fallback como path.
            //   - fallback_dependent: sí; fallback es el active path.
            //   - mixed_legacy_state: NO; explicit > 0 disqualifica fallback como path.
            //   - fully_explicit, empty_inert: NO.
            const fallbackVisibleUsers = state === 'fallback_dependent'
                ? countFallbackVisibleLectors(group, users)
                : 0;

            const totalVisibleUsers = explicitCount + fallbackVisibleUsers;

            const explicitCoverage = computeExplicitCoverage(explicitCount, fallbackEligibleNotExplicit);

            const diagnosis = buildGroupDiagnosis(group, users, groups);

            const auditEntry = (includeAudit && auditByGroupId.has(group.id))
                ? auditByGroupId.get(group.id).entry
                : null;

            rows.push({
                id:             group.id,
                name:           typeof group.name === 'string' ? group.name : group.id,
                type:           group.type === 'club' ? 'club' : 'course',
                school:         typeof group.school === 'string' ? group.school : null,
                organizationId: typeof group.organizationId === 'string' ? group.organizationId : null,

                state,
                reasonCode,
                mixedSeverity,
                isSingleSchool,

                operationalRisk:    deriveOperationalRisk(state, mixedSeverity),
                governanceStatus:   deriveGovernanceStatus(state, mixedSeverity),

                explicitMembers:             explicitCount,
                fallbackVisibleUsers,
                fallbackEligibleUsers,
                fallbackEligibleNotExplicit,
                crossSchoolExplicitCount,
                totalVisibleUsers,

                explicitCoverage,
                fallbackExtinguished:    deriveFallbackExtinguished(state),

                materializationReadiness: deriveMaterializationReadiness(state, reasonCode),
                transitionCapabilities:   deriveTransitionCapabilities(state, mixedSeverity),

                diagnosisSummary: {
                    healthStatus:        diagnosis.healthStatus,
                    inconsistenciesCount: Array.isArray(diagnosis.inconsistencies) ? diagnosis.inconsistencies.length : 0,
                    warningsCount:        Array.isArray(diagnosis.warnings) ? diagnosis.warnings.length : 0,
                },

                lastAuditEvent: auditEntry ? {
                    ts:                auditEntry.timestamp,
                    action:            auditEntry.action,
                    actor:             auditEntry.actor || null,
                    auditReferenceId:  auditEntry.auditReferenceId || null,
                } : null,
            });
        }

        // ── SORT operacional risk-first, alfabético dentro de bucket ───────────
        rows.sort(comparePriority);

        log(`[MGL_SNAPSHOT_OK] actor=${actor} totalGroups=${groups.length} returned=${rows.length} counts=${JSON.stringify(counts)}`, 'ACCESS');

        res.json({
            snapshotVersion: SNAPSHOT_VERSION,
            generatedAt:     new Date().toISOString(),
            totalGroups:     groups.length,
            counts,
            groups:          rows,
        });
    } catch (e) {
        log(`[MGL_SNAPSHOT_ERROR] actor=${actor} error=${e.message}`, 'ERROR');
        res.status(500).json({
            error:   'Internal Server Error',
            message: 'No se pudo generar el snapshot de governance.',
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint visibilidad — capa narrativa: el sistema explicándose a sí mismo.
//
// GET /api/groups/:id/diagnosis
//
// Devuelve el estado del grupo en lenguaje interpretable, listo para que la UI
// (Aula Viva explicativa, panel del estudiante, futura integración con Modo
// Accesible) muestre los mensajes tal cual sin re-interpretar.
//
// La respuesta es un GroupDiagnosis (ver utils/groupDiagnosis.d.ts):
// healthStatus OK | WARNING | ERROR, conteos por canal de membresía,
// inconsistencias e inconsistencias con message + cause + recommendedAction
// ya redactados, y un summary.headline de una sola frase para cabeceras.
//
// Toda la lógica de membresía pasa por la fuente única (getGroupMembers,
// getExplicitGroupMembers, applyLegacyColegioFallback) — este endpoint solo
// orquesta lectura + helper. requireAuth (mediadores y admins).
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/groups/:id/diagnosis', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const groups = readJSON(GROUPS_DB) || [];
        const users  = readJSON(USERS_DB)  || [];

        const group = groups.find(g => g?.id === id);
        if (!group) {
            return res.status(404).json({
                error:        GROUP_MEMBERSHIP_ERR.GROUP_NOT_FOUND,
                healthStatus: 'ERROR',
                summary: {
                    headline: 'Grupo no encontrado.',
                    tone:     'error',
                },
            });
        }

        const diagnosis = buildGroupDiagnosis(group, users, groups);
        res.json(diagnosis);
    } catch (e) {
        log(`GET /api/groups/${req.params.id}/diagnosis error: ${e.message}`, 'ERROR');
        res.status(500).json({
            error:        'Internal Server Error',
            healthStatus: 'ERROR',
            summary: {
                headline: 'No se pudo obtener el diagnóstico del grupo.',
                tone:     'error',
            },
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint Panel del estudiante — capa narrativa por lector.
//
// GET /api/students/:id/status
//
// Devuelve el estado del estudiante en lenguaje listo-para-UI (mismo patrón
// que /api/groups/:id/diagnosis). El frontend renderiza message/cause/
// recommendedAction directamente sin re-interpretar.
//
// Inputs que arma el endpoint:
//   metrics.inAnyGroup        ← getGroupMembers sobre cada grupo
//   metrics.hasContentAccess  ← accessService.getAccessibleContentIds()
//   metrics.lastReadingEventAt, .booksStarted, .booksCompleted, .progressPercentage
//                              ← getProgressByUser()
//   logs.lastLoginAt          ← user.lastLoginAt (campo opcional; null si no existe)
//   logs.recentErrorsCount    ← 0 hoy (no hay log per-user de errores)
//
// La lógica de transición de estado vive en utils/studentStatus.mjs (fuente
// única). Este endpoint solo orquesta lectura + helper.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/students/:id/status', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const users  = readJSON(USERS_DB)  || [];
        const groups = readJSON(GROUPS_DB) || [];

        const user = users.find(u => u?.id === id);
        if (!user) {
            // Sentinel: shape mínimo compatible con StudentStatus para que la UI
            // pueda mostrar SIEMPRE algo. Tono ERROR.
            return res.status(404).json({
                userId:             id,
                name:               'Estudiante',
                state:              'TECH_ISSUE',
                tone:               'error',
                headline:           'No se encontró el estudiante.',
                message:            'No existe un estudiante con ese identificador.',
                cause:              'El identificador es inválido o el estudiante fue eliminado.',
                recommendedAction:  'Verificar el identificador o pedir apoyo al equipo técnico.',
                lastLoginAt:        null,
                lastReadingEventAt: null,
                progress:           { booksStarted: 0, booksCompleted: 0, percentage: 0 },
            });
        }

        // ── inAnyGroup: usa fuente única getGroupMembers (incluye fallback colegio)
        const inAnyGroup = groups.some(g =>
            getGroupMembers(g, users, { allGroups: groups, warnFn: () => {} }).includes(id)
        );

        // ── hasContentAccess: solo se evalúa si el user tiene grupo (sino NO_GROUP gana).
        //    Si accessService devuelve 0 títulos y 0 colecciones, no hay contenido habilitado.
        let hasContentAccess; // undefined = no calculado
        if (inAnyGroup) {
            try {
                const access = getAccessibleContentIds(id) || {};
                const titlesOk      = Array.isArray(access.titleIds)      && access.titleIds.length      > 0;
                const collectionsOk = Array.isArray(access.collectionIds) && access.collectionIds.length > 0;
                const broadAccess   = access.titleIds === 'all' || access.hasBroadAccess === true;
                hasContentAccess = broadAccess || titlesOk || collectionsOk;
            } catch (_) {
                // Si el accessService falla, dejamos hasContentAccess undefined
                // — el helper no activa NO_ACCESS y la UI no inventa estado.
            }
        }

        // ── progress: agregamos sobre las entries del user.
        const progressList = getProgressByUser(id) || [];
        const booksStarted   = progressList.length;
        const booksCompleted = progressList.filter(p =>
            (p?.canonicalProgress?.globalPercentage ?? p?.porcentaje ?? 0) >= 90 || p?.isCompleted === true
        ).length;
        const progressPercentage = booksStarted === 0 ? 0 : Math.round(
            progressList.reduce((acc, p) =>
                acc + (p?.canonicalProgress?.globalPercentage ?? p?.porcentaje ?? 0), 0) / booksStarted
        );
        // lastReadingEventAt: el updatedAt más reciente de cualquier progreso
        const lastReadingEventAt = progressList.reduce((latest, p) => {
            const ts = p?.updatedAt || p?.fecha_actualizacion || null;
            if (!ts) return latest;
            if (!latest) return ts;
            return new Date(ts) > new Date(latest) ? ts : latest;
        }, null);

        const metrics = {
            inAnyGroup,
            hasContentAccess,
            lastReadingEventAt,
            booksStarted,
            booksCompleted,
            progressPercentage,
        };
        const logs = {
            lastLoginAt:       typeof user.lastLoginAt === 'string' ? user.lastLoginAt : null,
            recentErrorsCount: 0, // No hay log per-user de errores hoy. TECH_ISSUE preparado para integración futura.
        };

        const status = buildStudentStatus(user, metrics, logs);
        res.json(status);
    } catch (e) {
        log(`GET /api/students/${req.params.id}/status error: ${e.message}`, 'ERROR');
        res.status(500).json({
            userId:             req.params.id,
            name:               'Estudiante',
            state:              'TECH_ISSUE',
            tone:               'error',
            headline:           'No se pudo obtener el estado del estudiante.',
            message:            'Ocurrió un error inesperado al consultar el estado.',
            cause:              'El sistema encontró un problema interno al armar la respuesta.',
            recommendedAction:  'Reintentar en unos momentos; si persiste, contactar al equipo técnico.',
            lastLoginAt:        null,
            lastReadingEventAt: null,
            progress:           { booksStarted: 0, booksCompleted: 0, percentage: 0 },
        });
    }
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

app.post('/api/sections', requireAuth, async (req, res) => {
    const newSection = req.body;
    if (!newSection.id) newSection.id = `section-${Date.now()}`;

    await mutateSections((sections) => {
        sections.push(newSection);
        writeJSON(SECTIONS_DB, sections);
    });
    res.json(newSection);
});

app.put('/api/sections/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    let updated = null;
    const conflict = await mutateSections((sections) => {
        const index = sections.findIndex(s => s.id === id);
        if (index === -1) return { conflict: 'not_found' };
        sections[index] = { ...sections[index], ...updates };
        updated = sections[index];
        writeJSON(SECTIONS_DB, sections);
        return null;
    });
    if (conflict) return res.status(404).json({ error: 'Section not found' });
    res.json(updated);
});

app.delete('/api/sections/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const conflict = await mutateSections((sections) => {
        const index = sections.findIndex(s => s.id === id);
        if (index === -1) return { conflict: 'not_found' };
        sections.splice(index, 1);
        writeJSON(SECTIONS_DB, sections);
        return null;
    });
    if (conflict) return res.status(404).json({ error: 'Section not found' });
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

app.post('/api/schools/:name/config', requireAdminAccess, async (req, res) => {
    const { name } = req.params;
    const newConfig = req.body; // Expect { hiddenContentIds: [...] }

    const updatedConfig = {
        schoolName: name,
        hiddenContentIds: newConfig.hiddenContentIds || []
    };

    await mutateSchoolConfigs((configs) => {
        const index = configs.findIndex(c => c.schoolName === name);
        if (index >= 0) {
            configs[index] = updatedConfig;
        } else {
            configs.push(updatedConfig);
        }
        writeJSON(SCHOOL_CONFIGS_DB, configs);
    });
    res.json(updatedConfig);
});

// RETRY/REPAIR ROUTE (Must be before static catch-all)
// requireAdminRole aplicado vía app.use('/api/content', requireAdminRole).
// requireAuth (x-admin-secret) fue removido: el frontend envía x-user-id, no el secret.
app.post('/api/content/:id/retry', async (req, res) => {
    const { id } = req.params;
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    log(`[RETRY_START] contentId=${id} actor=${actorId}`, 'INFO');

    try {
        const contentList = readJSON(DB_FILE);
        const index = contentList.findIndex(c => c.id === id);

        if (index === -1) return res.status(404).json({ error: 'Content not found' });

        const content = contentList[index];
        if (!content.texto_plano_url) return res.status(400).json({ error: 'No text file linked' });

        // Guard: evitar encolar un segundo job si ya hay uno en curso.
        // ttsStatus='generando' significa que el queue ya tiene un job activo.
        if (content.ttsStatus === 'generando') {
            log(`[RETRY_FAIL] contentId=${id} reason=already_running actor=${actorId}`, 'WARN');
            return res.status(409).json({ error: 'Ya hay un proceso de generación de audio en curso para este contenido. Espera a que termine.' });
        }

        // Reset Status (atomic cross-container lock)
        await withFileLock(DB_FILE, () => {
            const freshList = readJSON(DB_FILE);
            const freshIdx = freshList.findIndex(c => c.id === id);
            if (freshIdx !== -1) {
                freshList[freshIdx].status = 'disponible';
                freshList[freshIdx].ttsStatus = 'generando';
                freshList[freshIdx].processingStatus = {
                    percentage: 0, currentSentence: 0, totalSentences: 0,
                    status: 'processing', lastUpdated: new Date().toISOString()
                };
                writeJSON(DB_FILE, freshList);
            }
        }, 'contentLock');

        // Async Trigger
        const relativePath = content.texto_plano_url.replace(/^\/uploads\//, '');
        const textFullPath = path.join(UPLOAD_DIR, relativePath);

        ttsQueue.enqueue(content.id, () => generateAudioForContent(content.id, textFullPath, UPLOAD_DIR, (progress) => {
            (async () => {
                try {
                    await withFileLock(DB_FILE, () => {
                        const currentList = readJSON(DB_FILE);
                        const idx = currentList.findIndex(c => c.id === id);
                        if (idx !== -1) {
                            currentList[idx].processingStatus = progress;
                            if (progress.status === 'completed') currentList[idx].ttsStatus = 'listo';
                            if (progress.status === 'failed' || progress.status === 'error_proveedor') currentList[idx].ttsStatus = 'error_proveedor';
                            if (progress.status === 'processing') currentList[idx].ttsStatus = 'generando';
                            writeJSON(DB_FILE, currentList);
                        }
                    }, 'contentLock');
                } catch (e) { /* ignore */ }
            })();
        }))
            .then(r => {
                if (r.abortedByProvider) log(`[RETRY_FAIL] contentId=${id} reason=provider_abort`, 'WARN');
                else if (r.success) log(`[RETRY_SUCCESS] contentId=${id}`, 'INFO');
                else log(`[RETRY_FAIL] contentId=${id} success=false`, 'WARN');
            })
            .catch(e => log(`[RETRY_FAIL] contentId=${id} error=${e?.message || String(e)}`, 'ERROR'));

        res.json({ success: true, content });

    } catch (e) {
        log(`[RETRY_FAIL] contentId=${id} error=${e?.message}`, 'ERROR');
        res.status(500).json({ error: e.message });
    }
});

// --- TTS GLOBAL SEMAPHORE — max 12 concurrent AI calls ---
const _ttsSemaphore = (() => {
    let active = 0;
    const MAX_CONCURRENT = 12;
    const queue = [];
    return {
        acquire() {
            return new Promise(resolve => {
                if (active < MAX_CONCURRENT) { active++; resolve(); }
                else queue.push(resolve);
            });
        },
        release() {
            const next = queue.shift();
            if (next) { next(); } else { active--; }
        },
        get queueDepth() { return queue.length; },
        get activeCount() { return active; },
    };
})();

// --- TTS ON-DEMAND (Sprint 1 — Security) ---
// Centraliza la generación de audio en el backend.
// El frontend nunca llama a proveedores de IA directamente.
app.post('/api/tts', requireUserAuth, ttsUserLimiter, async (req, res) => {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'text requerido y no puede estar vacío' });
    }

    // Respetar el límite de tokens del engine para TTS (2000 chars)
    const trimmed = text.trim().substring(0, 2000);

    const userId = req.headers['x-user-id'];

    if (_ttsSemaphore.queueDepth >= 50) {
        return res.status(503).json({ error: 'TTS temporalmente no disponible' });
    }

    await _ttsSemaphore.acquire();
    try {
        log(`[TTS] on-demand request userId=${userId} chars=${trimmed.length} active=${_ttsSemaphore.activeCount}`);
        // HF4B-1 — cache persistente en disco antes de tocar cualquier provider.
        // Contrato binario INTACTO: devuelve los bytes de audio, no una URL.
        const result = await getOrGenerateImmersiveAudio(trimmed);
        // Solo contabilizar generaciones reales (cache miss), igual que /api/album/tts.
        if (!result.cached) recordTtsUsage(userId, trimmed.length, 'tts');

        // M-4.3.2 — usar el mimeType honesto que devolvió el engine:
        //   OpenAI → 'audio/mpeg' (MP3 real)
        //   Gemini → 'audio/wav'  (PCM L16 wrappeado en RIFF por aiEngine)
        //   mock   → 'audio/wav'  (silent WAV)
        // Default 'audio/mpeg' por backward compat si el engine no declara.
        const audioMime = (typeof result.mimeType === 'string' && result.mimeType.length > 0)
            ? result.mimeType
            : 'audio/mpeg';
        res.set('Content-Type', audioMime);
        res.set('Cache-Control', 'public, max-age=3600'); // 1h — mismo texto = mismo audio
        res.set('X-Audio-Provider', result.provider);    // 'openai' | 'gemini' — para normalización de volumen en frontend
        res.set('X-TTS-Cache', result.cached ? 'HIT' : 'MISS'); // HF4B-1 — diagnóstico no disruptivo
        res.send(result.buffer);
    } catch (err) {
        log(`[TTS] on-demand error userId=${userId}: ${err.message}`, 'ERROR');
        // 503 — el cliente debe degradar a texto sin audio, no bloquear
        res.status(503).json({ error: 'TTS temporalmente no disponible' });
    } finally {
        _ttsSemaphore.release();
    }
});

// ---------------------------------------------------------------------------
// POST /api/album/tts
// TTS con cache persistente en disco para libro álbum.
//
// Input:  { text: string, contentId?: string }
// Output: { url: string | null, provider: string }
//   provider: 'openai' | 'gemini' — usado por frontend para normalización de volumen.
//   url es ruta estática — el frontend la asigna directamente a audio.src.
// ---------------------------------------------------------------------------
app.post('/api/album/tts', requireUserAuth, albumTtsUserLimiter, async (req, res) => {
    const { text, contentId } = req.body ?? {};

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'text requerido' });
    }

    const trimmed = text.trim().substring(0, 500);
    const userId  = req.headers['x-user-id'];

    try {
        const { url, provider, cached } = await getOrGenerateAlbumRegionAudio(contentId ?? 'global', trimmed);
        if (!cached) recordTtsUsage(userId, trimmed.length, 'album_tts'); // solo contabilizar generaciones reales
        res.json({ url, provider });
    } catch (err) {
        log(`[ALBUM_TTS] userId=${userId} error: ${err.message}`, 'ERROR');
        res.json({ url: null, provider: 'openai' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/gemini/analizar-ilustracion
// Proxy seguro para análisis de ilustraciones de libro álbum con Gemini multimodal.
// Reemplaza la llamada directa desde SubirContenido.tsx — VITE_GEMINI_API_KEY
// ya no necesita estar en el bundle del frontend para esta feature.
//
// Input:  { base64: string, mimeType: string }  (imagen como base64, max ~10MB)
// Output: { regions: AlbumRegion[] }
// Auth:   requireAdminAccess — solo administradores pueden analizar ilustraciones.
// ---------------------------------------------------------------------------
app.post('/api/gemini/analizar-ilustracion', requireAdminAccess, async (req, res) => {
    const { base64, mimeType } = req.body ?? {};

    if (!base64 || typeof base64 !== 'string') {
        return res.status(400).json({ error: 'base64 de imagen requerido' });
    }
    if (base64.length > 14_000_000) { // ~10MB decoded
        return res.status(413).json({ error: 'Imagen demasiado grande (máx ~10MB)' });
    }
    const safeMime = typeof mimeType === 'string' && mimeType.startsWith('image/')
        ? mimeType
        : 'image/jpeg';

    const gemini = getGemini();
    if (!gemini) {
        return res.status(503).json({ error: 'Gemini no disponible (GEMINI_API_KEY ausente en servidor)' });
    }

    const prompt = `Eres un asistente pedagógico que analiza ilustraciones de libros álbum infantiles para una plataforma de lectura mediada.

TAREA: Identifica entre 3 y 6 regiones visualmente distintas y narrativamente significativas en esta imagen.

REGLAS DE SALIDA:
- Devuelve ÚNICAMENTE JSON válido. Sin markdown, sin explicaciones.
- Entre 3 y 6 regiones. Nunca más de 6.
- Cada región debe corresponder a un elemento claramente visible.
- NO inventes elementos ausentes.

COORDENADAS: x, y = extremo superior izquierdo en % (0–100). width, height en %. Mínimo 10×10. Máximo 60×60.

PRIORIDAD: 1. Personaje(s) principal(es). 2. Acción central. 3. Objetos con carga emocional. 4. Elementos de fondo narrativos.

CAMPOS por región:
- text: descripción narrativa breve en español (máx 2 oraciones)
- type: "focus" (estándar) | "challenge" (elemento ambiguo u oculto)
- pedagogicalObjective: "literal" | "inferential" | "reflective" | "writing"
- leoHint: oración interna para IA (opcional, nunca visible al estudiante)
- x, y, width, height: números

Devuelve: {"regions": [...]}`;

    try {
        const response = await gemini.models.generateContent({
            // CHP-AI-RUNTIME-MODEL-COMPAT-01A — modelo central; ver aiEngine.js.
            model: GEMINI_TEXT_MODEL,
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: safeMime, data: base64 } },
                    { text: prompt },
                ],
            }],
            config: { responseMimeType: 'application/json' },
        });

        let parsed;
        try { parsed = JSON.parse(response.text ?? '{}'); } catch { parsed = {}; }

        const raw = Array.isArray(parsed?.regions) ? parsed.regions : [];
        const VALID_TYPES = new Set(['focus', 'challenge', 'contemplative', 'audio', 'nav']);
        const VALID_OBJ   = new Set(['literal', 'inferential', 'reflective', 'writing']);

        const regions = raw
            .filter(r => r && typeof r.text === 'string' &&
                         typeof r.x === 'number' && typeof r.y === 'number' &&
                         typeof r.width === 'number' && typeof r.height === 'number')
            .slice(0, 6)
            .map(r => ({
                text:                 r.text.substring(0, 300),
                type:                 VALID_TYPES.has(r.type) ? r.type : 'focus',
                x:                    Math.max(0, Math.min(100, r.x)),
                y:                    Math.max(0, Math.min(100, r.y)),
                width:                Math.max(1, Math.min(100, r.width)),
                height:               Math.max(1, Math.min(100, r.height)),
                pedagogicalObjective: VALID_OBJ.has(r.pedagogicalObjective) ? r.pedagogicalObjective : 'literal',
                ...(r.leoHint ? { leoHint: String(r.leoHint).substring(0, 200) } : {}),
            }));

        log(`[GEMINI_PROXY] analizar-ilustracion → ${regions.length} regiones`);
        res.json({ regions });
    } catch (err) {
        log(`[GEMINI_PROXY] analizar-ilustracion error: ${err.message}`, 'ERROR');
        res.status(502).json({ error: 'El modelo no pudo analizar la imagen.' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/gemini/sugerir-etiquetas
// Proxy seguro para sugerencia de etiquetas THEMA con Gemini.
// Reemplaza la llamada directa desde SubirContenido.tsx.
//
// Input:  { titulo: string, descripcion: string }
// Output: { tags: string[] }
// Auth:   requireAdminAccess
// ---------------------------------------------------------------------------
app.post('/api/gemini/sugerir-etiquetas', requireAdminAccess, async (req, res) => {
    const { titulo, descripcion } = req.body ?? {};

    if (!titulo || typeof titulo !== 'string') {
        return res.status(400).json({ error: 'titulo requerido' });
    }

    const gemini = getGemini();
    if (!gemini) {
        return res.status(503).json({ error: 'Gemini no disponible (GEMINI_API_KEY ausente en servidor)' });
    }

    const safeTitle = String(titulo).substring(0, 200);
    const safeDesc  = String(descripcion ?? '').substring(0, 500);

    try {
        const response = await gemini.models.generateContent({
            // CHP-AI-RUNTIME-MODEL-COMPAT-01A — modelo central; ver aiEngine.js.
            model: GEMINI_TEXT_MODEL,
            contents: `Analiza el siguiente libro y sugiere exactamente 4 etiquetas de clasificación (estilo THEMA simplificado para escuela).

Título: ${safeTitle}
Descripción: ${safeDesc}

Las etiquetas deben cubrir:
1. Tema Principal (ej. "Aventura", "Ciencia")
2. Género/Formato (ej. "Novela Gráfica", "Documental")
3. Público/Edad (ej. "Infantil", "Juvenil")
4. Un valor o tema transversal (ej. "Amistad", "Ecología")

Devuelve SOLO las 4 palabras o frases cortas separadas por comas.`,
        });

        const text = response.text ?? '';
        const tags = text.split(',').map(t => t.trim()).filter(Boolean).slice(0, 6);
        res.json({ tags });
    } catch (err) {
        log(`[GEMINI_PROXY] sugerir-etiquetas error: ${err.message}`, 'ERROR');
        res.status(502).json({ error: 'No se pudieron generar etiquetas.' });
    }
});

// ---------------------------------------------------------------------------
// ADMIN — TTS OBSERVABILITY & CACHE MANAGEMENT
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/tts/stats
 * Devuelve métricas de consumo de TTS por usuario desde el último reinicio.
 * Útil para detectar abuso, planificar capacidad y revisar costos.
 *
 * Output: { updatedAt, totalUsers, totalReqs, totalChars, users: [...] }
 * Auth: requireAdminAccess
 */
app.get('/api/admin/tts/stats', requireAdminAccess, (req, res) => {
    const users = [];
    let totalReqs  = 0;
    let totalChars = 0;

    _ttsUsage.forEach((data, userId) => {
        totalReqs  += data.reqs;
        totalChars += data.chars;
        users.push({ userId, ...data });
    });

    // Ordenar por mayor consumo primero
    users.sort((a, b) => b.chars - a.chars);

    res.json({
        updatedAt:  new Date().toISOString(),
        note:       'Datos desde el último reinicio del servidor. No persisten entre reinicios.',
        totalUsers: _ttsUsage.size,
        totalReqs,
        totalChars,
        users,
    });
});

/**
 * DELETE /api/admin/album-cache/:contentId
 * Elimina todo el cache de audio TTS de un contenido específico.
 * Usar cuando el texto de un álbum cambió editorialmente y el cache está desactualizado.
 *
 * Output: { removed, bytes, contentId }
 * Auth: requireAdminAccess
 */
app.delete('/api/admin/album-cache/:contentId', requireAdminAccess, async (req, res) => {
    const { contentId } = req.params;
    if (!contentId) return res.status(400).json({ error: 'contentId requerido' });

    try {
        const result = await purgeAlbumCacheForContent(contentId);
        log(`[ADMIN] Album cache purged contentId=${contentId} removed=${result.removed} bytes=${result.bytes}`);
        res.json({ ...result, contentId });
    } catch (err) {
        log(`[ADMIN] Album cache purge error: ${err.message}`, 'ERROR');
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/album-cache/gc
 * Dispara GC manual del cache de audio de álbum (elimina archivos > maxAgeDays).
 * Útil cuando el disco está cerca del límite sin esperar el ciclo de 24h.
 *
 * Body: { maxAgeDays?: number }  — default: 30
 * Output: { removed, bytes, maxAgeDays }
 * Auth: requireAdminAccess
 */
app.post('/api/admin/album-cache/gc', requireAdminAccess, async (req, res) => {
    const maxAgeDays = Math.max(1, parseInt(req.body?.maxAgeDays ?? 30, 10) || 30);
    try {
        const result = await cleanupAlbumCache(maxAgeDays);
        log(`[ADMIN] Manual GC: removed=${result.removed} bytes=${result.bytes} maxAgeDays=${maxAgeDays}`);
        res.json({ ...result, maxAgeDays });
    } catch (err) {
        log(`[ADMIN] Manual GC error: ${err.message}`, 'ERROR');
        res.status(500).json({ error: err.message });
    }
});

// --- LEO PEDAGOGICAL ENGINE (Fase 5 / D1) ---
app.post('/api/leo/ask', requireUserAuth, async (req, res) => {
    try {
        const leoReq = normalizeRequest(req.body, 'companion', req.headers['x-user-id']);
        const result = await dispatchInteraction(leoReq);
        res.status(200).json({ success: true, answer: result.answer });

        // Persist Leo interaction metadata (fire-and-forget, never blocks response)
        (async () => {
            try {
                const userId = req.headers['x-user-id'];
                const contentId = req.body?.contentId ?? null;
                const interactionType = req.body?.interactionType ?? 'chat';
                const surface = req.body?.surface ?? 'reader';
                const entry = { userId, contentId, timestamp: Date.now(), interactionType, surface };
                await withFileLock(LEO_INTERACTIONS_DB, () => {
                    const existing = readJSON(LEO_INTERACTIONS_DB) || [];
                    const updated = [...existing, entry];
                    const capped = updated.length > 50_000 ? updated.slice(updated.length - 50_000) : updated;
                    writeJSON(LEO_INTERACTIONS_DB, capped);
                }, 'leoInteractionsLock');
            } catch (persistErr) {
                log(`Leo interactions persist error: ${persistErr.message}`, 'WARN');
            }
        })();
    } catch (error) {
        log(`Leo ask error: ${error.message}`, 'WARN');
        const errStr = error.message.toLowerCase();
        let statusCode = error.statusCode ?? 500;
        if (errStr.includes("faltan parámetros") || errStr.includes("longitud permitida")) statusCode = 400;
        else if (errStr.includes("dominio autorizado") || errStr.includes("tipo de interacción")) statusCode = 403;
        res.status(statusCode).json({
            success: false,
            answer: errStr.includes('dominio autorizado')
                ? "¡Buena pregunta! Pero como estamos de exploración lectora, hablemos mejor sobre nuestra historia actual."
                : "¡Ups! Leo se distrajo. ¿Puedes intentarlo de nuevo?",
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

app.post('/api/leo/memory/:userId/:contentId', requireUserAuth, async (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const payload = req.body;
        const key = makeProgressKey(userId, contentId);

        let newMemory = null;
        await mutateLeoMemory((raw) => {
            const db = ensureLeoMemoryDbShape(raw);
            const existing = db.memoryMap[key] || {
                recentAnchors: [],
                lastQuestionType: null,
                sessionReadingProgress: 0,
                difficultyLevel: "medio",
                pedagogicalStage: 'comprehension'
            };
            newMemory = {
                ...existing,
                ...payload,
                updatedAt: new Date().toISOString()
            };
            db.memoryMap[key] = newMemory;
            writeJSON(LEO_MEMORY_DB, db);
        });

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

// --- LEO CHAT (Fase 6 / D1) ---
app.post('/api/leo/chat', requireUserAuth, async (req, res) => {
    try {
        const leoReq = normalizeRequest(req.body, 'chatbot', req.headers['x-user-id']);
        const result = await dispatchInteraction(leoReq);
        res.status(200).json({ success: true, answer: result.answer });
    } catch (error) {
        log(`Leo chat error: ${error.message}`, 'WARN');
        const statusCode = error.statusCode ?? 500;
        res.status(statusCode).json({
            success: false,
            answer: statusCode === 400
                ? error.message
                : '¡Hola! Soy Leo 🦀. Mi conexión con la biblioteca central está fallando un poco. ¿Me repites eso?',
        });
    }
});

// --- LEO RECAP (Fase 6 / D1) ---
app.post('/api/leo/recap', requireUserAuth, async (req, res) => {
    try {
        const leoReq = normalizeRequest(req.body, 'recap', req.headers['x-user-id']);
        const result = await dispatchInteraction(leoReq);
        res.status(200).json({ success: true, answer: result.answer });
    } catch (error) {
        log(`Leo recap error: ${error.message}`, 'WARN');
        const statusCode = error.statusCode ?? 500;
        res.status(statusCode).json({
            success: false,
            answer: statusCode === 400
                ? error.message
                : '¡Hola! 🦀 Te extrañé. ¡Sigamos leyendo!',
        });
    }
});

// --- LEO MEDIATOR VIEW (D6) ---
// Note: requireAuth lets GET through without the admin secret (existing pattern).
// D7 should introduce a requireMediatorAuth middleware scoped to mediador/administrador roles.

app.get('/api/leo/mediator/student/:userId', requireAuth, (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ success: false, error: 'userId requerido' });
        const summary = getMediatorStudentSummary(userId);
        res.json({ success: true, summary });
    } catch (e) {
        log(`Leo mediator summary error: ${e.message}`, 'ERROR');
        res.status(500).json({ success: false, error: 'Error al construir resumen de mediador' });
    }
});

app.get('/api/leo/mediator/student/:userId/content/:contentId', requireAuth, (req, res) => {
    try {
        const { userId, contentId } = req.params;
        if (!userId || !contentId) {
            return res.status(400).json({ success: false, error: 'userId y contentId requeridos' });
        }
        const history = getMediatorContentHistory(userId, contentId);
        res.json({ success: true, history });
    } catch (e) {
        log(`Leo mediator content history error: ${e.message}`, 'ERROR');
        res.status(500).json({ success: false, error: 'Error al construir historial por contenido' });
    }
});

// ── D7: ACTIVATION LAYER ──────────────────────────────────────────────────

/**
 * GET /api/leo/activation/:userId
 *
 * Returns activation outputs for a user: family summary, continuity nudge,
 * content recommendation, and/or production prompt.
 * Each output includes a `suppressUntil` advisory TTL for the caller.
 *
 * Auth: requireAuth (admin/mediator) or requireProgressOwner pattern.
 * Here we use requireAuth so mediators can query any student under their org.
 * Students calling for themselves must send x-user-id matching :userId.
 */
app.get('/api/leo/activation/:userId', requireAuth, (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ success: false, error: 'userId requerido' });
        const outputs = getActivationOutputsForUser(userId);
        res.json({ success: true, outputs });
    } catch (e) {
        log(`Leo activation error userId=${req.params.userId}: ${e.message}`, 'ERROR');
        res.status(500).json({ success: false, error: 'Error al generar outputs de activación' });
    }
});

// ── EXPORTACIÓN ACADÉMICA ──────────────────────────────────────────────────

/**
 * Sanitiza un string para usarlo como nombre de carpeta/archivo en el ZIP.
 * Preserva caracteres latinos (acentos, ñ), números, guiones y espacios (convertidos a _).
 */
function sanitizeFileName(str) {
    return (str || 'sin_nombre')
        .replace(/[^\w\s\-\u00C0-\u017E]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80);
}

/**
 * Escapa un valor para celda CSV (RFC 4180 simplificado).
 */
function csvCell(value) {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Genera el contenido del resumen.csv con una fila por entrega.
 */
function buildCSV(enriched) {
    const header = 'studentId,studentName,email,submittedAt,wordCount';
    const rows = enriched.map(({ sub, student }) => [
        csvCell(sub.studentId),
        csvCell(student?.nombre_completo || ''),
        csvCell(student?.email || ''),
        csvCell(sub.submittedAt || ''),
        csvCell(sub.wordCount ?? 0),
    ].join(','));
    return [header, ...rows].join('\r\n');
}

/**
 * Genera el contenido de respuesta.txt para un estudiante.
 */
function buildRespuesta(sub, student) {
    const name  = student?.nombre_completo || `Estudiante ${sub.studentId}`;
    const email = student?.email || '—';
    const fecha = sub.submittedAt
        ? new Date(sub.submittedAt).toLocaleDateString('es-ES', { timeZone: 'UTC' })
        : '—';
    return `Nombre: ${name}\nEmail: ${email}\nFecha: ${fecha}\n\n---\n\n${sub.responseText}`;
}

/**
 * Genera el objeto metadatos.json para un estudiante.
 */
function buildMetadatos(sub, student) {
    return {
        submissionId: sub.id,
        taskId:       sub.taskId,
        studentId:    sub.studentId,
        studentName:  student?.nombre_completo || '—',
        submittedAt:  sub.submittedAt || null,
        wordCount:    sub.wordCount ?? 0,
    };
}

// POST /api/submissions — el estudiante persiste su entrega en el servidor
// Complementa el guardado en localStorage; no reemplaza el flujo existente.
app.post('/api/submissions', requireUserAuth, async (req, res) => {
    try {
        const { taskId, studentId, groupId, responseText, contentId, source, taskTitle } = req.body;

        if (!taskId || !studentId || !groupId || typeof responseText !== 'string' || !responseText.trim()) {
            return res.status(400).json({ error: 'Campos obligatorios: taskId, studentId, groupId, responseText' });
        }

        // El usuario autenticado sólo puede enviar sus propias entregas
        if (req.user.id !== studentId) {
            return res.status(403).json({ error: 'No autorizado: solo puedes enviar entregas propias' });
        }

        const wordCount = responseText.trim().split(/\s+/).filter(Boolean).length;
        const newSub = {
            id:           `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            taskId,
            studentId,
            groupId,
            responseText,
            status:       'submitted',
            submittedAt:  new Date().toISOString(),
            wordCount,
            ...(contentId  && { contentId }),
            ...(source     && { source }),
            ...(taskTitle  && { taskTitle }),
        };

        await mutateSubmissions((submissions) => {
            // Reemplazar entrega previa del mismo estudiante para la misma tarea
            const base = submissions.filter(s => !(s.taskId === taskId && s.studentId === studentId));
            base.push(newSub);
            writeJSON(SUBMISSIONS_DB, base);
        });

        log(`Submission saved: task=${taskId} student=${studentId} words=${wordCount}`);
        res.status(201).json({ success: true, submission: newSub });

    } catch (e) {
        log(`POST /api/submissions error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al guardar la entrega' });
    }
});

// GET /api/tasks/:taskId/export-submissions — genera y descarga el ZIP de entregas
// Requiere autenticación de usuario válido (profesores/coordinadores).
app.get('/api/tasks/:taskId/export-submissions', requireUserAuth, (req, res) => {
    try {
        const { taskId } = req.params;

        const users       = readJSON(USERS_DB);
        const submissions = readJSON(SUBMISSIONS_DB);

        const taskSubs = submissions.filter(s => s.taskId === taskId && s.status === 'submitted');

        // Enriquecer con perfil de estudiante y ordenar alfabéticamente por nombre
        const enriched = taskSubs
            .map(sub => ({ sub, student: users.find(u => u.id === sub.studentId) || null }))
            .sort((a, b) => {
                const na = a.student?.nombre_completo || a.sub.studentId;
                const nb = b.student?.nombre_completo || b.sub.studentId;
                return na.localeCompare(nb, 'es');
            });

        const dateStr    = new Date().toISOString().slice(0, 10);
        const taskLabel  = enriched[0]?.sub.taskTitle || taskId;
        const safeLabel  = sanitizeFileName(taskLabel);
        const folderName = `Tarea_${safeLabel}`;
        const zipName    = `Tarea_${safeLabel}_${dateStr}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', (err) => {
            log(`Archiver error for task ${taskId}: ${err.message}`, 'ERROR');
            res.destroy(err);
        });

        archive.pipe(res);

        if (enriched.length === 0) {
            archive.append(
                `No hay entregas enviadas para la tarea: ${taskId}\n`,
                { name: `${folderName}/sin_entregas.txt` }
            );
        } else {
            // resumen.csv en raíz del folder
            archive.append(buildCSV(enriched), { name: `${folderName}/resumen.csv` });

            // Una carpeta por estudiante
            for (const { sub, student } of enriched) {
                const nameRaw    = student?.nombre_completo || `Estudiante_${sub.studentId}`;
                const safeName   = sanitizeFileName(nameRaw);
                const dir        = `${folderName}/${safeName}_${sub.studentId}`;

                archive.append(
                    buildRespuesta(sub, student),
                    { name: `${dir}/respuesta.txt` }
                );
                archive.append(
                    JSON.stringify(buildMetadatos(sub, student), null, 2),
                    { name: `${dir}/metadatos.json` }
                );
            }
        }

        archive.finalize();
        log(`ZIP export: task=${taskId} submissions=${enriched.length} file=${zipName}`);

    } catch (e) {
        log(`GET /api/tasks/:taskId/export-submissions error: ${e.message}`, 'ERROR');
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error al generar la exportación' });
        }
    }
});

// ── HELPERS PARA EXPORTACIÓN POR ESTUDIANTE ─────────────────────────────────

/**
 * CSV de resumen con una fila por tarea entregada por el estudiante.
 * Columnas: taskId, taskTitle, submittedAt, wordCount
 */
function buildStudentCSV(subs) {
    const header = 'taskId,taskTitle,submittedAt,wordCount';
    const rows = subs.map(sub => [
        csvCell(sub.taskId),
        csvCell(sub.taskTitle || ''),
        csvCell(sub.submittedAt || ''),
        csvCell(sub.wordCount ?? 0),
    ].join(','));
    return [header, ...rows].join('\r\n');
}

/**
 * Contenido de respuesta.txt para una tarea dentro del portfolio del estudiante.
 */
function buildStudentRespuesta(sub) {
    const taskLabel = sub.taskTitle || sub.taskId;
    const fecha = sub.submittedAt
        ? new Date(sub.submittedAt).toLocaleDateString('es-ES', { timeZone: 'UTC' })
        : '—';
    return `Tarea: ${taskLabel}\nFecha: ${fecha}\n\n---\n\n${sub.responseText}`;
}

/**
 * Objeto metadatos.json para una tarea dentro del portfolio del estudiante.
 */
function buildStudentMetadatos(sub, student) {
    return {
        submissionId: sub.id,
        taskId:       sub.taskId,
        taskTitle:    sub.taskTitle || '—',
        studentId:    sub.studentId,
        studentName:  student?.nombre_completo || '—',
        submittedAt:  sub.submittedAt || null,
        wordCount:    sub.wordCount ?? 0,
    };
}

// GET /api/students/:studentId/export-submissions — portfolio de tareas de un estudiante
// Ordenadas ascendente por fecha de entrega (cronología del estudiante).
app.get('/api/students/:studentId/export-submissions', requireUserAuth, (req, res) => {
    try {
        const { studentId } = req.params;

        const users       = readJSON(USERS_DB);
        const submissions = readJSON(SUBMISSIONS_DB);

        const student = users.find(u => u.id === studentId) || null;

        const studentSubs = submissions
            .filter(s => s.studentId === studentId && s.status === 'submitted')
            .sort((a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0)); // ascendente

        const dateStr     = new Date().toISOString().slice(0, 10);
        const studentName = student?.nombre_completo || `Estudiante_${studentId}`;
        const safeName    = sanitizeFileName(studentName);
        const zipName     = `${safeName}_${dateStr}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', (err) => {
            log(`Archiver error for student ${studentId}: ${err.message}`, 'ERROR');
            res.destroy(err);
        });

        archive.pipe(res);

        if (studentSubs.length === 0) {
            archive.append(
                `No hay entregas enviadas para: ${studentName}\n`,
                { name: `${safeName}/sin_entregas.txt` }
            );
        } else {
            archive.append(
                buildStudentCSV(studentSubs),
                { name: `${safeName}/resumen.csv` }
            );

            for (const sub of studentSubs) {
                const taskLabel    = sub.taskTitle || sub.taskId;
                const safeTaskLabel = sanitizeFileName(taskLabel);
                const dir          = `${safeName}/${safeTaskLabel}_${sub.taskId}`;

                archive.append(
                    buildStudentRespuesta(sub),
                    { name: `${dir}/respuesta.txt` }
                );
                archive.append(
                    JSON.stringify(buildStudentMetadatos(sub, student), null, 2),
                    { name: `${dir}/metadatos.json` }
                );
            }
        }

        archive.finalize();
        log(`ZIP export: student=${studentId} submissions=${studentSubs.length} file=${zipName}`);

    } catch (e) {
        log(`GET /api/students/:studentId/export-submissions error: ${e.message}`, 'ERROR');
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error al generar la exportación' });
        }
    }
});




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
            await withFileLock(DB_FILE, () => {
                writeJSON(DB_FILE, contentList);
            }, 'contentLock');
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






// ---------------------------------------------------------------------------
// ANALYTICS
// ---------------------------------------------------------------------------

// POST /api/analytics/events
// Accepts a JSON array of ReadingEvent objects from the frontend.
// Requires x-user-id header — events with a mismatching userId are discarded.
// Rate-limited by the global /api/ limiter. Capped at 50k events rolling.
app.post('/api/analytics/events', async (req, res) => {
    try {
        const events = req.body;
        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'Expected non-empty array of events' });
        }

        // Validate minimal shape to prevent junk writes
        const valid = events.every(e =>
            typeof e.event === 'string' &&
            typeof e.userId === 'string' &&
            typeof e.contentId === 'string' &&
            typeof e.timestamp === 'number'
        );
        if (!valid) {
            return res.status(400).json({ error: 'Malformed event objects' });
        }

        // Security: x-user-id header is required. Reject requests without it.
        // Events claiming a different userId than the header are discarded and logged.
        const headerUserId = req.headers['x-user-id'];
        if (!headerUserId) {
            return res.status(401).json({ error: 'x-user-id required' });
        }
        const securityFiltered = events.filter(e => {
            if (e.userId === headerUserId) return true;
            log(`Analytics: evento descartado — userId mismatch header=${headerUserId} event=${e.userId}`, 'WARN');
            return false;
        });

        if (securityFiltered.length === 0) {
            return res.status(200).json({ ok: true, received: 0, discarded: events.length });
        }

        // Validate userIds — discard events from unknown users to prevent DB contamination.
        const knownUsers = readJSON(USERS_DB);
        const validIds   = new Set(knownUsers.map(u => u.id));
        const validEvents = securityFiltered.filter(e => {
            if (validIds.has(e.userId)) return true;
            log(`Analytics: evento descartado — userId desconocido: ${e.userId}`, 'WARN');
            return false;
        });

        if (validEvents.length === 0) {
            return res.status(200).json({ ok: true, received: 0, discarded: events.length });
        }

        const { received, deduplicated } = await withFileLock(ANALYTICS_DB, () => {
            const existing = readJSON(ANALYTICS_DB) || [];
            const existingEventIds = new Set(existing.map(e => e.eventId).filter(Boolean));
            const deduped = validEvents.filter(e => {
                if (!e.eventId) return true;
                if (existingEventIds.has(e.eventId)) {
                    log(`Analytics: evento duplicado descartado eventId=${e.eventId}`, 'DEBUG');
                    return false;
                }
                return true;
            });
            const updated = [...existing, ...deduped];
            const capped = updated.length > 50_000 ? updated.slice(updated.length - 50_000) : updated;
            writeJSON(ANALYTICS_DB, capped);
            return { received: deduped.length, deduplicated: validEvents.length - deduped.length };
        }, 'analyticsLock');

        // ── DUAL-WRITE Backbone v1 (Fase 0) ──────────────────────────────────
        // Best-effort: intenta espejar los eventos legacy en events.db. Cualquier
        // fallo individual no afecta el response del endpoint legacy.
        try {
            const dualResult = dualWriteAnalyticsEventsToBackbone(validEvents, headerUserId);
            log(`[EVENTS_V1] dual-write analytics: accepted=${dualResult.accepted} dedup=${dualResult.deduplicated} rejected=${dualResult.rejected}`, 'INFO');
        } catch (e) {
            log(`[EVENTS_V1] dual-write analytics error: ${e.message}`, 'WARN');
        }

        res.json({ ok: true, received, deduplicated });
    } catch (e) {
        log(`Analytics write error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to write analytics' });
    }
});

// ---------------------------------------------------------------------------
// METRICS API
// ---------------------------------------------------------------------------

/**
 * Load all required flat-file databases and initialize the metrics engine.
 * Called fresh on each request — data is always current without a server restart.
 * Returns the raw loaded data so callers can use it for auth checks too.
 */
function loadAndInitMetrics() {
    const groups = readJSON(GROUPS_DB) || [];
    const users  = readJSON(USERS_DB)  || [];
    initMetrics({
        events:          readJSON(ANALYTICS_DB)       || [],
        leoMemory:       readJSON(LEO_MEMORY_DB)      || { memoryMap: {} },
        leoInteractions: readJSON(LEO_INTERACTIONS_DB) || [],
        progress:        getAllProgressAsMap(),
        groups,
        users,
    });
    return { groups, users };
}

// ---------------------------------------------------------------------------
// METRICS AUTH HELPERS
// ---------------------------------------------------------------------------

// isAdminRequest se construye en la factoría createAdminAuth (arriba), junto con
// los demás consumidores: Promise<boolean> file-only. TODO call site debe await.

/**
 * Resolve the requesting user from x-user-id header.
 * Returns null if header is missing or user not found.
 */
function resolveRequester(req, users) {
    const id = req.headers['x-user-id'];
    if (!id) return null;
    return users.find(u => u.id === id) ?? null;
}

/**
 * True if user has the mediador role.
 * DT-05: 'profesor' eliminado del modelo. Safety net: también acepta 'profesor'
 * para datos legacy que no hayan pasado por la migración DT-04.
 */
function isMediatorRole(user) {
    return (user.roles ?? []).some(r => r === 'mediador' || r === 'profesor');
}

/**
 * True if `user` is assigned as mediator of `courseId`.
 * Checks: group.teacherId, group.mediatorIds, and user.groupIds (reverse lookup).
 */
function isMediatorOfCourse(user, courseId, groups) {
    const group = groups.find(g => g.id === courseId);
    if (!group) return false;
    return (
        group.teacherId === user.id ||
        (group.mediatorIds ?? []).includes(user.id) ||
        (user.groupIds    ?? []).includes(courseId)
    );
}

// ---------------------------------------------------------------------------
// SCHOOL IDENTIFIER HELPERS
// ---------------------------------------------------------------------------

/**
 * Derive a stable URL-safe slug from a school name.
 * "Colegio Chibalete" → "colegio-chibalete"
 * Accent-stripped, lowercased, non-alphanumeric runs replaced with "-".
 */
function schoolNameToSlug(name) {
    return name
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // strip combining accents
        .replace(/[^a-z0-9]+/g, '-')       // non-alphanumeric → hyphen
        .replace(/^-|-$/g, '');            // trim leading/trailing hyphens
}

/**
 * Resolve a school by slug OR by raw name (case-insensitive, backward-compatible).
 * Returns { schoolId: string (slug), schoolName: string (canonical) } or null.
 *
 * Accepts:
 *   - "colegio-chibalete"   (new stable slug form)
 *   - "Colegio Chibalete"   (legacy name form — still supported)
 */
function resolveSchoolRecord(input, groups) {
    const normalizedInput = input.toLowerCase().trim();
    const match = groups.find(g => {
        if (!g.school) return false;
        const name = g.school.trim();
        return (
            name.toLowerCase() === normalizedInput ||   // exact name match (case-insensitive)
            schoolNameToSlug(name) === normalizedInput  // slug match
        );
    });
    if (!match) return null;
    const schoolName = match.school.trim();
    return { schoolId: schoolNameToSlug(schoolName), schoolName };
}

// ---------------------------------------------------------------------------
// ALERT GENERATION
// ---------------------------------------------------------------------------

const ALERT_SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Generate structured alerts from behavioral metrics and reading level scores.
 *
 * @param {object} behavioral   - BehavioralMetrics object
 * @param {object} readingLevels - ReadingLevelScores object
 * @param {'student'|'course'|'school'} context
 * @param {object} extras       - Optional: { studentCount, activeStudentCount }
 *                                for engagement alert at group level
 *
 * Alerts are deduplicated by type and sorted high → medium → low.
 */
function generateAlerts(behavioral, readingLevels, context = 'student', extras = {}) {
    const seen   = new Set();
    const alerts = [];

    const add = (type, severity, message) => {
        if (seen.has(type)) return; // deduplicate by type
        seen.add(type);
        alerts.push({ type, severity, message });
    };

    // low_sessions: sparse data — metrics may not be representative
    const sessionThreshold = context === 'student' ? 3 : 0;
    if (behavioral.totalSessions <= sessionThreshold) {
        add('low_sessions', 'low',
            context === 'student'
                ? 'El estudiante tiene pocas sesiones registradas. Las métricas pueden no ser representativas.'
                : 'El grupo tiene poca actividad registrada. Se necesitan más datos para métricas confiables.');
    }

    // low_trance: reader rarely enters sustained focus flow (streak >= 3)
    const tranceThreshold = context === 'school' ? 0.15 : 0.20;
    if (behavioral.totalSessions > 0 && behavioral.tranceEntryRate < tranceThreshold) {
        add('low_trance', context === 'school' ? 'high' : 'medium',
            'Baja tasa de flujo de concentración. Los lectores interrumpen la lectura con frecuencia antes de alcanzar ritmo sostenido.');
    }

    // low_continuity: high streak-break rate indicates fragmented reading
    const breakThreshold = context === 'student' ? 0.50 : 0.60;
    if (behavioral.totalSessions > 0 && behavioral.streakBreakRate > breakThreshold) {
        add('low_continuity', 'medium',
            'Alta tasa de interrupciones de racha. Indica lectura fragmentada o dificultad sostenida de atención.');
    }

    // low_inference: reader struggles beyond the literal level
    const inferThreshold = context === 'student' ? 30 : 25;
    if (readingLevels.inferential < inferThreshold) {
        add('low_inference', 'high',
            'Nivel inferencial bajo. El lector puede tener dificultad para derivar significado más allá del contenido explícito.');
    }

    // low_engagement: group-level only — fewer active students than expected
    const { studentCount, activeStudentCount, totalLeoInteractions, totalLeoOfflineAttempts } = extras;
    if (studentCount != null && activeStudentCount != null && studentCount > 0) {
        const engThreshold = context === 'school' ? 0.40 : 0.50;
        const engSeverity  = context === 'school' ? 'high' : 'medium';
        if (activeStudentCount / studentCount < engThreshold) {
            add('low_engagement', engSeverity,
                `Solo ${activeStudentCount} de ${studentCount} estudiantes tienen sesiones registradas.`);
        }
    }

    // leo_offline_barrier: significant offline Leo attempts detected
    if (totalLeoOfflineAttempts != null && totalLeoOfflineAttempts > 0) {
        const totalAttempts = (totalLeoInteractions ?? 0) + totalLeoOfflineAttempts;
        const offlineRatio  = totalAttempts > 0 ? totalLeoOfflineAttempts / totalAttempts : 1;
        if (offlineRatio > 0.40 || totalLeoOfflineAttempts >= 5) {
            add('leo_offline_barrier', 'medium',
                `${totalLeoOfflineAttempts} intento${totalLeoOfflineAttempts > 1 ? 's' : ''} de Leo sin conexión registrado${totalLeoOfflineAttempts > 1 ? 's' : ''}. Puede indicar una barrera de conectividad.`);
        }
    }

    // Sort: high → medium → low
    return alerts.sort((a, b) => ALERT_SEVERITY_ORDER[a.severity] - ALERT_SEVERITY_ORDER[b.severity]);
}

// ---------------------------------------------------------------------------
// RESPONSE FORMATTERS
// ---------------------------------------------------------------------------

/** Map a composite score (0–100) to a human-readable level label in Spanish. */
function compositeToLabel(score) {
    if (score >= 75) return 'Avanzado';
    if (score >= 55) return 'En desarrollo';
    if (score >= 30) return 'Básico';
    return 'Inicial';
}

/** Round a number to 1 decimal place. */
function r1(n) { return Math.round(n * 10) / 10; }

/** Return a reading-levels object with all scores rounded to 1 decimal. */
function roundReadingLevels(rl) {
    return {
        literal:     r1(rl.literal),
        inferential: r1(rl.inferential),
        critical:    r1(rl.critical),
        reflective:  r1(rl.reflective),
        composite:   r1(rl.composite),
    };
}

/**
 * Format raw StudentMetrics into the structured API response shape.
 */
function formatStudentResponse(raw) {
    const alerts = generateAlerts(raw.behavioral, raw.readingLevels, 'student');
    return {
        userId:     raw.userId,
        dataWindow: raw.dataWindow,
        computedAt: raw.computedAt,
        summary: {
            totalSessions:        raw.behavioral.totalSessions,
            totalReadingTimeMs:   raw.behavioral.totalReadingTimeMs,
            distinctContentsRead: raw.behavioral.distinctContentsRead,
            composite:            r1(raw.readingLevels.composite),
            level:                compositeToLabel(raw.readingLevels.composite),
        },
        productMetrics: raw.behavioral,
        readingLevels:  roundReadingLevels(raw.readingLevels),
        icdli:          raw.icdli,
        alerts,
    };
}

/**
 * Build a Map<contentId, { title, type }> from content.json.
 * Returns empty map on read failure — callers fall back to contentId display.
 */
function buildContentMap() {
    try {
        const items = readJSON(DB_FILE) || [];
        return new Map(
            (Array.isArray(items) ? items : []).map(c => [
                c.id,
                { title: c.titulo ?? c.id, type: c.tipo ?? null }
            ])
        );
    } catch { return new Map(); }
}

/** Resolve a human-readable title from contentId, falling back gracefully. */
function resolveContentTitle(contentId, contentMap) {
    return contentMap.get(contentId)?.title ?? `Contenido ${contentId.slice(-8)}`;
}

/**
 * Build a ReadingDetails object from student.contentStats, enriched with titles.
 * Caps at 2 in-progress, 3 completed, 2 abandoned — sorted by recency.
 */
function buildReadingDetails(contentStats, contentMap) {
    const contents = contentStats?.contents ?? [];
    const byRecency = (a, b) => (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? '');

    const inProgress = contents
        .filter(c => c.status === 'in_progress')
        .sort(byRecency)
        .slice(0, 2)
        .map(c => ({
            contentId:          c.contentId,
            title:              resolveContentTitle(c.contentId, contentMap),
            type:               contentMap.get(c.contentId)?.type ?? null,
            progressPercentage: c.progressPercentage,
            totalReadingTimeMs: c.totalReadingTimeMs,
        }));

    const completed = contents
        .filter(c => c.status === 'completed')
        .sort(byRecency)
        .slice(0, 3)
        .map(c => ({
            contentId: c.contentId,
            title:     resolveContentTitle(c.contentId, contentMap),
            type:      contentMap.get(c.contentId)?.type ?? null,
            lastReadAt: c.lastReadAt,
        }));

    const abandoned = contents
        .filter(c => c.status === 'abandoned')
        .sort(byRecency)
        .slice(0, 2)
        .map(c => ({
            contentId:          c.contentId,
            title:              resolveContentTitle(c.contentId, contentMap),
            type:               contentMap.get(c.contentId)?.type ?? null,
            progressPercentage: c.progressPercentage,
        }));

    return { inProgress, completed, abandoned };
}

/**
 * Build a single student row for the course breakdown table.
 * Adds needsAttention flag and hasData boolean for direct UI consumption.
 */
function buildStudentBreakdownRow(student, users, contentMap) {
    const user       = users.find(u => u.id === student.userId);
    const hasData    = student.behavioral.totalSessions > 0;
    // needsAttention: no activity OR composite score at the lowest ICDLI tier
    const needsAttention = !hasData || student.readingLevels.composite < 30;
    return {
        userId:                  student.userId,
        name:                    user?.nombre_completo ?? student.userId,
        hasData,
        needsAttention,
        totalSessions:           student.behavioral.totalSessions,
        composite:               r1(student.readingLevels.composite),
        literal:                 r1(student.readingLevels.literal),
        inferential:             r1(student.readingLevels.inferential),
        critical:                r1(student.readingLevels.critical),
        reflective:              r1(student.readingLevels.reflective),
        level:                   compositeToLabel(student.readingLevels.composite),
        totalLeoInteractions:    student.leoMetrics?.totalLeoInteractions ?? 0,
        totalLeoOfflineAttempts: student.leoMetrics?.totalLeoOfflineAttempts ?? 0,
        dominantLeoType:         student.leoMetrics?.dominantType ?? null,
        lastAccessAt:            student.lastAccessAt ?? null,
        totalReadingTimeMs:      student.behavioral.totalReadingTimeMs,
        contentsInProgress:      student.contentStats?.inProgress ?? 0,
        contentsCompleted:       student.contentStats?.completed  ?? 0,
        contentsAbandoned:       student.contentStats?.abandoned  ?? 0,
        readingDetails:          buildReadingDetails(student.contentStats, contentMap ?? new Map()),
    };
}

/**
 * Format raw CourseMetrics into the structured API response shape.
 */
function formatCourseResponse(raw, users) {
    const contentMap = buildContentMap();

    const totalLeoInteractions = raw.studentBreakdown.reduce(
        (sum, s) => sum + (s.leoMetrics?.totalLeoInteractions ?? 0), 0
    );
    const totalLeoOfflineAttempts = raw.studentBreakdown.reduce(
        (sum, s) => sum + (s.leoMetrics?.totalLeoOfflineAttempts ?? 0), 0
    );

    const alerts = generateAlerts(
        raw.averages.behavioral,
        raw.averages.readingLevels,
        'course',
        { studentCount: raw.studentCount, activeStudentCount: raw.activeStudentCount, totalLeoInteractions, totalLeoOfflineAttempts }
    );

    const engagementRate = raw.studentCount > 0
        ? Math.round((raw.activeStudentCount / raw.studentCount) * 100) / 100
        : 0;

    const topNames    = raw.topPerformers.map(id => {
        const u = users.find(u => u.id === id);
        return { userId: id, name: u?.nombre_completo ?? id };
    });
    const bottomNames = raw.needsAttention.map(id => {
        const u = users.find(u => u.id === id);
        return { userId: id, name: u?.nombre_completo ?? id };
    });

    return {
        courseId:   raw.courseId,
        courseName: raw.courseName,
        computedAt: raw.computedAt,
        summary: {
            studentCount:           raw.studentCount,
            activeStudentCount:     raw.activeStudentCount,
            engagementRate,
            avgComposite:           r1(raw.averages.readingLevels.composite),
            level:                  compositeToLabel(raw.averages.readingLevels.composite),
            totalLeoInteractions,
            totalLeoOfflineAttempts,
        },
        productMetrics:   raw.averages.behavioral,
        readingLevels:    roundReadingLevels(raw.averages.readingLevels),
        icdli:            raw.averages.icdli,
        distributions:    raw.distributions,
        studentBreakdown: raw.studentBreakdown.map(s => buildStudentBreakdownRow(s, users, contentMap)),
        topPerformers:    topNames,
        needsAttention:   bottomNames,
        alerts,
    };
}

/**
 * Format raw SchoolMetrics into the structured API response shape.
 * schoolRecord: { schoolId: slug, schoolName: canonical }
 */
function formatSchoolResponse(raw, schoolRecord) {
    const alerts = generateAlerts(
        raw.averages.behavioral,
        raw.averages.readingLevels,
        'school',
        { studentCount: raw.studentCount, activeStudentCount: raw.activeStudentCount }
    );

    const engagementRate = raw.studentCount > 0
        ? Math.round((raw.activeStudentCount / raw.studentCount) * 100) / 100
        : 0;

    return {
        schoolId:   schoolRecord.schoolId,
        schoolName: schoolRecord.schoolName,
        computedAt: raw.computedAt,
        summary: {
            courseCount:        raw.courseCount,
            studentCount:       raw.studentCount,
            activeStudentCount: raw.activeStudentCount,
            engagementRate,
            avgComposite:       r1(raw.averages.readingLevels.composite),
            level:              compositeToLabel(raw.averages.readingLevels.composite),
        },
        productMetrics:  raw.averages.behavioral,
        readingLevels:   roundReadingLevels(raw.averages.readingLevels),
        icdli:           raw.averages.icdli,
        distributions:   raw.distributions,
        courseBreakdown: raw.courseBreakdown,
        alerts,
    };
}

/**
 * Compute the dataWindow for a course report from the raw student breakdown.
 * Uses the engine's StudentMetrics[] (which carry dataWindow) before formatting.
 * Returns null if no student has any recorded events.
 */
function computeCourseDataWindow(studentBreakdown) {
    const windows = studentBreakdown.filter(s => s.dataWindow != null).map(s => s.dataWindow);
    if (windows.length === 0) return null;
    return {
        from: windows.reduce((min, w) => Math.min(min, w.from), Infinity),
        to:   windows.reduce((max, w) => Math.max(max, w.to),   -Infinity),
    };
}

// ---------------------------------------------------------------------------
// METRICS ENDPOINTS
// ---------------------------------------------------------------------------

// GET /api/metrics/schools
// Lists all schools with both stable schoolId (slug) and display schoolName.
// Mediators see only schools of their assigned groups.
// Requires: admin OR authenticated mediator/user.
// ── CHP-STATS-SHADOW-01A — frontera única de las rutas legacy de métricas ──
//
// `mountLegacyMetricsRoute` NO decide autorización: cada handler legacy sigue
// haciéndolo tal cual. Con el default `legacy` la frontera devuelve el handler
// intacto, así que el comportamiento productivo no cambia.
//
// El ejecutor canónico queda SIN enlazar en esta unidad: enlazarlo exige
// extraer de `metricsRouterV2` un cómputo canónico reutilizable y alineado por
// periodo, que es una refactorización de los handlers v2 y pertenece a su
// propia unidad. Hasta entonces, `shadow` responde legacy y no compara.
const legacyMetricsShadowExecutor = createShadowExecutor({ log: (o, lvl) => log(JSON.stringify(o), lvl || 'INFO') });

function mountLegacyMetricsRoute(routeKind, legacyHandler) {
    return async function legacyMetricsRoute(req, res) {
        return executeMetricsRoute({
            mode: metricsEngineMode(),
            routeKind,
            req, res,
            legacyHandler,
            canonicalExecutor: null,      // pendiente: enlace al proveedor canónico
            captureLegacy: null,
            shadowExecutor: legacyMetricsShadowExecutor,
            log: (o, lvl) => log(JSON.stringify(o), lvl || 'INFO'),
        });
    };
}

const legacyMetricsSchoolsHandler = async (req, res) => {
    const { groups, users } = loadAndInitMetrics();
    const requester = resolveRequester(req, users);
    const adminAccess = await isAdminRequest(req);

    if (!adminAccess && !requester) {
        return res.status(401).json({ error: 'Auth requerida' });
    }

    let relevantGroups = groups;
    if (!adminAccess && requester && isMediatorRole(requester)) {
        relevantGroups = groups.filter(g => isMediatorOfCourse(requester, g.id, groups));
    }

    // Deduplicate by canonical name, return { schoolId (slug), schoolName } pairs
    const seen    = new Map(); // schoolName → slug
    for (const g of relevantGroups) {
        if (!g.school) continue;
        const name = g.school.trim();
        if (!seen.has(name)) seen.set(name, schoolNameToSlug(name));
    }

    const schools = [...seen.entries()]
        .map(([schoolName, schoolId]) => ({ schoolId, schoolName }))
        .sort((a, b) => a.schoolName.localeCompare(b.schoolName));

    res.json({ schools });
};

app.get('/api/metrics/schools', mountLegacyMetricsRoute('metrics.schools', legacyMetricsSchoolsHandler));

// GET /api/metrics/student/:userId
// Returns full structured metrics for a single student.
// Requires: admin secret OR the student's own x-user-id.
const legacyMetricsStudentHandler = async (req, res) => {
    const { userId }        = req.params;
    const { users }         = loadAndInitMetrics();
    const requester         = resolveRequester(req, users);
    const selfAccess        = requester?.id === userId;

    if (!(await isAdminRequest(req)) && !selfAccess) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
        const raw = computeStudentMetrics(userId);
        const response = formatStudentResponse(raw);
        // Sprint Data Backbone Fase 3: augment additivo. Si events.db falla,
        // backboneMetrics es shape vacío válido (nunca rompe legacy).
        response.backboneMetrics = safeLoadBackboneMetrics({
            userIds: [userId],
            windowDays: 30,
        });
        res.json(response);
    } catch (e) {
        log(`Metrics student error (${userId}): ${e.message}`, 'ERROR');
        res.status(500).json({ error: e.message });
    }
};

app.get('/api/metrics/student/:userId', mountLegacyMetricsRoute('metrics.student', legacyMetricsStudentHandler));

// ---------------------------------------------------------------------------
// DATA BACKBONE METRICS — helper compartido por endpoints
// ---------------------------------------------------------------------------
//
// Wrapper defensivo. Cualquier excepción al leer events.db (DB inexistente,
// archivo corrupto, statement con error) se traduce a `emptyBackboneMetrics`
// + log WARN. Los endpoints legacy nunca devuelven 500 por culpa del backbone.
//
function safeLoadBackboneMetrics(opts = {}) {
    const windowDays = typeof opts.windowDays === 'number' && opts.windowDays > 0 ? opts.windowDays : 30;
    try {
        const result = getBackboneEventsForMetrics({
            windowDays,
            userIds:    opts.userIds,
            contentIds: opts.contentIds,
            modes:      opts.modes,
        });
        const meta = {
            windowDays: result.windowDays,
            windowFrom: result.windowFrom,
            windowTo:   result.windowTo,
        };
        const metrics = aggregateBackboneMetrics(result.events, meta);

        // Sprint Data Backbone Fase 6A: funnels aditivos. Si el cómputo
        // falla por cualquier razón, devolvemos un shape vacío válido
        // para no romper consumidores ni la respuesta del endpoint legacy.
        try {
            metrics.funnels = computeBackboneFunnels(result.events, meta);
        } catch (e) {
            log(`[BACKBONE_FUNNELS] compute failed: ${e.message}`, 'WARN');
            metrics.funnels = emptyBackboneFunnels({ windowDays });
        }

        // Sprint Data Backbone Fase 6B: insights aditivos. Reglas puras
        // sobre metrics + funnels. Mismo contrato defensivo: nunca rompen.
        try {
            metrics.insights = computeBackboneInsights({
                metrics,
                funnels:    metrics.funnels,
                windowDays,
            });
        } catch (e) {
            log(`[BACKBONE_INSIGHTS] compute failed: ${e.message}`, 'WARN');
            metrics.insights = emptyBackboneInsights({ windowDays });
        }
        return metrics;
    } catch (e) {
        log(`[BACKBONE_METRICS] safeLoad failed: ${e.message}`, 'WARN');
        const empty = emptyBackboneMetrics({ windowDays });
        empty.funnels  = emptyBackboneFunnels({ windowDays });
        empty.insights = emptyBackboneInsights({ windowDays });
        return empty;
    }
}

// Devuelve userIds únicos para un school dado los grupos cargados en cache.
function collectSchoolUserIds(schoolName, groups) {
    const set = new Set();
    for (const g of groups) {
        if (typeof g.school === 'string' && g.school.toLowerCase() === schoolName.toLowerCase()) {
            const ids = [
                ...(Array.isArray(g.studentIds)   ? g.studentIds   : []),
                ...(Array.isArray(g.memberIds)    ? g.memberIds    : []),
            ];
            for (const id of ids) if (typeof id === 'string') set.add(id);
        }
    }
    return [...set];
}

// GET /api/metrics/course/:courseId
// Returns aggregated structured metrics for a course.
// Requires: admin secret OR mediator assigned to that course (x-user-id).
const legacyMetricsCourseHandler = async (req, res) => {
    const { courseId }      = req.params;
    const { groups, users } = loadAndInitMetrics();
    const requester         = resolveRequester(req, users);
    const adminAccess       = await isAdminRequest(req);
    const mediatorAccess    = requester && isMediatorRole(requester) &&
                              isMediatorOfCourse(requester, courseId, groups);

    if (!adminAccess && !mediatorAccess) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
        const raw      = computeCourseMetrics(courseId);
        const response = formatCourseResponse(raw, users);

        // Augment each student with their pedagogical profile (computed from session timelines)
        const pDb       = getAllProgressAsMap();
        const leoRaw    = readJSON(LEO_INTERACTIONS_DB) || [];
        const timelines = buildStudentSessionTimelines(pDb);
        const leoByUser = buildStudentLeoInteractionsMap(leoRaw);

        response.studentBreakdown = response.studentBreakdown.map(student => ({
            ...student,
            pedagogicalProfile: computePedagogicalProfile(
                timelines[student.userId] ?? [],
                leoByUser[student.userId] ?? []
            ),
        }));

        // Sprint Data Backbone Fase 3: backboneMetrics filtrado por los
        // alumnos del curso. Aditivo, no rompe shape existente.
        const courseUserIds = response.studentBreakdown
            .map(s => s.userId)
            .filter(id => typeof id === 'string');
        response.backboneMetrics = safeLoadBackboneMetrics({
            userIds:    courseUserIds,
            windowDays: 30,
        });

        res.json(response);
    } catch (e) {
        log(`Metrics course error (${courseId}): ${e.message}`, 'ERROR');
        const status = e.message.includes('not found') ? 404 : 500;
        res.status(status).json({ error: e.message });
    }
};

app.get('/api/metrics/course/:courseId', mountLegacyMetricsRoute('metrics.course', legacyMetricsCourseHandler));

// GET /api/metrics/school/:schoolId
// Accepts schoolId as either a slug ("colegio-chibalete") or original name.
// Returns aggregated structured metrics for a school.
// Requires: admin secret only.
const legacyMetricsSchoolHandler = async (req, res) => {
    if (!(await isAdminRequest(req))) {
        return res.status(403).json({ error: 'Acceso denegado: solo administradores' });
    }
    const { groups }     = loadAndInitMetrics();
    const input          = decodeURIComponent(req.params.schoolId);
    const schoolRecord   = resolveSchoolRecord(input, groups);

    if (!schoolRecord) {
        return res.status(404).json({ error: `No se encontraron grupos para: ${input}` });
    }

    try {
        const raw = computeSchoolMetrics(schoolRecord.schoolName);
        const response = formatSchoolResponse(raw, schoolRecord);

        // Sprint Data Backbone Fase 3: backboneMetrics agregado para todos
        // los alumnos de la escuela. Aditivo.
        const schoolUserIds = collectSchoolUserIds(schoolRecord.schoolName, groups);
        response.backboneMetrics = safeLoadBackboneMetrics({
            userIds:    schoolUserIds,
            windowDays: 30,
        });

        res.json(response);
    } catch (e) {
        log(`Metrics school error (${schoolRecord.schoolName}): ${e.message}`, 'ERROR');
        res.status(500).json({ error: e.message });
    }
};

app.get('/api/metrics/school/:schoolId', mountLegacyMetricsRoute('metrics.school', legacyMetricsSchoolHandler));

// ---------------------------------------------------------------------------
// DATA BACKBONE — endpoint diagnóstico (admin only)
// ---------------------------------------------------------------------------
//
// GET /api/metrics/backbone?windowDays=30
//
// Devuelve métricas globales del backbone v1, sin filtros de usuario. Útil
// para validar el flujo end-to-end (events.db → aggregator → JSON) sin
// pasar por la lógica legacy de metricsService.
//
// Si events.db no existe o falla, responde con shape vacío + 200 (no 500).
//
app.get('/api/metrics/backbone', async (req, res) => {
    if (!(await isAdminRequest(req))) {
        const { users } = loadAndInitMetrics();
        const requester = resolveRequester(req, users);
        if (!requester || !isMediatorRole(requester)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
    }

    const windowDays = (() => {
        const raw = parseInt(String(req.query.windowDays ?? '30'), 10);
        if (!Number.isFinite(raw) || raw <= 0) return 30;
        return Math.min(raw, 180); // cap defensivo: 6 meses máximo en una request
    })();

    try {
        const stats = (() => {
            try {
                return getBackboneEventStats({
                    sinceTs: Date.now() - windowDays * 86_400_000,
                });
            } catch (e) {
                log(`[BACKBONE_METRICS] stats failed: ${e.message}`, 'WARN');
                return { total: 0, byMode: {}, windowFrom: null, windowTo: null };
            }
        })();

        const backboneMetrics = safeLoadBackboneMetrics({ windowDays });
        res.json({
            ok: true,
            stats,
            backboneMetrics,
        });
    } catch (e) {
        log(`[BACKBONE_METRICS] endpoint error: ${e.message}`, 'ERROR');
        // Política Fase 3: nunca 500 por backbone — devolver vacío.
        res.json({
            ok: true,
            stats:           { total: 0, byMode: {}, windowFrom: null, windowTo: null },
            backboneMetrics: emptyBackboneMetrics({ windowDays }),
        });
    }
});

// ---------------------------------------------------------------------------
// DATA BACKBONE — funnels (Sprint 6A)
// ---------------------------------------------------------------------------
//
// GET /api/metrics/funnels?windowDays=30
//
// Devuelve embudos de conversión (LU, lectura, a11y, inmersivo, pdf, álbum)
// computados sobre eventos native del Backbone v1. Aditivo respecto al
// shape `backboneMetrics` que ya se inyecta en /api/metrics/{student,course,
// school,backbone} — este endpoint es la versión "diagnóstica" que devuelve
// solo el bloque de funnels para consumo de dashboards/herramientas internas.
//
// Nunca 500. Si events.db falla, responde con shape vacío + 200.
// Acceso: admin OR mediador autenticado (mismo gating que /api/metrics/backbone).
//
app.get('/api/metrics/funnels', async (req, res) => {
    if (!(await isAdminRequest(req))) {
        const { users } = loadAndInitMetrics();
        const requester = resolveRequester(req, users);
        if (!requester || !isMediatorRole(requester)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
    }

    const windowDays = (() => {
        const raw = parseInt(String(req.query.windowDays ?? '30'), 10);
        if (!Number.isFinite(raw) || raw <= 0) return 30;
        return Math.min(raw, 180);
    })();

    try {
        const result = getBackboneEventsForMetrics({ windowDays });
        const funnels = computeBackboneFunnels(result.events, {
            windowDays: result.windowDays,
            windowFrom: result.windowFrom,
            windowTo:   result.windowTo,
        });
        res.json({ ok: true, funnels });
    } catch (e) {
        log(`[BACKBONE_FUNNELS] endpoint error: ${e.message}`, 'WARN');
        // Política Fase 3/6A: nunca 500 por backbone — devolver vacío.
        res.json({ ok: true, funnels: emptyBackboneFunnels({ windowDays }) });
    }
});

// ---------------------------------------------------------------------------
// DATA BACKBONE — insights (Sprint 6B)
// ---------------------------------------------------------------------------
//
// GET /api/metrics/insights?windowDays=30
//
// Devuelve el resultado del agregador interpretativo: severitySummary +
// lista de insights ordenados (critical → warning → info). Reglas puras
// sobre `aggregateBackboneMetrics` + `computeBackboneFunnels`. No persiste
// alertas; cada llamada recomputa.
//
// Acceso: admin OR mediador autenticado (mismo gating que funnels/backbone).
// Nunca 500. Si el pipeline falla, responde con shape vacío.
//
app.get('/api/metrics/insights', async (req, res) => {
    if (!(await isAdminRequest(req))) {
        const { users } = loadAndInitMetrics();
        const requester = resolveRequester(req, users);
        if (!requester || !isMediatorRole(requester)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
    }

    const windowDays = (() => {
        const raw = parseInt(String(req.query.windowDays ?? '30'), 10);
        if (!Number.isFinite(raw) || raw <= 0) return 30;
        return Math.min(raw, 180);
    })();

    try {
        const result = getBackboneEventsForMetrics({ windowDays });
        const meta   = {
            windowDays: result.windowDays,
            windowFrom: result.windowFrom,
            windowTo:   result.windowTo,
        };
        const metrics  = aggregateBackboneMetrics(result.events, meta);
        const funnels  = computeBackboneFunnels(result.events, meta);
        const insights = computeBackboneInsights({ metrics, funnels, windowDays });

        // Sprint 6C: bloque `persisted` aditivo. Si insights.db falla,
        // available=false y no rompemos la respuesta principal.
        let persisted;
        try {
            const summary = getInsightsScopeSummary('global', null);
            persisted = { available: true, ...summary };
        } catch (e) {
            log(`[INSIGHTS_PERSISTED] read failed: ${e.message}`, 'WARN');
            persisted = { available: false, activeCount: 0, criticalCount: 0, warningCount: 0, lastSnapshotAt: null };
        }

        res.json({ ok: true, insights, persisted });
    } catch (e) {
        log(`[BACKBONE_INSIGHTS] endpoint error: ${e.message}`, 'WARN');
        res.json({
            ok: true,
            insights:  emptyBackboneInsights({ windowDays }),
            persisted: { available: false, activeCount: 0, criticalCount: 0, warningCount: 0, lastSnapshotAt: null },
        });
    }
});

// ---------------------------------------------------------------------------
// DATA BACKBONE — alertas persistidas (Sprint 6C)
// ---------------------------------------------------------------------------
//
// Cinco endpoints para gestionar el ciclo de vida de las alertas:
//   POST /api/metrics/insights/snapshot         → corre el state engine
//   GET  /api/metrics/insights/states           → lista states con filtros
//   POST /api/metrics/insights/:key/ack         → ack
//   POST /api/metrics/insights/:key/dismiss     → dismiss N días
//   GET  /api/metrics/insights/notifications    → cola pending
//
// Política de errores idéntica a /api/metrics/insights: nunca 500 si la
// telemetría base sigue funcionando. Si insights.db falla, devolvemos
// vacíos y log WARN.

async function requireAdminOrMediator(req, res) {
    if (await isAdminRequest(req)) return true;
    const { users } = loadAndInitMetrics();
    const requester = resolveRequester(req, users);
    if (!requester || !isMediatorRole(requester)) {
        res.status(403).json({ error: 'Acceso denegado' });
        return false;
    }
    return true;
}

app.post('/api/metrics/insights/snapshot', async (req, res) => {
    if (!(await requireAdminOrMediator(req, res))) return;
    const body = req.body ?? {};
    const windowDays = (() => {
        const raw = typeof body.windowDays === 'number' ? body.windowDays : 30;
        if (!Number.isFinite(raw) || raw <= 0) return 30;
        return Math.min(raw, 180);
    })();
    const scope = {
        level: typeof body.scope?.level === 'string' ? body.scope.level : 'global',
        id:    typeof body.scope?.id === 'string'    ? body.scope.id    : null,
    };
    const actorId = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : null;

    try {
        ensureInsightsDbOpen();
        const result   = getBackboneEventsForMetrics({ windowDays });
        const meta     = { windowDays: result.windowDays, windowFrom: result.windowFrom, windowTo: result.windowTo };
        const metrics  = aggregateBackboneMetrics(result.events, meta);
        const funnels  = computeBackboneFunnels(result.events, meta);
        const insights = computeBackboneInsights({ metrics, funnels, windowDays });
        const r = processInsightsSnapshot({ insights, scope, windowDays, actorId });
        log(`[INSIGHTS_SNAPSHOT] scope=${scope.level} new=${r.statesNew} updated=${r.statesUpdated} resolved=${r.statesResolved} notif=${r.notificationsCreated}`, 'INFO');
        res.json({
            ok: true,
            snapshotId:           r.snapshotId,
            stateSummary:         r.stateSummary,
            notificationsCreated: r.notificationsCreated,
            insightsPersisted:    r.insightsPersisted,
        });
    } catch (e) {
        log(`[INSIGHTS_SNAPSHOT] error: ${e.message}`, 'WARN');
        res.status(200).json({ ok: false, error: e.message });
    }
});

app.get('/api/metrics/insights/states', async (req, res) => {
    if (!(await requireAdminOrMediator(req, res))) return;
    try {
        ensureInsightsDbOpen();
        const filters = {
            scopeLevel: typeof req.query.scopeLevel === 'string' ? req.query.scopeLevel : undefined,
            scopeId:    typeof req.query.scopeId    === 'string' ? req.query.scopeId    : undefined,
            status:     typeof req.query.status     === 'string' ? req.query.status     : undefined,
            severity:   typeof req.query.severity   === 'string' ? req.query.severity   : undefined,
            limit:      Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1000),
        };
        const rows = listInsightStates(filters);
        // Mapeo a camelCase para el frontend; payload se rehidrata desde JSON.
        const states = rows.map(r => ({
            insightKey:        r.insight_key,
            scopeLevel:        r.scope_level,
            scopeId:           r.scope_id,
            type:              r.type,
            severity:          r.severity,
            title:             r.title,
            status:            r.status,
            firstSeenAt:       r.first_seen_at,
            lastSeenAt:        r.last_seen_at,
            lastValue:         r.last_value,
            previousValue:     r.previous_value,
            deltaValue:        r.delta_value,
            occurrences:       r.occurrences,
            dismissedUntil:    r.dismissed_until,
            acknowledgedAt:    r.acknowledged_at,
            acknowledgedBy:    r.acknowledged_by,
            insight:           safeJsonParse(r.last_payload_json),
            updatedAt:         r.updated_at,
        }));
        res.json({ ok: true, states, total: states.length });
    } catch (e) {
        log(`[INSIGHTS_STATES] error: ${e.message}`, 'WARN');
        res.json({ ok: false, states: [], total: 0, error: e.message });
    }
});

app.post('/api/metrics/insights/:insightKey/ack', async (req, res) => {
    if (!(await requireAdminOrMediator(req, res))) return;
    const insightKey = String(req.params.insightKey ?? '');
    const actorId = (req.body && typeof req.body.actorId === 'string')
        ? req.body.actorId
        : (typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : 'unknown');
    if (!insightKey) return res.status(400).json({ error: 'insightKey required' });

    try {
        ensureInsightsDbOpen();
        const ok = ackInsightState(insightKey, actorId, Date.now());
        if (!ok) return res.status(404).json({ ok: false, error: 'state not found' });
        res.json({ ok: true });
    } catch (e) {
        log(`[INSIGHTS_ACK] error: ${e.message}`, 'WARN');
        res.json({ ok: false, error: e.message });
    }
});

app.post('/api/metrics/insights/:insightKey/dismiss', async (req, res) => {
    if (!(await requireAdminOrMediator(req, res))) return;
    const insightKey = String(req.params.insightKey ?? '');
    const days = (() => {
        const raw = (req.body && typeof req.body.days === 'number') ? req.body.days : 7;
        if (!Number.isFinite(raw) || raw <= 0) return 7;
        return Math.min(raw, 180);
    })();
    if (!insightKey) return res.status(400).json({ error: 'insightKey required' });

    try {
        ensureInsightsDbOpen();
        const dismissedUntil = Date.now() + days * 86_400_000;
        const ok = dismissInsightState(insightKey, dismissedUntil, Date.now());
        if (!ok) return res.status(404).json({ ok: false, error: 'state not found' });
        res.json({ ok: true, dismissedUntil });
    } catch (e) {
        log(`[INSIGHTS_DISMISS] error: ${e.message}`, 'WARN');
        res.json({ ok: false, error: e.message });
    }
});

app.get('/api/metrics/insights/notifications', async (req, res) => {
    if (!(await requireAdminOrMediator(req, res))) return;
    try {
        ensureInsightsDbOpen();
        const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
        const limit  = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
        const rows   = listInsightNotifications({ status, limit });
        const notifications = rows.map(r => ({
            notificationId: r.notification_id,
            insightKey:     r.insight_key,
            scopeLevel:     r.scope_level,
            scopeId:        r.scope_id,
            severity:       r.severity,
            channel:        r.channel,
            status:         r.status,
            createdAt:      r.created_at,
            sentAt:         r.sent_at,
            payload:        safeJsonParse(r.payload_json),
        }));
        res.json({ ok: true, notifications, total: notifications.length });
    } catch (e) {
        log(`[INSIGHTS_NOTIF] error: ${e.message}`, 'WARN');
        res.json({ ok: false, notifications: [], total: 0, error: e.message });
    }
});

function safeJsonParse(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------------------
// REPORT ENDPOINTS
// ---------------------------------------------------------------------------

// GET /api/reports/course/:courseId
// Report-ready version of course metrics. Adds reportMeta for direct rendering.
// Requires: admin OR mediator assigned to that course.
app.get('/api/reports/course/:courseId', async (req, res) => {
    const { courseId }      = req.params;
    const { groups, users } = loadAndInitMetrics();
    const requester         = resolveRequester(req, users);
    const adminAccess       = await isAdminRequest(req);
    const mediatorAccess    = requester && isMediatorRole(requester) &&
                              isMediatorOfCourse(requester, courseId, groups);

    if (!adminAccess && !mediatorAccess) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }

    try {
        const raw      = computeCourseMetrics(courseId);
        const group    = groups.find(g => g.id === courseId);
        const response = formatCourseResponse(raw, users);

        // Compute dataWindow from engine's StudentMetrics[] (before formatting strips it)
        const dataWindow = computeCourseDataWindow(raw.studentBreakdown);

        response.reportMeta = {
            generatedAt: new Date().toISOString(),
            entityType:  'course',
            entityId:    raw.courseId,
            entityName:  raw.courseName,
            school:      group?.school          ?? null,
            schoolId:    group?.school ? schoolNameToSlug(group.school) : null,
            grade:       group?.grade           ?? null,
            groupType:   group?.type            ?? 'course',
            dataWindow,
        };

        res.json(response);
    } catch (e) {
        log(`Report course error (${courseId}): ${e.message}`, 'ERROR');
        const status = e.message.includes('not found') ? 404 : 500;
        res.status(status).json({ error: e.message });
    }
});

// GET /api/reports/school/:schoolId
// Report-ready version of school metrics. Accepts slug or name.
// Requires: admin secret only.
app.get('/api/reports/school/:schoolId', async (req, res) => {
    if (!(await isAdminRequest(req))) {
        return res.status(403).json({ error: 'Acceso denegado: solo administradores' });
    }
    const { groups }   = loadAndInitMetrics();
    const input        = decodeURIComponent(req.params.schoolId);
    const schoolRecord = resolveSchoolRecord(input, groups);

    if (!schoolRecord) {
        return res.status(404).json({ error: `No se encontraron grupos para: ${input}` });
    }

    try {
        const raw      = computeSchoolMetrics(schoolRecord.schoolName);
        const response = formatSchoolResponse(raw, schoolRecord);

        response.reportMeta = {
            generatedAt: new Date().toISOString(),
            entityType:  'school',
            entityId:    schoolRecord.schoolId,
            entityName:  schoolRecord.schoolName,
            courseCount: raw.courseCount,
            dataWindow:  null, // school-level window not computed (too expensive for sparse data)
        };

        res.json(response);
    } catch (e) {
        log(`Report school error (${schoolRecord.schoolName}): ${e.message}`, 'ERROR');
        res.status(500).json({ error: e.message });
    }
});

// ---------------------------------------------------------------------------
// CHIBALETE LU — CONTRATOS CANÓNICOS
// Endpoints estables para Chibalete LU como cliente liviano del mismo backend.
// Auth: requireUserAuth (x-user-id con cuenta activa).
// ---------------------------------------------------------------------------

// GET /api/auth/me
// Devuelve identidad, roles y colegio del usuario autenticado.
// LU lo usa al arranque para saber qué experiencia mostrar.
app.get('/api/auth/me', requireUserAuth, (req, res) => {
    const u = req.user;
    const roles = Array.isArray(u.roles) ? u.roles : (u.rol ? [u.rol] : []);
    res.json({
        id: u.id,
        nombre: u.nombre_completo ?? u.nombre ?? null,
        email: u.email,
        roles,
        colegio: u.colegio ?? null,
        accountStatus: u.accountStatus ?? 'active',
    });
});

// GET /api/content/my-catalog
// Devuelve solo el contenido accesible para el usuario autenticado.
// LU no reimplementa lógica de permisos: consulta este endpoint.
app.get('/api/content/my-catalog', requireUserAuth, (req, res) => {
    try {
        const userId = req.user.id;
        const { titleIds, collectionIds } = getAccessibleContentIds(userId);
        const allContent = readJSON(DB_FILE);

        const catalog = allContent.filter(item =>
            titleIds.includes(item.id) ||
            (item.collectionId && collectionIds.includes(item.collectionId))
        );

        res.json({
            success: true,
            catalog: catalog.map(item => ({
                id: item.id,
                title: item.title ?? item.titulo ?? null,
                type: item.type ?? item.tipo ?? null,
                coverImage: item.coverImage ?? item.portada ?? null,
                collectionId: item.collectionId ?? null,
            })),
        });
    } catch (e) {
        log(`GET my-catalog error (userId=${req.user.id}): ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al obtener catálogo' });
    }
});

// GET /api/progress/my/:contentId
// Devuelve el progreso del usuario autenticado para un contenido.
// LU usa x-user-id en header; no expone userId en la URL.
app.get('/api/progress/my/:contentId', requireUserAuth, (req, res) => {
    try {
        const userId = req.user.id;
        const { contentId } = req.params;
        const progress = getProgressItem(userId, contentId) ?? null;
        res.json({ success: true, progress });
    } catch (e) {
        log(`GET progress/my error (userId=${req.user?.id}): ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al obtener progreso' });
    }
});

// POST /api/progress/my/:contentId
// Sincroniza el progreso del usuario autenticado para un contenido.
// Misma lógica que /api/progress/:userId/:contentId/sync pero con userId desde sesión.
app.post('/api/progress/my/:contentId', requireUserAuth, (req, res) => {
    try {
        const userId = req.user.id;
        const { contentId } = req.params;
        const payload = req.body;

        if (!payload.canonicalProgress) {
            return res.status(400).json({ error: 'Falta objeto canonicalProgress' });
        }

        const key = makeProgressKey(userId, contentId);
        const existing = getProgressItem(userId, contentId);
        const incomingDate = payload.updatedAt || new Date().toISOString();

        if (existing && !shouldAcceptIncomingProgress(incomingDate, existing.updatedAt)) {
            log(`LU concurrencia: progreso ignorado por ser más viejo (${key})`, 'DEBUG');
            return res.json({ success: true, ignored: true, progress: existing });
        }

        const newProgress = {
            id: key,
            userId,
            contentId,
            isCompleted: payload.isCompleted || (existing?.isCompleted || false),
            canonicalProgress: normalizeCanonicalProgress(payload.canonicalProgress),
            updatedAt: incomingDate,
            history: mergeHistoryWithLimit(existing?.history || [], payload.session),
        };

        upsertProgress(newProgress);

        res.json({ success: true, progress: newProgress });
    } catch (e) {
        log(`POST progress/my error (userId=${req.user?.id}): ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al sincronizar progreso' });
    }
});

// ---------------------------------------------------------------------------
// INTERVENTIONS — mediator intervention log
// ---------------------------------------------------------------------------

function readInterventionsDb() {
    try {
        const data = readJSON(INTERVENTIONS_DB);
        return Array.isArray(data?.interventions) ? data : { interventions: [] };
    } catch { return { interventions: [] }; }
}

function writeInterventionsDb(data) {
    writeJSON(INTERVENTIONS_DB, data);
}

/**
 * POST /api/interventions
 * Create a new pedagogical intervention record.
 * Body: { studentId, courseId, type, note, contentId?, patternsAtIntervention[], readingTimeMsAtIntervention }
 * Auth: mediador or administrador
 */
app.post('/api/interventions', requireUserAuth, async (req, res) => {
    try {
        const requester = req.user;
        if (!isMediatorRole(requester) && !(requester.roles ?? []).includes('administrador')) {
            return res.status(403).json({ error: 'Solo mediadores pueden registrar intervenciones' });
        }
        const { studentId, courseId, type, note, contentId, patternsAtIntervention, readingTimeMsAtIntervention } = req.body;
        if (!studentId || !courseId || !type) {
            return res.status(400).json({ error: 'Faltan campos: studentId, courseId, type' });
        }
        const intervention = {
            id:                          crypto.randomUUID(),
            mediatorId:                  requester.id,
            studentId,
            courseId,
            type:                        String(type).slice(0, 60),
            note:                        note ? String(note).slice(0, 500) : '',
            contentId:                   contentId ?? null,
            patternsAtIntervention:      Array.isArray(patternsAtIntervention) ? patternsAtIntervention : [],
            readingTimeMsAtIntervention: Number(readingTimeMsAtIntervention) || 0,
            createdAt:                   new Date().toISOString(),
        };
        await mutateInterventions((db) => {
            db.interventions.push(intervention);
            writeJSON(INTERVENTIONS_DB, db);
        });
        log(`Intervention created: mediator=${requester.id} student=${studentId} type=${type}`, 'INFO');
        res.status(201).json({ success: true, intervention });
    } catch (e) {
        log(`POST /api/interventions error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al guardar intervención' });
    }
});

/**
 * GET /api/interventions/course/:courseId
 * Get all interventions for students in a course.
 * Auth: mediador or administrador
 */
app.get('/api/interventions/course/:courseId', requireUserAuth, (req, res) => {
    try {
        const requester = req.user;
        if (!isMediatorRole(requester) && !(requester.roles ?? []).includes('administrador')) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        const { courseId } = req.params;
        const db = readInterventionsDb();
        const interventions = db.interventions
            .filter(i => i.courseId === courseId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // most recent first
        res.json({ success: true, courseId, interventions });
    } catch (e) {
        log(`GET /api/interventions/course error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al obtener intervenciones' });
    }
});

/**
 * GET /api/interventions/student/:studentId
 * Full intervention history for one student with computed impact.
 * Auth: mediador or administrador
 */
app.get('/api/interventions/student/:studentId', requireUserAuth, (req, res) => {
    try {
        const requester = req.user;
        if (!isMediatorRole(requester) && !(requester.roles ?? []).includes('administrador')) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        const { studentId } = req.params;
        const iDb      = readInterventionsDb();
        const pDb      = getAllProgressAsMap();
        const timeMap  = buildStudentReadingTimeMap(pDb);
        const timelines = buildStudentSessionTimelines(pDb);
        const history  = buildStudentInterventionHistory(iDb.interventions, studentId, timeMap, timelines);
        res.json({ success: true, studentId, history });
    } catch (e) {
        log(`GET /api/interventions/student error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

/**
 * GET /api/interventions/effectiveness
 * Aggregated effectiveness analytics.
 * Query params: courseId (optional, scopes to one course)
 * Auth: mediador or administrador
 */
app.get('/api/interventions/effectiveness', requireUserAuth, (req, res) => {
    try {
        const requester = req.user;
        if (!isMediatorRole(requester) && !(requester.roles ?? []).includes('administrador')) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        const { courseId } = req.query;
        const iDb = readInterventionsDb();
        const pDb = getAllProgressAsMap();

        let interventions = iDb.interventions;
        if (courseId) {
            interventions = interventions.filter(iv => iv.courseId === courseId);
        }

        const timeMap      = buildStudentReadingTimeMap(pDb);
        const timelines    = buildStudentSessionTimelines(pDb);
        const leoRaw       = readJSON(LEO_INTERACTIONS_DB) || [];
        const leoByUser    = buildStudentLeoInteractionsMap(leoRaw);

        // Pass timelines to get temporal + dimension breakdowns in per-type stats
        const effectivenessByType = computeEffectivenessByType(interventions, timeMap, timelines);
        const successPatterns     = computeSuccessPatterns(interventions, timeMap);

        const totalInterventions     = interventions.length;
        const totalImproved          = effectivenessByType.reduce((s, e) => s + e.improved, 0);
        const overallImprovementRate = totalInterventions > 0 ? totalImproved / totalInterventions : 0;

        // Temporal aggregate rates — exclude interventions < 3 days old (too early)
        const NOW           = Date.now();
        const MS_3_DAYS     = 3 * 86_400_000;
        const assessable    = interventions.filter(iv => NOW - new Date(iv.createdAt).getTime() >= MS_3_DAYS);
        const totalAssessed = assessable.length;

        let overallImmediateRate = 0;
        let overallSustainedRate = 0;

        if (totalAssessed > 0) {
            let immediate = 0;
            let sustained = 0;
            for (const iv of assessable) {
                const sessions = timelines[iv.studentId] ?? [];
                const { temporalImpact } = computeTemporalImpact(iv, sessions);
                if (temporalImpact === 'immediate_improvement') immediate++;
                else if (temporalImpact === 'sustained_improvement') sustained++;
            }
            overallImmediateRate = immediate / totalAssessed;
            overallSustainedRate = sustained / totalAssessed;
        }

        // Pedagogical profiles — compute for all students who have interventions in scope
        const studentIds = [...new Set(interventions.map(iv => iv.studentId))];
        const studentPedagogicalProfiles = {};
        for (const uid of studentIds) {
            studentPedagogicalProfiles[uid] = computePedagogicalProfile(
                timelines[uid] ?? [],
                leoByUser[uid] ?? []
            );
        }
        const coursePedagogicalProfile = aggregateCoursePedagogicalProfile(studentPedagogicalProfiles);

        // Top 2 most effective types (need >=2 samples to include)
        const topTypes = effectivenessByType
            .filter(e => e.total >= 2)
            .slice(0, 2);

        res.json({
            success: true,
            courseId:                    courseId ?? null,
            totalInterventions,
            totalImproved,
            overallImprovementRate,
            overallImmediateRate,
            overallSustainedRate,
            totalAssessed,
            effectivenessByType,
            topTypes,
            successPatterns:             successPatterns.slice(0, 15),
            coursePedagogicalProfile,
            computedAt:                  Date.now(),
        });
    } catch (e) {
        log(`GET /api/interventions/effectiveness error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al calcular efectividad' });
    }
});

// ---------------------------------------------------------------------------
// READING PROGRESS — new canonical endpoints
// ---------------------------------------------------------------------------

// GET /api/reading-progress/:userId
// Returns computed ReadingProgress for every content this user has touched.
// Auth: owner OR admin OR mediador
app.get('/api/reading-progress/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const users = readJSON(USERS_DB);
        const requester  = resolveRequester(req, users);
        const isOwner    = requester?.id === userId;
        const isAdmin    = (await isAdminRequest(req)) || (requester && (requester.roles ?? []).includes('administrador'));
        const isMediator = requester && isMediatorRole(requester);
        if (!isOwner && !isAdmin && !isMediator) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        if (!users.find(u => u.id === userId)) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        const db  = getAllProgressAsMap();
        const cMap = buildContentMap();
        const entries = Object.values(db.progressMap).filter(p => p.userId === userId);
        const readingProgress = entries.map(raw => {
            const rp = computeReadingProgress(raw);
            rp.title = resolveContentTitle(rp.contentId, cMap);
            rp.type  = cMap.get(rp.contentId)?.type ?? null;
            return rp;
        });
        const summary = {
            total:      readingProgress.length,
            inProgress: readingProgress.filter(p => p.status === 'in_progress').length,
            completed:  readingProgress.filter(p => p.status === 'completed').length,
            abandoned:  readingProgress.filter(p => p.status === 'abandoned').length,
        };
        res.json({ success: true, userId, summary, readingProgress });
    } catch (e) {
        log(`GET reading-progress/${req.params.userId} error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al obtener progreso de lectura' });
    }
});

// GET /api/reading-progress/:userId/:contentId
// Returns computed ReadingProgress for a single content.
app.get('/api/reading-progress/:userId/:contentId', async (req, res) => {
    try {
        const { userId, contentId } = req.params;
        const users = readJSON(USERS_DB);
        const requester  = resolveRequester(req, users);
        const isOwner    = requester?.id === userId;
        const isAdmin    = (await isAdminRequest(req)) || (requester && (requester.roles ?? []).includes('administrador'));
        const isMediator = requester && isMediatorRole(requester);
        if (!isOwner && !isAdmin && !isMediator) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        const key = makeProgressKey(userId, contentId);
        const db  = getAllProgressAsMap();
        const raw = db.progressMap[key];
        const readingProgress = raw ? computeReadingProgress(raw) : notStartedProgress(userId, contentId);
        res.json({ success: true, readingProgress });
    } catch (e) {
        log(`GET reading-progress/${req.params.userId}/${req.params.contentId} error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Error al obtener progreso de lectura' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/playback-events
// Recibe batch de eventos de ritmo narrativo y los persiste en JSONL.
// Formato por línea: { event, ts, serverTs, userId, sessionId, contentId, ...campos }
// Append-only — nunca lee, nunca modifica. Analizable offline con analyze_rhythm.js.
// ---------------------------------------------------------------------------
app.post('/api/playback-events', (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).end();

        const events = req.body?.events;
        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'events[] required' });
        }
        // Cap por request — previene abuso sin complejidad de rate-limit adicional
        if (events.length > 50) return res.status(400).json({ error: 'max 50 events per request' });

        const serverTs = Date.now();
        const lines = events
            .filter(e => typeof e?.event === 'string' && e.event.length > 0 && e.event.length < 64)
            .map(e => JSON.stringify({ ...e, userId, serverTs }))
            .join('\n');

        if (!lines) return res.json({ ok: true, received: 0 });

        // appendFile es async — la respuesta va antes de que el disco confirme.
        // Aceptable: un evento perdido en un crash es preferible a bloquear el event loop.
        fs.appendFile(PLAYBACK_EVENTS_LOG, lines + '\n', err => {
            if (err) log(`[PLAYBACK_EVENTS] Write error: ${err.message}`, 'WARN');
        });

        // ── DUAL-WRITE Backbone v1 (Fase 0) ──────────────────────────────────
        // Espejo en events.db. Best-effort, no bloquea el response.
        try {
            const dualResult = dualWritePlaybackEventsToBackbone(events, userId);
            log(`[EVENTS_V1] dual-write playback: accepted=${dualResult.accepted} dedup=${dualResult.deduplicated} rejected=${dualResult.rejected}`, 'INFO');
        } catch (e) {
            log(`[EVENTS_V1] dual-write playback error: ${e.message}`, 'WARN');
        }

        res.json({ ok: true, received: events.length });
    } catch (e) {
        // Falla silenciosa intencionada: analytics nunca debe interrumpir la experiencia
        log(`[PLAYBACK_EVENTS] Unexpected error: ${e.message}`, 'WARN');
        res.json({ ok: true });
    }
});

// POST /api/events
// Recibe eventos de playback y los escribe al log del servidor.
// Fire-and-forget desde el cliente — nunca bloquea el flujo de audio.
// Requiere x-user-id para correlación — rechaza sin él (evita spam anónimo).
app.post('/api/events', (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(400).end();
        const { event, ts, ...rest } = req.body ?? {};
        if (typeof event !== 'string') return res.status(400).json({ error: 'event required' });
        log(`[EVENT] ${event} user=${userId} ts=${ts ?? Date.now()} ${JSON.stringify(rest)}`);

        // ── DUAL-WRITE Backbone v1 (Fase 0) ──────────────────────────────────
        // Antes los eventos warn-level del Inmersivo (manifest_fail, tts_fail,
        // blob_invalid, autoplay_blocked, etc.) sólo iban al log del proceso y se
        // perdían en cada reinicio. Ahora también se persisten en events.db.
        try {
            const dualResult = dualWriteSingleEventToBackbone(event, ts, rest, userId);
            if (dualResult.accepted || dualResult.deduplicated) {
                log(`[EVENTS_V1] dual-write event: accepted=${dualResult.accepted} dedup=${dualResult.deduplicated}`, 'INFO');
            } else if (dualResult.rejected) {
                log(`[EVENTS_V1] dual-write event rejected (${dualResult.reason})`, 'WARN');
            }
        } catch (e) {
            log(`[EVENTS_V1] dual-write event error: ${e.message}`, 'WARN');
        }

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: 'Error logging event' });
    }
});

// ---------------------------------------------------------------------------
// DATA BACKBONE v1 — POST /api/v1/events
// Endpoint nuevo, en paralelo a los 3 endpoints legacy.
// Recibe eventos canonicalizados ya con shape BackboneEvent. Valida estricto,
// dedupa por event_id UNIQUE en SQLite (atomic INSERT OR IGNORE), responde
// contadores. Nunca rompe el batch entero por un evento malformed.
// ---------------------------------------------------------------------------
app.post('/api/v1/events', (req, res) => {
    try {
        const headerUserId = req.headers['x-user-id'];
        if (!headerUserId) {
            return res.status(401).json({ error: 'x-user-id required' });
        }

        const events = req.body?.events;
        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'events array required' });
        }
        if (events.length > 50) {
            return res.status(400).json({ error: 'max 50 events per batch' });
        }

        let accepted     = 0;
        let deduplicated = 0;
        let rejected     = 0;
        const errors     = [];

        for (const incoming of events) {
            // Si el cliente no envió eventId, generamos uno en backend.
            // Sprint 5A: marcar payload._source = 'native' por defecto. Si el
            // cliente ya viene con _source (por ejemplo replays internos) no
            // se sobrescribe.
            const evt = incoming && typeof incoming === 'object'
                ? {
                    ...incoming,
                    eventId: incoming.eventId || ulid(),
                    payload: {
                        ...(incoming.payload || {}),
                        _source: incoming.payload?._source || 'native',
                    },
                }
                : incoming;

            const v = validateBackboneEvent(evt, headerUserId);
            if (!v.ok) {
                rejected += 1;
                errors.push({ eventId: evt?.eventId ?? null, error: v.error });
                continue;
            }
            try {
                const wasInserted = insertBackboneEvent(evt);
                if (wasInserted) accepted += 1;
                else            deduplicated += 1;
            } catch (e) {
                rejected += 1;
                errors.push({ eventId: evt.eventId, error: 'insert failed' });
                log(`[EVENTS_V1] insert error eventId=${evt.eventId}: ${e.message}`, 'WARN');
            }
        }

        log(`[EVENTS_V1] POST /api/v1/events accepted=${accepted} dedup=${deduplicated} rejected=${rejected}`, 'INFO');
        const response = { ok: true, accepted, deduplicated, rejected };
        if (errors.length > 0 && !IS_PROD) response.errors = errors;
        res.json(response);
    } catch (e) {
        log(`[EVENTS_V1] handler error: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to ingest events' });
    }
});

// ---------------------------------------------------------------------------
// Helpers internos del Backbone v1 — transformación legacy → BackboneEvent.
//
// La inferencia de `mode` desde un evento legacy es heurística: el shape
// histórico no tiene un campo `mode` explícito, así que mapeamos por
// `source`, por nombre del evento y por presencia de campos típicos. El
// resultado puede no coincidir 100% con la realidad (un block_complete
// indistinguible entre Texto e Inmersivo, por ejemplo), pero es la mejor
// señal disponible sin tocar el frontend en Fase 0.
//
// Cuando los visores migren al endpoint v1, mandarán `mode` explícito y
// estos helpers dejarán de usarse. Los mantenemos solo como shim.
// ---------------------------------------------------------------------------

const ALBUM_LEGACY_EVENT_NAMES = new Set([
    'route_selected', 'route_completed', 'region_visited', 'page_advance',
    'leo_intervention_shown', 'leo_intervention_dismissed', 'leo_intervention_engaged',
    'overlay_opened', 'overlay_closed', 'reread_started', 'reread_completed',
    'album_session_start', 'album_session_end',
]);

const IMMERSIVE_LEGACY_EVENT_NAMES = new Set([
    'transition_to_next_content', 'streak_break', 'level_up',
]);

function inferModeFromLegacyAnalyticsEvent(legacyEvent) {
    // 1. Pista explícita
    if (legacyEvent?.source === 'pdf') return 'pdf';

    // 2. Nombres únicos de cada visor
    if (legacyEvent?.event === 'page_change' || typeof legacyEvent?.pageNumber === 'number') {
        return 'pdf';
    }
    if (legacyEvent?.event === 'session_heartbeat') {
        // Hoy solo VisorPDF arranca heartbeat (analyticsService.startHeartbeat).
        return 'pdf';
    }
    if (IMMERSIVE_LEGACY_EVENT_NAMES.has(legacyEvent?.event)) {
        return 'immersive';
    }
    if (ALBUM_LEGACY_EVENT_NAMES.has(legacyEvent?.event)) {
        return 'album';
    }
    // 3. Default conservador: VisorTexto es el caso más común sin pista explícita.
    return 'text';
}

function legacyEventNameToBackbone(mode, legacyName) {
    // Ya cumple {mode}.{action} si el legacy era prefijado (no es el caso hoy).
    if (typeof legacyName === 'string' && /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/.test(legacyName)) {
        return legacyName;
    }
    // Sanitización mínima: minúsculas, espacios → _, no-letras → quitar.
    const action = String(legacyName || 'unknown')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'unknown';
    return `${mode}.${action}`;
}

function transformAnalyticsLegacyToBackbone(legacyEvent, headerUserId) {
    const mode = inferModeFromLegacyAnalyticsEvent(legacyEvent);
    // sessionId: si trae uno (createAlbumEmitter lo agrega), úsalo. Si no, genera
    // uno por evento — la correlación se pierde, pero los datos llegan.
    const sessionId = typeof legacyEvent.sessionId === 'string' && legacyEvent.sessionId
        ? legacyEvent.sessionId
        : `legacy-${ulid()}`;

    const eventId = isValidUlid(legacyEvent.eventId) ? legacyEvent.eventId : ulid();

    // Campos canónicos quedan en columnas; el resto va al payload.
    const {
        event: _event, userId: _userId, contentId: _contentId, timestamp: _timestamp,
        sessionId: _sessionId, eventId: _eventId, sessionDuration, elapsedMs,
        progressPercentage, ...rest
    } = legacyEvent;

    return {
        eventId,
        schemaVersion: 1,
        event: legacyEventNameToBackbone(mode, legacyEvent.event),
        mode,
        userId: legacyEvent.userId,
        contentId: legacyEvent.contentId ?? null,
        sessionId,
        clientTs: typeof legacyEvent.timestamp === 'number' ? legacyEvent.timestamp : Date.now(),
        elapsedMs: typeof elapsedMs === 'number' ? elapsedMs
                  : typeof sessionDuration === 'number' ? sessionDuration
                  : undefined,
        progressFraction: typeof progressPercentage === 'number'
            ? Math.max(0, Math.min(1, progressPercentage / 100))
            : undefined,
        // Sprint 5A: dual-write siempre marca _source='legacy' para que el
        // agregador pueda priorizar eventos nativos cuando coexisten.
        payload: { ...rest, _source: 'legacy' },
    };
}

function dualWriteAnalyticsEventsToBackbone(legacyEvents, headerUserId) {
    let accepted = 0, deduplicated = 0, rejected = 0;
    for (const legacy of legacyEvents) {
        try {
            const backbone = transformAnalyticsLegacyToBackbone(legacy, headerUserId);
            const v = validateBackboneEvent(backbone, headerUserId);
            if (!v.ok) { rejected += 1; continue; }
            const inserted = insertBackboneEvent(backbone);
            if (inserted) accepted += 1; else deduplicated += 1;
        } catch (e) {
            rejected += 1;
        }
    }
    return { accepted, deduplicated, rejected };
}

function dualWritePlaybackEventsToBackbone(legacyEvents, userId) {
    let accepted = 0, deduplicated = 0, rejected = 0;
    for (const legacy of legacyEvents) {
        try {
            // /api/playback-events viene del Modo Inmersivo (usePlaybackAnalytics).
            // mode es siempre 'immersive'.
            const sessionId = typeof legacy.sessionId === 'string' && legacy.sessionId
                ? legacy.sessionId
                : `legacy-${ulid()}`;
            const eventId = isValidUlid(legacy.eventId) ? legacy.eventId : ulid();
            const {
                event: _event, sessionId: _sessionId, eventId: _eventId,
                userId: _u, contentId: _c, ts, serverTs, ...rest
            } = legacy;
            const backbone = {
                eventId,
                schemaVersion: 1,
                event: legacyEventNameToBackbone('immersive', legacy.event),
                mode: 'immersive',
                userId,
                contentId: typeof legacy.contentId === 'string' ? legacy.contentId : null,
                sessionId,
                clientTs: typeof ts === 'number' ? ts : Date.now(),
                payload: { ...rest, _source: 'legacy' },
            };
            const v = validateBackboneEvent(backbone, userId);
            if (!v.ok) { rejected += 1; continue; }
            const inserted = insertBackboneEvent(backbone);
            if (inserted) accepted += 1; else deduplicated += 1;
        } catch (e) {
            rejected += 1;
        }
    }
    return { accepted, deduplicated, rejected };
}

function dualWriteSingleEventToBackbone(eventName, ts, rest, userId) {
    try {
        // /api/events lo usa useImmersivePlayback.pbLog para warn-level
        // (manifest_fail, tts_fail, blob_invalid, autoplay_blocked, etc.).
        // mode = 'immersive' siempre.
        const sessionId = typeof rest?.sessionId === 'string' && rest.sessionId
            ? rest.sessionId
            : `legacy-${ulid()}`;
        const eventId = isValidUlid(rest?.eventId) ? rest.eventId : ulid();
        const contentId = typeof rest?.contentId === 'string' ? rest.contentId : null;
        const {
            sessionId: _s, eventId: _e, contentId: _c, ...payload
        } = rest || {};
        const backbone = {
            eventId,
            schemaVersion: 1,
            event: legacyEventNameToBackbone('immersive', eventName),
            mode: 'immersive',
            userId,
            contentId,
            sessionId,
            clientTs: typeof ts === 'number' ? ts : Date.now(),
            payload: { ...payload, _source: 'legacy' },
        };
        const v = validateBackboneEvent(backbone, userId);
        if (!v.ok) return { accepted: 0, deduplicated: 0, rejected: 1, reason: v.error };
        const inserted = insertBackboneEvent(backbone);
        return inserted
            ? { accepted: 1, deduplicated: 0, rejected: 0 }
            : { accepted: 0, deduplicated: 1, rejected: 0 };
    } catch (e) {
        return { accepted: 0, deduplicated: 0, rejected: 1, reason: e.message };
    }
}


// --- STATIC FILES ---
app.use('/uploads', express.static(UPLOAD_DIR));

if (IS_PROD) {
    const DIST_DIR = path.join(__dirname, '../dist');
    const INDEX_HTML = path.join(DIST_DIR, 'index.html');
    app.use(express.static(DIST_DIR));
    app.use((req, res) => {
        // R4: fs.existsSync guard — si dist no existe (api container sin front),
        // devolver 404 JSON en vez de 500 ENOENT al intentar sendFile.
        if (req.accepts('html') && fs.existsSync(INDEX_HTML)) {
            res.sendFile(INDEX_HTML);
        } else {
            res.status(404).json({ error: 'Not Found' });
        }
    });
}

app.listen(PORT, '0.0.0.0', () => {
    log(`Server running on port ${PORT}`);
    setTimeout(checkMissingTTS, 2000);
    // Build upload dedup index in background — never blocks startup
    buildHashIndex(UPLOAD_DIR, UPLOAD_DIR)
        .then(() => log(`[HASH_INDEX] Built: ${uploadHashIndex.size} entries`, 'INFO'))
        .catch(e => log(`[HASH_INDEX] Build failed (dedup disabled): ${e.message}`, 'WARN'));
});
