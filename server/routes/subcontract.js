const express = require('express');
const path    = require('path');
const XLSX    = require('xlsx');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

const STATUS_FLOW = ['draft','assessed','approved','invoiced','paid'];

function notFound(msg) { return Object.assign(new Error(msg), { status: 404, code: 'NOT_FOUND' }); }
function badReq(msg)   { return Object.assign(new Error(msg), { status: 400, code: 'BAD_REQUEST' }); }

// â”€â”€ SUBCONTRACTORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Search/list suppliers â€” supports ?q=term&active=1
router.get('/subcontractors', (req, res) => {
  const con = db();
  const { q, active } = req.query;
  let sql = 'SELECT id, code, short_name, name, email, phone, balance FROM subcontractor';
  const params = [];
  const where = [];
  if (q) { where.push("(name LIKE ? OR short_name LIKE ? OR code LIKE ?)"); const t = `%${q}%`; params.push(t, t, t); }
  if (active === '1') { where.push('balance > 0'); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY name LIMIT 200';
  res.json(con.prepare(sql).all(...params));
  con.close();
});

router.post('/subcontractors', (req, res) => {
  const con = db();
  const { name, code, short_name, contact, email, phone, vat_number, address } = req.body;
  if (!name) throw badReq('name required');
  const r = con.prepare('INSERT INTO subcontractor (name,code,short_name,contact,email,phone,vat_number,address) VALUES (?,?,?,?,?,?,?,?)')
               .run(name, code||null, short_name||null, contact||null, email||null, phone||null, vat_number||null, address||null);
  res.status(201).json(con.prepare('SELECT * FROM subcontractor WHERE id=?').get(r.lastInsertRowid));
  con.close();
});

// â”€â”€ SUBCONTRACTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/projects/:pid/subcontracts', (req, res) => {
  const con = db();
  const rows = con.prepare(`
    SELECT sc.*, s.name AS subcontractor_name,
      (SELECT COUNT(*) FROM sub_application a WHERE a.subcontract_id = sc.id) AS application_count,
      (SELECT COUNT(*) FROM sub_boq_item b WHERE b.subcontract_id = sc.id) AS boq_item_count,
      (SELECT COALESCE(SUM(value_gmc),0) FROM sub_application a WHERE a.subcontract_id = sc.id AND a.status != 'draft') AS total_certified
    FROM subcontract sc
    JOIN subcontractor s ON s.id = sc.subcontractor_id
    WHERE sc.project_id = ?
    ORDER BY sc.ref
  `).all(req.params.pid);
  con.close();
  res.json(rows);
});

router.get('/projects/:pid/subcontracts/:id', (req, res) => {
  const con = db();
  const sc = con.prepare(`
    SELECT sc.*, s.name AS subcontractor_name, s.email, s.contact
    FROM subcontract sc JOIN subcontractor s ON s.id = sc.subcontractor_id
    WHERE sc.id = ? AND sc.project_id = ?
  `).get(req.params.id, req.params.pid);
  if (!sc) throw notFound('Subcontract not found');
  const boq    = con.prepare('SELECT sbi.*, bi.item_ref AS contract_ref FROM sub_boq_item sbi LEFT JOIN boq_item bi ON bi.id = sbi.boq_item_id WHERE sbi.subcontract_id = ? ORDER BY sbi.sort_order').all(sc.id);
  const apps   = con.prepare('SELECT * FROM sub_application WHERE subcontract_id = ? ORDER BY application_number DESC').all(sc.id);
  const ces    = con.prepare('SELECT * FROM compensation_event WHERE subcontract_id = ? ORDER BY ce_ref').all(sc.id);
  con.close();
  res.json({ subcontract: sc, boq_items: boq, applications: apps, compensation_events: ces });
});

