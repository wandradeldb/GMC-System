const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

// Direct "COST TYPE" column (seen in real exports, e.g. "PLANT", "MATERIALS", "Sub-contract") —
// this is the authoritative source when present. A transaction's TRANSTYPE alone isn't reliable:
// e.g. TRANSTYPE "POP" appears on both Plant and Material rows, distinguished only by COST TYPE.
function mapCostType(costType) {
  const t = (costType || '').toLowerCase().trim();
  if (!t) return null;
  if (t.includes('plant'))                            return 'Plant';
  if (t.includes('material') || t.includes('stores')) return 'Material';
  if (t.includes('agent'))                            return 'Labour';
  if (t.includes('overhead'))                         return 'Overhead';
  if (t.includes('sub'))                              return 'Sub';
  return null;
}

// Fallback heuristic for files with no COST TYPE column — map cost codes/trans type to category.
function deriveCategory(transType, costCode, costType) {
  const direct = mapCostType(costType);
  if (direct) return direct;
  const tt = (transType || '').toUpperCase();
  const cc = (costCode  || '').toLowerCase().trim();
  if (tt === 'PLANT' || tt === 'PLINV')               return 'Plant';
  if (cc === 'lab')                                   return 'Labour';
  if (cc === 'sal')                                   return 'Salary';
  if (cc.startsWith('oheads') || cc === 's05' || cc === 's06' || cc === 's07' || cc === 'scn' || cc.includes('overhead')) return 'Overhead';
  if (cc === 's04' || cc === 'tm')                    return 'Sub';
  if (cc === 'sun')                                   return 'Sundry';
  if (cc === 'pla' || cc === 'pl1' || cc === 'pl2' || cc === 'pl3' || cc === 's02') return 'Plant';
  if (cc === 'mat' || cc === 'm02' || cc === 'm03' || cc === 'm05') return 'Material';
  if (tt === 'POP')                                   return 'Material';
  return 'Other';
}

