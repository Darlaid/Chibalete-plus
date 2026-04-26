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
 */

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

/** Load all flat-file data into the module. Must be called before any compute* call. */
export function init(raw) {
  _events          = Array.isArray(raw.events)          ? raw.events          : [];
  _leoMemory       = raw.leoMemory ?? { memoryMap: {} };
  _leoInteractions = Array.isArray(raw.leoInteractions) ? raw.leoInteractions : [];
  _progress        = raw.progress  ?? { progressMap: {} };
  _groups          = Array.isArray(raw.groups) ? raw.groups : [];
  _users           = Array.isArray(raw.users)  ? raw.users  : [];
  _initialized     = true;
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

/** Resolve all student IDs from a group (handles both legacy and new schemas). */
function getGroupStudentIds(group) {
  const ids = new Set([
    ...(group.studentIds ?? []),
    ...(group.memberIds  ?? []),
  ]);
  for (const user of _users) {
    if (user.groupIds?.includes(group.id)) ids.add(user.id);
  }
  return [...ids];
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
function computeContentStats(userId) {
    const entries = Object.values(_progress.progressMap || {}).filter(p => p.userId === userId);
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
function computeLeoMetrics(userId) {
  const userInteractions = _leoInteractions.filter(e => e.userId === userId);
  const totalLeoInteractions = userInteractions.length;

  // Offline attempts come from analytics_db (LU Android: leo_interaction_attempted event)
  const totalLeoOfflineAttempts = _events.filter(
    e => e.userId === userId && (e.event === 'leo_interaction_attempted' || e.eventType === 'leo_interaction_attempted')
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

export function computeStudentMetrics(userId) {
  if (!_initialized) throw new Error('metricsService: call init() before computing metrics');

  const userEvents   = _events.filter(e => e.userId === userId);
  const allSessions  = parseSessions(_events);
  const sessions     = allSessions.filter(s => s.userId === userId);
  const leoEntries   = getLeoEntriesForUser(userId);
  const leoMetrics   = computeLeoMetrics(userId);

  const behavioral    = computeBehavioral(sessions, userEvents);
  const readingLevels = computeReadingLevels(behavioral, sessions, leoEntries);
  const icdli         = computeICDLI(readingLevels, behavioral, sessions, leoEntries);

  const timestamps  = userEvents.map(e => e.timestamp);
  const dataWindow  = timestamps.length > 0
    ? { from: Math.min(...timestamps), to: Math.max(...timestamps) }
    : null;
  const lastAccessAt  = timestamps.length > 0 ? Math.max(...timestamps) : null;
  const contentStats  = computeContentStats(userId);

  return { userId, behavioral, readingLevels, icdli, leoMetrics, contentStats, dataWindow, lastAccessAt, computedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// COURSE METRICS
// ---------------------------------------------------------------------------

export function computeCourseMetrics(courseId) {
  if (!_initialized) throw new Error('metricsService: call init() before computing metrics');

  const group = _groups.find(g => g.id === courseId);
  if (!group) throw new Error(`metricsService: group "${courseId}" not found`);

  const studentIds    = getGroupStudentIds(group);
  const allStudents   = studentIds.map(id => computeStudentMetrics(id));
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

export function computeSchoolMetrics(schoolId) {
  if (!_initialized) throw new Error('metricsService: call init() before computing metrics');

  const schoolGroups = _groups.filter(
    g => g.school?.toLowerCase() === schoolId.toLowerCase()
  );
  if (schoolGroups.length === 0) {
    throw new Error(`metricsService: no groups found for school "${schoolId}"`);
  }

  const allStudentIds = new Set();
  for (const group of schoolGroups) {
    for (const id of getGroupStudentIds(group)) allStudentIds.add(id);
  }

  const allStudents    = [...allStudentIds].map(id => computeStudentMetrics(id));
  const activeStudents = allStudents.filter(s => s.behavioral.totalSessions > 0);

  const courseBreakdown = schoolGroups
    .filter(g => getGroupStudentIds(g).length > 0)
    .map(g => {
      const groupStudentIds = getGroupStudentIds(g);
      const groupStudents   = groupStudentIds.map(id => computeStudentMetrics(id));
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