router.post('/projects/:pid/subcontracts', (req, res) => {
  const con = db();
  const { subcontractor_id, ref, description, contract_value, retention_pct, start_date, end_date } = req.body;
  if (!subcontractor_id || !ref || !description) throw badReq('subcontractor_id, ref, description required');
  const r = con.prepare(`
    INSERT INTO subcontract (project_id,subcontractor_id,ref,description,contract_value,retention_pct,start_date,end_date)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(req.params.pid, subcontractor_id, ref, description, contract_value||0, retention_pct??5, start_date||null, end_date||null);
  res.status(201).json(con.prepare('SELECT * FROM subcontract WHERE id=?').get(r.lastInsertRowid));
  con.close();
});

router.patch('/projects/:pid/subcontracts/:id', (req, res) => {
  const con = db();
  const sc = con.prepare('SELECT id FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
  if (!sc) throw notFound('Subcontract not found');
  const { description, contract_value, retention_pct, start_date, end_date, status, sub_type,
          has_contract, has_insurance, responsible_name, phone, email,
          pricing_lumpsum, mat_by, plant_by } = req.body;
  con.prepare(`UPDATE subcontract SET
    description=COALESCE(?,description), contract_value=COALESCE(?,contract_value),
    retention_pct=COALESCE(?,retention_pct), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date),
    status=COALESCE(?,status), sub_type=COALESCE(?,sub_type),
    has_contract=COALESCE(?,has_contract), has_insurance=COALESCE(?,has_insurance),
    responsible_name=COALESCE(?,responsible_name), phone=COALESCE(?,phone), email=COALESCE(?,email),
    pricing_lumpsum=COALESCE(?,pricing_lumpsum), mat_by=COALESCE(?,mat_by), plant_by=COALESCE(?,plant_by)
    WHERE id=?`)
   .run(description||null, contract_value??null, retention_pct??null, start_date||null, end_date||null,
        status||null, sub_type||null,
        has_contract??null, has_insurance??null, responsible_name||null, phone||null, email||null,
        pricing_lumpsum??null, mat_by||null, plant_by||null,
        sc.id);
  res.json(con.prepare('SELECT * FROM subcontract WHERE id=?').get(sc.id));
  con.close();
});

// â”€â”€ SUB BOQ ITEMS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.put('/projects/:pid/subcontracts/:id/boq', (req, res) => {
  const con = db();
  const sc = con.prepare('SELECT id FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
  if (!sc) throw notFound('Subcontract not found');
  const { items = [] } = req.body;
  con.exec('BEGIN');
  con.prepare('DELETE FROM sub_boq_item WHERE subcontract_id=?').run(sc.id);
  const ins = con.prepare('INSERT INTO sub_boq_item (subcontract_id,boq_item_id,item_ref,description,unit,qty,rate,section,sort_order) VALUES (?,?,?,?,?,?,?,?,?)');
  items.forEach((it, i) => ins.run(sc.id, it.boq_item_id||null, it.item_ref, it.description, it.unit, it.qty||0, it.rate||0, it.section||null, i*10));
  con.exec('COMMIT');
  res.json({ ok: true, items: con.prepare('SELECT * FROM sub_boq_item WHERE subcontract_id=? ORDER BY sort_order').all(sc.id) });
  con.close();
});

// â”€â”€ DASHBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Agregados para o dashboard de gestÃ£o (exposiÃ§Ã£o por sub, pipeline, retenÃ§Ã£o, cash)
router.get('/projects/:pid/dashboard', (req, res) => {
  const con = db();
  const pid = req.params.pid;
  const project = con.prepare('SELECT name, ref, client, contract_value FROM project WHERE id=?').get(pid) || {};

  const subs = con.prepare(`
    SELECT sc.id, sc.ref, sc.retention_pct, s.name AS sub_name,
      (SELECT ROUND(SUM(qty*rate),2) FROM sub_boq_item WHERE subcontract_id=sc.id) AS contract_value,
      (SELECT COALESCE(ROUND(SUM(value_gmc),2),0) FROM sub_application WHERE subcontract_id=sc.id AND status!='draft') AS certified
    FROM subcontract sc JOIN subcontractor s ON s.id=sc.subcontractor_id
    WHERE sc.project_id=? ORDER BY contract_value DESC
  `).all(pid);
  const subExposure = subs.map(s => ({
    id: s.id, ref: s.ref, sub_name: s.sub_name,
    contract_value: s.contract_value || 0, certified: s.certified || 0,
    remaining: Math.round(((s.contract_value || 0) - (s.certified || 0)) * 100) / 100,
  }));

  const pipeline = { draft: 0, assessed: 0, approved: 0, invoiced: 0, paid: 0 };
  con.prepare(`
    SELECT a.status, ROUND(SUM(a.value_gmc),2) val
    FROM sub_application a JOIN subcontract sc ON sc.id=a.subcontract_id
    WHERE sc.project_id=? GROUP BY a.status
  `).all(pid).forEach(r => { if (r.status in pipeline) pipeline[r.status] = r.val || 0; });

  const committedTotal = subExposure.reduce((a, s) => a + s.contract_value, 0);
  const certifiedTotal = subExposure.reduce((a, s) => a + s.certified, 0);
  const paidTotal = con.prepare(`
    SELECT COALESCE(ROUND(SUM(a.net_payable),2),0) v
    FROM sub_application a JOIN subcontract sc ON sc.id=a.subcontract_id
    WHERE sc.project_id=? AND a.status='paid'
  `).get(pid).v;
  const retentionHeld = Math.round(subs.reduce((a, s) => a + (s.certified || 0) * (s.retention_pct || 0) / 100, 0) * 100) / 100;

  con.close();
  res.json({
    project, subExposure, pipeline,
    kpis: {
      committedTotal: Math.round(committedTotal * 100) / 100,
      certifiedTotal: Math.round(certifiedTotal * 100) / 100,
      paidTotal,
      retentionHeld,
      owedToSubs: Math.round((certifiedTotal - paidTotal) * 100) / 100,
    },
  });
});

// Update retention % for a subcontract
router.put('/projects/:pid/subcontracts/:id/retention', (req, res) => {
  const con = db();
  const sc = con.prepare('SELECT id FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
  if (!sc) { con.close(); throw notFound('Subcontract not found'); }
  const pct = Math.min(100, Math.max(0, parseFloat(req.body.retention_pct) || 0));
  con.prepare('UPDATE subcontract SET retention_pct=?, updated_at=? WHERE id=?')
    .run(pct, new Date().toISOString(), sc.id);
  con.close();
  res.json({ ok: true, retention_pct: pct });
});

// â”€â”€ SUB BOQ â€” with certified totals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/projects/:pid/subcontracts/:id/boq', (req, res) => {
  const con = db();
  const sc = con.prepare('SELECT id FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
  if (!sc) { con.close(); return res.status(404).json({ error: 'Not found' }); }
  const items = con.prepare(`
    SELECT sbi.*,
      ROUND(sbi.qty * sbi.rate, 2) AS contract_value,
      COALESCE(
        (SELECT ai.pct_complete_gmc FROM sub_application_item ai
         JOIN sub_application a ON a.id = ai.sub_application_id
         WHERE ai.sub_boq_item_id = sbi.id AND a.subcontract_id = ? AND a.status != 'draft'
         ORDER BY a.application_number DESC LIMIT 1), 0
      ) AS pct_certified
    FROM sub_boq_item sbi
    WHERE sbi.subcontract_id = ?
    ORDER BY sbi.sort_order
  `).all(sc.id, sc.id);
  const result = items.map(it => ({
    ...it,
    value_certified:  Math.round((it.pct_certified / 100) * it.contract_value * 100) / 100,
    value_remaining:  Math.round((1 - it.pct_certified / 100) * it.contract_value * 100) / 100,
  }));
  con.close();
  res.json(result);
});

// â”€â”€ SUB APPLICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// List applications
router.get('/projects/:pid/subcontracts/:id/applications', (req, res) => {
  const con = db();
  const apps = con.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM sub_invoice i WHERE i.sub_application_id = a.id) AS invoice_count
    FROM sub_application a
    WHERE a.subcontract_id = ?
    ORDER BY a.application_number DESC
  `).all(req.params.id);
  con.close();
  res.json(apps);
});

