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

  // 3. Cost: subs from approved applications + Excel imports
  const wePeriod = weekEnding.slice(0, 7); // YYYY-MM
  const subsVal  = con.prepare(`
    SELECT COALESCE(SUM(a.value_gmc),0) AS total
    FROM sub_application a
    JOIN subcontract sc ON sc.id = a.subcontract_id
    WHERE sc.project_id=? AND substr(a.week_ending,1,7)=? AND a.status NOT IN ('draft')
  `).get(projectId, wePeriod);

  const excelSubs = con.prepare(`
    SELECT COALESCE(SUM(amount),0) AS total
    FROM excel_sub_cost
    WHERE project_id=? AND week_ending=?
  `).get(projectId, weekEnding);

  // Get existing tracker row to read manual cost entries + EFA
  const existing = con.prepare('SELECT * FROM tracker_we WHERE project_id=? AND week_ending=?').get(projectId, weekEnding);
  const costMat   = existing?.cost_materials || 0;
  const costPlant = existing?.cost_plant     || 0;
  const ohp       = existing?.ohp_allowance  || 0;
  const efaRev    = existing?.efa_revenue    || 0;
  const efaCost   = existing?.efa_cost       || 0;
  const targetPct = existing?.target_margin_pct ?? 8.0;

  const costSubs  = subsVal.total + (excelSubs?.total ?? 0);
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

  // Pull QS import costs per week (Material + Plant from qs_cost_transaction)
  const qsRows = con.prepare(`
    SELECT week_ending,
      ROUND(SUM(CASE WHEN cost_category='Material' THEN cost ELSE 0 END),2) AS qs_mat,
      ROUND(SUM(CASE WHEN cost_category='Plant'    THEN cost ELSE 0 END),2) AS qs_plant
    FROM qs_cost_transaction WHERE project_id=? GROUP BY week_ending
  `).all(req.params.pid);
  const qsMap = {};
  qsRows.forEach(r => { qsMap[r.week_ending] = r; });

  // Overlay QS costs and recompute totals/margin/cumulative
  let cumRev = 0, cumCost = 0;
  const enriched = rows.map(r => {
    const qs = qsMap[r.week_ending] || {};
    const mat   = (r.cost_materials || 0) + (qs.qs_mat   || 0);
    const plant = (r.cost_plant     || 0) + (qs.qs_plant || 0);
    const costTotal = Math.round(((r.cost_subs || 0) + mat + plant + (r.ohp_allowance || 0)) * 100) / 100;
    const revTotal  = r.rev_total_week || 0;
    cumRev  += revTotal;
    cumCost += costTotal;
    const marginWeek = Math.round((revTotal  - costTotal)  * 100) / 100;
    const marginCum  = Math.round((cumRev    - cumCost)    * 100) / 100;
    const marginPct  = cumRev > 0 ? Math.round((marginCum / cumRev) * 10000) / 100 : 0;
    return {
      ...r,
      cost_materials:   Math.round(mat   * 100) / 100,
      cost_plant:       Math.round(plant * 100) / 100,
      cost_total_week:  costTotal,
      cost_cumulative:  Math.round(cumCost * 100) / 100,
      rev_cumulative:   Math.round(cumRev  * 100) / 100,
      margin_week:      marginWeek,
      margin_cumulative: marginCum,
      margin_pct:       marginPct,
    };
  });

  // Project summary: this week, previous, cumulative, EFA
  const latest   = enriched[enriched.length - 1] || null;
  const previous = enriched[enriched.length - 2] || null;

  const contractValue = (con.prepare('SELECT contract_value FROM project WHERE id=?').get(req.params.pid) || {}).contract_value || 0;
  const totalBOQ      = (con.prepare('SELECT COALESCE(SUM(qty*rate),0) AS t FROM boq_item WHERE project_id=?').get(req.params.pid) || {}).t || 0;

  // ── Sub breakdown per week ─────────────────────────────────────────────────
  // Get all registered subcontracts for this project
  const subs = con.prepare(`
    SELECT sc.id, sc.ref, sc.description, s.name AS sub_name
    FROM subcontract sc JOIN subcontractor s ON s.id = sc.subcontractor_id
    WHERE sc.project_id=? ORDER BY sc.ref
  `).all(req.params.pid);

  // Cost-Payment per sub per WE — primeiro tenta sub_assessment (Excel import),
  // depois fallback para sub_application (aplicações formais)
  const assessRows = con.prepare(`
    SELECT sub_name, week_ending, ROUND(SUM(gmc_assessment),2) AS cost_payment
    FROM sub_assessment WHERE project_id=? AND week_ending IS NOT NULL
    GROUP BY sub_name, week_ending
  `).all(req.params.pid);
  // index: sheet_name_norm + WE → cost_payment
  const assessMap = {};
  assessRows.forEach(r => { assessMap[`${r.sub_name}__${r.week_ending}`] = r.cost_payment; });

  // Fallback: sub_application por período (YYYY-MM) — apenas status reais (não planned/draft)
  const subPayments = con.prepare(`
    SELECT sc.id AS sub_id, s.name AS sub_name, substr(a.week_ending,1,7) AS period,
      ROUND(SUM(a.value_gmc),2) AS cost_payment
    FROM sub_application a
    JOIN subcontract sc ON sc.id = a.subcontract_id
    JOIN subcontractor s ON s.id = sc.subcontractor_id
    WHERE sc.project_id=? AND a.status NOT IN ('draft')
    GROUP BY sc.id, substr(a.week_ending,1,7)
  `).all(req.params.pid);
  const payMap = {};
  subPayments.forEach(r => { payMap[`${r.sub_id}__${r.period}`] = { cost_payment: r.cost_payment, sub_name: r.sub_name }; });

  // Planned assessments por sub por período (status 'draft' = ainda não aprovado)
  const plannedPayments = con.prepare(`
    SELECT sc.id AS sub_id, s.name AS sub_name, substr(a.week_ending,1,7) AS period,
      ROUND(SUM(a.value_gmc),2) AS planned_cost
    FROM sub_application a
    JOIN subcontract sc ON sc.id = a.subcontract_id
    JOIN subcontractor s ON s.id = sc.subcontractor_id
    WHERE sc.project_id=? AND a.status = 'draft'
    GROUP BY sc.id, substr(a.week_ending,1,7)
  `).all(req.params.pid);
  const plannedMap = {};
  plannedPayments.forEach(r => { plannedMap[`${r.sub_id}__${r.period}`] = r.planned_cost; });

  // Material per sub per WE (from qs_cost_transaction, match on gang_name LIKE sub_name)
  const subMaterials = con.prepare(`
    SELECT week_ending, gang_name,
      ROUND(SUM(CASE WHEN cost_category='Material' THEN cost ELSE 0 END),2) AS cost_material,
      ROUND(SUM(CASE WHEN cost_category='Sub'      THEN cost ELSE 0 END),2) AS cost_sub_payment
    FROM qs_cost_transaction
    WHERE project_id=? AND week_ending IS NOT NULL
    GROUP BY week_ending, gang_name
  `).all(req.params.pid);

  // Revenue manually entered per sub per WE
  const subRevRows = con.prepare(`
    SELECT week_ending, sub_name, revenue_generated, gmc_op_plant, misc_subbies_cost, misc_subbies_revenue
    FROM tracker_sub_revenue WHERE project_id=?
  `).all(req.params.pid);
  // index: sub_name + WE → revenue_generated
  const revMap = {};
  subRevRows.forEach(r => { revMap[`${r.sub_name}__${r.week_ending}`] = r; });

  // Build sub_lines: for each WE, for each sub, aggregate the 3 values
  const subLines = {}; // week_ending → [{sub_id, sub_name, ref, cost_payment, cost_material, revenue_generated}]
  enriched.forEach(r => {
    const we = r.week_ending;
    const period = we.slice(0, 7); // YYYY-MM
    subLines[we] = subs.map(sc => {
      // Cost-Payment: 1º tenta sub_assessment (Excel import) por correspondência de nome de aba
      // O sheet name do Excel pode ser "Folan Civil", "Right Group", etc.
      // Comparamos com palavras-chave do nome do sub registado
      const GENERIC = new Set(['civil','group','engineering','construction','services','limited','solutions','building','contractors','infrastructure','ireland','costs','works','management']);
      const subWords = sc.sub_name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !GENERIC.has(w));
      let costPayment = 0;
      // Procurar em assessMap: chave = "SheetName__WE"
      for (const [key, val] of Object.entries(assessMap)) {
        const [assessSubName, assessWE] = key.split('__');
        if (assessWE === we) {
          const assessNorm = assessSubName.toLowerCase();
          if (subWords.some(w => assessNorm.includes(w))) {
            costPayment += val;
          }
        }
      }
      // Fallback: sub_application formal — só se este sub NÃO tem dados no Excel (assessMap)
      // Se tem dados no Excel, o valor 0 numa semana é correto (sem pagamento nessa semana)
      const hasExcelData = Object.keys(assessMap).some(key => {
        const [assessSubName] = key.split('__');
        const assessNorm = assessSubName.toLowerCase();
        return subWords.some(w => assessNorm.includes(w));
      });
      if (costPayment === 0 && !hasExcelData) {
        const pa = payMap[`${sc.id}__${period}`];
        if (pa) costPayment = pa.cost_payment;
      }

      // Material: match gang_name — try normal includes first, then space-stripped compare
      const matRow = subMaterials.find(m => {
        if (m.week_ending !== we) return false;
        const gn = m.gang_name?.toLowerCase() || '';
        const gnStripped = gn.replace(/\s+/g, '');
        return subWords.some(w => gn.includes(w) || gnStripped.includes(w));
      });
      const costMaterial = matRow?.cost_material || 0;

      // Revenue: from manual entry
      const revRow = revMap[`${sc.sub_name}__${we}`] || {};
      const revenueGenerated = revRow.revenue_generated || 0;

      const plannedCost = plannedMap[`${sc.id}__${period}`] || 0;

      return {
        sub_id:            sc.id,
        sub_name:          sc.sub_name,
        ref:               sc.ref,
        description:       sc.description,
        cost_payment:      Math.round(costPayment  * 100) / 100,
        cost_material:     Math.round(costMaterial * 100) / 100,
        revenue_generated: Math.round(revenueGenerated * 100) / 100,
        planned_cost:      Math.round(plannedCost  * 100) / 100,
      };
    });

    // GMC OP and Misc from manual entry (use first sub_revenue row for this WE with sub_name='__gmc_op__')
    const gmcOp   = revMap[`__gmc_op____${we}`]   || {};
    const misc    = revMap[`__misc____${we}`]      || {};
    subLines[we].__gmc_op__  = { gmc_op_plant:        gmcOp.gmc_op_plant        || 0 };
    subLines[we].__misc__    = { misc_subbies_cost:    misc.misc_subbies_cost    || 0,
                                 misc_subbies_revenue: misc.misc_subbies_revenue || 0 };
  });

  con.close();
  res.json({ rows: enriched, summary: { latest, previous, contractValue, totalBOQ }, sub_lines: subLines });
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

