-- 0003_work_cycle_acts.sql — CHP-GAMIFICACION-G4-05A-2.
--
-- Una evidencia aprobada produce dos actos sobre la misma obra (`reading` y
-- `reflection`). La clave de 0002, (fact_id, work_key), solo admite uno.
-- Contrato: docs/gamificacion/GAMIFICACION_G4_05A_2_ACTOS_Y_ELEGIBILIDAD.md.
--
-- Solo se aplica con `gm_work_cycles` vacía: con cualquier fila aborta y la
-- transacción de runMigrations no cambia nada. `CHECK` cierra `act`. Se conservan
-- las unicidades por sujeto, obra y ciclo, y la tabla sigue siendo append-only.

-- UP

CREATE TEMP TABLE _gm_0003_gate (x);
CREATE TEMP TRIGGER _gm_0003_gate_check BEFORE INSERT ON _gm_0003_gate
    WHEN EXISTS (SELECT 1 FROM main.gm_work_cycles)
    BEGIN SELECT RAISE(ABORT, '0003_REQUIRES_EMPTY_WORK_CYCLES'); END;
INSERT INTO _gm_0003_gate VALUES (1);
DROP TRIGGER _gm_0003_gate_check;
DROP TABLE _gm_0003_gate;

DROP TABLE gm_work_cycles;
CREATE TABLE gm_work_cycles (
    fact_id     TEXT NOT NULL REFERENCES gm_source_facts(fact_id),
    subject_ref TEXT NOT NULL,
    work_key    TEXT NOT NULL,
    cycle       INTEGER NOT NULL CHECK (cycle >= 1),
    act         TEXT NOT NULL CHECK (act IN ('reading','reflection')),
    xp          INTEGER NOT NULL CHECK (xp >= 0),
    pm          INTEGER NOT NULL CHECK (pm >= 0),
    PRIMARY KEY (fact_id, work_key, act)
);
CREATE UNIQUE INDEX ux_gm_cycle_reading ON gm_work_cycles(subject_ref, work_key, cycle) WHERE act = 'reading';
CREATE UNIQUE INDEX ux_gm_cycle_pm      ON gm_work_cycles(subject_ref, work_key, cycle) WHERE pm > 0;
CREATE TRIGGER gm_work_cycles_no_update BEFORE UPDATE ON gm_work_cycles
    BEGIN SELECT RAISE(ABORT, 'gm_work_cycles is append-only'); END;
CREATE TRIGGER gm_work_cycles_no_delete BEFORE DELETE ON gm_work_cycles
    BEGIN SELECT RAISE(ABORT, 'gm_work_cycles is append-only'); END;

-- DOWN

DROP TABLE IF EXISTS gm_work_cycles;
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
