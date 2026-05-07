/**
 * mergeBackboneMetrics — agrega N respuestas BackboneMetrics en una sola.
 *
 * Sprint Data Backbone — Fase 4.
 *
 * Caso de uso: DashboardAdminLectura recibe un BackboneMetrics por cada escuela
 * y necesita una vista agregada de todas las escuelas seleccionadas.
 *
 * Reglas de fusión:
 *   - Conteos por modo: suma directa de todos los campos numéricos.
 *   - Promedios (`averageProgressFraction`, `errorRate`): se recalculan
 *     ponderando por número de sesiones.
 *   - Máximos (`maxProgressFraction`): se toma el máximo absoluto.
 *   - `estimatedFromHeartbeat`: true si CUALQUIER escuela lo marca true.
 *   - `errorTypes`: merge sumando counts.
 *   - `coveragePercent`: se recalcula desde los conteos sumados.
 *   - `windowDays`: se preserva el primero (asumimos consistencia).
 *   - `windowFrom/To`: min/max respectivamente.
 *
 * Si la lista está vacía → null (el componente se encarga de no renderizar).
 */

import type { BackboneMetrics } from '../components/BackboneModeUsageSection';

// Sub-shapes locales para evitar partials encadenados en cada acceso.
type UsageBucket  = NonNullable<NonNullable<BackboneMetrics['usageByMode']>[string]>;
type TimeBucket   = NonNullable<NonNullable<BackboneMetrics['readingTimeByMode']>[string]>;
type ProgBucket   = NonNullable<NonNullable<BackboneMetrics['progressByMode']>[string]>;
type ErrorBucket  = NonNullable<NonNullable<BackboneMetrics['errorsByMode']>[string]>;
type HbBucket     = NonNullable<NonNullable<BackboneMetrics['heartbeatCoverage']>[string]>;

function emptyUsage(): Required<UsageBucket> {
    return {
        sessionStarts: 0, sessionEnds: 0, heartbeats: 0, activeUsers: 0, activeContents: 0,
        // Sprint 5A — breakdown native/legacy
        nativeSessions: 0, legacySessions: 0, totalSessions: 0,
    };
}
function emptyTime(): Required<TimeBucket> {
    return {
        totalElapsedMs: 0, averageSessionMs: 0, medianSessionMs: 0,
        completedSessions: 0, openSessionsEstimate: 0, estimatedFromHeartbeat: false,
        // Sprint 5A
        nativeElapsedMs: 0, legacyElapsedMs: 0,
    };
}
function emptyProg(): Required<ProgBucket> {
    return { averageProgressFraction: 0, maxProgressFraction: 0, completedCount: 0 };
}
function emptyError(): Required<ErrorBucket> {
    return { errorCount: 0, errorTypes: {}, affectedUsers: 0 };
}
function emptyHb(): Required<HbBucket> {
    return { sessionsWithHeartbeat: 0, sessionsWithoutHeartbeat: 0, coveragePercent: 0 };
}

