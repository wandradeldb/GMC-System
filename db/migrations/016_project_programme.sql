-- Migration 016 — Project Programme (schedule PDF upload + parsed activities).
--
-- One uploaded Gantt-chart PDF per project (UNIQUE project_id — uploading again
-- replaces the previous one, matching the "delete to replace on update" UX).
-- The PDF itself is stored on disk (see server/lib/programmeStorage.js), only
-- its path + metadata live here. project_programme_activity holds the rows
-- parsed out of the PDF's table (task name, duration, start/finish, outline
-- level) by server/lib/programmeParser.js — the graphical Gantt bars are not
-- parsed (they're vector graphics, not text); the frontend draws its own
-- simple bars from start_date/finish_date instead.
--
-- Applied automatically on first use via CREATE TABLE IF NOT EXISTS in
-- server/routes/programme.js's db() helper — no manual migration step needed,
-- consistent with how project_member etc. were added (see auth.js).

CREATE TABLE IF NOT EXISTS project_programme (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    file_path   TEXT    NOT NULL,
    uploaded_by TEXT,
    uploaded_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (project_id)
);

CREATE TABLE IF NOT EXISTS project_programme_activity (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    programme_id    INTEGER NOT NULL REFERENCES project_programme(id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    level           INTEGER NOT NULL DEFAULT 0,
    task_name       TEXT    NOT NULL,
    duration_label  TEXT,
    start_date      TEXT,
    finish_date     TEXT,
    predecessors    TEXT
);

CREATE INDEX IF NOT EXISTS idx_programme_activity_programme ON project_programme_activity(programme_id);
