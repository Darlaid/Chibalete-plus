/**
 * featureExtractor.mjs — PASO 4 §8.
 *
 * Produce feature_vectors versionados PARA IA FUTURA, sin entrenar IA hoy.
 * Cada vector lleva:
 *   - user_id, period, vector_version
 *   - period_start, period_end (ventana exacta)
 *   - features_json (TODOS los features juntos, serializados)
 *   - computed_at, source_watermark
 *
 * Versionado: si cambian las features, FEATURE_VECTOR_VERSION sube → v_old
 * persiste para back-compat (IA puede entrenar y comparar).
 *
 * Fuente:
 *   - user_reading_profiles (PASO 2)  — features actuales
 *   - signal_snapshots (PASO 2)       — confidences + meta
 *   - weekly_rollups (PASO 4)         — progression_slope (pendiente)
 *
 * GATING:
 *   FEATURE_EXTRACTION_ENABLED=1  → runOnce activo (default OFF).
 */
import { getInsightsExtDb, getStatements as getInsightsStmts } from '../db/insightsDbExt.mjs';
import { getRollupsExtDb, getRollupsStatements } from '../db/rollupsDbExt.mjs';
import { featureVectorsComputed } from '../observability/metrics.js';

export const FEATURE_VECTOR_VERSION = 1;
const PERIOD_KEY = '28d';
const DAY_MS = 86_400_000;

export const ENABLED = () => process.env.FEATURE_EXTRACTION_ENABLED === '1';

/**
 * Calcula pendiente lineal (slope) sobre los últimos N puntos numéricos.
 * Simple least-squares. Devuelve null si N<2 o ningún punto válido.
 */
function linearSlope(values) {
    const xs = [], ys = [];
    for (let i = 0; i < values.length; i++) {
        if (typeof values[i] === 'number' && isFinite(values[i])) {
            xs.push(i); ys.push(values[i]);
        }
    }
    const n = xs.length;
    if (n < 2) return null;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    return +((n * sumXY - sumX * sumY) / denom).toFixed(4);
}

/**
 * Lee snapshot por signal_id, devuelve metric_value o null.
 */
function snapVal(snapshots, signal_id) {
    const r = snapshots.find(s => s.signal_id === signal_id);
    return r && typeof r.metric_value === 'number' ? r.metric_value : null;
}
function snapConf(snapshots, signal_id) {
    const r = snapshots.find(s => s.signal_id === signal_id);
    return r ? r.confidence : null;
}

/**
 * Computa feature vector para un user.
 * @param {object} profile  fila user_reading_profiles
 * @param {Array<object>} snapshots  filas signal_snapshots (period=28d)
 * @param {Array<object>} weekly  últimos N weekly_rollups del scope global
 *                                 (para progression_slope)
 * @param {number} nowTs
 * @returns {{features:object, period_start:number, period_end:number}}
 */
export function buildFeatureVector({ profile, snapshots, weekly, nowTs }) {
    const periodEnd = nowTs;
    const periodStart = nowTs - 28 * DAY_MS;

    // Pendiente de continuidad sobre las últimas 4 weeks (si hay).
    const continuidadSeries = (weekly || [])
        .filter(r => r.metric_key === 'active_users')   // proxy global; en PASO 5 puede ser por user
        .slice(-4)
        .map(r => r.metric_value);
    const progressionSlope = linearSlope(continuidadSeries);

    const features = {
        continuidad:          snapVal(snapshots, 'continuidad_semanal'),
        persistencia:         profile?.persistencia_score ?? snapVal(snapshots, 'persistencia'),
        abandono:             snapVal(snapshots, 'abandono_temprano'),
        engagement:           profile?.engagement_score ?? null,
        concentracion:        profile?.concentracion_score ?? snapVal(snapshots, 'concentracion'),
        diversidad:           profile?.diversidad_score ?? snapVal(snapshots, 'diversidad_lectora'),
        autonomia:            profile?.autonomia_score ?? snapVal(snapshots, 'lectura_autonoma'),
        recuperacion:         snapVal(snapshots, 'recuperacion_tras_abandono'),
        audio_usage:          snapVal(snapshots, 'uso_audio'),
        accessibility_usage:  snapVal(snapshots, 'uso_accesibilidad'),
        relectura:            snapVal(snapshots, 'relectura'),
        progression_slope:    progressionSlope,

        // metadata reproducibilidad
        confidences: {
            continuidad:   snapConf(snapshots, 'continuidad_semanal'),
            persistencia:  snapConf(snapshots, 'persistencia'),
            abandono:      snapConf(snapshots, 'abandono_temprano'),
            diversidad:    snapConf(snapshots, 'diversidad_lectora'),
            tiempo:        snapConf(snapshots, 'tiempo_efectivo_lectura'),
        },
        last_active_at: profile?.last_active_at ?? null,
        abandono_risk:  profile?.abandono_risk ?? null,
    };
    return { features, period_start: periodStart, period_end: periodEnd };
}

