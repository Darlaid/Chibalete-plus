/**
 * interventionAnalyticsService.js
 *
 * Pure analytics functions for intervention effectiveness and pedagogical alignment.
 * No file I/O — callers pass data, this module only computes.
 *
 * Pedagogical model reference (Chibalete program):
 *   - Continuidad: lectura como práctica regular, no evento
 *   - Vínculo:     mediación afectiva, relectura voluntaria
 *   - Conversación: diálogo profundo con el texto (Leo como proxy)
 *   - Sostenimiento familiar: nodo familia como soporte
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_DAY            = 86_400_000;
const EARLY_WINDOW_DAYS = 14;
const LATE_WINDOW_DAYS  = 60;
const PRE_BASELINE_DAYS = 30;
const IMPROVEMENT_RATIO = 1.5;     // 50% more reading per day vs baseline
const MIN_ASSESSABLE_MS = 3 * MS_DAY;

// Depth weights for Leo interaction types — reflects conversational complexity
const LEO_DEPTH_WEIGHTS = {
    vocab:         0.25,
    comprehension: 0.50,
    question:      0.60,
    inferential:   0.75,
    reflection:    1.00,
};

/**
 * Which pedagogical dimension each intervention type primarily targets.
 * Used to align recommendations with the detected problem dimension.
 */
export const INTERVENTION_DIMENSION_MAP = {
    sesion_acompanada:  ['engagement', 'continuity'],
    retomar_contenido:  ['continuity'],
    cambio_texto:       ['engagement'],
    contacto_familia:   ['familySupport'],
    seguimiento_remoto: ['continuity'],
    otro:               [],
};

// ---------------------------------------------------------------------------
// Tier 1 — data extraction helpers
// ---------------------------------------------------------------------------

/**
 * Build a map of studentId → totalReadingTimeMs from progress_db.progressMap.
 */
export function buildStudentReadingTimeMap(progressDb) {
    const map = {};
    for (const entry of Object.values(progressDb.progressMap ?? {})) {
        if (!entry.userId) continue;
        if (!map[entry.userId]) map[entry.userId] = 0;
        const history = Array.isArray(entry.history) ? entry.history : [];
        map[entry.userId] += history.reduce((sum, h) => sum + Math.max(0, (h.durationSec ?? 0) * 1000), 0);
    }
    return map;
}

/**
 * Build per-student session timelines from progress history entries.
 * Requires history entries to have a `startedAt` ISO field (set by LU Android).
 */
export function buildStudentSessionTimelines(progressDb) {
    const timelines = {};
    for (const entry of Object.values(progressDb.progressMap ?? {})) {
        const { userId, history } = entry;
        if (!userId || !Array.isArray(history)) continue;
        if (!timelines[userId]) timelines[userId] = [];
        for (const h of history) {
            if (!h.startedAt) continue;
            const ts = new Date(h.startedAt).getTime();
            if (!isNaN(ts) && ts > 0) {
                timelines[userId].push({
                    timestamp:  ts,
                    durationMs: Math.max(0, (h.durationSec ?? 0) * 1000),
                });
            }
        }
    }
    for (const uid of Object.keys(timelines)) {
        timelines[uid].sort((a, b) => a.timestamp - b.timestamp);
    }
    return timelines;
}

/**
 * Build per-student Leo interaction lists from leo_interactions_db entries.
 * Returns { studentId: [{ interactionType, contentId, ... }] }
 */
export function buildStudentLeoInteractionsMap(leoInteractions) {
    const map = {};
    for (const entry of (leoInteractions ?? [])) {
        if (!entry.userId) continue;
        if (!map[entry.userId]) map[entry.userId] = [];
        map[entry.userId].push(entry);
    }
    return map;
}

// ---------------------------------------------------------------------------
// Tier 2 — pedagogical metric helpers (private)
// ---------------------------------------------------------------------------

function _readingConsistencyScore(sessions) {
    const ts = sessions.filter(s => s.timestamp > 0);
    if (ts.length < 3) return ts.length > 0 ? 0.3 : 0;
    const sorted = [...ts].sort((a, b) => a.timestamp - b.timestamp);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
        gaps.push((sorted[i].timestamp - sorted[i - 1].timestamp) / MS_DAY);
    }
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (mean < 0.01) return 0.95;
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
    const cv = Math.sqrt(variance) / mean;
    return Math.max(0, Math.min(1, 1 - cv));
}