// ── PUT /projects/:pid/tracker/:we/sub-revenue ──────────────────────────────
// Save revenue_generated per sub for a WE (and GMC OP plant + Misc)
router.put('/projects/:pid/tracker/:we/sub-revenue', (req, res) => {
  const con = db();
  const { pid } = req.params;
  const weekEnding = req.params.we;
  const { sub_lines = [], gmc_op_plant = 0, misc_subbies_cost = 0, misc_subbies_revenue = 0 } = req.body;

  con.exec('BEGIN');
  try {
    const stmt = con.prepare(`
      INSERT INTO tracker_sub_revenue (project_id, week_ending, sub_name, revenue_generated)
      VALUES (?,?,?,?)
      ON CONFLICT(project_id, week_ending, sub_name) DO UPDATE SET revenue_generated=excluded.revenue_generated
    `);
    for (const line of sub_lines) {
      stmt.run(pid, weekEnding, line.sub_name, line.revenue_generated || 0);
    }
    // GMC OP
    con.prepare(`
      INSERT INTO tracker_sub_revenue (project_id, week_ending, sub_name, gmc_op_plant)
      VALUES (?,?,?,?)
      ON CONFLICT(project_id, week_ending, sub_name) DO UPDATE SET gmc_op_plant=excluded.gmc_op_plant
    `).run(pid, weekEnding, '__gmc_op__', gmc_op_plant);
    // Misc
    con.prepare(`
      INSERT INTO tracker_sub_revenue (project_id, week_ending, sub_name, misc_subbies_cost, misc_subbies_revenue)
      VALUES (?,?,?,?,?)
      ON CONFLICT(project_id, week_ending, sub_name) DO UPDATE SET
        misc_subbies_cost=excluded.misc_subbies_cost, misc_subbies_revenue=excluded.misc_subbies_revenue
    `).run(pid, weekEnding, '__misc__', misc_subbies_cost, misc_subbies_revenue);

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true });
  } catch(e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// ── DELETE /projects/:pid/tracker/:we ────────────────────────────────────────
router.delete('/projects/:pid/tracker/:we', (req, res) => {
  const con = db();
  con.prepare('DELETE FROM boq_progress WHERE project_id=? AND week_ending=?').run(req.params.pid, req.params.we);
  const r = con.prepare('DELETE FROM tracker_we WHERE project_id=? AND week_ending=?').run(req.params.pid, req.params.we);
  con.close();
  if (r.changes === 0) return res.status(404).json({ error: 'Semana não encontrada' });
  res.json({ ok: true });
});

// Error handler
router.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, code: err.code || 'ERROR' });
});

module.exports = router;
