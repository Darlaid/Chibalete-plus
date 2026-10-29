-- 0001_ledger.sql — CHP-GAMIFICACION-G3-01.
--
-- Núcleo persistente del ledger de gamificación (docs/gamificacion/
-- GAMIFICACION_MODELO_DATOS_V1.md §2). Diez tablas `gm_`; ocho append-only por
-- trigger (mismo patrón que econ_events / rights_versions), `gm_pm_balances`
-- mutable solo dentro de la transacción del movimiento, y `gm_redemptions` con
-- transiciones vigiladas. Todo IF NOT EXISTS: la otra réplica puede aplicar la
-- misma versión a la vez (el runner reintenta y la ve aplicada).

-- UP

CREATE TABLE IF NOT EXISTS gm_rule_sets (
    rule_version   TEXT    PRIMARY KEY,
    created_at     INTEGER NOT NULL,
    created_by     TEXT    NOT NULL,
    rules_json     TEXT    NOT NULL,
    rules_sha256   TEXT    NOT NULL,
    effective_from INTEGER NOT NULL CHECK (effective_from >= created_at)
);

CREATE TABLE IF NOT EXISTS gm_source_facts (
    fact_id         TEXT    PRIMARY KEY,
    source          TEXT    NOT NULL CHECK (source IN ('mook_review','mook_experience','reading_completion','offline_validation','mission')),
    source_event_id TEXT    NOT NULL,
    fact_type       TEXT    NOT NULL,
    user_id         TEXT    NOT NULL,
    actor_id        TEXT,
    occurred_at     INTEGER NOT NULL,
    recorded_at     INTEGER NOT NULL,
    grade           TEXT    NOT NULL CHECK (grade IN ('A','B','C','D')),
    decision        TEXT    NOT NULL CHECK (decision IN (
                        'awarded','capped','observed','disabled_source',
                        'rejected_self_review','rejected_excluded_user','rejected_inactive_account',
                        'rejected_implausible','rejected_insufficient_data','rejected_not_eligible')),
    rule_version    TEXT    NOT NULL REFERENCES gm_rule_sets(rule_version),
    features_json   TEXT    NOT NULL DEFAULT '{}',
    UNIQUE (source, source_event_id, fact_type)
);
CREATE INDEX IF NOT EXISTS ix_gm_facts_user ON gm_source_facts(user_id, recorded_at);