function _weeklyPresenceRate(sessions, fromMs = null, toMs = null) {
    const now    = toMs   ?? Date.now();
    const start  = fromMs ?? now - 28 * MS_DAY;
    const recent = sessions.filter(s => s.timestamp >= start && s.timestamp <= now);
    if (recent.length === 0) return 0;
    const totalDays = Math.max(1, (now - start) / MS_DAY);
    const totalWeeks = totalDays / 7;
    const weeksWithActivity = new Set(
        recent.map(s => Math.floor((now - s.timestamp) / (7 * MS_DAY)))
    );
    return Math.min(1, weeksWithActivity.size / Math.ceil(totalWeeks));
}

function _weekendReadingRate(sessions) {
    if (sessions.length === 0) return 0;
    const weekendCount = sessions.filter(s => {
        const day = new Date(s.timestamp).getUTCDay();
        return day === 0 || day === 6;
    }).length;
    return weekendCount / sessions.length;
}

function _conversationalDepthScore(leoInteractions) {
    if (!leoInteractions || leoInteractions.length === 0) return 0;
    let weightedSum = 0;
    let validCount  = 0;
    for (const e of leoInteractions) {
        const type   = e.interactionType ?? null;
        const weight = type ? (LEO_DEPTH_WEIGHTS[type] ?? null) : null;
        if (weight !== null) { weightedSum += weight; validCount++; }
    }
    return validCount > 0 ? weightedSum / validCount : 0;
}

// ---------------------------------------------------------------------------
// Tier 3 — exported pedagogical profile
// ---------------------------------------------------------------------------

/**
 * Compute the 4 pedagogical dimension scores for one student.
 *
 *   readingConsistencyScore   — temporal regularity of sessions (habit quality)
 *   weeklyPresenceRate        — active weeks in last 4 (habit frequency)
 *   weekendReadingRate        — proportion of weekend sessions (family support proxy)
 *   conversationalDepthScore  — Leo interaction depth (conversación proxy)
 *
 * All scores are 0–1.
 */
export function computePedagogicalProfile(sessions = [], leoInteractions = []) {
    return {
        readingConsistencyScore:  _readingConsistencyScore(sessions),
        weeklyPresenceRate:       _weeklyPresenceRate(sessions),
        weekendReadingRate:       _weekendReadingRate(sessions),
        conversationalDepthScore: _conversationalDepthScore(leoInteractions),
    };
}

/**
 * Aggregate individual student profiles into a course-level summary.
 * Returns mean score per dimension plus a count of students with any session data.
 */
export function aggregateCoursePedagogicalProfile(studentProfiles) {
    const ids = Object.keys(studentProfiles);
    if (ids.length === 0) return null;

    const dims = ['readingConsistencyScore', 'weeklyPresenceRate', 'weekendReadingRate', 'conversationalDepthScore'];
    const sums = Object.fromEntries(dims.map(d => [d, 0]));
    let activeCount = 0;

    for (const profile of Object.values(studentProfiles)) {
        const hasData = profile.weeklyPresenceRate > 0 || profile.readingConsistencyScore > 0;
        if (hasData) activeCount++;
        for (const d of dims) sums[d] += profile[d] ?? 0;
    }

    const means = Object.fromEntries(dims.map(d => [d, ids.length > 0 ? sums[d] / ids.length : 0]));
    return { ...means, studentCount: ids.length, activeCount };
}

// ---------------------------------------------------------------------------
// Tier 4 — single-intervention impact signals
// ---------------------------------------------------------------------------

