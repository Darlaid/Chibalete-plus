/**
 * rollupsEngine.mjs — PASO 4: agregaciones temporales.
 *
 * Computa daily/weekly/monthly_rollups DESDE events.db (fuente de verdad)
 * por scope ('all','global' por defecto; user/group/school como extensión
 * PASO 5). Idempotente (UPSERT por PRIMARY KEY composite). Cancelable +
 * resumible via job ledger (materializer_runs).
 *
 * GATING:
 *   ROLLUPS_ENABLED=1  → runOnce activo (default OFF).
 *
 * Patrón 4-fase (lección PASO 3 §8b):
 *   1. compute puro (lee events.db read-only, sin tx)
 *   2. tx rollups (escribe daily/weekly/monthly)
 *   3. (sin POST-COMMIT cross-handle aquí porque rollups y job ledger viven
 *      en el mismo archivo y mismo handle rollupsDbExt)
 *   4. update job ledger status='completed'
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getRollupsExtDb, getRollupsStatements } from '../db/rollupsDbExt.mjs';
import { rollupUpdates } from '../observability/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_PATH = process.env.EVENTS_SQLITE_PATH
    || path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');

const DAY_MS  = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

let _eventsRaw = null;
function getEventsRaw() {
    if (_eventsRaw) return _eventsRaw;
    _eventsRaw = new Database(EVENTS_PATH, { readonly: true, fileMustExist: false });
    _eventsRaw.pragma('busy_timeout = 5000');
    return _eventsRaw;
}
export function closeRollupsEventsRaw() {
    if (_eventsRaw) { try { _eventsRaw.close(); } catch {} _eventsRaw = null; }
}

export const ENABLED = () => process.env.ROLLUPS_ENABLED === '1';

// ── Bucket helpers (UTC) ────────────────────────────────────────────────────
function dayStart(ts) { return Math.floor(ts / DAY_MS) * DAY_MS; }
function weekStart(ts) {
    // ISO-week: lunes 00:00 UTC. JS getUTCDay(): dom=0, lun=1...sab=6.
    const d = new Date(ts);
    const dow = d.getUTCDay() || 7;  // dom→7
    const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow - 1));
    return monday;
}
function monthStart(ts) {
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// ── Cómputo por bucket ──────────────────────────────────────────────────────
/**
 * Agrupa eventos por bucket+metric_key. Devuelve un Map keyed por
 * "period_start|scope|metric" → {metric_value, sample_size}.
 *
 * Metrics computadas (cardinalidad fija):
 *  - sessions_started        count(reading_started OR session_started)
 *  - sessions_completed      count(reading_completed)
 *  - sessions_abandoned      count(reading_abandoned)
 *  - active_users            distinct(user_id)
 *  - reading_minutes         sum(elapsed_ms)/60000  (cuando elapsed_ms presente)
 */
function aggregateBuckets(events, bucketFn) {
    const rows = new Map();
    const usersByBucket = new Map();    // bucket → Set(user_id)
    const minutesByBucket = new Map();  // bucket → ms acumulados

    const inc = (bucket, metric, by = 1) => {
        const k = `${bucket}|all|global|${metric}`;
        const prev = rows.get(k) || { period_start: bucket, scope_type: 'all',
            scope_id: 'global', metric_key: metric,
            metric_value: 0, sample_size: 0 };
        prev.metric_value += by;
        prev.sample_size  += 1;
        rows.set(k, prev);
    };

    for (const e of events) {
        if (!e || !e.server_ts) continue;
        const b = bucketFn(e.server_ts);
        if (e.event === 'reading_started' || e.event === 'session_started') inc(b, 'sessions_started');
        else if (e.event === 'reading_completed') inc(b, 'sessions_completed');
        else if (e.event === 'reading_abandoned') inc(b, 'sessions_abandoned');

        if (e.user_id) {
            if (!usersByBucket.has(b)) usersByBucket.set(b, new Set());
            usersByBucket.get(b).add(e.user_id);
        }
        // reading_minutes: payload.elapsedMs o columna elapsed_ms
        let ms = (typeof e.elapsed_ms === 'number') ? e.elapsed_ms : 0;
        if (!ms && e.payload_json) {
            try { const p = JSON.parse(e.payload_json);
                  if (typeof p?.elapsedMs === 'number') ms = p.elapsedMs;
            } catch {}
        }
        if (ms > 0) {
            minutesByBucket.set(b, (minutesByBucket.get(b) || 0) + ms);
        }
    }

    // emit active_users + reading_minutes (uno por bucket)
    for (const [b, set] of usersByBucket) {
        rows.set(`${b}|all|global|active_users`, {
            period_start: b, scope_type: 'all', scope_id: 'global',
            metric_key: 'active_users', metric_value: set.size, sample_size: set.size,
        });
    }
    for (const [b, ms] of minutesByBucket) {
        rows.set(`${b}|all|global|reading_minutes`, {
            period_start: b, scope_type: 'all', scope_id: 'global',
            metric_key: 'reading_minutes', metric_value: Math.round(ms / 60_000),
            sample_size: 1,
        });
    }
    return Array.from(rows.values());
}

