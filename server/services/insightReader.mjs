/**
 * insightReader.mjs — read API LIMPIA para Aula Viva (Phase-1 dual-read).
 *
 * Aula Viva PUEDE consumir esto (en endpoints existentes, agregando un
 * fallback al cálculo ad-hoc si insights está degraded). NO se reemplaza
 * ningún endpoint actual en este paso — el read cutover formal es Phase-3.
 *
 * Diseño: cada función nunca lanza; devuelve `null` o `{degraded:true}`
 * para que el caller decida fallback. Latencia objetivo <50ms (prepared
 * statements + índices PRIMARY KEY / UNIQUE).
 */
import { getInsightsExtDb, getStatements } from '../db/insightsDbExt.mjs';
import { getPedagogyExtDb, getPedagogyStatements } from '../db/pedagogyDbExt.mjs';
import { getRollupsExtDb, getRollupsStatements } from '../db/rollupsDbExt.mjs';
import * as featureExtractor from './featureExtractor.mjs';

function safe(fn, fallback = null) { try { return fn(); } catch { return fallback; } }

export function getUserProfile(userId) {
    return safe(() => {
        getInsightsExtDb();
        const row = getStatements().getProfile.get(String(userId));
        return row || null;
    });
}

export function getCohortRollup(scope_type, scope_id) {
    return safe(() => {
        getInsightsExtDb();
        const rows = getStatements().listCohort.all(String(scope_type), String(scope_id));
        return rows; // array (puede ser vacío si aún no se materializó)
    }, []);
}

export function getScopeSignals(scope_type, scope_id) {
    return safe(() => {
        getInsightsExtDb();
        const rows = getStatements().listScopeSignals.all(String(scope_type), String(scope_id));
        return rows;
    }, []);
}

/**
 * Health-suficiente: devuelve `{ready:false}` si el materializer nunca corrió
 * o está degraded → el caller usa cálculo ad-hoc (Phase-1 fallback).
 */
export function isReady() {
    return safe(() => {
        const s = getStatements().getMatState.get('aula_viva_pedagogical_v1');
        if (!s) return { ready: false, reason: 'never_materialized' };
        if (s.degraded) return { ready: false, reason: 'degraded', last_error: s.last_error };
        const ageMs = Date.now() - (s.updated_at || 0);
        if (ageMs > 24 * 3600_000) return { ready: false, reason: 'stale', age_hours: Math.floor(ageMs / 3600_000) };
        return { ready: true, last_run_age_ms: ageMs, last_event_id: s.last_event_id };
    }, { ready: false, reason: 'error' });
}

// ── PASO 3 — read API para Aula Viva (recommendations + risk + cohort comp) ──

/**
 * Lista recomendaciones activas (no acknowledged) para un scope ordenadas por
 * severidad DESC y created_at DESC. JSON.parse de explanation hecho aquí
 * (el caller recibe ya estructurado).
 */
export function getRecommendations(scope_type, scope_id, { includeAcknowledged = false, limit = 50 } = {}) {
    return safe(() => {
        getPedagogyExtDb();
        const stmts = getPedagogyStatements();
        const rows = includeAcknowledged
            ? stmts.listAllForScope.all(String(scope_type), String(scope_id), limit)
            : stmts.listActiveForScope.all(String(scope_type), String(scope_id));
        return rows.map(r => ({
            ...r,
            explanation: safe(() => JSON.parse(r.explanation_json), null),
            rule_ids: safe(() => JSON.parse(r.rule_ids_json), [r.rule_id]),
        }));
    }, []);
}

/**
 * Historial longitudinal de riesgos detectados para un user (activos + resueltos).
 * Permite reconstruir el timeline ¿cuándo apareció, cuándo se resolvió, qué señales?
 */
export function getRiskHistory(userId, { limit = 50 } = {}) {
    return safe(() => {
        getPedagogyExtDb();
        const rows = getPedagogyStatements().listRiskByUser.all(String(userId), limit);
        return rows.map(r => ({
            ...r,
            source_signals: safe(() => JSON.parse(r.source_signals_json), {}),
            active: r.resolved_at == null,
        }));
    }, []);
}

/**
 * Timeline longitudinal del perfil — combina profile actual + snapshots
 * agrupados por signal_id (cada signal_id devuelve su serie temporal de
 * `updated_at`s registrados). Como PASO 2 sobreescribe snapshots por UNIQUE,
 * la "serie" hoy es UN punto por signal; PASO 4 puede materializar history
 * append-only. La API es la misma desde el caller.
 */