CREATE TABLE IF NOT EXISTS gm_xp_entries (
    entry_id       TEXT    PRIMARY KEY,
    user_id        TEXT    NOT NULL,
    kind           TEXT    NOT NULL CHECK (kind IN ('award','void')),
    xp             INTEGER NOT NULL CHECK (xp >= 0),
    fact_id        TEXT    REFERENCES gm_source_facts(fact_id),
    voids_entry_id TEXT    REFERENCES gm_xp_entries(entry_id),
    rule_version   TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    CHECK ((kind = 'award' AND fact_id IS NOT NULL AND voids_entry_id IS NULL)
        OR (kind = 'void'  AND voids_entry_id IS NOT NULL AND xp = 0)),
    UNIQUE (fact_id, kind)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_xp_void ON gm_xp_entries(voids_entry_id) WHERE kind = 'void';
CREATE INDEX IF NOT EXISTS ix_gm_xp_user ON gm_xp_entries(user_id, created_at);

CREATE TABLE IF NOT EXISTS gm_achievements (
    row_id         TEXT    PRIMARY KEY,
    user_id        TEXT    NOT NULL,
    achievement_id TEXT    NOT NULL,
    kind           TEXT    NOT NULL CHECK (kind IN ('award','void')),
    fact_id        TEXT    REFERENCES gm_source_facts(fact_id),
    rule_version   TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    UNIQUE (user_id, achievement_id, kind)
);

CREATE TABLE IF NOT EXISTS gm_redemptions (
    redemption_id   TEXT    PRIMARY KEY,
    user_id         TEXT    NOT NULL,
    idempotency_key TEXT    NOT NULL,
    reward_id       TEXT    NOT NULL,
    reward_kind     TEXT    NOT NULL CHECK (reward_kind IN ('digital_asset','content_access','woo_coupon')),
    price_pm        INTEGER NOT NULL CHECK (price_pm > 0),
    rule_version    TEXT    NOT NULL,
    state           TEXT    NOT NULL CHECK (state IN ('RESERVED','DELIVERED','CONFIRMED','RELEASED')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS gm_pm_movements (
    seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
    movement_id         TEXT    NOT NULL UNIQUE,
    user_id             TEXT    NOT NULL,
    kind                TEXT    NOT NULL CHECK (kind IN ('earn','reserve','reserve_release','redeem_confirm','compensation','adjustment')),
    amount              INTEGER NOT NULL CHECK (amount <> 0 OR kind = 'redeem_confirm'),
    source              TEXT    NOT NULL,
    idempotency_key     TEXT    NOT NULL UNIQUE,
    fact_id             TEXT    REFERENCES gm_source_facts(fact_id),
    redemption_id       TEXT    REFERENCES gm_redemptions(redemption_id),
    related_movement_id TEXT    REFERENCES gm_pm_movements(movement_id),
    reason_code         TEXT    NOT NULL,
    actor_id            TEXT    NOT NULL,
    rule_version        TEXT    NOT NULL,
    period_day          TEXT    NOT NULL,
    period_week         TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    CHECK ((kind = 'earn'            AND amount > 0 AND fact_id IS NOT NULL)
        OR (kind = 'reserve'         AND amount < 0 AND redemption_id IS NOT NULL)
        OR (kind = 'reserve_release' AND amount > 0 AND redemption_id IS NOT NULL)
        OR (kind = 'redeem_confirm'  AND amount = 0 AND redemption_id IS NOT NULL)
        OR (kind = 'compensation'    AND related_movement_id IS NOT NULL)
        OR (kind = 'adjustment'      AND actor_id <> 'system'))
);
CREATE INDEX IF NOT EXISTS ix_gm_mov_user_seq ON gm_pm_movements(user_id, seq);
CREATE INDEX IF NOT EXISTS ix_gm_mov_caps     ON gm_pm_movements(user_id, kind, source, period_day, period_week);

CREATE TABLE IF NOT EXISTS gm_pm_balances (
    user_id         TEXT    PRIMARY KEY,
    available       INTEGER NOT NULL,
    reserved        INTEGER NOT NULL CHECK (reserved >= 0),
    lifetime_earned INTEGER NOT NULL CHECK (lifetime_earned >= 0),
    last_seq        INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gm_redemption_transitions (
    row_id        TEXT    PRIMARY KEY,
    redemption_id TEXT    NOT NULL REFERENCES gm_redemptions(redemption_id),
    from_state    TEXT,
    to_state      TEXT    NOT NULL,
    reason_code   TEXT    NOT NULL,
    actor_id      TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gm_reward_grants (
    grant_id      TEXT    PRIMARY KEY,
    redemption_id TEXT    NOT NULL UNIQUE REFERENCES gm_redemptions(redemption_id),
    user_id       TEXT    NOT NULL,
    reward_kind   TEXT    NOT NULL,
    external_ref  TEXT,
    expires_at    INTEGER,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gm_admin_audit (
    row_id      TEXT    PRIMARY KEY,
    actor_id    TEXT    NOT NULL,
    action      TEXT    NOT NULL,
    target_user TEXT,
    ref         TEXT,
    created_at  INTEGER NOT NULL
);

-- Append-only: ocho tablas.
CREATE TRIGGER IF NOT EXISTS gm_rule_sets_no_update BEFORE UPDATE ON gm_rule_sets
    BEGIN SELECT RAISE(ABORT, 'gm_rule_sets is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_rule_sets_no_delete BEFORE DELETE ON gm_rule_sets
    BEGIN SELECT RAISE(ABORT, 'gm_rule_sets is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_source_facts_no_update BEFORE UPDATE ON gm_source_facts
    BEGIN SELECT RAISE(ABORT, 'gm_source_facts is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_source_facts_no_delete BEFORE DELETE ON gm_source_facts
    BEGIN SELECT RAISE(ABORT, 'gm_source_facts is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_xp_entries_no_update BEFORE UPDATE ON gm_xp_entries
    BEGIN SELECT RAISE(ABORT, 'gm_xp_entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_xp_entries_no_delete BEFORE DELETE ON gm_xp_entries
    BEGIN SELECT RAISE(ABORT, 'gm_xp_entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_achievements_no_update BEFORE UPDATE ON gm_achievements
    BEGIN SELECT RAISE(ABORT, 'gm_achievements is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_achievements_no_delete BEFORE DELETE ON gm_achievements
    BEGIN SELECT RAISE(ABORT, 'gm_achievements is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_pm_movements_no_update BEFORE UPDATE ON gm_pm_movements
    BEGIN SELECT RAISE(ABORT, 'gm_pm_movements is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_pm_movements_no_delete BEFORE DELETE ON gm_pm_movements
    BEGIN SELECT RAISE(ABORT, 'gm_pm_movements is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_redemption_transitions_no_update BEFORE UPDATE ON gm_redemption_transitions
    BEGIN SELECT RAISE(ABORT, 'gm_redemption_transitions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_redemption_transitions_no_delete BEFORE DELETE ON gm_redemption_transitions
    BEGIN SELECT RAISE(ABORT, 'gm_redemption_transitions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_reward_grants_no_update BEFORE UPDATE ON gm_reward_grants
    BEGIN SELECT RAISE(ABORT, 'gm_reward_grants is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_reward_grants_no_delete BEFORE DELETE ON gm_reward_grants
    BEGIN SELECT RAISE(ABORT, 'gm_reward_grants is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_admin_audit_no_update BEFORE UPDATE ON gm_admin_audit
    BEGIN SELECT RAISE(ABORT, 'gm_admin_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gm_admin_audit_no_delete BEFORE DELETE ON gm_admin_audit
    BEGIN SELECT RAISE(ABORT, 'gm_admin_audit is append-only'); END;

-- El snapshot se corrige con UPDATE (reconstrucción), nunca se borra.
CREATE TRIGGER IF NOT EXISTS gm_pm_balances_no_delete BEFORE DELETE ON gm_pm_balances
    BEGIN SELECT RAISE(ABORT, 'gm_pm_balances rows are never deleted'); END;

-- Canjes: solo transiciones legales; estados finales y campos de identidad inmutables.
CREATE TRIGGER IF NOT EXISTS gm_redemptions_transition BEFORE UPDATE ON gm_redemptions
    WHEN NOT (
        (OLD.state = 'RESERVED'  AND NEW.state IN ('DELIVERED','RELEASED'))
     OR (OLD.state = 'DELIVERED' AND NEW.state IN ('CONFIRMED','RELEASED'))
    )
    OR NEW.redemption_id   IS NOT OLD.redemption_id
    OR NEW.user_id         IS NOT OLD.user_id
    OR NEW.idempotency_key IS NOT OLD.idempotency_key
    OR NEW.reward_id       IS NOT OLD.reward_id
    OR NEW.reward_kind     IS NOT OLD.reward_kind
    OR NEW.price_pm        IS NOT OLD.price_pm
    OR NEW.rule_version    IS NOT OLD.rule_version
    OR NEW.created_at      IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT, 'gm_redemptions illegal transition'); END;
CREATE TRIGGER IF NOT EXISTS gm_redemptions_no_delete BEFORE DELETE ON gm_redemptions
    BEGIN SELECT RAISE(ABORT, 'gm_redemptions rows are never deleted'); END;

-- DOWN

DROP TABLE IF EXISTS gm_admin_audit;
DROP TABLE IF EXISTS gm_reward_grants;
DROP TABLE IF EXISTS gm_redemption_transitions;
DROP TABLE IF EXISTS gm_pm_balances;
DROP TABLE IF EXISTS gm_pm_movements;
DROP TABLE IF EXISTS gm_redemptions;
DROP TABLE IF EXISTS gm_achievements;
DROP TABLE IF EXISTS gm_xp_entries;
DROP TABLE IF EXISTS gm_source_facts;
DROP TABLE IF EXISTS gm_rule_sets;
