-- Migration 014 — Site Agent registry (code, name, phone, email)
-- Company-wide list (not per-project), imported from "site agent cod.xlsx".
-- Lets the DAS "Site Agent" field be picked from a known list instead of
-- freely typed, and shows the matching code (e.g. SA23) next to the name.
-- Seed data lives in server/data/site-agents.json; das.js's db() helper
-- self-heals this table and seeds it on first run (see notes in 013).

CREATE TABLE IF NOT EXISTS site_agent (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    code  TEXT UNIQUE,
    name  TEXT NOT NULL,
    phone TEXT,
    email TEXT
);

ALTER TABLE das_entry ADD COLUMN site_agent_code TEXT;
