-- CHP-EDITORIAL-ROYALTIES-2026-01 F1-B — historial de editorial responsable.
-- Una fila por cada cambio EFECTIVO de `publisherId` en la ficha de una obra
-- (alta, reasignación o retirada). Sirve para resolver qué editorial figuraba
-- en un periodo; no define quién cobra (eso es `rights_versions.shares`).
-- Sin claves foráneas: un titular retirado no debe impedir conservar el rastro.
-- Solo inserciones (triggers abajo). Idempotente: IF NOT EXISTS.

-- UP
CREATE TABLE IF NOT EXISTS content_publisher_history (
    id                TEXT PRIMARY KEY,
    content_id        TEXT NOT NULL,
    from_publisher_id TEXT,
    to_publisher_id   TEXT,
    actor             TEXT NOT NULL,
    changed_at        TEXT NOT NULL,
    CHECK (from_publisher_id IS NOT to_publisher_id)
);

CREATE INDEX IF NOT EXISTS idx_content_publisher_history_content ON content_publisher_history (content_id, changed_at);

CREATE TRIGGER IF NOT EXISTS content_publisher_history_no_update
BEFORE UPDATE ON content_publisher_history
BEGIN
    SELECT RAISE(ABORT, 'content_publisher_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS content_publisher_history_no_delete
BEFORE DELETE ON content_publisher_history
BEGIN
    SELECT RAISE(ABORT, 'content_publisher_history is append-only');
END;

-- DOWN
DROP TRIGGER IF EXISTS content_publisher_history_no_delete;
DROP TRIGGER IF EXISTS content_publisher_history_no_update;
DROP INDEX IF EXISTS idx_content_publisher_history_content;
DROP TABLE IF EXISTS content_publisher_history;
