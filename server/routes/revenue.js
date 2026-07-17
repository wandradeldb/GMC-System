const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const router = express.Router();
const DB_PATH = require('../db-path');
function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  ensureCategoryTable(con);
  return con;
}

// Flexible per-project revenue categories (migration 017) — see server/routes/tracker.js's copy
// of this same function for the full rationale. Duplicated here (not shared via a module) because
// either route file's db() may be the first one hit after a deploy, and each needs the table to
// exist before it runs. Guarded so the backfill only actually executes once.
function ensureCategoryTable(con) {
  con.exec(`CREATE TABLE IF NOT EXISTS tracker_we_category (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    week_ending   TEXT    NOT NULL,
    category      TEXT    NOT NULL,
    revenue       REAL    NOT NULL DEFAULT 0,
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (project_id, week_ending, category)
  )`);
  con.exec('CREATE INDEX IF NOT EXISTS idx_trackercat_project_week ON tracker_we_category(project_id, week_ending)');
  con.exec('CREATE INDEX IF NOT EXISTS idx_trackercat_project_cat  ON tracker_we_category(project_id, category)');

  const alreadyBackfilled = con.prepare('SELECT COUNT(*) c FROM tracker_we_category').get().c > 0;
  if (!alreadyBackfilled) {
    con.exec(`
      INSERT OR IGNORE INTO tracker_we_category (project_id, week_ending, category, revenue)
      SELECT project_id, week_ending, 'Prelim Fixed', rev_prelims_fixed FROM tracker_we WHERE rev_prelims_fixed   != 0
      UNION ALL SELECT project_id, week_ending, 'Prelim Time',  rev_prelims_time   FROM tracker_we WHERE rev_prelims_time   != 0
      UNION ALL SELECT project_id, week_ending, 'Civil Works',  rev_civil          FROM tracker_we WHERE rev_civil          != 0
      UNION ALL SELECT project_id, week_ending, 'MEICA Works',  rev_meica          FROM tracker_we WHERE rev_meica          != 0
      UNION ALL SELECT project_id, week_ending, 'Landscape',    rev_landscape      FROM tracker_we WHERE rev_landscape      != 0
      UNION ALL SELECT project_id, week_ending, 'Commission',   rev_commissioning  FROM tracker_we WHERE rev_commissioning  != 0
      UNION ALL SELECT project_id, week_ending, 'A&E / Design', rev_ae             FROM tracker_we WHERE rev_ae             != 0
    `);
  }
}

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
// section is any non-empty string (migration 017) — the weekly rollup (PUT /revenue/week/:we
// below) groups revenue by this exact string into tracker_we_category rows, one row per distinct
// value, rather than a fixed set of tracker_we columns. Different contracts genuinely use
// different category taxonomies (their own BOQ Section column), so nothing here constrains what
// that string is beyond "must be present" — an empty/missing section still errors, since a row
// with no category has nowhere sensible to land.
router.post('/projects/:pid/revenue/activities', (req, res) => {
  const { rows, section, dedup = true } = req.body || {};
  const projectId = req.params.pid;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import', code: 'EMPTY' });
  }
  const badRows = [];
  const badSections = [];
  rows.forEach((row, i) => {
    if (!row.description || !String(row.description).trim()) badRows.push(i);
    const sec = row.section || section;
    if (!sec || !String(sec).trim()) badSections.push(i);
  });
  if (badRows.length) {
    return res.status(400).json({
      error: `Rows missing description: ${badRows.map(i => i + 1).join(', ')}`,
      code: 'INVALID_ROWS',
    });
  }
  if (badSections.length) {
    return res.status(400).json({
      error: `Rows with no section (row or default): ${badSections.map(i => i + 1).join(', ')}`,
      code: 'MISSING_SECTION',
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
      const rowSection = String(row.section || section).trim();
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

    // Replace this week's Path-B category rows (migration 017) -- one row per distinct
    // revenue_activity.section value currently defined for this project, not a fixed set of
    // columns. Delete-then-insert per category so one whose activities all dropped to 0% (or got
    // recategorised) doesn't linger with a stale value.
    const pathBCategories = new Set(acts.map(a => a.section));
    const delCat = con.prepare('DELETE FROM tracker_we_category WHERE project_id=? AND week_ending=? AND category=?');
    const upsertCat = con.prepare(`
      INSERT INTO tracker_we_category (project_id, week_ending, category, revenue, updated_at)
      VALUES (?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      ON CONFLICT(project_id, week_ending, category) DO UPDATE SET
        revenue=excluded.revenue, updated_at=excluded.updated_at
    `);
    for (const cat of pathBCategories) {
      const v = bySec[cat] || 0;
      if (v) upsertCat.run(pid, we, cat, v);
      else delCat.run(pid, we, cat);
    }

    // rev_total_week = sum of ALL categories now on file for this week -- merges in whatever
    // Path A (tracker.js, boq_progress-driven) already wrote there too, e.g. Merlin Park's
    // 'A&E / Design'. Replaces the old special-cased read of tracker_we.rev_ae, since A&E is now
    // just another category row instead of a field only the other route path could touch.
    const revTotal = (con.prepare('SELECT COALESCE(ROUND(SUM(revenue),2),0) AS t FROM tracker_we_category WHERE project_id=? AND week_ending=?').get(pid, we)).t;
    const wkNum = (con.prepare('SELECT COUNT(*) c FROM tracker_we WHERE project_id=? AND week_ending<?').get(pid, we).c) + 1;

    con.prepare(`
      INSERT INTO tracker_we (project_id, week_ending, week_number, rev_total_week, updated_at)
      VALUES (?,?,?,?,datetime('now'))
      ON CONFLICT(project_id, week_ending) DO UPDATE SET
        rev_total_week=excluded.rev_total_week, updated_at=datetime('now')
    `).run(pid, we, wkNum, revTotal);

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