// ── runOnce ────────────────────────────────────────────────────────────────
/**
 * Computa rollups para el rango [fromTs, toTs].
 * @param {{nowTs?:number, fromTs?:number, toTs?:number, log?:(m:string)=>void,
 *          forceRun?:boolean, granularities?:Array<'daily'|'weekly'|'monthly'>,
 *          maxEvents?:number}} [opts]
 */
export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const grans = opts.granularities ?? ['daily', 'weekly', 'monthly'];
    const result = {
        ok: false,
        eventsScanned: 0,
        daily_upserts: 0,
        weekly_upserts: 0,
        monthly_upserts: 0,
        durationMs: 0,
    };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getRollupsExtDb();
        const stmts = getRollupsStatements();
        // Por defecto: rolar últimos 90 días (cubre weekly + monthly de un trimestre).
        const fromTs = opts.fromTs ?? (nowTs - 90 * DAY_MS);
        const toTs   = opts.toTs   ?? nowTs;
        const maxEvents = opts.maxEvents ?? 200_000;

        const db = getEventsRaw();
        const events = db.prepare(
            `SELECT id, event, user_id, content_id, session_id, server_ts,
                    elapsed_ms, payload_json
             FROM events WHERE server_ts >= ? AND server_ts <= ? ORDER BY id ASC LIMIT ?`
        ).all(fromTs, toTs, maxEvents);
        result.eventsScanned = events.length;

        const tx = getRollupsExtDb().transaction(() => {
            if (grans.includes('daily')) {
                const rows = aggregateBuckets(events, dayStart);
                for (const r of rows) {
                    stmts.upsertDaily.run({ ...r, computed_at: nowTs, source_watermark: 0 });
                    result.daily_upserts++;
                }
            }
            if (grans.includes('weekly')) {
                const rows = aggregateBuckets(events, weekStart);
                for (const r of rows) {
                    stmts.upsertWeekly.run({ ...r, computed_at: nowTs, source_watermark: 0 });
                    result.weekly_upserts++;
                }
            }
            if (grans.includes('monthly')) {
                const rows = aggregateBuckets(events, monthStart);
                for (const r of rows) {
                    stmts.upsertMonthly.run({ ...r, computed_at: nowTs, source_watermark: 0 });
                    result.monthly_upserts++;
                }
            }
        });
        tx();
        try {
            rollupUpdates.labels('daily').inc(result.daily_upserts);
            rollupUpdates.labels('weekly').inc(result.weekly_upserts);
            rollupUpdates.labels('monthly').inc(result.monthly_upserts);
        } catch {}
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[rollupsEngine] error: ${result.error}`);
    }
    result.durationMs = Date.now() - t0;
    return result;
}

export function getStatus() {
    try {
        getRollupsExtDb();
        const stmts = getRollupsStatements();
        const c = stmts.countRollups.get();
        const latest = stmts.latestRollup.get();
        return {
            engine: 'aula_viva_rollups_v1',
            enabled: ENABLED(),
            daily_rows: c.daily, weekly_rows: c.weekly, monthly_rows: c.monthly,
            latest_computed_at: latest?.latest ?? null,
            stale_rollups: latest?.latest ? Math.max(0, Date.now() - latest.latest) > 24 * 3600_000 : true,
            ok: true,
        };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}
