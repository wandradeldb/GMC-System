const express = require('express');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = path.join(__dirname, '../../db/gmc.db');

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

// ── Revenue category classifier ─────────────────────────────────────────────
// Maps a boq_item row → one of the 7 revenue buckets
function revenueCategory(item) {
  const desc = (item.description || '').toLowerCase();
  const sch  = item.schedule;
  if (sch === '1')  return 'prelims_fixed';
  if (sch === '1A') return 'prelims_time';
  if (sch === '2') {
    if (/commission|training|testing|performance test/.test(desc)) return 'commissioning';
    if (/landscape|landscaping/.test(desc))                         return 'landscape';
    if (/mechanical|electrical|control|instrumentation|meica/.test(desc)) return 'meica';
    if (/civil|excavat|tank|pipeline|manhole|sewer|water main/.test(desc)) return 'civil';
  }
  // Design/AE items (from Sch1 prelims — Design Principles etc.)
  if (/design|ae |a&e|engineering|architect/.test(desc)) return 'ae';
  return 'civil'; // fallback for schedule 2 uncategorised
}

// ── Recalculate a tracker_we row from source data ──────────────────────────
function recalcWeek(con, projectId, weekEnding) {
  // 1. Revenue from BOQ_PROGRESS
  const progressRows = con.prepare(`
    SELECT bp.boq_item_id, bp.pct_complete_prev, bp.pct_complete_this,
           bi.schedule, bi.description,
           ROUND(bi.qty * bi.rate, 2) AS contract_sum
    FROM boq_progress bp
    JOIN boq_item bi ON bi.id = bp.boq_item_id
    WHERE bp.project_id = ? AND bp.week_ending = ?
  `).all(projectId, weekEnding);

  const rev = { prelims_fixed:0, prelims_time:0, civil:0, meica:0, landscape:0, commissioning:0, ae:0 };
  for (const row of progressRows) {
    const cat   = revenueCategory(row);
    const delta = Math.max(0, (row.pct_complete_this - row.pct_complete_prev) / 100) * row.contract_sum;
    rev[cat] += delta;
  }
  const revTotal = Object.values(rev).reduce((s, v) => s + v, 0);

  // 2. Revenue cumulative (all weeks up to and including this WE)
  const prevWeeks = con.prepare(`
    SELECT COALESCE(SUM(rev_total_week),0) AS cum
    FROM tracker_we WHERE project_id=? AND week_ending < ?
  `).get(projectId, weekEnding);
  const revCumulative = prevWeeks.cum + revTotal;

  // 3. Cost: subs from approved applications whose period falls within the WE's month
  //    Convention: WE maps to YYYY-MM by taking the month of the week_ending date
  const wePeriod = weekEnding.slice(0, 7); // YYYY-MM
  const subsVal  = con.prepare(`
    SELECT COALESCE(SUM(a.value_gmc),0) AS total
    FROM sub_application a
    JOIN subcontract sc ON sc.id = a.subcontract_id
    WHERE sc.project_id=? AND a.period=? AND a.status NOT IN ('draft')
  `).get(projectId, wePeriod);

  // Get existing tracker row to read manual cost entries + EFA
  const existing = con.prepare('SELECT * FROM tracker_we WHERE project_id=? AND week_ending=?').get(projectId, weekEnding);
  const costMat   = existing?.cost_materials || 0;
  const costPlant = existing?.cost_plant     || 0;
  const ohp       = existing?.ohp_allowance  || 0;
  const efaRev    = existing?.efa_revenue    || 0;
  const efaCost   = existing?.efa_cost       || 0;
  const targetPct = existing?.target_margin_pct ?? 8.0;

  const costSubs  = subsVal.total;
  const costTotal = costSubs + costMat + costPlant + ohp;

  // 4. Cost cumulative
  const prevCostWeeks = con.prepare(`
    SELECT COALESCE(SUM(cost_total_week),0) AS cum
    FROM tracker_we WHERE project_id=? AND week_ending < ?
  `).get(projectId, weekEnding);
  const costCumulative = prevCostWeeks.cum + costTotal;

  // 5. Margin
  const marginWeek = revTotal - costTotal;
  const marginCum  = revCumulative - costCumulative;
  const marginPct  = revCumulative > 0 ? (marginCum / revCumulative) * 100 : 0;

  // 6. EFA margin
  const efaMargin    = efaRev - efaCost;
  const efaMarginPct = efaRev > 0 ? (efaMargin / efaRev) * 100 : 0;

  // 7. Week number (sequential position)
  const wkNum = (con.prepare('SELECT COUNT(*)+1 AS n FROM tracker_we WHERE project_id=? AND week_ending < ?').get(projectId, weekEnding)).n;

  return {
    rev_prelims_fixed:  Math.round(rev.prelims_fixed  * 100) / 100,
    rev_prelims_time:   Math.round(rev.prelims_time   * 100) / 100,
    rev_civil:          Math.round(rev.civil           * 100) / 100,
    rev_meica:          Math.round(rev.meica           * 100) / 100,
    rev_landscape:      Math.round(rev.landscape       * 100) / 100,
    rev_commissioning:  Math.round(rev.commissioning   * 100) / 100,
    rev_ae:             Math.round(rev.ae              * 100) / 100,
    rev_total_week:     Math.round(revTotal            * 100) / 100,
    rev_cumulative:     Math.round(revCumulative       * 100) / 100,
    cost_subs:          Math.round(costSubs            * 100) / 100,
    cost_materials:     costMat,
    cost_plant:         costPlant,
    ohp_allowance:      ohp,
    cost_total_week:    Math.round(costTotal           * 100) / 100,
    cost_cumulative:    Math.round(costCumulative      * 100) / 100,
    margin_week:        Math.round(marginWeek          * 100) / 100,
    margin_cumulative:  Math.round(marginCum           * 100) / 100,
    margin_pct:         Math.round(marginPct           * 100) / 100,
    efa_revenue:        efaRev,
    efa_cost:           efaCost,
    efa_margin:         Math.round(efaMargin           * 100) / 100,
    efa_margin_pct:     Math.round(efaMarginPct        * 100) / 100,
    target_margin_pct:  targetPct,
    week_number:        wkNum,
  };
}

