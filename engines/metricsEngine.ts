/**
 * metricsEngine.ts — Unified reading metrics computation model
 *
 * Transforms raw analytics events into structured reading metrics at three
 * aggregation levels: student → course → school.
 *
 * Architecture:
 *   1. Call init(rawData) once to load the data store (no I/O here).
 *   2. Call compute* functions per entity.
 *
 * Metric families:
 *   A. Behavioral   — blocks, sessions, trance, transitions
 *   B. Reading levels — literal, inferential, critical, reflective (0–100)
 *   C. ICDLI        — 8 pedagogical dimensions (1–4 scale)
 *
 * All computation is pure (data in → result out). Loading JSON files from disk
 * is the caller's responsibility. Example server integration:
 *
 *   import { init, computeStudentMetrics } from '../engines/metricsEngine';
 *   const analytics = JSON.parse(fs.readFileSync(ANALYTICS_DB, 'utf-8'));
 *   const leo      = JSON.parse(fs.readFileSync(LEO_MEMORY_DB, 'utf-8'));
 *   const progress = JSON.parse(fs.readFileSync(PROGRESS_DB, 'utf-8'));
 *   const groups   = JSON.parse(fs.readFileSync(GROUPS_DB, 'utf-8'));
 *   const users    = JSON.parse(fs.readFileSync(USERS_DB, 'utf-8'));
 *   init({ events: analytics, leoMemory: leo, progress, groups, users });
 */

// ---------------------------------------------------------------------------
// INPUT TYPES  (mirrors the shapes of the flat-file databases)
// ---------------------------------------------------------------------------

/** Single event as written by analyticsService.track() */
export interface ReadingEvent {
  event: string;
  userId: string;
  contentId: string;
  timestamp: number;
  streak: number;
  level: number;
  sessionDuration: number;       // ms elapsed since session_start for this content
  // conditional fields
  isTransition?: boolean;        // session_start: was this a seamless content handoff?
  blocksCompleted?: number;      // block_complete: cumulative total for this user (NOT per session)
  nextContentId?: string;        // transition_to_next_content
  source?: 'completion' | 'transition' | 'unmount'; // session_end
  progressPercentage?: number;   // session_end
  previousStreak?: number;       // streak_break
  oldLevel?: number;             // level_up
  xp?: number;                   // level_up
}

export interface LeoMemoryEntry {
  recentAnchors: number[];         // sentence indices where the reader engaged Leo anchors
  lastQuestionType: string | null;
  sessionReadingProgress: number;  // 0–100
  difficultyLevel: 'inicial' | 'medio' | 'avanzado';
  pedagogicalStage: 'comprehension' | 'interpretation' | 'reflection' | 'creation';
  updatedAt?: string;
}

export interface LeoMemoryDatabase {
  memoryMap: Record<string, LeoMemoryEntry>; // key: "${userId}__${contentId}"
}

export interface ProgressEntry {
  userId: string;
  contentId: string;
  isCompleted: boolean;
  canonicalProgress?: {
    sentenceIndex?: number;
    totalSentences?: number;
    globalPercentage?: number;
    lastInteractedMode?: string;
  };
  porcentaje?: number; // legacy field
}

export interface ProgressDatabase {
  progressMap: Record<string, ProgressEntry>; // key: "${userId}__${contentId}"
}

export interface Group {
  id: string;
  name: string;
  school: string;
  grade?: string;
  type?: 'course' | 'club';
  teacherId?: string;
  studentIds?: string[];  // legacy field (courses)
  memberIds?: string[];   // newer field (clubs)
  mediatorIds?: string[];
}

export interface User {
  id: string;
  nombre_completo?: string;
  roles?: string[];
  colegio?: string;
  groupIds?: string[];
}

export interface RawData {
  events: ReadingEvent[];
  leoMemory: LeoMemoryDatabase;
  progress: ProgressDatabase;
  groups: Group[];
  users: User[];
}

// ---------------------------------------------------------------------------
// OUTPUT TYPES
// ---------------------------------------------------------------------------

