const express  = require('express');
const multer   = require('multer');
const XLSX     = require('xlsx');
const path     = require('path');
const { DatabaseSync } = require('node:sqlite');

const router   = express.Router();
const DB_PATH  = require('../db-path');
const upload   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function cellVal(sheet, r, c) {
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  if (!cell) return null;
  if (cell.t === 'n' && cell.z && cell.z.toLowerCase().includes('d')) return cell.w; // date formatted
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

// Find which row contains the header, searching rows 0..maxRow
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

// Map column aliases to their index in a header row
function mapCols(sheet, headerRow, aliases) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const result = {};
  for (const [field, aliasList] of Object.entries(aliases)) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 40); c++) {
      const v = norm(cellStr(sheet, headerRow, c));
      if (aliasList.some(a => v.includes(a) || a.includes(v) && v.length > 2)) {
        if (!(field in result)) result[field] = c;
      }
    }
  }
  return result;
}

// Excel serial date â†’ YYYY-MM-DD
function excelDateToISO(serial) {
  if (!serial || isNaN(serial)) return null;
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}

function isDateSerial(v) {
  return typeof v === 'number' && v > 40000 && v < 60000; // roughly 2009-2064
}

// â”€â”€ Parser: Folan Civil â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Headers around row 5 (0-indexed 4): Item | Description | Qty | Unit | Rates | BOQ Value | Qty Complete | Rate
// Returns { items: [{ref, description, qty_contracted, rate, boq_value, qty_complete}], weekEnding }
function parseFolanCivil(sheet, weekEnding) {
  const hdRow = findHeaderRow(sheet, ['description', 'qty'], 12);
  if (hdRow < 0) return { error: 'Header row not found', items: [] };

  const aliases = {
    ref:          ['item', 'ref', 'item ref', 'item no'],
    description:  ['description', 'desc'],
    qty:          ['qty', 'quantity'],
    unit:         ['unit'],
    rate:         ['rate', 'rates', 'unit rate'],
    boq_value:    ['boq value', 'boq', 'value', 'amount'],
    qty_complete: ['qty complete', 'qty comp', 'qty to date', '% complete'],
  };
  const cols = mapCols(sheet, hdRow, aliases);

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  let totalAmount = 0;

  for (let r = hdRow + 1; r <= range.e.r; r++) {
    const desc = cellStr(sheet, r, cols.description ?? 1);
    if (!desc || /total|sub-?total/i.test(desc)) continue;
    const qtyComplete = cols.qty_complete != null ? (cellNum(sheet, r, cols.qty_complete) ?? 0) : 0;
    const rate        = cols.rate != null         ? (cellNum(sheet, r, cols.rate) ?? 0)         : 0;
    const boqVal      = cols.boq_value != null    ? (cellNum(sheet, r, cols.boq_value) ?? 0)    : 0;
    // Value this assessment = qty_complete Ã— rate; if boq_value given, it's the contract total
    const itemAmount  = qtyComplete * rate;
    totalAmount += itemAmount;
  }

  return { amount: Math.round(totalAmount * 100) / 100, weekEnding };
}

// â”€â”€ Parser: Right Group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Headers around row 5: Description | Qty | Unit | Rate | Amount | Comment
function parseRightGroup(sheet, weekEnding) {
  const hdRow = findHeaderRow(sheet, ['description', 'amount'], 12);
  if (hdRow < 0) return { error: 'Header row not found', amount: 0 };

  const aliases = {
    description: ['description', 'desc'],
    qty:         ['qty', 'quantity'],
    rate:        ['rate', 'unit rate'],
    amount:      ['amount', 'amt', 'value', 'total'],
  };
  const cols = mapCols(sheet, hdRow, aliases);
  if (cols.amount == null) return { error: 'Amount column not found', amount: 0 };

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  let totalAmount = 0;

  for (let r = hdRow + 1; r <= range.e.r; r++) {
    const desc = cellStr(sheet, r, cols.description ?? 0);
    if (!desc || /^total|^sub.?total/i.test(desc)) continue;
    const amt = cellNum(sheet, r, cols.amount) ?? 0;
    // Only include positive item amounts (skip summary/total rows)
    if (amt > 0) totalAmount += amt;
  }

  return { amount: Math.round(totalAmount * 100) / 100, weekEnding };
}

