-- Migration 013 — Daily Allocation Sheet: subcontractor presence/work tracking
-- Lets the site agent record which of the project's subcontractors were on
-- site that day (picked from the existing subcontract list, not typed by
-- hand) and how many workers/hours/what they did.

CREATE TABLE IF NOT EXISTS das_subcontractor (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    das_entry_id    INTEGER NOT NULL REFERENCES das_entry(id) ON DELETE CASCADE,
    subcontract_id  INTEGER REFERENCES subcontract(id) ON DELETE SET NULL,
    sub_name        TEXT    NOT NULL,                          -- snapshot of the name at entry time
    workers_count   INTEGER NOT NULL DEFAULT 0,
    hours_worked    REAL    NOT NULL DEFAULT 0,
    activity_code   TEXT    CHECK (activity_code IN ('A','B','C','D','E','F','G')),
    work_type       TEXT    NOT NULL DEFAULT 'Contract'
                            CHECK (work_type IN ('Contract', 'Daywork')),
    description     TEXT,
    notes           TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_das_subcontractor_entry ON das_subcontractor(das_entry_id);