export interface BehavioralMetrics {
  totalSessions: number;
  totalReadingTimeMs: number;
  avgSessionDurationMs: number;
  avgBlocksPerSession: number;
  tranceEntryRate: number;         // 0–1: sessions where peakStreak >= 3 / total
  autoTransitionRate: number;      // 0–1: sessions ending as seamless transitions / total
  completionRate: number;          // 0–1: sessions reaching >= 80% progress / total
  avgProgressPercentage: number;   // 0–100
  avgPeakStreak: number;
  streakBreakRate: number;         // 0–1: streak_break events / block_complete events
  distinctContentsRead: number;
  rereadsRate: number;             // 0–1: content seen in >1 session / distinct contents
}

export interface ReadingLevelScores {
  literal: number;       // 0–100
  inferential: number;   // 0–100
  critical: number;      // 0–100
  reflective: number;    // 0–100
  composite: number;     // 0–100 weighted: 0.20L + 0.30I + 0.30C + 0.20R
}

/** 1=Initial · 2=Basic · 3=Developing · 4=Advanced */
export type ICDLIScore = 1 | 2 | 3 | 4;

export interface ICDLIDimensions {
  comprehension: ICDLIScore;      // literal comprehension accuracy
  integration: ICDLIScore;        // connecting ideas within a text
  inference: ICDLIScore;          // reading beyond explicit content
  criticalThinking: ICDLIScore;   // evaluative / questioning stance
  contextConnection: ICDLIScore;  // relating text to real world / prior knowledge
  metacognition: ICDLIScore;      // awareness of own reading process
  ideaProduction: ICDLIScore;     // generating new ideas from reading
  oralWriting: ICDLIScore;        // expression of comprehension (low-confidence proxy)
}

/** Continuous averages of ICDLIScore fields for aggregated entities */
export interface ICDLIAverages {
  comprehension: number;
  integration: number;
  inference: number;
  criticalThinking: number;
  contextConnection: number;
  metacognition: number;
  ideaProduction: number;
  oralWriting: number;
}

export interface Distribution {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
}

export interface ScoreDistributions {
  literal: Distribution;
  inferential: Distribution;
  critical: Distribution;
  reflective: Distribution;
  composite: Distribution;
}

export interface StudentMetrics {
  userId: string;
  behavioral: BehavioralMetrics;
  readingLevels: ReadingLevelScores;
  icdli: ICDLIDimensions;
  /** Timestamp range of the analytics events used for this computation */
  dataWindow: { from: number; to: number } | null;
  computedAt: number;
}

export interface CourseMetrics {
  courseId: string;
  courseName: string;
  studentCount: number;
  activeStudentCount: number;       // students with at least 1 recorded session
  averages: {
    behavioral: BehavioralMetrics;
    readingLevels: ReadingLevelScores;
    icdli: ICDLIAverages;
  };
  distributions: ScoreDistributions;
  studentBreakdown: StudentMetrics[];
  topPerformers: string[];          // top 20% by composite score (userId list)
  needsAttention: string[];         // bottom 20% by composite score (userId list)
  computedAt: number;
}

export interface SchoolMetrics {
  schoolId: string;                 // matches group.school field
  courseCount: number;
  studentCount: number;
  activeStudentCount: number;
  averages: {
    behavioral: BehavioralMetrics;
    readingLevels: ReadingLevelScores;
    icdli: ICDLIAverages;
  };
  distributions: ScoreDistributions;
  courseBreakdown: Array<{
    courseId: string;
    courseName: string;
    studentCount: number;
    avgComposite: number;
    avgLiteral: number;
    avgInferential: number;
    avgCritical: number;
    avgReflective: number;
  }>;
  computedAt: number;
}

export interface MetricsReport {
  student?: StudentMetrics;
  course?: CourseMetrics;
  school?: SchoolMetrics;
  computedAt: number;
}

// ---------------------------------------------------------------------------
// MODULE STATE (populated by init())
// ---------------------------------------------------------------------------

let _events: ReadingEvent[] = [];
let _leoMemory: LeoMemoryDatabase = { memoryMap: {} };
let _progress: ProgressDatabase = { progressMap: {} };
let _groups: Group[] = [];
let _users: User[] = [];
let _initialized = false;

/** Load data into the module. Must be called before any compute* function. */
export function init(raw: RawData): void {
  _events    = Array.isArray(raw.events) ? raw.events : [];
  _leoMemory = raw.leoMemory ?? { memoryMap: {} };
  _progress  = raw.progress  ?? { progressMap: {} };
  _groups    = Array.isArray(raw.groups) ? raw.groups : [];
  _users     = Array.isArray(raw.users)  ? raw.users  : [];
  _initialized = true;
}

