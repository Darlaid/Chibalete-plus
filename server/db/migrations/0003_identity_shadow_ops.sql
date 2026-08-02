-- 0003_identity_shadow_ops — CHP-IDDB-02B-A. Contabilidad por operación del
-- espejo v2. `shadow_audit` (0001) se conserva intacta y sigue siendo el gate
-- de consistencia por dominio; esta migración añade el detalle por operación,
-- que es lo que permite idempotencia, detección de obsolescencia y
-- reconciliación dirigida.
--
-- SIN PII: solo hashes de clave canónica, clasificaciones y contadores. Nunca
-- correos, nombres, payloads ni identificadores crudos.

-- UP

CREATE TABLE shadow_operations (
  operation_id             TEXT PRIMARY KEY,
  entity_type              TEXT NOT NULL CHECK (entity_type IN
                             ('user','institution','group','membership')),
  operation_type           TEXT NOT NULL CHECK (operation_type IN ('upsert','deactivate')),
  canonical_key_hash       TEXT NOT NULL,
  canonical_source_version TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
                             ('PENDING','APPLIED','NOOP_ALREADY_APPLIED','FAILED_RECONCILABLE')),
  attempt_count            INTEGER NOT NULL DEFAULT 0,
  applied_at               TEXT,
  error_classification     TEXT,
  writer_id                TEXT NOT NULL,
  created_at               TEXT NOT NULL
);
CREATE INDEX ix_shadow_ops_status ON shadow_operations(status);
CREATE INDEX ix_shadow_ops_entity ON shadow_operations(entity_type, canonical_key_hash);

-- Estado por dominio: permite rechazar una instantánea obsoleta sin comparar
-- contenido, y sostiene la telemetría operacional agregada.
CREATE TABLE shadow_state (
  domain              TEXT PRIMARY KEY CHECK (domain IN ('users','groups','access','institutions')),
  last_source_version TEXT NOT NULL,
  last_source_seq     REAL NOT NULL,
  last_applied_at     TEXT NOT NULL,
  attempted_count     INTEGER NOT NULL DEFAULT 0,
  applied_count       INTEGER NOT NULL DEFAULT 0,
  noop_count          INTEGER NOT NULL DEFAULT 0,
  failed_count        INTEGER NOT NULL DEFAULT 0,
  last_failure_class  TEXT
);

-- Auditoría de cada ejecución del reconciliador. Sin PII.
CREATE TABLE reconciliation_runs (
  reconciliation_id TEXT PRIMARY KEY,
  mode              TEXT NOT NULL CHECK (mode IN ('check','plan','apply')),
  source_version    TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('completed','failed')),
  counts_json       TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  completed_at      TEXT
);

-- `user_version` NO cambia: 0003 es ADITIVA dentro de la familia v2. El modelo
-- de identidad sigue siendo el mismo; esto solo añade contabilidad del espejo.
-- Así la candidate congelada de 02A (v2, sin estas tablas) y una base nueva
-- (v2, con ellas) declaran la misma versión de modelo, y el adaptador
-- comprueba la presencia de las tablas por separado, fallando cerrado si faltan.

-- DOWN
DROP TABLE IF EXISTS reconciliation_runs;
DROP TABLE IF EXISTS shadow_state;
DROP INDEX IF EXISTS ix_shadow_ops_entity;
DROP INDEX IF EXISTS ix_shadow_ops_status;
DROP TABLE IF EXISTS shadow_operations;
