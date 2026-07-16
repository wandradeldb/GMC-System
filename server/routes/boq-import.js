const express  = require('express');
const multer   = require('multer');
const XLSX     = require('xlsx');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

// ── cell/header helpers (mirrors server/routes/import.js) ──────────────────

function cellVal(sheet, r, c) {
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  if (!cell) return null;
  if (cell.t === 'n' && cell.z && cell.z.toLowerCase().includes('d')) return cell.w;
  return cell.v ?? null;
}

function cellStr(sheet, r, c) {
  const v = cellVal(sheet, r, c);
  return v == null ? '' : String(v).trim();
}

function cellNum(sheet, r, c) {
  const v = cellVal(sheet, r, c);
  if (v == null || v === '' || isNaN(Number(v))) return null;
  return Number(v);
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9%\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findHeaderRow(sheet, mustContain, maxRow = 12) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let r = 0; r <= Math.min(maxRow, range.e.r); r++) {
    const rowNorms = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, 30); c++) {
      rowNorms.push(norm(cellStr(sheet, r, c)));
    }
    const joined = rowNorms.join(' ');
    if (mustContain.every(kw => joined.includes(kw))) return r;
  }
  return -1;
}

function mapCols(sheet, headerRow, aliases) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const result = {};
  // Pass 1: exact match (normalized header cell === one of the aliases). Resolving exact
  // matches first prevents a short header like "Unit" from being fuzzy-claimed by a longer
  // alias of another field (e.g. rate's "unit rate" alias contains the substring "unit").
  for (let c = range.s.c; c <= Math.min(range.e.c, 40); c++) {
    const v = norm(cellStr(sheet, headerRow, c));
    if (!v) continue;
    for (const [field, aliasList] of Object.entries(aliases)) {
      if (field in result) continue;
      if (aliasList.includes(v)) result[field] = c;
    }
  }
  // Pass 2: fuzzy substring match for anything still unresolved, skipping columns already claimed.
  const claimed = new Set(Object.values(result));
  for (let c = range.s.c; c <= Math.min(range.e.c, 40); c++) {
    if (claimed.has(c)) continue;
    const v = norm(cellStr(sheet, headerRow, c));
    if (!v) continue;
    for (const [field, aliasList] of Object.entries(aliases)) {
      if (field in result) continue;
      if (aliasList.some(a => v.includes(a) || (a.includes(v) && v.length > 2))) result[field] = c;
    }
  }
  return result;
}

// ── BOQ column alias map ────────────────────────────────────────────────────

const BOQ_ALIASES = {
  item_ref:     ['item ref', 'item no', 'ref', 'item'],
  description:  ['description', 'desc', 'item description'],
  unit:         ['unit', 'uom'],
  qty:          ['qty', 'quantity'],
  rate:         ['rate', 'unit rate', 'rate eur'],
  amount:       ['amount', 'total', 'value', 'sum', 'contract sum', 'boq value'],
  section:      ['section', 'sub section', 'subsection'],
  iw_cost_code: ['iw cost code', 'cost code', 'code'],
  schedule:     ['schedule', 'sched'],
};

const VALID_TYPES = ['F', 'T', 'M'];

