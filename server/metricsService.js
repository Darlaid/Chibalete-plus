/**
 * metricsService.js — Server-side metrics computation (plain JS port of metricsEngine.ts).
 *
 * Identical computation logic; TypeScript types removed.
 * Call init(rawData) with loaded JSON databases, then call compute* functions.
 *
 * Usage in server.js:
 *   import { init, computeStudentMetrics, computeCourseMetrics, computeSchoolMetrics }
 *     from './metricsService.js';
 *   init({ events, leoMemory, progress, groups, users });
 *
 * Sprint 021 Fase 2 — la resolución de miembros de grupo se delega a
 * groupMembershipService.getGroupMembers (fuente única de verdad). Antes este
 * archivo tenía su propia copia de getGroupStudentIds — eliminada.
 */

import { getGroupMembers } from './groupMembershipService.js';

// ---------------------------------------------------------------------------
// MODULE STATE
// ---------------------------------------------------------------------------

let _events           = [];
let _leoMemory        = { memoryMap: {} };
let _leoInteractions  = [];   // leo_interactions_db.json entries
let _progress         = { progressMap: {} };
let _groups           = [];
let _users            = [];
let _initialized      = false;

/**
 * Generación de los datos cargados. Se incrementa en cada `init()`.
 *
 * Un `MetricsRequestContext` guarda la generación con la que se construyó: si
 * alguien intentara reutilizarlo después de otro `init()`, sus índices ya no
 * describirían los datos vigentes y devolvería cifras de otra petición. En vez
 * de arriesgar eso en silencio, el contexto lo detecta y lanza.
 */
let _generation = 0;

/** Load all flat-file data into the module. Must be called before any compute* call. */
export function init(raw) {
  _events          = Array.isArray(raw.events)          ? raw.events          : [];
  _leoMemory       = raw.leoMemory ?? { memoryMap: {} };
  _leoInteractions = Array.isArray(raw.leoInteractions) ? raw.leoInteractions : [];
  _progress        = raw.progress  ?? { progressMap: {} };
  _groups          = Array.isArray(raw.groups) ? raw.groups : [];
  _users           = Array.isArray(raw.users)  ? raw.users  : [];
  _initialized     = true;
  _generation     += 1;
}

// ---------------------------------------------------------------------------
// CHP-STATS-LEGACY-PERF-01B — CONTEXTO DE CÁLCULO POR PETICIÓN
//
// Medido en `-01A`: `computeSchoolMetrics` llama a `computeStudentMetrics` dos
// veces por alumno (180 llamadas para 90 alumnos) y CADA llamada vuelve a
// recorrer el progreso completo (73-90 % del coste) y a reconstruir las
// sesiones de toda la plataforma (21-32 %), para quedarse con un solo usuario.
// El coste es O(alumnos x datos).
//
// La corrección NO es una caché: es dejar de repetir el mismo trabajo dentro de
// la misma petición. El contexto se crea al empezar el cálculo, se pasa
// explícitamente y desaparece al terminar. Sin estado entre peticiones no hay
// invalidación, ni TTL, ni fingerprint, ni divergencia entre instancias.
// ---------------------------------------------------------------------------

const REQUEST_CONTEXT_FLAG = 'LEGACY_METRICS_REQUEST_CONTEXT';

export class MetricsConfigError extends Error {
  constructor(detail) {
    super(`METRICS_CONFIG_ERROR: ${detail}`);
    this.name = 'MetricsConfigError';
    this.code = 'METRICS_CONFIG_ERROR';
  }
}

/**
 * Resuelve el flag. **Default `off`**: la ausencia de la variable nunca activa
 * nada, y un valor no reconocido es un error explícito en vez de un default
 * silencioso que nadie revisaría.
 */
export function resolveRequestContextFlag(env = process.env) {
  const raw = env?.[REQUEST_CONTEXT_FLAG];
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const v = String(raw).trim().toLowerCase();
  if (v === 'off' || v === 'false' || v === '0') return false;
  if (v === 'on'  || v === 'true'  || v === '1') return true;
  throw new MetricsConfigError(`${REQUEST_CONTEXT_FLAG} debe ser on|off, recibido "${raw}"`);
}

// Se resuelve UNA vez al cargar el módulo: el flag nunca se lee dentro del
// bucle por alumno.
let _requestContextEnabled = resolveRequestContextFlag();

/** Solo para tests: reevalúa el flag sin reiniciar el proceso. */
export function __setRequestContextEnabledForTests(value) {
  _requestContextEnabled = Boolean(value);
}
export function isRequestContextEnabled() { return _requestContextEnabled; }

/** Contadores agregados. Sin identificadores, sin claves de memo, sin PII. */
export const metricsContextCounters = {
  metrics_request_context_created_total: 0,
  metrics_request_context_disposed_total: 0,
  metrics_request_context_progress_records_indexed: 0,
  metrics_request_context_events_indexed: 0,
  metrics_student_memo_hits_total: 0,
  metrics_student_memo_misses_total: 0,
  metrics_legacy_fallback_calls_total: 0,
  metrics_request_context_build_duration_ms: 0,
};