// â”€â”€ Parser: Weekly columns (RPS Costs, CarlowT) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Row ~2: "Week Ending" date headers
// Row ~4: sub-headers Qty | Unit | Rate | Sum | ... | Amount per week column group
function parseWeeklyColumns(sheet, subName) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const results = []; // [{weekEnding, amount}]

  // Find row with "Week Ending" or date serials
  let weRow = -1;
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    let dateCols = 0;
    for (let c = 1; c <= Math.min(range.e.c, 60); c++) {
      const v = cellVal(sheet, r, c);
      if (isDateSerial(v)) dateCols++;
    }
    if (dateCols >= 2) { weRow = r; break; }
    // Or look for "Week Ending" label row
    const rowText = [];
    for (let c = 0; c < 5; c++) rowText.push(norm(cellStr(sheet, r, c)));
    if (rowText.some(t => t.includes('week ending') || t.includes('week end') || t.includes('w/e'))) {
      weRow = r; break;
    }
  }
  if (weRow < 0) return results;

  // Find sub-header row (should have 'amount' or 'qty' appearing multiple times)
  let subHdRow = -1;
  for (let r = weRow + 1; r <= Math.min(weRow + 5, range.e.r); r++) {
    const rowNorms = [];
    for (let c = 1; c <= Math.min(range.e.c, 60); c++) rowNorms.push(norm(cellStr(sheet, r, c)));
    const amtCount = rowNorms.filter(v => v.includes('amount') || v.includes('amt')).length;
    if (amtCount >= 1) { subHdRow = r; break; }
  }

  // Discover WE columns: scan weRow for date serials
  // Each WE block has several sub-columns; find the "Amount" column in each block
  const weekBlocks = []; // {weekEnding, amountCol}

  for (let c = 1; c <= range.e.c; c++) {
    const v = cellVal(sheet, weRow, c);
    if (!isDateSerial(v)) continue;
    const we = excelDateToISO(v);
    if (!we) continue;

    // Look for Amount column in subHdRow, scanning columns c..c+10
    let amtCol = -1;
    if (subHdRow >= 0) {
      for (let sc = c; sc <= Math.min(c + 10, range.e.c); sc++) {
        const sh = norm(cellStr(sheet, subHdRow, sc));
        if (sh.includes('amount') || sh.includes('amt')) {
          // Make sure this isn't a later WE's block (check weRow has no date in between)
          let blocked = false;
          for (let bc = c + 1; bc < sc; bc++) {
            if (isDateSerial(cellVal(sheet, weRow, bc))) { blocked = true; break; }
          }
          if (!blocked) { amtCol = sc; break; }
        }
      }
    }
    weekBlocks.push({ weekEnding: we, amtCol });
  }

  // Find data rows: rows after subHdRow where there's a description in col 0
  const dataStartRow = subHdRow >= 0 ? subHdRow + 1 : weRow + 2;

  for (const { weekEnding, amtCol } of weekBlocks) {
    if (amtCol < 0) continue;
    let total = 0;
    for (let r = dataStartRow; r <= range.e.r; r++) {
      const rowDesc = cellStr(sheet, r, 0) || cellStr(sheet, r, 1);
      if (/^total|^sub.?total|^grand/i.test(rowDesc)) continue;
      const amt = cellNum(sheet, r, amtCol) ?? 0;
      total += amt;
    }
    if (total !== 0) results.push({ weekEnding, amount: Math.round(total * 100) / 100 });
  }

  return results;
}

// â”€â”€ Parser: Misc Subcons (multiple subs with "Subbie" label rows) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Row ~2: WE date headers
// "Subbie" marker rows divide sections; each section = one sub
function parseMiscSubcons(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const allResults = []; // [{subName, weekEnding, amount}]

  // Find WE row (same as parseWeeklyColumns)
  let weRow = -1;
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    let dateCols = 0;
    for (let c = 1; c <= Math.min(range.e.c, 60); c++) {
      if (isDateSerial(cellVal(sheet, r, c))) dateCols++;
    }
    if (dateCols >= 2) { weRow = r; break; }
  }
  if (weRow < 0) return allResults;

  // Collect week ending â†’ column index for "Amount" sub-columns
  // Sub-header row (weRow+2 typically): has Qty/Inv | Amount pairs
  let subHdRow = weRow + 1;
  for (let r = weRow + 1; r <= Math.min(weRow + 4, range.e.r); r++) {
    const rowNorms = [];
    for (let c = 0; c <= Math.min(range.e.c, 60); c++) rowNorms.push(norm(cellStr(sheet, r, c)));
    if (rowNorms.filter(v => v.includes('amount')).length >= 1) { subHdRow = r; break; }
  }

  // Build WE â†’ amtCol map
  const weAmtMap = []; // [{weekEnding, amtCol}]
  for (let c = 1; c <= range.e.c; c++) {
    const v = cellVal(sheet, weRow, c);
    if (!isDateSerial(v)) continue;
    const we = excelDateToISO(v);
    if (!we) continue;
    // Find Amount col in subHdRow within next 5 cols
    for (let sc = c; sc <= Math.min(c + 5, range.e.c); sc++) {
      const sh = norm(cellStr(sheet, subHdRow, sc));
      if (sh.includes('amount') || sh.includes('amt')) {
        weAmtMap.push({ weekEnding: we, amtCol: sc });
        break;
      }
    }
  }

  // Scan data rows for "Subbie" labels and group rows by sub
  const dataStart = subHdRow + 1;
  let currentSub = null;
  const subSections = []; // [{subName, rows: [rowIdx]}]

  for (let r = dataStart; r <= range.e.r; r++) {
    const c0 = norm(cellStr(sheet, r, 0));
    const c1 = norm(cellStr(sheet, r, 1));
    // "Subbie" marker: first cell = "subbie" or similar
    if (c0.includes('subbie') || c0.includes('sub contractor') || c0.includes('subcontractor')) {
      // Sub name is in next column
      const nameCell = cellStr(sheet, r, 1) || cellStr(sheet, r, 2);
      currentSub = nameCell || `Sub_${subSections.length + 1}`;
      subSections.push({ subName: currentSub, rows: [] });
    } else if (currentSub && !c0.includes('total') && (c1 || c0)) {
      subSections[subSections.length - 1].rows.push(r);
    }
  }

  for (const { subName, rows } of subSections) {
    for (const { weekEnding, amtCol } of weAmtMap) {
      let total = 0;
      for (const r of rows) {
        total += cellNum(sheet, r, amtCol) ?? 0;
      }
      if (total !== 0) allResults.push({ subName, weekEnding, amount: Math.round(total * 100) / 100 });
    }
  }

  return allResults;
}

