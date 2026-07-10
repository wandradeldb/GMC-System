const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const router = express.Router();
const DB_PATH = require('../db-path');
function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

// secÃ§Ã£o â†’ coluna de revenue no tracker_we
const SECTION_COL = {
  'Prelim Fixed':  'rev_prelims_fixed',
  'Prelim Time':   'rev_prelims_time',
  'Civil Works':   'rev_civil',
  'MEICA Works':   'rev_meica',
  'Landscape':     'rev_landscape',
  'Commission':    'rev_commissioning',
};

// â”€â”€ GET /projects/:pid/revenue/history â”€â”€â”€ todas as WE com dados por atividade â”€â”€
router.get('/projects/:pid/revenue/history', (req, res) => {
  const con = db();
  const { pid } = req.params;
  const weeks = con.prepare(
    'SELECT DISTINCT week_ending FROM revenue_week WHERE project_id=? ORDER BY week_ending ASC'
  ).all(pid).map(r => r.week_ending);
  const rows = con.prepare(
    'SELECT activity_id, week_ending, pct_complete, revenue FROM revenue_week WHERE project_id=? ORDER BY week_ending ASC'
  ).all(pid);
  con.close();
  const data = {};
  rows.forEach(r => {
    if (!data[r.activity_id]) data[r.activity_id] = {};
    data[r.activity_id][r.week_ending] = { pct: r.pct_complete, rev: r.revenue };
  });
  res.json({ weeks, data });
});

// â”€â”€ GET /projects/:pid/revenue/activities â”€â”€â”€ lista de atividades (vista contrato) â”€â”€
router.get('/projects/:pid/revenue/activities', (req, res) => {
  const con = db();
  const acts = con.prepare(`
    SELECT ra.*, s.name AS default_sub_name, sc.ref AS default_sub_ref
    FROM revenue_activity ra
    LEFT JOIN subcontract sc ON sc.id = ra.default_sub_id
    LEFT JOIN subcontractor s ON s.id = sc.subcontractor_id
    WHERE ra.project_id=? ORDER BY ra.sort_order
  `).all(req.params.pid);
  con.close();
  res.json(acts);
});