/**
 * Fotografía READ-ONLY de los contadores del request context.
 * CHP-STATS-LEGACY-PERF-OBS-01A-R2.
 *
 * Devuelve un objeto NUEVO en cada llamada: mutarlo no afecta a los contadores.
 * No reinicia, no incrementa, no abre stores, no lee bases y no toca disco.
 *
 * Sobre los nombres históricos, que son engañosos y se traducen aquí:
 *   · `progress_records_indexed` cuenta USUARIOS con progreso indexados
 *     (`progressByUser.size`), no registros individuales;
 *   · `events_indexed` cuenta USUARIOS con eventos indexados;
 *   · `build_duration_ms` es un ACUMULADO de todas las construcciones del
 *     proceso, no la duración de la última petición.
 *
 * Dos derivaciones, y solo dos:
 *   · `active = max(0, created - disposed)`. Es fiable porque `dispose()` va
 *     siempre en un `finally`, es idempotente y solo libera quien creó.
 *     El clamp es defensivo: un negativo indicaría un bug, no un estado.
 *   · `studentComputations = memoMisses + legacyFallbackCalls`. Los *hits* son
 *     reutilizaciones dentro de una misma petición, no cálculos; sumarlos
 *     inflaría la cifra.
 *
 * NO se exponen `generationGuardFailures` ni `contextErrors`: la guarda
 * `assertUsable()` lanza, pero no cuenta. Inventar el contador exigiría
 * instrumentar lógica productiva, que está fuera del alcance de esta unidad.
 *
 * Los contadores son de PROCESO: no se agregan entre api_1 y api_2 y vuelven a
 * cero al recrear el contenedor. Todos son monotónicos salvo `active`.
 *
 * @returns {{enabled: boolean, scope: 'process', createdTotal: number,
 *   disposedTotal: number, active: number, progressUsersIndexedTotal: number,
 *   eventUsersIndexedTotal: number, memoHitsTotal: number,
 *   memoMissesTotal: number, legacyFallbackCallsTotal: number,
 *   studentComputationsTotal: number, buildDurationMsTotal: number}}
 */
export function getMetricsRequestContextTelemetrySnapshot() {
  const c = metricsContextCounters;
  const created  = c.metrics_request_context_created_total;
  const disposed = c.metrics_request_context_disposed_total;
  const misses   = c.metrics_student_memo_misses_total;
  const fallback = c.metrics_legacy_fallback_calls_total;

  return {
    enabled: _requestContextEnabled,
    scope: 'process',
    createdTotal: created,
    disposedTotal: disposed,
    active: Math.max(0, created - disposed),
    progressUsersIndexedTotal: c.metrics_request_context_progress_records_indexed,
    eventUsersIndexedTotal: c.metrics_request_context_events_indexed,
    memoHitsTotal: c.metrics_student_memo_hits_total,
    memoMissesTotal: misses,
    legacyFallbackCallsTotal: fallback,
    studentComputationsTotal: misses + fallback,
    buildDurationMsTotal: c.metrics_request_context_build_duration_ms,
  };
}

/** Agrupa preservando el orden de aparición. Ausencia → lista vacía, nunca null. */
function groupBy(rows, keyOf) {
  const idx = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    let bucket = idx.get(k);
    if (bucket === undefined) { bucket = []; idx.set(k, bucket); }
    bucket.push(r);
  }
  return idx;
}

const EMPTY = Object.freeze([]);

/**
 * Índices y memo con vida de UNA petición.
 *
 * Solo se indexa donde está el coste: progreso, eventos y sesiones. La memoria
 * de Leo (0,04-0,12 ms) y las interacciones (0,002 ms) se dejan como están —
 * indexarlas no compensaría el riesgo semántico de tocar el prefijo `userId__`.
 */
