-- GMC System — SQLite Schema
-- Block 2: Contract Baseline
-- Designed for SQLite pilot; portable to PostgreSQL (no SQLite-specific types used in logic)

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- PROJECT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ref             TEXT    NOT NULL UNIQUE,          -- e.g. W03/26
    name            TEXT    NOT NULL,                 -- e.g. Merlin Park
    client          TEXT    NOT NULL,                 -- e.g. Uisce Éireann
    contract_value  REAL    NOT NULL CHECK (contract_value >= 0),
    start_date      TEXT,                             -- ISO 8601 YYYY-MM-DD
    end_date        TEXT,                             -- ISO 8601 YYYY-MM-DD
    status          TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'closed', 'tender')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- BOQ_ITEM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boq_item (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    schedule        TEXT    NOT NULL,                 -- e.g. A, B, C
    section         TEXT,                             -- sub-section within schedule
    item_ref        TEXT    NOT NULL,                 -- e.g. A.01, B.03
    description     TEXT    NOT NULL,
    unit            TEXT    NOT NULL,                 -- m, m², m³, nr, sum, wk, …
    qty             REAL    NOT NULL DEFAULT 0 CHECK (qty >= 0),
    rate            REAL    NOT NULL DEFAULT 0 CHECK (rate >= 0),
    contract_sum    REAL    GENERATED ALWAYS AS (ROUND(qty * rate, 2)) VIRTUAL,
    type            TEXT    NOT NULL DEFAULT 'M'
                            CHECK (type IN ('F', 'T', 'M')),
    iw_cost_code    TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,       -- preserves BOQ row order
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    UNIQUE (project_id, item_ref)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_boq_project    ON boq_item(project_id);
CREATE INDEX IF NOT EXISTS idx_boq_schedule   ON boq_item(project_id, schedule);
CREATE INDEX IF NOT EXISTS idx_boq_cost_code  ON boq_item(iw_cost_code);

-- ---------------------------------------------------------------------------
-- TRIGGER: keep updated_at current on project
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_project_updated_at
AFTER UPDATE ON project
FOR EACH ROW
BEGIN
    UPDATE project SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = OLD.id;
END;

-- ---------------------------------------------------------------------------
-- TRIGGER: keep updated_at current on boq_item
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_boq_updated_at
AFTER UPDATE ON boq_item
FOR EACH ROW
BEGIN
    UPDATE boq_item SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = OLD.id;
END;

-- ---------------------------------------------------------------------------
-- SEED: Merlin Park pilot project
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO project (ref, name, client, contract_value, status)
VALUES ('W03/26', 'Merlin Park', 'Uisce Éireann', 5347965.00, 'active');
