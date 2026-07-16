# GMC System — Project Instructions

## Overview

GMC System is a construction contract management platform built for GMC (General Main Contractor) operations. The core of the system is the **CONTRACT** — every module, entity, and workflow revolves around the contract.

Pilot project: **Merlin Park** — W03/26 — Uisce Éireann — €5,347,965

---

## Stack

| Layer       | Pilot          | Production     |
|-------------|----------------|----------------|
| Frontend    | React + Vite   | React          |
| Backend     | Node.js/Express| Node.js        |
| Database    | SQLite (`node:sqlite` DatabaseSync) | PostgreSQL |

- Frontend: `client/` — runs on port 5173 (`npm run dev` inside `client/`)
- Backend: `server/` — runs on port 3001 (`node server/index.js`)
- Vite proxies `/api` → `http://localhost:3001`
- For mobile access: `vite.config.js` has `host: true` → access via `http://192.168.1.10:5173`

---

## Architecture Principles

- The CONTRACT is the central entity of the entire system.
- All data, costs, valuations, and workflows are tied to a specific contract.
- Design for multi-project, multi-contract from the start (even in SQLite pilot).
- Keep the data model clean and portable — SQLite → PostgreSQL migration must be straightforward.

---

## Module Roadmap

| Block | Name                  | Status        |
|-------|-----------------------|---------------|
| 1     | Project Setup         | Done          |
| **2** | **Contract Baseline** | **Done**      |
| 3     | Subcontract Mgmt      | Done          |
| 4     | Cost Tracker          | Done          |
| 5     | Applications for Payment | Done       |
| 6     | Daily Allocation Sheet | Done         |

---

## Modules — Current State

