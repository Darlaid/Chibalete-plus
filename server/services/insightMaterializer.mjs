/**
 * insightMaterializer.mjs — PASO 2: cerebro pedagógico operacional.
 *
 * Modelo: events.db (canon) → proyección incremental con WATERMARK →
 * insights.db (read model). Idempotente, replayable, GATED, recovery-first.
 *
 * GATING:
 *   INSIGHTS_MATERIALIZER_ENABLED=1 para activar runOnce(). Default OFF =
 *   cero impacto en prod. rebuildInsights() siempre disponible (manual).
 *
 * NUNCA bloquea producción: corre off-hours/cron/admin; los errores se
 * registran (last_error en materializer_state + métrica) pero NO se
 * propagan. Recovery-first: un evento corrupto se skipea con counter, no
 * tumba el batch.
 *
 * Tablas escritas: signal_snapshots, user_reading_profiles, cohort_rollups,
 * materializer_state (watermark). Notificaciones vía insightsStore (P1 API).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import * as eventsService from '../eventsService.js';
import { getInsightsExtDb, getStatements } from '../db/insightsDbExt.mjs';

// ── Lectura DIRECTA de events.db (bypassa el transformer camelCase que sirve
// a HTTP). El materializer necesita `id` para watermark + `payload_json`
// crudo para señales. WAL permite múltiples readers; un 2do handle es seguro.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_PATH = process.env.EVENTS_SQLITE_PATH
    || path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');
let _eventsRawDb = null, _stmtBatch = null, _stmtUserHistory = null;
function getRawEventsDb() {
    if (_eventsRawDb) return _eventsRawDb;
    _eventsRawDb = new Database(EVENTS_PATH, { readonly: true, fileMustExist: false });
    _eventsRawDb.pragma('busy_timeout = 5000');
    _stmtBatch = _eventsRawDb.prepare(
        `SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?`);
    _stmtUserHistory = _eventsRawDb.prepare(
        `SELECT * FROM events WHERE user_id = ? AND server_ts >= ? ORDER BY server_ts ASC LIMIT ?`);
    return _eventsRawDb;
}
export function closeMaterializerEventsDb() {
    if (_eventsRawDb) { try { _eventsRawDb.close(); } catch {} _eventsRawDb = null; }
    _stmtBatch = _stmtUserHistory = null;
}
import { computeUserSignals, computeUserProfile } from './signalCompute.mjs';
import { SIGNAL_IDS } from '../analytics/signals.js';
import * as insightsStore from '../insightsStore.js';
// PASO 4 §10 — snapshot_history append-only (gated, default OFF). Import
// estático (módulo es cero-coste hasta que getRollupsExtDb se invoca; la
// DB sólo se abre on-demand). Permite que runOnce siga siendo SÍNCRONO,
// preservando los contratos PASO 2 / PASO 3.
import * as rollupsExt from '../db/rollupsDbExt.mjs';
import { snapshotHistoryTotal } from '../observability/metrics.js';

const MATERIALIZER_NAME = 'aula_viva_pedagogical_v1';
const DEFAULT_BATCH = 5000;
const PERIOD_DAYS = 28;

function now() { return Date.now(); }

/** Lee watermark actual. Si no existe, devuelve 0 (procesa todo desde inicio). */
function getWatermark() {
    getInsightsExtDb();
    const row = getStatements().getMatState.get(MATERIALIZER_NAME);
    return row ? row.last_event_id : 0;
}

function setWatermark(newWatermark, info) {
    getStatements().upsertMatState.run({
        name: MATERIALIZER_NAME,
        last_event_id: newWatermark,
        last_ts: info.last_ts ?? 0,
        updated_at: now(),
        lag_events: info.lag_events ?? 0,
        lag_seconds: info.lag_seconds ?? 0,
        degraded: info.degraded ? 1 : 0,
        last_error: info.last_error ?? null,
    });
}

/**
 * Procesa eventos desde el watermark. Idempotente, no-bloqueante.
 * @param {{ batchLimit?:number, nowTs?:number, log?:(m:string)=>void }} [opts]
 * @returns {{ ok:boolean, processed:number, watermarkFrom:number, watermarkTo:number,
 *             durationMs:number, lagEvents:number, profilesUpserted:number,
 *             snapshotsUpserted:number, cohortsUpserted:number, notifications:number,
 *             skippedCorrupted:number, error?:string }}
 */
