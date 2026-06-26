-- Block 3: Subcontract Management
-- Migration 002

-- ---------------------------------------------------------------------------
-- SUBCONTRACTOR  (company master)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subcontractor (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    contact     TEXT,
    email       TEXT,
    phone       TEXT,
    vat_number  TEXT,
    address     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------------
-- SUBCONTRACT  (agreement between GMC and a sub, on a project)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subcontract (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id          INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    subcontractor_id    INTEGER NOT NULL REFERENCES subcontractor(id),
    ref                 TEXT    NOT NULL,           -- e.g. SC-001
    description         TEXT    NOT NULL,           -- scope summary
    contract_value      REAL    NOT NULL DEFAULT 0,
    retention_pct       REAL    NOT NULL DEFAULT 5.0 CHECK (retention_pct >= 0 AND retention_pct <= 100),
    start_date          TEXT,
    end_date            TEXT,
    status              TEXT    NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','completed','terminated')),
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (project_id, ref)
);

-- ---------------------------------------------------------------------------
-- SUB_BOQ_ITEM  (sub's scope, optionally linked to a contract BOQ_ITEM)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_boq_item (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    subcontract_id  INTEGER NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
    boq_item_id     INTEGER REFERENCES boq_item(id) ON DELETE SET NULL,  -- link to contract BOQ
    item_ref        TEXT    NOT NULL,
    description     TEXT    NOT NULL,
    unit            TEXT    NOT NULL,
    qty             REAL    NOT NULL DEFAULT 0,
    rate            REAL    NOT NULL DEFAULT 0,
    sub_total       REAL    GENERATED ALWAYS AS (ROUND(qty * rate, 2)) VIRTUAL,
    section         TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- PAYMENT_RUN  (QS publishes a payment calendar; invoices attach to a run)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_run (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    run_ref     TEXT    NOT NULL,           -- e.g. PR-2026-01
    run_date    TEXT    NOT NULL,           -- scheduled payment date ISO
    description TEXT,
    status      TEXT    NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','processing','paid','cancelled')),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (project_id, run_ref)
);

-- ---------------------------------------------------------------------------
-- SUB_APPLICATION  (monthly assessment — one per subcontract per period)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_application (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    subcontract_id          INTEGER NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
    application_number      INTEGER NOT NULL,          -- sequential, 1-based
    period                  TEXT    NOT NULL,           -- YYYY-MM

    -- Sub's claim
    value_sub               REAL    NOT NULL DEFAULT 0,
    -- QS assessment
    value_gmc               REAL    NOT NULL DEFAULT 0,
    -- Delta (stored for query convenience; also = value_gmc - value_sub)
    delta                   REAL    GENERATED ALWAYS AS (ROUND(value_gmc - value_sub, 2)) VIRTUAL,

    -- Cumulative (filled from item-level detail)
    cumulative_sub          REAL    NOT NULL DEFAULT 0,
    cumulative_gmc          REAL    NOT NULL DEFAULT 0,
    retention_held          REAL    GENERATED ALWAYS AS (ROUND(cumulative_gmc * 0, 2)) VIRTUAL, -- overridden by trigger logic in app
    net_payable             REAL    NOT NULL DEFAULT 0, -- computed in app layer

    -- Approval
    qs_approved_by          TEXT,
    qs_approved_date        TEXT,
    invoice_requested       INTEGER NOT NULL DEFAULT 0 CHECK (invoice_requested IN (0,1)),  -- boolean
    status                  TEXT    NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','assessed','approved','invoiced','paid')),
    notes                   TEXT,
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

    UNIQUE (subcontract_id, application_number),
    UNIQUE (subcontract_id, period)
);

-- ---------------------------------------------------------------------------
-- SUB_APPLICATION_ITEM  (line-by-line assessment per sub_boq_item)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_application_item (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_application_id  INTEGER NOT NULL REFERENCES sub_application(id) ON DELETE CASCADE,
    sub_boq_item_id     INTEGER NOT NULL REFERENCES sub_boq_item(id) ON DELETE CASCADE,

    -- Sub's claim
    qty_complete_sub    REAL    NOT NULL DEFAULT 0,
    value_sub           REAL    GENERATED ALWAYS AS (
                            ROUND(qty_complete_sub * (SELECT rate FROM sub_boq_item WHERE id = sub_boq_item_id), 2)
                        ) VIRTUAL,
    -- QS assessment
    qty_complete_gmc    REAL    NOT NULL DEFAULT 0,
    value_gmc           REAL    GENERATED ALWAYS AS (
                            ROUND(qty_complete_gmc * (SELECT rate FROM sub_boq_item WHERE id = sub_boq_item_id), 2)
                        ) VIRTUAL,

    notes               TEXT
);

-- ---------------------------------------------------------------------------
-- COMPENSATION_EVENT  (variations / extras agreed within or outside assessment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compensation_event (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    subcontract_id      INTEGER NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
    sub_application_id  INTEGER REFERENCES sub_application(id) ON DELETE SET NULL,
    ce_ref              TEXT    NOT NULL,           -- e.g. CE-001
    description         TEXT    NOT NULL,
    sub_value           REAL    NOT NULL DEFAULT 0,   -- sub's claim
    gmc_value           REAL    NOT NULL DEFAULT 0,   -- QS agreed value
    status              TEXT    NOT NULL DEFAULT 'submitted'
                                CHECK (status IN ('submitted','assessed','agreed','rejected')),
    approved_date       TEXT,
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (subcontract_id, ce_ref)
);

-- ---------------------------------------------------------------------------
-- SUB_INVOICE  (invoice received from sub against an assessment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_invoice (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_application_id  INTEGER NOT NULL REFERENCES sub_application(id) ON DELETE CASCADE,
    invoice_number      TEXT    NOT NULL,
    invoice_date        TEXT    NOT NULL,
    gross_amount        REAL    NOT NULL DEFAULT 0,
    retention_amount    REAL    NOT NULL DEFAULT 0,
    net_amount          REAL    GENERATED ALWAYS AS (ROUND(gross_amount - retention_amount, 2)) VIRTUAL,
    sent_finance_date   TEXT,                          -- when QS sent to finance
    payment_run_id      INTEGER REFERENCES payment_run(id) ON DELETE SET NULL,
    payment_date        TEXT,                          -- actual payment date
    status              TEXT    NOT NULL DEFAULT 'received'
                                CHECK (status IN ('received','sent_to_finance','scheduled','paid','disputed')),
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (sub_application_id, invoice_number)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_subcontract_project      ON subcontract(project_id);
CREATE INDEX IF NOT EXISTS idx_sub_boq_subcontract      ON sub_boq_item(subcontract_id);
CREATE INDEX IF NOT EXISTS idx_sub_boq_boq_item         ON sub_boq_item(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_sub_app_subcontract      ON sub_application(subcontract_id);
CREATE INDEX IF NOT EXISTS idx_sub_app_item_app         ON sub_application_item(sub_application_id);
CREATE INDEX IF NOT EXISTS idx_ce_subcontract           ON compensation_event(subcontract_id);
CREATE INDEX IF NOT EXISTS idx_invoice_application      ON sub_invoice(sub_application_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payment_run      ON sub_invoice(payment_run_id);
CREATE INDEX IF NOT EXISTS idx_payment_run_project      ON payment_run(project_id);

-- ---------------------------------------------------------------------------
-- TRIGGERS: updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_subcontract_updated
AFTER UPDATE ON subcontract FOR EACH ROW
BEGIN UPDATE subcontract SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;

CREATE TRIGGER IF NOT EXISTS trg_sub_app_updated
AFTER UPDATE ON sub_application FOR EACH ROW
BEGIN UPDATE sub_application SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;

CREATE TRIGGER IF NOT EXISTS trg_ce_updated
AFTER UPDATE ON compensation_event FOR EACH ROW
BEGIN UPDATE compensation_event SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_updated
AFTER UPDATE ON sub_invoice FOR EACH ROW
BEGIN UPDATE sub_invoice SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;