/**
 * Binary impact based on total reading time growth.
 *
 * V9 65B — con `sessionTimelines`, las dos cifras de la comparación salen de la MISMA fuente: las sesiones fechadas
 * del lector (antes de la intervención frente al total). Antes se dividía el total de esas sesiones entre
 * `readingTimeMsAtIntervention`, una cifra que guardó el cliente al registrar la intervención y que procede de otra
 * fuente (el tiempo que mostraba el tablero): dos magnitudes distintas daban «mejoró» sin lectura posterior. La regla
 * no cambia (creció más de un 20 %; sin lectura previa, más de un minuto). Además se dice cuándo no hay evaluación:
 *   'pending'       la intervención tiene menos de MIN_ASSESSABLE_MS (los mismos 3 días de la evaluación temporal);
 *   'insufficient'  el lector no tiene ninguna sesión fechada con la que comparar.
 * Sin `sessionTimelines` (llamadas antiguas) se conserva el cálculo anterior.
 * @returns {'improved'|'unchanged'|'pending'|'insufficient'}
 */
export function computeImpact(intervention, studentReadingTimeMap, sessionTimelines = null, nowMs = Date.now()) {
    if (sessionTimelines) {
        const growth = readingGrowthSince(intervention, sessionTimelines, nowMs);
        if (growth.state) return growth.state;
        if (growth.beforeMs === 0) return growth.totalMs > 60_000 ? 'improved' : 'unchanged';
        return growth.totalMs / growth.beforeMs > 1.2 ? 'improved' : 'unchanged';
    }
    const currentMs = studentReadingTimeMap[intervention.studentId] ?? 0;
    const snapMs    = intervention.readingTimeMsAtIntervention ?? 0;
    if (snapMs === 0) return currentMs > 60_000 ? 'improved' : 'unchanged';
    return currentMs / snapMs > 1.2 ? 'improved' : 'unchanged';
}

/** Tiempo de lectura fechado del lector antes de la intervención y en total, o por qué no hay comparación. */
function readingGrowthSince(intervention, sessionTimelines, nowMs = Date.now()) {
    const t0 = new Date(intervention.createdAt).getTime();
    if (nowMs - t0 < MIN_ASSESSABLE_MS) return { state: 'pending' };
    const sessions = sessionTimelines[intervention.studentId] ?? [];
    if (sessions.length === 0) return { state: 'insufficient' };
    let beforeMs = 0, totalMs = 0;
    for (const s of sessions) { totalMs += s.durationMs; if (s.timestamp < t0) beforeMs += s.durationMs; }
    return { state: null, beforeMs, totalMs };
}

/**
 * Temporal impact using per-student session timeline.
 * Also computes dimension-level impacts (continuity and familySupport).
 *
 * Classification:
 *   immediate_improvement — rate improved in 0–14d AND held (or late window pending)
 *   sustained_improvement — rate didn't jump early but improved in 15–60d window
 *   no_improvement        — no change, or early spike that regressed
 */