export function createMetricsRequestContext() {
  if (!_initialized) throw new Error('metricsService: call init() before creating a context');
  const t0 = Date.now();

  // `parseSessions` se ejecuta UNA vez, la misma función de siempre. Como
  // agrupa por usuario antes de procesar, cada usuario se reconstruye de forma
  // independiente: por eso indexar su salida es idéntico a filtrarla por
  // usuario, y no hace falta un segundo algoritmo de sesiones.
  const allSessions = parseSessions(_events);

  const ctx = {
    generation: _generation,
    progressByUser: groupBy(Object.values(_progress.progressMap || {}), (p) => p.userId),
    eventsByUser:   groupBy(_events,   (e) => e.userId),
    sessionsByUser: groupBy(allSessions, (s) => s.userId),
    memo: new Map(),
    disposed: false,
    counters: { memoHits: 0, memoMisses: 0 },

    assertUsable() {
      if (this.disposed) throw new Error('metricsService: MetricsRequestContext ya liberado');
      if (this.generation !== _generation) {
        throw new Error('metricsService: MetricsRequestContext obsoleto (init() posterior)');
      }
    },
    progressFor(userId)  { this.assertUsable(); return this.progressByUser.get(userId)  ?? EMPTY; },
    eventsFor(userId)    { this.assertUsable(); return this.eventsByUser.get(userId)    ?? EMPTY; },
    sessionsFor(userId)  { this.assertUsable(); return this.sessionsByUser.get(userId)  ?? EMPTY; },

    /** Libera las referencias para que el contexto no sobreviva a la petición. */
    dispose() {
      if (this.disposed) return;
      this.progressByUser.clear();
      this.eventsByUser.clear();
      this.sessionsByUser.clear();
      this.memo.clear();
      this.disposed = true;
      metricsContextCounters.metrics_request_context_disposed_total += 1;
    },
  };

  metricsContextCounters.metrics_request_context_created_total += 1;
  metricsContextCounters.metrics_request_context_progress_records_indexed += ctx.progressByUser.size;
  metricsContextCounters.metrics_request_context_events_indexed += ctx.eventsByUser.size;
  metricsContextCounters.metrics_request_context_build_duration_ms += Date.now() - t0;
  return ctx;
}

/**
 * Contexto para un cálculo de nivel superior. Devuelve `null` con el flag
 * apagado, de modo que la ruta legacy queda exactamente como estaba.
 */
function contextForTopLevel(options) {
  if (options?.context) return { ctx: options.context, owned: false };
  if (!_requestContextEnabled) return { ctx: null, owned: false };
  return { ctx: createMetricsRequestContext(), owned: true };
}

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const DIFFICULTY_SCORE = { inicial: 0, medio: 0.5, avanzado: 1 };
const STAGE_SCORE      = { comprehension: 1, interpretation: 2, reflection: 3, creation: 4 };

// ---------------------------------------------------------------------------
// SESSION PARSING
// ---------------------------------------------------------------------------

function sealSession(partial) {
  return {
    userId:               partial.userId,
    contentId:            partial.contentId,
    startTimestamp:       partial.startTimestamp,
    endTimestamp:         partial.endTimestamp ?? null,
    durationMs:           partial.durationMs ?? 0,
    blocksInSession:      partial.blocksInSession ?? 0,
    peakStreak:           partial.peakStreak ?? 0,
    finalStreak:          partial.finalStreak ?? 0,
    progressPercentage:   partial.progressPercentage ?? 0,
    source:               partial.source ?? null,
    isSeamlessTransition: partial.isSeamlessTransition ?? false,
  };
}

/**
 * Parse raw events into discrete sessions per user.
 *
 * Session boundaries:
 *   - Opens:  session_start event
 *   - Closes: first matching session_end (subsequent session_end for the same
 *             open session are ignored — handles the known double-fire)
 *   - Falls back to: next session_start (incomplete sessions without session_end)
 *
 * block_complete events between open/close are counted per-session.
 * The cumulative `blocksCompleted` field in block_complete is ignored here;
 * we count raw occurrences instead.
 */
