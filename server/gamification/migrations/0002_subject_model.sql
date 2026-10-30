-- 0002_subject_model.sql — CHP-GAMIFICACION-PRIV-01B.
--
-- Modelo de sujeto (docs/gamificacion/GAMIFICACION_PRIV_01_MODELO_V1.md §2 y
-- GAMIFICACION_PRIV_01_IMPLEMENTACION_V1.md §1). El ledger deja de guardar
-- identidad canónica: `gm_subjects` es la ÚNICA tabla con `user_id`, mutable y
-- borrable; el resto solo guarda una referencia aleatoria.
--
-- Solo se aplica sobre un ledger vacío: no hay conversión de datos personales.
-- Con cualquier fila en una tabla `gm_` aborta y la transacción no cambia nada.
-- `RENAME COLUMN` conserva triggers, índices, CHECK y claves foráneas.
-- `gm_erasures` y `gm_work_cycles` quedan creadas e inertes (PRIV-01D y G4-05).

-- UP

CREATE TEMP TABLE _gm_0002_gate (x);
CREATE TEMP TRIGGER _gm_0002_gate_check BEFORE INSERT ON _gm_0002_gate
    WHEN EXISTS (SELECT 1 FROM main.gm_rule_sets) OR EXISTS (SELECT 1 FROM main.gm_source_facts)
      OR EXISTS (SELECT 1 FROM main.gm_xp_entries) OR EXISTS (SELECT 1 FROM main.gm_achievements)
      OR EXISTS (SELECT 1 FROM main.gm_redemptions) OR EXISTS (SELECT 1 FROM main.gm_pm_movements)
      OR EXISTS (SELECT 1 FROM main.gm_pm_balances) OR EXISTS (SELECT 1 FROM main.gm_redemption_transitions)
      OR EXISTS (SELECT 1 FROM main.gm_reward_grants) OR EXISTS (SELECT 1 FROM main.gm_admin_audit)
    BEGIN SELECT RAISE(ABORT, '0002_REQUIRES_EMPTY_LEDGER'); END;
INSERT INTO _gm_0002_gate VALUES (1);
DROP TRIGGER _gm_0002_gate_check;
DROP TABLE _gm_0002_gate;

ALTER TABLE gm_source_facts RENAME COLUMN user_id TO subject_ref;
ALTER TABLE gm_source_facts RENAME COLUMN actor_id TO actor_ref;
ALTER TABLE gm_xp_entries RENAME COLUMN user_id TO subject_ref;
ALTER TABLE gm_achievements RENAME COLUMN user_id TO subject_ref;
ALTER TABLE gm_redemptions RENAME COLUMN user_id TO subject_ref;
ALTER TABLE gm_pm_movements RENAME COLUMN user_id TO subject_ref;
ALTER TABLE gm_pm_movements RENAME COLUMN actor_id TO actor_ref;
ALTER TABLE gm_pm_balances RENAME COLUMN user_id TO subject_ref;
ALTER TABLE gm_reward_grants RENAME COLUMN user_id TO subject_ref;
ALTER TABLE gm_redemption_transitions RENAME COLUMN actor_id TO actor_ref;
ALTER TABLE gm_admin_audit RENAME COLUMN actor_id TO actor_ref;
ALTER TABLE gm_admin_audit RENAME COLUMN target_user TO target_ref;

-- Sin triggers: es la tabla que una supresión debe poder borrar.
CREATE TABLE gm_subjects (
    subject_ref  TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL UNIQUE,
    subject_salt BLOB NOT NULL CHECK (length(subject_salt) = 32),
    role_class   TEXT NOT NULL CHECK (role_class IN ('reader','actor')),
    created_on   TEXT NOT NULL
);

CREATE TABLE gm_erasures (
    erasure_id  TEXT PRIMARY KEY,
    tombstone   TEXT NOT NULL UNIQUE,
    erased_on   TEXT NOT NULL,
    request_ref TEXT
);

CREATE TABLE gm_work_cycles (
    fact_id     TEXT NOT NULL REFERENCES gm_source_facts(fact_id),
    subject_ref TEXT NOT NULL,
    work_key    TEXT NOT NULL,
    cycle       INTEGER NOT NULL CHECK (cycle >= 1),
    act         TEXT NOT NULL CHECK (act IN ('reading','reflection')),
    xp          INTEGER NOT NULL CHECK (xp >= 0),
    pm          INTEGER NOT NULL CHECK (pm >= 0),
    PRIMARY KEY (fact_id, work_key)
);
CREATE UNIQUE INDEX ux_gm_cycle_reading ON gm_work_cycles(subject_ref, work_key, cycle) WHERE act = 'reading';
CREATE UNIQUE INDEX ux_gm_cycle_pm      ON gm_work_cycles(subject_ref, work_key, cycle) WHERE pm > 0;
CREATE TRIGGER gm_work_cycles_no_update BEFORE UPDATE ON gm_work_cycles
    BEGIN SELECT RAISE(ABORT, 'gm_work_cycles is append-only'); END;
CREATE TRIGGER gm_work_cycles_no_delete BEFORE DELETE ON gm_work_cycles
    BEGIN SELECT RAISE(ABORT, 'gm_work_cycles is append-only'); END;

-- DOWN

DROP TABLE IF EXISTS gm_work_cycles;
DROP TABLE IF EXISTS gm_erasures;
DROP TABLE IF EXISTS gm_subjects;
ALTER TABLE gm_admin_audit RENAME COLUMN target_ref TO target_user;
ALTER TABLE gm_admin_audit RENAME COLUMN actor_ref TO actor_id;
ALTER TABLE gm_redemption_transitions RENAME COLUMN actor_ref TO actor_id;
ALTER TABLE gm_reward_grants RENAME COLUMN subject_ref TO user_id;
ALTER TABLE gm_pm_balances RENAME COLUMN subject_ref TO user_id;
ALTER TABLE gm_pm_movements RENAME COLUMN actor_ref TO actor_id;
ALTER TABLE gm_pm_movements RENAME COLUMN subject_ref TO user_id;
ALTER TABLE gm_redemptions RENAME COLUMN subject_ref TO user_id;
ALTER TABLE gm_achievements RENAME COLUMN subject_ref TO user_id;
ALTER TABLE gm_xp_entries RENAME COLUMN subject_ref TO user_id;
ALTER TABLE gm_source_facts RENAME COLUMN actor_ref TO actor_id;
ALTER TABLE gm_source_facts RENAME COLUMN subject_ref TO user_id;