export function computeTemporalImpact(intervention, sessions = []) {
    const t0       = new Date(intervention.createdAt).getTime();
    const now      = Date.now();
    const earlyEnd = t0 + EARLY_WINDOW_DAYS * MS_DAY;
    const lateEnd  = t0 + LATE_WINDOW_DAYS  * MS_DAY;
    const preStart = t0 - PRE_BASELINE_DAYS * MS_DAY;

    if (now - t0 < MIN_ASSESSABLE_MS) {
        return {
            temporalImpact: 'no_improvement', timeToImprovement: null,
            note: 'too_early', dimensionImpacts: null,
        };
    }

    const preSessions   = sessions.filter(s => s.timestamp >= preStart && s.timestamp < t0);
    const earlySessions = sessions.filter(s => s.timestamp >= t0 && s.timestamp < earlyEnd);
    const lateAvailable = now > earlyEnd;
    const lateSessions  = lateAvailable ? sessions.filter(s => s.timestamp >= earlyEnd && s.timestamp < lateEnd) : [];

    const preRate   = preSessions.reduce((s, x) => s + x.durationMs, 0) / PRE_BASELINE_DAYS;
    const earlyRate = earlySessions.reduce((s, x) => s + x.durationMs, 0) / EARLY_WINDOW_DAYS;
    const lateDays  = LATE_WINDOW_DAYS - EARLY_WINDOW_DAYS;
    const lateRate  = lateAvailable ? lateSessions.reduce((s, x) => s + x.durationMs, 0) / lateDays : null;

    const threshold     = Math.max(preRate * IMPROVEMENT_RATIO, MS_DAY / 1440);
    const earlyImproved = earlyRate >= threshold;
    const lateImproved  = lateRate !== null && lateRate >= threshold;

    let temporalImpact;
    let timeToImprovement = null;

    if (earlyImproved && (!lateAvailable || lateImproved)) {
        temporalImpact    = 'immediate_improvement';
        timeToImprovement = earlySessions[0] ? earlySessions[0].timestamp - t0 : null;
    } else if (!earlyImproved && lateImproved) {
        temporalImpact    = 'sustained_improvement';
        timeToImprovement = lateSessions[0] ? lateSessions[0].timestamp - t0 : null;
    } else {
        temporalImpact = 'no_improvement';
    }

    // Dimension-level impacts: compare continuity & family support before/after
    const postSessions = sessions.filter(s => s.timestamp >= t0 && s.timestamp < t0 + 30 * MS_DAY);
    const prePresence  = _weeklyPresenceRate(preSessions,  preStart, t0);
    const postPresence = _weeklyPresenceRate(postSessions, t0,       t0 + 30 * MS_DAY);
    const preWeekend   = _weekendReadingRate(preSessions);
    const postWeekend  = _weekendReadingRate(postSessions);

    const dimensionImpacts = {
        continuity:    postPresence > prePresence + 0.2   ? 'improved' : 'unchanged',
        familySupport: postWeekend  > preWeekend  + 0.1   ? 'improved' : 'unchanged',
    };

    return {
        temporalImpact, timeToImprovement, dimensionImpacts,
        rates: {
            preDailyMs:   Math.round(preRate),
            earlyDailyMs: Math.round(earlyRate),
            lateDailyMs:  lateRate !== null ? Math.round(lateRate) : null,
        },
    };
}

// ---------------------------------------------------------------------------
// Tier 5 — aggregations
// ---------------------------------------------------------------------------

/**
 * Aggregate effectiveness by intervention type.
 * When sessionTimelines is provided, also computes temporal + dimension breakdowns.
 * Base signature (2 args) is unchanged — existing callers are unaffected.
 */
export function computeEffectivenessByType(interventions, studentReadingTimeMap, sessionTimelines = null) {
    const byType = {};

    for (const iv of interventions) {
        if (!byType[iv.type]) {
            byType[iv.type] = { total: 0, improved: 0, unchanged: 0, pending: 0, insufficient: 0, immediate: 0, sustained: 0, continuityImproved: 0, familySupportImproved: 0 };
        }
        byType[iv.type].total++;

        // 65B: una intervención aún no evaluable o sin lectura que comparar no cuenta como «sin cambio».
        byType[iv.type][computeImpact(iv, studentReadingTimeMap, sessionTimelines)]++;

        if (sessionTimelines) {
            const sessions = sessionTimelines[iv.studentId] ?? [];
            const { temporalImpact, dimensionImpacts } = computeTemporalImpact(iv, sessions);
            if (temporalImpact === 'immediate_improvement') byType[iv.type].immediate++;
            else if (temporalImpact === 'sustained_improvement') byType[iv.type].sustained++;
            if (dimensionImpacts?.continuity    === 'improved') byType[iv.type].continuityImproved++;
            if (dimensionImpacts?.familySupport === 'improved') byType[iv.type].familySupportImproved++;
        }
    }

    return Object.entries(byType)
        .map(([type, s]) => {
            // 65B: las tasas se calculan sobre las intervenciones EVALUADAS (mejoró o sin cambio); las temporales, sobre
            // las que ya tienen el plazo mínimo (las mismas que el agregado `totalAssessed` de la ruta).
            const evaluated = s.improved + s.unchanged, elapsed = s.total - s.pending;
            return {
                type,
                total:           s.total,
                improved:        s.improved,
                unchanged:       s.unchanged,
                pending:         s.pending,
                insufficient:    s.insufficient,
                evaluated,
                improvementRate: evaluated > 0 ? s.improved / evaluated : 0,
                dimensions:      INTERVENTION_DIMENSION_MAP[type] ?? [],
                ...(sessionTimelines ? {
                    immediateCount:          s.immediate,
                    sustainedCount:          s.sustained,
                    immediateRate:           elapsed > 0 ? s.immediate / elapsed : 0,
                    sustainedRate:           elapsed > 0 ? s.sustained / elapsed : 0,
                    continuityImpactRate:    elapsed > 0 ? s.continuityImproved / elapsed : 0,
                    familySupportImpactRate: elapsed > 0 ? s.familySupportImproved / elapsed : 0,
                } : {}),
            };
        })
        .sort((a, b) => b.improvementRate - a.improvementRate);
}