// ---------------------------------------------------------------------------
// INTERNAL: PARSED SESSION
// ---------------------------------------------------------------------------

interface ParsedSession {
  userId: string;
  contentId: string;
  startTimestamp: number;
  endTimestamp: number | null;
  durationMs: number;             // from session_end.sessionDuration (authoritative)
  blocksInSession: number;        // count of block_complete events within session
  peakStreak: number;             // highest streak seen during this session
  finalStreak: number;
  progressPercentage: number;     // from session_end.progressPercentage
  source: 'completion' | 'transition' | 'unmount' | null;
  isSeamlessTransition: boolean;  // session_start.isTransition — came from content handoff
}

function sealSession(partial: Partial<ParsedSession>): ParsedSession {
  return {
    userId:                partial.userId!,
    contentId:             partial.contentId!,
    startTimestamp:        partial.startTimestamp!,
    endTimestamp:          partial.endTimestamp ?? null,
    durationMs:            partial.durationMs ?? 0,
    blocksInSession:       partial.blocksInSession ?? 0,
    peakStreak:            partial.peakStreak ?? 0,
    finalStreak:           partial.finalStreak ?? 0,
    progressPercentage:    partial.progressPercentage ?? 0,
    source:                partial.source ?? null,
    isSeamlessTransition:  partial.isSeamlessTransition ?? false,
  };
}

/**
 * Parse raw events into discrete sessions.
 *
 * Session boundaries:
 *   - Opens:  session_start event
 *   - Closes: first matching session_end event (subsequent session_end for the
 *             same open session are ignored — handles the known double-fire)
 *   - Falls back to: next session_start (incomplete sessions without session_end)
 *
 * block_complete events between open/close are counted per-session.
 * The cumulative `blocksCompleted` field in block_complete is ignored here;
 * we count raw occurrences instead.
 */
function parseSessions(events: ReadingEvent[]): ParsedSession[] {
  const sessions: ParsedSession[] = [];

  // Group events by userId (preserves inter-user isolation)
  const byUser = new Map<string, ReadingEvent[]>();
  for (const ev of events) {
    if (!byUser.has(ev.userId)) byUser.set(ev.userId, []);
    byUser.get(ev.userId)!.push(ev);
  }

  for (const [, userEvents] of byUser) {
    const sorted = [...userEvents].sort((a, b) => a.timestamp - b.timestamp);
    let open: Partial<ParsedSession> | null = null;

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
            peakStreak:           ev.streak,
            finalStreak:          ev.streak,
            progressPercentage:   0,
            source:               null,
            isSeamlessTransition: ev.isTransition ?? false,
          };
          break;
        }
        case 'block_complete': {
          if (open && open.contentId === ev.contentId) {
            open.blocksInSession = (open.blocksInSession ?? 0) + 1;
            open.peakStreak      = Math.max(open.peakStreak ?? 0, ev.streak);
            open.finalStreak     = ev.streak;
          }
          break;
        }
        case 'session_end': {
          // Only close if this session is still open (ignore double-fire duplicates)
          if (open && open.contentId === ev.contentId && open.endTimestamp == null) {
            open.endTimestamp      = ev.timestamp;
            open.durationMs        = ev.sessionDuration;
            open.progressPercentage = ev.progressPercentage ?? 0;
            open.source            = (ev.source ?? null) as ParsedSession['source'];
            sessions.push(sealSession(open));
            open = null;
          }
          break;
        }
        // streak_break and level_up are handled at the event level, not per-session
      }
    }

    if (open) sessions.push(sealSession(open)); // trailing incomplete session
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// INTERNAL: LEO MEMORY HELPERS
// ---------------------------------------------------------------------------

function getLeoEntriesForUser(userId: string): LeoMemoryEntry[] {
  const prefix = `${userId}__`;
  return Object.entries(_leoMemory.memoryMap)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry);
}

type DifficultyLevel = 'inicial' | 'medio' | 'avanzado';
type PedagogicalStage = 'comprehension' | 'interpretation' | 'reflection' | 'creation';

