/**
 * outcomesDbExt.mjs — PASO 6: outcomes + cohorts + trajectories +
 * institutional_learnings + predictive_risk_patterns.
 *
 * Mismo patrón insightsDbExt/pedagogyDbExt/rollupsDbExt:
 *   - handle paralelo al MISMO archivo insights.db
 *   - PRAGMAs idempotentes
 *   - CREATE TABLE IF NOT EXISTS
 *   - prepared statements cacheados
 *
 * 6 tablas nuevas:
 *
 *   intervention_outcomes     — uno por intervención evaluable
 *   cohort_definitions        — definición canónica (cohort_key UNIQUE)
 *   cohort_memberships        — snapshot de membership por cohort + user
 *   cohort_trajectories       — series temporales agregadas por cohort
 *   institutional_learnings   — aprendizajes prudentes ("observed effect")
 *   predictive_risk_patterns  — secuencias de señales observadas
 *
 * UNIQUE constraints estrictos garantizan idempotencia de los engines.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'insights.db');
const DB_PATH = process.env.INSIGHTS_SQLITE_PATH || DEFAULT_PATH;

const PRAGMA_TUNING = process.env.PRAGMA_TUNING_ENABLED !== '0';

let _db = null;
let _stmt = null;

export function getOutcomesExtDb() {
    if (_db) return _db;
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('busy_timeout = ' + (PRAGMA_TUNING ? 10000 : 5000));
    _db.pragma('foreign_keys = ON');
    _db.pragma('cache_size = ' + (PRAGMA_TUNING ? -8000 : -2000));
    _db.pragma('temp_store = MEMORY');
    _db.pragma('wal_autocheckpoint = 100');

    _db.exec(`
      -- ── INTERVENTION OUTCOMES ────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS intervention_outcomes (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        outcome_id          TEXT NOT NULL UNIQUE,
        intervention_id     TEXT NOT NULL,
        recommendation_id   TEXT,
        user_id             TEXT NOT NULL,
        scope_type          TEXT NOT NULL,
        scope_id            TEXT NOT NULL,
        intervention_type   TEXT NOT NULL,
        baseline_window_start  INTEGER NOT NULL,
        baseline_window_end    INTEGER NOT NULL,
        followup_window_start  INTEGER NOT NULL,
        followup_window_end    INTEGER NOT NULL,
        baseline_metrics_json  TEXT NOT NULL,
        followup_metrics_json  TEXT NOT NULL,
        delta_metrics_json     TEXT NOT NULL,
        outcome_label       TEXT NOT NULL,    -- improved|stable|worsened|insufficient_data|mixed
        confidence          REAL NOT NULL,    -- 0..1
        evidence_level      TEXT NOT NULL,    -- low|medium|high
        explanation         TEXT NOT NULL,    -- texto observacional, sin causalidad
        notes_json          TEXT,             -- libre (rule_id, etc.)
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        UNIQUE(intervention_id)               -- 1 outcome por intervención
      );
      CREATE INDEX IF NOT EXISTS idx_outcomes_user
        ON intervention_outcomes(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outcomes_type_label
        ON intervention_outcomes(intervention_type, outcome_label);
      CREATE INDEX IF NOT EXISTS idx_outcomes_scope
        ON intervention_outcomes(scope_type, scope_id, created_at DESC);

      -- ── COHORT DEFINITIONS ───────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS cohort_definitions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        cohort_id       TEXT NOT NULL UNIQUE,
        cohort_key      TEXT NOT NULL UNIQUE,   -- 'group:7A', 'risk:abandono_alto', ...
        cohort_type     TEXT NOT NULL,          -- group|school|club|library|intervention|risk|habit|modality|trajectory
        scope_type      TEXT NOT NULL,
        scope_id        TEXT NOT NULL,
        criteria_json   TEXT NOT NULL,          -- definición declarativa
        version         INTEGER NOT NULL DEFAULT 1,
        active          INTEGER NOT NULL DEFAULT 1,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_def_type
        ON cohort_definitions(cohort_type, active);
      CREATE INDEX IF NOT EXISTS idx_cohort_def_scope
        ON cohort_definitions(scope_type, scope_id);

      -- ── COHORT MEMBERSHIPS ───────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS cohort_memberships (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        cohort_id     TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        joined_at     INTEGER NOT NULL,
        left_at       INTEGER,
        membership_reason_json TEXT,
        UNIQUE(cohort_id, user_id, joined_at)
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_mem_cohort
        ON cohort_memberships(cohort_id, left_at);
      CREATE INDEX IF NOT EXISTS idx_cohort_mem_user
        ON cohort_memberships(user_id, joined_at DESC);

      -- ── COHORT TRAJECTORIES ──────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS cohort_trajectories (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        trajectory_id   TEXT NOT NULL UNIQUE,
        cohort_id       TEXT NOT NULL,
        period          TEXT NOT NULL,        -- '7d' | '28d' | '90d'
        period_start    INTEGER NOT NULL,
        period_end      INTEGER NOT NULL,
        metrics_json    TEXT NOT NULL,        -- {signal:value, ...}
        trend_json      TEXT NOT NULL,        -- {signal:trend, ...}
        confidence      REAL,
        sample_size     INTEGER,
        created_at      INTEGER NOT NULL,
        UNIQUE(cohort_id, period, period_end)
      );
      CREATE INDEX IF NOT EXISTS idx_traj_cohort
        ON cohort_trajectories(cohort_id, period_end DESC);

      -- ── INSTITUTIONAL LEARNINGS ──────────────────────────────────────
      CREATE TABLE IF NOT EXISTS institutional_learnings (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        learning_id           TEXT NOT NULL UNIQUE,
        scope_type            TEXT NOT NULL,
        scope_id              TEXT NOT NULL,
        learning_type         TEXT NOT NULL,    -- observed_strategy_effect | risk_pattern | habit_pattern
        evidence_json         TEXT NOT NULL,    -- {support_count, outcome_distribution, ...}
        confidence            REAL NOT NULL,    -- 0..1
        recommendation_hint   TEXT NOT NULL,    -- observacional, sin causalidad
        active                INTEGER NOT NULL DEFAULT 1,
        version               INTEGER NOT NULL DEFAULT 1,
        created_at            INTEGER NOT NULL,
        updated_at            INTEGER NOT NULL,
        UNIQUE(scope_type, scope_id, learning_type, version)
      );
      CREATE INDEX IF NOT EXISTS idx_learning_scope_active
        ON institutional_learnings(scope_type, scope_id, active);

      -- ── PREDICTIVE RISK PATTERNS (NO ML) ─────────────────────────────
      CREATE TABLE IF NOT EXISTS predictive_risk_patterns (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_id          TEXT NOT NULL UNIQUE,
        pattern_key         TEXT NOT NULL,         -- canonical key
        signal_sequence_json TEXT NOT NULL,        -- secuencia observada
        observed_outcome    TEXT NOT NULL,         -- abandono | recuperacion | invisibilidad ...
        support_count       INTEGER NOT NULL DEFAULT 1,
        confidence          REAL NOT NULL,
        version             INTEGER NOT NULL DEFAULT 1,
        active              INTEGER NOT NULL DEFAULT 1,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        UNIQUE(pattern_key, version)
      );
      CREATE INDEX IF NOT EXISTS idx_pat_outcome
        ON predictive_risk_patterns(observed_outcome, active);
    `);

    _stmt = {
        // ── Outcomes
        upsertOutcome: _db.prepare(`
            INSERT INTO intervention_outcomes
              (outcome_id, intervention_id, recommendation_id, user_id,
               scope_type, scope_id, intervention_type,
               baseline_window_start, baseline_window_end,
               followup_window_start, followup_window_end,
               baseline_metrics_json, followup_metrics_json, delta_metrics_json,
               outcome_label, confidence, evidence_level, explanation,
               notes_json, created_at, updated_at)
            VALUES
              (@outcome_id, @intervention_id, @recommendation_id, @user_id,
               @scope_type, @scope_id, @intervention_type,
               @baseline_window_start, @baseline_window_end,
               @followup_window_start, @followup_window_end,
               @baseline_metrics_json, @followup_metrics_json, @delta_metrics_json,
               @outcome_label, @confidence, @evidence_level, @explanation,
               @notes_json, @created_at, @updated_at)
            ON CONFLICT(intervention_id) DO UPDATE SET
              baseline_metrics_json = excluded.baseline_metrics_json,
              followup_metrics_json = excluded.followup_metrics_json,
              delta_metrics_json    = excluded.delta_metrics_json,
              outcome_label         = excluded.outcome_label,
              confidence            = excluded.confidence,
              evidence_level        = excluded.evidence_level,
              explanation           = excluded.explanation,
              notes_json            = excluded.notes_json,
              updated_at            = excluded.updated_at
        `),
        getOutcomeByIntervention: _db.prepare(
            `SELECT * FROM intervention_outcomes WHERE intervention_id = ?`),
        listOutcomesByUser: _db.prepare(
            `SELECT * FROM intervention_outcomes WHERE user_id = ?
             ORDER BY created_at DESC LIMIT ?`),
        listOutcomesByType: _db.prepare(
            `SELECT outcome_label, COUNT(*) AS n
             FROM intervention_outcomes WHERE intervention_type = ?
             GROUP BY outcome_label`),
        listOutcomesByScope: _db.prepare(
            `SELECT * FROM intervention_outcomes
             WHERE scope_type = ? AND scope_id = ?
             ORDER BY created_at DESC LIMIT ?`),
        countOutcomes: _db.prepare(`SELECT COUNT(*) AS n FROM intervention_outcomes`),
        countOutcomesByLabel: _db.prepare(
            `SELECT outcome_label, COUNT(*) AS n FROM intervention_outcomes
             GROUP BY outcome_label`),

        // ── Cohort definitions
        upsertCohortDef: _db.prepare(`
            INSERT INTO cohort_definitions
              (cohort_id, cohort_key, cohort_type, scope_type, scope_id,
               criteria_json, version, active, created_at, updated_at)
            VALUES
              (@cohort_id, @cohort_key, @cohort_type, @scope_type, @scope_id,
               @criteria_json, @version, 1, @created_at, @updated_at)
            ON CONFLICT(cohort_key) DO UPDATE SET
              criteria_json = excluded.criteria_json,
              version       = excluded.version,
              active        = 1,
              updated_at    = excluded.updated_at
        `),
        getCohortByKey: _db.prepare(`SELECT * FROM cohort_definitions WHERE cohort_key = ?`),
        getCohortById:  _db.prepare(`SELECT * FROM cohort_definitions WHERE cohort_id = ?`),
        listCohortsByType: _db.prepare(
            `SELECT * FROM cohort_definitions WHERE cohort_type = ? AND active = 1
             ORDER BY updated_at DESC`),
        deactivateCohort: _db.prepare(
            `UPDATE cohort_definitions SET active = 0, updated_at = ? WHERE cohort_id = ?`),
        countCohorts: _db.prepare(`SELECT COUNT(*) AS n FROM cohort_definitions WHERE active = 1`),

        // ── Cohort memberships
        clearCohortMemberships: _db.prepare(
            `DELETE FROM cohort_memberships WHERE cohort_id = ?`),
        insertCohortMembership: _db.prepare(`
            INSERT OR IGNORE INTO cohort_memberships
              (cohort_id, user_id, joined_at, left_at, membership_reason_json)
            VALUES (@cohort_id, @user_id, @joined_at, NULL, @membership_reason_json)
        `),
        listMembersOfCohort: _db.prepare(
            `SELECT * FROM cohort_memberships WHERE cohort_id = ? AND left_at IS NULL`),
        listCohortsOfUser: _db.prepare(
            `SELECT cm.*, cd.cohort_key, cd.cohort_type
             FROM cohort_memberships cm
             JOIN cohort_definitions cd ON cd.cohort_id = cm.cohort_id
             WHERE cm.user_id = ? AND cm.left_at IS NULL`),
        countCohortMemberships: _db.prepare(`SELECT COUNT(*) AS n FROM cohort_memberships`),

        // ── Trajectories
        upsertTrajectory: _db.prepare(`
            INSERT INTO cohort_trajectories
              (trajectory_id, cohort_id, period, period_start, period_end,
               metrics_json, trend_json, confidence, sample_size, created_at)
            VALUES
              (@trajectory_id, @cohort_id, @period, @period_start, @period_end,
               @metrics_json, @trend_json, @confidence, @sample_size, @created_at)
            ON CONFLICT(cohort_id, period, period_end) DO UPDATE SET
              metrics_json = excluded.metrics_json,
              trend_json   = excluded.trend_json,
              confidence   = excluded.confidence,
              sample_size  = excluded.sample_size,
              created_at   = excluded.created_at
        `),
        listTrajectoryByCohort: _db.prepare(
            `SELECT * FROM cohort_trajectories WHERE cohort_id = ? AND period = ?
             ORDER BY period_end DESC LIMIT ?`),
        countTrajectories: _db.prepare(`SELECT COUNT(*) AS n FROM cohort_trajectories`),

        // ── Institutional learnings
        upsertLearning: _db.prepare(`
            INSERT INTO institutional_learnings
              (learning_id, scope_type, scope_id, learning_type, evidence_json,
               confidence, recommendation_hint, active, version, created_at, updated_at)
            VALUES
              (@learning_id, @scope_type, @scope_id, @learning_type, @evidence_json,
               @confidence, @recommendation_hint, 1, @version, @created_at, @updated_at)
            ON CONFLICT(scope_type, scope_id, learning_type, version) DO UPDATE SET
              evidence_json       = excluded.evidence_json,
              confidence          = excluded.confidence,
              recommendation_hint = excluded.recommendation_hint,
              active              = 1,
              updated_at          = excluded.updated_at
        `),
        listLearningsByScope: _db.prepare(
            `SELECT * FROM institutional_learnings
             WHERE scope_type = ? AND scope_id = ? AND active = 1
             ORDER BY confidence DESC`),
        listLearningsByType: _db.prepare(
            `SELECT * FROM institutional_learnings
             WHERE learning_type = ? AND active = 1 ORDER BY confidence DESC LIMIT ?`),
        countLearnings: _db.prepare(`SELECT COUNT(*) AS n FROM institutional_learnings WHERE active = 1`),

        // ── Predictive patterns
        upsertPattern: _db.prepare(`
            INSERT INTO predictive_risk_patterns
              (pattern_id, pattern_key, signal_sequence_json, observed_outcome,
               support_count, confidence, version, active, created_at, updated_at)
            VALUES
              (@pattern_id, @pattern_key, @signal_sequence_json, @observed_outcome,
               @support_count, @confidence, @version, 1, @created_at, @updated_at)
            ON CONFLICT(pattern_key, version) DO UPDATE SET
              support_count = excluded.support_count,
              confidence    = excluded.confidence,
              updated_at    = excluded.updated_at
        `),
        listPatternsByOutcome: _db.prepare(
            `SELECT * FROM predictive_risk_patterns
             WHERE observed_outcome = ? AND active = 1
             ORDER BY confidence DESC, support_count DESC LIMIT ?`),
        countPatterns: _db.prepare(`SELECT COUNT(*) AS n FROM predictive_risk_patterns WHERE active = 1`),
    };
    return _db;
}

export function getOutcomesStatements() { getOutcomesExtDb(); return _stmt; }
export function closeOutcomesExtDb() {
    if (_db) { try { _db.close(); } catch {} _db = null; _stmt = null; }
}
export { DB_PATH };