// Certificate view data (must be declared before /:appId)
router.get('/projects/:pid/subcontracts/:id/applications/:appId/certificate', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
  if (!app) { con.close(); return res.status(404).json({ error: 'Not found' }); }

  const sc      = con.prepare('SELECT sc.*, s.name AS sub_name FROM subcontract sc JOIN subcontractor s ON s.id=sc.subcontractor_id WHERE sc.id=?').get(req.params.id);
  const project = con.prepare('SELECT name, ref, client FROM project WHERE id=?').get(req.params.pid) || {};
  const history = con.prepare('SELECT * FROM sub_application WHERE subcontract_id=? ORDER BY application_number').all(req.params.id);
  const items   = con.prepare(`
    SELECT ai.*, sbi.item_ref, sbi.description, sbi.unit, ROUND(sbi.qty*sbi.rate,2) AS contract_value
    FROM sub_application_item ai JOIN sub_boq_item sbi ON sbi.id=ai.sub_boq_item_id
    WHERE ai.sub_application_id=? ORDER BY sbi.sort_order
  `).all(app.id);

  const contractValue = con.prepare('SELECT COALESCE(ROUND(SUM(qty*rate),2),0) AS v FROM sub_boq_item WHERE subcontract_id=?').get(req.params.id).v;
  const prevCertified = history.filter(h => h.application_number < app.application_number && h.status !== 'draft')
                                .reduce((s, h) => s + (h.value_gmc || 0), 0);
  const thisApp      = app.value_gmc || 0;
  const cumulative   = Math.round((prevCertified + thisApp) * 100) / 100;
  const retPct       = sc.retention_pct || 5;
  const retAmount    = Math.round(cumulative * retPct / 100 * 100) / 100;
  const netDue       = Math.round((thisApp - retAmount + Math.round(prevCertified * retPct / 100 * 100) / 100) * 100) / 100;

  con.close();
  res.json({
    app,
    project,
    subcontract: { ...sc },
    summary: {
      contractValue,
      thisApp:        Math.round(thisApp * 100) / 100,
      previously:     Math.round(prevCertified * 100) / 100,
      cumulative,
      pctComplete:    contractValue > 0 ? Math.round(cumulative / contractValue * 1000) / 10 : 0,
      retentionPct:   retPct,
      retentionAmount: retAmount,
      netDue:          Math.round(netDue * 100) / 100,
    },
    history,
    items,
  });
});

// Get single application with items
router.get('/projects/:pid/subcontracts/:id/applications/:appId', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
  if (!app) throw notFound('Application not found');
  const items   = con.prepare(`
    SELECT ai.*, sbi.item_ref, sbi.description, sbi.unit, sbi.qty AS qty_contracted, sbi.rate, sbi.section,
      ROUND(sbi.qty * sbi.rate, 2) AS contract_value,
      ROUND(ai.pct_complete_sub / 100 * sbi.qty * sbi.rate, 2) AS value_sub_computed,
      ROUND(ai.pct_complete_gmc / 100 * sbi.qty * sbi.rate, 2) AS value_gmc_computed
    FROM sub_application_item ai
    JOIN sub_boq_item sbi ON sbi.id = ai.sub_boq_item_id
    WHERE ai.sub_application_id = ?
    ORDER BY sbi.sort_order
  `).all(app.id);
  const ces     = con.prepare('SELECT * FROM compensation_event WHERE sub_application_id = ?').all(app.id);
  const invoices = con.prepare('SELECT i.*, pr.run_date, pr.run_ref FROM sub_invoice i LEFT JOIN payment_run pr ON pr.id = i.payment_run_id WHERE i.sub_application_id = ?').all(app.id);
  con.close();
  res.json({ application: app, items, compensation_events: ces, invoices });
});