/**
 * Persiste feature_vectors para todos los profiles (o un subset por scopes).
 * Idempotente: UPSERT por (user_id, period, vector_version, period_end).
 */
export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const result = {
        ok: false, processed: 0, upserted: 0, skipped: 0,
        vector_version: FEATURE_VECTOR_VERSION, durationMs: 0,
    };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getInsightsExtDb();
        getRollupsExtDb();
        const insightsDb = getInsightsExtDb();
        const rollupsDb = getRollupsExtDb();
        const profilesQ = opts.scopes?.userIds
            ? insightsDb.prepare(
                `SELECT * FROM user_reading_profiles WHERE user_id IN (${
                  opts.scopes.userIds.map(() => '?').join(',')})`
              ).all(...opts.scopes.userIds.map(String))
            : insightsDb.prepare(`SELECT * FROM user_reading_profiles LIMIT 10000`).all();

        // Para weekly: leer última ventana global (cohort proxy).
        const weeklyAll = getRollupsStatements().listWeeklyScope.all(
            'all', 'global', nowTs - 90 * DAY_MS
        );

        const tx = rollupsDb.transaction(() => {
            for (const profile of profilesQ) {
                if (!profile?.user_id) { result.skipped++; continue; }
                const snapshots = insightsDb.prepare(
                    `SELECT * FROM signal_snapshots
                     WHERE scope_type='user' AND scope_id=? AND period=?`
                ).all(String(profile.user_id), PERIOD_KEY);
                const fv = buildFeatureVector({ profile, snapshots, weekly: weeklyAll, nowTs });
                getRollupsStatements().upsertFeatureVector.run({
                    user_id: String(profile.user_id),
                    period: PERIOD_KEY,
                    vector_version: FEATURE_VECTOR_VERSION,
                    period_start: fv.period_start,
                    period_end: fv.period_end,
                    features_json: JSON.stringify(fv.features),
                    computed_at: nowTs,
                    source_watermark: profile.source_watermark ?? 0,
                });
                result.upserted++;
                result.processed++;
            }
        });
        tx();
        try { featureVectorsComputed.inc(result.upserted); } catch {}
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[featureExtractor] error: ${result.error}`);
    }
    result.durationMs = Date.now() - t0;
    return result;
}

export function getLatestFeatureVector(userId) {
    try {
        getRollupsExtDb();
        const row = getRollupsStatements().latestFeatureVector
            .get(String(userId), FEATURE_VECTOR_VERSION);
        if (!row) return null;
        return {
            ...row,
            features: JSON.parse(row.features_json),
        };
    } catch { return null; }
}

export function getStatus() {
    try {
        getRollupsExtDb();
        const n = getRollupsStatements().countFeatureVectors.get().n;
        return {
            engine: 'aula_viva_features_v1',
            enabled: ENABLED(),
            vector_version: FEATURE_VECTOR_VERSION,
            total_vectors: n,
            ok: true,
        };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
