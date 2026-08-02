-- 0002_identity_v2 — CHP-IDDB-02A. Modelo canónico de identidad aprobado en
-- CHP-IDDB-01A..01D. NO reemplaza a 0001_identity: 0001 se conserva intacta y
-- sigue siendo el primer eslabón del historial. Esta migración lleva el
-- esquema de la forma legacy (users por id JSON, groups con PK
-- school::grade::name, group_members student/teacher) al modelo por
-- institución → grupo → membresía con rol.
--
-- PRECONDICIÓN FAIL-CLOSED: las tres tablas de dominio de v1 deben estar
-- VACÍAS. Una instalación v1 con filas no tiene plan seguro de conversión
-- —sus usuarios provienen del padrón legacy superseded, que 01D excluyó de la
-- importación— y por tanto la migración aborta la transacción en vez de
-- inventar una equivalencia. `access_rules` y `shadow_audit` SÍ se conservan
-- con sus filas: son dominios que v2 no redefine.
--
-- Toda la migración corre dentro de una transacción del runner (migrate.js) y
-- con PRAGMA foreign_keys=ON.

-- UP

-- ── Precondición: v1 vacía ────────────────────────────────────────────────
-- Si alguna tabla de dominio v1 tiene filas, el CHECK falla, la transacción
-- se revierte entera y no se destruye absolutamente nada.
CREATE TABLE _v2_requires_empty_v1_domain_tables (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO _v2_requires_empty_v1_domain_tables(ok)
SELECT CASE WHEN (SELECT COUNT(*) FROM users) = 0
             AND (SELECT COUNT(*) FROM groups) = 0
             AND (SELECT COUNT(*) FROM group_members) = 0
       THEN 1 ELSE 0 END;

-- ── Retirada de las tablas de dominio v1 (verificadas vacías) ─────────────
DROP INDEX IF EXISTS ix_gm_user;
DROP TABLE group_members;
DROP INDEX IF EXISTS ux_users_email_norm;
DROP TABLE groups;
DROP TABLE users;

-- ── migration_runs: trazabilidad de cada importación ──────────────────────
CREATE TABLE migration_runs (
  run_id               TEXT PRIMARY KEY,
  schema_version       TEXT NOT NULL,
  source_hashes_json   TEXT NOT NULL,
  plan_hash            TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  counts_json          TEXT,
  error_classification TEXT,
  started_at           TEXT NOT NULL,
  completed_at         TEXT
);

-- ── institutions ──────────────────────────────────────────────────────────
-- Una institución válida PUEDE existir con cero grupos (corrección de
-- contrato de 01C-R1: Externado está registrada y no es direccionable).
CREATE TABLE institutions (
  institution_id TEXT PRIMARY KEY,
  official_name  TEXT NOT NULL,
  name_norm      TEXT NOT NULL,
  addressable    INTEGER NOT NULL CHECK (addressable IN (0,1)),
  status         TEXT NOT NULL CHECK (status IN ('active','retired')),
  provenance     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_institutions_name_norm ON institutions(name_norm);

-- ── users ─────────────────────────────────────────────────────────────────
-- canonical_id es la identidad; email_norm es único entre las vivas.
-- SIN columna de credencial: la candidate no autentica a nadie y no custodia
-- hashes de contraseña. raw_json se guarda saneado (sin credencial) para
-- conservar el contrato de lectura lossless del resto del backend.
CREATE TABLE users (
  canonical_id         TEXT PRIMARY KEY,
  legacy_identity_hash TEXT NOT NULL,
  email_norm           TEXT NOT NULL,
  email_raw            TEXT,
  nombre_completo      TEXT,
  nombre_usuario       TEXT,
  roles_json           TEXT,
  global_role          TEXT NOT NULL CHECK (global_role IN ('administrador','mediador','lector')),
  status               TEXT NOT NULL CHECK (status IN ('active','inactive','suspended')),
  credential_excluded  INTEGER NOT NULL DEFAULT 1 CHECK (credential_excluded = 1),
  provenance           TEXT NOT NULL,
  source_version       TEXT NOT NULL,
  raw_json             TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT
);
CREATE UNIQUE INDEX ux_users_email_norm ON users(email_norm) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_users_legacy_hash ON users(legacy_identity_hash);

-- ── groups ────────────────────────────────────────────────────────────────
-- group_id es la clave real. legacy_school se conserva SOLO como procedencia
-- textual y nunca como join key.
CREATE TABLE groups (
  group_id       TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(institution_id),
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('course','club')),
  status         TEXT NOT NULL CHECK (status IN ('active','retired')),
  grade_level    TEXT,
  section        TEXT,
  legacy_school  TEXT,
  provenance     TEXT NOT NULL,
  raw_json       TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX ix_groups_institution ON groups(institution_id);
-- Permite la clave foránea compuesta de memberships: la institución de una
-- membresía no puede contradecir la de su grupo.
CREATE UNIQUE INDEX ux_groups_id_institution ON groups(group_id, institution_id);

-- ── memberships ───────────────────────────────────────────────────────────
-- Unicidad por (group_id, user_id, role): una misma persona puede ser
-- miembro Y mediadora del mismo grupo, y son dos membresías distintas.
CREATE TABLE memberships (
  membership_id  TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(canonical_id),
  group_id       TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('member','mediator')),
  status         TEXT NOT NULL CHECK (status IN ('active','inactive')),
  provenance     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (group_id, user_id, role),
  FOREIGN KEY (group_id, institution_id) REFERENCES groups(group_id, institution_id)
);
CREATE INDEX ix_memberships_user ON memberships(user_id);
CREATE INDEX ix_memberships_group ON memberships(group_id);

-- ── identity_tombstones ───────────────────────────────────────────────────
-- Un tombstone conserva un vínculo histórico. NO es un usuario: no tiene
-- columna de credencial ni de rol, no puede recibir membresía y
-- authentication_allowed está fijado por CHECK, no por defecto.
CREATE TABLE identity_tombstones (
  tombstone_id           TEXT PRIMARY KEY,
  legacy_identity_hash   TEXT NOT NULL UNIQUE,
  classification         TEXT NOT NULL,
  source                 TEXT NOT NULL,
  first_seen_at          TEXT,
  last_seen_at           TEXT,
  reference_count        INTEGER NOT NULL DEFAULT 0,
  authentication_allowed INTEGER NOT NULL DEFAULT 0 CHECK (authentication_allowed = 0),
  migration_run_id       TEXT REFERENCES migration_runs(run_id),
  provenance             TEXT NOT NULL,
  reviewed_at            TEXT,
  policy_version         TEXT NOT NULL,
  created_at             TEXT NOT NULL
);

-- Un tombstone no puede colisionar con una identidad canónica viva.
CREATE TRIGGER trg_tombstone_no_identity_collision
BEFORE INSERT ON identity_tombstones
BEGIN
  SELECT RAISE(ABORT, 'tombstone_collides_with_canonical_identity')
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.legacy_identity_hash = NEW.legacy_identity_hash)
     OR EXISTS (SELECT 1 FROM users u WHERE u.canonical_id = NEW.tombstone_id);