export function getProfileTimeline(userId) {
    return safe(() => {
        getInsightsExtDb();
        const profile = getStatements().getProfile.get(String(userId));
        const snapshots = getStatements().listScopeSignals.all('user', String(userId));
        // Riesgos del user (longitudinal real — append-only).
        const risks = getRiskHistory(userId, { limit: 100 });
        // Recomendaciones (history completo).
        const recs = getRecommendations('user', userId, { includeAcknowledged: true, limit: 100 });
        return {
            user_id: String(userId),
            profile_current: profile || null,
            signals_current: snapshots.map(s => ({
                signal_id: s.signal_id, metric_value: s.metric_value,
                confidence: s.confidence, updated_at: s.updated_at,
                meta: safe(() => s.metadata_json ? JSON.parse(s.metadata_json) : null, null),
            })),
            risks,
            recommendations: recs,
        };
    }, null);
}

/**
 * Comparativa de cohortes — devuelve métricas clave de un scope + delta vs
 * promedio global. Permite a la UI mostrar "grupo X vs cohort institucional".
 */
export function getCohortComparison(scope_type, scope_id, { period = '28d' } = {}) {
    return safe(() => {
        getInsightsExtDb();
        const scopeRollups = getStatements().listCohort.all(String(scope_type), String(scope_id));
        const globalRollups = getStatements().listCohort.all('all', 'global');
        const globalByKey = new Map(globalRollups.map(r => [r.metric_key, r.metric_value]));
        return {
            scope: { type: scope_type, id: scope_id }, period,
            metrics: scopeRollups
                .filter(r => r.period === period)
                .map(r => ({
                    metric_key: r.metric_key,
                    metric_value: r.metric_value,
                    trend: r.trend,
                    global_value: globalByKey.get(r.metric_key) ?? null,
                    delta_vs_global:
                        (typeof r.metric_value === 'number' && typeof globalByKey.get(r.metric_key) === 'number')
                            ? +(r.metric_value - globalByKey.get(r.metric_key)).toFixed(3)
                            : null,
                })),
            global_baseline: globalRollups
                .filter(r => r.period === period)
                .map(r => ({ metric_key: r.metric_key, metric_value: r.metric_value })),
        };
    }, { scope: { type: scope_type, id: scope_id }, period, metrics: [], global_baseline: [] });
}

// ── PASO 4 — read APIs: rollups, snapshot history, feature vectors, jobs ───

/**
 * Daily/weekly/monthly rollups para un scope desde sinceTs.
 * Devuelve arrays vacíos en error (never-throws).
 */
export function getDailyRollups(scope_type, scope_id, sinceTs = Date.now() - 90 * 86_400_000) {
    return safe(() => {
        getRollupsExtDb();
        return getRollupsStatements().listDailyScope.all(String(scope_type), String(scope_id), sinceTs);
    }, []);
}
export function getWeeklyRollups(scope_type, scope_id, sinceTs = Date.now() - 365 * 86_400_000) {
    return safe(() => {
        getRollupsExtDb();
        return getRollupsStatements().listWeeklyScope.all(String(scope_type), String(scope_id), sinceTs);
    }, []);
}
export function getMonthlyRollups(scope_type, scope_id, sinceTs = Date.now() - 730 * 86_400_000) {
    return safe(() => {
        getRollupsExtDb();
        return getRollupsStatements().listMonthlyScope.all(String(scope_type), String(scope_id), sinceTs);
    }, []);
}

/**
 * Timeline real de un signal (append-only). Si SNAPSHOT_HISTORY_ENABLED nunca
 * estuvo ON, retorna []; el caller puede fallback al snapshot actual.
 */
export function getSignalTimeline(scope_type, scope_id, signal_id, sinceTs = Date.now() - 90 * 86_400_000) {
    return safe(() => {
        getRollupsExtDb();
        return getRollupsStatements().timelineSignal.all(
            String(scope_type), String(scope_id), String(signal_id), sinceTs);
    }, []);
}

/** Feature vector más reciente para un user (IA futura). */
export function getLatestFeatureVector(userId) {
    return safe(() => featureExtractor.getLatestFeatureVector(userId), null);
}

/** Job ledger: últimos N runs. */
export function getJobLedger({ limit = 50 } = {}) {
    return safe(() => {
        getRollupsExtDb();
        return getRollupsStatements().listRecentRuns.all(limit);
    }, []);
}

/** Conteo agregado de recomendaciones activas por severidad — alimenta dashboards. */
export function getActiveRecommendationsSummary() {
    return safe(() => {
        getPedagogyExtDb();
        const rows = getPedagogyStatements().countActiveBySeverity.all();
        const summary = { critical: 0, high: 0, moderate: 0, info: 0 };
        for (const r of rows) summary[r.severity] = r.n;
        return summary;
    }, { critical: 0, high: 0, moderate: 0, info: 0 });
}
