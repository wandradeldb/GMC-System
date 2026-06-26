-- Block 4: Cost Control Tracker
-- Migration 003

-- ---------------------------------------------------------------------------
-- BOQ_PROGRESS  (QS enters % complete per BOQ item per week ending)
-- Revenue is derived: value_this = contract_sum × (pct_this - pct_prev)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boq_progress (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id          INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    boq_item_id         INTEGER NOT NULL REFERENCES boq_item(id) ON DELETE CASCADE,
    week_ending         TEXT    NOT NULL,           -- ISO Friday YYYY-MM-DD
    pct_complete_prev   REAL    NOT NULL DEFAULT 0 CHECK (pct_complete_prev >= 0 AND pct_complete_prev <= 100),
    pct_complete_this   REAL    NOT NULL DEFAULT 0 CHECK (pct_complete_this >= 0 AND pct_complete_this <= 100),
    entered_by          TEXT,
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (project_id, boq_item_id, week_ending)
);

-- ---------------------------------------------------------------------------
-- TRACKER_WE  (one row per project per week ending — the master cost ledger)
--
-- Revenue categories map from BOQ:
--   prelims_fixed   → schedule='1',  type='F'
--   prelims_time    → schedule='1A', type='T'
--   civil           → schedule='2', description contains 'civil'
--   meica           → schedule='2', description contains 'mechanical'/'electrical'/'control'
--   landscape       → schedule='2', description contains 'landscape'
--   commissioning   → schedule='2', description contains 'commission'/'training'/'testing'
--   ae              → design/AE items (from prelims – Design Principles, etc.)
--
-- Cost:
--   cost_subs       → sum of approved SUB_APPLICATION.value_gmc for WEs in period
--   cost_materials  → entered manually
--   cost_plant      → entered manually
--   ohp_allowance   → overhead & profit reserve (entered or % of cost)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracker_we (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id          INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    week_ending         TEXT    NOT NULL,           -- ISO Friday YYYY-MM-DD
    week_number         INTEGER NOT NULL,           -- sequential 1-based

    -- ── Revenue (calculated from BOQ_PROGRESS, stored for performance) ──
    rev_prelims_fixed   REAL    NOT NULL DEFAULT 0,
    rev_prelims_time    REAL    NOT NULL DEFAULT 0,
    rev_civil           REAL    NOT NULL DEFAULT 0,
    rev_meica           REAL    NOT NULL DEFAULT 0,
    rev_landscape       REAL    NOT NULL DEFAULT 0,
    rev_commissioning   REAL    NOT NULL DEFAULT 0,
    rev_ae              REAL    NOT NULL DEFAULT 0,
    rev_total_week      REAL    NOT NULL DEFAULT 0,  -- sum of above
    rev_cumulative      REAL    NOT NULL DEFAULT 0,  -- cumulative to this WE

    -- ── Cost (subs from approved applications; others entered manually) ──
    cost_subs           REAL    NOT NULL DEFAULT 0,
    cost_materials      REAL    NOT NULL DEFAULT 0,
    cost_plant          REAL    NOT NULL DEFAULT 0,
    ohp_allowance       REAL    NOT NULL DEFAULT 0,
    cost_total_week     REAL    NOT NULL DEFAULT 0,
    cost_cumulative     REAL    NOT NULL DEFAULT 0,

    -- ── Margin ──
    margin_week         REAL    NOT NULL DEFAULT 0,  -- rev_total_week - cost_total_week
    margin_cumulative   REAL    NOT NULL DEFAULT 0,
    margin_pct          REAL    NOT NULL DEFAULT 0,  -- margin_cumulative / rev_cumulative × 100

    -- ── EFA (Estimated Final Account — QS forecast) ──
    efa_revenue         REAL    NOT NULL DEFAULT 0,
    efa_cost            REAL    NOT NULL DEFAULT 0,
    efa_margin          REAL    NOT NULL DEFAULT 0,  -- efa_revenue - efa_cost
    efa_margin_pct      REAL    NOT NULL DEFAULT 0,
    target_margin_pct   REAL    NOT NULL DEFAULT 8.0,

    -- ── Meta ──
    entered_by          TEXT,
    notes               TEXT,
    status              TEXT    NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','locked')),
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

    UNIQUE (project_id, week_ending)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_boq_progress_project_we  ON boq_progress(project_id, week_ending);
CREATE INDEX IF NOT EXISTS idx_boq_progress_item_we     ON boq_progress(boq_item_id, week_ending);
CREATE INDEX IF NOT EXISTS idx_tracker_project_we       ON tracker_we(project_id, week_ending);

-- ---------------------------------------------------------------------------
-- TRIGGERS: updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_boq_progress_updated
AFTER UPDATE ON boq_progress FOR EACH ROW
BEGIN UPDATE boq_progress SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;

CREATE TRIGGER IF NOT EXISTS trg_tracker_we_updated
AFTER UPDATE ON tracker_we FOR EACH ROW
BEGIN UPDATE tracker_we SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = OLD.id; END;