// Shared row-classification logic, driven by a generic cell getter so it can be reused
// against an XLSX sheet (excel path) or an array-of-arrays (paste path, see boqPaste.js on the client).
function classifyRows(rowCount, getCell, cols, { schedule: formSchedule, type: formType }, batchTs) {
  const rows = [];
  const warnings = [];
  let sortOrder = 0;

  for (let r = 0; r < rowCount; r++) {
    const description = cols.description != null ? String(getCell(r, cols.description) ?? '').trim() : '';
    const rawItemRef   = cols.item_ref != null ? String(getCell(r, cols.item_ref) ?? '').trim() : '';

    if (!description && !rawItemRef) continue; // fully blank row
    if (/total|carried forward/i.test(description) || /total|carried forward/i.test(rawItemRef)) continue;

    if (!description) {
      warnings.push(`Row ${r + 1} skipped: no description`);
      continue;
    }

    let qty  = cols.qty != null ? numOrNull(getCell(r, cols.qty)) : null;
    let rate = cols.rate != null ? numOrNull(getCell(r, cols.rate)) : null;

    if (qty == null) {
      const amount = cols.amount != null ? numOrNull(getCell(r, cols.amount))
        : (rate != null ? rate : null);
      if (amount != null) {
        qty = 1;
        rate = amount;
        warnings.push(`Row ${r + 1}: no qty column — treated as lump sum`);
      } else {
        warnings.push(`Row ${r + 1} skipped: no qty/rate/amount value found`);
        continue;
      }
    }
    if (rate == null) {
      warnings.push(`Row ${r + 1}: no rate found — defaulted to 0`);
      rate = 0;
    }

    const item_ref = rawItemRef || `AUTO-${batchTs}-${rows.length + 1}`;

    let type = cols.type != null ? String(getCell(r, cols.type) ?? '').trim().toUpperCase() : '';
    if (!VALID_TYPES.includes(type)) type = VALID_TYPES.includes(formType) ? formType : 'M';

    const section  = cols.section != null ? (String(getCell(r, cols.section) ?? '').trim() || null) : null;
    const schedule = cols.schedule != null
      ? (String(getCell(r, cols.schedule) ?? '').trim() || formSchedule)
      : formSchedule;
    const iw_cost_code = cols.iw_cost_code != null
      ? (String(getCell(r, cols.iw_cost_code) ?? '').trim() || null)
      : null;

    rows.push({
      item_ref, description, unit: cols.unit != null ? String(getCell(r, cols.unit) ?? '').trim() : '',
      qty, rate, section, type, iw_cost_code, schedule,
      sort_order: sortOrder++,
      contract_sum: Math.round(qty * rate * 100) / 100,
    });
  }

  return { rows, warnings };
}

function numOrNull(v) {
  if (v == null || v === '' || isNaN(Number(v))) return null;
  return Number(v);
}

// ── Full-contract-sheet alias map & parser ──────────────────────────────────
// For "one sheet, many bills" exports (e.g. an "Itemised Bill" tab covering the whole contract):
// bills (schedules) are separated by "Bill NNN <Name>" / "Page Total NNN/<page>" marker rows rather
// than being one sheet per schedule, and section names appear as their own text-only rows.

const FULL_SHEET_ALIASES = {
  item_ref:     ['item'],
  iw_cost_code: ['pd ref', 'pd', 'cost code'],
  description:  ['description'],
  qty:          ['qty', 'quantity'],
  unit:         ['unit'],
  rate:         ['rate'],
  amount:       ['summary', 'amount', 'total'],
  section:      ['section', 'category'],
};

const BILL_START_RE = /^bill\s+(\d+)\s*(.*)$/i;
const PAGE_TOTAL_RE = /^page total\s+(\d+)/i;
const TOTAL_MARKER_RE = /^total\b/i; // e.g. "Total Prelim Time" — a bill-end subtotal row, not a real section title