// POST /projects/:pid/revenue/activities — bulk-create/update activities (e.g. from BOQ import).
// section must be one of SECTION_COL's keys — the weekly rollup (PUT /revenue/week/:we below) sums
// revenue by this exact string into fixed tracker_we columns, so an unrecognized value would silently
// vanish from the Cost Tracker instead of erroring.
router.post('/projects/:pid/revenue/activities', (req, res) => {
  const { rows, section, dedup = true } = req.body || {};
  const projectId = req.params.pid;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import', code: 'EMPTY' });
  }
  const validSections = Object.keys(SECTION_COL);
  const badRows = [];
  const badSections = [];
  rows.forEach((row, i) => {
    if (!row.description || !String(row.description).trim()) badRows.push(i);
    if (!validSections.includes(row.section || section)) badSections.push(i);
  });
  if (badRows.length) {
    return res.status(400).json({
      error: `Rows missing description: ${badRows.map(i => i + 1).join(', ')}`,
      code: 'INVALID_ROWS',
    });
  }
  if (badSections.length) {
    return res.status(400).json({
      error: `Rows with no valid section (row or default): ${badSections.map(i => i + 1).join(', ')}`,
      code: 'INVALID_SECTION',
    });
  }

  const con = db();
  con.exec('BEGIN');
  try {
    const findStmt = con.prepare('SELECT id FROM revenue_activity WHERE project_id = ? AND ref = ?');
    const insertStmt = con.prepare(`
      INSERT INTO revenue_activity (project_id, ref, description, qty, unit, rate, contract_value, section, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    const updateStmt = con.prepare(`
      UPDATE revenue_activity SET description=?, qty=?, unit=?, rate=?, contract_value=?, section=?
      WHERE id=?
    `);
    let nextSort = (con.prepare('SELECT COALESCE(MAX(sort_order),-1) AS m FROM revenue_activity WHERE project_id=?').get(projectId).m) + 1;

    let inserted = 0, updated = 0;
    for (const row of rows) {
      const ref = row.item_ref || row.ref || '';
      const qty = row.qty || 0;
      const rate = row.rate || 0;
      const contractValue = Math.round(qty * rate * 100) / 100;
      const rowSection = row.section || section;
      // dedup=false (full-sheet import): always insert. The source PD Ref repeats by design
      // (e.g. 106 rows share ref "2.1.1"), so deduping by ref would collapse them into one row.
      const existing = (dedup && ref) ? findStmt.get(projectId, ref) : null;
      if (existing) {
        updateStmt.run(row.description, qty, row.unit || '', rate, contractValue, rowSection, existing.id);
        updated++;
      } else {
        insertStmt.run(projectId, ref, row.description, qty, row.unit || '', rate, contractValue, rowSection, nextSort++);
        inserted++;
      }
    }

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, inserted, updated, total: rows.length });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    res.status(400).json({ error: e.message, code: 'COMMIT_FAILED' });
  }
});

// â”€â”€ GET /projects/:pid/revenue/week/:we â”€â”€â”€ atividades + valores desta semana â”€â”€
router.get('/projects/:pid/revenue/week/:we', (req, res) => {
  const con = db();
  const { pid, we } = req.params;
  const acts = con.prepare(`
    SELECT ra.id, ra.ref, ra.description, ra.unit, ra.qty, ra.rate, ra.contract_value, ra.section, ra.default_sub_id
    FROM revenue_activity ra WHERE ra.project_id=? ORDER BY ra.sort_order
  `).all(pid);
  const wk = con.prepare('SELECT activity_id, pct_complete, sub_id, revenue FROM revenue_week WHERE project_id=? AND week_ending=?').all(pid, we);
  const wkMap = {};
  wk.forEach(w => { wkMap[w.activity_id] = w; });
  con.close();
  res.json({
    week_ending: we,
    activities: acts.map(a => {
      const w = wkMap[a.id];
      return {
        id: a.id, ref: a.ref, description: a.description, unit: a.unit, qty: a.qty, rate: a.rate,
        contract_value: a.contract_value, section: a.section,
        pct_complete: w ? w.pct_complete : 0,
        sub_id: w ? w.sub_id : a.default_sub_id,
        revenue: w ? w.revenue : 0,
      };
    }),
  });
});

// â”€â”€ PUT /projects/:pid/revenue/week/:we â”€â”€â”€ grava a semana + alimenta o tracker â”€â”€
router.put('/projects/:pid/revenue/week/:we', (req, res) => {
  const con = db();
  const { pid, we } = req.params;
  const { items = [] } = req.body;

  const acts = con.prepare('SELECT id, contract_value, section FROM revenue_activity WHERE project_id=?').all(pid);
  const actMap = {};
  acts.forEach(a => { actMap[a.id] = a; });

  con.exec('BEGIN');
  try {
    const up = con.prepare(`
      INSERT INTO revenue_week (project_id, activity_id, week_ending, pct_complete, sub_id, revenue, updated_at)
      VALUES (?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(activity_id, week_ending) DO UPDATE SET
        pct_complete=excluded.pct_complete, sub_id=excluded.sub_id, revenue=excluded.revenue, updated_at=datetime('now')
    `);
    for (const it of items) {
      const a = actMap[it.activity_id];
      if (!a) continue;
      const pct = Math.min(100, Math.max(0, Number(it.pct_complete) || 0));
      const rev = Math.round(pct / 100 * (a.contract_value || 0) * 100) / 100;
      up.run(pid, it.activity_id, we, pct, it.sub_id || null, rev);
    }

    // Somar revenue por secÃ§Ã£o (toda a semana, do DB)
    const totals = con.prepare(`
      SELECT ra.section, ROUND(SUM(rw.revenue),2) v
      FROM revenue_week rw JOIN revenue_activity ra ON ra.id = rw.activity_id
      WHERE rw.project_id=? AND rw.week_ending=? GROUP BY ra.section
    `).all(pid, we);
    const bySec = {};
    totals.forEach(t => { bySec[t.section] = t.v || 0; });

    const revFixed = bySec['Prelim Fixed'] || 0, revTime = bySec['Prelim Time'] || 0,
          revCivil = bySec['Civil Works'] || 0, revMeica = bySec['MEICA Works'] || 0,
          revLand  = bySec['Landscape'] || 0,    revComm  = bySec['Commission'] || 0;
    const existing = con.prepare('SELECT rev_ae FROM tracker_we WHERE project_id=? AND week_ending=?').get(pid, we);
    const revAe = existing ? (existing.rev_ae || 0) : 0;
    const revTotal = Math.round((revFixed + revTime + revCivil + revMeica + revLand + revComm + revAe) * 100) / 100;
    const wkNum = (con.prepare('SELECT COUNT(*) c FROM tracker_we WHERE project_id=? AND week_ending<?').get(pid, we).c) + 1;

    con.prepare(`
      INSERT INTO tracker_we
        (project_id, week_ending, week_number, rev_prelims_fixed, rev_prelims_time, rev_civil, rev_meica, rev_landscape, rev_commissioning, rev_total_week, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(project_id, week_ending) DO UPDATE SET
        rev_prelims_fixed=excluded.rev_prelims_fixed, rev_prelims_time=excluded.rev_prelims_time,
        rev_civil=excluded.rev_civil, rev_meica=excluded.rev_meica, rev_landscape=excluded.rev_landscape,
        rev_commissioning=excluded.rev_commissioning, rev_total_week=excluded.rev_total_week, updated_at=datetime('now')
    `).run(pid, we, wkNum, revFixed, revTime, revCivil, revMeica, revLand, revComm, revTotal);

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, week_ending: we, sections: bySec, rev_total_week: revTotal });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

router.use((err, _req, res, _next) => {
  console.error('Revenue error:', err);
  res.status(500).json({ error: err.message });
});

module.exports = router;