export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? now();
    const batchLimit = opts.batchLimit ?? DEFAULT_BATCH;
    const result = {
        ok: false, processed: 0, watermarkFrom: 0, watermarkTo: 0,
        durationMs: 0, lagEvents: 0,
        profilesUpserted: 0, snapshotsUpserted: 0, cohortsUpserted: 0,
        notifications: 0, skippedCorrupted: 0,
    };
    try {
        getInsightsExtDb();
        const stmts = getStatements();
        // Pre-init insightsStore FUERA de cualquier transacción del materializer.
        // Si se abriera dentro de la tx con DDL bajo contención WAL podría
        // dejar _stmt en null (race observable bajo carga concurrente).
        try { insightsStore.ensureDbOpen(); } catch (e) { log(`[materializer] insightsStore preinit warn: ${e.message}`); }
        const wm = getWatermark();
        result.watermarkFrom = wm;

        // Total disponible en events.db para calcular lag.
        let totalEvents = 0;
        try { totalEvents = eventsService.getEventCount(); } catch {}
        result.lagEvents = Math.max(0, totalEvents - wm);

        // Lectura RAW (necesita `id` + `payload_json` crudos).
        let batch = [];
        try { getRawEventsDb(); batch = _stmtBatch.all(wm, batchLimit); }
        catch (e) { batch = []; log(`[materializer] raw events read failed: ${e.message}`); }
        if (!batch || batch.length === 0) {
            setWatermark(wm, { last_ts: 0, lag_events: 0, lag_seconds: 0, degraded: false });
            result.watermarkTo = wm; result.ok = true; result.durationMs = Date.now() - t0;
            return result;
        }

        // Agrupar por user_id para profiles/signals; capturar last id procesado.
        const byUser = new Map();
        let maxId = wm;
        for (const ev of batch) {
            if (ev.id > maxId) maxId = ev.id;
            // Tolerancia a evento corrupto: si falta user_id O event → skip + count.
            if (!ev || !ev.user_id || !ev.event) { result.skippedCorrupted++; continue; }
            if (!byUser.has(ev.user_id)) byUser.set(ev.user_id, []);
            byUser.get(ev.user_id).push(ev);
        }

        const periodKey = `${PERIOD_DAYS}d`;
        // Notificaciones se ACUMULAN durante la tx y se EMITEN POST-COMMIT.
        // SQLite WAL: 1 solo writer concurrente por archivo; abrir un 2do
        // handle (insightsStore) DENTRO de nuestra tx → SQLITE_BUSY silente.
        const pendingNotifs = [];
        const pendingSnapHistory = [];  // PASO 4 §10 — append-only opcional
        // Para cada user: traer historial ampliado (window completo) para señales
        // longitudinales correctas — NO solo el batch incremental (que puede ser
        // una sola fila). Hacemos UNA query por user a events.db (cheap por
        // índice idx_user_content).
        const tx = getInsightsExtDb().transaction(() => {
            for (const [userId, _evsInBatch] of byUser) {
                let history = [];
                try {
                    const sinceTs = nowTs - PERIOD_DAYS * 86400_000;
                    // RAW: necesita payload_json + server_ts + id sin transform.
                    getRawEventsDb();
                    history = _stmtUserHistory.all(String(userId), sinceTs, 20_000);
                } catch { history = _evsInBatch; }
                const sig = computeUserSignals(history, { nowTs, windowDays: PERIOD_DAYS });
                // Persistir signal_snapshots (user scope)
                for (const sid of SIGNAL_IDS) {
                    const s = sig[sid];
                    if (!s) continue;
                    stmts.upsertSignalSnap.run({
                        scope_type: 'user', scope_id: String(userId),
                        signal_id: sid, period: periodKey,
                        metric_value: typeof s.value === 'number' ? s.value : null,
                        confidence: s.confidence || 'pending',
                        trend: null,
                        source_watermark: maxId,
                        metadata_json: s.meta ? JSON.stringify(s.meta) : null,
                        updated_at: nowTs,
                    });
                    result.snapshotsUpserted++;
                    // PASO 4 §10: append-only opcional para timelines reales.
                    // Schedule a POST-COMMIT (mismo patrón risk: evita cross-handle
                    // write-lock dentro de la tx insights).
                    if (process.env.SNAPSHOT_HISTORY_ENABLED === '1') {
                        pendingSnapHistory.push({
                            recorded_at: nowTs,
                            scope_type: 'user', scope_id: String(userId),
                            signal_id: sid, period: periodKey,
                            metric_value: typeof s.value === 'number' ? s.value : null,
                            confidence: s.confidence || 'pending',
                            metadata_json: s.meta ? JSON.stringify(s.meta) : null,
                            source_watermark: maxId,
                        });
                    }
                }
                // Profile sintético + risk
                const profile = computeUserProfile(sig, { nowTs });
                const lastActive = Math.max(...history.map(e => e.server_ts || 0), 0);
                stmts.upsertProfile.run({
                    user_id: String(userId),
                    fluidez_score: profile.fluidez_score,
                    persistencia_score: profile.persistencia_score,
                    autonomia_score: profile.autonomia_score,
                    concentracion_score: profile.concentracion_score,
                    diversidad_score: profile.diversidad_score,
                    engagement_score: profile.engagement_score,
                    abandono_risk: profile.abandono_risk,
                    last_active_at: lastActive || null,
                    updated_at: nowTs, source_watermark: maxId,
                });
                result.profilesUpserted++;

                // Risk engine determinístico → ACUMULAR notificaciones (flush
                // post-commit). NO insertar acá: la tx mantiene el write-lock
                // del archivo y el segundo handle (insightsStore) recibiría
                // SQLITE_BUSY silente bajo carga.
                if (typeof profile.abandono_risk === 'number' && profile.abandono_risk >= 0.7) {
                    const insightKey = `risk:abandono:${userId}`;
                    pendingNotifs.push({
                        insightKey,
                        record: {
                            notificationId: `n_${insightKey}_${nowTs}`,
                            insightKey,
                            scopeLevel: 'user', scopeId: String(userId),
                            severity: 'warning', channel: 'dashboard', status: 'pending',
                            createdAt: nowTs, sentAt: null,
                            payloadJson: JSON.stringify({ type: 'risk_abandono',
                                score: profile.abandono_risk, window_days: PERIOD_DAYS }),
                        },
                    });
                }
            }

            // Cohort rollup global mínimo (group/school joins quedan para PASO 3).
            const profilesCount = stmts.countByTable.profiles.get().n;
            stmts.upsertCohort.run({
                scope_type: 'all', scope_id: 'global', period: periodKey,
                metric_key: 'active_users', metric_value: profilesCount,
                trend: null, updated_at: nowTs, source_watermark: maxId,
            });
            result.cohortsUpserted++;

            // Watermark final dentro de la misma transacción.
            const lastTs = batch[batch.length - 1]?.server_ts || 0;
            setWatermark(maxId, {
                last_ts: lastTs,
                lag_events: Math.max(0, totalEvents - maxId),
                lag_seconds: lastTs ? Math.max(0, Math.floor((nowTs - lastTs) / 1000)) : 0,
                degraded: false,
            });
            result.watermarkTo = maxId;
            result.processed = batch.length;
        });
        tx();
        // FLUSH notificaciones POST-COMMIT (handle separado de insightsStore,
        // sin contención con la tx ya cerrada). Cada inserción es try/catch
        // independiente: una falla NO afecta a las demás ni al batch.
        for (const { insightKey, record } of pendingNotifs) {
            try {
                if (!insightsStore.hasPendingNotification(insightKey, 'risk_abandono')) {
                    insightsStore.insertNotification(record);
                    result.notifications++;
                }
            } catch (e) { log(`[materializer] notification flush failed for ${insightKey}: ${e.message}`); }
        }
        // PASO 4 §10 — flush snapshot_history POST-COMMIT, en una sola tx
        // batched sobre rollupsDbExt (handle distinto al insightsDbExt). NO
        // viola WAL: la tx anterior ya cerró. Sync end-to-end → runOnce
        // sigue retornando sin Promise.
        if (pendingSnapHistory.length > 0) {
            try {
                const db = rollupsExt.getRollupsExtDb();
                const stmts = rollupsExt.getRollupsStatements();
                const histTx = db.transaction((rows) => {
                    for (const r of rows) stmts.insertSnapHistory.run(r);
                });
                histTx(pendingSnapHistory);
                try { snapshotHistoryTotal.inc(pendingSnapHistory.length); } catch {}
                result.snapshotHistoryAppended = pendingSnapHistory.length;
            } catch (e) {
                log(`[materializer] snapshot_history flush failed: ${e.message}`);
                // No es fatal: snapshot_history es una mejora opcional.
            }
        }
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[materializer] runOnce error: ${result.error}`);
        try { setWatermark(getWatermark(), { degraded: true, last_error: result.error }); } catch {}
    }
    result.durationMs = Date.now() - t0;
    return result;
}

/** Fallback si eventsService no tiene getEventsSinceId: filtrar por id usando una raw query. */
function getEventsSinceIdFallback(sinceId, limit) {
    try {
        // Usar getEventsSince con limit alto y filtrar por id > sinceId (lento si
        // hay muchos eventos viejos, pero correcto). En producción se sugiere
        // agregar getEventsSinceId a eventsService.
        const all = eventsService.getEventsSince({ sinceTs: 0, limit: Math.max(limit, 50_000) }) || [];
        return all.filter(e => e.id > sinceId).slice(0, limit);
    } catch { return []; }
}

/**
 * Replay parcial: recomputa proyecciones en una ventana sin mover el watermark.
 * @param {{ fromTs:number, toTs?:number, dryRun?:boolean, scopes?:{userIds?:string[]} }} opts
 */
export function rebuildInsights(opts) {
    const fromTs = opts.fromTs ?? 0;
    const toTs   = opts.toTs   ?? now();
    const dryRun = !!opts.dryRun;
    const userIds = opts.scopes?.userIds;
    const out = { ok: false, scanned: 0, wouldUpsert: 0, upserted: 0, durationMs: 0 };
    const t0 = Date.now();
    try {
        getInsightsExtDb();
        const stmts = getStatements();
        // RAW para replay: necesitamos id + payload_json + snake_case naturales.
        getRawEventsDb();
        const all = _eventsRawDb.prepare(
            `SELECT * FROM events WHERE server_ts >= ? AND server_ts <= ? ORDER BY id ASC LIMIT 100000`
        ).all(fromTs, toTs);
        const inRange = userIds
            ? all.filter(e => userIds.includes(e.user_id))
            : all;
        out.scanned = inRange.length;
        const byUser = new Map();
        for (const e of inRange) {
            if (!e.user_id) continue;
            if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
            byUser.get(e.user_id).push(e);
        }
        if (dryRun) {
            out.wouldUpsert = byUser.size * SIGNAL_IDS.length + byUser.size; // signals + profile
            out.ok = true; out.durationMs = Date.now() - t0;
            return out;
        }
        const tx = getInsightsExtDb().transaction(() => {
            for (const [userId, evs] of byUser) {
                const sig = computeUserSignals(evs, { nowTs: toTs, windowDays: PERIOD_DAYS });
                const profile = computeUserProfile(sig, { nowTs: toTs });
                for (const sid of SIGNAL_IDS) {
                    const s = sig[sid]; if (!s) continue;
                    stmts.upsertSignalSnap.run({
                        scope_type: 'user', scope_id: String(userId),
                        signal_id: sid, period: `${PERIOD_DAYS}d`,
                        metric_value: typeof s.value === 'number' ? s.value : null,
                        confidence: s.confidence || 'pending', trend: null,
                        source_watermark: 0,
                        metadata_json: JSON.stringify({ source: 'replay', ...(s.meta || {}) }),
                        updated_at: toTs,
                    });
                    out.upserted++;
                }
                stmts.upsertProfile.run({
                    user_id: String(userId),
                    fluidez_score: profile.fluidez_score,
                    persistencia_score: profile.persistencia_score,
                    autonomia_score: profile.autonomia_score,
                    concentracion_score: profile.concentracion_score,
                    diversidad_score: profile.diversidad_score,
                    engagement_score: profile.engagement_score,
                    abandono_risk: profile.abandono_risk,
                    last_active_at: Math.max(...evs.map(e => e.server_ts || 0), 0) || null,
                    updated_at: toTs, source_watermark: 0,
                });
                out.upserted++;
            }
        });
        tx();
        out.ok = true;
    } catch (e) {
        out.error = String(e?.message || e);
    }
    out.durationMs = Date.now() - t0;
    return out;
}

/** Status para /api/health/analytics. */
export function getStatus() {
    try {
        getInsightsExtDb();
        const s = getStatements();
        const wm = s.getMatState.get(MATERIALIZER_NAME);
        let total = 0; try { total = eventsService.getEventCount(); } catch {}
        return {
            materializer: MATERIALIZER_NAME,
            enabled: process.env.INSIGHTS_MATERIALIZER_ENABLED === '1',
            last_event_id: wm?.last_event_id ?? 0,
            last_ts: wm?.last_ts ?? 0,
            updated_at: wm?.updated_at ?? 0,
            lag_events: Math.max(0, total - (wm?.last_event_id ?? 0)),
            lag_seconds: wm?.last_ts ? Math.max(0, Math.floor((Date.now() - wm.last_ts) / 1000)) : null,
            degraded: !!wm?.degraded,
            last_error: wm?.last_error ?? null,
            tables: {
                signal_snapshots:    s.countByTable.snaps.get().n,
                user_reading_profiles: s.countByTable.profiles.get().n,
                cohort_rollups:      s.countByTable.cohorts.get().n,
            },
            ok: !wm?.degraded,
        };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}