// Validates that columns are in the expected REV1 order: Item → PD Ref → Description → Qty → Unit → Rate → Amount → Section
// Rejects if Section appears before Qty (REV2 misturado layout).
function validateColumnOrder(cols, headerRow) {
  const order = {};
  for (const [field, colIdx] of Object.entries(cols)) {
    if (colIdx != null) order[field] = colIdx;
  }

  // REV1 standard: Section should be last (rightmost), after Amount/Rate/Unit/Qty.
  const criticalFields = ['qty', 'unit', 'rate', 'section'];
  const present = criticalFields.filter(f => f in order);

  if (present.length >= 2) {
    const sectionCol = order.section;
    const qtyCol = order.qty;
    const unitCol = order.unit;
    const rateCol = order.rate;

    // If Section is present AND appears before Qty, Unit, or Rate, it's the misturado layout
    if (sectionCol != null && qtyCol != null && sectionCol < qtyCol) {
      return {
        valid: false,
        error: `Column order is incorrect (REV2 misturado). Section column is at position ${sectionCol + 1}, but should be last (after Qty/Unit/Rate).\n\nExpected order:\n1. Ref/Item\n2. PD Ref\n3. Description\n4. Qty\n5. Unit\n6. Rate\n7. Total\n8. Section\n\nPlease rearrange your columns or use the REV1 template.`,
        code: 'INVALID_COLUMN_ORDER'
      };
    }
    if (sectionCol != null && unitCol != null && sectionCol < unitCol) {
      return {
        valid: false,
        error: `Column order is incorrect (REV2 misturado). Section column is at position ${sectionCol + 1}, but should be last (after Unit).\n\nExpected order:\n1. Ref/Item\n2. PD Ref\n3. Description\n4. Qty\n5. Unit\n6. Rate\n7. Total\n8. Section`,
        code: 'INVALID_COLUMN_ORDER'
      };
    }
    if (sectionCol != null && rateCol != null && sectionCol < rateCol) {
      return {
        valid: false,
        error: `Column order is incorrect (REV2 misturado). Section column is at position ${sectionCol + 1}, but should be last (after Rate).\n\nExpected order:\n1. Ref/Item\n2. PD Ref\n3. Description\n4. Qty\n5. Unit\n6. Rate\n7. Total\n8. Section`,
        code: 'INVALID_COLUMN_ORDER'
      };
    }
  }

  return { valid: true };
}

// Reads the common data-row fields (item_ref, iw_cost_code/PD Ref, qty, rate). Returns null for
// rows that carry no usable qty/rate/amount (caller skips with a warning).
function readDataRow(sheet, r, cols, batchTs, autoRefState) {
  const qty  = cols.qty != null ? numOrNull(cellVal(sheet, r, cols.qty)) : null;
  let rate   = cols.rate != null ? numOrNull(cellVal(sheet, r, cols.rate)) : null;
  const amount = cols.amount != null ? numOrNull(cellVal(sheet, r, cols.amount)) : null;

  let finalQty = qty;
  if (finalQty == null) {
    if (amount != null) { finalQty = 1; rate = amount; }
    else return null;
  }
  if (rate == null) {
    if (amount != null && finalQty) rate = amount / finalQty;
    else rate = 0;
  }

  // Item ref / PD Ref: when a header explicitly labeled one, cols.item_ref/iw_cost_code are fixed
  // column indices, used directly. When neither had a header (REV1's common unlabeled-prefix
  // layout), how many real columns sit there can vary bill-by-bill within the same sheet — e.g. a
  // real file's Civil Works bill has both (Item "2.1", PD Ref "2.1.1", the latter often repeated
  // across several rows), while its Prelim Fixed/Time bills have only Item ("1.2.1") with a
  // meaningless running-count column where PD Ref would be. Decided per row: the standard
  // two-column layout (Item at left2Col, PD Ref at leftCol) is trusted UNLESS left2Col holds a
  // non-blank value that isn't itself a hierarchical ref — that only happens when there's really
  // just one ref column, immediately left of Description (leftCol), and no PD Ref at all.
  let rawItemRef, iw_cost_code;
  if (cols.itemRefAmbiguous) {
    const leftVal  = cols.leftCol  >= 0 ? String(cellVal(sheet, r, cols.leftCol)  ?? '').trim() : '';
    const left2Val = cols.left2Col >= 0 ? String(cellVal(sheet, r, cols.left2Col) ?? '').trim() : '';
    if (left2Val && !/^\d+(\.\d+){1,}$/.test(left2Val)) {
      rawItemRef = leftVal;
      iw_cost_code = null;
    } else {
      rawItemRef = left2Val;
      iw_cost_code = leftVal || null;
    }
  } else {
    rawItemRef = cols.item_ref != null ? String(cellVal(sheet, r, cols.item_ref) ?? '').trim() : '';
    iw_cost_code = cols.iw_cost_code != null
      ? (String(cellVal(sheet, r, cols.iw_cost_code) ?? '').trim() || null)
      : null;
  }
  const item_ref = rawItemRef || `AUTO-${batchTs}-${++autoRefState.n}`;

  return { item_ref, iw_cost_code, qty: finalQty, rate, contract_sum: Math.round(finalQty * rate * 100) / 100 };
}