### Block 2 — Contract BOQ (`/api/v1/projects/1/boq`)
- 120 BOQ items across 3 schedules: Sch 1 (Prelims Fixed), Sch 1A (Prelims Time), Sch 2 (WW Pump Stations)
- Total BOQ: €5,347,965.24
- Entity: `boq_item` — fields: id, project_id, schedule, item_ref, description, unit, qty, rate, contract_sum, type (F/T/M), section, iw_cost_code
- UI: filterable by schedule (sidebar) and type (F/T/M chips), searchable
- **Full-contract-sheet import (2026-07-08):** ImportBOQModal.jsx has a third mode, "Full Contract
  Sheet", for a real-world layout the user's actual contract export uses — a single sheet
  ("Itemised Bill") with all schedules ("Bills") flowing one after another, rather than one sheet
  per schedule. `POST /projects/:pid/boq-import/parse-excel-full` (server/routes/boq-import.js)
  auto-splits it: bill boundaries are detected via `"Page Total NNN/<page>"` marker rows (the
  reliable end-of-bill signal — `"Bill NNN <Name>"` start markers exist for most but not all bills,
  e.g. Merlin Park's real file has no such line for Bill 507), multi-page bills are merged into one
  schedule entry, and section-header text rows carry forward into `boq_item.section` for subsequent
  rows. The "PD Ref" column in this format is **not** a unique item reference (repeats across many
  unrelated rows) — it's mapped to `iw_cost_code`; the real per-row reference is the "Item" column.
  Verified end-to-end against the user's actual file
  (`BOQ Contract Merlin Park.xlsx`, "Itemised Bill" sheet): 217 real line items across 13 bills,
  summing to exactly €5,347,965.24 — an exact match to the documented contract value, confirming the
  parser reads this real layout correctly. Since one file can span many bills mapping to only 6
  Revenue Generator sections, the preview groups rows per-bill with its own Revenue Section
  dropdown (pre-filled by keyword match on the bill name — e.g. "MEICA", "Landscap" — left **blank**
  whenever the guess isn't confident, never silently guessed, since a wrong section here would
  misdirect real revenue in the Cost Tracker). This is a distinct, additive mode — the original
  single-schedule Upload Excel / Paste Table modes are unchanged.
- **Section-column standard (REV1) (2026-07-09):** the user standardised the import template on a
  cleaner sheet (`BOQ Contract Merlin Park REV1.xlsx`) that carries an explicit **"Section" column
  (col H)** giving one of the 6 revenue categories per row. `parse-excel-full` now detects that
  column (`FULL_SHEET_ALIASES.section = ['section','category']`; the "Section" header sits one row
  *above* the Description header, and Item/PD Ref cols are unlabeled, so the route recovers them —
  Section by scanning `headerRow-1`, and Item/PD Ref positionally as `descCol-2`/`descCol-1`). When a
  Section column is present (`sectioned:true` in the response), the import is **fully automatic** — no
  per-bill mapping: each row's `boq_item.schedule` **is the category** (so the Bill of Quantities page
  groups & filters by the 6 categories, matching the Revenue Generator's category filters), and
  `revenue_activity.section` = the category with `ref` = PD Ref (`iw_cost_code`, insert-only /
  `dedup:false` since PD Ref repeats). Sub-section title rows still carry into `boq_item.section`.
  Verified end-to-end against the real REV1 file: 194 line items, exact category counts (Prelim Fixed
  24, Prelim Time 22, Civil Works 106, MEICA 29, Landscape 7, Commission 6), grand total
  €5,347,965.24; both views render category-grouped with category filters. The older no-Section
  layout still works via the bill-detection fallback (`sectioned:false`).
- **Section-column import fixes (2026-07-16):** two gaps found against a real contract file
  (`BOQ Valendo.xlsx`, project "Ferg Project Teste real") whose Section values are asset-based
  (Pump Station, Wastewater Network, Water Network, Line Stops) rather than the 6 revenue
  categories. (1) `parseFullSheet` previously required an item's description and its qty/unit/rate
  to be on the same row; some real files wrap a single item's own description onto its own row with
  values on the very next row, which was misread as a section-title row and left the values row
  without a description, failing commit validation — now an immediately-following values row with
  no description of its own borrows the title-row text as its own description instead of being
  rejected, without leaving that title stuck as the section header for later rows. (2)
  `sectioned:true` import was "fully automatic" with no way to remap a file's Section value that
  doesn't match one of the 6 revenue categories — `POST /revenue/activities` correctly rejected the
  unmatched rows (`INVALID_SECTION`), but there was no UI to fix it. [ImportBOQModal.jsx](client/src/components/ImportBOQModal.jsx)
  now shows the same manual "Revenue Section" dropdown used by the older bill-detection mode for any
  `sectioned` schedule whose name **isn't already** one of the 6 (`REVENUE_SECTIONS.includes(s.schedule)`)
  — schedules that already match stay fully automatic, no dropdown.
- **BOQ import feeds Revenue Generator too (2026-07-08):** `revenue_activity` (used by the "Revenue Generator" tab, [RevenueGenerationView.jsx](client/src/components/RevenueGenerationView.jsx)) was previously a fully disconnected dataset from `boq_item` — for Merlin Park the two were seeded independently (120 vs 250 rows, unrelated ref numbering) and must stay that way. Going forward, [ImportBOQModal.jsx](client/src/components/ImportBOQModal.jsx) has an optional "Revenue Section" dropdown; when set, after the BOQ commit succeeds it also calls the new `POST /api/v1/projects/:pid/revenue/activities` ([revenue.js](server/routes/revenue.js)) to create/update matching `revenue_activity` rows 1:1 (same ref/description/qty/rate/contract_value). **The section value must be one of the 6 fixed strings already hardcoded in `RevenueGenerationView.jsx`'s `SECTIONS`** (`Prelim Fixed | Prelim Time | Civil Works | MEICA Works | Landscape | Commission`) — not free text. This isn't just cosmetic: `PUT /revenue/week/:we` sums weekly revenue by that exact string into 6 fixed `tracker_we` columns, so any other value would silently vanish from the Cost Tracker instead of erroring. The dropdown defaults to "don't create Revenue Generator activities", so plain BOQ-only imports are unaffected.
- **BOQ import (2026-07-08):** [BOQView.jsx](client/src/components/BOQView.jsx) is now wired to a real "Bill of Quantities" nav entry — it used to be imported but never rendered (the `boq` nav id was already taken by `RevenueGenerationView`, a separate feature that tracks weekly % completion per activity, not the raw BOQ list). The schedule filter/list is now derived from the loaded data (`Object.keys(data.grouped)`) instead of a list hardcoded to Merlin Park's `'1'/'1A'/'2'` — that hardcoding used to silently hide any BOQ items under any other schedule label. A new "+ Import BOQ" button opens [ImportBOQModal.jsx](client/src/components/ImportBOQModal.jsx), which supports both an Excel upload and a paste-from-clipboard (TSV) flow, both going through a shared parse-then-preview-then-commit sequence. Backend: [server/routes/boq-import.js](server/routes/boq-import.js) — `POST /projects/:pid/boq-import/parse-excel` (multer+xlsx, column auto-detected by header keywords) and `POST /projects/:pid/boq-import/commit` (find-then-update-or-insert per row, keyed on `(project_id, item_ref)`). Note: `boq_item` has **no actual UNIQUE(project_id, item_ref) constraint on the live DB** despite `schema.sql` documenting one — the deployed table predates it, and Merlin Park already has ~20 duplicate placeholder `item_ref` rows (`'1.?'`, `'1A.?'`, leftover `description='nan'` rows from the original Python import script) that would block adding that constraint without a data-cleanup pass first. The commit endpoint therefore does an explicit `SELECT`-then-`UPDATE`-or-`INSERT` instead of relying on `ON CONFLICT`, so it works regardless of that constraint. Previously, this data only ever got into the DB via `db/import-schedule10.py`, a one-off script requiring direct DB/filesystem access — no in-app path to add a BOQ existed for any project other than Merlin Park.

### Block 3 — Subcontracts (`/api/v1/projects/1/subcontracts`)
- GMC master supplier list: `subcontractor` table — 2,620 suppliers with fields: id, code, short_name, name, email, phone, balance, credit_limit
- Project-specific subcontracts: `subcontract` table — linked to master via `subcontractor_id`
- Live search autocomplete in "New Subcontract" modal (debounce 220ms, min 2 chars, LIMIT 200)
- Current Merlin Park subcontract: SC-001 — Right Group Ltd (MEICA, €950,000)

### Block 4 — Cost Tracker (`/api/v1/projects/1/tracker`)
- Weekly entries: revenue by category (Prelims Fixed/Time, A&E, Civil, MEICA, Landscape, Commissioning), costs (Subs, Materials, Plant, OH&P), margin
- EFA (Estimated Final Account) section per week
- Summary bar at top: Contract Value, BOQ Total, This Week, Prev Week, Revenue Cumulative, Margin, EFA
- Matrix table: rows = metrics, columns = weeks (WE dates) + Cumulative column
- Weeks started: WE 12 Jan → WE 26 Jun (Wk 21–23 have data)

### Block 5 — Applications for Payment (`/api/v1/projects/1/payapps`)
- GMC applies → ER issues certificate
- Key fields: `works_gross_override` — QS enters gross total directly (bypasses per-item % calculation, needed for Schedule 2 items not in DB)
- Merlin Park history:
  - PayApp #1: Cert #3684, gross €42,619.90, net €41,341.31
  - PayApp #2: Cert #3785 (corrected), gross €297,083, net €210,370; previously certified = €77,766.73 (cert #3684 + interim cut cert #3750 €36,425)

### Block 6 — Daily Allocation Sheet
- Daily labour/plant/material allocation per activity code
- Linked to iw_cost_code from BOQ

---

## Database Migrations

| File | Description |
|------|-------------|
| `db/migrations/001_...` | Initial schema |
| `db/migrations/005_supplier_master.sql` | Added code, short_name, balance, credit_limit to subcontractor; UNIQUE INDEX on code |
| `db/migrations/006_sub_application_week_ending.sql` | Replaced `sub_application.period` (YYYY-MM) with `week_ending` (date); status set now `draft/assessed/approved/invoiced/paid` |
| `db/migrations/007_fix_sub_application_fk.sql` | Repaired dangling FK refs to `sub_application_old` left by 006's table-rename (recreated `sub_application_item`, `compensation_event`, `sub_invoice`) |

---

## UI / Visual Decisions (current state)

### Layout
- **Topbar**: `position: fixed; top: 0; z-index: 1000; height: 56px` — dark navy `#1a1a2e`
- **App**: `padding-top: 56px` to compensate for fixed topbar
- **Logo**: GMC logo image at `client/public/gmc-logo.png` (height 36px) — replaces text
- **Nav buttons** (`.topbar-nav-btn`): 14px font, `padding: 8px 18px`, active state `rgba(255,255,255,0.18)`

### BOQ Table
- Description column: `width: 340px; max-width: 340px`
- Alternating rows: odd = `#f0f6ff` (light blue), even = `#ffd8bb` (Laranja Claro — darker orange)
- Hover: `#dbeafe` (blue) with `!important` to override alternating

### Cost Tracker
- Summary bar: 2-column grid on mobile, horizontal flex on desktop
- Project card (Merlin Park header) is **hidden** when on tracker view — `activeNav !== 'tracker'` in App.jsx
- "Merlin Park W03/26" sub-text removed from Contract Value summary card
- Section header rows (REVENUE / COST / MARGIN / EFA): `padding: 3px 12px` (slim)
- Table scroll: `.tracker-scroll-wrap { overflow: auto; max-height: calc(100vh - 260px) }` — enables sticky thead
- Thead sticky: `.tracker-col-head { position: sticky; top: 0; z-index: 3 }`
- Row label sticky: `.tracker-row-label { position: sticky; left: 0; z-index: 1 }`

### Responsive (Mobile)
- Breakpoint 768px: topbar wraps, sidebar stacks, content padding reduced
- Breakpoint 600px: section grids go 1-column, payapp columns hidden (`.payapp-col-hide`)
- Topbar nav: horizontal scroll, `scrollbar-width: none`

---

## Pilot Project: Merlin Park

| Field          | Value                  |
|----------------|------------------------|
| Name           | Merlin Park            |
| Reference      | W03/26                 |
| Client         | Uisce Éireann          |
| Contract Value | €5,347,965             |
| DB project_id  | 1                      |

---

## Conventions

- File names: kebab-case. JS variables: camelCase. DB columns: snake_case.
- API routes: `/api/v1/...`
- Monetary values: REAL with 2 decimal precision (€ not cents).
- Dates: ISO 8601 (YYYY-MM-DD).
- Errors: return `{ error: string, code: string }` from API.

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/App.jsx` | Root layout, topbar, nav routing |
| `client/src/index.css` | All styles — single CSS file |
| `client/src/components/BOQView.jsx` | Contract BOQ table |
| `client/src/components/TrackerView.jsx` | Weekly cost tracker matrix |
| `client/src/components/PayAppView.jsx` | Applications for payment |
| `client/src/components/SubcontractView.jsx` | Subcontract list |
| `client/src/components/NewSubcontractModal.jsx` | Live search modal |
| `server/index.js` | Express entry point |
| `server/routes/payapp.js` | PayApp API + works_gross_override |
| `server/routes/subcontract.js` | Subcontract + supplier search API |
| `db/gmc.db` | SQLite database |
| `client/public/gmc-logo.png` | GMC logo |
| `client/vite.config.js` | Vite config (host: true for mobile) |

---

## Deployment (Railway)

- Production: Railway service `GMC-System`, domain `gmc.migotem.ie`, branch `main`. Push with: `git push origin master master:main`
- Dockerfile-based build — installs deps from the **root** `package.json`, not `server/package.json`. New server dependencies must be added to both files.
- **Known failure mode — auto-deploy stuck on an old commit:** Railway's Source settings has a **"Wait for CI"** toggle (Settings → Source) that blocks deploys until GitHub Actions report success. This repo has no `.github/workflows/`, so if that toggle is ever ON, new commits never deploy — Railway silently keeps re-serving the last commit that was active before the toggle got flipped, with no error shown. It was found ON on 2026-07-05 without anyone having touched it (suspected Railway-side default change tied to a "GitHub permissions update" prompt shown under the toggle) — first repo the team saw it happen to.
  - **Fix:** Settings → Source → turn "Wait for CI" off. If deploys still don't advance afterward, Disconnect and reconnect the Source repo (Settings → Source → Source Repo → Disconnect, then "Connect Repo" → pick `wandradeldb/GMC-System` → branch `main`) to force GitHub App resync, then push a trivial commit (`git commit --allow-empty -m "..."`) to confirm auto-deploy fires and picks up the real HEAD.
  - **How to verify what's actually live** (no Railway dashboard access needed): `curl` the site, grab the JS bundle path from the HTML, and grep it for a string unique to the latest feature. Bundle filename hash and `Last-Modified` header changing confirms a genuinely new build went out.

---

## Project Lifecycle & Permissions

Each `project` row represents a real, signed construction contract (real money, real BOQ/cost data) — so destructive actions on it are deliberately split by privilege:

- **Archive / Unarchive (any project owner, self-service):** toggles `project.status` between `active` and `closed` via `PUT /api/v1/projects/:id` (already existed). UI: "📥 Archive" / "📤 Unarchive" button on the project card in [ProjectsView.jsx](client/src/components/ProjectsView.jsx), visible when `access_role === 'owner'`. Archived projects are hidden from "My Projects" by default, behind a "Show archived (n)" toggle. Fully reversible, no data is touched.
- **Delete permanently (system admin only, hard delete):** wipes the project and all cascaded child data (BOQ, tracker, subcontracts, payapps, DAS, QS costs, etc. — irreversible). Route: `DELETE /api/v1/auth/admin/projects/:id` in [auth.js](server/routes/auth.js), gated by `requireAdmin`. UI: red "🗑 Delete permanently" button, visible only when `localStorage.gmc_role === 'admin'` (system role, not project `access_role`) — requires typing the project's `ref` into a prompt to confirm.
- **Rationale:** a regular project owner (gestor) should never be able to unilaterally destroy contract data with one click — only archive it. Only an admin can do a true delete, and only after typing the exact project reference. This decision was made 2026-07-05 after fixing the user-deletion FK bug (see migration 015) — same underlying concern: project deletion is high-blast-radius and must be deliberate.

---

## Notes

- Full project context: https://docs.google.com/document/d/1fq33qfSA3JQDFUI1O6GDoTSSG0VlarPOhQISm9PFpwE/edit (requires GMC Google account)
- Update this file as decisions are made.
