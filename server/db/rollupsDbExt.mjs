/**
 * rollupsDbExt.mjs — PASO 4: escalabilidad + longitudinalidad real.
 *
 * Extiende insights.db (mismo archivo, mismo PRAGMA pattern) con 5 tablas
 * nuevas SIN tocar PASO 1/2/3:
 *
 *   - daily_rollups | weekly_rollups | monthly_rollups
 *       Agregaciones temporales: dashboards leen N filas en vez de scanear
 *       millones de eventos. PK composite (period_start, scope, metric).
 *       UPSERT idempotente.
 *
 *   - signal_snapshots_history (append-only)
 *       Resuelve la limitación PASO 3 §17: snapshot history para
 *       trayectorias longitudinales reales. Gated por SNAPSHOT_HISTORY_ENABLED.
 *
 *   - feature_vectors (versionado)
 *       Feature extraction para IA futura. Cada vector lleva
 *       vector_version + source_watermark → reproducible.
 *
 *   - materializer_runs (job ledger)
 *       Tracking de runs: status, progress_n/total, cancel_requested.
 *       Hace materializer y replay resumibles + cancelables.
 *
 *   - process_leader (advisory lock)
 *       Multi-api consistency sin Redis/etcd. TTL + heartbeat.
 *
 * Mismo handle pattern que insightsDbExt/pedagogyDbExt. Mismo archivo
 * → mismo write-lock — el patrón 4-fase de PASO 3 sigue siendo válido.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'insights.db');
const DB_PATH = process.env.INSIGHTS_SQLITE_PATH || DEFAULT_PATH;

// Tuning gated: ON por default; rollback = PRAGMA_TUNING_ENABLED=0.
const PRAGMA_TUNING = process.env.PRAGMA_TUNING_ENABLED !== '0';

let _db = null;
let _stmt = null;

export function getRollupsExtDb() {
    if (_db) return _db;
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('busy_timeout = ' + (PRAGMA_TUNING ? 10000 : 5000));  // §2 audit
    _db.pragma('foreign_keys = ON');
    _db.pragma('cache_size = ' + (PRAGMA_TUNING ? -8000 : -2000));    // §2: 8 MB para insights
    _db.pragma('temp_store = MEMORY');
    _db.pragma('wal_autocheckpoint = 100');
    if (PRAGMA_TUNING) {
        // 256 MB mmap → reads zero-copy. Valor seguro: SQLite limita al menor
        // entre este y el tamaño del archivo. No reserva RAM hasta que se usa.
        try { _db.pragma('mmap_size = 268435456'); } catch { /* fallback silencioso */ }
    }

    _db.exec(`
      -- ── Rollups temporales (alimentan dashboards) ───────────────────────
      CREATE TABLE IF NOT EXISTS daily_rollups (
        period_start    INTEGER NOT NULL,   -- floor(ts/86400e3)*86400e3 UTC
        scope_type      TEXT    NOT NULL,   -- 'user'|'group'|'school'|'all'
        scope_id        TEXT    NOT NULL,
        metric_key      TEXT    NOT NULL,
        metric_value    REAL,
        sample_size     INTEGER,            -- n eventos/profiles que sustentan
        computed_at     INTEGER NOT NULL,
        source_watermark INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (period_start, scope_type, scope_id, metric_key)
      );
      CREATE INDEX IF NOT EXISTS idx_daily_scope
        ON daily_rollups(scope_type, scope_id, period_start DESC);
      CREATE INDEX IF NOT EXISTS idx_daily_metric
        ON daily_rollups(metric_key, period_start DESC);

      CREATE TABLE IF NOT EXISTS weekly_rollups (
        period_start    INTEGER NOT NULL,   -- lunes 00:00 UTC del bucket
        scope_type      TEXT    NOT NULL,
        scope_id        TEXT    NOT NULL,
        metric_key      TEXT    NOT NULL,
        metric_value    REAL,
        sample_size     INTEGER,
        computed_at     INTEGER NOT NULL,
        source_watermark INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (period_start, scope_type, scope_id, metric_key)
      );
      CREATE INDEX IF NOT EXISTS idx_weekly_scope
        ON weekly_rollups(scope_type, scope_id, period_start DESC);

      CREATE TABLE IF NOT EXISTS monthly_rollups (
        period_start    INTEGER NOT NULL,   -- día 1 mes UTC
        scope_type      TEXT    NOT NULL,
        scope_id        TEXT    NOT NULL,
        metric_key      TEXT    NOT NULL,
        metric_value    REAL,
        sample_size     INTEGER,
        computed_at     INTEGER NOT NULL,
        source_watermark INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (period_start, scope_type, scope_id, metric_key)
      );
      CREATE INDEX IF NOT EXISTS idx_monthly_scope
        ON monthly_rollups(scope_type, scope_id, period_start DESC);

      -- ── Snapshot history (append-only longitudinal) ─────────────────────
      CREATE TABLE IF NOT EXISTS signal_snapshots_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at     INTEGER NOT NULL,
        scope_type      TEXT NOT NULL,
        scope_id        TEXT NOT NULL,
        signal_id       TEXT NOT NULL,
        period          TEXT NOT NULL,
        metric_value    REAL,
        confidence      TEXT,
        metadata_json   TEXT,
        source_watermark INTEGER NOT NULL
      );
      -- Acceso típico: timeline por (scope, signal) en una ventana temporal.
      CREATE INDEX IF NOT EXISTS idx_snap_hist_scope_sig
        ON signal_snapshots_history(scope_type, scope_id, signal_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_snap_hist_recorded
        ON signal_snapshots_history(recorded_at DESC);

      -- ── Feature vectors (IA futura, sin entrenar IA) ────────────────────
      CREATE TABLE IF NOT EXISTS feature_vectors (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         TEXT NOT NULL,
        period          TEXT NOT NULL,        -- '28d'
        vector_version  INTEGER NOT NULL,     -- FEATURE_VECTOR_VERSION
        period_start    INTEGER NOT NULL,
        period_end      INTEGER NOT NULL,
        features_json   TEXT NOT NULL,        -- serializado, todas las features
        computed_at     INTEGER NOT NULL,
        source_watermark INTEGER NOT NULL,
        UNIQUE(user_id, period, vector_version, period_end)
      );
      CREATE INDEX IF NOT EXISTS idx_fv_user
        ON feature_vectors(user_id, period_end DESC);
      CREATE INDEX IF NOT EXISTS idx_fv_version
        ON feature_vectors(vector_version, computed_at DESC);

      -- ── Job ledger (resumibilidad + cancelación + progreso) ─────────────
      CREATE TABLE IF NOT EXISTS materializer_runs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id          TEXT NOT NULL UNIQUE,
        run_type        TEXT NOT NULL,       -- 'materializer'|'intervention'|'rollup'|'replay'|'feature_extract'
        scope_json      TEXT,                -- input scopes (replay)
        started_at      INTEGER NOT NULL,
        completed_at    INTEGER,
        status          TEXT NOT NULL,       -- 'running'|'completed'|'failed'|'canceled'|'stalled'
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        progress_n      INTEGER NOT NULL DEFAULT 0,
        progress_total  INTEGER,
        last_checkpoint INTEGER,             -- último id procesado (para resume)
        error_message   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_type_started
        ON materializer_runs(run_type, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_active
        ON materializer_runs(status, started_at DESC) WHERE status = 'running';

      -- ── Leader election (advisory lock; sin Redis) ──────────────────────
      CREATE TABLE IF NOT EXISTS process_leader (
        lock_key      TEXT PRIMARY KEY,
        holder_id     TEXT NOT NULL,
        acquired_at   INTEGER NOT NULL,
        heartbeat_at  INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL
      );

      -- ── Slow query log (instrumentación, no historial completo) ─────────
      CREATE TABLE IF NOT EXISTS slow_query_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id        TEXT NOT NULL,
        elapsed_ms      INTEGER NOT NULL,
        observed_at     INTEGER NOT NULL,
        sample_args     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_slow_observed
        ON slow_query_log(observed_at DESC);
    `);

    _stmt = {
        // Rollups (mismo SQL para 3 granularidades, distinto _stmt.upsert*)
        upsertDaily: _db.prepare(`
            INSERT INTO daily_rollups
              (period_start, scope_type, scope_id, metric_key, metric_value,
               sample_size, computed_at, source_watermark)
            VALUES
              (@period_start, @scope_type, @scope_id, @metric_key, @metric_value,
               @sample_size, @computed_at, @source_watermark)
            ON CONFLICT(period_start, scope_type, scope_id, metric_key)
            DO UPDATE SET
              metric_value = excluded.metric_value,
              sample_size  = excluded.sample_size,
              computed_at  = excluded.computed_at,
              source_watermark = excluded.source_watermark
        `),
        upsertWeekly: _db.prepare(`
            INSERT INTO weekly_rollups
              (period_start, scope_type, scope_id, metric_key, metric_value,
               sample_size, computed_at, source_watermark)
            VALUES
              (@period_start, @scope_type, @scope_id, @metric_key, @metric_value,
               @sample_size, @computed_at, @source_watermark)
            ON CONFLICT(period_start, scope_type, scope_id, metric_key)
            DO UPDATE SET
              metric_value = excluded.metric_value,
              sample_size  = excluded.sample_size,
              computed_at  = excluded.computed_at,
              source_watermark = excluded.source_watermark
        `),
        upsertMonthly: _db.prepare(`
            INSERT INTO monthly_rollups
              (period_start, scope_type, scope_id, metric_key, metric_value,
               sample_size, computed_at, source_watermark)
            VALUES
              (@period_start, @scope_type, @scope_id, @metric_key, @metric_value,
               @sample_size, @computed_at, @source_watermark)
            ON CONFLICT(period_start, scope_type, scope_id, metric_key)
            DO UPDATE SET
              metric_value = excluded.metric_value,
              sample_size  = excluded.sample_size,
              computed_at  = excluded.computed_at,
              source_watermark = excluded.source_watermark
        `),
        listDailyScope: _db.prepare(`
            SELECT * FROM daily_rollups
            WHERE scope_type = ? AND scope_id = ? AND period_start >= ?
            ORDER BY period_start ASC
        `),
        listWeeklyScope: _db.prepare(`
            SELECT * FROM weekly_rollups
            WHERE scope_type = ? AND scope_id = ? AND period_start >= ?
            ORDER BY period_start ASC
        `),
        listMonthlyScope: _db.prepare(`
            SELECT * FROM monthly_rollups
            WHERE scope_type = ? AND scope_id = ? AND period_start >= ?
            ORDER BY period_start ASC
        `),
        countRollups: _db.prepare(`
            SELECT
              (SELECT COUNT(*) FROM daily_rollups)   AS daily,
              (SELECT COUNT(*) FROM weekly_rollups)  AS weekly,
              (SELECT COUNT(*) FROM monthly_rollups) AS monthly
        `),
        latestRollup: _db.prepare(`
            SELECT MAX(computed_at) AS latest FROM daily_rollups
        `),

        // Snapshot history
        insertSnapHistory: _db.prepare(`
            INSERT INTO signal_snapshots_history
              (recorded_at, scope_type, scope_id, signal_id, period,
               metric_value, confidence, metadata_json, source_watermark)
            VALUES
              (@recorded_at, @scope_type, @scope_id, @signal_id, @period,
               @metric_value, @confidence, @metadata_json, @source_watermark)
        `),
        timelineSignal: _db.prepare(`
            SELECT * FROM signal_snapshots_history
            WHERE scope_type = ? AND scope_id = ? AND signal_id = ? AND recorded_at >= ?
            ORDER BY recorded_at ASC
        `),
        countSnapHistory: _db.prepare(`SELECT COUNT(*) AS n FROM signal_snapshots_history`),

        // Feature vectors
        upsertFeatureVector: _db.prepare(`
            INSERT INTO feature_vectors
              (user_id, period, vector_version, period_start, period_end,
               features_json, computed_at, source_watermark)
            VALUES
              (@user_id, @period, @vector_version, @period_start, @period_end,
               @features_json, @computed_at, @source_watermark)
            ON CONFLICT(user_id, period, vector_version, period_end)
            DO UPDATE SET
              features_json     = excluded.features_json,
              computed_at       = excluded.computed_at,
              source_watermark  = excluded.source_watermark
        `),
        latestFeatureVector: _db.prepare(`
            SELECT * FROM feature_vectors
            WHERE user_id = ? AND vector_version = ?
            ORDER BY period_end DESC LIMIT 1
        `),
        countFeatureVectors: _db.prepare(`SELECT COUNT(*) AS n FROM feature_vectors`),

        // Job ledger
        insertRun: _db.prepare(`
            INSERT INTO materializer_runs
              (run_id, run_type, scope_json, started_at, status, progress_total, last_checkpoint)
            VALUES
              (@run_id, @run_type, @scope_json, @started_at, 'running', @progress_total, @last_checkpoint)
        `),
        updateRunProgress: _db.prepare(`
            UPDATE materializer_runs
            SET progress_n = @progress_n, last_checkpoint = @last_checkpoint
            WHERE run_id = @run_id
        `),
        completeRun: _db.prepare(`
            UPDATE materializer_runs
            SET completed_at = @completed_at, status = @status, error_message = @error_message
            WHERE run_id = @run_id
        `),
        requestCancel: _db.prepare(`
            UPDATE materializer_runs SET cancel_requested = 1
            WHERE run_id = @run_id AND status = 'running'
        `),
        getRun: _db.prepare(`SELECT * FROM materializer_runs WHERE run_id = ?`),
        listActiveRuns: _db.prepare(`
            SELECT * FROM materializer_runs WHERE status = 'running' ORDER BY started_at DESC
        `),
        listRecentRuns: _db.prepare(`
            SELECT * FROM materializer_runs ORDER BY started_at DESC LIMIT ?
        `),

        // Leader election
        leaderInsert: _db.prepare(`
            INSERT OR IGNORE INTO process_leader
              (lock_key, holder_id, acquired_at, heartbeat_at, expires_at)
            VALUES
              (@lock_key, @holder_id, @acquired_at, @heartbeat_at, @expires_at)
        `),
        leaderClaimExpired: _db.prepare(`
            UPDATE process_leader
            SET holder_id = @holder_id, acquired_at = @acquired_at,
                heartbeat_at = @heartbeat_at, expires_at = @expires_at
            WHERE lock_key = @lock_key AND expires_at < @now
        `),
        leaderHeartbeat: _db.prepare(`
            UPDATE process_leader
            SET heartbeat_at = @heartbeat_at, expires_at = @expires_at
            WHERE lock_key = @lock_key AND holder_id = @holder_id
        `),
        leaderRelease: _db.prepare(`
            DELETE FROM process_leader
            WHERE lock_key = @lock_key AND holder_id = @holder_id
        `),
        leaderGet: _db.prepare(`SELECT * FROM process_leader WHERE lock_key = ?`),

        // Slow query log
        logSlow: _db.prepare(`
            INSERT INTO slow_query_log (query_id, elapsed_ms, observed_at, sample_args)
            VALUES (@query_id, @elapsed_ms, @observed_at, @sample_args)
        `),
        countSlowSince: _db.prepare(`
            SELECT COUNT(*) AS n FROM slow_query_log WHERE observed_at >= ?
        `),
        listSlowRecent: _db.prepare(`
            SELECT * FROM slow_query_log WHERE observed_at >= ? ORDER BY observed_at DESC LIMIT ?
        `),
        pruneSlow: _db.prepare(`DELETE FROM slow_query_log WHERE observed_at < ?`),
    };
    return _db;
}

export function getRollupsStatements() { getRollupsExtDb(); return _stmt; }
export function closeRollupsExtDb() {
    if (_db) { try { _db.close(); } catch {} _db = null; _stmt = null; }
}
export { DB_PATH, PRAGMA_TUNING };
