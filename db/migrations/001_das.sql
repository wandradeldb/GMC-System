-- Block 6: Daily Allocation Sheet (DAS)
-- Migration 001

-- ---------------------------------------------------------------------------
-- DAS_ENTRY  (one per working day per project)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS das_entry (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    entry_date      TEXT    NOT NULL,                          -- ISO 8601 YYYY-MM-DD
    site_agent      TEXT    NOT NULL,
    weather         TEXT    CHECK (weather IN (
                        'Fine', 'Overcast', 'Light Rain',
                        'Heavy Rain', 'Wind', 'Frost', 'Snow'
                    )),
    work_type       TEXT    NOT NULL DEFAULT 'Contract'
                            CHECK (work_type IN ('Contract', 'Daywork')),
    visitors        TEXT,                                      -- free text, comma-separated
    general_notes   TEXT,
    status          TEXT    NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'submitted')),
    submitted_at    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    UNIQUE (project_id, entry_date)
);

-- ---------------------------------------------------------------------------
-- DAS_LABOUR  (one row per worker per DAS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS das_labour (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    das_entry_id    INTEGER NOT NULL REFERENCES das_entry(id) ON DELETE CASCADE,
    worker_name     TEXT    NOT NULL,
    trade           TEXT    NOT NULL,                          -- e.g. Ganger, Labourer, Fitter
    hours_worked    REAL    NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
    overtime_hours  REAL    NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
    activity_code   TEXT    CHECK (activity_code IN ('A','B','C','D','E','F','G')),
    work_type       TEXT    NOT NULL DEFAULT 'Contract'
                            CHECK (work_type IN ('Contract', 'Daywork')),
    notes           TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- DAS_PLANT  (plant/equipment per DAS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS das_plant (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    das_entry_id    INTEGER NOT NULL REFERENCES das_entry(id) ON DELETE CASCADE,
    plant_ref       TEXT,                                      -- fleet/hire ref
    description     TEXT    NOT NULL,                          -- e.g. "360 Excavator 20T"
    operator        TEXT,
    hours_worked    REAL    NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
    hours_idle      REAL    NOT NULL DEFAULT 0 CHECK (hours_idle >= 0),
    activity_code   TEXT    CHECK (activity_code IN ('A','B','C','D','E','F','G')),
    work_type       TEXT    NOT NULL DEFAULT 'Contract'
                            CHECK (work_type IN ('Contract', 'Daywork')),
    notes           TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- DAS_ACTIVITY  (work activities A–G, linked to service category)
-- Activity codes: A=Civil  B=Mechanical  C=Electrical
--                 D=Instrumentation  E=Commissioning  F=Preliminaries  G=Other
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS das_activity (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    das_entry_id     INTEGER NOT NULL REFERENCES das_entry(id) ON DELETE CASCADE,
    activity_code    TEXT    NOT NULL CHECK (activity_code IN ('A','B','C','D','E','F','G')),
    service_category TEXT    NOT NULL CHECK (service_category IN (
                         'Pump Station', 'Manhole', 'Pipework',
                         'Preliminaries', 'MEICA', 'Landscape', 'Other'
                     )),
    boq_item_id      INTEGER REFERENCES boq_item(id) ON DELETE SET NULL,
    description      TEXT    NOT NULL,
    qty_today        REAL,
    unit             TEXT,
    work_type        TEXT    NOT NULL DEFAULT 'Contract'
                             CHECK (work_type IN ('Contract', 'Daywork')),
    notes            TEXT,
    sort_order       INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- DAS_NEXT_WEEK  (filled on Fridays — planned activities for coming week)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS das_next_week (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id       INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    week_commencing  TEXT    NOT NULL,                         -- Monday ISO date
    site_agent       TEXT    NOT NULL,
    planned_labour   TEXT,                                     -- free text summary
    planned_plant    TEXT,
    planned_activities TEXT,                                   -- free text or JSON
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    UNIQUE (project_id, week_commencing)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_das_entry_project_date ON das_entry(project_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_das_labour_entry       ON das_labour(das_entry_id);
CREATE INDEX IF NOT EXISTS idx_das_plant_entry        ON das_plant(das_entry_id);
CREATE INDEX IF NOT EXISTS idx_das_activity_entry     ON das_activity(das_entry_id);
CREATE INDEX IF NOT EXISTS idx_das_next_week_project  ON das_next_week(project_id, week_commencing);

-- ---------------------------------------------------------------------------
-- TRIGGERS: updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_das_entry_updated
AFTER UPDATE ON das_entry FOR EACH ROW
BEGIN
    UPDATE das_entry SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_das_next_week_updated
AFTER UPDATE ON das_next_week FOR EACH ROW
BEGIN
    UPDATE das_next_week SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id;
END;