function parseFullSheet(sheet, headerRow, cols, batchTs) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const rows = [];
  const scheduleMap = new Map(); // schedule -> {schedule,label,itemCount,subtotal}
  const warnings = [];
  const autoRefState = { n: 0 };

  let currentSection = null; // carried-forward sub-section header text
  let sortOrder = 0;

  const bumpSchedule = (schedule, label, subtotal) => {
    const existing = scheduleMap.get(schedule);
    if (existing) {
      existing.itemCount += 1;
      existing.subtotal = Math.round((existing.subtotal + subtotal) * 100) / 100;
      if (!existing.label && label) existing.label = label;
    } else {
      scheduleMap.set(schedule, { schedule, label: label || '', itemCount: 1, subtotal: Math.round(subtotal * 100) / 100 });
    }
  };

  // ── REV1 standard: an explicit Section column gives the category per row ──
  if (cols.section != null) {
    let prevSchedule = null;
    // Some source files wrap a single item's own (long) description onto its own row, with the
    // qty/unit/rate on the very next row — indistinguishable from a real multi-item sub-section
    // title by position alone. Track the most recent title-only row so an immediately-following
    // row with values but no description of its own can borrow that text as ITS description,
    // rather than being rejected as invalid and without leaving the title stuck as the section
    // header for whatever comes after (sectionBeforeLabel restores the real prior section).
    let pendingLabel = null;
    let pendingLabelRow = -1;
    let sectionBeforeLabel = null;

    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const description = cols.description != null ? String(cellVal(sheet, r, cols.description) ?? '').trim() : '';
      const unit = cols.unit != null ? String(cellVal(sheet, r, cols.unit) ?? '').trim() : '';
      if (!description && !unit) continue;

      if (!unit) {
        // marker / sub-section-title row (no unit). Skip bill/page-total/subtotal noise; carry sub-section text.
        if (description && !BILL_START_RE.test(description) && !PAGE_TOTAL_RE.test(description) && !TOTAL_MARKER_RE.test(description)) {
          sectionBeforeLabel = currentSection;
          currentSection = description;
          pendingLabel = description;
          pendingLabelRow = r;
        }
        continue;
      }

      const data = readDataRow(sheet, r, cols, batchTs, autoRefState);
      if (!data) { warnings.push(`Row ${r + 1} skipped: no qty/rate/amount value found`); continue; }

      const schedule = String(cellVal(sheet, r, cols.section) ?? '').trim();
      if (!schedule) { warnings.push(`Row ${r + 1} skipped: blank Section`); continue; }

      // A leftover sub-section title from the previous bill/schedule should never carry across
      // into the next one — reset it the moment the Section-column value changes.
      if (prevSchedule !== null && schedule !== prevSchedule) currentSection = null;
      prevSchedule = schedule;

      let rowDescription = description;
      if (!rowDescription && pendingLabelRow === r - 1) {
        rowDescription = pendingLabel;
        currentSection = sectionBeforeLabel;
      }
      if (!rowDescription) { warnings.push(`Row ${r + 1} skipped: no description found`); continue; }

      rows.push({
        ...data, description: rowDescription, unit, section: currentSection, type: 'M',
        schedule, sort_order: sortOrder++,
      });
      bumpSchedule(schedule, schedule, data.qty * data.rate);
    }
    return { rows, schedules: [...scheduleMap.values()].sort((a, b) => a.schedule.localeCompare(b.schedule)), warnings, sectioned: true };
  }

  // ── Fallback: no Section column — split by "Bill NNN" / "Page Total NNN" markers ──
  let billName = null;
  let billBuffer = [];
  const flushBill = (schedule) => {
    if (billBuffer.length === 0) { billName = null; return; }
    for (const row of billBuffer) {
      row.schedule = schedule;
      rows.push(row);
      bumpSchedule(schedule, billName, row.qty * row.rate);
    }
    billBuffer = [];
    billName = null;
  };

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const description = cols.description != null ? String(cellVal(sheet, r, cols.description) ?? '').trim() : '';
    const unit = cols.unit != null ? String(cellVal(sheet, r, cols.unit) ?? '').trim() : '';
    if (!description && !unit) continue;

    const billMatch = BILL_START_RE.exec(description);
    if (billMatch) { billName = billMatch[2].trim() || null; currentSection = null; continue; }
    const pageTotalMatch = PAGE_TOTAL_RE.exec(description);
    if (pageTotalMatch) { flushBill(pageTotalMatch[1]); currentSection = null; continue; }

    if (!unit) { if (description && !TOTAL_MARKER_RE.test(description)) currentSection = description; continue; }

    const data = readDataRow(sheet, r, cols, batchTs, autoRefState);
    if (!data) { warnings.push(`Row ${r + 1} skipped: no qty/rate/amount value found`); continue; }

    billBuffer.push({ ...data, description, unit, section: currentSection, type: 'M', sort_order: sortOrder++ });
  }

  if (billBuffer.length > 0) {
    warnings.push(`${billBuffer.length} row(s) had no closing "Page Total" marker — check the source file`);
    flushBill('UNASSIGNED');
  }

  return { rows, schedules: [...scheduleMap.values()], warnings, sectioned: false };
}

