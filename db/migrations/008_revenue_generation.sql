-- Migration 008 — Revenue Generation module
-- Importa as atividades do "Revenue Generator" (por trade) e regista a % semanal + sub por atividade.
-- revenue_week alimenta as categorias de revenue do tracker_we por secção.

CREATE TABLE IF NOT EXISTS revenue_activity (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    ref             TEXT,
    description     TEXT,
    qty             REAL    NOT NULL DEFAULT 0,
    unit            TEXT,
    rate            REAL    NOT NULL DEFAULT 0,
    contract_value  REAL    NOT NULL DEFAULT 0,
    section         TEXT    NOT NULL,                 -- Prelim Fixed | Prelim Time | Civil Works | MEICA Works | Landscape | Commission
    default_sub_id  INTEGER REFERENCES subcontract(id) ON DELETE SET NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_revact_project ON revenue_activity(project_id);

CREATE TABLE IF NOT EXISTS revenue_week (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    activity_id     INTEGER NOT NULL REFERENCES revenue_activity(id) ON DELETE CASCADE,
    week_ending     TEXT    NOT NULL,
    pct_complete    REAL    NOT NULL DEFAULT 0,       -- % desta atividade gerado nesta semana
    sub_id          INTEGER REFERENCES subcontract(id) ON DELETE SET NULL,
    revenue         REAL    NOT NULL DEFAULT 0,       -- = pct_complete/100 * contract_value
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (activity_id, week_ending)
);
CREATE INDEX IF NOT EXISTS idx_revweek_week ON revenue_week(project_id, week_ending);
