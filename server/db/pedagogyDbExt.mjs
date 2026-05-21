/**
 * pedagogyDbExt.mjs — extensión PASO 3 del schema de insights.db.
 *
 * 3 tablas nuevas para el motor de intervención pedagógica longitudinal.
 * Mismo patrón que insightsDbExt: handle paralelo al MISMO archivo (WAL
 * permite múltiples readers, escritor único es la tx del engine — flush
 * post-commit para notificaciones, igual que PASO 2).
 *
 *   pedagogical_recommendations    — recomendaciones determinísticas auditables
 *   pedagogical_interventions      — acciones registradas por docentes
 *   pedagogical_risk_history       — historial longitudinal de riesgos detectados
 *
 * NO toca insightsStore.js NI insightsDbExt.mjs. Mismo file path; PRAGMA
 * idéntico ya está aplicado por el handle compartido del proceso. Idempotente.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, '..', '..', 'data-critical', 'insights.db');
const DB_PATH = process.env.INSIGHTS_SQLITE_PATH || DEFAULT_PATH;

let _db = null;
let _stmt = null;

export function getPedagogyExtDb() {
    if (_db) return _db;
    _db = new Database(DB_PATH);
    // PRAGMA: si insightsDbExt ya los aplicó al mismo archivo son no-op.
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('busy_timeout = 5000');
    _db.pragma('foreign_keys = ON');
    _db.pragma('cache_size = -2000');
    _db.pragma('temp_store = MEMORY');
    _db.pragma('wal_autocheckpoint = 100');

    _db.exec(`
      CREATE TABLE IF NOT EXISTS pedagogical_recommendations (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        recommendation_id   TEXT NOT NULL UNIQUE,
        scope_type          TEXT NOT NULL,         -- 'user'|'group'|'school'
        scope_id            TEXT NOT NULL,
        rule_id             TEXT NOT NULL,         -- de pedagogicalRules.js
        recommendation_type TEXT NOT NULL,         -- 'lectura_guiada'|'audio'|...
        severity            TEXT NOT NULL,         -- 'info'|'moderate'|'high'|'critical'
        confidence          REAL,                  -- 0..1
        created_at          INTEGER NOT NULL,
        expires_at          INTEGER NOT NULL,
        explanation_json    TEXT NOT NULL,
        rule_ids_json       TEXT NOT NULL,         -- JSON array (futuro: composiciones)
        acknowledged        INTEGER NOT NULL DEFAULT 0,
        acknowledged_at     INTEGER,
        acknowledged_by     TEXT,
        applied             INTEGER NOT NULL DEFAULT 0,
        applied_at          INTEGER,
        source_watermark    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_recs_scope_active
        ON pedagogical_recommendations(scope_type, scope_id, acknowledged);
      CREATE INDEX IF NOT EXISTS idx_recs_created
        ON pedagogical_recommendations(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recs_severity
        ON pedagogical_recommendations(severity, acknowledged);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_recs_active_dedupe
        ON pedagogical_recommendations(scope_type, scope_id, rule_id)
        WHERE acknowledged = 0;

      CREATE TABLE IF NOT EXISTS pedagogical_interventions (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        intervention_id       TEXT NOT NULL UNIQUE,
        teacher_id            TEXT,
        student_id            TEXT NOT NULL,
        intervention_type     TEXT NOT NULL,
        created_at            INTEGER NOT NULL,
        notes                 TEXT,
        recommendation_origin TEXT,                 -- recommendation_id si vino de una recomendación
        outcome               TEXT,                 -- 'pending'|'improved'|'no_change'|'worsened'
        outcome_at            INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_intvns_student
        ON pedagogical_interventions(student_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_intvns_teacher
        ON pedagogical_interventions(teacher_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS pedagogical_risk_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        risk_id         TEXT NOT NULL UNIQUE,
        user_id         TEXT NOT NULL,
        risk_type       TEXT NOT NULL,
        severity        TEXT NOT NULL,
        detected_at     INTEGER NOT NULL,
        resolved_at     INTEGER,
        source_signals_json TEXT NOT NULL          -- {signal_id: value} snapshot
      );
      CREATE INDEX IF NOT EXISTS idx_risk_user
        ON pedagogical_risk_history(user_id, detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_risk_active
        ON pedagogical_risk_history(resolved_at, severity);
    `);

    _stmt = {
        // Recomendaciones
        upsertRecommendation: _db.prepare(`
            INSERT INTO pedagogical_recommendations
                (recommendation_id, scope_type, scope_id, rule_id, recommendation_type,
                 severity, confidence, created_at, expires_at, explanation_json,
                 rule_ids_json, acknowledged, applied, source_watermark)
            VALUES
                (@recommendation_id, @scope_type, @scope_id, @rule_id, @recommendation_type,
                 @severity, @confidence, @created_at, @expires_at, @explanation_json,
                 @rule_ids_json, 0, 0, @source_watermark)
            ON CONFLICT(recommendation_id) DO UPDATE SET
                severity         = excluded.severity,
                confidence       = excluded.confidence,
                explanation_json = excluded.explanation_json,
                expires_at       = excluded.expires_at,
                source_watermark = excluded.source_watermark
        `),
        // Activa = !acknowledged. La unique index parcial garantiza UNA por
        // (scope, rule). El INSERT OR IGNORE evita duplicar; el caller hace
        // UPDATE explícito si quiere refrescar la activa.
        insertIfNoActive: _db.prepare(`
            INSERT OR IGNORE INTO pedagogical_recommendations
                (recommendation_id, scope_type, scope_id, rule_id, recommendation_type,
                 severity, confidence, created_at, expires_at, explanation_json,
                 rule_ids_json, acknowledged, applied, source_watermark)
            VALUES
                (@recommendation_id, @scope_type, @scope_id, @rule_id, @recommendation_type,
                 @severity, @confidence, @created_at, @expires_at, @explanation_json,
                 @rule_ids_json, 0, 0, @source_watermark)
        `),
        updateActiveRecommendation: _db.prepare(`
            UPDATE pedagogical_recommendations
            SET severity = @severity,
                confidence = @confidence,
                explanation_json = @explanation_json,
                expires_at = @expires_at,
                source_watermark = @source_watermark
            WHERE scope_type = @scope_type
              AND scope_id = @scope_id
              AND rule_id = @rule_id
              AND acknowledged = 0
        `),
        ackRecommendation: _db.prepare(`
            UPDATE pedagogical_recommendations
            SET acknowledged = 1, acknowledged_at = @ts, acknowledged_by = @by
            WHERE recommendation_id = @recommendation_id AND acknowledged = 0
        `),
        applyRecommendation: _db.prepare(`
            UPDATE pedagogical_recommendations
            SET applied = 1, applied_at = @ts
            WHERE recommendation_id = @recommendation_id
        `),
        listActiveForScope: _db.prepare(`
            SELECT * FROM pedagogical_recommendations
            WHERE scope_type = ? AND scope_id = ? AND acknowledged = 0
            ORDER BY
              CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                            WHEN 'moderate' THEN 2 WHEN 'info' THEN 3 ELSE 4 END,
              created_at DESC
        `),
        listAllForScope: _db.prepare(`
            SELECT * FROM pedagogical_recommendations
            WHERE scope_type = ? AND scope_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `),
        countActiveBySeverity: _db.prepare(`
            SELECT severity, COUNT(*) AS n
            FROM pedagogical_recommendations
            WHERE acknowledged = 0
            GROUP BY severity
        `),
        countAll: _db.prepare(`SELECT COUNT(*) AS n FROM pedagogical_recommendations`),
        countActive: _db.prepare(`
            SELECT COUNT(*) AS n FROM pedagogical_recommendations WHERE acknowledged = 0`),

        // Intervenciones
        insertIntervention: _db.prepare(`
            INSERT INTO pedagogical_interventions
                (intervention_id, teacher_id, student_id, intervention_type,
                 created_at, notes, recommendation_origin, outcome, outcome_at)
            VALUES
                (@intervention_id, @teacher_id, @student_id, @intervention_type,
                 @created_at, @notes, @recommendation_origin, @outcome, @outcome_at)
        `),
        listInterventionsByStudent: _db.prepare(`
            SELECT * FROM pedagogical_interventions
            WHERE student_id = ? ORDER BY created_at DESC LIMIT ?
        `),
        countInterventions: _db.prepare(`SELECT COUNT(*) AS n FROM pedagogical_interventions`),

        // Risk history
        insertRisk: _db.prepare(`
            INSERT OR IGNORE INTO pedagogical_risk_history
                (risk_id, user_id, risk_type, severity, detected_at,
                 resolved_at, source_signals_json)
            VALUES
                (@risk_id, @user_id, @risk_type, @severity, @detected_at,
                 NULL, @source_signals_json)
        `),
        resolveRisk: _db.prepare(`
            UPDATE pedagogical_risk_history
            SET resolved_at = @ts
            WHERE user_id = @user_id AND risk_type = @risk_type
              AND resolved_at IS NULL
        `),
        listRiskByUser: _db.prepare(`
            SELECT * FROM pedagogical_risk_history
            WHERE user_id = ? ORDER BY detected_at DESC LIMIT ?
        `),
        countActiveRisks: _db.prepare(`
            SELECT COUNT(*) AS n FROM pedagogical_risk_history WHERE resolved_at IS NULL`),
        hasActiveRisk: _db.prepare(`
            SELECT 1 FROM pedagogical_risk_history
            WHERE user_id = ? AND risk_type = ? AND resolved_at IS NULL LIMIT 1
        `),
    };
    return _db;
}

export function getPedagogyStatements() { getPedagogyExtDb(); return _stmt; }
export function closePedagogyExtDb() {
    if (_db) { try { _db.close(); } catch {} _db = null; _stmt = null; }
}
export { DB_PATH };