// ── POST /projects/:pid/boq-import/parse-excel ──────────────────────────────

router.post('/projects/:pid/boq-import/parse-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });

  const { schedule, type } = req.body || {};
  if (!schedule || !String(schedule).trim()) {
    return res.status(400).json({ error: 'Schedule is required (column or manual field)', code: 'MISSING_SCHEDULE' });
  }

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    return res.status(400).json({ error: 'Could not read file as Excel', code: 'BAD_FILE' });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return res.status(400).json({ error: 'Workbook has no sheets', code: 'NO_SHEET' });

  const headerRow = findHeaderRow(sheet, ['description'], 12);
  if (headerRow < 0) {
    return res.status(400).json({ error: 'Could not find a Description column', code: 'NO_HEADER' });
  }
  const cols = mapCols(sheet, headerRow, BOQ_ALIASES);
  if (cols.description == null) {
    return res.status(400).json({ error: 'Could not find a Description column', code: 'NO_HEADER' });
  }

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const dataRowCount = range.e.r - headerRow; // rows after header, 0-indexed offset from headerRow+1
  const getCell = (offset, c) => cellVal(sheet, headerRow + 1 + offset, c);

  const batchTs = Date.now();
  const { rows, warnings } = classifyRows(dataRowCount, getCell, cols, { schedule, type }, batchTs);

  res.json({ rows, warnings, source_file: req.file.originalname, sheet_used: sheetName });
});

// ── POST /projects/:pid/boq-import/parse-excel-full ─────────────────────────
// "One sheet, many bills" layout — no schedule/type needed upfront, both are derived per row.

