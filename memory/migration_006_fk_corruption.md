---
name: migration-006-fk-corruption
description: Migration 006 left child tables with dangling FK to sub_application_old; fixed by 007
metadata:
  type: project
---

Migration 006 (`sub_application.period` → `week_ending`) recreated `sub_application` via a table rename. SQLite (modern, legacy_alter_table OFF) rewrites child-table FK references on rename, so `sub_application_item`, `compensation_event`, and `sub_invoice` ended up referencing `"sub_application_old"` — a table that was then dropped. Result: any INSERT into `sub_application_item` failed with `no such table: main.sub_application_old` whenever `PRAGMA foreign_keys=ON` (which `db()` sets).

This silently broke both Excel import and manual create (the symptom that looked like "import returns 0 apps" was actually a chain: wrong column layout assumption → `period` column gone → dangling FK).

**Why:** SQLite rewrites FK names in dependent tables during `ALTER TABLE ... RENAME`.

**How to apply:** Migration 007 (`db/migrations/007_fix_sub_application_fk.sql` + `run_migration_007.js`) recreated the three child tables (they were empty) with FK → `sub_application`. To detect recurrence: `SELECT name FROM sqlite_master WHERE sql LIKE '%sub_application_old%'` should return nothing; run `PRAGMA foreign_key_check`. Related: [[subassessment_route_shadowing]].
