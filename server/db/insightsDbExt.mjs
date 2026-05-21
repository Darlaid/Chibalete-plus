/**
 * insightsDbExt.mjs — extensiones del schema de insights.db para PASO 2.
 *
 * NO toca insightsStore.js (alerts API funcional). Abre el MISMO archivo
 * insights.db (WAL permite múltiples handles) y agrega 4 tablas nuevas
 * idempotentemente. Mismo patrón PRAGMA que el resto del repo.
 *
 * Tablas (todas con `IF NOT EXISTS` — reaplicar = no-op):
 *   - materializer_state   (singleton por materializer_name)
 *   - signal_snapshots     (long-form por scope+signal+period)
 *   - user_reading_profiles
 *   - cohort_rollups
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'insights.db');
const DB_PATH = process.env.INSIGHTS_SQLITE_PATH || DEFAULT_PATH;

let _db = null;
let _stmt = null;

export function getInsightsExtDb() {
    if (_db) return _db;
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('busy_timeout = 5000');
    _db.pragma('foreign_keys = ON');
    _db.pragma('cache_size = -2000');
    _db.pragma('temp_store = MEMORY');
    _db.pragma('wal_autocheckpoint = 100');

    _db.exec(`
      CREATE TABLE IF NOT EXISTS materializer_state (
        materializer_name TEXT PRIMARY KEY,
        last_event_id     INTEGER NOT NULL DEFAULT 0,
        last_ts           INTEGER NOT NULL DEFAULT 0,
        updated_at        INTEGER NOT NULL DEFAULT 0,
        lag_events        INTEGER NOT NULL DEFAULT 0,
        lag_seconds       INTEGER NOT NULL DEFAULT 0,
        degraded          INTEGER NOT NULL DEFAULT 0,
        last_error        TEXT
      );

      CREATE TABLE IF NOT EXISTS signal_snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type    TEXT NOT NULL,
        scope_id      TEXT NOT NULL,
        signal_id     TEXT NOT NULL,
        period        TEXT NOT NULL,            -- '7d' | '14d' | '28d' | 'all'
        metric_value  REAL,
        confidence    TEXT,                     -- 'low'|'medium'|'high'|'pending'
        trend         TEXT,                     -- 'up'|'down'|'flat'|null
        source_watermark INTEGER NOT NULL,
        metadata_json TEXT,
        updated_at    INTEGER NOT NULL,
        UNIQUE(scope_type, scope_id, signal_id, period)
      );
      CREATE INDEX IF NOT EXISTS idx_sig_snap_scope ON signal_snapshots(scope_type, scope_id);
      CREATE INDEX IF NOT EXISTS idx_sig_snap_sig   ON signal_snapshots(signal_id, updated_at);

      CREATE TABLE IF NOT EXISTS user_reading_profiles (
        user_id            TEXT PRIMARY KEY,
        fluidez_score      REAL,
        persistencia_score REAL,
        autonomia_score    REAL,
        concentracion_score REAL,
        diversidad_score   REAL,
        engagement_score   REAL,
        abandono_risk      REAL,                 -- 0..1
        last_active_at     INTEGER,
        updated_at         INTEGER NOT NULL,
        source_watermark   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_profiles_updated ON user_reading_profiles(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_profiles_risk    ON user_reading_profiles(abandono_risk DESC);

      CREATE TABLE IF NOT EXISTS cohort_rollups (
        scope_type   TEXT NOT NULL,              -- 'group'|'school'|'org'
        scope_id     TEXT NOT NULL,
        period       TEXT NOT NULL,
        metric_key   TEXT NOT NULL,              -- e.g. 'engagement','active_users','at_risk'
        metric_value REAL,
        trend        TEXT,
        updated_at   INTEGER NOT NULL,
        source_watermark INTEGER NOT NULL,
        PRIMARY KEY (scope_type, scope_id, period, metric_key)
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_scope ON cohort_rollups(scope_type, scope_id);
    `);

    _stmt = {
      getMatState:   _db.prepare(`SELECT * FROM materializer_state WHERE materializer_name = ?`),
      upsertMatState:_db.prepare(`
        INSERT INTO materializer_state (materializer_name,last_event_id,last_ts,updated_at,lag_events,lag_seconds,degraded,last_error)
        VALUES (@name,@last_event_id,@last_ts,@updated_at,@lag_events,@lag_seconds,@degraded,@last_error)
        ON CONFLICT(materializer_name) DO UPDATE SET
          last_event_id=excluded.last_event_id, last_ts=excluded.last_ts,
          updated_at=excluded.updated_at, lag_events=excluded.lag_events,
          lag_seconds=excluded.lag_seconds, degraded=excluded.degraded,
          last_error=excluded.last_error
      `),
      upsertSignalSnap: _db.prepare(`
        INSERT INTO signal_snapshots (scope_type,scope_id,signal_id,period,metric_value,confidence,trend,source_watermark,metadata_json,updated_at)
        VALUES (@scope_type,@scope_id,@signal_id,@period,@metric_value,@confidence,@trend,@source_watermark,@metadata_json,@updated_at)
        ON CONFLICT(scope_type,scope_id,signal_id,period) DO UPDATE SET
          metric_value=excluded.metric_value, confidence=excluded.confidence,
          trend=excluded.trend, source_watermark=excluded.source_watermark,
          metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
      `),
      upsertProfile: _db.prepare(`
        INSERT INTO user_reading_profiles (user_id,fluidez_score,persistencia_score,autonomia_score,concentracion_score,diversidad_score,engagement_score,abandono_risk,last_active_at,updated_at,source_watermark)
        VALUES (@user_id,@fluidez_score,@persistencia_score,@autonomia_score,@concentracion_score,@diversidad_score,@engagement_score,@abandono_risk,@last_active_at,@updated_at,@source_watermark)
        ON CONFLICT(user_id) DO UPDATE SET
          fluidez_score=excluded.fluidez_score, persistencia_score=excluded.persistencia_score,
          autonomia_score=excluded.autonomia_score, concentracion_score=excluded.concentracion_score,
          diversidad_score=excluded.diversidad_score, engagement_score=excluded.engagement_score,
          abandono_risk=excluded.abandono_risk, last_active_at=excluded.last_active_at,
          updated_at=excluded.updated_at, source_watermark=excluded.source_watermark
      `),
      upsertCohort: _db.prepare(`
        INSERT INTO cohort_rollups (scope_type,scope_id,period,metric_key,metric_value,trend,updated_at,source_watermark)
        VALUES (@scope_type,@scope_id,@period,@metric_key,@metric_value,@trend,@updated_at,@source_watermark)
        ON CONFLICT(scope_type,scope_id,period,metric_key) DO UPDATE SET
          metric_value=excluded.metric_value, trend=excluded.trend,
          updated_at=excluded.updated_at, source_watermark=excluded.source_watermark
      `),
      getProfile:    _db.prepare(`SELECT * FROM user_reading_profiles WHERE user_id = ?`),
      listCohort:    _db.prepare(`SELECT * FROM cohort_rollups WHERE scope_type = ? AND scope_id = ?`),
      listScopeSignals: _db.prepare(`SELECT * FROM signal_snapshots WHERE scope_type = ? AND scope_id = ? ORDER BY signal_id`),
      countByTable: {
        snaps:    _db.prepare(`SELECT COUNT(*) AS n FROM signal_snapshots`),
        profiles: _db.prepare(`SELECT COUNT(*) AS n FROM user_reading_profiles`),
        cohorts:  _db.prepare(`SELECT COUNT(*) AS n FROM cohort_rollups`),
      },
    };
    return _db;
}

export function getStatements() { getInsightsExtDb(); return _stmt; }
export function closeInsightsExtDb() { if (_db) { try { _db.close(); } catch {} _db = null; _stmt = null; } }
export { DB_PATH };