function parseSessions(events) {
  const sessions = [];

  // Group events by userId
  const byUser = new Map();
  for (const ev of events) {
    if (!byUser.has(ev.userId)) byUser.set(ev.userId, []);
    byUser.get(ev.userId).push(ev);
  }

  for (const [, userEvents] of byUser) {
    const sorted = [...userEvents].sort((a, b) => a.timestamp - b.timestamp);
    let open = null;

    for (const ev of sorted) {
      switch (ev.event) {
        case 'session_start': {
          if (open) sessions.push(sealSession(open)); // close incomplete
          open = {
            userId:               ev.userId,
            contentId:            ev.contentId,
            startTimestamp:       ev.timestamp,
            endTimestamp:         null,
            durationMs:           0,
            blocksInSession:      0,
            peakStreak:           ev.streak ?? 0,
            finalStreak:          ev.streak ?? 0,
            progressPercentage:   0,
            source:               null,
            isSeamlessTransition: ev.isTransition ?? false,
          };
          break;
        }
        case 'block_complete': {
          if (open && open.contentId === ev.contentId) {
            open.blocksInSession += 1;
            open.peakStreak       = Math.max(open.peakStreak, ev.streak ?? 0);
            open.finalStreak      = ev.streak ?? 0;
          }
          break;
        }
        case 'session_end': {
          // Only close if this session is still open (ignore double-fire duplicates)
          if (open && open.contentId === ev.contentId && open.endTimestamp == null) {
            open.endTimestamp       = ev.timestamp;
            open.durationMs         = ev.sessionDuration ?? 0;
            open.progressPercentage = ev.progressPercentage ?? 0;
            open.source             = ev.source ?? null;
            sessions.push(sealSession(open));
            open = null;
          }
          break;
        }
        case 'session_heartbeat': {
          // Update the open session's best-known duration using the heartbeat's elapsedMs.
          // This is the fallback: if session_end never arrives, the last heartbeat
          // provides a floor for durationMs instead of leaving it at 0.
          if (open && open.contentId === ev.contentId) {
            const elapsed = typeof ev.elapsedMs === 'number' ? ev.elapsedMs : 0;
            if (elapsed > (open._lastHeartbeatElapsedMs ?? 0)) {
              open._lastHeartbeatElapsedMs = elapsed;
            }
          }
          break;
        }
        // streak_break, level_up, page_change, leo_interaction handled at event level
      }
    }

    if (open) {
      // If the session has no session_end, use the last heartbeat as durationMs fallback
      if (open._lastHeartbeatElapsedMs && open._lastHeartbeatElapsedMs > 0) {
        open.durationMs = open._lastHeartbeatElapsedMs;
      }
      sessions.push(sealSession(open));
    }
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// LEO MEMORY HELPERS
// ---------------------------------------------------------------------------

function getLeoEntriesForUser(userId) {
  const prefix = `${userId}__`;
  return Object.entries(_leoMemory.memoryMap)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry);
}

// ---------------------------------------------------------------------------
// STATISTICAL HELPERS
// ---------------------------------------------------------------------------

function meanOf(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function computeDistribution(values) {
  if (values.length === 0) {
    return { n: 0, min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0 };
  }
  const s   = [...values].sort((a, b) => a - b);
  const n   = s.length;
  const mid = Math.floor(n / 2);
  return {
    n,
    min:    s[0],
    max:    s[n - 1],
    mean:   meanOf(s),
    median: n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid],
    p25:    s[Math.max(0, Math.floor(n * 0.25) - 1)],
    p75:    s[Math.min(n - 1, Math.floor(n * 0.75))],
  };
}

function buildScoreDistributions(students) {
  return {
    literal:     computeDistribution(students.map(s => s.readingLevels.literal)),
    inferential: computeDistribution(students.map(s => s.readingLevels.inferential)),
    critical:    computeDistribution(students.map(s => s.readingLevels.critical)),
    reflective:  computeDistribution(students.map(s => s.readingLevels.reflective)),
    composite:   computeDistribution(students.map(s => s.readingLevels.composite)),
  };
}

// ---------------------------------------------------------------------------
// ICDLI MAPPING
// ---------------------------------------------------------------------------

/**
 * Map a continuous 0–100 score to a 1–4 ICDLI level.
 *   < 30  → 1 Initial
 *   30–54 → 2 Basic
 *   55–74 → 3 Developing
 *   ≥ 75  → 4 Advanced
 */
function scoreToICDLI(score) {
  if (score >= 75) return 4;
  if (score >= 55) return 3;
  if (score >= 30) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// BEHAVIORAL METRICS
// ---------------------------------------------------------------------------

function zeroBehavioral() {
  return {
    totalSessions: 0, totalReadingTimeMs: 0, avgSessionDurationMs: 0,
    avgBlocksPerSession: 0, tranceEntryRate: 0, autoTransitionRate: 0,
    completionRate: 0, avgProgressPercentage: 0, avgPeakStreak: 0,
    streakBreakRate: 0, distinctContentsRead: 0, rereadsRate: 0,
  };
}

function computeBehavioral(sessions, userEvents) {
  const n = sessions.length;
  if (n === 0) return zeroBehavioral();

  const totalReadingTimeMs   = sessions.reduce((s, ses) => s + ses.durationMs, 0);
  const avgSessionDurationMs = totalReadingTimeMs / n;
  const avgBlocksPerSession  = meanOf(sessions.map(s => s.blocksInSession));

  const tranceSessions       = sessions.filter(s => s.peakStreak >= 3).length;
  const tranceEntryRate      = tranceSessions / n;

  const transitionSessions   = sessions.filter(s => s.source === 'transition').length;
  const autoTransitionRate   = transitionSessions / n;

  const completedSessions    = sessions.filter(s => s.progressPercentage >= 80).length;
  const completionRate       = completedSessions / n;

  const avgProgressPercentage = meanOf(sessions.map(s => s.progressPercentage));
  const avgPeakStreak         = meanOf(sessions.map(s => s.peakStreak));

  const streakBreaks   = userEvents.filter(e => e.event === 'streak_break').length;
  const blockCompletes = userEvents.filter(e => e.event === 'block_complete').length;
  const streakBreakRate = blockCompletes > 0 ? streakBreaks / blockCompletes : 0;

  const contentsSeen = new Set(sessions.map(s => s.contentId));
  const distinctContentsRead = contentsSeen.size;

  const contentSessionCount = new Map();
  for (const s of sessions) {
    contentSessionCount.set(s.contentId, (contentSessionCount.get(s.contentId) ?? 0) + 1);
  }
  const rereadsCount = [...contentSessionCount.values()].filter(c => c > 1).length;
  const rereadsRate  = distinctContentsRead > 0 ? rereadsCount / distinctContentsRead : 0;

  return {
    totalSessions: n,
    totalReadingTimeMs,
    avgSessionDurationMs,
    avgBlocksPerSession,
    tranceEntryRate,
    autoTransitionRate,
    completionRate,
    avgProgressPercentage,
    avgPeakStreak,
    streakBreakRate,
    distinctContentsRead,
    rereadsRate,
  };
}

// ---------------------------------------------------------------------------
// READING LEVEL SCORES
// ---------------------------------------------------------------------------

function computeLiteralScore(b) {
  const avgProgressNorm = clamp(b.avgProgressPercentage / 100, 0, 1);
  const consistency     = clamp(1 - b.streakBreakRate, 0, 1);
  return clamp(
    (b.completionRate * 0.40 + avgProgressNorm * 0.35 + consistency * 0.25) * 100,
    0, 100
  );
}

function computeInferentialScore(b, sessions, leoEntries) {
  const totalAnchors     = leoEntries.reduce((s, e) => s + (e.recentAnchors?.length ?? 0), 0);
  const anchorRate       = clamp(totalAnchors / Math.max(1, b.totalSessions), 0, 1);
  const deepSessions     = sessions.filter(s => s.blocksInSession >= 2).length;
  const sessionDepthRate = b.totalSessions > 0 ? deepSessions / b.totalSessions : 0;
  const multiContentRate = clamp(b.distinctContentsRead / Math.max(1, b.totalSessions), 0, 1);
  return clamp(
    (anchorRate * 0.35 + sessionDepthRate * 0.35 + multiContentRate * 0.30) * 100,
    0, 100
  );
}

function computeCriticalScore(b, sessions, leoEntries) {
  const deepStreakSessions = sessions.filter(s => s.peakStreak >= 5).length;
  const deepStreakRate     = b.totalSessions > 0 ? deepStreakSessions / b.totalSessions : 0;
  const advancedCount     = leoEntries.filter(e => e.difficultyLevel === 'avanzado').length;
  const advancedLeoRate   = leoEntries.length > 0 ? advancedCount / leoEntries.length : 0;
  return clamp(
    (b.tranceEntryRate * 0.40 + deepStreakRate * 0.35 + advancedLeoRate * 0.25) * 100,
    0, 100
  );
}

function computeReflectiveScore(b, leoEntries) {
  const stageScores      = leoEntries.map(e => STAGE_SCORE[e.pedagogicalStage] ?? 1);
  const stageAdvancement = leoEntries.length > 0 ? meanOf(stageScores) / 4 : 0;
  return clamp(
    (stageAdvancement * 0.35 + b.autoTransitionRate * 0.35 + b.rereadsRate * 0.30) * 100,
    0, 100
  );
}

function computeReadingLevels(b, sessions, leoEntries) {
  const literal     = computeLiteralScore(b);
  const inferential = computeInferentialScore(b, sessions, leoEntries);
  const critical    = computeCriticalScore(b, sessions, leoEntries);
  const reflective  = computeReflectiveScore(b, leoEntries);
  const composite   = clamp(
    literal * 0.20 + inferential * 0.30 + critical * 0.30 + reflective * 0.20,
    0, 100
  );
  return { literal, inferential, critical, reflective, composite };
}

// ---------------------------------------------------------------------------
// ICDLI DIMENSIONS
// ---------------------------------------------------------------------------

function computeICDLI(rl, b, sessions, leoEntries) {
  const consistency      = clamp(1 - b.streakBreakRate, 0, 1);
  const advancedCount    = leoEntries.filter(e => e.difficultyLevel === 'avanzado').length;
  const advancedLeoRate  = leoEntries.length > 0 ? advancedCount / leoEntries.length : 0;
  const multiContentRate = clamp(b.distinctContentsRead / Math.max(1, b.totalSessions), 0, 1);
  const totalAnchors     = leoEntries.reduce((s, e) => s + (e.recentAnchors?.length ?? 0), 0);
  const anchorRate       = clamp(totalAnchors / Math.max(1, b.totalSessions), 0, 1);

  const maxStage       = leoEntries.length > 0
    ? Math.max(...leoEntries.map(e => STAGE_SCORE[e.pedagogicalStage] ?? 1))
    : 1;
  const peakStageScore = ((maxStage - 1) / 3) * 100; // normalize 1–4 → 0–100

  const integrationScore   = clamp(rl.literal * 0.40 + rl.inferential * 0.60, 0, 100);
  const contextScore       = clamp(multiContentRate * 60 + advancedLeoRate * 40, 0, 100);
  const metacognitionScore = clamp(rl.reflective * 0.60 + consistency * 40, 0, 100);
  const ideaScore          = clamp(peakStageScore * 0.70 + rl.critical * 0.30, 0, 100);
  const oralWritingScore   = clamp(b.autoTransitionRate * 50 + anchorRate * 50, 0, 100);

  return {
    comprehension:     scoreToICDLI(rl.literal),
    integration:       scoreToICDLI(integrationScore),
    inference:         scoreToICDLI(rl.inferential),
    criticalThinking:  scoreToICDLI(rl.critical),
    contextConnection: scoreToICDLI(contextScore),
    metacognition:     scoreToICDLI(metacognitionScore),
    ideaProduction:    scoreToICDLI(ideaScore),
    oralWriting:       scoreToICDLI(oralWritingScore),
  };
}

// ---------------------------------------------------------------------------
// GROUP STUDENT HELPERS
// ---------------------------------------------------------------------------
// Sprint 021 Fase 2 — la implementación local de getGroupStudentIds fue
// eliminada. Toda la lógica vive en utils/groupMembership.mjs vía
// groupMembershipService.getGroupMembers. No reintroducir lógica aquí —
// si la regla de membresía cambia, se cambia en una sola fuente.
//
// Wrapper liviano que pasa el state de módulo (_users, _groups) al servicio
// canónico. Mantiene la firma `(group) => string[]` para que los call sites
// existentes no cambien.
function resolveGroupMemberIds(group) {
  return getGroupMembers(group, _users, { allGroups: _groups });
}

// ---------------------------------------------------------------------------
// AGGREGATION HELPERS
// ---------------------------------------------------------------------------

function avgBehavioral(students) {
  if (students.length === 0) return zeroBehavioral();
  const f = pick => meanOf(students.map(pick));
  return {
    totalSessions:         f(s => s.behavioral.totalSessions),
    totalReadingTimeMs:    f(s => s.behavioral.totalReadingTimeMs),
    avgSessionDurationMs:  f(s => s.behavioral.avgSessionDurationMs),
    avgBlocksPerSession:   f(s => s.behavioral.avgBlocksPerSession),
    tranceEntryRate:       f(s => s.behavioral.tranceEntryRate),
    autoTransitionRate:    f(s => s.behavioral.autoTransitionRate),
    completionRate:        f(s => s.behavioral.completionRate),
    avgProgressPercentage: f(s => s.behavioral.avgProgressPercentage),
    avgPeakStreak:         f(s => s.behavioral.avgPeakStreak),
    streakBreakRate:       f(s => s.behavioral.streakBreakRate),
    distinctContentsRead:  f(s => s.behavioral.distinctContentsRead),
    rereadsRate:           f(s => s.behavioral.rereadsRate),
  };
}

function avgReadingLevels(students) {
  if (students.length === 0) return { literal: 0, inferential: 0, critical: 0, reflective: 0, composite: 0 };
  const f = pick => meanOf(students.map(pick));
  return {
    literal:     f(s => s.readingLevels.literal),
    inferential: f(s => s.readingLevels.inferential),
    critical:    f(s => s.readingLevels.critical),
    reflective:  f(s => s.readingLevels.reflective),
    composite:   f(s => s.readingLevels.composite),
  };
}

function avgICDLI(students) {
  if (students.length === 0) {
    return { comprehension: 1, integration: 1, inference: 1, criticalThinking: 1,
             contextConnection: 1, metacognition: 1, ideaProduction: 1, oralWriting: 1 };
  }
  const f = pick => meanOf(students.map(pick));
  return {
    comprehension:     f(s => s.icdli.comprehension),
    integration:       f(s => s.icdli.integration),
    inference:         f(s => s.icdli.inference),
    criticalThinking:  f(s => s.icdli.criticalThinking),
    contextConnection: f(s => s.icdli.contextConnection),
    metacognition:     f(s => s.icdli.metacognition),
    ideaProduction:    f(s => s.icdli.ideaProduction),
    oralWriting:       f(s => s.icdli.oralWriting),
  };
}

function topBottomByComposite(students, fraction) {
  if (students.length === 0) return { top: [], bottom: [] };
  const sorted = [...students].sort(
    (a, b) => b.readingLevels.composite - a.readingLevels.composite
  );
  const cutoff = Math.max(1, Math.ceil(sorted.length * fraction));
  return {
    top:    sorted.slice(0, cutoff).map(s => s.userId),
    bottom: sorted.slice(-cutoff).map(s => s.userId),
  };
}

// ---------------------------------------------------------------------------
// STUDENT METRICS
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CONTENT PROGRESS STATS
// ---------------------------------------------------------------------------

const ABANDONED_DAYS_METRICS = 30;

/**
 * Compute per-content reading progress stats for a user from progress_db.
 * Mirrors the status rules in server.js computeReadingProgress() — kept in sync manually.
 */
function computeContentStats(userId, ctx = null) {
    // Con contexto, la rebanada del usuario sale de un índice construido una
    // sola vez; sin él, el escaneo completo de siempre. Ambos caminos producen
    // exactamente los mismos registros y en el mismo orden (verificado sobre
    // los 647 usuarios del padrón en `-01A`).
    const entries = ctx
        ? ctx.progressFor(userId)
        : Object.values(_progress.progressMap || {}).filter(p => p.userId === userId);
    const contents = entries.map(raw => {
        const pct     = raw.canonicalProgress?.globalPercentage ?? 0;
        const history = Array.isArray(raw.history) ? raw.history : [];
        const totalReadingTimeMs = history.reduce((sum, h) => sum + Math.max(0, (h.durationSec ?? 0)) * 1000, 0);
        const lastReadAt = raw.updatedAt ?? null;
        let status;
        if (pct >= 90 || raw.isCompleted === true) {
            status = 'completed';
        } else if (pct <= 0 && history.length === 0) {
            status = 'not_started';
        } else {
            const daysSince = lastReadAt
                ? (Date.now() - new Date(lastReadAt).getTime()) / (1000 * 60 * 60 * 24)
                : Infinity;
            status = (daysSince > ABANDONED_DAYS_METRICS && pct < 50) ? 'abandoned' : 'in_progress';
        }
        return { contentId: raw.contentId, progressPercentage: Math.round(pct), totalReadingTimeMs, totalSessions: history.length, lastReadAt, status };
    });
    return {
        total:      contents.length,
        inProgress: contents.filter(c => c.status === 'in_progress').length,
        completed:  contents.filter(c => c.status === 'completed').length,
        abandoned:  contents.filter(c => c.status === 'abandoned').length,
        contents,
    };
}

/** Compute Leo interaction metrics for a user from leo_interactions_db entries and analytics events. */
function computeLeoMetrics(userId, userEvents = null) {
  const userInteractions = _leoInteractions.filter(e => e.userId === userId);
  const totalLeoInteractions = userInteractions.length;

  // Offline attempts come from analytics_db (LU Android: leo_interaction_attempted event)
  // Filtrar la rebanada del usuario por tipo es idéntico a filtrar todos los
  // eventos por usuario Y tipo; se evita así un segundo recorrido completo.
  const scope = userEvents ?? _events.filter(e => e.userId === userId);
  const totalLeoOfflineAttempts = scope.filter(
    e => (e.event === 'leo_interaction_attempted' || e.eventType === 'leo_interaction_attempted')
  ).length;

  // Count by interactionType
  const byType = {};
  for (const e of userInteractions) {
    const t = e.interactionType ?? 'unknown';
    byType[t] = (byType[t] ?? 0) + 1;
  }

  // Dominant type (most frequent)
  let dominantType = null;
  let dominantCount = 0;
  for (const [t, count] of Object.entries(byType)) {
    if (count > dominantCount) { dominantType = t; dominantCount = count; }
  }

  // Per-content breakdown
  const byContent = {};
  for (const e of userInteractions) {
    const c = e.contentId ?? 'unknown';
    byContent[c] = (byContent[c] ?? 0) + 1;
  }

  return { totalLeoInteractions, totalLeoOfflineAttempts, byType, dominantType, byContent };
}

function computeStudentMetricsUncached(userId, ctx) {
  const userEvents   = ctx ? ctx.eventsFor(userId)   : _events.filter(e => e.userId === userId);
  const sessions     = ctx ? ctx.sessionsFor(userId) : parseSessions(_events).filter(s => s.userId === userId);
  const leoEntries   = getLeoEntriesForUser(userId);
  const leoMetrics   = computeLeoMetrics(userId, ctx ? userEvents : null);

  const behavioral    = computeBehavioral(sessions, userEvents);
  const readingLevels = computeReadingLevels(behavioral, sessions, leoEntries);
  const icdli         = computeICDLI(readingLevels, behavioral, sessions, leoEntries);

  const timestamps  = userEvents.map(e => e.timestamp);
  const dataWindow  = timestamps.length > 0
    ? { from: Math.min(...timestamps), to: Math.max(...timestamps) }
    : null;
  const lastAccessAt  = timestamps.length > 0 ? Math.max(...timestamps) : null;
  const contentStats  = computeContentStats(userId, ctx);

  return { userId, behavioral, readingLevels, icdli, leoMetrics, contentStats, dataWindow, lastAccessAt, computedAt: Date.now() };
}

/**
 * @param {string} userId
 * @param {{context?: object}} [options]  contexto de petición, OPCIONAL.
 *
 * Sin `options.context` el comportamiento es exactamente el de siempre: los
 * call sites existentes no cambian ni una línea.
 *
 * Sobre la clave de memoización: esta función no admite periodo, filtros ni
 * opciones — su único parámetro funcional es `userId`. El resto de sus entradas
 * es el estado de módulo que fija `init()`, y de eso se ocupa `generation`: un
 * contexto construido antes de otro `init()` se rechaza en vez de devolver
 * cifras de datos que ya no son los vigentes. Por eso `userId` es una clave
 * completa DENTRO de un contexto, y no lo sería fuera de él.
 */
export function computeStudentMetrics(userId, options = {}) {
  if (!_initialized) throw new Error('metricsService: call init() before computing metrics');

  const ctx = options?.context ?? null;
  if (!ctx) {
    metricsContextCounters.metrics_legacy_fallback_calls_total += 1;
    return computeStudentMetricsUncached(userId, null);
  }

  ctx.assertUsable();
  if (ctx.memo.has(userId)) {
    ctx.counters.memoHits += 1;
    metricsContextCounters.metrics_student_memo_hits_total += 1;
    return ctx.memo.get(userId);
  }
  ctx.counters.memoMisses += 1;
  metricsContextCounters.metrics_student_memo_misses_total += 1;
  const result = computeStudentMetricsUncached(userId, ctx);
  ctx.memo.set(userId, result);
  return result;
}

// ---------------------------------------------------------------------------
// COURSE METRICS
// ---------------------------------------------------------------------------

export function computeCourseMetrics(courseId, options = {}) {
  if (!_initialized) throw new Error('metricsService: call init() before computing metrics');

  const group = _groups.find(g => g.id === courseId);
  if (!group) throw new Error(`metricsService: group "${courseId}" not found`);

  const { ctx, owned } = contextForTopLevel(options);
  try {
    return courseMetricsFrom(group, courseId, ctx);
  } finally {
    // El contexto solo se libera si lo creó ESTA llamada. Si vino del caller,
    // el caller decide su vida.
    if (owned && ctx) ctx.dispose();
  }
}

function courseMetricsFrom(group, courseId, ctx) {
  const studentIds     = resolveGroupMemberIds(group);
  const allStudents    = studentIds.map(id => computeStudentMetrics(id, { context: ctx }));
  const activeStudents = allStudents.filter(s => s.behavioral.totalSessions > 0);
  const { top, bottom } = topBottomByComposite(activeStudents, 0.20);

  return {
    courseId,
    courseName:         group.name,
    studentCount:       allStudents.length,
    activeStudentCount: activeStudents.length,
    averages: {
      behavioral:    avgBehavioral(activeStudents),
      readingLevels: avgReadingLevels(activeStudents),
      icdli:         avgICDLI(activeStudents),
    },
    distributions:    buildScoreDistributions(activeStudents),
    studentBreakdown: allStudents,
    topPerformers:    top,
    needsAttention:   bottom,
    computedAt:       Date.now(),
  };
}

// ---------------------------------------------------------------------------
// SCHOOL METRICS
// ---------------------------------------------------------------------------

export function computeSchoolMetrics(schoolId, options = {}) {
  if (!_initialized) throw new Error('metricsService: call init() before computing metrics');

  const schoolGroups = _groups.filter(
    g => g.school?.toLowerCase() === schoolId.toLowerCase()
  );
  if (schoolGroups.length === 0) {
    throw new Error(`metricsService: no groups found for school "${schoolId}"`);
  }

  const { ctx, owned } = contextForTopLevel(options);
  try {
    return schoolMetricsFrom(schoolGroups, schoolId, ctx);
  } finally {
    if (owned && ctx) ctx.dispose();
  }
}

function schoolMetricsFrom(schoolGroups, schoolId, ctx) {
  const allStudentIds = new Set();
  for (const group of schoolGroups) {
    for (const id of resolveGroupMemberIds(group)) allStudentIds.add(id);
  }

  // Aquí estaba el coste cuadrático: cada alumno se calculaba una vez para
  // `allStudents` y OTRA dentro de `courseBreakdown`. Con contexto, la segunda
  // pasada es un acierto de memo; sin contexto, el comportamiento es el de
  // siempre.
  const allStudents    = [...allStudentIds].map(id => computeStudentMetrics(id, { context: ctx }));
  const activeStudents = allStudents.filter(s => s.behavioral.totalSessions > 0);

  const courseBreakdown = schoolGroups
    .filter(g => resolveGroupMemberIds(g).length > 0)
    .map(g => {
      const groupStudentIds = resolveGroupMemberIds(g);
      const groupStudents   = groupStudentIds.map(id => computeStudentMetrics(id, { context: ctx }));
      const active          = groupStudents.filter(s => s.behavioral.totalSessions > 0);
      const compScores      = active.map(s => s.readingLevels.composite);
      return {
        courseId:       g.id,
        courseName:     g.name,
        studentCount:   groupStudents.length,
        avgComposite:   meanOf(compScores),
        avgLiteral:     meanOf(active.map(s => s.readingLevels.literal)),
        avgInferential: meanOf(active.map(s => s.readingLevels.inferential)),
        avgCritical:    meanOf(active.map(s => s.readingLevels.critical)),
        avgReflective:  meanOf(active.map(s => s.readingLevels.reflective)),
      };
    })
    .sort((a, b) => b.avgComposite - a.avgComposite);

  return {
    schoolId,
    courseCount:        schoolGroups.length,
    studentCount:       allStudents.length,
    activeStudentCount: activeStudents.length,
    averages: {
      behavioral:    avgBehavioral(activeStudents),
      readingLevels: avgReadingLevels(activeStudents),
      icdli:         avgICDLI(activeStudents),
    },
    distributions:  buildScoreDistributions(activeStudents),
    courseBreakdown,
    computedAt:     Date.now(),
  };
}
