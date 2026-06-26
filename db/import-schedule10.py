"""
Import MerlinPark_WorkOrder_Schedule10.xlsx into gmc.db (SQLite).

Column layout (all BOQ sheets):
  [0] IW Cost Code   [1] Item Ref   [2] Description   [3] Unit
  [4] Labour (€)     [5] Plant (€)  [6] Material (€)  [7] Amount (€)  [8] Comment

Run:
  pip install pandas openpyxl
  python db/import-schedule10.py
"""

import sqlite3
import re
import pandas as pd
from pathlib import Path

XLSX = Path(r"C:\Users\wagne\Downloads\MerlinPark_WorkOrder_Schedule10.xlsx")
DB   = Path(__file__).parent / "gmc.db"

# Sheet config: (excel_name, schedule_label, boq_type)
SHEETS = [
    ("Sch1. Preliminaries - Fixed",  "1",  "F"),
    ("Sch1A Preliminaries - Time",   "1A", "T"),
    ("Sch2 WW Pump Stations",        "2",  "F"),
]

ITEM_REF_RE = re.compile(r"^\d+[A-Z]?(\.\d+)*\.?$")

def is_item_ref(val):
    if not isinstance(val, str):
        return False
    return bool(ITEM_REF_RE.match(val.strip()))

def is_section_header(row):
    """Row has an item_ref in col 1 but no unit in col 3."""
    return is_item_ref(str(row.get(1, ""))) and pd.isna(row.get(3))

def is_data_row(row):
    """Row has a unit in col 3 and a numeric amount somewhere."""
    has_unit   = isinstance(row.get(3), str) and len(str(row.get(3)).strip()) > 0
    has_amount = isinstance(row.get(7), (int, float)) and not pd.isna(row.get(7))
    return has_unit and has_amount

def is_total_row(row):
    desc = str(row.get(1, "")) + str(row.get(2, ""))
    return "total schedule" in desc.lower() or "carried forward" in desc.lower()

def parse_sheet(xl, sheet_name, schedule_label, boq_type):
    df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
    items = []
    current_section = None
    pending_ref     = None   # for Schedule 2 pattern where ref is on previous row
    sort_order      = 0

    for idx, raw_row in df.iterrows():
        row = {j: v for j, v in enumerate(raw_row)}

        if idx < 3:          # skip title/header rows
            continue
        if is_total_row(row):
            continue

        # Section header: item_ref present, no unit
        if is_section_header(row):
            current_section = str(row[1]).strip()
            pending_ref     = current_section   # may be used by next data row
            continue

        # Data row: has unit + amount
        if is_data_row(row):
            iw_cost_code = row.get(0) if isinstance(row.get(0), str) else None
            item_ref     = str(row[1]).strip() if is_item_ref(str(row.get(1, ""))) else pending_ref
            description  = str(row.get(2, "")).strip()
            unit         = str(row[3]).strip().lower()
            amount       = float(row[7])

            # Lump sum: qty=1, rate=amount (contract_sum = qty*rate)
            qty  = 1.0
            rate = round(amount, 2)

            items.append({
                "schedule":     schedule_label,
                "section":      current_section,
                "item_ref":     item_ref or f"{schedule_label}.?",
                "description":  description,
                "unit":         unit,
                "qty":          qty,
                "rate":         rate,
                "type":         boq_type,
                "iw_cost_code": iw_cost_code,
                "sort_order":   sort_order,
            })
            sort_order  += 10
            pending_ref  = None
            continue

        # Rows with description in col 2 only (no item_ref) — sub-items in Sch2
        if not is_item_ref(str(row.get(1, ""))) and isinstance(row.get(2), str):
            unit   = row.get(3)
            amount = row.get(7)
            if isinstance(unit, str) and isinstance(amount, (int, float)) and not pd.isna(amount):
                iw_cost_code = row.get(0) if isinstance(row.get(0), str) else None
                items.append({
                    "schedule":     schedule_label,
                    "section":      current_section,
                    "item_ref":     pending_ref or f"{schedule_label}.?",
                    "description":  str(row[2]).strip(),
                    "unit":         str(unit).strip().lower(),
                    "qty":          1.0,
                    "rate":         round(float(amount), 2),
                    "type":         boq_type,
                    "iw_cost_code": iw_cost_code,
                    "sort_order":   sort_order,
                })
                sort_order += 10
                pending_ref = None

    return items

def main():
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")

    # Get project id
    project = con.execute("SELECT id FROM project WHERE ref = 'W03/26'").fetchone()
    if not project:
        raise RuntimeError("Project W03/26 not found — run init-db.js first")
    project_id = project[0]

    # Clear existing BOQ for this project (idempotent re-run)
    con.execute("DELETE FROM boq_item WHERE project_id = ?", (project_id,))

    xl    = pd.ExcelFile(XLSX)
    total = 0

    for sheet_name, schedule_label, boq_type in SHEETS:
        items = parse_sheet(xl, sheet_name, schedule_label, boq_type)
        for item in items:
            con.execute("""
                INSERT INTO boq_item
                    (project_id, schedule, section, item_ref, description,
                     unit, qty, rate, type, iw_cost_code, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """, (
                project_id,
                item["schedule"],
                item["section"],
                item["item_ref"],
                item["description"],
                item["unit"],
                item["qty"],
                item["rate"],
                item["type"],
                item["iw_cost_code"],
                item["sort_order"],
            ))
        print(f"  Sch {schedule_label:3s} ({boq_type}): {len(items):3d} items  "
              f"  subtotal = €{sum(i['rate'] for i in items):>14,.2f}")
        total += len(items)

    con.commit()

    # Verify
    rows = con.execute("""
        SELECT schedule, COUNT(*) as n, SUM(rate) as subtotal
        FROM boq_item WHERE project_id = ?
        GROUP BY schedule ORDER BY schedule
    """, (project_id,)).fetchall()

    grand = con.execute(
        "SELECT SUM(rate) FROM boq_item WHERE project_id = ?", (project_id,)
    ).fetchone()[0]

    print(f"\n{'-'*55}")
    print(f"  {'Schedule':<12} {'Items':>6}  {'Subtotal':>16}")
    print(f"{'-'*55}")
    for sch, n, sub in rows:
        print(f"  Sch {sch:<8}   {n:>4}    EUR{sub:>14,.2f}")
    print(f"{'-'*55}")
    print(f"  {'TOTAL':<12} {total:>6}    EUR{grand:>14,.2f}")
    print(f"\n  Contract value (project): EUR 5,347,965.00")
    diff = grand - 5347965
    print(f"  Difference from contract: EUR{diff:>+,.2f}")

    con.close()
    print(f"\nImport complete -> {DB}")

if __name__ == "__main__":
    main()