// Next Friday on/after the given ISO date — derives week_ending from trans_date when the source
// file has no dedicated WE/month/year columns at all (seen in real exports).
function nextFriday(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate + 'T12:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat, Friday=5
  d.setDate(d.getDate() + ((5 - day + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// Excel serial â†’ YYYY-MM-DD. date1904 must be passed for files that use Excel's 1904 date
// system (common in exports originating from older Mac Excel or some ERP/accounting systems) --
// XLSX.SSF.parse_date_code defaults to the 1900 system, and without this flag a 1904-system
// serial parses ~4 years off (day/month land close to correct, since the two epochs are ~1462
// days apart, but the year is wrong) -- which silently breaks every week_ending join against
// tracker_we downstream (buildTrackerReport in tracker.js matches on the full date string), even
// though the transaction list itself still looks right since day/month display fine.
function serialToISO(serial, date1904) {
  if (!serial || isNaN(serial)) return null;
  const d = XLSX.SSF.parse_date_code(Number(serial), date1904 ? { date1904: true } : undefined);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}

// â”€â”€ POST /projects/:pid/qs-costs/import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/projects/:pid/qs-costs/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });

  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);

  // Auto-detect the right sheet: check requested name first, then scan all sheets
  // for one containing the characteristic QS Cost headers
  const COST_HEADERS = ['cost', 'gangname', 'transactionid', 'transtype'];
  function sheetHasCostHeaders(s) {
    if (!s || !s['!ref']) return false;
    const r = XLSX.utils.decode_range(s['!ref']);
    for (let row = 0; row <= Math.min(10, r.e.r); row++) {
      const vals = [];
      for (let c = r.s.c; c <= Math.min(r.e.c, 30); c++) {
        const cell = s[XLSX.utils.encode_cell({ r: row, c })];
        if (cell) vals.push(String(cell.v).toLowerCase().replace(/\s/g, ''));
      }
      const joined = vals.join(' ');
      const hits = COST_HEADERS.filter(h => joined.includes(h)).length;
      if (hits >= 2) return true;
    }
    return false;
  }

  let sheetName = req.body.sheet || null;
  let sheet = sheetName ? wb.Sheets[sheetName] : null;

  if (!sheet || !sheetHasCostHeaders(sheet)) {
    // Try 'QS Costs' first
    for (const name of ['QS Costs', 'QSCosts', 'QS_Costs', 'Costs', 'Cost', ...wb.SheetNames]) {
      const s = wb.Sheets[name];
      if (s && sheetHasCostHeaders(s)) { sheet = s; sheetName = name; break; }
    }
  }

  if (!sheet) {
    return res.status(400).json({
      error: `No sheet with QS Cost columns found. Available sheets: ${wb.SheetNames.join(', ')}`,
      code: 'SHEET_NOT_FOUND'
    });
  }

  const range  = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const sourceFile = req.file.originalname;
  const projectId  = req.params.pid;

  // Find header row â€” look for row containing "TransactionID" or "GangName" or "Cost"
  let hdRow = -1;
  const COL = {};
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    const rowMap = {};
    for (let c = range.s.c; c <= Math.min(range.e.c, 30); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell) rowMap[String(cell.v).trim().toLowerCase()] = c;
    }
    if ('cost' in rowMap || 'transactionid' in rowMap || 'gangname' in rowMap) {
      hdRow = r;
      // Map expected columns by name
      const ALIASES = {
        transaction_id:  ['transactionid'],
        trans_date:      ['transdate', 'trandate'],
        agent_code:      ['agentcode'],
        agent_name:      ['agentname'],
        gang_no:         ['gangno'],
        gang_name:       ['gangname'],
        trans_type:      ['transtype'],
        cost_code:       ['costcode'],
        supplier_account:['supplieraccountnumber'],
        supplier_name:   ['supplieraccountname'],
        stock_item_text: ['stockitemtext'],
        document_ref:    ['documentreference'],
        plant_desc:      ['plantdescription'],
        unit_value:      ['unitvalue'],
        qty:             ['actualquantity'],
        cost:            ['cost'],
        cost_type:       ['cost type'],
        week_ending:     ['we'],
        month:           ['month'],
        year:            ['year'],
      };
      for (const [field, names] of Object.entries(ALIASES)) {
        for (const n of names) {
          if (n in rowMap) { COL[field] = rowMap[n]; break; }
        }
      }
      break;
    }
  }

  if (hdRow < 0) return res.status(400).json({ error: 'Header row not found in sheet', code: 'NO_HEADER' });

  const rows = [];
  for (let r = hdRow + 1; r <= range.e.r; r++) {
    const get = c => {
      if (c == null) return null;
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      return cell ? cell.v : null;
    };
    const getStr = c => { const v = get(c); return v != null ? String(v).trim() : null; };
    const getNum = c => { const v = get(c); return v != null && !isNaN(Number(v)) ? Number(v) : null; };

    const cost = getNum(COL.cost);
    if (cost == null) continue; // skip blank rows

    const transType = getStr(COL.trans_type);
    const costCode  = getStr(COL.cost_code);
    const costType  = getStr(COL.cost_type);
    const weSerial  = getNum(COL.week_ending);
    const tdSerial  = getNum(COL.trans_date);
    const transDate = serialToISO(tdSerial, date1904);
    // Some real exports have no WE/month/year columns at all — fall back to the Friday on/after
    // trans_date, matching the "week ending" convention used everywhere else in the app.
    const weekEnding = serialToISO(weSerial, date1904) || nextFriday(transDate);

    rows.push({
      transaction_id:   getStr(COL.transaction_id),
      trans_date:       transDate,
      agent_code:       getStr(COL.agent_code),
      agent_name:       getStr(COL.agent_name),
      gang_no:          getStr(COL.gang_no),
      gang_name:        getStr(COL.gang_name),
      trans_type:       transType,
      cost_code:        costCode,
      cost_category:    deriveCategory(transType, costCode, costType),
      supplier_account: getStr(COL.supplier_account),
      supplier_name:    getStr(COL.supplier_name),
      stock_item_text:  getStr(COL.stock_item_text),
      document_ref:     getStr(COL.document_ref),
      plant_description:getStr(COL.plant_desc),
      unit_value:       getNum(COL.unit_value),
      qty:              getNum(COL.qty),
      cost:             cost,
      week_ending:      weekEnding,
      month:            getStr(COL.month),
      year:             getNum(COL.year),
    });
  }

  const con = db();
  con.exec('BEGIN');
  try {
    // Clear existing import for this project (fresh import replaces previous)
    con.prepare('DELETE FROM qs_cost_transaction WHERE project_id=? AND source_file=?').run(projectId, sourceFile);

    const stmt = con.prepare(`
      INSERT INTO qs_cost_transaction
        (project_id,transaction_id,trans_date,agent_code,agent_name,gang_no,gang_name,
         trans_type,cost_code,cost_category,supplier_account,supplier_name,
         stock_item_text,document_ref,plant_description,unit_value,qty,cost,
         week_ending,month,year,source_file)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const row of rows) {
      stmt.run(
        projectId, row.transaction_id, row.trans_date, row.agent_code, row.agent_name,
        row.gang_no, row.gang_name, row.trans_type, row.cost_code, row.cost_category,
        row.supplier_account, row.supplier_name, row.stock_item_text, row.document_ref,
        row.plant_description, row.unit_value, row.qty, row.cost,
        row.week_ending, row.month, row.year, sourceFile
      );
    }
    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, imported: rows.length, source_file: sourceFile, sheet_used: sheetName });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// â”€â”€ GET /projects/:pid/qs-costs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Supports ?gang=&category=&week=&search=&page=&limit= — gang/week accept multiple
// values (repeated query params, e.g. ?gang=A&gang=B) for the Excel-style multi-select
// filters; omitting them means "All" (no filter). ?gang_none=1 / ?week_none=1 mean the
// user explicitly unchecked every option (Excel's "Select All" toggled off) — that's
// deliberately distinct from omitting the param, and should match zero rows, not all of them.
router.get('/projects/:pid/qs-costs', (req, res) => {
  const con = db();
  const { category, search, page = 1, limit = 200 } = req.query;
  const gangFilter = [].concat(req.query.gang || []).filter(Boolean);
  const weekFilter = [].concat(req.query.week || []).filter(Boolean);
  const gangNone = req.query.gang_none === '1';
  const weekNone = req.query.week_none === '1';

  let sql = 'SELECT * FROM qs_cost_transaction WHERE project_id=?';
  const params = [req.params.pid];

  if (gangNone)           { sql += ' AND 0'; }
  else if (gangFilter.length) { sql += ` AND gang_name IN (${gangFilter.map(() => '?').join(',')})`;  params.push(...gangFilter); }
  if (category)           { sql += ' AND cost_category=?';                                          params.push(category); }
  if (weekNone)           { sql += ' AND 0'; }
  else if (weekFilter.length) { sql += ` AND week_ending IN (${weekFilter.map(() => '?').join(',')})`; params.push(...weekFilter); }
  if (search)   { sql += ' AND (gang_name LIKE ? OR stock_item_text LIKE ? OR plant_description LIKE ? OR supplier_name LIKE ?)';
                  const t = `%${search}%`;
                  params.push(t, t, t, t); }

  sql += ' ORDER BY trans_date DESC, id DESC';
  sql += ` LIMIT ${Number(limit)} OFFSET ${(Number(page)-1)*Number(limit)}`;

  const rows = con.prepare(sql).all(...params);

  // Summary aggregates (same filters, no pagination)
  let sumSql = `
    SELECT
      cost_category,
      COUNT(*) AS count,
      ROUND(SUM(cost),2) AS total
    FROM qs_cost_transaction WHERE project_id=?
  `;
  const sumParams = [req.params.pid];
  if (gangNone)           { sumSql += ' AND 0'; }
  else if (gangFilter.length) { sumSql += ` AND gang_name IN (${gangFilter.map(() => '?').join(',')})`; sumParams.push(...gangFilter); }
  if (category)           { sumSql += ' AND cost_category=?';                                        sumParams.push(category); }
  if (weekNone)           { sumSql += ' AND 0'; }
  else if (weekFilter.length) { sumSql += ` AND week_ending IN (${weekFilter.map(() => '?').join(',')})`; sumParams.push(...weekFilter); }
  if (search)   { sumSql += ' AND (gang_name LIKE ? OR stock_item_text LIKE ? OR plant_description LIKE ? OR supplier_name LIKE ?)';
                  const t = `%${search}%`;
                  sumParams.push(t, t, t, t); }
  sumSql += ' GROUP BY cost_category ORDER BY total DESC';

  const summary = con.prepare(sumSql).all(...sumParams);

  // Filter options (all gangs, all weeks)
  const gangs  = con.prepare('SELECT DISTINCT gang_name FROM qs_cost_transaction WHERE project_id=? AND gang_name IS NOT NULL ORDER BY gang_name').all(req.params.pid);
  const weeks  = con.prepare('SELECT DISTINCT week_ending FROM qs_cost_transaction WHERE project_id=? AND week_ending IS NOT NULL ORDER BY week_ending DESC').all(req.params.pid);
  const cats   = con.prepare('SELECT DISTINCT cost_category FROM qs_cost_transaction WHERE project_id=? ORDER BY cost_category').all(req.params.pid);

  con.close();
  res.json({ rows, summary, filters: { gangs: gangs.map(r=>r.gang_name), weeks: weeks.map(r=>r.week_ending), categories: cats.map(r=>r.cost_category) } });
});

// â”€â”€ DELETE /projects/:pid/qs-costs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { ids: [1, 2, 3] }
router.delete('/projects/:pid/qs-costs', (req, res) => {
  const ids = req.body.ids;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array', code: 'INVALID_IDS' });
  }
  const con = db();
  const placeholders = ids.map(() => '?').join(',');
  try {
    const stmt = con.prepare(`DELETE FROM qs_cost_transaction WHERE id IN (${placeholders}) AND project_id=?`);
    const result = stmt.run(...ids, req.params.pid);
    con.close();
    res.json({ ok: true, deleted: result.changes });
  } catch (e) {
    con.close();
    throw e;
  }
});

// â”€â”€ GET /projects/:pid/qs-costs/summary-by-week â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/projects/:pid/qs-costs/summary-by-week', (req, res) => {
  const con = db();
  const rows = con.prepare(`
    SELECT week_ending, cost_category, ROUND(SUM(cost),2) AS total
    FROM qs_cost_transaction
    WHERE project_id=? AND week_ending IS NOT NULL
    GROUP BY week_ending, cost_category
    ORDER BY week_ending
  `).all(req.params.pid);
  con.close();
  res.json(rows);
});

router.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, code: err.code || 'ERROR' });
});

module.exports = router;
