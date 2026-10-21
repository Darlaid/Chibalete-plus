-- CHP-EDITORIAL-ROYALTIES-2026-01 F1-A — registro único de titulares.
-- Editorial o tercero con derechos económicos (kind). El sello es un atributo
-- (imprints, JSON array de textos), no una entidad. Sin datos bancarios.
-- Idempotente: IF NOT EXISTS / INSERT OR IGNORE (dos réplicas pueden abrir la
-- base a la vez).

-- UP
CREATE TABLE IF NOT EXISTS publishers (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('editorial', 'tercero')),
    legal_name    TEXT NOT NULL,
    trade_name    TEXT,
    tax_id        TEXT,
    imprints      TEXT NOT NULL DEFAULT '[]',
    contact_name  TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    notes         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- Primera editorial: ID interno permanente. Razón social y NIT los completa
-- administración (no se inventan aquí).
INSERT OR IGNORE INTO publishers (id, kind, legal_name, trade_name, imprints, status, created_at, updated_at)
VALUES ('pub-chibalete-editores', 'editorial', 'Chibalete Editores', 'Chibalete Editores', '[]', 'active',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- DOWN
DROP TABLE IF EXISTS publishers;