const DIFFICULTY_SCORE: Record<DifficultyLevel, number> = {
  inicial:  0,
  medio:    0.5,
  avanzado: 1,
};

const STAGE_SCORE: Record<PedagogicalStage, number> = {
  comprehension: 1,
  interpretation: 2,
  reflection:    3,
  creation:      4,
};

// ---------------------------------------------------------------------------
// INTERNAL: STATISTICAL HELPERS
// ---------------------------------------------------------------------------

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function computeDistribution(values: number[]): Distribution {
  if (values.length === 0) {
    return { n: 0, min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0 };
  }
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return {
    n,
    min:    s[0],
    max:    s[n - 1],
    mean:   mean(s),
    median: n % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid],
    p25:    s[Math.max(0, Math.floor(n * 0.25) - 1)],
    p75:    s[Math.min(n - 1, Math.floor(n * 0.75))],
  };
}

function buildScoreDistributions(students: StudentMetrics[]): ScoreDistributions {
  return {
    literal:     computeDistribution(students.map(s => s.readingLevels.literal)),
    inferential: computeDistribution(students.map(s => s.readingLevels.inferential)),
    critical:    computeDistribution(students.map(s => s.readingLevels.critical)),
    reflective:  computeDistribution(students.map(s => s.readingLevels.reflective)),
    composite:   computeDistribution(students.map(s => s.readingLevels.composite)),
  };
}

// ---------------------------------------------------------------------------
// INTERNAL: ICDLI MAPPING
// ---------------------------------------------------------------------------

/**
 * Map a continuous 0–100 score to a 1–4 ICDLI level.
 *
 * Thresholds (calibrated for behavioral proxies which are noisier than
 * direct assessment):
 *   < 30  → 1 Initial      (no meaningful engagement signals)
 *   30–54 → 2 Basic        (consistent but shallow engagement)
 *   55–74 → 3 Developing   (sustained engagement with depth cues)
 *   ≥ 75  → 4 Advanced     (strong behavioral markers across all signals)
 */