router.post('/projects/:pid/boq-import/parse-excel-full', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    return res.status(400).json({ error: 'Could not read file as Excel', code: 'BAD_FILE' });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return res.status(400).json({ error: 'Workbook has no sheets', code: 'NO_SHEET' });

  const headerRow = findHeaderRow(sheet, ['description'], 12);
  if (headerRow < 0) {
    return res.status(400).json({ error: 'Could not find a Description column', code: 'NO_HEADER' });
  }
  const cols = mapCols(sheet, headerRow, FULL_SHEET_ALIASES);
  if (cols.description == null || cols.unit == null) {
    return res.status(400).json({ error: 'Could not find Description/Unit columns', code: 'NO_HEADER' });
  }

  // The REV1 "standard" layout puts the "Section" header one row *above* the main header row, and
  // leaves the Item / PD Ref columns unlabeled. Recover both:
  //  - Section: scan the row above the header row for the section alias.
  if (cols.section == null && headerRow > 0) {
    const above = mapCols(sheet, headerRow - 1, { section: FULL_SHEET_ALIASES.section });
    if (above.section != null) cols.section = above.section;
  }
  //  - Item / PD Ref: unlabeled column(s) immediately left of Description. Some bills in a REV1
  //    sheet have two (Item, then PD Ref); others (seen in real files: Prelim Fixed/Time) have
  //    just one (Item only, no PD Ref at all) — and this can differ bill-by-bill within the same
  //    sheet, so it can't be decided once for the whole file. Flag it as ambiguous here; readDataRow
  //    resolves it per row by checking whether the column right before Description holds a
  //    hierarchical ref like "1.2.1" (making it Item, with no PD Ref column) or not (two-column
  //    fallback: Item one column further left, PD Ref immediately before Description).
  if (cols.item_ref == null && cols.iw_cost_code == null) {
    cols.itemRefAmbiguous = true;
    cols.leftCol  = cols.description - 1;
    cols.left2Col = cols.description - 2;
  } else {
    if (cols.iw_cost_code == null && cols.description - 1 >= 0) cols.iw_cost_code = cols.description - 1;
    if (cols.item_ref == null && cols.description - 2 >= 0)     cols.item_ref     = cols.description - 2;
  }

  // Validate that columns are in the correct REV1 order (reject misturado layouts)
  const orderCheck = validateColumnOrder(cols, headerRow);
  if (!orderCheck.valid) {
    return res.status(400).json({ error: orderCheck.error, code: orderCheck.code });
  }

  const batchTs = Date.now();
  const { rows, schedules, warnings, sectioned } = parseFullSheet(sheet, headerRow, cols, batchTs);

  if (rows.length === 0) {
    return res.status(400).json({ error: 'No data rows found', code: 'NO_ROWS' });
  }

  res.json({ rows, schedules, warnings, sectioned, source_file: req.file.originalname, sheet_used: sheetName });
});

// ── POST /projects/:pid/boq-import/commit ───────────────────────────────────