// Create new application (manual assessment)
router.post('/projects/:pid/subcontracts/:id/applications', (req, res) => {
  const con = db();
  con.exec('BEGIN');
  try {
    const sc = con.prepare('SELECT * FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
    if (!sc) throw notFound('Subcontract not found');

    const { week_ending, status = 'draft', notes, items = [] } = req.body;
    if (!week_ending) throw badReq('week_ending required');

    const nextNum = (con.prepare('SELECT COALESCE(MAX(application_number),0)+1 AS n FROM sub_application WHERE subcontract_id=?').get(sc.id).n);
    const r = con.prepare('INSERT INTO sub_application (subcontract_id,application_number,week_ending,status,notes) VALUES (?,?,?,?,?)')
                 .run(sc.id, nextNum, week_ending, STATUS_FLOW.includes(status) ? status : 'draft', notes || null);
    const appId = r.lastInsertRowid;

    // For each item, compute pct_prev (last approved pct before this app)
    const ins = con.prepare(`
      INSERT INTO sub_application_item
        (sub_application_id, sub_boq_item_id, pct_complete_sub, pct_complete_gmc, pct_prev,
         qty_complete_sub, qty_complete_gmc, value_sub_computed, value_gmc_computed)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    let valueSub = 0, valueGmc = 0;
    for (const it of items) {
      if (!it.sub_boq_item_id) continue;
      const boq = con.prepare('SELECT qty, rate FROM sub_boq_item WHERE id=?').get(it.sub_boq_item_id);
      if (!boq) continue;
      // pct_prev = last approved pct for this item
      const prevRow = con.prepare(`
        SELECT ai.pct_complete_gmc FROM sub_application_item ai
        JOIN sub_application a ON a.id = ai.sub_application_id
        WHERE ai.sub_boq_item_id=? AND a.subcontract_id=? AND a.status != 'draft'
        ORDER BY a.application_number DESC LIMIT 1
      `).get(it.sub_boq_item_id, sc.id);
      const pctPrev = prevRow ? prevRow.pct_complete_gmc : 0;
      const pctSub  = Math.min(100, Math.max(0, parseFloat(it.pct_complete_sub) || 0));
      const pctGmc  = Math.min(100, Math.max(0, parseFloat(it.pct_complete_gmc) || 0));
      const valSub  = Math.round(pctSub / 100 * boq.qty * boq.rate * 100) / 100;
      const valGmc  = Math.round(pctGmc / 100 * boq.qty * boq.rate * 100) / 100;
      // This period value = cumulative minus previous
      const thisSub = Math.round((pctSub - pctPrev) / 100 * boq.qty * boq.rate * 100) / 100;
      const thisGmc = Math.round((pctGmc - pctPrev) / 100 * boq.qty * boq.rate * 100) / 100;
      ins.run(appId, it.sub_boq_item_id, pctSub, pctGmc, pctPrev, boq.qty * pctSub / 100, boq.qty * pctGmc / 100, valSub, valGmc);
      valueSub += Math.max(0, thisSub);
      valueGmc += Math.max(0, thisGmc);
    }

    // Cumulative from previous non-draft apps
    const prevCum = con.prepare(`SELECT COALESCE(SUM(value_gmc),0) AS cum FROM sub_application WHERE subcontract_id=? AND status != 'draft' AND id != ?`).get(sc.id, appId).cum;
    const cumGmc  = Math.round((prevCum + valueGmc) * 100) / 100;
    const retHeld = Math.round(cumGmc * (sc.retention_pct / 100) * 100) / 100;
    const prevRet = Math.round(prevCum * (sc.retention_pct / 100) * 100) / 100;
    const netPay  = Math.round((valueGmc - (retHeld - prevRet)) * 100) / 100;

    con.prepare(`UPDATE sub_application SET value_sub=?, value_gmc=?, cumulative_sub=?, cumulative_gmc=?, net_payable=? WHERE id=?`)
       .run(Math.round(valueSub * 100) / 100, Math.round(valueGmc * 100) / 100,
            Math.round((prevCum + valueSub) * 100) / 100, cumGmc, netPay, appId);

    con.exec('COMMIT');
    const saved = con.prepare('SELECT * FROM sub_application WHERE id=?').get(appId);
    con.close();
    res.json({ ok: true, application: saved });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// Import sub claim from Excel (FormData: file + week_ending)
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
router.post('/projects/:pid/subcontracts/:id/applications/import-excel',
  upload.single('file'),
  (req, res) => {
    const con = db();
    try {
      const sc = con.prepare('SELECT * FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
      if (!sc) { con.close(); return res.status(404).json({ error: 'Subcontract not found' }); }
      if (!req.file) { con.close(); return res.status(400).json({ error: 'No file uploaded' }); }

      const week_ending = req.body.week_ending;
      if (!week_ending) { con.close(); return res.status(400).json({ error: 'week_ending required' }); }

      // Check not already imported for this week
      const existing = con.prepare('SELECT id FROM sub_application WHERE subcontract_id=? AND week_ending=?').get(sc.id, week_ending);
      if (existing) {
        con.close();
        return res.json({ ok: true, results: [{ appNum: 'N/A', created: false, reason: `Week ${week_ending} already has an application (id=${existing.id})` }] });
      }

      // Parse Excel
      const wb  = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const norm = s => String(s).toLowerCase().trim();
      const hdrIdx = raw.findIndex(r => r.some(c => norm(c) === 'description' || norm(c) === 'desc'));
      if (hdrIdx < 0) { con.close(); return res.status(400).json({ error: 'Could not find header row with "Description" column' }); }

      const hdr  = raw[hdrIdx].map(norm);
      const col  = names => hdr.findIndex(h => names.includes(h));
      const iRef    = col(['ref', 'item ref', 'item_ref', 'no', 'no.', '#']);
      const iDesc   = col(['description', 'desc']);
      const iSubPct = col(['sub %', 'sub%', 'sub pct', 'folan %', 'folan%', 'claimed %', 'claim %']);
      const iGmcPct = col(['gmc %', 'gmc%', 'assessed %', 'assessed%', 'gmc assessed']);

      // Load BOQ items for matching
      const boqItems = con.prepare('SELECT * FROM sub_boq_item WHERE subcontract_id=? ORDER BY sort_order').all(sc.id);
      const boqByRef = {};
      boqItems.forEach(b => { boqByRef[String(b.item_ref).trim()] = b; });

      // Parse claim rows
      const refCol = iRef >= 0 ? iRef : 0;
      const claimRows = [];
      for (const r of raw.slice(hdrIdx + 1)) {
        const refVal = String(r[refCol] || '').trim();
        const desc   = String(r[iDesc] || '').trim();
        if (!desc || !refVal || isNaN(parseFloat(refVal))) continue;
        const subPct = iSubPct >= 0 ? (parseFloat(r[iSubPct]) || 0) : 0;
        const gmcPct = iGmcPct >= 0 ? (parseFloat(r[iGmcPct]) || 0) : subPct; // fallback to sub pct
        claimRows.push({ ref: refVal, subPct, gmcPct });
      }

      // Build items for each matched BOQ entry
      con.exec('BEGIN');
      const nextNum = (con.prepare('SELECT COALESCE(MAX(application_number),0)+1 AS n FROM sub_application WHERE subcontract_id=?').get(sc.id).n);
      const appRow  = con.prepare('INSERT INTO sub_application (subcontract_id,application_number,week_ending,status) VALUES (?,?,?,?)').run(sc.id, nextNum, week_ending, 'draft');
      const appId   = appRow.lastInsertRowid;

      const ins = con.prepare(`
        INSERT INTO sub_application_item
          (sub_application_id, sub_boq_item_id, pct_complete_sub, pct_complete_gmc, pct_prev,
           qty_complete_sub, qty_complete_gmc, value_sub_computed, value_gmc_computed)
        VALUES (?,?,?,?,?,?,?,?,?)
      `);

      const overClaim = [];
      const unmatched = [];
      let valueSub = 0, valueGmc = 0;
      const gmcFromSub = claimRows.every(r => iGmcPct < 0);

      for (const claim of claimRows) {
        const boq = boqByRef[claim.ref];
        if (!boq) { unmatched.push(claim.ref); continue; }
        const prevRow = con.prepare(`
          SELECT ai.pct_complete_gmc FROM sub_application_item ai
          JOIN sub_application a ON a.id = ai.sub_application_id
          WHERE ai.sub_boq_item_id=? AND a.subcontract_id=? AND a.status != 'draft'
          ORDER BY a.application_number DESC LIMIT 1
        `).get(boq.id, sc.id);
        const pctPrev = prevRow ? prevRow.pct_complete_gmc : 0;
        const pctSub  = Math.min(100, Math.max(0, claim.subPct));
        const pctGmc  = Math.min(100, Math.max(0, claim.gmcPct));
        const cumSub  = pctPrev + pctSub;
        const cumGmc  = pctPrev + pctGmc;
        if (cumGmc > 100.1) overClaim.push({ ref: claim.ref, cumulative_pct: Math.round(cumGmc * 10) / 10 });
        const valSub = Math.round(pctSub / 100 * boq.qty * boq.rate * 100) / 100;
        const valGmc = Math.round(pctGmc / 100 * boq.qty * boq.rate * 100) / 100;
        ins.run(appId, boq.id, cumSub, cumGmc, pctPrev, boq.qty * cumSub / 100, boq.qty * cumGmc / 100, valSub, valGmc);
        valueSub += valSub;
        valueGmc += valGmc;
      }

      const prevCum = con.prepare(`SELECT COALESCE(SUM(value_gmc),0) AS cum FROM sub_application WHERE subcontract_id=? AND status != 'draft'`).get(sc.id).cum;
      const cumGmcTotal = Math.round((prevCum + valueGmc) * 100) / 100;
      const retHeld = Math.round(cumGmcTotal * (sc.retention_pct / 100) * 100) / 100;
      const prevRet = Math.round(prevCum * (sc.retention_pct / 100) * 100) / 100;
      const netPay  = Math.round((valueGmc - (retHeld - prevRet)) * 100) / 100;

      con.prepare(`UPDATE sub_application SET value_sub=?, value_gmc=?, cumulative_sub=?, cumulative_gmc=?, net_payable=? WHERE id=?`)
         .run(Math.round(valueSub * 100) / 100, Math.round(valueGmc * 100) / 100,
              Math.round((prevCum + valueSub) * 100) / 100, cumGmcTotal, netPay, appId);

      con.exec('COMMIT');
      con.close();
      res.json({
        ok: true,
        results: [{ appNum: nextNum, created: true, value_gmc: Math.round(valueGmc * 100) / 100, items: claimRows.length, week_ending, gmc_from_sub: gmcFromSub }],
        over_claim: overClaim,
        unmatched_refs: unmatched,
      });
    } catch (e) {
      try { con.exec('ROLLBACK'); } catch {}
      con.close();
      throw e;
    }
  }
);

// Save GMC assessment for an application
router.put('/projects/:pid/subcontracts/:id/applications/:appId/assessment', (req, res) => {
  const con = db();
  con.exec('BEGIN');
  try {
    const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
    if (!app) throw notFound('Application not found');
    const sc = con.prepare('SELECT * FROM subcontract WHERE id=?').get(req.params.id);

    const { items = [] } = req.body;
    let valueGmc = 0;
    for (const it of items) {
      if (!it.id) continue;
      const gmcVal = Math.round((parseFloat(it.value_gmc) || 0) * 100) / 100;
      // Recalculate pct from value
      const boq = con.prepare('SELECT sbi.qty, sbi.rate FROM sub_application_item ai JOIN sub_boq_item sbi ON sbi.id=ai.sub_boq_item_id WHERE ai.id=?').get(it.id);
      const cv  = boq ? boq.qty * boq.rate : 0;
      const pct = cv > 0 ? Math.round(gmcVal / cv * 10000) / 100 : 0;
      con.prepare('UPDATE sub_application_item SET value_gmc_computed=?, pct_complete_gmc=?, qty_complete_gmc=? WHERE id=?')
         .run(gmcVal, pct, boq ? boq.qty * pct / 100 : 0, it.id);
      valueGmc += gmcVal;
    }

    const prevCum = con.prepare(`SELECT COALESCE(SUM(value_gmc),0) AS cum FROM sub_application WHERE subcontract_id=? AND status != 'draft' AND id != ?`).get(req.params.id, app.id).cum;
    const cumGmc  = Math.round((prevCum + valueGmc) * 100) / 100;
    const retHeld = Math.round(cumGmc * (sc.retention_pct / 100) * 100) / 100;
    const prevRet = Math.round(prevCum * (sc.retention_pct / 100) * 100) / 100;
    const netPay  = Math.round((valueGmc - (retHeld - prevRet)) * 100) / 100;
    con.prepare('UPDATE sub_application SET value_gmc=?, cumulative_gmc=?, net_payable=? WHERE id=?')
       .run(Math.round(valueGmc * 100) / 100, cumGmc, netPay, app.id);

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// Change status
router.put('/projects/:pid/subcontracts/:id/applications/:appId/status', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT id FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
  if (!app) { con.close(); return res.status(404).json({ error: 'Not found' }); }
  const { status } = req.body;
  if (!STATUS_FLOW.includes(status)) { con.close(); return res.status(400).json({ error: 'Invalid status' }); }
  const dateField = status === 'approved' ? `, qs_approved_date=strftime('%Y-%m-%d','now')` : '';
  con.prepare(`UPDATE sub_application SET status=?${dateField} WHERE id=?`).run(status, app.id);
  con.close();
  res.json({ ok: true });
});

// Delete application
router.delete('/projects/:pid/subcontracts/:id/applications/:appId', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT id FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
  if (!app) { con.close(); return res.status(404).json({ error: 'Not found' }); }
  con.prepare('DELETE FROM sub_application_item WHERE sub_application_id=?').run(app.id);
  con.prepare('DELETE FROM sub_application WHERE id=?').run(app.id);
  con.close();
  res.json({ ok: true });
});

// Create or upsert an application for a period (legacy)
router.put('/projects/:pid/subcontracts/:id/applications/:period', (req, res) => {
  const con = db();
  con.exec('BEGIN');
  try {
    const sc = con.prepare('SELECT * FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
    if (!sc) throw notFound('Subcontract not found');

    const period = req.params.period; // YYYY-MM
    const { items = [], compensation_events = [], header = {} } = req.body;

    // Get or create application
    let app = con.prepare('SELECT * FROM sub_application WHERE subcontract_id=? AND period=?').get(sc.id, period);
    const nextNum = app ? app.application_number :
      (con.prepare('SELECT COALESCE(MAX(application_number),0)+1 AS n FROM sub_application WHERE subcontract_id=?').get(sc.id).n);

    if (!app) {
      const r = con.prepare('INSERT INTO sub_application (subcontract_id,application_number,period,status) VALUES (?,?,?,?)').run(sc.id, nextNum, period, 'draft');
      app = con.prepare('SELECT * FROM sub_application WHERE id=?').get(r.lastInsertRowid);
    }

    // Replace line items
    con.prepare('DELETE FROM sub_application_item WHERE sub_application_id=?').run(app.id);
    const insItem = con.prepare('INSERT INTO sub_application_item (sub_application_id,sub_boq_item_id,qty_complete_sub,qty_complete_gmc,notes) VALUES (?,?,?,?,?)');
    let valueSub = 0, valueGmc = 0;
    items.forEach(it => {
      const boqRow = con.prepare('SELECT rate FROM sub_boq_item WHERE id=?').get(it.sub_boq_item_id);
      if (!boqRow) return;
      insItem.run(app.id, it.sub_boq_item_id, it.qty_complete_sub||0, it.qty_complete_gmc||0, it.notes||null);
      valueSub += (it.qty_complete_sub||0) * boqRow.rate;
      valueGmc += (it.qty_complete_gmc||0) * boqRow.rate;
    });

    // Add agreed CEs to values
    const agreedCEs = con.prepare("SELECT COALESCE(SUM(gmc_value),0) AS total FROM compensation_event WHERE sub_application_id=? AND status='agreed'").get(app.id);
    valueGmc += agreedCEs.total;

    // Cumulative (sum all previous approved + this)
    const prevCum = con.prepare(`
      SELECT COALESCE(SUM(value_gmc),0) AS cum FROM sub_application
      WHERE subcontract_id=? AND period < ? AND status NOT IN ('draft')
    `).get(sc.id, period);
    const cumGmc     = prevCum.cum + valueGmc;
    const retHeld    = Math.round(cumGmc * (sc.retention_pct / 100) * 100) / 100;
    const prevRetain = Math.round(prevCum.cum * (sc.retention_pct / 100) * 100) / 100;
    const netPayable = Math.round((valueGmc - (retHeld - prevRetain)) * 100) / 100;

    // Update header
    const newStatus = header.status && STATUS_FLOW.includes(header.status) ? header.status : app.status;
    con.prepare(`
      UPDATE sub_application SET
        value_sub=?, value_gmc=?, cumulative_sub=?, cumulative_gmc=?,
        net_payable=?, qs_approved_by=?, qs_approved_date=?,
        invoice_requested=?, status=?, notes=?
      WHERE id=?
    `).run(
      Math.round(valueSub*100)/100, Math.round(valueGmc*100)/100,
      Math.round((prevCum.cum + valueSub)*100)/100, cumGmc,
      netPayable,
      header.qs_approved_by||app.qs_approved_by||null,
      header.qs_approved_date||app.qs_approved_date||null,
      header.invoice_requested ?? app.invoice_requested,
      newStatus, header.notes||app.notes||null,
      app.id
    );

    con.exec('COMMIT');
    const saved = con.prepare('SELECT * FROM sub_application WHERE id=?').get(app.id);
    const savedItems = con.prepare(`
      SELECT ai.*, sbi.item_ref, sbi.description, sbi.unit, sbi.qty AS qty_contracted, sbi.rate, sbi.section,
        ROUND(ai.qty_complete_sub * sbi.rate, 2) AS value_sub,
        ROUND(ai.qty_complete_gmc * sbi.rate, 2) AS value_gmc
      FROM sub_application_item ai JOIN sub_boq_item sbi ON sbi.id = ai.sub_boq_item_id
      WHERE ai.sub_application_id = ? ORDER BY sbi.sort_order
    `).all(app.id);
    con.close();
    res.json({ ok: true, application: saved, items: savedItems });
  } catch(e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// Approve an application
router.post('/projects/:pid/subcontracts/:id/applications/:appId/approve', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
  if (!app) throw notFound('Application not found');
  if (app.status !== 'assessed') throw badReq('Can only approve an assessed application');
  const { approved_by } = req.body;
  if (!approved_by) throw badReq('approved_by required');
  con.prepare(`UPDATE sub_application SET status='approved', qs_approved_by=?, qs_approved_date=strftime('%Y-%m-%d','now') WHERE id=?`)
     .run(approved_by, app.id);
  res.json(con.prepare('SELECT * FROM sub_application WHERE id=?').get(app.id));
  con.close();
});

// â”€â”€ COMPENSATION EVENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/projects/:pid/subcontracts/:id/ces', (req, res) => {
  const con = db();
  const sc = con.prepare('SELECT id FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
  if (!sc) throw notFound('Subcontract not found');
  const { ce_ref, description, sub_value, gmc_value, status, sub_application_id, notes } = req.body;
  if (!ce_ref || !description) throw badReq('ce_ref and description required');
  const r = con.prepare('INSERT INTO compensation_event (subcontract_id,sub_application_id,ce_ref,description,sub_value,gmc_value,status,notes) VALUES (?,?,?,?,?,?,?,?)')
               .run(sc.id, sub_application_id||null, ce_ref, description, sub_value||0, gmc_value||0, status||'submitted', notes||null);
  res.status(201).json(con.prepare('SELECT * FROM compensation_event WHERE id=?').get(r.lastInsertRowid));
  con.close();
});

router.patch('/projects/:pid/subcontracts/:id/ces/:ceId', (req, res) => {
  const con = db();
  const ce = con.prepare('SELECT id FROM compensation_event WHERE id=? AND subcontract_id=?').get(req.params.ceId, req.params.id);
  if (!ce) throw notFound('CE not found');
  const { gmc_value, status, approved_date, notes } = req.body;
  con.prepare(`UPDATE compensation_event SET gmc_value=COALESCE(?,gmc_value), status=COALESCE(?,status),
    approved_date=COALESCE(?,approved_date), notes=COALESCE(?,notes) WHERE id=?`)
   .run(gmc_value??null, status||null, approved_date||null, notes||null, ce.id);
  res.json(con.prepare('SELECT * FROM compensation_event WHERE id=?').get(ce.id));
  con.close();
});

// â”€â”€ SUB INVOICES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/projects/:pid/subcontracts/:id/applications/:appId/invoices', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
  if (!app) throw notFound('Application not found');
  if (!['approved'].includes(app.status)) throw badReq('Application must be approved before invoicing');
  const { invoice_number, invoice_date, gross_amount, retention_amount, notes } = req.body;
  if (!invoice_number || !invoice_date || gross_amount == null) throw badReq('invoice_number, invoice_date, gross_amount required');
  const r = con.prepare('INSERT INTO sub_invoice (sub_application_id,invoice_number,invoice_date,gross_amount,retention_amount,notes) VALUES (?,?,?,?,?,?)')
               .run(app.id, invoice_number, invoice_date, gross_amount, retention_amount||0, notes||null);
  // Update application status
  con.prepare("UPDATE sub_application SET status='invoiced', invoice_requested=1 WHERE id=?").run(app.id);
  res.status(201).json(con.prepare('SELECT * FROM sub_invoice WHERE id=?').get(r.lastInsertRowid));
  con.close();
});

router.patch('/projects/:pid/invoices/:invoiceId', (req, res) => {
  const con = db();
  const inv = con.prepare('SELECT * FROM sub_invoice WHERE id=?').get(req.params.invoiceId);
  if (!inv) throw notFound('Invoice not found');
  const { sent_finance_date, payment_run_id, payment_date, status, notes } = req.body;
  con.prepare(`UPDATE sub_invoice SET
    sent_finance_date=COALESCE(?,sent_finance_date), payment_run_id=COALESCE(?,payment_run_id),
    payment_date=COALESCE(?,payment_date), status=COALESCE(?,status), notes=COALESCE(?,notes)
    WHERE id=?`).run(sent_finance_date||null, payment_run_id||null, payment_date||null, status||null, notes||null, inv.id);
  if (status === 'paid') {
    const updated = con.prepare('SELECT * FROM sub_invoice WHERE id=?').get(inv.id);
    con.prepare("UPDATE sub_application SET status='paid' WHERE id=?").run(updated.sub_application_id);
  }
  res.json(con.prepare('SELECT * FROM sub_invoice WHERE id=?').get(inv.id));
  con.close();
});

// â”€â”€ PAYMENT RUNS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/projects/:pid/payment-runs', (req, res) => {
  const con = db();
  const runs = con.prepare(`
    SELECT pr.*,
      COUNT(i.id) AS invoice_count,
      COALESCE(SUM(i.net_amount),0) AS total_net
    FROM payment_run pr
    LEFT JOIN sub_invoice i ON i.payment_run_id = pr.id
    WHERE pr.project_id = ?
    GROUP BY pr.id ORDER BY pr.run_date DESC
  `).all(req.params.pid);
  con.close();
  res.json(runs);
});

router.post('/projects/:pid/payment-runs', (req, res) => {
  const con = db();
  const { run_ref, run_date, description } = req.body;
  if (!run_ref || !run_date) throw badReq('run_ref and run_date required');
  const r = con.prepare('INSERT INTO payment_run (project_id,run_ref,run_date,description) VALUES (?,?,?,?)')
               .run(req.params.pid, run_ref, run_date, description||null);
  res.status(201).json(con.prepare('SELECT * FROM payment_run WHERE id=?').get(r.lastInsertRowid));
  con.close();
});

router.patch('/projects/:pid/payment-runs/:runId', (req, res) => {
  const con = db();
  const { status } = req.body;
  con.prepare('UPDATE payment_run SET status=COALESCE(?,status) WHERE id=? AND project_id=?').run(status||null, req.params.runId, req.params.pid);
  if (status === 'paid') {
    // Mark all linked invoices as paid
    con.prepare("UPDATE sub_invoice SET status='paid', payment_date=strftime('%Y-%m-%d','now') WHERE payment_run_id=?").run(req.params.runId);
    con.prepare(`UPDATE sub_application SET status='paid' WHERE id IN (SELECT sub_application_id FROM sub_invoice WHERE payment_run_id=?)`)
       .run(req.params.runId);
  }
  res.json(con.prepare('SELECT * FROM payment_run WHERE id=?').get(req.params.runId));
  con.close();
});

// â”€â”€ DELETE /projects/:pid/subcontracts/:scid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/projects/:pid/subcontracts/:scid', (req, res) => {
  const con = db();
  con.exec('BEGIN');
  try {
    // Delete applications and their items
    const apps = con.prepare('SELECT id FROM sub_application WHERE subcontract_id=?').all(req.params.scid);
    for (const a of apps) {
      con.prepare('DELETE FROM sub_application_item WHERE sub_application_id=?').run(a.id);
    }
    con.prepare('DELETE FROM sub_application WHERE subcontract_id=?').run(req.params.scid);
    con.prepare('DELETE FROM sub_boq_item WHERE subcontract_id=?').run(req.params.scid);
    const r = con.prepare('DELETE FROM subcontract WHERE id=? AND project_id=?')
      .run(req.params.scid, req.params.pid);
    con.exec('COMMIT');
    con.close();
    if (r.changes === 0) return res.status(404).json({ error: 'Subcontract nÃ£o encontrado' });
    res.json({ ok: true });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// â”€â”€ SUB BOQ IMPORT (Excel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Expects JSON body: { file: '<base64>', mode: 'replace'|'append' }
// Excel columns (any order, header row required):
//   Ref | Description | Unit | Qty | Rate | Section
router.post('/projects/:pid/subcontracts/:id/boq/import', (req, res) => {
  const con = db();
  const sc = con.prepare('SELECT id FROM subcontract WHERE id=? AND project_id=?').get(req.params.id, req.params.pid);
  if (!sc) { con.close(); return res.status(404).json({ error: 'Not found' }); }

  const { file, mode = 'replace' } = req.body;
  if (!file) { con.close(); return res.status(400).json({ error: 'No file data' }); }

  const buf  = Buffer.from(file, 'base64');
  const wb   = XLSX.read(buf, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Find the header row: first row where any cell contains "description" (case-insensitive)
  const norm   = (s) => String(s).toLowerCase().trim();
  const hdrIdx = raw.findIndex(r => r.some(c => norm(c) === 'description'));

  let items = [];

  if (hdrIdx >= 0) {
    // Map by header names (column index â†’ field)
    const hdr = raw[hdrIdx].map(norm);
    const col  = (names) => hdr.findIndex(h => names.includes(h));
    const iRef  = col(['ref', 'item ref', 'item_ref', 'no', 'no.', 'no,.', '#']);
    const iDesc = col(['description', 'desc']);
    const iQty  = col(['qty', 'quantity']);
    const iUnit = col(['unit']);
    const iRate = col(['rate']);           // first "rate" column = sub-rates
    const iSec  = col(['section', 'sub category', 'category', 'section/category']);

    // Last seen section label (for rows where col 0 is empty = section header)
    let currentSection = null;
    const refCol = iRef >= 0 ? iRef : 0; // fallback to col 0 when header is blank

    items = raw.slice(hdrIdx + 1).reduce((acc, r) => {
      const desc = String(r[iDesc] || '').trim();
      if (!desc) return acc;

      // Section header row: ref cell is empty or non-numeric
      const refVal = r[refCol];
      const isItem = refVal !== '' && refVal !== null && !isNaN(parseFloat(refVal));

      if (!isItem) {
        // treat as section label
        currentSection = desc;
        return acc;
      }

      acc.push({
        item_ref:    String(refVal).trim(),
        description: desc,
        unit:        iUnit >= 0 ? String(r[iUnit] || '').trim() : '',
        qty:         iQty  >= 0 ? parseFloat(r[iQty])  || 0 : 0,
        rate:        iRate >= 0 ? parseFloat(r[iRate]) || 0 : 0,
        section:     iSec  >= 0 ? (String(r[iSec] || '').trim() || currentSection || null) : currentSection,
      });
      return acc;
    }, []);
  }

  con.exec('BEGIN');
  if (mode === 'replace') con.prepare('DELETE FROM sub_boq_item WHERE subcontract_id=?').run(sc.id);
  const ins = con.prepare('INSERT INTO sub_boq_item (subcontract_id,item_ref,description,unit,qty,rate,section,sort_order) VALUES (?,?,?,?,?,?,?,?)');
  const base = mode === 'append'
    ? ((con.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM sub_boq_item WHERE subcontract_id=?').get(sc.id) || {}).m || 0) + 10
    : 0;
  items.forEach((it, i) => ins.run(sc.id, it.item_ref, it.description, it.unit, it.qty, it.rate, it.section, base + i * 10));
  con.exec('COMMIT');

  const saved = con.prepare('SELECT * FROM sub_boq_item WHERE subcontract_id=? ORDER BY sort_order').all(sc.id);
  con.close();
  res.json({ ok: true, imported: items.length, total: saved.length, items: saved });
});

// Error handler
router.use((err, _req, res, _next) => {
  res.status(err.status||500).json({ error: err.message, code: err.code||'ERROR' });
});

module.exports = router;