function scoreToICDLI(score: number): ICDLIScore {
  if (score >= 75) return 4;
  if (score >= 55) return 3;
  if (score >= 30) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// BEHAVIORAL METRICS
// ---------------------------------------------------------------------------

/**
 * Compute behavioral metrics for a specific set of sessions and event subset.
 * All rates are expressed as 0–1 fractions.
 */
function computeBehavioral(
  sessions: ParsedSession[],
  userEvents: ReadingEvent[]
): BehavioralMetrics {
  const n = sessions.length;
  if (n === 0) {
    return {
      totalSessions: 0,
      totalReadingTimeMs: 0,
      avgSessionDurationMs: 0,
      avgBlocksPerSession: 0,
      tranceEntryRate: 0,
      autoTransitionRate: 0,
      completionRate: 0,
      avgProgressPercentage: 0,
      avgPeakStreak: 0,
      streakBreakRate: 0,
      distinctContentsRead: 0,
      rereadsRate: 0,
    };
  }

  const totalReadingTimeMs    = sessions.reduce((s, ses) => s + ses.durationMs, 0);
  const avgSessionDurationMs  = totalReadingTimeMs / n;
  const avgBlocksPerSession   = mean(sessions.map(s => s.blocksInSession));

  // Trance: session entered trance if peak streak >= 3
  // (TranceEngine activates at streak >= 3 with wasContinuing=true — streak >= 3
  //  in analytics is the observable proxy for that condition)
  const tranceSessions        = sessions.filter(s => s.peakStreak >= 3).length;
  const tranceEntryRate       = tranceSessions / n;

  // Auto-transition: sessions that ended as seamless content handoffs
  const transitionSessions    = sessions.filter(s => s.source === 'transition').length;
  const autoTransitionRate    = transitionSessions / n;

  // Completion: sessions where >= 80% of content was reached
  const completedSessions     = sessions.filter(s => s.progressPercentage >= 80).length;
  const completionRate        = completedSessions / n;

  const avgProgressPercentage = mean(sessions.map(s => s.progressPercentage));
  const avgPeakStreak         = mean(sessions.map(s => s.peakStreak));

  // Streak break rate: streak_break events / block_complete events
  const streakBreaks   = userEvents.filter(e => e.event === 'streak_break').length;
  const blockCompletes = userEvents.filter(e => e.event === 'block_complete').length;
  const streakBreakRate = blockCompletes > 0 ? streakBreaks / blockCompletes : 0;

  // Distinct contents
  const contentsSeen = new Set(sessions.map(s => s.contentId));
  const distinctContentsRead = contentsSeen.size;

  // Reread rate: content read in more than one distinct session
  const contentSessionCount = new Map<string, number>();
  for (const s of sessions) {
    contentSessionCount.set(s.contentId, (contentSessionCount.get(s.contentId) ?? 0) + 1);
  }
  const rereadsCount  = [...contentSessionCount.values()].filter(c => c > 1).length;
  const rereadsRate   = distinctContentsRead > 0 ? rereadsCount / distinctContentsRead : 0;

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

/**
 * Compute the four reading level scores (0–100) from behavioral signals.
 *
 * LITERAL — Ability to extract explicitly stated information.
 * Formula:  0.40 × completionRate
 *         + 0.35 × avgProgressNorm
 *         + 0.25 × readingConsistency
 *
 * Where readingConsistency = 1 − streakBreakRate (clamped 0–1).
 * Rationale: literal comprehension manifests as sustained, completion-oriented
 * reading. Readers who finish content and maintain focus demonstrate they can
 * extract the explicit information structure of a text.
 */
function computeLiteralScore(b: BehavioralMetrics): number {
  const avgProgressNorm   = clamp(b.avgProgressPercentage / 100, 0, 1);
  const consistency       = clamp(1 - b.streakBreakRate, 0, 1);
  return clamp(
    (b.completionRate * 0.40 + avgProgressNorm * 0.35 + consistency * 0.25) * 100,
    0, 100
  );
}

/**
 * INFERENTIAL — Ability to derive meaning beyond explicit content.
 * Formula:  0.35 × anchorEngagementRate
 *         + 0.35 × sessionDepthRate
 *         + 0.30 × multiContentRate
 *
 * Where:
 *   anchorEngagementRate = (totalAnchorsEngaged / max(totalSessions, 1)) capped at 1
 *   sessionDepthRate     = sessions with blocksInSession >= 2 / total
 *   multiContentRate     = min(1, distinctContents / max(totalSessions, 1))
 *
 * Rationale: inferential reading requires sustained cross-block attention
 * (depth), engagement with Leo's contextual prompts (anchor engagement), and
 * breadth of reading across multiple texts.
 */
function computeInferentialScore(
  b: BehavioralMetrics,
  sessions: ParsedSession[],
  leoEntries: LeoMemoryEntry[]
): number {
  const totalAnchors      = leoEntries.reduce((s, e) => s + e.recentAnchors.length, 0);
  const anchorRate        = clamp(totalAnchors / Math.max(1, b.totalSessions), 0, 1);

  const deepSessions      = sessions.filter(s => s.blocksInSession >= 2).length;
  const sessionDepthRate  = b.totalSessions > 0 ? deepSessions / b.totalSessions : 0;

  const multiContentRate  = clamp(
    b.distinctContentsRead / Math.max(1, b.totalSessions),
    0, 1
  );

  return clamp(
    (anchorRate * 0.35 + sessionDepthRate * 0.35 + multiContentRate * 0.30) * 100,
    0, 100
  );
}

/**
 * CRITICAL — Evaluative, questioning engagement with text.
 * Formula:  0.40 × tranceEntryRate
 *         + 0.35 × deepStreakRate
 *         + 0.25 × advancedLeoRate
 *
 * Where:
 *   deepStreakRate   = sessions with peakStreak >= 5 / total
 *   advancedLeoRate = Leo memories with difficultyLevel === 'avanzado' / total Leo memories
 *
 * Rationale: critical readers sustain deep focus (trance), build long streaks
 * (resistance to distraction), and voluntarily select the hardest Leo mode.
 */
function computeCriticalScore(
  b: BehavioralMetrics,
  sessions: ParsedSession[],
  leoEntries: LeoMemoryEntry[]
): number {
  const deepStreakSessions = sessions.filter(s => s.peakStreak >= 5).length;
  const deepStreakRate     = b.totalSessions > 0 ? deepStreakSessions / b.totalSessions : 0;

  const advancedCount     = leoEntries.filter(e => e.difficultyLevel === 'avanzado').length;
  const advancedLeoRate   = leoEntries.length > 0 ? advancedCount / leoEntries.length : 0;

  return clamp(
    (b.tranceEntryRate * 0.40 + deepStreakRate * 0.35 + advancedLeoRate * 0.25) * 100,
    0, 100
  );
}

/**
 * REFLECTIVE — Meta-awareness, revisiting, exploration beyond requirements.
 * Formula:  0.35 × stageAdvancementRate
 *         + 0.35 × voluntaryContinuationRate
 *         + 0.30 × rereadsRate
 *
 * Where:
 *   stageAdvancementRate     = mean(stageScore for each Leo memory) / 4
 *   voluntaryContinuationRate = autoTransitionRate (reader chose to keep reading)
 *
 * Stage scores: comprehension=1, interpretation=2, reflection=3, creation=4
 * Rationale: reflective readers voluntarily continue (auto-transitions), revisit
 * content, and advance to higher pedagogical engagement stages through Leo.
 */
function computeReflectiveScore(b: BehavioralMetrics, leoEntries: LeoMemoryEntry[]): number {
  const stageScores         = leoEntries.map(e => STAGE_SCORE[e.pedagogicalStage] ?? 1);
  const stageAdvancement    = leoEntries.length > 0 ? mean(stageScores) / 4 : 0;
  const voluntaryCont       = b.autoTransitionRate;

  return clamp(
    (stageAdvancement * 0.35 + voluntaryCont * 0.35 + b.rereadsRate * 0.30) * 100,
    0, 100
  );
}

function computeReadingLevels(
  b: BehavioralMetrics,
  sessions: ParsedSession[],
  leoEntries: LeoMemoryEntry[]
): ReadingLevelScores {
  const literal     = computeLiteralScore(b);
  const inferential = computeInferentialScore(b, sessions, leoEntries);
  const critical    = computeCriticalScore(b, sessions, leoEntries);
  const reflective  = computeReflectiveScore(b, leoEntries);

  // Composite: weighted toward active comprehension (inferential + critical)
  const composite   = clamp(
    literal * 0.20 + inferential * 0.30 + critical * 0.30 + reflective * 0.20,
    0, 100
  );

  return { literal, inferential, critical, reflective, composite };
}

// ---------------------------------------------------------------------------
// ICDLI DIMENSIONS
// ---------------------------------------------------------------------------

/**
 * Compute the 8 ICDLI dimensions (1–4) from behavioral scores.
 *
 * Dimension → primary behavioral signal → formula:
 *
 * 1. comprehension    → literal score (direct mapping)
 * 2. integration      → combining literal accuracy + inferential depth
 *                       score = literal × 0.40 + inferential × 0.60
 * 3. inference        → inferential score (direct mapping)
 * 4. criticalThinking → critical score (direct mapping)
 * 5. contextConnection → breadth of reading × advanced Leo engagement
 *                        score = multiContentRate×60 + advancedLeoRate×40
 * 6. metacognition    → reflective behavior + self-regulation
 *                       score = reflective×0.60 + consistency×40
 * 7. ideaProduction   → peak pedagogical stage reached + critical engagement
 *                       score = peakStageScore×0.70 + critical×0.30
 * 8. oralWriting      → voluntary engagement signals (lowest confidence proxy;
 *                       supplement with direct assessment for reliability)
 *                       score = autoTransitionRate×50 + anchorRate×50
 */
function computeICDLI(
  rl: ReadingLevelScores,
  b: BehavioralMetrics,
  sessions: ParsedSession[],
  leoEntries: LeoMemoryEntry[]
): ICDLIDimensions {
  // Pre-compute shared signals
  const consistency      = clamp(1 - b.streakBreakRate, 0, 1);
  const advancedCount    = leoEntries.filter(e => e.difficultyLevel === 'avanzado').length;
  const advancedLeoRate  = leoEntries.length > 0 ? advancedCount / leoEntries.length : 0;
  const multiContentRate = clamp(
    b.distinctContentsRead / Math.max(1, b.totalSessions),
    0, 1
  );
  const totalAnchors     = leoEntries.reduce((s, e) => s + e.recentAnchors.length, 0);
  const anchorRate       = clamp(totalAnchors / Math.max(1, b.totalSessions), 0, 1);

  // Peak pedagogical stage reached across all Leo interactions
  const maxStage         = leoEntries.length > 0
    ? Math.max(...leoEntries.map(e => STAGE_SCORE[e.pedagogicalStage] ?? 1))
    : 1;
  const peakStageScore   = ((maxStage - 1) / 3) * 100; // normalize 1–4 → 0–100

  const integrationScore   = clamp(rl.literal * 0.40 + rl.inferential * 0.60, 0, 100);
  const contextScore       = clamp(multiContentRate * 60 + advancedLeoRate * 40, 0, 100);
  const metacognitionScore = clamp(rl.reflective * 0.60 + consistency * 40, 0, 100);
  const ideaScore          = clamp(peakStageScore * 0.70 + rl.critical * 0.30, 0, 100);
  const oralWritingScore   = clamp(b.autoTransitionRate * 50 + anchorRate * 50, 0, 100);

  return {
    comprehension:    scoreToICDLI(rl.literal),
    integration:      scoreToICDLI(integrationScore),
    inference:        scoreToICDLI(rl.inferential),
    criticalThinking: scoreToICDLI(rl.critical),
    contextConnection: scoreToICDLI(contextScore),
    metacognition:    scoreToICDLI(metacognitionScore),
    ideaProduction:   scoreToICDLI(ideaScore),
    oralWriting:      scoreToICDLI(oralWritingScore),
  };
}

// ---------------------------------------------------------------------------
// STUDENT METRICS
// ---------------------------------------------------------------------------

/** Return all events for a single user. */
function eventsForUser(userId: string): ReadingEvent[] {
  return _events.filter(e => e.userId === userId);
}

/**
 * Compute full metrics for a single student.
 * Returns a zeroed metrics object if the student has no recorded events.
 */
export function computeStudentMetrics(userId: string): StudentMetrics {
  if (!_initialized) throw new Error('metricsEngine: call init() before computing metrics');

  const userEvents  = eventsForUser(userId);
  const allSessions = parseSessions(_events);
  const sessions    = allSessions.filter(s => s.userId === userId);
  const leoEntries  = getLeoEntriesForUser(userId);

  const behavioral  = computeBehavioral(sessions, userEvents);
  const readingLevels = computeReadingLevels(behavioral, sessions, leoEntries);
  const icdli       = computeICDLI(readingLevels, behavioral, sessions, leoEntries);

  const timestamps  = userEvents.map(e => e.timestamp);
  const dataWindow  = timestamps.length > 0
    ? { from: Math.min(...timestamps), to: Math.max(...timestamps) }
    : null;

  return {
    userId,
    behavioral,
    readingLevels,
    icdli,
    dataWindow,
    computedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// AGGREGATION HELPERS (used by course and school)
// ---------------------------------------------------------------------------

function avgBehavioral(students: StudentMetrics[]): BehavioralMetrics {
  if (students.length === 0) return computeBehavioral([], []);
  const f = (pick: (s: StudentMetrics) => number) => mean(students.map(pick));
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

function avgReadingLevels(students: StudentMetrics[]): ReadingLevelScores {
  if (students.length === 0) return { literal: 0, inferential: 0, critical: 0, reflective: 0, composite: 0 };
  const f = (pick: (s: StudentMetrics) => number) => mean(students.map(pick));
  return {
    literal:     f(s => s.readingLevels.literal),
    inferential: f(s => s.readingLevels.inferential),
    critical:    f(s => s.readingLevels.critical),
    reflective:  f(s => s.readingLevels.reflective),
    composite:   f(s => s.readingLevels.composite),
  };
}

function avgICDLI(students: StudentMetrics[]): ICDLIAverages {
  if (students.length === 0) {
    return { comprehension: 1, integration: 1, inference: 1, criticalThinking: 1,
             contextConnection: 1, metacognition: 1, ideaProduction: 1, oralWriting: 1 };
  }
  const f = (pick: (s: StudentMetrics) => number) => mean(students.map(pick));
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

/** Return the userId list for the top/bottom N% by composite score. */
function topBottomByComposite(
  students: StudentMetrics[],
  fraction: number
): { top: string[]; bottom: string[] } {
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

/** Resolve all student IDs from a group (handles both legacy and new schemas). */
function getGroupStudentIds(group: Group): string[] {
  const ids = new Set<string>([
    ...(group.studentIds ?? []),
    ...(group.memberIds  ?? []),
  ]);
  // Also include users who reference this group in their groupIds field
  for (const user of _users) {
    if (user.groupIds?.includes(group.id)) ids.add(user.id);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// COURSE METRICS
// ---------------------------------------------------------------------------

/**
 * Compute aggregated metrics for a course (group).
 * courseId must match a group `id` field in groups_db.json.
 */
export function computeCourseMetrics(courseId: string): CourseMetrics {
  if (!_initialized) throw new Error('metricsEngine: call init() before computing metrics');

  const group = _groups.find(g => g.id === courseId);
  if (!group) {
    throw new Error(`metricsEngine: group "${courseId}" not found`);
  }

  const studentIds = getGroupStudentIds(group);

  // Compute per-student metrics for everyone in the course
  const allStudents     = studentIds.map(id => computeStudentMetrics(id));
  const activeStudents  = allStudents.filter(s => s.behavioral.totalSessions > 0);

  const { top, bottom } = topBottomByComposite(activeStudents, 0.20);

  return {
    courseId,
    courseName:        group.name,
    studentCount:      allStudents.length,
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

/**
 * Compute aggregated metrics for a school.
 *
 * schoolId = the value of the `school` field on groups (e.g., "Colegio Chibalete").
 * Since schools_db.json is currently empty, school identity is derived from
 * the `school` field on group records — all groups sharing the same school
 * string are treated as belonging to the same institution.
 */
export function computeSchoolMetrics(schoolId: string): SchoolMetrics {
  if (!_initialized) throw new Error('metricsEngine: call init() before computing metrics');

  const schoolGroups = _groups.filter(
    g => g.school?.toLowerCase() === schoolId.toLowerCase()
  );

  if (schoolGroups.length === 0) {
    throw new Error(`metricsEngine: no groups found for school "${schoolId}"`);
  }

  // Collect unique student IDs across all school groups to avoid double-counting
  const allStudentIds = new Set<string>();
  for (const group of schoolGroups) {
    for (const id of getGroupStudentIds(group)) allStudentIds.add(id);
  }

  const allStudents    = [...allStudentIds].map(id => computeStudentMetrics(id));
  const activeStudents = allStudents.filter(s => s.behavioral.totalSessions > 0);

  // Per-course breakdown (only groups with at least one student)
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
        avgComposite:   mean(compScores),
        avgLiteral:     mean(active.map(s => s.readingLevels.literal)),
        avgInferential: mean(active.map(s => s.readingLevels.inferential)),
        avgCritical:    mean(active.map(s => s.readingLevels.critical)),
        avgReflective:  mean(active.map(s => s.readingLevels.reflective)),
      };
    })
    .sort((a, b) => b.avgComposite - a.avgComposite);

  return {
    schoolId,
    courseCount:       schoolGroups.length,
    studentCount:      allStudents.length,
    activeStudentCount: activeStudents.length,
    averages: {
      behavioral:    avgBehavioral(activeStudents),
      readingLevels: avgReadingLevels(activeStudents),
      icdli:         avgICDLI(activeStudents),
    },
    distributions:    buildScoreDistributions(activeStudents),
    courseBreakdown,
    computedAt:       Date.now(),
  };
}

// ---------------------------------------------------------------------------
// FULL REPORT
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper: compute any combination of student / course / school
 * metrics in a single call.
 *
 * Example:
 *   const report = computeFullReport({ userId: 'user-tono', courseId: 'group-chiba1' });
 *   report.student  // StudentMetrics
 *   report.course   // CourseMetrics
 */
export function computeFullReport(params: {
  userId?:  string;
  courseId?: string;
  schoolId?: string;
}): MetricsReport {
  if (!_initialized) throw new Error('metricsEngine: call init() before computing metrics');

  return {
    student:  params.userId   ? computeStudentMetrics(params.userId)   : undefined,
    course:   params.courseId ? computeCourseMetrics(params.courseId)  : undefined,
    school:   params.schoolId ? computeSchoolMetrics(params.schoolId)  : undefined,
    computedAt: Date.now(),
  };
}