/**
 * Cross pattern × type → result. Only includes combinations with >=2 data points.
 */
export function computeSuccessPatterns(interventions, studentReadingTimeMap, sessionTimelines = null) {
    const matrix = {};
    for (const iv of interventions) {
        const impact = computeImpact(iv, studentReadingTimeMap, sessionTimelines);
        if (impact === 'pending' || impact === 'insufficient') continue;   // 65B: sin evaluación no hay dato de éxito ni de fracaso
        for (const pattern of (iv.patternsAtIntervention ?? [])) {
            const key = `${pattern}::${iv.type}`;
            if (!matrix[key]) matrix[key] = { pattern, type: iv.type, total: 0, improved: 0 };
            matrix[key].total++;
            if (impact === 'improved') matrix[key].improved++;
        }
    }
    return Object.values(matrix)
        .filter(e => e.total >= 2)
        .map(e => ({ ...e, improvementRate: e.improved / e.total }))
        .sort((a, b) => b.improvementRate - a.improvementRate);
}

/**
 * For a given student pattern, return the best intervention type.
 *
 * When problemDimension is provided, prefers types that target that dimension.
 * Falls back to pure historical rate when no dimension-aligned type has enough data.
 */
export function getRecommendedInterventionType(pattern, successPatterns, problemDimension = null) {
    const relevant = successPatterns.filter(e => e.pattern === pattern);

    if (problemDimension) {
        // Prefer type with both data AND dimension alignment
        const aligned = relevant.filter(e =>
            (INTERVENTION_DIMENSION_MAP[e.type] ?? []).includes(problemDimension)
        );
        if (aligned.length > 0 && aligned[0].improvementRate >= 0.35) return aligned[0].type;

        // No historical data for this combo — use dimension map directly
        const mappedTypes = Object.entries(INTERVENTION_DIMENSION_MAP)
            .filter(([, dims]) => dims.includes(problemDimension))
            .map(([type]) => type);
        if (mappedTypes.length > 0) return mappedTypes[0];
    }

    if (relevant.length === 0) return null;
    return relevant[0].improvementRate >= 0.4 ? relevant[0].type : null;
}

/**
 * Full intervention history for one student with binary, temporal, and dimension impact.
 */
export function buildStudentInterventionHistory(interventions, studentId, studentReadingTimeMap, sessionTimelines = null) {
    const sessions = sessionTimelines ? (sessionTimelines[studentId] ?? []) : [];

    return interventions
        .filter(iv => iv.studentId === studentId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((iv, idx) => {
            const currentMs  = studentReadingTimeMap[studentId] ?? 0;
            const snapMs     = iv.readingTimeMsAtIntervention ?? 0;
            // 65B: con sesiones fechadas, la razón de crecimiento usa la misma fuente en las dos cifras (ver `computeImpact`).
            const growth     = sessionTimelines ? readingGrowthSince(iv, sessionTimelines) : null;
            const timeGrowth = growth
                ? (growth.state ? null : growth.beforeMs > 0 ? growth.totalMs / growth.beforeMs : (growth.totalMs > 60_000 ? 2 : 1))
                : snapMs > 0 ? currentMs / snapMs : (currentMs > 60_000 ? 2 : 1);
            const temporal   = computeTemporalImpact(iv, sessions);

            return {
                ...iv,
                impact:            computeImpact(iv, studentReadingTimeMap, sessionTimelines),
                timeGrowthRatio:   timeGrowth === null ? null : Math.round(timeGrowth * 100) / 100,
                temporalImpact:    temporal.temporalImpact,
                timeToImprovement: temporal.timeToImprovement,
                dimensionImpacts:  temporal.dimensionImpacts,
                temporalRates:     temporal.rates,
                sequenceNumber:    idx + 1,
            };
        });
}
