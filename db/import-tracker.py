"""
Import historical tracker data from W03-26 Merlin Park Pumping Station (version 2).xlsx
into tracker_we table.

Revenue comes from the Tracker sheet (rows 8-13, weekly category totals).
Costs come from rows 71, 73, 77, 80 (subcons, materials, supervision, OHP).
Cumulatives are computed as running sums.
BOQ_PROGRESS rows are NOT created (data not available at item level).
"""
import sqlite3, sys, os
import pandas as pd
from datetime import datetime

XLSX = r"C:\Users\wagne\Downloads\W03-26 Merlin Park Pumping Station (version 2).xlsx"
DB   = os.path.join(os.path.dirname(__file__), "gmc.db")
PROJECT_ID = 1

print(f"Reading {XLSX}...")
tracker_raw = pd.read_excel(XLSX, sheet_name="Tracker", header=None)

# ── Columns for the 23 real weeks (col index 3 → 25) ──────────────────────
DATA_COLS = list(range(3, 26))

def get_row(idx):
    return [
        round(float(v), 4) if str(v) not in ["nan", "None", "NaT"] else 0.0
        for v in [tracker_raw.iloc[idx, c] for c in DATA_COLS]
    ]

# ── Revenue rows ───────────────────────────────────────────────────────────
week_endings   = [tracker_raw.iloc[4, c].strftime("%Y-%m-%d") for c in DATA_COLS]
week_numbers   = [int(tracker_raw.iloc[3, c]) for c in DATA_COLS]
rev_pf         = get_row(8)   # Prelims Fixed
rev_pt         = get_row(9)   # Prelims Time
rev_civil      = get_row(10)  # Civil Works
rev_meica      = get_row(11)  # MEICA
rev_landscape  = get_row(12)  # Landscape
rev_commission = get_row(13)  # Commissioning
# AE = 0 (not in spreadsheet as separate line)

# ── Cost rows ─────────────────────────────────────────────────────────────
r71 = get_row(71)  # Total subcon payments
r73 = get_row(73)  # Total trackable (subcon + materials)
r77 = get_row(77)  # Supervision → cost_plant
r80 = get_row(80)  # OH&P Allowance

cost_subs      = r71
cost_materials = [round(r73[i] - r71[i], 4) for i in range(23)]
cost_plant     = r77
ohp_allowance  = r80

# ── Build per-week records with running cumulative ─────────────────────────
weeks = []
cum_rev  = 0.0
cum_cost = 0.0

for i in range(23):
    rev_total = round(rev_pf[i] + rev_pt[i] + rev_civil[i] + rev_meica[i] +
                      rev_landscape[i] + rev_commission[i], 4)
    cost_total = round(cost_subs[i] + cost_materials[i] + cost_plant[i] + ohp_allowance[i], 4)

    cum_rev  = round(cum_rev  + rev_total,  4)
    cum_cost = round(cum_cost + cost_total, 4)

    margin_week = round(rev_total  - cost_total,  4)
    margin_cum  = round(cum_rev    - cum_cost,     4)
    margin_pct  = round((margin_cum / cum_rev * 100) if cum_rev > 0 else 0.0, 4)

    weeks.append({
        "project_id":       PROJECT_ID,
        "week_ending":      week_endings[i],
        "week_number":      week_numbers[i],
        "rev_prelims_fixed":  rev_pf[i],
        "rev_prelims_time":   rev_pt[i],
        "rev_civil":          rev_civil[i],
        "rev_meica":          rev_meica[i],
        "rev_landscape":      rev_landscape[i],
        "rev_commissioning":  rev_commission[i],
        "rev_ae":             0.0,
        "rev_total_week":     rev_total,
        "rev_cumulative":     cum_rev,
        "cost_subs":          cost_subs[i],
        "cost_materials":     cost_materials[i],
        "cost_plant":         cost_plant[i],
        "ohp_allowance":      ohp_allowance[i],
        "cost_total_week":    cost_total,
        "cost_cumulative":    cum_cost,
        "margin_week":        margin_week,
        "margin_cumulative":  margin_cum,
        "margin_pct":         margin_pct,
        "efa_revenue":        0.0,
        "efa_cost":           0.0,
        "efa_margin":         0.0,
        "efa_margin_pct":     0.0,
        "target_margin_pct":  8.0,
        "entered_by":         "Excel import",
        "notes":              "Imported from W03-26 Merlin Park Pumping Station (version 2).xlsx",
        "status":             "draft",
    })

# ── Upsert into SQLite ─────────────────────────────────────────────────────
con = sqlite3.connect(DB)
con.execute("PRAGMA foreign_keys = ON")

COLS = [
    "project_id", "week_ending", "week_number",
    "rev_prelims_fixed", "rev_prelims_time", "rev_civil", "rev_meica",
    "rev_landscape", "rev_commissioning", "rev_ae",
    "rev_total_week", "rev_cumulative",
    "cost_subs", "cost_materials", "cost_plant", "ohp_allowance",
    "cost_total_week", "cost_cumulative",
    "margin_week", "margin_cumulative", "margin_pct",
    "efa_revenue", "efa_cost", "efa_margin", "efa_margin_pct", "target_margin_pct",
    "entered_by", "notes", "status",
]

placeholders = ", ".join(["?"] * len(COLS))
update_clause = ", ".join([f"{c}=excluded.{c}" for c in COLS if c not in ("project_id", "week_ending")])
sql = f"""
    INSERT INTO tracker_we ({", ".join(COLS)})
    VALUES ({placeholders})
    ON CONFLICT(project_id, week_ending) DO UPDATE SET {update_clause}
"""

con.execute("BEGIN")
for w in weeks:
    vals = [w[c] for c in COLS]
    con.execute(sql, vals)
    print(f"  WE {w['week_ending']}  rev={w['rev_total_week']:>12,.2f}  cost={w['cost_total_week']:>10,.2f}  margin={w['margin_week']:>10,.2f}  cum_rev={w['rev_cumulative']:>12,.2f}")
con.execute("COMMIT")
con.close()

print(f"\nImported {len(weeks)} weeks successfully.")
print(f"Final cumulative revenue : EUR {cum_rev:,.2f}")
print(f"Final cumulative cost    : EUR {cum_cost:,.2f}")
print(f"Final margin             : EUR {round(cum_rev - cum_cost, 2):,.2f}")
print(f"Final margin %           : {round((cum_rev - cum_cost) / cum_rev * 100, 2):.2f}%")
