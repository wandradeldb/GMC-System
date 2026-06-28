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

const STATUS_FLOW = ['draft','assessed','approved','invoiced','paid'];

function notFound(msg) { return Object.assign(new Error(msg), { status: 404, code: 'NOT_FOUND' }); }
function badReq(msg)   { return Object.assign(new Error(msg), { status: 400, code: 'BAD_REQUEST' }); }

// ── SUBCONTRACTORS ───────────────────────────────────────────────────────────

// Search/list suppliers — supports ?q=term&active=1
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

// ── SUBCONTRACTS ─────────────────────────────────────────────────────────────

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
  const { description, contract_value, retention_pct, start_date, end_date, status } = req.body;
  con.prepare(`UPDATE subcontract SET description=COALESCE(?,description), contract_value=COALESCE(?,contract_value),
    retention_pct=COALESCE(?,retention_pct), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date),
    status=COALESCE(?,status) WHERE id=?`)
   .run(description||null, contract_value??null, retention_pct??null, start_date||null, end_date||null, status||null, sc.id);
  res.json(con.prepare('SELECT * FROM subcontract WHERE id=?').get(sc.id));
  con.close();
});

// ── SUB BOQ ITEMS ────────────────────────────────────────────────────────────

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

// ── DASHBOARD ────────────────────────────────────────────────────────────────
// Agregados para o dashboard de gestão (exposição por sub, pipeline, retenção, cash)
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

// ── SUB APPLICATION ──────────────────────────────────────────────────────────

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

router.get('/projects/:pid/subcontracts/:id/applications/:appId', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(req.params.appId, req.params.id);
  if (!app) throw notFound('Application not found');
  const items   = con.prepare(`
    SELECT ai.*, sbi.item_ref, sbi.description, sbi.unit, sbi.qty AS qty_contracted, sbi.rate, sbi.section,
      ROUND(sbi.qty * sbi.rate, 2) AS contract_value,
      ROUND(ai.qty_complete_sub * sbi.rate, 2) AS value_sub,
      ROUND(ai.qty_complete_gmc * sbi.rate, 2) AS value_gmc
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

// Create or upsert an application for a period
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

// ── COMPENSATION EVENTS ──────────────────────────────────────────────────────

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

// ── SUB INVOICES ─────────────────────────────────────────────────────────────

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

// ── PAYMENT RUNS ─────────────────────────────────────────────────────────────

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

// ── DELETE /projects/:pid/subcontracts/:scid ──────────────────────────────────
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
    if (r.changes === 0) return res.status(404).json({ error: 'Subcontract não encontrado' });
    res.json({ ok: true });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// Error handler
router.use((err, _req, res, _next) => {
  res.status(err.status||500).json({ error: err.message, code: err.code||'ERROR' });
});

module.exports = router;