// ── GET /projects/:pid/tracker  ─────────────────────────────────────────────
// Returns all tracker_we rows ordered by week_ending ASC (columns for the UI)
router.get('/projects/:pid/tracker', (req, res) => {
  const con  = db();
  const rows = con.prepare('SELECT * FROM tracker_we WHERE project_id=? ORDER BY week_ending ASC').all(req.params.pid);

  // Project summary: this week, previous, cumulative, EFA
  const latest   = rows[rows.length - 1] || null;
  const previous = rows[rows.length - 2] || null;

  const contractValue = (con.prepare('SELECT contract_value FROM project WHERE id=?').get(req.params.pid) || {}).contract_value || 0;
  const totalBOQ      = (con.prepare('SELECT COALESCE(SUM(qty*rate),0) AS t FROM boq_item WHERE project_id=?').get(req.params.pid) || {}).t || 0;

  con.close();
  res.json({ rows, summary: { latest, previous, contractValue, totalBOQ } });
});

// ── GET /projects/:pid/tracker/:we  ─────────────────────────────────────────
// Get single WE detail including BOQ progress lines
router.get('/projects/:pid/tracker/:we', (req, res) => {
  const con     = db();
  const tracker = con.prepare('SELECT * FROM tracker_we WHERE project_id=? AND week_ending=?').get(req.params.pid, req.params.we);

  // BOQ progress for this WE (all items)
  const boqProgress = con.prepare(`
    SELECT bi.id AS boq_item_id, bi.item_ref, bi.description, bi.unit, bi.schedule,
           bi.type, ROUND(bi.qty * bi.rate, 2) AS contract_sum,
           COALESCE(bp.pct_complete_prev, 0) AS pct_complete_prev,
           COALESCE(bp.pct_complete_this, 0) AS pct_complete_this,
           COALESCE(bp.notes, '') AS progress_notes
    FROM boq_item bi
    LEFT JOIN boq_progress bp ON bp.boq_item_id = bi.id AND bp.week_ending = ? AND bp.project_id = ?
    WHERE bi.project_id = ?
    ORDER BY bi.sort_order, bi.schedule, bi.item_ref
  `).all(req.params.we, req.params.pid, req.params.pid);

  con.close();
  res.json({ tracker, boq_progress: boqProgress });
});

