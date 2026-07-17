-- Migration 017 — Flexible per-project revenue categories
--
-- The app used to hardcode exactly 6 revenue categories (Prelim Fixed, Prelim Time,
-- Civil Works, MEICA Works, Landscape, Commission) as literal columns on tracker_we.
-- Real contracts use different taxonomies project to project (e.g. Pump Station /
-- Wastewater Network / Water Network / Line Stops on a real file imported this
-- session), so category now lives as a row, not a column, keyed by whatever the
-- project's own BOQ Section values are.
--
-- Additive only: tracker_we's legacy rev_* columns are NOT dropped here — they stay
-- as a frozen historical snapshot / rollback safety net. Application code stops
-- writing/reading them going forward (separate commit).
--
-- Applied automatically on first use via CREATE TABLE IF NOT EXISTS in both
-- server/routes/tracker.js's and server/routes/revenue.js's db() helpers (duplicated
-- in both, since either route's db() may be the first one hit after a deploy) — no
-- manual migration step needed, consistent with project_programme (migration 016).
-- The backfill below is mirrored there too, guarded by a row-count check so it only
-- actually executes once. This file is documentation of that schema, not itself run
-- against production — see run_migration_017.js for local-only verification.

CREATE TABLE IF NOT EXISTS tracker_we_category (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    week_ending   TEXT    NOT NULL,
    category      TEXT    NOT NULL,   -- verbatim boq_item.schedule (Path A) or revenue_activity.section (Path B)
    revenue       REAL    NOT NULL DEFAULT 0,
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (project_id, week_ending, category)
);
CREATE INDEX IF NOT EXISTS idx_trackercat_project_week ON tracker_we_category(project_id, week_ending);
CREATE INDEX IF NOT EXISTS idx_trackercat_project_cat  ON tracker_we_category(project_id, category);

-- Backfill: legacy fixed columns -> rows (skip zero, they contribute nothing)
INSERT OR IGNORE INTO tracker_we_category (project_id, week_ending, category, revenue)
SELECT project_id, week_ending, 'Prelim Fixed', rev_prelims_fixed FROM tracker_we WHERE rev_prelims_fixed   != 0
UNION ALL SELECT project_id, week_ending, 'Prelim Time',  rev_prelims_time   FROM tracker_we WHERE rev_prelims_time   != 0
UNION ALL SELECT project_id, week_ending, 'Civil Works',  rev_civil          FROM tracker_we WHERE rev_civil          != 0
UNION ALL SELECT project_id, week_ending, 'MEICA Works',  rev_meica          FROM tracker_we WHERE rev_meica          != 0
UNION ALL SELECT project_id, week_ending, 'Landscape',    rev_landscape      FROM tracker_we WHERE rev_landscape      != 0
UNION ALL SELECT project_id, week_ending, 'Commission',   rev_commissioning  FROM tracker_we WHERE rev_commissioning  != 0
UNION ALL SELECT project_id, week_ending, 'A&E / Design', rev_ae             FROM tracker_we WHERE rev_ae             != 0;
