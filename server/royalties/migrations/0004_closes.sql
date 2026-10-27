-- CHP-EDITORIAL-ROYALTIES-2026-01 V1.4 U4 · F4-B-01 — cierres y movimientos.
-- Las cuatro tablas restantes del Plan V1.1 §3.1, en la misma royalties.db:
--   rule_sets      parámetros económicos versionados (JSON canónico + sha256)
--   period_inputs  INS manual por periodo con su soporte (P11)
--   closes         snapshot inmutable del mes con hash; UNIQUE(period)
--   adjustments    todo movimiento posterior; referencia el cierre, nunca lo cambia
-- Todas solo admiten inserciones (triggers). Idempotente: IF NOT EXISTS.

-- UP
CREATE TABLE IF NOT EXISTS rule_sets (
    id            TEXT PRIMARY KEY,
    params        TEXT NOT NULL,
    params_sha256 TEXT NOT NULL CHECK (length(params_sha256) = 64),
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS period_inputs (
    id             TEXT PRIMARY KEY,
    period         TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    gross_cop      INTEGER NOT NULL CHECK (gross_cop >= 0),
    deductions_cop INTEGER NOT NULL CHECK (deductions_cop >= 0),
    ins_cop        INTEGER NOT NULL CHECK (ins_cop >= 0 AND ins_cop = gross_cop - deductions_cop),
    support_ref    TEXT NOT NULL CHECK (length(trim(support_ref)) > 0),
    notes          TEXT,
    created_by     TEXT NOT NULL,
    created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_period_inputs_period ON period_inputs (period, created_at);

CREATE TABLE IF NOT EXISTS closes (
    id                TEXT PRIMARY KEY,
    period            TEXT NOT NULL UNIQUE CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    mode              TEXT NOT NULL CHECK (mode IN ('technical', 'official')),
    rule_set_id       TEXT NOT NULL REFERENCES rule_sets (id),
    period_input_id   TEXT NOT NULL REFERENCES period_inputs (id),
    preview_digest    TEXT NOT NULL,
    settlement_digest TEXT NOT NULL,
    snapshot          TEXT NOT NULL,
    snapshot_sha256   TEXT NOT NULL CHECK (length(snapshot_sha256) = 64),
    authorization_ref TEXT,
    created_by        TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    CHECK (mode = 'technical' OR length(trim(coalesce(authorization_ref, ''))) > 0)
);

CREATE TABLE IF NOT EXISTS adjustments (
    id            TEXT PRIMARY KEY,
    close_id      TEXT NOT NULL REFERENCES closes (id),
    kind          TEXT NOT NULL CHECK (kind IN ('adjustment', 'payment_recorded', 'retention', 'release', 'balance_transfer')),
    source        TEXT NOT NULL DEFAULT 'none' CHECK (source IN ('none', 'holder_retained', 'unattributed_retained',
                      'pending_version_split', 'pending_alpha_complement', 'pending_bgp_without_holders')),
    publisher_id  TEXT NOT NULL,
    amount_cop    INTEGER NOT NULL CHECK (amount_cop <> 0),
    target_period TEXT CHECK (target_period IS NULL OR target_period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    reason        TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    ref           TEXT,
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    CHECK (kind = 'adjustment' OR amount_cop > 0),
    CHECK ((kind = 'balance_transfer') = (target_period IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_adjustments_close ON adjustments (close_id, created_at);
CREATE INDEX IF NOT EXISTS idx_adjustments_target ON adjustments (target_period);

CREATE TRIGGER IF NOT EXISTS rule_sets_no_update BEFORE UPDATE ON rule_sets
BEGIN SELECT RAISE(ABORT, 'rule_sets is append-only'); END;
CREATE TRIGGER IF NOT EXISTS rule_sets_no_delete BEFORE DELETE ON rule_sets
BEGIN SELECT RAISE(ABORT, 'rule_sets is append-only'); END;
CREATE TRIGGER IF NOT EXISTS period_inputs_no_update BEFORE UPDATE ON period_inputs
BEGIN SELECT RAISE(ABORT, 'period_inputs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS period_inputs_no_delete BEFORE DELETE ON period_inputs
BEGIN SELECT RAISE(ABORT, 'period_inputs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS closes_no_update BEFORE UPDATE ON closes
BEGIN SELECT RAISE(ABORT, 'closes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS closes_no_delete BEFORE DELETE ON closes
BEGIN SELECT RAISE(ABORT, 'closes is append-only'); END;
CREATE TRIGGER IF NOT EXISTS adjustments_no_update BEFORE UPDATE ON adjustments
BEGIN SELECT RAISE(ABORT, 'adjustments is append-only'); END;
CREATE TRIGGER IF NOT EXISTS adjustments_no_delete BEFORE DELETE ON adjustments
BEGIN SELECT RAISE(ABORT, 'adjustments is append-only'); END;

-- DOWN
DROP TRIGGER IF EXISTS adjustments_no_delete;
DROP TRIGGER IF EXISTS adjustments_no_update;
DROP TRIGGER IF EXISTS closes_no_delete;
DROP TRIGGER IF EXISTS closes_no_update;
DROP TRIGGER IF EXISTS period_inputs_no_delete;
DROP TRIGGER IF EXISTS period_inputs_no_update;
DROP TRIGGER IF EXISTS rule_sets_no_delete;
DROP TRIGGER IF EXISTS rule_sets_no_update;
DROP INDEX IF EXISTS idx_adjustments_target;
DROP INDEX IF EXISTS idx_adjustments_close;
DROP TABLE IF EXISTS adjustments;
DROP TABLE IF EXISTS closes;
DROP INDEX IF EXISTS idx_period_inputs_period;
DROP TABLE IF EXISTS period_inputs;
DROP TABLE IF EXISTS rule_sets;