// â”€â”€ POST /projects/:pid/import/sub-excel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/projects/:pid/import/sub-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
  const sourceFile = req.file.originalname;
  const projectId  = req.params.pid;

  // Tab name â†’ parser config
  // weekEnding from req.body if caller provides it (for Folan Civil / Right Group lump sheets)
  const { week_ending } = req.body; // optional override for lump-sum sheets

  const importedRows = []; // {subName, weekEnding, amount}
  const warnings = [];

  const SUB_TABS = {
    'Folan Civil':  'folan',
    'Right Group':  'rightgroup',
    'RPS Costs':    'weekly',
    'CarlowT':      'weekly',
    'Misc Subcons': 'misc',
  };

  for (const [tabName, format] of Object.entries(SUB_TABS)) {
    const sheet = workbook.Sheets[tabName];
    if (!sheet) { warnings.push(`Sheet "${tabName}" not found â€” skipped`); continue; }

    if (format === 'folan') {
      const we = week_ending || new Date().toISOString().slice(0, 10);
      const { amount, error } = parseFolanCivil(sheet, we);
      if (error) warnings.push(`Folan Civil: ${error}`);
      else if (amount > 0) importedRows.push({ subName: 'Folan Civil', weekEnding: we, amount });
    }

    else if (format === 'rightgroup') {
      const we = week_ending || new Date().toISOString().slice(0, 10);
      const { amount, error } = parseRightGroup(sheet, we);
      if (error) warnings.push(`Right Group: ${error}`);
      else if (amount > 0) importedRows.push({ subName: 'Right Group', weekEnding: we, amount });
    }

    else if (format === 'weekly') {
      const rows = parseWeeklyColumns(sheet, tabName);
      if (rows.length === 0) warnings.push(`${tabName}: no weekly data found`);
      rows.forEach(r => importedRows.push({ subName: tabName, weekEnding: r.weekEnding, amount: r.amount }));
    }

    else if (format === 'misc') {
      const rows = parseMiscSubcons(sheet);
      if (rows.length === 0) warnings.push(`Misc Subcons: no data found`);
      rows.forEach(r => importedRows.push({ subName: r.subName, weekEnding: r.weekEnding, amount: r.amount }));
    }
  }

  // Persist
  const con = db();
  con.exec('BEGIN');
  try {
    const stmt = con.prepare(`
      INSERT INTO excel_sub_cost (project_id, sub_name, week_ending, amount, source_file)
      VALUES (?,?,?,?,?)
      ON CONFLICT(project_id, sub_name, week_ending) DO UPDATE SET
        amount=excluded.amount, source_file=excluded.source_file,
        imported_at=strftime('%Y-%m-%dT%H:%M:%S','now')
    `);
    for (const row of importedRows) {
      stmt.run(projectId, row.subName, row.weekEnding, row.amount, sourceFile);
    }
    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, imported: importedRows.length, rows: importedRows, warnings });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// â”€â”€ GET /projects/:pid/import/sub-excel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// List what's been imported
router.get('/projects/:pid/import/sub-excel', (req, res) => {
  const con = db();
  const rows = con.prepare(`
    SELECT sub_name, week_ending, amount, source_file, imported_at
    FROM excel_sub_cost
    WHERE project_id=?
    ORDER BY week_ending DESC, sub_name
  `).all(req.params.pid);
  con.close();
  res.json(rows);
});

// Error handler
router.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, code: err.code || 'ERROR' });
});

module.exports = router;