// ── PUT /projects/:pid/tracker/:we  ─────────────────────────────────────────
// Upsert tracker for a WE: save BOQ progress + manual costs + EFA, then recalc
router.put('/projects/:pid/tracker/:we', (req, res) => {
  const con = db();
  con.exec('BEGIN');
  try {
    const { pid }  = req.params;
    const weekEnding = req.params.we;
    const { boq_progress = [], costs = {}, efa = {}, entered_by, notes } = req.body;

    // 1. Upsert BOQ progress lines
    const insBP = con.prepare(`
      INSERT INTO boq_progress (project_id, boq_item_id, week_ending, pct_complete_prev, pct_complete_this, entered_by, notes)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(project_id, boq_item_id, week_ending) DO UPDATE SET
        pct_complete_prev=excluded.pct_complete_prev,
        pct_complete_this=excluded.pct_complete_this,
        entered_by=excluded.entered_by, notes=excluded.notes
    `);
    for (const item of boq_progress) {
      if (item.pct_complete_this == null) continue;
      insBP.run(pid, item.boq_item_id, weekEnding,
        item.pct_complete_prev ?? 0,
        Math.min(100, Math.max(0, item.pct_complete_this ?? 0)),
        entered_by || null, item.progress_notes || null);
    }

    // 2. Calculate aggregated values
    const calc = recalcWeek(con, pid, weekEnding);

    // Override manual cost entries from request
    if (costs.cost_materials != null) calc.cost_materials  = parseFloat(costs.cost_materials) || 0;
    if (costs.cost_plant     != null) calc.cost_plant      = parseFloat(costs.cost_plant)     || 0;
    if (costs.ohp_allowance  != null) calc.ohp_allowance   = parseFloat(costs.ohp_allowance)  || 0;
    if (efa.efa_revenue      != null) calc.efa_revenue     = parseFloat(efa.efa_revenue)      || 0;
    if (efa.efa_cost         != null) calc.efa_cost        = parseFloat(efa.efa_cost)         || 0;
    if (efa.target_margin_pct != null) calc.target_margin_pct = parseFloat(efa.target_margin_pct) || 8;

    // Recompute totals with updated manual values
    calc.cost_total_week  = Math.round((calc.cost_subs + calc.cost_materials + calc.cost_plant + calc.ohp_allowance) * 100) / 100;
    const prevCost = (con.prepare('SELECT COALESCE(SUM(cost_total_week),0) AS c FROM tracker_we WHERE project_id=? AND week_ending<?').get(pid, weekEnding)).c;
    calc.cost_cumulative  = Math.round((prevCost + calc.cost_total_week) * 100) / 100;
    calc.margin_week      = Math.round((calc.rev_total_week - calc.cost_total_week) * 100) / 100;
    calc.margin_cumulative= Math.round((calc.rev_cumulative - calc.cost_cumulative) * 100) / 100;
    calc.margin_pct       = calc.rev_cumulative > 0 ? Math.round((calc.margin_cumulative / calc.rev_cumulative) * 10000) / 100 : 0;
    calc.efa_margin        = Math.round((calc.efa_revenue - calc.efa_cost) * 100) / 100;
    calc.efa_margin_pct    = calc.efa_revenue > 0 ? Math.round((calc.efa_margin / calc.efa_revenue) * 10000) / 100 : 0;

    // 3. Upsert tracker_we
    con.prepare(`
      INSERT INTO tracker_we (
        project_id, week_ending, week_number,
        rev_prelims_fixed, rev_prelims_time, rev_civil, rev_meica, rev_landscape, rev_commissioning, rev_ae,
        rev_total_week, rev_cumulative,
        cost_subs, cost_materials, cost_plant, ohp_allowance, cost_total_week, cost_cumulative,
        margin_week, margin_cumulative, margin_pct,
        efa_revenue, efa_cost, efa_margin, efa_margin_pct, target_margin_pct,
        entered_by, notes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id, week_ending) DO UPDATE SET
        week_number=excluded.week_number,
        rev_prelims_fixed=excluded.rev_prelims_fixed, rev_prelims_time=excluded.rev_prelims_time,
        rev_civil=excluded.rev_civil, rev_meica=excluded.rev_meica,
        rev_landscape=excluded.rev_landscape, rev_commissioning=excluded.rev_commissioning, rev_ae=excluded.rev_ae,
        rev_total_week=excluded.rev_total_week, rev_cumulative=excluded.rev_cumulative,
        cost_subs=excluded.cost_subs, cost_materials=excluded.cost_materials,
        cost_plant=excluded.cost_plant, ohp_allowance=excluded.ohp_allowance,
        cost_total_week=excluded.cost_total_week, cost_cumulative=excluded.cost_cumulative,
        margin_week=excluded.margin_week, margin_cumulative=excluded.margin_cumulative, margin_pct=excluded.margin_pct,
        efa_revenue=excluded.efa_revenue, efa_cost=excluded.efa_cost,
        efa_margin=excluded.efa_margin, efa_margin_pct=excluded.efa_margin_pct,
        target_margin_pct=excluded.target_margin_pct,
        entered_by=excluded.entered_by, notes=excluded.notes
    `).run(
      pid, weekEnding, calc.week_number,
      calc.rev_prelims_fixed, calc.rev_prelims_time, calc.rev_civil, calc.rev_meica,
      calc.rev_landscape, calc.rev_commissioning, calc.rev_ae,
      calc.rev_total_week, calc.rev_cumulative,
      calc.cost_subs, calc.cost_materials, calc.cost_plant, calc.ohp_allowance,
      calc.cost_total_week, calc.cost_cumulative,
      calc.margin_week, calc.margin_cumulative, calc.margin_pct,
      calc.efa_revenue, calc.efa_cost, calc.efa_margin, calc.efa_margin_pct, calc.target_margin_pct,
      entered_by || null, notes || null
    );

    con.exec('COMMIT');
    const saved = con.prepare('SELECT * FROM tracker_we WHERE project_id=? AND week_ending=?').get(pid, weekEnding);
    con.close();
    res.json({ ok: true, tracker: saved });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// ── GET /projects/:pid/tracker/:we/progress-sheet  ──────────────────────────
// Returns BOQ items grouped by schedule for the progress entry form
router.get('/projects/:pid/tracker/:we/progress-sheet', (req, res) => {
  const con = db();
  const { pid } = req.params;
  const weekEnding = req.params.we;

  // Get previous WE to prefill pct_complete_prev
  const prevWE = (con.prepare('SELECT MAX(week_ending) AS we FROM tracker_we WHERE project_id=? AND week_ending<?').get(pid, weekEnding) || {}).we;

  const items = con.prepare(`
    SELECT bi.id AS boq_item_id, bi.item_ref, bi.description, bi.unit, bi.schedule, bi.type, bi.section,
           ROUND(bi.qty * bi.rate, 2) AS contract_sum, bi.sort_order,
           COALESCE(bp_prev.pct_complete_this, 0) AS pct_complete_prev,
           COALESCE(bp_this.pct_complete_this, 0) AS pct_complete_this,
           COALESCE(bp_this.notes, '') AS progress_notes
    FROM boq_item bi
    LEFT JOIN boq_progress bp_prev ON bp_prev.boq_item_id = bi.id AND bp_prev.project_id=? AND bp_prev.week_ending=?
    LEFT JOIN boq_progress bp_this ON bp_this.boq_item_id = bi.id AND bp_this.project_id=? AND bp_this.week_ending=?
    WHERE bi.project_id=?
    ORDER BY bi.sort_order, bi.schedule
  `).all(pid, prevWE || '', pid, weekEnding, pid);

  con.close();
  res.json({ week_ending: weekEnding, prev_week_ending: prevWE, items });
});

// Error handler
router.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, code: err.code || 'ERROR' });
});

module.exports = router;
