CREATE TABLE sub_application_new (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    subcontract_id          INTEGER NOT NULL REFERENCES subcontract(id) ON DELETE CASCADE,
    application_number      INTEGER NOT NULL,
    week_ending             TEXT    NOT NULL,

    value_sub               REAL    NOT NULL DEFAULT 0,
    value_gmc               REAL    NOT NULL DEFAULT 0,
    delta                   REAL    GENERATED ALWAYS AS (ROUND(value_gmc - value_sub, 2)) VIRTUAL,

    cumulative_sub          REAL    NOT NULL DEFAULT 0,
    cumulative_gmc          REAL    NOT NULL DEFAULT 0,
    retention_held          REAL    GENERATED ALWAYS AS (ROUND(cumulative_gmc * 0, 2)) VIRTUAL,
    net_payable             REAL    NOT NULL DEFAULT 0,

    qs_approved_by          TEXT,
    qs_approved_date        TEXT,
    invoice_requested       INTEGER NOT NULL DEFAULT 0 CHECK (invoice_requested IN (0,1)),
    status                  TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','assessed','approved','invoiced','paid')),
    notes                   TEXT,
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

    UNIQUE (subcontract_id, application_number),
    UNIQUE (subcontract_id, week_ending)
);

INSERT INTO sub_application_new (
    id, subcontract_id, application_number, week_ending,
    value_sub, value_gmc, cumulative_sub, cumulative_gmc, net_payable,
    qs_approved_by, qs_approved_date, invoice_requested, status, notes,
    created_at, updated_at
)
WITH ranked AS (
  SELECT
    sa.*,
    ROW_NUMBER() OVER (PARTITION BY subcontract_id, period ORDER BY id) as rn
  FROM sub_application sa
)
SELECT
    r.id, r.subcontract_id, r.application_number,
    date(r.period || '-05', '+' || ((r.rn - 1) * 7) || ' days') as week_ending,
    r.value_sub, r.value_gmc, r.cumulative_sub, r.cumulative_gmc, r.net_payable,
    r.qs_approved_by, r.qs_approved_date, r.invoice_requested, r.status, r.notes,
    r.created_at, r.updated_at
FROM ranked r;

DROP TABLE sub_application;
ALTER TABLE sub_application_new RENAME TO sub_application;

CREATE INDEX IF NOT EXISTS idx_sub_app_subcontract ON sub_application(subcontract_id);
CREATE INDEX IF NOT EXISTS idx_sub_app_week ON sub_application(week_ending);

CREATE TRIGGER IF NOT EXISTS trg_sub_app_updated
AFTER UPDATE ON sub_application FOR EACH ROW
BEGIN UPDATE sub_application SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;