END;

-- Ninguna membresía puede apuntar a un tombstone.
CREATE TRIGGER trg_membership_never_to_tombstone
BEFORE INSERT ON memberships
BEGIN
  SELECT RAISE(ABORT, 'membership_to_tombstone_forbidden')
  WHERE EXISTS (SELECT 1 FROM identity_tombstones t WHERE t.tombstone_id = NEW.user_id);
END;

-- Ninguna identidad canónica puede nacer sobre un tombstone existente.
CREATE TRIGGER trg_identity_no_tombstone_collision
BEFORE INSERT ON users
BEGIN
  SELECT RAISE(ABORT, 'canonical_identity_collides_with_tombstone')
  WHERE EXISTS (SELECT 1 FROM identity_tombstones t
                WHERE t.legacy_identity_hash = NEW.legacy_identity_hash
                   OR t.tombstone_id = NEW.canonical_id);
END;

-- ── identity_aliases ──────────────────────────────────────────────────────
-- Un alias resuelve a una identidad O a un tombstone, exactamente a uno.
CREATE TABLE identity_aliases (
  alias_id       TEXT PRIMARY KEY,
  legacy_alias   TEXT NOT NULL,
  user_id        TEXT REFERENCES users(canonical_id),
  tombstone_id   TEXT REFERENCES identity_tombstones(tombstone_id),
  status         TEXT NOT NULL CHECK (status IN ('active','revoked')),
  provenance     TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  CHECK ((user_id IS NOT NULL AND tombstone_id IS NULL)
      OR (user_id IS NULL AND tombstone_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_identity_alias_active
  ON identity_aliases(legacy_alias) WHERE status = 'active';

-- ── institution_aliases ───────────────────────────────────────────────────
-- Arranca únicamente con los cuatro nombres oficiales confirmados en 01C-R1.
CREATE TABLE institution_aliases (
  alias_id         TEXT PRIMARY KEY,
  alias_original   TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  institution_id   TEXT NOT NULL REFERENCES institutions(institution_id),
  status           TEXT NOT NULL CHECK (status IN ('active','revoked')),
  provenance       TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_institution_alias_active
  ON institution_aliases(alias_normalized) WHERE status = 'active';

-- ── migration_exclusions ──────────────────────────────────────────────────
-- Cada entidad NO importada queda registrada con su disposición y un hash de
-- referencia. Sin PII: nunca el identificador crudo.
CREATE TABLE migration_exclusions (
  exclusion_id   TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES migration_runs(run_id),
  entity         TEXT NOT NULL CHECK (entity IN ('user','group','membership','identity_reference')),
  disposition    TEXT NOT NULL,
  reference_hash TEXT NOT NULL,
  provenance     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_exclusions_disposition ON migration_exclusions(entity, disposition);
CREATE INDEX ix_exclusions_run ON migration_exclusions(run_id);

DROP TABLE _v2_requires_empty_v1_domain_tables;

PRAGMA user_version = 2;

-- DOWN
DROP TRIGGER IF EXISTS trg_identity_no_tombstone_collision;
DROP TRIGGER IF EXISTS trg_membership_never_to_tombstone;
DROP TRIGGER IF EXISTS trg_tombstone_no_identity_collision;
DROP TABLE IF EXISTS migration_exclusions;
DROP TABLE IF EXISTS institution_aliases;
DROP TABLE IF EXISTS identity_aliases;
DROP TABLE IF EXISTS identity_tombstones;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS institutions;
DROP TABLE IF EXISTS migration_runs;
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email_norm      TEXT NOT NULL,
  email_raw       TEXT,
  password        TEXT,
  nombre_completo TEXT,
  nombre_usuario  TEXT,
  roles_json      TEXT,
  colegio         TEXT,
  nivel_lectura   TEXT,
  account_status  TEXT,
  last_login_at   TEXT,
  raw_json        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_norm
  ON users(email_norm) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS groups (
  group_key   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  school      TEXT,
  grade       TEXT,
  teacher_id  TEXT,
  raw_json    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE TABLE IF NOT EXISTS group_members (
  group_key  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('student','teacher')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_key, user_id, role),
  FOREIGN KEY (group_key) REFERENCES groups(group_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_gm_user ON group_members(user_id);
PRAGMA user_version = 1;
