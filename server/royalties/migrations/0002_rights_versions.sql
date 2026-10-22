-- CHP-EDITORIAL-ROYALTIES-2026-01 F2-A — derechos versionados por obra.
-- Solo inserciones: una versión nueva sustituye a la anterior desde su
-- effective_at; el historial nunca se reescribe (triggers abajo).
-- publisher_id = editorial responsable al registrar; quién cobra lo define
-- `shares` (matriz de titulares en puntos básicos, 10000 = 100 %).
-- Permisos sin valor por defecto: cada versión los declara todos.
-- Idempotente: IF NOT EXISTS (dos réplicas pueden abrir la base a la vez).

-- UP
CREATE TABLE IF NOT EXISTS rights_versions (
    id                        TEXT PRIMARY KEY,
    content_id                TEXT NOT NULL,
    version_no                INTEGER NOT NULL CHECK (version_no >= 1),
    publisher_id              TEXT NOT NULL REFERENCES publishers(id),
    act_ref                   TEXT NOT NULL CHECK (length(trim(act_ref)) > 0),
    act_signed_on             TEXT NOT NULL,
    valid_from                TEXT NOT NULL,
    valid_until               TEXT,
    effective_at              TEXT NOT NULL,
    legal_status              TEXT NOT NULL CHECK (legal_status IN ('active', 'suspended', 'revoked', 'disputed')),
    economic_status           TEXT NOT NULL CHECK (economic_status IN ('pending', 'active', 'retained')),
    settlement_class          TEXT NOT NULL CHECK (settlement_class IN ('liquidable', 'auxiliary', 'excluded')),
    alpha                     REAL CHECK (alpha IS NULL OR (alpha > 0 AND alpha <= 1)),
    expected_minutes          REAL CHECK (expected_minutes IS NULL OR expected_minutes > 0),
    shares                    TEXT NOT NULL DEFAULT '[]',
    perm_subscription_reading INTEGER NOT NULL CHECK (perm_subscription_reading IN (0, 1)),
    perm_tts                  INTEGER NOT NULL CHECK (perm_tts IN (0, 1)),
    perm_ai_leo               INTEGER NOT NULL CHECK (perm_ai_leo IN (0, 1)),
    perm_offline              INTEGER NOT NULL CHECK (perm_offline IN (0, 1)),
    perm_indexing             INTEGER NOT NULL CHECK (perm_indexing IN (0, 1)),
    perm_promo_fragments      INTEGER NOT NULL CHECK (perm_promo_fragments IN (0, 1)),
    perm_cover_metadata       INTEGER NOT NULL CHECK (perm_cover_metadata IN (0, 1)),
    notes                     TEXT,
    created_by                TEXT NOT NULL,
    created_at                TEXT NOT NULL,
    UNIQUE (content_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_rights_versions_content ON rights_versions (content_id, version_no);

CREATE TRIGGER IF NOT EXISTS rights_versions_no_update
BEFORE UPDATE ON rights_versions
BEGIN
    SELECT RAISE(ABORT, 'rights_versions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS rights_versions_no_delete
BEFORE DELETE ON rights_versions
BEGIN
    SELECT RAISE(ABORT, 'rights_versions is append-only');
END;

-- DOWN
DROP TRIGGER IF EXISTS rights_versions_no_delete;
DROP TRIGGER IF EXISTS rights_versions_no_update;
DROP INDEX IF EXISTS idx_rights_versions_content;
DROP TABLE IF EXISTS rights_versions;