router.post('/projects/:pid/boq-import/commit', (req, res) => {
  const { rows, schedule, type } = req.body || {};
  const projectId = req.params.pid;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import', code: 'EMPTY' });
  }

  const badRows = [];
  rows.forEach((row, i) => {
    if (!row.description || !String(row.description).trim()) badRows.push(i);
    else if (!row.unit || !String(row.unit).trim()) badRows.push(i);
    else if (!(row.qty >= 0) || !(row.rate >= 0)) badRows.push(i);
  });
  if (badRows.length) {
    return res.status(400).json({
      error: `Rows failing validation (missing description/unit or negative qty/rate): ${badRows.map(i => i + 1).join(', ')}`,
      code: 'INVALID_ROWS',
    });
  }

  // NOTE: boq_item has no UNIQUE(project_id, item_ref) constraint on the live DB (schema.sql
  // documents one, but the deployed table predates it and Merlin Park already has ~20 duplicate
  // placeholder item_refs from the original Python import — adding the constraint would require a
  // data-cleanup migration, out of scope here). So this does an explicit find-then-branch instead
  // of an ON CONFLICT upsert, which works regardless of whether that constraint exists.
  const con = db();
  con.exec('BEGIN');
  try {
    const findAllStmt = con.prepare('SELECT id FROM boq_item WHERE project_id = ? AND item_ref = ?');
    const consumedIds = new Set(); // rows already matched earlier in this same batch — see below
    const insertStmt = con.prepare(`
      INSERT INTO boq_item
        (project_id, schedule, section, item_ref, description, unit, qty, rate, type, iw_cost_code, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    const updateStmt = con.prepare(`
      UPDATE boq_item SET
        schedule=?, section=?, description=?, unit=?, qty=?, rate=?, type=?, iw_cost_code=?, sort_order=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id=?
    `);

    let inserted = 0, updated = 0;
    for (const row of rows) {
      const rowType = VALID_TYPES.includes(row.type) ? row.type : (VALID_TYPES.includes(type) ? type : 'M');
      const rowSchedule = row.schedule || schedule || '';
      // item_ref isn't unique — some real source files repeat it across genuinely different lines
      // (e.g. two rows both "1.4.3"). Matching on item_ref alone would merge them into one row the
      // second time it's seen. Track which existing rows this batch has already claimed, so a
      // repeated item_ref in the SAME import creates a new row instead of overwriting the first.
      const candidates = findAllStmt.all(projectId, row.item_ref);
      const existing = candidates.find(c => !consumedIds.has(c.id));
      if (existing) {
        consumedIds.add(existing.id);
        updateStmt.run(
          rowSchedule, row.section || null, row.description, row.unit, row.qty || 0, row.rate || 0,
          rowType, row.iw_cost_code || null, row.sort_order ?? 0, existing.id
        );
        updated++;
      } else {
        const info = insertStmt.run(
          projectId, rowSchedule, row.section || null, row.item_ref,
          row.description, row.unit, row.qty || 0, row.rate || 0,
          rowType, row.iw_cost_code || null, row.sort_order ?? 0
        );
        consumedIds.add(Number(info.lastInsertRowid));
        inserted++;
      }
    }

    // Keep project.contract_value in sync with the BOQ — it's meant to always equal the sum of
    // all imported line items (see CLAUDE.md: Merlin Park's contract_value matches its BOQ total
    // exactly). Recomputed from the full table, not just this batch, so partial/per-schedule
    // imports still converge to the right figure once every schedule has been imported.
    const totalRow = con.prepare('SELECT COALESCE(SUM(qty*rate),0) AS t FROM boq_item WHERE project_id = ?').get(projectId);
    con.prepare('UPDATE project SET contract_value = ? WHERE id = ?').run(Math.round(totalRow.t * 100) / 100, projectId);

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, inserted, updated, total: rows.length });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    res.status(400).json({ error: e.message, code: 'COMMIT_FAILED' });
  }
});

// ── DELETE /projects/:pid/boq — wipe the entire Bill of Quantities for a project ────────────
// Also wipes revenue_activity/revenue_week: those are seeded 1:1 from the BOQ at import time
// (see ImportBOQModal's optional "Revenue Section"), so leaving them behind after a BOQ wipe
// would strand orphaned activities — stale contract_value/qty/rate that no longer match
// anything, inflating Revenue Generator's totals with numbers nobody can trace back to a BOQ line.

router.delete('/projects/:pid/boq', (req, res) => {
  const projectId = req.params.pid;
  const con = db();
  con.exec('BEGIN');
  try {
    con.prepare(`
      DELETE FROM revenue_week WHERE activity_id IN (SELECT id FROM revenue_activity WHERE project_id = ?)
    `).run(projectId);
    const { changes: deletedActivities } = con.prepare('DELETE FROM revenue_activity WHERE project_id = ?').run(projectId);
    const { changes } = con.prepare('DELETE FROM boq_item WHERE project_id = ?').run(projectId);
    con.prepare('UPDATE project SET contract_value = 0 WHERE id = ?').run(projectId);
    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, deleted: changes, deletedActivities });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    res.status(400).json({ error: e.message, code: 'DELETE_FAILED' });
  }
});

// Error handler
router.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, code: err.code || 'ERROR' });
});

module.exports = router;
