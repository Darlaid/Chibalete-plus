-- 0001_identity — P1-A esquema base users/groups/memberships/access.
-- Reversible (sección DOWN). raw_json = copia LOSSLESS del registro JSON
-- original → red de seguridad: siempre se puede reconstruir el JSON exacto
-- aunque falte mapear un campo nuevo. Soft-delete vía deleted_at.

-- UP

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,            -- JSON: ids string
  email_norm      TEXT NOT NULL,               -- email normalizado (lower/trim)
  email_raw       TEXT,
  password        TEXT,
  nombre_completo TEXT,
  nombre_usuario  TEXT,
  roles_json      TEXT,                        -- array serializado
  colegio         TEXT,
  nivel_lectura   TEXT,
  account_status  TEXT,
  last_login_at   TEXT,
  raw_json        TEXT NOT NULL,               -- registro JSON íntegro (lossless)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_norm
  ON users(email_norm) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS groups (
  group_key   TEXT PRIMARY KEY,                -- sintético estable: school::grade::name
  name        TEXT NOT NULL,
  school      TEXT,
  grade       TEXT,
  teacher_id  TEXT,
  raw_json    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

-- Memberships NORMALIZADAS (hoy embebidas en groups.studentIds/teacherId).
CREATE TABLE IF NOT EXISTS group_members (
  group_key  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('student','teacher')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_key, user_id, role),
  FOREIGN KEY (group_key) REFERENCES groups(group_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_gm_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS access_rules (
  id              TEXT PRIMARY KEY,
  scope           TEXT,
  scope_id        TEXT,
  title_ids_json  TEXT,
  collection_ids_json TEXT,
  expires_at      TEXT,
  raw_json        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS ix_access_scope ON access_rules(scope, scope_id);

-- Auditoría de consistencia shadow (dual-write) — detecta drift JSON↔SQLite.
CREATE TABLE IF NOT EXISTS shadow_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT NOT NULL,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  json_count  INTEGER,
  sqlite_count INTEGER,
  ok          INTEGER NOT NULL,
  detail      TEXT
);

-- DOWN
DROP TABLE IF EXISTS shadow_audit;
DROP TABLE IF EXISTS access_rules;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS users;
