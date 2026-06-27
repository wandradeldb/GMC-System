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

## Notes

- Full project context: https://docs.google.com/document/d/1fq33qfSA3JQDFUI1O6GDoTSSG0VlarPOhQISm9PFpwE/edit (requires GMC Google account)
- Update this file as decisions are made.