export function mergeBackboneMetrics(items: BackboneMetrics[]): BackboneMetrics | null {
    if (!Array.isArray(items) || items.length === 0) return null;

    const out: BackboneMetrics = {
        generatedAt:        Date.now(),
        windowDays:         items[0]?.windowDays ?? null,
        windowFrom:         null,
        windowTo:           null,
        totalEvents:        0,
        totalSessions:      0,
        usageByMode:        {},
        readingTimeByMode:  {},
        progressByMode:     {},
        errorsByMode:       {},
        immersiveAudio:     { audioPlayCount: 0, audioPauseCount: 0, audioSessions: 0, averagePlayPauseRatio: 0 },
        a11yAdoption:       { users: 0, sessions: 0, avgProgress: 0, errorRate: 0 },
        heartbeatCoverage:  {},
        // Sprint 5A — global breakdown sumado de todas las escuelas
        sourceBreakdown:    {
            native: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
            legacy: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
        },
    };

    // Para promedios ponderados por sesión.
    const progressWeighted: Record<string, { sumProgress: number; sessions: number }> = {};
    const a11yWeighted = { sumProgress: 0, sumErrors: 0, sessions: 0 };

    let windowFrom = Number.POSITIVE_INFINITY;
    let windowTo   = Number.NEGATIVE_INFINITY;

    let immPlayCount  = 0;
    let immPauseCount = 0;
    let immAudioSess  = 0;

    for (const m of items) {
        if (!m) continue;
        out.totalEvents   = (out.totalEvents   ?? 0) + (m.totalEvents   ?? 0);
        out.totalSessions = (out.totalSessions ?? 0) + (m.totalSessions ?? 0);
        if (typeof m.windowFrom === 'number') windowFrom = Math.min(windowFrom, m.windowFrom);
        if (typeof m.windowTo   === 'number') windowTo   = Math.max(windowTo,   m.windowTo);

        // usageByMode: suma directa.
        for (const [mode, b] of Object.entries(m.usageByMode ?? {})) {
            const acc = (out.usageByMode![mode] ??= emptyUsage()) as Required<UsageBucket>;
            acc.sessionStarts  += b?.sessionStarts  ?? 0;
            acc.sessionEnds    += b?.sessionEnds    ?? 0;
            acc.heartbeats     += b?.heartbeats     ?? 0;
            acc.activeUsers    += b?.activeUsers    ?? 0;
            acc.activeContents += b?.activeContents ?? 0;
            acc.nativeSessions += b?.nativeSessions ?? 0;
            acc.legacySessions += b?.legacySessions ?? 0;
            acc.totalSessions  += b?.totalSessions  ?? 0;
        }

        // readingTimeByMode: suma; promedios se recalculan al final.
        for (const [mode, b] of Object.entries(m.readingTimeByMode ?? {})) {
            const acc = (out.readingTimeByMode![mode] ??= emptyTime()) as Required<TimeBucket>;
            acc.totalElapsedMs       += b?.totalElapsedMs       ?? 0;
            acc.completedSessions    += b?.completedSessions    ?? 0;
            acc.openSessionsEstimate += b?.openSessionsEstimate ?? 0;
            acc.estimatedFromHeartbeat = acc.estimatedFromHeartbeat || (b?.estimatedFromHeartbeat ?? false);
            acc.nativeElapsedMs      += b?.nativeElapsedMs      ?? 0;
            acc.legacyElapsedMs      += b?.legacyElapsedMs      ?? 0;
        }

        // progressByMode: max y completedCount sumados; promedio ponderado.
        for (const [mode, b] of Object.entries(m.progressByMode ?? {})) {
            const acc = (out.progressByMode![mode] ??= emptyProg()) as Required<ProgBucket>;
            acc.maxProgressFraction = Math.max(acc.maxProgressFraction, b?.maxProgressFraction ?? 0);
            acc.completedCount     += b?.completedCount ?? 0;
            const sessions = m.usageByMode?.[mode]?.sessionStarts ?? 0;
            if (sessions > 0 && typeof b?.averageProgressFraction === 'number') {
                if (!progressWeighted[mode]) progressWeighted[mode] = { sumProgress: 0, sessions: 0 };
                progressWeighted[mode].sumProgress += b.averageProgressFraction * sessions;
                progressWeighted[mode].sessions    += sessions;
            }
        }

        // errorsByMode: suma + merge de errorTypes.
        for (const [mode, b] of Object.entries(m.errorsByMode ?? {})) {
            const acc = (out.errorsByMode![mode] ??= emptyError()) as Required<ErrorBucket>;
            acc.errorCount    += b?.errorCount    ?? 0;
            acc.affectedUsers += b?.affectedUsers ?? 0;
            for (const [t, c] of Object.entries(b?.errorTypes ?? {})) {
                acc.errorTypes[t] = (acc.errorTypes[t] ?? 0) + c;
            }
        }

        // immersiveAudio: suma counters.
        immPlayCount  += m.immersiveAudio?.audioPlayCount  ?? 0;
        immPauseCount += m.immersiveAudio?.audioPauseCount ?? 0;
        immAudioSess  += m.immersiveAudio?.audioSessions   ?? 0;

        // a11yAdoption: ponderado por sesiones a11y.
        const a11ySess = m.a11yAdoption?.sessions ?? 0;
        if (a11ySess > 0) {
            a11yWeighted.sessions    += a11ySess;
            a11yWeighted.sumProgress += (m.a11yAdoption?.avgProgress ?? 0) * a11ySess;
            a11yWeighted.sumErrors   += (m.a11yAdoption?.errorRate   ?? 0) * a11ySess;
        }
        out.a11yAdoption!.users = (out.a11yAdoption!.users ?? 0) + (m.a11yAdoption?.users ?? 0);

        // heartbeatCoverage: sumar conteos; coveragePercent recalcular al final.
        for (const [mode, b] of Object.entries(m.heartbeatCoverage ?? {})) {
            const acc = (out.heartbeatCoverage![mode] ??= emptyHb()) as Required<HbBucket>;
            acc.sessionsWithHeartbeat    += b?.sessionsWithHeartbeat    ?? 0;
            acc.sessionsWithoutHeartbeat += b?.sessionsWithoutHeartbeat ?? 0;
        }

        // Sprint 5A — sourceBreakdown global se suma escuela a escuela.
        const sb = m.sourceBreakdown;
        if (sb) {
            const accN = out.sourceBreakdown!.native!;
            const accL = out.sourceBreakdown!.legacy!;
            accN.totalEvents    = (accN.totalEvents    ?? 0) + (sb.native?.totalEvents    ?? 0);
            accN.totalSessions  = (accN.totalSessions  ?? 0) + (sb.native?.totalSessions  ?? 0);
            accN.totalElapsedMs = (accN.totalElapsedMs ?? 0) + (sb.native?.totalElapsedMs ?? 0);
            accL.totalEvents    = (accL.totalEvents    ?? 0) + (sb.legacy?.totalEvents    ?? 0);
            accL.totalSessions  = (accL.totalSessions  ?? 0) + (sb.legacy?.totalSessions  ?? 0);
            accL.totalElapsedMs = (accL.totalElapsedMs ?? 0) + (sb.legacy?.totalElapsedMs ?? 0);
        }
    }

    // ── Recalcular promedios y campos derivados ──────────────────────────────

    // readingTimeByMode.averageSessionMs (medianSessionMs queda en 0 al fusionar — se pierde).
    for (const [mode, b] of Object.entries(out.readingTimeByMode ?? {})) {
        const time = b as Required<TimeBucket>;
        const sessions = time.completedSessions + time.openSessionsEstimate;
        time.averageSessionMs = sessions > 0 ? Math.round(time.totalElapsedMs / sessions) : 0;
        // medianSessionMs no es agregable sin conservar todas las durations.
        time.medianSessionMs  = 0;
    }

    // progressByMode.averageProgressFraction ponderado.
    for (const [mode, b] of Object.entries(out.progressByMode ?? {})) {
        const w = progressWeighted[mode];
        const prog = b as Required<ProgBucket>;
        prog.averageProgressFraction = w && w.sessions > 0 ? w.sumProgress / w.sessions : 0;
    }

    // immersiveAudio.averagePlayPauseRatio.
    const totalActions = immPlayCount + immPauseCount;
    out.immersiveAudio = {
        audioPlayCount:        immPlayCount,
        audioPauseCount:       immPauseCount,
        audioSessions:         immAudioSess,
        averagePlayPauseRatio: totalActions > 0 ? immPlayCount / totalActions : 0,
    };

    // a11yAdoption recalculado.
    out.a11yAdoption!.sessions    = a11yWeighted.sessions;
    out.a11yAdoption!.avgProgress = a11yWeighted.sessions > 0 ? a11yWeighted.sumProgress / a11yWeighted.sessions : 0;
    out.a11yAdoption!.errorRate   = a11yWeighted.sessions > 0 ? a11yWeighted.sumErrors   / a11yWeighted.sessions : 0;

    // heartbeatCoverage.coveragePercent.
    for (const [, b] of Object.entries(out.heartbeatCoverage ?? {})) {
        const hb = b as Required<HbBucket>;
        const total = hb.sessionsWithHeartbeat + hb.sessionsWithoutHeartbeat;
        hb.coveragePercent = total > 0 ? Math.round((hb.sessionsWithHeartbeat / total) * 1000) / 10 : 0;
    }

    out.windowFrom = Number.isFinite(windowFrom) ? windowFrom : null;
    out.windowTo   = Number.isFinite(windowTo)   ? windowTo   : null;

    return out;
}
