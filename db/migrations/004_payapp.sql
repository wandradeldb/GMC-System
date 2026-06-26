-- Block 5: Application for Payment
-- Migration 004

-- ---------------------------------------------------------------------------
-- PAYAPP  (header — one per PayApp submitted to client)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payapp (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id              INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    app_number              INTEGER NOT NULL,               -- 1, 2, 3...
    period                  TEXT    NOT NULL,               -- YYYY-MM (month of works)
    date_submitted          TEXT,                           -- ISO YYYY-MM-DD
    date_certified          TEXT,                           -- ISO YYYY-MM-DD (when ER certifies)
    cert_number             TEXT,                           -- ER certificate number

    -- Status
    status                  TEXT    NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','submitted','certified','paid')),

    -- Gross works (cumulative to this application)
    works_gross_cumulative  REAL    NOT NULL DEFAULT 0,
    ae_cumulative           REAL    NOT NULL DEFAULT 0,     -- Adjustment Events
    total_gross_cumulative  REAL    NOT NULL DEFAULT 0,     -- works + AEs

    -- Retention
    retention_pct           REAL    NOT NULL DEFAULT 3.0,
    retention_cumulative    REAL    NOT NULL DEFAULT 0,     -- total_gross × retention_pct/100

    -- Net values
    net_cumulative          REAL    NOT NULL DEFAULT 0,     -- total_gross - retention
    previously_certified    REAL    NOT NULL DEFAULT 0,     -- net of last certified payapp
    this_certificate        REAL    NOT NULL DEFAULT 0,     -- net_cumulative - previously_certified

    -- ER certified values (may differ from submitted)
    er_works_certified      REAL,
    er_net_certified        REAL,
    er_this_cert            REAL,

    -- Meta
    prepared_by             TEXT,
    notes                   TEXT,
    source                  TEXT    DEFAULT 'manual',       -- 'manual' | 'import'
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

    UNIQUE (project_id, app_number)
);

-- ---------------------------------------------------------------------------
-- PAYAPP_ITEM  (per-BOQ-item % claimed per PayApp)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payapp_item (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    payapp_id               INTEGER NOT NULL REFERENCES payapp(id) ON DELETE CASCADE,
    boq_item_id             INTEGER NOT NULL REFERENCES boq_item(id) ON DELETE CASCADE,
    pct_complete            REAL    NOT NULL DEFAULT 0
                                    CHECK (pct_complete >= 0 AND pct_complete <= 100),
    value_claimed           REAL    NOT NULL DEFAULT 0,     -- contract_sum × pct_complete / 100
    er_pct_certified        REAL,                           -- ER's certified % (may differ)
    er_value_certified      REAL,
    notes                   TEXT,
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (payapp_id, boq_item_id)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payapp_project     ON payapp(project_id, app_number);
CREATE INDEX IF NOT EXISTS idx_payapp_item_payapp ON payapp_item(payapp_id);
CREATE INDEX IF NOT EXISTS idx_payapp_item_boq    ON payapp_item(boq_item_id);

-- ---------------------------------------------------------------------------
-- TRIGGERS: updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_payapp_updated
AFTER UPDATE ON payapp FOR EACH ROW
BEGIN UPDATE payapp SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;
