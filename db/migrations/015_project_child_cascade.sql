-- Fixes: excel_sub_cost, qs_cost_transaction, tracker_sub_revenue reference
-- project(id) with no ON DELETE action, blocking project (and owner user) deletion
-- whenever those tables hold rows for the project. sub_assessment.project_id had
-- no FK at all — added one with cascade for consistency with every other
-- project-child table.
--
-- SQLite can't ALTER a column's FK constraint, so each table is rebuilt.

PRAGMA foreign_keys = OFF;

CREATE TABLE excel_sub_cost_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    sub_name TEXT NOT NULL,
    week_ending TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    source_file TEXT,
    imported_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
    notes TEXT,
    UNIQUE(project_id, sub_name, week_ending)
);
INSERT INTO excel_sub_cost_new SELECT * FROM excel_sub_cost;
DROP TABLE excel_sub_cost;
ALTER TABLE excel_sub_cost_new RENAME TO excel_sub_cost;

CREATE TABLE qs_cost_transaction_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    transaction_id TEXT,
    trans_date TEXT,
    agent_code TEXT,
    agent_name TEXT,
    gang_no TEXT,
    gang_name TEXT,
    trans_type TEXT,
    cost_code TEXT,
    cost_category TEXT,
    supplier_account TEXT,
    supplier_name TEXT,
    stock_item_text TEXT,
    document_ref TEXT,
    plant_description TEXT,
    unit_value REAL,
    qty REAL,
    cost REAL,
    week_ending TEXT,
    month TEXT,
    year INTEGER,
    source_file TEXT,
    imported_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
INSERT INTO qs_cost_transaction_new SELECT * FROM qs_cost_transaction;
DROP TABLE qs_cost_transaction;
ALTER TABLE qs_cost_transaction_new RENAME TO qs_cost_transaction;

CREATE TABLE tracker_sub_revenue_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    week_ending TEXT NOT NULL,
    sub_name TEXT NOT NULL,
    revenue_generated REAL DEFAULT 0,
    gmc_op_plant REAL DEFAULT 0,
    misc_subbies_cost REAL DEFAULT 0,
    misc_subbies_revenue REAL DEFAULT 0,
    notes TEXT,
    UNIQUE(project_id, week_ending, sub_name)
);
INSERT INTO tracker_sub_revenue_new SELECT * FROM tracker_sub_revenue;
DROP TABLE tracker_sub_revenue;
ALTER TABLE tracker_sub_revenue_new RENAME TO tracker_sub_revenue;

CREATE TABLE sub_assessment_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    sub_name TEXT NOT NULL,
    app_label TEXT,
    week_ending TEXT,
    gmc_assessment REAL DEFAULT 0,
    sub_claimed   REAL DEFAULT 0,
    source_file TEXT,
    imported_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, sub_name, app_label)
);
INSERT INTO sub_assessment_new SELECT * FROM sub_assessment;
DROP TABLE sub_assessment;
ALTER TABLE sub_assessment_new RENAME TO sub_assessment;

CREATE INDEX IF NOT EXISTS idx_excel_sub_cost_project ON excel_sub_cost(project_id);
CREATE INDEX IF NOT EXISTS idx_qs_cost_transaction_project ON qs_cost_transaction(project_id);
CREATE INDEX IF NOT EXISTS idx_tracker_sub_revenue_project ON tracker_sub_revenue(project_id);
CREATE INDEX IF NOT EXISTS idx_sub_assessment_project ON sub_assessment(project_id);

PRAGMA foreign_keys = ON;
